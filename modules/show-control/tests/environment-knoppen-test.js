"use strict";

// Omgevingsknoppen en fases: lijst per omgeving, volgende fase, begin. Geen netwerk, geen catalogus.

const assert = require("node:assert/strict");
const { buildEnvironmentFaseCue, environmentFasesStatus, publicFasesStatus, resetFasesState } = require("../cue-library/environment-fases");
const { resetOmvallenState } = require("../cue-library/environment-omvallen");
const { buildEnvironmentKnopCue, environmentKnoppenStatus } = require("../cue-library/environment-knoppen");
const { oscArgsForAction } = require("../target-adapters/touchdesigner-adapter");

const catalog = {
  environments: [
    { id: "environment:25", name: "Auto", extras: { geluid: { bron: "bestand", bestand: "geluid:botsing", volume: 0.8 } } },
    { id: "environment:26", name: "Antiekwinkel" },
    { id: "environment:5", name: "Logeerkamer" },
  ],
  mediaAssets: [
    { id: "beeld:aanrijding", environmentId: "environment:25", type: "extra", role: "extraShot", relativePath: "environments/environment_25/extra/aanrijding.mp4" },
    { id: "beeld:uit", environmentId: "environment:25", type: "extra", role: "extraShot", relativePath: "environments/environment_25/extra/uit.jpg" },
    { id: "geluid:botsing", environmentId: "environment:25", type: "extra", role: "extraGeluid", relativePath: "environments/environment_25/extra/botsing.mp3" },
  ],
  environmentCompositions: [
    { environmentId: "environment:25", fases: [
      { naam: "Rijden", assetId: "", schok: false, schokNa: 0 },
      { naam: "Aanrijding", assetId: "beeld:aanrijding", schok: true, schokNa: 1.4 },
      { naam: "Myrthe stapt uit", assetId: "beeld:uit", schok: false, schokNa: 0 },
    ] },
  ],
};
const manifest = { drukken: [{ druk: 1, naam: "komt los", klap: 1.25, clip: "stap-1.mov", duur: 2.4, geluid: "" }, { druk: 2, naam: "kast valt", klap: 1.55, clip: "stap-2.mov", duur: 2.7, geluid: "" }] };
const fases = { catalog, catalogMediaRoot: "/media", fileExists: () => true };
const options = (metOmvallen) => ({
  environmentFases: fases,
  environmentOmvallen: metOmvallen ? { manifest, catalogMediaRoot: "/media", fileExists: () => true } : { manifest: null, catalogMediaRoot: "/bestaat-niet" },
});
const scene = (id, runId) => ({ activeSituation: { runId, resolved: { environmentId: id } } });

resetFasesState();
resetOmvallenState();

// Een omgeving zonder fases of effect: lege lijst.
assert.deepEqual(environmentKnoppenStatus(scene("environment:5", "a"), options(false)).knoppen, []);
assert.throws(() => buildEnvironmentKnopCue(scene("environment:5", "a"), { plek: 0 }, options(false)), /geen_knop/);

// Auto: één knop met de volgende fase, en begin (nog uit).
let status = environmentKnoppenStatus(scene("environment:25", "a"), options(false));
assert.deepEqual(status.knoppen.map((knop) => [knop.soort, knop.label, knop.teller, knop.staat]), [
  ["fase", "AANRIJDING", "1/3", "klaar"],
  ["begin", "BEGIN", "", "uit"],
]);
assert.equal(publicFasesStatus(environmentFasesStatus(scene("environment:25", "a"), fases)).fases[1].filePath, undefined);

// Druk: Aanrijding. Geluid begint meteen; TD krijgt de wachttijd tot de klap mee.
let cue = buildEnvironmentKnopCue(scene("environment:25", "a"), { plek: 0 }, options(false));
assert.deepEqual(cue.actions.map((action) => [action.command, action.delayMs]), [["audio.extra.play", 0], ["td.effect.fase", 0]]);
assert.equal(cue.actions[0].payload.volume, 0.8);
assert.deepEqual(oscArgsForAction({ ...cue.actions[1], cueId: cue.cueId }).slice(3), ["/media/environments/environment_25/extra/aanrijding.mp4", "0", "1", "1.4"]);
status = environmentKnoppenStatus(scene("environment:25", "a"), options(false));
assert.deepEqual(status.knoppen.map((knop) => [knop.label, knop.teller, knop.staat]), [["MYRTHE STAPT UIT", "2/3", "klaar"], ["BEGIN", "", "klaar"]]);

// Druk: uitstappen, zonder schok dus zonder geluid. Daarna staat er OPNIEUW.
cue = buildEnvironmentKnopCue(scene("environment:25", "a"), { plek: 0 }, options(false));
assert.deepEqual(cue.actions.map((action) => action.command), ["td.effect.fase"]);
assert.equal(environmentKnoppenStatus(scene("environment:25", "a"), options(false)).knoppen[0].label, "OPNIEUW");

// OPNIEUW = terug naar de eerste fase: de gewone achtergrond.
cue = buildEnvironmentKnopCue(scene("environment:25", "a"), { plek: 0 }, options(false));
assert.deepEqual(oscArgsForAction({ ...cue.actions[0], cueId: cue.cueId }).slice(3), ["", "1", "0", "0"]);

// Een nieuwe scène begint bij fase 1.
buildEnvironmentFaseCue(scene("environment:25", "a"), { index: 2 }, fases);
assert.equal(environmentFasesStatus(scene("environment:25", "b"), fases).actief, 0);
assert.throws(() => buildEnvironmentFaseCue(scene("environment:25", "b"), { index: 9 }, fases), /onbekende_fase/);

// Fases en omvallen samen: twee knoppen en één begin die alles terugzet.
const beide = options(true);
buildEnvironmentKnopCue(scene("environment:25", "c"), { plek: 0 }, beide);
buildEnvironmentKnopCue(scene("environment:25", "c"), { plek: 1 }, beide);
status = environmentKnoppenStatus(scene("environment:25", "c"), beide);
assert.deepEqual(status.knoppen.map((knop) => [knop.soort, knop.label, knop.teller]), [
  ["fase", "MYRTHE STAPT UIT", "2/3"],
  ["omvallen", "KAST VALT", "1/2"],
  ["begin", "BEGIN", ""],
]);
cue = buildEnvironmentKnopCue(scene("environment:25", "c"), { plek: 2 }, beide);
assert.deepEqual(cue.actions.map((action) => action.command), ["td.effect.fase", "td.effect.omvallen"]);
assert.ok(cue.actions.every((action) => action.actionId.startsWith(cue.cueId) && action.transport.args[0] === cue.cueId));
status = environmentKnoppenStatus(scene("environment:25", "c"), beide);
assert.deepEqual(status.knoppen.map((knop) => knop.teller), ["1/3", "0/2", ""]);

console.log("show-control environment-knoppen: ok");
