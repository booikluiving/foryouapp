"use strict";

const crypto = require("node:crypto");

const {
  ALGORITHM_CONFIG_SNAPSHOT_SCHEMA_VERSION,
  RUNTIME_STATE_SCHEMA_VERSION,
  SHOW_RUN_SNAPSHOT_SCHEMA_VERSION,
  createShowRunId,
  createSituationRunId,
} = require("../../../shared/contracts/runtime-v0");
const { materializePreparedNext } = require("../materialization/materialize");
const { saveRunState } = require("./state-store");

function placeholderAlgorithmConfigSnapshot() {
  return {
    schemaVersion: ALGORITHM_CONFIG_SNAPSHOT_SCHEMA_VERSION,
    source: {
      type: "runtime-v0-placeholder",
      readOnly: true,
    },
    scorePolicy: "neutral",
    scoresFrozenByRuntime: false,
    createdAt: new Date().toISOString(),
  };
}

function activeCatalogSituations(catalog) {
  return (catalog.situations || []).filter((item) => item.active && !item.archivedAt);
}

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function catalogSituationMap(catalog) {
  return new Map(activeCatalogSituations(catalog).map((item) => [item.id, item]));
}

function createShowRunSnapshot({ catalog, paths, algorithmConfig }) {
  return {
    schemaVersion: SHOW_RUN_SNAPSHOT_SCHEMA_VERSION,
    createdAt: new Date().toISOString(),
    catalog: cloneJson(catalog),
    paths: cloneJson(paths),
    algorithmConfig: cloneJson(algorithmConfig),
  };
}

function isPathStart(statusItem) {
  return (statusItem.pathStatuses || []).some((item) => item.status === "available" && item.isPathStart);
}

function charactersOverlap(a, b) {
  if (!a || !b) return false;
  const left = new Set(a.characterIds || []);
  return (b.characterIds || []).some((id) => left.has(id));
}

function sameEnvironment(a, b) {
  return !!(a && b && a.environmentId && b.environmentId && a.environmentId === b.environmentId);
}

function buildEligiblePool({ catalog, pathEvaluation, playedSituations, activeSituation, lastPlayedSituation }) {
  const situationMap = catalogSituationMap(catalog);
  const playedSet = new Set((playedSituations || []).map((item) => item.situationId));
  const activeSituationId = activeSituation ? activeSituation.situationId : null;
  const available = (pathEvaluation.items || [])
    .filter((item) => item.status === "available")
    .filter((item) => situationMap.has(item.situationId))
    .filter((item) => !playedSet.has(item.situationId))
    .filter((item) => item.situationId !== activeSituationId)
    .map((item) => ({
      situationId: item.situationId,
      legacySituationId: item.legacySituationId,
      isPathStart: isPathStart(item),
      pathStatus: item,
      situation: situationMap.get(item.situationId),
    }));

  const startCandidates = available.filter((item) => item.isPathStart);
  const orderedBase = startCandidates.length > 0 ? startCandidates : available;
  const hardFiltered = orderedBase.filter((item) => {
    if (lastPlayedSituation && charactersOverlap(item.situation, lastPlayedSituation)) return false;
    if (lastPlayedSituation && sameEnvironment(item.situation, lastPlayedSituation)) return false;
    return true;
  });
  const finalCandidates = hardFiltered.length > 0 ? hardFiltered : orderedBase;

  return finalCandidates
    .sort((a, b) => {
      const sortA = Number(a.situation.sortOrder || 0);
      const sortB = Number(b.situation.sortOrder || 0);
      if (sortA !== sortB) return sortA - sortB;
      return a.legacySituationId - b.legacySituationId;
    })
    .map((item) => ({
      situationId: item.situationId,
      legacySituationId: item.legacySituationId,
      title: item.situation.title,
      isPathStart: item.isPathStart,
      reason: item.isPathStart ? "path_start" : "path_available",
    }));
}

