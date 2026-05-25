"use strict";

const { execFile, execFileSync } = require("node:child_process");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const APP_ROOT = path.resolve(__dirname, "../../../..");
const V2_ROOT = path.resolve(__dirname, "../../..");
const DEFAULT_LEGACY_SQLITE_PATH = path.join(APP_ROOT, "data", "live.sqlite");
const DEFAULT_LEGACY_SNAPSHOT_DIR = path.join(
  V2_ROOT,
  "modules",
  "catalog",
  "legacy-readonly",
  "snapshots"
);
const DEFAULT_ENVIRONMENT_ASSET_MEDIA_DIR = path.join(
  os.homedir(),
  "Library",
  "CloudStorage",
  "Dropbox",
  "For You",
  "Voorstelling",
  "Media",
  "Achtergrondjes"
);

const LEGACY_TABLES = Object.freeze([
  "algorithm_performers",
  "algorithm_characters",
  "algorithm_situations",
  "algorithm_environments",
  "algorithm_labels",
  "algorithm_scenes",
]);

const MUTATING_SQL_PATTERN = /\b(ALTER|ATTACH|CREATE|DELETE|DETACH|DROP|INSERT|PRAGMA|REINDEX|REPLACE|UPDATE|VACUUM)\b/i;

const ENVIRONMENT_ASSET_TYPES = Object.freeze({
  background: Object.freeze(["jpg", "jpeg", "png", "webp"]),
  audio: Object.freeze(["mp3", "wav", "aif", "aiff", "m4a", "aac", "flac"]),
  fx: Object.freeze(["mp4", "mov", "m4v", "webm", "jpg", "jpeg", "png", "webp"]),
  prompt: Object.freeze(["txt"]),
});

const FX_SIDE_BASENAME_TYPES = new Set(["fx"]);

function legacySqlitePath() {
  return path.resolve(process.env.V2_CATALOG_LEGACY_SQLITE_PATH || DEFAULT_LEGACY_SQLITE_PATH);
}

function environmentAssetMediaDir() {
  return path.resolve(
    process.env.V2_CATALOG_ENVIRONMENT_ASSET_MEDIA_DIR
      || process.env.ENVIRONMENT_ASSET_MEDIA_DIR
      || DEFAULT_ENVIRONMENT_ASSET_MEDIA_DIR
  );
}

function assertLegacySqliteSource(dbPath) {
  const resolved = path.resolve(dbPath || legacySqlitePath());
  const allowed = path.resolve(DEFAULT_LEGACY_SQLITE_PATH);
  if (resolved !== allowed && !process.env.V2_CATALOG_ALLOW_CUSTOM_LEGACY_SOURCE) {
    throw new Error(`legacy_source_not_allowed:${resolved}`);
  }
  if (!fs.existsSync(resolved)) throw new Error(`legacy_sqlite_missing:${resolved}`);
  return resolved;
}

function assertPathUnderV2(targetPath) {
  const resolved = path.resolve(targetPath);
  const relative = path.relative(V2_ROOT, resolved);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`legacy_snapshot_path_outside_v2:${resolved}`);
  }
  return resolved;
}

function legacySnapshotDir() {
  return assertPathUnderV2(process.env.V2_CATALOG_LEGACY_SNAPSHOT_DIR || DEFAULT_LEGACY_SNAPSHOT_DIR);
}

function sha256File(filePath) {
  const hash = crypto.createHash("sha256");
  hash.update(fs.readFileSync(filePath));
  return hash.digest("hex");
}

function hashText(text) {
  return crypto.createHash("sha256").update(String(text)).digest("hex");
}

function sqliteImmutableUri(dbPath) {
  const resolved = path.resolve(dbPath);
  return `${pathToFileURL(resolved).href}?mode=ro&immutable=1`;
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
    if (!fs.existsSync(filePath)) throw new Error(`legacy_sqlite_${kind}_missing:${filePath}`);
    if (!fs.statSync(filePath).isFile()) throw new Error(`legacy_sqlite_${kind}_not_file:${filePath}`);
  }
  return files;
}

function legacyWalSourceHashes(files) {
  return Object.fromEntries(
    Object.entries(files).map(([kind, filePath]) => [kind, sha256File(filePath)])
  );
}

