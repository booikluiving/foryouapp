"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");

const TEST_DB_DIR = path.join(__dirname, ".tmp-unit-db");
process.env.V2_RUNTIME_DB_DIR = TEST_DB_DIR;

const {
  assertNoAlgorithmRuntimeOwnershipFields,
  buildEligiblePool,
  previousSituation,
  receiveScores,
  refreshEligiblePool,
  resetRun,
  startRun,
  startSituation,
  stopSituation,
  updateOrderSettings,
} = require("../run-control/runtime-engine");
const { materializePreparedNext } = require("../materialization/materialize");
const {
  readCurrentRunState,
  readRunState,
  runFilePath,
  saveRunState,
} = require("../run-control/state-store");

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

const catalogFixture = {
  schemaVersion: "catalog.read-model.v0",
  source: { type: "fixture", readOnly: true },
  situations: [
    {
      id: "situation:1",
      legacyId: 1,
      title: "Start A",
      sortOrder: 10,
      characterIds: ["character:1"],
      environmentId: "environment:1",
      labelIds: ["label:warm"],
      active: true,
      archivedAt: null,
    },
    {
      id: "situation:2",
      legacyId: 2,
      title: "Unlocked Later",
      sortOrder: 20,
      characterIds: ["character:2"],
      environmentId: "environment:2",
      labelIds: ["label:warm"],
      active: true,
      archivedAt: null,
    },
    {
      id: "situation:3",
      legacyId: 3,
      title: "Start B",
      sortOrder: 30,
      characterIds: ["character:3"],
      environmentId: "environment:3",
      labelIds: ["label:cold"],
      active: true,
      archivedAt: null,
    },
    {
      id: "situation:4",
      legacyId: 4,
      title: "Start C",
      sortOrder: 40,
      characterIds: ["character:4"],
      environmentId: "environment:4",
      labelIds: ["label:warm"],
      active: true,
      archivedAt: null,
    },
  ],
  labels: [
    { id: "label:warm", legacyId: 1, name: "Warm" },
    { id: "label:cold", legacyId: 2, name: "Cold" },
  ],
  performers: [
    { id: "performer:1", legacyId: 1, name: "Performer 1", performerSlot: 1, active: true, archivedAt: null },
    { id: "performer:2", legacyId: 2, name: "Performer 2", performerSlot: 2, active: true, archivedAt: null },
    { id: "performer:3", legacyId: 3, name: "Performer 3", performerSlot: 3, active: true, archivedAt: null },
    { id: "performer:4", legacyId: 4, name: "Unslotted Performer", performerSlot: 0, active: true, archivedAt: null },
  ],
  characters: [
    { id: "character:1", legacyId: 1, name: "A", performerIds: ["performer:1"] },
    { id: "character:2", legacyId: 2, name: "B", performerIds: ["performer:2"] },
    { id: "character:3", legacyId: 3, name: "C", performerIds: ["performer:3"] },
    { id: "character:4", legacyId: 4, name: "D", performerIds: ["performer:4"] },
  ],
  environments: [
    { id: "environment:1", legacyId: 1, name: "Room 1", active: true, archivedAt: null },
    { id: "environment:2", legacyId: 2, name: "Room 2", active: true, archivedAt: null },
    { id: "environment:3", legacyId: 3, name: "Room 3", active: true, archivedAt: null },
    { id: "environment:4", legacyId: 4, name: "Room 4", active: true, archivedAt: null },
  ],
};

const pathsFixture = {
  schemaVersion: "paths.snapshot.v0",
  source: { type: "fixture", readOnly: true },
  paths: [],
  crossingThresholds: [],
};

const algorithmConfigFixture = {
  schemaVersion: "algorithm.config.v0",
  source: { type: "fixture", readOnly: true },
  weights: {},
  normalization: {},
  neutralPredictedScore: 0,
};

function pathStatus(situationId, legacySituationId, status, isPathStart) {
  return {
    situationId,
    legacySituationId,
    status,
    pathAvailable: status === "available",
    pathLocked: status === "locked" || status === "blocked",
    pathStatuses: [{ status, isPathStart: !!isPathStart, pathId: "path:1", pathName: "Fixture" }],
  };
}

