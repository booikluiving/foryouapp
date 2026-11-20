"use strict";

// Personagevraag stuurt het algoritme; labeltrek geeft de procenten per label zoals het algoritme trekt.
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
    personageVoorkeur: { stemmen: 4, keuzes: [{ characterId: "character:1", aandeel: 0.75 }] } },
  { situationRunId: "r2", situationId: "situation:2", labelIds: ["label:2"], characterIds: ["character:2"], observedScore: 4,
    labelVoorkeur: { labelId: "label:2", delta: 1 } },
];

const zonder = buildScoreFeed({ catalog, observations: observations.map(({ personageVoorkeur, ...rest }) => rest) });
const met = buildScoreFeed({ catalog, observations });
const score = (feed, id) => feed.scores.find((item) => item.situationId === id).predictedScore;
assert.ok(score(met, "situation:3") > score(zonder, "situation:3"), "Mark-scène stijgt door de personagestem");
assert.equal(score(met, "situation:4"), score(zonder, "situation:4"), "scène zonder Mark blijft gelijk");
assert.ok(met.scores.find((item) => item.situationId === "situation:3").reasons.includes("publiek_personage_voorkeur"));

const trek = labelTrek({ catalog, observations });
// Grof: 8 × 0,25 = 2. Absurd: 4 × 0,25 + 1 × 1 = 2. Satirisch niet gezien: 0%.
assert.deepEqual(trek.map((rij) => [rij.name, rij.procent]), [["Grof", 100], ["Absurd", 100], ["Satirisch", 0]]);

const fav = personageFavorieten({ observations });
assert.equal(fav[0].characterId, "character:1");
// Eén personage: 75 % ja, 25 % "Hoeft niet" → voorkeur 0,75 − 0,25 = 0,5.
assert.equal(fav[0].aandeel, 0.5);

// De personagevraag is relatief: gelijk verdeeld = 0, minder dan gelijk = min, "Hoeft niet" = min.
const { personageVoorkeurWaarden } = require("../scoring/score-engine");
const waarden = (keuzes) => Object.fromEntries(personageVoorkeurWaarden({ keuzes }).map(([id, w]) => [id, Math.round(w * 100) / 100]));
assert.deepEqual(waarden([{ characterId: "a", aandeel: 0.5 }, { characterId: "b", aandeel: 0.5 }]), { a: 0, b: 0 });
assert.deepEqual(waarden([{ characterId: "a", aandeel: 1 / 3 }, { characterId: "b", aandeel: 1 / 3 }, { characterId: "c", aandeel: 1 / 3 }]), { a: 0, b: 0, c: 0 });
assert.deepEqual(waarden([{ characterId: "a", aandeel: 1 }, { characterId: "b", aandeel: 0 }]), { a: 1, b: -1 });
assert.deepEqual(waarden([{ characterId: "a", aandeel: 0.6 }, { characterId: "b", aandeel: 0.3 }, { characterId: "c", aandeel: 0.1 }]), { a: 0.4, b: -0.1, c: -0.7 });
assert.deepEqual(waarden([{ characterId: "a", aandeel: 0.2 }, { characterId: "nee", aandeel: 0.8 }]), { a: -0.6 });
// Een personage dat niemand terug wil zien drukt zijn scènes omlaag.
const tegen = buildScoreFeed({ catalog, observations: [{ situationRunId: "r1", situationId: "situation:1", labelIds: [], characterIds: ["character:1"], observedScore: 0,
  personageVoorkeur: { stemmen: 10, keuzes: [{ characterId: "character:1", aandeel: 0.1 }, { characterId: "nee", aandeel: 0.9 }] } }] });
assert.ok(score(tegen, "situation:3") < 0, "Mark-scène daalt als niemand Mark terug wil zien");
console.log("voorkeur en trek: ok");
