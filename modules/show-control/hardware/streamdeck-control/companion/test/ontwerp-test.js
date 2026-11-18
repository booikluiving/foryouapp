"use strict";

// Het ontwerpsysteem van het deck: de controle op deck.json, de groene volgende stap
// en de scèneknoppen die van links aanschuiven.
//   node test/ontwerp-test.js
const assert = require("node:assert/strict");
const { loadDeck, standVan } = require("../lib");
const { validate } = require("../bouw");
const { compute } = require("../deck-status");

const deck = loadDeck();
validate(deck);

// --- de controle weigert wat niet in het systeem past ---
const kapot = (wijzig) => {
  const d = JSON.parse(JSON.stringify(deck));
  wijzig(d);
  return () => validate(d);
};
const show = (d) => d.paginas.find((p) => p.id === "show").knoppen;
assert.throws(kapot((d) => { show(d)[0].soort = "licht"; }), /soort licht onbekend/);
assert.throws(kapot((d) => { delete show(d)[0].soort; }), /soort \(geen\) onbekend/);
assert.throws(kapot((d) => { show(d)[0].kleur = "#ff0000"; }), /veld kleur hoort niet/);
assert.throws(kapot((d) => { show(d)[0].label = "HEEL LANGE"; }), /hooguit 8/);
assert.throws(kapot((d) => { show(d)[0].label = "A\nB\nC"; }), /hooguit 2/);
assert.throws(kapot((d) => { show(d).find((k) => k.key === "brent").plek = [0, 0]; show(d)[0].plek = [2, 7]; }), /soort geluid mag niet in rij 1/);
assert.throws(kapot((d) => { d.ontwerp.soorten.run.kleur = d.ontwerp.standen.volgende.vlak; }), /al een standkleur/);
assert.throws(kapot((d) => { d.ontwerp.soorten.run.standen.push("paars"); }), /stand paars bestaat niet/);
assert.throws(kapot((d) => { show(d).find((k) => k.key === "cam1").actie = { link: "http://x" }; }), /een link is soort web/);
assert.throws(kapot((d) => { show(d).find((k) => k.key === "nav_show_schermen").plek = [1, 7]; show(d).find((k) => k.key === "opname").plek = [3, 6]; }), /navigatie alleen in de onderste rij|mag niet in rij/);

// --- deck-status: een nagebootste stand van de show ---
const scene = { situationId: "situation:49", legacySituationId: 49, title: "Een" };
const g = (extra = {}) => ({
  core: Object.fromEntries(["d_gateway", "d_catalog", "d_paths", "d_algorithm", "d_runtime", "d_showcontrol", "d_audience", "d_scriptagent"].map((k) => [k, true])),
  hw: Object.fromEntries(["d_sq5", "d_camera", "d_streamdeck", "d_perfectcue", "d_dmx"].map((k) => [k, { ok: true, body: {} }])),
  showStatus: { ok: true, body: { warnings: [], environmentExtras: null, environmentKnoppen: { knoppen: [] }, personageKnop: null, ...(extra.show || {}) } },
  runtime: { ok: true, body: extra.runtime || { showRunId: "run-1", status: "running", activeSituation: null, resolvedPreparedNext: scene, preparedNext: { ...scene, reason: "runtime_order" }, startPhase: { active: false } } },
  sq5: { ok: true, body: { brent: true, megan: false, booiMixed: true, booi: false } },
  teleprompter: { ok: true, body: extra.tele || { ok: true, preparedScene: { sceneId: 49, title: "Een", status: "prepared", ready: false }, teleprompt: { lines: [], source: {} } } },
  stem: { ok: true, body: { actief: false } },
  sim: { ok: true, body: { bots: 0, personages: false } },
  ports: { 9100: true, 9101: true, 8008: true },
  tdText: "TD\nv1",
});

// tussen scènes, chat nog niet gegeven: SCENE CHAT is de volgende stap, READY en START donker
let uit = compute(deck, g());
assert.equal(uit.scenechat.s, "volgende");
assert.equal(uit.ready.s, "uit");
assert.equal(uit.sit.s, "uit");
assert.equal(Object.values(uit).filter((v) => v.s === "volgende").length, 1, "hooguit één groene knop");
// mics: open = kan, dicht = muted, MIX = half
assert.equal(standVan(uit.brent.s), "muted");
assert.equal(standVan(uit.megan.s), "kan");
assert.equal(standVan(uit.booi.s), "half");

// chat gegeven: READY is de volgende stap
uit = compute(deck, g({ tele: { ok: true, preparedScene: { sceneId: 49, title: "Een", status: "prepared", ready: false }, teleprompt: { lines: [{ text: "x" }], source: { sceneId: 49 } } } }));
assert.equal(uit.ready.s, "volgende");
assert.equal(uit.scenechat.s, "klaar");

// ready gegeven: START SCENE is de volgende stap
uit = compute(deck, g({ tele: { ok: true, preparedScene: { sceneId: 49, title: "Een", status: "prepared", ready: true }, teleprompt: { lines: [{ text: "x" }], source: { sceneId: 49 } } } }));
assert.equal(uit.sit.s, "volgende");
assert.equal(standVan(uit.ready.s), "aan");

// geen run: START RUN is groen
uit = compute(deck, g({ runtime: { showRunId: null, status: "idle" } }));
assert.equal(uit.run.s, "volgende");

// scèneknoppen: wat er is schuift van links aan, de rest is leeg
uit = compute(deck, g({ show: {
  environmentKnoppen: { knoppen: [null, { label: "Deur dicht", staat: "klaar" }] },
  environmentExtras: { shot: { klaar: false }, geluid: { klaar: true, label: "Gegrom", aan: true } },
  personageKnop: { label: "Marit nummer", staat: "klaar" },
} }));
assert.deepEqual(uit.plekken, { sc1: "omg2", sc2: "extrageluid", sc3: "personage" });
assert.equal(uit.sc1.t, "DEUR\nDICHT");
assert.equal(standVan(uit.sc2.s), "loopt");
assert.equal(uit.sc4.s, "leeg");
assert.equal(uit.omg1, undefined, "bronknoppen hebben geen eigen plek");

// zonder scèneknoppen: alle zes leeg
uit = compute(deck, g());
for (let n = 1; n <= 6; n += 1) assert.equal(uit[`sc${n}`].s, "leeg");

// elke stand hoort bij de soort van de knop
const soortVan = Object.fromEntries(deck.paginas.flatMap((p) => p.knoppen).map((k) => [k.key, k.soort]));
for (const [k, v] of Object.entries(uit)) {
  const st = standVan(v.s);
  assert.ok(st === "leeg" || deck.ontwerp.soorten[soortVan[k]].standen.includes(st), `${k}: ${st} niet bij ${soortVan[k]}`);
}

console.log("ontwerp-test: ok");
