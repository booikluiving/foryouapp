"use strict";

const assert = require("node:assert/strict");
const { bouwStageRapport } = require("../server/stage-rapport");

const report = {
  weights: { oordeel: 3, chat: 1, likes: 0.5, roomSound: 0 },
  grenzen: { likesPerTelefoon: 10, chatPerTelefoon: 3 },
  scenes: [
    { nr: 1, situationRunId: "run:1", title: "Een", labels: ["Satirisch"], durationSeconds: 60, viewers: 30, hearts: 40, bored: 5, messages: 2, score: 6.44, calculation: { oordeel: 0.6, oordeelStemmen: 10, chat: 0.2, chatBerichten: 4, likes: 0.28, telefoons: 10, punten: { oordeel: 1.8, chat: 0.2, likes: 0.14 }, totaal: 2.14 }, roomSound: null },
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

const alleLabels = bouwStageRapport({ ...report, labelNames: ["Grof", "Absurd", "Satirisch"] }, {}, "run:1");
assert.deepEqual(alleLabels.labels[2], { naam: "absurd", score: null, nu: false }, "een label zonder gespeelde scène staat er zonder score");
assert.equal(alleLabels.labels.length, 3);

const stemmen = bouwStageRapport(report, { startPhase: { active: true }, preparedNext: { situationId: "situation:7", title: "Zeven" } }, "run:1");
assert.equal(stemmen.hierna, null, "tijdens de startscènes kiest het publiek");

const metGeluid = bouwStageRapport({ ...report, scenes: [{ ...report.scenes[0], roomSound: { averageDb: 60, peakDb: 81.4, liftDb: 21.4, samples: [60, 70, 81.4] } }] }, {}, "");
assert.deepEqual(metGeluid.scene.geluid, { rustDb: 60, piekDb: 81.4, liftDb: 21.4, golf: [60, 70, 81.4] });

assert.equal(metKeuze.scene.camera, null, "zonder camera geen camerablok");
const camScene = { ...report.scenes[0], camera: { seconds: 60, peopleAverage: 11.6, peopleMax: 14, laughMoments: 3, boredMoments: 1, clapMoments: 2, laughPct: 22, attentionPct: 70, boredPct: 30, headshots: 2, boredHeadshots: 1 } };
const metCamera = bouwStageRapport({ ...report, weights: { ...report.weights, cameraLaugh: 2, cameraBored: -2 }, scenes: [camScene] }, {}, "run:1");
assert.equal(metCamera.scene.camera.personen, 12);
assert.equal(metCamera.scene.camera.lachmomenten, 3);
assert.deepEqual(metCamera.scene.camera.groepen, { leukst: [], verveeld: [] }, "de gezichten vult de publieksdienst aan");
assert.deepEqual(metKeuze.som, {
  oordeel: 0.6, oordeelStemmen: 10, wOordeel: 3,
  chat: 0.2, chatBerichten: 4, wChat: 1,
  likes: 0.28, wLikes: 0.5, likesPerTelefoon: 10,
  telefoons: 10,
  punten: { oordeel: 1.8, chat: 0.2, likes: 0.14 },
  totaal: 2.14,
}, "de som: oordeel, chat en likes keer hun gewicht");

console.log("stage-rapport: ok");
