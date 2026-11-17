"use strict";

// Personagevraag (meer/minder) stuurt het algoritme; labeltrek geeft de procenten per label zoals het algoritme trekt.
const assert = require("node:assert/strict");
const { buildScoreFeed, labelTrek, personageFavorieten } = require("../scoring/score-engine");

const catalog = {
  labels: [{ id: "label:1", name: "Grof" }, { id: "label:2", name: "Absurd" }, { id: "label:3", name: "Satirisch" }],
  characters: [{ id: "character:1", name: "Mark" }, { id: "character:2", name: "Adolf" }],
  situations: [
    { id: "situation:1", title: "Een", labelIds: ["label:1"], characterIds: ["character:1"], active: true },
    { id: "situation:2", title: "Twee", labelIds: ["label:2"], characterIds: ["character:2"], active: true },
    { id: "situation:3", title: "Drie", labelIds: ["label:1"], characterIds: ["character:1"], active: true },
    { id: "situation:4", title: "Vier", labelIds: ["label:2"], characterIds: ["character:2"], active: true },
  ],
};
const observations = [
  { situationRunId: "r1", situationId: "situation:1", labelIds: ["label:1"], characterIds: ["character:1"], observedScore: 8,
    personageVoorkeur: { stemmen: 6, keuzes: [{ characterId: "character:1", delta: 0.5 }, { characterId: "character:2", delta: -0.5 }] } },
  { situationRunId: "r2", situationId: "situation:2", labelIds: ["label:2"], characterIds: ["character:2"], observedScore: 4,
    labelVoorkeur: { labelId: "label:2", delta: 1 } },
];

const zonder = buildScoreFeed({ catalog, observations: observations.map(({ personageVoorkeur, ...rest }) => rest) });
const met = buildScoreFeed({ catalog, observations });
const score = (feed, id) => feed.scores.find((item) => item.situationId === id).predictedScore;
assert.ok(score(met, "situation:3") > score(zonder, "situation:3"), "Mark-scène stijgt door de personagestem");
assert.ok(score(met, "situation:4") < score(zonder, "situation:4"), "Adolf-scène zakt door minder Adolf");
assert.ok(met.scores.find((item) => item.situationId === "situation:3").reasons.includes("publiek_personage_voorkeur"));

const trek = labelTrek({ catalog, observations });
// Grof: 8 × 0,25 = 2. Absurd: 4 × 0,25 + 1 × 1 = 2. Satirisch niet gezien: 0%.
assert.deepEqual(trek.map((rij) => [rij.name, rij.procent]), [["Grof", 100], ["Absurd", 100], ["Satirisch", 0]]);

const fav = personageFavorieten({ observations });
assert.equal(fav[0].characterId, "character:1");
assert.equal(fav[0].voorkeur, 0.5);
assert.equal(fav.length, 1, "wie minder wordt gewild is geen favoriet");
console.log("voorkeur en trek: ok");