function evaluatePaths(playedSituationIds) {
  const played = new Set(playedSituationIds || []);
  const items = [
    pathStatus("situation:1", 1, played.has("situation:1") ? "played" : "available", true),
    pathStatus("situation:2", 2, played.has("situation:1") ? "available" : "locked", false),
    pathStatus("situation:3", 3, played.has("situation:3") ? "played" : "available", true),
    pathStatus("situation:4", 4, played.has("situation:4") ? "played" : "available", true),
  ];
  return Promise.resolve({
    schemaVersion: "paths.evaluation.v0",
    input: { playedSituationIds },
    counts: {
      situations: items.length,
      available: items.filter((item) => item.status === "available").length,
      locked: items.filter((item) => item.pathLocked).length,
      played: items.filter((item) => item.status === "played").length,
    },
    items,
    pathAvailable: items.filter((item) => item.status === "available").map((item) => item.situationId),
    pathLocked: items.filter((item) => item.pathLocked).map((item) => item.situationId),
  });
}

function neutralScoreFeed(showRunId) {
  return {
    type: "situationScoresUpdated",
    schemaVersion: "algorithm.score-feed.v0",
    showRunId,
    updatedAt: new Date().toISOString(),
    scores: catalogFixture.situations.map((situation) => ({
      situationId: situation.id,
      legacySituationId: situation.legacyId,
      predictedScore: 0,
      observedScore: null,
      confidence: 0.1,
      reasons: ["neutral"],
    })),
  };
}

function rankedScoreFeed(showRunId, scores) {
  return {
    type: "situationScoresUpdated",
    schemaVersion: "algorithm.score-feed.v0",
    showRunId,
    updatedAt: new Date().toISOString(),
    scores: Object.entries(scores).map(([situationId, predictedScore]) => ({
      situationId,
      predictedScore,
      confidence: 0.7,
      reasons: ["unit_score"],
    })),
  };
}

async function resetTestDb() {
  await fs.rm(TEST_DB_DIR, { recursive: true, force: true });
}

