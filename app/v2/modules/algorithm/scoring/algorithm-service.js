"use strict";

const {
  SITUATION_OBSERVED_SCHEMA_VERSION,
} = require("../../../shared/contracts/algorithm-v0");
const {
  buildScoreFeed,
  catalogFromRunSnapshot,
  defaultAlgorithmConfig,
  observedScoreForEvent,
} = require("./score-engine");
const {
  readAlgorithmRunState,
  saveAlgorithmRunState,
} = require("../score-history/state-store");

function assertNoRuntimeOwnershipFields(payload) {
  const forbidden = [
    "availablePool",
    "pathAvailable",
    "pathLocked",
    "eligiblePool",
    "preparedNext",
    "resolvedPreparedNext",
    "activeSituation",
    "playedSituations",
    "order",
  ];
  for (const key of forbidden) {
    if (Object.prototype.hasOwnProperty.call(payload || {}, key)) {
      throw new Error(`algorithm_forbidden_runtime_field:${key}`);
    }
  }
}

async function createAlgorithmRun({ showRunId, runSnapshot, catalog, config } = {}) {
  if (!showRunId) throw new Error("algorithm_missing_show_run_id");
  const catalogSnapshot = catalogFromRunSnapshot(runSnapshot || catalog);
  if (!catalogSnapshot) throw new Error("algorithm_missing_catalog_snapshot");
  const state = {
    schemaVersion: "algorithm.run-state.v0",
    showRunId,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    source: {
      type: runSnapshot ? "runtime-run-snapshot" : "catalog-snapshot",
      readOnly: true,
    },
    config: config || defaultAlgorithmConfig(),
    catalog: catalogSnapshot,
    observations: [],
    scoreFeed: buildScoreFeed({
      showRunId,
      catalog: catalogSnapshot,
      observations: [],
      config: config || defaultAlgorithmConfig(),
    }),
    log: [{
      type: "algorithm_run_created",
      at: new Date().toISOString(),
      situationCount: (catalogSnapshot.situations || []).length,
    }],
  };
  await saveAlgorithmRunState(state);
  return state;
}

async function getScoreFeed(showRunId) {
  const state = await readAlgorithmRunState(showRunId);
  return state.scoreFeed;
}

async function observeSituation(event) {
  assertNoRuntimeOwnershipFields(event);
  if (!event || event.type !== "situationObserved") throw new Error("algorithm_invalid_observed_event_type");
  if (!event.showRunId) throw new Error("algorithm_missing_show_run_id");
  if (!event.situationRunId) throw new Error("algorithm_missing_situation_run_id");
  if (!event.situationId) throw new Error("algorithm_missing_situation_id");
  const state = await readAlgorithmRunState(event.showRunId);
  const observedScore = observedScoreForEvent(event, state.config);
  const observation = {
    schemaVersion: SITUATION_OBSERVED_SCHEMA_VERSION,
    type: "situationObserved",
    showRunId: event.showRunId,
    situationRunId: event.situationRunId,
    situationId: event.situationId,
    startedAt: event.startedAt || null,
    endedAt: event.endedAt || null,
    durationSeconds: Number(event.durationSeconds || 0),
    audience: event.audience || {},
    chatAppSignals: event.chatAppSignals || {},
    reactionLabSignals: event.reactionLabSignals || {},
    observedScore,
    observedAt: new Date().toISOString(),
  };
  state.observations.push(observation);
  state.scoreFeed = buildScoreFeed({
    showRunId: state.showRunId,
    catalog: state.catalog,
    observations: state.observations,
    config: state.config,
  });
  state.updatedAt = new Date().toISOString();
  state.log.push({
    type: "situation_observed",
    at: state.updatedAt,
    situationRunId: observation.situationRunId,
    situationId: observation.situationId,
    observedScore,
  });
  await saveAlgorithmRunState(state);
  return {
    observation,
    scoreFeed: state.scoreFeed,
  };
}

module.exports = {
  assertNoRuntimeOwnershipFields,
  createAlgorithmRun,
  getScoreFeed,
  observeSituation,
};
