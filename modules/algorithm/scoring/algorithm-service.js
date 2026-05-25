"use strict";

const {
  SITUATION_OBSERVED_SCHEMA_VERSION,
} = require("../../../shared/contracts/algorithm-v0");
const {
  buildScoreFeed,
  catalogFromRunSnapshot,
  defaultAlgorithmConfig,
  normalizeAlgorithmConfig,
  observedScoreForEvent,
} = require("./score-engine");
const {
  listScoringContextStates,
  readAlgorithmConfigFile,
  readScoringContextState,
  saveAlgorithmConfigFile,
  saveScoringContextState,
} = require("../score-history/state-store");

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function assertNoRuntimeOwnershipFields(payload) {
  const forbidden = [
    "availablePool",
    "pathAvailablePool",
    "pathLockedPool",
    "pathAvailable",
    "pathLocked",
    "eligiblePool",
    "preparedNext",
    "resolvedPreparedNext",
    "activeSituation",
    "playedSituations",
    "playedHistory",
    "order",
    "currentOrder",
    "runtimeCandidates",
  ];
  const walk = (value) => {
    if (!value || typeof value !== "object") return null;
    if (Array.isArray(value)) {
      for (const item of value) {
        const nested = walk(item);
        if (nested) return nested;
      }
      return null;
    }
    for (const key of Object.keys(value)) {
      if (forbidden.includes(key)) return key;
      const nested = walk(value[key]);
      if (nested) return nested;
    }
    return null;
  };
  const found = walk(payload);
  if (found) throw new Error(`algorithm_forbidden_runtime_field:${found}`);
}

function assertNoPromptSettings(payload) {
  const forbidden = ["globalPrompt", "promptTemplate", "systemPrompt", "scenePrompt", "promptSettings"];
  for (const key of forbidden) {
    if (Object.prototype.hasOwnProperty.call(payload || {}, key)) {
      throw new Error(`algorithm_forbidden_prompt_field:${key}`);
    }
  }
}

async function readAlgorithmConfig() {
  try {
    return normalizeAlgorithmConfig(await readAlgorithmConfigFile());
  } catch (err) {
    if (!err || err.code !== "ENOENT") throw err;
    return defaultAlgorithmConfig();
  }
}

async function updateAlgorithmConfig(patch = {}, options = {}) {
  assertNoRuntimeOwnershipFields(patch);
  assertNoPromptSettings(patch);
  const current = options.replace ? defaultAlgorithmConfig() : await readAlgorithmConfig();
  const normalized = normalizeAlgorithmConfig(patch, { base: current });
  normalized.createdAt = current.createdAt || normalized.createdAt;
  normalized.updatedAt = new Date().toISOString();
  normalized.source = {
    type: "algorithm-v0-config",
    readOnly: false,
  };
  await saveAlgorithmConfigFile(normalized);
  return normalized;
}

async function getAlgorithmConfigSnapshot() {
  const config = normalizeAlgorithmConfig(await readAlgorithmConfig());
  return {
    ...config,
    source: {
      type: "algorithm-v0-config-snapshot",
      readOnly: true,
    },
    snapshotAt: new Date().toISOString(),
  };
}

function situationById(catalog, situationId) {
  return ((catalog && catalog.situations) || []).find((item) => item && item.id === situationId) || null;
}

function observationContext(catalog, situationId) {
  const situation = situationById(catalog, situationId);
  return {
    labelIds: situation && Array.isArray(situation.labelIds) ? situation.labelIds : [],
    characterIds: situation && Array.isArray(situation.characterIds) ? situation.characterIds : [],
  };
}

function eventHasAudienceSignalPayload(event = {}) {
  const chatAppSignals = event.chatAppSignals || {};
  const audience = event.audience || {};
  return Number(chatAppSignals.heartCount || 0) > 0
    || Number(chatAppSignals.boredCount || 0) > 0
    || (Array.isArray(chatAppSignals.rawMessages) && chatAppSignals.rawMessages.length > 0)
    || (Array.isArray(event.rawChat) && event.rawChat.length > 0)
    || Number(audience.linkedSignalCount || 0) > 0;
}

