"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs/promises");
const net = require("node:net");
const path = require("node:path");
const { spawn } = require("node:child_process");

const { V2_ROOT } = require("../snapshots/snapshot-store");
const {
  DEFAULT_DB_PATH,
  DEFAULT_MEDIA_ROOT,
  DEFAULT_STORE_PATH,
  readCatalogStore,
} = require("../write-model/catalog-store");
const { importLegacyCatalog } = require("../tools/import-legacy-catalog");

const TEST_DIR = __dirname;
const APP_ROOT = path.resolve(TEST_DIR, "../../..");
let PORT = 3021;
const RUN_ID = `catalog-composition-editor-${Date.now()}-${crypto.randomBytes(4).toString("hex")}`;
const TEST_ROOT = path.join(APP_ROOT, "modules", "catalog", "tests", "tmp", RUN_ID);
const TEST_DB_PATH = path.join(TEST_ROOT, "db", "catalog.sqlite");
const TEST_MEDIA_ROOT = path.join(TEST_ROOT, "media");
const TEST_SNAPSHOT_DIR = path.join(TEST_ROOT, "snapshots");
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

async function assertNoDefaultPollution() {
  if (await pathExists(DEFAULT_STORE_PATH)) {
    const storeText = await fs.readFile(DEFAULT_STORE_PATH, "utf8");
    assert(!/composition-editor-test|flattened-test|test-bg-video|test-fx-video|test-fx-image/i.test(storeText), "default V2 store contains composition test records");
  }
  if (await pathExists(DEFAULT_MEDIA_ROOT)) {
    const mediaState = JSON.stringify(await hashPathState(DEFAULT_MEDIA_ROOT));
    assert(!/composition-editor-test|flattened-test|test-bg-video|test-fx-video|test-fx-image/i.test(mediaState), "default V2 media root contains composition test media");
  }
}

