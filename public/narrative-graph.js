(function initNarrativeGraph(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.ForYouNarrativeGraph = api;
})(typeof globalThis !== "undefined" ? globalThis : window, function narrativeGraphFactory() {
  "use strict";

  const CHARACTER_TYPE = "character";
  const SCENE_TYPE = "scene";
  const ENVIRONMENT_TYPE = "environment";
  const APPEARS_IN_EDGE = "appears_in";
  const HAPPENS_IN_EDGE = "happens_in";

  function normalizeId(value) {
    const id = Number.parseInt(String(value || ""), 10);
    return Number.isInteger(id) && id > 0 ? id : 0;
  }

  function normalizeText(value) {
    return String(value || "").trim();
  }

  function isActive(item) {
    return !!(item && item.isActive && !item.archivedAt);
  }

  function uniqueIds(values) {
    const seen = new Set();
    const out = [];
    for (const value of Array.isArray(values) ? values : []) {
      const id = normalizeId(value);
      if (!id || seen.has(id)) continue;
      seen.add(id);
      out.push(id);
    }
    return out;
  }

  function sceneCharacterIds(scene) {
    return uniqueIds([]
      .concat(Array.isArray(scene && scene.characterIds) ? scene.characterIds : [])
      .concat(Array.isArray(scene && scene.characterSlots) ? scene.characterSlots : []));
  }

  function bump(map, id) {
    const safeId = normalizeId(id);
    if (!safeId) return;
    map.set(safeId, Number(map.get(safeId) || 0) + 1);
  }

  function visibleItems(items, includeInactive) {
    return (Array.isArray(items) ? items : [])
      .filter((item) => item && normalizeId(item.id))
      .filter((item) => includeInactive || isActive(item));
  }

  function buildNarrativeGraphData(catalog = {}, options = {}) {
    const includeInactive = !!options.includeInactive;
    const characters = visibleItems(catalog.characters, includeInactive);
    const scenes = visibleItems(catalog.scenes, includeInactive);
    const environments = visibleItems(catalog.environments, includeInactive);
    const characterById = new Map(characters.map((item) => [normalizeId(item.id), item]));
    const environmentById = new Map(environments.map((item) => [normalizeId(item.id), item]));
    const characterSceneCounts = new Map();
    const environmentSceneCounts = new Map();
    const sceneCharacterCounts = new Map();
    const edges = [];
    const seenEdges = new Set();

    function pushEdge(edge) {
      if (!edge || !edge.data || !edge.data.id || seenEdges.has(edge.data.id)) return;
      seenEdges.add(edge.data.id);
      edges.push(edge);
    }

    for (const scene of scenes) {
      const sceneId = normalizeId(scene.id);
      const characterIds = sceneCharacterIds(scene).filter((id) => characterById.has(id));
      sceneCharacterCounts.set(sceneId, characterIds.length);
      for (const characterId of characterIds) {
        bump(characterSceneCounts, characterId);
        pushEdge({
          data: {
            id: `character-${characterId}-scene-${sceneId}`,
            source: `character:${characterId}`,
            target: `scene:${sceneId}`,
            type: APPEARS_IN_EDGE,
            label: "komt voor in",
            characterId,
            sceneId,
          },
          classes: APPEARS_IN_EDGE,
        });
      }

      const environmentId = scene.environmentMode === "random" ? 0 : normalizeId(scene.environmentId);
      if (environmentId && environmentById.has(environmentId)) {
        bump(environmentSceneCounts, environmentId);
        pushEdge({
          data: {
            id: `scene-${sceneId}-environment-${environmentId}`,
            source: `scene:${sceneId}`,
            target: `environment:${environmentId}`,
            type: HAPPENS_IN_EDGE,
            label: "speelt in",
            sceneId,
            environmentId,
          },
          classes: HAPPENS_IN_EDGE,
        });
      }
    }

    const nodes = [];
    for (const character of characters) {
      const id = normalizeId(character.id);
      const sceneCount = Number(characterSceneCounts.get(id) || 0);
      nodes.push({
        data: {
          id: `character:${id}`,
          entityId: id,
          type: CHARACTER_TYPE,
          typeLabel: "Personage",
          label: normalizeText(character.name) || `Personage ${id}`,
          name: normalizeText(character.name),
          description: normalizeText(character.description),
          sceneCount,
          weight: sceneCount,
          important: sceneCount >= 2,
        },
        classes: CHARACTER_TYPE,
      });
    }

    for (const scene of scenes) {
      const id = normalizeId(scene.id);
      const characterCount = Number(sceneCharacterCounts.get(id) || 0);
      const environmentId = scene.environmentMode === "random" ? 0 : normalizeId(scene.environmentId);
      nodes.push({
        data: {
          id: `scene:${id}`,
          entityId: id,
          type: SCENE_TYPE,
          typeLabel: "Situatie/scène",
          label: normalizeText(scene.title) || `Situatie ${id}`,
          title: normalizeText(scene.title),
          description: normalizeText(scene.promptOverride),
          characterIds: sceneCharacterIds(scene),
          characterCount,
          environmentId,
          environmentMode: normalizeText(scene.environmentMode || "selected"),
          weight: characterCount,
          important: true,
        },
        classes: SCENE_TYPE,
      });
    }

    for (const environment of environments) {
      const id = normalizeId(environment.id);
      const sceneCount = Number(environmentSceneCounts.get(id) || 0);
      nodes.push({
        data: {
          id: `environment:${id}`,
          entityId: id,
          type: ENVIRONMENT_TYPE,
          typeLabel: "Omgeving",
          label: normalizeText(environment.name) || `Omgeving ${id}`,
          name: normalizeText(environment.name),
          description: normalizeText(environment.description),
          sceneCount,
          weight: sceneCount,
          important: sceneCount >= 2,
        },
        classes: ENVIRONMENT_TYPE,
      });
    }

    return {
      nodes,
      edges,
      elements: nodes.concat(edges),
      metadata: {
        nodeTypes: [CHARACTER_TYPE, SCENE_TYPE, ENVIRONMENT_TYPE],
        edgeTypes: [APPEARS_IN_EDGE, HAPPENS_IN_EDGE],
        counts: {
          characters: characters.length,
          scenes: scenes.length,
          environments: environments.length,
          characterSceneEdges: edges.filter((edge) => edge.data.type === APPEARS_IN_EDGE).length,
          sceneEnvironmentEdges: edges.filter((edge) => edge.data.type === HAPPENS_IN_EDGE).length,
        },
      },
      indexes: {
        charactersById: new Map(characters.map((item) => [normalizeId(item.id), item])),
        scenesById: new Map(scenes.map((item) => [normalizeId(item.id), item])),
        environmentsById: new Map(environments.map((item) => [normalizeId(item.id), item])),
      },
    };
  }

  return {
    CHARACTER_TYPE,
    SCENE_TYPE,
    ENVIRONMENT_TYPE,
    APPEARS_IN_EDGE,
    HAPPENS_IN_EDGE,
    buildNarrativeGraphData,
  };
});