function applyLiveObservationFallback(event = {}, state = {}) {
  if (eventHasAudienceSignalPayload(event)) return event;
  const live = state && state.liveAudienceObservation;
  if (!live || live.situationRunId !== event.situationRunId) return event;
  return {
    ...event,
    audience: cloneJson(live.audience || {}),
    chatAppSignals: cloneJson(live.chatAppSignals || {}),
    rawChat: Array.isArray(live.rawChat) ? cloneJson(live.rawChat) : [],
    finalizedFromLiveAudience: true,
  };
}

function normalizeStoredState(state) {
  const catalog = catalogFromRunSnapshot(state && state.catalog ? state.catalog : state);
  const config = normalizeAlgorithmConfig(state && state.config ? state.config : defaultAlgorithmConfig());
  const observations = Array.isArray(state && state.observations) ? state.observations.map((observation) => ({
    ...observation,
    ...observationContext(catalog, observation.situationId),
  })) : [];
  const liveAudienceObservation = state && state.liveAudienceObservation
    ? {
      ...state.liveAudienceObservation,
      ...observationContext(catalog, state.liveAudienceObservation.situationId),
    }
    : null;
  const scoreFeed = buildScoreFeed({
    showRunId: state.showRunId,
    catalog,
    observations,
    liveObservation: liveAudienceObservation,
    config,
  });
  return {
    ...state,
    schemaVersion: "algorithm.score-state.v0",
    contextType: "scoring-context",
    config,
    catalog,
    observations,
    liveAudienceObservation,
    scoreFeed,
  };
}

function summarizeScoringContext(state) {
  return {
    schemaVersion: state.schemaVersion || "algorithm.score-state.v0",
    contextType: "scoring-context",
    showRunId: state.showRunId,
    createdAt: state.createdAt || null,
    updatedAt: state.updatedAt || null,
    source: state.source || null,
    situationCount: state.catalog && Array.isArray(state.catalog.situations) ? state.catalog.situations.length : 0,
    observationCount: Array.isArray(state.observations) ? state.observations.length : 0,
    latestSituationRunId: state.scoreFeed ? state.scoreFeed.updatedAfterSituationRunId : null,
    scoreCount: state.scoreFeed && Array.isArray(state.scoreFeed.scores) ? state.scoreFeed.scores.length : 0,
  };
}

async function createScoringContext({ showRunId, runSnapshot, catalog, config } = {}) {
  assertNoRuntimeOwnershipFields({ showRunId, runSnapshot, catalog, config });
  assertNoPromptSettings(config || {});
  if (!showRunId) throw new Error("algorithm_missing_show_run_id");
  const catalogSnapshot = catalogFromRunSnapshot(runSnapshot || catalog);
  if (!catalogSnapshot) throw new Error("algorithm_missing_catalog_snapshot");
  const scoringConfig = normalizeAlgorithmConfig(config || await readAlgorithmConfig());
  const state = {
    schemaVersion: "algorithm.score-state.v0",
    contextType: "scoring-context",
    showRunId,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    source: {
      type: runSnapshot ? "runtime-run-snapshot" : "catalog-snapshot",
      readOnly: true,
    },
    config: scoringConfig,
    catalog: catalogSnapshot,
    observations: [],
    scoreFeed: buildScoreFeed({
      showRunId,
      catalog: catalogSnapshot,
      observations: [],
      config: scoringConfig,
    }),
    log: [{
      type: "scoring_context_created",
      at: new Date().toISOString(),
      situationCount: (catalogSnapshot.situations || []).length,
    }],
  };
  await saveScoringContextState(state);
  return state;
}

async function createAlgorithmRun(options = {}) {
  return createScoringContext(options);
}

async function getScoringContext(showRunId) {
  return normalizeStoredState(await readScoringContextState(showRunId));
}

async function listScoringContexts() {
  const states = await listScoringContextStates();
  return {
    ok: true,
    contexts: states.map((state) => summarizeScoringContext(normalizeStoredState(state))),
  };
}

async function getScoreFeed(showRunId) {
  const state = await getScoringContext(showRunId);
  return state.scoreFeed;
}

