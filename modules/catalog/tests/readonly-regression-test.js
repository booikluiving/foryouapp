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
} = require("../tools/legacy-readonly/sqlite-adapter");

const TEST_DIR = __dirname;
const APP_ROOT = path.resolve(TEST_DIR, "../../..");
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
    main: path.join(APP_ROOT, "legacy", "data", "live.sqlite"),
    wal: path.join(APP_ROOT, "legacy", "data", "live.sqlite-wal"),
    shm: path.join(APP_ROOT, "legacy", "data", "live.sqlite-shm"),
  });

  const rows = await queryJson("SELECT COUNT(*) AS count FROM algorithm_scenes");
  const legacySceneCount = Number(rows[0].count);
  assert(legacySceneCount > 0, "legacy scenes should be present");

  const readModel = await buildCatalogReadModel();
  assert.equal(readModel.source.type, "v2-catalog-sqlite");
  assert.equal(readModel.source.readOnly, false);
  assert.equal(readModel.source.ownsMutations, true);
  assertPathInside(V2_ROOT, readModel.source.path);
  assert(!JSON.stringify(readModel.source).includes("legacy/data/live.sqlite"), "V2 read model must not expose legacy sqlite paths");
  assert.equal(readModel.counts.situations, legacySceneCount);
  assert(readModel.counts.mediaAssets >= readModel.counts.environments);

  const after = await protectedHashes();
  assertHashesEqual(before, after);

  process.stdout.write(JSON.stringify({
    ok: true,
    adapter: "sqlite3-cli-wal-copy-checkpoint-immutable-read",
    legacySnapshotId: legacySnapshot.snapshotId,
    catalogSourceType: readModel.source.type,
    catalogDbPath: readModel.source.path,
    counts: readModel.counts,
    protectedV1HashesUnchanged: true,
  }, null, 2));
  process.stdout.write("\n");
}

main().catch((err) => {
  process.stderr.write(`${err.stack || err.message}\n`);
  process.exit(1);
});
