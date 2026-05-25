"use strict";

const {
  DEFAULT_ALGORITHM_SETTINGS,
  buildAlgorithmOrder,
} = require("../../legacy/lib/show-algorithm");

function legacyNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function mapV2CatalogToV1Catalog(catalog) {
  const performers = (catalog.performers || []).map((item) => ({
    id: legacyNumber(item.legacyId),
    name: item.name,
    sortOrder: legacyNumber(item.sortOrder),
    roleSlot: legacyNumber(item.performerSlot),
    isActive: item.active !== false,
    archivedAt: item.archivedAt || "",
  }));
  const characters = (catalog.characters || []).map((item) => ({
    id: legacyNumber(item.legacyId),
    name: item.name,
    description: item.description || "",
    performerId: legacyNumber(item.legacyPerformerId || (item.performerIds || [])[0]),
    labelScores: item.labelScores || {},
    isActive: item.active !== false,
    archivedAt: item.archivedAt || "",
  }));
  const environments = (catalog.environments || []).map((item) => ({
    id: legacyNumber(item.legacyId),
    name: item.name,
    description: item.description || "",
    labelScores: item.labelScores || {},
    isActive: item.active !== false,
    archivedAt: item.archivedAt || "",
  }));
  const labels = (catalog.labels || []).map((item) => ({
    id: legacyNumber(item.legacyId),
    name: item.name,
    sortOrder: legacyNumber(item.sortOrder),
    isActive: item.active !== false,
    archivedAt: item.archivedAt || "",
  }));
  const situations = (catalog.situations || []).map((item) => ({
    id: legacyNumber(item.legacyId),
    title: item.title,
    sortOrder: legacyNumber(item.sortOrder),
    characterCount: legacyNumber(item.characterCount),
    characterSlots: (item.characterSlots || []).map((slot) => {
      if (slot.mode === "random-character") return -1;
      return legacyNumber(slot.legacyCharacterId);
    }),
    characterIds: item.legacyCharacterIds || [],
    situationIds: item.legacySituationIds || [],
    labelIds: item.legacyLabelIds || [],
    environmentId: legacyNumber(item.legacyEnvironmentId),
    environmentMode: item.environmentMode || "selected",
    contextSceneId: legacyNumber(item.legacyContextSceneId),
    promptOverride: item.promptText || item.description || "",
    isActive: item.active !== false,
    archivedAt: item.archivedAt || "",
  }));
  return {
    performers,
    characters,
    environments,
    labels,
    situations,
  };
}

function mapV2PathsToV1Paths(pathsSnapshot) {
  const paths = (pathsSnapshot.paths || []).map((path) => ({
    id: legacyNumber(path.legacyId),
    name: path.name,
    description: path.description || "",
    isActive: path.active !== false,
    archivedAt: path.archivedAt || "",
    sceneIds: path.legacySituationIds || [],
    edges: (path.edges || []).map((edge) => ({
      fromSceneId: legacyNumber(edge.legacyFromSituationId),
      toSceneId: legacyNumber(edge.legacyToSituationId),
      edgeType: edge.edgeType || "required",
    })),
    thresholds: (path.thresholds || []).map((threshold) => ({
      sourceSceneId: legacyNumber(threshold.legacySituationId),
      requiredCount: legacyNumber(threshold.requiredCount) || 1,
    })),
    blockRules: (path.blockRules || []).map((rule) => ({
      sourceSceneId: legacyNumber(rule.legacySourceSituationId),
      includeCrossingPaths: rule.includeCrossingPaths !== false,
    })),
    endSceneIds: (path.nodes || [])
      .filter((node) => node.isEndNode)
      .map((node) => legacyNumber(node.legacySituationId))
      .filter(Boolean),
    ignoreCrossingBlockSceneIds: (path.nodes || [])
      .filter((node) => node.ignoreCrossingBlocks)
      .map((node) => legacyNumber(node.legacySituationId))
      .filter(Boolean),
  }));
  const crossingThresholds = (pathsSnapshot.crossingThresholds || []).map((threshold) => ({
    sceneId: legacyNumber(threshold.legacySituationId),
    requiredCount: legacyNumber(threshold.requiredCount) || 1,
  }));
  return { paths, crossingThresholds };
}

function buildV1OrderFromV2Snapshots({ catalog, paths, runs = [], settings = DEFAULT_ALGORITHM_SETTINGS, preparedNext = null }) {
  const v1Catalog = mapV2CatalogToV1Catalog(catalog);
  const v1Paths = mapV2PathsToV1Paths(paths);
  return buildAlgorithmOrder({
    scenes: v1Catalog.situations,
    runs,
    settings,
    catalog: {
      ...v1Catalog,
      paths: v1Paths.paths,
      crossingThresholds: v1Paths.crossingThresholds,
    },
    preparedNext,
  });
}

module.exports = {
  buildV1OrderFromV2Snapshots,
  mapV2CatalogToV1Catalog,
  mapV2PathsToV1Paths,
};
