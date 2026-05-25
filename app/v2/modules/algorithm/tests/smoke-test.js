"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs/promises");
const net = require("node:net");
const path = require("node:path");
const { spawn } = require("node:child_process");

const TEST_DIR = __dirname;
const APP_ROOT = path.resolve(TEST_DIR, "../../../..");
const CATALOG_PORT = 3021;
const ALGORITHM_PORT = 3023;
const CATALOG_URL = `http://127.0.0.1:${CATALOG_PORT}`;
const ALGORITHM_URL = `http://127.0.0.1:${ALGORITHM_PORT}`;
const EXPRESS_FALLBACK = "/opt/homebrew/lib/node_modules/node-red/node_modules/express";
const SHOW_RUN_ID = "show-run-20260524-130000000Z";
const PROTECTED_V1_FILES = [
  path.join(APP_ROOT, "data", "live.sqlite"),
  path.join(APP_ROOT, "data", "live.sqlite-wal"),
  path.join(APP_ROOT, "data", "live.sqlite-shm"),
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

async function fetchJson(baseUrl, pathname, options) {
  const response = await fetch(`${baseUrl}${pathname}`, options);
  const body = await response.json();
  if (!response.ok) throw new Error(`${pathname} returned ${response.status}: ${JSON.stringify(body)}`);
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
  await assertPortFree(CATALOG_PORT);
  await assertPortFree(ALGORITHM_PORT);
  const beforeHashes = await protectedHashes();
  const services = [];
  try {
    services.push(spawnService("catalog", path.join(APP_ROOT, "v2/modules/catalog/server/server.js"), {
      CATALOG_PORT: String(CATALOG_PORT),
      V2_CATALOG_EXPRESS_MODULE: EXPRESS_FALLBACK,
    }));
    await waitForHealth(services[0].child, CATALOG_URL, "catalog", services[0].logs);

    services.push(spawnService("algorithm", path.join(APP_ROOT, "v2/modules/algorithm/server/server.js"), {
      ALGORITHM_PORT: String(ALGORITHM_PORT),
      V2_ALGORITHM_EXPRESS_MODULE: EXPRESS_FALLBACK,
    }));
    await waitForHealth(services[1].child, ALGORITHM_URL, "algorithm", services[1].logs);

    const catalog = await fetchJson(CATALOG_URL, "/v0/catalog/read-model");
    const created = await fetchJson(ALGORITHM_URL, "/v0/algorithm/runs", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ showRunId: SHOW_RUN_ID, catalog }),
    });
    assert.equal(created.scoreFeed.scores.length, catalog.situations.filter((item) => item.active && !item.archivedAt).length);
    const neutralScores = new Set(created.scoreFeed.scores.map((item) => item.predictedScore));
    assert.deepEqual(Array.from(neutralScores), [0], "initial equal scores should remain equal");

    const situation = catalog.situations.find((item) => item.active && !item.archivedAt && item.labelIds && item.labelIds.length > 0)
      || catalog.situations.find((item) => item.active && !item.archivedAt);
    assert(situation, "catalog should contain an active situation");
    const observed = await fetchJson(ALGORITHM_URL, "/v0/algorithm/events/situation-observed", {
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
    assert.equal(observed.scoreFeed.scores.length, created.scoreFeed.scores.length);
    assert(!Object.prototype.hasOwnProperty.call(observed.scoreFeed, "preparedNext"));
    assert(!Object.prototype.hasOwnProperty.call(observed.scoreFeed, "pathAvailable"));
    assert(!Object.prototype.hasOwnProperty.call(observed.scoreFeed, "eligiblePool"));

    const finalFeed = await fetchJson(ALGORITHM_URL, `/v0/algorithm/runs/${SHOW_RUN_ID}/scores`);
    assert.equal(finalFeed.updatedAfterSituationRunId, `${SHOW_RUN_ID}:situation-run:0001`);

    await stopServices(services);
    const afterHashes = await protectedHashes();
    assertHashesEqual(beforeHashes, afterHashes);

    process.stdout.write(JSON.stringify({
      ok: true,
      ports: { catalog: CATALOG_PORT, algorithm: ALGORITHM_PORT },
      showRunId: SHOW_RUN_ID,
      scoreCount: finalFeed.scores.length,
      observedSituationId: situation.id,
      observedScore: observed.observation.observedScore,
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
