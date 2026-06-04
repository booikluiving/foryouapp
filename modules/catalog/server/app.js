"use strict";

const path = require("node:path");

const {
  CATALOG_SCHEMA_VERSION,
} = require("../../../shared/contracts/catalog-v0");
const { loadExpress } = require("./express-loader");
const { buildCatalogReadModel } = require("../read-model/build-read-model");
const { createCatalogSnapshot } = require("../snapshots/snapshot-store");
const { validateCatalogReadModel } = require("../validation/validate-catalog");
const {
  listMediaAssets,
  listEnvironmentCompositions,
  listLightingPresets,
  deleteMediaAsset,
  mediaAssetFilePath,
  saveMediaAssetUpload,
  upsertCharacter,
  upsertEnvironment,
  upsertEnvironmentComposition,
  upsertLightingPreset,
  upsertPerformer,
  upsertSituation,
} = require("../write-model/catalog-store");

const express = loadExpress();
const DEFAULT_SHOW_CONTROL_URL = "http://127.0.0.1:3025";

function asyncRoute(handler) {
  return (req, res, next) => {
    Promise.resolve(handler(req, res, next)).catch(next);
  };
}

function showControlUrl(options = {}) {
  return String(
    options.showControlUrl
    || process.env.V2_CATALOG_SHOW_CONTROL_URL
    || process.env.V2_SHOW_CONTROL_URL
    || DEFAULT_SHOW_CONTROL_URL
  ).replace(/\/+$/, "");
}

function createMediaRefreshScheduler(options = {}) {
  const timers = new Map();
  const debounceMs = Math.max(0, Number(
    options.mediaRefreshDebounceMs
    || process.env.V2_CATALOG_MEDIA_REFRESH_DEBOUNCE_MS
    || 150
  ));
  return function scheduleMediaRefresh(input = {}) {
    const environmentId = String(input.environmentId || "").trim();
    if (!environmentId) return;
    const previous = timers.get(environmentId);
    if (previous) clearTimeout(previous);
    const timer = setTimeout(async () => {
      timers.delete(environmentId);
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), Number(options.mediaRefreshTimeoutMs || 1200));
      try {
        await fetch(`${showControlUrl(options)}/v0/show-control/media-assets/refresh`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            environmentId,
            roles: Array.isArray(input.roles) ? input.roles : [],
            reason: input.reason || "catalog_media_changed",
            source: input.source || "catalog",
            assetId: input.assetId || null,
          }),
          signal: controller.signal,
        });
      } catch (_err) {
        // Saving media in Catalog must not depend on Show Control being reachable.
      } finally {
        clearTimeout(timeout);
      }
    }, debounceMs);
    if (typeof timer.unref === "function") timer.unref();
    timers.set(environmentId, timer);
  };
}

