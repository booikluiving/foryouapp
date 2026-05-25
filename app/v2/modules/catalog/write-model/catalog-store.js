"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs/promises");
const fsSync = require("node:fs");
const path = require("node:path");

const STORE_SCHEMA_VERSION = "catalog.write-store.v0";
const COMPOSITION_SCHEMA_VERSION = "catalog.environment-composition.v0";
const COMPOSITION_CANVAS = Object.freeze({
  panels: 3,
  panelWidth: 2160,
  panelHeight: 3840,
  canvasWidth: 6480,
  canvasHeight: 3840,
  aspectRatio: "27:16",
});
const MEDIA_ASSET_TYPES = Object.freeze(["background", "soundscape", "fx"]);
const MEDIA_ASSET_ROLES = Object.freeze(["background", "soundscape", "fxVideo", "fxImage"]);
const MEDIA_ASSET_CONFIG = Object.freeze({
  background: Object.freeze({
    extensions: Object.freeze(["jpg", "jpeg", "png", "webp", "mp4", "mov", "m4v", "webm"]),
    mimePrefixes: Object.freeze(["image/", "video/"]),
    maxBytes: 250 * 1024 * 1024,
  }),
  soundscape: Object.freeze({
    extensions: Object.freeze(["mp3", "wav", "aif", "aiff", "m4a", "aac", "flac"]),
    mimePrefixes: Object.freeze(["audio/"]),
    maxBytes: 100 * 1024 * 1024,
  }),
  fx: Object.freeze({
    extensions: Object.freeze(["mp4", "mov", "m4v", "webm", "jpg", "jpeg", "png", "webp"]),
    mimePrefixes: Object.freeze(["video/", "image/"]),
    maxBytes: 250 * 1024 * 1024,
  }),
});
const MEDIA_ASSET_ROLE_CONFIG = Object.freeze({
  background: Object.freeze({
    type: "background",
    extensions: MEDIA_ASSET_CONFIG.background.extensions,
    mimePrefixes: MEDIA_ASSET_CONFIG.background.mimePrefixes,
    maxBytes: MEDIA_ASSET_CONFIG.background.maxBytes,
    singleton: true,
  }),
  soundscape: Object.freeze({
    type: "soundscape",
    extensions: MEDIA_ASSET_CONFIG.soundscape.extensions,
    mimePrefixes: MEDIA_ASSET_CONFIG.soundscape.mimePrefixes,
    maxBytes: MEDIA_ASSET_CONFIG.soundscape.maxBytes,
    singleton: true,
  }),
  fxVideo: Object.freeze({
    type: "fx",
    extensions: Object.freeze(["mp4", "mov", "m4v", "webm"]),
    mimePrefixes: Object.freeze(["video/"]),
    maxBytes: MEDIA_ASSET_CONFIG.fx.maxBytes,
    singleton: true,
  }),
  fxImage: Object.freeze({
    type: "fx",
    extensions: Object.freeze(["jpg", "jpeg", "png", "webp"]),
    mimePrefixes: Object.freeze(["image/"]),
    maxBytes: 50 * 1024 * 1024,
    singleton: false,
  }),
});
const MEDIA_TYPE_ALIASES = Object.freeze({
  audio: "soundscape",
  soundscape: "soundscape",
  background: "background",
  fx: "fx",
});
const MEDIA_ROLE_ALIASES = Object.freeze({
  audio: "soundscape",
  soundscape: "soundscape",
  background: "background",
  fx: "fx",
  fxvideo: "fxVideo",
  "fx-video": "fxVideo",
  video: "fxVideo",
  fximage: "fxImage",
  "fx-image": "fxImage",
  image: "fxImage",
  png: "fxImage",
});

const CATALOG_ROOT = path.resolve(__dirname, "..");
const V2_ROOT = path.resolve(__dirname, "../../..");
const DEFAULT_STORE_PATH = path.join(CATALOG_ROOT, "db", "catalog-store.json");
const DEFAULT_MEDIA_ROOT = path.join(CATALOG_ROOT, "media");

class CatalogInputError extends Error {
  constructor(message, issues = []) {
    super(message);
    this.name = "CatalogInputError";
    this.statusCode = 400;
    this.issues = issues;
  }
}

function assertPathUnderV2(targetPath) {
  const resolved = path.resolve(targetPath);
  const relative = path.relative(V2_ROOT, resolved);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`catalog_store_path_outside_v2:${resolved}`);
  }
  return resolved;
}

function catalogStorePath(options = {}) {
  return assertPathUnderV2(options.storePath || process.env.V2_CATALOG_STORE_PATH || DEFAULT_STORE_PATH);
}

function catalogMediaRoot(options = {}) {
  return assertPathUnderV2(options.mediaRoot || process.env.V2_CATALOG_MEDIA_ROOT || DEFAULT_MEDIA_ROOT);
}

function nowIso() {
  return new Date().toISOString();
}

function emptyStore() {
  return {
    schemaVersion: STORE_SCHEMA_VERSION,
    createdAt: nowIso(),
    updatedAt: nowIso(),
    nextCounters: {
      performer: 1,
      character: 1,
      environment: 1,
      situation: 1,
    },
    performers: [],
    characters: [],
    environments: [],
    situations: [],
    mediaAssets: [],
    environmentCompositions: [],
  };
}

function normalizeStore(raw) {
  const store = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : emptyStore();
  return {
    ...emptyStore(),
    ...store,
    nextCounters: {
      ...emptyStore().nextCounters,
      ...(store.nextCounters || {}),
    },
    performers: Array.isArray(store.performers) ? store.performers : [],
    characters: Array.isArray(store.characters) ? store.characters : [],
    environments: Array.isArray(store.environments) ? store.environments : [],
    situations: Array.isArray(store.situations) ? store.situations : [],
    mediaAssets: Array.isArray(store.mediaAssets) ? store.mediaAssets : [],
    environmentCompositions: Array.isArray(store.environmentCompositions) ? store.environmentCompositions : [],
  };
}

async function readCatalogStore(options = {}) {
  const filePath = catalogStorePath(options);
  try {
    const raw = JSON.parse(await fs.readFile(filePath, "utf8"));
    return normalizeStore(raw);
  } catch (err) {
    if (err && err.code === "ENOENT") return emptyStore();
    throw err;
  }
}

async function writeCatalogStore(store, options = {}) {
  const filePath = catalogStorePath(options);
  const normalized = normalizeStore({ ...store, updatedAt: nowIso() });
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const tempPath = assertPathUnderV2(path.join(
    path.dirname(filePath),
    `.${path.basename(filePath)}.${process.pid}.${Date.now()}.tmp`
  ));
  await fs.writeFile(tempPath, `${JSON.stringify(normalized, null, 2)}\n`, "utf8");
  await fs.rename(tempPath, filePath);
  return normalized;
}

