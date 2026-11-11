"use strict";

const path = require("node:path");

const { PATHS_SNAPSHOT_SCHEMA_VERSION } = require("../../../shared/contracts/paths-v0");
const { buildPathsEditorState } = require("../read-model/build-editor-state");
const { evaluatePaths } = require("../evaluation/evaluate-paths");
const { buildPathsSnapshot } = require("../read-model/build-snapshot");
const { createPathsSnapshot } = require("../snapshots/snapshot-store");
const { buildPathsUniverseState } = require("../universe/build-universe-state");
const { validatePathsSnapshot } = require("../validation/validate-paths");
const {
  archivePath,
  deleteInactivePath,
  readPathsStore,
  upsertCrossingThreshold,
  upsertPath,
  writePathsStore,
} = require("../db/paths-store");
const {
  pathsContent,
  pathsContentHash,
  pathsContentIssues,
  withPathsContent,
} = require("../db/paths-content");
const { createWriteQueue, loopbackOnly } = require("../../../shared/sync/content-hash");
const { fetchEditorCatalog } = require("../client/catalog-client");
const { loadExpress } = require("./express-loader");

const express = loadExpress();

function asyncRoute(handler) {
  return (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
}

function createPathsApp(options = {}) {
  const app = express();
  const startedAt = new Date();
  const editorRoot = path.resolve(__dirname, "../editor");
  const editorGraphPath = path.resolve(__dirname, "../rules-engine/paden-graph.js");
  const universeRoot = path.resolve(__dirname, "../universe/public");
  app.use(createWriteQueue());
  app.use(express.json({ limit: "5mb" }));

  // Whole-content exchange for the website sync.
  app.get("/v0/paths/store", loopbackOnly, asyncRoute(async (_req, res) => {
    const content = pathsContent(await readPathsStore(options));
    res.json({ ok: true, hash: pathsContentHash(content), content });
  }));

  app.put("/v0/paths/store", loopbackOnly, asyncRoute(async (req, res) => {
    const body = req.body || {};
    const store = await readPathsStore(options);
    const currentHash = pathsContentHash(pathsContent(store));
    if (!body.force && body.expectedHash !== currentHash) {
      res.status(409).json({ ok: false, error: "content_changed", currentHash });
      return;
    }
    const issues = pathsContentIssues(body.content, store.schemaVersion);
    if (issues.length) {
      res.status(400).json({ ok: false, error: "content_invalid", issues });
      return;
    }
    await writePathsStore(withPathsContent(store, body.content), options);
    const written = pathsContent(await readPathsStore(options));
    res.json({ ok: true, previousHash: currentHash, hash: pathsContentHash(written) });
  }));

  app.get("/", (_req, res) => {
    res.redirect("/editor/");
  });

  app.get("/editor/paden-graph.js", (_req, res) => {
    res.type("application/javascript").sendFile(editorGraphPath);
  });

  app.use("/editor", express.static(editorRoot, { extensions: ["html"] }));
  app.use("/universe", express.static(universeRoot, {
    extensions: ["html"],
    index: "index.html",
    maxAge: "30s",
  }));

  app.get("/health", (_req, res) => {
    const port = Number(process.env.PATHS_PORT || process.env.PORT || options.port || 3022);
    res.json({
      ok: true,
      service: "paths",
      version: "v0",
      schemaVersion: PATHS_SNAPSHOT_SCHEMA_VERSION,
      port,
      startedAt: startedAt.toISOString(),
      uptimeSeconds: Math.round(process.uptime()),
    });
  });

  app.get("/v0/paths/read-model", asyncRoute(async (_req, res) => {
    res.json(await buildPathsSnapshot(options));
  }));

  app.get("/v0/paths/snapshot", asyncRoute(async (_req, res) => {
    res.json(await buildPathsSnapshot(options));
  }));

  app.get("/v0/paths/editor-state", asyncRoute(async (_req, res) => {
    res.json(await buildPathsEditorState(options));
  }));

  app.get("/v0/paths/universe-state", asyncRoute(async (_req, res) => {
    res.json(await buildPathsUniverseState(options));
  }));

  app.get("/v0/paths/validation", asyncRoute(async (_req, res) => {
    const snapshot = await buildPathsSnapshot(options);
    res.json(validatePathsSnapshot(snapshot));
  }));

  app.post("/v0/paths/evaluate", asyncRoute(async (req, res) => {
    const snapshot = req.body && req.body.snapshot
      ? req.body.snapshot
      : await buildPathsSnapshot(options);
    res.json(evaluatePaths(snapshot, req.body || {}));
  }));

  app.post("/v0/paths/paths/upsert", asyncRoute(async (req, res) => {
    const catalog = await fetchEditorCatalog();
    const pathItem = await upsertPath(req.body || {}, { ...options, catalog });
    const state = await buildPathsEditorState(options);
    res.status(pathItem && req.body && req.body.id ? 200 : 201).json({
      ok: true,
      path: pathItem,
      state,
    });
  }));

  app.put("/v0/paths/paths/:id", asyncRoute(async (req, res) => {
    const catalog = await fetchEditorCatalog();
    const pathItem = await upsertPath({ ...(req.body || {}), id: req.params.id }, { ...options, catalog });
    const state = await buildPathsEditorState(options);
    res.json({ ok: true, path: pathItem, state });
  }));

  app.post("/v0/paths/crossing-thresholds/upsert", asyncRoute(async (req, res) => {
    const crossingThreshold = await upsertCrossingThreshold(req.body || {}, options);
    const state = await buildPathsEditorState(options);
    res.json({ ok: true, crossingThreshold, state });
  }));

  app.put("/v0/paths/crossing-thresholds/:sceneId", asyncRoute(async (req, res) => {
    const crossingThreshold = await upsertCrossingThreshold({
      ...(req.body || {}),
      sceneId: req.params.sceneId,
    }, options);
    const state = await buildPathsEditorState(options);
    res.json({ ok: true, crossingThreshold, state });
  }));

  app.post("/v0/paths/archive", asyncRoute(async (req, res) => {
    const archived = await archivePath(req.body && req.body.id, options);
    const state = await buildPathsEditorState(options);
    res.json({ ok: true, archived, state });
  }));

  app.post("/v0/paths/delete", asyncRoute(async (req, res) => {
    const deleted = await deleteInactivePath(req.body && req.body.id, options);
    const state = await buildPathsEditorState(options);
    res.json({ ok: true, deleted, state });
  }));

  app.post("/v0/paths/snapshots", asyncRoute(async (_req, res) => {
    const snapshot = await buildPathsSnapshot(options);
    const validation = validatePathsSnapshot(snapshot);
    const result = await createPathsSnapshot({ ...options, paths: snapshot, validation });
    res.status(201).json(result);
  }));

  app.use((req, res) => {
    res.status(404).json({ ok: false, error: "not_found", path: req.path });
  });

  app.use((err, _req, res, _next) => {
    const statusCode = Number(err && err.statusCode || 500);
    res.status(statusCode).json({
      ok: false,
      error: "paths_service_error",
      message: err && err.message ? String(err.message) : "unknown_error",
      issues: Array.isArray(err && err.issues) ? err.issues : [],
    });
  });

  return app;
}

module.exports = {
  createPathsApp,
};
