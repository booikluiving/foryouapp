"use strict";

const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");

const DEFAULT_CATALOG_DB_PATH = path.resolve(__dirname, "../../catalog/db/catalog.sqlite");

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function asObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : null;
}

function environmentIdFromResolved(resolved = {}) {
  return String(
    resolved.environmentId
    || (resolved.environment && resolved.environment.id)
    || ""
  ).trim();
}

function assetIdOf(asset = {}) {
  return String(asset.id || asset.assetId || "").trim();
}

function assetRoleOf(asset = {}) {
  return String(asset.role || asset.type || "").trim();
}

function assetTypeOf(asset = {}) {
  return String(asset.type || asset.role || "").trim();
}

function assetFilePath(asset = {}) {
  const primaryFile = asObject(asset.primaryFile) || {};
  if (primaryFile.absolutePath) return String(primaryFile.absolutePath);
  if (asset.filePath) return String(asset.filePath);
  if (asset.absolutePath) return String(asset.absolutePath);
  if (asset.file) return String(asset.file);
  const files = Array.isArray(asset.files) ? asset.files : [];
  const firstFile = asObject(files[0]) || {};
  return String(firstFile.absolutePath || firstFile.path || "");
}

function assetUrl(asset = {}, assetId = "") {
  return String(asset.url || (assetId ? `/v0/catalog/media-assets/file/${encodeURIComponent(assetId)}` : ""));
}

function assetTags(asset = {}) {
  if (Array.isArray(asset.tags)) return asset.tags.map((tag) => String(tag).trim()).filter(Boolean);
  if (typeof asset.tags === "string") return asset.tags.split(",").map((tag) => tag.trim()).filter(Boolean);
  return [];
}

function normalizeAsset(asset, { environmentId = "", role = "" } = {}) {
  const source = asObject(asset);
  if (!source) return null;
  const id = assetIdOf(source);
  const resolvedRole = assetRoleOf(source) || role;
  const resolvedType = String(source.type || (
    resolvedRole === "soundscape" ? "soundscape"
      : resolvedRole === "background" ? "background"
        : resolvedRole === "fxVideo" || resolvedRole === "fxImage" || resolvedRole === "fx" ? "fx"
          : ""
  )).trim();
  return {
    id,
    assetId: id,
    environmentId: String(source.environmentId || environmentId || "").trim(),
    legacyEnvironmentId: source.legacyEnvironmentId || null,
    type: resolvedType,
    role: resolvedRole,
    status: source.status || "present",
    name: source.name || source.title || source.filename || id,
    filename: source.filename || source.originalFilename || "",
    filePath: assetFilePath(source),
    url: assetUrl(source, id),
    mimeType: source.mimeType || "",
    extension: source.extension || "",
    relativePath: source.relativePath || "",
    tags: assetTags(source),
    source: source.source || null,
  };
}

function catalogFromRuntimeState(runtimeState = {}) {
  return runtimeState.showRunSnapshot && runtimeState.showRunSnapshot.catalog
    ? runtimeState.showRunSnapshot.catalog
    : {};
}

function catalogDbPath(options = {}) {
  return String(
    options.catalogDbPath
    || process.env.V2_CATALOG_DB_PATH
    || DEFAULT_CATALOG_DB_PATH
  );
}

function parseRecordJson(row) {
  try {
    return row && row.record_json ? JSON.parse(row.record_json) : null;
  } catch (_err) {
    return null;
  }
}

function liveCatalogFromOption(environmentId, liveCatalog) {
  if (!liveCatalog || typeof liveCatalog !== "object") return null;
  return {
    ok: true,
    source: "option",
    mediaAssets: (liveCatalog.mediaAssets || [])
      .filter((asset) => String(asset.environmentId || "") === environmentId),
    environmentCompositions: (liveCatalog.environmentCompositions || [])
      .filter((composition) => String(composition.environmentId || "") === environmentId),
  };
}

