#!/usr/bin/env node
"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { buildGraph } = require("../src/domain/normalize-paths");

const graph = buildGraph({
  paths: [
    { id: 1, name: "Pad A", sortOrder: 1, isActive: 1 },
    { id: 2, name: "Pad B", sortOrder: 2, isActive: 1 },
  ],
  pathScenes: [
    { id: 1, pathId: 1, sceneId: 10, sortOrder: 1 },
    { id: 2, pathId: 1, sceneId: 20, sortOrder: 2 },
    { id: 3, pathId: 2, sceneId: 20, sortOrder: 1 },
    { id: 4, pathId: 2, sceneId: 30, sortOrder: 2 },
  ],
  pathEdges: [
    { id: 1, pathId: 1, fromSceneId: 10, toSceneId: 20, edgeType: "required", sortOrder: 1 },
    { id: 2, pathId: 2, fromSceneId: 20, toSceneId: 30, edgeType: "required", sortOrder: 1 },
    { id: 3, pathId: 2, fromSceneId: 20, toSceneId: 30, edgeType: "optional", sortOrder: 2 },
  ],
  thresholds: [],
  nodeBlocks: [],
  scenes: [
    { id: 10, title: "Start", sortOrder: 1, isActive: 1 },
    { id: 20, title: "Kruising", sortOrder: 2, isActive: 1 },
    { id: 30, title: "Eind", sortOrder: 3, isActive: 1 },
    { id: 40, title: "Los", sortOrder: 4, isActive: 1 },
  ],
});

assert.equal(graph.networkMap.nodes.length, 4, "Network map should use unique scenes plus loose scenes");
assert.equal(graph.networkMap.edges.length, 2, "Network map should aggregate duplicate scene-pair edges");

const crossing = graph.networkMap.nodes.find((node) => node.sceneId === 20);
assert.ok(crossing, "Crossing scene should exist as a single network node");
assert.equal(crossing.membershipCount, 2, "Crossing scene should preserve path memberships");
assert.equal(crossing.isCrossingNode, true, "Crossing scene should be marked");

const duplicateEdge = graph.networkMap.edges.find((edge) => edge.fromSceneId === 20 && edge.toSceneId === 30);
assert.ok(duplicateEdge, "Aggregated duplicate edge should exist");
assert.equal(duplicateEdge.count, 2, "Duplicate edge should retain source edge count");
assert.equal(duplicateEdge.pathCount, 1, "Duplicate edge inside one path should not invent extra paths");
assert.equal(duplicateEdge.isMultiPath, true, "Duplicate edge should still be marked as structurally strong");

assert.equal(graph.networkMap.summary.componentCount, 2, "Loose scene should remain its own component");
assert.equal(graph.networkMap.summary.largestComponentSize, 3, "Connected path scenes should form the largest component");
assert.equal(graph.networkMap.summary.isolatedNodeCount, 1, "Loose scene should be isolated");

const rendererSource = fs.readFileSync(path.join(__dirname, "..", "src", "public", "sky-renderer.js"), "utf8");
assert.equal(
  rendererSource.includes("state.tweaks.labels || status"),
  false,
  "Runtime status should not force network labels when the labels toggle is off"
);

console.log("Universe network-map tests passed");
