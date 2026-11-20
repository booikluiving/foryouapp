"use strict";

// Twee spelers op één camera: de autocam kiest de camera uit shared/casting/camera-per-personage.json.

const assert = require("node:assert/strict");
const { resolveAutoCameraSwitch, buildAutoCameraReactionShotPlan } = require("../teleprompter-parser/src/integration/express-router");

function kies(scene, spreker) {
  const teleprompt = { source: { sceneId: scene.sceneId }, lines: [{ type: "dialogue", speakerLabel: spreker }] };
  const besluit = resolveAutoCameraSwitch({
    show: { active: true }, teleprompt, cue: { index: 1, version: 1 },
    preparedScene: scene, autoCameraSwitch: { enabled: true, lastCameraSlot: 0 },
  });
  return besluit.slot;
}

const slaapkamer = (sceneId) => ({
  sceneId, status: "playing", environment: { id: 3, name: "Grimmige_slaapkamer" },
  characters: [
    { id: 2, characterId: "character:2", name: "Peter", slot: 1 },
    { id: 3, characterId: "character:3", name: "Penelope", slot: 2 },
    { id: 19, characterId: "character:19", name: "Monster onder het bed", slot: 3 },
  ],
});
assert.equal(kies(slaapkamer(4), "Monster onder het bed"), 2, "monster onder het bed staat op camera 2");
assert.equal(kies(slaapkamer(4), "Penelope"), 2);
assert.equal(kies(slaapkamer(4), "Peter"), 1);
assert.equal(kies(slaapkamer(44), "Monster onder het bed"), 3, "in 44 komt het monster uit de kast: eigen camera");

const zonnebloemen = {
  sceneId: 9, status: "playing", environment: { id: 22, name: "Zonnebloemveld" },
  characters: [
    { id: 4, name: "BobbieDeCrackhond", slot: 1 },
    { id: 6, characterId: "character:6", name: "Zonnebloem 1", slot: 2 },
    { id: 7, characterId: "character:7", name: "Zonnebloem 2", slot: 3 },
  ],
};
assert.equal(kies(zonnebloemen, "Zonnebloem 2"), 2, "zonnebloem 2 staat op camera 2");
assert.equal(kies(zonnebloemen, "Zonnebloem 1"), 2);
assert.equal(kies(zonnebloemen, "BobbieDeCrackhond"), 1);

// Monster in een andere omgeving: gewoon zijn eigen camera.
const ander = { ...slaapkamer(34), environment: { id: 9 } };
assert.equal(kies(ander, "Monster onder het bed"), 3);

// Reactieshot op Zonnebloem 2: nooit camera 2 (daar staat hij al), dus camera 1.
const teleprompt = { source: { sceneId: 9 }, lines: [{ type: "dialogue", speakerLabel: "Zonnebloem 2" }] };
for (const r of [0, 0.5, 0.99]) {
  const plan = buildAutoCameraReactionShotPlan({
    show: { active: true }, teleprompt, cue: { index: 1, version: 1 }, preparedScene: zonnebloemen,
    autoCameraSwitch: { enabled: true, reactionShotsEnabled: true }, random: () => r,
  });
  assert.equal(plan.slot, 1);
  assert.equal(plan.returnSlot, 2);
}

console.log("camera-per-personage-test: ok");
