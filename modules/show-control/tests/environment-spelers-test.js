"use strict";

// Spelerbeeld spiegelen en faden: bij een stap (de deur gaat dicht), bij BEGIN en bij de start van
// de scène. Geen netwerk, geen catalogus: het manifest wordt meegegeven.

const assert = require("node:assert/strict");
const {
  buildEnvironmentOmvallenCue,
  omvallenSpelerStartAction,
  resetOmvallenState,
} = require("../cue-library/environment-omvallen");
const { spelerPayload } = require("../cue-library/environment-spelers");
const { oscArgsForAction } = require("../target-adapters/touchdesigner-adapter");
const { resolveCommand } = require("../command-registry/command-registry");

const manifest = {
  herhaal: true,
  spelers: [{ camera: 3, spiegel: true }],
  drukken: [
    { druk: 1, naam: "DEUR DICHT", clip: "dicht.mov", duur: 0.6, speler: { camera: 1, zichtbaar: false, fade: 0.5 } },
    { druk: 2, naam: "DEUR OPEN", clip: "open.mov", duur: 1.7, speler: { camera: 1, zichtbaar: true, fade: 1 } },
  ],
};
const options = { manifest, catalogMediaRoot: "/media", fileExists: () => true };
const scene = (runId) => ({ activeSituation: { runId, resolved: { environmentId: "environment:3", situationId: "situation:63" } } });
const speler = (cue) => cue.actions.find((action) => action.command === "td.effect.speler");
const osc = (cue) => oscArgsForAction({ ...speler(cue), cueId: cue.cueId }).slice(3);

assert.equal(spelerPayload(null), null);
assert.equal(spelerPayload({ camera: 7, zichtbaar: false }), null);
assert.deepEqual(spelerPayload([{ camera: 1, zichtbaar: false }, { camera: 3, spiegel: true }]), { spiegel: "--1", zichtbaar: "0--", fade: 0.5 });

// De deur gaat dicht: speler 1 fadet weg. De deur gaat open: speler 1 komt terug.
resetOmvallenState();
assert.deepEqual(osc(buildEnvironmentOmvallenCue(scene("a"), {}, options)), ["---", "0--", "0.5"]);
assert.deepEqual(osc(buildEnvironmentOmvallenCue(scene("a"), {}, options)), ["---", "1--", "1"]);
// BEGIN: de voorgrond terug en speler 1 weer in beeld.
const begin = buildEnvironmentOmvallenCue(scene("a"), { actie: "begin" }, options);
assert.deepEqual(begin.actions.map((action) => action.command), ["td.effect.omvallen", "td.effect.speler"]);
assert.deepEqual(osc(begin).slice(0, 2), ["---", "1--"]);

// Een stap zonder speler stuurt niets extra.
resetOmvallenState();
const kaal = buildEnvironmentOmvallenCue(scene("b"), {}, { ...options, manifest: { drukken: [{ druk: 1, naam: "x", clip: "x.mov" }] } });
assert.equal(speler(kaal), undefined);

// Start van de scène: speler 3 gespiegeld, kort na de omgeving.
const start = omvallenSpelerStartAction(scene("a"), options);
assert.equal(start.command, "td.effect.speler");
assert.equal(start.delayMs, 400);
assert.deepEqual(oscArgsForAction({ ...start, cueId: "c" }).slice(3), ["--1", "---", "0"]);
assert.equal(omvallenSpelerStartAction(scene("a"), { ...options, manifest: { drukken: [] } }), null);
assert.equal(omvallenSpelerStartAction({}, options), null);

assert.equal(resolveCommand("td.effect.speler").targetId, "touchdesigner");

console.log("show-control environment-spelers: ok");
