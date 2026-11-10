"use strict";

// Kleine, verzonnen catalogus voor tests. Schrijft een store naar de opgegeven
// testdatabase; raakt de echte catalogus niet aan.

const {
  CATALOG_SCHEMA_VERSION,
  toCatalogId,
} = require("../../../../shared/contracts/catalog-v0");
const {
  STORE_SCHEMA_VERSION,
  catalogDbPath,
  writeCatalogStore,
} = require("../../write-model/catalog-store");

const STAMP = "2026-01-01T00:00:00.000Z";
const SOURCE = { type: "test-seed" };

function base(type, id, extra) {
  return {
    id: toCatalogId(type, id),
    legacyId: id,
    externalId: null,
    active: true,
    archivedAt: null,
    status: "active",
    createdAt: STAMP,
    updatedAt: STAMP,
    source: { ...SOURCE },
    ...extra,
  };
}

function performer(id, name, slot) {
  return base("performer", id, { name, performerSlot: slot, sortOrder: id });
}

function character(id, name, performerId) {
  return base("character", id, {
    name,
    description: `Beschrijving van ${name}`,
    promptText: `Speel ${name}.`,
    performerIds: [toCatalogId("performer", performerId)],
    legacyPerformerId: performerId,
    labelScores: {},
  });
}

function environment(id, name) {
  return base("environment", id, {
    name,
    description: `Omgeving ${name}`,
    promptText: `De scène speelt in ${name}.`,
    labelScores: {},
  });
}

function label(id, name) {
  return base("label", id, { name, sortOrder: id });
}

function situation(id, title, environmentId, characterIds, labelIds) {
  return base("situation", id, {
    legacyTable: "algorithm_scenes",
    title,
    description: `Situatie ${title}`,
    promptText: `Situatie ${title}`,
    sortOrder: id,
    characterCount: characterIds.length,
    characterIds: characterIds.map((value) => toCatalogId("character", value)),
    legacyCharacterIds: characterIds,
    characterSlots: characterIds.map((value, index) => ({
      slotIndex: index + 1,
      mode: "fixed-character",
      characterId: toCatalogId("character", value),
      legacyCharacterId: value,
    })),
    environmentMode: "selected",
    environmentId: toCatalogId("environment", environmentId),
    legacyEnvironmentId: environmentId,
    labelIds: labelIds.map((value) => toCatalogId("label", value)),
    legacyLabelIds: labelIds,
    legacySituationIds: [],
    contextSituationId: null,
    legacyContextSceneId: null,
  });
}

function buildSeedStore() {
  return {
    schemaVersion: STORE_SCHEMA_VERSION,
    createdAt: STAMP,
    updatedAt: STAMP,
    importedFrom: {
      type: "test-seed",
      importedAt: STAMP,
      source: { type: "test-seed", snapshotId: "seed", adapter: null, tables: [] },
      catalogSchemaVersion: CATALOG_SCHEMA_VERSION,
    },
    nextCounters: { performer: 1, character: 1, environment: 1, situation: 1 },
    performers: [
      performer(1, "Speler Een", 1),
      performer(2, "Speler Twee", 2),
      performer(3, "Speler Drie", 3),
    ],
    characters: [
      character(1, "Personage Een", 1),
      character(2, "Personage Twee", 2),
      character(3, "Personage Drie", 3),
      character(4, "Personage Vier", 1),
    ],
    environments: [
      environment(4, "Cradam"),
      environment(14, "NOS_Studio"),
      environment(18, "Festival"),
      environment(24, "Bioscoop"),
      environment(28, "The Voice of Holland"),
      environment(29, "Lingo studio"),
    ],
    labels: [label(1, "Rustig"), label(2, "Druk")],
    situations: [
      situation(1, "Eerste situatie", 24, [1, 2], [1]),
      situation(2, "Tweede situatie", 18, [2, 3], [2]),
      situation(3, "Derde situatie", 29, [1, 3, 4], [1, 2]),
    ],
    mediaAssets: [],
    environmentCompositions: [],
  };
}

async function seedCatalog(options = {}) {
  const store = buildSeedStore();
  await writeCatalogStore(store, options);
  return { ok: true, catalogDbPath: catalogDbPath(options) };
}

module.exports = { buildSeedStore, seedCatalog };
