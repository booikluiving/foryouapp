"use strict";

const assert = require("node:assert/strict");

const { PATHS_SNAPSHOT_SCHEMA_VERSION } = require("../../../shared/contracts/paths-v0");
const { evaluatePaths } = require("../evaluation/evaluate-paths");
const Graph = require("../rules-engine/paden-graph");
const LayoutRelaxer = require("../editor/layout-relaxer");
const { validatePathsSnapshot } = require("../validation/validate-paths");

function relaxedRectsOverlap(a, b, padding = 8) {
  const rectA = LayoutRelaxer.rectForPosition(a.position, { nodeWidth: 170, nodeHeight: 46, padding });
  const rectB = LayoutRelaxer.rectForPosition(b.position, { nodeWidth: 170, nodeHeight: 46, padding });
  return LayoutRelaxer.rectsOverlap(rectA, rectB);
}

function fixtureSnapshot() {
  return {
    schemaVersion: PATHS_SNAPSHOT_SCHEMA_VERSION,
    generatedAt: "2026-01-01T00:00:00.000Z",
    source: { type: "fixture", readOnly: true },
    counts: {},
    paths: [
      {
        id: "path:1",
        legacyId: 1,
        name: "Main",
        active: true,
        archivedAt: null,
        situationIds: ["situation:1", "situation:2", "situation:3"],
        nodes: [
          { situationId: "situation:1", legacySituationId: 1, ignoreCrossingBlocks: false },
          { situationId: "situation:2", legacySituationId: 2, ignoreCrossingBlocks: false },
          { situationId: "situation:3", legacySituationId: 3, ignoreCrossingBlocks: false },
        ],
        edges: [
          { fromSituationId: "situation:1", toSituationId: "situation:2", edgeType: "required" },
          { fromSituationId: "situation:2", toSituationId: "situation:3", edgeType: "required" },
        ],
        thresholds: [],
        blockRules: [],
      },
    ],
    crossingThresholds: [],
  };
}

function crossingSnapshot() {
  return {
    schemaVersion: PATHS_SNAPSHOT_SCHEMA_VERSION,
    generatedAt: "2026-01-01T00:00:00.000Z",
    source: { type: "fixture", readOnly: true },
    counts: {},
    paths: [
      {
        id: "path:1",
        legacyId: 1,
        name: "A",
        active: true,
        archivedAt: null,
        situationIds: ["situation:1", "situation:6"],
        nodes: [
          { situationId: "situation:1", legacySituationId: 1, ignoreCrossingBlocks: false },
          { situationId: "situation:6", legacySituationId: 6, ignoreCrossingBlocks: false },
        ],
        edges: [{ fromSituationId: "situation:1", toSituationId: "situation:6", edgeType: "required" }],
        thresholds: [],
        blockRules: [],
      },
      {
        id: "path:2",
        legacyId: 2,
        name: "B",
        active: true,
        archivedAt: null,
        situationIds: ["situation:2", "situation:6"],
        nodes: [
          { situationId: "situation:2", legacySituationId: 2, ignoreCrossingBlocks: false },
          { situationId: "situation:6", legacySituationId: 6, ignoreCrossingBlocks: false },
        ],
        edges: [{ fromSituationId: "situation:2", toSituationId: "situation:6", edgeType: "required" }],
        thresholds: [],
        blockRules: [],
      },
    ],
    crossingThresholds: [
      { situationId: "situation:6", legacySituationId: 6, requiredCount: 2 },
    ],
  };
}

function localStartWithGlobalIncomingSnapshot() {
  return {
    schemaVersion: PATHS_SNAPSHOT_SCHEMA_VERSION,
    generatedAt: "2026-01-01T00:00:00.000Z",
    source: { type: "fixture", readOnly: true },
    counts: {},
    paths: [
      {
        id: "path:1",
        legacyId: 1,
        name: "Main",
        active: true,
        archivedAt: null,
        situationIds: ["situation:1", "situation:2"],
        nodes: [
          { situationId: "situation:1", legacySituationId: 1, ignoreCrossingBlocks: false },
          { situationId: "situation:2", legacySituationId: 2, ignoreCrossingBlocks: false },
        ],
        edges: [{ fromSituationId: "situation:1", toSituationId: "situation:2", edgeType: "required" }],
        thresholds: [],
        blockRules: [],
      },
      {
        id: "path:2",
        legacyId: 2,
        name: "Continuation",
        active: true,
        archivedAt: null,
        situationIds: ["situation:2", "situation:3"],
        nodes: [
          { situationId: "situation:2", legacySituationId: 2, ignoreCrossingBlocks: false },
          { situationId: "situation:3", legacySituationId: 3, ignoreCrossingBlocks: false },
        ],
        edges: [{ fromSituationId: "situation:2", toSituationId: "situation:3", edgeType: "required" }],
        thresholds: [],
        blockRules: [],
      },
    ],
    crossingThresholds: [],
  };
}

