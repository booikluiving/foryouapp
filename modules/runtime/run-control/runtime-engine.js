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
const {
  clearCurrentRunState,
  createIdleRuntimeState,
  saveRunState,
} = require("./state-store");

const ALGORITHM_RUNTIME_OWNERSHIP_FIELDS = [
  "availablePool",
  "pathAvailable",
  "pathLocked",
  "eligiblePool",
  "preparedNext",
  "resolvedPreparedNext",
  "activeSituation",
  "playedSituations",
  "situationRuns",
  "order",
];

const MAX_RUN_LOG_ENTRIES = 240;

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

function safeNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function defaultOrderSettings() {
  return {
    randomizeEqualScores: false,
  };
}

function normalizeRuntimeDerivedState(state = {}) {
  state.orderSettings = normalizeOrderSettings(state.orderSettings);
  state.runLog = Array.isArray(state.runLog) ? state.runLog : [];
  state.compactRunLog = state.compactRunLog && typeof state.compactRunLog === "object" && !Array.isArray(state.compactRunLog)
    ? state.compactRunLog
    : {
      schemaVersion: "runtime.compact-run-log.v0",
      liveScoreFeeds: {
        count: 0,
        lastAt: null,
        lastSource: null,
        lastScorePhase: null,
        lastSituationRunId: null,
      },
    };
  state.rankingRevision = Number.isFinite(Number(state.rankingRevision)) ? Number(state.rankingRevision) : 0;
  state.rankingTieBreaks = state.rankingTieBreaks && typeof state.rankingTieBreaks === "object" && !Array.isArray(state.rankingTieBreaks)
    ? state.rankingTieBreaks
    : {
      schemaVersion: "runtime.ranking-tie-breaks.v0",
      epoch: 0,
      groups: {},
      updatedAt: null,
    };
  state.rankingTieBreaks.groups = state.rankingTieBreaks.groups && typeof state.rankingTieBreaks.groups === "object"
    ? state.rankingTieBreaks.groups
    : {};
  state.rankingTieBreaks.epoch = Number.isFinite(Number(state.rankingTieBreaks.epoch))
    ? Number(state.rankingTieBreaks.epoch)
    : 0;
  state.lastRankChangeSummary = state.lastRankChangeSummary && typeof state.lastRankChangeSummary === "object"
    ? state.lastRankChangeSummary
    : null;
  state.finalizationStatus = state.finalizationStatus && typeof state.finalizationStatus === "object"
    ? state.finalizationStatus
    : { status: "idle", updatedAt: null };
  state.lastAppliedScoreFeedRevision = state.lastAppliedScoreFeedRevision && typeof state.lastAppliedScoreFeedRevision === "object"
    ? state.lastAppliedScoreFeedRevision
    : null;
  return state;
}

function appendRunLog(state, entry = {}) {
  normalizeRuntimeDerivedState(state);
  state.runLog.push(entry);
  if (state.runLog.length > MAX_RUN_LOG_ENTRIES) {
    const first = state.runLog[0] && state.runLog[0].type === "show_run_started" ? state.runLog[0] : null;
    const tailSize = first ? MAX_RUN_LOG_ENTRIES - 1 : MAX_RUN_LOG_ENTRIES;
    const tail = state.runLog.slice(-tailSize);
    state.runLog = first ? [first].concat(tail) : tail;
  }
}

function recordCompactLiveScore(state, scoreFeed = {}) {
  normalizeRuntimeDerivedState(state);
  const liveScoreFeeds = state.compactRunLog.liveScoreFeeds || {};
  state.compactRunLog.liveScoreFeeds = {
    ...liveScoreFeeds,
    count: Number(liveScoreFeeds.count || 0) + 1,
    lastAt: scoreFeed.receivedAt || new Date().toISOString(),
    lastSource: scoreFeed.source || null,
    lastScorePhase: scoreFeed.scorePhase || null,
    lastSituationRunId: scoreFeed.updatedAfterSituationRunId || null,
    lastAudienceAggregateVersion: scoreFeed.audienceAggregateVersion ?? liveScoreFeeds.lastAudienceAggregateVersion ?? null,
    lastScoreCount: Array.isArray(scoreFeed.scores) ? scoreFeed.scores.length : 0,
  };
}

function normalizeOrderSettings(input = {}, base = defaultOrderSettings()) {
  const source = input && typeof input === "object" ? input : {};
  return {
    randomizeEqualScores: Object.prototype.hasOwnProperty.call(source, "randomizeEqualScores")
      ? !!source.randomizeEqualScores
      : !!(base && base.randomizeEqualScores),
  };
}

function extractScoreFeed(payload = {}) {
  if (payload && Array.isArray(payload.scores)) return payload;
  if (payload && payload.scoreFeed && Array.isArray(payload.scoreFeed.scores)) return payload.scoreFeed;
  return null;
}

function assertNoAlgorithmRuntimeOwnershipFields(payload = {}) {
  for (const key of ALGORITHM_RUNTIME_OWNERSHIP_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(payload || {}, key)) {
      throw new Error(`algorithm_forbidden_runtime_field:${key}`);
    }
  }
}

