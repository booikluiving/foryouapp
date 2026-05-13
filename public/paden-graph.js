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
    const sourceSceneId = normalizeId(src.sourceSceneId || src.sceneId || src.targetSceneId || src.toSceneId || src.target || src.source || src.fromSceneId || src.from);
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

  function normalizeBlockRule(rule) {
    const src = rule && typeof rule === "object" ? rule : {};
    const sourceSceneId = normalizeId(src.sourceSceneId || src.source || src.fromSceneId || src.from);
    if (!sourceSceneId) return null;
    return {
      sourceSceneId,
      includeCrossingPaths: true,
    };
  }

  function normalizeBlockRules(rules, sceneIds = null) {
    const sceneSet = sceneIds ? new Set(normalizeIdList(sceneIds)) : null;
    const byKey = new Map();
    (Array.isArray(rules) ? rules : []).forEach((rawRule) => {
      const rule = normalizeBlockRule(rawRule);
      if (!rule) return;
      if (sceneSet && !sceneSet.has(rule.sourceSceneId)) return;
      byKey.set(String(rule.sourceSceneId), rule);
    });
    return Array.from(byKey.values()).sort((a, b) => a.sourceSceneId - b.sourceSceneId);
  }

  function normalizeIgnoreCrossingBlockSceneIds(pathOrIds = [], sceneIds = null) {
    const source = Array.isArray(pathOrIds)
      ? pathOrIds
      : (
        pathOrIds && (
          pathOrIds.ignoreCrossingBlockSceneIds
          || pathOrIds.crossingBlockIgnoreSceneIds
          || pathOrIds.blockIgnoreSceneIds
          || pathOrIds.ignoreBlockSceneIds
        )
      );
    const sceneSet = sceneIds ? new Set(normalizeIdList(sceneIds)) : null;
    return normalizeIdList(Array.isArray(source) ? source : [])
      .filter((sceneId) => !sceneSet || sceneSet.has(sceneId));
  }

  function activeGraphPaths(paths = []) {
    return (Array.isArray(paths) ? paths : [])
      .filter((path) => path && path.isActive !== false && !path.archivedAt);
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

  function incomingSourcesByTarget(sceneIds, edges) {
    const ids = normalizeIdList(sceneIds);
    const map = new Map(ids.map((id) => [id, []]));
    normalizeEdges(edges, ids).forEach((edge) => {
      if (isOptionalEdge(edge)) return;
      const sources = map.get(edge.toSceneId);
      if (!sources || sources.includes(edge.fromSceneId)) return;
      sources.push(edge.fromSceneId);
    });
    return map;
  }

  function normalizeThresholdsForEdges(thresholds, sceneIds, edges) {
    const incoming = incomingSourcesByTarget(sceneIds, edges);
    return normalizeThresholds(thresholds)
      .map((threshold) => {
        const incomingCount = incoming.get(threshold.sourceSceneId)
          ? incoming.get(threshold.sourceSceneId).length
          : 0;
        if (incomingCount <= 1) return null;
        const parsedRequired = Number.parseInt(String(threshold.requiredCount || "1"), 10);
        const requiredCount = Math.min(incomingCount, Math.max(1, Number.isInteger(parsedRequired) ? parsedRequired : 1));
        if (requiredCount >= incomingCount) return null;
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
    const byScene = new Map();
    normalizeCrossingThresholds(thresholds).forEach((threshold) => {
      const routes = crossingIncomingRoutesForPaths(paths, threshold.sceneId);
      const incomingCount = routes.length;
      const incomingPathCount = new Set(routes.map((route) => normalizeId(route.pathId))).size;
      if (incomingPathCount <= 1) return;
      if (incomingCount <= 1) return;
      const parsedRequired = Number.parseInt(String(threshold.requiredCount || "1"), 10);
      const requiredCount = Math.min(incomingCount, Math.max(1, Number.isInteger(parsedRequired) ? parsedRequired : 1));
      if (requiredCount >= incomingCount) return;
      byScene.set(threshold.sceneId, {
        sceneId: threshold.sceneId,
        requiredCount,
      });
    });
    return Array.from(byScene.values()).sort((a, b) => a.sceneId - b.sceneId);
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

  function effectiveEndSceneIds(path, sceneIds = null, edges = null) {
    const ids = normalizeIdList(Array.isArray(sceneIds) ? sceneIds : getPathSceneIds(path));
    const sceneSet = new Set(ids);
    return normalizeIdList(path && path.endSceneIds || []).filter((sceneId) => sceneSet.has(sceneId));
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

    const directionRank = (value) => String(value || "") === "prev" ? 0 : String(value || "") === "next" ? 1 : 2;
    return ghosts.sort((a, b) => (
      String(a.pathId || "").localeCompare(String(b.pathId || ""))
      || Number(a.fromSceneId || 0) - Number(b.fromSceneId || 0)
      || directionRank(a.direction) - directionRank(b.direction)
      || Number(a.sceneId || 0) - Number(b.sceneId || 0)
    ));
  }

  function uniqueIds(values = []) {
    return normalizeIdList(Array.from(values || []));
  }

  function uniqueThresholdGroups(groups = []) {
    const byKey = new Map();
    (Array.isArray(groups) ? groups : []).forEach((rawGroup) => {
      const group = rawGroup && typeof rawGroup === "object" ? rawGroup : {};
      const pathId = normalizeId(group.pathId);
      const sourceSceneId = normalizeId(group.sourceSceneId);
      if (!pathId || !sourceSceneId) return;
      const targetSceneIds = normalizeIdList(group.targetSceneIds || []);
      const outgoingCount = Math.max(targetSceneIds.length, Number.parseInt(String(group.outgoingCount || "0"), 10) || targetSceneIds.length);
      const requiredCount = Math.min(Math.max(1, Number.parseInt(String(group.requiredCount || outgoingCount || "1"), 10) || 1), Math.max(outgoingCount, 1));
      const completedCount = Math.min(Math.max(0, Number.parseInt(String(group.completedCount || "0"), 10) || 0), Math.max(outgoingCount, 0));
      byKey.set(`${pathId}:${sourceSceneId}`, {
        pathId,
        pathName: String(group.pathName || `Pad ${pathId}`),
        color: String(group.color || ""),
        sourceSceneId,
        targetSceneIds,
        outgoingCount,
        requiredCount,
        completedCount,
        satisfied: !!group.satisfied || completedCount >= requiredCount,
        optionalSceneIds: normalizeIdList(group.optionalSceneIds || []),
      });
    });
    return Array.from(byKey.values()).sort((a, b) => (a.pathId - b.pathId) || (a.sourceSceneId - b.sourceSceneId));
  }

  function defaultPathStatus(sceneId) {
    return {
      sceneId,
      pathIds: [],
      pathNames: [],
      predecessorIds: [],
      requiredPredecessorIds: [],
      successorIds: [],
      missingPredecessorIds: [],
      requiredMissingPredecessorIds: [],
      completedPredecessorIds: [],
      optionalPredecessorIds: [],
      crossingOptionalPredecessorIds: [],
      optionalSceneIds: [],
      optionalSourceSceneIds: [],
      sideSceneIds: [],
      sideSourceSceneIds: [],
      expiredSideSceneIds: [],
      expiredSideSourceSceneIds: [],
      missingSideSourceSceneIds: [],
      activeSideSourceSceneIds: [],
      reachedPathIds: [],
      availablePathIds: [],
      blockedPathIds: [],
      closedPathIds: [],
      endPathIds: [],
      blockingRules: [],
      reached: false,
      available: false,
      blocked: false,
      pathClosed: false,
      endNode: false,
      nodeStatus: "Locked",
      thresholdGroups: [],
      blockingThresholds: [],
      crossingThreshold: null,
      blockingCrossingThreshold: null,
      crossingIncomingCount: 0,
      crossingRequiredCount: 0,
      crossingCompletedCount: 0,
      crossingSatisfied: false,
      requiredCount: 0,
      completedCount: 0,
      satisfied: false,
      optional: false,
      expiredOptional: false,
      pathDetails: [],
      isPathStart: false,
      isPathEnd: false,
      isSplit: false,
      isMerge: false,
      ready: true,
    };
  }

  function buildPathSceneStatuses({ paths = [], scenes = [], playedSceneIds = [], crossingThresholds = [] } = {}) {
    const active = activeGraphPaths(paths).filter((path) => normalizeId(path && path.id));
    const sceneById = new Map((Array.isArray(scenes) ? scenes : [])
      .filter((scene) => scene && scene.isActive !== false && !scene.archivedAt)
      .map((scene) => [normalizeId(scene.id), scene])
      .filter(([id]) => !!id));
    const playedSet = new Set(normalizeIdList(playedSceneIds));
    const statusBySceneId = new Map();
    const ensureStatus = (sceneId) => {
      const id = normalizeId(sceneId);
      if (!id) return null;
      if (!statusBySceneId.has(id)) statusBySceneId.set(id, defaultPathStatus(id));
      return statusBySceneId.get(id);
    };
    const analyses = [];
    const globalBlockedSceneIds = new Set();
    const globalRequiredIncomingRoutesBySceneId = new Map();
    const crossingThresholdBySceneId = crossingThresholdMapForPaths(crossingThresholds, active);
    const addGlobalRequiredIncomingRoute = (route) => {
      const targetSceneId = normalizeId(route && route.toSceneId);
      if (!targetSceneId) return;
      if (!globalRequiredIncomingRoutesBySceneId.has(targetSceneId)) {
        globalRequiredIncomingRoutesBySceneId.set(targetSceneId, []);
      }
      const routes = globalRequiredIncomingRoutesBySceneId.get(targetSceneId);
      const key = `${normalizeId(route.pathId)}:${normalizeId(route.fromSceneId)}:${targetSceneId}`;
      if (routes.some((item) => item.key === key)) return;
      routes.push({ ...route, key });
    };

    active.forEach((path) => {
      const pathId = normalizeId(path && path.id);
      const sceneIds = getPathSceneIds(path).filter((sceneId) => !sceneById.size || sceneById.has(sceneId));
      if (!pathId || !sceneIds.length) return;
      const sceneIdSet = new Set(sceneIds);
      getRenderableEdges(path, { fallback: true }).forEach((edge) => {
        if (isOptionalEdge(edge)) return;
        if (!sceneIdSet.has(edge.fromSceneId) || !sceneIdSet.has(edge.toSceneId)) return;
        addGlobalRequiredIncomingRoute({
          pathId,
          pathName: path.name || `Pad ${pathId}`,
          color: path.color || "",
          fromSceneId: edge.fromSceneId,
          toSceneId: edge.toSceneId,
        });
      });
    });

    active.forEach((path) => {
      const pathId = normalizeId(path.id);
      const sceneIds = getPathSceneIds(path).filter((sceneId) => !sceneById.size || sceneById.has(sceneId));
      if (!pathId || !sceneIds.length) return;
      const sceneIdSet = new Set(sceneIds);
      const incomingBySceneId = new Map(sceneIds.map((sceneId) => [sceneId, []]));
      const outgoingBySceneId = new Map(sceneIds.map((sceneId) => [sceneId, []]));
      const requiredIncomingBySceneId = new Map(sceneIds.map((sceneId) => [sceneId, []]));
      const requiredOutgoingBySceneId = new Map(sceneIds.map((sceneId) => [sceneId, []]));
      const sideIncomingBySceneId = new Map(sceneIds.map((sceneId) => [sceneId, []]));
      const sideOutgoingBySceneId = new Map(sceneIds.map((sceneId) => [sceneId, []]));
      const pathEdges = getRenderableEdges(path, { fallback: true });
      pathEdges.forEach((edge) => {
        if (!sceneIdSet.has(edge.fromSceneId) || !sceneIdSet.has(edge.toSceneId)) return;
        incomingBySceneId.get(edge.toSceneId).push(edge.fromSceneId);
        outgoingBySceneId.get(edge.fromSceneId).push(edge.toSceneId);
        if (isOptionalEdge(edge)) {
          sideIncomingBySceneId.get(edge.toSceneId).push(edge.fromSceneId);
          sideOutgoingBySceneId.get(edge.fromSceneId).push(edge.toSceneId);
        } else {
          requiredIncomingBySceneId.get(edge.toSceneId).push(edge.fromSceneId);
          requiredOutgoingBySceneId.get(edge.fromSceneId).push(edge.toSceneId);
        }
      });
      const endSceneIds = new Set(effectiveEndSceneIds(path, sceneIds, pathEdges));
      const reached = new Set();
      const localStartSceneIds = sceneIds.filter((sceneId) => (incomingBySceneId.get(sceneId) || []).length === 0);
      const queue = localStartSceneIds.filter((sceneId) => {
        const globalIncomingRoutes = globalRequiredIncomingRoutesBySceneId.get(sceneId) || [];
        return !globalIncomingRoutes.length || playedSet.has(sceneId);
      });
      if (!queue.length && !localStartSceneIds.length && sceneIds.length) queue.push(sceneIds[0]);
      while (queue.length) {
        const sceneId = queue.shift();
        if (!sceneId || reached.has(sceneId) || !sceneIdSet.has(sceneId)) continue;
        reached.add(sceneId);
        if (!playedSet.has(sceneId)) continue;
        if (endSceneIds.has(sceneId)) continue;
        const requiredTargets = Array.from(new Set(requiredOutgoingBySceneId.get(sceneId) || []));
        const sideTargets = Array.from(new Set(sideOutgoingBySceneId.get(sceneId) || []));
        const requiredTargetPlayed = requiredTargets.some((targetId) => playedSet.has(targetId));
        requiredTargets.forEach((targetId) => {
          if (!reached.has(targetId)) queue.push(targetId);
        });
        if (!requiredTargetPlayed) {
          sideTargets.forEach((targetId) => {
            if (!reached.has(targetId)) queue.push(targetId);
          });
        }
      }

      const localBlockedSceneIds = new Set();
      const triggeredRules = [];
      const ancestorSceneIdsFor = (sourceSceneId) => {
        const ancestors = new Set();
        const stack = Array.from(new Set(incomingBySceneId.get(sourceSceneId) || []));
        while (stack.length) {
          const candidateId = stack.pop();
          if (!candidateId || ancestors.has(candidateId) || candidateId === sourceSceneId) continue;
          ancestors.add(candidateId);
          (incomingBySceneId.get(candidateId) || []).forEach((predecessorId) => {
            if (!ancestors.has(predecessorId)) stack.push(predecessorId);
          });
        }
        return Array.from(ancestors).filter((sceneId) => sceneIdSet.has(sceneId)).sort((a, b) => a - b);
      };
      normalizeBlockRules(path.blockRules || [], sceneIds).forEach((rule) => {
        if (!reached.has(rule.sourceSceneId) || !playedSet.has(rule.sourceSceneId)) return;
        const targetSceneIds = ancestorSceneIdsFor(rule.sourceSceneId);
        if (!targetSceneIds.length) return;
        targetSceneIds.forEach((targetSceneId) => localBlockedSceneIds.add(targetSceneId));
        triggeredRules.push({
          pathId,
          pathName: path.name || `Pad ${pathId}`,
          color: path.color || "",
          sourceSceneId: rule.sourceSceneId,
          targetSceneIds,
          includeCrossingPaths: !!rule.includeCrossingPaths,
        });
        if (rule.includeCrossingPaths) {
          targetSceneIds.forEach((targetSceneId) => globalBlockedSceneIds.add(targetSceneId));
        }
      });
      const reachedEndSceneIds = Array.from(endSceneIds).filter((sceneId) => reached.has(sceneId) && playedSet.has(sceneId));
      analyses.push({
        path,
        pathId,
        sceneIds,
        incomingBySceneId,
        outgoingBySceneId,
        requiredIncomingBySceneId,
        requiredOutgoingBySceneId,
        sideIncomingBySceneId,
        sideOutgoingBySceneId,
        endSceneIds,
        reached,
        localBlockedSceneIds,
        triggeredRules,
        pathClosed: reachedEndSceneIds.length > 0,
        ignoreCrossingBlockSceneIds: new Set(normalizeIgnoreCrossingBlockSceneIds(path, sceneIds)),
      });
    });

    analyses.forEach((analysis) => {
      const {
        path,
        pathId,
        sceneIds,
        incomingBySceneId,
        outgoingBySceneId,
        requiredIncomingBySceneId,
        requiredOutgoingBySceneId,
        sideIncomingBySceneId,
        sideOutgoingBySceneId,
        endSceneIds,
        reached,
        localBlockedSceneIds,
        triggeredRules,
        pathClosed,
        ignoreCrossingBlockSceneIds,
      } = analysis;
      const thresholdByTargetSceneId = new Map(normalizeThresholdsForEdges(path.thresholds || [], sceneIds, getRenderableEdges(path, { fallback: true }))
        .map((threshold) => [threshold.sourceSceneId, threshold]));
      const thresholdGroups = [];
      requiredIncomingBySceneId.forEach((sourceIds, targetSceneId) => {
        const targetSceneIds = uniqueIds(sourceIds);
        const threshold = thresholdByTargetSceneId.get(targetSceneId);
        if (!threshold || targetSceneIds.length <= 1) return;
        if (!reached.has(targetSceneId) && !targetSceneIds.some((sourceSceneId) => reached.has(sourceSceneId) && playedSet.has(sourceSceneId))) return;
        const completedSceneIds = targetSceneIds.filter((sourceSceneId) => reached.has(sourceSceneId) && playedSet.has(sourceSceneId));
        const requiredCount = Math.min(targetSceneIds.length, Math.max(1, Number(threshold.requiredCount || targetSceneIds.length)));
        thresholdGroups.push({
          pathId,
          pathName: path.name || `Pad ${pathId}`,
          color: path.color || "",
          sourceSceneId: targetSceneId,
          targetSceneIds,
          outgoingCount: targetSceneIds.length,
          requiredCount,
          completedCount: completedSceneIds.length,
          satisfied: completedSceneIds.length >= requiredCount,
          optionalSceneIds: completedSceneIds.length >= requiredCount ? targetSceneIds.filter((sourceSceneId) => !playedSet.has(sourceSceneId)) : [],
        });
      });
      const thresholdGroupsBySource = new Map();
      const optionalGroupsByTarget = new Map();
      thresholdGroups.forEach((group) => {
        if (!thresholdGroupsBySource.has(group.sourceSceneId)) thresholdGroupsBySource.set(group.sourceSceneId, []);
        thresholdGroupsBySource.get(group.sourceSceneId).push(group);
        group.optionalSceneIds.forEach((optionalSceneId) => {
          if (!optionalGroupsByTarget.has(optionalSceneId)) optionalGroupsByTarget.set(optionalSceneId, []);
          optionalGroupsByTarget.get(optionalSceneId).push(group);
        });
      });

      sceneIds.forEach((sceneId) => {
        const status = ensureStatus(sceneId);
        if (!status) return;
        const incoming = uniqueIds(incomingBySceneId.get(sceneId) || []);
        const outgoing = uniqueIds(outgoingBySceneId.get(sceneId) || []);
        const requiredIncoming = uniqueIds(requiredIncomingBySceneId.get(sceneId) || []);
        const sideIncoming = uniqueIds(sideIncomingBySceneId.get(sceneId) || []);
        const sideOutgoing = uniqueIds(sideOutgoingBySceneId.get(sceneId) || []);
        const isReached = reached.has(sceneId);
        const isPlayed = playedSet.has(sceneId);
        const activeSideSourceIds = sideIncoming.filter((sourceSceneId) => reached.has(sourceSceneId) && playedSet.has(sourceSceneId));
        const expiredSideSourceIds = sideIncoming.filter((sourceSceneId) => (
          reached.has(sourceSceneId)
          && playedSet.has(sourceSceneId)
          && (requiredOutgoingBySceneId.get(sourceSceneId) || []).some((targetId) => reached.has(targetId) && playedSet.has(targetId))
        ));
        const missingSideSourceIds = sideIncoming.filter((sourceSceneId) => !reached.has(sourceSceneId) || !playedSet.has(sourceSceneId));
        const optionalPredecessorIds = requiredIncoming.filter((predecessorId) => (
          (!reached.has(predecessorId) || !playedSet.has(predecessorId)) && optionalGroupsByTarget.has(predecessorId)
        ));
        const requiredMissingPredecessorIds = requiredIncoming.filter((predecessorId) => (
          (!reached.has(predecessorId) || !playedSet.has(predecessorId)) && !optionalGroupsByTarget.has(predecessorId)
        ));
        const missingPredecessorIds = requiredMissingPredecessorIds
          .concat(expiredSideSourceIds.length ? expiredSideSourceIds : missingSideSourceIds);
        const completedPredecessorIds = incoming.filter((predecessorId) => (
          reached.has(predecessorId) && playedSet.has(predecessorId) && !expiredSideSourceIds.includes(predecessorId)
        ));
        const sourceThresholdGroups = thresholdGroupsBySource.get(sceneId) || [];
        const incomingBlockingThresholds = thresholdGroups.filter((group) => (
          !group.satisfied && Number(group.sourceSceneId || 0) === Number(sceneId || 0)
        ));
        const optionalSceneGroups = optionalGroupsByTarget.get(sceneId) || [];
        const ignoresCrossingBlock = ignoreCrossingBlockSceneIds.has(sceneId);
        const crossingRuleBlocked = globalBlockedSceneIds.has(sceneId) && !ignoresCrossingBlock;
        const ruleBlocked = !isPlayed && (localBlockedSceneIds.has(sceneId) || crossingRuleBlocked);
        const closedBlocked = !isPlayed && pathClosed;
        const expiredOptional = expiredSideSourceIds.length > 0 && !isPlayed;
        const detailBlocked = ruleBlocked || closedBlocked || expiredOptional;
        const detailReady = isReached
          && !detailBlocked
          && missingPredecessorIds.length === 0
          && incomingBlockingThresholds.length === 0;
        status.pathIds.push(pathId);
        status.pathNames.push(path.name || `Pad ${pathId}`);
        status.pathDetails.push({
          pathId,
          pathName: path.name || `Pad ${pathId}`,
          color: path.color || "",
          predecessorIds: incoming,
          requiredPredecessorIds: requiredIncoming,
          successorIds: outgoing,
          missingPredecessorIds,
          requiredMissingPredecessorIds,
          completedPredecessorIds,
          optionalPredecessorIds,
          optionalSourceSceneIds: uniqueIds(optionalSceneGroups.map((group) => group.sourceSceneId)),
          optionalSceneIds: uniqueIds(sourceThresholdGroups.flatMap((group) => group.optionalSceneIds)),
          sideSourceSceneIds: sideIncoming,
          sideSceneIds: sideOutgoing,
          expiredSideSourceSceneIds: uniqueIds(expiredSideSourceIds),
          expiredSideSceneIds: uniqueIds(sideOutgoing.filter((targetId) => (
            playedSet.has(sceneId)
            && (requiredOutgoingBySceneId.get(sceneId) || []).some((nextId) => playedSet.has(nextId))
            && !playedSet.has(targetId)
          ))),
          missingSideSourceSceneIds: uniqueIds(missingSideSourceIds),
          activeSideSourceSceneIds: uniqueIds(activeSideSourceIds),
          reached: isReached,
          available: !isPlayed && detailReady,
          blocked: detailBlocked,
          ruleBlocked,
          crossingRuleBlocked,
          ignoresCrossingBlock,
          closedBlocked,
          pathClosed,
          endNode: endSceneIds.has(sceneId),
          blockingRules: triggeredRules.filter((rule) => normalizeIdList(rule.targetSceneIds || []).includes(sceneId)),
          thresholdGroups: sourceThresholdGroups,
          blockingThresholds: incomingBlockingThresholds,
          optional: (optionalSceneGroups.length > 0 || activeSideSourceIds.length > 0) && !expiredSideSourceIds.length && !isPlayed,
          expiredOptional,
          ready: detailReady,
          isStart: incoming.length === 0,
          isEnd: endSceneIds.has(sceneId),
          isSplit: outgoing.length > 1,
          isMerge: incoming.length > 1,
        });
        incoming.forEach((predecessorId) => {
          if (!status.predecessorIds.includes(predecessorId)) status.predecessorIds.push(predecessorId);
        });
        outgoing.forEach((successorId) => {
          if (!status.successorIds.includes(successorId)) status.successorIds.push(successorId);
        });
      });
    });

    const analysisByPathId = new Map(analyses.map((analysis) => [analysis.pathId, analysis]));
    const routeCompleted = (route) => {
      const analysis = analysisByPathId.get(normalizeId(route && route.pathId));
      const fromSceneId = normalizeId(route && route.fromSceneId);
      return !!(analysis && fromSceneId && analysis.reached.has(fromSceneId) && playedSet.has(fromSceneId));
    };

    statusBySceneId.forEach((status) => {
      status.predecessorIds = uniqueIds(status.pathDetails.flatMap((detail) => detail.predecessorIds || []));
      status.requiredPredecessorIds = uniqueIds(status.pathDetails.flatMap((detail) => detail.requiredPredecessorIds || []));
      status.successorIds = uniqueIds(status.pathDetails.flatMap((detail) => detail.successorIds || []));
      status.completedPredecessorIds = uniqueIds(status.pathDetails.flatMap((detail) => detail.completedPredecessorIds || []));
      status.missingPredecessorIds = uniqueIds(status.pathDetails.flatMap((detail) => detail.missingPredecessorIds || []));
      status.requiredMissingPredecessorIds = uniqueIds(status.pathDetails.flatMap((detail) => detail.requiredMissingPredecessorIds || []));
      status.optionalPredecessorIds = uniqueIds(status.pathDetails.flatMap((detail) => detail.optionalPredecessorIds || []));
      status.optionalSceneIds = uniqueIds(status.pathDetails.flatMap((detail) => detail.optionalSceneIds || []));
      status.optionalSourceSceneIds = uniqueIds(status.pathDetails.flatMap((detail) => detail.optionalSourceSceneIds || []));
      status.sideSceneIds = uniqueIds(status.pathDetails.flatMap((detail) => detail.sideSceneIds || []));
      status.sideSourceSceneIds = uniqueIds(status.pathDetails.flatMap((detail) => detail.sideSourceSceneIds || []));
      status.expiredSideSceneIds = uniqueIds(status.pathDetails.flatMap((detail) => detail.expiredSideSceneIds || []));
      status.expiredSideSourceSceneIds = uniqueIds(status.pathDetails.flatMap((detail) => detail.expiredSideSourceSceneIds || []));
      status.missingSideSourceSceneIds = uniqueIds(status.pathDetails.flatMap((detail) => detail.missingSideSourceSceneIds || []));
      status.activeSideSourceSceneIds = uniqueIds(status.pathDetails.flatMap((detail) => detail.activeSideSourceSceneIds || []));
      status.reachedPathIds = uniqueIds(status.pathDetails.filter((detail) => detail.reached).map((detail) => detail.pathId));
      status.availablePathIds = uniqueIds(status.pathDetails.filter((detail) => detail.available).map((detail) => detail.pathId));
      status.blockedPathIds = uniqueIds(status.pathDetails.filter((detail) => detail.blocked).map((detail) => detail.pathId));
      status.closedPathIds = uniqueIds(status.pathDetails.filter((detail) => detail.pathClosed).map((detail) => detail.pathId));
      status.endPathIds = uniqueIds(status.pathDetails.filter((detail) => detail.endNode).map((detail) => detail.pathId));
      status.blockingRules = status.pathDetails.flatMap((detail) => Array.isArray(detail.blockingRules) ? detail.blockingRules : []);
      status.reached = status.reachedPathIds.length > 0;
      status.available = status.availablePathIds.length > 0;
      status.pathClosed = status.closedPathIds.length > 0;
      status.endNode = status.endPathIds.length > 0;
      const crossingRoutes = globalRequiredIncomingRoutesBySceneId.get(status.sceneId) || [];
      const crossingRoutePathCount = new Set(crossingRoutes.map((route) => normalizeId(route.pathId))).size;
      if (crossingRoutes.length > 1 && crossingRoutePathCount > 1) {
        const completedRoutes = crossingRoutes.filter(routeCompleted);
        const completedRouteKeys = new Set(completedRoutes.map((route) => route.key));
        const requiredCount = Math.min(
          crossingRoutes.length,
          Math.max(1, Number(crossingThresholdBySceneId.get(status.sceneId) || crossingRoutes.length))
        );
        const crossingSatisfied = completedRoutes.length >= requiredCount || playedSet.has(status.sceneId);
        const missingRouteSourceIds = uniqueIds(crossingRoutes
          .filter((route) => !completedRouteKeys.has(route.key))
          .map((route) => route.fromSceneId));
        const crossingThreshold = {
          sceneId: status.sceneId,
          incomingCount: crossingRoutes.length,
          requiredCount,
          completedCount: completedRoutes.length,
          satisfied: crossingSatisfied,
          routes: crossingRoutes.map((route) => ({
            pathId: route.pathId,
            pathName: route.pathName,
            color: route.color,
            fromSceneId: route.fromSceneId,
            toSceneId: route.toSceneId,
            completed: completedRouteKeys.has(route.key),
          })),
          optionalPredecessorIds: crossingSatisfied ? missingRouteSourceIds : [],
        };
        status.crossingThreshold = crossingThreshold;
        status.blockingCrossingThreshold = !crossingSatisfied && !playedSet.has(status.sceneId) ? crossingThreshold : null;
        status.crossingIncomingCount = crossingThreshold.incomingCount;
        status.crossingRequiredCount = crossingThreshold.requiredCount;
        status.crossingCompletedCount = crossingThreshold.completedCount;
        status.crossingSatisfied = crossingSatisfied;
        status.crossingOptionalPredecessorIds = crossingSatisfied ? missingRouteSourceIds : [];
        status.predecessorIds = uniqueIds(status.predecessorIds.concat(crossingRoutes.map((route) => route.fromSceneId)));
        status.requiredPredecessorIds = uniqueIds(status.requiredPredecessorIds.concat(crossingRoutes.map((route) => route.fromSceneId)));
        status.completedPredecessorIds = uniqueIds(status.completedPredecessorIds.concat(completedRoutes.map((route) => route.fromSceneId)));
        if (!crossingSatisfied && !playedSet.has(status.sceneId)) {
          status.missingPredecessorIds = uniqueIds(status.missingPredecessorIds.concat(missingRouteSourceIds));
          status.requiredMissingPredecessorIds = uniqueIds(status.requiredMissingPredecessorIds.concat(missingRouteSourceIds));
          status.pathDetails.forEach((detail) => {
            detail.ready = false;
            detail.available = false;
            detail.blockingCrossingThreshold = crossingThreshold;
          });
        }
      }
      status.reachedPathIds = uniqueIds(status.pathDetails.filter((detail) => detail.reached).map((detail) => detail.pathId));
      status.availablePathIds = uniqueIds(status.pathDetails.filter((detail) => detail.available).map((detail) => detail.pathId));
      status.blockedPathIds = uniqueIds(status.pathDetails.filter((detail) => detail.blocked).map((detail) => detail.pathId));
      status.closedPathIds = uniqueIds(status.pathDetails.filter((detail) => detail.pathClosed).map((detail) => detail.pathId));
      status.endPathIds = uniqueIds(status.pathDetails.filter((detail) => detail.endNode).map((detail) => detail.pathId));
      status.reached = status.reachedPathIds.length > 0;
      status.available = status.availablePathIds.length > 0;
      status.pathClosed = status.closedPathIds.length > 0;
      status.endNode = status.endPathIds.length > 0;
      status.thresholdGroups = uniqueThresholdGroups(status.pathDetails.flatMap((detail) => detail.thresholdGroups || []));
      status.blockingThresholds = uniqueThresholdGroups(status.pathDetails
        .filter((detail) => detail.reached && !detail.blocked && !detail.ready)
        .flatMap((detail) => detail.blockingThresholds || []));
      const primaryThreshold = status.thresholdGroups[0] || null;
      status.requiredCount = primaryThreshold ? primaryThreshold.requiredCount : 0;
      status.completedCount = primaryThreshold ? primaryThreshold.completedCount : 0;
      status.satisfied = !!(status.thresholdGroups.length && status.thresholdGroups.every((group) => group.satisfied));
      status.expiredOptional = status.expiredSideSourceSceneIds.length > 0 && !playedSet.has(status.sceneId);
      status.optional = !status.expiredOptional
        && (status.optionalSourceSceneIds.length > 0 || status.activeSideSourceSceneIds.length > 0)
        && !playedSet.has(status.sceneId);
      status.isPathStart = status.pathDetails.some((detail) => detail.isStart)
        && !(globalRequiredIncomingRoutesBySceneId.get(status.sceneId) || []).length;
      status.isPathEnd = status.pathDetails.some((detail) => detail.isEnd);
      status.isSplit = status.successorIds.length > 1 || status.pathDetails.some((detail) => detail.isSplit);
      status.isMerge = status.predecessorIds.length > 1 || status.pathDetails.some((detail) => detail.isMerge);

      status.blocked = !playedSet.has(status.sceneId)
        && !status.available
        && status.pathDetails.some((detail) => detail.blocked);
      status.ready = playedSet.has(status.sceneId)
        || (!!status.available && !status.blocked);
      status.nodeStatus = playedSet.has(status.sceneId)
        ? "Played"
        : status.blocked
          ? "Blocked"
          : status.ready
            ? "Available"
            : "Locked";
    });

    return statusBySceneId;
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
    normalizeBlockRule,
    normalizeBlockRules,
    normalizeIgnoreCrossingBlockSceneIds,
    normalizeEdges,
    normalizeThresholdsForEdges,
    normalizeCrossingThresholdsForPaths,
    outgoingTargetsBySource,
    incomingSourcesByTarget,
    thresholdMapForPath,
    crossingIncomingRoutesForPaths,
    crossingThresholdMapForPaths,
    edgeKey,
    fallbackEdgesFromSceneIds,
    getPathSceneIds,
    getRenderableEdges,
    effectiveEndSceneIds,
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
    buildPathSceneStatuses,
  };
});
