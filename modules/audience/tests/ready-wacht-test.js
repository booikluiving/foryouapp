"use strict";

// Spelers kunnen tot 25 seconden na het einde van een scène nog niet op READY (het publiek stemt dan).
// Draai: node modules/audience/tests/ready-wacht-test.js (geen netwerk, geen showdata).
const assert = require("node:assert/strict");

process.env.AUDIENCE_READY_ZONDER_TEKST = "1";
global.fetch = async () => ({ ok: true, json: async () => ({}) });
const { createSpelersReady } = require("../server/spelers-ready");

let eind = null;
const service = {
  emit: () => {},
  store: { getSetting: (_k, d) => d, setSetting: () => {} },
  getRonde: () => ({ start: null, eind, titel: "", situationRunId: null, emoji: {} }),
};
const view = {
  showRunId: "run-1",
  status: "running",
  activeSituation: null,
  preparedNext: { situationId: "situation:2", reason: "after_start_situation" },
  resolvedPreparedNext: { situationId: "situation:2", performerSlots: [{ characterId: "character:1", performerId: "p1", slotIndex: 1 }] },
  showRunSnapshot: { catalog: { performers: [{ id: "p1", performerSlot: 1 }] } },
};
const ready = createSpelersReady({ service, fetchRuntimeView: async () => ({ ok: true, state: view }) });

(async () => {
  // Scène net voorbij (5 s): READY wordt niet aangenomen, de knop staat op wachten.
  eind = new Date(Date.now() - 5000).toISOString();
  let uit = await ready.zet(1, true);
  assert.equal(uit.ok, false);
  assert.equal(uit.fout, "te_vroeg");
  assert.equal(uit.klaar, false);
  assert.ok(uit.wachtTot > Date.now());
  // Na de wachttijd (30 s): wel.
  eind = new Date(Date.now() - 30000).toISOString();
  uit = await ready.zet(1, true);
  assert.equal(uit.ok, true);
  assert.equal(uit.wachtTot, 0);
  assert.deepEqual(uit.plekken, [1]);
  // Ready intrekken mag altijd.
  eind = new Date().toISOString();
  uit = await ready.zet(1, false);
  assert.equal(uit.ok, true);
  // Nog nooit een scène gespeeld (begin van de run): meteen.
  eind = null;
  uit = await ready.zet(1, true);
  assert.equal(uit.ok, true);
  process.stdout.write("ready-wacht-test: ok\n");
  process.exit(0);
})().catch((err) => { console.error(err); process.exit(1); });
