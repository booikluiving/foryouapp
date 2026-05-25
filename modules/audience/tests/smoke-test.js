"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs/promises");
const net = require("node:net");
const path = require("node:path");
const { spawn } = require("node:child_process");
const { loadWs } = require("../server/realtime-loader");

const WebSocket = loadWs();

const TEST_DIR = __dirname;
const APP_ROOT = path.resolve(TEST_DIR, "../../..");
const PORTS = {};
const PROTECTED_V1_FILES = [
  path.join(APP_ROOT, "legacy", "data", "live.sqlite"),
  path.join(APP_ROOT, "legacy", "data", "live.sqlite-wal"),
  path.join(APP_ROOT, "legacy", "data", "live.sqlite-shm"),
];

async function sha256(filePath) {
  const data = await fs.readFile(filePath);
  return crypto.createHash("sha256").update(data).digest("hex");
}

async function protectedHashes() {
  const entries = [];
  for (const filePath of PROTECTED_V1_FILES) entries.push([filePath, await sha256(filePath)]);
  return Object.fromEntries(entries);
}

function assertHashesEqual(before, after) {
  for (const filePath of PROTECTED_V1_FILES) {
    assert.equal(after[filePath], before[filePath], `${path.basename(filePath)} changed`);
  }
}

async function findFreePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.once("listening", () => {
      const port = server.address().port;
      server.close(() => resolve(port));
    });
    server.listen(0);
  });
}

async function allocatePorts() {
  const out = {};
  for (const name of ["catalog", "paths", "algorithm", "runtime", "audience"]) {
    out[name] = await findFreePort();
  }
  return out;
}

async function fetchJson(baseUrl, pathname, options = {}) {
  const response = await fetch(`${baseUrl}${pathname}`, options);
  const body = await response.json();
  if (!response.ok) throw new Error(`${pathname} returned ${response.status}: ${JSON.stringify(body)}`);
  return body;
}

async function fetchText(baseUrl, pathname, options = {}) {
  const response = await fetch(`${baseUrl}${pathname}`, options);
  const text = await response.text();
  if (!response.ok) throw new Error(`${pathname} returned ${response.status}: ${text.slice(0, 200)}`);
  return text;
}

async function waitForHealth(child, baseUrl, serviceName, logs) {
  const deadline = Date.now() + 10000;
  while (Date.now() < deadline) {
    if (child.exitCode != null) throw new Error(`${serviceName} exited early (${child.exitCode}): ${logs.join("")}`);
    try {
      const health = await fetchJson(baseUrl, "/health");
      if (health.ok && health.service === serviceName) return health;
    } catch (_err) {
      await new Promise((resolve) => setTimeout(resolve, 150));
    }
  }
  throw new Error(`${serviceName} did not become healthy: ${logs.join("")}`);
}

function spawnService(name, script, env) {
  const logs = [];
  const child = spawn(process.execPath, [script], {
    cwd: APP_ROOT,
    env: { ...process.env, ...env },
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout.on("data", (chunk) => logs.push(String(chunk)));
  child.stderr.on("data", (chunk) => logs.push(String(chunk)));
  return { name, child, logs };
}

async function stopService(service) {
  if (!service || !service.child || service.child.exitCode != null) return;
  await new Promise((resolve) => {
    const forceTimer = setTimeout(() => {
      if (service.child.exitCode == null) {
        try { service.child.kill("SIGKILL"); } catch {}
      }
      setTimeout(resolve, 250);
    }, 1500);
    service.child.once("exit", () => {
      clearTimeout(forceTimer);
      resolve();
    });
    service.child.kill("SIGTERM");
  });
}

async function stopServices(services) {
  for (const service of services.slice().reverse()) await stopService(service);
}

function assertAudienceDoesNotChooseOrder(value) {
  const text = JSON.stringify(value);
  for (const key of ["preparedNext", "resolvedPreparedNext", "eligiblePool", "pathAvailable", "order", "scoreFeed"]) {
    assert(!text.includes(`"${key}"`), `${key} should not be emitted by Audience`);
  }
}

function waitForWsMessage(client, predicate, label, timeoutMs = 5000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error(`Timed out waiting for ${label}`));
    }, timeoutMs);
    function cleanup() {
      clearTimeout(timer);
      client.messages = client.messages || [];
      client.ws.off("message", onMessage);
      client.ws.off("close", onClose);
      client.ws.off("error", onError);
    }
    function inspect(msg) {
      try {
        if (predicate(msg)) {
          cleanup();
          resolve(msg);
          return true;
        }
      } catch {}
      return false;
    }
    function onMessage(raw) {
      let msg = null;
      try {
        msg = JSON.parse(String(raw));
      } catch {
        return;
      }
      client.messages.push(msg);
      inspect(msg);
    }
    function onClose(code) {
      cleanup();
      reject(new Error(`Socket closed while waiting for ${label}: ${code}`));
    }
    function onError(err) {
      cleanup();
      reject(err);
    }
    for (const msg of client.messages || []) {
      if (inspect(msg)) return;
    }
    client.ws.on("message", onMessage);
    client.ws.on("close", onClose);
    client.ws.on("error", onError);
  });
}

