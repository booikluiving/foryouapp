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
const { fetchCatalogSnapshot } = require("../client/catalog-client");
const { buildPromptInput } = require("../prompt-builder/prompt-builder");
const { createScriptOutput } = require("../script-output/script-service");
const { parseTeleprompt } = require("../teleprompter-parser/src/domain/parse-teleprompt");
const { createTelepromptStore } = require("../teleprompter-parser/src/runtime/teleprompt-store");
const { createTeleprompterParserBridge } = require("../teleprompter-parser/src/integration/script-agent-bridge");
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

  const compactRuntimeOutput = {
    schemaVersion: "runtime.resolved-output.v0",
    showRunId: runtimeState.showRunId,
    status: runtimeState.status,
    updatedAt: runtimeState.updatedAt,
    showRunSnapshotCreatedAt: runtimeState.showRunSnapshot.createdAt,
    resolvedPreparedNext: {
      ...cloneJson(runtimeState.resolvedPreparedNext),
      performerSlots: promptInput.performerSlots,
    },
  };
  const promptInputFromCompact = buildPromptInput(compactRuntimeOutput, new Date("2026-05-24T18:00:01.500Z"));
  assert.equal(promptInputFromCompact.contentHash, promptInput.contentHash, "compact runtimeOutput should build the same prompt");
  assert.equal(promptInputFromCompact.performerSlots[0].performerName, "Performer A");

  const mutatedOrderState = cloneJson(runtimeState);
  mutatedOrderState.preparedNext = { situationId: "situation:999" };
  mutatedOrderState.eligiblePool = [{ situationId: "situation:999" }];
  mutatedOrderState.pathEvaluation.pathAvailable = ["situation:999"];
  const promptInputAgain = buildPromptInput(mutatedOrderState, new Date("2026-05-24T18:00:02.000Z"));
  assert.equal(promptInputAgain.contentHash, promptInput.contentHash, "prompt content should be stable from resolved output");

  const flexibleCastState = cloneJson(runtimeState);
  flexibleCastState.showRunSnapshot.catalog.performers = [
    { id: "performer:1", legacyId: 1, name: "Performer A", performerSlot: 1 },
    { id: "performer:2", legacyId: 2, name: "Performer B", performerSlot: 2 },
    { id: "performer:3", legacyId: 3, name: "Performer C", performerSlot: 3 },
  ];
  flexibleCastState.resolvedPreparedNext.characters = [
    { id: "character:flex", legacyId: 10, name: "Zwangere vrouw", performerIds: [] },
    { id: "character:bobby", legacyId: 11, name: "Bobby", performerIds: ["performer:1"] },
    { id: "character:adolf", legacyId: 12, name: "Adolf", performerIds: ["performer:2"] },
  ];
  delete flexibleCastState.resolvedPreparedNext.performerSlots;
  const flexiblePromptInput = buildPromptInput(flexibleCastState, new Date("2026-05-24T18:00:02.500Z"));
  assert.deepEqual(
    flexiblePromptInput.performerSlots.map((slot) => [slot.slotIndex, slot.performerId, slot.characterId]),
    [
      [1, "performer:1", "character:bobby"],
      [1, null, "character:flex"],
      [2, "performer:2", "character:adolf"],
    ],
    "Script Agent fallback should reflect catalog performer choices without redistributing roles"
  );

  const previousCatalogUrl = process.env.V2_SCRIPT_AGENT_CATALOG_URL;
  process.env.V2_SCRIPT_AGENT_CATALOG_URL = "http://127.0.0.1:1";
  const fallbackCatalog = await fetchCatalogSnapshot();
  if (previousCatalogUrl == null) {
    delete process.env.V2_SCRIPT_AGENT_CATALOG_URL;
  } else {
    process.env.V2_SCRIPT_AGENT_CATALOG_URL = previousCatalogUrl;
  }
  assert.equal(fallbackCatalog.ok, true);
  assert.equal(fallbackCatalog.source, "local-catalog-read-model");
  assert((fallbackCatalog.catalog.situations || []).length > 0, "local catalog fallback should expose situations");

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

  const legacyParsed = parseTeleprompt({
    rawText: "Mark moet winnen\nAda: Hallo Ben. Tweede zin.\nRegie: Ze wachten.",
    source: "unit",
  });
  assert.equal(legacyParsed.title, "Mark moet winnen");
  assert.equal(legacyParsed.lines.length, 3);
  assert.deepEqual(legacyParsed.lines.map((line) => line.type), ["dialogue", "dialogue", "stage_direction"]);
  assert.equal(legacyParsed.characters[0].color, "#4cc9f0");

  const legacyStore = createTelepromptStore();
  legacyStore.prepareScene({
    sceneId: 1,
    title: "Open Scene",
    environment: { id: 1, name: "Studio", imageUrl: "http://127.0.0.1:3021/v0/catalog/media-assets/file/bg" },
    characters: [{ id: 1, name: "Ada", slot: 1 }, { id: 2, name: "Ben", slot: 2 }],
  });
  legacyStore.ingest({ sceneId: 1, rawText: "Ada: Eerste.\nBen: Tweede.", source: "unit" });
  assert.equal(legacyStore.getCue().deckLength, 4);
  assert.equal(legacyStore.getPreparedScene().status, "prepared");
  legacyStore.revealPreparedScene();
  assert.equal(legacyStore.getPreparedScene().status, "playing");
  assert.equal(legacyStore.setCaptionStyle({ fontSizeScale: 9, verticalPosition: 10 }).captionStyle.fontSizeScale, 1.25);

  const bridge = createTeleprompterParserBridge({
    env: { V2_SCRIPT_AGENT_CATALOG_URL: "http://catalog.test" },
  });
  const preparedFromPrompt = bridge.preparedSceneFromPromptInput(promptInput);
  assert.equal(preparedFromPrompt.sceneId, 1);
  assert.deepEqual(preparedFromPrompt.characters.map((character) => [character.name, character.slot]), [["Ada", 1], ["Ben", 2]]);
  assert.equal(preparedFromPrompt.characters[0].performerName, "Performer A");
  const preparedFromPayload = bridge.preparedSceneFromPayload({
    situation: { situationId: "situation:1", legacySituationId: 1, title: "Open Scene" },
    environment: { id: "environment:1", legacyId: 1, name: "Studio" },
    backgroundAsset: { url: "/v0/catalog/media-assets/file/bg" },
    performerSlots: [{ characterId: "character:1", legacyCharacterId: 1, characterName: "Ada", slotIndex: 1, performerName: "Performer A" }],
  });
  assert.equal(preparedFromPayload.environment.imageUrl, "http://catalog.test/v0/catalog/media-assets/file/bg");
  assert.equal(preparedFromPayload.characters[0].slot, 1);
  assert.equal(preparedFromPayload.characters[0].performerName, "Performer A");

  const operatorService = createOperatorService({
    clients: {
      fetchCurrentRuntimeState: async () => ({ ok: true, state: cloneJson(runtimeState) }),
      fetchCatalogSnapshot: async () => ({ ok: true, catalog: cloneJson(runtimeState.showRunSnapshot.catalog) }),
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
  assert.equal(operatorService.snapshotStage().draftInfo.situationId, "situation:1");
  assert.deepEqual(operatorService.snapshotStage().draftInfo.characterIds, ["character:1", "character:2"]);
  assert.equal(operatorService.snapshotStage().draftInfo.environmentId, "environment:1");
  assert.equal(operatorService.snapshotStage().draft, "");
  assertNoRuntimeOrderFields(operatorDraft);

  const compactOperatorDraft = await operatorService.createDraftFromRuntime(compactRuntimeOutput, { force: true });
  assert.equal(compactOperatorDraft.situationId, "situation:1");
  assert.equal(compactOperatorDraft.promptInput.contentHash, promptInput.contentHash);

  const savedStyle = await operatorService.saveStageStyle({ font: "ibm", cursor: "not-real", fontSize: 99 });
  assert.deepEqual(savedStyle, { font: "ibm", cursor: "block", fontSize: 42 });
  const stageEvents = [];
  operatorService.emitter.on("stage", (event) => stageEvents.push(event));
  operatorService.updateStageDraft("live typing", { sourceId: "unit-source", revision: 99 });
  assert(stageEvents.some((event) => event.type === "operator_stage_draft" && event.sourceId === "unit-source" && event.revision === 99));

  const index = await operatorService.catalogIndex();
  assert.equal(index.situaties.length, 1);
  assert.equal(index.personages.length, 2);
  const manual = await operatorService.createManualDraft({
    sessionId: "manual_session",
    situationId: "situation:1",
    characterIds: ["character:2"],
    environmentId: "environment:1",
    extra: "Maak het compacter.",
    sourceId: "unit-manual",
  });
  assert.equal(validatePromptInputShape(manual.promptInput).length, 0);
  assert.equal(manual.promptInput.source.type, "manual-catalog-selection");
  assert.equal(manual.promptInput.situation.situationId, "situation:1");
  assert.deepEqual(manual.promptInput.characters.map((item) => item.characterId), ["character:2"]);
  assert.deepEqual(operatorService.snapshotStage().draftInfo.characterIds, ["character:2"]);
  assert.equal(operatorService.snapshotStage().draft, "");
  assert(manual.draft.text.includes("Maak het compacter."));
  assertNoRuntimeOrderFields(manual.promptInput);

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

  const sceneChatEvents = [];
  const sceneChat = await operatorService.sceneToChat({ sourceId: "unit-scene-chat" }, (event) => sceneChatEvents.push(event));
  assert.equal(sceneChat.sessionId, runtimeState.showRunId);
  assert.equal(sceneChat.draft.source.type, "runtime-prepared-next");
  assert.equal(sceneChat.done.provider, "deepseek");
  assert(sceneChatEvents.some((event) => event.type === "done"));
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
      "Catalog client falls back to local V2 read model when the service URL is unavailable",
      "parser verifies characters and flags unknown roles against snapshot",
      "teleprompter shows performer slots from runtime output",
      "Script Agent output contains no Runtime order state",
      "Operator migrates preparedNext to editable DeepSeek prompt draft",
      "Operator builds manual catalog drafts with stage source tracking",
      "Operator stage style normalizes legacy terminal settings",
      "Operator secrets are managed in UI API without plaintext status leaks",
      "DeepSeek stream is converted to Script Agent output and teleprompter data",
      "Scene naar chat uses the Runtime prepared draft and DeepSeek stream",
      "Legacy teleprompter parser/store behavior is preserved under Script Agent",
      "Teleprompter bridge maps Script Agent prompt input to legacy prepared scene payloads",
    ],
  }, null, 2));
  process.stdout.write("\n");

  await fs.rm(TMP_DB_DIR, { recursive: true, force: true });
}

main().catch((err) => {
  process.stderr.write(`${err.stack || err.message}\n`);
  process.exit(1);
});