function normalizeScoreItem(item = {}) {
  const predictedScore = safeNumber(item.predictedScore ?? item.score ?? item.points, 0);
  const observedScore = item.observedScore == null ? null : safeNumber(item.observedScore, 0);
  return {
    situationId: item.situationId ? String(item.situationId) : "",
    legacySituationId: item.legacySituationId == null ? null : safeNumber(item.legacySituationId, null),
    observedScore,
    predictedScore,
    confidence: item.confidence == null ? null : safeNumber(item.confidence, 0),
    reasons: Array.isArray(item.reasons) ? item.reasons.map(String) : [],
    components: item.components && typeof item.components === "object" && !Array.isArray(item.components)
      ? cloneJson(item.components)
      : {},
  };
}

function normalizeScoreFeed(state, payload = {}) {
  assertNoAlgorithmRuntimeOwnershipFields(payload);
  const scoreFeed = extractScoreFeed(payload) || payload;
  assertNoAlgorithmRuntimeOwnershipFields(scoreFeed);
  const scores = Array.isArray(scoreFeed.scores)
    ? scoreFeed.scores.map((item) => {
      assertNoAlgorithmRuntimeOwnershipFields(item);
      return normalizeScoreItem(item);
    }).filter((item) => item.situationId)
    : [];
  return {
    type: scoreFeed.type || "situationScoresUpdated",
    schemaVersion: scoreFeed.schemaVersion || "runtime.accepted-score-feed.v0",
    showRunId: scoreFeed.showRunId || state.showRunId || null,
    source: payload.source || scoreFeed.source || "algorithm",
    scorePhase: scoreFeed.scorePhase || null,
    audienceAggregateVersion: scoreFeed.audienceAggregateVersion == null
      ? payload.audienceAggregateVersion ?? null
      : scoreFeed.audienceAggregateVersion,
    scoreFeedRevision: scoreFeed.scoreFeedRevision == null
      ? payload.scoreFeedRevision ?? null
      : scoreFeed.scoreFeedRevision,
    receivedAt: new Date().toISOString(),
    updatedAt: scoreFeed.updatedAt || null,
    updatedAfterSituationRunId: scoreFeed.updatedAfterSituationRunId || null,
    scores,
    debugSummary: scoreFeed.debugSummary && typeof scoreFeed.debugSummary === "object"
      ? cloneJson(scoreFeed.debugSummary)
      : null,
  };
}

function scoreMapFromFeed(scoreFeed) {
  return new Map(((scoreFeed && scoreFeed.scores) || []).map((item) => [item.situationId, item]));
}

function candidateScoreValue(candidate) {
  return candidate && candidate.score ? safeNumber(candidate.score.predictedScore, 0) : 0;
}

function stableCandidateOrder(a, b) {
  const sortA = Number(a.situation.sortOrder || 0);
  const sortB = Number(b.situation.sortOrder || 0);
  if (sortA !== sortB) return sortA - sortB;
  return a.legacySituationId - b.legacySituationId;
}

function shuffleCandidates(candidates) {
  const shuffled = candidates.slice();
  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    const item = shuffled[index];
    shuffled[index] = shuffled[swapIndex];
    shuffled[swapIndex] = item;
  }
  return shuffled;
}

function randomKeyForSituation(tieBreaks, groupKey, situationId) {
  if (!tieBreaks.groups[groupKey]) {
    tieBreaks.groups[groupKey] = {
      groupKey,
      keys: {},
      createdAt: new Date().toISOString(),
    };
  }
  const group = tieBreaks.groups[groupKey];
  if (!Object.prototype.hasOwnProperty.call(group.keys, situationId)) {
    group.keys[situationId] = Math.random();
  }
  return group.keys[situationId];
}

function equalScoreGroupKey(score, group, tieBreaks) {
  const scorePart = Number.isFinite(Number(score)) ? Number(score).toFixed(4) : "none";
  const ids = group.map((item) => item.situationId).sort().join(",");
  return `${Number(tieBreaks.epoch || 0)}|score:${scorePart}|ids:${ids}`;
}

