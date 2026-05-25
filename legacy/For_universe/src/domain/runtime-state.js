"use strict";

function numberValue(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function boolFromSetting(value) {
  const clean = String(value ?? "").trim().toLowerCase();
  return clean === "1" || clean === "true" || clean === "yes";
}

function textValue(value, fallback = "") {
  return String(value ?? fallback);
}

function parseJsonArray(value) {
  try {
    const parsed = JSON.parse(String(value || "[]"));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function sortRuns(runs = []) {
  return (Array.isArray(runs) ? runs : [])
    .slice()
    .sort((a, b) => {
      const byOrder = numberValue(a.runOrder) - numberValue(b.runOrder);
      if (byOrder) return byOrder;
      return numberValue(a.id) - numberValue(b.id);
    });
}

function buildSceneIndex(graph = {}) {
  const index = new Map();
  for (const pathItem of Array.isArray(graph.paths) ? graph.paths : []) {
    for (const node of Array.isArray(pathItem.nodes) ? pathItem.nodes : []) {
      const sceneId = numberValue(node.sceneId);
      if (!sceneId) continue;
      const existing = index.get(sceneId) || {};
      const memberships = Array.isArray(node.pathMemberships) ? node.pathMemberships : [];
      index.set(sceneId, {
        sceneId,
        title: node.title || existing.title || `Scene ${sceneId}`,
        role: node.role || existing.role || "",
        pathMemberships: memberships.length ? memberships : existing.pathMemberships || [],
      });
    }
  }
  for (const scene of Array.isArray(graph.looseScenes) ? graph.looseScenes : []) {
    const sceneId = numberValue(scene.sceneId);
    if (!sceneId || index.has(sceneId)) continue;
    index.set(sceneId, {
      sceneId,
      title: scene.title || `Scene ${sceneId}`,
      role: "unassigned",
      pathMemberships: [],
    });
  }
  return index;
}

function sceneSnapshot(sceneId, sceneIndex) {
  const safeSceneId = numberValue(sceneId);
  const scene = sceneIndex.get(safeSceneId);
  return {
    sceneId: safeSceneId,
    title: scene ? scene.title : `Scene ${safeSceneId}`,
    role: scene ? scene.role : "",
    pathMemberships: scene ? scene.pathMemberships : [],
  };
}

function runSnapshot(run, sceneIndex) {
  if (!run) return null;
  const scene = sceneSnapshot(run.sceneId, sceneIndex);
  return {
    runId: numberValue(run.id),
    sessionId: numberValue(run.sessionId),
    runOrder: numberValue(run.runOrder),
    sceneId: scene.sceneId,
    title: scene.title,
    role: scene.role,
    pathMemberships: scene.pathMemberships,
    selectionSource: textValue(run.selectionSource),
    startedAt: textValue(run.startedAt),
    endedAt: textValue(run.endedAt),
    isActive: !run.endedAt,
    score: run.score === null || run.score === undefined ? null : Number(run.score),
    reason: textValue(run.reason),
  };
}

function normalizeLockedQueue(rawValue, sceneIndex) {
  return parseJsonArray(rawValue)
    .map((entry, index) => {
      const scene = sceneSnapshot(entry && entry.sceneId, sceneIndex);
      if (!scene.sceneId) return null;
      return {
        position: numberValue(entry.position, index + 1),
        sceneId: scene.sceneId,
        title: scene.title,
        role: scene.role,
        pathMemberships: scene.pathMemberships,
        source: textValue(entry.source, "queue"),
        lockedAt: textValue(entry.lockedAt),
        randomSeed: textValue(entry.randomSeed),
      };
    })
    .filter(Boolean)
    .sort((a, b) => a.position - b.position || a.sceneId - b.sceneId);
}

function normalizeRuntimeScenes(items, sceneIndex, source = "runtime") {
  const seen = new Set();
  return (Array.isArray(items) ? items : [])
    .map((entry, index) => {
      const scene = sceneSnapshot(entry && (entry.sceneId || entry.id), sceneIndex);
      if (!scene.sceneId || seen.has(scene.sceneId)) return null;
      seen.add(scene.sceneId);
      return {
        position: numberValue(entry && entry.position, index + 1),
        sceneId: scene.sceneId,
        title: entry && entry.title ? textValue(entry.title) : scene.title,
        role: scene.role,
        pathMemberships: scene.pathMemberships,
        source: textValue(entry && entry.source, source),
        nodeStatus: textValue(entry && entry.nodeStatus),
        active: !!(entry && entry.active),
        next: !!(entry && entry.next),
        available: !!(entry && entry.available),
        played: !!(entry && entry.played),
        locked: !!(entry && entry.locked),
        blocked: !!(entry && entry.blocked),
        reason: textValue(entry && entry.reason),
        score: entry && entry.score !== null && entry.score !== undefined ? Number(entry.score) : null,
      };
    })
    .filter(Boolean)
    .sort((a, b) => a.position - b.position || a.sceneId - b.sceneId);
}

function pathById(graph = {}) {
  return new Map((Array.isArray(graph.paths) ? graph.paths : []).map((pathItem) => [numberValue(pathItem.pathId), pathItem]));
}

function inferActivePathCandidates(currentScene, previousRun, graph = {}) {
  if (!currentScene || !currentScene.sceneId) return [];
  const memberships = Array.isArray(currentScene.pathMemberships) ? currentScene.pathMemberships : [];
  if (!memberships.length) return [];

  const paths = pathById(graph);
  const directCandidates = memberships.map((membership) => {
    const pathItem = paths.get(numberValue(membership.pathId));
    return {
      pathId: numberValue(membership.pathId),
      name: membership.pathName || (pathItem ? pathItem.name : `Pad ${membership.pathId}`),
      color: membership.color || (pathItem ? pathItem.color : ""),
      confidence: memberships.length === 1 ? "direct" : "ambiguous",
      reason: memberships.length === 1 ? "current_scene_single_path" : "current_scene_crossing",
    };
  });

  const previousSceneId = numberValue(previousRun && previousRun.sceneId);
  if (!previousSceneId || memberships.length <= 1) return directCandidates;

  const inferred = directCandidates.filter((candidate) => {
    const pathItem = paths.get(candidate.pathId);
    return !!(pathItem && Array.isArray(pathItem.edges) && pathItem.edges.some((edge) => (
      numberValue(edge.fromSceneId) === previousSceneId
      && numberValue(edge.toSceneId) === currentScene.sceneId
    )));
  });

  if (!inferred.length) return directCandidates;
  return inferred.map((candidate) => ({
    ...candidate,
    confidence: "inferred",
    reason: "previous_scene_edge_to_current",
  }));
}

function graphNextScenes(currentScene, activePathCandidates, graph = {}, sceneIndex, playedSceneIds) {
  if (!currentScene || !currentScene.sceneId) return [];
  const paths = pathById(graph);
  const seen = new Set();
  const out = [];

  for (const candidate of activePathCandidates) {
    const pathItem = paths.get(numberValue(candidate.pathId));
    if (!pathItem) continue;
    for (const edge of Array.isArray(pathItem.edges) ? pathItem.edges : []) {
      if (numberValue(edge.fromSceneId) !== currentScene.sceneId) continue;
      const targetSceneId = numberValue(edge.toSceneId);
      const key = `${candidate.pathId}:${targetSceneId}:${edge.type || ""}`;
      if (!targetSceneId || seen.has(key)) continue;
      seen.add(key);
      const target = sceneSnapshot(targetSceneId, sceneIndex);
      out.push({
        pathId: candidate.pathId,
        pathName: candidate.name,
        color: candidate.color,
        sceneId: target.sceneId,
        title: target.title,
        edgeType: textValue(edge.type, "required") || "required",
        alreadyPlayed: playedSceneIds.has(target.sceneId),
        source: "graph_edge",
      });
    }
  }

  return out;
}

function buildRuntimeState(runtimeSource = {}, graph = {}) {
  const appRuntime = runtimeSource.appRuntime && typeof runtimeSource.appRuntime === "object"
    ? runtimeSource.appRuntime
    : {};
  const sceneIndex = buildSceneIndex(graph);
  const runs = sortRuns(runtimeSource.runs || []);
  const activeRun = appRuntime.activeRun || runtimeSource.activeRun || runs.find((run) => !run.endedAt) || null;
  const playedRuns = runs.filter((run) => !!run.endedAt);
  const playedSceneIds = new Set(playedRuns.map((run) => numberValue(run.sceneId)).filter(Boolean));
  const previousRun = playedRuns.length ? playedRuns[playedRuns.length - 1] : null;
  const currentScene = runSnapshot(activeRun, sceneIndex)
    || normalizeRuntimeScenes(appRuntime.activeScene ? [appRuntime.activeScene] : [], sceneIndex, "algorithm_active_scene")[0]
    || null;
  const preparedNextScenes = normalizeLockedQueue(
    runtimeSource.settings && runtimeSource.settings.lockedQueue
      ? runtimeSource.settings.lockedQueue.value
      : "[]",
    sceneIndex
  );
  const availableScenes = normalizeRuntimeScenes(appRuntime.availableScenes, sceneIndex, "algorithm_current_order");
  const activePathCandidates = inferActivePathCandidates(currentScene, previousRun, graph);
  const appSession = appRuntime.session && typeof appRuntime.session === "object" ? appRuntime.session : null;
  const appAlgorithmRun = appRuntime.algorithmRun && typeof appRuntime.algorithmRun === "object" ? appRuntime.algorithmRun : null;
  const session = runtimeSource.currentSession || appSession;
  const algorithmRunStarted = typeof (appAlgorithmRun && appAlgorithmRun.started) === "boolean"
    ? appAlgorithmRun.started
    : boolFromSetting(runtimeSource.settings && runtimeSource.settings.runStarted
      ? runtimeSource.settings.runStarted.value
      : "");

  return {
    session: session ? {
      id: numberValue(session.id),
      name: textValue(session.name),
      startedAt: textValue(session.startedAt),
      endedAt: textValue(session.endedAt),
      updatedAt: textValue(session.updatedAt),
      isActive: typeof session.isActive === "boolean" ? session.isActive : !session.endedAt,
      algorithmRunStarted,
    } : null,
    currentScene,
    activePathCandidates,
    playedScenes: playedRuns.map((run) => runSnapshot(run, sceneIndex)).filter(Boolean),
    playedSceneIds: Array.from(playedSceneIds),
    preparedNextScenes,
    availableScenes,
    graphNextScenes: graphNextScenes(currentScene, activePathCandidates, graph, sceneIndex, playedSceneIds),
    latestCompletedScene: runSnapshot(previousRun, sceneIndex),
    summary: {
      runCount: runs.length,
      playedCount: playedRuns.length,
      hasActiveRun: !!currentScene,
      preparedNextCount: preparedNextScenes.length,
      availableCount: availableScenes.length,
      activePathCandidateCount: activePathCandidates.length,
    },
    source: {
      mode: "read_only_runtime_overlay",
      currentScene: "algorithm_scene_runs row without ended_at",
      preparedNextScenes: "settings.algorithm_locked_queue_session_<sessionId>",
      availableScenes: "For You algorithm currentOrder.rows with Active/Available/Next status",
      activePathCandidates: "inferred from current scene memberships and previous edge when possible",
    },
  };
}

module.exports = {
  buildRuntimeState,
};
