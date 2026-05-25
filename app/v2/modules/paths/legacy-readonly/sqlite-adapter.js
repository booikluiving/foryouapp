"use strict";

const { execFile, execFileSync } = require("node:child_process");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const APP_ROOT = path.resolve(__dirname, "../../../..");
const V2_ROOT = path.resolve(__dirname, "../../..");
const DEFAULT_LEGACY_SQLITE_PATH = path.join(APP_ROOT, "data", "live.sqlite");
const DEFAULT_LEGACY_SNAPSHOT_DIR = path.join(
  V2_ROOT,
  "modules",
  "paths",
  "legacy-readonly",
  "snapshots"
);

const LEGACY_PATH_TABLES = Object.freeze([
  "algorithm_paths",
  "algorithm_path_scenes",
  "algorithm_path_edges",
  "algorithm_path_thresholds",
  "algorithm_path_node_blocks",
  "algorithm_crossing_thresholds",
]);

const MUTATING_SQL_PATTERN = /\b(ALTER|ATTACH|CREATE|DELETE|DETACH|DROP|INSERT|PRAGMA|REINDEX|REPLACE|UPDATE|VACUUM)\b/i;

function legacySqlitePath() {
  return path.resolve(process.env.V2_PATHS_LEGACY_SQLITE_PATH || DEFAULT_LEGACY_SQLITE_PATH);
}

function assertPathUnderV2(targetPath) {
  const resolved = path.resolve(targetPath);
  const relative = path.relative(V2_ROOT, resolved);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`paths_legacy_snapshot_path_outside_v2:${resolved}`);
  }
  return resolved;
}

function legacySnapshotDir() {
  return assertPathUnderV2(process.env.V2_PATHS_LEGACY_SNAPSHOT_DIR || DEFAULT_LEGACY_SNAPSHOT_DIR);
}

function assertLegacySqliteSource(dbPath) {
  const resolved = path.resolve(dbPath || legacySqlitePath());
  const allowed = path.resolve(DEFAULT_LEGACY_SQLITE_PATH);
  if (resolved !== allowed && !process.env.V2_PATHS_ALLOW_CUSTOM_LEGACY_SOURCE) {
    throw new Error(`paths_legacy_source_not_allowed:${resolved}`);
  }
  if (!fs.existsSync(resolved)) throw new Error(`paths_legacy_sqlite_missing:${resolved}`);
  return resolved;
}

function sha256File(filePath) {
  const hash = crypto.createHash("sha256");
  hash.update(fs.readFileSync(filePath));
  return hash.digest("hex");
}

function hashText(text) {
  return crypto.createHash("sha256").update(String(text)).digest("hex");
}

function legacyWalSidecarPaths(sourcePath) {
  return {
    main: sourcePath,
    wal: `${sourcePath}-wal`,
    shm: `${sourcePath}-shm`,
  };
}

function assertLegacyWalSourceFiles(sourcePath) {
  const files = legacyWalSidecarPaths(sourcePath);
  for (const [kind, filePath] of Object.entries(files)) {
    if (!fs.existsSync(filePath)) throw new Error(`paths_legacy_sqlite_${kind}_missing:${filePath}`);
    if (!fs.statSync(filePath).isFile()) throw new Error(`paths_legacy_sqlite_${kind}_not_file:${filePath}`);
  }
  return files;
}

function sourceHashes(files) {
  return Object.fromEntries(
    Object.entries(files).map(([kind, filePath]) => [kind, sha256File(filePath)])
  );
}

function combinedSnapshotHash(hashes) {
  return hashText(JSON.stringify({
    main: hashes.main,
    wal: hashes.wal,
    shm: hashes.shm,
  }));
}

function copyFile(sourcePath, targetPath, mode) {
  fs.copyFileSync(sourcePath, targetPath, fs.constants.COPYFILE_EXCL);
  fs.chmodSync(targetPath, mode);
}

function checkpointCopiedSqlite(mainPath) {
  const stdout = execFileSync(
    "sqlite3",
    ["-json", path.resolve(mainPath), "PRAGMA wal_checkpoint(TRUNCATE);"],
    { encoding: "utf8", maxBuffer: 4 * 1024 * 1024 }
  );
  const text = String(stdout || "").trim();
  return text ? JSON.parse(text) : [];
}

function chmodReadOnlyIfExists(filePath) {
  if (fs.existsSync(filePath)) fs.chmodSync(filePath, 0o444);
}

function readManifest(manifestPath) {
  return JSON.parse(fs.readFileSync(manifestPath, "utf8"));
}

