"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs/promises");
const net = require("node:net");
const path = require("node:path");
const { spawn } = require("node:child_process");

const { DEFAULT_STORE_PATH } = require("../db/paths-store");
const { V2_ROOT } = require("../snapshots/snapshot-store");

const TEST_DIR = __dirname;
const APP_ROOT = path.resolve(TEST_DIR, "../../../..");
const PORT = 3022;
const BASE_URL = `http://127.0.0.1:${PORT}`;
const TEST_TMP_DIR = path.join(TEST_DIR, ".tmp", `paths-smoke-${process.pid}`);
const TEST_STORE_PATH = path.join(TEST_TMP_DIR, "paths-store.json");
const TEST_SNAPSHOT_DIR = path.join(TEST_TMP_DIR, "snapshots");
const PROTECTED_V1_FILES = [
  path.join(APP_ROOT, "data", "live.sqlite"),
  path.join(APP_ROOT, "data", "live.sqlite-wal"),
  path.join(APP_ROOT, "data", "live.sqlite-shm"),
];

async function sha256(filePath) {
  const data = await fs.readFile(filePath);
  return crypto.createHash("sha256").update(data).digest("hex");
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
  if (!stats.isFile()) return { type: "other" };
  return { type: "file", sha256: await sha256(filePath) };
}

async function assertNoDefaultPollution() {
  if (!(await pathExists(DEFAULT_STORE_PATH))) return;
  const storeText = await fs.readFile(DEFAULT_STORE_PATH, "utf8");
  assert(!/V2 smoke pad/i.test(storeText), "default V2 paths store contains smoke-test records");
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

async function assertListenFree(port, host) {
  await new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.once("listening", () => server.close(resolve));
    server.listen(port, host);
  });
}

async function assertPortFree(port) {
  await assertListenFree(port, "127.0.0.1");
  await assertListenFree(port, "::");
}

async function fetchJson(pathname, options) {
  const response = await fetch(`${BASE_URL}${pathname}`, options);
  const body = await response.json();
  if (!response.ok) throw new Error(`${pathname} returned ${response.status}: ${JSON.stringify(body)}`);
  return body;
}

async function fetchText(pathname) {
  const response = await fetch(`${BASE_URL}${pathname}`);
  const body = await response.text();
  if (!response.ok) throw new Error(`${pathname} returned ${response.status}: ${body.slice(0, 300)}`);
  return body;
}

