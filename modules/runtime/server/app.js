"use strict";

const path = require("node:path");

const { RUNTIME_STATE_SCHEMA_VERSION } = require("../../../shared/contracts/runtime-v0");
const {
  fetchAlgorithmConfigSnapshot,
  evaluatePaths,
  fetchAudienceAlgorithmInput,
  fetchCatalogSnapshot,
  fetchPathsSnapshot,
  initializeAlgorithmScoringContext,
  observeSituation,
} = require("../client/service-clients");
const {
  finalizePendingSituation,
  normalizeRuntimeDerivedState,
  previousSituation,
  receiveScores,
  refreshEligiblePool,
  resetRun,
  restoreAlgorithmScoringContext,
  startRun,
  startSituation,
  stopSituation,
  updateOrderSettings,
} = require("../run-control/runtime-engine");
const {
  readCurrentRunState,
  readRunState,
  saveRunState,
} = require("../run-control/state-store");
const { loadExpress } = require("./express-loader");

const express = loadExpress();
const LIVE_SCORE_SAVE_DEBOUNCE_MS = 500;

function asyncRoute(handler) {
  return (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
}

function runtimeClients() {
  return {
    fetchAlgorithmConfigSnapshot,
    fetchAudienceAlgorithmInput,
    fetchCatalogSnapshot,
    fetchPathsSnapshot,
    evaluatePaths,
    initializeAlgorithmScoringContext,
    observeSituation,
  };
}

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function extractScoreFeed(payload = {}) {
  if (payload && Array.isArray(payload.scores)) return payload;
  if (payload && payload.scoreFeed && Array.isArray(payload.scoreFeed.scores)) return payload.scoreFeed;
  return payload || {};
}

function isLiveScorePayload(payload = {}) {
  const feed = extractScoreFeed(payload);
  const source = payload.source || feed.source || "";
  const phase = feed.scorePhase || payload.scorePhase || "";
  return phase === "live" || source === "audience_live_algorithm";
}

function incomingAudienceAggregateVersion(payload = {}) {
  const feed = extractScoreFeed(payload);
  const value = feed.audienceAggregateVersion ?? payload.audienceAggregateVersion;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function scoreFeedStaleReason(state, payload = {}) {
  const feed = extractScoreFeed(payload);
  const showRunId = feed.showRunId || payload.showRunId || null;
  if (showRunId && state.showRunId && showRunId !== state.showRunId) return "show_run_mismatch";
  if (!isLiveScorePayload(payload)) return null;
  const situationRunId = feed.updatedAfterSituationRunId || payload.updatedAfterSituationRunId || null;
  if (!state.activeSituation) return "live_score_without_active_situation";
  if (situationRunId && situationRunId !== state.activeSituation.situationRunId) {
    return "live_score_for_non_active_situation";
  }
  const incomingVersion = incomingAudienceAggregateVersion(payload);
  const last = state.lastAppliedScoreFeedRevision || {};
  if (
    incomingVersion != null
    && last.scorePhase === "live"
    && last.source === "audience_live_algorithm"
    && last.situationRunId === state.activeSituation.situationRunId
    && Number.isFinite(Number(last.audienceAggregateVersion))
    && incomingVersion <= Number(last.audienceAggregateVersion)
  ) {
    return "stale_audience_aggregate_version";
  }
  return null;
}

function compactCatalog(catalog = {}) {
  return {
    schemaVersion: catalog.schemaVersion || null,
    source: catalog.source || null,
    situations: (catalog.situations || []).map((item) => ({
      id: item.id,
      legacyId: item.legacyId,
      title: item.title || item.name || item.id,
      sortOrder: item.sortOrder,
      characterIds: Array.isArray(item.characterIds) ? item.characterIds.slice() : [],
      environmentId: item.environmentId || null,
      labelIds: Array.isArray(item.labelIds) ? item.labelIds.slice() : [],
      active: item.active,
      archivedAt: item.archivedAt || null,
    })),
    characters: (catalog.characters || []).map((item) => ({
      id: item.id,
      legacyId: item.legacyId,
      name: item.name || item.title || item.id,
    })),
    environments: (catalog.environments || []).map((item) => ({
      id: item.id,
      legacyId: item.legacyId,
      name: item.name || item.title || item.id,
      active: item.active,
      archivedAt: item.archivedAt || null,
    })),
  };
}

function compactPathEvaluation(pathEvaluation = null) {
  if (!pathEvaluation) return null;
  return {
    schemaVersion: pathEvaluation.schemaVersion || null,
    counts: pathEvaluation.counts || null,
    items: (pathEvaluation.items || []).map((item) => ({
      situationId: item.situationId,
      legacySituationId: item.legacySituationId,
      status: item.status,
      pathAvailable: !!item.pathAvailable,
      pathLocked: !!item.pathLocked,
      pathStatuses: Array.isArray(item.pathStatuses)
        ? item.pathStatuses.map((pathStatus) => ({
          pathId: pathStatus.pathId,
          pathName: pathStatus.pathName,
          status: pathStatus.status,
          isPathStart: !!pathStatus.isPathStart,
        }))
        : [],
    })),
  };
}

function compactRuntimeView(state = {}) {
  const normalized = normalizeRuntimeDerivedState(cloneJson(state));
  const snapshot = normalized.showRunSnapshot
    ? {
      schemaVersion: normalized.showRunSnapshot.schemaVersion || null,
      createdAt: normalized.showRunSnapshot.createdAt || null,
      catalog: compactCatalog(normalized.showRunSnapshot.catalog || {}),
      paths: {
        schemaVersion: normalized.showRunSnapshot.paths && normalized.showRunSnapshot.paths.schemaVersion
          ? normalized.showRunSnapshot.paths.schemaVersion
          : null,
      },
      algorithmConfig: {
        schemaVersion: normalized.showRunSnapshot.algorithmConfig && normalized.showRunSnapshot.algorithmConfig.schemaVersion
          ? normalized.showRunSnapshot.algorithmConfig.schemaVersion
          : null,
      },
    }
    : null;
  return {
    schemaVersion: normalized.schemaVersion,
    status: normalized.status,
    showRunId: normalized.showRunId,
    createdAt: normalized.createdAt,
    updatedAt: normalized.updatedAt,
    showRunSnapshot: snapshot,
    catalogPreview: normalized.catalogPreview ? compactCatalog(normalized.catalogPreview) : null,
    preparedNext: normalized.preparedNext || null,
    resolvedPreparedNext: normalized.resolvedPreparedNext || null,
    activeSituation: normalized.activeSituation || null,
    situationRuns: normalized.situationRuns || [],
    playedSituations: normalized.playedSituations || [],
    pathEvaluation: compactPathEvaluation(normalized.pathEvaluation),
    eligiblePool: normalized.eligiblePool || [],
    lastScoreFeed: normalized.lastScoreFeed || null,
    orderSettings: normalized.orderSettings,
    rankingRevision: normalized.rankingRevision,
    lastRankChangeSummary: normalized.lastRankChangeSummary,
    finalizationStatus: normalized.finalizationStatus,
    compactRunLog: normalized.compactRunLog,
    runLog: (normalized.runLog || []).slice(-24),
    reset: normalized.reset || null,
    previewUnavailable: normalized.previewUnavailable || null,
  };
}

async function withIdlePreview(state, clients) {
  if (!state || state.showRunSnapshot) return state;
  try {
    const catalog = await clients.fetchCatalogSnapshot();
    const pathEvaluation = await clients.evaluatePaths([]);
    return {
      ...state,
      catalogPreview: catalog,
      pathEvaluation,
      eligiblePool: [],
    };
  } catch (err) {
    return {
      ...state,
      previewUnavailable: {
        at: new Date().toISOString(),
        message: err && err.message ? String(err.message).slice(0, 180) : "unknown_error",
      },
    };
  }
}

function createRuntimeApp(options = {}) {
  const app = express();
  const startedAt = new Date();
  const clients = options.clients || runtimeClients();
  const stateCache = new Map();
  const saveTimers = new Map();
  const finalizationJobs = new Map();
  const uiRoot = path.resolve(__dirname, "../ui/control");
  const sharedUiRoot = path.resolve(__dirname, "../../../shared/ui");
  app.use(express.json({ limit: "512kb" }));

  function cacheState(state) {
    if (state && state.showRunId) stateCache.set(state.showRunId, state);
    return state;
  }

  async function readRunStateCached(showRunId) {
    if (stateCache.has(showRunId)) return stateCache.get(showRunId);
    return cacheState(normalizeRuntimeDerivedState(await readRunState(showRunId)));
  }

  async function readCurrentRunStateCached() {
    const current = await readCurrentRunState();
    if (current && current.showRunId && stateCache.has(current.showRunId)) return stateCache.get(current.showRunId);
    return current && current.showRunId ? cacheState(normalizeRuntimeDerivedState(current)) : normalizeRuntimeDerivedState(current);
  }

  async function persistRunState(state, options = {}) {
    if (!state || !state.showRunId) return null;
    const timer = saveTimers.get(state.showRunId);
    if (timer) {
      clearTimeout(timer);
      saveTimers.delete(state.showRunId);
    }
    cacheState(state);
    return saveRunState(state, options);
  }

  function scheduleRunStateSave(state, delayMs = LIVE_SCORE_SAVE_DEBOUNCE_MS) {
    if (!state || !state.showRunId) return;
    cacheState(state);
    const existing = saveTimers.get(state.showRunId);
    if (existing) clearTimeout(existing);
    const timer = setTimeout(() => {
      saveTimers.delete(state.showRunId);
      saveRunState(state).catch((err) => {
        // Keep the HTTP path fast; the next explicit action/save will retry persistence.
        process.stderr.write(`[runtime] debounced save failed: ${err && err.message ? err.message : err}\n`);
      });
    }, delayMs);
    saveTimers.set(state.showRunId, timer);
  }

  function clearCachedRun(showRunId) {
    const timer = saveTimers.get(showRunId);
    if (timer) clearTimeout(timer);
    saveTimers.delete(showRunId);
    finalizationJobs.delete(showRunId);
    stateCache.delete(showRunId);
  }

  function queueFinalization(showRunId, options = {}) {
    if (!showRunId || finalizationJobs.has(showRunId)) return;
    const job = Promise.resolve()
      .then(async () => {
        const state = await readRunStateCached(showRunId);
        await finalizePendingSituation(state, clients, options);
        cacheState(state);
      })
      .catch((err) => {
        process.stderr.write(`[runtime] finalization failed: ${err && err.message ? err.message : err}\n`);
      })
      .finally(() => {
        finalizationJobs.delete(showRunId);
      });
    finalizationJobs.set(showRunId, job);
  }

  app.get("/", (_req, res) => {
    res.redirect("/runtime/");
  });

  app.use("/shared/ui", express.static(sharedUiRoot));
  app.use("/runtime", express.static(uiRoot, { extensions: ["html"] }));

  app.get("/health", (_req, res) => {
    const port = Number(process.env.RUNTIME_PORT || process.env.PORT || options.port || 3024);
    res.json({
      ok: true,
      service: "runtime",
      version: "v0",
      schemaVersion: RUNTIME_STATE_SCHEMA_VERSION,
      port,
      startedAt: startedAt.toISOString(),
      uptimeSeconds: Math.round(process.uptime()),
    });
  });

  app.post("/v0/runtime/runs/start", asyncRoute(async (req, res) => {
    const state = await startRun({ clients, orderSettings: req.body && req.body.orderSettings });
    cacheState(state);
    res.status(201).json(state);
  }));

  app.get("/v0/runtime/runs/current", asyncRoute(async (_req, res) => {
    res.json(await withIdlePreview(await readCurrentRunStateCached(), clients));
  }));

  app.get("/v0/runtime/runs/current/view", asyncRoute(async (_req, res) => {
    const state = await withIdlePreview(await readCurrentRunStateCached(), clients);
    res.json(compactRuntimeView(state));
  }));

  app.get("/v0/runtime/runs/:showRunId", asyncRoute(async (req, res) => {
    res.json(await readRunStateCached(req.params.showRunId));
  }));

  app.post("/v0/runtime/runs/:showRunId/start-situation", asyncRoute(async (req, res) => {
    const state = await readRunStateCached(req.params.showRunId);
    const next = await startSituation(state, clients, { skipSave: true });
    await persistRunState(next);
    res.json(next);
  }));

  app.post("/v0/runtime/runs/:showRunId/stop-situation", asyncRoute(async (req, res) => {
    const state = await readRunStateCached(req.params.showRunId);
    const next = await stopSituation(state, clients, { ...(req.body || {}), deferFinalization: true, skipSave: true });
    await persistRunState(next);
    res.json(next);
    queueFinalization(req.params.showRunId, req.body || {});
  }));

  app.post("/v0/runtime/runs/:showRunId/previous-situation", asyncRoute(async (req, res) => {
    const state = await readRunStateCached(req.params.showRunId);
    const next = await previousSituation(state, clients, { ...(req.body || {}), skipSave: true });
    await persistRunState(next);
    res.json(next);
  }));

  app.patch("/v0/runtime/runs/:showRunId/order-settings", asyncRoute(async (req, res) => {
    const state = await readRunStateCached(req.params.showRunId);
    const next = await updateOrderSettings(state, clients, req.body || {});
    await persistRunState(next);
    res.json(next);
  }));

  app.post("/v0/runtime/runs/:showRunId/algorithm-context/restore", asyncRoute(async (req, res) => {
    const state = await readRunStateCached(req.params.showRunId);
    const beforePrepared = JSON.stringify({
      preparedNext: state.preparedNext || null,
      resolvedPreparedNext: state.resolvedPreparedNext || null,
    });
    const result = await restoreAlgorithmScoringContext(state, clients, {
      reason: req.body && req.body.reason ? String(req.body.reason) : "runtime_endpoint_restore",
    });
    await persistRunState(state);
    const afterPrepared = JSON.stringify({
      preparedNext: state.preparedNext || null,
      resolvedPreparedNext: state.resolvedPreparedNext || null,
    });
    res.json({
      ok: true,
      restored: true,
      showRunId: state.showRunId,
      preparedNextUnchanged: beforePrepared === afterPrepared,
      preparedNextSituationId: state.preparedNext ? state.preparedNext.situationId : null,
      scoreCount: result && result.scoreFeed ? result.scoreFeed.scores.length : 0,
      state,
    });
  }));

  app.post("/v0/runtime/runs/:showRunId/reset", asyncRoute(async (req, res) => {
    const state = await readRunStateCached(req.params.showRunId);
    const reset = await withIdlePreview(await resetRun(state, req.body || {}), clients);
    clearCachedRun(req.params.showRunId);
    res.json(reset);
  }));

  app.post("/v0/runtime/runs/reset", asyncRoute(async (req, res) => {
    const state = await readCurrentRunStateCached();
    const reset = await withIdlePreview(await resetRun(state, req.body || {}), clients);
    if (state && state.showRunId) clearCachedRun(state.showRunId);
    res.json(reset);
  }));

  app.post("/v0/runtime/runs/:showRunId/scores", asyncRoute(async (req, res) => {
    const state = await readRunStateCached(req.params.showRunId);
    if (!state || state.status !== "running") {
      res.json({
        ok: true,
        applied: false,
        ignored: true,
        ignoredReason: "runtime_score_feed_ignored_for_inactive_run",
        reason: "runtime_score_feed_ignored_for_inactive_run",
        showRunId: req.params.showRunId,
        status: state && state.status ? state.status : "unknown",
        preparedNextUnchanged: true,
        eligiblePoolResorted: false,
      });
      return;
    }
    normalizeRuntimeDerivedState(state);
    const staleReason = scoreFeedStaleReason(state, req.body || {});
    if (staleReason) {
      res.json({
        ok: true,
        applied: false,
        ignored: true,
        ignoredReason: staleReason,
        showRunId: req.params.showRunId,
        rankingRevision: state.rankingRevision || 0,
        preparedNextUnchanged: true,
        eligiblePoolResorted: false,
        eligiblePoolOrderChanged: false,
      });
      return;
    }
    const beforePrepared = JSON.stringify({
      preparedNext: state.preparedNext || null,
      resolvedPreparedNext: state.resolvedPreparedNext || null,
    });
    const eligiblePoolBefore = (state.eligiblePool || []).map((item) => item.situationId);
    receiveScores(state, req.body || {});
    await refreshEligiblePool(state, clients, "score_feed_received");
    if (isLiveScorePayload(req.body || {})) {
      scheduleRunStateSave(state);
    } else {
      await persistRunState(state);
    }
    const afterPrepared = JSON.stringify({
      preparedNext: state.preparedNext || null,
      resolvedPreparedNext: state.resolvedPreparedNext || null,
    });
    const after = state.preparedNext ? state.preparedNext.situationId : null;
    const eligiblePoolAfter = (state.eligiblePool || []).map((item) => item.situationId);
    const liveScore = isLiveScorePayload(req.body || {});
    const responseBody = {
      ok: true,
      applied: true,
      ignored: false,
      preparedNextUnchanged: beforePrepared === afterPrepared,
      preparedNextSituationId: after,
      eligiblePoolResorted: true,
      eligiblePoolOrderChanged: eligiblePoolBefore.join("|") !== eligiblePoolAfter.join("|"),
      rankingRevision: state.rankingRevision || 0,
      rankChangeSummary: state.lastRankChangeSummary || null,
      eligiblePoolBefore,
      eligiblePoolAfter,
    };
    if (!liveScore) responseBody.state = state;
    res.json(responseBody);
  }));

  app.use((req, res) => {
    res.status(404).json({ ok: false, error: "not_found", path: req.path });
  });

  app.use((err, _req, res, _next) => {
    res.status(500).json({
      ok: false,
      error: "runtime_service_error",
      message: err && err.message ? String(err.message) : "unknown_error",
    });
  });

  return app;
}

module.exports = {
  createRuntimeApp,
};
