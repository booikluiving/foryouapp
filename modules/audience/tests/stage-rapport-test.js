"use strict";

const assert = require("node:assert/strict");
const { bouwStageRapport } = require("../server/stage-rapport");

const report = {
  weights: { heart: 1, bored: -1, message: 0.05, roomSound: 0 },
  scenes: [
    { nr: 1, situationRunId: "run:1", title: "Een", labels: ["Satirisch"], durationSeconds: 60, viewers: 30, hearts: 40, bored: 5, messages: 2, score: 6.44, calculation: { raw: 35.1, roomSound: 0, durationFactor: 1, audienceFactor: 0.18 }, roomSound: null },
  ],
  labels: [{ name: "Satirisch", averageScore: 6.44 }, { name: "Grof", averageScore: -1.2 }],
  forecast: { bySituation: { "situation:7": 2.26 } },
};

assert.deepEqual(bouwStageRapport(report, {}, "run:9"), { ok: true, klaar: false }, "scène nog niet verwerkt");

const metKeuze = bouwStageRapport(report, { startPhase: { active: false }, preparedNext: { situationId: "situation:7", title: "Zeven" } }, "run:1");
assert.equal(metKeuze.klaar, true);
assert.equal(metKeuze.scene.titel, "Een");
assert.equal(metKeuze.scene.score, 6.4);
assert.equal(metKeuze.scene.geluid, null, "zonder meting geen zaalgeluid in het venster");
assert.deepEqual(metKeuze.hierna, { titel: "Zeven", score: 2.3 });
assert.deepEqual(metKeuze.labels, [{ naam: "satirisch", score: 6.4, nu: true }, { naam: "grof", score: -1.2, nu: false }]);

const stemmen = bouwStageRapport(report, { startPhase: { active: true }, preparedNext: { situationId: "situation:7", title: "Zeven" } }, "run:1");
assert.equal(stemmen.hierna, null, "tijdens de startscènes kiest het publiek");

const metGeluid = bouwStageRapport({ ...report, scenes: [{ ...report.scenes[0], roomSound: { averageDb: 60, peakDb: 81.4, liftDb: 21.4, samples: [60, 70, 81.4] } }] }, {}, "");
assert.deepEqual(metGeluid.scene.geluid, { rustDb: 60, piekDb: 81.4, liftDb: 21.4, golf: [60, 70, 81.4] });

console.log("stage-rapport: ok");