function randomizeEqualScoreGroups(candidates, orderSettings = defaultOrderSettings(), rankingTieBreaks = null) {
  const settings = normalizeOrderSettings(orderSettings);
  if (!settings.randomizeEqualScores || candidates.length < 2) return candidates;
  if (!rankingTieBreaks) {
    const out = [];
    let group = [];
    let groupScore = null;
    const flush = () => {
      if (!group.length) return;
      out.push(...(group.length > 1 ? shuffleCandidates(group) : group));
      group = [];
      groupScore = null;
    };
    for (const candidate of candidates) {
      const score = candidateScoreValue(candidate);
      if (!group.length || score === groupScore) {
        group.push(candidate);
        groupScore = score;
        continue;
      }
      flush();
      group.push(candidate);
      groupScore = score;
    }
    flush();
    return out;
  }
  const tieBreaks = rankingTieBreaks && typeof rankingTieBreaks === "object"
    ? rankingTieBreaks
    : { epoch: 0, groups: {} };
  tieBreaks.groups = tieBreaks.groups && typeof tieBreaks.groups === "object" ? tieBreaks.groups : {};
  const usedGroupKeys = new Set();
  const out = [];
  let group = [];
  let groupScore = null;
  const flush = () => {
    if (!group.length) return;
    if (group.length === 1) {
      out.push(...group);
    } else {
      const groupKey = equalScoreGroupKey(groupScore, group, tieBreaks);
      usedGroupKeys.add(groupKey);
      const randomized = group.slice().sort((a, b) => {
        const keyA = randomKeyForSituation(tieBreaks, groupKey, a.situationId);
        const keyB = randomKeyForSituation(tieBreaks, groupKey, b.situationId);
        if (keyA !== keyB) return keyA - keyB;
        return stableCandidateOrder(a, b);
      }).map((item) => ({
        ...item,
        tieGroupKey: groupKey,
        tieBreakKey: randomKeyForSituation(tieBreaks, groupKey, item.situationId),
      }));
      out.push(...randomized);
    }
    group = [];
    groupScore = null;
  };
  for (const candidate of candidates) {
    const score = candidateScoreValue(candidate);
    if (!group.length || score === groupScore) {
      group.push(candidate);
      groupScore = score;
      continue;
    }
    flush();
    group.push(candidate);
    groupScore = score;
  }
  flush();
  for (const key of Object.keys(tieBreaks.groups)) {
    if (!usedGroupKeys.has(key)) delete tieBreaks.groups[key];
  }
  tieBreaks.updatedAt = new Date().toISOString();
  return out;
}

function charactersOverlap(a, b) {
  if (!a || !b) return false;
  const left = new Set(a.characterIds || []);
  return (b.characterIds || []).some((id) => left.has(id));
}

function sameEnvironment(a, b) {
  return !!(a && b && a.environmentId && b.environmentId && a.environmentId === b.environmentId);
}

function buildEligiblePool({
  catalog,
  pathEvaluation,
  playedSituations,
  activeSituation,
  lastPlayedSituation,
  scoreFeed,
  orderSettings,
  rankingTieBreaks,
}) {
  const situationMap = catalogSituationMap(catalog);
  const scoreBySituation = scoreMapFromFeed(scoreFeed);
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

  const sortedCandidates = finalCandidates
    .map((item) => {
      const score = scoreBySituation.get(item.situationId) || null;
      return {
        ...item,
        score,
        scoreValue: score ? safeNumber(score.predictedScore, 0) : null,
      };
    })
    .sort((a, b) => {
      const scoreA = candidateScoreValue(a);
      const scoreB = candidateScoreValue(b);
      if (scoreA !== scoreB) return scoreB - scoreA;
      return stableCandidateOrder(a, b);
    });

  return randomizeEqualScoreGroups(sortedCandidates, orderSettings, rankingTieBreaks)
    .map((item) => ({
      situationId: item.situationId,
      legacySituationId: item.legacySituationId,
      title: item.situation.title,
      isPathStart: item.isPathStart,
      reason: item.isPathStart ? "path_start" : "path_available",
      score: item.score,
      scoreValue: item.scoreValue,
      tieGroupKey: item.tieGroupKey || null,
      tieBreakKey: item.tieBreakKey == null ? null : item.tieBreakKey,
    }));
}

function bumpRankingTieEpoch(state, reason) {
  normalizeRuntimeDerivedState(state);
  state.rankingTieBreaks.epoch = Number(state.rankingTieBreaks.epoch || 0) + 1;
  state.rankingTieBreaks.groups = {};
  state.rankingTieBreaks.updatedAt = new Date().toISOString();
  state.rankingTieBreaks.lastReason = reason || "ranking_epoch";
  return state.rankingTieBreaks.epoch;
}

function rankingReasonFor(reason = "runtime_refresh") {
  if (String(reason).includes("score_feed")) return "score_changed";
  if (String(reason).includes("order_settings")) return "tie_epoch_created";
  if (String(reason).includes("start") || String(reason).includes("stop") || String(reason).includes("previous")) {
    return "lifecycle_changed";
  }
  if (String(reason).includes("path")) return "path_changed";
  return "runtime_refresh";
}

function rankChangeSummary(beforePool = [], afterPool = [], options = {}) {
  const beforeIds = beforePool.map((item) => item.situationId);
  const afterIds = afterPool.map((item) => item.situationId);
  const beforeIndex = new Map(beforeIds.map((id, index) => [id, index]));
  const moved = [];
  for (const [index, id] of afterIds.entries()) {
    const previous = beforeIndex.has(id) ? beforeIndex.get(id) : null;
    if (previous != null && previous !== index) {
      moved.push({
        situationId: id,
        from: previous + 1,
        to: index + 1,
        delta: previous - index,
      });
    }
  }
  const joinedBefore = beforeIds.join("|");
  const joinedAfter = afterIds.join("|");
  return {
    schemaVersion: "runtime.rank-change-summary.v0",
    at: new Date().toISOString(),
    revision: options.revision,
    reason: options.reason || "runtime_refresh",
    changeReason: options.changeReason || rankingReasonFor(options.reason),
    orderChanged: joinedBefore !== joinedAfter,
    beforeTop: beforeIds.slice(0, 8),
    afterTop: afterIds.slice(0, 8),
    moved: moved.slice(0, 12),
    movedCount: moved.length,
    eligibleCount: afterIds.length,
    randomizeEqualScores: !!options.randomizeEqualScores,
    preparedNextFrozen: !!options.preparedNextFrozen,
  };
}

