"use strict";

// De eerste scènes van een run komen uit verschillende paden (diversePaden, standaard 6).
// Draai: node modules/runtime/tests/diverse-paden-test.js (leest en schrijft geen showdata).
const assert = require("node:assert/strict");
const { buildEligiblePool, normalizeOrderSettings } = require("../run-control/runtime-engine");

const sit = (n, pers) => ({ id: `situation:${n}`, legacyId: n, title: `S${n}`, active: true, characterIds: [`character:${pers}`], characterSlots: [] });
// Pad A: 1 → 2; pad B: 3 → 4; pad C: 5; scène 6 zit in A én C.
const catalog = { situations: [sit(1, 1), sit(2, 2), sit(3, 3), sit(4, 4), sit(5, 5), sit(6, 6)], characters: [], performers: [], environments: [] };
const status = (id, paden, s = "available") => ({ situationId: `situation:${id}`, legacySituationId: id, status: s, pathStatuses: paden.map((pathId) => ({ pathId, status: s })) });
const evaluatie = (gespeeld) => ({
  items: [
    status(1, ["path:A"], gespeeld.includes(1) ? "played" : "available"),
    status(2, ["path:A"]),
    status(3, ["path:B"], gespeeld.includes(3) ? "played" : "available"),
    status(4, ["path:B"]),
    status(5, ["path:C"]),
    status(6, ["path:A", "path:C"]),
  ],
});
const pool = (gespeeld, actief, orderSettings = {}) => buildEligiblePool({
  catalog,
  pathEvaluation: evaluatie(gespeeld),
  playedSituations: gespeeld.map((n) => ({ situationId: `situation:${n}` })),
  activeSituation: actief ? { situationId: `situation:${actief}` } : null,
  lastPlayedSituation: null,
  scoreFeed: null,
  orderSettings: { startSceneCount: 0, ...orderSettings },
  rankingTieBreaks: null,
}).map((item) => item.legacySituationId).sort((a, b) => a - b);

// Scène 1 (pad A) speelt: de volgende komt niet uit pad A (2 en 6 vallen af).
assert.deepEqual(pool([], 1), [3, 4, 5]);
// 1 gespeeld, 3 (pad B) speelt: alleen pad C blijft over.
assert.deepEqual(pool([1], 3), [5]);
// Is er niets zonder gedeeld pad, dan de minste overlap: na A, B en C overal één gedeeld pad.
assert.deepEqual(pool([1, 3], 5), [2, 4]);
// Uit (0) of na het aantal: gewoon alles wat vrij is.
assert.deepEqual(pool([], 1, { diversePaden: 0 }), [2, 3, 4, 5, 6]);
assert.deepEqual(pool([], 1, { diversePaden: 1 }), [2, 3, 4, 5, 6]);
// Standaard 6, instelbaar, bewaard naast de rest.
assert.equal(normalizeOrderSettings({}).diversePaden, 6);
assert.equal(normalizeOrderSettings({ diversePaden: 5 }).diversePaden, 5);
assert.equal(normalizeOrderSettings({ vrijeSpeler: false }, { diversePaden: 5 }).diversePaden, 5);
process.stdout.write("diverse-paden-test: ok\n");