function slugify(value, fallback = "item") {
  const slug = String(value || "")
    .normalize("NFKD")
    .replace(/[^\w\s-]/g, "")
    .trim()
    .toLowerCase()
    .replace(/[\s_]+/g, "-")
    .replace(/-+/g, "-")
    .slice(0, 48);
  return slug || fallback;
}

function nextEntityId(store, entityType, name) {
  const next = Number(store.nextCounters[entityType] || 1);
  store.nextCounters[entityType] = next + 1;
  return `${entityType}:v2-${String(next).padStart(4, "0")}-${slugify(name, entityType)}`;
}

function upsertById(items, item) {
  const index = items.findIndex((candidate) => candidate.id === item.id);
  if (index >= 0) items[index] = item;
  else items.push(item);
}

function asArray(value) {
  return Array.isArray(value) ? value : value == null || value === "" ? [] : [value];
}

function normalizeIds(values) {
  const seen = new Set();
  const output = [];
  for (const value of asArray(values)) {
    const id = String(value || "").trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    output.push(id);
  }
  return output;
}

function issue(code, message, extra = {}) {
  return { code, message, ...extra };
}

function activeItems(items) {
  return (items || []).filter((item) => item.active !== false && !item.archivedAt);
}

function mapById(items) {
  return new Map((items || []).map((item) => [item.id, item]));
}

function statusFor(active) {
  return active === false ? "inactive" : "active";
}

function legacyIdFromCatalogId(id, prefix) {
  const match = String(id || "").match(new RegExp(`^${prefix}:(\\d+)$`));
  return match ? Number(match[1]) : null;
}

function characterSlot(characterId, index) {
  return {
    slotIndex: index + 1,
    mode: "fixed-character",
    characterId,
    legacyCharacterId: legacyIdFromCatalogId(characterId, "character"),
  };
}

function normalizePerformerRecord(record, base = null) {
  const active = record.active !== false;
  return {
    ...(base || {}),
    id: record.id,
    legacyId: base ? base.legacyId || null : null,
    name: record.name,
    performerSlot: Number(record.performerSlot || 0),
    sortOrder: base ? Number(base.sortOrder || 0) : 0,
    externalId: base ? base.externalId || null : null,
    active,
    archivedAt: null,
    status: statusFor(active),
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    source: { type: "v2-catalog-store" },
    v2Edited: true,
  };
}

function normalizeCharacterRecord(record, base = null) {
  const active = record.active !== false;
  return {
    ...(base || {}),
    id: record.id,
    legacyId: base ? base.legacyId || null : null,
    name: record.name,
    description: record.description || "",
    promptText: record.description || "",
    performerIds: normalizeIds(record.performerIds),
    legacyPerformerId: null,
    labelScores: base && base.labelScores ? base.labelScores : {},
    externalId: base ? base.externalId || null : null,
    active,
    archivedAt: null,
    status: statusFor(active),
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    source: { type: "v2-catalog-store" },
    v2Edited: true,
  };
}

function normalizeEnvironmentRecord(record, base = null) {
  const active = record.active !== false;
  return {
    ...(base || {}),
    id: record.id,
    legacyId: base ? base.legacyId || null : null,
    name: record.name,
    description: record.description || "",
    promptText: record.description || "",
    labelScores: base && base.labelScores ? base.labelScores : {},
    externalId: base ? base.externalId || null : null,
    active,
    archivedAt: null,
    status: statusFor(active),
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    source: { type: "v2-catalog-store" },
    v2Edited: true,
  };
}

function normalizeSituationRecord(record, base = null) {
  const active = record.active !== false;
  const characterIds = normalizeIds(record.characterIds);
  return {
    ...(base || {}),
    id: record.id,
    legacyId: base ? base.legacyId || null : null,
    legacyTable: base ? base.legacyTable || "algorithm_scenes" : "v2-catalog-store",
    title: record.title,
    description: record.description || "",
    promptText: record.description || "",
    sortOrder: base ? Number(base.sortOrder || 0) : 0,
    characterCount: characterIds.length,
    characterIds,
    legacyCharacterIds: characterIds.map((id) => legacyIdFromCatalogId(id, "character")).filter(Boolean),
    characterSlots: characterIds.map(characterSlot),
    environmentMode: "selected",
    environmentId: record.environmentId,
    legacyEnvironmentId: legacyIdFromCatalogId(record.environmentId, "environment"),
    labelIds: base && Array.isArray(base.labelIds) ? base.labelIds : [],
    legacyLabelIds: base && Array.isArray(base.legacyLabelIds) ? base.legacyLabelIds : [],
    legacySituationIds: base && Array.isArray(base.legacySituationIds) ? base.legacySituationIds : [],
    contextSituationId: base ? base.contextSituationId || null : null,
    legacyContextSceneId: base ? base.legacyContextSceneId || null : null,
    externalId: base ? base.externalId || null : null,
    active,
    archivedAt: null,
    status: statusFor(active),
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    source: { type: "v2-catalog-store" },
    v2Edited: true,
  };
}

function performerChoicesForCharacter(character, activePerformers) {
  const performerMap = mapById(activePerformers);
  const explicit = normalizeIds(character && character.performerIds);
  if (!explicit.length) return activePerformers.map((item) => item.id);
  return explicit.filter((id) => performerMap.has(id));
}

function canAssignCast(characters, activePerformers) {
  const performerIds = activePerformers.map((item) => item.id);
  const choices = characters.map((character) => performerChoicesForCharacter(character, activePerformers));
  if (choices.some((item) => item.length === 0)) return false;

  function search(index, used) {
    if (index >= choices.length) return true;
    for (const performerId of choices[index]) {
      if (used.has(performerId)) continue;
      used.add(performerId);
      if (search(index + 1, used)) return true;
      used.delete(performerId);
    }
    return false;
  }

  return performerIds.length >= characters.length && search(0, new Set());
}

function validateCharacterInput(body, readModel) {
  const issues = [];
  const performerIds = normalizeIds(body.performerIds || body.performerId);
  const performers = mapById(readModel.performers || []);
  if (!String(body.name || "").trim()) issues.push(issue("character_name_required", "Name is required."));
  for (const performerId of performerIds) {
    if (!performers.has(performerId)) {
      issues.push(issue("character_performer_missing", `Performer ${performerId} does not exist.`, { performerId }));
    }
  }
  return issues;
}

