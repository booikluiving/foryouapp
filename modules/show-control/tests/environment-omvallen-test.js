"use strict";

// Effect omvallen: de cue per druk, de teller per scène en terug naar het begin.
// Geen netwerk, geen catalogus: manifest en bestanden worden meegegeven.

const assert = require("node:assert/strict");
const {
  buildEnvironmentOmvallenCue,
  environmentOmvallenStatus,
  publicOmvallenStatus,
  resetOmvallenState,
} = require("../cue-library/environment-omvallen");
const { oscArgsForAction } = require("../target-adapters/touchdesigner-adapter");

const manifest = {
  schemaVersion: "omvallen.v0",
  environmentId: "environment:26",
  drukken: [
    { druk: 1, naam: "komt los", klap: 1.25, clip: "stap-1.mov", duur: 2.44, geluid: "environments/environment_26/extra/val-1.mp3" },
    { druk: 2, naam: "kast valt", klap: 1.55, clip: "stap-2.mov", duur: 2.76, geluid: "" },
    { druk: 3, naam: "stapel zakt weg", klap: 1.2, clip: "stap-3.mov", duur: 2.76, geluid: "environments/environment_26/extra/weg.mp3" },
  ],
};
const options = { manifest, catalogMediaRoot: "/media", fileExists: (filePath) => !filePath.endsWith("weg.mp3") };
const scene = (id, runId) => ({ activeSituation: { runId, resolved: { environmentId: id } } });

resetOmvallenState();
assert.equal(environmentOmvallenStatus({}, options).reden, "geen_omgeving");
assert.equal(environmentOmvallenStatus(scene("environment:26", "a"), { manifest: null, catalogMediaRoot: "/bestaat-niet" }).reden, "geen_effect");
assert.throws(() => buildEnvironmentOmvallenCue({}, {}, options), /geen_omgeving/);

let status = environmentOmvallenStatus(scene("environment:26", "a"), options);
assert.deepEqual([status.klaar, status.pos, status.totaal, status.volgende], [true, 0, 3, "komt los"]);
assert.equal(publicOmvallenStatus(status).manifest, undefined);

// Druk 1: clip naar TD, geluid op de klap.
let cue = buildEnvironmentOmvallenCue(scene("environment:26", "a"), {}, options);
assert.equal(cue.actions.length, 2);
assert.equal(cue.actions[0].command, "td.effect.omvallen");
assert.equal(cue.actions[0].payload.filePath, "/media/environments/environment_26/omvallen/stap-1.mov");
assert.equal(cue.actions[1].command, "audio.extra.play");
assert.equal(cue.actions[1].delayMs, 1250);
assert.deepEqual(oscArgsForAction({ ...cue.actions[0], cueId: cue.cueId }).slice(3), ["/media/environments/environment_26/omvallen/stap-1.mov", "0", "2.44"]);

// Druk 2: geen geluid ingevuld, dus alleen de clip.
cue = buildEnvironmentOmvallenCue(scene("environment:26", "a"), {}, options);
assert.equal(cue.actions.length, 1);
assert.equal(cue.actions[0].payload.druk, 2);

// Druk 3: het geluidsbestand ontbreekt, de clip gaat wel.
cue = buildEnvironmentOmvallenCue(scene("environment:26", "a"), {}, options);
assert.equal(cue.actions.length, 1);
assert.equal(environmentOmvallenStatus(scene("environment:26", "a"), options).volgende, "begin");

// Na de laatste: terug naar het begin.
cue = buildEnvironmentOmvallenCue(scene("environment:26", "a"), {}, options);
assert.equal(cue.actions[0].payload.uit, true);
assert.deepEqual(oscArgsForAction({ ...cue.actions[0], cueId: cue.cueId }).slice(3), ["", "1", "0"]);
assert.equal(environmentOmvallenStatus(scene("environment:26", "a"), options).pos, 0);

