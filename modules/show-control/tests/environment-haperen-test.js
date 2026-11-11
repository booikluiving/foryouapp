"use strict";

// Haperen: houd-knop (indrukken = aan, loslaten = uit); BEGIN zet alles terug.
// Geen netwerk, geen catalogus: het manifest wordt meegegeven.

const assert = require("node:assert/strict");
const {
  buildEnvironmentHaperCue,
  environmentHaperenStatus,
  resetHaperenState,
} = require("../cue-library/environment-haperen");
const { resetOmvallenState } = require("../cue-library/environment-omvallen");
const { buildEnvironmentKnopCue, environmentKnoppenStatus } = require("../cue-library/environment-knoppen");
const { oscArgsForAction } = require("../target-adapters/touchdesigner-adapter");

const manifest = {
  haper: { camera: 3, naam: "Adolf" },
  drukken: [{ druk: 1, naam: "nemen op", clip: "a.mov" }],
};
const options = { manifest, catalogMediaRoot: "/media", fileExists: () => true };
const scene = (runId) => ({ activeSituation: { runId, resolved: { environmentId: "environment:27", situationId: "situation:67" } } });
const osc = (cue, i = 0) => oscArgsForAction({ ...cue.actions[i], cueId: cue.cueId }).slice(3);

resetOmvallenState();
resetHaperenState();
assert.equal(environmentHaperenStatus({}, options).reden, "geen_omgeving");
assert.equal(environmentHaperenStatus(scene("a"), { ...options, manifest: { drukken: manifest.drukken } }).reden, "geen_haperen");
assert.throws(() => buildEnvironmentHaperCue(scene("a"), {}, { ...options, manifest: { drukken: manifest.drukken } }), /geen_haperen/);

// Zonder fase wisselt het: aan, uit, aan. Altijd dezelfde sterkte (2, of wat erbij staat).
const reeks = [];
for (let i = 0; i < 3; i += 1) reeks.push(osc(buildEnvironmentHaperCue(scene("a"), {}, options)).join(","));
assert.deepEqual(reeks, ["3,2", "3,0", "3,2"]);
assert.equal(environmentHaperenStatus(scene("a"), options).aan, true);
assert.deepEqual(osc(buildEnvironmentHaperCue(scene("a"), { actie: "aan" }, { ...options, manifest: { ...manifest, haper: { camera: 1, sterkte: 3 } } })), ["1", "3"]);

// Een nieuwe scène begint weer uit.
assert.equal(environmentHaperenStatus(scene("b"), options).aan, false);

// De knoppen: stappen, haperen (houd-knop), begin.
const knopOptions = { environmentOmvallen: options, environmentFases: { catalog: { environmentCompositions: [], environments: [], mediaAssets: [] } } };
let knoppen = environmentKnoppenStatus(scene("b"), knopOptions).knoppen;
assert.deepEqual(knoppen.map((knop) => [knop.soort, knop.label, knop.staat, !!knop.houden]), [
  ["omvallen", "NEMEN OP", "klaar", false], ["haperen", "ADOLF HAPERT", "klaar", true], ["begin", "BEGIN", "uit", false],
]);

// Indrukken = aan, nog eens indrukken blijft aan, loslaten = uit.
assert.deepEqual(osc(buildEnvironmentKnopCue(scene("b"), { plek: 1, fase: "druk" }, knopOptions)), ["3", "2"]);
assert.deepEqual(osc(buildEnvironmentKnopCue(scene("b"), { plek: 1, fase: "druk" }, knopOptions)), ["3", "2"]);
knoppen = environmentKnoppenStatus(scene("b"), knopOptions).knoppen;
assert.deepEqual([knoppen[1].aan, knoppen[2].staat], [true, "klaar"]);
assert.deepEqual(osc(buildEnvironmentKnopCue(scene("b"), { plek: 1, fase: "los" }, knopOptions)), ["3", "0"]);
assert.equal(environmentKnoppenStatus(scene("b"), knopOptions).knoppen[1].aan, false);

// Loslaten van een gewone knop doet niets; indrukken met fase "druk" werkt als altijd.
assert.throws(() => buildEnvironmentKnopCue(scene("b"), { plek: 0, fase: "los" }, knopOptions), /geen_houdknop/);
assert.equal(buildEnvironmentKnopCue(scene("b"), { plek: 0, fase: "druk" }, knopOptions).actions[0].command, "td.effect.omvallen");

// BEGIN: clip weg en haperen uit, in één cue.
buildEnvironmentKnopCue(scene("b"), { plek: 1, fase: "druk" }, knopOptions);
const cue = buildEnvironmentKnopCue(scene("b"), { plek: 2 }, knopOptions);
assert.deepEqual(cue.actions.map((action) => action.command), ["td.effect.omvallen", "td.effect.haper"]);
assert.deepEqual(osc(cue, 1), ["3", "0"]);

console.log("show-control environment-haperen: ok");