async function main() {
  await resetTestDb();

  const idle = await readCurrentRunState();
  assert.equal(idle.status, "idle", "current state without a run should be idle");
  assert.equal(idle.showRunId, null);

  const tieBreakShowRunId = "show-run-20260525-120000000Z";
  const initialPathEvaluation = await evaluatePaths([]);
  const stableEqualScores = buildEligiblePool({
    catalog: catalogFixture,
    pathEvaluation: initialPathEvaluation,
    playedSituations: [],
    activeSituation: null,
    lastPlayedSituation: null,
    scoreFeed: neutralScoreFeed(tieBreakShowRunId),
    orderSettings: { randomizeEqualScores: false },
  }).map((item) => item.situationId);
  const originalRandom = Math.random;
  Math.random = () => 0;
  let randomizedEqualScores;
  try {
    randomizedEqualScores = buildEligiblePool({
      catalog: catalogFixture,
      pathEvaluation: initialPathEvaluation,
      playedSituations: [],
      activeSituation: null,
      lastPlayedSituation: null,
      scoreFeed: neutralScoreFeed(tieBreakShowRunId),
      orderSettings: { randomizeEqualScores: true },
    }).map((item) => item.situationId);
  } finally {
    Math.random = originalRandom;
  }
  assert.deepEqual(stableEqualScores, ["situation:1", "situation:3", "situation:4"]);
  assert.notDeepEqual(randomizedEqualScores, stableEqualScores, "equal-score candidates should randomize when enabled");
  assert.deepEqual(randomizedEqualScores.slice().sort(), stableEqualScores.slice().sort());
  const stableTieBreaks = {
    schemaVersion: "runtime.ranking-tie-breaks.v0",
    epoch: 1,
    groups: {},
  };
  const randomSequence = [0.73, 0.12, 0.45, 0.99, 0.01];
  Math.random = () => randomSequence.shift() ?? 0.5;
  let stableRandomizedFirst;
  try {
    stableRandomizedFirst = buildEligiblePool({
      catalog: catalogFixture,
      pathEvaluation: initialPathEvaluation,
      playedSituations: [],
      activeSituation: null,
      lastPlayedSituation: null,
      scoreFeed: neutralScoreFeed(tieBreakShowRunId),
      orderSettings: { randomizeEqualScores: true },
      rankingTieBreaks: stableTieBreaks,
    }).map((item) => item.situationId);
  } finally {
    Math.random = originalRandom;
  }
  Math.random = () => 0.01;
  let stableRandomizedSecond;
  try {
    stableRandomizedSecond = buildEligiblePool({
      catalog: catalogFixture,
      pathEvaluation: initialPathEvaluation,
      playedSituations: [],
      activeSituation: null,
      lastPlayedSituation: null,
      scoreFeed: neutralScoreFeed(tieBreakShowRunId),
      orderSettings: { randomizeEqualScores: true },
      rankingTieBreaks: stableTieBreaks,
    }).map((item) => item.situationId);
  } finally {
    Math.random = originalRandom;
  }
  assert.deepEqual(stableRandomizedSecond, stableRandomizedFirst, "Runtime tie randomization should stay stable while equal-score group is unchanged");
  const castResolved = materializePreparedNext({
    catalog: {
      performers: [
        { id: "performer:1", name: "Performer 1", performerSlot: 1, active: true, archivedAt: null },
        { id: "performer:2", name: "Performer 2", performerSlot: 2, active: true, archivedAt: null },
        { id: "performer:3", name: "Performer 3", performerSlot: 3, active: true, archivedAt: null },
      ],
      characters: [
        { id: "character:flex", legacyId: 10, name: "Zwangere vrouw", performerIds: [] },
        { id: "character:bobby", legacyId: 11, name: "Bobby", performerIds: ["performer:1"] },
        { id: "character:adolf", legacyId: 12, name: "Adolf", performerIds: ["performer:2"] },
      ],
      environments: [{ id: "environment:cast", name: "Cast Room", active: true, archivedAt: null }],
      situations: [{
        id: "situation:cast",
        legacyId: 10,
        title: "Cast fixture",
        promptText: "Assign constrained roles first.",
        characterIds: ["character:flex", "character:bobby", "character:adolf"],
        environmentId: "environment:cast",
        labelIds: [],
      }],
    },
    preparedNext: { situationId: "situation:cast" },
    seed: "cast-fixture",
  });
  assert.deepEqual(
    castResolved.performerSlots.map((slot) => [slot.slotIndex, slot.performerId, slot.characterId]),
    [
      [1, "performer:1", "character:bobby"],
      [1, null, "character:flex"],
      [2, "performer:2", "character:adolf"],
    ],
    "resolved performer slots should reflect catalog performer choices without redistributing roles"
  );
  const conflictResolved = materializePreparedNext({
    catalog: {
      performers: [
        { id: "performer:1", name: "Performer 1", performerSlot: 1, active: true, archivedAt: null },
      ],
      characters: [
        { id: "character:conflict-a", legacyId: 13, name: "Conflict A", performerIds: ["performer:1"] },
        { id: "character:conflict-b", legacyId: 14, name: "Conflict B", performerIds: ["performer:1"] },
      ],
      environments: [{ id: "environment:cast", name: "Cast Room", active: true, archivedAt: null }],
      situations: [{
        id: "situation:cast-conflict",
        legacyId: 11,
        title: "Cast conflict fixture",
        promptText: "Two roles may need the same performer.",
        characterIds: ["character:conflict-a", "character:conflict-b"],
        environmentId: "environment:cast",
        labelIds: [],
      }],
    },
    preparedNext: { situationId: "situation:cast-conflict" },
    seed: "cast-conflict-fixture",
  });
  assert.deepEqual(
    conflictResolved.performerSlots.map((slot) => [slot.slotIndex, slot.performerId, slot.characterId]),
    [
      [1, "performer:1", "character:conflict-a"],
      [1, "performer:1", "character:conflict-b"],
    ],
    "runtime should still expose catalog performer choices when roles share one performer"
  );
  assert(conflictResolved.castWarnings.some((issue) => issue.code === "situation_cast_performer_conflict"));
  const anchoredPool = buildEligiblePool({
    catalog: catalogFixture,
    pathEvaluation: initialPathEvaluation,
    playedSituations: [{ situationId: "situation:3" }],
    activeSituation: { situationId: "situation:1" },
    lastPlayedSituation: null,
    scoreFeed: neutralScoreFeed(tieBreakShowRunId),
    orderSettings: { randomizeEqualScores: true },
  });
  assert(!anchoredPool.some((item) => item.situationId === "situation:1"), "active situation must stay out of rest pool");
  assert(!anchoredPool.some((item) => item.situationId === "situation:3"), "played situations must stay out of rest pool");

  const algorithmInitPayloads = [];
  const observedEvents = [];
  const clients = {
    fetchCatalogSnapshot: async () => cloneJson(catalogFixture),
    fetchPathsSnapshot: async () => cloneJson(pathsFixture),
    fetchAlgorithmConfigSnapshot: async () => cloneJson(algorithmConfigFixture),
    initializeAlgorithmScoringContext: async (payload) => {
      algorithmInitPayloads.push(cloneJson(payload));
      return { ok: true, scoreFeed: neutralScoreFeed(payload.showRunId) };
    },
    observeSituation: async (event) => {
      observedEvents.push(cloneJson(event));
      return {
        observation: { ...event, observedScore: 12 },
        scoreFeed: rankedScoreFeed(event.showRunId, {
          "situation:2": 99,
          "situation:3": 8,
          "situation:4": 7,
        }),
      };
    },
    evaluatePaths,
  };

  const state = await startRun({ clients });
  assert.match(state.showRunId, /^show-run-\d{8}-\d{9}Z$/, "Runtime should create showRunId");
  assert(state.showRunSnapshot.catalog, "start run should freeze catalog");
  assert(state.showRunSnapshot.paths, "start run should freeze paths");
  assert.equal(state.showRunSnapshot.algorithmConfig.schemaVersion, "algorithm.config.v0");
  assert.equal(state.preparedNext.situationId, "situation:1");
  assert.equal(state.resolvedPreparedNext.situationId, "situation:1");
  assert.deepEqual(
    state.resolvedPreparedNext.performerSlots.map((slot) => [slot.slotIndex, slot.performerId, slot.characterId]),
    [[1, "performer:1", "character:1"]],
    "resolvedPreparedNext should carry performer slot display records"
  );
  assert.equal(state.orderSettings.randomizeEqualScores, false);
  assert(state.rankingRevision > 0, "Runtime should track ranking revisions");

  const preparedBeforeOrderToggle = state.preparedNext.situationId;
  await updateOrderSettings(state, clients, { randomizeEqualScores: true });
  assert.equal(state.orderSettings.randomizeEqualScores, true);
  assert.equal(state.preparedNext.situationId, preparedBeforeOrderToggle, "order toggle must not replace preparedNext");

  assert.equal(algorithmInitPayloads.length, 1, "Runtime may initialize Algorithm with an existing run id");
  assert.equal(algorithmInitPayloads[0].showRunId, state.showRunId);
  assert(algorithmInitPayloads[0].runSnapshot.catalog, "Algorithm gets a Runtime snapshot");
  assertNoAlgorithmRuntimeOwnershipFields(algorithmInitPayloads[0]);
  assert(!Object.prototype.hasOwnProperty.call(algorithmInitPayloads[0], "activeSituation"));
  assert(!Object.prototype.hasOwnProperty.call(algorithmInitPayloads[0], "preparedNext"));

  catalogFixture.situations[0].title = "MUTATED AFTER START";
  assert.equal(state.showRunSnapshot.catalog.situations[0].title, "Start A", "showRunSnapshot must be frozen");

  for (const field of ["preparedNext", "activeSituation", "playedSituations", "eligiblePool", "pathAvailable"]) {
    assert(!Object.prototype.hasOwnProperty.call(state.lastScoreFeed, field), `Algorithm score output must not contain ${field}`);
  }
  assert.throws(
    () => receiveScores(state, { scores: [], preparedNext: { situationId: "situation:4" } }),
    /algorithm_forbidden_runtime_field:preparedNext/
  );

  const preparedBeforeScores = state.preparedNext.situationId;
  receiveScores(state, rankedScoreFeed(state.showRunId, {
    "situation:4": 50,
    "situation:3": 10,
  }));
  await refreshEligiblePool(state, clients, "unit_score_feed_received");
  assert.equal(state.preparedNext.situationId, preparedBeforeScores, "score updates must not replace preparedNext");
  assert.equal(state.lastScoreFeed.scores[0].situationId, "situation:4", "Runtime should store score feed as input");
  assert.equal(state.eligiblePool[0].situationId, "situation:4", "Runtime should resort eligible pool on new scores");
  assert.equal(state.lastRankChangeSummary.changeReason, "score_changed");

  await startSituation(state, clients);
  assert.equal(state.activeSituation.situationId, "situation:1");
  assert.equal(state.playedSituations.length, 0, "active situation is not played until stop");
  assert.equal(state.preparedNext.situationId, "situation:4", "score feed should influence the next Runtime calculation");
  assert.equal(state.preparedNext.reason, "after_start_situation", "Runtime still owns the choice reason");
  const preparedBeforeStop = state.preparedNext.situationId;

  await stopSituation(state, clients, {
    audience: { activeClients: 12 },
    chatAppSignals: { heartCount: 4, boredCount: 1, rawMessages: ["ja"] },
  });
  assert.equal(state.activeSituation, null);
  assert.equal(state.playedSituations.length, 1);
  assert.equal(state.playedSituations[0].situationId, "situation:1");
  assert.equal(state.preparedNext.situationId, preparedBeforeStop, "stop should not replace already frozen preparedNext");
  assert.equal(observedEvents.length, 1, "Runtime should send a situationObserved event after stop");
  assert.equal(observedEvents[0].showRunId, state.showRunId);
  assert.equal(observedEvents[0].situationId, "situation:1");
  assertNoAlgorithmRuntimeOwnershipFields(observedEvents[0]);
  assert(!state.eligiblePool.some((item) => item.situationId === "situation:1"), "played situations must not return to eligible pool");

  await new Promise((resolve) => setTimeout(resolve, 2));
  const recoveryInitPayloads = [];
  let recoveryObserveCalls = 0;
  const recoveryClients = {
    ...clients,
    initializeAlgorithmScoringContext: async (payload) => {
      recoveryInitPayloads.push(cloneJson(payload));
      return { ok: true, scoreFeed: neutralScoreFeed(payload.showRunId) };
    },
    observeSituation: async (event) => {
      recoveryObserveCalls += 1;
      if (recoveryObserveCalls === 1) {
        throw new Error("http://algorithm returned 404: {\"error\":\"algorithm_missing_scoring_context\"}");
      }
      return {
        observation: { ...event, observedScore: 17 },
        scoreFeed: rankedScoreFeed(event.showRunId, {
          "situation:2": 17,
          "situation:3": 6,
          "situation:4": 5,
        }),
      };
    },
  };
  const recoveryState = await startRun({ clients: recoveryClients });
  await startSituation(recoveryState, recoveryClients);
  const recoveryPreparedBeforeStop = JSON.stringify({
    preparedNext: recoveryState.preparedNext,
    resolvedPreparedNext: recoveryState.resolvedPreparedNext,
  });
  await stopSituation(recoveryState, recoveryClients, {
    audience: { activeClients: 3 },
    chatAppSignals: { heartCount: 2, boredCount: 0, rawMessages: [] },
  });
  const recoveryPreparedAfterStop = JSON.stringify({
    preparedNext: recoveryState.preparedNext,
    resolvedPreparedNext: recoveryState.resolvedPreparedNext,
  });
  assert.equal(recoveryObserveCalls, 2, "missing Algorithm context should trigger one situationObserved retry");
  assert.equal(recoveryInitPayloads.length, 2, "Runtime should reinitialize Algorithm context after missing context");
  assert(recoveryState.runLog.some((item) => item.type === "algorithm_scoring_context_restored"), "Runtime should log context recovery");
  assert(recoveryState.runLog.some((item) => item.type === "algorithm_situation_observed" && item.recoveredMissingContext), "final observation should still succeed after recovery");
  assert.equal(recoveryPreparedAfterStop, recoveryPreparedBeforeStop, "Algorithm context recovery must not replace frozen preparedNext");

  await new Promise((resolve) => setTimeout(resolve, 2));
  const audienceAggregateFetches = [];
  const audienceObservedEvents = [];
  const audienceStopClients = {
    ...clients,
    fetchAudienceAlgorithmInput: async (payload) => {
      audienceAggregateFetches.push(cloneJson(payload));
      return {
        ok: true,
        showRunId: payload.showRunId,
        situationRunId: payload.situationRunId,
        situationId: "situation:1",
        audience: { activeClients: 2, linkedSignalCount: 4 },
        chatAppSignals: { heartCount: 3, boredCount: 1, rawMessages: ["ja"] },
        rawChat: [{ text: "ja", isBot: false }],
      };
    },
    observeSituation: async (event) => {
      audienceObservedEvents.push(cloneJson(event));
      return {
        observation: { ...event, observedScore: 5 },
        scoreFeed: rankedScoreFeed(event.showRunId, {
          "situation:2": 5,
          "situation:3": 2,
          "situation:4": 1,
        }),
      };
    },
  };
  const audienceStopState = await startRun({ clients: audienceStopClients });
  await startSituation(audienceStopState, audienceStopClients);
  const audienceStopPreparedBefore = JSON.stringify({
    preparedNext: audienceStopState.preparedNext,
    resolvedPreparedNext: audienceStopState.resolvedPreparedNext,
  });
  await stopSituation(audienceStopState, audienceStopClients);
  const audienceStopPreparedAfter = JSON.stringify({
    preparedNext: audienceStopState.preparedNext,
    resolvedPreparedNext: audienceStopState.resolvedPreparedNext,
  });
  assert.equal(audienceAggregateFetches.length, 1, "stop without explicit payload should fetch Audience aggregate");
  assert.equal(audienceAggregateFetches[0].situationRunId, `${audienceStopState.showRunId}:situation-run:0001`);
  assert.equal(audienceObservedEvents.length, 1);
  assert.equal(audienceObservedEvents[0].chatAppSignals.heartCount, 3);
  assert.equal(audienceObservedEvents[0].chatAppSignals.boredCount, 1);
  assert.deepEqual(audienceObservedEvents[0].chatAppSignals.rawMessages, ["ja"]);
  assert.equal(audienceObservedEvents[0].finalizedFromAudienceAggregate, true);
  assert.equal(audienceObservedEvents[0].rawChat.length, 1);
  assert(audienceStopState.runLog.some((item) => item.type === "audience_aggregate_attached" && item.heartCount === 3));
  assert.equal(audienceStopPreparedAfter, audienceStopPreparedBefore, "Audience aggregate finalization must not replace frozen preparedNext");

  await new Promise((resolve) => setTimeout(resolve, 2));
  const unavailableObservedEvents = [];
  const audienceUnavailableClients = {
    ...clients,
    fetchAudienceAlgorithmInput: async () => {
      throw new Error("audience_unavailable_for_unit_test");
    },
    observeSituation: async (event) => {
      unavailableObservedEvents.push(cloneJson(event));
      return {
        observation: { ...event, observedScore: 0 },
        scoreFeed: rankedScoreFeed(event.showRunId, {
          "situation:2": 0,
          "situation:3": 0,
          "situation:4": 0,
        }),
      };
    },
  };
  const audienceUnavailableState = await startRun({ clients: audienceUnavailableClients });
  await startSituation(audienceUnavailableState, audienceUnavailableClients);
  await stopSituation(audienceUnavailableState, audienceUnavailableClients);
  assert.equal(unavailableObservedEvents.length, 1, "Audience-unavailable stop should still send final observation");
  assert.equal(unavailableObservedEvents[0].finalizedFromAudienceAggregate, false);
  assert(audienceUnavailableState.runLog.some((item) => item.type === "audience_aggregate_unavailable"), "Runtime should log missing Audience aggregate");

  await new Promise((resolve) => setTimeout(resolve, 2));
  const deferredObservedEvents = [];
  const deferredClients = {
    ...clients,
    observeSituation: async (event) => {
      deferredObservedEvents.push(cloneJson(event));
      return {
        observation: { ...event, observedScore: 3 },
        scoreFeed: rankedScoreFeed(event.showRunId, {
          "situation:2": 3,
          "situation:3": 1,
          "situation:4": 1,
        }),
      };
    },
  };
  const deferredState = await startRun({ clients: deferredClients });
  await startSituation(deferredState, deferredClients);
  await stopSituation(deferredState, deferredClients, { deferFinalization: true });
  assert.equal(deferredObservedEvents.length, 0, "deferred stop should not block on Algorithm final observation");
  assert.equal(deferredState.finalizationStatus.status, "pending");

  await previousSituation(state, clients);
  assert.equal(state.activeSituation.situationId, "situation:1", "previous should restore the last played situation");
  assert.equal(state.playedSituations.length, 0, "restored previous situation is no longer marked played");
  assert.equal(state.preparedNext.situationId, preparedBeforeStop, "previous should keep frozen preparedNext");

  const bulkyState = cloneJson(state);
  bulkyState.runLog = Array.from({ length: 800 }, (_, index) => ({
    type: "live_poll_race_fixture",
    at: new Date().toISOString(),
    message: `large runtime state entry ${index} ${"x".repeat(220)}`,
  }));
  await saveRunState(bulkyState);
  await fs.appendFile(runFilePath(bulkyState.showRunId), "\n{\"stalePartialWrite\":", "utf8");
  assert.equal((await readRunState(bulkyState.showRunId)).showRunId, state.showRunId, "reader should recover from trailing stale JSON bytes");
  const concurrentWrites = Array.from({ length: 10 }, async (_, index) => {
    const next = cloneJson(bulkyState);
    next.updatedAt = new Date(Date.now() + index).toISOString();
    next.runLog[0].message = `atomic write iteration ${index} ${"y".repeat(220)}`;
    await saveRunState(next);
  });
  const concurrentReads = Array.from({ length: 40 }, async () => {
    const current = await readCurrentRunState();
    assert.equal(current.showRunId, state.showRunId);
  });
  await Promise.all(concurrentWrites.concat(concurrentReads));
  assert.equal((await readCurrentRunState()).showRunId, state.showRunId, "state reads should survive live write/poll races");

  const reset = await resetRun(state);
  assert.equal(reset.status, "idle", "reset should return logical idle state");
  const idleAfterReset = await readCurrentRunState();
  assert.equal(idleAfterReset.status, "idle", "current state should be idle after reset");
  assert.equal(idleAfterReset.showRunId, null);
  await saveRunState({ ...state, status: "reset" });
  const idleAfterLateResetSave = await readCurrentRunState();
  assert.equal(idleAfterLateResetSave.status, "idle", "late reset-run saves must not become current");
  assert.equal(idleAfterLateResetSave.showRunId, null);

  process.stdout.write(JSON.stringify({
    ok: true,
    showRunId: state.showRunId,
    assertions: [
      "idle current state is safe",
      "Runtime creates showRunId and snapshots",
      "Algorithm receives no Runtime lifecycle ownership fields",
      "Algorithm score output contains no order or lifecycle fields",
      "preparedNext stays frozen on score updates",
      "equal-score tie randomization can be toggled without moving active/prepared/played anchors",
      "equal-score tie randomization stays stable within the same ranking group",
      "score feed influences the next Runtime calculation",
      "missing Algorithm context is restored before retrying final observation",
      "stop-situation finalizes Audience aggregate without moving preparedNext",
      "deferred stop queues finalization without blocking on Algorithm",
      "Audience aggregate unavailability does not break stop-situation",
      "active becomes played only after stop",
      "previous restores the last played situation",
      "runtime reader tolerates trailing stale JSON bytes",
      "runtime state writes are atomic during concurrent live polling",
      "reset runs cannot become current after late saves",
      "reset returns to idle",
    ],
  }, null, 2));
  process.stdout.write("\n");

  await resetTestDb();
}

main().catch(async (err) => {
  await resetTestDb();
  process.stderr.write(`${err.stack || err.message}\n`);
  process.exit(1);
});
