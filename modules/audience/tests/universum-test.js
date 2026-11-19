"use strict";

// Universum op de telefoon: stand uit de runtime-view en wat het publiek ervan te zien krijgt.
// Draait zonder diensten: npm run audience:universum-test

const assert = require("node:assert/strict");
const { createUniversum, standUitView } = require("../server/universum");

const KAART = {
  ok: true,
  versie: "k1",
  indeling: "zaalscherm",
  scenes: [
    { id: 1, x: 0, y: 0, t: "Eerste", w: ["Peter", null], o: "Keuken" },
    { id: 2, x: 10, y: 0, t: "Tweede", w: ["Lisa"], o: "Supermarkt" },
    { id: 3, x: 20, y: 0, t: "Geheim op slot", w: ["Adolf"], o: "Tennis" },
    { id: 4, x: 30, y: 0, t: "Klaargezet", w: [null, "Mark"], o: "Trein" },
  ],
  lijnen: [[1, 2], [2, 3], [1, 4]],
  paden: [{ id: 9, n: "Adolf's Pad", c: "#14b8a6", s: [1, 2, 3], e: [[1, 2], [2, 3]] }],
};

function view(over = {}) {
  return {
    showRunId: "run-a",
    status: "running",
    startPhase: { active: false },
    playedSituations: [{ situationRunId: "r1", situationId: "situation:1" }],
    situationRuns: [{ situationRunId: "r1", situationId: "situation:1", resolved: { characters: [{ name: "Peter" }, { name: "Yaël" }], environment: { name: "Grimmige_slaapkamer" } } }],
    activeSituation: null,
    preparedNext: { situationId: "situation:4", reason: "after_start_situation" },
    resolvedPreparedNext: { situationId: "situation:4", characters: [{ name: "Emma" }, { name: "Mark" }], environment: { name: "Trein" } },
    pathEvaluation: { items: [
      { situationId: "situation:1", status: "played" },
      { situationId: "situation:2", status: "available" },
      { situationId: "situation:3", status: "locked" },
      { situationId: "situation:4", status: "available" },
    ] },
    ...over,
  };
}

async function main() {
  // Stand uit de view
  const stand = standUitView(view());
  assert.deepEqual(stand.gespeeld, [1]);
  assert.equal(stand.klaar, 0, "klaargezet blijft verborgen (het zaalscherm onthult hem pas na het stemmen)");
  assert.deepEqual(stand.vrij, [2, 4]);
  assert.deepEqual(stand.echt[1], { w: ["Peter", "Yaël"], o: "Grimmige slaapkamer" }, "wie er echt speelde, ook op een vrije plek");
  assert.deepEqual(standUitView({ showRunId: "x", status: "idle" }).gespeeld, [], "geen run = niets gespeeld");
  assert.deepEqual(standUitView({ status: "idle", showRunId: null, pathEvaluation: { items: [{ situationId: "situation:4", status: "available" }, { situationId: "situation:2", status: "available" }, { situationId: "situation:9", status: "locked" }] } }).vrij, [2, 4], "geen run: startscènes wel vrij");
  assert.equal(standUitView(view({ startPhase: { active: true }, playedSituations: [], situationRuns: [] })).klaar, 0, "startfase: niets klaargezet tonen");

  // Publiek: alleen open scènes, op slot nooit
  const u = createUniversum({ fetchKaart: async () => KAART });
  await u.laadKaart(true);
  assert.equal(u.volg(view()), true, "eerste stand is nieuw");
  assert.equal(u.volg(view()), false, "zelfde stand = geen bericht");
  const p = u.publiek();
  assert.equal(p.type, "universum");
  assert.ok(!p.kaartjes[3], "op slot: geen kaartje");
  assert.ok(!JSON.stringify(p).includes("Geheim"), "titel van een slotscène verlaat de Mac niet");
  assert.deepEqual(p.kaartjes[1].w, ["Peter", "Yaël"]);
  assert.deepEqual(p.kaartjes[2], { t: "Tweede", w: ["Lisa"], o: null }, "vrij: titel en personages, geen omgeving");
  assert.equal(p.kaartjes[1].o, "Grimmige slaapkamer", "gespeeld: omgeving wel");
  assert.ok(!JSON.stringify(p).includes("Trein") && !JSON.stringify(p).includes("Emma"), "klaargezet: niets van de ingevulde scène verlaat de Mac");

  // Kaart voor de telefoon: geen woorden
  const skelet = u.skelet();
  const tekst = JSON.stringify(skelet);
  for (const woord of ["Eerste", "Geheim", "Peter", "Keuken", "Adolf"]) assert.ok(!tekst.includes(woord), `kaart bevat geen ${woord}`);
  assert.deepEqual(skelet.s[2], [3, 20, 0]);

  // Scène start → nieuwe versie, nu gezet
  const v1 = p.v;
  assert.equal(u.volg(view({ activeSituation: { situationId: "situation:4", resolved: { characters: [{ name: "Emma" }, { name: "Mark" }] } }, preparedNext: null })), true);
  const p2 = u.publiek();
  assert.ok(p2.v > v1);
  assert.equal(p2.nu, 4);
  assert.ok(!p2.vrij.includes(4), "wat speelt is niet meer vrij");

  // Padendienst weg: vorige kaart blijft
  const weg = createUniversum({ fetchKaart: async () => { throw new Error("weg"); } });
  await weg.laadKaart(true);
  assert.equal(weg.skelet(), null);
  const eerst = createUniversum({ fetchKaart: (() => { let n = 0; return async () => (n++ ? null : KAART); })() });
  await eerst.laadKaart(true);
  await eerst.laadKaart(true);
  assert.equal(eerst.skelet().versie, "k1", "mislukte vraag gooit de kaart niet weg");

  // De indeling van het zaalscherm is nog uit te knippen
  const { knip } = require("../../paths/universe/telefoon-indeling");
  const fs = require("node:fs");
  const bron = fs.readFileSync(require.resolve("../../paths/universe/public/sky-renderer.js"), "utf8");
  for (const naam of ["networkLayout", "networkDepthInfo", "networkTargetForNode", "buildNetworkAdjacency"]) {
    assert.ok(knip(bron, naam).startsWith(`function ${naam}(`), `${naam} gevonden in sky-renderer.js`);
  }

  console.log("universum-test: ok");
}

main().catch((err) => { console.error(err); process.exit(1); });
