#!/usr/bin/env node
"use strict";

const assert = require("assert");
const {
  ALGORITHM_RANDOM_SLOT_VALUE,
  buildAlgorithmOrder,
  buildSceneWarnings,
  calculateRunScore,
  calculateRunScoreDetails,
  composeScenePrompt,
  computeEntityScores,
  normalizePerformer,
  normalizeScene,
  normalizeSceneCharacterSlotsForPerformerRoles,
  normalizeSceneForPerformerRoles,
  pickRecommendation,
  resolveRandomCharacterSlotsForPerformerRoles,
  resolveRandomEnvironmentForScene,
  validateSceneLinks,
} = require("../lib/show-algorithm");
const {
  incomingWins,
  normalizeOscProfile,
  normalizePeerUrls,
  normalizeSyncSettingRows,
  syncSettingIsAllowed,
} = require("../lib/local-sync");

function testScoreFormula() {
  assert.strictEqual(
    calculateRunScore({ heartCount: 10, boredCount: 2, commentCount: 4 }),
    8
  );
}

function testScoreWeightsAffectRuns() {
  const run = { heartCount: 10, boredCount: 2, commentCount: 4 };
  assert.strictEqual(calculateRunScore(run, { heartWeight: 2 }), 18);
  assert(calculateRunScore(run, { boredWeight: -2 }) < calculateRunScore(run));
  assert(calculateRunScore(run, { commentWeight: 1 }) > calculateRunScore(run));
}

function testTimeNormalizedScoreBlend() {
  const run = {
    heartCount: 10,
    boredCount: 0,
    commentCount: 0,
    startedAt: "2026-01-01T00:00:00.000Z",
    endedAt: "2026-01-01T00:02:00.000Z",
  };
  const raw = calculateRunScoreDetails(run, { timeNormalizedBlend: 0 });
  const blended = calculateRunScoreDetails(run, { timeNormalizedBlend: 0.5 });
  const perMinute = calculateRunScoreDetails(run, { timeNormalizedBlend: 1 });
  assert.strictEqual(raw.rawScore, 10);
  assert.strictEqual(raw.score, 10);
  assert.strictEqual(perMinute.perMinuteScore, 5);
  assert.strictEqual(perMinute.score, 5);
  assert.strictEqual(blended.score, 7.5);
}

function testTimeNormalizedScoreRewardsShortRuns() {
  const shortRun = {
    heartCount: 10,
    startedAt: "2026-01-01T00:00:00.000Z",
    endedAt: "2026-01-01T00:01:00.000Z",
  };
  const longRun = {
    heartCount: 10,
    startedAt: "2026-01-01T00:00:00.000Z",
    endedAt: "2026-01-01T00:05:00.000Z",
  };
  assert.strictEqual(calculateRunScore(shortRun, { timeNormalizedBlend: 0 }), calculateRunScore(longRun, { timeNormalizedBlend: 0 }));
  assert(calculateRunScore(shortRun, { timeNormalizedBlend: 1 }) > calculateRunScore(longRun, { timeNormalizedBlend: 1 }));
}

function testEntityScoresUseCurrentScoreSettings() {
  const scores = computeEntityScores({
    scenes: [{ id: 1, title: "Peter", characterIds: [1], isActive: true }],
    runs: [{
      id: 1,
      sceneId: 1,
      endedAt: "2026-01-01T00:01:00.000Z",
      score: 999,
      heartCount: 2,
    }],
    settings: { heartWeight: 3 },
  });
  assert.strictEqual(scores.scenes[0].average, 6);
  assert.strictEqual(scores.characters[0].average, 6);
}

function testRecommendationUsesCurrentScoreSettings() {
  const scenes = [
    { id: 1, title: "Lang sterk", sortOrder: 1, characterIds: [1], isActive: true },
    { id: 2, title: "Kort sterk", sortOrder: 2, characterIds: [2], isActive: true },
    { id: 3, title: "Lang vervolg", sortOrder: 3, characterIds: [1], isActive: true },
    { id: 4, title: "Kort vervolg", sortOrder: 4, characterIds: [2], isActive: true },
  ];
  const runs = [
    {
      id: 1,
      sceneId: 1,
      runOrder: 1,
      heartCount: 10,
      startedAt: "2026-01-01T00:00:00.000Z",
      endedAt: "2026-01-01T00:05:00.000Z",
    },
    {
      id: 2,
      sceneId: 2,
      runOrder: 2,
      heartCount: 3,
      startedAt: "2026-01-01T00:10:00.000Z",
      endedAt: "2026-01-01T00:10:30.000Z",
    },
  ];
  assert.strictEqual(
    pickRecommendation({ scenes, runs, settings: { calibrationCount: 0, timeNormalizedBlend: 0 } }).scene.id,
    3
  );
  assert.strictEqual(
    pickRecommendation({ scenes, runs, settings: { calibrationCount: 0, timeNormalizedBlend: 1 } }).scene.id,
    4
  );
}

function testRecentPopularCharacterGetsDiversityPenalty() {
  const scenes = [
    { id: 1, title: "Penelope calibratie", sortOrder: 1, characterIds: [1], isActive: true },
    { id: 2, title: "Penelope terug", sortOrder: 2, characterIds: [1], isActive: true },
    { id: 3, title: "Ander personage", sortOrder: 3, characterIds: [2], isActive: true },
    { id: 4, title: "Ander ijkpunt", sortOrder: 4, characterIds: [2], isActive: true },
  ];
  const runs = [
    { id: 1, sceneId: 4, runOrder: 1, heartCount: 8, endedAt: "2026-01-01T00:00:00.000Z" },
    { id: 2, sceneId: 1, runOrder: 2, heartCount: 10, endedAt: "2026-01-01T00:01:00.000Z" },
  ];
  const order = buildAlgorithmOrder({
    scenes,
    runs,
    settings: { calibrationCount: 0, characterCooldownWindow: 1, diversityWeight: 5, explorationWeight: 0.5 },
  });
  assert.strictEqual(order.next.sceneId, 3);
  const penelope = order.rows.find((entry) => entry.sceneId === 2);
  assert(penelope.scoreBreakdown.recencyPenalty > 0);
}

function testPopularCharacterReturnsAfterCooldownWindow() {
  const scenes = [
    { id: 1, title: "Penelope oud", sortOrder: 1, characterIds: [1], isActive: true },
    { id: 2, title: "Penelope terug", sortOrder: 2, characterIds: [1], isActive: true },
    { id: 3, title: "Minder sterk alternatief", sortOrder: 3, characterIds: [2], isActive: true },
    { id: 4, title: "Tussenruimte A", sortOrder: 4, characterIds: [3], isActive: true },
    { id: 5, title: "Tussenruimte B", sortOrder: 5, characterIds: [4], isActive: true },
    { id: 6, title: "Tussenruimte C", sortOrder: 6, characterIds: [5], isActive: true },
  ];
  const runs = [
    { id: 1, sceneId: 1, runOrder: 1, heartCount: 10, endedAt: "2026-01-01T00:00:00.000Z" },
    { id: 2, sceneId: 4, runOrder: 2, heartCount: 1, endedAt: "2026-01-01T00:01:00.000Z" },
    { id: 3, sceneId: 5, runOrder: 3, heartCount: 1, endedAt: "2026-01-01T00:02:00.000Z" },
    { id: 4, sceneId: 6, runOrder: 4, heartCount: 1, endedAt: "2026-01-01T00:03:00.000Z" },
  ];
  const order = buildAlgorithmOrder({
    scenes,
    runs,
    settings: { calibrationCount: 0, characterCooldownWindow: 3, diversityWeight: 5 },
  });
  assert.strictEqual(order.next.sceneId, 2);
  assert.strictEqual(order.next.scoreBreakdown.recencyPenalty, 0);
}

