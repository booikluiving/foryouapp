"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs/promises");
const fsSync = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { buildCatalogReadModel } = require("../read-model/build-read-model");
const {
  DEFAULT_MEDIA_ROOT,
  DEFAULT_STORE_PATH,
  MEDIA_ASSET_CONFIG,
  catalogDbPath,
  catalogMediaRoot,
  mimeTypeFromExtension,
  readCatalogStore,
  saveMediaAssetFile,
} = require("../write-model/catalog-store");

const CATALOG_ROOT = path.resolve(__dirname, "..");
const V2_ROOT = path.resolve(__dirname, "../../..");
const APP_ROOT = V2_ROOT;
const DEFAULT_SOURCE = path.join(
  os.homedir(),
  "Dropbox",
  "For You",
  "Voorstelling",
  "Media",
  "Achtergrondjes"
);
const DEFAULT_REPORT_DIR = path.join(CATALOG_ROOT, "reports");
const PROTECTED_V1_FILES = Object.freeze([
  path.join(APP_ROOT, "legacy", "data", "live.sqlite"),
  path.join(APP_ROOT, "legacy", "data", "live.sqlite-wal"),
  path.join(APP_ROOT, "legacy", "data", "live.sqlite-shm"),
]);
const TYPE_ORDER = Object.freeze(["background", "soundscape", "fx"]);
const TAGS_BY_TYPE = Object.freeze({
  background: Object.freeze(["background"]),
  soundscape: Object.freeze(["audio", "soundscape"]),
  fx: Object.freeze(["fx"]),
});

function assertPathUnderV2(targetPath) {
  const resolved = path.resolve(targetPath);
  const relative = path.relative(V2_ROOT, resolved);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`catalog_import_path_outside_v2:${resolved}`);
  }
  return resolved;
}

function timestampId(date = new Date()) {
  return date.toISOString().replace(/[-:.]/g, "").replace("T", "-").replace("Z", "Z");
}

async function sha256File(filePath) {
  const data = await fs.readFile(filePath);
  return crypto.createHash("sha256").update(data).digest("hex");
}

async function protectedV1Hashes() {
  const entries = [];
  for (const filePath of PROTECTED_V1_FILES) {
    entries.push([filePath, await sha256File(filePath)]);
  }
  return Object.fromEntries(entries);
}

function hashesUnchanged(before, after) {
  return PROTECTED_V1_FILES.every((filePath) => before[filePath] === after[filePath]);
}

async function pathExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch (_err) {
    return false;
  }
}

async function countFiles(rootPath) {
  let count = 0;
  const samples = [];

  async function walk(current) {
    const entries = await fs.readdir(current, { withFileTypes: true });
    entries.sort((a, b) => a.name.localeCompare(b.name, "nl"));
    for (const entry of entries) {
      const absolutePath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        await walk(absolutePath);
        continue;
      }
      if (!entry.isFile()) continue;
      count += 1;
      if (samples.length < 50) samples.push(path.relative(rootPath, absolutePath));
    }
  }

  await walk(rootPath);
  return { fileCount: count, sampleFiles: samples };
}

async function v2MediaCounts(options = {}) {
  const store = await readCatalogStore(options);
  return {
    dbPath: catalogDbPath(options),
    storePath: path.resolve(options.storePath || process.env.V2_CATALOG_STORE_PATH || DEFAULT_STORE_PATH),
    mediaRoot: path.resolve(options.mediaRoot || process.env.V2_CATALOG_MEDIA_ROOT || DEFAULT_MEDIA_ROOT),
    storeMediaAssets: (store.mediaAssets || []).length,
    presentStoreMediaAssets: (store.mediaAssets || []).filter((asset) => asset.status === "present").length,
    replacedStoreMediaAssets: (store.mediaAssets || []).filter((asset) => asset.status === "replaced").length,
  };
}

function extensionFromFilename(filename) {
  return path.extname(String(filename || "")).replace(/^\./, "").toLowerCase();
}

function isHiddenName(name) {
  const text = String(name || "");
  return !text || text === ".DS_Store" || text.startsWith(".");
}