function validatePerformerInput(body, readModel) {
  const issues = [];
  const slot = Number(body.performerSlot || 0);
  if (!String(body.name || "").trim()) issues.push(issue("performer_name_required", "Name is required."));
  if (!Number.isInteger(slot) || slot < 0 || slot > 3) {
    issues.push(issue("performer_slot_invalid", "Performer slot must be 0, 1, 2, or 3.", { performerSlot: body.performerSlot }));
  }
  if (slot > 0) {
    const conflict = (readModel.performers || []).find((performer) => (
      performer.id !== body.id
      && performer.active !== false
      && !performer.archivedAt
      && Number(performer.performerSlot || 0) === slot
    ));
    if (conflict) {
      issues.push(issue("performer_slot_conflict", `Performer slot ${slot} is already used by ${conflict.name || conflict.id}.`, {
        performerSlot: slot,
        conflictId: conflict.id,
      }));
    }
  }
  return issues;
}

function validateEnvironmentInput(body) {
  const issues = [];
  if (!String(body.name || "").trim()) issues.push(issue("environment_name_required", "Name is required."));
  return issues;
}

function validateSituationInput(body, readModel) {
  const issues = [];
  const characterIds = normalizeIds(body.characterIds);
  const characterMap = mapById(readModel.characters || []);
  const environmentMap = mapById(readModel.environments || []);
  const activePerformers = activeItems(readModel.performers || []);
  const characters = characterIds.map((id) => characterMap.get(id)).filter(Boolean);
  if (!String(body.title || "").trim()) issues.push(issue("situation_title_required", "Title is required."));
  if (!body.environmentId || !environmentMap.has(body.environmentId)) {
    issues.push(issue("situation_environment_required", "A valid environment is required.", { environmentId: body.environmentId || null }));
  }
  if (characterIds.length < 1 || characterIds.length > 3) {
    issues.push(issue("situation_character_count_invalid", "Choose 1 to 3 characters.", { count: characterIds.length }));
  }
  if (new Set(characterIds).size !== characterIds.length) {
    issues.push(issue("situation_duplicate_character", "Each character can be selected once."));
  }
  for (const characterId of characterIds) {
    const character = characterMap.get(characterId);
    if (!character) {
      issues.push(issue("situation_character_missing", `Character ${characterId} does not exist.`, { characterId }));
    } else if (character.active === false || character.archivedAt) {
      issues.push(issue("situation_character_inactive", `Character ${character.name || characterId} is inactive.`, { characterId }));
    }
  }
  if (characters.length === characterIds.length && characterIds.length > 0 && !canAssignCast(characters, activePerformers)) {
    issues.push(issue(
      "situation_cast_performer_conflict",
      "Selected characters cannot be played at the same time by the available performer slots.",
      { characterIds }
    ));
  }
  return issues;
}

async function upsertPerformer(body, readModel, options = {}) {
  const issues = validatePerformerInput(body || {}, readModel);
  if (issues.length) throw new CatalogInputError("invalid_performer", issues);
  const store = await readCatalogStore(options);
  const existing = store.performers.find((item) => item.id === body.id);
  const base = (readModel.performers || []).find((item) => item.id === body.id) || null;
  const at = nowIso();
  const record = {
    id: String(body.id || nextEntityId(store, "performer", body.name)),
    name: String(body.name || "").trim(),
    performerSlot: Number(body.performerSlot || 0),
    active: body.active !== false,
    createdAt: existing ? existing.createdAt : base ? base.createdAt || at : at,
    updatedAt: at,
  };
  upsertById(store.performers, record);
  await writeCatalogStore(store, options);
  return normalizePerformerRecord(record, base);
}

async function upsertCharacter(body, readModel, options = {}) {
  const issues = validateCharacterInput(body || {}, readModel);
  if (issues.length) throw new CatalogInputError("invalid_character", issues);
  const store = await readCatalogStore(options);
  const existing = store.characters.find((item) => item.id === body.id);
  const base = (readModel.characters || []).find((item) => item.id === body.id) || null;
  const at = nowIso();
  const record = {
    id: String(body.id || nextEntityId(store, "character", body.name)),
    name: String(body.name || "").trim(),
    description: String(body.description || "").trim(),
    performerIds: normalizeIds(body.performerIds || body.performerId),
    active: body.active !== false,
    createdAt: existing ? existing.createdAt : base ? base.createdAt || at : at,
    updatedAt: at,
  };
  upsertById(store.characters, record);
  await writeCatalogStore(store, options);
  return normalizeCharacterRecord(record, base);
}

async function upsertEnvironment(body, readModel, options = {}) {
  const issues = validateEnvironmentInput(body || {});
  if (issues.length) throw new CatalogInputError("invalid_environment", issues);
  const store = await readCatalogStore(options);
  const existing = store.environments.find((item) => item.id === body.id);
  const base = (readModel.environments || []).find((item) => item.id === body.id) || null;
  const at = nowIso();
  const record = {
    id: String(body.id || nextEntityId(store, "environment", body.name)),
    name: String(body.name || "").trim(),
    description: String(body.description || "").trim(),
    active: body.active !== false,
    createdAt: existing ? existing.createdAt : base ? base.createdAt || at : at,
    updatedAt: at,
  };
  upsertById(store.environments, record);
  await writeCatalogStore(store, options);
  return normalizeEnvironmentRecord(record, base);
}

async function upsertSituation(body, readModel, options = {}) {
  const issues = validateSituationInput(body || {}, readModel);
  if (issues.length) throw new CatalogInputError("invalid_situation", issues);
  const store = await readCatalogStore(options);
  const existing = store.situations.find((item) => item.id === body.id);
  const base = (readModel.situations || []).find((item) => item.id === body.id) || null;
  const at = nowIso();
  const record = {
    id: String(body.id || nextEntityId(store, "situation", body.title)),
    title: String(body.title || "").trim(),
    description: String(body.description || "").trim(),
    environmentId: String(body.environmentId || "").trim(),
    characterIds: normalizeIds(body.characterIds),
    active: body.active !== false,
    createdAt: existing ? existing.createdAt : base ? base.createdAt || at : at,
    updatedAt: at,
  };
  upsertById(store.situations, record);
  await writeCatalogStore(store, options);
  return normalizeSituationRecord(record, base);
}

function applyRecords(baseItems, records, normalizer) {
  const map = new Map((baseItems || []).map((item) => [item.id, item]));
  for (const record of records || []) {
    map.set(record.id, normalizer(record, map.get(record.id) || null));
  }
  return Array.from(map.values());
}