function applyEligiblePoolUpdate(state, eligiblePool, reason) {
  normalizeRuntimeDerivedState(state);
  const beforePool = Array.isArray(state.eligiblePool) ? state.eligiblePool : [];
  state.rankingRevision += 1;
  state.eligiblePool = eligiblePool;
  state.lastRankChangeSummary = rankChangeSummary(beforePool, eligiblePool, {
    revision: state.rankingRevision,
    reason,
    changeReason: rankingReasonFor(reason),
    randomizeEqualScores: !!state.orderSettings.randomizeEqualScores,
    preparedNextFrozen: !!state.preparedNext,
  });
  return state.lastRankChangeSummary;
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
  normalizeRuntimeDerivedState(state);
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
    scoreFeed: state.lastScoreFeed,
    orderSettings: state.orderSettings,
    rankingTieBreaks: state.rankingTieBreaks,
  });
  applyEligiblePoolUpdate(state, eligiblePool, reason);
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
  appendRunLog(state, {
    type: prepared ? "prepared_next_set" : "prepared_next_empty",
    at: state.updatedAt,
    reason,
    situationId: prepared ? prepared.situationId : null,
    eligibleCount: eligiblePool.length,
    rankingRevision: state.rankingRevision,
  });
  return state;
}

async function refreshEligiblePool(state, clients, reason = "runtime_refresh") {
  normalizeRuntimeDerivedState(state);
  const playedSituationIds = (state.playedSituations || []).map((item) => item.situationId);
  const pathEvaluation = await clients.evaluatePaths(playedSituationIds);
  const lastPlayedSituationId = state.playedSituations.length
    ? state.playedSituations[state.playedSituations.length - 1].situationId
    : null;
  const catalogMap = catalogSituationMap(state.showRunSnapshot.catalog);
  state.pathEvaluation = pathEvaluation;
  const eligiblePool = buildEligiblePool({
    catalog: state.showRunSnapshot.catalog,
    pathEvaluation,
    playedSituations: state.playedSituations,
    activeSituation: state.activeSituation,
    lastPlayedSituation: lastPlayedSituationId ? catalogMap.get(lastPlayedSituationId) : null,
    scoreFeed: state.lastScoreFeed,
    orderSettings: state.orderSettings,
    rankingTieBreaks: state.rankingTieBreaks,
  });
  const summary = applyEligiblePoolUpdate(state, eligiblePool, reason);
  state.updatedAt = new Date().toISOString();
  appendRunLog(state, {
    type: "eligible_pool_refreshed",
    at: state.updatedAt,
    reason,
    eligibleCount: state.eligiblePool.length,
    preparedNextFrozen: !!state.preparedNext,
    randomizeEqualScores: !!state.orderSettings.randomizeEqualScores,
    rankingRevision: state.rankingRevision,
    orderChanged: !!(summary && summary.orderChanged),
  });
  return state;
}

async function loadAlgorithmConfigSnapshot(clients) {
  if (!clients || typeof clients.fetchAlgorithmConfigSnapshot !== "function") {
    return placeholderAlgorithmConfigSnapshot();
  }
  try {
    return await clients.fetchAlgorithmConfigSnapshot();
  } catch (err) {
    return {
      ...placeholderAlgorithmConfigSnapshot(),
      source: {
        type: "runtime-v0-placeholder",
        readOnly: true,
        reason: "algorithm_config_unavailable",
        message: err && err.message ? String(err.message).slice(0, 180) : "unknown_error",
      },
    };
  }
}

function isScoreFeedContractError(err) {
  const message = err && err.message ? String(err.message) : "";
  return message.startsWith("algorithm_forbidden_runtime_field:")
    || message.startsWith("runtime_invalid_score_feed");
}

function errorMessage(err) {
  return err && err.message ? String(err.message) : "unknown_error";
}

function isMissingAlgorithmScoringContextError(err) {
  const message = errorMessage(err);
  return message.includes("algorithm_missing_scoring_context")
    || (message.includes("ENOENT") && message.includes("/algorithm/db/"));
}

