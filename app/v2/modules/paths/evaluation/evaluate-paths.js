"use strict";

const {
  PATHS_EVALUATION_SCHEMA_VERSION,
  fromSituationId,
  toPathId,
  toSituationId,
} = require("../../../shared/contracts/paths-v0");
const Graph = require("../rules-engine/paden-graph");

function normalizePlayedSituationIds(values) {
  const output = [];
  const seen = new Set();
  for (const value of values || []) {
    const legacyId = fromSituationId(value) || Graph.normalizeId(value);
    if (!legacyId || seen.has(legacyId)) continue;
    seen.add(legacyId);
    output.push(toSituationId(legacyId));
  }
  return output;
}

function legacyPathFromSnapshot(path) {
  return {
    id: Number(path.legacyId || String(path.id || "").replace(/^path:/, "")),
    name: path.name || "Naamloos pad",
    description: path.description || "",
    color: path.color || "",
    sortOrder: Number(path.sortOrder || 0),
    edgeMode: path.edgeMode || "manual",
    sceneIds: (path.nodes || []).map((node) => Number(node.legacySituationId || fromSituationId(node.situationId) || 0)).filter(Boolean),
    edges: (path.edges || []).map((edge) => ({
      fromSceneId: Number(edge.legacyFromSituationId || fromSituationId(edge.fromSituationId) || 0),
      toSceneId: Number(edge.legacyToSituationId || fromSituationId(edge.toSituationId) || 0),
      edgeType: edge.edgeType || "required",
    })).filter((edge) => edge.fromSceneId && edge.toSceneId),
    thresholds: (path.thresholds || []).map((threshold) => ({
      sourceSceneId: Number(threshold.legacySituationId || fromSituationId(threshold.situationId) || 0),
      requiredCount: Number(threshold.requiredCount || 1),
    })).filter((threshold) => threshold.sourceSceneId),
    endSceneIds: (path.nodes || [])
      .filter((node) => node.isEndNode)
      .map((node) => Number(node.legacySituationId || fromSituationId(node.situationId) || 0))
      .filter(Boolean),
    blockRules: (path.blockRules || []).map((rule) => ({
      sourceSceneId: Number(rule.legacySourceSituationId || fromSituationId(rule.sourceSituationId) || 0),
      includeCrossingPaths: !!rule.includeCrossingPaths,
    })).filter((rule) => rule.sourceSceneId),
    ignoreCrossingBlockSceneIds: (path.nodes || [])
      .filter((node) => node.ignoreCrossingBlocks)
      .map((node) => Number(node.legacySituationId || fromSituationId(node.situationId) || 0))
      .filter(Boolean),
    isActive: path.active !== false,
    archivedAt: path.archivedAt || "",
  };
}

function legacyCrossingThreshold(threshold) {
  return {
    sceneId: Number(threshold.legacySituationId || fromSituationId(threshold.situationId) || 0),
    requiredCount: Number(threshold.requiredCount || 1),
  };
}

function statusName(status) {
  return String(status.nodeStatus || "Locked").toLowerCase();
}

function detailStatus(detail, playedSet, sceneId) {
  if (playedSet.has(sceneId)) return "played";
  if (detail.available) return "available";
  if (detail.blocked) return "blocked";
  return "locked";
}

function detailReason(detail, status, sceneId) {
  if (status === "played") return "already_played";
  if (detail.blockingCrossingThreshold) return "crossing_threshold";
  if (detail.blockingThresholds && detail.blockingThresholds.length) return "path_threshold";
  if (detail.ruleBlocked) return "path_block_rule";
  if (detail.closedBlocked) return "path_closed";
  if (detail.expiredOptional) return "optional_expired";
  if (status === "available" && detail.isStart) return "path_start";
  if (status === "available") return "predecessors_played";
  if (!detail.reached) return detail.isStart ? "global_path_start_waiting_for_incoming_route" : "path_not_reached";
  if (detail.missingPredecessorIds && detail.missingPredecessorIds.length) return "path_threshold";
  return `path_status_${sceneId}`;
}

function mapIds(ids = [], mapper = toSituationId) {
  return Graph.normalizeIdList(ids).map(mapper);
}

