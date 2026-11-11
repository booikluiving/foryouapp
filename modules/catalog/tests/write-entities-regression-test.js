"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs/promises");
const path = require("node:path");

const {
  readCatalogStore,
  upsertCharacter,
  upsertEnvironment,
  upsertPerformer,
  upsertSituation,
  writeCatalogStore,
} = require("../write-model/catalog-store");
const { buildCatalogReadModel } = require("../read-model/build-read-model");
const { toEditorCatalog } = require("../../paths/client/catalog-client");

const RUN_ID = `catalog-write-entities-${Date.now()}-${crypto.randomBytes(4).toString("hex")}`;
const TEST_ROOT = path.join(__dirname, "tmp", RUN_ID);
const OPTIONS = {
  dbPath: path.join(TEST_ROOT, "db", "catalog.sqlite"),
  mediaRoot: path.join(TEST_ROOT, "media"),
};
const AT = "2026-05-21T14:40:05.992Z";

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function legacyRecord(fields) {
  return {
    externalId: null,
    active: true,
    archivedAt: null,
    status: "active",
    createdAt: AT,
    updatedAt: AT,
    source: { type: "legacy-import" },
    ...fields,
  };
}

function slot(slotIndex, mode, characterNumber = null) {
  return {
    slotIndex,
    mode,
    characterId: characterNumber ? `character:${characterNumber}` : null,
    legacyCharacterId: characterNumber,
  };
}

function legacySituation(number, fields) {
  const characterIds = fields.characterSlots
    .filter((item) => item.mode === "fixed-character")
    .map((item) => item.characterId);
  return legacyRecord({
    id: `situation:${number}`,
    legacyId: number,
    legacyTable: "algorithm_scenes",
    description: `Omschrijving ${number}`,
    promptText: `Omschrijving ${number}`,
    characterCount: 3,
    characterIds,
    legacyCharacterIds: characterIds.map((id) => Number(id.split(":")[1])),
    environmentMode: "selected",
    environmentId: "environment:15",
    legacyEnvironmentId: 15,
    labelIds: ["label:2", "label:3"],
    legacyLabelIds: [2, 3],
    legacySituationIds: [],
    contextSituationId: null,
    legacyContextSceneId: null,
    ...fields,
  });
}

function seedStore() {
  return {
    schemaVersion: "catalog.write-store.v0",
    createdAt: AT,
    updatedAt: AT,
    nextCounters: { performer: 1, character: 1, environment: 1, situation: 1 },
    performers: [
      legacyRecord({ id: "performer:1", legacyId: 1, name: "Megan", performerSlot: 2, sortOrder: 10 }),
      legacyRecord({ id: "performer:2", legacyId: 2, name: "Brent", performerSlot: 3, sortOrder: 20 }),
    ],
    characters: [15, 29, 30, 31].map((number) => legacyRecord({
      id: `character:${number}`,
      legacyId: number,
      name: `Personage ${number}`,
      description: `Wie ${number} is`,
      promptText: number === 31 ? "Eigen prompt die afwijkt" : `Wie ${number} is`,
      performerIds: ["performer:1"],
      legacyPerformerId: 1,
      labelScores: number === 15 ? { "label:2": 3 } : {},
    })),
    environments: [7, 15].map((number) => legacyRecord({
      id: `environment:${number}`,
      legacyId: number,
      name: `Omgeving ${number}`,
      description: `Plek ${number}`,
      promptText: `Plek ${number}`,
      labelScores: {},
    })),
    labels: [2, 3].map((number) => legacyRecord({ id: `label:${number}`, legacyId: number, name: `Label ${number}`, sortOrder: number * 10 })),
    situations: [
      legacySituation(2, {
        title: "Bobbie betaalt in natura",
        sortOrder: 10,
        characterSlots: [slot(1, "fixed-character", 15), slot(2, "fixed-character", 29), slot(3, "empty")],
        contextSituationId: "situation:84",
        legacyContextSceneId: 84,
      }),
      legacySituation(11, {
        title: "Willekeurige omgeving",
        sortOrder: 110,
        environmentMode: "random",
        environmentId: null,
        legacyEnvironmentId: null,
        characterSlots: [slot(1, "fixed-character", 15), slot(2, "random-character"), slot(3, "random-character")],
      }),
      legacySituation(84, {
        title: "Gearchiveerd en inactief",
        sortOrder: 840,
        active: false,
        archivedAt: AT,
        status: "archived",
        characterSlots: [slot(1, "fixed-character", 15), slot(2, "fixed-character", 29), slot(3, "fixed-character", 30)],
      }),
    ],
    mediaAssets: [{
      id: "media:environment-15-background",
      environmentId: "environment:15",
      type: "background",
      role: "background",
      status: "present",
      filename: "plek.jpg",
    }],
    environmentCompositions: [],
    lightingPresets: [{ id: "lighting:custom-regie", name: "Regie", mode: "custom", fixtures: [] }],
  };
}

