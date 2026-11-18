"use strict";

// Bord (blind ranking): de knop BORD AAN. Geen netwerk, geen catalogus.

const assert = require("node:assert/strict");
const { buildEnvironmentKnopCue, environmentKnoppenStatus } = require("../cue-library/environment-knoppen");
const { resetBordState } = require("../cue-library/environment-bord");
const { sceneEindeActions } = require("../cue-library/scene-einde");
const { requestForTeleprompterAction } = require("../target-adapters/teleprompter-adapter");

const options = {
  environmentFases: {
    catalog: {
      environments: [],
      mediaAssets: [],
      environmentCompositions: [],
      situations: [
        { id: "situation:90", blindRanking: { aan: true, plaatjes: [{ naam: "Churchill", assetId: "" }] } },
        { id: "situation:91", blindRanking: { aan: false, plaatjes: [] } },
      ],
    },
    catalogMediaRoot: "/media",
    fileExists: () => true,
  },
  environmentOmvallen: { manifest: null, catalogMediaRoot: "/bestaat-niet" },
};
const omgeving = { situationId: "situation:90", environmentId: "environment:31", environment: { id: "environment:31", name: "Adelaarsnest" } };
const speelt = { showRunId: "run", activeSituation: { situationRunId: "sit-1", resolved: omgeving } };
const klaar = { showRunId: "run", activeSituation: null, resolvedPreparedNext: omgeving };
const rij = (state) => environmentKnoppenStatus(state, options).knoppen.map((knop) => [knop.soort, knop.label, knop.teller, knop.staat]);

resetBordState();

// Klaargezet: de knop staat er, maar doet nog niets.
assert.deepEqual(rij(klaar), [["bord", "BORD AAN", "", "uit"], ["begin", "BEGIN", "", "uit"]]);
assert.throws(() => buildEnvironmentKnopCue(klaar, { plek: 0 }, options), /geen_knop/);

// De scène speelt: één druk zet het bord aan; daarna is de knop donker.
assert.deepEqual(rij(speelt), [["bord", "BORD AAN", "", "klaar"], ["begin", "BEGIN", "", "uit"]]);
let cue = buildEnvironmentKnopCue(speelt, { plek: 0 }, options);
assert.deepEqual(cue.actions.map((action) => [action.targetId, action.command, action.payload.actie]), [["teleprompter", "teleprompter.bord", "aan"]]);
assert.deepEqual(requestForTeleprompterAction(cue.actions[0]), {
  method: "POST",
  path: "/v0/script-agent/teleprompter-parser/bord",
  body: { actie: "aan", source: "streamdeck" },
});
assert.deepEqual(rij(speelt), [["bord", "BORD AAN", "", "uit"], ["begin", "BEGIN", "", "klaar"]]);
assert.throws(() => buildEnvironmentKnopCue(speelt, { plek: 0 }, options), /geen_knop/);

// BEGIN: het bord weer weg.
cue = buildEnvironmentKnopCue(speelt, { plek: 1 }, options);
assert.deepEqual(cue.actions.map((action) => [action.command, action.payload.actie]), [["teleprompter.bord", "begin"]]);
assert.deepEqual(rij(speelt)[0], ["bord", "BORD AAN", "", "klaar"]);

// Einde van de scène: het bord gaat mee uit.
buildEnvironmentKnopCue(speelt, { plek: 0 }, options);
const einde = sceneEindeActions({ now: 1 });
const bordUit = einde.filter((action) => action.command === "teleprompter.bord");
assert.deepEqual(bordUit.map((action) => action.payload.actie), ["begin"]);
assert.deepEqual(rij(speelt)[0], ["bord", "BORD AAN", "", "klaar"]);

// Een situatie zonder de schakelaar heeft de knop niet, ook niet in dezelfde omgeving of met "blind ranking" in de naam.
const ander = { activeSituation: { situationRunId: "sit-2", resolved: { situationId: "situation:91", environmentId: "environment:31", environment: { name: "Blind ranking" } } } };
assert.deepEqual(rij(ander), []);
const zonder = { activeSituation: { situationRunId: "sit-3", resolved: { environmentId: "environment:5", environment: { name: "Logeerkamer" } } } };
assert.deepEqual(rij(zonder), []);

console.log("environment-bord-test ok");
