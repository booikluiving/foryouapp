"use strict";

// Invulscène: de plek "willekeurig personage" krijgt een personage uit de catalogus.
// Draai: node modules/runtime/tests/invulscene-test.js (leest en schrijft geen showdata).
const assert = require("node:assert/strict");
const { materializePreparedNext } = require("../materialization/materialize");

const performers = [
  { id: "performer:2", name: "Booi", performerSlot: 1, active: true },
  { id: "performer:1", name: "Megan", performerSlot: 2, active: true },
  { id: "performer:3", name: "Brent", performerSlot: 3, active: true },
];
const characters = [
  { id: "character:29", legacyId: 29, name: "Lisa", performerIds: ["performer:1"], active: true },
  { id: "character:18", legacyId: 18, name: "Mark", performerIds: ["performer:3"], active: true },
  { id: "character:40", legacyId: 40, name: "Tijmen", performerIds: [], active: true },
  { id: "character:41", legacyId: 41, name: "Weg", performerIds: [], active: false },
  { id: "character:42", legacyId: 42, name: "Oud", performerIds: [], active: true, archivedAt: "2026-01-01" },
];
const zelfscan = {
  id: "situation:15",
  legacyId: 15,
  title: "Zelfscan fraude",
  promptText: "{personage1} steelt. Lisa ziet {personage1}.",
  characterIds: ["character:29"],
  characterSlots: [
    { slotIndex: 1, mode: "random-character" },
    { slotIndex: 2, mode: "fixed-character", characterId: "character:29" },
    { slotIndex: 3, mode: "empty" },
  ],
};
const tweeVrij = {
  id: "situation:7",
  legacyId: 7,
  title: "Twee vrij",
  promptText: "Lisa, {personage1} en {personage2}.",
  characterIds: ["character:29"],
  characterSlots: [
    { slotIndex: 1, mode: "fixed-character", characterId: "character:29" },
    { slotIndex: 2, mode: "random-character" },
    { slotIndex: 3, mode: "random-character" },
  ],
};
const catalog = { situations: [zelfscan, tweeVrij], characters, performers, environments: [] };

for (let i = 0; i < 40; i += 1) {
  const resolved = materializePreparedNext({ catalog, preparedNext: { situationId: "situation:15" }, seed: `s${i}` });
  assert.equal(resolved.characters.length, 2);
  const extra = resolved.characters[1];
  assert.ok(["character:18", "character:40"].includes(extra.id), "alleen actieve, niet de vaste");
  assert.deepEqual(extra.performerIds, []);
  assert.equal(resolved.promptText, `${extra.name} steelt. Lisa ziet ${extra.name}.`);
  const slots = resolved.performerSlots.map((slot) => [slot.slotIndex, slot.characterName]);
  assert.ok(slots.some(([index, name]) => index === 2 && name === "Lisa"));
  const extraSlot = slots.find(([, name]) => name === extra.name);
  assert.ok(extraSlot && [1, 3].includes(extraSlot[0]), "ingevuld personage op een vrije plek");
  assert.equal(resolved.ingevuld[0].placeholder, "personage1");
}

// Niet het personage uit de vorige scène, zolang er een ander is.
for (let i = 0; i < 40; i += 1) {
  const resolved = materializePreparedNext({
    catalog, preparedNext: { situationId: "situation:15" }, seed: `r${i}`, recentCharacterIds: ["character:18"],
  });
  assert.equal(resolved.characters[1].id, "character:40");
}
// Alles was in de vorige scène: dan toch iemand.
const allesRecent = materializePreparedNext({
  catalog, preparedNext: { situationId: "situation:15" }, seed: "x", recentCharacterIds: ["character:18", "character:40"],
});
assert.equal(allesRecent.characters.length, 2);

// Twee vrije plekken: twee verschillende personages, elk een eigen speler.
const twee = materializePreparedNext({ catalog, preparedNext: { situationId: "situation:7" }, seed: "t" });
const namen = twee.characters.slice(1).map((item) => item.name).sort();
assert.deepEqual(namen, ["Mark", "Tijmen"]);
assert.ok(!/\{personage/.test(twee.promptText));
assert.equal(new Set(twee.performerSlots.map((slot) => slot.slotIndex)).size, 3);

// Situatie zonder willekeurige plek: niets verandert.
const vast = materializePreparedNext({
  catalog: { ...catalog, situations: [{ ...zelfscan, characterSlots: [] }] },
  preparedNext: { situationId: "situation:15" }, seed: "v",
});
assert.equal(vast.characters.length, 1);
assert.equal(vast.ingevuld, undefined);

console.log("invulscene-test ok");
