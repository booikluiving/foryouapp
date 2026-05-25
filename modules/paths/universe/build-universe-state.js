"use strict";

const { PATHS_UNIVERSE_STATE_SCHEMA_VERSION } = require("../contracts/paths-universe-v0");
const Graph = require("../rules-engine/paden-graph");
const { buildPathsEditorState } = require("../read-model/build-editor-state");
const { buildGraph } = require("./domain/normalize-paths");

function stableRowId(pathId, index, offset = 0) {
  return (Number(pathId || 0) * 100000) + offset + index + 1;
}

function truthyNumber(value) {
  return value ? 1 : 0;
}

function activeStorePaths(paths = []) {
  return (Array.isArray(paths) ? paths : [])
    .filter((path) => path && path.isActive !== false && !path.archivedAt);
}

function buildAlgorithmSourceFromEditorState(editorState) {
  const catalog = editorState && editorState.catalog ? editorState.catalog : {};
  const paths = Array.isArray(catalog.paths) ? catalog.paths : [];
  const scenes = (Array.isArray(catalog.scenes) ? catalog.scenes : []).map((scene) => ({
    id: Number(scene.id || 0),
    title: String(scene.title || ""),
    sortOrder: Number(scene.sortOrder || 0),
    characterCount: Number(scene.characterCount || 0),
    characterSlotsJson: JSON.stringify(scene.characterSlots || []),
    characterIdsJson: JSON.stringify(scene.characterIds || []),
    situationIdsJson: JSON.stringify(scene.situationIds || []),
    labelIdsJson: JSON.stringify(scene.labelIds || []),
    environmentId: scene.environmentId || null,
    environmentMode: String(scene.environmentMode || "selected"),
    contextSceneId: scene.contextSceneId || null,
    promptOverride: String(scene.promptOverride || ""),
    isActive: scene.isActive === false ? 0 : 1,
    archivedAt: scene.archivedAt || "",
    createdAt: scene.createdAt || "",
    updatedAt: scene.updatedAt || "",
  }));

  const pathScenes = [];
  const pathEdges = [];
  const thresholds = [];
  const nodeBlocks = [];

  for (const pathItem of paths) {
    const pathId = Number(pathItem.id || 0);
    const sceneIds = Graph.getPathSceneIds(pathItem);
    const endSceneIds = new Set(Graph.normalizeIdList(pathItem.endSceneIds || []));
    const ignoreSceneIds = new Set(Graph.normalizeIgnoreCrossingBlockSceneIds(pathItem, sceneIds));
    sceneIds.forEach((sceneId, index) => {
      pathScenes.push({
        id: stableRowId(pathId, index),
        pathId,
        sceneId,
        sortOrder: (index + 1) * 10,
        isEndNode: truthyNumber(endSceneIds.has(sceneId)),
        ignoreCrossingBlocks: truthyNumber(ignoreSceneIds.has(sceneId)),
        createdAt: pathItem.createdAt || "",
        updatedAt: pathItem.updatedAt || "",
      });
    });

    Graph.getRenderableEdges(pathItem, { fallback: true }).forEach((edge, index) => {
      pathEdges.push({
        id: stableRowId(pathId, index, 20000),
        pathId,
        fromSceneId: Number(edge.fromSceneId || 0),
        toSceneId: Number(edge.toSceneId || 0),
        edgeType: edge.edgeType || "required",
        sortOrder: (index + 1) * 10,
        createdAt: pathItem.createdAt || "",
        updatedAt: pathItem.updatedAt || "",
      });
    });

    Graph.normalizeThresholdsForEdges(pathItem.thresholds || [], sceneIds, Graph.getRenderableEdges(pathItem, { fallback: true }))
      .forEach((threshold, index) => {
        thresholds.push({
          id: stableRowId(pathId, index, 40000),
          pathId,
          sourceSceneId: Number(threshold.sourceSceneId || 0),
          requiredCount: Number(threshold.requiredCount || 1),
          createdAt: pathItem.createdAt || "",
          updatedAt: pathItem.updatedAt || "",
        });
      });

    Graph.normalizeBlockRules(pathItem.blockRules || [], sceneIds).forEach((rule, index) => {
      nodeBlocks.push({
        id: stableRowId(pathId, index, 60000),
        pathId,
        sourceSceneId: Number(rule.sourceSceneId || 0),
        includeCrossingPaths: truthyNumber(rule.includeCrossingPaths),
        createdAt: pathItem.createdAt || "",
        updatedAt: pathItem.updatedAt || "",
      });
    });
  }

  return {
    paths: paths.map((pathItem) => ({
      id: Number(pathItem.id || 0),
      name: String(pathItem.name || ""),
      description: String(pathItem.description || ""),
      sortOrder: Number(pathItem.sortOrder || 0),
      color: String(pathItem.color || ""),
      edgeMode: String(pathItem.edgeMode || "manual"),
      isActive: pathItem.isActive === false ? 0 : 1,
      archivedAt: pathItem.archivedAt || "",
      createdAt: pathItem.createdAt || "",
      updatedAt: pathItem.updatedAt || "",
    })),
    pathScenes,
    pathEdges,
    thresholds,
    nodeBlocks,
    crossingThresholds: (catalog.crossingThresholds || []).map((threshold, index) => ({
      id: index + 1,
      sceneId: Number(threshold.sceneId || 0),
      requiredCount: Number(threshold.requiredCount || 1),
      createdAt: threshold.createdAt || "",
      updatedAt: threshold.updatedAt || "",
    })),
    scenes,
    runs: [],
  };
}

async function buildPathsUniverseState(options = {}) {
  const editorState = await buildPathsEditorState(options);
  const raw = buildAlgorithmSourceFromEditorState(editorState);
  const graph = buildGraph(raw);
  const paths = editorState.catalog && Array.isArray(editorState.catalog.paths)
    ? editorState.catalog.paths
    : [];

  return {
    ok: true,
    schemaVersion: PATHS_UNIVERSE_STATE_SCHEMA_VERSION,
    generatedAt: new Date().toISOString(),
    source: {
      type: "v2-paths-universe-state",
      pathsReadModel: "/v0/paths/editor-state",
      pathsStoreReadOnly: false,
      catalogReadOnly: true,
      runtimeOverlay: "not_connected",
      seededFrom: editorState.source ? editorState.source.seededFrom || null : null,
    },
    counts: {
      paths: raw.paths.length,
      activePaths: activeStorePaths(paths).length,
      scenes: raw.scenes.length,
      pathScenes: raw.pathScenes.length,
      pathEdges: raw.pathEdges.length,
      thresholds: raw.thresholds.length,
      nodeBlocks: raw.nodeBlocks.length,
      crossings: graph.crossings.length,
      looseScenes: graph.looseScenes.length,
      networkNodes: graph.networkMap.summary.nodeCount,
      networkEdges: graph.networkMap.summary.edgeCount,
    },
    graph,
    runtime: null,
  };
}

module.exports = {
  buildAlgorithmSourceFromEditorState,
  buildPathsUniverseState,
};