function ensureLegacyPathsSnapshot(options = {}) {
  const sourcePath = assertLegacySqliteSource(options.dbPath || legacySqlitePath());
  const files = assertLegacyWalSourceFiles(sourcePath);
  const hashes = sourceHashes(files);
  const combinedSha256 = combinedSnapshotHash(hashes);
  const snapshotId = `paths-live-wal-${combinedSha256.slice(0, 16)}`;
  const snapshotDirPath = assertPathUnderV2(path.join(legacySnapshotDir(), snapshotId));
  const manifestPath = assertPathUnderV2(path.join(snapshotDirPath, "manifest.json"));

  if (fs.existsSync(manifestPath)) return readManifest(manifestPath);

  fs.mkdirSync(legacySnapshotDir(), { recursive: true });
  const tempDir = assertPathUnderV2(path.join(
    legacySnapshotDir(),
    `.${snapshotId}.${process.pid}.${Date.now()}.tmp`
  ));
  const rawDir = assertPathUnderV2(path.join(tempDir, "raw"));
  const checkpointDir = assertPathUnderV2(path.join(tempDir, "checkpoint"));
  fs.mkdirSync(rawDir, { recursive: true });
  fs.mkdirSync(checkpointDir, { recursive: true });

  const rawFiles = {
    main: assertPathUnderV2(path.join(rawDir, "live.sqlite")),
    wal: assertPathUnderV2(path.join(rawDir, "live.sqlite-wal")),
    shm: assertPathUnderV2(path.join(rawDir, "live.sqlite-shm")),
  };
  const checkpointFiles = {
    main: assertPathUnderV2(path.join(checkpointDir, "live.sqlite")),
    wal: assertPathUnderV2(path.join(checkpointDir, "live.sqlite-wal")),
    shm: assertPathUnderV2(path.join(checkpointDir, "live.sqlite-shm")),
  };

  copyFile(files.main, rawFiles.main, 0o444);
  copyFile(files.wal, rawFiles.wal, 0o444);
  copyFile(files.shm, rawFiles.shm, 0o444);
  copyFile(rawFiles.main, checkpointFiles.main, 0o644);
  copyFile(rawFiles.wal, checkpointFiles.wal, 0o644);
  copyFile(rawFiles.shm, checkpointFiles.shm, 0o644);

  const checkpointResult = checkpointCopiedSqlite(checkpointFiles.main);
  chmodReadOnlyIfExists(checkpointFiles.main);
  chmodReadOnlyIfExists(checkpointFiles.wal);
  chmodReadOnlyIfExists(checkpointFiles.shm);

  const manifest = {
    snapshotId,
    snapshotDir: snapshotDirPath,
    rawDir: assertPathUnderV2(path.join(snapshotDirPath, "raw")),
    checkpointDir: assertPathUnderV2(path.join(snapshotDirPath, "checkpoint")),
    sourcePath,
    sourceFiles: files,
    sourceSha256: hashes,
    combinedSha256,
    rawFiles: {
      main: assertPathUnderV2(path.join(snapshotDirPath, "raw", "live.sqlite")),
      wal: assertPathUnderV2(path.join(snapshotDirPath, "raw", "live.sqlite-wal")),
      shm: assertPathUnderV2(path.join(snapshotDirPath, "raw", "live.sqlite-shm")),
    },
    checkpointFiles: {
      main: assertPathUnderV2(path.join(snapshotDirPath, "checkpoint", "live.sqlite")),
      wal: assertPathUnderV2(path.join(snapshotDirPath, "checkpoint", "live.sqlite-wal")),
      shm: assertPathUnderV2(path.join(snapshotDirPath, "checkpoint", "live.sqlite-shm")),
    },
    checkpoint: {
      mode: "wal_checkpoint(TRUNCATE)",
      target: "v2-paths-copy",
      result: checkpointResult,
    },
    created: true,
  };

  fs.writeFileSync(path.join(tempDir, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  fs.chmodSync(path.join(tempDir, "manifest.json"), 0o444);
  try {
    fs.renameSync(tempDir, snapshotDirPath);
  } catch (err) {
    if (err && err.code === "EEXIST" && fs.existsSync(manifestPath)) return readManifest(manifestPath);
    throw err;
  }
  return readManifest(manifestPath);
}

function sqliteImmutableUri(dbPath) {
  return `${pathToFileURL(path.resolve(dbPath)).href}?mode=ro&immutable=1`;
}

function assertReadOnlySql(sql) {
  const normalized = String(sql || "").trim();
  if (!normalized) throw new Error("paths_empty_sql_not_allowed");
  if (!/^SELECT\b/i.test(normalized)) throw new Error("paths_only_select_sql_allowed");
  if (MUTATING_SQL_PATTERN.test(normalized)) throw new Error("paths_mutating_sql_not_allowed");
  return normalized;
}

function queryJson(sql, options = {}) {
  const safeSql = assertReadOnlySql(sql);
  const legacySnapshot = options.legacySnapshot || ensureLegacyPathsSnapshot(options);
  return new Promise((resolve, reject) => {
    execFile(
      "sqlite3",
      ["-json", sqliteImmutableUri(legacySnapshot.checkpointFiles.main), safeSql],
      { maxBuffer: 32 * 1024 * 1024 },
      (err, stdout, stderr) => {
        if (err) {
          err.message = stderr ? `${err.message}: ${stderr.trim()}` : err.message;
          reject(err);
          return;
        }
        const text = String(stdout || "").trim();
        if (!text) {
          resolve([]);
          return;
        }
        try {
          resolve(JSON.parse(text));
        } catch (parseErr) {
          parseErr.message = `paths_sqlite_json_parse_failed: ${parseErr.message}`;
          reject(parseErr);
        }
      }
    );
  });
}

async function readLegacyPathRows(options = {}) {
  const legacySnapshot = ensureLegacyPathsSnapshot(options);
  const paths = await queryJson(
    `SELECT id, name, description, sort_order, color, edge_mode, is_active, archived_at, created_at, updated_at
     FROM algorithm_paths
     ORDER BY sort_order, id`,
    { legacySnapshot }
  );
  const pathScenes = await queryJson(
    `SELECT id, path_id, scene_id, sort_order, is_end_node, ignore_crossing_blocks, created_at, updated_at
     FROM algorithm_path_scenes
     ORDER BY path_id, sort_order, id`,
    { legacySnapshot }
  );
  const pathEdges = await queryJson(
    `SELECT id, path_id, from_scene_id, to_scene_id, edge_type, sort_order, created_at, updated_at
     FROM algorithm_path_edges
     ORDER BY path_id, sort_order, id`,
    { legacySnapshot }
  );
  const pathThresholds = await queryJson(
    `SELECT id, path_id, source_scene_id, required_count, created_at, updated_at
     FROM algorithm_path_thresholds
     ORDER BY path_id, source_scene_id, id`,
    { legacySnapshot }
  );
  const pathNodeBlocks = await queryJson(
    `SELECT id, path_id, source_scene_id, include_crossing_paths, created_at, updated_at
     FROM algorithm_path_node_blocks
     ORDER BY path_id, source_scene_id, id`,
    { legacySnapshot }
  );
  const crossingThresholds = await queryJson(
    `SELECT id, scene_id, required_count, created_at, updated_at
     FROM algorithm_crossing_thresholds
     ORDER BY scene_id, id`,
    { legacySnapshot }
  );

  return {
    source: {
      type: "legacy-sqlite-wal-copy",
      path: legacySnapshot.checkpointFiles.main,
      walPath: legacySnapshot.checkpointFiles.wal,
      shmPath: legacySnapshot.checkpointFiles.shm,
      rawPath: legacySnapshot.rawFiles.main,
      rawWalPath: legacySnapshot.rawFiles.wal,
      rawShmPath: legacySnapshot.rawFiles.shm,
      snapshotId: legacySnapshot.snapshotId,
      snapshotDir: legacySnapshot.snapshotDir,
      originalPath: legacySnapshot.sourcePath,
      originalFiles: legacySnapshot.sourceFiles,
      originalSha256: legacySnapshot.sourceSha256,
      originalCombinedSha256: legacySnapshot.combinedSha256,
      readOnly: true,
      originalReadOnly: true,
      adapter: "sqlite3-cli-paths-wal-copy-checkpoint-immutable-read",
      checkpoint: legacySnapshot.checkpoint,
      tables: LEGACY_PATH_TABLES,
    },
    paths,
    pathScenes,
    pathEdges,
    pathThresholds,
    pathNodeBlocks,
    crossingThresholds,
  };
}

module.exports = {
  DEFAULT_LEGACY_SQLITE_PATH,
  DEFAULT_LEGACY_SNAPSHOT_DIR,
  LEGACY_PATH_TABLES,
  V2_ROOT,
  assertPathUnderV2,
  assertReadOnlySql,
  ensureLegacyPathsSnapshot,
  legacySqlitePath,
  queryJson,
  readLegacyPathRows,
};
