"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs/promises");
const net = require("node:net");
const path = require("node:path");
const { spawn } = require("node:child_process");

const TEST_DIR = __dirname;
const APP_ROOT = path.resolve(TEST_DIR, "../../../..");
const PORTS = {
  catalog: 3021,
  paths: 3022,
  algorithm: 3023,
  runtime: 3024,
  audience: 3026,
};
const PROTECTED_V1_FILES = [
  path.join(APP_ROOT, "data", "live.sqlite"),
  path.join(APP_ROOT, "data", "live.sqlite-wal"),
  path.join(APP_ROOT, "data", "live.sqlite-shm"),
];
const EXPRESS_FALLBACK = "/opt/homebrew/lib/node_modules/node-red/node_modules/express";

async function sha256(filePath) {
  const data = await fs.readFile(filePath);
  return crypto.createHash("sha256").update(data).digest("hex");
}

async function protectedHashes() {
  const entries = [];
  for (const filePath of PROTECTED_V1_FILES) {
    entries.push([filePath, await sha256(filePath)]);
  }
  return Object.fromEntries(entries);
}

function assertHashesEqual(before, after) {
  for (const filePath of PROTECTED_V1_FILES) {
    assert.equal(after[filePath], before[filePath], `${path.basename(filePath)} changed`);
  }
}

async function assertPortFree(port) {
  await new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.once("listening", () => server.close(resolve));
    server.listen(port, "127.0.0.1");
  });
}

async function fetchJson(baseUrl, pathname, options) {
  const response = await fetch(`${baseUrl}${pathname}`, options);
  const body = await response.json();
  if (!response.ok) throw new Error(`${pathname} returned ${response.status}: ${JSON.stringify(body)}`);
  return body;
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
    service.child.once("exit", resolve);
    service.child.kill("SIGTERM");
    setTimeout(() => {
      if (service.child.exitCode == null) service.child.kill("SIGKILL");
    }, 2000).unref();
  });
}

async function stopServices(services) {
  for (const service of services.reverse()) {
    await stopService(service);
  }
}

function assertAudienceDoesNotChooseOrder(value) {
  const text = JSON.stringify(value);
  for (const key of ["preparedNext", "resolvedPreparedNext", "eligiblePool", "pathAvailable", "order", "scoreFeed"]) {
    assert(!text.includes(`"${key}"`), `${key} should not be emitted by Audience`);
  }
}

