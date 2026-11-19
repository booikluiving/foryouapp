"use strict";

// Universum op de telefoon: stand uit de runtime-view en wat het publiek ervan te zien krijgt.
// Draait zonder diensten: npm run audience:universum-test

const assert = require("node:assert/strict");
const { createUniversum, doelUitView } = require("../server/universum");

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
    situationRuns: [{ situationRunId: "r1", situationId: "situation:1", resolved: { characters: [{ name: "Peter" }, { name: "Yaël" }], environmentId: "environment:3", environment: { name: "Grimmige_slaapkamer" } } }],
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
  // Doel zoals het zaalscherm (build-runtime-overlay): gespeeld, nu, klaar, vrij
  const d = doelUitView(view());
  assert.deepEqual(d.gespeeld, [1]);
  assert.equal(d.klaar, 4);
  assert.deepEqual([...d.rel].sort(), [1, 2, 4]);
  assert.deepEqual(d.echt[1], { w: ["Peter", "Yaël"], o: "Grimmige slaapkamer", e: "environment:3" }, "wie er echt speelde, ook op een vrije plek");
  assert.equal(doelUitView({ status: "idle", showRunId: null, pathEvaluation: { items: [{ situationId: "situation:4", status: "available" }, { situationId: "situation:2", status: "available" }] } }).rel.size, 2, "geen run: startscènes vrij");
  assert.equal(doelUitView(view({ startPhase: { active: true }, playedSituations: [], situationRuns: [], pathEvaluation: { items: [{ situationId: "situation:4", status: "available" }] } })).klaar, 0, "startfase: niets klaargezet tonen");

  // Stappen zoals het zaalscherm
  const u = createUniversum({ fetchKaart: async () => KAART, beeldVersie: (id) => (id === "environment:3" ? "abc" : "") });
  await u.laadKaart(true);
  // Eerste blik midden in een run: meteen de hele stand (springen), klaar ook.
  assert.equal(u.volg(view()), true, "eerste stand is nieuw");
  assert.equal(u.volg(view()), false, "zelfde stand = geen bericht");
  let p = u.publiek();
  assert.equal(p.klaar, 4);
  assert.ok(!p.kaartjes[3], "op slot: geen kaartje");
  assert.ok(!JSON.stringify(p).includes("Geheim"), "titel van een slotscène verlaat de Mac niet");
  assert.deepEqual(p.kaartjes[2], { t: "Tweede", w: ["Lisa"], o: null }, "vrij: titel en personages, geen omgeving");
  assert.equal(p.kaartjes[4].o, "Trein", "gekozen: omgeving zoals het vakje op het zaalscherm");
  assert.equal(p.kaartjes[1].b, "/audience/public/omgevingsbeeld/3?v=abc", "gespeeld: beeld van de omgeving");
  assert.ok(!p.kaartjes[2].b, "vrij: geen beeld");
  assert.equal(u.omgevingZichtbaar("environment:3"), true);
  assert.equal(u.omgevingZichtbaar("environment:9"), false, "een omgeving die niemand zag: geen beeld");

  // Scène 4 speelt: niets klaar, wat nu vrijkomt wacht.
  const speelt = { activeSituation: { situationId: "situation:4", resolved: { characters: [{ name: "Emma" }, { name: "Mark" }] } }, preparedNext: { situationId: "situation:3", reason: "after_start_situation" },
    resolvedPreparedNext: { situationId: "situation:3", characters: [{ name: "Adolf" }] } };
  assert.equal(u.volg(view(speelt)), true);
  p = u.publiek();
  assert.equal(p.nu, 4);
  assert.equal(p.klaar, 0, "tijdens de scène: de volgende scène niet tonen");
  assert.ok(!JSON.stringify(p).includes("Adolf"), "klaargezet tijdens de scène verlaat de Mac niet");

  // Scène gestopt: 4 gespeeld, 3 komt vrij volgens de runtime, maar pas na het stemmen in beeld.
  const gestopt = { playedSituations: [{ situationRunId: "r1", situationId: "situation:1" }, { situationRunId: "r2", situationId: "situation:4" }],
    preparedNext: { situationId: "situation:3", reason: "after_stop_situation" }, resolvedPreparedNext: { situationId: "situation:3", characters: [{ name: "Adolf" }], environment: { name: "Tennis" } },
    pathEvaluation: { items: [{ situationId: "situation:1", status: "played" }, { situationId: "situation:4", status: "played" }, { situationId: "situation:2", status: "available" }, { situationId: "situation:3", status: "available" }] } };
  u.volg(view(gestopt));
  p = u.publiek();
  assert.deepEqual(p.gespeeld, [1, 4]);
  assert.ok(!p.vrij.includes(3) && p.klaar === 0, "na de scène: nieuw vrij en klaar wachten op het zaalscherm");
  assert.equal(u.vrijgave(), true, "stemmen dicht: nieuwe scènes komen vrij");
  p = u.publiek();
  assert.ok(p.vrij.includes(3) && p.klaar === 0, "vrij, maar nog niet gekozen");
  assert.equal(u.keuzeGetoond(), true, "kiezer geland");
  p = u.publiek();
  assert.equal(p.klaar, 3);
  assert.equal(p.kaartjes[3].o, "Tennis");
  // Overslaan: andere scène klaar → weer verborgen tot de volgende keuze.
  u.volg(view({ ...gestopt, preparedNext: { situationId: "situation:2", reason: "skip" }, resolvedPreparedNext: { situationId: "situation:2", characters: [] } }));
  assert.equal(u.publiek().klaar, 0, "andere klaargezette scène: eerst weer de kiezer");

  // Kaart voor de telefoon: geen woorden
  const skelet = u.skelet();
  const tekst = JSON.stringify(skelet);
  for (const woord of ["Eerste", "Geheim", "Peter", "Keuken", "Adolf"]) assert.ok(!tekst.includes(woord), `kaart bevat geen ${woord}`);
  assert.deepEqual(skelet.s[2], [3, 20, 0]);

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