function choosePreparedNext({ catalog, eligiblePool, reason = "runtime_order" }) {
  if (!eligiblePool || eligiblePool.length === 0) return null;
  const candidate = eligiblePool[0];
  const seed = crypto.createHash("sha256")
    .update(`${candidate.situationId}:${Date.now()}:${Math.random()}`)
    .digest("hex")
    .slice(0, 16);
  return {
    situationId: candidate.situationId,
    legacySituationId: candidate.legacySituationId,
    title: candidate.title,
    chosenAt: new Date().toISOString(),
    reason,
    seed,
    resolvedPreparedNext: materializePreparedNext({
      catalog,
      preparedNext: candidate,
      seed,
    }),
  };
}

async function computeAndSetPreparedNext(state, clients, reason = "runtime_order") {
  const playedSituationIds = (state.playedSituations || []).map((item) => item.situationId);
  const pathEvaluation = await clients.evaluatePaths(playedSituationIds);
  const lastPlayedSituationId = state.playedSituations.length
    ? state.playedSituations[state.playedSituations.length - 1].situationId
    : null;
  const catalogMap = catalogSituationMap(state.showRunSnapshot.catalog);
  const eligiblePool = buildEligiblePool({
    catalog: state.showRunSnapshot.catalog,
    pathEvaluation,
    playedSituations: state.playedSituations,
    activeSituation: state.activeSituation,
    lastPlayedSituation: lastPlayedSituationId ? catalogMap.get(lastPlayedSituationId) : null,
  });
  const prepared = choosePreparedNext({
    catalog: state.showRunSnapshot.catalog,
    eligiblePool,
    reason,
  });
  state.pathEvaluation = pathEvaluation;
  state.eligiblePool = eligiblePool;
  state.preparedNext = prepared ? {
    situationId: prepared.situationId,
    legacySituationId: prepared.legacySituationId,
    title: prepared.title,
    chosenAt: prepared.chosenAt,
    reason: prepared.reason,
    seed: prepared.seed,
  } : null;
  state.resolvedPreparedNext = prepared ? prepared.resolvedPreparedNext : null;
  state.updatedAt = new Date().toISOString();
  state.runLog.push({
    type: prepared ? "prepared_next_set" : "prepared_next_empty",
    at: state.updatedAt,
    reason,
    situationId: prepared ? prepared.situationId : null,
    eligibleCount: eligiblePool.length,
  });
  return state;
}

async function refreshEligiblePool(state, clients, reason = "runtime_refresh") {
  const playedSituationIds = (state.playedSituations || []).map((item) => item.situationId);
  const pathEvaluation = await clients.evaluatePaths(playedSituationIds);
  const lastPlayedSituationId = state.playedSituations.length
    ? state.playedSituations[state.playedSituations.length - 1].situationId
    : null;
  const catalogMap = catalogSituationMap(state.showRunSnapshot.catalog);
  state.pathEvaluation = pathEvaluation;
  state.eligiblePool = buildEligiblePool({
    catalog: state.showRunSnapshot.catalog,
    pathEvaluation,
    playedSituations: state.playedSituations,
    activeSituation: state.activeSituation,
    lastPlayedSituation: lastPlayedSituationId ? catalogMap.get(lastPlayedSituationId) : null,
  });
  state.updatedAt = new Date().toISOString();
  state.runLog.push({
    type: "eligible_pool_refreshed",
    at: state.updatedAt,
    reason,
    eligibleCount: state.eligiblePool.length,
    preparedNextFrozen: !!state.preparedNext,
  });
  return state;
}

