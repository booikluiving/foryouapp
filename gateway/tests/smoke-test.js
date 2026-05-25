"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs/promises");
const net = require("node:net");
const path = require("node:path");
const { spawn } = require("node:child_process");

const TEST_DIR = __dirname;
const APP_ROOT = path.resolve(TEST_DIR, "../..");
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
  for (const name of ["gateway", "catalog", "paths", "algorithm", "runtime", "showControl", "audience", "scriptAgent"]) {
    out[name] = await findFreePort();
  }
  return out;
}

async function fetchText(baseUrl, pathname) {
  const response = await fetch(`${baseUrl}${pathname}`, { signal: AbortSignal.timeout(5000) });
  const text = await response.text();
  if (!response.ok) throw new Error(`${pathname} returned ${response.status}: ${text}`);
  return text;
}

async function fetchJson(baseUrl, pathname, options) {
  const response = await fetch(`${baseUrl}${pathname}`, {
    ...(options || {}),
    signal: AbortSignal.timeout(5000),
  });
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
  const waitForExit = () => new Promise((resolve) => service.child.once("exit", resolve));
  const timeout = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  service.child.kill("SIGTERM");
  await Promise.race([waitForExit(), timeout(1500)]);
  if (service.child.exitCode == null) {
    service.child.kill("SIGKILL");
    await Promise.race([waitForExit(), timeout(1500)]);
  }
}

async function stopServices(services) {
  for (const service of services.reverse()) {
    await stopService(service);
  }
}

