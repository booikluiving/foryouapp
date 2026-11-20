"use strict";

// Padwaarde: elk pad is apart 1 waard, gedeeld door zijn vrije scènes; de keuze is een loting met
// padwaarde × e^score. Draai: node modules/runtime/tests/padwaarde-test.js (leest en schrijft geen showdata).
const assert = require("node:assert/strict");
const { padWaardenVoor, trekMetPadwaarde, normalizeOrderSettings, buildEligiblePool, choosePreparedNext } = require("../run-control/runtime-engine");

const vrijIn = (...paden) => ({ pathStatuses: paden.map((pathId) => ({ pathId, status: "available" })) });

// Bobbie's pad heeft één vrije scène, Adolfs pad vijf: 1 tegen 0,2 per scène.
let waarden = padWaardenVoor([
  { pathStatus: vrijIn("path:bobbie") },
  ...[1, 2, 3, 4, 5].map(() => ({ pathStatus: vrijIn("path:adolf") })),
]);
assert.deepEqual(waarden.map((w) => Math.round(w * 100) / 100), [1, 0.2, 0.2, 0.2, 0.2, 0.2]);

// Een scène in twee paden krijgt beide delen; paden die op slot zitten tellen niet mee.
waarden = padWaardenVoor([
  { pathStatus: { pathStatuses: [{ pathId: "path:a", status: "available" }, { pathId: "path:b", status: "available" }, { pathId: "path:c", status: "locked" }] } },
  { pathStatus: vrijIn("path:a") },
]);
assert.deepEqual(waarden, [1.5, 0.5]);

// Zonder pad (voorrang) telt een scène als een eigen pad.
assert.deepEqual(padWaardenVoor([{ pathStatus: { pathStatuses: [] } }]), [1]);

// Loten: gelijke score → de kans volgt de padwaarde (1 tegen 5 × 0,2: de helft voor Bobbie).
const pool = [
  { situationId: "situation:1", padWaarde: 1, scoreValue: 0 },
  ...[2, 3, 4, 5, 6].map((n) => ({ situationId: `situation:${n}`, padWaarde: 0.2, scoreValue: 0 })),
];
let teller = 0;
const keer = 20000;
let zaad = 7;
const random = () => { zaad = (zaad * 16807) % 2147483647; return zaad / 2147483647; };
for (let i = 0; i < keer; i += 1) if (trekMetPadwaarde(pool, { random }).pool[0].situationId === "situation:1") teller += 1;
assert.ok(Math.abs(teller / keer - 0.5) < 0.02, `Bobbie ${teller / keer}`);

// De score telt mee: score 1 tegen 0 → e keer zoveel lootjes (1 × e tegen 1 × 1 ≈ 73 %).
teller = 0;
const metScore = [
  { situationId: "situation:1", padWaarde: 1, scoreValue: 1 },
  { situationId: "situation:2", padWaarde: 1, scoreValue: 0 },
];
for (let i = 0; i < keer; i += 1) if (trekMetPadwaarde(metScore, { random }).pool[0].situationId === "situation:1") teller += 1;
assert.ok(Math.abs(teller / keer - Math.E / (Math.E + 1)) < 0.02, `score ${teller / keer}`);

// De getrokken scène gaat vooraan, de rest blijft in de volgorde van het algoritme.
const trek = trekMetPadwaarde(pool, { random: () => 0.99 });
assert.equal(trek.pool[0].situationId, "situation:6");
assert.deepEqual(trek.pool.slice(1).map((item) => item.situationId), ["situation:1", "situation:2", "situation:3", "situation:4", "situation:5"]);
assert.equal(trek.trekking.plaatsBijAlgoritme, 6);

// Schakelaar: standaard uit, aan te zetten, blijft staan bij een andere wijziging.
assert.equal(normalizeOrderSettings({}).padWaarde, false);
const aan = normalizeOrderSettings({ padWaarde: true });
assert.equal(aan.padWaarde, true);
assert.equal(normalizeOrderSettings({ vrijeSpeler: false }, aan).padWaarde, true);

// In de echte lijst: buildEligiblePool geeft elke vrije scène haar padwaarde mee, en met de schakelaar
// aan wordt de klaargezette scène getrokken (reden "padwaarde").
const situaties = [1, 2, 3].map((n) => ({ id: `situation:${n}`, legacyId: n, title: `S${n}`, active: true, characterIds: [`character:${n}`], characterSlots: [] }));
const catalog = { situations: situaties, characters: [], performers: [], environments: [] };
const pathEvaluation = {
  items: [
    { situationId: "situation:1", legacySituationId: 1, status: "available", pathStatuses: [{ pathId: "path:1", status: "available" }] },
    { situationId: "situation:2", legacySituationId: 2, status: "available", pathStatuses: [{ pathId: "path:2", status: "available" }] },
    { situationId: "situation:3", legacySituationId: 3, status: "available", pathStatuses: [{ pathId: "path:2", status: "available" }] },
  ],
};
const lijst = buildEligiblePool({ catalog, pathEvaluation, playedSituations: [], activeSituation: null, lastPlayedSituation: null, scoreFeed: null, orderSettings: { padWaarde: true }, rankingTieBreaks: null });
assert.deepEqual(Object.fromEntries(lijst.map((item) => [item.situationId, item.padWaarde])), { "situation:1": 1, "situation:2": 0.5, "situation:3": 0.5 });
const gekozen = choosePreparedNext({ catalog, eligiblePool: lijst, padWaarde: true });
assert.equal(gekozen.reason, "padwaarde");
assert.ok(gekozen.padWaarde && gekozen.padWaarde.kans > 0);
const zonder = choosePreparedNext({ catalog, eligiblePool: lijst, padWaarde: false });
assert.equal(zonder.situationId, lijst[0].situationId);
assert.equal(zonder.padWaarde, null);

process.stdout.write("padwaarde-test: ok\n");