async function openAudienceClient(baseWsUrl, cookie, clientTag, name) {
  const messages = [];
  const ws = new WebSocket(`${baseWsUrl}/v2/audience/realtime?sid=${Date.now()}-${clientTag}`, {
    headers: { Cookie: cookie },
  });
  const client = { ws, messages, clientTag, name };
  ws.on("message", (raw) => {
    try {
      messages.push(JSON.parse(String(raw)));
    } catch {}
  });
  await new Promise((resolve, reject) => {
    ws.once("open", resolve);
    ws.once("error", reject);
  });
  await waitForWsMessage(client, (msg) => msg.type === "hello", "hello");
  ws.send(JSON.stringify({ type: "register", clientTag, name }));
  await new Promise((resolve) => setTimeout(resolve, 120));
  return client;
}

async function waitForClose(client, label, timeoutMs = 5000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Timed out waiting for close: ${label}`)), timeoutMs);
    client.ws.once("close", (code) => {
      clearTimeout(timer);
      resolve(code);
    });
  });
}

async function waitForRuntimeLiveScore(runtimeBase, showRunId, situationRunId, timeoutMs = 8000) {
  const deadline = Date.now() + timeoutMs;
  let lastState = null;
  while (Date.now() < deadline) {
    lastState = await fetchJson(runtimeBase, `/v0/runtime/runs/${encodeURIComponent(showRunId)}`);
    const feed = lastState && lastState.lastScoreFeed;
    if (feed
      && feed.source === "audience_live_algorithm"
      && feed.scorePhase === "live"
      && feed.updatedAfterSituationRunId === situationRunId) {
      return lastState;
    }
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  throw new Error(`Timed out waiting for live Runtime score: ${JSON.stringify(lastState && lastState.lastScoreFeed || null)}`);
}

async function waitForAlgorithmLiveSignals(algorithmBase, showRunId, minimumHearts, timeoutMs = 8000) {
  const deadline = Date.now() + timeoutMs;
  let context = null;
  while (Date.now() < deadline) {
    context = await fetchJson(algorithmBase, `/v0/algorithm/scoring-contexts/${encodeURIComponent(showRunId)}`);
    const hearts = Number(context
      && context.liveAudienceObservation
      && context.liveAudienceObservation.chatAppSignals
      && context.liveAudienceObservation.chatAppSignals.heartCount || 0);
    if (hearts >= minimumHearts) return context;
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  throw new Error(`Timed out waiting for Algorithm live hearts: ${JSON.stringify(context && context.liveAudienceObservation || null)}`);
}

async function waitForRuntimeFinalScore(runtimeBase, showRunId, situationRunId, timeoutMs = 8000) {
  const deadline = Date.now() + timeoutMs;
  let lastState = null;
  while (Date.now() < deadline) {
    lastState = await fetchJson(runtimeBase, `/v0/runtime/runs/${encodeURIComponent(showRunId)}`);
    const feed = lastState && lastState.lastScoreFeed;
    const finalized = lastState
      && lastState.finalizationStatus
      && lastState.finalizationStatus.status === "complete";
    if (finalized
      && feed
      && feed.scorePhase === "definitive"
      && feed.updatedAfterSituationRunId === situationRunId) {
      return lastState;
    }
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  throw new Error(`Timed out waiting for final Runtime score: ${JSON.stringify(lastState && lastState.finalizationStatus || null)}`);
}

async function main() {
  Object.assign(PORTS, await allocatePorts());
  const beforeHashes = await protectedHashes();
  const services = [];
  const tempDbDir = await fs.mkdtemp(path.join(TEST_DIR, "tmp-audience-db-"));
  const tempAlgorithmDbDir = await fs.mkdtemp(path.join(TEST_DIR, "tmp-algorithm-db-"));
  const tempRuntimeDbDir = await fs.mkdtemp(path.join(TEST_DIR, "tmp-runtime-db-"));
  const sockets = [];
  try {
    const catalogScript = path.join(APP_ROOT, "modules", "catalog", "server", "server.js");
    const pathsScript = path.join(APP_ROOT, "modules", "paths", "server", "server.js");
    const algorithmScript = path.join(APP_ROOT, "modules", "algorithm", "server", "server.js");
    const runtimeScript = path.join(APP_ROOT, "modules", "runtime", "server", "server.js");
    const audienceScript = path.join(APP_ROOT, "modules", "audience", "server", "server.js");

    services.push(spawnService("catalog", catalogScript, {
      CATALOG_PORT: String(PORTS.catalog),
      V2_CATALOG_LEGACY_SQLITE_PATH: "/missing.sqlite",
    }));
    await waitForHealth(services[0].child, `http://127.0.0.1:${PORTS.catalog}`, "catalog", services[0].logs);

    services.push(spawnService("paths", pathsScript, {
      PATHS_PORT: String(PORTS.paths),
      V2_PATHS_CATALOG_URL: `http://127.0.0.1:${PORTS.catalog}`,
      V2_PATHS_LEGACY_SQLITE_PATH: "/missing.sqlite",
    }));
    await waitForHealth(services[1].child, `http://127.0.0.1:${PORTS.paths}`, "paths", services[1].logs);

    services.push(spawnService("algorithm", algorithmScript, {
      ALGORITHM_PORT: String(PORTS.algorithm),
      V2_ALGORITHM_DB_DIR: tempAlgorithmDbDir,
    }));
    await waitForHealth(services[2].child, `http://127.0.0.1:${PORTS.algorithm}`, "algorithm", services[2].logs);

    services.push(spawnService("runtime", runtimeScript, {
      RUNTIME_PORT: String(PORTS.runtime),
      V2_RUNTIME_DB_DIR: tempRuntimeDbDir,
      V2_RUNTIME_CATALOG_URL: `http://127.0.0.1:${PORTS.catalog}`,
      V2_RUNTIME_PATHS_URL: `http://127.0.0.1:${PORTS.paths}`,
      V2_RUNTIME_ALGORITHM_URL: `http://127.0.0.1:${PORTS.algorithm}`,
      V2_RUNTIME_AUDIENCE_URL: `http://127.0.0.1:${PORTS.audience}`,
    }));
    await waitForHealth(services[3].child, `http://127.0.0.1:${PORTS.runtime}`, "runtime", services[3].logs);

    services.push(spawnService("audience", audienceScript, {
      AUDIENCE_PORT: String(PORTS.audience),
      V2_AUDIENCE_RUNTIME_URL: `http://127.0.0.1:${PORTS.runtime}`,
      V2_AUDIENCE_ALGORITHM_URL: `http://127.0.0.1:${PORTS.algorithm}`,
      V2_AUDIENCE_DB_DIR: tempDbDir,
    }));
    await waitForHealth(services[4].child, `http://127.0.0.1:${PORTS.audience}`, "audience", services[4].logs);

    const algorithmBase = `http://127.0.0.1:${PORTS.algorithm}`;
    const runtimeBase = `http://127.0.0.1:${PORTS.runtime}`;
    const audienceBase = `http://127.0.0.1:${PORTS.audience}`;
    const audienceWsBase = `ws://127.0.0.1:${PORTS.audience}`;

    const adminHtml = await fetchText(audienceBase, "/admin");
    assert(adminHtml.includes("Audience Admin V2"));
    const publicHtml = await fetchText(audienceBase, "/");
    assert(publicHtml.includes("reactionBar"));

    const runtimeStarted = await fetchJson(runtimeBase, "/v0/runtime/runs/start", { method: "POST" });
    const active = await fetchJson(runtimeBase, `/v0/runtime/runs/${runtimeStarted.showRunId}/start-situation`, {
      method: "POST",
    });
    const activeSituation = active.activeSituation;
    assert(activeSituation && activeSituation.situationRunId);

    const algorithmRun = await fetchJson(algorithmBase, `/v0/algorithm/scoring-contexts/${encodeURIComponent(active.showRunId)}`);
    assert.equal(algorithmRun.showRunId, active.showRunId);
    await fs.rm(path.join(tempAlgorithmDbDir, "scoring-contexts", `${active.showRunId}.json`), { force: true });
    await fs.rm(path.join(tempAlgorithmDbDir, "runs", `${active.showRunId}.json`), { force: true });

    const started = await fetchJson(audienceBase, "/v2/audience/admin/sessions/start", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Smoke audience", tokenTtlMinutes: 30 }),
    });
    assert(started.session.id);
    assert(started.join.token);
    assert(started.join.joinPath.includes("/join?token="));

    const joinResponse = await fetch(`${audienceBase}${started.join.joinPath}`, { redirect: "manual" });
    assert.equal(joinResponse.status, 302);
    const cookie = String(joinResponse.headers.get("set-cookie") || "").split(";")[0];
    assert(cookie.includes("fy_audience_access="));

    const clientA = await openAudienceClient(audienceWsBase, cookie, "client-a", "Alice");
    const clientB = await openAudienceClient(audienceWsBase, cookie, "client-b", "Bob");
    sockets.push(clientA.ws, clientB.ws);

    clientA.ws.send(JSON.stringify({ type: "comment", name: "Alice", text: "meer hiervan", clientTag: "client-a" }));
    await waitForWsMessage(clientB, (msg) => msg.type === "comment" && msg.text === "meer hiervan", "live chat on second client");

    clientB.ws.send(JSON.stringify({ type: "reaction", reaction: "heart", clientTag: "client-b" }));
    await new Promise((resolve) => setTimeout(resolve, 160));
    clientA.ws.send(JSON.stringify({ type: "reaction", reaction: "heart", clientTag: "client-a" }));
    await new Promise((resolve) => setTimeout(resolve, 350));

    const liveRuntime = await waitForRuntimeLiveScore(runtimeBase, active.showRunId, activeSituation.situationRunId);
    const activeLiveScore = liveRuntime.lastScoreFeed.scores.find((score) => score.situationId === activeSituation.situationId);
    assert(activeLiveScore && activeLiveScore.reasons.includes("live_audience_signals"));
    assert(activeLiveScore.predictedScore > 0, "live heart/comment signals should produce a positive active score");
    assert.equal(liveRuntime.preparedNext.situationId, active.preparedNext.situationId, "live scores must not change preparedNext");
    assert(liveRuntime.runLog.some((item) => item.type === "score_feed_received" && item.source === "audience_live_algorithm"));
    for (let index = 1; index < liveRuntime.eligiblePool.length; index += 1) {
      const previousValue = liveRuntime.eligiblePool[index - 1].scoreValue;
      const currentValue = liveRuntime.eligiblePool[index].scoreValue;
      const previous = Number(previousValue === null || previousValue === undefined ? 0 : previousValue);
      const currentScore = Number(currentValue === null || currentValue === undefined ? 0 : currentValue);
      assert(previous >= currentScore, "Runtime eligiblePool should be sorted by live score");
    }

    const liveAlgorithmContext = await waitForAlgorithmLiveSignals(algorithmBase, active.showRunId, 2);
    assert.equal(liveAlgorithmContext.observations.length, 0, "live audience signals should not create final observations");
    assert(liveAlgorithmContext.liveAudienceObservation);
    assert(liveAlgorithmContext.liveAudienceObservation.chatAppSignals.heartCount >= 2);

    let adminState = await fetchJson(audienceBase, "/v2/audience/admin/state");
    assert(adminState.users.length >= 2);
    assert(adminState.recentMessages.some((message) => message.text === "meer hiervan"));
    assert.equal(adminState.reactionCounts.heart, 2);
    assert.equal(adminState.runtime.liveScoreDispatch.ok, true);
    assert(adminState.runtime.liveScoreDispatch.recoveryCount >= 1, "Audience should recover missing Algorithm context through Runtime");

    await fetchJson(audienceBase, "/v2/audience/admin/users/mute", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ targetKind: "client", clientKey: "127.0.0.1|client-a", minutes: 5 }),
    });
    await waitForWsMessage(clientA, (msg) => msg.type === "moderation_notice" && msg.code === "user_muted", "mute notice");
    clientA.ws.send(JSON.stringify({ type: "comment", name: "Alice", text: "mag dit?", clientTag: "client-a" }));
    await waitForWsMessage(clientA, (msg) => msg.type === "error" && msg.code === "user_muted", "mute enforcement");
    await fetchJson(audienceBase, "/v2/audience/admin/users/unmute", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ targetKind: "client", clientKey: "127.0.0.1|client-a" }),
    });

    const clientC = await openAudienceClient(audienceWsBase, cookie, "client-c", "Cato");
    sockets.push(clientC.ws);
    await fetchJson(audienceBase, "/v2/audience/admin/users/kick", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ targetKind: "client", clientKey: "127.0.0.1|client-c" }),
    });
    assert.equal(await waitForClose(clientC, "kick"), 4003);

    const blockClose = waitForClose(clientB, "block");
    await fetchJson(audienceBase, "/v2/audience/admin/users/block", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ targetKind: "client", clientKey: "127.0.0.1|client-b" }),
    });
    assert.equal(await blockClose, 4004);
    await fetchJson(audienceBase, "/v2/audience/admin/users/unblock", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ targetKind: "client", clientKey: "127.0.0.1|client-b" }),
    });

    const pollStarted = await fetchJson(audienceBase, "/v2/audience/admin/polls/start", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ question: "Kies?", options: ["A", "B"], durationSeconds: 60 }),
    });
    assert.equal(pollStarted.poll.question, "Kies?");
    await waitForWsMessage(clientA, (msg) => msg.type === "poll_started" && msg.poll.question === "Kies?", "poll_started");
    clientA.ws.send(JSON.stringify({ type: "poll_vote", pollId: pollStarted.poll.id, optionIndex: 1, clientTag: "client-a" }));
    await waitForWsMessage(clientA, (msg) => msg.type === "poll_vote_ok" && msg.pollId === pollStarted.poll.id, "poll_vote_ok");
    adminState = await fetchJson(audienceBase, "/v2/audience/admin/state");
    assert.equal(adminState.activePoll.totalVotes, 1);
    await fetchJson(audienceBase, "/v2/audience/admin/polls/close", { method: "POST" });

    const simStarted = await fetchJson(audienceBase, "/v2/audience/admin/simulation/start", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ clients: 4, msgRate: 0.08, reactionRate: 1.2, crowdMode: "hyped" }),
    });
    assert.equal(simStarted.simulation.running, true);
    await new Promise((resolve) => setTimeout(resolve, 1800));
    await fetchJson(audienceBase, "/v2/audience/admin/simulation/stop", { method: "POST" });
    const signalsAfterSim = await fetchJson(audienceBase, `/v2/audience/signals?sessionId=${started.session.id}`);
    assert(signalsAfterSim.signals.some((signal) => signal.simulated === true || signal.isBot === true));

    const algorithmInput = await fetchJson(
      audienceBase,
      `/v2/audience/algorithm-input?showRunId=${encodeURIComponent(active.showRunId)}&situationRunId=${encodeURIComponent(activeSituation.situationRunId)}`
    );
    assert(algorithmInput.chatAppSignals.heartCount >= 1);
    assert(algorithmInput.chatAppSignals.rawMessages.includes("meer hiervan"));
    assert(algorithmInput.rawChat.some((message) => message.text === "meer hiervan"));
    assertAudienceDoesNotChooseOrder(algorithmInput);

    const stopped = await fetchJson(runtimeBase, `/v0/runtime/runs/${encodeURIComponent(active.showRunId)}/stop-situation`, {
      method: "POST",
    });
    assert.equal(stopped.activeSituation, null);
    assert.equal(stopped.finalizationStatus.status, "pending");
    const finalizedRuntime = await waitForRuntimeFinalScore(runtimeBase, active.showRunId, activeSituation.situationRunId);
    assert(finalizedRuntime.runLog.some((item) => item.type === "audience_aggregate_attached" && item.heartCount >= 2));
    assert.equal(finalizedRuntime.lastScoreFeed.scorePhase, "definitive");
    const finalRuntimeScore = finalizedRuntime.lastScoreFeed.scores.find((score) => score.situationId === activeSituation.situationId);
    assert(finalRuntimeScore && finalRuntimeScore.observedScore > 0, "final score should not reset live audience signals to zero");
    assert(finalRuntimeScore.reasons.includes("finalized_from_audience_aggregate"));
    const finalAlgorithmContext = await fetchJson(algorithmBase, `/v0/algorithm/scoring-contexts/${encodeURIComponent(active.showRunId)}`);
    const finalObservation = finalAlgorithmContext.observations.find((observation) => observation.situationRunId === activeSituation.situationRunId);
    assert(finalObservation);
    assert(finalObservation.chatAppSignals.rawMessages.includes("meer hiervan"));
    assert(finalObservation.chatAppSignals.heartCount >= 2);
    assert(finalObservation.finalizedFromAudienceAggregate);
    assert(finalObservation.observedScore > 0);
    assert.equal(finalAlgorithmContext.liveAudienceObservation, null);

    await stopService(services.find((service) => service.name === "runtime"));
    clientA.ws.send(JSON.stringify({ type: "reaction", reaction: "bored", clientTag: "client-a" }));
    await new Promise((resolve) => setTimeout(resolve, 500));
    const noRuntimeInput = await fetchJson(audienceBase, "/v2/audience/algorithm-input");
    assert.equal(noRuntimeInput.metadata.reason, "runtime_unavailable");

    for (const socket of sockets) {
      if (socket.readyState === WebSocket.OPEN) socket.close(1000, "done");
    }
    await stopServices(services);
    const afterHashes = await protectedHashes();
    assertHashesEqual(beforeHashes, afterHashes);
    await fs.rm(tempDbDir, { recursive: true, force: true });
    await fs.rm(tempAlgorithmDbDir, { recursive: true, force: true });
    await fs.rm(tempRuntimeDbDir, { recursive: true, force: true });

    process.stdout.write(JSON.stringify({
      ok: true,
      ports: PORTS,
      sessionId: started.session.id,
      joinTokenWorks: true,
      multipleClientsJoined: true,
      liveChatObserved: true,
      moderation: ["mute", "unmute", "block", "unblock", "kick"],
      pollVotes: adminState.activePoll ? adminState.activePoll.totalVotes : 1,
      simulationProducedBotSignals: true,
      linkedSituationRunId: activeSituation.situationRunId,
      recoveredMissingAlgorithmContext: adminState.runtime.liveScoreDispatch.recoveryCount,
      finalScorePreservedAudienceSignals: true,
      runtimeUnavailableHandled: true,
      protectedV1HashesUnchanged: true,
    }, null, 2));
    process.stdout.write("\n");
  } catch (err) {
    for (const socket of sockets) {
      try { socket.close(1000, "error"); } catch {}
    }
    await stopServices(services);
    const afterHashes = await protectedHashes();
    assertHashesEqual(beforeHashes, afterHashes);
    await fs.rm(tempDbDir, { recursive: true, force: true });
    await fs.rm(tempAlgorithmDbDir, { recursive: true, force: true });
    await fs.rm(tempRuntimeDbDir, { recursive: true, force: true });
    err.message = `${err.message}\nService logs:\n${services.map((service) => `${service.name}:\n${service.logs.join("")}`).join("\n")}`;
    throw err;
  }
}

main().catch((err) => {
  process.stderr.write(`${err.stack || err.message}\n`);
  process.exit(1);
});
