#!/usr/bin/env node
"use strict";

const assert = require("node:assert/strict");
const {
  APPEARS_IN_EDGE,
  HAPPENS_IN_EDGE,
  buildNarrativeGraphData,
} = require("../public/narrative-graph");

const catalog = {
  characters: [
    { id: 1, name: "Mila", description: "Scherp", isActive: true },
    { id: 2, name: "Bo", description: "Droog", isActive: true },
    { id: 3, name: "Inactief", description: "", isActive: false },
  ],
  environments: [
    { id: 10, name: "Supermarkt", description: "Kassa's", isActive: true },
    { id: 11, name: "Perron", description: "Laat", isActive: true },
    { id: 12, name: "Archief", description: "", isActive: true, archivedAt: "2026-01-01T00:00:00.000Z" },
  ],
  scenes: [
    {
      id: 100,
      title: "Ruzie om bonuskaart",
      promptOverride: "Iemand wil punten sparen zonder kaart.",
      characterIds: [1, 2, 2, 999],
      characterSlots: [1, 0],
      environmentId: 10,
      environmentMode: "selected",
      isActive: true,
    },
    {
      id: 101,
      title: "Trein zonder trein",
      promptOverride: "",
      characterIds: [1],
      characterSlots: [],
      environmentId: 11,
      environmentMode: "selected",
      isActive: true,
    },
    {
      id: 102,
      title: "Random locatie",
      promptOverride: "",
      characterIds: [2],
      characterSlots: [],
      environmentId: 10,
      environmentMode: "random",
      isActive: true,
    },
    {
      id: 103,
      title: "Uitgezet",
      promptOverride: "",
      characterIds: [1],
      environmentId: 10,
      environmentMode: "selected",
      isActive: false,
    },
  ],
};

const graph = buildNarrativeGraphData(catalog);

assert.equal(graph.metadata.counts.characters, 2);
assert.equal(graph.metadata.counts.scenes, 3);
assert.equal(graph.metadata.counts.environments, 2);
assert.equal(graph.metadata.counts.characterSceneEdges, 4);
assert.equal(graph.metadata.counts.sceneEnvironmentEdges, 2);

const nodeById = new Map(graph.nodes.map((node) => [node.data.id, node]));
assert.equal(nodeById.get("character:1").data.sceneCount, 2);
assert.equal(nodeById.get("character:1").data.important, true);
assert.equal(nodeById.get("character:2").data.sceneCount, 2);
assert.equal(nodeById.get("scene:100").data.characterCount, 2);
assert.equal(nodeById.get("environment:10").data.sceneCount, 1);
assert.equal(nodeById.has("character:3"), false);
assert.equal(nodeById.has("environment:12"), false);

const appearsEdges = graph.edges.filter((edge) => edge.data.type === APPEARS_IN_EDGE);
const happensEdges = graph.edges.filter((edge) => edge.data.type === HAPPENS_IN_EDGE);
assert.deepEqual(
  appearsEdges.map((edge) => [edge.data.characterId, edge.data.sceneId]).sort(),
  [[1, 100], [1, 101], [2, 100], [2, 102]]
);
assert.deepEqual(
  happensEdges.map((edge) => [edge.data.sceneId, edge.data.environmentId]).sort(),
  [[100, 10], [101, 11]]
);
assert.equal(graph.indexes.scenesById.get(100).title, "Ruzie om bonuskaart");

console.log("PASS narrative graph data builder");
