"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const { Readable } = require("node:stream");

const TMP_DB_DIR = path.join(__dirname, ".tmp-kalibratie-db");
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

// Kalibreren: een nieuwe run begint met de voorbeeldscènes in de geschiedenis; ze blijven vooraan
// staan, en een scène met een voorbeeld krijgt het voorbeeld onder de opdracht.
function staatMet(situationId, title, legacyId, showRunId = runtimeState.showRunId) {
  const state = cloneJson(runtimeState);
  state.showRunId = showRunId;
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
  const verzoeken = [];
  const fetchImpl = async (_url, options = {}) => {
    verzoeken.push(JSON.parse(options.body));
    async function* stroom() {
      yield Buffer.from(`data: ${JSON.stringify({ choices: [{ delta: { content: "Ada: tekst " + verzoeken.length }, finish_reason: "stop" }], usage: { prompt_tokens: 3, completion_tokens: 3 } })}\n\n`);
      yield Buffer.from("data: [DONE]\n\n");
    }
    return { ok: true, body: Readable.from(stroom()), text: async () => "" };
  };
  const service = createOperatorService({
    clients: {
      fetchCurrentRuntimeState: async () => ({ ok: true, state: cloneJson(huidig) }),
      fetchCatalogSnapshot: async () => ({ ok: true, catalog: cloneJson(huidig.showRunSnapshot.catalog) }),
    },
    env: {},
    fetchImpl,
    log: () => {},
  });
  await service.saveSecrets({ deepSeekApiKey: "sk-test" });
  await service.saveSettings({ model: "deepseek-chat", reasoningEffort: "off", promptTemplate: "Scene {situationTitle}. Schrijf 16 tot 20 regels.\n{runtimePrompt}" });

  // Zetten: per situatie wint de nieuwste, een oudere kopie zet niets terug.
  await service.zetVoorbeelden([
    { situationId: "situation:1", titel: "Open Scene", vraag: "OPDRACHT EEN", tekst: "VOORBEELD EEN", at: "2026-11-19T10:00:00Z" },
    { situationId: "situation:2", titel: "Tweede", vraag: "OPDRACHT TWEE", tekst: "VOORBEELD TWEE", at: "2026-11-19T10:00:00Z" },
  ]);
  const oud = await service.zetVoorbeelden({ situationId: "situation:1", tekst: "OUDER", at: "2026-11-18T10:00:00Z" });
  assert.equal(oud.veranderd, 0, "an older copy changes nothing");
  assert.equal((await service.voorbeeldStand()).voorbeelden.length, 2);

  // Eerste scène van de run: situatie 1 heeft een voorbeeld.
  await service.sceneToChat({ sourceId: "unit" });
  let laatste = verzoeken.at(-1).messages;
  const inhoud = laatste.map((m) => m.content);
  assert.ok(inhoud.includes("OPDRACHT EEN") && inhoud.includes("VOORBEELD EEN"), "example 1 is in the history");
  assert.ok(inhoud.includes("OPDRACHT TWEE") && inhoud.includes("VOORBEELD TWEE"), "example 2 is in the history");
  const opdracht = laatste.at(-1).content;
  assert.ok(opdracht.includes("--- VOORBEELD ---") && opdracht.includes("VOORBEELD EEN"), "the scene gets its own example");
  assert.ok(opdracht.includes("16 tot 20 regels"), "with examples the first scene is not shortened");
  const gesprek = service.sessionInfo(runtimeState.showRunId).messages;
  assert.equal(gesprek.length, 2, "the examples are not in the visible conversation");
  assert.ok(!gesprek[0].content.includes("--- VOORBEELD ---"), "the conversation keeps the plain prompt");

  // Een scène zonder voorbeeld: geen voorbeeldblok, wel de voorbeelden vooraan.
  for (let i = 3; i <= 8; i += 1) {
    huidig = staatMet(`situation:${i}`, `Scene ${i}`, i);
    await service.sceneToChat({ sourceId: "unit" });
  }
  laatste = verzoeken.at(-1).messages;
  assert.ok(!laatste.at(-1).content.includes("--- VOORBEELD ---"), "no example for a scene without one");
  assert.equal(laatste[2].content, "VOORBEELD EEN", "the examples stay at the front after many scenes");
  assert.equal(laatste.length, 1 + 4 + 8 + 1, "system + examples + last 4 scenes + prompt");

  // Nieuwe run: begint opnieuw met de voorbeelden, eerste scène niet ingekort.
  huidig = staatMet("situation:9", "Negen", 9, "show-run-20260525-180000000Z");
  await service.sceneToChat({ sourceId: "unit" });
  laatste = verzoeken.at(-1).messages;
  assert.equal(laatste.length, 1 + 4 + 1, "a new run starts with only the examples");

  // Uit: geen voorbeelden, eerste scène ingekort zoals voorheen.
  await service.saveSettings({ kalibreren: false });
  huidig = staatMet("situation:1", "Open Scene", 1, "show-run-20260526-180000000Z");
  await service.sceneToChat({ sourceId: "unit" });
  laatste = verzoeken.at(-1).messages;
  assert.equal(laatste.length, 2, "without calibration only system + prompt");
  assert.ok(!laatste.at(-1).content.includes("--- VOORBEELD ---"));
  assert.ok(laatste.at(-1).content.includes("11 tot 14 regels"), "without calibration the first scene is shortened");

  // Weghalen: lege tekst.
  await service.saveSettings({ kalibreren: true });
  await service.zetVoorbeelden({ situationId: "situation:2", tekst: "", at: "2026-11-19T11:00:00Z" });
  assert.deepEqual((await service.voorbeeldStand()).voorbeelden.map((v) => v.situationId), ["situation:1"]);

  // De website-test (geen show-run) kalibreert niet.
  await service.streamChat({ sessionId: "test_pol", message: "Scene X", promptInput: (await service.createDraftFromRuntime(staatMet("situation:1", "Open Scene", 1), { force: true })).promptInput });
  laatste = verzoeken.at(-1).messages;
  assert.equal(laatste.length, 2, "a website test session has no examples");

  process.stdout.write(JSON.stringify({ ok: true, aanroepen: verzoeken.length }) + "\n");
  await fs.rm(TMP_DB_DIR, { recursive: true, force: true });
}

main().catch(async (err) => {
  await fs.rm(TMP_DB_DIR, { recursive: true, force: true });
  process.stderr.write(`${err.stack || err.message}\n`);
  process.exit(1);
});