async function buildObservation(event, state) {
  assertNoRuntimeOwnershipFields(event);
  if (!event || event.type !== "situationObserved") throw new Error("algorithm_invalid_observed_event_type");
  if (!event.showRunId) throw new Error("algorithm_missing_show_run_id");
  if (!event.situationRunId) throw new Error("algorithm_missing_situation_run_id");
  if (!event.situationId) throw new Error("algorithm_missing_situation_id");
  const sourceEvent = applyLiveObservationFallback(event, state);
  const observedScore = observedScoreForEvent(sourceEvent, state.config);
  const context = observationContext(state.catalog, sourceEvent.situationId);
  return {
    schemaVersion: SITUATION_OBSERVED_SCHEMA_VERSION,
    type: "situationObserved",
    showRunId: sourceEvent.showRunId,
    situationRunId: sourceEvent.situationRunId,
    situationId: sourceEvent.situationId,
    labelIds: context.labelIds,
    characterIds: context.characterIds,
    startedAt: sourceEvent.startedAt || null,
    endedAt: sourceEvent.endedAt || null,
    durationSeconds: Number(sourceEvent.durationSeconds || 0),
    audience: sourceEvent.audience || {},
    chatAppSignals: sourceEvent.chatAppSignals || {},
    reactionLabSignals: sourceEvent.reactionLabSignals || {},
    rawChat: Array.isArray(sourceEvent.rawChat) ? cloneJson(sourceEvent.rawChat) : [],
    finalizedFromAudienceAggregate: !!sourceEvent.finalizedFromAudienceAggregate,
    finalizedFromLiveAudience: !!sourceEvent.finalizedFromLiveAudience,
    observedScore,
    observedAt: new Date().toISOString(),
  };
}

function durationSecondsForLiveEvent(event) {
  if (event && event.durationSeconds != null) return Number(event.durationSeconds || 0);
  const startedMs = Date.parse(String(event && event.startedAt || ""));
  const createdMs = Date.parse(String(event && (event.createdAt || event.receivedAt) || ""));
  const endedMs = Number.isFinite(createdMs) ? createdMs : Date.now();
  if (!Number.isFinite(startedMs) || !Number.isFinite(endedMs)) return 60;
  return Math.max(1, Math.round((endedMs - startedMs) / 1000));
}

async function buildLiveAudienceObservation(event, state) {
  assertNoRuntimeOwnershipFields(event);
  if (!event || typeof event !== "object") throw new Error("algorithm_invalid_audience_signal_event");
  if (!event.showRunId) throw new Error("algorithm_missing_show_run_id");
  if (!event.situationRunId) throw new Error("algorithm_missing_situation_run_id");
  if (!event.situationId) throw new Error("algorithm_missing_situation_id");
  const liveEvent = {
    ...event,
    durationSeconds: durationSecondsForLiveEvent(event),
  };
  const observedScore = observedScoreForEvent(liveEvent, state.config);
  const context = observationContext(state.catalog, event.situationId);
  return {
    schemaVersion: "algorithm.audience-signals-live.v0",
    type: "audienceSignalsLive",
    scorePhase: "live",
    showRunId: event.showRunId,
    situationRunId: event.situationRunId,
    situationId: event.situationId,
    labelIds: context.labelIds,
    characterIds: context.characterIds,
    startedAt: event.startedAt || null,
    createdAt: event.createdAt || null,
    durationSeconds: liveEvent.durationSeconds,
    audience: event.audience || {},
    chatAppSignals: event.chatAppSignals || {},
    rawChat: Array.isArray(event.rawChat) ? cloneJson(event.rawChat) : [],
    audienceAggregateVersion: event.audienceAggregateVersion == null ? null : Number(event.audienceAggregateVersion),
    observedScore,
    observedAt: new Date().toISOString(),
  };
}