function combinedWalSnapshotHash(sourceHashes) {
  return hashText(JSON.stringify({
    main: sourceHashes.main,
    wal: sourceHashes.wal,
    shm: sourceHashes.shm,
  }));
}

function copyFileReadOnly(sourcePath, targetPath) {
  fs.copyFileSync(sourcePath, targetPath, fs.constants.COPYFILE_EXCL);
  fs.chmodSync(targetPath, 0o444);
}

function copyFileWritable(sourcePath, targetPath) {
  fs.copyFileSync(sourcePath, targetPath, fs.constants.COPYFILE_EXCL);
  fs.chmodSync(targetPath, 0o644);
}

function checkpointCopiedSqlite(mainPath) {
  const stdout = execFileSync(
    "sqlite3",
    ["-json", path.resolve(mainPath), "PRAGMA wal_checkpoint(TRUNCATE);"],
    { encoding: "utf8", maxBuffer: 4 * 1024 * 1024 }
  );
  const text = String(stdout || "").trim();
  if (!text) return [];
  return JSON.parse(text);
}

function chmodReadOnlyIfExists(filePath) {
  if (fs.existsSync(filePath)) fs.chmodSync(filePath, 0o444);
}

function readManifest(manifestPath) {
  return JSON.parse(fs.readFileSync(manifestPath, "utf8"));
}

function ensureLegacySqliteSnapshot(options = {}) {
  const sourcePath = assertLegacySqliteSource(options.dbPath || legacySqlitePath());
  const sourceFiles = assertLegacyWalSourceFiles(sourcePath);
  const sourceSha256 = legacyWalSourceHashes(sourceFiles);
  const combinedSha256 = combinedWalSnapshotHash(sourceSha256);
  const snapshotsRoot = legacySnapshotDir();
  const snapshotId = `live-wal-${combinedSha256.slice(0, 16)}`;
  const snapshotDirPath = assertPathUnderV2(path.join(snapshotsRoot, snapshotId));
  const manifestPath = assertPathUnderV2(path.join(snapshotDirPath, "manifest.json"));

  if (fs.existsSync(manifestPath)) {
    return readManifest(manifestPath);
  }

  fs.mkdirSync(snapshotsRoot, { recursive: true });
  const tempDir = assertPathUnderV2(path.join(
    snapshotsRoot,
    `.${snapshotId}.${process.pid}.${Date.now()}.tmp`
  ));
  const rawDir = path.join(tempDir, "raw");
  const checkpointDir = path.join(tempDir, "checkpoint");
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

  copyFileReadOnly(sourceFiles.main, rawFiles.main);
  copyFileReadOnly(sourceFiles.wal, rawFiles.wal);
  copyFileReadOnly(sourceFiles.shm, rawFiles.shm);
  copyFileWritable(rawFiles.main, checkpointFiles.main);
  copyFileWritable(rawFiles.wal, checkpointFiles.wal);
  copyFileWritable(rawFiles.shm, checkpointFiles.shm);

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
    sourceFiles,
    sourceSha256,
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
      target: "v2-copy",
      result: checkpointResult,
    },
    created: true,
  };

  const tempManifestPath = path.join(tempDir, "manifest.json");
  fs.writeFileSync(tempManifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  fs.chmodSync(tempManifestPath, 0o444);

  try {
    fs.renameSync(tempDir, snapshotDirPath);
  } catch (err) {
    if (err && err.code === "EEXIST" && fs.existsSync(manifestPath)) {
      return readManifest(manifestPath);
    }
    throw err;
  }

  return readManifest(manifestPath);
}

function assertReadOnlySql(sql) {
  const normalized = String(sql || "").trim();
  if (!normalized) throw new Error("empty_sql_not_allowed");
  if (!/^SELECT\b/i.test(normalized)) throw new Error("only_select_sql_allowed");
  if (MUTATING_SQL_PATTERN.test(normalized)) throw new Error("mutating_sql_not_allowed");
  return normalized;
}

function queryJson(sql, options = {}) {
  const safeSql = assertReadOnlySql(sql);
  const legacySnapshot = options.legacySnapshot || ensureLegacySqliteSnapshot(options);
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
          parseErr.message = `sqlite_json_parse_failed: ${parseErr.message}`;
          reject(parseErr);
        }
      }
    );
  });
}