function liveCatalogFromDisk(environmentId, options = {}) {
  if (options.disableLiveCatalog === true) return null;
  const dbPath = catalogDbPath(options);
  let db = null;
  try {
    db = new DatabaseSync(dbPath, { readOnly: true });
    const mediaAssets = db
      .prepare("SELECT record_json FROM media_assets WHERE environment_id = ? ORDER BY id")
      .all(environmentId)
      .map(parseRecordJson)
      .filter(Boolean);
    const environmentCompositions = db
      .prepare("SELECT record_json FROM environment_compositions WHERE environment_id = ?")
      .all(environmentId)
      .map(parseRecordJson)
      .filter(Boolean);
    const environment = db
      .prepare("SELECT id FROM environments WHERE id = ? LIMIT 1")
      .get(environmentId);
    if (!environment && !mediaAssets.length && !environmentCompositions.length) {
      return {
        ok: false,
        source: "catalog.sqlite",
        dbPath,
        error: "environment_not_found",
      };
    }
    return {
      ok: true,
      source: "catalog.sqlite",
      dbPath,
      mediaAssets,
      environmentCompositions,
    };
  } catch (err) {
    return {
      ok: false,
      source: "catalog.sqlite",
      dbPath,
      error: err && err.message ? String(err.message) : "catalog_live_lookup_failed",
    };
  } finally {
    if (db) {
      try { db.close(); } catch (_err) {}
    }
  }
}

function liveCatalogForEnvironment(environmentId, options = {}) {
  const fromOption = liveCatalogFromOption(environmentId, options.liveCatalog);
  if (fromOption) return fromOption;
  return liveCatalogFromDisk(environmentId, options);
}

function catalogWithLiveEnvironmentAssets(runtimeState = {}, environmentId = "", options = {}) {
  const snapshotCatalog = catalogFromRuntimeState(runtimeState);
  if (!environmentId) return { catalog: snapshotCatalog, resolution: { source: "runtime-snapshot", live: false } };
  const live = liveCatalogForEnvironment(environmentId, options);
  if (!live || live.ok !== true) {
    return {
      catalog: snapshotCatalog,
      resolution: {
        source: "runtime-snapshot",
        live: false,
        liveLookup: live ? { ok: false, source: live.source, error: live.error || null } : null,
      },
    };
  }
  return {
    catalog: {
      ...snapshotCatalog,
      mediaAssets: [
        ...(snapshotCatalog.mediaAssets || []).filter((asset) => String(asset.environmentId || "") !== environmentId),
        ...live.mediaAssets,
      ],
      environmentCompositions: [
        ...(snapshotCatalog.environmentCompositions || []).filter((composition) => String(composition.environmentId || "") !== environmentId),
        ...live.environmentCompositions,
      ],
      _liveAssetOverlay: true,
    },
    resolution: {
      source: live.source,
      live: true,
      mediaAssetCount: live.mediaAssets.length,
      compositionCount: live.environmentCompositions.length,
      dbPath: live.dbPath || null,
    },
  };
}

function isPresent(asset = {}) {
  const status = String(asset.status || "present");
  return status !== "deleted" && status !== "replaced" && status !== "missing";
}

function assetsForEnvironment(catalog, environmentId) {
  return (catalog.mediaAssets || [])
    .filter((asset) => String(asset.environmentId || "") === environmentId)
    .filter(isPresent);
}

function compositionForEnvironment(catalog, environmentId) {
  return (catalog.environmentCompositions || [])
    .find((composition) => String(composition.environmentId || "") === environmentId) || null;
}

function assetById(assets, assetId) {
  return assets.find((asset) => assetIdOf(asset) === assetId) || null;
}

function preferredAssetForRole(catalog, environmentId, role) {
  const assets = assetsForEnvironment(catalog, environmentId);
  const composition = compositionForEnvironment(catalog, environmentId);
  const layerKey = role === "background" ? "backgroundLayer" : role === "soundscape" ? "soundscapeLayer" : "";
  const layer = layerKey && composition ? composition[layerKey] : null;
  const layerAssetId = layer && layer.assetId ? String(layer.assetId) : "";
  if (layerAssetId) {
    const composed = assetById(assets, layerAssetId);
    if (composed) return composed;
  }
  return assets.find((asset) => assetRoleOf(asset) === role || String(asset.type || "") === role) || null;
}

