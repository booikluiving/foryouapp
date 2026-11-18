"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");

const TEST_DIR = __dirname;
const APP_ROOT = path.resolve(TEST_DIR, "../../..");
const TEST_DB_DIR = path.join(APP_ROOT, "modules/algorithm/db/.tmp/unit");
process.env.ALGORITHM_DB_DIR = TEST_DB_DIR;

const {
  assertNoPromptSettings,
  assertNoRuntimeOwnershipFields,
  createAlgorithmRun,
  createScoringContext,
  getAlgorithmConfigSnapshot,
  getScoreFeed,
  getScoringContext,
  observeAudienceSignals,
  observeSituation,
  readAlgorithmConfig,
  simulateSituationObservation,
  updateAlgorithmConfig,
} = require("../scoring/algorithm-service");
const {
  normalizeAlgorithmConfig,
  observedScoreForEvent,
} = require("../scoring/score-engine");

const showRunId = "show-run-20260524-120000000Z";
const effectRunId = "show-run-20260524-120000001Z";
const profileRunId = "show-run-20260524-120000004Z";
const fallbackRunId = "show-run-20260524-120000005Z";
const catalog = {
  schemaVersion: "catalog.read-model.v0",
  source: { type: "fixture", readOnly: true },
  situations: [
    {
      id: "situation:1",
      legacyId: 1,
      title: "Observed",
      labelIds: ["label:fun"],
      characterIds: ["character:1"],
      active: true,
      archivedAt: null,
    },
    {
      id: "situation:2",
      legacyId: 2,
      title: "Shared Label",
      labelIds: ["label:fun"],
      characterIds: ["character:2"],
      active: true,
      archivedAt: null,
    },
    {
      id: "situation:3",
      legacyId: 3,
      title: "Neutral",
      labelIds: ["label:dark"],
      characterIds: ["character:3"],
      active: true,
      archivedAt: null,
    },
    {
      id: "situation:4",
      legacyId: 4,
      title: "Shared Character",
      labelIds: ["label:odd"],
      characterIds: ["character:1"],
      active: true,
      archivedAt: null,
    },
    {
      id: "situation:5",
      legacyId: 5,
      title: "Future Fun",
      labelIds: ["label:fun"],
      characterIds: ["character:5"],
      active: true,
      archivedAt: null,
    },
  ],
  labels: [{ id: "label:fun", name: "Fun" }, { id: "label:dark", name: "Dark" }, { id: "label:odd", name: "Odd" }],
  characters: [
    { id: "character:1", name: "One" },
    { id: "character:2", name: "Two" },
    { id: "character:3", name: "Three" },
    { id: "character:5", name: "Five" },
  ],
};

const forbiddenOutputFields = [
  "preparedNext",
  "currentOrder",
  "pathAvailable",
  "pathLocked",
  "eligiblePool",
  "availablePool",
  "playedSituations",
  "activeSituation",
];

function assertNoForbiddenOutputFields(value) {
  if (!value || typeof value !== "object") return;
  if (Array.isArray(value)) {
    for (const item of value) assertNoForbiddenOutputFields(item);
    return;
  }
  for (const key of Object.keys(value)) {
    assert(!forbiddenOutputFields.includes(key), `published forbidden field ${key}`);
    assertNoForbiddenOutputFields(value[key]);
  }
}

function observedEvent(overrides = {}) {
  return {
    type: "situationObserved",
    showRunId,
    situationRunId: `${showRunId}:situation-run:0001`,
    situationId: "situation:1",
    startedAt: "2026-05-24T12:00:00.000Z",
    endedAt: "2026-05-24T12:02:00.000Z",
    durationSeconds: 120,
    audience: { activeClients: 25 },
    chatAppSignals: {
      heartCount: 20,
      boredCount: 2,
      rawMessages: ["goed", "meer hiervan"],
    },
    ...overrides,
  };
}