async function readLegacyCatalogRows(options = {}) {
  const legacySnapshot = ensureLegacySqliteSnapshot(options);
  const performers = await queryJson(
    `SELECT id, name, sort_order, role_slot, external_id, is_active, archived_at, created_at, updated_at
     FROM algorithm_performers
     ORDER BY sort_order, id`,
    { legacySnapshot }
  );
  const characters = await queryJson(
    `SELECT id, name, description, prompt_text, performer_id, external_id, label_scores_json,
            is_active, archived_at, created_at, updated_at
     FROM algorithm_characters
     ORDER BY name, id`,
    { legacySnapshot }
  );
  const legacySituations = await queryJson(
    `SELECT id, name, description, prompt_text, required_character_ids_json,
            allowed_character_ids_json, external_id, label_scores_json,
            is_active, archived_at, created_at, updated_at
     FROM algorithm_situations
     ORDER BY name, id`,
    { legacySnapshot }
  );
  const environments = await queryJson(
    `SELECT id, name, description, prompt_text, external_id, label_scores_json,
            is_active, archived_at, created_at, updated_at
     FROM algorithm_environments
     ORDER BY name, id`,
    { legacySnapshot }
  );
  const labels = await queryJson(
    `SELECT id, name, sort_order, is_active, archived_at, created_at, updated_at
     FROM algorithm_labels
     ORDER BY sort_order, id`,
    { legacySnapshot }
  );
  const scenes = await queryJson(
    `SELECT id, title, sort_order, character_count, character_slots_json, character_ids_json,
            situation_ids_json, environment_id, environment_mode, prompt_override,
            context_scene_id, external_id, label_ids_json, is_active, archived_at,
            created_at, updated_at
     FROM algorithm_scenes
     ORDER BY sort_order, id`,
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
      adapter: "sqlite3-cli-wal-copy-checkpoint-immutable-read",
      checkpoint: legacySnapshot.checkpoint,
      tables: LEGACY_TABLES,
    },
    performers,
    characters,
    legacySituations,
    environments,
    labels,
    scenes,
  };
}

function normalizeExtension(filename) {
  return path.extname(String(filename || "")).replace(/^\./, "").toLowerCase();
}

function visibleFileName(filename) {
  const name = String(filename || "");
  return !!name && name !== ".DS_Store" && !name.startsWith("._") && !name.startsWith(".");
}

function fileItem(mediaDir, filename) {
  const absolutePath = path.join(mediaDir, filename);
  const stats = fs.statSync(absolutePath);
  if (!stats.isFile()) return null;
  return {
    filename,
    absolutePath,
    ext: normalizeExtension(filename),
    sizeBytes: stats.size,
    updatedAt: stats.mtime.toISOString(),
  };
}

function readEnvironmentAssetFiles(options = {}) {
  const mediaDir = path.resolve(options.mediaDir || environmentAssetMediaDir());
  const byBase = new Map();
  let mediaDirError = "";
  let filenames = [];

  try {
    filenames = fs.readdirSync(mediaDir);
  } catch (err) {
    mediaDirError = err && err.message ? String(err.message) : "environment_asset_media_dir_unavailable";
  }

  for (const filename of filenames) {
    if (!visibleFileName(filename)) continue;
    let item = null;
    try {
      item = fileItem(mediaDir, filename);
    } catch (_err) {
      item = null;
    }
    if (!item || !item.ext) continue;
    const base = path.basename(filename, path.extname(filename));
    if (!base) continue;
    if (!byBase.has(base)) byBase.set(base, []);
    byBase.get(base).push(item);
  }

  return {
    mediaDir,
    mediaDirError,
    byBase,
    assetTypes: ENVIRONMENT_ASSET_TYPES,
    sideBasenameTypes: FX_SIDE_BASENAME_TYPES,
  };
}

module.exports = {
  DEFAULT_LEGACY_SQLITE_PATH,
  DEFAULT_LEGACY_SNAPSHOT_DIR,
  ENVIRONMENT_ASSET_TYPES,
  LEGACY_TABLES,
  V2_ROOT,
  assertLegacySqliteSource,
  assertPathUnderV2,
  assertReadOnlySql,
  environmentAssetMediaDir,
  ensureLegacySqliteSnapshot,
  legacySnapshotDir,
  legacySqlitePath,
  queryJson,
  readEnvironmentAssetFiles,
  readLegacyCatalogRows,
};