// Een nieuwe scène in dezelfde omgeving begint weer bij het begin.
buildEnvironmentOmvallenCue(scene("environment:26", "a"), {}, options);
assert.equal(environmentOmvallenStatus(scene("environment:26", "a"), options).pos, 1);
assert.equal(environmentOmvallenStatus(scene("environment:26", "b"), options).pos, 0);

// Actie "begin" zet hem altijd terug.
buildEnvironmentOmvallenCue(scene("environment:26", "b"), {}, options);
cue = buildEnvironmentOmvallenCue(scene("environment:26", "b"), { actie: "begin" }, options);
assert.equal(cue.actions[0].payload.uit, true);

// Clip weg: geen cue.
assert.throws(() => buildEnvironmentOmvallenCue(scene("environment:26", "c"), {}, { ...options, fileExists: () => false }), /clip_ontbreekt/);

// Stappen per situatie en een stap die het sfeergeluid wisselt.
{
  const fs = require("node:fs");
  const os = require("node:os");
  const path = require("node:path");
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "omvallen-test-"));
  const dir = path.join(root, "environments", "environment_27", "omvallen");
  fs.mkdirSync(dir, { recursive: true });
  for (const naam of ["a.mov", "b.mov", "stil.wav"]) fs.writeFileSync(path.join(dir, naam), "x");
  fs.writeFileSync(path.join(dir, "omvallen.json"), JSON.stringify({ drukken: [{ druk: 1, naam: "omgeving", clip: "a.mov" }] }));
  fs.writeFileSync(path.join(dir, "omvallen-situation_67.json"), JSON.stringify({ drukken: [
    { druk: 1, naam: "neemt op", clip: "b.mov", klap: 0.5, sfeer: "environments/environment_27/omvallen/stil.wav" },
  ] }));
  const opts = { catalogMediaRoot: root };
  const met = (situationId, runId) => ({ activeSituation: { runId, resolved: { environmentId: "environment:27", situationId } } });
  resetOmvallenState();
  assert.equal(environmentOmvallenStatus(met("situation:81", "x"), opts).volgende, "omgeving");
  assert.equal(environmentOmvallenStatus(met("situation:67", "y"), opts).volgende, "neemt op");
  cue = buildEnvironmentOmvallenCue(met("situation:67", "y"), {}, opts);
  assert.deepEqual(cue.actions.map((action) => action.command), ["td.effect.omvallen", "td.effect.fase"]);
  assert.equal(cue.actions[1].delayMs, 500);
  assert.deepEqual(oscArgsForAction({ ...cue.actions[1], cueId: cue.cueId }).slice(3), ["", "1", "0", "0", path.join(dir, "stil.wav")]);
  // Begin: clip weg en het sfeergeluid van de omgeving terug.
  cue = buildEnvironmentOmvallenCue(met("situation:67", "y"), { actie: "begin" }, opts);
  assert.deepEqual(cue.actions.map((action) => action.command), ["td.effect.omvallen", "td.effect.fase"]);
  assert.equal(cue.actions[1].payload.sfeerPath, "");
  fs.rmSync(root, { recursive: true, force: true });
}

console.log("show-control environment-omvallen: ok");

