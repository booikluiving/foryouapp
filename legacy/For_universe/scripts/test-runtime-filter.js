#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const rootDir = path.resolve(__dirname, "..");
const adapterPath = path.join(rootDir, "src", "public", "sky-data-adapter.js");
const { buildRuntimeState } = require(path.join(rootDir, "src", "domain", "runtime-state"));

global.window = {
  ForUniverseLayout: {
    applyLayout: (paths) => paths,
  },
};

vm.runInThisContext(fs.readFileSync(adapterPath, "utf8"), { filename: adapterPath });

const Data = global.window.ForUniverseData;

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function buildModel(runtime) {
  return Data.buildSkyModel({
    paths: [
      {
        pathId: 1,
        name: "Testpad",
        color: "#ffffff",
        sortOrder: 10,
        isActive: true,
        nodes: [
          { sceneId: 1, pathId: 1, pathIndex: 0, title: "Start", role: "entry", isEntryNode: true, isActive: true },
          { sceneId: 2, pathId: 1, pathIndex: 1, title: "Vervolg", role: "middle", isActive: true },
        ],
        edges: [
          { edgeId: 1, fromSceneId: 1, toSceneId: 2, type: "required", sortOrder: 10 },
        ],
      },
    ],
    looseScenes: [
      { sceneId: 3, title: "Los", isActive: true, sortOrder: 30 },
    ],
    crossings: [],
    summary: { pathCount: 1, nodeCount: 2, edgeCount: 1, looseSceneCount: 1 },
  }, runtime);
}

const noRun = buildModel({
  session: { id: 17, isActive: true, algorithmRunStarted: false },
  currentScene: null,
  playedSceneIds: [],
  preparedNextScenes: [],
  summary: { hasActiveRun: false },
});
assert(noRun.runtime.isReleaseLimited === false, "No run should not release-limit the universe");
assert(Data.statusForScene(2, noRun.runtime) === "", "No run should not add runtime status styling");

const staleOpenSession = buildModel({
  session: { id: 17, isActive: true, algorithmRunStarted: true },
  currentScene: null,
  playedSceneIds: [1],
  preparedNextScenes: [{ sceneId: 2 }],
  summary: { hasActiveRun: false },
});
assert(staleOpenSession.runtime.isReleaseLimited === false, "Run-start flag without current run should not release-limit");

const activeRun = buildModel({
  session: { id: 17, isActive: true, algorithmRunStarted: true },
  currentScene: { sceneId: 1 },
  playedSceneIds: [],
  preparedNextScenes: [{ sceneId: 2 }],
  availableScenes: [{ sceneId: 3, nodeStatus: "Available" }],
  summary: { hasActiveRun: true },
});
assert(activeRun.runtime.isReleaseLimited === true, "Active current scene should release-limit the universe");
assert(activeRun.runtime.releasedSceneIds.has(1), "Current scene should be released");
assert(activeRun.runtime.releasedSceneIds.has(2), "Prepared next scene should be released");
assert(activeRun.runtime.releasedSceneIds.has(3), "Algorithm available scene should be released");
assert(Data.statusForScene(3, activeRun.runtime) === "available", "Algorithm available scene should get available status");

const serverRuntime = buildRuntimeState({
  currentSession: { id: 17, name: "Test", endedAt: "" },
  runs: [],
  activeRun: null,
  settings: {
    runStarted: { value: "0" },
    lockedQueue: { value: "[]" },
  },
  appRuntime: {
    algorithmRun: { started: true },
    activeRun: { id: 91, sessionId: 17, sceneId: 1, endedAt: "" },
    availableScenes: [
      { sceneId: 2, title: "Vervolg", nodeStatus: "Available" },
      { sceneId: 3, title: "Los", nodeStatus: "Available" },
    ],
  },
}, {
  paths: [
    {
      pathId: 1,
      name: "Testpad",
      nodes: [
        { sceneId: 1, title: "Start", pathMemberships: [{ pathId: 1, pathName: "Testpad" }] },
        { sceneId: 2, title: "Vervolg", pathMemberships: [{ pathId: 1, pathName: "Testpad" }] },
      ],
      edges: [{ fromSceneId: 1, toSceneId: 2 }],
    },
  ],
  looseScenes: [{ sceneId: 3, title: "Los" }],
});
assert(serverRuntime.session.algorithmRunStarted === true, "App algorithm state should override stale run-start setting");
assert(serverRuntime.summary.availableCount === 2, "Server runtime should expose app available scene count");
assert(serverRuntime.availableScenes.map((scene) => scene.sceneId).join(",") === "2,3", "Server runtime should expose app available scenes");

console.log("Universe runtime-filter tests passed");
