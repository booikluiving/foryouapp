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
  showControl: 3025,
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

function runtimeOrderSnapshot(runtimeState) {
  return {
    preparedNext: runtimeState.preparedNext,
    resolvedPreparedNext: runtimeState.resolvedPreparedNext,
    eligiblePool: runtimeState.eligiblePool,
    activeSituation: runtimeState.activeSituation,
    playedSituations: runtimeState.playedSituations,
    runLogLength: Array.isArray(runtimeState.runLog) ? runtimeState.runLog.length : null,
  };
}

function assertNoShowControlChoice(value) {
  const text = JSON.stringify(value);
  for (const key of ["eligiblePool", "pathAvailable", "pathLocked", "scoreFeed", "chosenByShowControl"]) {
    assert(!text.includes(`"${key}"`), `${key} should not be emitted by Show Control`);
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
    const showControlScript = path.join(APP_ROOT, "v2", "modules", "show-control", "server", "server.js");

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

    services.push(spawnService("show-control", showControlScript, {
      SHOW_CONTROL_PORT: String(PORTS.showControl),
      V2_SHOW_CONTROL_EXPRESS_MODULE: EXPRESS_FALLBACK,
      V2_SHOW_CONTROL_RUNTIME_URL: `http://127.0.0.1:${PORTS.runtime}`,
    }));
    await waitForHealth(services[3].child, `http://127.0.0.1:${PORTS.showControl}`, "show-control", services[3].logs);

    const runtimeBase = `http://127.0.0.1:${PORTS.runtime}`;
    const showControlBase = `http://127.0.0.1:${PORTS.showControl}`;
    const started = await fetchJson(runtimeBase, "/v0/runtime/runs/start", { method: "POST" });
    assert(started.resolvedPreparedNext && started.resolvedPreparedNext.situationId);
    const runtimeBeforePrepare = await fetchJson(runtimeBase, "/v0/runtime/runs/current");
    const orderBeforePrepare = runtimeOrderSnapshot(runtimeBeforePrepare);

    const prepare = await fetchJson(showControlBase, "/v0/show-control/cues/prepare", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    });
    assert.equal(prepare.cue.status.state, "ok");
    assert(prepare.cue.actions[0].payloadId);
    assert.equal(prepare.cue.actions[0].transport.type, "osc-control-intent");
    assertNoShowControlChoice(prepare.cue);

    const payload = await fetchJson(
      showControlBase,
      `/v0/show-control/cues/${encodeURIComponent(prepare.cue.cueId)}/payload/${encodeURIComponent(prepare.cue.actions[0].payloadId)}`
    );
    assert.equal(payload.payload.situation.situationId, started.resolvedPreparedNext.situationId);

    const runtimeAfterPrepare = await fetchJson(runtimeBase, "/v0/runtime/runs/current");
    assert.deepEqual(runtimeOrderSnapshot(runtimeAfterPrepare), orderBeforePrepare);

    const active = await fetchJson(runtimeBase, `/v0/runtime/runs/${started.showRunId}/start-situation`, {
      method: "POST",
    });
    assert(active.activeSituation && active.activeSituation.situationRunId);
    const orderBeforeGo = runtimeOrderSnapshot(active);

    const goStartedAt = Date.now();
    const go = await fetchJson(showControlBase, "/v0/show-control/cues/go", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    });
    assert(Date.now() - goStartedAt < 100, "GO request should be non-blocking");
    assert.equal(go.cue.status.nonBlocking, true);
    assert.equal(go.cue.status.stage, "sent");
    assertNoShowControlChoice(go.cue);

    const runtimeAfterGo = await fetchJson(runtimeBase, "/v0/runtime/runs/current");
    assert.deepEqual(runtimeOrderSnapshot(runtimeAfterGo), orderBeforeGo);

    const compound = await fetchJson(showControlBase, "/v0/show-control/cues", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: "Ordered smoke cue",
        actions: [
          { targetId: "touchdesigner", command: "td.phase.set", ackMode: "acknowledged", delayMs: 1 },
          { targetId: "sq5", command: "sq5.scene.set", ackMode: "acknowledged", delayMs: 1 },
          { targetId: "dmx", command: "dmx.look.set", ackMode: "fire-and-forget", delayMs: 1 },
        ],
      }),
    });
    assert.deepEqual(compound.cue.status.sentOrder, compound.cue.actions.map((action) => action.actionId));

    const warning = await fetchJson(showControlBase, "/v0/show-control/cues/prepare", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ simulateTargetTimeout: true }),
    });
    assert.equal(warning.cue.status.state, "warning");
    assert.equal(warning.cue.status.warnings[0].stage, "timedOut");

    await stopServices(services);
    const afterHashes = await protectedHashes();
    assertHashesEqual(beforeHashes, afterHashes);

    process.stdout.write(JSON.stringify({
      ok: true,
      ports: PORTS,
      showRunId: started.showRunId,
      prepareCueId: prepare.cue.cueId,
      goCueId: go.cue.cueId,
      compoundOrder: compound.cue.status.sentOrder.length,
      warningStage: warning.cue.status.warnings[0].stage,
      runtimeOrderStateUnchanged: true,
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
