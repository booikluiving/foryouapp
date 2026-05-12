#!/usr/bin/env node
"use strict";

const assert = require("node:assert/strict");
const Graph = require("../public/paden-graph");

const splitPath = {
  id: 1,
  name: "Split merge",
  sceneIds: [1, 2, 3, 4],
  edges: [
    { fromSceneId: 1, toSceneId: 2 },
    { fromSceneId: 1, toSceneId: 3 },
    { fromSceneId: 2, toSceneId: 4 },
    { fromSceneId: 3, toSceneId: 4 },
  ],
  isActive: true,
};

const ranks = Graph.computeRanks(splitPath.sceneIds, splitPath.edges);
assert.equal(ranks.get(1), 0);
assert.equal(ranks.get(2), 1);
assert.equal(ranks.get(3), 1);
assert.equal(ranks.get(4), 2);

const layout = Graph.computePathLayout(splitPath);
assert.equal(layout.positions[2].y, layout.positions[3].y);
assert.notEqual(layout.positions[2].x, layout.positions[3].x);
assert.equal(layout.positions[4].y > layout.positions[2].y, true);

const optionalRanks = Graph.computeRanks(
  [1, 2, 3],
  [
    { fromSceneId: 1, toSceneId: 2 },
    { fromSceneId: 1, toSceneId: 3, edgeType: "optional" },
  ]
);
assert.equal(optionalRanks.get(2), 1);
assert.equal(optionalRanks.get(3), 0);

assert.deepEqual(
  Graph.pathEndpoints({
    sceneIds: [1, 2, 3],
    edges: [
      { fromSceneId: 1, toSceneId: 2 },
      { fromSceneId: 1, toSceneId: 3, edgeType: "optional" },
    ],
    edgeMode: "manual",
  }, { connectedOnly: true }),
  { starts: [1], ends: [2] }
);

assert.deepEqual(
  Graph.normalizeEdges([{ fromSceneId: 1, toSceneId: 2, edgeType: "optional" }], [1, 2]),
  [{ fromSceneId: 1, toSceneId: 2, edgeType: "optional" }]
);

assert.deepEqual(
  Graph.getRenderableEdges({ sceneIds: [7, 8, 9], edges: [] }),
  [
    { fromSceneId: 7, toSceneId: 8 },
    { fromSceneId: 8, toSceneId: 9 },
  ]
);

assert.deepEqual(
  Graph.getRenderableEdges({ sceneIds: [7, 8, 9], edges: [], edgeMode: "manual" }),
  []
);

assert.deepEqual(
  Graph.pathEndpoints({ sceneIds: [7, 8], edges: [], edgeMode: "manual" }),
  { starts: [7, 8], ends: [7, 8] }
);

assert.deepEqual(
  Graph.pathEndpoints({ sceneIds: [7, 8], edges: [], edgeMode: "manual" }, { connectedOnly: true }),
  { starts: [], ends: [] }
);

assert.deepEqual(
  Graph.pathEndpoints({
    sceneIds: [7, 8, 9],
    edges: [{ fromSceneId: 7, toSceneId: 8 }, { fromSceneId: 7, toSceneId: 9 }],
    edgeMode: "manual",
  }, { connectedOnly: true }),
  { starts: [7], ends: [8, 9] }
);

assert.equal(
  Graph.edgeCandidateIssue({
    sceneIds: [1, 2, 3],
    edges: [{ fromSceneId: 1, toSceneId: 2 }],
    edgeMode: "manual",
  }, 1, 3),
  ""
);

assert.equal(
  Graph.edgeCandidateIssue({
    sceneIds: [1, 2, 3],
    edges: [{ fromSceneId: 1, toSceneId: 2 }],
    edgeMode: "manual",
  }, 2, 3),
  ""
);

assert.equal(
  Graph.edgeCandidateIssue({
    sceneIds: [1, 2, 3],
    edges: [{ fromSceneId: 1, toSceneId: 2 }],
    edgeMode: "manual",
  }, 3, 1),
  ""
);

assert.equal(
  Graph.edgeCandidateIssue({
    sceneIds: [1, 2, 3, 4],
    edges: [{ fromSceneId: 1, toSceneId: 2 }],
    edgeMode: "manual",
  }, 3, 4),
  "path_disconnected_components:2"
);

assert.equal(
  Graph.edgeCandidateIssue({
    sceneIds: [1, 2, 3],
    edges: [{ fromSceneId: 1, toSceneId: 3 }],
    edgeMode: "manual",
  }, 2, 3),
  ""
);

assert.deepEqual(
  Graph.connectedSceneIds([1, 2, 3], [{ fromSceneId: 1, toSceneId: 2 }]),
  [1, 2]
);

assert.equal(
  Graph.connectedComponentCount(
    [1, 2, 3, 4],
    [{ fromSceneId: 1, toSceneId: 2 }, { fromSceneId: 3, toSceneId: 4 }]
  ),
  2
);

assert.equal(
  Graph.edgeCandidateIssue({
    sceneIds: [1, 2, 3],
    edges: [{ fromSceneId: 1, toSceneId: 2 }, { fromSceneId: 2, toSceneId: 3 }],
    edgeMode: "manual",
  }, 3, 1),
  "path_cycle:3"
);