async function main() {
  for (const port of Object.values(PORTS)) await assertPortFree(port);
  const beforeHashes = await protectedHashes();
  const services = [];
  try {
    const catalogScript = path.join(APP_ROOT, "v2", "modules", "catalog", "server", "server.js");
    const pathsScript = path.join(APP_ROOT, "v2", "modules", "paths", "server", "server.js");
    const algorithmScript = path.join(APP_ROOT, "v2", "modules", "algorithm", "server", "server.js");
    const runtimeScript = path.join(APP_ROOT, "v2", "modules", "runtime", "server", "server.js");
    const audienceScript = path.join(APP_ROOT, "v2", "modules", "audience", "server", "server.js");

    services.push(spawnService("catalog", catalogScript, {
      CATALOG_PORT: String(PORTS.catalog),
      V2_CATALOG_EXPRESS_MODULE: EXPRESS_FALLBACK,
    }));
    await waitForHealth(services[0].child, `http://127.0.0.1:${PORTS.catalog}`, "catalog", services[0].logs);

    services.push(spawnService("paths", pathsScript, {
      PATHS_PORT: String(PORTS.paths),
      V2_PATHS_EXPRESS_MODULE: EXPRESS_FALLBACK,
    }));
    await waitForHealth(services[1].child, `http://127.0.0.1:${PORTS.paths}`, "paths", services[1].logs);

    services.push(spawnService("algorithm", algorithmScript, {
      ALGORITHM_PORT: String(PORTS.algorithm),
      V2_ALGORITHM_EXPRESS_MODULE: EXPRESS_FALLBACK,
    }));
    await waitForHealth(services[2].child, `http://127.0.0.1:${PORTS.algorithm}`, "algorithm", services[2].logs);

    services.push(spawnService("runtime", runtimeScript, {
      RUNTIME_PORT: String(PORTS.runtime),
      V2_RUNTIME_EXPRESS_MODULE: EXPRESS_FALLBACK,
      V2_RUNTIME_CATALOG_URL: `http://127.0.0.1:${PORTS.catalog}`,
      V2_RUNTIME_PATHS_URL: `http://127.0.0.1:${PORTS.paths}`,
    }));
    await waitForHealth(services[3].child, `http://127.0.0.1:${PORTS.runtime}`, "runtime", services[3].logs);

    services.push(spawnService("audience", audienceScript, {
      AUDIENCE_PORT: String(PORTS.audience),
      V2_AUDIENCE_EXPRESS_MODULE: EXPRESS_FALLBACK,
      V2_AUDIENCE_RUNTIME_URL: `http://127.0.0.1:${PORTS.runtime}`,
    }));
    await waitForHealth(services[4].child, `http://127.0.0.1:${PORTS.audience}`, "audience", services[4].logs);

    const catalogBase = `http://127.0.0.1:${PORTS.catalog}`;
    const algorithmBase = `http://127.0.0.1:${PORTS.algorithm}`;
    const runtimeBase = `http://127.0.0.1:${PORTS.runtime}`;
    const audienceBase = `http://127.0.0.1:${PORTS.audience}`;

    const runtimeStarted = await fetchJson(runtimeBase, "/v0/runtime/runs/start", { method: "POST" });
    const active = await fetchJson(runtimeBase, `/v0/runtime/runs/${runtimeStarted.showRunId}/start-situation`, {
      method: "POST",
    });
    const activeSituation = active.activeSituation;
    assert(activeSituation && activeSituation.situationRunId);

    const catalog = await fetchJson(catalogBase, "/v0/catalog/read-model");
    const algorithmRun = await fetchJson(algorithmBase, "/v0/algorithm/runs", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ showRunId: active.showRunId, catalog }),
    });
    assert.equal(algorithmRun.showRunId, active.showRunId);

    const session = await fetchJson(audienceBase, "/v0/audience/sessions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    });
    assert(session.session.sessionId);

    const heart = await fetchJson(audienceBase, "/v0/audience/signals", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ type: "heart", sessionId: session.session.sessionId }),
    });
    assert.equal(heart.signal.link.status, "linked");
    assert.equal(heart.signal.link.showRunId, active.showRunId);
    assert.equal(heart.signal.link.situationRunId, activeSituation.situationRunId);
    assert.equal(heart.signal.link.situationId, activeSituation.situationId);

    const chat = await fetchJson(audienceBase, "/v0/audience/signals", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ type: "chat", sessionId: session.session.sessionId, text: "meer hiervan" }),
    });
    assert.equal(chat.signal.text, "meer hiervan");

    const algorithmInput = await fetchJson(
      audienceBase,
      `/v0/audience/algorithm-input?showRunId=${encodeURIComponent(active.showRunId)}&situationRunId=${encodeURIComponent(activeSituation.situationRunId)}`
    );
    assert.equal(algorithmInput.chatAppSignals.heartCount, 1);
    assert.deepEqual(algorithmInput.chatAppSignals.rawMessages, ["meer hiervan"]);
    assertAudienceDoesNotChooseOrder(algorithmInput);

    const observed = await fetchJson(algorithmBase, "/v0/algorithm/events/situation-observed", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        type: "situationObserved",
        showRunId: active.showRunId,
        situationRunId: activeSituation.situationRunId,
        situationId: activeSituation.situationId,
        startedAt: activeSituation.startedAt,
        endedAt: new Date().toISOString(),
        durationSeconds: 60,
        audience: algorithmInput.audience,
        chatAppSignals: algorithmInput.chatAppSignals,
      }),
    });
    assert.equal(observed.observation.chatAppSignals.rawMessages[0], "meer hiervan");

    await fetchJson(runtimeBase, `/v0/runtime/runs/${runtimeStarted.showRunId}/stop-situation`, { method: "POST" });
    const outsideActive = await fetchJson(audienceBase, "/v0/audience/signals", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ type: "bored", sessionId: session.session.sessionId }),
    });
    assert.equal(outsideActive.signal.link.status, "unlinked");
    assert.equal(outsideActive.signal.link.reason, "no_active_situation");

    await stopServices(services);
    const afterHashes = await protectedHashes();
    assertHashesEqual(beforeHashes, afterHashes);

    process.stdout.write(JSON.stringify({
      ok: true,
      ports: PORTS,
      showRunId: active.showRunId,
      situationRunId: activeSituation.situationRunId,
      linkedHeartSituationRunId: heart.signal.link.situationRunId,
      rawChatForwardedToAlgorithm: observed.observation.chatAppSignals.rawMessages,
      outsideActiveSignalStatus: outsideActive.signal.link.status,
      audienceDoesNotChooseOrder: true,
      protectedV1HashesUnchanged: true,
    }, null, 2));
    process.stdout.write("\n");
  } catch (err) {
    await stopServices(services);
    const afterHashes = await protectedHashes();
    assertHashesEqual(beforeHashes, afterHashes);
    err.message = `${err.message}\nService logs:\n${services.map((service) => `${service.name}:\n${service.logs.join("")}`).join("\n")}`;
    throw err;
  }
}

main().catch((err) => {
  process.stderr.write(`${err.stack || err.message}\n`);
  process.exit(1);
});