async function observeAudienceSignals(event) {
  const state = await getScoringContext(event && event.showRunId);
  const alreadyObserved = (state.observations || []).some((observation) => (
    observation && event && observation.situationRunId === event.situationRunId
  ));
  if (alreadyObserved) {
    return {
      ok: true,
      ignored: true,
      ignoredReason: "situation_already_observed",
      scorePhase: state.scoreFeed && state.scoreFeed.scorePhase ? state.scoreFeed.scorePhase : "definitive",
      scoreFeed: state.scoreFeed,
    };
  }
  const liveAudienceObservation = await buildLiveAudienceObservation(event, state);
  const scoreFeed = buildScoreFeed({
    showRunId: state.showRunId,
    catalog: state.catalog,
    observations: state.observations,
    liveObservation: liveAudienceObservation,
    config: state.config,
  });
  scoreFeed.audienceAggregateVersion = liveAudienceObservation.audienceAggregateVersion;
  scoreFeed.scoreFeedRevision = liveAudienceObservation.audienceAggregateVersion;
  state.liveAudienceObservation = liveAudienceObservation;
  state.liveAudienceInput = {
    showRunId: liveAudienceObservation.showRunId,
    situationRunId: liveAudienceObservation.situationRunId,
    situationId: liveAudienceObservation.situationId,
    createdAt: liveAudienceObservation.createdAt,
    observedAt: liveAudienceObservation.observedAt,
    audience: cloneJson(liveAudienceObservation.audience),
    chatAppSignals: cloneJson(liveAudienceObservation.chatAppSignals),
    audienceAggregateVersion: liveAudienceObservation.audienceAggregateVersion,
    rawChatCount: liveAudienceObservation.rawChat.length,
  };
  state.liveScoreFeed = scoreFeed;
  state.scoreFeed = scoreFeed;
  state.updatedAt = new Date().toISOString();
  state.log = Array.isArray(state.log) ? state.log : [];
  state.log.push({
    type: "audience_signals_live",
    at: state.updatedAt,
    situationRunId: liveAudienceObservation.situationRunId,
    situationId: liveAudienceObservation.situationId,
    observedScore: liveAudienceObservation.observedScore,
  });
  await saveScoringContextState(state);
  return {
    ok: true,
    scorePhase: "live",
    liveAudienceObservation,
    scoreFeed,
  };
}

async function observeSituation(event) {
  const state = await getScoringContext(event && event.showRunId);
  const observation = await buildObservation(event, state);
  const observedScore = observation.observedScore;
  state.observations.push(observation);
  state.scoreFeed = buildScoreFeed({
    showRunId: state.showRunId,
    catalog: state.catalog,
    observations: state.observations,
    config: state.config,
  });
  state.liveAudienceObservation = null;
  state.liveAudienceInput = null;
  state.liveScoreFeed = null;
  state.updatedAt = new Date().toISOString();
  state.log = Array.isArray(state.log) ? state.log : [];
  state.log.push({
    type: "situation_observed",
    at: state.updatedAt,
    situationRunId: observation.situationRunId,
    situationId: observation.situationId,
    observedScore,
  });
  await saveScoringContextState(state);
  return {
    observation,
    scoreFeed: state.scoreFeed,
  };
}

async function simulateSituationObservation(event) {
  const state = await getScoringContext(event && event.showRunId);
  const observation = await buildObservation({
    ...event,
    type: "situationObserved",
    situationRunId: event && event.situationRunId ? event.situationRunId : `${state.showRunId}:simulation`,
  }, state);
  const simulatedObservations = [...state.observations, {
    ...observation,
    simulated: true,
  }];
  const scoreFeed = buildScoreFeed({
    showRunId: state.showRunId,
    catalog: state.catalog,
    observations: simulatedObservations,
    config: state.config,
  });
  return {
    ok: true,
    persisted: false,
    observation: {
      ...observation,
      simulated: true,
    },
    scoreFeed,
  };
}

module.exports = {
  assertNoPromptSettings,
  assertNoRuntimeOwnershipFields,
  createAlgorithmRun,
  createScoringContext,
  getAlgorithmConfigSnapshot,
  getScoreFeed,
  getScoringContext,
  listScoringContexts,
  observeAudienceSignals,
  observeSituation,
  readAlgorithmConfig,
  simulateSituationObservation,
  summarizeScoringContext,
  updateAlgorithmConfig,
};