function normalizeMediaAssetType(value) {
  return MEDIA_TYPE_ALIASES[String(value || "").trim()] || "";
}

function extensionKind(extension) {
  const ext = String(extension || "").toLowerCase().replace(/^\./, "");
  if (["jpg", "jpeg", "png", "webp"].includes(ext)) return "image";
  if (["mp3", "wav", "aif", "aiff", "m4a", "aac", "flac"].includes(ext)) return "audio";
  if (["mp4", "mov", "m4v", "webm"].includes(ext)) return "video";
  return "file";
}

function normalizeMediaAssetRole(value, extension = "", mimeType = "") {
  const raw = String(value || "").trim();
  const compact = raw.replace(/[_\s]+/g, "-").toLowerCase();
  const role = MEDIA_ROLE_ALIASES[raw] || MEDIA_ROLE_ALIASES[compact] || "";
  if (role && role !== "fx") return role;
  if (role === "fx") {
    const kind = mediaKindFromMime(mimeType) !== "file" ? mediaKindFromMime(mimeType) : extensionKind(extension);
    return kind === "video" ? "fxVideo" : "fxImage";
  }
  return "";
}

function mediaStorageTypeForRole(role) {
  const config = MEDIA_ASSET_ROLE_CONFIG[role];
  return config ? config.type : "";
}

function roleForMediaRecord(record) {
  const explicit = normalizeMediaAssetRole(record && record.role);
  if (explicit) return explicit;
  const type = normalizeMediaAssetType(record && record.type);
  if (type === "background" || type === "soundscape") return type;
  if (type === "fx") {
    const metadata = record && record.metadata && typeof record.metadata === "object" ? record.metadata : {};
    const kind = metadata.previewKind || mediaKindFromMime(record && record.mimeType) || extensionKind(record && record.extension);
    return kind === "video" ? "fxVideo" : "fxImage";
  }
  return "";
}

function mediaAssetFileUrl(assetId) {
  return `/v0/catalog/media-assets/file/${encodeURIComponent(assetId)}`;
}

function pathInside(parent, child) {
  const relative = path.relative(parent, child);
  return !!relative && !relative.startsWith("..") && !path.isAbsolute(relative);
}

function resolveMediaAssetPath(record, mediaRoot) {
  const relativePath = String(record && record.relativePath || "").trim();
  if (relativePath) return assertPathUnderV2(path.join(mediaRoot, relativePath));
  const storedPath = String(record && record.filePath || "").trim();
  if (!storedPath) return "";
  try {
    const resolved = assertPathUnderV2(storedPath);
    return pathInside(mediaRoot, resolved) ? resolved : "";
  } catch (_err) {
    return "";
  }
}

function normalizeMediaAssetRecord(record) {
  const role = roleForMediaRecord(record);
  return {
    id: record.id,
    environmentId: record.environmentId,
    legacyEnvironmentId: legacyIdFromCatalogId(record.environmentId, "environment"),
    environmentName: record.environmentName || "",
    type: record.type,
    role,
    status: record.status || "present",
    filename: record.filename,
    originalFilename: record.originalFilename || record.filename,
    relativePath: record.relativePath,
    filePath: record.filePath,
    url: mediaAssetFileUrl(record.id),
    mimeType: record.mimeType || "application/octet-stream",
    extension: record.extension || "",
    sizeBytes: Number(record.sizeBytes || 0),
    tags: Array.isArray(record.tags) ? record.tags : [],
    metadata: record.metadata && typeof record.metadata === "object" ? record.metadata : {},
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    source: { type: "v2-media-store" },
  };
}

function numericValue(value, fallback, { min = -Infinity, max = Infinity, integer = false } = {}) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  const clamped = Math.min(max, Math.max(min, number));
  return integer ? Math.round(clamped) : clamped;
}

function defaultLayerSize(role) {
  if (role === "background" || role === "fxVideo") {
    return { width: COMPOSITION_CANVAS.canvasWidth, height: COMPOSITION_CANVAS.canvasHeight };
  }
  return { width: Math.round(COMPOSITION_CANVAS.canvasWidth / 3), height: Math.round(COMPOSITION_CANVAS.canvasHeight / 3) };
}

function normalizeCompositionLayer(layer, role, index = 0) {
  if (!layer || typeof layer !== "object" || Array.isArray(layer)) return null;
  const assetId = String(layer.assetId || "").trim();
  if (!assetId) return null;
  const size = defaultLayerSize(role);
  const id = String(layer.id || `layer:${role}:${slugify(assetId, "asset")}:${index + 1}`).slice(0, 160);
  return {
    id,
    assetId,
    role,
    name: String(layer.name || "").trim(),
    visible: layer.visible !== false,
    locked: layer.locked === true,
    x: numericValue(layer.x, 0, { min: -COMPOSITION_CANVAS.canvasWidth * 2, max: COMPOSITION_CANVAS.canvasWidth * 2 }),
    y: numericValue(layer.y, 0, { min: -COMPOSITION_CANVAS.canvasHeight * 2, max: COMPOSITION_CANVAS.canvasHeight * 2 }),
    width: numericValue(layer.width, size.width, { min: 1, max: COMPOSITION_CANVAS.canvasWidth * 3 }),
    height: numericValue(layer.height, size.height, { min: 1, max: COMPOSITION_CANVAS.canvasHeight * 3 }),
    rotationDeg: numericValue(layer.rotationDeg, 0, { min: -360, max: 360 }),
    opacity: numericValue(layer.opacity, 1, { min: 0, max: 1 }),
    zIndex: numericValue(layer.zIndex, index + 1, { min: 0, max: 9999, integer: true }),
  };
}

function normalizeEnvironmentCompositionRecord(record) {
  const at = nowIso();
  const backgroundLayer = normalizeCompositionLayer(record && record.backgroundLayer, "background", 0);
  const fxVideoLayer = normalizeCompositionLayer(record && record.fxVideoLayer, "fxVideo", 0);
  const imageLayers = Array.isArray(record && record.imageLayers)
    ? record.imageLayers.map((layer, index) => normalizeCompositionLayer(layer, "fxImage", index)).filter(Boolean)
    : [];
  return {
    schemaVersion: COMPOSITION_SCHEMA_VERSION,
    id: String(record && record.environmentId || "").trim(),
    environmentId: String(record && record.environmentId || "").trim(),
    canvas: { ...COMPOSITION_CANVAS },
    guidesVisible: record && record.guidesVisible !== false,
    backgroundLayer,
    fxVideoLayer,
    imageLayers,
    createdAt: record && record.createdAt || at,
    updatedAt: record && record.updatedAt || record && record.createdAt || at,
    source: { type: "v2-composition-store" },
  };
}