async function syncAlgorithmScoringContext(state, clients, options = {}) {
  const {
    reason = "runtime_sync",
    logType = "algorithm_scoring_context_initialized",
    unavailableLogType = "algorithm_scoring_context_unavailable",
    scoreSource = "algorithm_initial_scores",
    applyScoreFeed = true,
    throwOnUnavailable = false,
  } = options;
  if (!clients || typeof clients.initializeAlgorithmScoringContext !== "function") {
    const err = new Error("runtime_algorithm_context_client_unavailable");
    if (throwOnUnavailable) throw err;
    return { ok: false, error: err.message };
  }
  try {
    const result = await clients.initializeAlgorithmScoringContext({
      showRunId: state.showRunId,
      runSnapshot: state.showRunSnapshot,
      config: state.showRunSnapshot.algorithmConfig,
    });
    assertNoAlgorithmRuntimeOwnershipFields(result);
    const scoreFeed = extractScoreFeed(result);
    if (scoreFeed && applyScoreFeed) receiveScores(state, { ...scoreFeed, source: scoreSource });
    appendRunLog(state, {
      type: logType,
      at: new Date().toISOString(),
      reason,
      scoreCount: scoreFeed ? scoreFeed.scores.length : 0,
    });
    return { ok: true, result, scoreFeed };
  } catch (err) {
    if (isScoreFeedContractError(err)) throw err;
    appendRunLog(state, {
      type: unavailableLogType,
      at: new Date().toISOString(),
      reason,
      missingContext: isMissingAlgorithmScoringContextError(err),
      message: errorMessage(err).slice(0, 180),
    });
    if (throwOnUnavailable) throw err;
    return { ok: false, error: errorMessage(err) };
  }
}

async function initializeAlgorithmScoringContext(state, clients) {
  await syncAlgorithmScoringContext(state, clients, {
    reason: "start_run",
    logType: "algorithm_scoring_context_initialized",
    unavailableLogType: "algorithm_scoring_context_unavailable",
    scoreSource: "algorithm_initial_scores",
    applyScoreFeed: true,
    throwOnUnavailable: false,
  });
  return state;
}

async function restoreAlgorithmScoringContext(state, clients, options = {}) {
  return syncAlgorithmScoringContext(state, clients, {
    reason: options.reason || "algorithm_context_restore",
    logType: "algorithm_scoring_context_restored",
    unavailableLogType: "algorithm_scoring_context_restore_failed",
    scoreSource: "algorithm_context_restored",
    applyScoreFeed: false,
    throwOnUnavailable: true,
  });
}

async function startRun({ clients, orderSettings } = {}) {
  const createdAtDate = new Date();
  const showRunId = createShowRunId(createdAtDate);
  const catalog = await clients.fetchCatalogSnapshot();
  const paths = await clients.fetchPathsSnapshot();
  const algorithmConfig = await loadAlgorithmConfigSnapshot(clients);
  const showRunSnapshot = createShowRunSnapshot({ catalog, paths, algorithmConfig });
  const state = normalizeRuntimeDerivedState({
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
    lastScoreFeed: null,
    orderSettings: normalizeOrderSettings(orderSettings),
    runLog: [{
      type: "show_run_started",
      at: createdAtDate.toISOString(),
      showRunId,
    }],
  });
  await initializeAlgorithmScoringContext(state, clients);
  await computeAndSetPreparedNext(state, clients, "start_run");
  await saveRunState(state);
  return state;
}

async function startSituation(state, clients, options = {}) {
  normalizeRuntimeDerivedState(state);
  if (!state.resolvedPreparedNext) throw new Error("runtime_no_resolved_prepared_next");
  if (state.activeSituation) throw new Error("runtime_active_situation_exists");
  bumpRankingTieEpoch(state, "start_situation");
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
    title: activeSituation.title,
    resolved: cloneJson(activeSituation.resolved),
    startedAt,
    endedAt: null,
    status: "active",
  });
  state.activeSituation = activeSituation;
  state.preparedNext = null;
  state.resolvedPreparedNext = null;
  state.updatedAt = startedAt;
  appendRunLog(state, {
    type: "situation_started",
    at: startedAt,
    situationRunId,
    situationId: activeSituation.situationId,
  });
  await computeAndSetPreparedNext(state, clients, "after_start_situation");
  if (!options.skipSave) await saveRunState(state);
  return state;
}

function situationObservedEvent(state, active, stoppedAt, options = {}) {
  const startedMs = Date.parse(active.startedAt || "");
  const stoppedMs = Date.parse(stoppedAt || "");
  const durationSeconds = Number.isFinite(startedMs) && Number.isFinite(stoppedMs)
    ? Math.max(0, Math.round((stoppedMs - startedMs) / 1000))
    : 0;
  return {
    type: "situationObserved",
    showRunId: state.showRunId,
    situationRunId: active.situationRunId,
    situationId: active.situationId,
    startedAt: active.startedAt,
    endedAt: stoppedAt,
    durationSeconds,
    audience: options.audience || {},
    chatAppSignals: options.chatAppSignals || {},
    reactionLabSignals: options.reactionLabSignals || {},
    rawChat: Array.isArray(options.rawChat) ? cloneJson(options.rawChat) : [],
    finalizedFromAudienceAggregate: !!options.finalizedFromAudienceAggregate,
    finalizedFromLiveAudience: !!options.finalizedFromLiveAudience,
  };
}

function hasExplicitAudienceObservationOptions(options = {}) {
  if (!options || typeof options !== "object") return false;
  return Object.prototype.hasOwnProperty.call(options, "audience")
    || Object.prototype.hasOwnProperty.call(options, "chatAppSignals")
    || Object.prototype.hasOwnProperty.call(options, "rawChat")
    || Object.prototype.hasOwnProperty.call(options, "reactionLabSignals");
}

