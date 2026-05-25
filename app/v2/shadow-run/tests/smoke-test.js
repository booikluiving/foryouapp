"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs/promises");
const net = require("node:net");
const path = require("node:path");
const { spawn } = require("node:child_process");

const { validateShadowRunReportShape } = require("../../shared/contracts/shadow-run-v0");
const { compareShadowRun, saveShadowReport } = require("../compare/shadow-compare");
const {
  evaluateV2Paths,
  fetchCatalogReadModel,
  fetchPathsSnapshot,
  startV2RuntimeRun,
} = require("../v2-client/service-clients");

const TEST_DIR = __dirname;
const APP_ROOT = path.resolve(TEST_DIR, "../../..");
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

async function fetchJson(baseUrl, pathname) {
  const response = await fetch(`${baseUrl}${pathname}`, { signal: AbortSignal.timeout(5000) });
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
  for (const service of services.reverse()) await stopService(service);
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
    await waitForHealth(services.at(-1).child, `http://127.0.0.1:${PORTS.catalog}`, "catalog", services.at(-1).logs);

    services.push(spawnService("paths", pathsScript, {
      PATHS_PORT: String(PORTS.paths),
      V2_PATHS_EXPRESS_MODULE: EXPRESS_FALLBACK,
    }));
    await waitForHealth(services.at(-1).child, `http://127.0.0.1:${PORTS.paths}`, "paths", services.at(-1).logs);

    services.push(spawnService("runtime", runtimeScript, {
      RUNTIME_PORT: String(PORTS.runtime),
      V2_RUNTIME_EXPRESS_MODULE: EXPRESS_FALLBACK,
      V2_RUNTIME_CATALOG_URL: `http://127.0.0.1:${PORTS.catalog}`,
      V2_RUNTIME_PATHS_URL: `http://127.0.0.1:${PORTS.paths}`,
      V2_SHADOW_CATALOG_URL: `http://127.0.0.1:${PORTS.catalog}`,
      V2_SHADOW_PATHS_URL: `http://127.0.0.1:${PORTS.paths}`,
      V2_SHADOW_RUNTIME_URL: `http://127.0.0.1:${PORTS.runtime}`,
    }));
    await waitForHealth(services.at(-1).child, `http://127.0.0.1:${PORTS.runtime}`, "runtime", services.at(-1).logs);

    process.env.V2_SHADOW_CATALOG_URL = `http://127.0.0.1:${PORTS.catalog}`;
    process.env.V2_SHADOW_PATHS_URL = `http://127.0.0.1:${PORTS.paths}`;
    process.env.V2_SHADOW_RUNTIME_URL = `http://127.0.0.1:${PORTS.runtime}`;

    const catalog = await fetchCatalogReadModel();
    const paths = await fetchPathsSnapshot();
    const pathEvaluation = await evaluateV2Paths([]);
    const runtimeState = await startV2RuntimeRun();
    const report = compareShadowRun({ catalog, paths, pathEvaluation, runtimeState });
    assert.equal(validateShadowRunReportShape(report).length, 0);
    assert(report.v1.availablePool.length > 0, "V1 oracle should expose an available pool");
    assert(report.v2.availablePool.length > 0, "V2 should expose an available pool");
    assert.equal(report.comparison.summary.availablePoolMatches, true, "V2 initial available pool must match the V1 oracle");
    assert.equal(
      report.comparison.summary.runtimeEligibleMatchesPathAvailable,
      true,
      "Runtime eligiblePool must use the same initial pool as Paths pathAvailable"
    );
    assert(report.comparison.preparedNext.explanation);
    const saved = await saveShadowReport(report);
    const savedText = await fs.readFile(saved.filePath, "utf8");
    assert.equal(JSON.parse(savedText).shadowRunId, report.shadowRunId);

    await stopServices(services);
    const afterHashes = await protectedHashes();
    assertHashesEqual(beforeHashes, afterHashes);

    process.stdout.write(JSON.stringify({
      ok: true,
      ports: PORTS,
      shadowRunId: report.shadowRunId,
      reportPath: saved.filePath,
      v1Available: report.v1.availablePool.length,
      v2Available: report.v2.availablePool.length,
      v2RuntimeEligible: report.v2.runtimeEligiblePool.length,
      availablePoolMatches: report.comparison.summary.availablePoolMatches,
      runtimeEligibleMatchesPathAvailable: report.comparison.summary.runtimeEligibleMatchesPathAvailable,
      preparedNextMatches: report.comparison.summary.preparedNextMatches,
      preparedNextExplanation: report.comparison.preparedNext.explanation,
      differenceCount: report.comparison.summary.differenceCount,
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