function applyCatalogStore(readModel, store, options = {}) {
  const performers = applyRecords(readModel.performers, store.performers, normalizePerformerRecord);
  const characters = applyRecords(readModel.characters, store.characters, normalizeCharacterRecord);
  const environments = applyRecords(readModel.environments, store.environments, normalizeEnvironmentRecord);
  const situations = applyRecords(readModel.situations, store.situations, normalizeSituationRecord);
  const mediaAssets = [
    ...(readModel.mediaAssets || []),
    ...(store.mediaAssets || []).map(normalizeMediaAssetRecord),
  ];
  const environmentCompositions = (store.environmentCompositions || [])
    .map(normalizeEnvironmentCompositionRecord)
    .filter((composition) => composition.environmentId);

  return {
    ...readModel,
    source: {
      ...readModel.source,
      v2WriteStore: {
        path: catalogStorePath(options),
        readOnly: false,
        schemaVersion: STORE_SCHEMA_VERSION,
      },
      v2MediaRoot: {
        path: catalogMediaRoot(options),
        readOnly: false,
      },
    },
    counts: {
      ...readModel.counts,
      performers: performers.length,
      activePerformers: performers.filter((item) => item.active && !item.archivedAt).length,
      characters: characters.length,
      activeCharacters: characters.filter((item) => item.active && !item.archivedAt).length,
      environments: environments.length,
      activeEnvironments: environments.filter((item) => item.active && !item.archivedAt).length,
      situations: situations.length,
      activeSituations: situations.filter((item) => item.active && !item.archivedAt).length,
      mediaAssets: mediaAssets.length,
      presentMediaAssets: mediaAssets.filter((asset) => asset.status === "present").length,
      environmentCompositions: environmentCompositions.length,
      v2Performers: store.performers.length,
      v2Characters: store.characters.length,
      v2Environments: store.environments.length,
      v2Situations: store.situations.length,
      v2MediaAssets: store.mediaAssets.length,
    },
    performers,
    characters,
    environments,
    situations,
    mediaAssets,
    environmentCompositions,
  };
}

function safeSegment(value) {
  return String(value || "").replace(/[^a-zA-Z0-9_-]+/g, "_").replace(/^_+|_+$/g, "") || "unknown";
}

function extensionFromFilename(filename) {
  return path.extname(String(filename || "")).replace(/^\./, "").toLowerCase();
}

function mediaKindFromMime(mimeType) {
  const mime = String(mimeType || "").toLowerCase();
  if (mime.startsWith("image/")) return "image";
  if (mime.startsWith("audio/")) return "audio";
  if (mime.startsWith("video/")) return "video";
  return "file";
}

function parseTags(value) {
  if (Array.isArray(value)) return value.map((item) => String(item || "").trim()).filter(Boolean);
  const text = String(value || "").trim();
  if (!text) return [];
  try {
    const parsed = JSON.parse(text);
    if (Array.isArray(parsed)) return parseTags(parsed);
  } catch (_err) {
    // Comma tags are the compact UI path.
  }
  return text.split(",").map((item) => item.trim()).filter(Boolean);
}

function loadBusboy() {
  const candidates = [
    process.env.V2_CATALOG_BUSBOY_MODULE,
    "busboy",
    "/opt/homebrew/lib/node_modules/node-red/node_modules/busboy",
  ].filter(Boolean);
  for (const candidate of candidates) {
    try {
      return require(candidate);
    } catch (_err) {
      // Try the next known local runtime path.
    }
  }
  throw new Error("busboy_module_unavailable");
}

async function sha256File(filePath) {
  const hash = crypto.createHash("sha256");
  await new Promise((resolve, reject) => {
    const stream = fsSync.createReadStream(filePath);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("error", reject);
    stream.on("end", resolve);
  });
  return hash.digest("hex");
}

async function imageDimensions(filePath, extension) {
  const ext = String(extension || "").toLowerCase();
  if (!["png", "jpg", "jpeg"].includes(ext)) return null;
  let buffer;
  try {
    buffer = await fs.readFile(filePath);
  } catch (_err) {
    return null;
  }
  if (ext === "png") {
    if (buffer.length >= 24 && buffer.toString("ascii", 1, 4) === "PNG") {
      return {
        width: buffer.readUInt32BE(16),
        height: buffer.readUInt32BE(20),
      };
    }
    return null;
  }
  let offset = 2;
  if (buffer[0] !== 0xff || buffer[1] !== 0xd8) return null;
  while (offset + 9 < buffer.length) {
    if (buffer[offset] !== 0xff) return null;
    const marker = buffer[offset + 1];
    const length = buffer.readUInt16BE(offset + 2);
    if (length < 2) return null;
    if (marker >= 0xc0 && marker <= 0xc3) {
      return {
        height: buffer.readUInt16BE(offset + 5),
        width: buffer.readUInt16BE(offset + 7),
      };
    }
    offset += 2 + length;
  }
  return null;
}

function mimeTypeFromExtension(extension) {
  const ext = String(extension || "").toLowerCase().replace(/^\./, "");
  return {
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    png: "image/png",
    webp: "image/webp",
    mp3: "audio/mpeg",
    wav: "audio/wav",
    aif: "audio/aiff",
    aiff: "audio/aiff",
    m4a: "audio/mp4",
    aac: "audio/aac",
    flac: "audio/flac",
    mp4: "video/mp4",
    mov: "video/quicktime",
    m4v: "video/x-m4v",
    webm: "video/webm",
  }[ext] || "application/octet-stream";
}

function mimeAllowedForType(type, mimeType) {
  const config = MEDIA_ASSET_CONFIG[type];
  const mime = String(mimeType || "").toLowerCase();
  if (!mime || mime === "application/octet-stream") return true;
  return config.mimePrefixes.some((prefix) => mime.startsWith(prefix));
}

function mimeAllowedForRole(role, mimeType) {
  const config = MEDIA_ASSET_ROLE_CONFIG[role];
  const mime = String(mimeType || "").toLowerCase();
  if (!mime || mime === "application/octet-stream") return true;
  return config.mimePrefixes.some((prefix) => mime.startsWith(prefix));
}