assert.equal(
  Graph.edgeCandidateIssue({
    sceneIds: [1, 2, 3],
    edges: [{ fromSceneId: 1, toSceneId: 2 }, { fromSceneId: 1, toSceneId: 3 }],
    edgeMode: "manual",
  }, 2, 3),
  ""
);

assert.deepEqual(
  Graph.normalizeEdges(
    [
      { fromSceneId: 1, toSceneId: 2 },
      { fromSceneId: 1, toSceneId: 2 },
      { fromSceneId: 2, toSceneId: 999 },
      { fromSceneId: 3, toSceneId: 3 },
    ],
    [1, 2, 3]
  ),
  [{ fromSceneId: 1, toSceneId: 2 }]
);

assert.deepEqual(
  Graph.normalizeThresholdsForEdges(
    [
      { sourceSceneId: 1, requiredCount: 2 },
      { sourceSceneId: 2, requiredCount: 1 },
      { sourceSceneId: 3, requiredCount: 9 },
    ],
    [1, 2, 3, 4],
    [
      { fromSceneId: 1, toSceneId: 2 },
      { fromSceneId: 1, toSceneId: 3 },
      { fromSceneId: 1, toSceneId: 4 },
      { fromSceneId: 3, toSceneId: 2 },
      { fromSceneId: 3, toSceneId: 4 },
    ]
  ),
  [{ sourceSceneId: 1, requiredCount: 2 }]
);

assert.equal(
  Graph.thresholdMapForPath({
    sceneIds: [1, 2, 3],
    edges: [{ fromSceneId: 1, toSceneId: 2 }, { fromSceneId: 1, toSceneId: 3 }],
    edgeMode: "manual",
    thresholds: [{ sourceSceneId: 1, requiredCount: 1 }],
  }).get(1),
  1
);

const crossingPaths = [
  { id: 1, name: "A", sceneIds: [1, 4], edges: [{ fromSceneId: 1, toSceneId: 4 }], isActive: true },
  { id: 2, name: "B", sceneIds: [2, 4], edges: [{ fromSceneId: 2, toSceneId: 4 }], isActive: true },
  { id: 3, name: "C", sceneIds: [3, 4], edges: [{ fromSceneId: 3, toSceneId: 4, edgeType: "optional" }], isActive: true },
];
assert.deepEqual(
  Graph.crossingIncomingRoutesForPaths(crossingPaths, 4).map((route) => [route.pathId, route.fromSceneId]),
  [[1, 1], [2, 2]]
);
assert.deepEqual(
  Graph.normalizeCrossingThresholdsForPaths([{ sceneId: 4, requiredCount: 1 }], crossingPaths),
  [{ sceneId: 4, requiredCount: 1 }]
);

const membership = Graph.analyzePathMembership([
  { id: 1, name: "A", color: "#14b8a6", sceneIds: [1, 2], isActive: true },
  { id: 2, name: "B", color: "#f97316", sceneIds: [2, 3], isActive: true },
  { id: 3, name: "Archived", color: "#000", sceneIds: [2], isActive: true, archivedAt: "2026-01-01" },
]);
assert.equal(membership.get(2).length, 2);
assert.deepEqual(membership.get(2).map((item) => item.name), ["A", "B"]);

const ghosts = Graph.selectGhostNeighbors(
  { id: 1, name: "Active", sceneIds: [10, 20], edges: [{ fromSceneId: 10, toSceneId: 20 }], isActive: true },
  [
    { id: 1, name: "Active", sceneIds: [10, 20], edges: [{ fromSceneId: 10, toSceneId: 20 }], isActive: true },
    {
      id: 2,
      name: "Other",
      color: "#f97316",
      sceneIds: [5, 20, 30],
      edges: [{ fromSceneId: 5, toSceneId: 20 }, { fromSceneId: 20, toSceneId: 30 }],
      isActive: true,
    },
  ],
  { visiblePathIds: new Set(["2"]) }
);
assert.deepEqual(
  ghosts
    .map((item) => [item.sceneId, item.fromSceneId, item.direction])
    .sort((a, b) => a[0] - b[0]),
  [[5, 20, "prev"], [30, 20, "next"]]
);

const multiSelectionGhosts = Graph.selectGhostNeighbors(
  { id: "__selected__", sceneIds: [10, 20, 40], edges: [], isActive: true },
  [
    { id: 1, name: "Selected A", sceneIds: [10, 20], edges: [{ fromSceneId: 10, toSceneId: 20 }], isActive: true },
    { id: 2, name: "Selected B", sceneIds: [20, 40], edges: [{ fromSceneId: 20, toSceneId: 40 }], isActive: true },
    {
      id: 3,
      name: "Outside",
      color: "#3b82f6",
      sceneIds: [4, 20, 41],
      edges: [{ fromSceneId: 4, toSceneId: 20 }, { fromSceneId: 20, toSceneId: 41 }],
      isActive: true,
    },
  ],
  { activeSceneIds: [10, 20, 40], excludePathIds: new Set(["1", "2"]) }
);
assert.deepEqual(
  multiSelectionGhosts
    .map((item) => [item.pathId, item.sceneId, item.fromSceneId, item.direction])
    .sort((a, b) => a[1] - b[1]),
  [[3, 4, 20, "prev"], [3, 41, 20, "next"]]
);

console.log("PASS paden graph helpers");
