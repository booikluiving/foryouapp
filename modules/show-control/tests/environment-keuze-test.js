"use strict";

// Effect omvallen met keuzes (trolleyprobleem): eerst de stap "tram komt", dan links of rechts,
// daarna alleen nog OPNIEUW. Geen netwerk, geen catalogus.

const assert = require("node:assert/strict");
const { resetOmvallenState } = require("../cue-library/environment-omvallen");
const { buildEnvironmentKnopCue, environmentKnoppenStatus } = require("../cue-library/environment-knoppen");

const manifest = {
  drukken: [{ druk: 1, naam: "Tram komt", clip: "tram-komt.mov", duur: 5, klap: 0, geluid: "environments/environment_30/omvallen/tram-komt.wav" }],
  keuzes: [
    { naam: "Links", clip: "links.mov", duur: 2.6, klap: 0, geluid: "environments/environment_30/omvallen/links.wav" },
    { naam: "Rechts", clip: "rechts.mov", duur: 2.6, klap: 0, geluid: "environments/environment_30/omvallen/rechts.wav" },
  ],
};
const options = { environmentFases: { catalog: { environments: [], mediaAssets: [], environmentCompositions: [] } }, environmentOmvallen: { manifest, catalogMediaRoot: "/media", fileExists: () => true } };
const scene = (runId) => ({ activeSituation: { runId, resolved: { environmentId: "environment:30" } } });
const knoppen = (runId = "a") => environmentKnoppenStatus(scene(runId), options).knoppen.map((knop) => [knop.soort, knop.label, knop.staat]);

resetOmvallenState();

// Begin: tram komt kan, links en rechts nog niet. BEGIN past er niet meer bij (OPNIEUW doet dat).
assert.deepEqual(knoppen(), [["omvallen", "TRAM KOMT", "klaar"], ["keuze", "LINKS", "uit"], ["keuze", "RECHTS", "uit"]]);
assert.throws(() => buildEnvironmentKnopCue(scene("a"), { plek: 1 }, options), /geen_knop/);

// Tram komt.
let cue = buildEnvironmentKnopCue(scene("a"), { plek: 0 }, options);
assert.equal(cue.actions[0].payload.filePath, "/media/environments/environment_30/omvallen/tram-komt.mov");
assert.deepEqual(knoppen(), [["omvallen", "OPNIEUW", "klaar"], ["keuze", "LINKS", "klaar"], ["keuze", "RECHTS", "klaar"]]);

// Rechts: clip en geluid van rechts; daarna kunnen links en rechts niet meer.
cue = buildEnvironmentKnopCue(scene("a"), { plek: 2 }, options);
assert.deepEqual(cue.actions.map((action) => [action.command, action.payload.filePath]), [
  ["td.effect.omvallen", "/media/environments/environment_30/omvallen/rechts.mov"],
  ["audio.extra.play", "/media/environments/environment_30/omvallen/rechts.wav"],
]);
assert.equal(cue.name, "Omvallen: Rechts");
assert.deepEqual(knoppen(), [["omvallen", "OPNIEUW", "klaar"], ["keuze", "LINKS", "uit"], ["keuze", "RECHTS", "uit"]]);
assert.throws(() => buildEnvironmentKnopCue(scene("a"), { plek: 1 }, options), /geen_knop/);

// OPNIEUW: terug naar het begin, voorgrond terug.
cue = buildEnvironmentKnopCue(scene("a"), { plek: 0 }, options);
assert.deepEqual(cue.actions.map((action) => [action.command, action.payload.uit]), [["td.effect.omvallen", true]]);
assert.deepEqual(knoppen(), [["omvallen", "TRAM KOMT", "klaar"], ["keuze", "LINKS", "uit"], ["keuze", "RECHTS", "uit"]]);

// Opnieuw de tram, nu links.
buildEnvironmentKnopCue(scene("a"), { plek: 0 }, options);
cue = buildEnvironmentKnopCue(scene("a"), { plek: 1 }, options);
assert.equal(cue.actions[0].payload.filePath, "/media/environments/environment_30/omvallen/links.mov");

// Een nieuwe scène begint weer bij het begin.
assert.deepEqual(knoppen("b"), [["omvallen", "TRAM KOMT", "klaar"], ["keuze", "LINKS", "uit"], ["keuze", "RECHTS", "uit"]]);

console.log("environment-keuze-test ok");