async function cleanupTestRoot() {
  await fs.rm(TEST_ROOT, { recursive: true, force: true });
  try {
    await fs.rmdir(path.dirname(TEST_ROOT));
  } catch (err) {
    if (err.code !== "ENOENT" && err.code !== "ENOTEMPTY") throw err;
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

async function fetchText(pathname) {
  const response = await fetch(`http://127.0.0.1:${PORT}${pathname}`);
  const text = await response.text();
  if (!response.ok) throw new Error(`${pathname} returned ${response.status}: ${text}`);
  return text;
}

async function fetchJson(pathname, options) {
  const response = await fetch(`http://127.0.0.1:${PORT}${pathname}`, options);
  const body = await response.json();
  if (!response.ok) {
    const err = new Error(`${pathname} returned ${response.status}: ${JSON.stringify(body)}`);
    err.status = response.status;
    err.body = body;
    throw err;
  }
  return body;
}

async function waitForHealth(child, logs) {
  const deadline = Date.now() + 8000;
  while (Date.now() < deadline) {
    if (child.exitCode != null) throw new Error(`Catalog server exited early (${child.exitCode}): ${logs.join("")}`);
    try {
      const health = await fetchJson("/health");
      if (health.ok && health.service === "catalog") return health;
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

function jsonOptions(method, body) {
  return {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  };
}

async function expectBadRequest(pathname, options, code) {
  try {
    await fetchJson(pathname, options);
  } catch (err) {
    assert.equal(err.status, 400);
    assert((err.body.issues || []).some((item) => item.code === code), `Expected issue ${code}`);
    return err.body;
  }
  throw new Error(`${pathname} should have failed`);
}

async function uploadAsset({ environmentId, type, role, filename, mimeType, bytes, tags = [], replaceTags = [] }) {
  const form = new FormData();
  form.set("environmentId", environmentId);
  form.set("type", type);
  if (role) form.set("role", role);
  form.set("tags", tags.join(","));
  if (replaceTags.length) form.set("replaceTags", replaceTags.join(","));
  form.set("asset", new Blob([bytes], { type: mimeType }), filename);
  return fetchJson("/v0/catalog/media-assets/upload", {
    method: "POST",
    body: form,
  });
}

async function main() {
  PORT = await findFreePort();
  await assertPortFree(PORT);
  await assertNoDefaultPollution();
  const beforeHashes = await protectedHashes();
  const defaultStoreBefore = await hashPathState(DEFAULT_STORE_PATH);
  const defaultDbBefore = await hashPathState(DEFAULT_DB_PATH);
  const defaultMediaBefore = await hashPathState(DEFAULT_MEDIA_ROOT);
  await importLegacyCatalog({
    dbPath: TEST_DB_PATH,
    jsonStorePath: path.join(TEST_ROOT, "missing-catalog-store.json"),
  });
  const logs = [];
  const child = spawn(process.execPath, [path.resolve(TEST_DIR, "../server/server.js")], {
    cwd: APP_ROOT,
    env: {
      ...process.env,
      CATALOG_PORT: String(PORT),
      V2_CATALOG_DB_PATH: TEST_DB_PATH,
      V2_CATALOG_MEDIA_ROOT: TEST_MEDIA_ROOT,
      V2_CATALOG_SNAPSHOT_DIR: TEST_SNAPSHOT_DIR,
      V2_CATALOG_LEGACY_SQLITE_PATH: "/missing.sqlite",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout.on("data", (chunk) => logs.push(String(chunk)));
  child.stderr.on("data", (chunk) => logs.push(String(chunk)));

  try {
    await waitForHealth(child, logs);

    const mediaHtml = await fetchText("/catalog/media-assets/");
    const mediaJs = await fetchText("/catalog/media-assets/app.js");
    const catalogCss = await fetchText("/catalog/styles.css");
    assert(mediaHtml.includes("/shared/ui/foryou-v2.css"));
    assert(mediaJs.includes("aspectRatio: \"27:16\""));
    assert(mediaJs.includes("canvasWidth: 6480"));
    assert(mediaJs.includes("canvasHeight: 3840"));
    assert(!mediaJs.includes("Maak output-PNG"));
    assert(!mediaJs.includes("data-flatten-images"));
    assert(mediaJs.includes("createOutputPng"));
    assert(mediaJs.includes("lock.svg"));
    assert(!mediaJs.includes("Opgeslagen. Output-PNG bijgewerkt."));
    assert(mediaJs.includes("replaceTags"));
    assert(mediaJs.includes("Niet in compositie"));
    assert(mediaJs.includes("renderInactiveAssetPanel"));
    assert(mediaJs.includes("Uit compositie"));
    assert(mediaJs.includes("Verwijder definitief"));
    assert(mediaJs.includes("data-asset-action"));
    assert(mediaJs.includes("deleteMediaAssetFromEditor"));
    assert(!mediaJs.includes("> Zichtbaar</label>"));
    assert(mediaJs.includes("rendered-output"));
    assert(mediaJs.includes("td-output"));
    assert(mediaJs.includes("isRenderedOutputAsset"));
    assert(mediaJs.includes("addToDraft: false"));
    assert(mediaJs.includes("Originele PNG-lagen blijven bewerkbaar"));
    assert(!mediaJs.includes("const flatLayer"));
    assert(mediaJs.includes("saveState"));
    assert(mediaJs.includes("Bewerkt"));
    assert(mediaJs.includes("data-toggle-guides"));
    assert(mediaJs.includes("data-toggle-people"));
    assert(mediaJs.includes("renderPeopleOverlay"));
    assert(mediaJs.includes("ghost-standin.png"));
    assert(!mediaJs.includes("data-toggle-video"));
    assert(mediaJs.includes("renderEditorPlayback"));
    assert(mediaJs.includes("preload=\"metadata\""));
    assert(mediaJs.includes("data-video-poster"));
    assert(mediaJs.includes("captureVideoPoster"));
    assert(mediaJs.includes("processVideoPosterQueue"));
    assert(mediaJs.includes("IntersectionObserver"));
    assert(mediaJs.includes("data-save-composition"));
    assert(mediaJs.includes("data-close-editor"));
    assert(mediaJs.includes("data-open-environment"));
    assert(mediaJs.includes("data-canvas-drop"));
    assert(mediaJs.includes("editorUploadStrip"));
    assert(mediaJs.includes("data-layer-row"));
    assert(mediaJs.includes("layerDragHandle"));
    assert(mediaJs.includes("layerLockIcon"));
    assert(mediaJs.includes("renderLightingPanel"));
    assert(mediaJs.includes("data-lighting-field"));
    assert(mediaJs.includes("Lamp 4-9 blijven frontlicht"));
    assert(mediaJs.includes("reorderLayer"));
    assert(mediaJs.includes("imageDimensionsFromFile"));
    assert(mediaJs.includes("event.shiftKey"));
    assert(mediaJs.includes("pointerdown"));
    assert(mediaJs.includes("toBlob"));
    assert(mediaJs.includes("role: \"fxVideo\""));
    assert(mediaJs.includes("role: \"fxImage\""));
    assert(catalogCss.includes("aspect-ratio: 27 / 16"));
    assert(catalogCss.includes(".compositionGuides"));
    assert(catalogCss.includes(".compositionPeople"));
    assert(catalogCss.includes(".ghostStandIn"));
    assert(catalogCss.includes("z-index: 5"));
    assert(catalogCss.includes(".compositionEditor"));
    assert(catalogCss.includes(".editorPlayback"));
    assert(catalogCss.includes(".mediaPlaybackRow"));
    assert(catalogCss.includes(".videoPoster"));
    assert(catalogCss.includes("mix-blend-mode: screen"));
    assert(catalogCss.includes(".editorUploadStrip"));
    assert(catalogCss.includes(".layerDragHandle"));
    assert(catalogCss.includes(".layerLockIcon"));
    assert(catalogCss.includes(".inactiveAssetList"));
    assert(catalogCss.includes(".inactiveAssetItem"));
    assert(catalogCss.includes(".inactiveAssetsPanel summary"));
    assert(catalogCss.includes(".lightingPanel"));
    assert(catalogCss.includes(".lightingFixtureRow"));
    assert(!catalogCss.includes(".layerLockIcon::before"));
    assert(!catalogCss.includes(".layerLockIcon::after"));

    const initial = await fetchJson("/v0/catalog/read-model");
    const environment = initial.environments.find((item) => item.active && !item.archivedAt);
    assert(environment, "fixture requires an active environment");
    assert(initial.lightingPresets.some((preset) => preset.id === "studio-neutral"), "read-model should include default lighting presets");
    const lightingPresets = await fetchJson("/v0/catalog/lighting-presets");
    assert(lightingPresets.lightingPresets.some((preset) => preset.id === "neutral-dim"), "lighting preset API should expose neutral-dim");
    const festivalPreset = (await fetchJson("/v0/catalog/lighting-presets/festival-color", jsonOptions("PUT", {
      name: "Festival / kleur",
      category: "Kleur",
      fixtures: {
        lamp1: { hue: 315, saturation: 170, intensity: 131 },
        lamp2: { hue: 34, saturation: 180, intensity: 144 },
        lamp3: { hue: 205, saturation: 170, intensity: 121 },
      },
    }))).preset;
    assert.equal(festivalPreset.id, "festival-color");
    assert.equal(festivalPreset.fixtures.lamp2.intensity, 144);

    const bgVideo = (await uploadAsset({
      environmentId: environment.id,
      type: "background",
      role: "background",
      filename: "composition-editor-test-bg-video.mp4",
      mimeType: "video/mp4",
      bytes: Buffer.from("fake mp4 background"),
      tags: ["test", "background"],
    })).asset;
    assert.equal(bgVideo.type, "background");
    assert.equal(bgVideo.role, "background");
    assert.equal(bgVideo.metadata.previewKind, "video");
    assertPathInside(V2_ROOT, bgVideo.filePath);
    assertPathInside(TEST_MEDIA_ROOT, bgVideo.filePath);

    const oldFxVideo = (await uploadAsset({
      environmentId: environment.id,
      type: "fx",
      role: "fxVideo",
      filename: "composition-editor-test-fx-video.mp4",
      mimeType: "video/mp4",
      bytes: Buffer.from("fake mp4 fx one"),
      tags: ["test", "fx", "video"],
    })).asset;
    const fxVideo = (await uploadAsset({
      environmentId: environment.id,
      type: "fx",
      role: "fxVideo",
      filename: "composition-editor-test-fx-video-replacement.webm",
      mimeType: "video/webm",
      bytes: Buffer.from("fake webm fx two"),
      tags: ["test", "fx", "video", "replacement"],
    })).asset;
    assert.equal(fxVideo.role, "fxVideo");

    const pngBytes = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=", "base64");
    const imageOne = (await uploadAsset({
      environmentId: environment.id,
      type: "fx",
      role: "fxImage",
      filename: "composition-editor-test-fx-image-one.png",
      mimeType: "image/png",
      bytes: pngBytes,
      tags: ["test", "fx", "image"],
    })).asset;
    const imageTwo = (await uploadAsset({
      environmentId: environment.id,
      type: "fx",
      role: "fxImage",
      filename: "composition-editor-test-fx-image-two.png",
      mimeType: "image/png",
      bytes: pngBytes,
      tags: ["test", "fx", "image"],
    })).asset;
    assert.equal(imageOne.role, "fxImage");
    assert.equal(imageTwo.role, "fxImage");

    const storeAfterUploads = await readCatalogStore({ dbPath: TEST_DB_PATH });
    const replacedFxVideo = storeAfterUploads.mediaAssets.find((asset) => asset.id === oldFxVideo.id);
    assert.equal(replacedFxVideo.status, "replaced");
    assert(replacedFxVideo.backupFilePath.startsWith(path.join(TEST_MEDIA_ROOT, "_asset-backups")));
    const presentFxImages = storeAfterUploads.mediaAssets.filter((asset) => asset.role === "fxImage" && asset.status !== "replaced");
    assert.equal(presentFxImages.length, 2, "fxImage uploads should be additive");

    const outputOne = (await uploadAsset({
      environmentId: environment.id,
      type: "fx",
      role: "fxImage",
      filename: "composition-editor-output-one.png",
      mimeType: "image/png",
      bytes: pngBytes,
      tags: ["test", "fx", "image", "rendered-output", "td-output"],
      replaceTags: ["rendered-output", "td-output"],
    })).asset;
    const outputTwo = (await uploadAsset({
      environmentId: environment.id,
      type: "fx",
      role: "fxImage",
      filename: "composition-editor-output-two.png",
      mimeType: "image/png",
      bytes: pngBytes,
      tags: ["test", "fx", "image", "rendered-output", "td-output"],
      replaceTags: ["rendered-output", "td-output"],
    })).asset;
    const storeAfterOutputs = await readCatalogStore({ dbPath: TEST_DB_PATH });
    const replacedOutput = storeAfterOutputs.mediaAssets.find((asset) => asset.id === outputOne.id);
    assert.equal(replacedOutput.status, "replaced", "new output render should replace the previous output render");
    assert(replacedOutput.backupFilePath.startsWith(path.join(TEST_MEDIA_ROOT, "_asset-backups")));
    assert(storeAfterOutputs.mediaAssets.some((asset) => asset.id === outputTwo.id && asset.status !== "replaced"));
    assert(storeAfterOutputs.mediaAssets.some((asset) => asset.id === imageOne.id && asset.status !== "replaced"));
    assert(storeAfterOutputs.mediaAssets.some((asset) => asset.id === imageTwo.id && asset.status !== "replaced"));
    await expectBadRequest(`/v0/catalog/media-assets/${encodeURIComponent(outputTwo.id)}`, { method: "DELETE" }, "media_asset_output_delete_forbidden");

    const inactiveImage = (await uploadAsset({
      environmentId: environment.id,
      type: "fx",
      role: "fxImage",
      filename: "composition-editor-delete-me.png",
      mimeType: "image/png",
      bytes: pngBytes,
      tags: ["test", "fx", "image"],
    })).asset;
    await fs.access(inactiveImage.filePath);
    const deletedImage = await fetchJson(`/v0/catalog/media-assets/${encodeURIComponent(inactiveImage.id)}`, { method: "DELETE" });
    assert.equal(deletedImage.asset.status, "deleted");
    assert(!(await pathExists(inactiveImage.filePath)), "deleted media file should be removed from the V2 media root");
    const storeAfterDelete = await readCatalogStore({ dbPath: TEST_DB_PATH });
    assert(storeAfterDelete.mediaAssets.some((asset) => asset.id === inactiveImage.id && asset.status === "deleted"));
    assert(storeAfterDelete.mediaAssets.some((asset) => asset.id === imageOne.id && asset.status !== "deleted"));
    assert(storeAfterDelete.mediaAssets.some((asset) => asset.id === imageTwo.id && asset.status !== "deleted"));

    const compositionPayload = {
      guidesVisible: true,
      backgroundLayer: {
        assetId: bgVideo.id,
        x: -120,
        y: 0,
        width: 6600,
        height: 3911,
        rotationDeg: 1.5,
        opacity: 1,
        zIndex: 0,
      },
      fxVideoLayer: {
        assetId: fxVideo.id,
        x: 0,
        y: 0,
        width: 6480,
        height: 3840,
        rotationDeg: 0,
        opacity: 0.7,
        zIndex: 10,
      },
      imageLayers: [
        {
          assetId: imageOne.id,
          name: "composition-editor-test-png-1",
          x: 216,
          y: 300,
          width: 1200,
          height: 900,
          rotationDeg: -3,
          opacity: 0.8,
          zIndex: 21,
          visible: false,
        },
        {
          assetId: imageTwo.id,
          name: "flattened-test-source",
          x: 3200,
          y: 400,
          width: 1000,
          height: 800,
          rotationDeg: 7,
          opacity: 1,
          zIndex: 22,
          visible: true,
        },
      ],
      lighting: {
        mode: "preset",
        presetId: "festival-color",
        stopBehavior: "neutral-dim",
      },
    };
    const saved = await fetchJson(`/v0/catalog/media-compositions/${encodeURIComponent(environment.id)}`, jsonOptions("PUT", compositionPayload));
    assert.equal(saved.composition.canvas.canvasWidth, 6480);
    assert.equal(saved.composition.canvas.canvasHeight, 3840);
    assert.equal(saved.composition.canvas.aspectRatio, "27:16");
    assert.equal(saved.composition.imageLayers.length, 2);
    assert.equal(saved.composition.lighting.presetId, "festival-color");
    assert.equal(saved.composition.lighting.stopBehavior, "neutral-dim");

    await expectBadRequest(`/v0/catalog/media-compositions/${encodeURIComponent(environment.id)}`, jsonOptions("PUT", {
      backgroundLayer: { assetId: imageOne.id },
    }), "composition_asset_role_mismatch");

    const mediaResponse = await fetchJson("/v0/catalog/media-assets");
    assert(mediaResponse.environmentCompositions.some((item) => item.environmentId === environment.id));
    assert(mediaResponse.lightingPresets.some((preset) => preset.id === "festival-color" && preset.fixtures.lamp2.intensity === 144));
    const readModel = await fetchJson("/v0/catalog/read-model");
    assert(readModel.environmentCompositions.some((item) => item.environmentId === environment.id && item.lighting.presetId === "festival-color"));
    assert(readModel.lightingPresets.some((preset) => preset.id === "festival-color" && preset.fixtures.lamp2.intensity === 144));
    const snapshotResult = await fetchJson("/v0/catalog/snapshots", { method: "POST" });
    const snapshot = JSON.parse(await fs.readFile(snapshotResult.filePath, "utf8"));
    assert(snapshot.catalog.environmentCompositions.some((item) => item.environmentId === environment.id && item.lighting.presetId === "festival-color"));
    assert(snapshot.catalog.lightingPresets.some((preset) => preset.id === "festival-color" && preset.fixtures.lamp2.intensity === 144));

    await stopChild(child);
    const afterHashes = await protectedHashes();
    assertHashesEqual(beforeHashes, afterHashes);
    assert.deepEqual(await hashPathState(DEFAULT_STORE_PATH), defaultStoreBefore, "default V2 store changed during composition smoke");
    assert.deepEqual(await hashPathState(DEFAULT_DB_PATH), defaultDbBefore, "default V2 catalog db changed during composition smoke");
    assert.deepEqual(await hashPathState(DEFAULT_MEDIA_ROOT), defaultMediaBefore, "default V2 media root changed during composition smoke");
    await assertNoDefaultPollution();
    await cleanupTestRoot();

    process.stdout.write(JSON.stringify({
      ok: true,
      port: PORT,
      environmentId: environment.id,
      backgroundVideoAssetId: bgVideo.id,
      fxVideoAssetId: fxVideo.id,
      fxImageAssetIds: [imageOne.id, imageTwo.id],
      compositionEnvironmentId: saved.composition.environmentId,
      snapshotId: snapshotResult.snapshotId,
      protectedV1HashesUnchanged: true,
      defaultV2StoreUnchanged: true,
      defaultV2MediaRootUnchanged: true,
      temporaryTestRootCleaned: true,
    }, null, 2));
    process.stdout.write("\n");
  } catch (err) {
    await stopChild(child);
    const afterHashes = await protectedHashes();
    assertHashesEqual(beforeHashes, afterHashes);
    assert.deepEqual(await hashPathState(DEFAULT_STORE_PATH), defaultStoreBefore, "default V2 store changed during failed composition smoke");
    assert.deepEqual(await hashPathState(DEFAULT_DB_PATH), defaultDbBefore, "default V2 catalog db changed during failed composition smoke");
    assert.deepEqual(await hashPathState(DEFAULT_MEDIA_ROOT), defaultMediaBefore, "default V2 media root changed during failed composition smoke");
    await cleanupTestRoot();
    throw err;
  }
}

main().catch((err) => {
  console.error(err && err.stack || err);
  process.exit(1);
});