function validateMediaUploadFields({ environment, type, role, extension, mimeType, size }) {
  const issues = [];
  const config = MEDIA_ASSET_ROLE_CONFIG[role] || MEDIA_ASSET_CONFIG[type];
  if (!environment) issues.push(issue("media_environment_missing", "A valid environment is required."));
  if (!config) issues.push(issue("media_type_invalid", "Asset type must be background, soundscape, or fx.", { type }));
  if (role && !MEDIA_ASSET_ROLES.includes(role)) {
    issues.push(issue("media_role_invalid", "Asset role must be background, soundscape, fxVideo, or fxImage.", { role }));
  }
  if (role && type && mediaStorageTypeForRole(role) && mediaStorageTypeForRole(role) !== type) {
    issues.push(issue("media_role_type_conflict", `${role} cannot be uploaded as ${type}.`, { role, type }));
  }
  if (config && !config.extensions.includes(extension)) {
    issues.push(issue("media_extension_invalid", `.${extension || ""} is not allowed for ${role || type}.`, { extension, type, role }));
  }
  if (config) {
    const mimeAllowed = role ? mimeAllowedForRole(role, mimeType) : mimeAllowedForType(type, mimeType);
    if (!mimeAllowed) {
      issues.push(issue("media_mime_invalid", `${mimeType || "unknown"} is not allowed for ${role || type}.`, { mimeType, type, role }));
    }
  }
  if (size <= 0) issues.push(issue("media_file_empty", "Uploaded file is empty."));
  if (config && size > config.maxBytes) {
    issues.push(issue("media_file_too_large", `File is larger than the ${role || type} limit.`, { size, maxBytes: config.maxBytes }));
  }
  return issues;
}

function ensureDirSync(dirPath) {
  fsSync.mkdirSync(dirPath, { recursive: true });
}

function backupStamp() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

function parseMediaAssetUpload(req, options = {}) {
  return new Promise((resolve, reject) => {
    const Busboy = loadBusboy();
    const mediaRoot = catalogMediaRoot(options);
    const tempDir = assertPathUnderV2(path.join(mediaRoot, "_asset-upload-tmp"));
    const fields = {};
    const writeJobs = [];
    let upload = null;
    let settled = false;
    let tempPath = "";

    const fail = (err) => {
      if (settled) return;
      settled = true;
      if (tempPath) {
        try { fsSync.unlinkSync(tempPath); } catch (_unlinkErr) {}
      }
      reject(err);
    };

    let busboy = null;
    try {
      busboy = Busboy({
        headers: req.headers,
        limits: {
          fields: 12,
          files: 1,
          fileSize: Math.max(...Object.values(MEDIA_ASSET_CONFIG).map((item) => item.maxBytes)),
        },
      });
    } catch (_err) {
      reject(new CatalogInputError("invalid_upload", [issue("invalid_upload", "Upload is not valid multipart/form-data.")]));
      return;
    }

    busboy.on("field", (name, value) => {
      fields[String(name || "")] = String(value || "").slice(0, 2000);
    });

    busboy.on("file", (name, file, info) => {
      if (String(name || "") !== "asset") {
        file.resume();
        return;
      }
      if (upload || tempPath) {
        file.resume();
        fail(new CatalogInputError("invalid_multiple_files", [issue("invalid_multiple_files", "Upload one file at a time.")]));
        return;
      }
      try {
        ensureDirSync(tempDir);
        tempPath = assertPathUnderV2(path.join(tempDir, `${Date.now()}-${crypto.randomBytes(8).toString("hex")}.upload`));
      } catch (err) {
        file.resume();
        fail(err);
        return;
      }

      let size = 0;
      let limitReached = false;
      const writeStream = fsSync.createWriteStream(tempPath, { flags: "wx" });
      const writeDone = new Promise((resolveWrite, rejectWrite) => {
        file.on("data", (chunk) => {
          size += chunk.length;
        });
        file.on("limit", () => {
          limitReached = true;
        });
        file.on("error", rejectWrite);
        writeStream.on("error", rejectWrite);
        writeStream.on("finish", () => {
          upload = {
            tempPath,
            size,
            limitReached,
            filename: String(info && info.filename || ""),
            mimeType: String(info && info.mimeType || ""),
          };
          resolveWrite();
        });
      });
      writeJobs.push(writeDone);
      file.pipe(writeStream);
    });

    busboy.on("error", () => fail(new CatalogInputError("invalid_upload", [issue("invalid_upload", "Upload stream failed.")])));
    busboy.on("finish", async () => {
      if (settled) return;
      try {
        await Promise.all(writeJobs);
        if (!upload) throw new CatalogInputError("file_required", [issue("file_required", "A file is required.")]);
        if (upload.limitReached) throw new CatalogInputError("media_file_too_large", [issue("media_file_too_large", "File is too large.")]);
        settled = true;
        resolve({ fields, upload });
      } catch (err) {
        fail(err);
      }
    });

    req.pipe(busboy);
  });
}

function backupExistingMediaAssets(store, { environmentId, type, role, mediaRoot, replaceTags = [], skipAssetId = "" }) {
  const stamp = backupStamp();
  const backups = [];
  const roleConfig = MEDIA_ASSET_ROLE_CONFIG[role];
  const requiredTags = parseTags(replaceTags);
  if (roleConfig && !roleConfig.singleton && !requiredTags.length) return backups;
  for (const record of store.mediaAssets || []) {
    if (skipAssetId && record.id === skipAssetId) continue;
    if (record.environmentId !== environmentId || record.status === "replaced") continue;
    if (role ? roleForMediaRecord(record) !== role : record.type !== type) continue;
    if (requiredTags.length) {
      const recordTags = parseTags(record.tags);
      if (!requiredTags.every((tag) => recordTags.includes(tag))) continue;
    }
    const sourcePath = resolveMediaAssetPath(record, mediaRoot);
    if (!sourcePath || !fsSync.existsSync(sourcePath)) continue;
    const backupDir = assertPathUnderV2(path.join(mediaRoot, "_asset-backups", stamp, safeSegment(environmentId), type));
    ensureDirSync(backupDir);
    const targetPath = assertPathUnderV2(path.join(backupDir, path.basename(sourcePath)));
    fsSync.renameSync(sourcePath, targetPath);
    record.status = "replaced";
    record.replacedAt = nowIso();
    record.backupFilePath = targetPath;
    record.backupRelativePath = path.relative(mediaRoot, targetPath);
    backups.push({
      assetId: record.id,
      from: record.relativePath,
      to: record.backupRelativePath,
    });
  }
  return backups;
}

