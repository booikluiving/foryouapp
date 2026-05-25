"use strict";

const { queryJson } = require("./sqlite-adapter");

function parseJsonArray(value) {
  if (value == null || value === "") return [];
  try {
    const parsed = JSON.parse(String(value));
    return Array.isArray(parsed) ? parsed : [];
  } catch (_err) {
    return [];
  }
}

function parseJsonObject(value) {
  if (value == null || value === "") return {};
  try {
    const parsed = JSON.parse(String(value));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch (_err) {
    return {};
  }
}

function normalizeIds(values) {
  const seen = new Set();
  const ids = [];
  for (const value of values || []) {
    const id = Number.parseInt(String(value || ""), 10);
    if (!Number.isInteger(id) || id < 1 || seen.has(id)) continue;
    seen.add(id);
    ids.push(id);
  }
  return ids;
}

function parseCatalogRows(rows) {
  const labels = (rows.labels || []).map((row) => ({
    id: Number(row.id || 0),
    name: String(row.name || ""),
    sortOrder: Number(row.sort_order || 0),
    isActive: Number(row.is_active || 0) > 0,
    archivedAt: row.archived_at || "",
  })).filter((item) => item.id);
  const labelById = new Map(labels.map((label) => [label.id, label]));

  const characters = (rows.characters || []).map((row) => ({
    id: Number(row.id || 0),
    name: String(row.name || ""),
    description: String(row.description || ""),
    promptText: String(row.prompt_text || ""),
    performerId: row.performer_id ? Number(row.performer_id) : null,
    labelScores: parseJsonObject(row.label_scores_json),
    isActive: Number(row.is_active || 0) > 0,
    archivedAt: row.archived_at || "",
  })).filter((item) => item.id);

  const situations = (rows.situations || []).map((row) => ({
    id: Number(row.id || 0),
    name: String(row.name || ""),
    description: String(row.description || ""),
    promptText: String(row.prompt_text || ""),
    requiredCharacterIds: normalizeIds(parseJsonArray(row.required_character_ids_json)),
    allowedCharacterIds: normalizeIds(parseJsonArray(row.allowed_character_ids_json)),
    labelScores: parseJsonObject(row.label_scores_json),
    isActive: Number(row.is_active || 0) > 0,
    archivedAt: row.archived_at || "",
  })).filter((item) => item.id);

  const environments = (rows.environments || []).map((row) => ({
    id: Number(row.id || 0),
    name: String(row.name || ""),
    description: String(row.description || ""),
    promptText: String(row.prompt_text || ""),
    labelScores: parseJsonObject(row.label_scores_json),
    isActive: Number(row.is_active || 0) > 0,
    archivedAt: row.archived_at || "",
  })).filter((item) => item.id);

  const scenes = (rows.scenes || []).map((row) => {
    const labelIds = normalizeIds(parseJsonArray(row.label_ids_json));
    const sceneLabels = labelIds.map((id) => labelById.get(id)).filter(Boolean);
    return {
      id: Number(row.id || 0),
      title: String(row.title || ""),
      sortOrder: Number(row.sort_order || 0),
      characterCount: Number(row.character_count || 0),
      characterSlots: parseJsonArray(row.character_slots_json),
      characterIds: normalizeIds(parseJsonArray(row.character_ids_json)),
      situationIds: normalizeIds(parseJsonArray(row.situation_ids_json)),
      labelIds,
      labels: sceneLabels,
      labelProfile: {},
      environmentId: row.environment_id ? Number(row.environment_id) : null,
      environmentMode: String(row.environment_mode || "selected"),
      contextSceneId: row.context_scene_id ? Number(row.context_scene_id) : null,
      promptOverride: String(row.prompt_override || ""),
      isActive: Number(row.is_active || 0) > 0,
      archivedAt: row.archived_at || "",
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

async function readLegacyEditorCatalogRows(options = {}) {
  const queryOptions = options.legacySnapshot ? { legacySnapshot: options.legacySnapshot } : options;
  const [scenes, characters, situations, environments, labels] = await Promise.all([
    queryJson(
      `SELECT id, title, sort_order, character_count, character_slots_json, character_ids_json,
        situation_ids_json, label_ids_json, environment_id, environment_mode, context_scene_id,
        prompt_override, is_active, archived_at
       FROM algorithm_scenes
       ORDER BY sort_order, title COLLATE NOCASE, id`,
      queryOptions
    ),
    queryJson(
      `SELECT id, name, description, prompt_text, performer_id, label_scores_json, is_active, archived_at
       FROM algorithm_characters
       ORDER BY name COLLATE NOCASE, id`,
      queryOptions
    ),
    queryJson(
      `SELECT id, name, description, prompt_text, required_character_ids_json, allowed_character_ids_json,
        label_scores_json, is_active, archived_at
       FROM algorithm_situations
       ORDER BY name COLLATE NOCASE, id`,
      queryOptions
    ),
    queryJson(
      `SELECT id, name, description, prompt_text, label_scores_json, is_active, archived_at
       FROM algorithm_environments
       ORDER BY name COLLATE NOCASE, id`,
      queryOptions
    ),
    queryJson(
      `SELECT id, name, sort_order, is_active, archived_at
       FROM algorithm_labels
       ORDER BY sort_order, name COLLATE NOCASE, id`,
      queryOptions
    ),
  ]);
  return parseCatalogRows({ scenes, characters, situations, environments, labels });
}

module.exports = {
  readLegacyEditorCatalogRows,
};