function classifyTopLevelFile(filename) {
  const extension = extensionFromFilename(filename);
  const rawBase = path.basename(filename, path.extname(filename));
  if (!rawBase || !extension) return { skipped: "unsupported", extension, groupName: rawBase };
  if (extension === "txt") return { skipped: "text", extension, groupName: rawBase };

  const isFxSidecar = rawBase.endsWith(".fx");
  const groupName = isFxSidecar ? rawBase.slice(0, -3) : rawBase;
  const backgroundExtensions = new Set(MEDIA_ASSET_CONFIG.background.extensions);
  const soundscapeExtensions = new Set(MEDIA_ASSET_CONFIG.soundscape.extensions);
  const fxExtensions = new Set(MEDIA_ASSET_CONFIG.fx.extensions);

  if (isFxSidecar) {
    return fxExtensions.has(extension)
      ? { type: "fx", extension, groupName }
      : { skipped: "unsupported", extension, groupName };
  }
  if (backgroundExtensions.has(extension)) return { type: "background", extension, groupName };
  if (soundscapeExtensions.has(extension)) return { type: "soundscape", extension, groupName };
  if (fxExtensions.has(extension)) return { type: "fx", extension, groupName };
  return { skipped: "unsupported", extension, groupName };
}

function environmentMap(readModel) {
  return new Map((readModel.environments || []).map((environment) => [environment.name, environment]));
}

function candidateSort(a, b) {
  return a.groupName.localeCompare(b.groupName, "nl")
    || TYPE_ORDER.indexOf(a.type) - TYPE_ORDER.indexOf(b.type)
    || a.filename.localeCompare(b.filename, "nl");
}

function pushGroup(map, groupName, item) {
  if (!map.has(groupName)) map.set(groupName, { groupName, files: [] });
  map.get(groupName).files.push(item);
}

async function scanSourceDirectory(sourceDir, readModel) {
  const resolvedSource = path.resolve(sourceDir);
  const envByName = environmentMap(readModel);
  const entries = await fs.readdir(resolvedSource, { withFileTypes: true });
  entries.sort((a, b) => a.name.localeCompare(b.name, "nl"));

  const candidates = [];
  const unmatchedGroups = new Map();
  const skippedTextFiles = [];
  const skippedHiddenFiles = [];
  const skippedUnsupportedFiles = [];
  const skippedSubfolders = [];
  const skippedAssetBackups = [];
  const skippedUploadTmp = [];

  for (const entry of entries) {
    const absolutePath = path.join(resolvedSource, entry.name);
    if (isHiddenName(entry.name)) {
      skippedHiddenFiles.push({ filename: entry.name });
      continue;
    }
    if (entry.isDirectory()) {
      const summary = {
        dirname: entry.name,
        ...(await countFiles(absolutePath)),
      };
      if (entry.name === "_asset-backups") skippedAssetBackups.push(summary);
      else if (entry.name === "_asset-upload-tmp") skippedUploadTmp.push(summary);
      else skippedSubfolders.push(summary);
      continue;
    }
    if (!entry.isFile()) {
      skippedUnsupportedFiles.push({ filename: entry.name, reason: "not_file" });
      continue;
    }

    const stats = await fs.stat(absolutePath);
    const classification = classifyTopLevelFile(entry.name);
    const item = {
      filename: entry.name,
      sourcePath: absolutePath,
      extension: classification.extension,
      groupName: classification.groupName,
      sizeBytes: stats.size,
      updatedAt: stats.mtime.toISOString(),
    };

    if (classification.skipped === "text") {
      skippedTextFiles.push(item);
      continue;
    }
    if (classification.skipped) {
      skippedUnsupportedFiles.push({ ...item, reason: classification.skipped });
      continue;
    }

    const environment = envByName.get(classification.groupName);
    if (!environment) {
      pushGroup(unmatchedGroups, classification.groupName, {
        ...item,
        type: classification.type,
      });
      continue;
    }

    candidates.push({
      ...item,
      type: classification.type,
      environmentId: environment.id,
      environmentName: environment.name,
      environmentStatus: environment.status,
    });
  }

  candidates.sort(candidateSort);

  const matchedEnvironmentNames = new Set(candidates.map((candidate) => candidate.environmentName));
  const environmentsWithoutSourceAssets = (readModel.environments || [])
    .filter((environment) => environment.active && !environment.archivedAt)
    .filter((environment) => !matchedEnvironmentNames.has(environment.name))
    .map((environment) => ({
      environmentId: environment.id,
      environmentName: environment.name,
    }));

  return {
    sourceDir: resolvedSource,
    importCandidates: candidates,
    skippedTextFiles,
    skippedHiddenFiles,
    skippedUnsupportedFiles,
    skippedAssetBackups,
    skippedUploadTmp,
    skippedSubfolders,
    unmatchedGroups: Array.from(unmatchedGroups.values())
      .sort((a, b) => a.groupName.localeCompare(b.groupName, "nl")),
    environmentsWithoutSourceAssets,
  };
}

