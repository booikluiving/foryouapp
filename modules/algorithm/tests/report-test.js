"use strict";

const assert = require("node:assert/strict");
const { buildAudienceReport } = require("../report/build-report");

const catalog = {
  labels: [{ id: "label:1", name: "Satirisch" }, { id: "label:2", name: "Grof" }, { id: "label:3", name: "Absurd" }],
  characters: [{ id: "character:1", name: "Peter" }, { id: "character:2", name: "Adolf" }],
  situations: [
    { id: "situation:1", title: "Een", labelIds: ["label:1"], characterIds: ["character:1"] },
    { id: "situation:2", title: "Twee", labelIds: ["label:2", "label:3"], characterIds: ["character:2"] },
    { id: "situation:3", title: "Drie", labelIds: ["label:1"], characterIds: ["character:1"] },
    { id: "situation:4", title: "Vier", labelIds: ["label:3"], characterIds: ["character:2"] },
  ],
};
const observation = (nr, situationId, hearts, bored, observedScore) => {
  const situation = catalog.situations.find((item) => item.id === situationId);
  return {
    situationRunId: `run:${nr}`,
    situationId,
    labelIds: situation.labelIds,
    characterIds: situation.characterIds,
    durationSeconds: 60,
    audience: { activeClients: 10 },
    chatAppSignals: { heartCount: hearts, boredCount: bored, rawMessages: ["ja"] },
    observedScore,
  };
};

const leeg = buildAudienceReport({ showRunId: "run", catalog, observations: [], scoreFeed: { scores: [] } });
assert.equal(leeg.totals.scenes, 0);
assert.equal(leeg.conclusion, null);
assert.deepEqual(leeg.labels, []);

const report = buildAudienceReport({
  showRunId: "run",
  catalog,
  observations: [observation(1, "situation:1", 12, 1, 4), observation(2, "situation:2", 2, 6, -2)],
  scoreFeed: {
    scores: [
      { situationId: "situation:1", predictedScore: 4, components: {} },
      { situationId: "situation:3", predictedScore: 1.6, components: { profileLabelAffinity: 1, profileCharacterAffinity: 0.6 } },
      { situationId: "situation:4", predictedScore: 3, components: { liveAudience: 3 } },
    ],
  },
});
assert.equal(report.totals.scenes, 2);
assert.equal(report.totals.hearts, 14);
assert.equal(report.totals.averageScore, 1);
assert.deepEqual(report.conclusion.best.map((row) => row.name), ["Satirisch"]);
assert.deepEqual(report.conclusion.worst.map((row) => row.name), ["Absurd", "Grof"], "gelijke stand: beide labels");
assert.deepEqual(report.labels.map((row) => [row.name, row.scenes, row.averageScore]), [["Satirisch", 1, 4], ["Absurd", 1, -2], ["Grof", 1, -2]]);
assert.deepEqual(report.characters.map((row) => row.name), ["Peter", "Adolf"]);
assert.equal(report.scenes[1].title, "Twee");
assert.equal(report.scenes[1].versusAverage, -3);
assert.deepEqual(report.forecast.highest.map((row) => row.title), ["Drie"], "gespeelde scènes en de scène die nu speelt staan niet in de verwachting");
assert.equal(report.forecast.highest[0].fromLabels, 1);
assert.equal(report.live.title, "Vier");
assert.equal(report.stats.totalMinutes, 2);
assert.equal(report.stats.heartsPerMinute, 7);
assert.equal(report.stats.heartShare, 67);
assert.equal(report.stats.best.title, "Een");
assert.equal(report.stats.worst.title, "Twee");
assert.deepEqual(report.scenes[0].calculation, { raw: 11.05, roomSound: 0, durationFactor: 1, audienceFactor: 0.32 });
assert.equal(leeg.stats.heartShare, null);

// Zaalgeluid telt alleen mee als het gewicht is ingesteld.
const { observedScoreForEvent } = require("../scoring/score-engine");
const metGeluid = { durationSeconds: 60, audience: { activeClients: 1 }, chatAppSignals: { heartCount: 10, boredCount: 0, rawMessages: [] }, roomSound: { averageDb: 60, peakDb: 80, liftDb: 20 } };
assert.equal(observedScoreForEvent(metGeluid, {}), 10);
assert.equal(observedScoreForEvent(metGeluid, { weights: { roomSound: 0.5 } }), 20);

console.log("publieksrapport: ok");