function testActiveSceneCountsForDiversityPenalty() {
  const scenes = [
    { id: 1, title: "Penelope actief", sortOrder: 1, characterIds: [1], isActive: true },
    { id: 2, title: "Penelope meteen terug", sortOrder: 2, characterIds: [1], isActive: true },
    { id: 3, title: "Ademruimte", sortOrder: 3, characterIds: [2], isActive: true },
    { id: 4, title: "Penelope eerder", sortOrder: 4, characterIds: [1], isActive: true },
    { id: 5, title: "Ademruimte eerder", sortOrder: 5, characterIds: [2], isActive: true },
    { id: 6, title: "Filler laatst", sortOrder: 6, characterIds: [3], isActive: true },
  ];
  const runs = [
    { id: 1, sceneId: 4, runOrder: 1, heartCount: 10, endedAt: "2026-01-01T00:00:00.000Z" },
    { id: 2, sceneId: 5, runOrder: 2, heartCount: 8, endedAt: "2026-01-01T00:01:00.000Z" },
    { id: 3, sceneId: 6, runOrder: 3, heartCount: 0, endedAt: "2026-01-01T00:02:00.000Z" },
    { id: 4, sceneId: 1, runOrder: 4, startedAt: "2026-01-01T00:03:00.000Z" },
  ];
  const order = buildAlgorithmOrder({
    scenes,
    runs,
    settings: { calibrationCount: 0, characterCooldownWindow: 1, diversityWeight: 5 },
  });
  assert.strictEqual(order.active.sceneId, 1);
  assert.strictEqual(order.next.sceneId, 3);
  assert(order.rows.find((entry) => entry.sceneId === 2).scoreBreakdown.recencyPenalty > 0);
}

function testExplorationBonusRewardsUnderTestedScenes() {
  const scenes = [
    { id: 1, title: "Bekender personage", sortOrder: 1, characterIds: [1], isActive: true },
    { id: 2, title: "Nieuw personage", sortOrder: 2, characterIds: [2], isActive: true },
    { id: 3, title: "Oude test", sortOrder: 3, characterIds: [1], isActive: true },
  ];
  const runs = [
    { id: 1, sceneId: 3, runOrder: 1, heartCount: 0, endedAt: "2026-01-01T00:00:00.000Z" },
  ];
  const order = buildAlgorithmOrder({
    scenes,
    runs,
    settings: { calibrationCount: 0, diversityWeight: 0, explorationWeight: 1 },
  });
  assert.strictEqual(order.next.sceneId, 2);
  assert(order.next.scoreBreakdown.explorationBonus > order.rows.find((entry) => entry.sceneId === 1).scoreBreakdown.explorationBonus);
}

function testRetryBonusIsSoft() {
  const scenes = [
    { id: 1, title: "Slecht gevallen", sortOrder: 1, characterIds: [1], isActive: true },
    { id: 2, title: "Nog steeds sterker", sortOrder: 2, characterIds: [2], isActive: true },
    { id: 3, title: "Laatst gespeeld", sortOrder: 3, characterIds: [3], isActive: true },
  ];
  const runs = [
    { id: 1, sceneId: 1, runOrder: 1, boredCount: 1, endedAt: "2026-01-01T00:00:00.000Z" },
    { id: 2, sceneId: 2, runOrder: 2, heartCount: 2, endedAt: "2026-01-01T00:01:00.000Z" },
    { id: 3, sceneId: 3, runOrder: 3, heartCount: 0, endedAt: "2026-01-01T00:02:00.000Z" },
  ];
  const order = buildAlgorithmOrder({
    scenes,
    runs,
    settings: { calibrationCount: 0, diversityWeight: 0, retryWeight: 0.35, sceneRepeatPenalty: 1 },
  });
  const low = order.rows.find((entry) => entry.sceneId === 1);
  assert(low.scoreBreakdown.retryBonus > 0);
  assert.strictEqual(order.next.sceneId, 2);
}

function testSceneRepeatPenaltyAfterCycle() {
  const scenes = [
    { id: 1, title: "Een", sortOrder: 1, characterIds: [1], isActive: true },
    { id: 2, title: "Twee", sortOrder: 2, characterIds: [2], isActive: true },
    { id: 3, title: "Drie", sortOrder: 3, characterIds: [3], isActive: true },
  ];
  const runs = [
    { id: 1, sceneId: 1, runOrder: 1, heartCount: 3, endedAt: "2026-01-01T00:00:00.000Z" },
    { id: 2, sceneId: 2, runOrder: 2, heartCount: 3, endedAt: "2026-01-01T00:01:00.000Z" },
    { id: 3, sceneId: 3, runOrder: 3, heartCount: 3, endedAt: "2026-01-01T00:02:00.000Z" },
  ];
  const order = buildAlgorithmOrder({
    scenes,
    runs,
    settings: { calibrationCount: 0, sceneRepeatPenalty: 2 },
  });
  assert.strictEqual(order.cycleComplete, true);
  assert.strictEqual(order.rows.find((entry) => entry.sceneId === 1).scoreBreakdown.sceneRepeatPenalty, 2);
}

function testFinalScoreTieBreaksDeterministically() {
  const scenes = [
    { id: 2, title: "Tweede", sortOrder: 2, isActive: true },
    { id: 1, title: "Eerste", sortOrder: 1, isActive: true },
  ];
  const order = buildAlgorithmOrder({
    scenes,
    runs: [],
    settings: { calibrationCount: 0, diversityWeight: 0, explorationWeight: 0, retryWeight: 0, sceneRepeatPenalty: 0 },
  });
  assert.strictEqual(order.next.sceneId, 1);
}

function testCalibrationFixedOrder() {
  const scenes = [
    { id: 1, title: "Een", sortOrder: 1, isActive: true },
    { id: 2, title: "Twee", sortOrder: 2, isActive: true },
  ];
  const result = pickRecommendation({
    scenes,
    runs: [{ id: 1, sceneId: 1, runOrder: 1, endedAt: "2026-01-01T00:00:00.000Z", heartCount: 1 }],
    settings: { calibrationCount: 5 },
  });
  assert.strictEqual(result.calibration.active, true);
  assert.strictEqual(result.scene.id, 2);
}

function testRecommendationSkipsLastScene() {
  const scenes = [
    { id: 1, title: "Peter solo", sortOrder: 1, characterIds: [1], situationIds: [1], isActive: true },
    { id: 2, title: "Peter terug", sortOrder: 2, characterIds: [1], situationIds: [1], isActive: true },
  ];
  const runs = [
    { id: 1, sceneId: 1, runOrder: 1, endedAt: "2026-01-01T00:00:00.000Z", heartCount: 12, boredCount: 0, score: 12 },
    { id: 2, sceneId: 2, runOrder: 2, endedAt: "2026-01-01T00:01:00.000Z", heartCount: 2, boredCount: 0, score: 2 },
  ];
  const result = pickRecommendation({ scenes, runs, settings: { calibrationCount: 1 } });
  assert.strictEqual(result.calibration.active, false);
  assert.notStrictEqual(result.scene.id, 2);
}

function testCurrentOrderKeepsCalibrationFixed() {
  const scenes = Array.from({ length: 6 }, (_, index) => ({
    id: index + 1,
    title: `Situatie ${index + 1}`,
    sortOrder: index + 1,
    isActive: true,
  }));
  const order = buildAlgorithmOrder({
    scenes,
    runs: [{ id: 1, sceneId: 1, runOrder: 1, endedAt: "2026-01-01T00:00:00.000Z", score: 1 }],
    settings: { calibrationCount: 5 },
  });
  assert.deepStrictEqual(order.calibrationScenes.map((entry) => entry.sceneId), [1, 2, 3, 4, 5]);
  assert.strictEqual(order.calibration.active, true);
  assert.strictEqual(order.next.sceneId, 2);
  assert.deepStrictEqual(order.upcoming.map((entry) => entry.sceneId), [6]);
}

function testCurrentOrderRowsStartAtFirstAfterReset() {
  const scenes = [
    { id: 1, title: "Een", sortOrder: 1, isActive: true },
    { id: 2, title: "Twee", sortOrder: 2, isActive: true },
    { id: 3, title: "Drie", sortOrder: 3, isActive: true },
  ];
  const order = buildAlgorithmOrder({ scenes, runs: [], settings: { calibrationCount: 2 } });
  assert.deepStrictEqual(order.rows.map((entry) => entry.sceneId), [1, 2, 3]);
  assert.strictEqual(order.next.sceneId, 1);
  assert.strictEqual(order.next.rank, 1);
  assert.strictEqual(order.rows[0].next, true);
  assert.strictEqual(order.rows[0].active, false);
  assert.strictEqual(order.rows.filter((entry) => entry.next).length, 1);
}