function countRawMessages(chatAppSignals = {}) {
  return Array.isArray(chatAppSignals.rawMessages) ? chatAppSignals.rawMessages.length : 0;
}

async function resolveStopSituationObservationOptions(state, active, clients, options = {}) {
  const source = options && typeof options === "object" ? options : {};
  if (hasExplicitAudienceObservationOptions(source)) return source;
  if (!clients || typeof clients.fetchAudienceAlgorithmInput !== "function") return source;
  try {
    const input = await clients.fetchAudienceAlgorithmInput({
      showRunId: state.showRunId,
      situationRunId: active.situationRunId,
    });
    if (input && input.situationId && input.situationId !== active.situationId) {
      appendRunLog(state, {
        type: "audience_aggregate_mismatch",
        at: new Date().toISOString(),
        situationRunId: active.situationRunId,
        expectedSituationId: active.situationId,
        receivedSituationId: input.situationId,
      });
      return source;
    }
    const chatAppSignals = input && input.chatAppSignals && typeof input.chatAppSignals === "object"
      ? cloneJson(input.chatAppSignals)
      : {};
    const audience = input && input.audience && typeof input.audience === "object"
      ? cloneJson(input.audience)
      : {};
    const rawChat = input && Array.isArray(input.rawChat) ? cloneJson(input.rawChat) : [];
    appendRunLog(state, {
      type: "audience_aggregate_attached",
      at: new Date().toISOString(),
      situationRunId: active.situationRunId,
      heartCount: Number(chatAppSignals.heartCount || 0),
      boredCount: Number(chatAppSignals.boredCount || 0),
      messageCount: countRawMessages(chatAppSignals),
      linkedSignalCount: Number(audience.linkedSignalCount || 0),
    });
    return {
      ...source,
      audience,
      chatAppSignals,
      rawChat,
      finalizedFromAudienceAggregate: true,
    };
  } catch (err) {
    appendRunLog(state, {
      type: "audience_aggregate_unavailable",
      at: new Date().toISOString(),
      situationRunId: active.situationRunId,
      message: errorMessage(err).slice(0, 180),
    });
    return source;
  }
}

async function sendSituationObserved(state, active, stoppedAt, clients, options = {}) {
  if (!clients || typeof clients.observeSituation !== "function") return null;
  const event = situationObservedEvent(state, active, stoppedAt, options);
  assertNoAlgorithmRuntimeOwnershipFields(event);
  try {
    const result = await clients.observeSituation(event);
    assertNoAlgorithmRuntimeOwnershipFields(result);
    const scoreFeed = extractScoreFeed(result);
    if (scoreFeed) receiveScores(state, { ...scoreFeed, source: "algorithm_observation_scores" });
    appendRunLog(state, {
      type: "algorithm_situation_observed",
      at: new Date().toISOString(),
      situationRunId: active.situationRunId,
      scoreCount: scoreFeed ? scoreFeed.scores.length : 0,
    });
    return result;
  } catch (err) {
    if (isScoreFeedContractError(err)) throw err;
    if (isMissingAlgorithmScoringContextError(err)) {
      try {
        await restoreAlgorithmScoringContext(state, clients, { reason: "before_situation_observed_retry" });
        const result = await clients.observeSituation(event);
        assertNoAlgorithmRuntimeOwnershipFields(result);
        const scoreFeed = extractScoreFeed(result);
        if (scoreFeed) receiveScores(state, { ...scoreFeed, source: "algorithm_observation_scores" });
        appendRunLog(state, {
          type: "algorithm_situation_observed",
          at: new Date().toISOString(),
          situationRunId: active.situationRunId,
          scoreCount: scoreFeed ? scoreFeed.scores.length : 0,
          recoveredMissingContext: true,
        });
        return result;
      } catch (retryErr) {
        if (isScoreFeedContractError(retryErr)) throw retryErr;
        appendRunLog(state, {
          type: "algorithm_observation_unavailable",
          at: new Date().toISOString(),
          situationRunId: active.situationRunId,
          missingContext: isMissingAlgorithmScoringContextError(retryErr),
          recoveredMissingContext: false,
          message: errorMessage(retryErr).slice(0, 180),
        });
        return null;
      }
    }
    appendRunLog(state, {
      type: "algorithm_observation_unavailable",
      at: new Date().toISOString(),
      situationRunId: active.situationRunId,
      missingContext: isMissingAlgorithmScoringContextError(err),
      message: errorMessage(err).slice(0, 180),
    });
    return null;
  }
}