let evaluation = evaluatePaths(fixtureSnapshot(), {});
assert(evaluation.pathAvailable.includes("situation:1"), "start situation should be available");
assert(evaluation.pathLocked.includes("situation:2"), "locked successor should not be playable at start");
assert(!evaluation.pathAvailable.includes("situation:2"), "locked successor must not appear as available");

evaluation = evaluatePaths(fixtureSnapshot(), { playedSituationIds: ["situation:1"] });
assert(evaluation.played.includes("situation:1"));
assert(evaluation.pathAvailable.includes("situation:2"), "played predecessor unlocks successor");
assert(!evaluation.pathAvailable.includes("situation:1"), "played situations are not returned as available");
assert(evaluation.pathLocked.includes("situation:3"), "deeper successor remains locked");

evaluation = evaluatePaths(crossingSnapshot(), { playedSituationIds: ["situation:1"] });
assert(evaluation.pathLocked.includes("situation:6"), "crossing threshold keeps situation locked");
assert(!evaluation.pathAvailable.includes("situation:6"), "crossing locked situation is never available");

evaluation = evaluatePaths(crossingSnapshot(), { playedSituationIds: ["situation:1", "situation:2"] });
assert(evaluation.pathAvailable.includes("situation:6"), "crossing threshold unlocks after enough paths complete");

evaluation = evaluatePaths(localStartWithGlobalIncomingSnapshot(), {});
assert.deepEqual(evaluation.pathAvailable, ["situation:1"], "only true global start nodes are initially available");
assert(evaluation.pathLocked.includes("situation:2"), "local path starts with global incoming routes stay locked");

evaluation = evaluatePaths(localStartWithGlobalIncomingSnapshot(), { playedSituationIds: ["situation:1"] });
assert(evaluation.pathAvailable.includes("situation:2"), "global incoming route unlocks the continuation start");
assert.equal(evaluation.items.find((item) => item.situationId === "situation:2").isPathStart, false);

evaluation = evaluatePaths(localStartWithGlobalIncomingSnapshot(), { playedSituationIds: ["situation:2"] });
assert(evaluation.played.includes("situation:2"), "override seed is treated as played input");
assert(evaluation.pathAvailable.includes("situation:3"), "override seed unlocks downstream continuation");

let overrideStatuses = Graph.buildPathSceneStatuses({
  paths: [{
    id: 1,
    name: "Override fixture",
    sceneIds: [1, 2, 3],
    edges: [
      { fromSceneId: 1, toSceneId: 2 },
      { fromSceneId: 2, toSceneId: 3 },
    ],
    edgeMode: "manual",
    thresholds: [],
    isActive: true,
  }],
  scenes: [
    { id: 1, isActive: true },
    { id: 2, isActive: true },
    { id: 3, isActive: true },
  ],
  playedSceneIds: [2],
});
assert.equal(overrideStatuses.get(2).nodeStatus, "Played", "played mid-path node is still marked played");
assert.equal(overrideStatuses.get(3).nodeStatus, "Locked", "plain played mid-path facts do not rewrite reachability");

overrideStatuses = Graph.buildPathSceneStatuses({
  paths: [{
    id: 1,
    name: "Override fixture",
    sceneIds: [1, 2, 3],
    edges: [
      { fromSceneId: 1, toSceneId: 2 },
      { fromSceneId: 2, toSceneId: 3 },
    ],
    edgeMode: "manual",
    thresholds: [],
    isActive: true,
  }],
  scenes: [
    { id: 1, isActive: true },
    { id: 2, isActive: true },
    { id: 3, isActive: true },
  ],
  playedSceneIds: [2],
  seedSceneIds: [2],
});
assert.equal(overrideStatuses.get(2).nodeStatus, "Played", "override seed keeps the overridden node played");
assert.equal(overrideStatuses.get(3).nodeStatus, "Available", "override seed unlocks downstream successors without playing ancestors");

let relaxed = LayoutRelaxer.relaxLayout({
  visiblePathCount: 1,
  nodeWidth: 170,
  nodeHeight: 46,
  padding: 8,
  nodes: [
    { sceneId: 1, pathIds: ["a"], position: { x: 20, y: 20 } },
    { sceneId: 2, pathIds: ["a"], position: { x: 20, y: 20 } },
  ],
  pathPositions: new Map([["a", { 1: { x: 20, y: 20 }, 2: { x: 20, y: 20 } }]]),
});
assert.equal(relaxed.enabled, false, "single visible path should keep layout relaxer disabled");
assert.deepEqual(relaxed.nodes.map((node) => node.position), [{ x: 20, y: 20 }, { x: 20, y: 20 }]);

