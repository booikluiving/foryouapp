"use strict";

// Vrije speler: een heel lichte voorkeur voor een scène met de speler die nu niet speelt.
// Draai: node modules/runtime/tests/vrije-speler-test.js (leest en schrijft geen showdata).
const assert = require("node:assert/strict");
const { kiesKandidaat, vrijePlekkenVoor } = require("../run-control/runtime-engine");

const performers = [
  { id: "performer:3", name: "Booi", performerSlot: 1, active: true },
  { id: "performer:1", name: "Megan", performerSlot: 2, active: true },
  { id: "performer:2", name: "Brent", performerSlot: 3, active: true },
];
const characters = [
  { id: "character:1", name: "Peter", performerIds: ["performer:3"], active: true },
  { id: "character:2", name: "Lisa", performerIds: ["performer:1"], active: true },
  { id: "character:3", name: "Adolf", performerIds: ["performer:2"], active: true },
];
const vast = (slotIndex, characterId) => ({ slotIndex, mode: "fixed-character", characterId });
const leeg = (slotIndex) => ({ slotIndex, mode: "empty" });
const situaties = [
  // Booi + Megan: Brent (plek 3) speelt niet mee.
  { id: "situation:1", title: "Peter en Lisa", characterIds: ["character:1", "character:2"], characterSlots: [vast(1, "character:1"), vast(2, "character:2"), leeg(3)] },
  // Booi + Brent: Brent speelt mee.
  { id: "situation:2", title: "Peter en Adolf", characterIds: ["character:1", "character:3"], characterSlots: [vast(1, "character:1"), leeg(2), vast(3, "character:3")] },
  { id: "situation:3", title: "Lisa alleen", characterIds: ["character:2"], characterSlots: [leeg(1), vast(2, "character:2"), leeg(3)] },
];
const catalog = { situations: situaties, characters, performers, environments: [] };
const item = (id, scoreValue) => ({ situationId: id, title: id, scoreValue });
const kies = (pool, vrijePlekken) => kiesKandidaat({ catalog, eligiblePool: pool, recentSlotIndexes: [], recentCharacterIds: [], vrijePlekken });

// Nummer 2 heeft de vrije speler en scoort bijna even hoog: die gaat voor.
let keuze = kies([item("situation:1", 10), item("situation:2", 9.9), item("situation:3", 9), item("situation:3", 8), item("situation:3", 6)], [3]);
assert.equal(keuze.candidate.situationId, "situation:2");
assert.equal(keuze.vrijeSpeler.algoritmeKeuze, "situation:1");
assert.deepEqual(keuze.vrijeSpeler.vrijePlekken, [3]);

// Verschil te groot (meer dan de helft van nummer 1 tot nummer 5): het algoritme wint.
keuze = kies([item("situation:1", 10), item("situation:2", 7), item("situation:3", 6.5), item("situation:3", 6), item("situation:3", 5)], [3]);
assert.equal(keuze.candidate.situationId, "situation:1");
assert.equal(keuze.vrijeSpeler, null);

// Nummer 1 heeft de vrije speler al: niets verandert.
keuze = kies([item("situation:2", 10), item("situation:1", 10)], [3]);
assert.equal(keuze.candidate.situationId, "situation:2");
assert.equal(keuze.vrijeSpeler, null);

// Verder dan nummer 3 kijkt hij niet.
keuze = kies([item("situation:1", 10), item("situation:3", 10), item("situation:3", 10), item("situation:2", 10)], [3]);
assert.equal(keuze.candidate.situationId, "situation:1");

// Niemand vrij: nummer 1.
keuze = kies([item("situation:1", 10), item("situation:2", 10)], []);
assert.equal(keuze.candidate.situationId, "situation:1");

// Vrije plekken: alleen tijdens een scène, buiten de startfase, en als de voorkeur aan staat.
const spelend = { resolved: { performerSlots: [{ slotIndex: 1, characterId: "character:1" }, { slotIndex: 2, characterId: "character:2" }, { slotIndex: 3, characterId: null }] } };
assert.deepEqual(vrijePlekkenVoor({ activeSituation: spelend, orderSettings: { vrijeSpeler: true }, startPhase: { active: false } }), [3]);
assert.deepEqual(vrijePlekkenVoor({ activeSituation: spelend, orderSettings: { vrijeSpeler: false }, startPhase: { active: false } }), []);
assert.deepEqual(vrijePlekkenVoor({ activeSituation: spelend, orderSettings: { vrijeSpeler: true }, startPhase: { active: true } }), []);
assert.deepEqual(vrijePlekkenVoor({ activeSituation: null, orderSettings: { vrijeSpeler: true } }), []);

console.log("vrije-speler-test ok");
