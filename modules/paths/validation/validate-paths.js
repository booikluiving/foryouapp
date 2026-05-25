"use strict";

const { validatePathsSnapshotShape } = require("../../../shared/contracts/paths-v0");

function makeIssue(severity, code, entityType, entityId, message, extra = {}) {
  return { severity, code, entityType, entityId, message, ...extra };
}

function validatePathsSnapshot(snapshot) {
  const shapeIssues = validatePathsSnapshotShape(snapshot).map((item) => makeIssue(
    "error",
    item.code,
    "pathsSnapshot",
    "pathsSnapshot",
    item.message,
    { field: item.field || null }
  ));
  if (shapeIssues.length > 0) {
    return {
      ok: false,
      generatedAt: new Date().toISOString(),
      schemaVersion: snapshot && snapshot.schemaVersion ? snapshot.schemaVersion : null,
      counts: { errors: shapeIssues.length, warnings: 0, info: 0 },
      issues: shapeIssues,
    };
  }

  const issues = [];
  for (const path of snapshot.paths) {
    const nodeIds = new Set((path.nodes || []).map((node) => node.situationId));
    if (!path.name) {
      issues.push(makeIssue("error", "path_missing_name", "path", path.id, "Path has no name."));
    }
    if (path.active && !path.archivedAt && nodeIds.size === 0) {
      issues.push(makeIssue("warning", "active_path_without_nodes", "path", path.id, "Active path has no situations."));
    }
    for (const edge of path.edges || []) {
      if (!nodeIds.has(edge.fromSituationId)) {
        issues.push(makeIssue(
          "error",
          "edge_missing_from_situation",
          "pathEdge",
          edge.id,
          `Path edge references missing from situation ${edge.fromSituationId}.`,
          { pathId: path.id, refId: edge.fromSituationId }
        ));
      }
      if (!nodeIds.has(edge.toSituationId)) {
        issues.push(makeIssue(
          "error",
          "edge_missing_to_situation",
          "pathEdge",
          edge.id,
          `Path edge references missing to situation ${edge.toSituationId}.`,
          { pathId: path.id, refId: edge.toSituationId }
        ));
      }
    }
    for (const threshold of path.thresholds || []) {
      if (!nodeIds.has(threshold.situationId)) {
        issues.push(makeIssue(
          "error",
          "threshold_missing_situation",
          "pathThreshold",
          threshold.id,
          `Path threshold references missing situation ${threshold.situationId}.`,
          { pathId: path.id, refId: threshold.situationId }
        ));
      }
    }
    for (const blockRule of path.blockRules || []) {
      if (!nodeIds.has(blockRule.sourceSituationId)) {
        issues.push(makeIssue(
          "error",
          "block_rule_missing_situation",
          "pathBlockRule",
          blockRule.id,
          `Path block rule references missing situation ${blockRule.sourceSituationId}.`,
          { pathId: path.id, refId: blockRule.sourceSituationId }
        ));
      }
    }
  }

  const allSituationIds = new Set(snapshot.paths.flatMap((path) => path.situationIds || []));
  for (const threshold of snapshot.crossingThresholds) {
    if (!allSituationIds.has(threshold.situationId)) {
      issues.push(makeIssue(
        "error",
        "crossing_threshold_missing_situation",
        "crossingThreshold",
        threshold.id,
        `Crossing threshold references missing situation ${threshold.situationId}.`,
        { refId: threshold.situationId }
      ));
    }
  }

  const counts = issues.reduce((acc, item) => {
    if (item.severity === "error") acc.errors += 1;
    else if (item.severity === "warning") acc.warnings += 1;
    else acc.info += 1;
    return acc;
  }, { errors: 0, warnings: 0, info: 0 });

  return {
    ok: counts.errors === 0,
    generatedAt: new Date().toISOString(),
    schemaVersion: snapshot.schemaVersion,
    source: snapshot.source,
    snapshotCounts: snapshot.counts,
    counts,
    issues,
  };
}

module.exports = {
  validatePathsSnapshot,
};
