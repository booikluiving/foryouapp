"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs/promises");
const net = require("node:net");
const path = require("node:path");
const { spawn } = require("node:child_process");

const TEST_DIR = __dirname;
const APP_ROOT = path.resolve(TEST_DIR, "../../..");
const PORTS = {};
const SHOW_RUN_ID = "show-run-20260524-130000000Z";
const ALGORITHM_TEST_DB_DIR = path.join(APP_ROOT, "modules/algorithm/db/.tmp/smoke");
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

async function findFreePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.once("listening", () => {
      const port = server.address().port;
      server.close(() => resolve(port));
    });
    server.listen(0, "127.0.0.1");
  });
}

async function allocatePorts() {
  return {
    catalog: await findFreePort(),
    algorithm: await findFreePort(),
  };
}

async function fetchJson(baseUrl, pathname, options) {
  const response = await fetch(`${baseUrl}${pathname}`, options);
  const body = await response.json();
  if (!response.ok) throw new Error(`${pathname} returned ${response.status}: ${JSON.stringify(body)}`);
  return body;
}

async function fetchText(baseUrl, pathname, options) {
  const response = await fetch(`${baseUrl}${pathname}`, options);
  const body = await response.text();
  if (!response.ok) throw new Error(`${pathname} returned ${response.status}: ${body.slice(0, 300)}`);
  return body;
}

async function waitForHealth(child, baseUrl, serviceName, logs) {
  const deadline = Date.now() + 8000;
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
  for (const service of services.reverse()) await stopService(service);
}