async function readModel() {
  return buildCatalogReadModel(OPTIONS);
}

async function storeRecord(collection, id) {
  const store = await readCatalogStore(OPTIONS);
  return store[collection].find((item) => item.id === id);
}

// The catalog UI sends exactly these fields when it saves a situation.
function uiSituationBody(situation, changes = {}) {
  return {
    id: situation.id,
    title: situation.title,
    description: situation.description,
    environmentId: situation.environmentId || "",
    characterIds: situation.characterIds,
    ...changes,
  };
}

async function main() {
  await fs.rm(TEST_ROOT, { recursive: true, force: true });
  await writeCatalogStore(seedStore(), OPTIONS);
  const seeded = await readCatalogStore(OPTIONS);
  const untouchedMedia = cloneJson(seeded.mediaAssets);
  const untouchedLighting = cloneJson(seeded.lightingPresets);

  // 1. A text edit keeps everything the form does not show.
  const before = await storeRecord("situations", "situation:2");
  await upsertSituation(uiSituationBody(before, { description: "Nieuwe omschrijving" }), await readModel(), OPTIONS);
  let after = await storeRecord("situations", "situation:2");
  assert.equal(after.legacyId, 2, "legacyId must survive a save");
  assert.deepEqual(after.labelIds, ["label:2", "label:3"], "labels must survive a save");
  assert.deepEqual(after.legacyLabelIds, [2, 3]);
  assert.equal(after.sortOrder, 10, "sortOrder must survive a save");
  assert.deepEqual(after.characterSlots, before.characterSlots, "empty character slot must survive a save");
  assert.equal(after.legacyTable, "algorithm_scenes");
  assert.equal(after.contextSituationId, "situation:84");
  assert.equal(after.legacyContextSceneId, 84);
  assert.equal(after.description, "Nieuwe omschrijving");
  assert.equal(after.promptText, "Nieuwe omschrijving", "promptText follows the description it mirrored");
  assert.equal(after.active, true);
  let modelSituation = (await readModel()).situations.find((item) => item.id === "situation:2");
  assert.equal(modelSituation.legacyId, 2);
  assert.deepEqual(modelSituation.labelIds, ["label:2", "label:3"]);
  assert.equal(modelSituation.characterSlots.length, 3);

  // 2. A save without description keeps the description.
  await upsertSituation({ id: "situation:2", title: "Bobbie betaalt in natura", environmentId: "environment:15", characterIds: ["character:15", "character:29"] }, await readModel(), OPTIONS);
  after = await storeRecord("situations", "situation:2");
  assert.equal(after.description, "Nieuwe omschrijving", "a missing description must not wipe it");

  // 3. Changing characters keeps the empty slot where it is, until a third character needs it.
  await upsertSituation(uiSituationBody(after, { characterIds: ["character:15", "character:30"] }), await readModel(), OPTIONS);
  after = await storeRecord("situations", "situation:2");
  assert.deepEqual(after.characterSlots.map((item) => [item.slotIndex, item.mode, item.characterId]), [
    [1, "fixed-character", "character:15"],
    [2, "fixed-character", "character:30"],
    [3, "empty", null],
  ]);
  assert.deepEqual(after.legacyCharacterIds, [15, 30]);
  await upsertSituation(uiSituationBody(after, { characterIds: ["character:15", "character:30", "character:29"] }), await readModel(), OPTIONS);
  after = await storeRecord("situations", "situation:2");
  assert.deepEqual(after.characterSlots.map((item) => [item.slotIndex, item.mode, item.characterId]), [
    [1, "fixed-character", "character:15"],
    [2, "fixed-character", "character:30"],
    [3, "fixed-character", "character:29"],
  ]);
  assert.deepEqual(after.labelIds, ["label:2", "label:3"], "labels survive character changes too");

  // 4. A random environment and random-character slots survive a save from the form.
  const random = await storeRecord("situations", "situation:11");
  await upsertSituation(uiSituationBody(random, { title: "Willekeurige omgeving (bewerkt)" }), await readModel(), OPTIONS);
  after = await storeRecord("situations", "situation:11");
  assert.equal(after.environmentMode, "random", "random environment must survive a save");
  assert.equal(after.environmentId, null);
  assert.deepEqual(after.characterSlots, random.characterSlots, "random-character slots must survive a save");
  await upsertSituation(uiSituationBody(after, { environmentId: "environment:7" }), await readModel(), OPTIONS);
  after = await storeRecord("situations", "situation:11");
  assert.equal(after.environmentMode, "selected", "choosing an environment selects it");
  assert.equal(after.environmentId, "environment:7");
  assert.equal(after.legacyEnvironmentId, 7);
  await assert.rejects(
    upsertSituation(uiSituationBody(await storeRecord("situations", "situation:2"), { environmentId: "" }), await readModel(), OPTIONS),
    /invalid_situation/,
    "a selected environment cannot be cleared"
  );

  // 5. Saving an archived situation keeps it archived.
  const archived = await storeRecord("situations", "situation:84");
  await upsertSituation(uiSituationBody(archived, { description: "Nog steeds uit" }), await readModel(), OPTIONS);
  after = await storeRecord("situations", "situation:84");
  assert.equal(after.active, false, "a save must not reactivate a situation");
  assert.equal(after.archivedAt, AT);
  assert.equal(after.status, "archived", "a save must not turn archived into inactive");

  // 6. New situations get the next free number and can be placed in a path.
  const created = await upsertSituation({
    title: "Nieuwe situatie",
    description: "Van de website",
    environmentId: "environment:15",
    characterIds: ["character:15", "character:29"],
  }, await readModel(), OPTIONS);
  assert.equal(created.id, "situation:85", "new situation follows the highest number");
  assert.equal(created.legacyId, 85);
  after = await storeRecord("situations", "situation:85");
  assert.equal(after.legacyId, 85);
  assert(after.sortOrder > 840, "new situation sorts after the existing ones");
  assert.equal(after.environmentMode, "selected");
  const editorCatalog = toEditorCatalog(await readModel());
  const scene = editorCatalog.scenes.find((item) => item.id === 85);
  assert(scene, "new situation must appear in the paths editor");
  assert.equal(scene.title, "Nieuwe situatie");
  assert(!editorCatalog.scenes.some((item) => !item.id), "every situation must have a path number");
  const second = await upsertSituation({
    title: "Nog een",
    environmentId: "environment:15",
    characterIds: ["character:15"],
  }, await readModel(), OPTIONS);
  assert.equal(second.id, "situation:86");
  assert.equal((await readCatalogStore(OPTIONS)).nextCounters.situation, 87, "the counter only moves forward");

  // 7. Characters keep their legacy fields; a deliberate prompt stays.
  const character = await storeRecord("characters", "character:15");
  await upsertCharacter({ id: "character:15", name: "Personage 15", description: "Anders", performerIds: ["performer:1"] }, await readModel(), OPTIONS);
  after = await storeRecord("characters", "character:15");
  assert.equal(after.legacyId, 15);
  assert.deepEqual(after.labelScores, character.labelScores, "labelScores must survive a save");
  assert.equal(after.legacyPerformerId, 1);
  assert.equal(after.promptText, "Anders");
  await upsertCharacter({ id: "character:31", name: "Personage 31", description: "Nieuw", performerIds: ["performer:2"] }, await readModel(), OPTIONS);
  after = await storeRecord("characters", "character:31");
  assert.equal(after.promptText, "Eigen prompt die afwijkt", "a promptText that differs from the description is kept");
  assert.equal(after.legacyPerformerId, 2, "legacyPerformerId follows a performer change");
  const newCharacter = await upsertCharacter({ name: "Nieuw personage", description: "x", performerIds: [] }, await readModel(), OPTIONS);
  assert.equal(newCharacter.id, "character:32");
  assert.equal(newCharacter.legacyId, 32);

  // 8. Environments and performers keep their numbers, slots and order.
  await upsertEnvironment({ id: "environment:15", name: "Omgeving 15", description: "Nieuw" }, await readModel(), OPTIONS);
  after = await storeRecord("environments", "environment:15");
  assert.equal(after.legacyId, 15);
  assert.equal(after.promptText, "Nieuw");
  const newEnvironment = await upsertEnvironment({ name: "Nieuwe plek", description: "" }, await readModel(), OPTIONS);
  assert.equal(newEnvironment.id, "environment:16");
  await upsertPerformer({ id: "performer:2", name: "Brent K" }, await readModel(), OPTIONS);
  after = await storeRecord("performers", "performer:2");
  assert.equal(after.legacyId, 2);
  assert.equal(after.performerSlot, 3, "a missing performerSlot must not wipe it");
  assert.equal(after.sortOrder, 20);

  // 9. Media and lighting presets are never touched by entity saves.
  const finalStore = await readCatalogStore(OPTIONS);
  assert.deepEqual(finalStore.mediaAssets, untouchedMedia);
  assert.deepEqual(finalStore.lightingPresets, untouchedLighting);

  process.stdout.write(JSON.stringify({
    ok: true,
    checks: [
      "situation save keeps legacyId, labels, sortOrder, context and empty slots",
      "missing description is kept",
      "character changes keep open slots until they are needed",
      "random environment and random-character slots survive a save",
      "archived situations stay archived",
      "new situations get the next free number and appear in the paths editor",
      "character, environment and performer saves keep their legacy fields",
      "media and lighting presets are untouched",
    ],
  }, null, 2));
  process.stdout.write("\n");
  await fs.rm(TEST_ROOT, { recursive: true, force: true });
}

main().catch(async (err) => {
  await fs.rm(TEST_ROOT, { recursive: true, force: true }).catch(() => {});
  process.stderr.write(`${err.stack || err.message}\n`);
  process.exit(1);
});
