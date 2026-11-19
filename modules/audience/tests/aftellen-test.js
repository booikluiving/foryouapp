"use strict";

// Ready per speler met en zonder aftellen. Runtime, script-agent en show control zijn nagebootst:
// er gaat niets naar de echte diensten.

const assert = require("node:assert/strict");
const { createSpelersReady } = require("../server/spelers-ready");

const cues = [];
let scene = 5;
globalThis.fetch = async (url, opts = {}) => {
  const pad = String(url).replace(/^https?:\/\/[^/]+/, "");
  const ok = (body) => ({ ok: true, status: 200, json: async () => body });
  if (pad.includes("/teleprompter-parser/current")) {
    return ok({ preparedScene: { status: "prepared", sceneId: `situation:${scene}` }, teleprompt: { lines: [{ text: "Ada: hoi" }], source: { sceneId: `situation:${scene}` } } });
  }
  if (pad.startsWith("/v0/show-control/")) { cues.push(pad); return ok({ ok: true }); }
  throw new Error(`onverwacht: ${url}`);
};

const fetchRuntimeView = async () => ({
  ok: true,
  state: { showRunId: "run-1", status: "running", activeSituation: null, preparedNext: { situationId: `situation:${scene}` }, resolvedPreparedNext: { situationId: `situation:${scene}`, performerSlots: [] } },
});
const instellingen = new Map();
const store = { getSetting: (k, f) => (instellingen.has(k) ? instellingen.get(k) : f), setSetting: (k, v) => instellingen.set(k, v) };
const meldingen = [];
const service = { store, emit: (_soort, msg) => meldingen.push(msg) };
const wacht = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

(async () => {
  const ready = createSpelersReady({ service, fetchRuntimeView });
  assert.equal(ready.aftellen(), true, "standaard telt het zaalscherm af");

  for (const plek of [1, 2, 3]) await ready.zet(plek, true);
  assert.ok(ready.publiek().aftellenTot > Date.now(), "iedereen ready: aftellen loopt");
  assert.equal(cues.length, 0, "de scène start pas na het aftellen");
  await wacht(3300);
  assert.ok(cues.includes("/v0/show-control/cues/start-situation"), "na het aftellen start de scène");
  console.log("ok: met aftellen");

  cues.length = 0;
  ready.zetAftellen(false);
  assert.equal(instellingen.get("aftellen_aan"), false, "bewaard");
  scene = 6;
  for (const plek of [1, 2, 3]) await ready.zet(plek, true);
  await wacht(50);
  assert.ok(cues.includes("/v0/show-control/cues/start-situation"), "zonder aftellen start de scène meteen");
  assert.ok(!meldingen.some((m) => m.type === "spelers_ready" && m.aftellen === false && m.aftellenTot), "zonder aftellen geen aftellen op het scherm");
  console.log("ok: zonder aftellen");

  const opnieuw = createSpelersReady({ service, fetchRuntimeView });
  assert.equal(opnieuw.aftellen(), false, "na een herstart blijft het uit");
  console.log("aftellen-test: alles ok");
  process.exit(0);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