async function main() {
  Object.assign(PORTS, await allocatePorts());
  await assertPortFree(PORTS.catalog);
  await assertPortFree(PORTS.algorithm);
  await fs.rm(ALGORITHM_TEST_DB_DIR, { recursive: true, force: true });
  const beforeHashes = await protectedHashes();
  const services = [];
  try {
    const catalogUrl = `http://127.0.0.1:${PORTS.catalog}`;
    const algorithmUrl = `http://127.0.0.1:${PORTS.algorithm}`;
    services.push(spawnService("catalog", path.join(APP_ROOT, "modules/catalog/server/server.js"), {
      CATALOG_PORT: String(PORTS.catalog),
      V2_CATALOG_LEGACY_SQLITE_PATH: "/missing.sqlite",
    }));
    await waitForHealth(services[0].child, catalogUrl, "catalog", services[0].logs);

    services.push(spawnService("algorithm", path.join(APP_ROOT, "modules/algorithm/server/server.js"), {
      ALGORITHM_PORT: String(PORTS.algorithm),
      V2_ALGORITHM_DB_DIR: ALGORITHM_TEST_DB_DIR,
    }));
    await waitForHealth(services[1].child, algorithmUrl, "algorithm", services[1].logs);

    const config = await fetchJson(algorithmUrl, "/v0/algorithm/config");
    assert.equal(config.schemaVersion, "algorithm.config.v0");
    const savedConfig = await fetchJson(algorithmUrl, "/v0/algorithm/config", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        weights: { heart: 1.5, bored: -2, message: 0.5, exploration: 0.25 },
        normalization: { timeCorrection: 1, audienceSize: 1 },
      }),
    });
    assert.equal(savedConfig.weights.heart, 1.5);

    const catalog = await fetchJson(catalogUrl, "/v0/catalog/read-model");
    const created = await fetchJson(algorithmUrl, "/v0/algorithm/scoring-contexts", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ showRunId: SHOW_RUN_ID, catalog }),
    });
    assert.equal(created.scoreFeed.scores.length, catalog.situations.filter((item) => item.active && !item.archivedAt).length);
    assert.equal(created.contextType, "scoring-context");
    assert(created.scoreFeed.scores.every((item) => Number.isFinite(Number(item.predictedScore))));

    const situation = catalog.situations.find((item) => item.active && !item.archivedAt && item.labelIds && item.labelIds.length > 0)
      || catalog.situations.find((item) => item.active && !item.archivedAt);
    assert(situation, "catalog should contain an active situation");
    const live = await fetchJson(algorithmUrl, "/v0/algorithm/events/audience-signals", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        showRunId: SHOW_RUN_ID,
        situationRunId: `${SHOW_RUN_ID}:situation-run:0001`,
        situationId: situation.id,
        startedAt: "2026-05-24T13:00:00.000Z",
        createdAt: "2026-05-24T13:01:00.000Z",
        audience: { activeClients: 3 },
        chatAppSignals: {
          heartCount: 8,
          boredCount: 0,
          rawMessages: ["live ja"],
        },
        rawChat: [{ text: "live ja" }],
      }),
    });
    assert.equal(live.scorePhase, "live");
    assert.equal(live.scoreFeed.scorePhase, "live");
    assert.equal(live.scoreFeed.scores.length, created.scoreFeed.scores.length);
    assert(live.scoreFeed.scores.some((score) => score.reasons.includes("live_audience_signals")));
    assert(!Object.prototype.hasOwnProperty.call(live.scoreFeed, "preparedNext"));
    assert(!Object.prototype.hasOwnProperty.call(live.scoreFeed, "eligiblePool"));

    const observed = await fetchJson(algorithmUrl, "/v0/algorithm/events/situation-observed", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        type: "situationObserved",
        showRunId: SHOW_RUN_ID,
        situationRunId: `${SHOW_RUN_ID}:situation-run:0001`,
        situationId: situation.id,
        startedAt: "2026-05-24T13:00:00.000Z",
        endedAt: "2026-05-24T13:03:00.000Z",
        durationSeconds: 180,
        audience: { activeClients: 42 },
        chatAppSignals: {
          heartCount: 25,
          boredCount: 3,
          rawMessages: ["ja", "goed"],
        },
      }),
    });
    assert(observed.observation.observedScore > 0);
    assert.equal(observed.scoreFeed.scorePhase, "definitive");
    assert.equal(observed.scoreFeed.scores.length, created.scoreFeed.scores.length);
    assert(!Object.prototype.hasOwnProperty.call(observed.scoreFeed, "preparedNext"));
    assert(!Object.prototype.hasOwnProperty.call(observed.scoreFeed, "currentOrder"));
    assert(!Object.prototype.hasOwnProperty.call(observed.scoreFeed, "pathAvailable"));
    assert(!Object.prototype.hasOwnProperty.call(observed.scoreFeed, "eligiblePool"));
    assert(observed.scoreFeed.scores.some((score) => Array.isArray(score.reasons) && score.reasons.length));
    assert(observed.scoreFeed.scores.some((score) => Number.isFinite(Number(score.confidence))));

    const finalFeed = await fetchJson(algorithmUrl, `/v0/algorithm/scoring-contexts/${SHOW_RUN_ID}/scores`);
    assert.equal(finalFeed.updatedAfterSituationRunId, `${SHOW_RUN_ID}:situation-run:0001`);
    assert(finalFeed.debugSummary);
    assert(Array.isArray(finalFeed.debugSummary.topSituations));

    const legacyState = await fetchJson(algorithmUrl, `/v0/algorithm/runs/${SHOW_RUN_ID}`);
    assert.equal(legacyState.deprecated, true);
    const legacyFeed = await fetchJson(algorithmUrl, `/v0/algorithm/runs/${SHOW_RUN_ID}/scores`);
    assert.equal(legacyFeed.updatedAfterSituationRunId, finalFeed.updatedAfterSituationRunId);

    const contexts = await fetchJson(algorithmUrl, "/v0/algorithm/scoring-contexts");
    assert(contexts.contexts.some((context) => context.showRunId === SHOW_RUN_ID));

    const simulation = await fetchJson(algorithmUrl, "/v0/algorithm/simulate", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        showRunId: SHOW_RUN_ID,
        situationId: situation.id,
        durationSeconds: 90,
        audience: { activeClients: 12 },
        chatAppSignals: {
          heartCount: 10,
          boredCount: 0,
          rawMessages: ["sim smoke"],
        },
      }),
    });
    assert.equal(simulation.persisted, false);
    assert(simulation.observation.observedScore > 0);

    const uiHtml = await fetchText(algorithmUrl, "/algorithm/");
    assert(uiHtml.includes("configGrid"), "UI should include config panel");
    assert(uiHtml.includes("simulationSituation"), "UI should include simulation panel");
    assert(uiHtml.includes("scoresTable"), "UI should include scorefeed panel");
    assert(uiHtml.includes("topCharacters"), "UI should include debug top lists");
    const uiJs = await fetchText(algorithmUrl, "/algorithm/app.js");
    assert(uiJs.includes("Heart weight"));
    assert(uiJs.includes("/v0/algorithm/config"));
    assert(uiJs.includes("/v0/algorithm/simulate"));

    await stopServices(services);
    const afterHashes = await protectedHashes();
    assertHashesEqual(beforeHashes, afterHashes);

    process.stdout.write(JSON.stringify({
      ok: true,
      ports: PORTS,
      showRunId: SHOW_RUN_ID,
      scoreCount: finalFeed.scores.length,
      observedSituationId: situation.id,
      observedScore: observed.observation.observedScore,
      uiSmoke: true,
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
