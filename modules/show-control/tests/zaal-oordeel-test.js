"use strict";

// Zaaloordeel in show control: welke scène, lach-knop aan/uit, door naar algoritme en runtime.
// Draai: node modules/show-control/tests/zaal-oordeel-test.js (geen netwerk, geen showdata).
const assert = require("node:assert/strict");
const { createZaalOordeel } = require("../server/zaal-oordeel");

const verstuurd = [];
global.fetch = async (url, opties = {}) => {
  const body = opties.body ? JSON.parse(opties.body) : null;
  verstuurd.push({ url, body });
  if (url.includes("/events/zaal-oordeel")) return { ok: true, json: async () => ({ ok: true, wacht: false }) };
  if (url.endsWith("/scores") && !opties.method) return { ok: true, json: async () => ({ scores: [{ situationId: "situation:1", predictedScore: 1 }] }) };
  return { ok: true, json: async () => ({ ok: true }) };
};

let state = null;
const zaal = createZaalOordeel({ fetchCurrentRuntimeState: async () => ({ ok: true, state }), runtimeUrl: "http://rt", algorithmUrl: "http://al" });

(async () => {
  // Geen run: niets te beoordelen.
  state = { status: "idle" };
  assert.equal((await zaal.geef({ stap: "lach" })).error, "geen_scene");

  // Scène speelt: het oordeel gaat over die scène.
  state = { status: "running", showRunId: "run-1", activeSituation: { situationRunId: "sr-2", situationId: "situation:2", title: "Twee" }, situationRuns: [{ situationRunId: "sr-1", resolved: { situationId: "situation:1", title: "Een" } }] };
  let uit = await zaal.geef({ stap: "lach", bron: "deck" });
  assert.equal(uit.ok, true);
  assert.equal(uit.scene.situationRunId, "sr-2");
  assert.equal(uit.oordeel.waarde, 1);
  const naarAlgoritme = verstuurd.find((v) => v.url === "http://al/v0/algorithm/events/zaal-oordeel");
  assert.deepEqual(naarAlgoritme.body, { showRunId: "run-1", situationRunId: "sr-2", situationId: "situation:2", waarde: 1, bron: "deck" });
  assert.ok(verstuurd.some((v) => v.url === "http://rt/v0/runtime/runs/run-1/scores" && v.body.source === "zaal_oordeel"), "scores naar de runtime");

  // Nog een keer lach op dezelfde scène: terug naar 0.
  uit = await zaal.geef({ stap: "lach", bron: "deck" });
  assert.equal(uit.oordeel.waarde, 0);

  // Scène voorbij: het oordeel gaat over de laatste gespeelde scène.
  state = { status: "running", showRunId: "run-1", activeSituation: null, situationRuns: [{ situationRunId: "sr-1", resolved: { situationId: "situation:1", title: "Een" } }, { situationRunId: "sr-2", resolved: { situationId: "situation:2", title: "Twee" } }] };
  uit = await zaal.geef({ waarde: -0.5, bron: "telefoon" });
  assert.equal(uit.scene.situationRunId, "sr-2");
  assert.equal(uit.scene.speelt, false);
  assert.equal(uit.oordeel.waarde, -0.5);
  // Buiten de grenzen: geknipt op -1..1.
  uit = await zaal.geef({ waarde: 7 });
  assert.equal(uit.oordeel.waarde, 1);
  // Stand voor de knop en de pagina.
  const stand = await zaal.stand();
  assert.equal(stand.scene.titel, "Twee");
  assert.equal(stand.oordeel.waarde, 1);
  assert.equal((await zaal.geef({})).error, "waarde_ontbreekt");
  process.stdout.write("zaal-oordeel (show control): ok\n");
})().catch((err) => { console.error(err); process.exit(1); });