function testCurrentOrderRowsMarkActiveWithNext() {
  const scenes = [
    { id: 1, title: "Een", sortOrder: 1, isActive: true },
    { id: 2, title: "Twee", sortOrder: 2, isActive: true },
  ];
  const runs = [{ id: 1, sceneId: 1, runOrder: 1, startedAt: "2026-01-01T00:00:00.000Z" }];
  const order = buildAlgorithmOrder({ scenes, runs, settings: { calibrationCount: 2 } });
  assert.strictEqual(order.active.sceneId, 1);
  assert.strictEqual(order.next.sceneId, 2);
  assert.strictEqual(order.next.rank, 2);
  assert.strictEqual(order.rows[0].active, true);
  assert.strictEqual(order.rows[0].next, false);
  assert.strictEqual(order.rows[1].active, false);
  assert.strictEqual(order.rows[1].next, true);
  assert.strictEqual(order.rows.filter((entry) => entry.active).length, 1);
  assert.strictEqual(order.rows.filter((entry) => entry.next).length, 1);
}

function testCurrentOrderRowsAdvanceAfterStop() {
  const scenes = [
    { id: 1, title: "Een", sortOrder: 1, isActive: true },
    { id: 2, title: "Twee", sortOrder: 2, isActive: true },
    { id: 3, title: "Drie", sortOrder: 3, isActive: true },
  ];
  const runs = [{ id: 1, sceneId: 1, runOrder: 1, endedAt: "2026-01-01T00:00:00.000Z", score: 1 }];
  const order = buildAlgorithmOrder({ scenes, runs, settings: { calibrationCount: 2 } });
  assert.strictEqual(order.rows[0].played, true);
  assert.strictEqual(order.rows[1].next, true);
  assert.strictEqual(order.next.sceneId, 2);
  assert.strictEqual(order.next.rank, 2);
}

function testCurrentOrderRowsKeepActiveAfterCalibration() {
  const scenes = [
    { id: 1, title: "Calibratie", sortOrder: 1, characterIds: [1], isActive: true },
    { id: 2, title: "Actief later", sortOrder: 2, characterIds: [1], isActive: true },
    { id: 3, title: "Nog later", sortOrder: 3, characterIds: [2], isActive: true },
  ];
  const runs = [
    { id: 1, sceneId: 1, runOrder: 1, endedAt: "2026-01-01T00:00:00.000Z", score: 10 },
    { id: 2, sceneId: 2, runOrder: 2, startedAt: "2026-01-01T00:01:00.000Z" },
  ];
  const order = buildAlgorithmOrder({ scenes, runs, settings: { calibrationCount: 1 } });
  const activeRow = order.rows.find((entry) => entry.sceneId === 2);
  const nextRow = order.rows.find((entry) => entry.sceneId === 3);
  assert(activeRow);
  assert.strictEqual(activeRow.active, true);
  assert(nextRow);
  assert.strictEqual(nextRow.next, true);
  assert.strictEqual(order.active.sceneId, 2);
  assert.strictEqual(order.next.sceneId, 3);
  assert.strictEqual(order.rows.filter((entry) => entry.next).length, 1);
}

function testCurrentOrderRowsKeepActiveAndNextDeepInList() {
  const scenes = Array.from({ length: 35 }, (_, index) => ({
    id: index + 1,
    title: `Situatie ${index + 1}`,
    sortOrder: index + 1,
    isActive: true,
  }));
  const runs = Array.from({ length: 32 }, (_, index) => ({
    id: index + 1,
    sceneId: index + 1,
    runOrder: index + 1,
    endedAt: `2026-01-01T00:${String(index).padStart(2, "0")}:00.000Z`,
    score: 0,
  })).concat([
    { id: 33, sceneId: 33, runOrder: 33, startedAt: "2026-01-01T01:00:00.000Z" },
  ]);
  const order = buildAlgorithmOrder({ scenes, runs, settings: { calibrationCount: 5 } });
  assert.strictEqual(order.active.sceneId, 33);
  assert.strictEqual(order.next.sceneId, 34);
  assert.strictEqual(order.rows[32].active, true);
  assert.strictEqual(order.rows[33].next, true);
  assert.strictEqual(order.rows.filter((entry) => entry.active).length, 1);
  assert.strictEqual(order.rows.filter((entry) => entry.next).length, 1);
}

function testRecommendationMatchesCurrentOrderNext() {
  const scenes = [
    { id: 1, title: "Calibratie", sortOrder: 1, characterIds: [1], isActive: true },
    { id: 2, title: "Peter later", sortOrder: 2, characterIds: [1], isActive: true },
    { id: 3, title: "Penelope later", sortOrder: 3, characterIds: [2], isActive: true },
  ];
  const runs = [{ id: 1, sceneId: 1, runOrder: 1, endedAt: "2026-01-01T00:00:00.000Z", score: 12 }];
  const settings = { calibrationCount: 1 };
  const order = buildAlgorithmOrder({ scenes, runs, settings });
  const recommendation = pickRecommendation({ scenes, runs, settings, order });
  assert.strictEqual(recommendation.scene.id, order.next.sceneId);
  assert.strictEqual(
    buildAlgorithmOrder({ scenes, runs, settings }).next.sceneId,
    order.next.sceneId
  );
}

function testRecommendationMatchesCurrentOrderNextDuringActiveRun() {
  const scenes = [
    { id: 1, title: "Een", sortOrder: 1, isActive: true },
    { id: 2, title: "Twee", sortOrder: 2, isActive: true },
    { id: 3, title: "Drie", sortOrder: 3, isActive: true },
  ];
  const runs = [{ id: 1, sceneId: 1, runOrder: 1, startedAt: "2026-01-01T00:00:00.000Z" }];
  const settings = { calibrationCount: 2 };
  const order = buildAlgorithmOrder({ scenes, runs, settings });
  const recommendation = pickRecommendation({ scenes, runs, settings, order });
  assert.strictEqual(order.active.sceneId, 1);
  assert.strictEqual(order.next.sceneId, 2);
  assert.strictEqual(recommendation.scene.id, order.next.sceneId);
}

function testCurrentOrderRanksAfterCalibration() {
  const scenes = [
    { id: 1, title: "Peter calibratie", sortOrder: 1, characterIds: [1], isActive: true },
    { id: 2, title: "Peter later", sortOrder: 2, characterIds: [1], isActive: true },
    { id: 3, title: "Penelope later", sortOrder: 3, characterIds: [2], isActive: true },
  ];
  const order = buildAlgorithmOrder({
    scenes,
    runs: [{ id: 1, sceneId: 1, runOrder: 1, endedAt: "2026-01-01T00:00:00.000Z", heartCount: 12 }],
    settings: { calibrationCount: 1 },
  });
  assert.strictEqual(order.calibration.active, false);
  assert.strictEqual(order.upcoming[0].sceneId, 2);
  assert.strictEqual(order.next.sceneId, 2);
}

function testPreparedNextLocksLiveQueueAfterCalibration() {
  const scenes = Array.from({ length: 12 }, (_, index) => ({
    id: index + 1,
    title: `Situatie ${index + 1}`,
    sortOrder: index + 1,
    characterIds: [index === 0 || index === 10 ? 1 : index + 10],
    isActive: true,
  }));
  const runs = [1, 2, 3, 4, 5].map((sceneId, index) => ({
    id: sceneId,
    sceneId,
    runOrder: sceneId,
    endedAt: `2026-01-01T00:0${index}:00.000Z`,
    heartCount: sceneId === 1 ? 12 : 0,
  }));
  const settings = {
    calibrationCount: 5,
    diversityWeight: 0,
    explorationWeight: 0,
    retryWeight: 0,
    sceneRepeatPenalty: 0,
  };
  const unlocked = buildAlgorithmOrder({ scenes, runs, settings });
  assert.strictEqual(unlocked.next.sceneId, 11);
  const locked = buildAlgorithmOrder({
    scenes,
    runs,
    settings,
    preparedNext: { sceneId: 11, source: "test", lockedAt: "2026-01-01T00:05:00.000Z" },
  });
  assert.strictEqual(locked.preparedNext.locked, true);
  assert.strictEqual(locked.next.sceneId, 11);
  assert.strictEqual(locked.next.lockedNext, true);
  assert.deepStrictEqual(locked.queueRows.slice(0, 6).map((entry) => entry.sceneId), [1, 2, 3, 4, 5, 11]);
}

