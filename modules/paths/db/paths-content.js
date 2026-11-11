"use strict";

const { hashJson } = require("../../../shared/sync/content-hash");

// The paths store is all content; nextPathId is left out of the hash for the same
// reason as the catalog counters.
function pathsContent(store) {
  return {
    schemaVersion: store.schemaVersion,
    nextPathId: Number(store.nextPathId) || 1,
    paths: JSON.parse(JSON.stringify(store.paths || [])),
    crossingThresholds: JSON.parse(JSON.stringify(store.crossingThresholds || [])),
  };
}

function pathsContentHash(content) {
  return hashJson({
    schemaVersion: content.schemaVersion,
    paths: content.paths || [],
    crossingThresholds: content.crossingThresholds || [],
  });
}

function pathsContentIssues(content, expectedSchemaVersion) {
  const issues = [];
  if (!content || typeof content !== "object" || Array.isArray(content)) return [{ code: "content_missing" }];
  if (expectedSchemaVersion && content.schemaVersion !== expectedSchemaVersion) {
    issues.push({ code: "schema_version_mismatch", expected: expectedSchemaVersion, actual: content.schemaVersion || null });
  }
  if (!Array.isArray(content.paths)) issues.push({ code: "collection_missing", collection: "paths" });
  if (!Array.isArray(content.crossingThresholds)) issues.push({ code: "collection_missing", collection: "crossingThresholds" });
  return issues;
}

function withPathsContent(store, content) {
  return {
    ...store,
    nextPathId: Math.max(Number(store.nextPathId) || 1, Number(content.nextPathId) || 1),
    paths: JSON.parse(JSON.stringify(content.paths)),
    crossingThresholds: JSON.parse(JSON.stringify(content.crossingThresholds)),
  };
}

module.exports = {
  pathsContent,
  pathsContentHash,
  pathsContentIssues,
  withPathsContent,
};
