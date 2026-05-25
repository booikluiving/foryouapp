"use strict";

const assert = require("node:assert/strict");

const {
  validatePromptInputShape,
  validateScriptOutputShape,
} = require("../../../shared/contracts/script-agent-v0");
const { buildPromptInput } = require("../prompt-builder/prompt-builder");
const { createScriptOutput } = require("../script-output/script-service");
const { parseScriptText } = require("../text-parser/text-parser");

const runtimeState = {
  schemaVersion: "runtime.state.v0",
  showRunId: "show-run-20260524-180000000Z",
  status: "running",
  updatedAt: "2026-05-24T18:00:00.000Z",
  showRunSnapshot: {
    schemaVersion: "runtime.show-run-snapshot.v0",
    createdAt: "2026-05-24T18:00:00.000Z",
    catalog: {
      schemaVersion: "catalog.read-model.v0",
      performers: [
        { id: "performer:1", legacyId: 1, name: "Performer A", performerSlot: 1 },
        { id: "performer:2", legacyId: 2, name: "Performer B", performerSlot: 2 },
      ],
      characters: [
        { id: "character:1", legacyId: 1, name: "Ada", performerIds: ["performer:1"] },
        { id: "character:2", legacyId: 2, name: "Ben", performerIds: ["performer:2"] },
      ],
      environments: [{ id: "environment:1", legacyId: 1, name: "Studio" }],
      situations: [
        {
          id: "situation:1",
          legacyId: 1,
          title: "Open Scene",
          promptText: "Begin rustig en laat de personages botsen.",
          characterIds: ["character:1", "character:2"],
          environmentId: "environment:1",
          labelIds: ["label:1"],
        },
      ],
      labels: [{ id: "label:1", legacyId: 1, name: "Intro" }],
      mediaAssets: [],
    },
  },
  preparedNext: { situationId: "situation:1" },
  eligiblePool: [{ situationId: "situation:1" }],
  pathEvaluation: { pathAvailable: ["situation:1"], pathLocked: [] },
  resolvedPreparedNext: {
    situationId: "situation:1",
    legacySituationId: 1,
    title: "Open Scene",
    promptText: "Begin rustig en laat de personages botsen.",
    characterIds: ["character:1", "character:2"],
    characters: [
      { id: "character:1", legacyId: 1, name: "Ada", performerIds: ["performer:1"] },
      { id: "character:2", legacyId: 2, name: "Ben", performerIds: ["performer:2"] },
    ],
    environmentId: "environment:1",
    environment: { id: "environment:1", legacyId: 1, name: "Studio" },
    labelIds: ["label:1"],
    seed: "fixture-seed",
    materializedAt: "2026-05-24T18:00:00.000Z",
  },
};

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function assertNoRuntimeOrderFields(value) {
  const text = JSON.stringify(value);
  for (const key of ["preparedNext", "resolvedPreparedNext", "eligiblePool", "pathAvailable", "pathLocked", "order"]) {
    assert(!text.includes(`"${key}"`), `${key} should not be written by Script Agent`);
  }
}

async function main() {
  const promptInput = buildPromptInput(runtimeState, new Date("2026-05-24T18:00:01.000Z"));
  assert.equal(validatePromptInputShape(promptInput).length, 0);
  assert.equal(promptInput.showRunId, runtimeState.showRunId);
  assert.equal(promptInput.situation.situationId, "situation:1");
  assert.equal(promptInput.performerSlots.length, 2);
  assert.equal(promptInput.performerSlots[0].performerName, "Performer A");
  assertNoRuntimeOrderFields(promptInput);

  const mutatedOrderState = cloneJson(runtimeState);
  mutatedOrderState.preparedNext = { situationId: "situation:999" };
  mutatedOrderState.eligiblePool = [{ situationId: "situation:999" }];
  mutatedOrderState.pathEvaluation.pathAvailable = ["situation:999"];
  const promptInputAgain = buildPromptInput(mutatedOrderState, new Date("2026-05-24T18:00:02.000Z"));
  assert.equal(promptInputAgain.contentHash, promptInput.contentHash, "prompt content should be stable from resolved output");

  const parserOutput = parseScriptText({
    promptInput,
    scriptText: "Ada: Hallo Ben\nBen: Hallo Ada\nOnbekend: dit moet falen",
    parsedAtDate: new Date("2026-05-24T18:00:03.000Z"),
  });
  assert.equal(parserOutput.verified, false);
  assert(parserOutput.issues.some((issue) => issue.code === "unknown_role"));
  assert.equal(parserOutput.lines.find((line) => line.role === "Ada").characterId, "character:1");

  const scriptOutput = createScriptOutput({
    promptInput,
    scriptText: "Ada: Hallo Ben\nBen: Hallo Ada",
    createdAtDate: new Date("2026-05-24T18:00:04.000Z"),
  });
  assert.equal(validateScriptOutputShape(scriptOutput).length, 0);
  assert.equal(scriptOutput.parserOutput.verified, true);
  assert.equal(scriptOutput.teleprompter.performerSlots.length, 2);
  assert.equal(scriptOutput.teleprompter.performerSlots[0].lines[0].text, "Hallo Ben");
  assert.deepEqual(scriptOutput.captions.segments.map((segment) => segment.speaker), ["Ada", "Ben"]);
  assertNoRuntimeOrderFields(scriptOutput);

  process.stdout.write(JSON.stringify({
    ok: true,
    showRunId: promptInput.showRunId,
    promptInputId: promptInput.promptInputId,
    contentHash: promptInput.contentHash,
    performerSlots: scriptOutput.teleprompter.performerSlots.length,
    assertions: [
      "resolvedPreparedNext yields stable prompt input",
      "parser verifies characters and flags unknown roles against snapshot",
      "teleprompter shows performer slots from runtime output",
      "Script Agent output contains no Runtime order state",
    ],
  }, null, 2));
  process.stdout.write("\n");
}

main().catch((err) => {
  process.stderr.write(`${err.stack || err.message}\n`);
  process.exit(1);
});