function testPreparedNextDoesNotMoveWhenRankingChanges() {
  const scenes = [
    { id: 1, title: "Calibratie", sortOrder: 1, characterIds: [1], isActive: true },
    { id: 2, title: "Oud voorbereid", sortOrder: 2, characterIds: [2], isActive: true },
    { id: 3, title: "Nieuw hoger", sortOrder: 3, characterIds: [3], isActive: true },
    { id: 4, title: "Smaakmaker", sortOrder: 4, characterIds: [3], isActive: true },
  ];
  const runs = [
    { id: 1, sceneId: 1, runOrder: 1, endedAt: "2026-01-01T00:00:00.000Z", heartCount: 1 },
    { id: 2, sceneId: 4, runOrder: 2, endedAt: "2026-01-01T00:01:00.000Z", heartCount: 20 },
  ];
  const settings = { calibrationCount: 1, diversityWeight: 0, explorationWeight: 0, retryWeight: 0, sceneRepeatPenalty: 0 };
  assert.strictEqual(buildAlgorithmOrder({ scenes, runs, settings }).next.sceneId, 3);
  const locked = buildAlgorithmOrder({
    scenes,
    runs,
    settings,
    preparedNext: { sceneId: 2, source: "end_scene", lockedAt: "2026-01-01T00:02:00.000Z" },
  });
  assert.strictEqual(locked.preparedNext.locked, true);
  assert.strictEqual(locked.next.sceneId, 2);
  assert.deepStrictEqual(locked.queueRows.slice(0, 3).map((entry) => entry.sceneId), [1, 4, 2]);
}

function testPreparedNextInvalidatesWhenStartedOrPlayed() {
  const scenes = [
    { id: 1, title: "Een", sortOrder: 1, isActive: true },
    { id: 2, title: "Twee", sortOrder: 2, isActive: true },
  ];
  const activeOrder = buildAlgorithmOrder({
    scenes,
    runs: [{ id: 1, sceneId: 2, runOrder: 1, startedAt: "2026-01-01T00:00:00.000Z" }],
    settings: { calibrationCount: 0 },
    preparedNext: { sceneId: 2, source: "test" },
  });
  assert.strictEqual(activeOrder.preparedNext.locked, false);
  assert.strictEqual(activeOrder.preparedNext.invalidReason, "scene_active");

  const playedOrder = buildAlgorithmOrder({
    scenes,
    runs: [{ id: 1, sceneId: 2, runOrder: 1, endedAt: "2026-01-01T00:00:00.000Z" }],
    settings: { calibrationCount: 0 },
    preparedNext: { sceneId: 2, source: "test" },
  });
  assert.strictEqual(playedOrder.preparedNext.locked, false);
  assert.strictEqual(playedOrder.preparedNext.invalidReason, "scene_already_played");
}

function testPreparedNextLocksFollowingSceneDuringActiveRun() {
  const scenes = Array.from({ length: 12 }, (_, index) => ({
    id: index + 1,
    title: `Situatie ${index + 1}`,
    sortOrder: index + 1,
    characterIds: [index === 0 || index === 10 ? 1 : index + 10],
    isActive: true,
  }));
  const runs = [1, 2, 3, 4, 5].map((sceneId, index) => ({
    id: sceneId,
    sceneId,
    runOrder: sceneId,
    endedAt: `2026-01-01T00:0${index}:00.000Z`,
    heartCount: sceneId === 1 ? 12 : 0,
  }));
  runs.push({
    id: 6,
    sceneId: 6,
    runOrder: 6,
    startedAt: "2026-01-01T00:06:00.000Z",
  });
  const settings = {
    calibrationCount: 5,
    diversityWeight: 0,
    explorationWeight: 0,
    retryWeight: 0,
    sceneRepeatPenalty: 0,
  };
  const unlocked = buildAlgorithmOrder({ scenes, runs, settings });
  assert.strictEqual(unlocked.next.sceneId, 11);

  const locked = buildAlgorithmOrder({
    scenes,
    runs,
    settings,
    preparedNext: { sceneId: 7, source: "scene_started", lockedAt: "2026-01-01T00:06:00.000Z" },
  });
  assert.strictEqual(locked.active.sceneId, 6);
  assert.strictEqual(locked.preparedNext.locked, true);
  assert.strictEqual(locked.next.sceneId, 7);
  assert.strictEqual(locked.next.lockedNext, true);
  assert.deepStrictEqual(locked.queueRows.slice(0, 7).map((entry) => entry.sceneId), [1, 2, 3, 4, 5, 6, 7]);
  assert.strictEqual(locked.queueRows[5].active, true);
  assert.strictEqual(locked.queueRows[6].next, true);
  assert.strictEqual(locked.queueRows[6].lockedNext, true);
}

function testLiveRankingMovesHighSceneIntoNextQueuePosition() {
  const scenes = Array.from({ length: 50 }, (_, index) => ({
    id: index + 1,
    title: `Situatie ${index + 1}`,
    sortOrder: index + 1,
    characterIds: [index === 0 || index === 45 ? 1 : index + 10],
    isActive: true,
  }));
  const runs = [1, 2, 3, 4, 5].map((sceneId, index) => ({
    id: sceneId,
    sceneId,
    runOrder: sceneId,
    endedAt: `2026-01-01T00:0${index}:00.000Z`,
    heartCount: sceneId === 1 ? 12 : 0,
  }));
  const order = buildAlgorithmOrder({
    scenes,
    runs,
    settings: {
      calibrationCount: 5,
      diversityWeight: 0,
      explorationWeight: 0,
      retryWeight: 0,
      sceneRepeatPenalty: 0,
    },
  });
  assert.strictEqual(order.next.sceneId, 46);
  assert.strictEqual(order.queueRows[5].sceneId, 46);
  assert.strictEqual(order.queueRows[5].queuePosition, 6);
}

function testLockedQueueShowsFifthNextAndSixthPlannedAfterStoppingFourthCalibration() {
  const scenes = Array.from({ length: 50 }, (_, index) => ({
    id: index + 1,
    title: `Situatie ${index + 1}`,
    sortOrder: index + 1,
    characterIds: [index === 0 || index === 45 ? 1 : index + 10],
    isActive: true,
  }));
  const runs = [1, 2, 3, 4].map((sceneId, index) => ({
    id: sceneId,
    sceneId,
    runOrder: sceneId,
    endedAt: `2026-01-01T00:0${index}:00.000Z`,
    heartCount: sceneId === 1 ? 12 : 0,
  }));
  const lockedQueue = [1, 2, 3, 4, 5, 46].map((sceneId, index) => ({
    position: index + 1,
    sceneId,
    source: "test",
    lockedAt: `2026-01-01T00:0${index}:00.000Z`,
    randomSeed: `seed-${index + 1}`,
  }));
  const order = buildAlgorithmOrder({
    scenes,
    runs,
    settings: { calibrationCount: 5 },
    lockedQueue,
  });
  assert.strictEqual(order.next.sceneId, 5);
  assert.strictEqual(order.next.lockedNext, true);
  assert.strictEqual(order.next.randomSeed, "seed-5");
  assert.deepStrictEqual(order.queueRows.slice(0, 6).map((entry) => entry.sceneId), [1, 2, 3, 4, 5, 46]);
  assert.strictEqual(order.queueRows[4].next, true);
  assert.strictEqual(order.queueRows[5].lockedFuture, true);
  assert.strictEqual(order.queueRows[5].queuePosition, 6);
}

