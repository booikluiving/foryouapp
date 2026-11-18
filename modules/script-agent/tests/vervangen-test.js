"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const { Readable } = require("node:stream");

const TMP_DB_DIR = path.join(__dirname, ".tmp-vervangen-db");
process.env.SCRIPT_AGENT_DB_DIR = TMP_DB_DIR;

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

// Een lopende tekst die vervangen wordt (knop OVERSLAAN) stopt en komt nergens meer aan.
function staatMet(situationId, title, legacyId) {
  const state = cloneJson(runtimeState);
  const situatie = { ...state.showRunSnapshot.catalog.situations[0], id: situationId, legacyId, title };
  state.showRunSnapshot.catalog.situations.push(situatie);
  state.preparedNext = { situationId };
  state.eligiblePool = [{ situationId }];
  state.resolvedPreparedNext = { ...state.resolvedPreparedNext, situationId, legacySituationId: legacyId, title };
  return state;
}

async function main() {
  await fs.rm(TMP_DB_DIR, { recursive: true, force: true });
  let huidig = staatMet("situation:1", "Open Scene", 1);
  let losLaten = null;
  let aanroep = 0;
  const fetchImpl = async (_url, options = {}) => {
    aanroep += 1;
    const body = JSON.parse(options.body);
    const traag = aanroep === 1;
    const regel = body.messages.at(-1).content.includes("Tweede") ? "Ada: nieuwe tekst" : "Ada: oude tekst";
    async function* stroom() {
      yield Buffer.from(`data: ${JSON.stringify({ choices: [{ delta: { content: regel.slice(0, 5) } }] })}\n\n`);
      if (traag) await new Promise((resolve) => { losLaten = resolve; });
      yield Buffer.from(`data: ${JSON.stringify({ choices: [{ delta: { content: regel.slice(5) }, finish_reason: "stop" }], usage: { prompt_tokens: 3, completion_tokens: 3 } })}\n\n`);
      yield Buffer.from("data: [DONE]\n\n");
    }
    return { ok: true, body: Readable.from(stroom()), text: async () => "" };
  };
  const uitvoer = [];
  const service = createOperatorService({
    clients: {
      fetchCurrentRuntimeState: async () => ({ ok: true, state: cloneJson(huidig) }),
      fetchCatalogSnapshot: async () => ({ ok: true, catalog: cloneJson(huidig.showRunSnapshot.catalog) }),
    },
    env: {},
    fetchImpl,
    log: () => {},
    onScriptOutput: async ({ scriptOutput }) => uitvoer.push(scriptOutput),
  });
  await service.saveSecrets({ deepSeekApiKey: "sk-test" });
  await service.saveSettings({ model: "deepseek-chat", reasoningEffort: "off" });

  const stage = [];
  service.emitter.on("stage", (event) => stage.push(event));
  const oud = service.sceneToChat({ sourceId: "unit" });
  while (!losLaten) await new Promise((resolve) => setTimeout(resolve, 5));
  huidig = staatMet("situation:2", "Tweede", 2);
  const nieuw = await service.sceneToChat({ sourceId: "unit-overslaan", overslaan: true, overgeslagenSituationId: "situation:1" });
  losLaten();
  const oudKlaar = await oud;
  assert.equal(oudKlaar.done.type, "replaced", "the old text is replaced");
  assert.equal(nieuw.done.type, "done");
  assert.ok(nieuw.done.text.includes("nieuwe tekst"));
  assert.equal(uitvoer.length, 1, "only the new script reaches the teleprompter");
  assert.equal(uitvoer[0].situationId, "situation:2");
  assert.ok(!stage.some((event) => event.type === "operator_stage_delta" && String(event.fullText).includes("oude tekst")), "nothing of the old text is shown after the replacement");
  assert.ok(!stage.some((event) => event.type === "operator_stage_error"), "no error on the stage");
  assert.equal(service.snapshotStage().streaming, false);

  // Al afgemaakte tekst van een overgeslagen scène gaat uit de geschiedenis van het model.
  huidig = staatMet("situation:3", "Derde", 3);
  const info = service.sessionInfo(runtimeState.showRunId);
  const voor = info.turnCount;
  await service.sceneToChat({ sourceId: "unit-overslaan", overslaan: true, overgeslagenSituationId: "situation:2" });
  assert.equal(service.sessionInfo(runtimeState.showRunId).turnCount, voor, "the skipped scene's turn is replaced, not added");
  process.stdout.write(JSON.stringify({ ok: true, aanroepen: aanroep }) + "\n");
  await fs.rm(TMP_DB_DIR, { recursive: true, force: true });
}

main().catch(async (err) => {
  await fs.rm(TMP_DB_DIR, { recursive: true, force: true });
  process.stderr.write(`${err.stack || err.message}\n`);
  process.exit(1);
});
