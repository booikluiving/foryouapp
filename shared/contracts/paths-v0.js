"use strict";

const PATHS_SNAPSHOT_SCHEMA_VERSION = "paths.snapshot.v0";
const PATHS_EVALUATION_SCHEMA_VERSION = "paths.evaluation.v0";

function toPathId(legacyId) {
  const safeLegacyId = Number(legacyId);
  if (!Number.isInteger(safeLegacyId) || safeLegacyId < 1) {
    throw new Error("invalid_legacy_path_id");
  }
  return `path:${safeLegacyId}`;
}

function toSituationId(legacySceneId) {
  const safeLegacyId = Number(legacySceneId);
  if (!Number.isInteger(safeLegacyId) || safeLegacyId < 1) {
    throw new Error("invalid_legacy_situation_id");
  }
  return `situation:${safeLegacyId}`;
}

function fromSituationId(value) {
  if (Number.isInteger(value) && value > 0) return value;
  const match = String(value || "").match(/^situation:(\d+)$/);
  if (!match) return null;
  const legacyId = Number(match[1]);
  return Number.isInteger(legacyId) && legacyId > 0 ? legacyId : null;
}

function validatePathsSnapshotShape(snapshot) {
  const issues = [];
  if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot)) {
    return [{ code: "invalid_paths_snapshot", message: "Paths snapshot must be an object." }];
  }
  if (snapshot.schemaVersion !== PATHS_SNAPSHOT_SCHEMA_VERSION) {
    issues.push({
      code: "invalid_schema_version",
      message: `Expected schemaVersion ${PATHS_SNAPSHOT_SCHEMA_VERSION}.`,
    });
  }
  for (const key of ["paths", "crossingThresholds"]) {
    if (!Array.isArray(snapshot[key])) {
      issues.push({
        code: "missing_array",
        field: key,
        message: `Paths snapshot must include array field ${key}.`,
      });
    }
  }
  if (!snapshot.source || typeof snapshot.source !== "object") {
    issues.push({
      code: "missing_source",
      message: "Paths snapshot must include source metadata.",
    });
  }
  return issues;
}

module.exports = {
  PATHS_EVALUATION_SCHEMA_VERSION,
  PATHS_SNAPSHOT_SCHEMA_VERSION,
  fromSituationId,
  toPathId,
  toSituationId,
  validatePathsSnapshotShape,
};
