"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs/promises");
const net = require("node:net");
const path = require("node:path");
const { spawn } = require("node:child_process");

const TEST_DIR = __dirname;
const APP_ROOT = path.resolve(TEST_DIR, "../../..");
const TEST_RUNTIME_DB_DIR = path.join(TEST_DIR, ".tmp-smoke-db");
const PORTS = {};
const PROTECTED_V1_FILES = [
  path.join(APP_ROOT, "legacy", "public", "algoritme.html"),
  path.join(APP_ROOT, "legacy", "server.js"),
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
  const out = {};
  for (const name of ["catalog", "paths", "runtime"]) {
    out[name] = await findFreePort();
  }
  return out;
}

async function fetchJson(baseUrl, pathname, options) {
  const response = await fetch(`${baseUrl}${pathname}`, options);
  const body = await response.json();
  if (!response.ok) throw new Error(`${pathname} returned ${response.status}: ${JSON.stringify(body)}`);
  return body;
}

async function fetchText(baseUrl, pathname) {
  const response = await fetch(`${baseUrl}${pathname}`);
  const body = await response.text();
  if (!response.ok) throw new Error(`${pathname} returned ${response.status}: ${body}`);
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

async function resetRuntimeTestDb() {
  await fs.rm(TEST_RUNTIME_DB_DIR, { recursive: true, force: true });
}

async function main() {
  Object.assign(PORTS, await allocatePorts());
  for (const port of Object.values(PORTS)) await assertPortFree(port);
  await resetRuntimeTestDb();
  const beforeHashes = await protectedHashes();
  const services = [];
  try {
    const catalogScript = path.join(APP_ROOT, "modules", "catalog", "server", "server.js");
    const pathsScript = path.join(APP_ROOT, "modules", "paths", "server", "server.js");
    const runtimeScript = path.join(APP_ROOT, "modules", "runtime", "server", "server.js");
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

    services.push(spawnService("runtime", runtimeScript, {
      RUNTIME_PORT: String(PORTS.runtime),
      V2_RUNTIME_DB_DIR: TEST_RUNTIME_DB_DIR,
      V2_RUNTIME_CATALOG_URL: `http://127.0.0.1:${PORTS.catalog}`,
      V2_RUNTIME_PATHS_URL: `http://127.0.0.1:${PORTS.paths}`,
      V2_RUNTIME_ALGORITHM_URL: "http://127.0.0.1:3999",
      V2_RUNTIME_AUDIENCE_URL: "http://127.0.0.1:3998",
    }));
    await waitForHealth(services[2].child, `http://127.0.0.1:${PORTS.runtime}`, "runtime", services[2].logs);

    const runtimeBase = `http://127.0.0.1:${PORTS.runtime}`;
    const ui = await fetchText(runtimeBase, "/runtime/");
    assert(ui.includes("Huidige Volgorde"), "Runtime UI should be served at /runtime/");

    const idle = await fetchJson(runtimeBase, "/v0/runtime/runs/current");
    assert.equal(idle.status, "idle", "current endpoint should be idle before start");
    assert(idle.catalogPreview && idle.catalogPreview.situations.length > 0, "idle current should include UI catalog preview");
    assert(idle.pathEvaluation && Array.isArray(idle.pathEvaluation.items), "idle current should include path preview");

    const started = await fetchJson(runtimeBase, "/v0/runtime/runs/start", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ orderSettings: { randomizeEqualScores: true } }),
    });
    assert(started.showRunId);
    assert(started.showRunSnapshot.catalog);
    assert(started.showRunSnapshot.paths);
    assert(started.showRunSnapshot.algorithmConfig);
    const snapshotText = JSON.stringify(started.showRunSnapshot);
    assert(!snapshotText.includes("legacy-sqlite-wal-copy"), "runtime snapshot must not include legacy sqlite source type");
    assert(!snapshotText.includes("originalPath"), "runtime snapshot must not include legacy originalPath metadata");
    assert(!snapshotText.includes("rawPath"), "runtime snapshot must not include legacy rawPath metadata");
    assert(!snapshotText.includes("legacy/data/live.sqlite"), "runtime snapshot must not include V1 sqlite paths");
    assert(started.preparedNext && started.preparedNext.situationId);
    assert(started.resolvedPreparedNext && started.resolvedPreparedNext.situationId);
    assert(started.eligiblePool.length > 0);
    assert.equal(started.orderSettings.randomizeEqualScores, true);

    const current = await fetchJson(runtimeBase, "/v0/runtime/runs/current");
    assert.equal(current.showRunId, started.showRunId);

    const preparedBeforeScores = started.preparedNext.situationId;
    const boostedCandidate = started.eligiblePool.find((item) => item.situationId !== preparedBeforeScores)
      || started.eligiblePool[0];
    const scoreResult = await fetchJson(runtimeBase, `/v0/runtime/runs/${started.showRunId}/scores`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ source: "smoke", scores: [{ situationId: boostedCandidate.situationId, score: 999 }] }),
    });
    assert.equal(scoreResult.preparedNextUnchanged, true);
    assert.equal(scoreResult.eligiblePoolResorted, true);
    assert.equal(scoreResult.preparedNextSituationId, preparedBeforeScores);
    assert.equal(scoreResult.state.eligiblePool[0].situationId, boostedCandidate.situationId);

    const active = await fetchJson(runtimeBase, `/v0/runtime/runs/${started.showRunId}/start-situation`, { method: "POST" });
    assert(active.activeSituation && active.activeSituation.situationId === preparedBeforeScores);
    assert.equal(active.playedSituations.length, 0, "active situation should not be played yet");
    assert(active.preparedNext && active.resolvedPreparedNext, "runtime should prepare a new next situation");
    const preparedBeforeStop = active.preparedNext.situationId;

    const stopped = await fetchJson(runtimeBase, `/v0/runtime/runs/${started.showRunId}/stop-situation`, { method: "POST" });
    assert.equal(stopped.activeSituation, null);
    assert.equal(stopped.playedSituations.length, 1);
    assert.equal(stopped.playedSituations[0].situationId, preparedBeforeScores);
    assert(stopped.preparedNext && stopped.preparedNext.situationId === preparedBeforeStop);
    assert(!stopped.eligiblePool.some((item) => item.situationId === preparedBeforeScores));

    const reset = await fetchJson(runtimeBase, `/v0/runtime/runs/${started.showRunId}/reset`, { method: "POST" });
    assert.equal(reset.status, "idle");
    assert(reset.catalogPreview && reset.catalogPreview.situations.length > 0, "reset response should keep UI list visible");
    const idleAfterReset = await fetchJson(runtimeBase, "/v0/runtime/runs/current");
    assert.equal(idleAfterReset.status, "idle");
    assert.equal(idleAfterReset.showRunId, null);
    assert(idleAfterReset.catalogPreview && idleAfterReset.catalogPreview.situations.length > 0);

    await stopServices(services);
    await resetRuntimeTestDb();
    const afterHashes = await protectedHashes();
    assertHashesEqual(beforeHashes, afterHashes);

    process.stdout.write(JSON.stringify({
      ok: true,
      ports: PORTS,
      showRunId: stopped.showRunId,
      preparedAtStart: preparedBeforeScores,
      activeSituationPlayedAfterStop: stopped.playedSituations[0].situationId,
      preparedNextFrozenThroughStop: stopped.preparedNext.situationId,
      catalogSnapshotSituations: stopped.showRunSnapshot.catalog.counts.situations,
      pathsSnapshotPaths: stopped.showRunSnapshot.paths.counts.paths,
      runtimeUiServed: true,
      resetReturnedIdle: true,
      resetKeptCatalogPreview: true,
      protectedV1HashesUnchanged: true,
    }, null, 2));
    process.stdout.write("\n");
  } catch (err) {
    await stopServices(services);
    await resetRuntimeTestDb();
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