async function saveMediaAssetFile(input, readModel, options = {}) {
  let tempPath = input && input.tempPath ? assertPathUnderV2(input.tempPath) : "";
  const environmentId = String(input && input.environmentId || "").trim();
  const originalFilename = String(input && input.originalFilename || input && input.filename || "");
  const extension = extensionFromFilename(originalFilename);
  const mimeType = String(input && input.mimeType || mimeTypeFromExtension(extension));
  const requestedType = normalizeMediaAssetType(input && input.type);
  const requestedRole = normalizeMediaAssetRole(input && input.role, extension, mimeType);
  const inferredRole = requestedRole || normalizeMediaAssetRole(requestedType, extension, mimeType);
  const role = inferredRole;
  const type = requestedType || mediaStorageTypeForRole(role);
  const size = Number(input && input.sizeBytes || 0);
  const environment = (readModel.environments || []).find((item) => item.id === environmentId) || null;
  const issues = validateMediaUploadFields({
    environment,
    type,
    role,
    extension,
    mimeType,
    size,
  });
  if (!tempPath) issues.push(issue("media_temp_file_missing", "A staged media file is required."));
  if (issues.length) {
    if (tempPath) {
      try { await fs.unlink(tempPath); } catch (_err) {}
    }
    throw new CatalogInputError("invalid_media_upload", issues);
  }

  const hash = (await sha256File(tempPath)).slice(0, 16);
  const base = slugify(path.basename(originalFilename, path.extname(originalFilename)), "asset");
  const filename = `${base}-${hash}.${extension}`;
  const mediaRoot = catalogMediaRoot(options);
  const targetDir = assertPathUnderV2(path.join(mediaRoot, "environments", safeSegment(environmentId), type));
  const filePath = assertPathUnderV2(path.join(targetDir, filename));
  const store = await readCatalogStore(options);
  const assetId = `media-asset:${environmentId}:${role || type}:${base}-${hash}`;
  const backups = backupExistingMediaAssets(store, {
    environmentId,
    type,
    role,
    mediaRoot,
    replaceTags: input && input.replaceTags,
    skipAssetId: assetId,
  });

  await fs.mkdir(targetDir, { recursive: true });
  try {
    await fs.rename(tempPath, filePath);
    tempPath = "";
  } finally {
    if (tempPath) {
      try { await fs.unlink(tempPath); } catch (_err) {}
    }
  }

  const at = nowIso();
  const dimensions = await imageDimensions(filePath, extension);
  const record = {
    id: assetId,
    environmentId,
    environmentName: environment.name || "",
    type,
    role,
    filename,
    originalFilename,
    relativePath: path.relative(mediaRoot, filePath),
    filePath,
    mimeType,
    extension,
    sizeBytes: size,
    tags: parseTags(input && input.tags),
    metadata: {
      previewKind: mediaKindFromMime(mimeType),
      role,
      ...(dimensions ? { dimensions } : {}),
      backups,
    },
    createdAt: at,
    updatedAt: at,
  };
  upsertById(store.mediaAssets, record);
  await writeCatalogStore(store, options);
  return normalizeMediaAssetRecord(record);
}

async function saveMediaAssetUpload(req, readModel, options = {}) {
  const parsed = await parseMediaAssetUpload(req, options);
  let tempPath = parsed.upload.tempPath;
  try {
    const asset = await saveMediaAssetFile({
      tempPath,
      environmentId: parsed.fields.environmentId,
      type: parsed.fields.type || parsed.fields.assetType,
      role: parsed.fields.role,
      originalFilename: parsed.upload.filename,
      mimeType: parsed.upload.mimeType,
      sizeBytes: parsed.upload.size,
      tags: parsed.fields.tags,
      replaceTags: parsed.fields.replaceTags || parsed.fields.replaceTag,
    }, readModel, options);
    tempPath = "";
    return asset;
  } catch (err) {
    if (tempPath) {
      try { await fs.unlink(tempPath); } catch (_err) {}
    }
    throw err;
  }
}

async function listMediaAssets(options = {}) {
  const store = await readCatalogStore(options);
  return (store.mediaAssets || []).map(normalizeMediaAssetRecord);
}

async function mediaAssetFilePath(assetId, options = {}) {
  const store = await readCatalogStore(options);
  const record = (store.mediaAssets || []).find((item) => item.id === assetId);
  if (!record) throw Object.assign(new Error("media_asset_not_found"), { statusCode: 404 });
  if (record.status === "deleted") throw Object.assign(new Error("media_asset_deleted"), { statusCode: 404 });
  const mediaRoot = catalogMediaRoot(options);
  const filePath = resolveMediaAssetPath(record, mediaRoot);
  if (!filePath) throw Object.assign(new Error("media_asset_file_missing"), { statusCode: 404 });
  if (!fsSync.existsSync(filePath)) throw Object.assign(new Error("media_asset_file_missing"), { statusCode: 404 });
  return { filePath, mimeType: record.mimeType || "application/octet-stream" };
}

async function deleteMediaAsset(assetId, options = {}) {
  const id = String(assetId || "").trim();
  const store = await readCatalogStore(options);
  const record = (store.mediaAssets || []).find((item) => item.id === id);
  if (!record) throw Object.assign(new Error("media_asset_not_found"), { statusCode: 404 });
  const tags = parseTags(record.tags);
  if (tags.includes("rendered-output") || tags.includes("td-output")) {
    throw new CatalogInputError("media_asset_output_delete_forbidden", [
      issue("media_asset_output_delete_forbidden", "Generated output assets are managed by save and cannot be manually deleted.", { assetId: id }),
    ]);
  }
  const mediaRoot = catalogMediaRoot(options);
  const filePath = resolveMediaAssetPath(record, mediaRoot);
  if (filePath) {
    const relative = path.relative(mediaRoot, filePath);
    if (relative.startsWith("..") || path.isAbsolute(relative)) throw new Error("media_asset_path_outside_media_root");
    try { await fs.unlink(filePath); } catch (err) {
      if (!err || err.code !== "ENOENT") throw err;
    }
  }
  const at = nowIso();
  record.status = "deleted";
  record.deletedAt = at;
  record.updatedAt = at;
  for (const composition of store.environmentCompositions || []) {
    if (composition.backgroundLayer && composition.backgroundLayer.assetId === id) composition.backgroundLayer = null;
    if (composition.fxVideoLayer && composition.fxVideoLayer.assetId === id) composition.fxVideoLayer = null;
    composition.imageLayers = (composition.imageLayers || []).filter((layer) => layer.assetId !== id);
    composition.updatedAt = at;
  }
  await writeCatalogStore(store, options);
  return normalizeMediaAssetRecord(record);
}