async function stageImportFile(candidate, options = {}) {
  const mediaRoot = catalogMediaRoot(options);
  const tempDir = assertPathUnderV2(path.join(mediaRoot, "_asset-import-tmp"));
  await fs.mkdir(tempDir, { recursive: true });
  const tempPath = assertPathUnderV2(path.join(
    tempDir,
    `${Date.now()}-${crypto.randomBytes(8).toString("hex")}.${candidate.extension}.import`
  ));
  await fs.copyFile(candidate.sourcePath, tempPath, fsSync.constants.COPYFILE_EXCL);
  return tempPath;
}

async function cleanupImportTmp(options = {}) {
  const tempDir = assertPathUnderV2(path.join(catalogMediaRoot(options), "_asset-import-tmp"));
  try {
    await fs.rmdir(tempDir);
  } catch (err) {
    if (err.code !== "ENOENT" && err.code !== "ENOTEMPTY") throw err;
  }
}

async function importCandidates(candidates, readModel, options = {}) {
  const importedAssets = [];
  const failedImports = [];

  for (const candidate of candidates) {
    let tempPath = "";
    try {
      tempPath = await stageImportFile(candidate, options);
      const asset = await saveMediaAssetFile({
        tempPath,
        environmentId: candidate.environmentId,
        type: candidate.type,
        originalFilename: candidate.filename,
        mimeType: mimeTypeFromExtension(candidate.extension),
        sizeBytes: candidate.sizeBytes,
        tags: TAGS_BY_TYPE[candidate.type] || [],
      }, readModel, options);
      tempPath = "";
      importedAssets.push({
        sourcePath: candidate.sourcePath,
        environmentId: candidate.environmentId,
        environmentName: candidate.environmentName,
        type: candidate.type,
        asset,
      });
    } catch (err) {
      if (tempPath) {
        try { await fs.unlink(tempPath); } catch (_unlinkErr) {}
      }
      failedImports.push({
        sourcePath: candidate.sourcePath,
        environmentId: candidate.environmentId,
        environmentName: candidate.environmentName,
        type: candidate.type,
        error: err && err.message ? err.message : String(err),
        issues: err && Array.isArray(err.issues) ? err.issues : [],
      });
    }
  }

  await cleanupImportTmp(options);
  return { importedAssets, failedImports };
}

async function writeReport(report, reportDir) {
  const resolvedReportDir = assertPathUnderV2(reportDir || DEFAULT_REPORT_DIR);
  await fs.mkdir(resolvedReportDir, { recursive: true });
  const filePath = assertPathUnderV2(path.join(
    resolvedReportDir,
    `environment-assets-import-${timestampId(new Date(report.createdAt))}.json`
  ));
  await fs.writeFile(filePath, `${JSON.stringify({ ...report, reportPath: filePath }, null, 2)}\n`, "utf8");
  return filePath;
}