function createCatalogApp(options = {}) {
  const app = express();
  const startedAt = new Date();
  const scheduleMediaRefresh = createMediaRefreshScheduler(options);
  const uiRoot = path.resolve(__dirname, "../ui");
  const sharedUiRoot = path.resolve(__dirname, "../../../shared/ui");

  app.use(express.json({ limit: "256kb" }));

  app.get("/", (_req, res) => {
    res.redirect("/catalog/");
  });

  app.use("/shared/ui", express.static(sharedUiRoot));
  app.use("/catalog/media-assets", express.static(path.join(uiRoot, "media-assets"), { extensions: ["html"] }));
  app.use("/catalog", express.static(path.join(uiRoot, "catalog"), { extensions: ["html"] }));

  app.get("/health", (req, res) => {
    const port = Number(process.env.CATALOG_PORT || process.env.PORT || options.port || 3021);
    res.json({
      ok: true,
      service: "catalog",
      version: "v0",
      schemaVersion: CATALOG_SCHEMA_VERSION,
      port,
      startedAt: startedAt.toISOString(),
      uptimeSeconds: Math.round(process.uptime()),
    });
  });

  app.get("/v0/catalog/read-model", asyncRoute(async (_req, res) => {
    const readModel = await buildCatalogReadModel(options);
    res.json(readModel);
  }));

  app.get("/v0/catalog/validation", asyncRoute(async (_req, res) => {
    const readModel = await buildCatalogReadModel(options);
    const validation = validateCatalogReadModel(readModel);
    res.json(validation);
  }));

  app.get("/v0/catalog/media-assets", asyncRoute(async (_req, res) => {
    const readModel = await buildCatalogReadModel(options);
    res.json({
      ok: true,
      generatedAt: new Date().toISOString(),
      environments: readModel.environments,
      mediaAssets: readModel.mediaAssets,
      environmentCompositions: readModel.environmentCompositions || await listEnvironmentCompositions(options),
      lightingPresets: readModel.lightingPresets || await listLightingPresets(options),
      baseLighting: {
        fixtureGroup: "front",
        fixtureIds: ["lamp4", "lamp5", "lamp6", "lamp7", "lamp8", "lamp9"],
        look: "neutral-soft-white",
      },
      v2MediaAssets: await listMediaAssets(options),
      counts: {
        environments: readModel.environments.length,
        mediaAssets: readModel.mediaAssets.length,
        environmentCompositions: (readModel.environmentCompositions || []).length,
        lightingPresets: (readModel.lightingPresets || []).length,
      },
    });
  }));

  app.get("/v0/catalog/lighting-presets", asyncRoute(async (_req, res) => {
    res.json({
      ok: true,
      generatedAt: new Date().toISOString(),
      lightingPresets: await listLightingPresets(options),
    });
  }));

  app.put("/v0/catalog/lighting-presets/:presetId", asyncRoute(async (req, res) => {
    const preset = await upsertLightingPreset(req.params.presetId, req.body || {}, options);
    const updatedReadModel = await buildCatalogReadModel(options);
    res.json({
      ok: true,
      preset,
      readModelCounts: updatedReadModel.counts,
    });
  }));

  app.get("/v0/catalog/media-assets/file/:assetId", asyncRoute(async (req, res) => {
    try {
      const file = await mediaAssetFilePath(req.params.assetId, options);
      res.type(file.mimeType);
      res.sendFile(file.filePath);
      return;
    } catch (err) {
      if (!err || err.statusCode !== 404) throw err;
    }

    const readModel = await buildCatalogReadModel(options);
    const asset = (readModel.mediaAssets || []).find((item) => item.id === req.params.assetId);
    const primaryFile = asset && asset.status === "present" ? asset.primaryFile : null;
    const candidatePath = primaryFile && primaryFile.absolutePath ? path.resolve(primaryFile.absolutePath) : "";
    const knownPaths = new Set((asset && Array.isArray(asset.files) ? asset.files : [])
      .map((item) => item && item.absolutePath ? path.resolve(item.absolutePath) : "")
      .filter(Boolean));
    if (!candidatePath || !knownPaths.has(candidatePath)) {
      throw Object.assign(new Error("media_asset_file_missing"), { statusCode: 404 });
    }
    res.sendFile(candidatePath);
  }));

  app.post("/v0/catalog/media-assets/upload", asyncRoute(async (req, res) => {
    const readModel = await buildCatalogReadModel(options);
    const asset = await saveMediaAssetUpload(req, readModel, options);
    const updatedReadModel = await buildCatalogReadModel(options);
    scheduleMediaRefresh({
      environmentId: asset.environmentId,
      roles: [asset.role || asset.type].filter(Boolean),
      reason: "media_asset_upload",
      source: "catalog-upload",
      assetId: asset.id,
    });
    res.status(201).json({
      ok: true,
      asset,
      readModelCounts: updatedReadModel.counts,
    });
  }));

  app.delete("/v0/catalog/media-assets/:assetId", asyncRoute(async (req, res) => {
    const asset = await deleteMediaAsset(req.params.assetId, options);
    const updatedReadModel = await buildCatalogReadModel(options);
    scheduleMediaRefresh({
      environmentId: asset.environmentId,
      roles: [asset.role || asset.type].filter(Boolean),
      reason: "media_asset_delete",
      source: "catalog-delete",
      assetId: asset.id,
    });
    res.json({
      ok: true,
      asset,
      readModelCounts: updatedReadModel.counts,
    });
  }));

  app.put("/v0/catalog/media-compositions/:environmentId", asyncRoute(async (req, res) => {
    const readModel = await buildCatalogReadModel(options);
    const composition = await upsertEnvironmentComposition(req.params.environmentId, req.body || {}, readModel, options);
    const updatedReadModel = await buildCatalogReadModel(options);
    const roles = [];
    if (composition.backgroundLayer) roles.push("background");
    if (composition.fxVideoLayer) roles.push("fxVideo");
    if ((composition.imageLayers || []).length) roles.push("fxImage");
    scheduleMediaRefresh({
      environmentId: composition.environmentId,
      roles,
      reason: "media_composition_save",
      source: "catalog-composition",
    });
    res.json({
      ok: true,
      composition,
      readModelCounts: updatedReadModel.counts,
    });
  }));

  app.post("/v0/catalog/characters", asyncRoute(async (req, res) => {
    const readModel = await buildCatalogReadModel(options);
    const character = await upsertCharacter(req.body || {}, readModel, options);
    res.status(201).json({ ok: true, character });
  }));

  app.post("/v0/catalog/performers", asyncRoute(async (req, res) => {
    const readModel = await buildCatalogReadModel(options);
    const performer = await upsertPerformer(req.body || {}, readModel, options);
    res.status(201).json({ ok: true, performer });
  }));

  app.patch("/v0/catalog/performers/:id", asyncRoute(async (req, res) => {
    const readModel = await buildCatalogReadModel(options);
    const performer = await upsertPerformer({ ...(req.body || {}), id: req.params.id }, readModel, options);
    res.json({ ok: true, performer });
  }));

  app.put("/v0/catalog/performers/:id", asyncRoute(async (req, res) => {
    const readModel = await buildCatalogReadModel(options);
    const performer = await upsertPerformer({ ...(req.body || {}), id: req.params.id }, readModel, options);
    res.json({ ok: true, performer });
  }));

  app.patch("/v0/catalog/characters/:id", asyncRoute(async (req, res) => {
    const readModel = await buildCatalogReadModel(options);
    const character = await upsertCharacter({ ...(req.body || {}), id: req.params.id }, readModel, options);
    res.json({ ok: true, character });
  }));

  app.put("/v0/catalog/characters/:id", asyncRoute(async (req, res) => {
    const readModel = await buildCatalogReadModel(options);
    const character = await upsertCharacter({ ...(req.body || {}), id: req.params.id }, readModel, options);
    res.json({ ok: true, character });
  }));

  app.post("/v0/catalog/environments", asyncRoute(async (req, res) => {
    const readModel = await buildCatalogReadModel(options);
    const environment = await upsertEnvironment(req.body || {}, readModel, options);
    res.status(201).json({ ok: true, environment });
  }));

  app.patch("/v0/catalog/environments/:id", asyncRoute(async (req, res) => {
    const readModel = await buildCatalogReadModel(options);
    const environment = await upsertEnvironment({ ...(req.body || {}), id: req.params.id }, readModel, options);
    res.json({ ok: true, environment });
  }));

  app.put("/v0/catalog/environments/:id", asyncRoute(async (req, res) => {
    const readModel = await buildCatalogReadModel(options);
    const environment = await upsertEnvironment({ ...(req.body || {}), id: req.params.id }, readModel, options);
    res.json({ ok: true, environment });
  }));

  app.post("/v0/catalog/situations", asyncRoute(async (req, res) => {
    const readModel = await buildCatalogReadModel(options);
    const situation = await upsertSituation(req.body || {}, readModel, options);
    res.status(201).json({ ok: true, situation });
  }));

  app.patch("/v0/catalog/situations/:id", asyncRoute(async (req, res) => {
    const readModel = await buildCatalogReadModel(options);
    const situation = await upsertSituation({ ...(req.body || {}), id: req.params.id }, readModel, options);
    res.json({ ok: true, situation });
  }));

  app.put("/v0/catalog/situations/:id", asyncRoute(async (req, res) => {
    const readModel = await buildCatalogReadModel(options);
    const situation = await upsertSituation({ ...(req.body || {}), id: req.params.id }, readModel, options);
    res.json({ ok: true, situation });
  }));

  app.post("/v0/catalog/snapshots", asyncRoute(async (_req, res) => {
    const readModel = await buildCatalogReadModel(options);
    const validation = validateCatalogReadModel(readModel);
    const snapshot = await createCatalogSnapshot({
      ...options,
      catalog: readModel,
      validation,
    });
    res.status(201).json(snapshot);
  }));

  app.use((req, res) => {
    res.status(404).json({
      ok: false,
      error: "not_found",
      path: req.path,
    });
  });

  app.use((err, _req, res, _next) => {
    res.status(err && err.statusCode ? err.statusCode : 500).json({
      ok: false,
      error: err && err.statusCode === 400 ? "catalog_validation_error" : "catalog_service_error",
      message: err && err.message ? String(err.message) : "unknown_error",
      issues: Array.isArray(err && err.issues) ? err.issues : [],
    });
  });

  return app;
}

module.exports = {
  createCatalogApp,
};