function testLockedQueueRevealsSixthWhenFifthCalibrationStarts() {
  const scenes = Array.from({ length: 50 }, (_, index) => ({
    id: index + 1,
    title: `Situatie ${index + 1}`,
    sortOrder: index + 1,
    characterIds: [index === 0 || index === 45 ? 1 : index + 10],
    isActive: true,
  }));
  const runs = [1, 2, 3, 4].map((sceneId, index) => ({
    id: sceneId,
    sceneId,
    runOrder: sceneId,
    endedAt: `2026-01-01T00:0${index}:00.000Z`,
    heartCount: sceneId === 1 ? 12 : 0,
  }));
  runs.push({
    id: 5,
    sceneId: 5,
    runOrder: 5,
    startedAt: "2026-01-01T00:05:00.000Z",
  });
  const lockedQueue = [1, 2, 3, 4, 5, 46].map((sceneId, index) => ({
    position: index + 1,
    sceneId,
    source: "test",
    randomSeed: `seed-${index + 1}`,
  }));
  const order = buildAlgorithmOrder({
    scenes,
    runs,
    settings: { calibrationCount: 5 },
    lockedQueue,
  });
  assert.strictEqual(order.active.sceneId, 5);
  assert.strictEqual(order.next.sceneId, 46);
  assert.strictEqual(order.next.queuePosition, 6);
  assert.strictEqual(order.next.randomSeed, "seed-6");
  assert.deepStrictEqual(order.queueRows.slice(0, 6).map((entry) => entry.sceneId), [1, 2, 3, 4, 5, 46]);
  assert.strictEqual(order.queueRows[4].active, true);
  assert.strictEqual(order.queueRows[5].next, true);
  assert.strictEqual(order.queueRows[5].lockedNext, true);
}

function testCurrentOrderHidesPlayedUntilCycleComplete() {
  const scenes = [
    { id: 1, title: "Een", sortOrder: 1, isActive: true },
    { id: 2, title: "Twee", sortOrder: 2, isActive: true },
    { id: 3, title: "Drie", sortOrder: 3, isActive: true },
  ];
  const order = buildAlgorithmOrder({
    scenes,
    runs: [{ id: 1, sceneId: 1, runOrder: 1, endedAt: "2026-01-01T00:00:00.000Z", score: 1 }],
    settings: { calibrationCount: 1 },
  });
  assert.deepStrictEqual(order.upcoming.map((entry) => entry.sceneId).sort(), [2, 3]);
  assert(order.hiddenPlayed.some((entry) => entry.sceneId === 1));
}

function testCurrentOrderSkipsLastWhenEverythingPlayed() {
  const scenes = [
    { id: 1, title: "Een", sortOrder: 1, isActive: true },
    { id: 2, title: "Twee", sortOrder: 2, isActive: true },
    { id: 3, title: "Drie", sortOrder: 3, isActive: true },
  ];
  const order = buildAlgorithmOrder({
    scenes,
    runs: [
      { id: 1, sceneId: 1, runOrder: 1, endedAt: "2026-01-01T00:00:00.000Z", score: 1 },
      { id: 2, sceneId: 2, runOrder: 2, endedAt: "2026-01-01T00:01:00.000Z", score: 1 },
      { id: 3, sceneId: 3, runOrder: 3, endedAt: "2026-01-01T00:02:00.000Z", score: 1 },
    ],
    settings: { calibrationCount: 1 },
  });
  assert.strictEqual(order.cycleComplete, true);
  assert(order.upcoming.length > 0);
  assert.notStrictEqual(order.upcoming[0].sceneId, 3);
  assert.deepStrictEqual(order.hiddenPlayed, []);
}

function testCurrentOrderKeepsInvalidOutOfUpcoming() {
  const catalog = {
    characters: [
      { id: 1, name: "Peter", isActive: true },
      { id: 2, name: "Penelope", isActive: false },
    ],
    situations: [],
    environments: [{ id: 1, name: "Kamer", isActive: true }],
  };
  const scenes = [
    { id: 1, title: "Ok", sortOrder: 1, characterIds: [1], environmentId: 1, isActive: true },
    { id: 2, title: "Invalid", sortOrder: 2, characterIds: [2], environmentId: 1, isActive: true },
  ];
  const order = buildAlgorithmOrder({ scenes, runs: [], settings: { calibrationCount: 0 }, catalog });
  assert(order.invalid.some((entry) => entry.sceneId === 2));
  assert(!order.upcoming.some((entry) => entry.sceneId === 2));
}

function testContextSceneDefaultOff() {
  assert.strictEqual(normalizeScene({ id: 1, title: "Los" }).contextSceneId, 0);
}

function testContextSceneValidation() {
  const catalog = {
    characters: [],
    situations: [],
    environments: [],
    scenes: [
      { id: 1, title: "Context", isActive: true },
      { id: 2, title: "Vervolg", contextSceneId: 1, isActive: true },
      { id: 3, title: "Non-actief", isActive: false },
    ],
  };
  assert.strictEqual(
    validateSceneLinks({ id: 2, title: "Vervolg", contextSceneId: 1, isActive: true }, catalog).ok,
    true
  );
  const self = validateSceneLinks({ id: 2, title: "Zelf", contextSceneId: 2, isActive: true }, catalog);
  assert.strictEqual(self.ok, false);
  assert(self.issues.includes("context_scene_self"));
  const inactive = validateSceneLinks({ id: 2, title: "Mist", contextSceneId: 3, isActive: true }, catalog);
  assert.strictEqual(inactive.ok, false);
  assert(inactive.issues.includes("context_scene_inactive:3"));
  const cycle = validateSceneLinks(
    { id: 1, title: "A", contextSceneId: 2, isActive: true },
    {
      ...catalog,
      scenes: [
        { id: 1, title: "A", contextSceneId: 2, isActive: true },
        { id: 2, title: "B", contextSceneId: 1, isActive: true },
      ],
    }
  );
  assert.strictEqual(cycle.ok, false);
  assert(cycle.issues.includes("context_scene_cycle:1"));
}

function testContextSceneIsQueuedBeforeDependent() {
  const scenes = [
    { id: 1, title: "Context eerst", sortOrder: 1, characterIds: [2], isActive: true },
    { id: 2, title: "Vervolg", sortOrder: 2, characterIds: [1], contextSceneId: 1, isActive: true },
    { id: 3, title: "Smaaktest", sortOrder: 3, characterIds: [1], isActive: true },
  ];
  const runs = [{ id: 1, sceneId: 3, runOrder: 1, endedAt: "2026-01-01T00:00:00.000Z", score: 12 }];
  const catalog = { scenes, characters: [{ id: 1, name: "Peter", isActive: true }, { id: 2, name: "Penelope", isActive: true }] };
  const order = buildAlgorithmOrder({ scenes, runs, settings: { calibrationCount: 1 }, catalog });
  assert.strictEqual(order.next.sceneId, 1);
  assert.deepStrictEqual(
    order.calibrationScenes.concat(order.upcoming).slice(0, 2).map((entry) => entry.sceneId),
    [1, 2]
  );
  assert(order.blockedContext.some((entry) => entry.sceneId === 2));
  assert.deepStrictEqual(order.blockedContext.find((entry) => entry.sceneId === 2).issues, []);
}

function testContextSceneUnlocksAfterRun() {
  const scenes = [
    { id: 1, title: "Context eerst", sortOrder: 1, characterIds: [2], isActive: true },
    { id: 2, title: "Vervolg", sortOrder: 2, characterIds: [1], contextSceneId: 1, isActive: true },
    { id: 3, title: "Smaaktest", sortOrder: 3, characterIds: [1], isActive: true },
  ];
  const runs = [
    { id: 1, sceneId: 3, runOrder: 1, endedAt: "2026-01-01T00:00:00.000Z", score: 12 },
    { id: 2, sceneId: 1, runOrder: 2, endedAt: "2026-01-01T00:01:00.000Z", score: 0 },
  ];
  const catalog = { scenes, characters: [{ id: 1, name: "Peter", isActive: true }, { id: 2, name: "Penelope", isActive: true }] };
  const order = buildAlgorithmOrder({ scenes, runs, settings: { calibrationCount: 1 }, catalog });
  assert.strictEqual(order.next.sceneId, 2);
  assert(!order.blockedContext.some((entry) => entry.sceneId === 2));
}