async function main() {
  Object.assign(PORTS, await allocatePorts());
  for (const port of Object.values(PORTS)) await assertPortFree(port);
  const beforeHashes = await protectedHashes();
  const services = [];
  try {
    const scripts = {
      catalog: path.join(APP_ROOT, "modules", "catalog", "server", "server.js"),
      paths: path.join(APP_ROOT, "modules", "paths", "server", "server.js"),
      algorithm: path.join(APP_ROOT, "modules", "algorithm", "server", "server.js"),
      runtime: path.join(APP_ROOT, "modules", "runtime", "server", "server.js"),
      showControl: path.join(APP_ROOT, "modules", "show-control", "server", "server.js"),
      audience: path.join(APP_ROOT, "modules", "audience", "server", "server.js"),
      scriptAgent: path.join(APP_ROOT, "modules", "script-agent", "server", "server.js"),
      gateway: path.join(APP_ROOT, "gateway", "server", "server.js"),
    };

    services.push(spawnService("catalog", scripts.catalog, {
      CATALOG_PORT: String(PORTS.catalog),
      V2_CATALOG_LEGACY_SQLITE_PATH: "/missing.sqlite",
    }));
    await waitForHealth(services.at(-1).child, `http://127.0.0.1:${PORTS.catalog}`, "catalog", services.at(-1).logs);

    services.push(spawnService("paths", scripts.paths, {
      PATHS_PORT: String(PORTS.paths),
      V2_PATHS_CATALOG_URL: `http://127.0.0.1:${PORTS.catalog}`,
      V2_PATHS_LEGACY_SQLITE_PATH: "/missing.sqlite",
    }));
    await waitForHealth(services.at(-1).child, `http://127.0.0.1:${PORTS.paths}`, "paths", services.at(-1).logs);

    services.push(spawnService("algorithm", scripts.algorithm, {
      ALGORITHM_PORT: String(PORTS.algorithm),
    }));
    await waitForHealth(services.at(-1).child, `http://127.0.0.1:${PORTS.algorithm}`, "algorithm", services.at(-1).logs);

    services.push(spawnService("runtime", scripts.runtime, {
      RUNTIME_PORT: String(PORTS.runtime),
      V2_RUNTIME_CATALOG_URL: `http://127.0.0.1:${PORTS.catalog}`,
      V2_RUNTIME_PATHS_URL: `http://127.0.0.1:${PORTS.paths}`,
    }));
    await waitForHealth(services.at(-1).child, `http://127.0.0.1:${PORTS.runtime}`, "runtime", services.at(-1).logs);

    services.push(spawnService("show-control", scripts.showControl, {
      SHOW_CONTROL_PORT: String(PORTS.showControl),
      V2_SHOW_CONTROL_RUNTIME_URL: `http://127.0.0.1:${PORTS.runtime}`,
    }));
    await waitForHealth(services.at(-1).child, `http://127.0.0.1:${PORTS.showControl}`, "show-control", services.at(-1).logs);

    services.push(spawnService("audience", scripts.audience, {
      AUDIENCE_PORT: String(PORTS.audience),
      V2_AUDIENCE_RUNTIME_URL: `http://127.0.0.1:${PORTS.runtime}`,
    }));
    await waitForHealth(services.at(-1).child, `http://127.0.0.1:${PORTS.audience}`, "audience", services.at(-1).logs);

    services.push(spawnService("script-agent", scripts.scriptAgent, {
      SCRIPT_AGENT_PORT: String(PORTS.scriptAgent),
      V2_SCRIPT_AGENT_RUNTIME_URL: `http://127.0.0.1:${PORTS.runtime}`,
    }));
    await waitForHealth(services.at(-1).child, `http://127.0.0.1:${PORTS.scriptAgent}`, "script-agent", services.at(-1).logs);

    services.push(spawnService("gateway", scripts.gateway, {
      GATEWAY_PORT: String(PORTS.gateway),
      V2_GATEWAY_CATALOG_URL: `http://127.0.0.1:${PORTS.catalog}`,
      V2_GATEWAY_PATHS_URL: `http://127.0.0.1:${PORTS.paths}`,
      V2_GATEWAY_ALGORITHM_URL: `http://127.0.0.1:${PORTS.algorithm}`,
      V2_GATEWAY_RUNTIME_URL: `http://127.0.0.1:${PORTS.runtime}`,
      V2_GATEWAY_SHOW_CONTROL_URL: `http://127.0.0.1:${PORTS.showControl}`,
      V2_GATEWAY_AUDIENCE_URL: `http://127.0.0.1:${PORTS.audience}`,
      V2_GATEWAY_SCRIPT_AGENT_URL: `http://127.0.0.1:${PORTS.scriptAgent}`,
    }));
    const gatewayService = services.at(-1);
    await waitForHealth(gatewayService.child, `http://127.0.0.1:${PORTS.gateway}`, "gateway", gatewayService.logs);

    const gatewayBase = `http://127.0.0.1:${PORTS.gateway}`;
    const runtimeBase = `http://127.0.0.1:${PORTS.runtime}`;
    const html = await fetchText(gatewayBase, "/dashboard/");
    const js = await fetchText(gatewayBase, "/dashboard/app.js");
    assert(html.includes("For You V2"));
    assert(js.includes("/v0/gateway/status"));

    const status = await fetchJson(gatewayBase, "/v0/gateway/status");
    assert.equal(status.ok, true);
    assert.equal(status.services.length, 7);
    assert(status.services.every((service) => service.ok));

    const started = await fetchJson(gatewayBase, "/v0/gateway/runtime/runs/start", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    });
    assert(started.showRunId);

    const prepare = await fetchJson(gatewayBase, "/v0/gateway/show-control/cues/prepare", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    });
    assert.equal(prepare.cue.cueType, "prepare");
    assert.notEqual(prepare.cue.status.state, "failed");
    assert(["ok", "warning"].includes(prepare.cue.status.state), `unexpected prepare status ${prepare.cue.status.state}`);

    const active = await fetchJson(gatewayBase, `/v0/gateway/runtime/runs/${started.showRunId}/start-situation`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    });
    assert(active.activeSituation && active.activeSituation.situationRunId);

    const go = await fetchJson(gatewayBase, "/v0/gateway/show-control/cues/go", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    });
    assert.equal(go.cue.cueType, "go");
    assert.equal(go.cue.status.nonBlocking, true);

    await stopService(gatewayService);
    const runtimeAfterGatewayStop = await fetchJson(runtimeBase, "/v0/runtime/runs/current");
    assert.equal(runtimeAfterGatewayStop.showRunId, started.showRunId);
    assert(runtimeAfterGatewayStop.activeSituation && runtimeAfterGatewayStop.activeSituation.situationRunId);

    await stopServices(services);
    const afterHashes = await protectedHashes();
    assertHashesEqual(beforeHashes, afterHashes);

    process.stdout.write(JSON.stringify({
      ok: true,
      ports: PORTS,
      statusServices: status.services.length,
      showRunId: started.showRunId,
      prepareCueId: prepare.cue.cueId,
      goCueId: go.cue.cueId,
      gatewayStoppedWithoutModuleDataCorruption: true,
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
