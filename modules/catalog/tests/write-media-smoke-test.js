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
const RUN_ID = `catalog-write-media-${Date.now()}-${crypto.randomBytes(4).toString("hex")}`;
const TEST_ROOT = path.join(APP_ROOT, "modules", "catalog", "tests", "tmp", RUN_ID);
const TEST_DB_PATH = path.join(TEST_ROOT, "db", "catalog.sqlite");
const TEST_MEDIA_ROOT = path.join(TEST_ROOT, "media");
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
    assert(!/V2 Test|test-background|test-soundscape|V2 Conflict/.test(storeText), "default V2 store contains test records");
  }
  if (await pathExists(DEFAULT_MEDIA_ROOT)) {
    const mediaState = JSON.stringify(await hashPathState(DEFAULT_MEDIA_ROOT));
    assert(!/v2-test|test-background|test-soundscape/i.test(mediaState), "default V2 media root contains test media");
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
    assert((err.body.issues || []).some((issue) => issue.code === code), `Expected issue ${code}`);
    return err.body;
  }
  throw new Error(`${pathname} should have failed`);
}

async function uploadAsset({ environmentId, type, filename, mimeType, bytes, tags }) {
  const form = new FormData();
  form.set("environmentId", environmentId);
  form.set("type", type);
  form.set("tags", tags.join(","));
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
      V2_CATALOG_LEGACY_SQLITE_PATH: "/missing.sqlite",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout.on("data", (chunk) => logs.push(String(chunk)));
  child.stderr.on("data", (chunk) => logs.push(String(chunk)));

  try {
    await waitForHealth(child, logs);

    const catalogHtml = await fetchText("/catalog/");
    const mediaHtml = await fetchText("/catalog/media-assets/");
    const sharedCss = await fetchText("/shared/ui/foryou-v2.css");
    const catalogCss = await fetchText("/catalog/styles.css");
    const catalogJs = await fetchText("/catalog/app.js");
    const mediaJs = await fetchText("/catalog/media-assets/app.js");
    assert(catalogHtml.includes("Personages"));
    assert(catalogHtml.includes('/shared/ui/foryou-v2.css'));
    assert(mediaHtml.includes('/shared/ui/foryou-v2.css'));
    assert(catalogHtml.includes("Interne tools"));
    assert(!catalogHtml.includes("Personages / Omgevingen / Situaties"), "catalog summary should not show redundant right-side label");
    assert(!catalogHtml.includes("Performer 1 / 2 / 3"), "performer summary should not show redundant right-side label");
    assert(!catalogHtml.includes('id="characterForm"'), "character form should render inline inside an expanded row");
    assert(!catalogHtml.includes('id="environmentForm"'), "environment form should render inline inside an expanded row");
    assert(!catalogHtml.includes('id="situationForm"'), "situation form should render inline inside an expanded row");
    const primaryActions = (catalogHtml.match(/<div class="fy-actions fy-actions-end">([\s\S]*?)<\/div>/) || [null, ""])[1];
    assert(!primaryActions.includes("Validatie"), "validation should not be a primary toolbar action");
    assert(!primaryActions.includes("Snapshot"), "snapshot should not be a primary toolbar action");
    assert(catalogHtml.includes('id="catalogColumns"'));
    assert.equal((catalogHtml.match(/class="fy-window catalogWindow"/g) || []).length, 3, "catalog UI should have three main columns");
    assert(catalogHtml.includes("fy-grid-3 catalogWindows"));
    assert.equal((catalogHtml.match(/fy-scroll-list catalogList/g) || []).length, 3, "catalog lists should be scrollable");
    assert(catalogHtml.includes("Performers beheren"));
    assert(sharedCss.includes(".fy-window"));
    assert(sharedCss.includes(".fy-scroll-list"));
    assert(sharedCss.includes(".fy-drop-zone"));
    assert(sharedCss.includes(".fy-preview"));
    assert(catalogCss.includes(".catalogWindows"));
    assert(catalogCss.includes("grid-template-columns: repeat(3"));
    assert(catalogCss.includes(".catalogList"));
    assert(catalogCss.includes("overflow: auto"));
    assert(mediaHtml.includes("Media Asset Manager"));
    assert(mediaHtml.includes("environmentCards"));
    assert(mediaHtml.includes("asset-grid"));
    assert(catalogJs.includes("/v0/catalog/read-model"));
    assert(!catalogJs.includes("fy-icon-button"));
    assert(catalogJs.includes("inlineForm"));
    assert(catalogJs.includes("Omschrijving"));
    assert(catalogJs.includes("data-toggle-character"));
    assert(catalogJs.includes("data-toggle-environment"));
    assert(catalogJs.includes("data-toggle-situation"));
    assert(catalogJs.includes("Geen selectie betekent: Alle."));
    assert(catalogJs.includes("zachte media-meldingen verborgen"));
    assert(catalogJs.includes("van 3 personages gekozen"));
    assert(!catalogJs.includes("van 3 rollen gekozen"));
    assert(!catalogJs.includes("<strong>Rol"));
    assert(mediaJs.includes("/v0/catalog/media-assets/upload"));
    assert(!catalogJs.includes("/v0/runtime"));
    assert(!catalogJs.includes("/v0/paths"));
    assert(!catalogHtml.includes('class="rail"'));
    assert(!catalogHtml.includes('class="shell"'));
    assert(!mediaHtml.includes('class="rail"'));
    assert(!mediaHtml.includes('class="shell"'));
    assert(mediaJs.includes("<audio controls"));
    assert(mediaJs.includes("<img"));
    assert(mediaJs.includes("Geen achtergrond"));
    assert(mediaJs.includes("Geen audio-preview"));
    assert(mediaJs.includes('label: "Achtergrond"'));
    assert(mediaJs.includes('label: "Audio"'));
    assert(mediaJs.includes('label: "FX"'));
    assert(mediaJs.includes('label: "FX video"'));
    assert(mediaJs.includes('label: "PNG-laag"'));
    assert(mediaJs.includes("aspectRatio: \"27:16\""));
    assert(mediaJs.includes("canvasWidth: 6480"));
    assert(mediaJs.includes("createOutputPng"));
    assert(mediaJs.includes("/v0/catalog/media-compositions/"));
    assert(mediaJs.includes("data-canvas-drop"));
    assert(mediaJs.includes("data-toggle-people"));
    assert(mediaJs.includes("renderPeopleOverlay"));
    assert(mediaJs.includes("ghost-standin.png"));
    assert(mediaJs.includes("data-video-poster"));
    assert(!mediaJs.includes("data-toggle-video"));
    assert(mediaJs.includes("renderEditorPlayback"));
    assert(mediaJs.includes("editorUploadStrip"));
    assert(mediaJs.includes("fy-drop-zone"));
    assert(mediaJs.includes("fy-button fy-button-primary"));
    assert(mediaJs.includes("data-upload-key"));
    assert(mediaJs.includes('"background"'));
    assert(mediaJs.includes('"soundscape"'));
    assert(mediaJs.includes('"fx"'));

    const initial = await fetchJson("/v0/catalog/read-model");
    const performers = initial.performers.filter((item) => item.active && !item.archivedAt);
    assert(performers.length >= 2, "fixture requires at least two performers");

    const createdPerformer = (await fetchJson("/v0/catalog/performers", jsonOptions("POST", {
      name: "V2 Test Performer",
      performerSlot: 0,
    }))).performer;
    const updatedPerformer = (await fetchJson(`/v0/catalog/performers/${encodeURIComponent(createdPerformer.id)}`, jsonOptions("PATCH", {
      name: "V2 Test Performer Updated",
      performerSlot: 0,
    }))).performer;
    assert.equal(updatedPerformer.name, "V2 Test Performer Updated");

    const createdCharacter = (await fetchJson("/v0/catalog/characters", jsonOptions("POST", {
      name: "V2 Test Personage A",
      description: "Eerste V2 testpersonage",
      performerIds: [updatedPerformer.id],
    }))).character;
    const updatedCharacter = (await fetchJson(`/v0/catalog/characters/${encodeURIComponent(createdCharacter.id)}`, jsonOptions("PATCH", {
      name: "V2 Test Personage A Updated",
      description: "Bijgewerkt met meerdere performers",
      performerIds: [updatedPerformer.id, performers[0].id],
    }))).character;
    assert.deepEqual(updatedCharacter.performerIds, [updatedPerformer.id, performers[0].id]);

    const secondCharacter = (await fetchJson("/v0/catalog/characters", jsonOptions("POST", {
      name: "V2 Test Personage B",
      description: "Tweede V2 testpersonage",
      performerIds: [performers[1].id],
    }))).character;
    const conflictA = (await fetchJson("/v0/catalog/characters", jsonOptions("POST", {
      name: "V2 Conflict A",
      performerIds: [performers[0].id],
    }))).character;
    const conflictB = (await fetchJson("/v0/catalog/characters", jsonOptions("POST", {
      name: "V2 Conflict B",
      performerIds: [performers[0].id],
    }))).character;

    const createdEnvironment = (await fetchJson("/v0/catalog/environments", jsonOptions("POST", {
      name: "V2 Test Omgeving",
      description: "Eerste V2 omgeving",
    }))).environment;
    const updatedEnvironment = (await fetchJson(`/v0/catalog/environments/${encodeURIComponent(createdEnvironment.id)}`, jsonOptions("PATCH", {
      name: "V2 Test Omgeving Updated",
      description: "Bijgewerkte V2 omgeving",
    }))).environment;
    assert.equal(updatedEnvironment.description, "Bijgewerkte V2 omgeving");

    await expectBadRequest("/v0/catalog/situations", jsonOptions("POST", {
      title: "Ongeldige cast",
      environmentId: updatedEnvironment.id,
      characterIds: [conflictA.id, conflictB.id],
    }), "situation_cast_performer_conflict");

    const createdSituation = (await fetchJson("/v0/catalog/situations", jsonOptions("POST", {
      title: "V2 Test Situatie",
      description: "Speelt in de testomgeving",
      environmentId: updatedEnvironment.id,
      characterIds: [updatedCharacter.id, secondCharacter.id],
    }))).situation;
    const updatedSituation = (await fetchJson(`/v0/catalog/situations/${encodeURIComponent(createdSituation.id)}`, jsonOptions("PATCH", {
      title: "V2 Test Situatie Updated",
      description: "Bijgewerkte situatie",
      environmentId: updatedEnvironment.id,
      characterIds: [updatedCharacter.id, secondCharacter.id],
    }))).situation;
    assert.equal(updatedSituation.environmentId, updatedEnvironment.id);
    assert.deepEqual(updatedSituation.characterIds, [updatedCharacter.id, secondCharacter.id]);

    const pngBytes = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=", "base64");
    const wavBytes = Buffer.from("UklGRiQAAABXQVZFZm10IBAAAAABAAEARKwAAIhYAQACABAAZGF0YQAAAAA=", "base64");
    const imageUpload = await uploadAsset({
      environmentId: updatedEnvironment.id,
      type: "background",
      filename: "test-background.png",
      mimeType: "image/png",
      bytes: pngBytes,
      tags: ["test", "background"],
    });
    const audioUpload = await uploadAsset({
      environmentId: updatedEnvironment.id,
      type: "soundscape",
      filename: "test-soundscape.wav",
      mimeType: "audio/wav",
      bytes: wavBytes,
      tags: ["test", "audio"],
    });
    assert(imageUpload.asset.id.startsWith(`media-asset:${updatedEnvironment.id}:background:`));
    assert(audioUpload.asset.id.startsWith(`media-asset:${updatedEnvironment.id}:soundscape:`));
    assert.equal(imageUpload.asset.environmentId, updatedEnvironment.id);
    assert.equal(audioUpload.asset.type, "soundscape");
    assert.deepEqual(imageUpload.asset.tags, ["test", "background"]);
    assertPathInside(V2_ROOT, imageUpload.asset.filePath);
    assertPathInside(V2_ROOT, audioUpload.asset.filePath);
    assert(imageUpload.asset.filePath.startsWith(path.join(TEST_MEDIA_ROOT, "environments")));
    assert(imageUpload.asset.filePath.includes(`${path.sep}background${path.sep}`));
    assert(audioUpload.asset.filePath.includes(`${path.sep}soundscape${path.sep}`));
    await fs.access(imageUpload.asset.filePath);
    await fs.access(audioUpload.asset.filePath);

    const replacementUpload = await uploadAsset({
      environmentId: updatedEnvironment.id,
      type: "background",
      filename: "test-background-replacement.png",
      mimeType: "image/png",
      bytes: pngBytes,
      tags: ["test", "background", "replacement"],
    });
    assert.equal(replacementUpload.asset.type, "background");
    assert(replacementUpload.asset.metadata.backups.some((backup) => backup.assetId === imageUpload.asset.id));
    const storeAfterReplacement = await readCatalogStore({ dbPath: TEST_DB_PATH });
    const replacedRecord = storeAfterReplacement.mediaAssets.find((asset) => asset.id === imageUpload.asset.id);
    assert.equal(replacedRecord.status, "replaced");
    assert(replacedRecord.backupFilePath.startsWith(path.join(TEST_MEDIA_ROOT, "_asset-backups")));
    await fs.access(replacedRecord.backupFilePath);

    const imageResponse = await fetch(`http://127.0.0.1:${PORT}/v0/catalog/media-assets/file/${encodeURIComponent(replacementUpload.asset.id)}`);
    assert.equal(imageResponse.status, 200);
    assert(String(imageResponse.headers.get("content-type") || "").includes("image/png"));
    assert((await imageResponse.arrayBuffer()).byteLength > 0);
    const audioResponse = await fetch(`http://127.0.0.1:${PORT}/v0/catalog/media-assets/file/${encodeURIComponent(audioUpload.asset.id)}`);
    assert.equal(audioResponse.status, 200);
    assert(String(audioResponse.headers.get("content-type") || "").includes("audio/wav"));
    assert((await audioResponse.arrayBuffer()).byteLength > 0);

    const editedReadModel = await fetchJson("/v0/catalog/read-model");
    assert(editedReadModel.characters.some((item) => item.id === updatedCharacter.id && item.name.endsWith("Updated")));
    assert(editedReadModel.environments.some((item) => item.id === updatedEnvironment.id && item.description === "Bijgewerkte V2 omgeving"));
    assert(editedReadModel.situations.some((item) => item.id === updatedSituation.id && item.title.endsWith("Updated")));
    assert(editedReadModel.performers.some((item) => item.id === updatedPerformer.id && item.name.endsWith("Updated")));
    assert(editedReadModel.mediaAssets.some((item) => item.id === imageUpload.asset.id && item.status === "replaced"));
    assert(editedReadModel.mediaAssets.some((item) => item.id === replacementUpload.asset.id && item.status === "present"));
    assert(editedReadModel.mediaAssets.some((item) => item.id === audioUpload.asset.id));

    const snapshotResult = await fetchJson("/v0/catalog/snapshots", { method: "POST" });
    const snapshot = JSON.parse(await fs.readFile(snapshotResult.filePath, "utf8"));
    assert(snapshot.catalog.characters.some((item) => item.id === updatedCharacter.id));
    assert(snapshot.catalog.mediaAssets.some((item) => item.id === replacementUpload.asset.id));

    await stopChild(child);
    const afterHashes = await protectedHashes();
    assertHashesEqual(beforeHashes, afterHashes);
    assert.deepEqual(await hashPathState(DEFAULT_STORE_PATH), defaultStoreBefore, "default V2 store changed during write/media smoke");
    assert.deepEqual(await hashPathState(DEFAULT_DB_PATH), defaultDbBefore, "default V2 catalog db changed during write/media smoke");
    assert.deepEqual(await hashPathState(DEFAULT_MEDIA_ROOT), defaultMediaBefore, "default V2 media root changed during write/media smoke");
    await assertNoDefaultPollution();
    await cleanupTestRoot();

    process.stdout.write(JSON.stringify({
      ok: true,
      port: PORT,
      dbPath: TEST_DB_PATH,
      mediaRoot: TEST_MEDIA_ROOT,
      characterId: updatedCharacter.id,
      environmentId: updatedEnvironment.id,
      situationId: updatedSituation.id,
      imageAssetId: imageUpload.asset.id,
      replacementImageAssetId: replacementUpload.asset.id,
      audioAssetId: audioUpload.asset.id,
      imagePath: imageUpload.asset.filePath,
      replacementImagePath: replacementUpload.asset.filePath,
      audioPath: audioUpload.asset.filePath,
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
    assert.deepEqual(await hashPathState(DEFAULT_STORE_PATH), defaultStoreBefore, "default V2 store changed during failed write/media smoke");
    assert.deepEqual(await hashPathState(DEFAULT_DB_PATH), defaultDbBefore, "default V2 catalog db changed during failed write/media smoke");
    assert.deepEqual(await hashPathState(DEFAULT_MEDIA_ROOT), defaultMediaBefore, "default V2 media root changed during failed write/media smoke");
    await cleanupTestRoot();
    err.message = `${err.message}\nCatalog server logs:\n${logs.join("")}`;
    throw err;
  }
}

main().catch((err) => {
  process.stderr.write(`${err.stack || err.message}\n`);
  process.exit(1);
});
