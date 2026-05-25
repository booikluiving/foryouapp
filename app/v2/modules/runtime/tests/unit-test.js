"use strict";

const assert = require("node:assert/strict");

const {
  receiveScores,
  startRun,
  startSituation,
  stopSituation,
} = require("../run-control/runtime-engine");

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
      labelIds: [],
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
      labelIds: [],
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
      labelIds: [],
      active: true,
      archivedAt: null,
    },
  ],
  characters: [
    { id: "character:1", legacyId: 1, name: "A", performerIds: ["performer:1"] },
    { id: "character:2", legacyId: 2, name: "B", performerIds: ["performer:2"] },
    { id: "character:3", legacyId: 3, name: "C", performerIds: ["performer:3"] },
  ],
  environments: [
    { id: "environment:1", legacyId: 1, name: "Room 1", active: true, archivedAt: null },
    { id: "environment:2", legacyId: 2, name: "Room 2", active: true, archivedAt: null },
    { id: "environment:3", legacyId: 3, name: "Room 3", active: true, archivedAt: null },
  ],
};

const pathsFixture = {
  schemaVersion: "paths.snapshot.v0",
  source: { type: "fixture", readOnly: true },
  paths: [],
  crossingThresholds: [],
};

function pathStatus(situationId, legacySituationId, status, isPathStart) {
  return {
    situationId,
    legacySituationId,
    status,
    pathAvailable: status === "available",
    pathLocked: status === "locked",
    pathStatuses: [{ status, isPathStart: !!isPathStart, pathId: "path:1", pathName: "Fixture" }],
  };
}

function evaluatePaths(playedSituationIds) {
  const played = new Set(playedSituationIds || []);
  const items = [
    pathStatus("situation:1", 1, played.has("situation:1") ? "played" : "available", true),
    pathStatus("situation:2", 2, played.has("situation:1") ? "available" : "locked", false),
    pathStatus("situation:3", 3, played.has("situation:3") ? "played" : "available", true),
  ];
  return Promise.resolve({
    schemaVersion: "paths.evaluation.v0",
    input: { playedSituationIds },
    items,
    pathAvailable: items.filter((item) => item.status === "available").map((item) => item.situationId),
    pathLocked: items.filter((item) => item.pathLocked).map((item) => item.situationId),
  });
}

async function main() {
  const clients = {
    fetchCatalogSnapshot: async () => catalogFixture,
    fetchPathsSnapshot: async () => pathsFixture,
    evaluatePaths,
  };

  const state = await startRun({ clients });
  assert(state.showRunSnapshot.catalog, "start run should freeze catalog");
  assert(state.showRunSnapshot.paths, "start run should freeze paths");
  assert.equal(state.showRunSnapshot.algorithmConfig.schemaVersion, "algorithm.config.placeholder.v0");
  assert.equal(state.preparedNext.situationId, "situation:1");
  assert.equal(state.resolvedPreparedNext.situationId, "situation:1");

  catalogFixture.situations[0].title = "MUTATED AFTER START";
  assert.equal(state.showRunSnapshot.catalog.situations[0].title, "Start A", "showRunSnapshot must be frozen");

  const preparedBeforeScores = state.preparedNext.situationId;
  receiveScores(state, { scores: [{ situationId: "situation:2", score: 999 }] });
  assert.equal(state.preparedNext.situationId, preparedBeforeScores, "score updates must not replace preparedNext");

  await startSituation(state, clients);
  assert.equal(state.activeSituation.situationId, "situation:1");
  assert.equal(state.playedSituations.length, 0, "active situation is not played until stop");
  assert.equal(state.preparedNext.situationId, "situation:3", "Runtime prepares next after active starts");
  const preparedBeforeStop = state.preparedNext.situationId;

  await stopSituation(state, clients);
  assert.equal(state.activeSituation, null);
  assert.equal(state.playedSituations.length, 1);
  assert.equal(state.playedSituations[0].situationId, "situation:1");
  assert.equal(state.preparedNext.situationId, preparedBeforeStop, "stop should not replace already frozen preparedNext");
  assert(!state.eligiblePool.some((item) => item.situationId === "situation:1"), "played situations must not return to eligible pool");

  process.stdout.write(JSON.stringify({
    ok: true,
    showRunId: state.showRunId,
    assertions: [
      "start run freezes snapshots",
      "score feed does not replace preparedNext",
      "active becomes played only after stop",
      "played situations are absent from eligible pool",
    ],
  }, null, 2));
  process.stdout.write("\n");
}

main().catch((err) => {
  process.stderr.write(`${err.stack || err.message}\n`);
  process.exit(1);
});