function validateLayerNumbers(layer, issues, pathLabel) {
  const numericFields = ["x", "y", "width", "height", "rotationDeg", "opacity", "zIndex"];
  for (const field of numericFields) {
    if (layer[field] == null || layer[field] === "") continue;
    const number = Number(layer[field]);
    if (!Number.isFinite(number)) {
      issues.push(issue("composition_transform_invalid", `${pathLabel}.${field} must be a number.`, { field, path: pathLabel }));
    }
  }
  if (Number(layer.width) <= 0 || Number(layer.height) <= 0) {
    issues.push(issue("composition_size_invalid", `${pathLabel} must have a positive size.`, { path: pathLabel }));
  }
  if (layer.opacity != null && (Number(layer.opacity) < 0 || Number(layer.opacity) > 1)) {
    issues.push(issue("composition_opacity_invalid", `${pathLabel}.opacity must be between 0 and 1.`, { path: pathLabel }));
  }
}

function validateCompositionLayer(layer, { expectedRole, environmentId, assetMap, mediaRoot, issues, pathLabel, required = false }) {
  if (!layer) {
    if (required) issues.push(issue("composition_layer_required", `${pathLabel} is required.`, { path: pathLabel }));
    return null;
  }
  const normalized = normalizeCompositionLayer(layer, expectedRole, 0);
  if (!normalized) {
    issues.push(issue("composition_layer_invalid", `${pathLabel} is invalid.`, { path: pathLabel }));
    return null;
  }
  const asset = assetMap.get(normalized.assetId);
  if (!asset) {
    issues.push(issue("composition_asset_missing", `${pathLabel} references an unknown V2 asset.`, {
      path: pathLabel,
      assetId: normalized.assetId,
    }));
  } else {
    if (asset.environmentId !== environmentId) {
      issues.push(issue("composition_asset_environment_mismatch", `${pathLabel} asset belongs to another environment.`, {
        path: pathLabel,
        assetId: normalized.assetId,
        environmentId: asset.environmentId,
      }));
    }
    if (roleForMediaRecord(asset) !== expectedRole) {
      issues.push(issue("composition_asset_role_mismatch", `${pathLabel} must use a ${expectedRole} asset.`, {
        path: pathLabel,
        assetId: normalized.assetId,
        expectedRole,
        role: roleForMediaRecord(asset),
      }));
    }
    if (asset.status !== "present") {
      issues.push(issue("composition_asset_not_present", `${pathLabel} asset is not present.`, {
        path: pathLabel,
        assetId: normalized.assetId,
      }));
    }
    if (asset.relativePath || asset.filePath) {
      const assetPath = resolveMediaAssetPath(asset, mediaRoot);
      if (!assetPath) {
        issues.push(issue("composition_asset_outside_media_root", `${pathLabel} asset is outside the V2 media root.`, {
          path: pathLabel,
          assetId: normalized.assetId,
        }));
      }
    }
  }
  validateLayerNumbers(layer, issues, pathLabel);
  return normalized;
}

async function upsertEnvironmentComposition(environmentId, body, readModel, options = {}) {
  const id = String(environmentId || "").trim();
  const environment = (readModel.environments || []).find((item) => item.id === id);
  const issues = [];
  if (!environment) {
    issues.push(issue("composition_environment_missing", "A valid environment is required.", { environmentId: id }));
  }

  const store = await readCatalogStore(options);
  const normalizedAssets = (store.mediaAssets || []).map(normalizeMediaAssetRecord);
  const assetMap = new Map(normalizedAssets.map((asset) => [asset.id, asset]));
  const mediaRoot = catalogMediaRoot(options);
  const backgroundLayer = validateCompositionLayer(body && body.backgroundLayer, {
    expectedRole: "background",
    environmentId: id,
    assetMap,
    mediaRoot,
    issues,
    pathLabel: "backgroundLayer",
  });
  const fxVideoLayer = validateCompositionLayer(body && body.fxVideoLayer, {
    expectedRole: "fxVideo",
    environmentId: id,
    assetMap,
    mediaRoot,
    issues,
    pathLabel: "fxVideoLayer",
  });
  const imageLayers = [];
  for (const [index, layer] of (Array.isArray(body && body.imageLayers) ? body.imageLayers : []).entries()) {
    const normalized = validateCompositionLayer(layer, {
      expectedRole: "fxImage",
      environmentId: id,
      assetMap,
      mediaRoot,
      issues,
      pathLabel: `imageLayers.${index}`,
    });
    if (normalized) imageLayers.push({ ...normalized, zIndex: normalized.zIndex || index + 10 });
  }
  if (imageLayers.length > 100) {
    issues.push(issue("composition_too_many_layers", "A composition can contain at most 100 image layers."));
  }
  if (issues.length) throw new CatalogInputError("invalid_environment_composition", issues);

  const existing = (store.environmentCompositions || []).find((item) => item.environmentId === id);
  const at = nowIso();
  const record = normalizeEnvironmentCompositionRecord({
    environmentId: id,
    canvas: { ...COMPOSITION_CANVAS },
    guidesVisible: body && body.guidesVisible !== false,
    backgroundLayer,
    fxVideoLayer,
    imageLayers,
    createdAt: existing ? existing.createdAt : at,
    updatedAt: at,
  });
  const index = store.environmentCompositions.findIndex((item) => item.environmentId === id);
  if (index >= 0) store.environmentCompositions[index] = record;
  else store.environmentCompositions.push(record);
  await writeCatalogStore(store, options);
  return record;
}

async function listEnvironmentCompositions(options = {}) {
  const store = await readCatalogStore(options);
  return (store.environmentCompositions || []).map(normalizeEnvironmentCompositionRecord);
}

module.exports = {
  CatalogInputError,
  COMPOSITION_CANVAS,
  COMPOSITION_SCHEMA_VERSION,
  DEFAULT_MEDIA_ROOT,
  DEFAULT_STORE_PATH,
  MEDIA_ASSET_ROLES,
  MEDIA_ASSET_TYPES,
  MEDIA_ASSET_CONFIG,
  STORE_SCHEMA_VERSION,
  applyCatalogStore,
  canAssignCast,
  catalogMediaRoot,
  catalogStorePath,
  listMediaAssets,
  listEnvironmentCompositions,
  deleteMediaAsset,
  mediaAssetFilePath,
  mimeTypeFromExtension,
  normalizeMediaAssetRole,
  normalizeMediaAssetType,
  readCatalogStore,
  saveMediaAssetFile,
  saveMediaAssetUpload,
  upsertEnvironmentComposition,
  upsertCharacter,
  upsertEnvironment,
  upsertPerformer,
  upsertSituation,
  validateSituationInput,
};
