"use strict";

const {
  CATALOG_SCHEMA_VERSION,
} = require("../../../shared/contracts/catalog-v0");
const {
  applyCatalogStore,
  catalogDbPath,
  readCatalogStore,
} = require("../write-model/catalog-store");

function emptyReadModel(source) {
  return {
    schemaVersion: CATALOG_SCHEMA_VERSION,
    generatedAt: new Date().toISOString(),
    source,
    counts: {
      performers: 0,
      activePerformers: 0,
      characters: 0,
      activeCharacters: 0,
      environments: 0,
      activeEnvironments: 0,
      situations: 0,
      activeSituations: 0,
      labels: 0,
      activeLabels: 0,
      mediaAssets: 0,
      presentMediaAssets: 0,
      legacySituationFragments: 0,
      environmentCompositions: 0,
    },
    performers: [],
    characters: [],
    environments: [],
    situations: [],
    labels: [],
    mediaAssets: [],
    environmentCompositions: [],
    legacy: {
      algorithmSituations: [],
    },
  };
}

function sanitizeImportedFrom(importedFrom) {
  if (!importedFrom || typeof importedFrom !== "object" || Array.isArray(importedFrom)) return null;
  const source = importedFrom.source && typeof importedFrom.source === "object" ? importedFrom.source : {};
  return {
    type: importedFrom.type || "unknown-import",
    importedAt: importedFrom.importedAt || null,
    catalogSchemaVersion: importedFrom.catalogSchemaVersion || null,
    source: {
      type: source.type && String(source.type).includes("legacy")
        ? "legacy-import-oracle"
        : source.type || null,
      snapshotId: source.snapshotId || null,
      adapter: source.adapter ? "import-tool" : null,
      tables: Array.isArray(source.tables) ? source.tables : [],
    },
  };
}

async function buildCatalogReadModel(options = {}) {
  const dbPath = catalogDbPath(options);
  const store = await readCatalogStore(options);
  const source = {
    type: "v2-catalog-sqlite",
    path: dbPath,
    readOnly: false,
    ownsMutations: true,
    schemaVersion: store.schemaVersion,
    importedFrom: sanitizeImportedFrom(store.importedFrom),
  };
  return applyCatalogStore(emptyReadModel(source), store, options);
}

module.exports = {
  buildCatalogReadModel,
};
