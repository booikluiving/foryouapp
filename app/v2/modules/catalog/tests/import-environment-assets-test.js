"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs/promises");
const path = require("node:path");

const {
  DEFAULT_MEDIA_ROOT,
  DEFAULT_STORE_PATH,
  readCatalogStore,
} = require("../write-model/catalog-store");
const { buildCatalogReadModel } = require("../read-model/build-read-model");
const { validateCatalogReadModel } = require("../validation/validate-catalog");
const { runImport } = require("../tools/import-environment-assets");

const TEST_DIR = __dirname;
const APP_ROOT = path.resolve(TEST_DIR, "../../../..");
const RUN_ID = `catalog-import-assets-${Date.now()}-${crypto.randomBytes(4).toString("hex")}`;
const TEST_ROOT = path.join(APP_ROOT, "v2", "modules", "catalog", "tests", "tmp", RUN_ID);
const SOURCE_ROOT = path.join(TEST_ROOT, "source");
const REPLACEMENT_SOURCE_ROOT = path.join(TEST_ROOT, "replacement-source");
const TEST_STORE_PATH = path.join(TEST_ROOT, "db", "catalog-store.json");
const TEST_MEDIA_ROOT = path.join(TEST_ROOT, "media");
const TEST_REPORT_DIR = path.join(TEST_ROOT, "reports");
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

async function pathExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch (_err) {
    return false;
  }
}

async function hashPathState(filePath) {
  if (!(await pathExists(filePath))) return null;
  const stats = await fs.stat(filePath);
  if (stats.isFile()) return { type: "file", sha256: await sha256(filePath) };
  if (!stats.isDirectory()) return { type: "other" };
  const files = [];

  async function walk(current) {
    const entries = await fs.readdir(current, { withFileTypes: true });
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      const absolute = path.join(current, entry.name);
      const relative = path.relative(filePath, absolute);
      if (entry.isDirectory()) {
        files.push({ type: "dir", path: relative });
        await walk(absolute);
      } else if (entry.isFile()) {
        files.push({ type: "file", path: relative, sha256: await sha256(absolute) });
      }
    }
  }

  await walk(filePath);
  return { type: "dir", files };
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

async function writeFixture(filePath, text) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, text);
}

async function createSourceFixture() {
  await writeFixture(path.join(SOURCE_ROOT, "Bioscoop.jpg"), "fake jpg background");
  await writeFixture(path.join(SOURCE_ROOT, "Bioscoop.mp3"), "fake mp3 soundscape");
  await writeFixture(path.join(SOURCE_ROOT, "Bioscoop.fx.png"), "fake png fx");
  await writeFixture(path.join(SOURCE_ROOT, "Festival.mp4"), "fake mp4 background");
  await writeFixture(path.join(SOURCE_ROOT, "Festival.fx.mp4"), "fake mp4 fx");
  await writeFixture(path.join(SOURCE_ROOT, "Cradam.txt"), "legacy prompt text");
  await writeFixture(path.join(SOURCE_ROOT, ".DS_Store"), "hidden");
  await writeFixture(path.join(SOURCE_ROOT, "._Bioscoop.jpg"), "appledouble");
  await writeFixture(path.join(SOURCE_ROOT, "Auto.jpg"), "unmatched");
  await writeFixture(path.join(SOURCE_ROOT, "Leesmij.md"), "unsupported");
  await writeFixture(path.join(SOURCE_ROOT, "NOS_Studio", "NOS_Studio.jpg"), "nested ignored");
  await writeFixture(path.join(SOURCE_ROOT, "Losse tiktoks", "Apple_Dance.mp3"), "nested ignored");
  await writeFixture(path.join(SOURCE_ROOT, "_asset-backups", "old", "Bioscoop.jpg"), "backup ignored");
  await writeFixture(path.join(SOURCE_ROOT, "_asset-upload-tmp", "staged.upload"), "tmp ignored");
}