function mapDetail(detail, playedSet, sceneId) {
  const status = detailStatus(detail, playedSet, sceneId);
  return {
    status,
    reason: detailReason(detail, status, sceneId),
    pathId: toPathId(detail.pathId),
    pathName: detail.pathName,
    reached: !!detail.reached,
    isPathStart: !!detail.isStart,
    isLocalPathStart: !!detail.isStart,
    requiredPredecessorIds: mapIds(detail.requiredPredecessorIds),
    completedPredecessorIds: mapIds(detail.completedPredecessorIds),
    missingPredecessorIds: mapIds(detail.missingPredecessorIds),
    optionalPredecessorIds: mapIds(detail.optionalPredecessorIds),
    successorIds: mapIds(detail.successorIds),
    requiredCount: detail.blockingCrossingThreshold
      ? detail.blockingCrossingThreshold.requiredCount
      : detail.requiredCount || 0,
    completedCount: detail.blockingCrossingThreshold
      ? detail.blockingCrossingThreshold.completedCount
      : detail.completedCount || 0,
    endNode: !!detail.endNode,
    pathClosed: !!detail.pathClosed,
  };
}

function mapStatus(status, playedSet) {
  const legacySituationId = Number(status.sceneId || 0);
  const nodeStatus = statusName(status);
  const pathDetails = (status.pathDetails || []).map((detail) => mapDetail(detail, playedSet, legacySituationId));
  return {
    situationId: toSituationId(legacySituationId),
    legacySituationId,
    status: nodeStatus,
    pathAvailable: nodeStatus === "available",
    pathLocked: nodeStatus === "locked" || nodeStatus === "blocked",
    availablePathIds: mapIds(status.availablePathIds, toPathId),
    lockedPathIds: pathDetails.filter((detail) => detail.status === "locked").map((detail) => detail.pathId),
    blockedPathIds: mapIds(status.blockedPathIds, toPathId),
    reachedPathIds: mapIds(status.reachedPathIds, toPathId),
    pathStatuses: pathDetails,
    isPathStart: !!status.isPathStart,
    isPathEnd: !!status.isPathEnd,
    pathClosed: !!status.pathClosed,
    predecessorIds: mapIds(status.predecessorIds),
    requiredPredecessorIds: mapIds(status.requiredPredecessorIds),
    completedPredecessorIds: mapIds(status.completedPredecessorIds),
    missingPredecessorIds: mapIds(status.missingPredecessorIds),
    requiredCount: Number(status.requiredCount || status.crossingRequiredCount || 0),
    completedCount: Number(status.completedCount || status.crossingCompletedCount || 0),
    crossingThreshold: status.crossingThreshold ? {
      situationId: toSituationId(status.crossingThreshold.sceneId),
      incomingCount: status.crossingThreshold.incomingCount,
      requiredCount: status.crossingThreshold.requiredCount,
      completedCount: status.crossingThreshold.completedCount,
      satisfied: !!status.crossingThreshold.satisfied,
    } : null,
  };
}

function evaluatePaths(snapshot, input = {}) {
  const paths = (snapshot.paths || [])
    .filter((path) => path && path.active !== false && !path.archivedAt)
    .map(legacyPathFromSnapshot)
    .filter((path) => path.id && path.sceneIds.length);
  const playedSituationIds = normalizePlayedSituationIds(
    input.playedSituationIds || input.playedSceneIds || input.completedSituationIds || []
  );
  const playedSceneIds = playedSituationIds.map(fromSituationId).filter(Boolean);
  const playedSet = new Set(playedSceneIds);
  const scenes = Array.from(new Set(paths.flatMap((path) => path.sceneIds)))
    .map((id) => ({ id, title: `Situatie #${id}`, isActive: true, archivedAt: "" }));
  const statuses = Graph.buildPathSceneStatuses({
    paths,
    scenes,
    playedSceneIds,
    crossingThresholds: (snapshot.crossingThresholds || []).map(legacyCrossingThreshold).filter((item) => item.sceneId),
  });
  const items = Array.from(statuses.values())
    .map((status) => mapStatus(status, playedSet))
    .sort((a, b) => a.legacySituationId - b.legacySituationId);

  return {
    schemaVersion: PATHS_EVALUATION_SCHEMA_VERSION,
    generatedAt: new Date().toISOString(),
    sourceSnapshotSchemaVersion: snapshot.schemaVersion,
    input: {
      playedSituationIds,
    },
    counts: {
      situations: items.length,
      available: items.filter((item) => item.status === "available").length,
      locked: items.filter((item) => item.status === "locked").length,
      blocked: items.filter((item) => item.status === "blocked").length,
      played: items.filter((item) => item.status === "played").length,
    },
    pathAvailable: items.filter((item) => item.status === "available").map((item) => item.situationId),
    pathLocked: items.filter((item) => item.pathLocked).map((item) => item.situationId),
    played: items.filter((item) => item.status === "played").map((item) => item.situationId),
    items,
  };
}

module.exports = {
  evaluatePaths,
  normalizePlayedSituationIds,
};
