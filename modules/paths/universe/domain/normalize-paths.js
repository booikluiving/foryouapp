"use strict";

function numberValue(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function boolValue(value) {
  return Number(value || 0) > 0;
}

function textValue(value, fallback = "") {
  return String(value ?? fallback);
}

function groupBy(rows, key) {
  const grouped = new Map();
  for (const row of Array.isArray(rows) ? rows : []) {
    const value = Number(row && row[key] || 0);
    if (!grouped.has(value)) grouped.set(value, []);
    grouped.get(value).push(row);
  }
  return grouped;
}

function sceneLabel(sceneId, sceneById) {
  const scene = sceneById.get(Number(sceneId || 0));
  return scene ? textValue(scene.title, `Scene ${sceneId}`) : `Scene ${sceneId}`;
}

function classifyNode({ hasIncoming, hasOutgoing, isEndNode, inPath }) {
  if (!inPath) return "unassigned";
  if (!hasIncoming && !hasOutgoing) return "isolated";
  if (!hasIncoming && hasOutgoing) return "entry";
  if (isEndNode) return "end";
  if (hasIncoming && !hasOutgoing) return "terminal";
  return "middle";
}

function buildMemberships(pathScenes, pathById) {
  const membershipBySceneId = new Map();
  for (const row of pathScenes) {
    const sceneId = Number(row.sceneId || 0);
    const pathId = Number(row.pathId || 0);
    if (!sceneId || !pathId) continue;
    if (!membershipBySceneId.has(sceneId)) membershipBySceneId.set(sceneId, []);
    const path = pathById.get(pathId);
    membershipBySceneId.get(sceneId).push({
      pathId,
      pathName: path ? textValue(path.name, `Pad ${pathId}`) : `Pad ${pathId}`,
      color: path ? textValue(path.color) : "",
      pathSceneId: Number(row.id || 0),
      isEndNode: boolValue(row.isEndNode),
      sortOrder: numberValue(row.sortOrder),
    });
  }
  return membershipBySceneId;
}

function buildNetworkMap({ paths, looseScenes, sceneById, membershipBySceneId }) {
  const nodesBySceneId = new Map();
  const sceneFlags = new Map();

  function ensureFlags(sceneId) {
    if (!sceneFlags.has(sceneId)) {
      sceneFlags.set(sceneId, {
        isEntryNode: false,
        isEndNode: false,
        isTerminalNode: false,
        isIsolatedNode: false,
        pathNodeCount: 0,
      });
    }
    return sceneFlags.get(sceneId);
  }

  for (const pathItem of paths) {
    for (const node of pathItem.nodes || []) {
      const sceneId = Number(node.sceneId || 0);
      if (!sceneId) continue;
      const flags = ensureFlags(sceneId);
      flags.pathNodeCount += 1;
      flags.isEntryNode = flags.isEntryNode || !!node.isEntryNode;
      flags.isEndNode = flags.isEndNode || !!node.isEndNode;
      flags.isTerminalNode = flags.isTerminalNode || !!node.isTerminalNode;
      flags.isIsolatedNode = flags.isIsolatedNode || !!node.isIsolatedNode;
    }
  }

  function ensureNode(sceneId) {
    const safeSceneId = Number(sceneId || 0);
    if (!safeSceneId) return null;
    if (nodesBySceneId.has(safeSceneId)) return nodesBySceneId.get(safeSceneId);
    const scene = sceneById.get(safeSceneId);
    const memberships = (membershipBySceneId.get(safeSceneId) || []).slice()
      .sort((a, b) => Number(a.pathId || 0) - Number(b.pathId || 0));
    const flags = ensureFlags(safeSceneId);
    const node = {
      id: safeSceneId,
      sceneId: safeSceneId,
      title: sceneLabel(safeSceneId, sceneById),
      sortOrder: scene ? numberValue(scene.sortOrder) : 0,
      isActive: scene ? boolValue(scene.isActive) : false,
      archivedAt: scene ? textValue(scene.archivedAt) : "",
      pathMemberships: memberships,
      pathIds: memberships.map((membership) => Number(membership.pathId || 0)).filter(Boolean),
      pathNames: memberships.map((membership) => textValue(membership.pathName)).filter(Boolean),
      membershipCount: memberships.length,
      isCrossingNode: memberships.length > 1,
      crossingLevel: Math.min(Math.max(memberships.length - 1, 0), 3),
      isEntryNode: flags.isEntryNode,
      isEndNode: flags.isEndNode,
      isTerminalNode: flags.isTerminalNode,
      isIsolatedNode: flags.isIsolatedNode,
      pathNodeCount: flags.pathNodeCount,
      degree: 0,
      inDegree: 0,
      outDegree: 0,
      edgeCount: 0,
      source: {
        table: "algorithm_scenes",
        id: safeSceneId,
      },
    };
    nodesBySceneId.set(safeSceneId, node);
    return node;
  }

  for (const sceneId of sceneById.keys()) ensureNode(sceneId);
  for (const loose of looseScenes) ensureNode(loose.sceneId);

  const edgesByPair = new Map();
  for (const pathItem of paths) {
    for (const edge of pathItem.edges || []) {
      const fromSceneId = Number(edge.fromSceneId || 0);
      const toSceneId = Number(edge.toSceneId || 0);
      if (!fromSceneId || !toSceneId) continue;
      const fromNode = ensureNode(fromSceneId);
      const toNode = ensureNode(toSceneId);
      if (!fromNode || !toNode) continue;
      const low = Math.min(fromSceneId, toSceneId);
      const high = Math.max(fromSceneId, toSceneId);
      const key = fromSceneId === toSceneId ? `${fromSceneId}:${toSceneId}:loop` : `${low}:${high}`;
      if (!edgesByPair.has(key)) {
        edgesByPair.set(key, {
          edgeId: key,
          fromSceneId: low,
          toSceneId: high,
          fromTitle: sceneLabel(low, sceneById),
          toTitle: sceneLabel(high, sceneById),
          pathIds: new Set(),
          pathNames: new Set(),
          directions: new Set(),
          edgeTypes: new Set(),
          sourceEdgeIds: [],
          count: 0,
          isLoop: fromSceneId === toSceneId,
        });
      }
      const aggregate = edgesByPair.get(key);
      aggregate.pathIds.add(Number(pathItem.pathId || 0));
      aggregate.pathNames.add(textValue(pathItem.name, `Pad ${pathItem.pathId}`));
      aggregate.directions.add(`${fromSceneId}->${toSceneId}`);
      aggregate.edgeTypes.add(textValue(edge.type, "required") || "required");
      aggregate.sourceEdgeIds.push(Number(edge.edgeId || 0));
      aggregate.count += 1;
      fromNode.outDegree += 1;
      toNode.inDegree += 1;
    }
  }

  const edges = Array.from(edgesByPair.values()).map((edge) => {
    const pathIds = Array.from(edge.pathIds).filter(Boolean).sort((a, b) => a - b);
    const pathNames = Array.from(edge.pathNames).filter(Boolean).sort((a, b) => a.localeCompare(b, "nl", { numeric: true }));
    const directions = Array.from(edge.directions).sort();
    const edgeTypes = Array.from(edge.edgeTypes).sort();
    const fromNode = nodesBySceneId.get(edge.fromSceneId);
    const toNode = nodesBySceneId.get(edge.toSceneId);
    if (fromNode) {
      fromNode.degree += edge.isLoop ? 0 : 1;
      fromNode.edgeCount += edge.count;
    }
    if (toNode && toNode !== fromNode) {
      toNode.degree += 1;
      toNode.edgeCount += edge.count;
    }
    return {
      edgeId: edge.edgeId,
      fromSceneId: edge.fromSceneId,
      toSceneId: edge.toSceneId,
      fromTitle: edge.fromTitle,
      toTitle: edge.toTitle,
      pathIds,
      pathNames,
      pathCount: pathIds.length,
      directions,
      edgeTypes,
      count: edge.count,
      isLoop: edge.isLoop,
      isMultiPath: pathIds.length > 1 || edge.count > 1,
      sourceEdgeIds: edge.sourceEdgeIds.filter(Boolean).sort((a, b) => a - b),
    };
  }).sort((a, b) => {
    if (b.pathCount !== a.pathCount) return b.pathCount - a.pathCount;
    if (b.count !== a.count) return b.count - a.count;
    if (a.fromSceneId !== b.fromSceneId) return a.fromSceneId - b.fromSceneId;
    return a.toSceneId - b.toSceneId;
  });

  const nodes = Array.from(nodesBySceneId.values()).sort((a, b) => {
    const sortDiff = numberValue(a.sortOrder) - numberValue(b.sortOrder);
    if (sortDiff) return sortDiff;
    return a.sceneId - b.sceneId;
  });

  const adjacency = new Map(nodes.map((node) => [node.sceneId, new Set()]));
  edges.forEach((edge) => {
    if (edge.isLoop) return;
    if (!adjacency.has(edge.fromSceneId)) adjacency.set(edge.fromSceneId, new Set());
    if (!adjacency.has(edge.toSceneId)) adjacency.set(edge.toSceneId, new Set());
    adjacency.get(edge.fromSceneId).add(edge.toSceneId);
    adjacency.get(edge.toSceneId).add(edge.fromSceneId);
  });

  const seen = new Set();
  const components = [];
  for (const node of nodes) {
    if (seen.has(node.sceneId)) continue;
    const stack = [node.sceneId];
    const component = [];
    seen.add(node.sceneId);
    while (stack.length) {
      const sceneId = stack.pop();
      component.push(sceneId);
      for (const nextSceneId of adjacency.get(sceneId) || []) {
        if (seen.has(nextSceneId)) continue;
        seen.add(nextSceneId);
        stack.push(nextSceneId);
      }
    }
    components.push(component);
  }
  components.sort((a, b) => b.length - a.length);

  const maxDegree = nodes.reduce((max, node) => Math.max(max, node.degree), 0);
  const averageDegree = nodes.length
    ? nodes.reduce((sum, node) => sum + node.degree, 0) / nodes.length
    : 0;

  return {
    nodes,
    edges,
    components: components.map((sceneIds, index) => ({
      id: index + 1,
      sceneIds,
      size: sceneIds.length,
    })),
    summary: {
      nodeCount: nodes.length,
      pathSceneNodeCount: nodes.filter((node) => node.membershipCount > 0).length,
      looseNodeCount: nodes.filter((node) => node.membershipCount === 0).length,
      edgeCount: edges.length,
      sourceEdgeCount: edges.reduce((sum, edge) => sum + edge.count, 0),
      multiPathEdgeCount: edges.filter((edge) => edge.isMultiPath).length,
      crossingNodeCount: nodes.filter((node) => node.isCrossingNode).length,
      componentCount: components.length,
      largestComponentSize: components.length ? components[0].length : 0,
      isolatedNodeCount: nodes.filter((node) => node.degree === 0).length,
      maxDegree,
      averageDegree,
    },
  };
}

function buildGraph(source) {
  const safeSource = source && typeof source === "object" ? source : {};
  const scenes = Array.isArray(safeSource.scenes) ? safeSource.scenes : [];
  const rawPaths = Array.isArray(safeSource.paths) ? safeSource.paths : [];
  const rawPathScenes = Array.isArray(safeSource.pathScenes) ? safeSource.pathScenes : [];
  const rawPathEdges = Array.isArray(safeSource.pathEdges) ? safeSource.pathEdges : [];

  const sceneById = new Map(scenes.map((scene) => [Number(scene.id || 0), scene]));
  const pathById = new Map(rawPaths.map((path) => [Number(path.id || 0), path]));
  const pathScenesByPathId = groupBy(rawPathScenes, "pathId");
  const pathEdgesByPathId = groupBy(rawPathEdges, "pathId");
  const thresholdsByPathId = groupBy(safeSource.thresholds || [], "pathId");
  const nodeBlocksByPathId = groupBy(safeSource.nodeBlocks || [], "pathId");
  const membershipBySceneId = buildMemberships(rawPathScenes, pathById);

  const paths = rawPaths.map((pathRow) => {
    const pathId = Number(pathRow.id || 0);
    const pathSceneRows = pathScenesByPathId.get(pathId) || [];
    const pathEdgeRows = pathEdgesByPathId.get(pathId) || [];
    const sceneIds = pathSceneRows.map((row) => Number(row.sceneId || 0)).filter(Boolean);
    const sceneIdSet = new Set(sceneIds);
    const indexBySceneId = new Map(sceneIds.map((sceneId, index) => [sceneId, index]));
    const incomingBySceneId = new Map(sceneIds.map((sceneId) => [sceneId, []]));
    const outgoingBySceneId = new Map(sceneIds.map((sceneId) => [sceneId, []]));

    for (const edge of pathEdgeRows) {
      const fromSceneId = Number(edge.fromSceneId || 0);
      const toSceneId = Number(edge.toSceneId || 0);
      if (!sceneIdSet.has(fromSceneId) || !sceneIdSet.has(toSceneId)) continue;
      outgoingBySceneId.get(fromSceneId).push(edge);
      incomingBySceneId.get(toSceneId).push(edge);
    }

    const nodes = pathSceneRows.map((row, index) => {
      const sceneId = Number(row.sceneId || 0);
      const scene = sceneById.get(sceneId);
      const incoming = incomingBySceneId.get(sceneId) || [];
      const outgoing = outgoingBySceneId.get(sceneId) || [];
      const memberships = membershipBySceneId.get(sceneId) || [];
      const isEndNode = boolValue(row.isEndNode);
      const role = classifyNode({
        hasIncoming: incoming.length > 0,
        hasOutgoing: outgoing.length > 0,
        isEndNode,
        inPath: true,
      });

      return {
        nodeId: `${pathId}:${sceneId}`,
        sceneId,
        pathId,
        pathIndex: index,
        title: sceneLabel(sceneId, sceneById),
        role,
        isEntryNode: role === "entry",
        isEndNode,
        isTerminalNode: role === "terminal",
        isIsolatedNode: role === "isolated",
        isCrossingNode: memberships.length > 1,
        isActive: scene ? boolValue(scene.isActive) : false,
        archivedAt: scene ? textValue(scene.archivedAt) : "",
        incomingCount: incoming.length,
        outgoingCount: outgoing.length,
        pathMemberships: memberships,
        source: {
          table: "algorithm_path_scenes",
          id: Number(row.id || 0),
          sortOrder: numberValue(row.sortOrder),
          ignoreCrossingBlocks: boolValue(row.ignoreCrossingBlocks),
        },
      };
    });

    const edges = pathEdgeRows.map((edge, index) => {
      const fromSceneId = Number(edge.fromSceneId || 0);
      const toSceneId = Number(edge.toSceneId || 0);
      const fromIndex = indexBySceneId.has(fromSceneId) ? indexBySceneId.get(fromSceneId) : null;
      const toIndex = indexBySceneId.has(toSceneId) ? indexBySceneId.get(toSceneId) : null;
      return {
        edgeId: Number(edge.id || 0),
        pathId,
        fromSceneId,
        toSceneId,
        fromIndex,
        toIndex,
        fromTitle: sceneLabel(fromSceneId, sceneById),
        toTitle: sceneLabel(toSceneId, sceneById),
        type: textValue(edge.edgeType, "required") || "required",
        sortOrder: numberValue(edge.sortOrder),
        valid: fromIndex !== null && toIndex !== null && fromIndex !== toIndex,
        source: {
          table: "algorithm_path_edges",
          id: Number(edge.id || 0),
        },
      };
    });

    return {
      pathId,
      name: textValue(pathRow.name, `Pad ${pathId}`),
      description: textValue(pathRow.description),
      color: textValue(pathRow.color),
      sortOrder: numberValue(pathRow.sortOrder),
      edgeMode: textValue(pathRow.edgeMode, "legacy") || "legacy",
      isActive: boolValue(pathRow.isActive),
      archivedAt: textValue(pathRow.archivedAt),
      createdAt: textValue(pathRow.createdAt),
      updatedAt: textValue(pathRow.updatedAt),
      nodes,
      edges,
      thresholds: (thresholdsByPathId.get(pathId) || []).map((row) => ({
        sourceSceneId: Number(row.sourceSceneId || 0),
        requiredCount: Number(row.requiredCount || 0),
      })),
      blockRules: (nodeBlocksByPathId.get(pathId) || []).map((row) => ({
        sourceSceneId: Number(row.sourceSceneId || 0),
        includeCrossingPaths: boolValue(row.includeCrossingPaths),
      })),
      source: {
        table: "algorithm_paths",
        id: pathId,
      },
    };
  });

  const assignedSceneIds = new Set(rawPathScenes.map((row) => Number(row.sceneId || 0)).filter(Boolean));
  const looseScenes = scenes
    .filter((scene) => !assignedSceneIds.has(Number(scene.id || 0)))
    .map((scene) => ({
      sceneId: Number(scene.id || 0),
      title: textValue(scene.title, `Scene ${scene.id}`),
      role: "unassigned",
      isActive: boolValue(scene.isActive),
      archivedAt: textValue(scene.archivedAt),
      sortOrder: numberValue(scene.sortOrder),
      pathMemberships: [],
      source: {
        table: "algorithm_scenes",
        id: Number(scene.id || 0),
      },
    }));

  const crossings = Array.from(membershipBySceneId.entries())
    .filter(([, memberships]) => memberships.length > 1)
    .map(([sceneId, memberships]) => ({
      sceneId,
      title: sceneLabel(sceneId, sceneById),
      pathMemberships: memberships,
    }));

  const isolatedNodes = paths.flatMap((path) => path.nodes.filter((node) => node.isIsolatedNode));
  const networkMap = buildNetworkMap({
    paths,
    looseScenes,
    sceneById,
    membershipBySceneId,
  });

  return {
    terms: {
      visualStar: "node",
      visualConnection: "edge",
      entryNode: "derived from edges, not stored",
      endNode: "stored as algorithm_path_scenes.is_end_node",
      isolatedNode: "path node without incoming or outgoing edges",
      unassignedScene: "scene without path membership",
      crossing: "scene with memberships in more than one path",
    },
    paths,
    looseScenes,
    isolatedNodes,
    crossings,
    networkMap,
    summary: {
      pathCount: paths.length,
      activePathCount: paths.filter((path) => path.isActive && !path.archivedAt).length,
      nodeCount: paths.reduce((sum, path) => sum + path.nodes.length, 0),
      edgeCount: paths.reduce((sum, path) => sum + path.edges.length, 0),
      crossingCount: crossings.length,
      isolatedNodeCount: isolatedNodes.length,
      looseSceneCount: looseScenes.length,
      sceneCount: scenes.length,
    },
  };
}

module.exports = {
  buildGraph,
  classifyNode,
};