async function stopSituation(state, clients, options = {}) {
  normalizeRuntimeDerivedState(state);
  if (!state.activeSituation) throw new Error("runtime_no_active_situation");
  const stoppedAt = new Date().toISOString();
  const active = state.activeSituation;
  bumpRankingTieEpoch(state, "stop_situation");
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
  appendRunLog(state, {
    type: "situation_stopped",
    at: stoppedAt,
    situationRunId: active.situationRunId,
    situationId: active.situationId,
  });
  if (options && options.deferFinalization) {
    state.finalizationStatus = {
      status: "pending",
      queuedAt: stoppedAt,
      updatedAt: stoppedAt,
      showRunId: state.showRunId,
      situationRunId: active.situationRunId,
      situationId: active.situationId,
      stoppedAt,
      activeSituation: cloneJson(active),
    };
    appendRunLog(state, {
      type: "situation_finalization_queued",
      at: stoppedAt,
      situationRunId: active.situationRunId,
      situationId: active.situationId,
    });
    if (state.resolvedPreparedNext || state.preparedNext) {
      await refreshEligiblePool(state, clients, "after_stop_situation");
    } else {
      await computeAndSetPreparedNext(state, clients, "after_stop_situation");
    }
    if (!options.skipSave) await saveRunState(state);
    return state;
  }
  const observationOptions = await resolveStopSituationObservationOptions(state, active, clients, options);
  await sendSituationObserved(state, active, stoppedAt, clients, observationOptions);
  if (state.resolvedPreparedNext || state.preparedNext) {
    await refreshEligiblePool(state, clients, "after_stop_situation");
  } else {
    await computeAndSetPreparedNext(state, clients, "after_stop_situation");
  }
  if (!options.skipSave) await saveRunState(state);
  return state;
}

async function finalizePendingSituation(state, clients, options = {}) {
  normalizeRuntimeDerivedState(state);
  const pending = state.finalizationStatus || {};
  if (pending.status !== "pending" || !pending.activeSituation || !pending.stoppedAt) return state;
  const active = cloneJson(pending.activeSituation);
  const startedAt = new Date().toISOString();
  state.finalizationStatus = {
    ...pending,
    status: "running",
    startedAt,
    updatedAt: startedAt,
  };
  appendRunLog(state, {
    type: "situation_finalization_started",
    at: startedAt,
    situationRunId: active.situationRunId,
    situationId: active.situationId,
  });
  try {
    const observationOptions = await resolveStopSituationObservationOptions(state, active, clients, options);
    await sendSituationObserved(state, active, pending.stoppedAt, clients, observationOptions);
    if (state.resolvedPreparedNext || state.preparedNext) {
      await refreshEligiblePool(state, clients, "after_situation_finalized");
    } else {
      await computeAndSetPreparedNext(state, clients, "after_situation_finalized");
    }
    const completedAt = new Date().toISOString();
    state.finalizationStatus = {
      ...state.finalizationStatus,
      status: "complete",
      completedAt,
      updatedAt: completedAt,
      scorePhase: state.lastScoreFeed ? state.lastScoreFeed.scorePhase : null,
      scoreSource: state.lastScoreFeed ? state.lastScoreFeed.source : null,
    };
    appendRunLog(state, {
      type: "situation_finalization_complete",
      at: completedAt,
      situationRunId: active.situationRunId,
      situationId: active.situationId,
      scorePhase: state.lastScoreFeed ? state.lastScoreFeed.scorePhase : null,
      scoreSource: state.lastScoreFeed ? state.lastScoreFeed.source : null,
    });
  } catch (err) {
    const failedAt = new Date().toISOString();
    state.finalizationStatus = {
      ...state.finalizationStatus,
      status: "failed",
      failedAt,
      updatedAt: failedAt,
      message: errorMessage(err).slice(0, 180),
    };
    appendRunLog(state, {
      type: "situation_finalization_failed",
      at: failedAt,
      situationRunId: active.situationRunId,
      situationId: active.situationId,
      message: errorMessage(err).slice(0, 180),
    });
  }
  await saveRunState(state);
  return state;
}

function receiveScores(state, scoreFeed = {}) {
  normalizeRuntimeDerivedState(state);
  state.lastScoreFeed = normalizeScoreFeed(state, scoreFeed);
  state.lastAppliedScoreFeedRevision = {
    source: state.lastScoreFeed.source,
    scorePhase: state.lastScoreFeed.scorePhase,
    showRunId: state.lastScoreFeed.showRunId,
    situationRunId: state.lastScoreFeed.updatedAfterSituationRunId,
    audienceAggregateVersion: state.lastScoreFeed.audienceAggregateVersion,
    scoreFeedRevision: state.lastScoreFeed.scoreFeedRevision,
    updatedAt: state.lastScoreFeed.updatedAt,
    receivedAt: state.lastScoreFeed.receivedAt,
  };
  if (state.lastScoreFeed.scorePhase === "live" || state.lastScoreFeed.source === "audience_live_algorithm") {
    recordCompactLiveScore(state, state.lastScoreFeed);
  }
  appendRunLog(state, {
    type: "score_feed_received",
    at: state.lastScoreFeed.receivedAt,
    scoreCount: state.lastScoreFeed.scores.length,
    preparedNextFrozen: !!state.preparedNext,
    source: state.lastScoreFeed.source,
    scorePhase: state.lastScoreFeed.scorePhase,
    audienceAggregateVersion: state.lastScoreFeed.audienceAggregateVersion,
  });
  if (state.lastScoreFeed.source === "audience_live_algorithm") {
    appendRunLog(state, {
      type: "audience_live_score_received",
      at: state.lastScoreFeed.receivedAt,
      scoreCount: state.lastScoreFeed.scores.length,
      preparedNextFrozen: !!state.preparedNext,
      scorePhase: state.lastScoreFeed.scorePhase,
      audienceAggregateVersion: state.lastScoreFeed.audienceAggregateVersion,
    });
  }
  return state;
}