function testContextSceneResetsWithRuns() {
  const scenes = [
    { id: 1, title: "Context eerst", sortOrder: 1, isActive: true },
    { id: 2, title: "Vervolg", sortOrder: 2, contextSceneId: 1, isActive: true },
  ];
  const order = buildAlgorithmOrder({ scenes, runs: [], settings: { calibrationCount: 0 }, catalog: { scenes } });
  assert.strictEqual(order.next.sceneId, 1);
  assert(order.blockedContext.some((entry) => entry.sceneId === 2));
}

function testContextSceneDoesNotMoveToBottomWhenAlreadyAfterContext() {
  const scenes = [
    { id: 1, title: "Context eerst", sortOrder: 1, isActive: true },
    { id: 2, title: "Vervolg", sortOrder: 2, contextSceneId: 1, isActive: true },
    { id: 3, title: "Andere situatie", sortOrder: 3, isActive: true },
  ];
  const order = buildAlgorithmOrder({ scenes, runs: [], settings: { calibrationCount: 0 }, catalog: { scenes } });
  assert.deepStrictEqual(order.upcoming.map((entry) => entry.sceneId), [1, 2, 3]);
  assert.strictEqual(order.upcoming[1].blocked, true);
  assert.deepStrictEqual(order.upcoming[1].issues, []);
}

function testSceneLinkValidation() {
  const catalog = {
    characters: [
      { id: 1, name: "Peter", isActive: true },
      { id: 2, name: "Penelope", isActive: true },
    ],
    situations: [
      {
        id: 1,
        name: "Slaapkamer",
        requiredCharacterIds: [1],
        allowedCharacterIds: [1, 2],
        isActive: true,
      },
    ],
    environments: [{ id: 1, name: "Kamer", isActive: true }],
  };
  assert.strictEqual(
    validateSceneLinks(
      { id: 1, title: "Ok", characterIds: [1, 2], situationIds: [1], environmentId: 1 },
      catalog
    ).ok,
    true
  );
  const invalid = validateSceneLinks(
    { id: 2, title: "Mist", characterIds: [2], situationIds: [1], environmentId: 1 },
    catalog
  );
  assert.strictEqual(invalid.ok, false);
  assert(invalid.issues.includes("required_character_missing:1"));
  const duplicate = validateSceneLinks(
    { id: 3, title: "Dubbel", characterCount: 2, characterSlots: [1, 1], characterIds: [1], environmentId: 1 },
    catalog
  );
  assert.strictEqual(duplicate.ok, false);
  assert(duplicate.issues.includes("character_duplicate:1"));
  const multipleRandom = validateSceneLinks(
    { id: 4, title: "Randoms", characterCount: 3, characterSlots: [0, 0, 0], characterIds: [], environmentMode: "random" },
    catalog
  );
  assert.strictEqual(multipleRandom.ok, true);
  const inactiveLinks = validateSceneLinks(
    {
      id: 5,
      title: "Non-actief",
      characterCount: 1,
      characterSlots: [3],
      characterIds: [3],
      environmentId: 2,
      environmentMode: "selected",
    },
    {
      ...catalog,
      characters: catalog.characters.concat([{ id: 3, name: "Simone", isActive: false }]),
      environments: catalog.environments.concat([{ id: 2, name: "Gang", isActive: false }]),
    }
  );
  assert.strictEqual(inactiveLinks.ok, false);
  assert(inactiveLinks.issues.includes("character_inactive:3"));
  assert(inactiveLinks.issues.includes("environment_inactive:2"));
}

function testCastWarningsIgnoreFlexibleCharacters() {
  const warnings = buildSceneWarnings(
    { id: 1, title: "Flexibel", characterCount: 2, characterSlots: [1, 2], characterIds: [1, 2] },
    {
      characters: [
        { id: 1, name: "Anne-Fleur", performerId: 0, isActive: true },
        { id: 2, name: "Boer", performerId: 0, isActive: true },
      ],
      performers: [{ id: 1, name: "Megan", isActive: true }],
    }
  );
  assert.deepStrictEqual(warnings, []);
}

function testCastWarningsDetectSamePerformer() {
  const warnings = buildSceneWarnings(
    { id: 1, title: "Dubbel", characterCount: 2, characterSlots: [1, 2], characterIds: [1, 2] },
    {
      characters: [
        { id: 1, name: "Anne-Fleur", performerId: 1, isActive: true },
        { id: 2, name: "Lisa", performerId: 1, isActive: true },
      ],
      performers: [{ id: 1, name: "Megan", isActive: true }],
    }
  );
  assert.deepStrictEqual(warnings, ["performer_conflict:1:1,2"]);
}

function testCastWarningsAllowDifferentPerformers() {
  const warnings = buildSceneWarnings(
    { id: 1, title: "Geen dubbel", characterCount: 2, characterSlots: [1, 2], characterIds: [1, 2] },
    {
      characters: [
        { id: 1, name: "Anne-Fleur", performerId: 1, isActive: true },
        { id: 2, name: "Boer", performerId: 2, isActive: true },
      ],
      performers: [
        { id: 1, name: "Megan", isActive: true },
        { id: 2, name: "Booi", isActive: true },
      ],
    }
  );
  assert.deepStrictEqual(warnings, []);
}

function testCastWarningsIgnoreRandomSlots() {
  const warnings = buildSceneWarnings(
    { id: 1, title: "Random", characterCount: 3, characterSlots: [1, 0, 2], characterIds: [1, 2] },
    {
      characters: [
        { id: 1, name: "Anne-Fleur", performerId: 1, isActive: true },
        { id: 2, name: "Lisa", performerId: 1, isActive: true },
      ],
      performers: [{ id: 1, name: "Megan", isActive: true }],
    }
  );
  assert.deepStrictEqual(warnings, ["performer_conflict:1:1,2"]);

  const onlyRandom = buildSceneWarnings(
    { id: 2, title: "Random alleen", characterCount: 2, characterSlots: [1, 0], characterIds: [1] },
    {
      characters: [{ id: 1, name: "Anne-Fleur", performerId: 1, isActive: true }],
      performers: [{ id: 1, name: "Megan", isActive: true }],
    }
  );
  assert.deepStrictEqual(onlyRandom, []);
}

function testCastWarningsDoNotBlockOrder() {
  const catalog = {
    performers: [{ id: 1, name: "Megan", isActive: true }],
    characters: [
      { id: 1, name: "Anne-Fleur", performerId: 1, isActive: true },
      { id: 2, name: "Lisa", performerId: 1, isActive: true },
    ],
    situations: [],
    environments: [],
  };
  const scenes = [
    { id: 1, title: "Dubbele rol", sortOrder: 1, characterCount: 2, characterSlots: [1, 2], characterIds: [1, 2], isActive: true },
  ];
  const order = buildAlgorithmOrder({ scenes, runs: [], settings: { calibrationCount: 0 }, catalog: { ...catalog, scenes } });
  assert.strictEqual(order.invalid.length, 0);
  assert.strictEqual(order.next.sceneId, 1);
  assert.deepStrictEqual(order.upcoming[0].warnings, ["performer_conflict:1:1,2"]);
}

function testPerformerRoleSlotNormalization() {
  assert.strictEqual(normalizePerformer({ name: "Booi", roleSlot: 1 }).roleSlot, 1);
  assert.strictEqual(normalizePerformer({ name: "Megan", roleSlot: 2 }).roleSlot, 2);
  assert.strictEqual(normalizePerformer({ name: "Brent", roleSlot: 3 }).roleSlot, 3);
  assert.strictEqual(normalizePerformer({ name: "Iedereen", roleSlot: 8 }).roleSlot, 3);
  assert.strictEqual(normalizePerformer({ name: "Geen", roleSlot: -1 }).roleSlot, 0);
}

