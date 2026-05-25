"use strict";

const {
  CATALOG_SCHEMA_VERSION,
  toCatalogId,
  toMediaAssetId,
} = require("../../../shared/contracts/catalog-v0");
const {
  ENVIRONMENT_ASSET_TYPES,
  readEnvironmentAssetFiles,
  readLegacyCatalogRows,
} = require("../legacy-readonly/sqlite-adapter");
const {
  applyCatalogStore,
  readCatalogStore,
} = require("../write-model/catalog-store");

function boolFromSqlite(value) {
  return Number(value) === 1;
}

function nullableText(value) {
  return value == null ? "" : String(value);
}

function parseJsonArray(text) {
  if (text == null || text === "") return [];
  try {
    const parsed = JSON.parse(String(text));
    return Array.isArray(parsed) ? parsed : [];
  } catch (_err) {
    return [];
  }
}

function parseJsonObject(text) {
  if (text == null || text === "") return {};
  try {
    const parsed = JSON.parse(String(text));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch (_err) {
    return {};
  }
}

function uniquePositiveIntegers(values) {
  const seen = new Set();
  const output = [];
  for (const value of values || []) {
    const number = Number(value);
    if (!Number.isInteger(number) || number < 1 || seen.has(number)) continue;
    seen.add(number);
    output.push(number);
  }
  return output;
}

function legacyStatus(row) {
  if (row.archived_at) return "archived";
  return boolFromSqlite(row.is_active) ? "active" : "inactive";
}

function mapPerformer(row) {
  return {
    id: toCatalogId("performer", row.id),
    legacyId: Number(row.id),
    name: nullableText(row.name),
    performerSlot: Number(row.role_slot || 0),
    sortOrder: Number(row.sort_order || 0),
    externalId: row.external_id || null,
    active: boolFromSqlite(row.is_active),
    archivedAt: row.archived_at || null,
    status: legacyStatus(row),
    createdAt: nullableText(row.created_at),
    updatedAt: nullableText(row.updated_at),
  };
}

function mapCharacter(row) {
  const performerLegacyId = Number(row.performer_id || 0);
  return {
    id: toCatalogId("character", row.id),
    legacyId: Number(row.id),
    name: nullableText(row.name),
    description: nullableText(row.description),
    promptText: nullableText(row.prompt_text),
    performerIds: performerLegacyId > 0 ? [toCatalogId("performer", performerLegacyId)] : [],
    legacyPerformerId: performerLegacyId > 0 ? performerLegacyId : null,
    labelScores: parseJsonObject(row.label_scores_json),
    externalId: row.external_id || null,
    active: boolFromSqlite(row.is_active),
    archivedAt: row.archived_at || null,
    status: legacyStatus(row),
    createdAt: nullableText(row.created_at),
    updatedAt: nullableText(row.updated_at),
  };
}

function mapEnvironment(row) {
  return {
    id: toCatalogId("environment", row.id),
    legacyId: Number(row.id),
    name: nullableText(row.name),
    description: nullableText(row.description),
    promptText: nullableText(row.prompt_text),
    labelScores: parseJsonObject(row.label_scores_json),
    externalId: row.external_id || null,
    active: boolFromSqlite(row.is_active),
    archivedAt: row.archived_at || null,
    status: legacyStatus(row),
    createdAt: nullableText(row.created_at),
    updatedAt: nullableText(row.updated_at),
  };
}

function mapLabel(row) {
  return {
    id: toCatalogId("label", row.id),
    legacyId: Number(row.id),
    name: nullableText(row.name),
    sortOrder: Number(row.sort_order || 0),
    active: boolFromSqlite(row.is_active),
    archivedAt: row.archived_at || null,
    status: legacyStatus(row),
    createdAt: nullableText(row.created_at),
    updatedAt: nullableText(row.updated_at),
  };
}

function mapCharacterSlot(value, index) {
  const number = Number(value);
  if (number > 0) {
    return {
      slotIndex: index + 1,
      mode: "fixed-character",
      characterId: toCatalogId("character", number),
      legacyCharacterId: number,
    };
  }
  if (number === -1) {
    return {
      slotIndex: index + 1,
      mode: "random-character",
      characterId: null,
      legacyCharacterId: null,
    };
  }
  return {
    slotIndex: index + 1,
    mode: "empty",
    characterId: null,
    legacyCharacterId: null,
  };
}

function mapSituation(row) {
  const characterSlots = parseJsonArray(row.character_slots_json);
  const characterLegacyIds = uniquePositiveIntegers([
    ...parseJsonArray(row.character_ids_json),
    ...characterSlots,
  ]);
  const labelLegacyIds = uniquePositiveIntegers(parseJsonArray(row.label_ids_json));
  const legacySituationIds = uniquePositiveIntegers(parseJsonArray(row.situation_ids_json));
  const environmentLegacyId = Number(row.environment_id || 0);
  const contextLegacyId = Number(row.context_scene_id || 0);

  return {
    id: toCatalogId("situation", row.id),
    legacyId: Number(row.id),
    legacyTable: "algorithm_scenes",
    title: nullableText(row.title),
    description: nullableText(row.prompt_override),
    promptText: nullableText(row.prompt_override),
    sortOrder: Number(row.sort_order || 0),
    characterCount: Number(row.character_count || characterLegacyIds.length || 0),
    characterIds: characterLegacyIds.map((id) => toCatalogId("character", id)),
    legacyCharacterIds: characterLegacyIds,
    characterSlots: characterSlots.map(mapCharacterSlot),
    environmentMode: nullableText(row.environment_mode || "selected"),
    environmentId: environmentLegacyId > 0 ? toCatalogId("environment", environmentLegacyId) : null,
    legacyEnvironmentId: environmentLegacyId > 0 ? environmentLegacyId : null,
    labelIds: labelLegacyIds.map((id) => toCatalogId("label", id)),
    legacyLabelIds: labelLegacyIds,
    legacySituationIds,
    contextSituationId: contextLegacyId > 0 ? toCatalogId("situation", contextLegacyId) : null,
    legacyContextSceneId: contextLegacyId > 0 ? contextLegacyId : null,
    externalId: row.external_id || null,
    active: boolFromSqlite(row.is_active),
    archivedAt: row.archived_at || null,
    status: legacyStatus(row),
    createdAt: nullableText(row.created_at),
    updatedAt: nullableText(row.updated_at),
  };
}

function mapLegacySituationFragment(row) {
  return {
    id: `legacy-algorithm-situation:${Number(row.id)}`,
    legacyId: Number(row.id),
    name: nullableText(row.name),
    description: nullableText(row.description),
    promptText: nullableText(row.prompt_text),
    requiredCharacterIds: uniquePositiveIntegers(parseJsonArray(row.required_character_ids_json))
      .map((id) => toCatalogId("character", id)),
    allowedCharacterIds: uniquePositiveIntegers(parseJsonArray(row.allowed_character_ids_json))
      .map((id) => toCatalogId("character", id)),
    labelScores: parseJsonObject(row.label_scores_json),
    externalId: row.external_id || null,
    active: boolFromSqlite(row.is_active),
    archivedAt: row.archived_at || null,
    status: legacyStatus(row),
    createdAt: nullableText(row.created_at),
    updatedAt: nullableText(row.updated_at),
  };
}

function assetFilesForType(baseFiles, fxFiles, type) {
  const extensions = new Set(ENVIRONMENT_ASSET_TYPES[type] || []);
  const sourceFiles = type === "fx"
    ? [...baseFiles, ...fxFiles]
    : baseFiles;
  return sourceFiles
    .filter((item) => extensions.has(item.ext))
    .sort((a, b) => a.filename.localeCompare(b.filename, "nl"));
}

function mapMediaAssets(environments, assetScan) {
  const mediaAssets = [];
  for (const environment of environments) {
    const baseFiles = assetScan.byBase.get(environment.name) || [];
    const fxFiles = assetScan.byBase.get(`${environment.name}.fx`) || [];
    for (const type of Object.keys(ENVIRONMENT_ASSET_TYPES)) {
      const files = assetFilesForType(baseFiles, fxFiles, type);
      mediaAssets.push({
        id: toMediaAssetId(environment.legacyId, type),
        environmentId: environment.id,
        legacyEnvironmentId: environment.legacyId,
        environmentName: environment.name,
        type,
        status: files.length > 0 ? "present" : "missing",
        mediaDir: assetScan.mediaDir,
        expectedBasenames: type === "fx"
          ? [environment.name, `${environment.name}.fx`]
          : [environment.name],
        files,
        primaryFile: files[0] || null,
      });
    }
  }
  return mediaAssets;
}

function countActive(items) {
  return items.filter((item) => item.active && !item.archivedAt).length;
}

async function buildCatalogReadModel(options = {}) {
  const legacyRows = await readLegacyCatalogRows(options);
  const performers = legacyRows.performers.map(mapPerformer);
  const characters = legacyRows.characters.map(mapCharacter);
  const environments = legacyRows.environments.map(mapEnvironment);
  const labels = legacyRows.labels.map(mapLabel);
  const situations = legacyRows.scenes.map(mapSituation);
  const legacySituationFragments = legacyRows.legacySituations.map(mapLegacySituationFragment);
  const assetScan = readEnvironmentAssetFiles(options);
  const mediaAssets = mapMediaAssets(environments, assetScan);

  const readModel = {
    schemaVersion: CATALOG_SCHEMA_VERSION,
    generatedAt: new Date().toISOString(),
    source: {
      ...legacyRows.source,
      environmentAssetMediaDir: assetScan.mediaDir,
      environmentAssetMediaDirError: assetScan.mediaDirError,
    },
    counts: {
      performers: performers.length,
      activePerformers: countActive(performers),
      characters: characters.length,
      activeCharacters: countActive(characters),
      environments: environments.length,
      activeEnvironments: countActive(environments),
      situations: situations.length,
      activeSituations: countActive(situations),
      labels: labels.length,
      activeLabels: countActive(labels),
      mediaAssets: mediaAssets.length,
      presentMediaAssets: mediaAssets.filter((asset) => asset.status === "present").length,
      legacySituationFragments: legacySituationFragments.length,
    },
    performers,
    characters,
    environments,
    situations,
    labels,
    mediaAssets,
    legacy: {
      algorithmSituations: legacySituationFragments,
    },
  };
  const store = await readCatalogStore(options);
  return applyCatalogStore(readModel, store, options);
}

module.exports = {
  buildCatalogReadModel,
  parseJsonArray,
  parseJsonObject,
};
