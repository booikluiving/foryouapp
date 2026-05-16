(function () {
  "use strict";

  const Layout = window.ForUniverseLayout;

  function numberValue(value, fallback = 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  }

  function textValue(value, fallback = "") {
    const text = String(value ?? "");
    return text || fallback;
  }

  function bySortOrderThenId(a, b) {
    const sortA = numberValue(a.sortOrder ?? (a.source && a.source.sortOrder), 0);
    const sortB = numberValue(b.sortOrder ?? (b.source && b.source.sortOrder), 0);
    if (sortA !== sortB) return sortA - sortB;
    return numberValue(a.pathId ?? a.sceneId ?? a.id, 0) - numberValue(b.pathId ?? b.sceneId ?? b.id, 0);
  }

  function sceneFromNode(node) {
    return {
      id: numberValue(node.sceneId),
      sceneId: numberValue(node.sceneId),
      title: textValue(node.title, `Scene ${node.sceneId}`),
      role: textValue(node.role),
      pathMemberships: Array.isArray(node.pathMemberships) ? node.pathMemberships : [],
      isActive: !!node.isActive,
      archivedAt: textValue(node.archivedAt),
    };
  }

  function buildSceneIndex(graph) {
    const sceneById = new Map();

    for (const pathItem of Array.isArray(graph.paths) ? graph.paths : []) {
      for (const node of Array.isArray(pathItem.nodes) ? pathItem.nodes : []) {
        const scene = sceneFromNode(node);
        if (!scene.sceneId) continue;
        const existing = sceneById.get(scene.sceneId) || {};
        sceneById.set(scene.sceneId, {
          ...existing,
          ...scene,
          title: scene.title || existing.title || `Scene ${scene.sceneId}`,
          pathMemberships: scene.pathMemberships.length ? scene.pathMemberships : existing.pathMemberships || [],
        });
      }
    }

    for (const loose of Array.isArray(graph.looseScenes) ? graph.looseScenes : []) {
      const sceneId = numberValue(loose.sceneId);
      if (!sceneId || sceneById.has(sceneId)) continue;
      sceneById.set(sceneId, {
        id: sceneId,
        sceneId,
        title: textValue(loose.title, `Scene ${sceneId}`),
        role: "unassigned",
        pathMemberships: [],
        isActive: !!loose.isActive,
        archivedAt: textValue(loose.archivedAt),
      });
    }

    return sceneById;
  }

  function deriveSets(pathItem, nodes, edges) {
    const incoming = new Map(nodes.map((node) => [numberValue(node.sceneId), 0]));
    const outgoing = new Map(nodes.map((node) => [numberValue(node.sceneId), 0]));

    for (const edge of edges) {
      incoming.set(numberValue(edge.toSceneId), (incoming.get(numberValue(edge.toSceneId)) || 0) + 1);
      outgoing.set(numberValue(edge.fromSceneId), (outgoing.get(numberValue(edge.fromSceneId)) || 0) + 1);
    }

    const entrySceneIds = [];
    const endSceneIds = [];
    const isolatedSceneIds = [];

    for (const node of nodes) {
      const sceneId = numberValue(node.sceneId);
      if (!sceneId) continue;
      const hasIncoming = (incoming.get(sceneId) || 0) > 0;
      const hasOutgoing = (outgoing.get(sceneId) || 0) > 0;
      if (node.isEntryNode || node.role === "entry" || (!hasIncoming && hasOutgoing)) entrySceneIds.push(sceneId);
      if (node.isEndNode || node.role === "end") endSceneIds.push(sceneId);
      if (node.isIsolatedNode || node.role === "isolated" || (!hasIncoming && !hasOutgoing)) isolatedSceneIds.push(sceneId);
    }

    return {
      entrySceneIds,
      endSceneIds,
      isolatedSceneIds,
      nodeBySceneId: new Map(nodes.map((node) => [numberValue(node.sceneId), node])),
      pathId: numberValue(pathItem.pathId),
    };
  }

  function normalizePath(pathItem, index) {
    const nodes = (Array.isArray(pathItem.nodes) ? pathItem.nodes : [])
      .slice()
      .sort((a, b) => {
        const sourceA = a.source && Number.isFinite(Number(a.source.sortOrder)) ? Number(a.source.sortOrder) : a.pathIndex;
        const sourceB = b.source && Number.isFinite(Number(b.source.sortOrder)) ? Number(b.source.sortOrder) : b.pathIndex;
        if (sourceA !== sourceB) return numberValue(sourceA) - numberValue(sourceB);
        return numberValue(a.sceneId) - numberValue(b.sceneId);
      });
    const nodeIds = nodes.map((node) => numberValue(node.sceneId)).filter(Boolean);
    const nodeIdSet = new Set(nodeIds);
    const edges = (Array.isArray(pathItem.edges) ? pathItem.edges : [])
      .filter((edge) => edge && edge.valid !== false)
      .filter((edge) => nodeIdSet.has(numberValue(edge.fromSceneId)) && nodeIdSet.has(numberValue(edge.toSceneId)))
      .map((edge) => ({
        edgeId: numberValue(edge.edgeId),
        fromSceneId: numberValue(edge.fromSceneId),
        toSceneId: numberValue(edge.toSceneId),
        type: textValue(edge.type, "required") || "required",
        sortOrder: numberValue(edge.sortOrder),
      }))
      .sort(bySortOrderThenId);
    const derived = deriveSets(pathItem, nodes, edges);

    return {
      id: String(pathItem.pathId || index + 1),
      pathId: numberValue(pathItem.pathId),
      name: textValue(pathItem.name, `Pad ${pathItem.pathId || index + 1}`),
      description: textValue(pathItem.description),
      group: "",
      color: textValue(pathItem.color),
      sortOrder: numberValue(pathItem.sortOrder),
      edgeMode: textValue(pathItem.edgeMode),
      isActive: !!pathItem.isActive,
      archivedAt: textValue(pathItem.archivedAt),
      nodeIds,
      nodes,
      edges,
      endSceneIds: derived.endSceneIds,
      entrySceneIds: derived.entrySceneIds,
      isolatedSceneIds: derived.isolatedSceneIds,
      nodeBySceneId: derived.nodeBySceneId,
      source: pathItem.source || {},
    };
  }

  function normalizeNetworkMap(networkMap, sceneById) {
    const safeNetwork = networkMap && typeof networkMap === "object" ? networkMap : {};
    const nodes = (Array.isArray(safeNetwork.nodes) ? safeNetwork.nodes : [])
      .map((node) => {
        const sceneId = numberValue(node.sceneId ?? node.id);
        if (!sceneId) return null;
        const existing = sceneById.get(sceneId);
        const pathMemberships = Array.isArray(node.pathMemberships)
          ? node.pathMemberships.map((membership) => ({
              pathId: numberValue(membership.pathId),
              pathName: textValue(membership.pathName, `Pad ${membership.pathId}`),
              color: textValue(membership.color),
            })).filter((membership) => membership.pathId)
          : [];
        const normalized = {
          id: sceneId,
          sceneId,
          title: textValue(node.title, existing ? existing.title : `Scene ${sceneId}`),
          sortOrder: numberValue(node.sortOrder),
          isActive: !!node.isActive,
          archivedAt: textValue(node.archivedAt),
          pathMemberships,
          pathIds: (Array.isArray(node.pathIds) ? node.pathIds : pathMemberships.map((membership) => membership.pathId))
            .map((pathId) => numberValue(pathId))
            .filter(Boolean),
          pathNames: (Array.isArray(node.pathNames) ? node.pathNames : pathMemberships.map((membership) => membership.pathName))
            .map((pathName) => textValue(pathName))
            .filter(Boolean),
          membershipCount: numberValue(node.membershipCount, pathMemberships.length),
          isCrossingNode: !!node.isCrossingNode || pathMemberships.length > 1,
          crossingLevel: numberValue(node.crossingLevel, Math.min(Math.max(pathMemberships.length - 1, 0), 3)),
          isEntryNode: !!node.isEntryNode,
          isEndNode: !!node.isEndNode,
          isTerminalNode: !!node.isTerminalNode,
          isIsolatedNode: !!node.isIsolatedNode,
          degree: numberValue(node.degree),
          inDegree: numberValue(node.inDegree),
          outDegree: numberValue(node.outDegree),
          edgeCount: numberValue(node.edgeCount),
        };
        if (!existing) sceneById.set(sceneId, {
          id: sceneId,
          sceneId,
          title: normalized.title,
          role: normalized.membershipCount ? "network" : "unassigned",
          pathMemberships,
          isActive: normalized.isActive,
          archivedAt: normalized.archivedAt,
        });
        return normalized;
      })
      .filter(Boolean)
      .sort(bySortOrderThenId);

    const nodeIds = new Set(nodes.map((node) => node.sceneId));
    const edges = (Array.isArray(safeNetwork.edges) ? safeNetwork.edges : [])
      .map((edge) => {
        const fromSceneId = numberValue(edge.fromSceneId);
        const toSceneId = numberValue(edge.toSceneId);
        if (!fromSceneId || !toSceneId || !nodeIds.has(fromSceneId) || !nodeIds.has(toSceneId)) return null;
        return {
          edgeId: textValue(edge.edgeId, `${fromSceneId}:${toSceneId}`),
          fromSceneId,
          toSceneId,
          fromTitle: textValue(edge.fromTitle, `Scene ${fromSceneId}`),
          toTitle: textValue(edge.toTitle, `Scene ${toSceneId}`),
          pathIds: (Array.isArray(edge.pathIds) ? edge.pathIds : []).map((pathId) => numberValue(pathId)).filter(Boolean),
          pathNames: (Array.isArray(edge.pathNames) ? edge.pathNames : []).map((pathName) => textValue(pathName)).filter(Boolean),
          pathCount: numberValue(edge.pathCount),
          directions: Array.isArray(edge.directions) ? edge.directions.map((value) => textValue(value)).filter(Boolean) : [],
          edgeTypes: Array.isArray(edge.edgeTypes) ? edge.edgeTypes.map((value) => textValue(value)).filter(Boolean) : [],
          count: numberValue(edge.count, 1),
          isLoop: !!edge.isLoop || fromSceneId === toSceneId,
          isMultiPath: !!edge.isMultiPath,
        };
      })
      .filter(Boolean);

    return {
      nodes,
      edges,
      nodeBySceneId: new Map(nodes.map((node) => [node.sceneId, node])),
      summary: safeNetwork.summary || {
        nodeCount: nodes.length,
        edgeCount: edges.length,
      },
    };
  }

  function runtimeOverlay(runtime) {
    const currentSceneId = runtime && runtime.currentScene ? numberValue(runtime.currentScene.sceneId) : 0;
    const playedSceneIds = new Set((runtime && runtime.playedSceneIds || []).map((sceneId) => numberValue(sceneId)).filter(Boolean));
    const releasedSceneIds = new Set(playedSceneIds);
    if (currentSceneId) releasedSceneIds.add(currentSceneId);
    const nextSceneIds = new Set();
    const availableSceneIds = new Set();
    for (const scene of runtime && runtime.preparedNextScenes || []) {
      const sceneId = numberValue(scene.sceneId);
      if (sceneId) {
        nextSceneIds.add(sceneId);
        releasedSceneIds.add(sceneId);
      }
    }
    for (const scene of runtime && runtime.availableScenes || []) {
      const sceneId = numberValue(scene.sceneId);
      if (sceneId) {
        availableSceneIds.add(sceneId);
        releasedSceneIds.add(sceneId);
      }
    }
    for (const scene of runtime && runtime.graphNextScenes || []) {
      const sceneId = numberValue(scene.sceneId);
      if (sceneId && !availableSceneIds.has(sceneId)) nextSceneIds.add(sceneId);
    }
    const activePathIds = new Set((runtime && runtime.activePathCandidates || [])
      .map((pathItem) => String(numberValue(pathItem.pathId)))
      .filter((pathId) => pathId !== "0"));
    const hasActiveRun = !!(
      runtime
      && (
        currentSceneId
        || (runtime.summary && runtime.summary.hasActiveRun)
      )
    );
    const isReleaseLimited = !!(
      runtime
      && runtime.session
      && runtime.session.isActive
      && runtime.session.algorithmRunStarted
      && hasActiveRun
    );

    return {
      raw: runtime || null,
      currentSceneId,
      playedSceneIds,
      nextSceneIds,
      availableSceneIds,
      releasedSceneIds,
      activePathIds,
      hasActiveRun,
      isReleaseLimited,
      releasedCount: releasedSceneIds.size,
      hasRuntime: !!runtime,
    };
  }

  function statusForScene(sceneId, runtime) {
    const safeSceneId = numberValue(sceneId);
    if (!safeSceneId || !runtime) return "";
    if (!runtime.isReleaseLimited) return "";
    if (runtime.currentSceneId === safeSceneId) return "current";
    if (runtime.nextSceneIds.has(safeSceneId)) return "next";
    if (runtime.availableSceneIds && runtime.availableSceneIds.has(safeSceneId)) return "available";
    if (runtime.playedSceneIds.has(safeSceneId)) return "played";
    return "";
  }

  function labelForStatus(status) {
    if (status === "current") return "speelt nu";
    if (status === "next") return "volgende";
    if (status === "available") return "beschikbaar";
    if (status === "played") return "gespeeld";
    return "nog niet gespeeld";
  }

  function buildSkyModel(graph, runtime) {
    const safeGraph = graph && typeof graph === "object" ? graph : {};
    const sceneById = buildSceneIndex(safeGraph);
    const crossingSceneIds = new Set((Array.isArray(safeGraph.crossings) ? safeGraph.crossings : [])
      .map((item) => numberValue(item.sceneId))
      .filter(Boolean));
    const crossingLevelBySceneId = new Map((Array.isArray(safeGraph.crossings) ? safeGraph.crossings : [])
      .map((item) => {
        const sceneId = numberValue(item.sceneId);
        const membershipCount = Array.isArray(item.pathMemberships) ? item.pathMemberships.length : 0;
        return [sceneId, Math.min(Math.max(membershipCount - 1, 1), 3)];
      })
      .filter(([sceneId]) => !!sceneId));
    const paths = Layout.applyLayout((Array.isArray(safeGraph.paths) ? safeGraph.paths : [])
      .slice()
      .sort(bySortOrderThenId)
      .map(normalizePath));
    const looseScenes = (Array.isArray(safeGraph.looseScenes) ? safeGraph.looseScenes : [])
      .slice()
      .sort(bySortOrderThenId)
      .map((scene) => ({
        id: numberValue(scene.sceneId),
        sceneId: numberValue(scene.sceneId),
        title: textValue(scene.title, `Scene ${scene.sceneId}`),
        role: "unassigned",
        pathMemberships: [],
      }));
    const networkMap = normalizeNetworkMap(safeGraph.networkMap, sceneById);

    for (const pathItem of paths) {
      for (const node of pathItem.nodes) {
        const sceneId = numberValue(node.sceneId);
        if (node.isCrossingNode) crossingSceneIds.add(sceneId);
        if (node.isCrossingNode && !crossingLevelBySceneId.has(sceneId)) {
          const membershipCount = Array.isArray(node.pathMemberships) ? node.pathMemberships.length : 0;
          crossingLevelBySceneId.set(sceneId, Math.min(Math.max(membershipCount - 1, 1), 3));
        }
      }
    }

    return {
      paths,
      looseScenes,
      looseSceneIds: looseScenes.map((scene) => scene.sceneId),
      networkMap,
      sceneById,
      crossingSceneIds,
      crossingLevelBySceneId,
      runtime: runtimeOverlay(runtime),
      summary: safeGraph.summary || {
        pathCount: paths.length,
        looseSceneCount: looseScenes.length,
        nodeCount: paths.reduce((sum, pathItem) => sum + pathItem.nodeIds.length, 0),
        edgeCount: paths.reduce((sum, pathItem) => sum + pathItem.edges.length, 0),
      },
      sourceTerms: safeGraph.terms || {},
    };
  }

  window.ForUniverseData = {
    buildSkyModel,
    labelForStatus,
    statusForScene,
  };
})();