async function startRun({ clients }) {
  const createdAtDate = new Date();
  const showRunId = createShowRunId(createdAtDate);
  const catalog = await clients.fetchCatalogSnapshot();
  const paths = await clients.fetchPathsSnapshot();
  const algorithmConfig = placeholderAlgorithmConfigSnapshot();
  const showRunSnapshot = createShowRunSnapshot({ catalog, paths, algorithmConfig });
  const state = {
    schemaVersion: RUNTIME_STATE_SCHEMA_VERSION,
    showRunId,
    status: "running",
    createdAt: createdAtDate.toISOString(),
    updatedAt: createdAtDate.toISOString(),
    showRunSnapshot,
    preparedNext: null,
    resolvedPreparedNext: null,
    activeSituation: null,
    situationRuns: [],
    playedSituations: [],
    pathEvaluation: null,
    eligiblePool: [],
    runLog: [{
      type: "show_run_started",
      at: createdAtDate.toISOString(),
      showRunId,
    }],
  };
  await computeAndSetPreparedNext(state, clients, "start_run");
  await saveRunState(state);
  return state;
}

async function startSituation(state, clients) {
  if (!state.resolvedPreparedNext) throw new Error("runtime_no_resolved_prepared_next");
  if (state.activeSituation) throw new Error("runtime_active_situation_exists");
  const sequence = state.situationRuns.length + 1;
  const situationRunId = createSituationRunId(state.showRunId, sequence);
  const startedAt = new Date().toISOString();
  const activeSituation = {
    situationRunId,
    situationId: state.resolvedPreparedNext.situationId,
    legacySituationId: state.resolvedPreparedNext.legacySituationId,
    title: state.resolvedPreparedNext.title,
    resolved: state.resolvedPreparedNext,
    startedAt,
    status: "active",
  };
  state.situationRuns.push({
    situationRunId,
    situationId: activeSituation.situationId,
    legacySituationId: activeSituation.legacySituationId,
    startedAt,
    endedAt: null,
    status: "active",
  });
  state.activeSituation = activeSituation;
  state.preparedNext = null;
  state.resolvedPreparedNext = null;
  state.updatedAt = startedAt;
  state.runLog.push({
    type: "situation_started",
    at: startedAt,
    situationRunId,
    situationId: activeSituation.situationId,
  });
  await computeAndSetPreparedNext(state, clients, "after_start_situation");
  await saveRunState(state);
  return state;
}

async function stopSituation(state, clients) {
  if (!state.activeSituation) throw new Error("runtime_no_active_situation");
  const stoppedAt = new Date().toISOString();
  const active = state.activeSituation;
  const run = state.situationRuns.find((item) => item.situationRunId === active.situationRunId);
  if (run) {
    run.endedAt = stoppedAt;
    run.status = "played";
  }
  state.playedSituations.push({
    situationRunId: active.situationRunId,
    situationId: active.situationId,
    legacySituationId: active.legacySituationId,
    startedAt: active.startedAt,
    stoppedAt,
  });
  state.activeSituation = null;
  state.updatedAt = stoppedAt;
  state.runLog.push({
    type: "situation_stopped",
    at: stoppedAt,
    situationRunId: active.situationRunId,
    situationId: active.situationId,
  });
  if (state.resolvedPreparedNext || state.preparedNext) {
    await refreshEligiblePool(state, clients, "after_stop_situation");
  } else {
    await computeAndSetPreparedNext(state, clients, "after_stop_situation");
  }
  await saveRunState(state);
  return state;
}

function receiveScores(state, scoreFeed = {}) {
  state.lastScoreFeed = {
    receivedAt: new Date().toISOString(),
    source: scoreFeed.source || "test",
    scores: Array.isArray(scoreFeed.scores) ? scoreFeed.scores : [],
  };
  state.runLog.push({
    type: "score_feed_received",
    at: state.lastScoreFeed.receivedAt,
    scoreCount: state.lastScoreFeed.scores.length,
    preparedNextFrozen: !!state.preparedNext,
  });
  return state;
}

module.exports = {
  buildEligiblePool,
  computeAndSetPreparedNext,
  createShowRunSnapshot,
  placeholderAlgorithmConfigSnapshot,
  receiveScores,
  refreshEligiblePool,
  startRun,
  startSituation,
  stopSituation,
};
