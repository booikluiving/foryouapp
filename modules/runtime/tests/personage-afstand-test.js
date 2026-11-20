"use strict";

// Een personage komt pas terug als er minstens twee scènes tussen zitten (Adolf, X, Y, Adolf).
const assert = require("node:assert/strict");
const { buildEligiblePool } = require("../run-control/runtime-engine.js");

const sit = (n, chars, env) => ({ id: `situation:${n}`, title: `S${n}`, characterIds: chars, environmentId: `environment:${env}`, labelIds: [], active: true });
const catalog = {
  situations: [sit(1, ["character:8"], 1), sit(2, ["character:9"], 2), sit(3, ["character:10"], 3), sit(4, ["character:8", "character:11"], 4), sit(5, ["character:12"], 5)],
  characters: [],
};
const byId = new Map(catalog.situations.map((s) => [s.id, s]));
const evaluatie = (vrij) => ({ items: vrij.map((n) => ({ situationId: `situation:${n}`, status: "available", pathStatuses: [{ pathId: "path:1", status: "available" }] })) });
const pool = ({ vrij, gespeeld, actief = null, recent = null }) => buildEligiblePool({
  catalog,
  pathEvaluation: evaluatie(vrij),
  playedSituations: gespeeld.map((n) => ({ situationId: `situation:${n}` })),
  activeSituation: actief ? { situationId: `situation:${actief}`, resolved: { characterIds: byId.get(`situation:${actief}`).characterIds } } : null,
  lastPlayedSituation: gespeeld.length ? byId.get(`situation:${gespeeld[gespeeld.length - 1]}`) : null,
  scoreFeed: null,
  orderSettings: { startSceneCount: 0 },
  rankingTieBreaks: null,
  recentCharacterIds: recent,
}).map((k) => Number(k.situationId.split(":")[1])).sort();

// Adolf (1) speelde, nu speelt 2: scène 4 met Adolf mag nog niet, 3 en 5 wel.
assert.deepEqual(pool({ vrij: [3, 4, 5], gespeeld: [1], actief: 2 }), [3, 5]);
// Twee scènes ertussen (1, 2, nu 3): 4 mag weer.
assert.deepEqual(pool({ vrij: [4, 5], gespeeld: [1, 2], actief: 3 }), [4, 5]);
// Tussen scènes (niets speelt, 1 en 2 gespeeld): 4 nog niet.
assert.deepEqual(pool({ vrij: [3, 4], gespeeld: [1, 2] }), [3]);
// Niets anders vrij: alleen de vorige scène ontwijken, dus 4 mag dan toch.
assert.deepEqual(pool({ vrij: [4], gespeeld: [1], actief: 2 }), [4]);
// Invulscène: een ingevuld personage van de vorige scènes telt ook mee.
assert.deepEqual(pool({ vrij: [3, 5], gespeeld: [1], actief: 2, recent: ["character:12"] }), [3]);
console.log("personage-afstand-test ok");
