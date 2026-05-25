"use strict";

const assert = require("node:assert/strict");

const {
  assertNoRuntimeOwnershipFields,
  createAlgorithmRun,
  getScoreFeed,
  observeSituation,
} = require("../scoring/algorithm-service");

const showRunId = "show-run-20260524-120000000Z";
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
  ],
  labels: [{ id: "label:fun" }, { id: "label:dark" }],
  characters: [{ id: "character:1" }, { id: "character:2" }, { id: "character:3" }],
};

async function main() {
  const created = await createAlgorithmRun({ showRunId, catalog });
  assert.equal(created.scoreFeed.scores.length, 3, "Algorithm should score every situation");
  const neutralScores = created.scoreFeed.scores.map((score) => score.predictedScore);
  assert.deepEqual(neutralScores, [0, 0, 0], "Equal neutral scores should remain equal");

  assert.throws(
    () => assertNoRuntimeOwnershipFields({ preparedNext: { situationId: "situation:1" } }),
    /algorithm_forbidden_runtime_field:preparedNext/
  );

  const result = await observeSituation({
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
  });
  assert(result.observation.observedScore > 0, "positive signals should produce positive observed score");
  assert.equal(result.scoreFeed.scores.length, 3);
  const observed = result.scoreFeed.scores.find((score) => score.situationId === "situation:1");
  const sharedLabel = result.scoreFeed.scores.find((score) => score.situationId === "situation:2");
  const neutral = result.scoreFeed.scores.find((score) => score.situationId === "situation:3");
  assert.equal(observed.observedScore, result.observation.observedScore);
  assert(sharedLabel.predictedScore > neutral.predictedScore, "shared label should be influenced after observation");

  const scoreFeed = await getScoreFeed(showRunId);
  assert.equal(scoreFeed.updatedAfterSituationRunId, `${showRunId}:situation-run:0001`);
  assert(!Object.prototype.hasOwnProperty.call(scoreFeed, "preparedNext"));
  assert(!Object.prototype.hasOwnProperty.call(scoreFeed, "pathAvailable"));
  assert(!Object.prototype.hasOwnProperty.call(scoreFeed, "eligiblePool"));

  process.stdout.write(JSON.stringify({
    ok: true,
    showRunId,
    scoreCount: scoreFeed.scores.length,
    observedScore: result.observation.observedScore,
    assertions: [
      "Algorithm publishes scores for all situations",
      "equal neutral scores remain equal",
      "observed situation updates later predicted scores",
      "runtime/order ownership fields are rejected or absent",
    ],
  }, null, 2));
  process.stdout.write("\n");
}

main().catch((err) => {
  process.stderr.write(`${err.stack || err.message}\n`);
  process.exit(1);
});
