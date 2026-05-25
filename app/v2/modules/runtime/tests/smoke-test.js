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
  runtime: 3024,
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

async function main() {
  for (const port of Object.values(PORTS)) await assertPortFree(port);
  const beforeHashes = await protectedHashes();
  const services = [];
  try {
    const catalogScript = path.join(APP_ROOT, "v2", "modules", "catalog", "server", "server.js");
    const pathsScript = path.join(APP_ROOT, "v2", "modules", "paths", "server", "server.js");
    const runtimeScript = path.join(APP_ROOT, "v2", "modules", "runtime", "server", "server.js");
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

    services.push(spawnService("runtime", runtimeScript, {
      RUNTIME_PORT: String(PORTS.runtime),
      V2_RUNTIME_EXPRESS_MODULE: EXPRESS_FALLBACK,
      V2_RUNTIME_CATALOG_URL: `http://127.0.0.1:${PORTS.catalog}`,
      V2_RUNTIME_PATHS_URL: `http://127.0.0.1:${PORTS.paths}`,
    }));
    await waitForHealth(services[2].child, `http://127.0.0.1:${PORTS.runtime}`, "runtime", services[2].logs);

    const runtimeBase = `http://127.0.0.1:${PORTS.runtime}`;
    const started = await fetchJson(runtimeBase, "/v0/runtime/runs/start", { method: "POST" });
    assert(started.showRunId);
    assert(started.showRunSnapshot.catalog);
    assert(started.showRunSnapshot.paths);
    assert.equal(started.showRunSnapshot.algorithmConfig.schemaVersion, "algorithm.config.placeholder.v0");
    assert(started.preparedNext && started.preparedNext.situationId);
    assert(started.resolvedPreparedNext && started.resolvedPreparedNext.situationId);
    assert(started.eligiblePool.length > 0);

    const preparedBeforeScores = started.preparedNext.situationId;
    const scoreResult = await fetchJson(runtimeBase, `/v0/runtime/runs/${started.showRunId}/scores`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ source: "smoke", scores: [{ situationId: "situation:999", score: 999 }] }),
    });
    assert.equal(scoreResult.preparedNextUnchanged, true);
    assert.equal(scoreResult.preparedNextSituationId, preparedBeforeScores);

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

    await stopServices(services);
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
