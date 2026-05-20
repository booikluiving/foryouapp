"use strict";

const assert = require("assert");
const { parseTeleprompt } = require("../src/domain/parse-teleprompt");
const { createTelepromptStore } = require("../src/runtime/teleprompt-store");

function parse(rawText, title = "") {
  return parseTeleprompt({ title, rawText, source: "test" });
}

{
  const result = parse("Emma: Hallo daar. Hoe gaat het?\nLotte: Goed!");
  assert.strictEqual(result.title, "Teleprompt");
  assert.strictEqual(result.characters.length, 2);
  assert.strictEqual(result.lines.length, 3);
  assert.strictEqual(result.lines[0].speakerLabel, "Emma");
  assert.strictEqual(result.lines[1].text, "Hoe gaat het?");
}

{
  const result = parse("# volwassen niet zo happymeal\nEmma: Mijn moeder zegt dat Mac Donalds niet gezond is, maar ik vind de nuggetjes zooo lekker!");
  assert.strictEqual(result.title, "volwassen niet zo happymeal");
  assert.strictEqual(result.lines.length, 1);
  assert.strictEqual(result.lines[0].type, "dialogue");
}

{
  const result = parse("*Emma kijkt naar Lotte.*\nRegie: Ze wachten even.\nLosse regel");
  assert.strictEqual(result.lines.length, 3);
  assert.deepStrictEqual(result.lines.map((line) => line.type), ["stage_direction", "stage_direction", "stage_direction"]);
  assert.strictEqual(result.lines[0].text, "Emma kijkt naar Lotte.");
}

{
  const result = parse("A: een.\nB: twee.\nC: drie.");
  assert.strictEqual(result.characters.length, 3);
  assert.strictEqual(result.characters[2].id, "character_3");
}

{
  const store = createTelepromptStore();
  store.ingest({
    rawText: "Emma: Eerste zin.\n*Ze zwaait.*\nLotte: Tweede zin.",
    source: "test",
  });
  assert.strictEqual(store.getCue().index, 0);
  assert.strictEqual(store.getCue().deckLength, 5);
  assert.strictEqual(store.setCueIndex(99).cue.index, 4);
  assert.strictEqual(store.setCueIndex(-10).cue.index, 0);
  store.ingest({
    rawText: "Solo: Nieuwe zin.",
    source: "test",
  });
  assert.strictEqual(store.getCue().index, 0);
  assert.strictEqual(store.getCue().deckLength, 3);
}

console.log("teleprompter parser smoke tests passed");