async function main() {
  await fs.rm(TEST_DB_DIR, { recursive: true, force: true });

  const defaultConfig = await readAlgorithmConfig();
  assert.equal(defaultConfig.schemaVersion, "algorithm.config.v0");

  const persisted = await updateAlgorithmConfig({
    weights: {
      likes: 99,
      oordeel: -4,
      chat: 0.75,
      diversity: 4,
    },
    normalization: {
      timeCorrection: 2,
      audienceSize: -1,
    },
    neutralPredictedScore: 3.25,
  });
  assert.equal(persisted.weights.likes, 10, "likes weight should clamp");
  assert.equal(persisted.weights.oordeel, 0, "oordeel weight should clamp");
  assert.equal(persisted.normalization.timeCorrection, 1, "time correction should clamp");
  assert.equal(persisted.normalization.audienceSize, 0, "audience normalization should clamp");
  assert.equal((await readAlgorithmConfig()).neutralPredictedScore, 3.25, "config should persist");
  assert.equal((await getAlgorithmConfigSnapshot()).source.readOnly, true, "snapshot should be read-only");
  assert.throws(() => assertNoPromptSettings({ promptTemplate: "nope" }), /algorithm_forbidden_prompt_field:promptTemplate/);
  await assert.rejects(() => updateAlgorithmConfig({ globalPrompt: "script agent only" }), /algorithm_forbidden_prompt_field:globalPrompt/);

  await updateAlgorithmConfig(normalizeAlgorithmConfig({}, { base: defaultConfig }), { replace: true });
  await assert.rejects(
    () => getScoringContext("show-run-20260524-120000099Z"),
    /algorithm_missing_scoring_context:show-run-20260524-120000099Z/,
    "missing Algorithm context should be explicit and recoverable by callers"
  );
  const created = await createScoringContext({ showRunId, catalog });
  assert.equal(created.contextType, "scoring-context");
  assert.equal(created.scoreFeed.scores.length, 5, "Algorithm should score every situation");
  assert.deepEqual(created.scoreFeed.scores.map((score) => score.predictedScore), [0, 0, 0, 0, 0], "Equal neutral scores should remain equal");

  const legacyCreated = await createAlgorithmRun({ showRunId: "show-run-20260524-120000002Z", catalog });
  assert.equal(legacyCreated.contextType, "scoring-context", "runs alias route should create scoring context state");

  assert.throws(
    () => assertNoRuntimeOwnershipFields({ preparedNext: { situationId: "situation:1" } }),
    /algorithm_forbidden_runtime_field:preparedNext/
  );
  await assert.rejects(
    () => createScoringContext({ showRunId: "show-run-20260524-120000003Z", runSnapshot: { catalog, currentOrder: [] } }),
    /algorithm_forbidden_runtime_field:currentOrder/
  );

  const liveLow = await observeAudienceSignals({
    showRunId,
    situationRunId: `${showRunId}:situation-run:0001`,
    situationId: "situation:1",
    startedAt: "2026-05-24T12:00:00.000Z",
    createdAt: "2026-05-24T12:00:30.000Z",
    audience: { activeClients: 1 },
    chatAppSignals: { heartCount: 1, boredCount: 0, rawMessages: [] },
  });
  const liveHigh = await observeAudienceSignals({
    showRunId,
    situationRunId: `${showRunId}:situation-run:0001`,
    situationId: "situation:1",
    startedAt: "2026-05-24T12:00:00.000Z",
    createdAt: "2026-05-24T12:00:40.000Z",
    audience: { activeClients: 1 },
    chatAppSignals: { heartCount: 8, boredCount: 0, rawMessages: ["ja"] },
    rawChat: [{ text: "ja" }],
    audienceAggregateVersion: 2,
  });
  assert.equal(liveHigh.scorePhase, "live");
  assert.equal(liveHigh.scoreFeed.scorePhase, "live");
  assert.equal(liveHigh.scoreFeed.audienceAggregateVersion, 2);
  const liveLowActiveScore = liveLow.scoreFeed.scores.find((score) => score.situationId === "situation:1");
  const liveHighActiveScore = liveHigh.scoreFeed.scores.find((score) => score.situationId === "situation:1");
  assert(liveHighActiveScore.predictedScore > liveLowActiveScore.predictedScore, "live hearts should move the active score");
  assert.equal(liveHighActiveScore.observedScore, null, "live score must not become definitive observedScore");
  assert(liveHighActiveScore.reasons.includes("live_audience_signals"));
  const liveContext = await getScoringContext(showRunId);
  assert.equal(liveContext.observations.length, 0, "live signals must not persist definitive observations");
  assert.equal(liveContext.liveAudienceObservation.situationRunId, `${showRunId}:situation-run:0001`);
  assertNoForbiddenOutputFields(liveHigh.scoreFeed);

  const result = await observeSituation(observedEvent());
  assert(result.observation.observedScore > 0, "positive signals should produce positive observed score");
  assert.equal(result.scoreFeed.scores.length, 5);
  const observed = result.scoreFeed.scores.find((score) => score.situationId === "situation:1");
  const sharedLabel = result.scoreFeed.scores.find((score) => score.situationId === "situation:2");
  const neutral = result.scoreFeed.scores.find((score) => score.situationId === "situation:3");
  assert.equal(observed.observedScore, result.observation.observedScore);
  assert(sharedLabel.predictedScore > neutral.predictedScore, "shared label should be influenced after observation");

  await assert.rejects(
    () => observeSituation(observedEvent({ activeSituation: { situationId: "situation:1" } })),
    /algorithm_forbidden_runtime_field:activeSituation/
  );

  const scoreFeed = await getScoreFeed(showRunId);
  assert.equal(scoreFeed.updatedAfterSituationRunId, `${showRunId}:situation-run:0001`);
  assertNoForbiddenOutputFields(scoreFeed);
  const context = await getScoringContext(showRunId);
  assert.equal(context.observations[0].situationRunId, `${showRunId}:situation-run:0001`);
  assert.equal(context.liveAudienceObservation, null, "final observation should clear live audience state");

  const profileConfig = normalizeAlgorithmConfig({
    weights: {
      heart: 1,
      bored: -1,
      message: 0,
      labelAffinity: 1,
      characterAffinity: 1,
      diversity: 0,
      exploration: 0,
      retry: 0,
      sceneRepeatPenalty: 0,
    },
    normalization: { timeCorrection: 0, audienceSize: 0 },
    profile: { memoryMode: "cumulative_recency", recencyHalfLifeObservations: 1, liveWeightMultiplier: 1.25 },
  });
  await createScoringContext({ showRunId: profileRunId, catalog, config: profileConfig });
  const profileFirst = await observeSituation(observedEvent({
    showRunId: profileRunId,
    situationRunId: `${profileRunId}:situation-run:0001`,
    situationId: "situation:1",
    audience: { activeClients: 1 },
    durationSeconds: 60,
    chatAppSignals: { heartCount: 4, boredCount: 0, rawMessages: [] },
  }));
  const futureFunAfterFirst = profileFirst.scoreFeed.scores.find((score) => score.situationId === "situation:5");
  assert(futureFunAfterFirst.predictedScore > 0, "old positive label signal should lift future matching scenes");
  assert(futureFunAfterFirst.reasons.includes("profile_label_affinity"));
  const sharedCharacterAfterFirst = profileFirst.scoreFeed.scores.find((score) => score.situationId === "situation:4");
  assert(sharedCharacterAfterFirst.predictedScore > 0, "old positive character signal should lift future matching scenes");
  assert(sharedCharacterAfterFirst.reasons.includes("profile_character_affinity"));

  const profileSecond = await observeSituation(observedEvent({
    showRunId: profileRunId,
    situationRunId: `${profileRunId}:situation-run:0002`,
    situationId: "situation:2",
    audience: { activeClients: 1 },
    durationSeconds: 60,
    chatAppSignals: { heartCount: 0, boredCount: 4, rawMessages: [] },
  }));
  const futureFunAfterRecentNegative = profileSecond.scoreFeed.scores.find((score) => score.situationId === "situation:5");
  assert(futureFunAfterRecentNegative.predictedScore < futureFunAfterFirst.predictedScore, "recent negative signal should weigh stronger than old positive signal");
  assert(futureFunAfterRecentNegative.predictedScore < 0, "recency-weighted profile can push matching future scenes down");

  await createScoringContext({ showRunId: fallbackRunId, catalog, config: profileConfig });
  await observeAudienceSignals({
    showRunId: fallbackRunId,
    situationRunId: `${fallbackRunId}:situation-run:0001`,
    situationId: "situation:1",
    startedAt: "2026-05-24T12:00:00.000Z",
    createdAt: "2026-05-24T12:00:30.000Z",
    audience: { activeClients: 1, linkedSignalCount: 3 },
    chatAppSignals: { heartCount: 3, boredCount: 0, rawMessages: [] },
  });
  const fallbackFinal = await observeSituation(observedEvent({
    showRunId: fallbackRunId,
    situationRunId: `${fallbackRunId}:situation-run:0001`,
    situationId: "situation:1",
    audience: {},
    durationSeconds: 60,
    chatAppSignals: {},
  }));
  assert(fallbackFinal.observation.observedScore > 0, "empty final event should use matching live aggregate as fallback");
  assert.equal(fallbackFinal.observation.finalizedFromLiveAudience, true);
  const fallbackContext = await getScoringContext(fallbackRunId);
  assert.equal(fallbackContext.liveAudienceObservation, null, "final fallback should still clear live state");

  // De score: oordeel na de scène (zwaarst), chat (positief of negatief) en likes (begrensd per telefoon).
  const scoreConfig = normalizeAlgorithmConfig({});
  const refs = (telefoon, hart, saai = 0) => [
    ...Array.from({ length: hart }, () => ({ type: "heart", clientKey: telefoon })),
    ...Array.from({ length: saai }, () => ({ type: "bored", clientKey: telefoon })),
  ];
  const heartsLow = observedScoreForEvent({ signalRefs: refs("a", 1) }, scoreConfig);
  const heartsHigh = observedScoreForEvent({ signalRefs: refs("a", 5) }, scoreConfig);
  const heartsSpam = observedScoreForEvent({ signalRefs: refs("a", 500) }, scoreConfig);
  const heartsCapped = observedScoreForEvent({ signalRefs: refs("a", 10) }, scoreConfig);
  const boredHigh = observedScoreForEvent({ signalRefs: refs("a", 5, 4) }, scoreConfig);
  const botsOnly = observedScoreForEvent({ signalRefs: refs("bot", 50).map((ref) => ({ ...ref, isBot: true })) }, scoreConfig);
  const chatPositief = observedScoreForEvent({ signalRefs: refs("a", 5), rawChat: [{ signalId: "c1", clientKey: "a", text: "haha geweldig" }] }, scoreConfig);
  const chatNegatief = observedScoreForEvent({ signalRefs: refs("a", 5), rawChat: [{ signalId: "c1", clientKey: "a", text: "boring" }] }, scoreConfig);
  const chatSpam = observedScoreForEvent({ rawChat: Array.from({ length: 20 }, (_, i) => ({ signalId: `c${i}`, clientKey: "a", text: "lol" })) }, scoreConfig);
  const metOordeel = observedScoreForEvent({ signalRefs: refs("a", 500), oordeel: { gemiddelde: -1, stemmen: 1 } }, scoreConfig);
  const bigAudience = observedScoreForEvent({ signalRefs: refs("a", 5), oordeel: { gemiddelde: 0, stemmen: 10 } }, scoreConfig);
  assert(heartsHigh > heartsLow, "more likes should increase observed score");
  assert.equal(heartsSpam, heartsCapped, "likes are capped per phone");
  assert(boredHigh < heartsHigh, "bored should reduce observed score");
  assert.equal(botsOnly, 0, "bots do not count");
  assert(chatPositief > heartsHigh, "positive chat should increase observed score");
  assert(chatNegatief < heartsHigh, "negative chat should reduce observed score");
  assert.equal(chatSpam, 1, "chat is capped per phone (3 messages, divided by phones)");
  assert(metOordeel < 0, "a bad verdict outweighs spammed likes");
  assert(bigAudience < heartsHigh, "the same likes count less in a bigger audience");

  const effectConfig = normalizeAlgorithmConfig({
    weights: {
      likes: 1,
      chat: 0,
      labelAffinity: 0,
      characterAffinity: 0,
      diversity: 2,
      exploration: 3,
      retry: 4,
      sceneRepeatPenalty: 2,
    },
    normalization: { timeCorrection: 0, audienceSize: 0 },
  });
  await createScoringContext({ showRunId: effectRunId, catalog, config: effectConfig });
  const effectResult = await observeSituation(observedEvent({
    showRunId: effectRunId,
    situationRunId: `${effectRunId}:situation-run:0001`,
    situationId: "situation:1",
    audience: { activeClients: 1 },
    durationSeconds: 60,
    chatAppSignals: { heartCount: 0, boredCount: 3, rawMessages: [] },
  }));
  const effectObserved = effectResult.scoreFeed.scores.find((score) => score.situationId === "situation:1");
  const effectUnobserved = effectResult.scoreFeed.scores.find((score) => score.situationId === "situation:2");
  const effectSharedCharacter = effectResult.scoreFeed.scores.find((score) => score.situationId === "situation:4");
  assert(effectObserved.components.retryBonus > 0, "low observed score should create retry bonus");
  assert.equal(effectObserved.components.sceneRepeatPenalty, 2, "observed situation should get repeat penalty");
  assert(effectUnobserved.components.explorationBonus > effectObserved.components.explorationBonus, "unobserved situation should get stronger exploration");
  assert(effectSharedCharacter.components.diversityPenalty > 0, "recent character overlap should create diversity penalty");

  const simulation = await simulateSituationObservation({
    showRunId,
    situationId: "situation:2",
    durationSeconds: 60,
    audience: { activeClients: 1 },
    chatAppSignals: { heartCount: 50, boredCount: 0, rawMessages: ["sim"] },
  });
  assert.equal(simulation.persisted, false);
  const afterSimulationContext = await getScoringContext(showRunId);
  assert.equal(afterSimulationContext.observations.length, 1, "simulation must not persist observations");

  process.stdout.write(JSON.stringify({
    ok: true,
    showRunId,
    scoreCount: scoreFeed.scores.length,
    observedScore: result.observation.observedScore,
    assertions: [
      "config normalizes and persists",
      "scoring contexts replace algorithm runs while the runs alias works",
      "runtime/order ownership fields are rejected and absent from scorefeed",
      "live audience signals change score feeds without persisting observations",
      "run profile scoring accumulates labels and characters with recency weighting",
      "final observation can fall back to matching live audience aggregate",
      "hearts, bored, chat, time, audience, diversity, exploration, retry and repeat penalty affect scores",
      "simulation does not persist",
    ],
  }, null, 2));
  process.stdout.write("\n");
}

main().catch((err) => {
  process.stderr.write(`${err.stack || err.message}\n`);
  process.exit(1);
});
