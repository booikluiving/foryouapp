"use strict";

// De volgorde van een scène op het deck: welke knop mag wanneer.
//   node test/volgorde-test.js
const assert = require("node:assert/strict");
const { showVolgorde } = require("../lib");

const scene = { situationId: "situation:49", legacySituationId: 49, title: "Een" };
const run = (extra = {}) => ({ showRunId: "run-1", status: "running", activeSituation: null, resolvedPreparedNext: scene, preparedNext: { ...scene, reason: "runtime_order" }, startPhase: { active: false }, ...extra });
const tele = (extra = {}, lines = [], bron = 0) => ({ ok: true, preparedScene: { sceneId: 49, title: "Een", status: "prepared", ready: false, ...extra }, teleprompt: { lines, source: bron ? { sceneId: bron } : {} } });
const tekst = [{ text: "regel" }];
const zegt = (uitkomst, mag, waarom, wat) => {
  assert.equal(uitkomst.mag, mag, wat);
  if (!mag) assert.equal(uitkomst.waarom, waarom, wat);
};

// Geen run: alleen START RUN.
let v = showVolgorde({ showRunId: null, status: "idle" }, tele(), null);
zegt(v.run, true, "", "zonder run mag START RUN");
zegt(v.sit, false, "NO\nRUN", "zonder run geen scène");
zegt(v.chat, false, "NO\nRUN", "zonder run geen scène naar chat");
zegt(v.stem, false, "NO\nRUN", "zonder run geen stemming");

// Startfase, nog niet gestemd: eerst STEM.
v = showVolgorde(run({ startPhase: { active: true } }), tele(), { actief: false });
zegt(v.stem, true, "", "in de startfase mag STEM");
zegt(v.chat, false, "EERST\nSTEM", "in de startfase eerst stemmen, dan pas scène naar chat");
zegt(v.ready_knop, false, "EERST\nSTEM", "in de startfase eerst stemmen, dan pas ready");
zegt(v.sit, false, "EERST\nSTEM", "in de startfase eerst stemmen, dan pas starten");

// De stemming loopt: alleen sluiten.
v = showVolgorde(run({ startPhase: { active: true } }), tele(), { actief: true });
zegt(v.stem, true, "", "een lopende stemming mag gesloten worden");
zegt(v.chat, false, "STEM\nLOOPT", "tijdens het stemmen geen scène naar chat");
zegt(v.sit, false, "STEM\nLOOPT", "tijdens het stemmen niet starten");

// De winnaar staat klaar: nu scène naar chat, niet nog een keer stemmen.
const gekozen = run({ startPhase: { active: true }, preparedNext: { ...scene, reason: "operator_chosen" } });
v = showVolgorde(gekozen, tele(), { actief: false });
zegt(v.stem, false, "AL\nGEKOZEN", "na de uitslag niet opnieuw stemmen");
zegt(v.chat, true, "", "na de uitslag mag scène naar chat");
zegt(v.ready_knop, false, "EERST\nCHAT", "zonder tekst geen ready");
zegt(v.sit, false, "EERST\nCHAT", "zonder tekst niet starten");

// De tekst is er: nu READY, nog niet starten.
v = showVolgorde(gekozen, tele({}, tekst, 49), { actief: false });
zegt(v.ready_knop, true, "", "met de tekst van deze scène mag READY");
zegt(v.sit, false, "EERST\nREADY", "zonder ready niet starten");
zegt(v.chat, true, "", "de tekst mag opnieuw gemaakt worden");

// De tekst hoort bij een andere scène.
v = showVolgorde(gekozen, tele({}, tekst, 12), { actief: false });
zegt(v.ready_knop, false, "EERST\nCHAT", "tekst van een andere scène telt niet");
zegt(v.sit, false, "EERST\nCHAT", "met de tekst van een andere scène niet starten");

// READY is gegeven: starten mag.
v = showVolgorde(gekozen, tele({ ready: true }, tekst, 49), { actief: false });
assert.equal(v.ready, true);
zegt(v.ready_knop, false, "AL\nREADY", "ready is al gegeven");
zegt(v.sit, true, "", "na ready mag de scène starten");

// READY voor een andere scène dan die klaarstaat telt niet.
v = showVolgorde(gekozen, tele({ sceneId: 12, ready: true }, tekst, 12), { actief: false });
assert.equal(v.ready, false);
zegt(v.sit, false, "EERST\nCHAT", "ready voor een andere scène telt niet");

// De scène speelt: alleen stoppen.
v = showVolgorde(run({ activeSituation: { situationId: "situation:49" } }), tele({ status: "playing", ready: true }, tekst, 49), { actief: false });
zegt(v.sit, true, "", "een lopende scène mag gestopt worden");
zegt(v.run, false, "EERST\nSTOP", "tijdens een scène geen reset");
zegt(v.chat, false, "SCENE\nLOOPT", "tijdens een scène geen scène naar chat");
zegt(v.ready_knop, false, "SCENE\nLOOPT", "tijdens een scène geen ready");
zegt(v.stem, false, "SCENE\nLOOPT", "tijdens een scène geen stemming");
zegt(v.fase, false, "SCENE\nLOOPT", "tijdens een scène geen inloop of loading");

// Na de startfase volgt de run de paden: geen stemming meer, wel de rest.
v = showVolgorde(run(), tele(), { actief: false });
zegt(v.stem, false, "STARTS\nKLAAR", "na de startfase geen stemming");
zegt(v.chat, true, "", "na de startfase mag scène naar chat zonder stemming");
zegt(v.run, true, "", "tussen twee scènes mag reset");
zegt(v.fase, true, "", "tussen twee scènes mogen inloop en loading");

// Er staat niets klaar.
v = showVolgorde(run({ resolvedPreparedNext: null, preparedNext: null }), tele(), { actief: false });
zegt(v.chat, false, "GEEN\nSCENE", "zonder klaargezette scène geen scène naar chat");
zegt(v.sit, false, "GEEN\nSCENE", "zonder klaargezette scène niet starten");

// De teleprompter is niet bereikbaar.
v = showVolgorde(run(), null, null);
zegt(v.ready_knop, false, "READY\n--", "zonder teleprompter geen ready");
zegt(v.sit, false, "EERST\nREADY", "zonder teleprompter niet starten vanaf het deck");

console.log("volgorde: ok");