async function runImport(rawOptions = {}) {
  const sourceDir = path.resolve(rawOptions.source || DEFAULT_SOURCE);
  if (!(await pathExists(sourceDir))) throw new Error(`source_dir_missing:${sourceDir}`);
  const mode = rawOptions.apply ? "apply" : "dry-run";
  const options = {
    dbPath: rawOptions.dbPath,
    storePath: rawOptions.storePath,
    mediaRoot: rawOptions.mediaRoot,
  };
  const createdAt = new Date().toISOString();
  const beforeV1Hashes = await protectedV1Hashes();
  const beforeV2MediaCounts = await v2MediaCounts(options);
  const readModelBefore = await buildCatalogReadModel(options);
  const scan = await scanSourceDirectory(sourceDir, readModelBefore);
  const importResult = rawOptions.apply
    ? await importCandidates(scan.importCandidates, readModelBefore, options)
    : { importedAssets: [], failedImports: [] };
  const readModelAfter = rawOptions.apply ? await buildCatalogReadModel(options) : readModelBefore;
  const afterV2MediaCounts = await v2MediaCounts(options);
  const afterV1Hashes = await protectedV1Hashes();

  const report = {
    ok: importResult.failedImports.length === 0,
    mode,
    createdAt,
    sourceDir,
    dbPath: beforeV2MediaCounts.dbPath,
    storePath: beforeV2MediaCounts.storePath,
    mediaRoot: beforeV2MediaCounts.mediaRoot,
    beforeV1Hashes,
    afterV1Hashes,
    protectedV1HashesUnchanged: hashesUnchanged(beforeV1Hashes, afterV1Hashes),
    beforeV2MediaCounts,
    afterV2MediaCounts,
    readModelCountsBefore: readModelBefore.counts,
    readModelCountsAfter: readModelAfter.counts,
    wouldImportAssets: scan.importCandidates,
    importedAssets: importResult.importedAssets,
    failedImports: importResult.failedImports,
    skippedTextFiles: scan.skippedTextFiles,
    skippedHiddenFiles: scan.skippedHiddenFiles,
    skippedUnsupportedFiles: scan.skippedUnsupportedFiles,
    skippedAssetBackups: scan.skippedAssetBackups,
    skippedUploadTmp: scan.skippedUploadTmp,
    skippedSubfolders: scan.skippedSubfolders,
    unmatchedGroups: scan.unmatchedGroups,
    environmentsWithoutSourceAssets: scan.environmentsWithoutSourceAssets,
  };
  report.reportPath = await writeReport(report, rawOptions.reportDir || process.env.V2_CATALOG_REPORT_DIR || DEFAULT_REPORT_DIR);
  return report;
}

function parseArgs(argv) {
  const options = {
    source: DEFAULT_SOURCE,
    apply: false,
    reportDir: process.env.V2_CATALOG_REPORT_DIR || DEFAULT_REPORT_DIR,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--help" || arg === "-h") {
      options.help = true;
    } else if (arg === "--source") {
      options.source = argv[++index];
    } else if (arg === "--report-dir") {
      options.reportDir = argv[++index];
    } else if (arg === "--store") {
      options.storePath = argv[++index];
    } else if (arg === "--media-root") {
      options.mediaRoot = argv[++index];
    } else if (arg === "--dry-run") {
      options.apply = false;
    } else if (arg === "--apply") {
      options.apply = true;
    } else {
      throw new Error(`unknown_argument:${arg}`);
    }
  }

  return options;
}

function usage() {
  return [
    "Usage: node modules/catalog/tools/import-environment-assets.js [--dry-run|--apply] [--source DIR]",
    "",
    "Defaults:",
    `  --source ${DEFAULT_SOURCE}`,
    `  --report-dir ${DEFAULT_REPORT_DIR}`,
    "",
    "Test-only overrides:",
    "  --store PATH",
    "  --media-root PATH",
  ].join("\n");
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    process.stdout.write(`${usage()}\n`);
    return;
  }
  const report = await runImport(options);
  process.stdout.write(JSON.stringify({
    ok: report.ok,
    mode: report.mode,
    reportPath: report.reportPath,
    sourceDir: report.sourceDir,
    wouldImport: report.wouldImportAssets.length,
    imported: report.importedAssets.length,
    failed: report.failedImports.length,
    skippedText: report.skippedTextFiles.length,
    skippedHidden: report.skippedHiddenFiles.length,
    skippedSubfolders: report.skippedSubfolders.length,
    skippedAssetBackups: report.skippedAssetBackups.length,
    unmatchedGroups: report.unmatchedGroups.map((group) => group.groupName),
    environmentsWithoutSourceAssets: report.environmentsWithoutSourceAssets.map((environment) => environment.environmentName),
    protectedV1HashesUnchanged: report.protectedV1HashesUnchanged,
  }, null, 2));
  process.stdout.write("\n");
  if (!report.ok) process.exitCode = 1;
}

if (require.main === module) {
  main().catch((err) => {
    process.stderr.write(`${err.stack || err.message}\n`);
    process.exit(1);
  });
}

module.exports = {
  DEFAULT_SOURCE,
  classifyTopLevelFile,
  runImport,
  scanSourceDirectory,
};
