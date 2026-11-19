"use strict";

// Vrije personages (zonder vaste speler) worden eerlijk verdeeld over de spelers die in
// de scène nog niets hebben. Draait zonder diensten en zonder data: node shared/casting/performer-slots-test.js

const assert = require("assert");
const { assignPerformerSlots } = require("./performer-slots");

const performers = [
  { id: "performer:3", name: "Speler 1", performerSlot: 1, active: true },
  { id: "performer:1", name: "Speler 2", performerSlot: 2, active: true },
  { id: "performer:2", name: "Speler 3", performerSlot: 3, active: true },
];
const vast1 = { id: "character:vast1", name: "Vast 1", performerIds: ["performer:3"] };
const vast2 = { id: "character:vast2", name: "Vast 2", performerIds: ["performer:1"] };
const vast3 = { id: "character:vast3", name: "Vast 3", performerIds: ["performer:2"] };
const vrijA = { id: "character:vrijA", name: "Vrij A", performerIds: [] };
const vrijB = { id: "character:vrijB", name: "Vrij B", performerIds: [] };

function slotsOf(result) {
  return result.performerSlots.map((slot) => [slot.slotIndex, slot.characterId]);
}
function freeSlots(result) {
  return result.performerSlots.filter((slot) => !slot.performerId).map((slot) => slot.slotIndex);
}
function assertDistinct(result, message) {
  const indexes = result.performerSlots.map((slot) => slot.slotIndex);
  assert.equal(new Set(indexes).size, indexes.length, message);
}

// 1. Vaste koppelingen blijven vast, met of zonder loting.
for (const seed of [null, "a", "b", "c"]) {
  assert.deepEqual(
    slotsOf(assignPerformerSlots({ characters: [vast3, vast1, vast2], performers, seed })),
    [[1, "character:vast1"], [2, "character:vast2"], [3, "character:vast3"]],
  );
}

// 2. Zonder seed: de laagste vrije plek, nooit een plek die al bezet is.
assert.deepEqual(
  slotsOf(assignPerformerSlots({ characters: [vast2, vrijA], performers })),
  [[1, "character:vrijA"], [2, "character:vast2"]],
  "een vrij personage mag niet op de plek van een vaste speler komen",
);

// 3. Dezelfde seed geeft dezelfde verdeling.
assert.deepEqual(
  assignPerformerSlots({ characters: [vast1, vrijA], performers, seed: "zelfde" }),
  assignPerformerSlots({ characters: [vast1, vrijA], performers, seed: "zelfde" }),
);

// 4. Losse scènes zonder voorgeschiedenis: het lot verdeelt gelijk over de open plekken.
function tel(characters, rondes = 3000) {
  const count = { 1: 0, 2: 0, 3: 0 };
  for (let index = 0; index < rondes; index += 1) {
    const result = assignPerformerSlots({ characters, performers, seed: `los-${index}` });
    assertDistinct(result, "elke speler hoogstens één personage");
    for (const slotIndex of freeSlots(result)) count[slotIndex] += 1;
  }
  return count;
}
const eenVastEenVrij = tel([vast1, vrijA]);
assert.equal(eenVastEenVrij[1], 0, "speler 1 heeft al een vast personage");
assert(Math.abs(eenVastEenVrij[2] - eenVastEenVrij[3]) < 300, `speler 2 en 3 ongeveer even vaak: ${JSON.stringify(eenVastEenVrij)}`);
const eenVrij = tel([vrijA]);
for (const slotIndex of [1, 2, 3]) {
  assert(eenVrij[slotIndex] > 850 && eenVrij[slotIndex] < 1150, `één vrij personage, drie spelers: ${JSON.stringify(eenVrij)}`);
}
const tweeVrij = tel([vrijA, vrijB]);
for (const slotIndex of [1, 2, 3]) {
  assert(tweeVrij[slotIndex] > 1800 && tweeVrij[slotIndex] < 2200, `twee vrije personages, drie spelers: ${JSON.stringify(tweeVrij)}`);
}

// 5. Wie de vorige scène buiten beeld bleef, gaat voor.
assert.deepEqual(
  freeSlots(assignPerformerSlots({ characters: [vast1, vrijA], performers, seed: "x", recentSlotIndexes: [[1, 2, 3], [1, 2]] })),
  [3],
  "speler 3 stond de vorige scène niet in beeld en krijgt het vrije personage",
);
assert.deepEqual(
  freeSlots(assignPerformerSlots({ characters: [vast1, vrijA], performers, seed: "x", recentSlotIndexes: [[1, 2], [1, 3]] })),
  [2],
);

// 6. Een reeks scènes met telkens één vast en één vrij personage, of twee vrije:
// niemand blijft twee scènes achter elkaar buiten beeld en de vrije rollen zijn gelijk verdeeld.
const reeks = [];
const vrijPerSpeler = { 1: 0, 2: 0, 3: 0 };
const scenes = [[vast1, vrijA], [vrijA, vrijB], [vast2, vrijA], [vrijA, vrijB], [vast1, vrijA], [vrijA, vrijB]];
for (let index = 0; index < 600; index += 1) {
  const result = assignPerformerSlots({
    characters: scenes[index % scenes.length],
    performers,
    seed: `reeks-${index}`,
    recentSlotIndexes: reeks,
  });
  assertDistinct(result, "elke speler hoogstens één personage");
  for (const slotIndex of freeSlots(result)) vrijPerSpeler[slotIndex] += 1;
  const inBeeld = result.performerSlots.map((slot) => slot.slotIndex);
  if (reeks.length) {
    const vorige = reeks[reeks.length - 1];
    for (const slotIndex of [1, 2, 3]) {
      assert(vorige.includes(slotIndex) || inBeeld.includes(slotIndex), `speler ${slotIndex} twee scènes achter elkaar buiten beeld (scène ${index})`);
    }
  }
  reeks.push(inBeeld);
}
assert(vrijPerSpeler[3] >= vrijPerSpeler[1] && vrijPerSpeler[3] >= vrijPerSpeler[2], `speler 3 krijgt zijn deel: ${JSON.stringify(vrijPerSpeler)}`);


// Vaste plek: het vrije personage blijft in zijn vak, wat het lot ook zegt.
for (let index = 0; index < 200; index += 1) {
  const result = assignPerformerSlots({ characters: [vast1, { ...vrijA, vastePlek: 2 }], performers, seed: `vast-${index}` });
  assert.deepEqual(slotsOf(result), [[1, "character:vast1"], [2, "character:vrijA"]], "vaste plek 2");
}
// Twee vrije personages, één met vaste plek: de ander loot over wat overblijft.
for (let index = 0; index < 200; index += 1) {
  const result = assignPerformerSlots({ characters: [{ ...vrijA, vastePlek: 1 }, vrijB], performers, seed: `half-${index}` });
  assertDistinct(result, "vaste plek en loting botsen niet");
  assert.equal(result.performerSlots.find((slot) => slot.characterId === "character:vrijA").slotIndex, 1);
}
// Vaste plek bezet door een vaste speler: dan gewoon de loting.
{
  const result = assignPerformerSlots({ characters: [vast2, { ...vrijA, vastePlek: 2 }], performers, seed: "bezet" });
  assertDistinct(result, "bezette vaste plek");
  assert.notEqual(result.performerSlots.find((slot) => slot.characterId === "character:vrijA").slotIndex, 2);
}

console.log(JSON.stringify({
  ok: true,
  eenVastEenVrij,
  eenVrij,
  tweeVrij,
  reeksVrijPerSpeler: vrijPerSpeler,
}));