async function waitForHealth(child, logs) {
  const deadline = Date.now() + 8000;
  while (Date.now() < deadline) {
    if (child.exitCode != null) throw new Error(`Paths server exited early (${child.exitCode}): ${logs.join("")}`);
    try {
      return await fetchJson("/health");
    } catch (_err) {
      await new Promise((resolve) => setTimeout(resolve, 150));
    }
  }
  throw new Error(`Paths server did not become healthy: ${logs.join("")}`);
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
  await assertPortFree(PORT);
  await assertNoDefaultPollution();
  await fs.rm(TEST_TMP_DIR, { recursive: true, force: true });
  const beforeHashes = await protectedHashes();
  const defaultStoreBefore = await hashPathState(DEFAULT_STORE_PATH);
  const logs = [];
  const child = spawn(process.execPath, [path.resolve(TEST_DIR, "../server/server.js")], {
    cwd: APP_ROOT,
    env: {
      ...process.env,
      PATHS_PORT: String(PORT),
      V2_PATHS_STORE_PATH: TEST_STORE_PATH,
      V2_PATHS_SNAPSHOT_DIR: TEST_SNAPSHOT_DIR,
      V2_PATHS_EXPRESS_MODULE: process.env.V2_PATHS_EXPRESS_MODULE
        || "/opt/homebrew/lib/node_modules/node-red/node_modules/express",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout.on("data", (chunk) => logs.push(String(chunk)));
  child.stderr.on("data", (chunk) => logs.push(String(chunk)));

  try {
    const health = await waitForHealth(child, logs);
    assert.equal(health.ok, true);
    assert.equal(health.service, "paths");
    assert.equal(health.port, PORT);

    const snapshot = await fetchJson("/v0/paths/read-model");
    assert.equal(snapshot.schemaVersion, "paths.snapshot.v0");
    assert(snapshot.counts.paths > 0, "paths should be present");
    assert(snapshot.counts.pathNodes > 0, "path nodes should be present");
    assert(snapshot.counts.pathEdges > 0, "path edges should be present");
    assert.equal(snapshot.source.readOnly, false);
    assert.equal(snapshot.source.ownsMutations, true);
    assertPathInside(V2_ROOT, snapshot.source.path);
    assert.equal(snapshot.source.seededFrom.readOnly, true);
    assert.equal(snapshot.source.seededFrom.originalReadOnly, true);

    const editorState = await fetchJson("/v0/paths/editor-state");
    assert.equal(editorState.ok, true);
    assert.equal(editorState.schemaVersion, "paths.editor-state.v0");
    assert(editorState.catalog.scenes.length > 1, "editor-state should include read-only catalog scenes");
    assert(editorState.catalog.paths.length > 0, "editor-state should include paths");

    const editorHtml = await fetchText("/editor/");
    assert(editorHtml.includes("testModeBtn"), "editor should include Testpad control");
    assert(editorHtml.includes("/editor/layout-relaxer.js"), "editor should load layout relaxer");
    const editorApp = await fetchText("/editor/paden-editor.js");
    assert(editorApp.includes("overrideTestScene"), "editor Testpad should include explicit override handling");
    assert(editorApp.includes("data-node-test-override"), "editor nodes should expose hover Testpad override action");
    assert(editorApp.includes("seedSceneIds"), "editor Testpad override should seed downstream reachability");
    assert(editorApp.includes("LayoutRelaxer.relaxLayout"), "editor should use layout relaxer");
    assert(editorApp.includes("startEdgeAnimation"), "editor should animate edges alongside layout moves");
    const editorRelaxer = await fetchText("/editor/layout-relaxer.js");
    assert(editorRelaxer.includes("relaxLayout"), "layout relaxer should expose relaxLayout");

    const sceneIds = editorState.catalog.scenes
      .filter((scene) => scene && scene.isActive !== false && !scene.archivedAt)
      .slice(0, 2)
      .map((scene) => Number(scene.id));
    assert.equal(sceneIds.length, 2, "test needs two active scenes");

    const created = await fetchJson("/v0/paths/paths/upsert", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: "V2 smoke pad",
        description: "save-load test",
        color: "#039be5",
        edgeMode: "manual",
        sceneIds: [sceneIds[0]],
        edges: [],
        thresholds: [],
        endSceneIds: [],
        blockRules: [],
        ignoreCrossingBlockSceneIds: [],
        isActive: true,
      }),
    });
    assert(created.path.id, "created path should have an id");

    const updated = await fetchJson(`/v0/paths/paths/${created.path.id}`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        ...created.path,
        name: "V2 smoke pad opgeslagen",
        sceneIds,
        edges: [{ fromSceneId: sceneIds[0], toSceneId: sceneIds[1], edgeType: "required" }],
        thresholds: [],
        endSceneIds: [sceneIds[1]],
        blockRules: [{ sourceSceneId: sceneIds[1], includeCrossingPaths: true }],
        ignoreCrossingBlockSceneIds: [],
        isActive: true,
      }),
    });
    assert.equal(updated.path.name, "V2 smoke pad opgeslagen");

    const reloadedState = await fetchJson("/v0/paths/editor-state");
    const savedPath = reloadedState.catalog.paths.find((item) => Number(item.id) === Number(created.path.id));
    assert(savedPath, "saved path should reload from V2 store");
    assert.deepEqual(savedPath.sceneIds, sceneIds);
    assert.deepEqual(savedPath.edges, [{ fromSceneId: sceneIds[0], toSceneId: sceneIds[1] }]);
    assert.deepEqual(savedPath.endSceneIds, [sceneIds[1]]);
    assert.deepEqual(savedPath.blockRules, [{ sourceSceneId: sceneIds[1], includeCrossingPaths: true }]);

    const validation = await fetchJson("/v0/paths/validation");
    assert(validation.counts && Number.isInteger(validation.counts.errors));
    assert.equal(validation.counts.errors, 0);

    const universeState = await fetchJson("/v0/paths/universe-state");
    assert.equal(universeState.ok, true);
    assert.equal(universeState.schemaVersion, "paths.universe-state.v0");
    assert(universeState.graph.summary.pathCount > 0, "universe-state should include paths");
    assert(universeState.graph.networkMap.summary.nodeCount > 0, "universe-state should include network nodes");
    assert(universeState.graph.networkMap.summary.edgeCount > 0, "universe-state should include network edges");
    assert.equal(universeState.runtime, null, "V2 Universe runtime overlay should be a read-only disconnected fallback");

    const universeHtml = await fetchText("/universe/");
    assert(universeHtml.includes('id="sky"'), "Universe page should include the sky svg");
    assert(universeHtml.includes('id="testModeBtn"'), "Universe page should include Testpad control");
    assert(universeHtml.includes('id="testPanel"'), "Universe page should include Testpad panel");
    assert(universeHtml.includes("/universe/sky-renderer.js"), "Universe page should load the V1 renderer copy");
    const universeApp = await fetchText("/universe/app.js");
    assert(universeApp.includes("/v0/paths/universe-state"), "Universe page should use the V2 universe-state endpoint");
    assert(universeApp.includes("/v0/paths/evaluate"), "Universe Testpad should use the V2 evaluate endpoint");
    assert(universeApp.includes("playedSceneIds"), "Universe Testpad should evaluate played scene ids");
    assert(!universeApp.includes("/api/universe/graph"), "Universe page should not use the V1 graph endpoint");
    const universeRenderer = await fetchText("/universe/sky-renderer.js");
    assert(universeRenderer.includes("onSceneClick"), "Universe renderer should expose scene click handling");
    const universeStageHtml = await fetchText("/universe/stage");
    assert(universeStageHtml.includes('id="sky"'), "Universe stage page should include the sky svg");
    const universeStageApp = await fetchText("/universe/stage-app.js");
    assert(universeStageApp.includes("/v0/paths/universe-state"), "Universe stage page should use the V2 universe-state endpoint");
    assert(!universeStageApp.includes("/api/universe/graph"), "Universe stage page should not use the V1 graph endpoint");

    const initialEvaluation = await fetchJson("/v0/paths/evaluate", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ playedSituationIds: [] }),
    });
    assert(initialEvaluation.pathAvailable.length > 0, "start situations should be available");
    assert(initialEvaluation.pathLocked.length > 0, "locked situations should be reported");
    const savedReadModel = await fetchJson("/v0/paths/read-model");
    const savedSnapshotPath = savedReadModel.paths.find((item) => item.id === `path:${created.path.id}`);
    assert(savedSnapshotPath, "saved path should be present in read-model");

    const isolatedInitialEvaluation = await fetchJson("/v0/paths/evaluate", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        snapshot: { ...savedReadModel, paths: [savedSnapshotPath], crossingThresholds: [] },
        playedSituationIds: [],
      }),
    });
    assert(isolatedInitialEvaluation.pathAvailable.includes(`situation:${sceneIds[0]}`), "new path start should be available");
    assert(isolatedInitialEvaluation.pathLocked.includes(`situation:${sceneIds[1]}`), "new path successor should be locked");

    const playedStart = `situation:${sceneIds[0]}`;
    const afterPlayedEvaluation = await fetchJson("/v0/paths/evaluate", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        snapshot: { ...savedReadModel, paths: [savedSnapshotPath], crossingThresholds: [] },
        playedSituationIds: [playedStart],
      }),
    });
    assert(afterPlayedEvaluation.played.includes(playedStart), "played fact should be echoed");
    assert(!afterPlayedEvaluation.pathAvailable.includes(playedStart), "played situation should not remain available");
    assert(afterPlayedEvaluation.pathAvailable.includes(`situation:${sceneIds[1]}`), "saved edge should unlock successor");

    const snapshotResult = await fetchJson("/v0/paths/snapshots", { method: "POST" });
    assert(snapshotResult.snapshotId);
    assert(snapshotResult.createdAt);
    assert(snapshotResult.filePath);
    assertPathInside(V2_ROOT, snapshotResult.filePath);

    await stopChild(child);
    const afterHashes = await protectedHashes();
    assertHashesEqual(beforeHashes, afterHashes);
    assert.deepEqual(await hashPathState(DEFAULT_STORE_PATH), defaultStoreBefore, "default V2 paths store changed during smoke");
    await assertNoDefaultPollution();
    await fs.rm(TEST_TMP_DIR, { recursive: true, force: true });

    process.stdout.write(JSON.stringify({
      ok: true,
      port: PORT,
      counts: snapshot.counts,
      validationCounts: validation.counts,
      initialAvailable: initialEvaluation.pathAvailable.length,
      initialLocked: initialEvaluation.pathLocked.length,
      universeCounts: universeState.counts,
      playedStart,
      savedPathId: created.path.id,
      snapshotId: snapshotResult.snapshotId,
      snapshotPathInsideV2: true,
      protectedV1HashesUnchanged: true,
    }, null, 2));
    process.stdout.write("\n");
  } catch (err) {
    await stopChild(child);
    const afterHashes = await protectedHashes();
    assertHashesEqual(beforeHashes, afterHashes);
    assert.deepEqual(await hashPathState(DEFAULT_STORE_PATH), defaultStoreBefore, "default V2 paths store changed during failed smoke");
    await fs.rm(TEST_TMP_DIR, { recursive: true, force: true });
    err.message = `${err.message}\nPaths server logs:\n${logs.join("")}`;
    throw err;
  }
}

main().catch((err) => {
  process.stderr.write(`${err.stack || err.message}\n`);
  process.exit(1);
});
