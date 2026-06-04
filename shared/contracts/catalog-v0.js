"use strict";

const CATALOG_SCHEMA_VERSION = "catalog.read-model.v0";
const CATALOG_SNAPSHOT_SCHEMA_VERSION = "catalog.snapshot.v0";

const ENTITY_PREFIXES = Object.freeze({
  performer: "performer",
  character: "character",
  environment: "environment",
  situation: "situation",
  label: "label",
  mediaAsset: "media-asset",
});

const REQUIRED_READ_MODEL_ARRAYS = Object.freeze([
  "performers",
  "characters",
  "environments",
  "situations",
  "labels",
  "mediaAssets",
  "lightingPresets",
]);

function toCatalogId(entityType, legacyId) {
  const prefix = ENTITY_PREFIXES[entityType];
  if (!prefix) throw new Error(`unknown_catalog_entity_type:${entityType}`);
  const safeLegacyId = Number(legacyId);
  if (!Number.isInteger(safeLegacyId) || safeLegacyId < 1) {
    throw new Error(`invalid_legacy_id:${entityType}`);
  }
  return `${prefix}:${safeLegacyId}`;
}

function toMediaAssetId(environmentLegacyId, assetType) {
  const safeEnvironmentLegacyId = Number(environmentLegacyId);
  if (!Number.isInteger(safeEnvironmentLegacyId) || safeEnvironmentLegacyId < 1) {
    throw new Error("invalid_media_asset_environment_id");
  }
  const safeAssetType = String(assetType || "").trim();
  if (!safeAssetType) throw new Error("invalid_media_asset_type");
  return `${ENTITY_PREFIXES.mediaAsset}:environment:${safeEnvironmentLegacyId}:${safeAssetType}`;
}

function validateCatalogReadModelShape(readModel) {
  const issues = [];
  if (!readModel || typeof readModel !== "object" || Array.isArray(readModel)) {
    return [{ code: "invalid_read_model", message: "Catalog read model must be an object." }];
  }
  if (readModel.schemaVersion !== CATALOG_SCHEMA_VERSION) {
    issues.push({
      code: "invalid_schema_version",
      message: `Expected schemaVersion ${CATALOG_SCHEMA_VERSION}.`,
    });
  }
  for (const key of REQUIRED_READ_MODEL_ARRAYS) {
    if (!Array.isArray(readModel[key])) {
      issues.push({
        code: "missing_array",
        field: key,
        message: `Catalog read model must include array field ${key}.`,
      });
    }
  }
  if (!readModel.source || typeof readModel.source !== "object") {
    issues.push({
      code: "missing_source",
      message: "Catalog read model must include source metadata.",
    });
  }
  return issues;
}

module.exports = {
  CATALOG_SCHEMA_VERSION,
  CATALOG_SNAPSHOT_SCHEMA_VERSION,
  REQUIRED_READ_MODEL_ARRAYS,
  toCatalogId,
  toMediaAssetId,
  validateCatalogReadModelShape,
};
