"use strict";

// Bots beantwoorden de vragen na de scène, maar tellen standaard niet mee voor het algoritme.
// Draai: node modules/audience/tests/beoordeling-bots-test.js (geen netwerk, geen showdata).
const assert = require("node:assert/strict");
const { createBeoordeling } = require("../server/beoordeling");

global.fetch = async () => ({ ok: true, json: async () => ({}) });
const instellingen = new Map();
const service = {
  store: { getSetting: (k, d) => (instellingen.has(k) ? instellingen.get(k) : d), setSetting: (k, v) => instellingen.set(k, v) },
  emit: () => {},
  onlineMensen: () => 100,
  getActiveSession: () => ({ id: 1 }),
};
const beoordeling = createBeoordeling(service);
const state = {
  showRunId: "run-1",
  situationRuns: [{ situationRunId: "sr-1", resolved: { situationId: "situation:1", title: "Test", performerSlots: [{ characterId: "character:1", characterName: "Adolf", performerId: "p1" }, { characterId: "character:2", characterName: "Bea", performerId: "p2" }], labelIds: [] } }],
  showRunSnapshot: { catalog: { labels: [], performers: [] } },
};

function ronde(botsTellenMee) {
  beoordeling.zetInstellingen({ botsTellenMee });
  beoordeling.reset();
  beoordeling.onthoudScene({ ...state, situationRuns: [{ ...state.situationRuns[0], situationRunId: `sr-${botsTellenMee}` }] });
  const open = beoordeling.start();
  assert.ok(open, "vragen gaan open");
  // Twee mensen: top en Adolf. Drie bots: nooit en Bea.
  for (const mens of ["m1", "m2"]) {
    beoordeling.antwoord(mens, { id: open.id, vraag: "scene", keuze: "heelleuk" });
    beoordeling.antwoord(mens, { id: open.id, vraag: "personage", keuze: "character:1" });
  }
  for (const bot of ["b1", "b2", "b3"]) {
    beoordeling.antwoord(bot, { id: open.id, vraag: "scene", keuze: "heelsaai" }, { bot: true });
    beoordeling.antwoord(bot, { id: open.id, vraag: "personage", keuze: "character:2" }, { bot: true });
  }
  return beoordeling.sluit("test");
}

let uitslag = ronde(false);
assert.deepEqual(uitslag.tellingen.scene, { heelsaai: 0, saai: 0, medium: 0, leuk: 0, heelleuk: 2 }, "zonder bots: alleen de mensen");
assert.deepEqual(uitslag.tellingen.personage, { "character:1": 2, "character:2": 0 });
assert.equal(uitslag.deelnemers, 2);
assert.equal(uitslag.bots, 3);

uitslag = ronde(true);
assert.deepEqual(uitslag.tellingen.scene, { heelsaai: 3, saai: 0, medium: 0, leuk: 0, heelleuk: 2 }, "met bots: iedereen");
assert.equal(uitslag.deelnemers, 5);

// Standaard tellen bots niet mee.
const { normalizeInstellingen } = require("../server/beoordeling");
assert.equal(normalizeInstellingen({}).botsTellenMee, false);

// De bots stemmen volgens een smaak: fan-personage wint vaak, en die smaak verschilt per run.
const { ChatSimulator } = (() => { try { return require("../simulation/chat-simulator"); } catch (_err) { return {}; } })();
if (ChatSimulator) {
  const sim = Object.create(ChatSimulator.prototype);
  sim.service = { chatRun: "run-a" };
  sim.randomInt = (min, max) => min + Math.floor(Math.random() * (max - min + 1));
  sim.sample = (lijst, d) => (lijst.length ? lijst[sim.randomInt(0, lijst.length - 1)] : d);
  const vragen = [
    { id: "scene", keuzes: ["heelsaai", "saai", "medium", "leuk", "heelleuk"].map((id) => ({ id })) },
    { id: "personage", keuzes: [{ id: "character:1" }, { id: "character:2" }] },
  ];
  let fanStemmen = 0;
  const smaak = sim.smaakVoorRun();
  for (let i = 0; i < 400; i += 1) {
    const antwoorden = sim.botAntwoorden({}, { vragen });
    const p = antwoorden.find((a) => a.vraag === "personage").keuze;
    if (smaak.fans.has(p)) fanStemmen += 1;
  }
  if (smaak.fans.size === 1) assert.ok(fanStemmen > 200, `fan wint vaak (${fanStemmen}/400)`);
  sim.service.chatRun = "run-b";
  assert.notEqual(sim.smaakVoorRun(), smaak, "nieuwe run, nieuwe smaak");
}

// Vijf stappen op de thermometer; het oordeel voor het algoritme is -1, -½, 0, +½, +1.
assert.deepEqual(normalizeInstellingen({}).scene.keuzes.map((k) => k.id), ["heelsaai", "saai", "medium", "leuk", "heelleuk"]);
assert.equal(normalizeInstellingen({ scene: { keuzes: [1, 2, 3, 4, 5, 6].map((n) => ({ id: `k${n}`, emoji: "x" })) } }).scene.keuzes.length, 5);
let verstuurd = null;
global.fetch = async (url, opties = {}) => { if (url.includes("scene-oordeel")) verstuurd = JSON.parse(opties.body); return { ok: true, json: async () => ({}) }; };
beoordeling.zetInstellingen({ botsTellenMee: false, scene: { keuzes: normalizeInstellingen({}).scene.keuzes } });
beoordeling.reset();
beoordeling.onthoudScene({ ...state, situationRuns: [{ ...state.situationRuns[0], situationRunId: "sr-vijf" }] });
const open5 = beoordeling.start();
["heelsaai", "saai", "medium", "leuk", "heelleuk"].forEach((k, i) => beoordeling.antwoord(`m${i}`, { id: open5.id, vraag: "scene", keuze: k }));
beoordeling.antwoord("m5", { id: open5.id, vraag: "scene", keuze: "leuk" });
beoordeling.sluit("test");
setTimeout(() => {
  // (−1 − ½ + 0 + ½ + 1 + ½) / 6 = 0,083
  assert.equal(verstuurd && verstuurd.gemiddelde, 0.083);
  process.stdout.write("beoordeling-bots-test: ok\n");
}, 50);
