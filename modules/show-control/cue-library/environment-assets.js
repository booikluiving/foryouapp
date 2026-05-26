"use strict";

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

function normalizeAsset(asset, { environmentId = "", role = "" } = {}) {
  const source = asObject(asset);
  if (!source) return null;
  const id = assetIdOf(source);
  const resolvedRole = assetRoleOf(source) || role;
  const resolvedType = String(source.type || (resolvedRole === "soundscape" ? "soundscape" : resolvedRole === "background" ? "background" : "")).trim();
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
    source: source.source || null,
  };
}

function catalogFromRuntimeState(runtimeState = {}) {
  return runtimeState.showRunSnapshot && runtimeState.showRunSnapshot.catalog
    ? runtimeState.showRunSnapshot.catalog
    : {};
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

function existingAsset(resolved = {}, role) {
  const assets = asObject(resolved.assets) || {};
  return asObject(assets[role]) || null;
}

function resolvedEnvironmentAssets(runtimeState, resolved) {
  const environmentId = environmentIdFromResolved(resolved);
  const catalog = catalogFromRuntimeState(runtimeState);
  const existingAssets = asObject(resolved.assets) || {};
  const background = normalizeAsset(
    existingAsset(resolved, "background") || preferredAssetForRole(catalog, environmentId, "background"),
    { environmentId, role: "background" }
  );
  const soundscape = normalizeAsset(
    existingAsset(resolved, "soundscape") || preferredAssetForRole(catalog, environmentId, "soundscape"),
    { environmentId, role: "soundscape" }
  );
  return {
    environmentId,
    assets: {
      ...cloneJson(existingAssets),
      ...(background ? { background } : {}),
      ...(soundscape ? { soundscape } : {}),
    },
    background,
    soundscape,
  };
}

function enrichPayloadWithEnvironmentAssets(payload, runtimeState, resolved) {
  const enriched = { ...payload };
  const environmentAssets = resolvedEnvironmentAssets(runtimeState, resolved);
  if (environmentAssets.environmentId && !enriched.environmentId) {
    enriched.environmentId = environmentAssets.environmentId;
  }
  enriched.assets = environmentAssets.assets;
  enriched.environmentAssets = {
    ...(environmentAssets.background ? { background: environmentAssets.background } : {}),
    ...(environmentAssets.soundscape ? { soundscape: environmentAssets.soundscape } : {}),
  };
  if (environmentAssets.background) {
    enriched.backgroundAsset = environmentAssets.background;
    enriched.assetId = environmentAssets.background.assetId;
    enriched.type = environmentAssets.background.type || "background";
    enriched.role = environmentAssets.background.role || "background";
    enriched.filePath = environmentAssets.background.filePath || "";
    enriched.url = environmentAssets.background.url || "";
  }
  return enriched;
}

module.exports = {
  enrichPayloadWithEnvironmentAssets,
  environmentIdFromResolved,
  normalizeAsset,
  resolvedEnvironmentAssets,
};
