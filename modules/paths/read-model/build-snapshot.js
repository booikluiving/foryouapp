"use strict";

const {
  PATHS_SNAPSHOT_SCHEMA_VERSION,
  toPathId,
  toSituationId,
} = require("../../../shared/contracts/paths-v0");
const { pathsStorePath, readPathsStore } = require("../db/paths-store");
const Graph = require("../rules-engine/paden-graph");

function text(value) {
  return value == null ? "" : String(value);
}

function status(path) {
  if (path.archivedAt) return "archived";
  return path.isActive !== false ? "active" : "inactive";
}

function mapNode(path, legacySituationId, sortOrder) {
  return {
    id: `path-node:${Number(path.id)}:${legacySituationId}`,
    legacyId: null,
    situationId: toSituationId(legacySituationId),
    legacySituationId,
    sortOrder,
    isEndNode: Graph.normalizeIdList(path.endSceneIds || []).includes(legacySituationId),
    ignoreCrossingBlocks: Graph.normalizeIgnoreCrossingBlockSceneIds(path, path.sceneIds).includes(legacySituationId),
    createdAt: text(path.createdAt),
    updatedAt: text(path.updatedAt),
  };
}

function mapEdge(path, edge, index) {
  const legacyFromSituationId = Number(edge.fromSceneId);
  const legacyToSituationId = Number(edge.toSceneId);
  return {
    id: `path-edge:${Number(path.id)}:${legacyFromSituationId}:${legacyToSituationId}`,
    legacyId: null,
    fromSituationId: toSituationId(legacyFromSituationId),
    toSituationId: toSituationId(legacyToSituationId),
    legacyFromSituationId,
    legacyToSituationId,
    edgeType: text(edge.edgeType || "required"),
    sortOrder: (index + 1) * 10,
    createdAt: text(path.createdAt),
    updatedAt: text(path.updatedAt),
  };
}

function mapThreshold(path, threshold) {
  const legacySituationId = Number(threshold.sourceSceneId);
  return {
    id: `path-threshold:${Number(path.id)}:${legacySituationId}`,
    legacyId: null,
    situationId: toSituationId(legacySituationId),
    legacySituationId,
    requiredCount: Math.max(1, Number(threshold.requiredCount || 1)),
    createdAt: text(threshold.createdAt || path.createdAt),
    updatedAt: text(threshold.updatedAt || path.updatedAt),
  };
}

function mapBlockRule(path, rule) {
  const legacySituationId = Number(rule.sourceSceneId);
  return {
    id: `path-block:${Number(path.id)}:${legacySituationId}`,
    legacyId: null,
    sourceSituationId: toSituationId(legacySituationId),
    legacySourceSituationId: legacySituationId,
    includeCrossingPaths: !!rule.includeCrossingPaths,
    createdAt: text(rule.createdAt || path.createdAt),
    updatedAt: text(rule.updatedAt || path.updatedAt),
  };
}

function mapCrossingThreshold(threshold) {
  const legacySituationId = Number(threshold.sceneId);
  return {
    id: `crossing-threshold:${legacySituationId}`,
    legacyId: null,
    situationId: toSituationId(legacySituationId),
    legacySituationId,
    requiredCount: Math.max(1, Number(threshold.requiredCount || 1)),
    createdAt: text(threshold.createdAt),
    updatedAt: text(threshold.updatedAt),
  };
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

async function buildPathsSnapshot(options = {}) {
  const store = await readPathsStore(options);
  const paths = store.paths.map((path) => {
    const legacyId = Number(path.id);
    const sceneIds = Graph.getPathSceneIds(path);
    const edgesForSnapshot = Graph.getRenderableEdges(path, { fallback: true });
    const nodes = sceneIds.map((sceneId, index) => mapNode(path, sceneId, (index + 1) * 10));
    const edges = edgesForSnapshot.map((edge, index) => mapEdge(path, edge, index));
    const thresholds = Graph.normalizeThresholdsForEdges(path.thresholds || [], sceneIds, edgesForSnapshot)
      .map((threshold) => mapThreshold(path, threshold));
    const blockRules = Graph.normalizeBlockRules(path.blockRules || [], sceneIds)
      .map((rule) => mapBlockRule(path, rule));
    return {
      id: toPathId(legacyId),
      legacyId,
      name: text(path.name),
      description: text(path.description),
      color: text(path.color),
      sortOrder: Number(path.sortOrder || 0),
      edgeMode: text(path.edgeMode || "manual"),
      active: path.isActive !== false,
      archivedAt: path.archivedAt || null,
      status: status(path),
      createdAt: text(path.createdAt),
      updatedAt: text(path.updatedAt),
      situationIds: nodes.map((node) => node.situationId),
      legacySituationIds: nodes.map((node) => node.legacySituationId),
      nodes,
      edges,
      thresholds,
      blockRules,
    };
  });
  const crossingThresholds = Graph.normalizeCrossingThresholdsForPaths(
    store.crossingThresholds || [],
    store.paths.filter((path) => path.isActive !== false && !path.archivedAt)
  ).map(mapCrossingThreshold);

  return {
    schemaVersion: PATHS_SNAPSHOT_SCHEMA_VERSION,
    generatedAt: new Date().toISOString(),
    source: {
      type: "v2-paths-store",
      path: pathsStorePath(options),
      readOnly: false,
      ownsMutations: true,
      seededFrom: sanitizeSeededFrom(store.seededFrom),
    },
    counts: {
      paths: paths.length,
      activePaths: paths.filter((item) => item.active && !item.archivedAt).length,
      pathNodes: paths.reduce((sum, item) => sum + item.nodes.length, 0),
      pathEdges: paths.reduce((sum, item) => sum + item.edges.length, 0),
      thresholds: paths.reduce((sum, item) => sum + item.thresholds.length, 0),
      blockRules: paths.reduce((sum, item) => sum + item.blockRules.length, 0),
      crossingThresholds: crossingThresholds.length,
      uniqueSituations: new Set(paths.flatMap((item) => item.situationIds)).size,
    },
    paths,
    crossingThresholds,
  };
}

module.exports = {
  buildPathsSnapshot,
};
