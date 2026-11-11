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

console.log("show-control environment-omvallen: ok");
