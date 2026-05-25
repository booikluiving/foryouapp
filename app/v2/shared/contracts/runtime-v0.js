"use strict";

const RUNTIME_STATE_SCHEMA_VERSION = "runtime.state.v0";
const SHOW_RUN_SNAPSHOT_SCHEMA_VERSION = "runtime.show-run-snapshot.v0";
const ALGORITHM_CONFIG_SNAPSHOT_SCHEMA_VERSION = "algorithm.config.placeholder.v0";

function createShowRunId(createdAtDate = new Date()) {
  const stamp = createdAtDate.toISOString().replace(/[-:.]/g, "").replace("T", "-").replace("Z", "Z");
  return `show-run-${stamp}`;
}

function createSituationRunId(showRunId, sequence) {
  const safeSequence = Number(sequence);
  if (!Number.isInteger(safeSequence) || safeSequence < 1) throw new Error("invalid_situation_run_sequence");
  return `${showRunId}:situation-run:${String(safeSequence).padStart(4, "0")}`;
}

function validateRuntimeStateShape(state) {
  const issues = [];
  if (!state || typeof state !== "object" || Array.isArray(state)) {
    return [{ code: "invalid_runtime_state", message: "Runtime state must be an object." }];
  }
  if (state.schemaVersion !== RUNTIME_STATE_SCHEMA_VERSION) {
    issues.push({
      code: "invalid_schema_version",
      message: `Expected schemaVersion ${RUNTIME_STATE_SCHEMA_VERSION}.`,
    });
  }
  if (!state.showRunId) issues.push({ code: "missing_show_run_id", message: "Runtime state requires showRunId." });
  if (!state.showRunSnapshot) {
    issues.push({ code: "missing_show_run_snapshot", message: "Runtime state requires showRunSnapshot." });
  }
  if (!Array.isArray(state.playedSituations)) {
    issues.push({ code: "missing_played_situations", message: "Runtime state requires playedSituations array." });
  }
  return issues;
}

module.exports = {
  ALGORITHM_CONFIG_SNAPSHOT_SCHEMA_VERSION,
  RUNTIME_STATE_SCHEMA_VERSION,
  SHOW_RUN_SNAPSHOT_SCHEMA_VERSION,
  createShowRunId,
  createSituationRunId,
  validateRuntimeStateShape,
};
