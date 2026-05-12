(function initPadenGraph(root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
  } else {
    root.PadenGraph = factory();
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function createPadenGraph() {
  "use strict";

  const DEFAULT_NODE_W = 170;
  const DEFAULT_NODE_H = 46;
  const DEFAULT_ROW_GAP = 102;
  const DEFAULT_LANE_GAP = 184;
  const DEFAULT_PAD_X = 90;
  const DEFAULT_PAD_Y = 42;
  const DEFAULT_CENTER_X = 390;

  function normalizeId(value) {
    const parsed = Number.parseInt(String(value || ""), 10);
    return Number.isInteger(parsed) && parsed > 0 ? parsed : 0;
  }

  function normalizeIdList(values) {
    const seen = new Set();
    const ids = [];
    (Array.isArray(values) ? values : []).forEach((value) => {
      const id = normalizeId(value);
      if (!id || seen.has(id)) return;
      seen.add(id);
      ids.push(id);
    });
    return ids;
  }

  function normalizeEdge(edge) {
    const src = edge && typeof edge === "object" ? edge : {};
    const fromSceneId = normalizeId(src.fromSceneId || src.from || src.sourceSceneId || src.source);
    const toSceneId = normalizeId(src.toSceneId || src.to || src.targetSceneId || src.target);
    if (!fromSceneId || !toSceneId || fromSceneId === toSceneId) return null;
    const edgeType = String(src.edgeType || src.type || "").trim().toLowerCase() === "optional" ? "optional" : "";
    return edgeType ? { fromSceneId, toSceneId, edgeType } : { fromSceneId, toSceneId };
  }

  function isOptionalEdge(edge) {
    return String(edge && edge.edgeType || "").trim().toLowerCase() === "optional";
  }

  function normalizeThreshold(threshold) {
    const src = threshold && typeof threshold === "object" ? threshold : {};
    const sourceSceneId = normalizeId(src.sourceSceneId || src.source || src.fromSceneId || src.from);
    const requiredCount = Number.parseInt(String(src.requiredCount || src.required || src.count || "1"), 10);
    if (!sourceSceneId) return null;
    return {
      sourceSceneId,
      requiredCount: Number.isInteger(requiredCount) && requiredCount > 0 ? requiredCount : 1,
    };
  }

  function normalizeThresholds(thresholds) {
    const bySource = new Map();
    (Array.isArray(thresholds) ? thresholds : []).forEach((rawThreshold) => {
      const threshold = normalizeThreshold(rawThreshold);
      if (!threshold) return;
      bySource.set(threshold.sourceSceneId, threshold);
    });
    return Array.from(bySource.values()).sort((a, b) => a.sourceSceneId - b.sourceSceneId);
  }

  function normalizeCrossingThreshold(threshold) {
    const src = threshold && typeof threshold === "object" ? threshold : {};
    const sceneId = normalizeId(src.sceneId || src.targetSceneId || src.toSceneId || src.scene);
    const requiredCount = Number.parseInt(String(src.requiredCount || src.required || src.count || "1"), 10);
    if (!sceneId) return null;
    return {
      sceneId,
      requiredCount: Number.isInteger(requiredCount) && requiredCount > 0 ? requiredCount : 1,
    };
  }

  function normalizeCrossingThresholds(thresholds) {
    const byScene = new Map();
    (Array.isArray(thresholds) ? thresholds : []).forEach((rawThreshold) => {
      const threshold = normalizeCrossingThreshold(rawThreshold);
      if (!threshold) return;
      byScene.set(threshold.sceneId, threshold);
    });
    return Array.from(byScene.values()).sort((a, b) => a.sceneId - b.sceneId);
  }

  function edgeKey(edge) {
    return `${normalizeId(edge && edge.fromSceneId)}:${normalizeId(edge && edge.toSceneId)}`;
  }

  function normalizeEdges(edges, sceneIds) {
    const sceneSet = sceneIds ? new Set(sceneIds.map(Number)) : null;
    const seen = new Set();
    const normalized = [];
    (Array.isArray(edges) ? edges : []).forEach((rawEdge) => {
      const edge = normalizeEdge(rawEdge);
      if (!edge) return;
      if (sceneSet && (!sceneSet.has(edge.fromSceneId) || !sceneSet.has(edge.toSceneId))) return;
      const key = edgeKey(edge);
      if (seen.has(key)) return;
      seen.add(key);
      normalized.push(edge);
    });
    return normalized;
  }

  function outgoingTargetsBySource(sceneIds, edges) {
    const ids = normalizeIdList(sceneIds);
    const map = new Map(ids.map((id) => [id, []]));
    normalizeEdges(edges, ids).forEach((edge) => {
      if (isOptionalEdge(edge)) return;
      const targets = map.get(edge.fromSceneId);
      if (!targets || targets.includes(edge.toSceneId)) return;
      targets.push(edge.toSceneId);
    });
    return map;
  }

  function normalizeThresholdsForEdges(thresholds, sceneIds, edges) {
    const outgoing = outgoingTargetsBySource(sceneIds, edges);
    return normalizeThresholds(thresholds)
      .map((threshold) => {
        const outgoingCount = outgoing.get(threshold.sourceSceneId)
          ? outgoing.get(threshold.sourceSceneId).length
          : 0;
        if (outgoingCount <= 1) return null;
        const parsedRequired = Number.parseInt(String(threshold.requiredCount || "1"), 10);
        const requiredCount = Math.min(outgoingCount, Math.max(1, Number.isInteger(parsedRequired) ? parsedRequired : 1));
        if (requiredCount >= outgoingCount) return null;
        return {
          sourceSceneId: threshold.sourceSceneId,
          requiredCount,
        };
      })
      .filter(Boolean);
  }

  function thresholdMapForPath(path, options = {}) {
    const sceneIds = getPathSceneIds(path);
    const edges = getRenderableEdges(path, options);
    return new Map(normalizeThresholdsForEdges(path && path.thresholds, sceneIds, edges)
      .map((threshold) => [threshold.sourceSceneId, threshold.requiredCount]));
  }

  function crossingIncomingRoutesForPaths(paths = [], sceneId = 0) {
    const targetSceneId = normalizeId(sceneId);
    if (!targetSceneId) return [];
    const routes = [];
    const seen = new Set();
    (Array.isArray(paths) ? paths : []).forEach((path) => {
      if (!path || path.isActive === false || path.archivedAt) return;
      const pathId = normalizeId(path.id);
      if (!pathId) return;
      const sceneIds = getPathSceneIds(path);
      if (!sceneIds.includes(targetSceneId)) return;
      const sceneIdSet = new Set(sceneIds);
      getRenderableEdges(path, { fallback: true }).forEach((edge) => {
        if (isOptionalEdge(edge) || edge.toSceneId !== targetSceneId) return;
        if (!sceneIdSet.has(edge.fromSceneId) || !sceneIdSet.has(edge.toSceneId)) return;
        const key = `${pathId}:${edge.fromSceneId}:${edge.toSceneId}`;
        if (seen.has(key)) return;
        seen.add(key);
        routes.push({
          pathId,
          pathName: path.name || `Pad ${pathId}`,
          color: path.color || "",
          fromSceneId: edge.fromSceneId,
          toSceneId: edge.toSceneId,
        });
      });
    });
    return routes;
  }

  function normalizeCrossingThresholdsForPaths(thresholds, paths = []) {
    return normalizeCrossingThresholds(thresholds)
      .map((threshold) => {
        const incomingCount = crossingIncomingRoutesForPaths(paths, threshold.sceneId).length;
        if (incomingCount <= 1) return null;
        const parsedRequired = Number.parseInt(String(threshold.requiredCount || "1"), 10);
        const requiredCount = Math.min(incomingCount, Math.max(1, Number.isInteger(parsedRequired) ? parsedRequired : 1));
        if (requiredCount >= incomingCount) return null;
        return {
          sceneId: threshold.sceneId,
          requiredCount,
        };
      })
      .filter(Boolean);
  }

  function crossingThresholdMapForPaths(thresholds, paths = []) {
    return new Map(normalizeCrossingThresholdsForPaths(thresholds, paths)
      .map((threshold) => [threshold.sceneId, threshold.requiredCount]));
  }

  function fallbackEdgesFromSceneIds(sceneIds) {
    const ids = normalizeIdList(sceneIds);
    const edges = [];
    for (let i = 0; i < ids.length - 1; i += 1) {
      edges.push({ fromSceneId: ids[i], toSceneId: ids[i + 1] });
    }
    return edges;
  }

  function getPathSceneIds(path) {
    return normalizeIdList(path && Array.isArray(path.sceneIds) ? path.sceneIds : []);
  }

  function getRenderableEdges(path, options = {}) {
    const sceneIds = getPathSceneIds(path);
    const edges = normalizeEdges(path && path.edges, sceneIds);
    const fallback = options.fallback !== false && String(path && path.edgeMode || "legacy") !== "manual";
    if (edges.length || !fallback) return edges;
    return fallbackEdgesFromSceneIds(sceneIds);
  }

  function buildAdjacency(sceneIds, edges) {
    const ids = normalizeIdList(sceneIds);
    const idSet = new Set(ids);
    const incoming = new Map(ids.map((id) => [id, []]));
    const outgoing = new Map(ids.map((id) => [id, []]));
    normalizeEdges(edges, ids).forEach((edge) => {
      if (!idSet.has(edge.fromSceneId) || !idSet.has(edge.toSceneId)) return;
      outgoing.get(edge.fromSceneId).push(edge.toSceneId);
      incoming.get(edge.toSceneId).push(edge.fromSceneId);
    });
    return { incoming, outgoing };
  }

  function computeRanks(sceneIds, edges) {
    const ids = normalizeIdList(sceneIds);
    const order = new Map(ids.map((id, index) => [id, index]));
    const normalizedEdges = normalizeEdges(edges, ids);
    const { incoming } = buildAdjacency(ids, normalizedEdges);
    const remainingIncoming = new Map(ids.map((id) => [id, (incoming.get(id) || []).length]));
    const ranks = new Map(ids.map((id) => [id, 0]));
    const visited = new Set();
    let queue = ids.filter((id) => (incoming.get(id) || []).length === 0);
    if (!queue.length && ids.length) queue = [ids[0]];

    while (queue.length) {
      queue.sort((a, b) => (ranks.get(a) - ranks.get(b)) || ((order.get(a) || 0) - (order.get(b) || 0)));
      const id = queue.shift();
      if (!id || visited.has(id)) continue;
      visited.add(id);
      normalizedEdges
        .filter((edge) => edge.fromSceneId === id)
        .forEach((edge) => {
          const toId = edge.toSceneId;
          const nextRank = (ranks.get(id) || 0) + (isOptionalEdge(edge) ? 0 : 1);
          ranks.set(toId, Math.max(ranks.get(toId) || 0, nextRank));
          remainingIncoming.set(toId, Math.max(0, (remainingIncoming.get(toId) || 0) - 1));
          if ((remainingIncoming.get(toId) || 0) === 0) queue.push(toId);
        });
    }

    let tailRank = ids.reduce((max, id) => Math.max(max, ranks.get(id) || 0), 0);
    ids.forEach((id) => {
      if (visited.has(id)) return;
      tailRank += 1;
      ranks.set(id, tailRank);
    });
    return ranks;
  }

  function computePathLayout(path, options = {}) {
    const nodeW = Number(options.nodeWidth || DEFAULT_NODE_W);
    const nodeH = Number(options.nodeHeight || DEFAULT_NODE_H);
    const rowGap = Number(options.rowGap || DEFAULT_ROW_GAP);
    const laneGap = Number(options.laneGap || DEFAULT_LANE_GAP);
    const padX = Number(options.padX || DEFAULT_PAD_X);
    const padY = Number(options.padY || DEFAULT_PAD_Y);
    const centerX = Number(options.centerX || DEFAULT_CENTER_X);
    const sceneIds = getPathSceneIds(path);
    const edges = getRenderableEdges(path, { fallback: options.fallback !== false });
    const ranks = computeRanks(sceneIds, edges);
    const order = new Map(sceneIds.map((id, index) => [id, index]));
    const rows = new Map();

    sceneIds.forEach((id) => {
      const rank = ranks.get(id) || 0;
      if (!rows.has(rank)) rows.set(rank, []);
      rows.get(rank).push(id);
    });

    const positions = {};
    Array.from(rows.keys()).sort((a, b) => a - b).forEach((rank) => {
      const row = rows.get(rank).slice().sort((a, b) => (order.get(a) || 0) - (order.get(b) || 0));
      const offset = ((row.length - 1) * laneGap) / 2;
      row.forEach((id, index) => {
        positions[id] = {
          x: Math.round(centerX - offset + index * laneGap - nodeW / 2),
          y: Math.round(padY + rank * rowGap),
        };
      });
    });

    const minX = Object.values(positions).reduce((min, pos) => Math.min(min, pos.x), Infinity);
    if (Number.isFinite(minX) && minX < padX) {
      const shift = padX - minX;
      Object.values(positions).forEach((pos) => { pos.x += shift; });
    }

    const maxX = Object.values(positions).reduce((max, pos) => Math.max(max, pos.x + nodeW), padX + nodeW);
    const maxY = Object.values(positions).reduce((max, pos) => Math.max(max, pos.y + nodeH), padY + nodeH);
    return {
      positions,
      ranks: Object.fromEntries(Array.from(ranks.entries()).map(([id, rank]) => [id, rank])),
      width: Math.max(820, Math.ceil(maxX + padX)),
      height: Math.max(760, Math.ceil(maxY + padY + 90)),
    };
  }

  function analyzePathMembership(paths) {
    const membership = new Map();
    (Array.isArray(paths) ? paths : []).forEach((path) => {
      if (!path || path.isActive === false || path.archivedAt) return;
      getPathSceneIds(path).forEach((sceneId) => {
        if (!membership.has(sceneId)) membership.set(sceneId, []);
        membership.get(sceneId).push({
          pathId: path.id,
          name: path.name || "Naamloos pad",
          color: path.color || "",
        });
      });
    });
    return membership;
  }

  function pathEndpoints(path, options = {}) {
    const sceneIds = getPathSceneIds(path);
    const edges = getRenderableEdges(path, options);
    const incoming = new Set(edges.map((edge) => edge.toSceneId));
    const requiredOutgoing = new Set(edges.filter((edge) => !isOptionalEdge(edge)).map((edge) => edge.fromSceneId));
    const sideIncoming = new Set(edges.filter(isOptionalEdge).map((edge) => edge.toSceneId));
    const connectedOnly = !!options.connectedOnly;
    return {
      starts: sceneIds.filter((id) => !incoming.has(id) && (!connectedOnly || requiredOutgoing.has(id))),
      ends: sceneIds.filter((id) => !requiredOutgoing.has(id) && !sideIncoming.has(id) && (!connectedOnly || incoming.has(id))),
    };
  }

  function connectedSceneIds(sceneIds, edges) {
    const connected = new Set();
    normalizeEdges(edges, sceneIds).forEach((edge) => {
      connected.add(edge.fromSceneId);
      connected.add(edge.toSceneId);
    });
    return normalizeIdList(sceneIds).filter((id) => connected.has(id));
  }

  function connectedComponentCount(sceneIds, edges) {
    const ids = connectedSceneIds(sceneIds, edges);
    if (!ids.length) return 0;
    const adjacency = new Map(ids.map((id) => [id, []]));
    normalizeEdges(edges, sceneIds).forEach((edge) => {
      if (!adjacency.has(edge.fromSceneId) || !adjacency.has(edge.toSceneId)) return;
      adjacency.get(edge.fromSceneId).push(edge.toSceneId);
      adjacency.get(edge.toSceneId).push(edge.fromSceneId);
    });
    const seen = new Set();
    let count = 0;
    ids.forEach((id) => {
      if (seen.has(id)) return;
      count += 1;
      const stack = [id];
      while (stack.length) {
        const current = stack.pop();
        if (!current || seen.has(current)) continue;
        seen.add(current);
        (adjacency.get(current) || []).forEach((nextId) => {
          if (!seen.has(nextId)) stack.push(nextId);
        });
      }
    });
    return count;
  }

  function canReachScene(startId, targetId, edges, sceneIds) {
    const start = normalizeId(startId);
    const target = normalizeId(targetId);
    if (!start || !target) return false;
    const { outgoing } = buildAdjacency(sceneIds || [], edges || []);
    const stack = [start];
    const seen = new Set();
    while (stack.length) {
      const current = stack.pop();
      if (current === target) return true;
      if (!current || seen.has(current)) continue;
      seen.add(current);
      (outgoing.get(current) || []).forEach((nextId) => {
        if (!seen.has(nextId)) stack.push(nextId);
      });
    }
    return false;
  }

  function edgeCandidateIssue(path, fromSceneId, toSceneId, options = {}) {
    const sceneIds = getPathSceneIds(path);
    const fromId = normalizeId(fromSceneId);
    const toId = normalizeId(toSceneId);
    if (!fromId || !toId || fromId === toId) return `path_edge_self:${fromId || toId || 0}`;
    if (!sceneIds.includes(fromId)) return `path_edge_scene_missing:${fromId}`;
    if (!sceneIds.includes(toId)) return `path_edge_scene_missing:${toId}`;
    const edges = getRenderableEdges(path, options);
    const key = `${fromId}:${toId}`;
    if (edges.some((edge) => edgeKey(edge) === key)) return `path_edge_duplicate:${key}`;
    const candidateEdges = [...edges, { fromSceneId: fromId, toSceneId: toId }];
    if (canReachScene(toId, fromId, edges, sceneIds)) return `path_cycle:${fromId}`;
    const componentCount = connectedComponentCount(sceneIds, candidateEdges);
    if (componentCount > 1) return `path_disconnected_components:${componentCount}`;
    return "";
  }

  function collectNeighborIds(startId, adjacency, steps) {
    const found = [];
    let frontier = [startId];
    for (let step = 0; step < steps; step += 1) {
      const next = [];
      frontier.forEach((id) => {
        (adjacency.get(id) || []).forEach((neighborId) => {
          if (!found.includes(neighborId)) found.push(neighborId);
          next.push(neighborId);
        });
      });
      frontier = next;
      if (!frontier.length) break;
    }
    return found;
  }

  function selectGhostNeighbors(activePath, allPaths, options = {}) {
    const steps = Math.max(1, Number.parseInt(String(options.steps || 1), 10) || 1);
    const activeSceneIds = options.activeSceneIds
      ? normalizeIdList(options.activeSceneIds)
      : getPathSceneIds(activePath);
    const activeSceneSet = new Set(activeSceneIds);
    const activePathId = activePath && activePath.id;
    const visiblePathIds = options.visiblePathIds ? new Set(Array.from(options.visiblePathIds).map(String)) : null;
    const excludePathIds = options.excludePathIds ? new Set(Array.from(options.excludePathIds).map(String)) : new Set();
    const ghosts = [];
    const seen = new Set();

    (Array.isArray(allPaths) ? allPaths : []).forEach((path) => {
      if (!path || path.isActive === false || path.archivedAt) return;
      const pathId = String(path.id || "");
      if (pathId === String(activePathId || "")) return;
      if (excludePathIds.has(pathId)) return;
      if (visiblePathIds && !visiblePathIds.has(pathId)) return;
      const sceneIds = getPathSceneIds(path);
      const shared = sceneIds.filter((sceneId) => activeSceneSet.has(sceneId));
      if (!shared.length) return;
      const edges = getRenderableEdges(path, { fallback: true });
      const { incoming, outgoing } = buildAdjacency(sceneIds, edges);
      shared.forEach((fromSceneId) => {
        [
          { direction: "prev", ids: collectNeighborIds(fromSceneId, incoming, steps) },
          { direction: "next", ids: collectNeighborIds(fromSceneId, outgoing, steps) },
        ].forEach((group) => {
          group.ids.forEach((sceneId) => {
            if (!sceneId || activeSceneSet.has(sceneId)) return;
            const key = `${path.id || "path"}:${fromSceneId}:${sceneId}:${group.direction}`;
            if (seen.has(key)) return;
            seen.add(key);
            ghosts.push({
              sceneId,
              fromSceneId,
              pathId: path.id,
              pathName: path.name || "Naamloos pad",
              color: path.color || "",
              direction: group.direction,
            });
          });
        });
      });
    });

    return ghosts;
  }

  return {
    DEFAULT_NODE_W,
    DEFAULT_NODE_H,
    normalizeId,
    normalizeIdList,
    normalizeEdge,
    isOptionalEdge,
    normalizeThreshold,
    normalizeThresholds,
    normalizeCrossingThreshold,
    normalizeCrossingThresholds,
    normalizeEdges,
    normalizeThresholdsForEdges,
    normalizeCrossingThresholdsForPaths,
    outgoingTargetsBySource,
    thresholdMapForPath,
    crossingIncomingRoutesForPaths,
    crossingThresholdMapForPaths,
    edgeKey,
    fallbackEdgesFromSceneIds,
    getPathSceneIds,
    getRenderableEdges,
    buildAdjacency,
    computeRanks,
    computePathLayout,
    analyzePathMembership,
    pathEndpoints,
    connectedSceneIds,
    connectedComponentCount,
    canReachScene,
    edgeCandidateIssue,
    selectGhostNeighbors,
  };
});