function isFxAsset(asset = {}) {
  const role = assetRoleOf(asset);
  const type = assetTypeOf(asset);
  return type === "fx" || role === "fx" || role === "fxVideo" || role === "fxImage";
}

function isTdOutputAsset(asset = {}) {
  const tags = assetTags(asset);
  return tags.includes("td-output") || tags.includes("rendered-output");
}

function uniqueAssets(assets = []) {
  const seen = new Set();
  const result = [];
  for (const asset of assets) {
    const id = assetIdOf(asset);
    const key = id || assetFilePath(asset);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    result.push(asset);
  }
  return result;
}

function fxAssetsFromComposition(catalog, environmentId) {
  const assets = assetsForEnvironment(catalog, environmentId);
  const composition = compositionForEnvironment(catalog, environmentId);
  if (!composition) return [];
  const selected = [];
  const fxVideoAssetId = composition.fxVideoLayer && composition.fxVideoLayer.assetId
    ? String(composition.fxVideoLayer.assetId)
    : "";
  if (fxVideoAssetId) {
    const fxVideo = assetById(assets, fxVideoAssetId);
    if (fxVideo) selected.push(fxVideo);
  }
  const imageLayers = Array.isArray(composition.imageLayers) ? composition.imageLayers : [];
  for (const layer of imageLayers.slice().sort((left, right) => Number(left.zIndex || 0) - Number(right.zIndex || 0))) {
    const assetId = layer && layer.assetId ? String(layer.assetId) : "";
    if (!assetId) continue;
    const asset = assetById(assets, assetId);
    if (asset) selected.push(asset);
  }
  return uniqueAssets(selected);
}

function tdOutputAssetsForEnvironment(catalog, environmentId) {
  return uniqueAssets(
    assetsForEnvironment(catalog, environmentId)
      .filter(isFxAsset)
      .filter(isTdOutputAsset)
  );
}

function preferTdOutputAssets(assets = []) {
  const presentAssets = assets.filter(isPresent);
  const outputs = presentAssets.filter(isTdOutputAsset);
  return outputs.length ? uniqueAssets(outputs) : uniqueAssets(presentAssets);
}

function fxAssetsForEnvironment(catalog, environmentId) {
  const outputs = tdOutputAssetsForEnvironment(catalog, environmentId);
  if (outputs.length) return outputs;
  const composed = fxAssetsFromComposition(catalog, environmentId);
  if (composed.length) return composed;
  return assetsForEnvironment(catalog, environmentId).filter(isFxAsset).filter((asset) => !isTdOutputAsset(asset));
}

function existingAsset(resolved = {}, role) {
  const assets = asObject(resolved.assets) || {};
  return asObject(assets[role]) || null;
}

function existingFxAssets(resolved = {}) {
  if (Array.isArray(resolved.fxAssets)) return resolved.fxAssets.filter(asObject);
  const assets = asObject(resolved.assets) || {};
  if (Array.isArray(assets.fx)) return assets.fx.filter(asObject);
  if (asObject(assets.fx)) return [assets.fx];
  if (Array.isArray(assets.fxAssets)) return assets.fxAssets.filter(asObject);
  return [];
}

