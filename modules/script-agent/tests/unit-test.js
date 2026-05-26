"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const { Readable } = require("node:stream");

const TMP_DB_DIR = path.join(__dirname, ".tmp-unit-db");
process.env.V2_SCRIPT_AGENT_DB_DIR = TMP_DB_DIR;

const {
  validatePromptInputShape,
  validateScriptOutputShape,
} = require("../../../shared/contracts/script-agent-v0");
const { createOperatorService } = require("../operator/operator-service");
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

function fakeDeepSeekFetch(expectedApiKey) {
  return async (url, options = {}) => {
    assert.equal(url, "https://api.deepseek.com/chat/completions");
    assert.equal(options.method, "POST");
    assert.equal(options.headers.authorization, `Bearer ${expectedApiKey}`);
    const body = JSON.parse(options.body);
    assert.equal(body.model, "deepseek-chat");
    assert.equal(body.stream, true);
    assert.equal(body.messages[0].role, "system");
    assert.equal(body.messages.at(-1).role, "user");
    const chunks = [
      `data: ${JSON.stringify({ choices: [{ delta: { content: "Ada: Live regel\\n" } }] })}\n\n`,
      `data: ${JSON.stringify({
        choices: [{ delta: { content: "Ben: Tegenregel" } }],
        usage: { prompt_tokens: 30, completion_tokens: 12, prompt_cache_hit_tokens: 4 },
      })}\n\n`,
      "data: [DONE]\n\n",
    ];
    return {
      ok: true,
      body: Readable.from(chunks.map((chunk) => Buffer.from(chunk))),
      text: async () => "",
    };
  };
}

async function main() {
  await fs.rm(TMP_DB_DIR, { recursive: true, force: true });

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

  const operatorService = createOperatorService({
    clients: {
      fetchCurrentRuntimeState: async () => ({ ok: true, state: cloneJson(runtimeState) }),
    },
    env: {},
    fetchImpl: fakeDeepSeekFetch("sk-test-deepseek"),
  });
  assert.equal((await operatorService.secretsStatus()).deepseek.configured, false);
  await operatorService.saveSecrets({ deepSeekApiKey: "sk-test-deepseek" });
  const secretsStatus = await operatorService.secretsStatus();
  assert.equal(secretsStatus.deepseek.configured, true);
  assert.equal(secretsStatus.deepseek.source, "local");
  assert(!JSON.stringify(secretsStatus).includes("sk-test-deepseek"));

  const settings = await operatorService.saveSettings({
    model: "deepseek-chat",
    maxTokens: 512,
    temperature: 0.4,
  });
  assert.equal(settings.provider, "deepseek");
  assert.equal(settings.model, "deepseek-chat");

  const operatorDraft = await operatorService.createDraftFromRuntime(null, { force: true });
  assert.equal(operatorDraft.showRunId, runtimeState.showRunId);
  assert.equal(operatorDraft.situationId, "situation:1");
  assert(operatorDraft.text.includes("Open Scene"));
  assert(operatorDraft.text.includes("Ada"));
  assert(operatorDraft.text.includes("Studio"));
  assertNoRuntimeOrderFields(operatorDraft);

  const streamEvents = [];
  const generated = await operatorService.streamChat({
    sessionId: runtimeState.showRunId,
    message: operatorDraft.text,
    promptInput: operatorDraft.promptInput,
  }, (event) => streamEvents.push(event));
  assert.equal(generated.provider, "deepseek");
  assert.equal(generated.scriptOutput.parserOutput.verified, true);
  assert.equal(generated.scriptOutput.teleprompter.performerSlots.length, 2);
  assert(streamEvents.some((event) => event.type === "delta"));
  assert(streamEvents.some((event) => event.type === "done"));
  assertNoRuntimeOrderFields(generated.scriptOutput);
  const operatorStatus = await operatorService.status();
  assert(!JSON.stringify(operatorStatus).includes("sk-test-deepseek"));

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
      "Operator migrates preparedNext to editable DeepSeek prompt draft",
      "Operator secrets are managed in UI API without plaintext status leaks",
      "DeepSeek stream is converted to Script Agent output and teleprompter data",
    ],
  }, null, 2));
  process.stdout.write("\n");

  await fs.rm(TMP_DB_DIR, { recursive: true, force: true });
}

main().catch((err) => {
  process.stderr.write(`${err.stack || err.message}\n`);
  process.exit(1);
});
