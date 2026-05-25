"use strict";

const { PATHS_EDITOR_STATE_SCHEMA_VERSION } = require("../contracts/paths-editor-v0");
const { fetchEditorCatalog } = require("../client/catalog-client");
const { readPathsStore } = require("../db/paths-store");
const Graph = require("../rules-engine/paden-graph");

function activePaths(paths = []) {
  return paths.filter((path) => path && path.isActive !== false && !path.archivedAt);
}

function sanitizeSeededFrom(seededFrom) {
  if (!seededFrom || typeof seededFrom !== "object" || Array.isArray(seededFrom)) return null;
  if (seededFrom.type === "legacy-sqlite-wal-copy") {
    return {
      type: "v2-owned-import",
      importedFrom: "legacy-paths",
      snapshotId: seededFrom.snapshotId || null,
      adapter: seededFrom.adapter || null,
      tables: Array.isArray(seededFrom.tables) ? seededFrom.tables : [],
    };
  }
  return seededFrom;
}

async function buildPathsEditorState(options = {}) {
  const [store, catalog] = await Promise.all([
    readPathsStore(options),
    options.catalog ? Promise.resolve(options.catalog) : fetchEditorCatalog(),
  ]);
  const paths = store.paths.map((path) => ({ ...path }));
  const crossingThresholds = Graph.normalizeCrossingThresholdsForPaths(
    store.crossingThresholds || [],
    activePaths(paths)
  );
  return {
    ok: true,
    schemaVersion: PATHS_EDITOR_STATE_SCHEMA_VERSION,
    generatedAt: new Date().toISOString(),
    source: {
      type: "v2-paths-store-with-readonly-catalog",
      pathsStoreReadOnly: false,
      catalogReadOnly: true,
      catalogSource: "v2-catalog-service",
      seededFrom: sanitizeSeededFrom(store.seededFrom),
    },
    catalog: {
      ...catalog,
      paths,
      crossingThresholds,
    },
  };
}

module.exports = {
  buildPathsEditorState,
};