relaxed = LayoutRelaxer.relaxLayout({
  visiblePathCount: 2,
  activePathId: "active",
  nodeWidth: 170,
  nodeHeight: 46,
  padding: 8,
  nodes: [
    { sceneId: 1, pathIds: ["active"], position: { x: 40, y: 40 } },
    { sceneId: 2, pathIds: ["other"], position: { x: 40, y: 40 } },
  ],
  pathPositions: new Map([
    ["active", { 1: { x: 40, y: 40 } }],
    ["other", { 2: { x: 40, y: 40 } }],
  ]),
});
assert.equal(relaxed.enabled, true, "multiple visible paths should enable layout relaxer");
assert.deepEqual(relaxed.nodes.find((node) => node.sceneId === 1).relaxOffset, { x: 0, y: 0 }, "active path node should stay stable");
assert.notDeepEqual(relaxed.nodes.find((node) => node.sceneId === 2).relaxOffset, { x: 0, y: 0 }, "colliding non-active node should move");
assert.equal(relaxedRectsOverlap(relaxed.nodes[0], relaxed.nodes[1]), false, "relaxed nodes should not overlap");
assert.deepEqual(relaxed.pathPositions.get("other")[2], relaxed.nodes.find((node) => node.sceneId === 2).position, "path positions should use relaxed display position");

relaxed = LayoutRelaxer.relaxLayout({
  visiblePathCount: 2,
  activePathId: "active",
  nodeWidth: 170,
  nodeHeight: 46,
  padding: 8,
  rowTolerance: 36,
  nodes: [
    { sceneId: 10, pathIds: ["active"], position: { x: 40, y: 100 } },
    { sceneId: 11, pathIds: ["other"], position: { x: 40, y: 118 } },
  ],
  pathPositions: new Map([
    ["active", { 10: { x: 40, y: 100 } }],
    ["other", { 11: { x: 40, y: 118 } }],
  ]),
});
assert.equal(
  relaxed.nodes.find((node) => node.sceneId === 11).position.y,
  relaxed.nodes.find((node) => node.sceneId === 10).position.y,
  "nearby relaxed nodes should stay on the leading row"
);
assert.deepEqual(relaxed.nodes.find((node) => node.sceneId === 11).relaxOffset, { x: 190, y: -18 }, "row alignment offset should remain explicit and unsaved");

relaxed = LayoutRelaxer.relaxLayout({
  visiblePathCount: 2,
  activePathId: "active",
  nodeWidth: 170,
  nodeHeight: 46,
  padding: 8,
  nodes: [
    { sceneId: 20, pathIds: ["other"], position: { x: 0, y: 200 } },
    { sceneId: 21, pathIds: ["active"], position: { x: 500, y: 200 } },
    { sceneId: 22, pathIds: ["other"], position: { x: 1200, y: 200 } },
  ],
  pathPositions: new Map([
    ["other", { 20: { x: 0, y: 200 }, 22: { x: 1200, y: 200 } }],
    ["active", { 21: { x: 500, y: 200 } }],
  ]),
});
const compactLeft = relaxed.nodes.find((node) => node.sceneId === 20).position;
const compactAnchor = relaxed.nodes.find((node) => node.sceneId === 21).position;
const compactRight = relaxed.nodes.find((node) => node.sceneId === 22).position;
assert.equal(compactAnchor.x, 500, "active row anchor should stay stable during row compaction");
assert(compactAnchor.x - compactLeft.x <= 190, "loose left-side row gaps should compact");
assert(compactRight.x - compactAnchor.x <= 190, "loose right-side row gaps should compact");
assert.equal(relaxedRectsOverlap(relaxed.nodes.find((node) => node.sceneId === 20), relaxed.nodes.find((node) => node.sceneId === 21)), false, "compacted left node should not overlap anchor");
assert.equal(relaxedRectsOverlap(relaxed.nodes.find((node) => node.sceneId === 21), relaxed.nodes.find((node) => node.sceneId === 22)), false, "compacted right node should not overlap anchor");

const validation = validatePathsSnapshot(fixtureSnapshot());
assert.equal(validation.ok, true);
assert.equal(validation.counts.errors, 0);

process.stdout.write(JSON.stringify({
  ok: true,
  assertions: [
    "start situations are available",
    "path locked situations are never available",
    "played facts unlock successors",
    "crossing thresholds can lock and unlock",
    "local path starts with global incoming routes are not initial candidates",
    "override-style played seed unlocks downstream continuation",
    "testpad override seeds downstream reachability without playing ancestors",
    "multi-path layout relaxer separates colliding visible nodes",
    "multi-path layout relaxer preserves nearby leading rows",
    "multi-path layout relaxer compacts loose row gaps",
  ],
}, null, 2));
process.stdout.write("\n");
