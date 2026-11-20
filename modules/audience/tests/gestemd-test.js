"use strict";

// Na de scène: de eerste stem van een echte telefoon geeft "NAAM heeft gestemd!" in de chat op het
// zaalscherm (type "gestemd"); bots, Anoniem en een tweede antwoord niet.
// Draai: node modules/audience/tests/gestemd-test.js (geen netwerk, geen showdata).
const assert = require("node:assert/strict");
const { createBeoordeling } = require("../server/beoordeling");

global.fetch = async () => ({ ok: true, json: async () => ({}) });
const instellingen = new Map();
const uit = [];
const service = {
  store: { getSetting: (k, d) => (instellingen.has(k) ? instellingen.get(k) : d), setSetting: (k, v) => instellingen.set(k, v) },
  emit: (soort, msg) => { if (soort === "broadcast") uit.push(msg); },
  onlineMensen: () => 100,
  getActiveSession: () => ({ id: 1 }),
  naamKleur: () => "#123456",
};
const beoordeling = createBeoordeling(service);
beoordeling.reset();
beoordeling.onthoudScene({
  showRunId: "run-1",
  situationRuns: [{ situationRunId: "sr-1", resolved: { situationId: "situation:1", title: "Test", performerSlots: [{ characterId: "character:1", characterName: "Adolf", performerId: "p1" }], labelIds: [] } }],
  showRunSnapshot: { catalog: { labels: [], performers: [] } },
});
const open = beoordeling.start();
assert.ok(open);
const gestemd = () => uit.filter((m) => m.type === "gestemd");
beoordeling.antwoord("t1", { id: open.id, vraag: "scene", keuze: "heelleuk", naam: "Bok" });
beoordeling.antwoord("t1", { id: open.id, vraag: "personage", keuze: "character:1", naam: "Bok" });
beoordeling.antwoord("b1", { id: open.id, vraag: "scene", keuze: "heelleuk", naam: "Bot" }, { bot: true });
beoordeling.antwoord("t2", { id: open.id, vraag: "scene", keuze: "heelleuk", naam: "Anoniem" });
assert.deepEqual(gestemd().map((m) => [m.naam, m.kleur]), [["Bok", "#123456"]]);
beoordeling.reset();
console.log("gestemd-test: alles in orde");
process.exit(0);