async function updateOrderSettings(state, clients, patch = {}) {
  if (!state || !state.showRunId || state.status === "idle") throw new Error("runtime_no_show_run");
  normalizeRuntimeDerivedState(state);
  const beforeRandomize = !!state.orderSettings.randomizeEqualScores;
  state.orderSettings = normalizeOrderSettings(patch, state.orderSettings);
  if (beforeRandomize !== !!state.orderSettings.randomizeEqualScores) {
    bumpRankingTieEpoch(state, "order_settings_updated");
  }
  state.updatedAt = new Date().toISOString();
  appendRunLog(state, {
    type: "order_settings_updated",
    at: state.updatedAt,
    randomizeEqualScores: !!state.orderSettings.randomizeEqualScores,
    preparedNextFrozen: !!state.preparedNext,
  });
  await refreshEligiblePool(state, clients, "order_settings_updated");
  await saveRunState(state);
  return state;
}

async function previousSituation(state, clients, options = {}) {
  if (!state || !state.showRunId || state.status === "idle") throw new Error("runtime_no_show_run");
  normalizeRuntimeDerivedState(state);
  if (state.activeSituation) throw new Error("runtime_previous_requires_no_active_situation");
  if (!Array.isArray(state.playedSituations) || !state.playedSituations.length) {
    throw new Error("runtime_no_previous_situation");
  }
  const restored = state.playedSituations.pop();
  const restoredAt = new Date().toISOString();
  bumpRankingTieEpoch(state, "previous_situation");
  const run = (state.situationRuns || []).find((item) => item.situationRunId === restored.situationRunId);
  const title = restored.title || (run && run.title) || restored.situationId;
  const resolved = (run && run.resolved)
    ? cloneJson(run.resolved)
    : materializePreparedNext({
      catalog: state.showRunSnapshot.catalog,
      preparedNext: {
        situationId: restored.situationId,
        legacySituationId: restored.legacySituationId,
        title,
      },
      seed: `previous:${restored.situationRunId}`,
    });
  if (run) {
    run.endedAt = null;
    run.status = "active";
  }
  state.activeSituation = {
    situationRunId: restored.situationRunId,
    situationId: restored.situationId,
    legacySituationId: restored.legacySituationId,
    title,
    resolved,
    startedAt: restored.startedAt,
    restoredAt,
    status: "active",
  };
  state.updatedAt = restoredAt;
  appendRunLog(state, {
    type: "previous_situation_restored",
    at: restoredAt,
    situationRunId: restored.situationRunId,
    situationId: restored.situationId,
  });
  if (state.resolvedPreparedNext || state.preparedNext) {
    await refreshEligiblePool(state, clients, "after_previous_situation");
  } else {
    await computeAndSetPreparedNext(state, clients, "after_previous_situation");
  }
  if (!options.skipSave) await saveRunState(state);
  return state;
}

async function resetRun(state) {
  const resetAt = new Date().toISOString();
  if (state && state.showRunId) {
    state.status = "reset";
    state.updatedAt = resetAt;
    state.preparedNext = null;
    state.resolvedPreparedNext = null;
    state.activeSituation = null;
    state.situationRuns = [];
    state.playedSituations = [];
    state.pathEvaluation = null;
    state.eligiblePool = [];
    state.lastScoreFeed = null;
    state.rankingRevision = 0;
    state.rankingTieBreaks = {
      schemaVersion: "runtime.ranking-tie-breaks.v0",
      epoch: 0,
      groups: {},
      updatedAt: resetAt,
    };
    state.lastRankChangeSummary = null;
    state.finalizationStatus = { status: "idle", updatedAt: resetAt };
    state.compactRunLog = {
      schemaVersion: "runtime.compact-run-log.v0",
      liveScoreFeeds: {
        count: 0,
        lastAt: null,
        lastSource: null,
        lastScorePhase: null,
        lastSituationRunId: null,
      },
    };
    state.runLog = Array.isArray(state.runLog) ? state.runLog : [];
    appendRunLog(state, {
      type: "show_run_reset",
      at: resetAt,
      showRunId: state.showRunId,
    });
    await saveRunState(state, { updateCurrent: false });
  }
  await clearCurrentRunState();
  return createIdleRuntimeState({
    reset: state && state.showRunId ? {
      showRunId: state.showRunId,
      resetAt,
    } : null,
  });
}

module.exports = {
  assertNoAlgorithmRuntimeOwnershipFields,
  buildEligiblePool,
  computeAndSetPreparedNext,
  createIdleRuntimeState,
  createShowRunSnapshot,
  defaultOrderSettings,
  finalizePendingSituation,
  normalizeRuntimeDerivedState,
  normalizeOrderSettings,
  placeholderAlgorithmConfigSnapshot,
  previousSituation,
  receiveScores,
  refreshEligiblePool,
  resetRun,
  restoreAlgorithmScoringContext,
  situationObservedEvent,
  startRun,
  startSituation,
  stopSituation,
  updateOrderSettings,
};
