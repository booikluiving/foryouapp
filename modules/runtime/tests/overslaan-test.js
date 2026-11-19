"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");

const TEST_DB_DIR = path.join(__dirname, ".tmp-overslaan-db");
process.env.RUNTIME_DB_DIR = TEST_DB_DIR;

const {
  assertNoAlgorithmRuntimeOwnershipFields,
  buildEligiblePool,
  previousSituation,
  receiveScores,
  refreshEligiblePool,
  resetRun,
  startRun,
  prepareChosenSituation,
  setTestRun,
  skipPreparedSituation,
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

// Knop OVERSLAAN: de klaargezette scène vervalt voor de run, de volgende in de keten komt klaar.
async function main() {
  await resetTestDb();
  const clients = {
    fetchCatalogSnapshot: async () => cloneJson(catalogFixture),
    fetchPathsSnapshot: async () => cloneJson(pathsFixture),
    fetchAlgorithmConfigSnapshot: async () => cloneJson(algorithmConfigFixture),
    initializeAlgorithmScoringContext: async (payload) => ({ ok: true, scoreFeed: neutralScoreFeed(payload.showRunId) }),
    observeSituation: async (event) => ({ observation: { ...event, observedScore: 1 }, scoreFeed: neutralScoreFeed(event.showRunId) }),
    evaluatePaths: (playedSituationIds) => evaluatePaths(playedSituationIds),
  };
  const state = await startRun({ clients, orderSettings: { startSceneCount: 0 } });
  const eerste = state.preparedNext.situationId;
  await skipPreparedSituation(state, clients, { situationId: eerste, skipSave: true });
  assert.notEqual(state.preparedNext.situationId, eerste, "skip prepares another scene");
  assert.equal(state.preparedNext.reason, "operator_skipped");
  assert.equal(state.resolvedPreparedNext.situationId, state.preparedNext.situationId);
  assert.deepEqual(state.skippedSituations.map((item) => item.situationId), [eerste]);
  assert.ok(!state.eligiblePool.some((item) => item.situationId === eerste), "a skipped scene leaves the pool");
  await assert.rejects(
    () => skipPreparedSituation(state, clients, { situationId: eerste, skipSave: true }),
    /runtime_skip_stale/,
    "a second press for the old scene does not skip the new one"
  );
  const tweede = state.preparedNext.situationId;
  await skipPreparedSituation(state, clients, { skipSave: true });
  const derde = state.preparedNext.situationId;
  assert.ok(![eerste, tweede].includes(derde), "skipping again moves on down the chain");
  await assert.rejects(
    () => skipPreparedSituation(state, clients, { skipSave: true }),
    /runtime_skip_nothing_left/,
    "skipping the last free scene is refused"
  );
  assert.equal(state.preparedNext.situationId, derde, "a refused skip keeps the prepared scene");
  assert.equal(state.skippedSituations.length, 2);
  await startSituation(state, clients, { skipSave: true });
  await assert.rejects(() => skipPreparedSituation(state, clients, { skipSave: true }), /runtime_skip_requires_no_active_situation/);
  await stopSituation(state, clients, { skipSave: true });
  const daarna = state.preparedNext && state.preparedNext.situationId;
  assert.ok(![eerste, tweede].includes(daarna), "skipped scenes do not come back in the run");
  await saveRunState(state);
  assert.equal((await readRunState(state.showRunId)).skippedSituations.length, 2, "skipped scenes are saved with the run");
  process.stdout.write(JSON.stringify({ ok: true, eerste, tweede, derde, daarna }) + "\n");
  await resetTestDb();
}

main().catch(async (err) => {
  await resetTestDb();
  process.stderr.write(`${err.stack || err.message}\n`);
  process.exit(1);
});
