"use strict";

const DEFAULT_CATALOG_BASE_URL = "http://127.0.0.1:3021";

function catalogBaseUrl() {
  return String(process.env.V2_PATHS_CATALOG_URL || DEFAULT_CATALOG_BASE_URL).replace(/\/+$/, "");
}

function legacyNumber(item) {
  const legacyId = Number(item && item.legacyId);
  if (Number.isInteger(legacyId) && legacyId > 0) return legacyId;
  const match = String(item && item.id || "").match(/:(\d+)$/);
  return match ? Number(match[1]) : 0;
}

async function fetchCatalogReadModel() {
  const url = `${catalogBaseUrl()}/v0/catalog/read-model`;
  let response;
  try {
    response = await fetch(url);
  } catch (err) {
    const wrapped = new Error(`catalog_unavailable:${err.message}`);
    wrapped.statusCode = 503;
    throw wrapped;
  }
  const body = await response.json();
  if (!response.ok) {
    const wrapped = new Error(`catalog_unavailable:${response.status}:${JSON.stringify(body)}`);
    wrapped.statusCode = 503;
    throw wrapped;
  }
  return body;
}

function toEditorCatalog(readModel) {
  const labels = (readModel.labels || []).map((item) => ({
    id: legacyNumber(item),
    name: String(item.name || ""),
    sortOrder: Number(item.sortOrder || 0),
    isActive: item.active !== false,
    archivedAt: item.archivedAt || "",
  })).filter((item) => item.id);
  const labelById = new Map(labels.map((item) => [item.id, item]));

  const characters = (readModel.characters || []).map((item) => ({
    id: legacyNumber(item),
    name: String(item.name || ""),
    description: String(item.description || ""),
    promptText: String(item.promptText || item.description || ""),
    performerId: Number(item.legacyPerformerId || legacyNumber({ id: (item.performerIds || [])[0] }) || 0) || null,
    labelScores: item.labelScores || {},
    isActive: item.active !== false,
    archivedAt: item.archivedAt || "",
  })).filter((item) => item.id);

  const environments = (readModel.environments || []).map((item) => ({
    id: legacyNumber(item),
    name: String(item.name || ""),
    description: String(item.description || ""),
    promptText: String(item.promptText || item.description || ""),
    labelScores: item.labelScores || {},
    isActive: item.active !== false,
    archivedAt: item.archivedAt || "",
  })).filter((item) => item.id);

  const situations = ((readModel.legacy && readModel.legacy.algorithmSituations) || []).map((item) => ({
    id: Number(item.legacyId || 0),
    name: String(item.name || ""),
    description: String(item.description || ""),
    promptText: String(item.promptText || item.description || ""),
    requiredCharacterIds: (item.requiredCharacterIds || []).map((characterId) => legacyNumber({ id: characterId })).filter(Boolean),
    allowedCharacterIds: (item.allowedCharacterIds || []).map((characterId) => legacyNumber({ id: characterId })).filter(Boolean),
    labelScores: item.labelScores || {},
    isActive: item.active !== false,
    archivedAt: item.archivedAt || "",
  })).filter((item) => item.id);

  const scenes = (readModel.situations || []).map((item) => {
    const labelIds = (item.labelIds || []).map((labelId) => legacyNumber({ id: labelId })).filter(Boolean);
    return {
      id: legacyNumber(item),
      title: String(item.title || ""),
      sortOrder: Number(item.sortOrder || 0),
      characterCount: Number(item.characterCount || (item.characterIds || []).length || 0),
      characterSlots: (item.characterSlots || []).map((slot) => {
        if (slot.mode === "random-character") return -1;
        return Number(slot.legacyCharacterId || legacyNumber({ id: slot.characterId }) || 0);
      }),
      characterIds: (item.characterIds || []).map((characterId) => legacyNumber({ id: characterId })).filter(Boolean),
      situationIds: Array.isArray(item.legacySituationIds) ? item.legacySituationIds : [],
      labelIds,
      labels: labelIds.map((id) => labelById.get(id)).filter(Boolean),
      labelProfile: {},
      environmentId: item.legacyEnvironmentId || legacyNumber({ id: item.environmentId }) || null,
      environmentMode: String(item.environmentMode || "selected"),
      contextSceneId: item.legacyContextSceneId || legacyNumber({ id: item.contextSituationId }) || null,
      promptOverride: String(item.promptText || item.description || ""),
      isActive: item.active !== false,
      archivedAt: item.archivedAt || "",
    };
  }).filter((item) => item.id);

  return {
    scenes,
    characters,
    situations,
    environments,
    labels,
  };
}

async function fetchEditorCatalog() {
  return toEditorCatalog(await fetchCatalogReadModel());
}

module.exports = {
  DEFAULT_CATALOG_BASE_URL,
  catalogBaseUrl,
  fetchCatalogReadModel,
  fetchEditorCatalog,
  toEditorCatalog,
};
