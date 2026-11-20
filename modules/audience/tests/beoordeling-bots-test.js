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
    beoordeling.antwoord(mens, { id: open.id, vraag: "scene", keuze: "top" });
    beoordeling.antwoord(mens, { id: open.id, vraag: "personage", keuze: "character:1" });
  }
  for (const bot of ["b1", "b2", "b3"]) {
    beoordeling.antwoord(bot, { id: open.id, vraag: "scene", keuze: "nooit" }, { bot: true });
    beoordeling.antwoord(bot, { id: open.id, vraag: "personage", keuze: "character:2" }, { bot: true });
  }
  return beoordeling.sluit("test");
}

let uitslag = ronde(false);
assert.deepEqual(uitslag.tellingen.scene, { nooit: 0, matig: 0, goed: 0, top: 2 }, "zonder bots: alleen de mensen");
assert.deepEqual(uitslag.tellingen.personage, { "character:1": 2, "character:2": 0 });
assert.equal(uitslag.deelnemers, 2);
assert.equal(uitslag.bots, 3);

uitslag = ronde(true);
assert.deepEqual(uitslag.tellingen.scene, { nooit: 3, matig: 0, goed: 0, top: 2 }, "met bots: iedereen");
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
    { id: "scene", keuzes: ["nooit", "matig", "goed", "top"].map((id) => ({ id })) },
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

process.stdout.write("beoordeling-bots-test: ok\n");