function testRoleSlotsMoveFixedPerformersToActorSlots() {
  const catalog = {
    performers: [
      { id: 1, name: "Booi", roleSlot: 1, isActive: true },
      { id: 2, name: "Megan", roleSlot: 2, isActive: true },
      { id: 3, name: "Brent", roleSlot: 3, isActive: true },
    ],
    characters: [
      { id: 11, name: "Booi-rol", performerId: 1, isActive: true },
      { id: 12, name: "Megan-rol", performerId: 2, isActive: true },
      { id: 13, name: "Brent-rol", performerId: 3, isActive: true },
    ],
  };
  assert.deepStrictEqual(
    normalizeSceneCharacterSlotsForPerformerRoles([12, 11, 13], catalog),
    [11, 12, 13]
  );
}

function testRoleSlotsFillFreeActorSlotsWithFlexibleCharacters() {
  const catalog = {
    performers: [{ id: 2, name: "Megan", roleSlot: 2, isActive: true }],
    characters: [
      { id: 1, name: "Flex", performerId: 0, isActive: true },
      { id: 2, name: "Megan-rol", performerId: 2, isActive: true },
    ],
  };
  assert.deepStrictEqual(
    normalizeSceneCharacterSlotsForPerformerRoles([2, 1], catalog),
    [1, 2, 0]
  );
}

function testRoleSlotsKeepEmptyActorSlotsAsNone() {
  const catalog = {
    performers: [{ id: 3, name: "Brent", roleSlot: 3, isActive: true }],
    characters: [{ id: 3, name: "Brent-rol", performerId: 3, isActive: true }],
  };
  assert.deepStrictEqual(
    normalizeSceneCharacterSlotsForPerformerRoles([3, 0], catalog),
    [0, 0, 3]
  );
}

function testRoleSlotsPlaceRandomAfterConcreteActorSlots() {
  const catalog = {
    performers: [{ id: 3, name: "Brent", roleSlot: 3, isActive: true }],
    characters: [
      { id: 1, name: "Flex", performerId: 0, isActive: true },
      { id: 3, name: "Brent-rol", performerId: 3, isActive: true },
    ],
  };
  assert.deepStrictEqual(
    normalizeSceneCharacterSlotsForPerformerRoles([1, 3, ALGORITHM_RANDOM_SLOT_VALUE], catalog),
    [1, ALGORITHM_RANDOM_SLOT_VALUE, 3]
  );
}

function testRoleSlotsKeepExtraRolesAfterActorSlots() {
  const catalog = {
    performers: [{ id: 3, name: "Brent", roleSlot: 3, isActive: true }],
    characters: [
      { id: 1, name: "Flex 1", performerId: 0, isActive: true },
      { id: 2, name: "Flex 2", performerId: 0, isActive: true },
      { id: 3, name: "Brent-rol", performerId: 3, isActive: true },
      { id: 4, name: "Flex 3", performerId: 0, isActive: true },
    ],
  };
  assert.deepStrictEqual(
    normalizeSceneCharacterSlotsForPerformerRoles([3, 1, 2, 4], catalog),
    [1, 2, 3, 4]
  );
}

function testSceneForPerformerRolesUpdatesCharacterIdsAndCount() {
  const catalog = {
    performers: [{ id: 3, name: "Brent", roleSlot: 3, isActive: true }],
    characters: [{ id: 3, name: "Brent-rol", performerId: 3, isActive: true }],
  };
  const scene = normalizeSceneForPerformerRoles(
    { id: 1, title: "Brent solo", characterCount: 1, characterSlots: [3], characterIds: [3] },
    catalog
  );
  assert.deepStrictEqual(scene.characterSlots, [0, 0, 3]);
  assert.deepStrictEqual(scene.characterIds, [3]);
  assert.strictEqual(scene.characterCount, 3);
}

function testRandomSlotsResolveWithinPerformerCandidates() {
  const catalog = {
    performers: [
      { id: 1, name: "Booi", roleSlot: 1, isActive: true },
      { id: 2, name: "Megan", roleSlot: 2, isActive: true },
      { id: 3, name: "Brent", roleSlot: 3, isActive: true },
    ],
    characters: [
      { id: 1, name: "Peter", performerId: 0, isActive: true },
      { id: 2, name: "Antoine", performerId: 3, isActive: true },
      { id: 3, name: "Adolf", performerId: 3, isActive: true },
      { id: 4, name: "Anne-Fleur", performerId: 2, isActive: true },
      { id: 5, name: "Lisa", performerId: 2, isActive: true },
    ],
  };
  const result = resolveRandomCharacterSlotsForPerformerRoles(
    [1, 3, ALGORITHM_RANDOM_SLOT_VALUE],
    catalog,
    { seed: "peter-adolf-random" }
  );
  assert.strictEqual(result.characterSlots[0], 1);
  assert.strictEqual(result.characterSlots[2], 3);
  assert([4, 5].includes(result.characterSlots[1]));
  assert(!result.characterSlots.includes(2));
  assert.strictEqual(new Set(result.characterSlots.filter((id) => id > 0)).size, 3);
}

function testMultipleRandomSlotsResolvePerPerformerWithoutDuplicates() {
  const catalog = {
    performers: [
      { id: 1, name: "Booi", roleSlot: 1, isActive: true },
      { id: 2, name: "Megan", roleSlot: 2, isActive: true },
      { id: 3, name: "Brent", roleSlot: 3, isActive: true },
    ],
    characters: [
      { id: 1, name: "Booi-random", performerId: 1, isActive: true },
      { id: 2, name: "Megan-random-1", performerId: 2, isActive: true },
      { id: 3, name: "Megan-random-2", performerId: 2, isActive: true },
      { id: 4, name: "Brent-vast", performerId: 3, isActive: true },
      { id: 5, name: "Brent-anders", performerId: 3, isActive: true },
    ],
  };
  const result = resolveRandomCharacterSlotsForPerformerRoles(
    [4, ALGORITHM_RANDOM_SLOT_VALUE, ALGORITHM_RANDOM_SLOT_VALUE],
    catalog,
    { seed: "two-randoms" }
  );
  assert.strictEqual(result.characterSlots[0], 1);
  assert([2, 3].includes(result.characterSlots[1]));
  assert.strictEqual(result.characterSlots[2], 4);
  assert(!result.characterSlots.includes(5));
  assert.strictEqual(new Set(result.characterSlots.filter((id) => id > 0)).size, 3);
}

function testRandomEnvironmentResolvesToConcreteEnvironment() {
  const catalog = {
    environments: [
      { id: 1, name: "Keuken", description: "Een krappe keuken.", isActive: true },
      { id: 2, name: "Tennisbaan", description: "Een natte tennisbaan.", isActive: true },
    ],
  };
  const result = resolveRandomEnvironmentForScene(
    { id: 1, title: "Random plek", environmentMode: "random" },
    catalog,
    { seed: "random-environment" }
  );
  assert.strictEqual(result.scene.environmentMode, "selected");
  assert([1, 2].includes(result.scene.environmentId));
  assert(result.randomEnvironment && result.randomEnvironment.name);
}

function testPromptCompositionWithResolvedRandomEnvironmentHasNoRandomPlaceholder() {
  const catalog = {
    environments: [
      { id: 7, name: "Kelder", description: "Een lage kelder.", isActive: true },
    ],
  };
  const resolved = resolveRandomEnvironmentForScene(
    { id: 1, title: "Random plek", environmentMode: "random" },
    catalog,
    { seed: "resolved-env-prompt" }
  );
  const prompt = composeScenePrompt({
    scene: resolved.scene,
    environment: catalog.environments[0],
    settings: { calibrationCount: 1 },
  });
  assert(prompt.includes("Locatie: Kelder"));
  assert(!prompt.includes("Random omgeving"));
}

