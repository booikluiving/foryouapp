"use strict";

// Scène in The Voice of Holland: het script begint met de regieregel *intro*; andere omgevingen niet.

const assert = require("node:assert");
const { createScriptOutput } = require("../script-output/script-service");
const { parseTeleprompt } = require("../teleprompter-parser/src/domain/parse-teleprompt");
const { metIntroRegel } = require("../../../shared/intro/intro");

function promptInput(naam) {
  return {
    promptInputId: "prompt-input:test",
    showRunId: "show-run:test",
    situation: { situationId: "situation:80", title: "Test", promptText: "" },
    environment: { id: "environment:28", name: naam },
    characters: [{ characterId: "character:1", name: "Hannah", slot: 1 }, { characterId: "character:2", name: "Boa", slot: 2 }],
  };
}

const tekst = "Hannah: Ik draai om.\nBoa: Dank je wel.";

const voice = createScriptOutput({ promptInput: promptInput("The Voice of Holland"), scriptText: tekst });
assert.strictEqual(voice.scriptText.split("\n")[0], "*intro*");
const regels = parseTeleprompt({ rawText: voice.scriptText, title: "Test" }).lines;
assert.strictEqual(regels[0].type, "stage_direction", "de eerste regel is een regieregel");
assert.strictEqual(regels[1].type, "dialogue");
assert.strictEqual(regels.length, 3);

// Staat hij er al (bewaard script opnieuw gebruikt), dan komt hij er niet nog eens bij.
assert.strictEqual(metIntroRegel(promptInput("The Voice of Holland"), voice.scriptText), voice.scriptText);

const ander = createScriptOutput({ promptInput: promptInput("Podcaststudio"), scriptText: tekst });
assert.strictEqual(ander.scriptText, tekst);

console.log("intro-regel-test ok");
