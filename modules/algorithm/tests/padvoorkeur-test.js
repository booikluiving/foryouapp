"use strict";

// Padvoorkeur: vond het publiek een scène goed (of slecht), dan krijgen de scènes die in een pad
// direct daarna komen haar score × gewicht padVolgende mee.
// Draai: node modules/algorithm/tests/padvoorkeur-test.js (leest en schrijft geen showdata).
const assert = require("node:assert/strict");
const { buildScoreFeed, defaultAlgorithmConfig, normalizeAlgorithmConfig, padVoorgangersUitPaden } = require("../scoring/score-engine");

const sit = (n) => ({ id: `situation:${n}`, legacyId: n, title: `S${n}`, active: true, labelIds: [], characterIds: [] });
const paths = {
  schemaVersion: "paths.snapshot.v0",
  paths: [
    // Adolfs pad: 1 → 2 → 3
    { id: "path:1", edges: [{ fromSituationId: "situation:1", toSituationId: "situation:2" }, { fromSituationId: "situation:2", toSituationId: "situation:3" }] },
    // Ander pad: 4 → 5, en 1 → 6
    { id: "path:2", edges: [{ fromSituationId: "situation:4", toSituationId: "situation:5" }, { fromSituationId: "situation:1", toSituationId: "situation:6" }] },
    // Gearchiveerd pad telt niet.
    { id: "path:3", archivedAt: "2026-01-01", edges: [{ fromSituationId: "situation:4", toSituationId: "situation:3" }] },
  ],
};

// Voorgangers uit de paden.
const voorgangers = padVoorgangersUitPaden(paths);
assert.deepEqual(voorgangers, { "situation:2": ["situation:1"], "situation:3": ["situation:2"], "situation:5": ["situation:4"], "situation:6": ["situation:1"] });

const catalog = { situations: [1, 2, 3, 4, 5, 6].map(sit), labels: [], characters: [], padVoorgangers: voorgangers };
const scores = (observations, config = defaultAlgorithmConfig()) => {
  const feed = buildScoreFeed({ showRunId: "test", catalog, observations, config });
  return Object.fromEntries(feed.scores.map((item) => [item.situationId, item]));
};

// Scène 1 goed (+4): de opvolgers 2 en 6 krijgen +4, de rest niets.
let s = scores([{ situationId: "situation:1", observedScore: 4, labelIds: [], characterIds: [] }]);
assert.equal(s["situation:2"].components.padVoorkeur, 4);
assert.equal(s["situation:6"].components.padVoorkeur, 4);
assert.equal(s["situation:3"].components.padVoorkeur, 0);
assert.equal(s["situation:5"].components.padVoorkeur, 0);
assert.ok(s["situation:2"].reasons.includes("publiek_pad_voorkeur"));
assert.equal(s["situation:2"].predictedScore, 4);

// Scène 4 slecht (−2): opvolger 5 krijgt −2.
s = scores([{ situationId: "situation:4", observedScore: -2, labelIds: [], characterIds: [] }]);
assert.equal(s["situation:5"].components.padVoorkeur, -2);

// Gewicht 0,25: een kwart.
s = scores([{ situationId: "situation:1", observedScore: 4, labelIds: [], characterIds: [] }], normalizeAlgorithmConfig({ weights: { padVolgende: 0.25 } }));
assert.equal(s["situation:2"].components.padVoorkeur, 1);

// Gewicht standaard 1, ook als een bewaarde instelling het nog niet kent; 0 zet het uit.
assert.equal(defaultAlgorithmConfig().weights.padVolgende, 1);
assert.equal(normalizeAlgorithmConfig({ weights: { oordeel: 3 } }).weights.padVolgende, 1);
s = scores([{ situationId: "situation:1", observedScore: 4, labelIds: [], characterIds: [] }], normalizeAlgorithmConfig({ weights: { padVolgende: 0 } }));
assert.equal(s["situation:2"].components.padVoorkeur, 0);

// Zonder paden bij de catalogus (oude run): geen padvoorkeur, geen fout.
const zonder = buildScoreFeed({ showRunId: "test", catalog: { ...catalog, padVoorgangers: undefined }, observations: [{ situationId: "situation:1", observedScore: 4, labelIds: [], characterIds: [] }], config: defaultAlgorithmConfig() });
assert.equal(zonder.scores.find((item) => item.situationId === "situation:2").components.padVoorkeur, 0);

process.stdout.write("padvoorkeur-test: ok\n");
