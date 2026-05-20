"use strict";

const assert = require("node:assert/strict");

const { parseTelepromptText } = require("../src/domain/parse-teleprompt");
const { createTelepromptStore } = require("../src/runtime/teleprompt-store");

function lineTexts(result) {
  return result.lines.map((line) => line.text);
}

{
  const result = parseTelepromptText({
    rawText: [
      "# De Lift",
      "Megan: Hallo. Hoe gaat het?",
      "[Ze stapt naar voren.]",
      "Brent: Goed!",
    ].join("\n"),
    source: "test",
  });
  assert.equal(result.title, "De Lift");
  assert.equal(result.characters.length, 2);
  assert.deepEqual(lineTexts(result), ["Hallo.", "Hoe gaat het?", "Ze stapt naar voren.", "Goed!"]);
  assert.deepEqual(result.lines.map((line) => line.type), ["dialogue", "dialogue", "stage_direction", "dialogue"]);
}

{
  const result = parseTelepromptText({
    title: "Eigen titel",
    rawText: [
      "Personage 1: Een.",
      "Personage 2: Twee?",
      "Personage 3: Drie!",
    ].join("\n"),
  });
  assert.equal(result.title, "Eigen titel");
  assert.equal(result.characters.length, 3);
  assert.deepEqual(result.characters.map((character) => character.id), ["character_1", "character_2", "character_3"]);
}

{
  const result = parseTelepromptText({
    rawText: [
      "Regie: Stilte in de zaal.",
      "Een losse regieaanwijzing zonder label.",
      "Solo: Dit is een lange zin. Dit wordt een tweede kaart.",
    ].join("\n"),
  });
  assert.equal(result.characters.length, 1);
  assert.deepEqual(result.lines.map((line) => line.type), [
    "stage_direction",
    "stage_direction",
    "dialogue",
    "dialogue",
  ]);
  assert.deepEqual(lineTexts(result), [
    "Stilte in de zaal.",
    "Een losse regieaanwijzing zonder label.",
    "Dit is een lange zin.",
    "Dit wordt een tweede kaart.",
  ]);
}

{
  const store = createTelepromptStore();
  assert.equal(store.current().version, 0);
  const first = store.ingest({ rawText: "A: Eerste.", source: "manual" });
  const second = store.ingest({ rawText: "B: Tweede.", source: "operator_chat" });
  assert.equal(first.version, 1);
  assert.equal(second.version, 2);
  assert.equal(store.current().source.kind, "operator_chat");
}

console.log("teleprompter parser smoke tests passed");

