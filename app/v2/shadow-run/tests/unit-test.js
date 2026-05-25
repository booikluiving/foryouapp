"use strict";

const assert = require("node:assert/strict");

const { validateShadowRunReportShape } = require("../../shared/contracts/shadow-run-v0");
const { compareShadowRun } = require("../compare/shadow-compare");

const catalog = {
  schemaVersion: "catalog.read-model.v0",
  performers: [{ id: "performer:1", legacyId: 1, name: "Performer A", performerSlot: 1, active: true }],
  characters: [{
    id: "character:1",
    legacyId: 1,
    name: "Ada",
    legacyPerformerId: 1,
    performerIds: ["performer:1"],
    active: true,
  }],
  environments: [{ id: "environment:1", legacyId: 1, name: "Studio", active: true }],
  labels: [{ id: "label:1", legacyId: 1, name: "Intro", active: true }],
  mediaAssets: [],
  situations: [{
    id: "situation:1",
    legacyId: 1,
    title: "Start",
    sortOrder: 1,
    characterCount: 1,
    characterIds: ["character:1"],
    legacyCharacterIds: [1],
    characterSlots: [{ slotIndex: 1, mode: "fixed-character", characterId: "character:1", legacyCharacterId: 1 }],
    environmentId: "environment:1",
    legacyEnvironmentId: 1,
    environmentMode: "selected",
    labelIds: ["label:1"],
    legacyLabelIds: [1],
    legacySituationIds: [],
    active: true,
  }],
};

const paths = {
  schemaVersion: "paths.snapshot.v0",
  paths: [{
    id: "path:1",
    legacyId: 1,
    name: "Start path",
    active: true,
    archivedAt: null,
    legacySituationIds: [1],
    nodes: [{ legacySituationId: 1, isEndNode: false, ignoreCrossingBlocks: false }],
    edges: [],
    thresholds: [],
    blockRules: [],
  }],
  crossingThresholds: [],
};

async function main() {
  const report = compareShadowRun({
    catalog,
    paths,
    pathEvaluation: {
      schemaVersion: "paths.evaluation.v0",
      items: [{ situationId: "situation:1", legacySituationId: 1, status: "available", pathAvailable: true }],
    },
    runtimeState: {
      showRunId: "show-run-20260524-200000000Z",
      preparedNext: {
        situationId: "situation:1",
        legacySituationId: 1,
        reason: "start_run",
      },
      eligiblePool: [{ situationId: "situation:1" }],
    },
    createdAtDate: new Date("2026-05-24T20:00:00.000Z"),
  });
  assert.equal(validateShadowRunReportShape(report).length, 0);
  assert.equal(report.comparison.availablePool.summary, undefined);
  assert.deepEqual(report.comparison.availablePool.onlyInV1, []);
  assert.deepEqual(report.comparison.availablePool.onlyInV2, []);
  assert.deepEqual(report.comparison.availablePoolExplanations.onlyInV1, []);
  assert.deepEqual(report.comparison.availablePoolExplanations.onlyInV2, []);
  assert.equal(report.v1.availablePoolLayer, "v1-order-available-rows");
  assert.equal(report.v2.availablePoolLayer, "v2-paths-pathAvailable");
  assert.equal(report.v2.runtimeEligiblePoolMatchesPathAvailable, true);
  assert.equal(report.comparison.preparedNext.matches, true);
  assert.equal(report.comparison.summary.availablePoolMatches, true);
  assert.equal(report.comparison.summary.runtimeEligibleMatchesPathAvailable, true);
  assert.equal(report.comparison.summary.differenceCount, 0);

  process.stdout.write(JSON.stringify({
    ok: true,
    shadowRunId: report.shadowRunId,
    availablePoolMatches: report.comparison.summary.availablePoolMatches,
    preparedNextMatches: report.comparison.summary.preparedNextMatches,
    assertions: [
      "V1 oracle can be built from V2 snapshots",
      "available pools are compared as V2 situation ids at the Paths pathAvailable layer",
      "Runtime eligiblePool is checked against Paths pathAvailable",
      "preparedNext comparison records match/explanation",
    ],
  }, null, 2));
  process.stdout.write("\n");
}

main().catch((err) => {
  process.stderr.write(`${err.stack || err.message}\n`);
  process.exit(1);
});
