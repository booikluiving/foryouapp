"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const net = require("node:net");
const path = require("node:path");
const { spawn } = require("node:child_process");

const {
  CATALOG_SCHEMA_VERSION,
  CATALOG_SNAPSHOT_SCHEMA_VERSION,
  REQUIRED_READ_MODEL_ARRAYS,
} = require("../../../shared/contracts/catalog-v0");
const { APP_ROOT } = require("../snapshots/snapshot-store");

const TEST_DIR = __dirname;
let PORT = 3021;
function assertPathInside(parent, child) {
  const relative = path.relative(parent, child);
  assert(!relative.startsWith("..") && !path.isAbsolute(relative), `${child} is outside ${parent}`);
}

async function assertPortFree(port) {
  await new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.once("listening", () => {
      server.close(resolve);
    });
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

async function fetchJson(pathname, options) {
  const response = await fetch(`http://127.0.0.1:${PORT}${pathname}`, options);
  const body = await response.json();
  if (!response.ok) {
    throw new Error(`${pathname} returned ${response.status}: ${JSON.stringify(body)}`);
  }
  return body;
}

async function waitForHealth(child, logs) {
  const deadline = Date.now() + 8000;
  while (Date.now() < deadline) {
    if (child.exitCode != null) {
      throw new Error(`Catalog server exited early (${child.exitCode}): ${logs.join("")}`);
    }
    try {
      return await fetchJson("/health");
    } catch (_err) {
      await new Promise((resolve) => setTimeout(resolve, 150));
    }
  }
  throw new Error(`Catalog server did not become healthy: ${logs.join("")}`);
}

async function stopChild(child) {
  if (!child || child.exitCode != null) return;
  await new Promise((resolve) => {
    child.once("exit", resolve);
    child.kill("SIGTERM");
    setTimeout(() => {
      if (child.exitCode == null) child.kill("SIGKILL");
    }, 2000).unref();
  });
}

async function main() {
  PORT = await findFreePort();
  await assertPortFree(PORT);
  const serverPath = path.resolve(TEST_DIR, "../server/server.js");
  const logs = [];
  const child = spawn(process.execPath, [serverPath], {
    cwd: APP_ROOT,
    env: {
      ...process.env,
      CATALOG_PORT: String(PORT),
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout.on("data", (chunk) => logs.push(String(chunk)));
  child.stderr.on("data", (chunk) => logs.push(String(chunk)));

  try {
    const health = await waitForHealth(child, logs);
    assert.equal(health.ok, true);
    assert.equal(health.service, "catalog");
    assert.equal(health.version, "v0");
    assert.equal(health.port, PORT);

    const readModel = await fetchJson("/v0/catalog/read-model");
    assert.equal(readModel.schemaVersion, CATALOG_SCHEMA_VERSION);
    for (const key of REQUIRED_READ_MODEL_ARRAYS) {
      assert(Array.isArray(readModel[key]), `${key} must be an array`);
    }
    assert(readModel.performers.length > 0, "performers should be present");
    assert(readModel.characters.length > 0, "characters should be present");
    assert(readModel.environments.length > 0, "environments should be present");
    assert(readModel.situations.length > 0, "situations should be present");
    assert(readModel.labels.length > 0, "labels should be present");
    assert(readModel.mediaAssets.length >= readModel.environments.length, "media asset metadata should be present");
    assert(readModel.lightingPresets.some((preset) => preset.id === "studio-neutral"), "lighting presets should be present");
    assert.equal(readModel.source.type, "catalog-sqlite");
    assert.equal(readModel.source.readOnly, false);
    assert.equal(readModel.source.ownsMutations, true);
    assertPathInside(APP_ROOT, readModel.source.path);

    const validation = await fetchJson("/v0/catalog/validation");
    assert.equal(validation.schemaVersion, CATALOG_SCHEMA_VERSION);
    assert(validation.counts && Number.isInteger(validation.counts.errors));
    assert(Array.isArray(validation.issues), "validation issues should be an array");

    const lightingPresets = await fetchJson("/v0/catalog/lighting-presets");
    assert(lightingPresets.lightingPresets.some((preset) => preset.id === "neutral-dim"), "lighting preset API should expose neutral-dim");

    const snapshotResult = await fetchJson("/v0/catalog/snapshots", { method: "POST" });
    assert(snapshotResult.snapshotId, "snapshotId should be returned");
    assert(snapshotResult.createdAt, "createdAt should be returned");
    assert.equal(snapshotResult.schemaVersion, CATALOG_SNAPSHOT_SCHEMA_VERSION);
    assert(snapshotResult.source && snapshotResult.source.type === "catalog-sqlite", "snapshot source should be SQLite");
    assert(snapshotResult.source && snapshotResult.source.ownsMutations === true, "snapshot source should own mutations");
    assert(snapshotResult.filePath, "snapshot filePath should be returned");
    assertPathInside(APP_ROOT, snapshotResult.filePath);

    const snapshot = JSON.parse(await fs.readFile(snapshotResult.filePath, "utf8"));
    assert.equal(snapshot.snapshotId, snapshotResult.snapshotId);
    assert(snapshot.createdAt);
    assert(snapshot.source && snapshot.source.type === "catalog-sqlite");
    assert(snapshot.source && snapshot.source.ownsMutations === true);
    assertPathInside(APP_ROOT, snapshot.source.path);
    assert.equal(snapshot.schemaVersion, CATALOG_SNAPSHOT_SCHEMA_VERSION);
    assert(snapshot.catalog && Array.isArray(snapshot.catalog.situations));
    assert.equal(snapshot.catalog.situations.length, readModel.situations.length);
    assert(snapshot.catalog.lightingPresets.some((preset) => preset.id === "studio-neutral"), "snapshot should include lighting presets");

    await stopChild(child);

    process.stdout.write(JSON.stringify({
      ok: true,
      port: PORT,
      counts: readModel.counts,
      validationCounts: validation.counts,
      snapshotId: snapshotResult.snapshotId,
      snapshotPath: snapshotResult.filePath,
    }, null, 2));
    process.stdout.write("\n");
  } catch (err) {
    await stopChild(child);
    err.message = `${err.message}\nCatalog server logs:\n${logs.join("")}`;
    throw err;
  }
}

main().catch((err) => {
  process.stderr.write(`${err.stack || err.message}\n`);
  process.exit(1);
});
