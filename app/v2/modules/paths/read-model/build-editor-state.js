"use strict";

const { PATHS_EDITOR_STATE_SCHEMA_VERSION } = require("../contracts/paths-editor-v0");
const { readPathsStore } = require("../db/paths-store");
const { readLegacyEditorCatalogRows } = require("../legacy-readonly/editor-adapter");
const Graph = require("../rules-engine/paden-graph");

function activePaths(paths = []) {
  return paths.filter((path) => path && path.isActive !== false && !path.archivedAt);
}

async function buildPathsEditorState(options = {}) {
  const [store, catalog] = await Promise.all([
    readPathsStore(options),
    readLegacyEditorCatalogRows(options),
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
      seededFrom: store.seededFrom || null,
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
