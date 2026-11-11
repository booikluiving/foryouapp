"use strict";

// Haperen: de knop zet het aan en uit, elke keer dat het aangaat een stap erger; BEGIN zet alles terug.
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

// Aan (1), uit, aan (2), uit, aan (3), uit, aan (blijft 3).
const reeks = [];
for (let i = 0; i < 7; i += 1) reeks.push(osc(buildEnvironmentHaperCue(scene("a"), {}, options)).join(","));
assert.deepEqual(reeks, ["3,1", "3,0", "3,2", "3,0", "3,3", "3,0", "3,3"]);
assert.equal(environmentHaperenStatus(scene("a"), options).aan, true);

// Een nieuwe scène begint weer uit en bij de lichtste stap.
assert.deepEqual([environmentHaperenStatus(scene("b"), options).aan, environmentHaperenStatus(scene("b"), options).sterkte], [false, 0]);

// De knoppen: stappen, haperen, begin.
const knopOptions = { environmentOmvallen: options, environmentFases: { catalog: { environmentCompositions: [], environments: [], mediaAssets: [] } } };
let knoppen = environmentKnoppenStatus(scene("b"), knopOptions).knoppen;
assert.deepEqual(knoppen.map((knop) => [knop.soort, knop.label, knop.staat]), [
  ["omvallen", "NEMEN OP", "klaar"], ["haperen", "ADOLF HAPERT", "klaar"], ["begin", "BEGIN", "uit"],
]);
let cue = buildEnvironmentKnopCue(scene("b"), { plek: 1 }, knopOptions);
assert.deepEqual(osc(cue), ["3", "1"]);
knoppen = environmentKnoppenStatus(scene("b"), knopOptions).knoppen;
assert.deepEqual([knoppen[1].label, knoppen[1].teller, knoppen[2].staat], ["HAPEREN UIT", "1/3", "klaar"]);

// BEGIN: clip weg en haperen uit, in één cue; daarna begint haperen weer bij 1.
cue = buildEnvironmentKnopCue(scene("b"), { plek: 2 }, knopOptions);
assert.deepEqual(cue.actions.map((action) => action.command), ["td.effect.omvallen", "td.effect.haper"]);
assert.deepEqual(osc(cue, 1), ["3", "0"]);
assert.deepEqual(osc(buildEnvironmentKnopCue(scene("b"), { plek: 1 }, knopOptions)), ["3", "1"]);

console.log("show-control environment-haperen: ok");