function resolvedEnvironmentAssets(runtimeState, resolved, options = {}) {
  const environmentId = environmentIdFromResolved(resolved);
  const { catalog, resolution } = catalogWithLiveEnvironmentAssets(runtimeState, environmentId, options);
  const existingAssets = asObject(resolved.assets) || {};
  const preferCatalogAssets = !!catalog._liveAssetOverlay;
  const background = normalizeAsset(
    preferCatalogAssets
      ? preferredAssetForRole(catalog, environmentId, "background")
      : existingAsset(resolved, "background") || preferredAssetForRole(catalog, environmentId, "background"),
    { environmentId, role: "background" }
  );
  const soundscape = normalizeAsset(
    preferCatalogAssets
      ? preferredAssetForRole(catalog, environmentId, "soundscape")
      : existingAsset(resolved, "soundscape") || preferredAssetForRole(catalog, environmentId, "soundscape"),
    { environmentId, role: "soundscape" }
  );
  const catalogOutputFx = tdOutputAssetsForEnvironment(catalog, environmentId);
  const existingFx = existingFxAssets(resolved);
  const fxSource = preferCatalogAssets
    ? (catalogOutputFx.length ? catalogOutputFx : fxAssetsForEnvironment(catalog, environmentId))
    : (catalogOutputFx.length
      ? catalogOutputFx
      : existingFx.length
        ? existingFx
        : fxAssetsForEnvironment(catalog, environmentId));
  const fx = preferTdOutputAssets(fxSource)
    .map((asset) => normalizeAsset(asset, { environmentId, role: assetRoleOf(asset) || "fx" }))
    .filter(Boolean);
  return {
    environmentId,
    resolution,
    assets: {
      ...cloneJson(existingAssets),
      ...(background ? { background } : {}),
      ...(soundscape ? { soundscape } : {}),
      fx,
    },
    background,
    soundscape,
    fx,
  };
}

function enrichPayloadWithEnvironmentAssets(payload, runtimeState, resolved, options = {}) {
  const enriched = { ...payload };
  const environmentAssets = resolvedEnvironmentAssets(runtimeState, resolved, options);
  if (environmentAssets.environmentId && !enriched.environmentId) {
    enriched.environmentId = environmentAssets.environmentId;
  }
  enriched.mediaAssetResolution = environmentAssets.resolution || { source: "runtime-snapshot", live: false };
  enriched.assets = environmentAssets.assets;
  enriched.environmentAssets = {
    ...(environmentAssets.background ? { background: environmentAssets.background } : {}),
    ...(environmentAssets.soundscape ? { soundscape: environmentAssets.soundscape } : {}),
    fx: environmentAssets.fx || [],
  };
  if (environmentAssets.background) {
    enriched.backgroundAsset = environmentAssets.background;
    enriched.assetId = environmentAssets.background.assetId;
    enriched.type = environmentAssets.background.type || "background";
    enriched.role = environmentAssets.background.role || "background";
    enriched.filePath = environmentAssets.background.filePath || "";
    enriched.url = environmentAssets.background.url || "";
  }
  if (environmentAssets.soundscape) {
    enriched.soundscapeAsset = environmentAssets.soundscape;
    enriched.soundscapeFilePath = environmentAssets.soundscape.filePath || "";
    enriched.soundscapeUrl = environmentAssets.soundscape.url || "";
  }
  enriched.fxAssets = environmentAssets.fx || [];
  enriched.fxFilePaths = enriched.fxAssets.map((asset) => asset.filePath).filter(Boolean);
  enriched.fxOverlayAsset = enriched.fxAssets[0] || null;
  enriched.fxOverlayFilePath = enriched.fxOverlayAsset ? enriched.fxOverlayAsset.filePath || "" : "";
  enriched.hasFxOverlay = Boolean(enriched.fxOverlayFilePath);
  enriched.fxVideoAsset = enriched.fxAssets.find((asset) => asset.role === "fxVideo") || null;
  enriched.fxImageAssets = enriched.fxAssets.filter((asset) => asset.role === "fxImage");
  enriched.assetFilePaths = {
    ...(environmentAssets.background && environmentAssets.background.filePath ? { background: environmentAssets.background.filePath } : {}),
    ...(environmentAssets.soundscape && environmentAssets.soundscape.filePath ? { soundscape: environmentAssets.soundscape.filePath } : {}),
    fx: enriched.fxFilePaths,
  };
  return enriched;
}

module.exports = {
  enrichPayloadWithEnvironmentAssets,
  catalogWithLiveEnvironmentAssets,
  environmentIdFromResolved,
  liveCatalogForEnvironment,
  normalizeAsset,
  resolvedEnvironmentAssets,
};
