"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs/promises");
const path = require("node:path");

const { buildCatalogReadModel } = require("../read-model/build-read-model");
const {
  assertReadOnlySql,
  ensureLegacySqliteSnapshot,
  queryJson,
  V2_ROOT,
} = require("../legacy-readonly/sqlite-adapter");

const TEST_DIR = __dirname;
const APP_ROOT = path.resolve(TEST_DIR, "../../../..");
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
    assert.equal(
      after[filePath],
      before[filePath],
      `${path.basename(filePath)} changed during read-only adapter regression`
    );
  }
}

function assertPathInside(parent, child) {
  const relative = path.relative(parent, child);
  assert(!relative.startsWith("..") && !path.isAbsolute(relative), `${child} is outside ${parent}`);
}

async function assertFileExists(filePath) {
  const stats = await fs.stat(filePath);
  assert(stats.isFile(), `${filePath} should be a file`);
}

async function main() {
  assert.throws(
    () => assertReadOnlySql("UPDATE algorithm_scenes SET title = title"),
    /mutating_sql_not_allowed|only_select_sql_allowed/
  );
  assert.throws(
    () => assertReadOnlySql("PRAGMA journal_mode"),
    /mutating_sql_not_allowed|only_select_sql_allowed/
  );

  const before = await protectedHashes();
  const legacySnapshot = ensureLegacySqliteSnapshot();
  assertPathInside(V2_ROOT, legacySnapshot.snapshotDir);
  assertPathInside(V2_ROOT, legacySnapshot.rawFiles.main);
  assertPathInside(V2_ROOT, legacySnapshot.rawFiles.wal);
  assertPathInside(V2_ROOT, legacySnapshot.rawFiles.shm);
  assertPathInside(V2_ROOT, legacySnapshot.checkpointFiles.main);
  assertPathInside(V2_ROOT, legacySnapshot.checkpointFiles.wal);
  assertPathInside(V2_ROOT, legacySnapshot.checkpointFiles.shm);
  await assertFileExists(legacySnapshot.rawFiles.main);
  await assertFileExists(legacySnapshot.rawFiles.wal);
  await assertFileExists(legacySnapshot.rawFiles.shm);
  await assertFileExists(legacySnapshot.checkpointFiles.main);
  await assertFileExists(legacySnapshot.checkpointFiles.wal);
  await assertFileExists(legacySnapshot.checkpointFiles.shm);
  assert.deepEqual(legacySnapshot.sourceFiles, {
    main: path.join(APP_ROOT, "data", "live.sqlite"),
    wal: path.join(APP_ROOT, "data", "live.sqlite-wal"),
    shm: path.join(APP_ROOT, "data", "live.sqlite-shm"),
  });

  const rows = await queryJson("SELECT COUNT(*) AS count FROM algorithm_scenes");
  assert.equal(Number(rows[0].count), 72);

  const readModel = await buildCatalogReadModel();
  assert.equal(readModel.source.readOnly, true);
  assert.equal(readModel.source.originalReadOnly, true);
  assert.equal(readModel.source.adapter, "sqlite3-cli-wal-copy-checkpoint-immutable-read");
  assert.equal(readModel.source.originalPath, path.join(APP_ROOT, "data", "live.sqlite"));
  assert.equal(readModel.source.originalFiles.wal, path.join(APP_ROOT, "data", "live.sqlite-wal"));
  assert.equal(readModel.source.originalFiles.shm, path.join(APP_ROOT, "data", "live.sqlite-shm"));
  assertPathInside(V2_ROOT, readModel.source.path);
  assertPathInside(V2_ROOT, readModel.source.walPath);
  assertPathInside(V2_ROOT, readModel.source.shmPath);
  assertPathInside(V2_ROOT, readModel.source.rawPath);
  assertPathInside(V2_ROOT, readModel.source.rawWalPath);
  assertPathInside(V2_ROOT, readModel.source.rawShmPath);
  assert.equal(readModel.source.checkpoint.target, "v2-copy");
  assert.equal(readModel.counts.situations, 72);
  assert(readModel.counts.mediaAssets >= readModel.counts.environments);

  const after = await protectedHashes();
  assertHashesEqual(before, after);

  process.stdout.write(JSON.stringify({
    ok: true,
    adapter: readModel.source.adapter,
    legacySnapshotId: readModel.source.snapshotId,
    legacyCheckpointPath: readModel.source.path,
    legacyRawPath: readModel.source.rawPath,
    originalPath: readModel.source.originalPath,
    originalWalPath: readModel.source.originalFiles.wal,
    originalShmPath: readModel.source.originalFiles.shm,
    counts: readModel.counts,
    protectedV1HashesUnchanged: true,
  }, null, 2));
  process.stdout.write("\n");
}

main().catch((err) => {
  process.stderr.write(`${err.stack || err.message}\n`);
  process.exit(1);
});