function testPromptComposition() {
  const prompt = composeScenePrompt({
    scene: { id: 1, title: "De test", promptOverride: "Peter bekent iets." },
    characters: [{ id: 1, name: "Peter", description: "Peter is nerveus." }],
    situations: [{ id: 1, name: "Bekentenis", description: "Een bekentenis loopt mis." }],
    environment: { id: 1, name: "Keuken", description: "Een krappe keuken." },
    settings: { calibrationCount: 1 },
    audienceContext: "Publiekssmaak: Peter scoort hoog.",
  });
  assert(prompt.includes("Peter Peter is nerveus."));
  assert(prompt.includes("Een bekentenis loopt mis."));
  assert(prompt.includes("Locatie: Keuken"));
  assert(prompt.includes("Titel: De test"));
  assert(prompt.includes("Publiekssmaak: Peter scoort hoog."));
}

function testPromptCompositionWithRandomSlots() {
  const prompt = composeScenePrompt({
    scene: {
      id: 1,
      title: "Random bezoek",
      characterCount: 3,
      characterSlots: [1, ALGORITHM_RANDOM_SLOT_VALUE, 0],
      environmentMode: "random",
      promptOverride: "Iemand verschijnt onverwacht.",
    },
    characters: [{ id: 1, name: "Peter", description: "Peter is nerveus." }],
    performers: [{ id: 1, name: "Megan", roleSlot: 2, isActive: true }],
    settings: { calibrationCount: 1 },
  });
  assert(prompt.includes("Personage 1: Peter Peter is nerveus."));
  assert(!prompt.includes("random personage voor"));
  assert(!prompt.includes("Random omgeving"));
}

function testPromptCompositionSkipsEmptySlots() {
  const prompt = composeScenePrompt({
    scene: {
      id: 1,
      title: "Leeg drietal",
      characterCount: 3,
      characterSlots: [0, 0, 0],
      environmentMode: "random",
    },
    settings: { calibrationCount: 1 },
  });
  assert(prompt.includes("Geen personages."));
  assert(!prompt.includes("random personage."));
}

function testSyncLastWriteWins() {
  assert.strictEqual(incomingWins("2026-05-07T10:00:00.000Z", "2026-05-07T10:00:01.000Z"), true);
  assert.strictEqual(incomingWins("2026-05-07T10:00:01.000Z", "2026-05-07T10:00:00.000Z"), false);
}

function testSyncSettingsFilterSecrets() {
  assert.strictEqual(syncSettingIsAllowed("algorithm_global_prompt"), true);
  assert.strictEqual(syncSettingIsAllowed("algorithm_score_heart_weight"), true);
  assert.strictEqual(syncSettingIsAllowed("algorithm_score_bored_weight"), true);
  assert.strictEqual(syncSettingIsAllowed("algorithm_score_comment_weight"), true);
  assert.strictEqual(syncSettingIsAllowed("algorithm_score_time_normalized_blend"), true);
  assert.strictEqual(syncSettingIsAllowed("algorithm_variation_character_cooldown_window"), true);
  assert.strictEqual(syncSettingIsAllowed("algorithm_variation_diversity_weight"), true);
  assert.strictEqual(syncSettingIsAllowed("algorithm_variation_exploration_weight"), true);
  assert.strictEqual(syncSettingIsAllowed("algorithm_variation_retry_weight"), true);
  assert.strictEqual(syncSettingIsAllowed("algorithm_variation_scene_repeat_penalty"), true);
  assert.strictEqual(syncSettingIsAllowed("osc_profile_device-1"), true);
  assert.strictEqual(syncSettingIsAllowed("admin_password_hash_scrypt_v1"), false);
  const rows = normalizeSyncSettingRows([
    { key: "algorithm_global_prompt", value: "A", updated_at: "2026-05-07T10:00:00.000Z" },
    { key: "admin_password_hash_scrypt_v1", value: "secret", updated_at: "2026-05-07T10:00:00.000Z" },
  ]);
  assert.deepStrictEqual(rows.map((row) => row.key), ["algorithm_global_prompt"]);
}

function testSyncPeerNormalization() {
  assert.deepStrictEqual(
    normalizePeerUrls(["http://192.168.1.49:3310/", "http://192.168.1.49:3310", "ftp://x"]),
    ["http://192.168.1.49:3310"]
  );
}

function testOscProfilesAreDeviceScoped() {
  const profile = normalizeOscProfile({
    sendEnabled: true,
    listenPort: 6767,
    sendHost: "192.168.1.49",
    sendPort: 8002,
  });
  assert.strictEqual(profile.sendEnabled, true);
  assert.strictEqual(profile.listenPort, 6767);
  assert.strictEqual(profile.sendHost, "192.168.1.49");
  assert.strictEqual(profile.sendPort, 8002);
  assert.strictEqual(normalizeOscProfile({ sendEnabled: true, sendHost: "", sendPort: 8002 }).sendEnabled, false);
}

testScoreFormula();
testScoreWeightsAffectRuns();
testTimeNormalizedScoreBlend();
testTimeNormalizedScoreRewardsShortRuns();
testEntityScoresUseCurrentScoreSettings();
testRecommendationUsesCurrentScoreSettings();
testRecentPopularCharacterGetsDiversityPenalty();
testPopularCharacterReturnsAfterCooldownWindow();
testActiveSceneCountsForDiversityPenalty();
testExplorationBonusRewardsUnderTestedScenes();
testRetryBonusIsSoft();
testSceneRepeatPenaltyAfterCycle();
testFinalScoreTieBreaksDeterministically();
testCalibrationFixedOrder();
testRecommendationSkipsLastScene();
testCurrentOrderKeepsCalibrationFixed();
testCurrentOrderRowsStartAtFirstAfterReset();
testCurrentOrderRowsMarkActiveWithNext();
testCurrentOrderRowsAdvanceAfterStop();
testCurrentOrderRowsKeepActiveAfterCalibration();
testCurrentOrderRowsKeepActiveAndNextDeepInList();
testRecommendationMatchesCurrentOrderNext();
testRecommendationMatchesCurrentOrderNextDuringActiveRun();
testCurrentOrderRanksAfterCalibration();
testPreparedNextLocksLiveQueueAfterCalibration();
testPreparedNextDoesNotMoveWhenRankingChanges();
testPreparedNextInvalidatesWhenStartedOrPlayed();
testPreparedNextLocksFollowingSceneDuringActiveRun();
testLiveRankingMovesHighSceneIntoNextQueuePosition();
testLockedQueueShowsFifthNextAndSixthPlannedAfterStoppingFourthCalibration();
testLockedQueueRevealsSixthWhenFifthCalibrationStarts();
testCurrentOrderHidesPlayedUntilCycleComplete();
testCurrentOrderSkipsLastWhenEverythingPlayed();
testCurrentOrderKeepsInvalidOutOfUpcoming();
testContextSceneDefaultOff();
testContextSceneValidation();
testContextSceneIsQueuedBeforeDependent();
testContextSceneUnlocksAfterRun();
testContextSceneResetsWithRuns();
testContextSceneDoesNotMoveToBottomWhenAlreadyAfterContext();
testSceneLinkValidation();
testCastWarningsIgnoreFlexibleCharacters();
testCastWarningsDetectSamePerformer();
testCastWarningsAllowDifferentPerformers();
testCastWarningsIgnoreRandomSlots();
testCastWarningsDoNotBlockOrder();
testPerformerRoleSlotNormalization();
testRoleSlotsMoveFixedPerformersToActorSlots();
testRoleSlotsFillFreeActorSlotsWithFlexibleCharacters();
testRoleSlotsKeepEmptyActorSlotsAsNone();
testRoleSlotsPlaceRandomAfterConcreteActorSlots();
testRoleSlotsKeepExtraRolesAfterActorSlots();
testSceneForPerformerRolesUpdatesCharacterIdsAndCount();
testRandomSlotsResolveWithinPerformerCandidates();
testMultipleRandomSlotsResolvePerPerformerWithoutDuplicates();
testRandomEnvironmentResolvesToConcreteEnvironment();
testPromptCompositionWithResolvedRandomEnvironmentHasNoRandomPlaceholder();
testPromptComposition();
testPromptCompositionWithRandomSlots();
testPromptCompositionSkipsEmptySlots();
testSyncLastWriteWins();
testSyncSettingsFilterSecrets();
testSyncPeerNormalization();
testOscProfilesAreDeviceScoped();

console.log("show-algorithm tests passed");