async function createReplacementSourceFixture() {
  await writeFixture(path.join(REPLACEMENT_SOURCE_ROOT, "Bioscoop.png"), "replacement background");
}

async function cleanupTestRoot() {
  await fs.rm(TEST_ROOT, { recursive: true, force: true });
  try {
    await fs.rmdir(path.dirname(TEST_ROOT));
  } catch (err) {
    if (err.code !== "ENOENT" && err.code !== "ENOTEMPTY") throw err;
  }
}

async function main() {
  await cleanupTestRoot();
  await createSourceFixture();
  await createReplacementSourceFixture();

  const beforeHashes = await protectedHashes();
  const defaultStoreBefore = await hashPathState(DEFAULT_STORE_PATH);
  const defaultMediaBefore = await hashPathState(DEFAULT_MEDIA_ROOT);

  try {
    const dryStoreBefore = await hashPathState(TEST_STORE_PATH);
    const dryMediaBefore = await hashPathState(TEST_MEDIA_ROOT);
    const dryRun = await runImport({
      source: SOURCE_ROOT,
      reportDir: TEST_REPORT_DIR,
      storePath: TEST_STORE_PATH,
      mediaRoot: TEST_MEDIA_ROOT,
      apply: false,
    });

    assert.equal(dryRun.mode, "dry-run");
    assert.equal(dryRun.importedAssets.length, 0);
    assert.equal(dryRun.wouldImportAssets.length, 5);
    assert(dryRun.wouldImportAssets.some((item) => item.filename === "Bioscoop.jpg" && item.type === "background"));
    assert(dryRun.wouldImportAssets.some((item) => item.filename === "Bioscoop.mp3" && item.type === "soundscape"));
    assert(dryRun.wouldImportAssets.some((item) => item.filename === "Bioscoop.fx.png" && item.type === "fx"));
    assert(dryRun.wouldImportAssets.some((item) => item.filename === "Festival.mp4" && item.type === "background"));
    assert(dryRun.wouldImportAssets.some((item) => item.filename === "Festival.fx.mp4" && item.type === "fx"));
    assert(dryRun.skippedTextFiles.some((item) => item.filename === "Cradam.txt"));
    assert(dryRun.skippedHiddenFiles.some((item) => item.filename === ".DS_Store"));
    assert(dryRun.skippedHiddenFiles.some((item) => item.filename === "._Bioscoop.jpg"));
    assert(dryRun.skippedSubfolders.some((item) => item.dirname === "NOS_Studio"));
    assert(dryRun.skippedSubfolders.some((item) => item.dirname === "Losse tiktoks"));
    assert(dryRun.skippedAssetBackups.some((item) => item.dirname === "_asset-backups"));
    assert(dryRun.skippedUploadTmp.some((item) => item.dirname === "_asset-upload-tmp"));
    assert(dryRun.skippedUnsupportedFiles.some((item) => item.filename === "Leesmij.md"));
    assert(dryRun.unmatchedGroups.some((group) => group.groupName === "Auto"));
    assert(dryRun.environmentsWithoutSourceAssets.some((item) => item.environmentName === "Ballenbak"));
    assert(await pathExists(dryRun.reportPath));
    assert.deepEqual(await hashPathState(TEST_STORE_PATH), dryStoreBefore, "dry-run changed temporary V2 store");
    assert.deepEqual(await hashPathState(TEST_MEDIA_ROOT), dryMediaBefore, "dry-run wrote temporary media");

    const applyRun = await runImport({
      source: SOURCE_ROOT,
      reportDir: TEST_REPORT_DIR,
      storePath: TEST_STORE_PATH,
      mediaRoot: TEST_MEDIA_ROOT,
      apply: true,
    });
    assert.equal(applyRun.mode, "apply");
    assert.equal(applyRun.importedAssets.length, 5);
    assert.equal(applyRun.failedImports.length, 0);
    assert(await pathExists(applyRun.reportPath));
    const validationAfterImport = validateCatalogReadModel(await buildCatalogReadModel({
      storePath: TEST_STORE_PATH,
      mediaRoot: TEST_MEDIA_ROOT,
    }));
    assert(!validationAfterImport.issues.some((issue) => (
      issue.code === "media_asset_missing_files"
      && issue.refId === "environment:24"
      && /background|audio|soundscape/.test(issue.message)
    )), "V2-present imported assets should suppress legacy missing media info for Bioscoop");
    for (const imported of applyRun.importedAssets) {
      assertPathInside(TEST_MEDIA_ROOT, imported.asset.filePath);
      assert(await pathExists(imported.asset.filePath));
      assert(imported.asset.id.startsWith(`media-asset:${imported.environmentId}:${imported.asset.role || imported.type}:`));
      assert.equal(imported.asset.status, "present");
      if (imported.type === "soundscape") assert.equal(imported.asset.metadata.previewKind, "audio");
      else if (imported.type === "background") assert(["image", "video"].includes(imported.asset.metadata.previewKind));
      else assert(["image", "video"].includes(imported.asset.metadata.previewKind));
    }

    const firstStore = await readCatalogStore({ storePath: TEST_STORE_PATH });
    const oldBackground = firstStore.mediaAssets.find((asset) => (
      asset.environmentName === "Bioscoop"
      && asset.type === "background"
      && (asset.status || "present") === "present"
    ));
    assert(oldBackground, "expected imported Bioscoop background");

    const replacementRun = await runImport({
      source: REPLACEMENT_SOURCE_ROOT,
      reportDir: TEST_REPORT_DIR,
      storePath: TEST_STORE_PATH,
      mediaRoot: TEST_MEDIA_ROOT,
      apply: true,
    });
    assert.equal(replacementRun.importedAssets.length, 1);
    const finalStore = await readCatalogStore({ storePath: TEST_STORE_PATH });
    const replacedOld = finalStore.mediaAssets.find((asset) => asset.id === oldBackground.id);
    const newBackground = replacementRun.importedAssets[0].asset;
    assert.equal(replacedOld.status, "replaced");
    assert(replacedOld.backupFilePath.startsWith(path.join(TEST_MEDIA_ROOT, "_asset-backups")));
    assert(await pathExists(replacedOld.backupFilePath));
    assert.equal(newBackground.status, "present");
    assert.equal(newBackground.type, "background");
    assertPathInside(TEST_MEDIA_ROOT, newBackground.filePath);

    const afterHashes = await protectedHashes();
    assertHashesEqual(beforeHashes, afterHashes);
    assert.deepEqual(await hashPathState(DEFAULT_STORE_PATH), defaultStoreBefore, "default V2 store changed during import smoke");
    assert.deepEqual(await hashPathState(DEFAULT_MEDIA_ROOT), defaultMediaBefore, "default V2 media root changed during import smoke");

    await cleanupTestRoot();
    process.stdout.write(JSON.stringify({
      ok: true,
      dryRunWouldImport: dryRun.wouldImportAssets.length,
      applyImported: applyRun.importedAssets.length,
      replacementImported: replacementRun.importedAssets.length,
      protectedV1HashesUnchanged: true,
      defaultV2StoreUnchanged: true,
      defaultV2MediaRootUnchanged: true,
      temporaryTestRootCleaned: !(await pathExists(TEST_ROOT)),
    }, null, 2));
    process.stdout.write("\n");
  } catch (err) {
    const afterHashes = await protectedHashes();
    assertHashesEqual(beforeHashes, afterHashes);
    assert.deepEqual(await hashPathState(DEFAULT_STORE_PATH), defaultStoreBefore, "default V2 store changed during failed import smoke");
    assert.deepEqual(await hashPathState(DEFAULT_MEDIA_ROOT), defaultMediaBefore, "default V2 media root changed during failed import smoke");
    await cleanupTestRoot();
    throw err;
  }
}

main().catch((err) => {
  process.stderr.write(`${err.stack || err.message}\n`);
  process.exit(1);
});
