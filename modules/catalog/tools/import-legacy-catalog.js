"use strict";

const fs = require("node:fs");
const path = require("node:path");

const {
  CATALOG_SCHEMA_VERSION,
  toCatalogId,
} = require("../../../shared/contracts/catalog-v0");
const {
  readLegacyCatalogRows,
} = require("./legacy-readonly/sqlite-adapter");
const {
  DEFAULT_STORE_PATH,
  STORE_SCHEMA_VERSION,
  catalogDbPath,
  writeCatalogStore,
} = require("../write-model/catalog-store");

function bool(value) {
  return Number(value) === 1;
}

function text(value) {
  return value == null ? "" : String(value);
}

function jsonArray(value) {
  if (value == null || value === "") return [];
  try {
    const parsed = JSON.parse(String(value));
    return Array.isArray(parsed) ? parsed : [];
  } catch (_err) {
    return [];
  }
}

function jsonObject(value) {
  if (value == null || value === "") return {};
  try {
    const parsed = JSON.parse(String(value));
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

function status(row) {
  if (row.archived_at) return "archived";
  return bool(row.is_active) ? "active" : "inactive";
}

function mapPerformer(row) {
  return {
    id: toCatalogId("performer", row.id),
    legacyId: Number(row.id),
    name: text(row.name),
    performerSlot: Number(row.role_slot || 0),
    sortOrder: Number(row.sort_order || 0),
    externalId: row.external_id || null,
    active: bool(row.is_active),
    archivedAt: row.archived_at || null,
    status: status(row),
    createdAt: text(row.created_at),
    updatedAt: text(row.updated_at),
    source: { type: "legacy-import" },
  };
}

function mapCharacter(row) {
  const performerLegacyId = Number(row.performer_id || 0);
  return {
    id: toCatalogId("character", row.id),
    legacyId: Number(row.id),
    name: text(row.name),
    description: text(row.description),
    promptText: text(row.prompt_text || row.description),
    performerIds: performerLegacyId > 0 ? [toCatalogId("performer", performerLegacyId)] : [],
    legacyPerformerId: performerLegacyId > 0 ? performerLegacyId : null,
    labelScores: jsonObject(row.label_scores_json),
    externalId: row.external_id || null,
    active: bool(row.is_active),
    archivedAt: row.archived_at || null,
    status: status(row),
    createdAt: text(row.created_at),
    updatedAt: text(row.updated_at),
    source: { type: "legacy-import" },
  };
}

function mapEnvironment(row) {
  return {
    id: toCatalogId("environment", row.id),
    legacyId: Number(row.id),
    name: text(row.name),
    description: text(row.description),
    promptText: text(row.prompt_text || row.description),
    labelScores: jsonObject(row.label_scores_json),
    externalId: row.external_id || null,
    active: bool(row.is_active),
    archivedAt: row.archived_at || null,
    status: status(row),
    createdAt: text(row.created_at),
    updatedAt: text(row.updated_at),
    source: { type: "legacy-import" },
  };
}

function mapLabel(row) {
  return {
    id: toCatalogId("label", row.id),
    legacyId: Number(row.id),
    name: text(row.name),
    sortOrder: Number(row.sort_order || 0),
    active: bool(row.is_active),
    archivedAt: row.archived_at || null,
    status: status(row),
    createdAt: text(row.created_at),
    updatedAt: text(row.updated_at),
    source: { type: "legacy-import" },
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
  const characterSlots = jsonArray(row.character_slots_json);
  const legacyCharacterIds = uniquePositiveIntegers([
    ...jsonArray(row.character_ids_json),
    ...characterSlots,
  ]);
  const legacyLabelIds = uniquePositiveIntegers(jsonArray(row.label_ids_json));
  const legacySituationIds = uniquePositiveIntegers(jsonArray(row.situation_ids_json));
  const legacyEnvironmentId = Number(row.environment_id || 0);
  const legacyContextSceneId = Number(row.context_scene_id || 0);
  return {
    id: toCatalogId("situation", row.id),
    legacyId: Number(row.id),
    legacyTable: "algorithm_scenes",
    title: text(row.title),
    description: text(row.prompt_override),
    promptText: text(row.prompt_override),
    sortOrder: Number(row.sort_order || 0),
    characterCount: Number(row.character_count || legacyCharacterIds.length || 0),
    characterIds: legacyCharacterIds.map((id) => toCatalogId("character", id)),
    legacyCharacterIds,
    characterSlots: characterSlots.map(mapCharacterSlot),
    environmentMode: text(row.environment_mode || "selected"),
    environmentId: legacyEnvironmentId > 0 ? toCatalogId("environment", legacyEnvironmentId) : null,
    legacyEnvironmentId: legacyEnvironmentId > 0 ? legacyEnvironmentId : null,
    labelIds: legacyLabelIds.map((id) => toCatalogId("label", id)),
    legacyLabelIds,
    legacySituationIds,
    contextSituationId: legacyContextSceneId > 0 ? toCatalogId("situation", legacyContextSceneId) : null,
    legacyContextSceneId: legacyContextSceneId > 0 ? legacyContextSceneId : null,
    externalId: row.external_id || null,
    active: bool(row.is_active),
    archivedAt: row.archived_at || null,
    status: status(row),
    createdAt: text(row.created_at),
    updatedAt: text(row.updated_at),
    source: { type: "legacy-import" },
  };
}

function readJsonStore(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (err) {
    if (err && err.code === "ENOENT") return {};
    throw err;
  }
}

function maxV2Counter(items, entityType) {
  let max = 0;
  const pattern = new RegExp(`^${entityType}:v2-(\\d+)`);
  for (const item of items || []) {
    const match = String(item && item.id || "").match(pattern);
    if (match) max = Math.max(max, Number(match[1]));
  }
  return max + 1;
}

async function buildLegacyImportStore(options = {}) {
  const legacyRows = await readLegacyCatalogRows({
    ...options,
    dbPath: options.legacyDbPath,
  });
  const jsonStorePath = options.jsonStorePath || process.env.V2_CATALOG_JSON_STORE_PATH || DEFAULT_STORE_PATH;
  const jsonStore = readJsonStore(jsonStorePath);
  const performers = [
    ...legacyRows.performers.map(mapPerformer),
    ...(jsonStore.performers || []),
  ];
  const characters = [
    ...legacyRows.characters.map(mapCharacter),
    ...(jsonStore.characters || []),
  ];
  const environments = [
    ...legacyRows.environments.map(mapEnvironment),
    ...(jsonStore.environments || []),
  ];
  const labels = legacyRows.labels.map(mapLabel);
  const situations = [
    ...legacyRows.scenes.map(mapSituation),
    ...(jsonStore.situations || []),
  ];

  const now = new Date().toISOString();
  return {
    schemaVersion: STORE_SCHEMA_VERSION,
    createdAt: jsonStore.createdAt || now,
    updatedAt: now,
    importedFrom: {
      type: "legacy-sqlite-import",
      importedAt: now,
      source: {
        type: legacyRows.source.type,
        snapshotId: legacyRows.source.snapshotId,
        adapter: legacyRows.source.adapter,
        tables: legacyRows.source.tables,
      },
      catalogSchemaVersion: CATALOG_SCHEMA_VERSION,
    },
    nextCounters: {
      performer: Math.max(Number(jsonStore.nextCounters && jsonStore.nextCounters.performer || 1), maxV2Counter(performers, "performer")),
      character: Math.max(Number(jsonStore.nextCounters && jsonStore.nextCounters.character || 1), maxV2Counter(characters, "character")),
      environment: Math.max(Number(jsonStore.nextCounters && jsonStore.nextCounters.environment || 1), maxV2Counter(environments, "environment")),
      situation: Math.max(Number(jsonStore.nextCounters && jsonStore.nextCounters.situation || 1), maxV2Counter(situations, "situation")),
    },
    performers,
    characters,
    environments,
    labels,
    situations,
    mediaAssets: jsonStore.mediaAssets || [],
    environmentCompositions: jsonStore.environmentCompositions || [],
  };
}

async function importLegacyCatalog(options = {}) {
  const store = await buildLegacyImportStore(options);
  if (!options.dryRun) await writeCatalogStore(store, options);
  return {
    ok: true,
    dryRun: !!options.dryRun,
    catalogDbPath: catalogDbPath(options),
    counts: {
      performers: store.performers.length,
      characters: store.characters.length,
      environments: store.environments.length,
      labels: store.labels.length,
      situations: store.situations.length,
      mediaAssets: store.mediaAssets.length,
      environmentCompositions: store.environmentCompositions.length,
    },
    importedFrom: store.importedFrom,
  };
}

function parseArgs(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--dry-run") options.dryRun = true;
    else if (arg === "--apply") options.dryRun = false;
    else if (arg === "--db") options.dbPath = argv[++index];
    else if (arg === "--legacy-db") options.legacyDbPath = argv[++index];
    else if (arg === "--json-store") options.jsonStorePath = argv[++index];
  }
  return options;
}

if (require.main === module) {
  importLegacyCatalog(parseArgs(process.argv.slice(2))).then((result) => {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  }).catch((err) => {
    process.stderr.write(`${err.stack || err.message}\n`);
    process.exit(1);
  });
}

module.exports = {
  buildLegacyImportStore,
  importLegacyCatalog,
};