// Vanzelf: af en toe een clip uit zichzelf, alleen bij een scène die speelt, niet door een druk heen.
{
  const { environmentVanzelfTick } = require("../cue-library/environment-omvallen");
  const vanzelfManifest = {
    schemaVersion: "omvallen.v0",
    environmentId: "environment:6",
    drukken: [{ druk: 1, naam: "Veel foto's", klap: 0, clip: "salvo-1.mov", duur: 3.6, geluid: "environments/environment_6/omvallen/salvo-1.wav" }],
    vanzelf: { clips: ["flits-1.mov", "flits-2.mov"], duur: 0.6, geluid: "environments/environment_6/omvallen/flits.wav", volume: 0.5, minSec: 10, maxSec: 20 },
  };
  const opt = (now) => ({ manifest: vanzelfManifest, catalogMediaRoot: "/media", fileExists: () => true, random: () => 0.5, now });
  const speelt = scene("environment:6", "p");
  resetOmvallenState();
  // Klaargezet maar niet gestart: niets.
  assert.equal(environmentVanzelfTick({ resolvedPreparedNext: { environmentId: "environment:6" } }, opt(0)), null);
  // Scène start: eerst wachten (15 s bij random 0,5).
  assert.equal(environmentVanzelfTick(speelt, opt(1000)), null);
  assert.equal(environmentVanzelfTick(speelt, opt(15000)), null);
  let flits = environmentVanzelfTick(speelt, opt(16000));
  assert.equal(flits.actions[0].command, "td.effect.omvallen");
  assert.equal(flits.actions[0].payload.filePath, "/media/environments/environment_6/omvallen/flits-1.mov");
  assert.equal(flits.actions[1].payload.volume, 0.5);
  // Telt niet als druk.
  assert.equal(environmentOmvallenStatus(speelt, opt(16000)).pos, 0);
  // Volgende pas na de wachttijd, met de volgende clip.
  assert.equal(environmentVanzelfTick(speelt, opt(20000)), null);
  flits = environmentVanzelfTick(speelt, opt(31000));
  assert.equal(flits.actions[0].payload.filePath, "/media/environments/environment_6/omvallen/flits-2.mov");
  // Een druk (salvo) houdt de flits vanzelf tegen tot de clip uit is.
  buildEnvironmentOmvallenCue(speelt, {}, opt(45900));
  assert.equal(environmentVanzelfTick(speelt, opt(46000)), null);
  assert.ok(environmentVanzelfTick(speelt, opt(50100)));
  // Zonder "vanzelf" in het manifest: nooit iets.
  resetOmvallenState();
  assert.equal(environmentVanzelfTick(scene("environment:26", "a"), { ...options, now: 0 }), null);
  assert.equal(environmentVanzelfTick(scene("environment:26", "a"), { ...options, now: 999999 }), null);
  resetOmvallenState();
}

// Herhaal: de knop gaat eindeloos door (salvo), zonder teller en zonder OPNIEUW.
{
  const { environmentKnoppenStatus } = require("../cue-library/environment-knoppen");
  const herhaalManifest = {
    schemaVersion: "omvallen.v0",
    environmentId: "environment:6",
    herhaal: true,
    drukken: [
      { druk: 1, naam: "Veel foto's", klap: 0, clip: "salvo-1.mov", duur: 3.6 },
      { druk: 2, naam: "Veel foto's", klap: 0, clip: "salvo-2.mov", duur: 3.6 },
    ],
  };
  const opt = { manifest: herhaalManifest, catalogMediaRoot: "/media", fileExists: () => true };
  const speelt = scene("environment:6", "h");
  resetOmvallenState();
  const clips = [];
  for (let i = 0; i < 5; i += 1) clips.push(buildEnvironmentOmvallenCue(speelt, {}, opt).actions[0].payload.filePath.split("/").pop());
  assert.deepEqual(clips, ["salvo-1.mov", "salvo-2.mov", "salvo-1.mov", "salvo-2.mov", "salvo-1.mov"]);
  const knoppen = environmentKnoppenStatus(speelt, { environmentOmvallen: opt }).knoppen;
  assert.deepEqual([knoppen[0].label, knoppen[0].teller, knoppen[1].label, knoppen[1].staat], ["VEEL FOTO'S", "", "BEGIN", "klaar"]);
  // BEGIN zet het effect uit en begint opnieuw.
  const begin = buildEnvironmentOmvallenCue(speelt, { actie: "begin" }, opt);
  assert.equal(begin.actions[0].payload.uit, true);
  assert.equal(environmentOmvallenStatus(speelt, opt).pos, 0);
  resetOmvallenState();
}
