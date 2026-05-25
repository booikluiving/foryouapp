"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs/promises");
const net = require("node:net");
const path = require("node:path");
const { spawn } = require("node:child_process");

const {
  CATALOG_SCHEMA_VERSION,
  CATALOG_SNAPSHOT_SCHEMA_VERSION,
  REQUIRED_READ_MODEL_ARRAYS,
} = require("../../../shared/contracts/catalog-v0");
const { assertReadOnlySql } = require("../legacy-readonly/sqlite-adapter");
const { V2_ROOT } = require("../snapshots/snapshot-store");

const TEST_DIR = __dirname;
const APP_ROOT = path.resolve(TEST_DIR, "../../../..");
const PORT = 3021;
const BASE_URL = `http://127.0.0.1:${PORT}`;
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

async function fetchJson(pathname, options) {
  const response = await fetch(`${BASE_URL}${pathname}`, options);
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
  assert.throws(
    () => assertReadOnlySql("UPDATE algorithm_scenes SET title = title"),
    /mutating_sql_not_allowed|only_select_sql_allowed/
  );

  await assertPortFree(PORT);
  const beforeHashes = await protectedHashes();
  const serverPath = path.resolve(TEST_DIR, "../server/server.js");
  const logs = [];
  const child = spawn(process.execPath, [serverPath], {
    cwd: APP_ROOT,
    env: {
      ...process.env,
      CATALOG_PORT: String(PORT),
      V2_CATALOG_EXPRESS_MODULE: process.env.V2_CATALOG_EXPRESS_MODULE
        || "/opt/homebrew/lib/node_modules/node-red/node_modules/express",
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
    assert.equal(readModel.source.readOnly, true);
    assert.equal(readModel.source.originalReadOnly, true);
    assert.equal(readModel.source.adapter, "sqlite3-cli-wal-copy-checkpoint-immutable-read");
    assert(readModel.source.originalPath.endsWith(path.join("app", "data", "live.sqlite")));
    assert(readModel.source.originalFiles.wal.endsWith(path.join("app", "data", "live.sqlite-wal")));
    assert(readModel.source.originalFiles.shm.endsWith(path.join("app", "data", "live.sqlite-shm")));
    assertPathInside(V2_ROOT, readModel.source.path);
    assertPathInside(V2_ROOT, readModel.source.walPath);
    assertPathInside(V2_ROOT, readModel.source.shmPath);
    assertPathInside(V2_ROOT, readModel.source.rawPath);
    assertPathInside(V2_ROOT, readModel.source.rawWalPath);
    assertPathInside(V2_ROOT, readModel.source.rawShmPath);
    assert.equal(readModel.source.checkpoint.target, "v2-copy");

    const validation = await fetchJson("/v0/catalog/validation");
    assert.equal(validation.schemaVersion, CATALOG_SCHEMA_VERSION);
    assert(validation.counts && Number.isInteger(validation.counts.errors));
    assert(Array.isArray(validation.issues), "validation issues should be an array");

    const snapshotResult = await fetchJson("/v0/catalog/snapshots", { method: "POST" });
    assert(snapshotResult.snapshotId, "snapshotId should be returned");
    assert(snapshotResult.createdAt, "createdAt should be returned");
    assert.equal(snapshotResult.schemaVersion, CATALOG_SNAPSHOT_SCHEMA_VERSION);
    assert(snapshotResult.source && snapshotResult.source.readOnly === true, "snapshot source should be read-only");
    assert(snapshotResult.filePath, "snapshot filePath should be returned");
    assertPathInside(V2_ROOT, snapshotResult.filePath);

    const snapshot = JSON.parse(await fs.readFile(snapshotResult.filePath, "utf8"));
    assert.equal(snapshot.snapshotId, snapshotResult.snapshotId);
    assert(snapshot.createdAt);
    assert(snapshot.source && snapshot.source.readOnly === true);
    assert(snapshot.source && snapshot.source.originalReadOnly === true);
    assertPathInside(V2_ROOT, snapshot.source.path);
    assertPathInside(V2_ROOT, snapshot.source.walPath);
    assertPathInside(V2_ROOT, snapshot.source.shmPath);
    assertPathInside(V2_ROOT, snapshot.source.rawPath);
    assertPathInside(V2_ROOT, snapshot.source.rawWalPath);
    assertPathInside(V2_ROOT, snapshot.source.rawShmPath);
    assert.equal(snapshot.schemaVersion, CATALOG_SNAPSHOT_SCHEMA_VERSION);
    assert(snapshot.catalog && Array.isArray(snapshot.catalog.situations));
    assert.equal(snapshot.catalog.situations.length, readModel.situations.length);

    await stopChild(child);
    const afterHashes = await protectedHashes();
    assertHashesEqual(beforeHashes, afterHashes);

    process.stdout.write(JSON.stringify({
      ok: true,
      port: PORT,
      counts: readModel.counts,
      validationCounts: validation.counts,
      snapshotId: snapshotResult.snapshotId,
      snapshotPath: snapshotResult.filePath,
      protectedV1HashesUnchanged: true,
    }, null, 2));
    process.stdout.write("\n");
  } catch (err) {
    await stopChild(child);
    const afterHashes = await protectedHashes();
    assertHashesEqual(beforeHashes, afterHashes);
    err.message = `${err.message}\nCatalog server logs:\n${logs.join("")}`;
    throw err;
  }
}

main().catch((err) => {
  process.stderr.write(`${err.stack || err.message}\n`);
  process.exit(1);
});
