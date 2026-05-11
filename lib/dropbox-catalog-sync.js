"use strict";

const fs = require("fs");
const path = require("path");
const os = require("os");
const crypto = require("crypto");
const { DatabaseSync } = require("node:sqlite");

const FORMAT_VERSION = 1;
const DEFAULT_INTERVAL_MS = 2000;
const DEFAULT_DEBOUNCE_MS = 700;
const MAX_TEXT = 10000;

const ROOT_FOLDERS = Object.freeze([
  "00 Index voor GPT",
  "01 Research",
  "02 Personages",
  "03 Omgevingen",
  "04 Situaties",
  "06 Stijlregels",
  "07 Grappige voorbeeldscènes",
  "08 Runs & Scores",
  "09 Chatlogs",
  "10 Techniek & Sync",
]);

const STYLE_SETTING_KEYS = Object.freeze([
  "algorithm_calibration_count",
  "algorithm_global_prompt",
  "algorithm_prompt_template",
  "algorithm_score_heart_weight",
  "algorithm_score_bored_weight",
  "algorithm_score_comment_weight",
  "algorithm_score_time_normalized_blend",
  "algorithm_variation_character_cooldown_window",
  "algorithm_variation_diversity_weight",
  "algorithm_variation_exploration_weight",
  "algorithm_variation_retry_weight",
  "algorithm_variation_scene_repeat_penalty",
  "sim_defaults_json",
]);

function nowIso() {
  return new Date().toISOString();
}

function clampInt(value, min, max, fallback) {
  const parsed = Number.parseInt(String(value), 10);
  if (!Number.isInteger(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

function normalizeText(value, max = MAX_TEXT) {
  return String(value === undefined || value === null ? "" : value)
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .trim()
    .slice(0, max);
}

function normalizeIso(value, fallback = "") {
  const raw = normalizeText(value, 100);
  const ts = Date.parse(raw);
  if (!Number.isFinite(ts)) return fallback;
  return new Date(ts).toISOString();
}

function normalizeBool(value, fallback = true) {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value > 0;
  const raw = String(value === undefined || value === null ? "" : value).trim().toLowerCase();
  if (["1", "true", "yes", "ja", "active", "actief"].includes(raw)) return true;
  if (["0", "false", "no", "nee", "inactive", "inactief"].includes(raw)) return false;
  return fallback;
}

function normalizeId(value, fallback = 0) {
  const parsed = Number.parseInt(String(value === undefined || value === null ? "" : value), 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function normalizeInt(value, fallback = 0) {
  const parsed = Number.parseInt(String(value === undefined || value === null ? "" : value), 10);
  return Number.isInteger(parsed) ? parsed : fallback;
}

function normalizeNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function normalizeIdList(value) {
  const raw = Array.isArray(value) ? value : [];
  const out = [];
  const seen = new Set();
  for (const item of raw) {
    const parsed = Number.parseInt(String(item), 10);
    if (!Number.isInteger(parsed)) continue;
    if (parsed < 1 && parsed !== -1) continue;
    if (seen.has(parsed)) continue;
    seen.add(parsed);
    out.push(parsed);
  }
  return out;
}

function safeJsonParse(value, fallback) {
  try {
    return JSON.parse(String(value));
  } catch {
    return fallback;
  }
}

function safeJsonStringify(value, fallback = "{}") {
  try {
    return JSON.stringify(value);
  } catch {
    return fallback;
  }
}

function prettyJson(value) {
  return JSON.stringify(value, null, 2);
}

function hashText(value) {
  return crypto.createHash("sha256").update(String(value || "")).digest("hex");
}

function relativePosix(rootDir, filePath) {
  return path.relative(rootDir, filePath).split(path.sep).join("/");
}

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function readFileText(filePath) {
  try {
    return fs.readFileSync(filePath, "utf8");
  } catch {
    return "";
  }
}

function atomicWriteFile(filePath, text) {
  ensureDir(path.dirname(filePath));
  const tempPath = path.join(path.dirname(filePath), `.${path.basename(filePath)}.${process.pid}.${Date.now()}.tmp`);
  fs.writeFileSync(tempPath, text, "utf8");
  fs.renameSync(tempPath, filePath);
}

function writeFileIfChanged(filePath, text) {
  if (hashText(readFileText(filePath)) === hashText(text)) return false;
  atomicWriteFile(filePath, text);
  return true;
}

function appendJsonl(filePath, rows) {
  if (!Array.isArray(rows) || !rows.length) return;
  ensureDir(path.dirname(filePath));
  const text = rows.map((row) => JSON.stringify(row)).join("\n") + "\n";
  fs.appendFileSync(filePath, text, "utf8");
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function slugifyName(value, fallback = "item") {
  const normalized = String(value || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 70);
  return normalized || fallback;
}

function metadataBlock(meta) {
  return "";
}

function parseMetadata(text) {
  const match = String(text || "").match(/<!--\s*foryou:metadata\s*\n([\s\S]*?)\n-->/i);
  if (!match) return null;
  const parsed = safeJsonParse(match[1], null);
  return parsed && typeof parsed === "object" ? parsed : null;
}

function inferMetadataFromPath(relPath) {
  const normalized = String(relPath || "").split(path.sep).join("/");
  const base = path.basename(normalized);
  let match = null;
  if (normalized.startsWith("02 Personages/Performers/") && (match = base.match(/(?:^|-)performer-(\d{1,8})(?:-|\.foryou\.md$)/))) {
    return { version: FORMAT_VERSION, entity: "performer", id: Number(match[1]) };
  }
  if (normalized.startsWith("02 Personages/Characters/") && (match = base.match(/(?:^|-)character-(\d{1,8})(?:-|\.foryou\.md$)/))) {
    return { version: FORMAT_VERSION, entity: "character", id: Number(match[1]) };
  }
  if (normalized.startsWith("03 Omgevingen/") && (match = base.match(/(?:^|-)environment-(\d{1,8})(?:-|\.foryou\.md$)/))) {
    return { version: FORMAT_VERSION, entity: "environment", id: Number(match[1]) };
  }
  if (normalized.startsWith("04 Situaties/") && (match = base.match(/(?:^|-)situation-scene-(\d{1,8})(?:-|\.foryou\.md$)/))) {
    return { version: FORMAT_VERSION, entity: "scene_situation", id: Number(match[1]), sceneId: Number(match[1]) };
  }
  if (normalized.startsWith("04 Situaties/") && (match = base.match(/(?:^|-)situation-(\d{1,8})(?:-|\.foryou\.md$)/))) {
    return { version: FORMAT_VERSION, entity: "situation", id: Number(match[1]) };
  }
  if (normalized.startsWith("05 Scènes/") && (match = base.match(/(?:^|-)scene-(\d{1,8})(?:-|\.foryou\.md$)/))) {
    return { version: FORMAT_VERSION, entity: "scene", id: Number(match[1]) };
  }
  if (normalized === "06 Stijlregels/style-settings.foryou.md") {
    return { version: FORMAT_VERSION, entity: "style_settings", id: 1 };
  }
  return null;
}

function metadataForRecord(relPath, text) {
  return parseMetadata(text) || inferMetadataFromPath(relPath);
}

function hasOwn(object, key) {
  return !!object && Object.prototype.hasOwnProperty.call(object, key);
}

function extractTitle(text, fallback = "") {
  const withoutMetadata = String(text || "").replace(/<!--\s*foryou:metadata\s*\n[\s\S]*?\n-->\s*/i, "");
  const match = withoutMetadata.match(/^#\s+(.+?)\s*$/m);
  return normalizeText(match ? match[1] : fallback, 220);
}

function extractSection(text, title) {
  const raw = String(text || "");
  const pattern = new RegExp(`^##\\s+${escapeRegExp(title)}\\s*$`, "im");
  const match = pattern.exec(raw);
  if (!match) return "";
  const start = match.index + match[0].length;
  const rest = raw.slice(start);
  const next = rest.search(/^##\s+/m);
  const section = next >= 0 ? rest.slice(0, next) : rest;
  return normalizeText(section.replace(/^\n+/, "").replace(/\n+$/, ""), MAX_TEXT);
}

function extractBodyAfterTitle(text) {
  return normalizeText(
    String(text || "")
      .replace(/<!--\s*foryou:metadata\s*\n[\s\S]*?\n-->\s*/i, "")
      .replace(/^#\s+.+?\s*$/m, "")
      .trim(),
    MAX_TEXT
  );
}

function extractJsonCode(sectionText, fallback = {}) {
  const raw = String(sectionText || "").trim();
  const fenced = raw.match(/^```(?:json)?\s*\n([\s\S]*?)\n```$/i);
  return safeJsonParse(fenced ? fenced[1] : raw, fallback);
}

function section(title, body) {
  return `## ${title}\n${String(body === undefined || body === null ? "" : body).trim() || "_Leeg._"}\n`;
}

function cleanDisplayName(value) {
  return normalizeText(value, 220).replace(/[_]+/g, " ").replace(/\s+/g, " ").trim();
}

function normalizeComparableText(value) {
  return cleanDisplayName(value)
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function lowerFirstLetter(value) {
  return String(value || "").replace(/^(\s*)([A-ZÀ-ÖØ-Þ])([A-ZÀ-ÖØ-Þ]?)/, (_, space, letter, next) => {
    if (next && next === next.toUpperCase()) return `${space}${letter}${next}`;
    return `${space}${letter.toLowerCase()}${next || ""}`;
  });
}

function descriptionStartsWithName(name, description) {
  const normalizedName = normalizeComparableText(name);
  const normalizedDescription = normalizeComparableText(description);
  return !!normalizedName
    && (normalizedDescription === normalizedName || normalizedDescription.startsWith(`${normalizedName} `));
}

function descriptionWithSubject(name, description, kind = "record") {
  const subject = cleanDisplayName(name);
  const text = normalizeText(description, MAX_TEXT);
  if (!subject || !text || descriptionStartsWithName(subject, text)) return text;
  const sentence = lowerFirstLetter(text);
  if (/^(is|heeft|werkt|lijkt|doet|kan|heet|wordt|komt|spreekt|vindt|wil|moet|praat|drinkt|leeft|gebruikt|houdt|schommelt)\b/i.test(text)) {
    return `${subject} ${sentence}`;
  }
  if (/^(een|de|het)\b/i.test(text)) {
    return `${subject} is ${sentence}`;
  }
  if (kind === "environment" && /^(in|op|bij|onder|achter|voor|tussen|aan)\b/i.test(text)) {
    return `${subject}: ${text}`;
  }
  return `${subject} is ${sentence}`;
}

function bulletValue(label, value) {
  return `- ${label}: ${value === undefined || value === null || value === "" ? "-" : value}`;
}

function escapeMarkdownCell(value) {
  return String(value === undefined || value === null ? "" : value)
    .replace(/\r?\n/g, " ")
    .replace(/\|/g, "\\|")
    .trim();
}

function formatTranscriptMessage(message) {
  const name = normalizeText(message && message.name, 120) || "Anoniem";
  const status = normalizeText(message && message.status, 40) || "accepted";
  const text = normalizeText(message && message.text, 8000) || "_Leeg bericht._";
  const meta = [
    `id=${Number(message && message.id || 0)}`,
    `client=${normalizeText(message && message.clientKey, 200) || "-"}`,
    `ip=${normalizeText(message && message.ip, 80) || "-"}`,
    status !== "accepted" ? `status=${status}` : "",
    message && message.detail ? `detail=${normalizeText(message.detail, 200)}` : "",
  ].filter(Boolean).join("; ");
  return [
    `### ${normalizeText(message && message.time, 80) || "-"} - ${name}`,
    "",
    text,
    "",
    `_${meta}_`,
    "",
  ].join("\n");
}

function defaultDropboxRoot() {
  const home = os.homedir();
  const direct = path.join(home, "Dropbox");
  if (fs.existsSync(direct)) return direct;
  const cloudStorage = path.join(home, "Library", "CloudStorage");
  const cloudDropbox = path.join(cloudStorage, "Dropbox");
  if (fs.existsSync(cloudDropbox)) return cloudDropbox;
  try {
    const match = fs.readdirSync(cloudStorage, { withFileTypes: true })
      .find((entry) => entry.isDirectory() && /^Dropbox/i.test(entry.name));
    if (match) return path.join(cloudStorage, match.name);
  } catch {}
  return direct;
}

function defaultRootDir() {
  return path.join(defaultDropboxRoot(), "For You", "Database");
}

function isTruthyEnv(value, fallback = false) {
  if (value === undefined || value === null || value === "") return fallback;
  return ["1", "true", "yes", "ja", "on"].includes(String(value).trim().toLowerCase());
}

function shouldEnable(rootDir, explicitEnabled) {
  if (explicitEnabled !== undefined && explicitEnabled !== null && String(explicitEnabled) !== "") {
    return isTruthyEnv(explicitEnabled, false);
  }
  if (process.env.FORYOU_DROPBOX_CATALOG_DIR) return true;
  return fs.existsSync(defaultDropboxRoot());
}

function walkFiles(dirPath, predicate, out = []) {
  let entries = [];
  try {
    entries = fs.readdirSync(dirPath, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    if (entry.name.startsWith(".") && entry.name.endsWith(".tmp")) continue;
    const filePath = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      walkFiles(filePath, predicate, out);
    } else if (!predicate || predicate(filePath)) {
      out.push(filePath);
    }
  }
  return out;
}

function ensureExternalIdColumn(db, table) {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all();
  if (!columns.some((column) => String(column.name || "") === "external_id")) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN external_id TEXT`);
  }
  db.exec(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_${table}_external_id
      ON ${table}(external_id)
      WHERE external_id IS NOT NULL AND external_id <> ''
  `);
}

function ensureSchema(db) {
  db.exec("PRAGMA journal_mode = WAL;");
  db.exec("PRAGMA synchronous = NORMAL;");
  db.exec("PRAGMA busy_timeout = 5000;");
  db.exec(`
    CREATE TABLE IF NOT EXISTS catalog_file_sync_state (
      file_path TEXT PRIMARY KEY,
      entity TEXT NOT NULL,
      entity_id INTEGER NOT NULL DEFAULT 0,
      content_hash TEXT,
      db_updated_at TEXT,
      file_mtime_ms INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'synced',
      last_synced_at TEXT NOT NULL,
      conflict_path TEXT,
      last_error TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_catalog_file_sync_entity
      ON catalog_file_sync_state(entity, entity_id);

    CREATE TABLE IF NOT EXISTS catalog_sync_kv (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);
  [
    "algorithm_performers",
    "algorithm_characters",
    "algorithm_situations",
    "algorithm_environments",
    "algorithm_scenes",
  ].forEach((table) => ensureExternalIdColumn(db, table));
}

function recordPathFor(kind, row) {
  const id = String(normalizeId(row && row.id)).padStart(4, "0");
  const label = slugifyName(row && (row.name || row.title), kind);
  if (kind === "performer") return path.join("02 Personages", "Performers", `${label}-performer-${id}.foryou.md`);
  if (kind === "character") return path.join("02 Personages", "Characters", `${label}-character-${id}.foryou.md`);
  if (kind === "environment") return path.join("03 Omgevingen", `${label}-environment-${id}.foryou.md`);
  if (kind === "situation") return path.join("04 Situaties", `${label}-situation-${id}.foryou.md`);
  if (kind === "scene_situation") return path.join("04 Situaties", `${label}-situation-scene-${id}.foryou.md`);
  if (kind === "scene") return path.join("05 Scènes", `${label}-scene-${id}.foryou.md`);
  if (kind === "style_settings") return path.join("06 Stijlregels", "style-settings.foryou.md");
  return path.join("10 Techniek & Sync", `unknown-${id}.foryou.md`);
}

function legacyRecordPathsFor(kind, row) {
  const id = String(normalizeId(row && row.id)).padStart(4, "0");
  const label = slugifyName(row && (row.name || row.title), kind);
  if (kind === "performer") return [
    path.join("02 Personages", "Performers", `performer-${id}.foryou.md`),
    path.join("02 Personages", "Performers", `performer-${id}-${label}.foryou.md`),
  ];
  if (kind === "character") return [
    path.join("02 Personages", "Characters", `character-${id}.foryou.md`),
    path.join("02 Personages", "Characters", `character-${id}-${label}.foryou.md`),
  ];
  if (kind === "environment") return [
    path.join("03 Omgevingen", `environment-${id}.foryou.md`),
    path.join("03 Omgevingen", `environment-${id}-${label}.foryou.md`),
  ];
  if (kind === "situation") return [
    path.join("04 Situaties", "Database Situaties", `situation-${id}.foryou.md`),
    path.join("04 Situaties", `situation-${id}-${label}.foryou.md`),
  ];
  if (kind === "scene_situation") {
    return [
      path.join("04 Situaties", "Uit Scènes", `situation-scene-${id}.foryou.md`),
      path.join("04 Situaties", "Uit Scènes", `situation-scene-${id}-${label}.foryou.md`),
      path.join("04 Situaties", `situation-scene-${id}.foryou.md`),
      path.join("04 Situaties", `situation-scene-${id}-${label}.foryou.md`),
    ];
  }
  if (kind === "scene") return [
    path.join("05 Scènes", `scene-${id}.foryou.md`),
    path.join("05 Scènes", `scene-${id}-${label}.foryou.md`),
  ];
  return [];
}

function renderPerformer(row) {
  const meta = {
    version: FORMAT_VERSION,
    entity: "performer",
    id: normalizeId(row.id),
    externalId: row.external_id || "",
    sortOrder: normalizeInt(row.sort_order, 0),
    roleSlot: normalizeInt(row.role_slot, 0),
    isActive: Number(row.is_active || 0) > 0,
    archivedAt: row.archived_at || "",
    createdAt: row.created_at || "",
    updatedAt: row.updated_at || "",
  };
  return [
    metadataBlock(meta),
    `# ${normalizeText(row.name, 220) || `Performer ${meta.id}`}`,
  ].filter(Boolean).join("\n");
}

function renderCharacter(row) {
  const meta = {
    version: FORMAT_VERSION,
    entity: "character",
    id: normalizeId(row.id),
    externalId: row.external_id || "",
    performerId: normalizeId(row.performer_id, 0) || null,
    isActive: Number(row.is_active || 0) > 0,
    archivedAt: row.archived_at || "",
    createdAt: row.created_at || "",
    updatedAt: row.updated_at || "",
  };
  return [
    metadataBlock(meta),
    `# ${normalizeText(row.name, 220) || `Personage ${meta.id}`}`,
    "",
    normalizeText(row.description, 4000),
  ].filter(Boolean).join("\n");
}

function renderEnvironment(row) {
  const meta = {
    version: FORMAT_VERSION,
    entity: "environment",
    id: normalizeId(row.id),
    externalId: row.external_id || "",
    isActive: Number(row.is_active || 0) > 0,
    archivedAt: row.archived_at || "",
    createdAt: row.created_at || "",
    updatedAt: row.updated_at || "",
  };
  return [
    metadataBlock(meta),
    `# ${normalizeText(row.name, 220) || `Omgeving ${meta.id}`}`,
    "",
    normalizeText(row.description, 4000),
  ].filter(Boolean).join("\n");
}

function renderSituation(row) {
  const meta = {
    version: FORMAT_VERSION,
    entity: "situation",
    id: normalizeId(row.id),
    externalId: row.external_id || "",
    requiredCharacterIds: normalizeIdList(safeJsonParse(row.required_character_ids_json || "[]", [])),
    allowedCharacterIds: normalizeIdList(safeJsonParse(row.allowed_character_ids_json || "[]", [])),
    isActive: Number(row.is_active || 0) > 0,
    archivedAt: row.archived_at || "",
    createdAt: row.created_at || "",
    updatedAt: row.updated_at || "",
  };
  return [
    metadataBlock(meta),
    `# ${normalizeText(row.name, 220) || `Situatie ${meta.id}`}`,
    "",
    normalizeText(row.description, 5000),
    normalizeText(row.prompt_text, 5000),
  ].filter(Boolean).join("\n");
}

function renderSceneSituation(row) {
  const meta = {
    version: FORMAT_VERSION,
    entity: "scene_situation",
    id: normalizeId(row.id),
    sceneId: normalizeId(row.id),
    sourceTable: "algorithm_scenes",
    isActive: Number(row.is_active || 0) > 0,
    archivedAt: row.archived_at || "",
    createdAt: row.created_at || "",
    updatedAt: row.updated_at || "",
  };
  return [
    metadataBlock(meta),
    `# ${normalizeText(row.title, 220) || `Situatie uit scène ${meta.id}`}`,
    "",
    normalizeText(row.prompt_override, 5000),
  ].filter(Boolean).join("\n");
}

function formatSceneCharacters(characterSlots, labels = {}) {
  if (!characterSlots.length) return "_Geen personages._";
  return characterSlots.map((id, index) => {
    if (id === -1) return `- Rol ${index + 1}: random`;
    if (id > 0) return `- Rol ${index + 1}: ${labels.characters && labels.characters[id] ? labels.characters[id] : `Personage ${id}`}`;
    return `- Rol ${index + 1}: leeg`;
  }).join("\n");
}

function formatSceneEnvironment(meta, labels = {}) {
  if (String(meta.environmentMode || "selected") === "random") return "Random omgeving";
  if (!meta.environmentId) return "_Geen vaste omgeving._";
  return labels.environments && labels.environments[meta.environmentId]
    ? labels.environments[meta.environmentId]
    : `Omgeving ${meta.environmentId}`;
}

function formatSceneSituations(situationIds, labels = {}) {
  if (!situationIds.length) return "_Geen gekoppelde situaties._";
  return situationIds.map((id) => `- ${labels.situations && labels.situations[id] ? labels.situations[id] : `Situatie ${id}`}`).join("\n");
}

function formatSceneLabels(labelIds, labels = {}) {
  if (!labelIds.length) return "_Geen labels._";
  return labelIds.map((id) => `- ${labels.labels && labels.labels[id] ? labels.labels[id] : `Label ${id}`}`).join("\n");
}

function renderScene(row, labels = {}) {
  const characterSlots = normalizeIdList(safeJsonParse(row.character_slots_json || "[]", []));
  const characterIds = normalizeIdList(safeJsonParse(row.character_ids_json || "[]", []));
  const situationIds = normalizeIdList(safeJsonParse(row.situation_ids_json || "[]", []));
  const labelIds = normalizeIdList(safeJsonParse(row.label_ids_json || "[]", []));
  const meta = {
    version: FORMAT_VERSION,
    entity: "scene",
    id: normalizeId(row.id),
    externalId: row.external_id || "",
    sortOrder: normalizeInt(row.sort_order, 0),
    characterCount: normalizeInt(row.character_count, 1),
    characterSlots,
    characterIds,
    situationIds,
    labelIds,
    environmentId: normalizeId(row.environment_id, 0) || null,
    environmentMode: normalizeText(row.environment_mode || "selected", 40),
    contextSceneId: normalizeId(row.context_scene_id, 0) || null,
    isActive: Number(row.is_active || 0) > 0,
    archivedAt: row.archived_at || "",
    createdAt: row.created_at || "",
    updatedAt: row.updated_at || "",
  };
  return [
    metadataBlock(meta),
    `# ${normalizeText(row.title, 220) || `Scène ${meta.id}`}`,
    "",
    section("Personages", formatSceneCharacters(characterSlots, labels)),
    section("Omgeving", formatSceneEnvironment(meta, labels)),
    section("Gekoppelde Situaties", formatSceneSituations(situationIds, labels)),
    section("Labels", formatSceneLabels(labelIds, labels)),
    meta.contextSceneId ? section("Context", labels.scenes && labels.scenes[meta.contextSceneId] ? labels.scenes[meta.contextSceneId] : `Scène ${meta.contextSceneId}`) : "",
  ].filter(Boolean).join("\n");
}

function renderStyleSettings(rows) {
  const settings = {};
  for (const row of rows) settings[String(row.key || "")] = String(row.value || "");
  const latest = rows.map((row) => row.updated_at || "").filter(Boolean).sort().pop() || "";
  const meta = {
    version: FORMAT_VERSION,
    entity: "style_settings",
    id: 1,
    updatedAt: latest,
    settingKeys: Object.keys(settings),
  };
  return [
    metadataBlock(meta),
    "# Stijlregels",
    "",
    section("Settings JSON", `\`\`\`json\n${prettyJson(settings)}\n\`\`\``),
  ].filter(Boolean).join("\n");
}

function rowUpdatedAt(row) {
  return normalizeIso(row && (row.updated_at || row.updatedAt || row.updated_at), "");
}

function createDropboxCatalogSync(options = {}) {
  const dbPath = options.dbPath;
  const rootDir = path.resolve(options.rootDir || process.env.FORYOU_DROPBOX_CATALOG_DIR || defaultRootDir());
  const enabled = shouldEnable(rootDir, options.enabled !== undefined ? options.enabled : process.env.FORYOU_DROPBOX_CATALOG_ENABLED);
  const intervalMs = clampInt(options.intervalMs || process.env.FORYOU_DROPBOX_CATALOG_INTERVAL_MS, 500, 300000, DEFAULT_INTERVAL_MS);
  const debounceMs = clampInt(options.debounceMs || process.env.FORYOU_DROPBOX_CATALOG_DEBOUNCE_MS, 100, 30000, DEFAULT_DEBOUNCE_MS);
  const logger = typeof options.logger === "function" ? options.logger : () => {};
  const onImported = typeof options.onImported === "function" ? options.onImported : () => {};

  let db = null;
  let statements = null;
  let timer = null;
  let watcher = null;
  let debounceTimer = null;
  let running = false;
  let lastSyncAt = "";
  let lastError = "";
  let syncInProgress = false;

  function log(event, meta = {}) {
    try {
      logger(event, { rootDir, ...meta });
    } catch {}
  }

  function openDb() {
    if (db) return db;
    if (!dbPath) throw new Error("db_path_required");
    db = new DatabaseSync(dbPath);
    ensureSchema(db);
    return db;
  }

  function closeDb() {
    if (!db) return;
    try { db.close(); } catch {}
    db = null;
    statements = null;
  }

  function sql() {
    const database = openDb();
    if (statements) return statements;
    statements = {
      performers: database.prepare(`SELECT id, name, sort_order, role_slot, is_active, archived_at, created_at, updated_at, COALESCE(external_id, '') AS external_id FROM algorithm_performers ORDER BY sort_order ASC, id ASC`),
      characters: database.prepare(`SELECT id, name, description, prompt_text, performer_id, is_active, archived_at, created_at, updated_at, COALESCE(external_id, '') AS external_id FROM algorithm_characters ORDER BY id ASC`),
      situations: database.prepare(`SELECT id, name, description, prompt_text, required_character_ids_json, allowed_character_ids_json, is_active, archived_at, created_at, updated_at, COALESCE(external_id, '') AS external_id FROM algorithm_situations ORDER BY id ASC`),
      labels: database.prepare(`SELECT id, name, sort_order, is_active, archived_at, created_at, updated_at FROM algorithm_labels ORDER BY sort_order ASC, id ASC`),
      environments: database.prepare(`SELECT id, name, description, prompt_text, is_active, archived_at, created_at, updated_at, COALESCE(external_id, '') AS external_id FROM algorithm_environments ORDER BY id ASC`),
      scenes: database.prepare(`SELECT id, title, sort_order, character_count, character_slots_json, character_ids_json, situation_ids_json, label_ids_json, environment_id, environment_mode, context_scene_id, prompt_override, is_active, archived_at, created_at, updated_at, COALESCE(external_id, '') AS external_id FROM algorithm_scenes ORDER BY sort_order ASC, id ASC`),
      settings: database.prepare(`SELECT key, value, updated_at FROM settings WHERE key IN (${STYLE_SETTING_KEYS.map(() => "?").join(", ")}) ORDER BY key ASC`),
      sessions: database.prepare(`SELECT s.id, s.name, s.started_at, s.ended_at, s.updated_at, COUNT(m.id) AS message_count, COALESCE(MAX(m.id), 0) AS max_message_id FROM sessions s LEFT JOIN chat_messages m ON m.session_id = s.id GROUP BY s.id ORDER BY s.id ASC`),
      messagesBySession: database.prepare(`SELECT id, session_id, time, client_id, client_key, ip, name, text, status, detail FROM chat_messages WHERE session_id = ? ORDER BY id ASC`),
      messagesAfterId: database.prepare(`SELECT id, session_id, time, client_id, client_key, ip, name, text, status, detail FROM chat_messages WHERE session_id = ? AND id > ? ORDER BY id ASC`),
      runs: database.prepare(`SELECT r.id, r.session_id, r.scene_id, r.run_order, r.selection_source, r.started_at, r.ended_at, r.heart_count, r.bored_count, r.comment_count, r.score, r.prompt_snapshot, r.reason, r.updated_at, s.title AS scene_title FROM algorithm_scene_runs r LEFT JOIN algorithm_scenes s ON s.id = r.scene_id ORDER BY r.id ASC`),
      leaderboard: database.prepare(`SELECT s.id AS scene_id, s.title, COUNT(r.id) AS run_count, AVG(r.score) AS avg_score, SUM(r.heart_count) AS hearts, SUM(r.bored_count) AS bored, SUM(r.comment_count) AS comments, MAX(r.ended_at) AS last_run_at FROM algorithm_scenes s LEFT JOIN algorithm_scene_runs r ON r.scene_id = s.id AND r.ended_at IS NOT NULL GROUP BY s.id ORDER BY avg_score DESC, run_count DESC, s.sort_order ASC, s.id ASC`),
      getState: database.prepare(`SELECT file_path AS filePath, entity, entity_id AS entityId, content_hash AS contentHash, db_updated_at AS dbUpdatedAt, file_mtime_ms AS fileMtimeMs, status, last_synced_at AS lastSyncedAt, conflict_path AS conflictPath, last_error AS lastError FROM catalog_file_sync_state WHERE file_path = ?`),
      getStateByEntity: database.prepare(`SELECT file_path AS filePath, entity, entity_id AS entityId, content_hash AS contentHash, db_updated_at AS dbUpdatedAt FROM catalog_file_sync_state WHERE entity = ? AND entity_id = ? ORDER BY last_synced_at DESC LIMIT 1`),
      getStatesByEntity: database.prepare(`SELECT file_path AS filePath, entity, entity_id AS entityId, content_hash AS contentHash, db_updated_at AS dbUpdatedAt, status FROM catalog_file_sync_state WHERE entity = ? AND entity_id = ? ORDER BY file_path ASC`),
      upsertState: database.prepare(`INSERT INTO catalog_file_sync_state (file_path, entity, entity_id, content_hash, db_updated_at, file_mtime_ms, status, last_synced_at, conflict_path, last_error) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(file_path) DO UPDATE SET entity = excluded.entity, entity_id = excluded.entity_id, content_hash = excluded.content_hash, db_updated_at = excluded.db_updated_at, file_mtime_ms = excluded.file_mtime_ms, status = excluded.status, last_synced_at = excluded.last_synced_at, conflict_path = excluded.conflict_path, last_error = excluded.last_error`),
      deleteState: database.prepare(`DELETE FROM catalog_file_sync_state WHERE file_path = ?`),
      getKv: database.prepare(`SELECT value FROM catalog_sync_kv WHERE key = ?`),
      upsertKv: database.prepare(`INSERT INTO catalog_sync_kv (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`),
      getPerformerById: database.prepare(`SELECT id, name, sort_order, role_slot, is_active, archived_at, created_at, updated_at FROM algorithm_performers WHERE id = ?`),
      getCharacterById: database.prepare(`SELECT id, name, description, prompt_text, performer_id, is_active, archived_at, created_at, updated_at FROM algorithm_characters WHERE id = ?`),
      getSituationById: database.prepare(`SELECT id, name, description, prompt_text, required_character_ids_json, allowed_character_ids_json, is_active, archived_at, created_at, updated_at FROM algorithm_situations WHERE id = ?`),
      getEnvironmentById: database.prepare(`SELECT id, name, description, prompt_text, is_active, archived_at, created_at, updated_at FROM algorithm_environments WHERE id = ?`),
      getSceneById: database.prepare(`SELECT id, title, sort_order, character_count, character_slots_json, character_ids_json, situation_ids_json, label_ids_json, environment_id, environment_mode, context_scene_id, prompt_override, is_active, archived_at, created_at, updated_at FROM algorithm_scenes WHERE id = ?`),
      maxSceneSortOrder: database.prepare(`SELECT COALESCE(MAX(sort_order), 0) AS n FROM algorithm_scenes`),
    };
    return statements;
  }

  function ensureFolders() {
    ensureDir(rootDir);
    for (const folder of ROOT_FOLDERS) ensureDir(path.join(rootDir, folder));
    [
      path.join("02 Personages", "Performers"),
      path.join("02 Personages", "Characters"),
      path.join("08 Runs & Scores", "sessions"),
      path.join("09 Chatlogs", "raw"),
      path.join("09 Chatlogs", "transcripts"),
      path.join("10 Techniek & Sync", "conflicts"),
    ].forEach((folder) => ensureDir(path.join(rootDir, folder)));
  }

  function removeEmptyDirIfPresent(relPath) {
    try {
      fs.rmdirSync(path.join(rootDir, relPath));
      log("empty_legacy_folder_removed", { relPath });
    } catch {}
  }

  function getKv(key, fallback = "") {
    const row = sql().getKv.get(key);
    return row && typeof row.value === "string" ? row.value : fallback;
  }

  function setKv(key, value) {
    sql().upsertKv.run(String(key), String(value), nowIso());
  }

  function fileMtimeMs(filePath) {
    try {
      return Math.floor(fs.statSync(filePath).mtimeMs);
    } catch {
      return 0;
    }
  }

  function updateState(relPath, entity, entityId, contentHash, dbUpdatedAt, status = "synced", conflictPath = "", lastError = "") {
    sql().upsertState.run(
      relPath,
      entity,
      normalizeId(entityId, 0),
      contentHash || "",
      dbUpdatedAt || "",
      fileMtimeMs(path.join(rootDir, relPath)),
      status,
      nowIso(),
      conflictPath || null,
      lastError || null
    );
  }

  function writeConflict(relPath, reason, details = {}) {
    const safeBase = path.basename(relPath).replace(/[^A-Za-z0-9_.-]+/g, "-").slice(0, 80) || "record";
    const stamp = nowIso().replace(/[:.]/g, "-");
    const conflictRel = path.join("10 Techniek & Sync", "conflicts", `${stamp}-${safeBase}.md`);
    const conflictPath = path.join(rootDir, conflictRel);
    const body = [
      `# Sync conflict: ${relPath}`,
      "",
      `Reason: ${reason}`,
      "",
      "```json",
      prettyJson(details),
      "```",
      "",
    ].join("\n");
    atomicWriteFile(conflictPath, body);
    log("conflict", { relPath, reason, conflictRel });
    return conflictRel.split(path.sep).join("/");
  }

  function writeRecordFile(relPath, entity, entityId, dbUpdatedAt, rendered) {
    const filePath = path.join(rootDir, relPath);
    const nextHash = hashText(rendered);
    const current = readFileText(filePath);
    const currentHash = current ? hashText(current) : "";
    const state = sql().getState.get(relPath);
    if (state && state.status === "conflict" && current && currentHash === state.contentHash && currentHash !== nextHash) {
      return false;
    }
    if (current && currentHash === nextHash) {
      updateState(relPath, entity, entityId, nextHash, dbUpdatedAt);
      return false;
    }
    if (current && state && state.contentHash && currentHash !== state.contentHash) {
      const conflictRel = writeConflict(relPath, "file_changed_before_db_export", {
        entity,
        entityId,
        dbUpdatedAt,
        previousHash: state.contentHash,
        currentHash,
        nextHash,
      });
      updateState(relPath, entity, entityId, state.contentHash, state.dbUpdatedAt || "", "conflict", conflictRel, "file_changed_before_db_export");
      return false;
    }
    if (current && !state && currentHash !== nextHash) {
      const conflictRel = writeConflict(relPath, "existing_file_without_sync_state", {
        entity,
        entityId,
        dbUpdatedAt,
        currentHash,
        nextHash,
      });
      updateState(relPath, entity, entityId, currentHash, dbUpdatedAt, "conflict", conflictRel, "existing_file_without_sync_state");
      return false;
    }
    atomicWriteFile(filePath, rendered);
    updateState(relPath, entity, entityId, nextHash, dbUpdatedAt);
    return true;
  }

  function removeSupersededFile(relPath, entity, entityId, expectedHash, reason = "renamed") {
    const filePath = path.join(rootDir, relPath);
    const text = readFileText(filePath);
    const state = sql().getState.get(relPath);
    if (!text) {
      if (state) sql().deleteState.run(relPath);
      return false;
    }
    const currentHash = hashText(text);
    const meta = metadataForRecord(relPath, text);
    if ((state && state.contentHash && currentHash === state.contentHash) || currentHash === expectedHash) {
      try {
        fs.unlinkSync(filePath);
      } catch (err) {
        const message = err && err.message ? err.message : "unlink_failed";
        updateState(
          relPath,
          entity,
          entityId,
          currentHash,
          (state && state.dbUpdatedAt) || dbUpdatedAtFor(meta),
          "error",
          "",
          `remove_superseded_failed: ${message}`
        );
        log("superseded_file_remove_failed", { relPath, entity, entityId, reason, message });
        return false;
      }
      sql().deleteState.run(relPath);
      log("superseded_file_removed", { relPath, entity, entityId, reason });
      return true;
    }
    const sameRecord = meta
      && String(meta.entity || "") === String(entity || "")
      && normalizeId(meta.id || meta.sceneId, 0) === normalizeId(entityId, 0);
    if (sameRecord) {
      const conflictRel = writeConflict(relPath, "superseded_file_changed_before_cleanup", {
        entity,
        entityId,
        expectedHash,
        currentHash,
        canonicalReason: reason,
      });
      updateState(relPath, entity, entityId, currentHash, dbUpdatedAtFor(meta), "conflict", conflictRel, "superseded_file_changed_before_cleanup");
    }
    return false;
  }

  function cleanupSupersededFiles(canonicalRelPath, entity, entityId, rendered, legacyRelPaths = []) {
    const expectedHash = hashText(rendered);
    const candidates = new Set((Array.isArray(legacyRelPaths) ? legacyRelPaths : []).map((item) => item.split(path.sep).join("/")));
    for (const row of sql().getStatesByEntity.all(entity, normalizeId(entityId, 0))) {
      const relPath = String(row.filePath || "").split(path.sep).join("/");
      if (relPath && relPath !== canonicalRelPath) candidates.add(relPath);
    }
    for (const relPath of candidates) {
      if (!relPath || relPath === canonicalRelPath) continue;
      removeSupersededFile(relPath, entity, entityId, expectedHash, "canonical_filename_changed");
    }
  }

  function cleanupDeprecatedSceneExports() {
    const sceneRoot = path.join(rootDir, "05 Scènes");
    for (const filePath of walkFiles(sceneRoot, (candidate) => candidate.endsWith(".foryou.md"))) {
      const relPath = relativePosix(rootDir, filePath);
      const text = readFileText(filePath);
      const meta = metadataForRecord(relPath, text);
      if (!meta || String(meta.entity || "") !== "scene") continue;
      removeSupersededFile(relPath, "scene", normalizeId(meta.id, 0), hashText(text), "scene_exports_removed_from_gpt_catalog");
    }
    removeEmptyDirIfPresent("05 Scènes");
  }

  function exportRecord(kind, row, entity, rendered) {
    const relPath = recordPathFor(kind, row).split(path.sep).join("/");
    const changed = writeRecordFile(relPath, entity, row.id, rowUpdatedAt(row), rendered);
    cleanupSupersededFiles(relPath, entity, row.id, rendered, legacyRecordPathsFor(kind, row));
    return changed ? 1 : 0;
  }

  function labelMaps(rows) {
    return {
      performers: Object.fromEntries(rows.performers.map((row) => [Number(row.id), String(row.name || "")])),
      characters: Object.fromEntries(rows.characters.map((row) => [Number(row.id), String(row.name || "")])),
      environments: Object.fromEntries(rows.environments.map((row) => [Number(row.id), String(row.name || "")])),
      situations: Object.fromEntries(rows.situations.map((row) => [Number(row.id), String(row.name || "")])),
      labels: Object.fromEntries((rows.labels || []).map((row) => [Number(row.id), String(row.name || "")])),
      scenes: Object.fromEntries(rows.scenes.map((row) => [Number(row.id), String(row.title || "")])),
    };
  }

  function exportCatalogRecords() {
    const statements = sql();
    const rows = {
      performers: statements.performers.all(),
      characters: statements.characters.all(),
      situations: statements.situations.all(),
      labels: statements.labels.all(),
      environments: statements.environments.all(),
      scenes: statements.scenes.all(),
      settings: statements.settings.all(...STYLE_SETTING_KEYS),
    };
    const labels = labelMaps(rows);
    let changed = 0;
    for (const row of rows.performers) {
      changed += exportRecord("performer", row, "performer", renderPerformer(row));
    }
    for (const row of rows.characters) {
      changed += exportRecord("character", row, "character", renderCharacter(row));
    }
    for (const row of rows.environments) {
      changed += exportRecord("environment", row, "environment", renderEnvironment(row));
    }
    for (const row of rows.situations) {
      changed += exportRecord("situation", row, "situation", renderSituation(row));
    }
    for (const row of rows.scenes) {
      changed += exportRecord("scene_situation", row, "scene_situation", renderSceneSituation(row));
    }
    removeEmptyDirIfPresent(path.join("04 Situaties", "Uit Scènes"));
    removeEmptyDirIfPresent(path.join("04 Situaties", "Database Situaties"));
    cleanupDeprecatedSceneExports();
    changed += writeRecordFile(recordPathFor("style_settings", { id: 1 }), "style_settings", 1, rowUpdatedAt(rows.settings[rows.settings.length - 1] || {}), renderStyleSettings(rows.settings)) ? 1 : 0;
    return { rows, changed };
  }

  function exportRunsAndScores(rows) {
    const statements = sql();
    const runs = statements.runs.all().map((row) => ({
      id: Number(row.id || 0),
      sessionId: Number(row.session_id || 0),
      sceneId: Number(row.scene_id || 0),
      sceneTitle: String(row.scene_title || ""),
      runOrder: Number(row.run_order || 0),
      selectionSource: String(row.selection_source || ""),
      startedAt: String(row.started_at || ""),
      endedAt: row.ended_at ? String(row.ended_at) : null,
      heartCount: Number(row.heart_count || 0),
      boredCount: Number(row.bored_count || 0),
      commentCount: Number(row.comment_count || 0),
      score: row.score === null || row.score === undefined ? null : Number(row.score),
      promptSnapshot: String(row.prompt_snapshot || ""),
      reason: String(row.reason || ""),
      updatedAt: String(row.updated_at || ""),
    }));
    const runsPath = path.join(rootDir, "08 Runs & Scores", "runs.jsonl");
    const runsText = runs.map((run) => JSON.stringify(run)).join("\n") + (runs.length ? "\n" : "");
    writeFileIfChanged(runsPath, runsText);

    const leaderboard = statements.leaderboard.all();
    const lines = [
      "# Runs & Scores",
      "",
      "| Scene | Runs | Avg score | Hearts | Bored | Comments | Last run |",
      "| --- | ---: | ---: | ---: | ---: | ---: | --- |",
      ...leaderboard.map((row) => (
        `| ${String(row.title || `Scene ${row.scene_id}`).replace(/\|/g, "\\|")} | ${Number(row.run_count || 0)} | ${normalizeNumber(row.avg_score, 0).toFixed(2)} | ${Number(row.hearts || 0)} | ${Number(row.bored || 0)} | ${Number(row.comments || 0)} | ${row.last_run_at || ""} |`
      )),
      "",
    ];
    writeFileIfChanged(path.join(rootDir, "08 Runs & Scores", "leaderboard.md"), lines.join("\n"));

    const examples = leaderboard
      .filter((row) => Number(row.run_count || 0) > 0)
      .slice(0, 12)
      .map((row) => `- ${row.title} — avg ${normalizeNumber(row.avg_score, 0).toFixed(2)}, runs ${Number(row.run_count || 0)}`)
      .join("\n") || "_Nog geen gespeelde voorbeeldscènes._";
    writeFileIfChanged(path.join(rootDir, "07 Grappige voorbeeldscènes", "best-presterende-scenes.md"), [
      "# Grappige Voorbeeldscènes",
      "",
      "Deze lijst wordt gegenereerd uit runs en scores, als inspiratie voor GPT.",
      "",
      examples,
      "",
    ].join("\n"));

    return { runs: runs.length, leaderboard: leaderboard.length, catalogRows: rows };
  }

  function exportChatlogs() {
    const statements = sql();
    const sessions = statements.sessions.all();
    let exportedMessages = 0;
    let exportedTranscripts = 0;
    for (const session of sessions) {
      const sessionId = Number(session.id || 0);
      if (!sessionId) continue;
      const maxMessageId = Number(session.max_message_id || 0);
      if (!maxMessageId) continue;
      const filePath = path.join(rootDir, "09 Chatlogs", "raw", `session-${String(sessionId).padStart(5, "0")}.jsonl`);
      const kvKey = `chatlog:last_message_id:${sessionId}`;
      const lastMessageId = normalizeInt(getKv(kvKey, "0"), 0);
      const fileExists = fs.existsSync(filePath);
      if (fileExists && lastMessageId >= maxMessageId) continue;
      const rows = fileExists && lastMessageId > 0
        ? statements.messagesAfterId.all(sessionId, lastMessageId)
        : statements.messagesBySession.all(sessionId);
      const messages = rows.map((row) => ({
        id: Number(row.id || 0),
        sessionId: Number(row.session_id || 0),
        time: String(row.time || ""),
        clientId: Number(row.client_id || 0),
        clientKey: String(row.client_key || ""),
        ip: String(row.ip || ""),
        name: String(row.name || ""),
        text: String(row.text || ""),
        status: String(row.status || ""),
        detail: row.detail === null || row.detail === undefined ? null : String(row.detail),
      }));
      if (!fileExists || lastMessageId <= 0) {
        atomicWriteFile(filePath, messages.map((row) => JSON.stringify(row)).join("\n") + (messages.length ? "\n" : ""));
      } else {
        appendJsonl(filePath, messages);
      }
      exportedMessages += messages.length;
      setKv(kvKey, String(maxMessageId));

      const transcriptPath = path.join(rootDir, "09 Chatlogs", "transcripts", `session-${String(sessionId).padStart(5, "0")}-${slugifyName(session.name || `session-${sessionId}`, "session")}.md`);
      const transcriptRows = statements.messagesBySession.all(sessionId).map((row) => ({
        id: Number(row.id || 0),
        sessionId: Number(row.session_id || 0),
        time: String(row.time || ""),
        clientId: Number(row.client_id || 0),
        clientKey: String(row.client_key || ""),
        ip: String(row.ip || ""),
        name: String(row.name || ""),
        text: String(row.text || ""),
        status: String(row.status || ""),
        detail: row.detail === null || row.detail === undefined ? null : String(row.detail),
      }));
      const transcript = [
        `# Chatlog sessie ${sessionId}: ${normalizeText(session.name, 180) || "zonder naam"}`,
        "",
        bulletValue("startedAt", session.started_at || ""),
        bulletValue("endedAt", session.ended_at || ""),
        bulletValue("messages", transcriptRows.length),
        "",
        "## Transcript",
        "",
        transcriptRows.map(formatTranscriptMessage).join("\n").trim() || "_Geen berichten._",
        "",
      ].join("\n");
      if (writeFileIfChanged(transcriptPath, transcript)) exportedTranscripts += 1;
    }
    const summary = [
      "# Chatlogs",
      "",
      "| Session | Messages | Started | Ended |",
      "| ---: | ---: | --- | --- |",
      ...sessions.map((session) => (
        `| ${Number(session.id || 0)} | ${Number(session.message_count || 0)} | ${escapeMarkdownCell(session.started_at || "")} | ${escapeMarkdownCell(session.ended_at || "")} |`
      )),
      "",
      "Leesbare transcripts staan in `transcripts/`; machineleesbare JSONL staat in `raw/`.",
      "",
    ].join("\n");
    writeFileIfChanged(path.join(rootDir, "09 Chatlogs", "chatlog-index.md"), summary);
    return { sessions: sessions.length, exportedMessages, exportedTranscripts };
  }

  function exportIndexes(rows) {
    const counts = {
      performers: rows.performers.length,
      characters: rows.characters.length,
      environments: rows.environments.length,
      databaseSituations: rows.situations.length,
      sceneSituations: rows.scenes.length,
      scenes: rows.scenes.length,
    };
    const activeCounts = {
      characters: rows.characters.filter((row) => Number(row.is_active || 0) > 0 && !row.archived_at).length,
      environments: rows.environments.filter((row) => Number(row.is_active || 0) > 0 && !row.archived_at).length,
      scenes: rows.scenes.filter((row) => Number(row.is_active || 0) > 0 && !row.archived_at).length,
    };
    const readme = [
      "# For You Database",
      "",
      "Dit is de levende Dropbox-representatie van de lokale SQLite-catalogus.",
      "",
      "- SQLite blijft de runtime-database voor de app.",
      "- Deze map synchroniseert catalogusbestanden twee kanten op.",
      "- `data/live.sqlite` wordt niet via Dropbox gesynct.",
      "- `04 Situaties` bevat de premise/prompt van huidige scènes.",
      "- Speelbare scène-compositie blijft in SQLite en wordt niet als GPT-facing catalogusmap geëxporteerd.",
      "",
      "## Aantallen",
      "",
      ...Object.entries(counts).map(([key, value]) => `- ${key}: ${value}`),
      "",
    ].join("\n");
    writeFileIfChanged(path.join(rootDir, "00 Index voor GPT", "README.md"), readme);

    const gptContext = [
      "# GPT Context",
      "",
      "## Structuur",
      ROOT_FOLDERS.map((folder) => `- ${folder}`).join("\n"),
      "",
      "## Catalogus",
      `- Performers: ${counts.performers}`,
      `- Personages: ${counts.characters} (${activeCounts.characters} actief)`,
      `- Omgevingen: ${counts.environments} (${activeCounts.environments} actief)`,
      `- Situaties uit scènes: ${counts.sceneSituations}`,
      `- Database-situaties: ${counts.databaseSituations}`,
      `- Runtime-scènes in SQLite: ${counts.scenes} (${activeCounts.scenes} actief)`,
      "",
      "## Belangrijke sync-regels",
      "- Bewerk canonieke `.foryou.md` bestanden in `02 Personages`, `03 Omgevingen`, `04 Situaties` en `06 Stijlregels`.",
      "- Conflicten komen in `10 Techniek & Sync/conflicts`.",
      "- Chatlogs staan volledig intern in `09 Chatlogs`, maar deze rollup blijft compact.",
      "",
      "## Actieve scènes",
      rows.scenes
        .filter((row) => Number(row.is_active || 0) > 0 && !row.archived_at)
        .map((row) => `- ${row.title}`)
        .join("\n") || "_Geen actieve scènes._",
      "",
    ].join("\n");
    writeFileIfChanged(path.join(rootDir, "00 Index voor GPT", "gpt-context.md"), gptContext);
    writeFileIfChanged(path.join(rootDir, "00 Index voor GPT", "gpt-context.txt"), gptContext.replace(/^#/gm, ""));

    const manifest = {
      version: FORMAT_VERSION,
      rootDir,
      counts,
      activeCounts,
    };
    writeFileIfChanged(path.join(rootDir, "10 Techniek & Sync", "manifest.json"), prettyJson(manifest) + "\n");
    writeFileIfChanged(path.join(rootDir, "10 Techniek & Sync", "sync-status.md"), [
      "# Sync Status",
      "",
      `Running: ${running ? "yes" : "no"}`,
      `Last error: ${lastError || "-"}`,
      `Root: ${rootDir}`,
      "",
    ].join("\n"));
  }

  function dbUpdatedAtFor(meta) {
    const statements = sql();
    const entity = String(meta && meta.entity || "");
    const id = normalizeId(meta && (meta.id || meta.sceneId));
    if (!id && entity !== "style_settings") return "";
    if (entity === "performer") return rowUpdatedAt(statements.getPerformerById.get(id));
    if (entity === "character") return rowUpdatedAt(statements.getCharacterById.get(id));
    if (entity === "situation") return rowUpdatedAt(statements.getSituationById.get(id));
    if (entity === "environment") return rowUpdatedAt(statements.getEnvironmentById.get(id));
    if (entity === "scene" || entity === "scene_situation") return rowUpdatedAt(statements.getSceneById.get(id));
    if (entity === "style_settings") {
      return statements.settings.all(...STYLE_SETTING_KEYS)
        .map((row) => normalizeIso(row.updated_at, ""))
        .filter(Boolean)
        .sort()
        .pop() || "";
    }
    return "";
  }

  function assertNoConflict(relPath, meta, contentHash) {
    const state = sql().getState.get(relPath);
    if (!state) {
      const currentDbUpdatedAt = dbUpdatedAtFor(meta);
      const fileUpdatedAt = normalizeIso(meta.updatedAt || meta.updated_at, "");
      if (currentDbUpdatedAt && fileUpdatedAt && currentDbUpdatedAt > fileUpdatedAt) {
        const conflictRel = writeConflict(relPath, "existing_file_older_than_db_without_sync_state", {
          entity: meta.entity,
          id: meta.id || meta.sceneId || 0,
          currentDbUpdatedAt,
          fileUpdatedAt,
          incomingHash: contentHash,
        });
        updateState(relPath, String(meta.entity || ""), normalizeId(meta.id || meta.sceneId, 0), contentHash, currentDbUpdatedAt, "conflict", conflictRel, "existing_file_older_than_db_without_sync_state");
        return false;
      }
      return state;
    }
    if (!state.contentHash || state.contentHash === contentHash) return state;
    const currentDbUpdatedAt = dbUpdatedAtFor(meta);
    if (state.dbUpdatedAt && currentDbUpdatedAt && state.dbUpdatedAt !== currentDbUpdatedAt) {
      const conflictRel = writeConflict(relPath, "db_and_file_changed_since_last_sync", {
        entity: meta.entity,
        id: meta.id || meta.sceneId || 0,
        previousDbUpdatedAt: state.dbUpdatedAt,
        currentDbUpdatedAt,
        previousHash: state.contentHash,
        incomingHash: contentHash,
      });
      updateState(relPath, String(meta.entity || ""), normalizeId(meta.id || meta.sceneId, 0), state.contentHash, state.dbUpdatedAt || "", "conflict", conflictRel, "db_and_file_changed_since_last_sync");
      return false;
    }
    return state;
  }

  function importPerformer(meta, text) {
    const database = openDb();
    const statements = sql();
    const id = normalizeId(meta.id, 0);
    const title = extractTitle(text, meta.name || "");
    const row = id ? statements.getPerformerById.get(id) : null;
    const now = nowIso();
    if (row) {
      database.prepare(`UPDATE algorithm_performers SET name = ?, sort_order = ?, role_slot = ?, is_active = ?, archived_at = ?, updated_at = ? WHERE id = ?`)
        .run(title, normalizeInt(meta.sortOrder, row.sort_order || 0), normalizeInt(meta.roleSlot, row.role_slot || 0), normalizeBool(meta.isActive, Number(row.is_active || 0) > 0) ? 1 : 0, normalizeBool(meta.isActive, true) ? null : (meta.archivedAt || row.archived_at || now), now, id);
      return { id, updatedAt: now };
    }
    const insert = database.prepare(`INSERT INTO algorithm_performers (name, sort_order, role_slot, is_active, archived_at, created_at, updated_at, external_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(title, normalizeInt(meta.sortOrder, 0), normalizeInt(meta.roleSlot, 0), normalizeBool(meta.isActive, true) ? 1 : 0, normalizeBool(meta.isActive, true) ? null : (meta.archivedAt || now), now, now, normalizeText(meta.externalId || `dropbox-performer-${Date.now()}`, 120));
    return { id: Number(insert.lastInsertRowid), updatedAt: now };
  }

  function importCharacter(meta, text) {
    const database = openDb();
    const statements = sql();
    const id = normalizeId(meta.id, 0);
    const title = extractTitle(text, meta.name || "");
    const description = extractSection(text, "Beschrijving") || extractBodyAfterTitle(text);
    const row = id ? statements.getCharacterById.get(id) : null;
    const now = nowIso();
    if (row) {
      const performerId = hasOwn(meta, "performerId")
        ? normalizeId(meta.performerId, 0) || null
        : normalizeId(row.performer_id, 0) || null;
      database.prepare(`UPDATE algorithm_characters SET name = ?, description = ?, performer_id = ?, is_active = ?, archived_at = ?, updated_at = ? WHERE id = ?`)
        .run(title, description, performerId, normalizeBool(meta.isActive, Number(row.is_active || 0) > 0) ? 1 : 0, normalizeBool(meta.isActive, true) ? null : (meta.archivedAt || row.archived_at || now), now, id);
      return { id, updatedAt: now };
    }
    const insert = database.prepare(`INSERT INTO algorithm_characters (name, description, prompt_text, performer_id, is_active, archived_at, created_at, updated_at, external_id) VALUES (?, ?, '', ?, ?, ?, ?, ?, ?)`)
      .run(title, description, normalizeId(meta.performerId, 0) || null, normalizeBool(meta.isActive, true) ? 1 : 0, normalizeBool(meta.isActive, true) ? null : (meta.archivedAt || now), now, now, normalizeText(meta.externalId || `dropbox-character-${Date.now()}`, 120));
    return { id: Number(insert.lastInsertRowid), updatedAt: now };
  }

  function importEnvironment(meta, text) {
    const database = openDb();
    const statements = sql();
    const id = normalizeId(meta.id, 0);
    const title = extractTitle(text, meta.name || "");
    const description = extractSection(text, "Beschrijving") || extractBodyAfterTitle(text);
    const row = id ? statements.getEnvironmentById.get(id) : null;
    const now = nowIso();
    if (row) {
      database.prepare(`UPDATE algorithm_environments SET name = ?, description = ?, is_active = ?, archived_at = ?, updated_at = ? WHERE id = ?`)
        .run(title, description, normalizeBool(meta.isActive, Number(row.is_active || 0) > 0) ? 1 : 0, normalizeBool(meta.isActive, true) ? null : (meta.archivedAt || row.archived_at || now), now, id);
      return { id, updatedAt: now };
    }
    const insert = database.prepare(`INSERT INTO algorithm_environments (name, description, prompt_text, is_active, archived_at, created_at, updated_at, external_id) VALUES (?, ?, '', ?, ?, ?, ?, ?)`)
      .run(title, description, normalizeBool(meta.isActive, true) ? 1 : 0, normalizeBool(meta.isActive, true) ? null : (meta.archivedAt || now), now, now, normalizeText(meta.externalId || `dropbox-environment-${Date.now()}`, 120));
    return { id: Number(insert.lastInsertRowid), updatedAt: now };
  }

  function importSituation(meta, text) {
    const database = openDb();
    const statements = sql();
    const id = normalizeId(meta.id, 0);
    const title = extractTitle(text, meta.name || "");
    const premise = extractSection(text, "Premise") || extractBodyAfterTitle(text);
    const promptText = extractSection(text, "Prompt");
    const row = id ? statements.getSituationById.get(id) : null;
    const requiredJson = hasOwn(meta, "requiredCharacterIds")
      ? safeJsonStringify(normalizeIdList(meta.requiredCharacterIds || []), "[]")
      : (row && row.required_character_ids_json) || "[]";
    const allowedJson = hasOwn(meta, "allowedCharacterIds")
      ? safeJsonStringify(normalizeIdList(meta.allowedCharacterIds || []), "[]")
      : (row && row.allowed_character_ids_json) || "[]";
    const now = nowIso();
    if (row) {
      database.prepare(`UPDATE algorithm_situations SET name = ?, description = ?, prompt_text = ?, required_character_ids_json = ?, allowed_character_ids_json = ?, is_active = ?, archived_at = ?, updated_at = ? WHERE id = ?`)
        .run(title, premise, promptText, requiredJson, allowedJson, normalizeBool(meta.isActive, Number(row.is_active || 0) > 0) ? 1 : 0, normalizeBool(meta.isActive, true) ? null : (meta.archivedAt || row.archived_at || now), now, id);
      return { id, updatedAt: now };
    }
    const insert = database.prepare(`INSERT INTO algorithm_situations (name, description, prompt_text, required_character_ids_json, allowed_character_ids_json, is_active, archived_at, created_at, updated_at, external_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(title, premise, promptText, requiredJson, allowedJson, normalizeBool(meta.isActive, true) ? 1 : 0, normalizeBool(meta.isActive, true) ? null : (meta.archivedAt || now), now, now, normalizeText(meta.externalId || `dropbox-situation-${Date.now()}`, 120));
    return { id: Number(insert.lastInsertRowid), updatedAt: now };
  }

  function importSceneSituation(meta, text) {
    const database = openDb();
    const statements = sql();
    const id = normalizeId(meta.sceneId || meta.id, 0);
    const title = extractTitle(text, meta.title || "");
    const premise = extractSection(text, "Premise") || extractBodyAfterTitle(text);
    const row = id ? statements.getSceneById.get(id) : null;
    if (!row) throw new Error("scene_not_found");
    const now = nowIso();
    database.prepare(`UPDATE algorithm_scenes SET title = ?, prompt_override = ?, is_active = ?, archived_at = ?, updated_at = ? WHERE id = ?`)
      .run(title, premise, normalizeBool(meta.isActive, Number(row.is_active || 0) > 0) ? 1 : 0, normalizeBool(meta.isActive, true) ? null : (meta.archivedAt || row.archived_at || now), now, id);
    return { id, updatedAt: now };
  }

  function importScene(meta, text) {
    const database = openDb();
    const statements = sql();
    const id = normalizeId(meta.id, 0);
    const row = id ? statements.getSceneById.get(id) : null;
    const now = nowIso();
    const rowCharacterSlots = row ? normalizeIdList(safeJsonParse(row.character_slots_json || "[]", [])) : [];
    const rowCharacterIds = row ? normalizeIdList(safeJsonParse(row.character_ids_json || "[]", [])) : [];
    const rowSituationIds = row ? normalizeIdList(safeJsonParse(row.situation_ids_json || "[]", [])) : [];
    const rowLabelIds = row ? normalizeIdList(safeJsonParse(row.label_ids_json || "[]", [])) : [];
    const characterSlots = hasOwn(meta, "characterSlots") || hasOwn(meta, "characterIds")
      ? normalizeIdList(meta.characterSlots || meta.characterIds || [])
      : rowCharacterSlots;
    const characterIds = hasOwn(meta, "characterIds")
      ? normalizeIdList(meta.characterIds || characterSlots.filter((item) => item > 0))
      : rowCharacterIds;
    const situationIds = hasOwn(meta, "situationIds")
      ? normalizeIdList(meta.situationIds || [])
      : rowSituationIds;
    const labelIds = hasOwn(meta, "labelIds")
      ? normalizeIdList(meta.labelIds || [])
      : rowLabelIds;
    if (row) {
      const environmentMode = hasOwn(meta, "environmentMode")
        ? normalizeText(meta.environmentMode || row.environment_mode || "selected", 40)
        : normalizeText(row.environment_mode || "selected", 40);
      const environmentId = hasOwn(meta, "environmentId")
        ? normalizeId(meta.environmentId, 0) || null
        : normalizeId(row.environment_id, 0) || null;
      const contextSceneId = hasOwn(meta, "contextSceneId")
        ? normalizeId(meta.contextSceneId, 0) || null
        : normalizeId(row.context_scene_id, 0) || null;
      database.prepare(`UPDATE algorithm_scenes SET sort_order = ?, character_count = ?, character_slots_json = ?, character_ids_json = ?, situation_ids_json = ?, label_ids_json = ?, environment_id = ?, environment_mode = ?, context_scene_id = ?, is_active = ?, archived_at = ?, updated_at = ? WHERE id = ?`)
        .run(
          normalizeInt(meta.sortOrder, row.sort_order || 0),
          normalizeInt(meta.characterCount, row.character_count || Math.max(1, characterSlots.length || characterIds.length || 1)),
          safeJsonStringify(characterSlots, "[]"),
          safeJsonStringify(characterIds, "[]"),
          safeJsonStringify(situationIds, "[]"),
          safeJsonStringify(labelIds, "[]"),
          environmentMode === "random" ? null : environmentId,
          environmentMode,
          contextSceneId,
          normalizeBool(meta.isActive, Number(row.is_active || 0) > 0) ? 1 : 0,
          normalizeBool(meta.isActive, true) ? null : (meta.archivedAt || row.archived_at || now),
          now,
          id
        );
      return { id, updatedAt: now };
    }
    const title = extractTitle(text, meta.title || "Nieuwe scène");
    const insert = database.prepare(`INSERT INTO algorithm_scenes (title, sort_order, character_count, character_slots_json, character_ids_json, situation_ids_json, label_ids_json, environment_id, environment_mode, context_scene_id, prompt_override, is_active, archived_at, created_at, updated_at, external_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '', ?, ?, ?, ?, ?)`)
      .run(
        title,
        normalizeInt(meta.sortOrder, Number(statements.maxSceneSortOrder.get().n || 0) + 10),
        normalizeInt(meta.characterCount, Math.max(1, characterSlots.length || characterIds.length || 1)),
        safeJsonStringify(characterSlots, "[]"),
        safeJsonStringify(characterIds, "[]"),
        safeJsonStringify(situationIds, "[]"),
        safeJsonStringify(labelIds, "[]"),
        String(meta.environmentMode || "selected") === "random" ? null : normalizeId(meta.environmentId, 0) || null,
        normalizeText(meta.environmentMode || "selected", 40),
        normalizeId(meta.contextSceneId, 0) || null,
        normalizeBool(meta.isActive, true) ? 1 : 0,
        normalizeBool(meta.isActive, true) ? null : (meta.archivedAt || now),
        now,
        now,
        normalizeText(meta.externalId || `dropbox-scene-${Date.now()}`, 120)
      );
    return { id: Number(insert.lastInsertRowid), updatedAt: now };
  }

  function importStyleSettings(meta, text) {
    const database = openDb();
    const settings = extractJsonCode(extractSection(text, "Settings JSON"), {});
    if (!settings || typeof settings !== "object" || Array.isArray(settings)) throw new Error("settings_json_invalid");
    const now = nowIso();
    const upsert = database.prepare(`INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`);
    for (const key of STYLE_SETTING_KEYS) {
      if (!Object.prototype.hasOwnProperty.call(settings, key)) continue;
      upsert.run(key, String(settings[key] === undefined || settings[key] === null ? "" : settings[key]), now);
    }
    return { id: 1, updatedAt: now };
  }

  function importRecordFile(filePath) {
    const relPath = relativePosix(rootDir, filePath);
    if (!relPath.endsWith(".foryou.md")) return false;
    const text = readFileText(filePath);
    if (!text) return false;
    const meta = metadataForRecord(relPath, text);
    if (!meta || Number(meta.version || 0) !== FORMAT_VERSION || !meta.entity) return false;
    const contentHash = hashText(text);
    const conflictState = assertNoConflict(relPath, meta, contentHash);
    if (conflictState === false) return false;
    if (conflictState && conflictState.contentHash === contentHash && conflictState.status === "synced") return false;

    const entity = String(meta.entity || "");
    let result = null;
    openDb().exec("BEGIN IMMEDIATE");
    try {
      if (entity === "performer") result = importPerformer(meta, text);
      else if (entity === "character") result = importCharacter(meta, text);
      else if (entity === "environment") result = importEnvironment(meta, text);
      else if (entity === "situation") result = importSituation(meta, text);
      else if (entity === "scene_situation") result = importSceneSituation(meta, text);
      else if (entity === "scene") result = importScene(meta, text);
      else if (entity === "style_settings") result = importStyleSettings(meta, text);
      else {
        openDb().exec("ROLLBACK");
        return false;
      }
      openDb().exec("COMMIT");
    } catch (err) {
      try { openDb().exec("ROLLBACK"); } catch {}
      const conflictRel = writeConflict(relPath, "import_failed", {
        entity,
        message: err && err.message ? err.message : "unknown",
      });
      updateState(relPath, entity, normalizeId(meta.id || meta.sceneId, 0), contentHash, dbUpdatedAtFor(meta), "error", conflictRel, err && err.message ? err.message : "import_failed");
      throw err;
    }
    updateState(relPath, entity, result.id || normalizeId(meta.id || meta.sceneId, 0), contentHash, result.updatedAt);
    try { onImported({ entity, id: result.id || 0, filePath: relPath }); } catch {}
    log("imported", { entity, id: result.id || 0, relPath });
    return true;
  }

  function importChangedFiles() {
    const importRoots = [
      path.join(rootDir, "02 Personages"),
      path.join(rootDir, "03 Omgevingen"),
      path.join(rootDir, "04 Situaties"),
      path.join(rootDir, "05 Scènes"),
      path.join(rootDir, "06 Stijlregels"),
    ];
    let imported = 0;
    for (const importRoot of importRoots) {
      for (const filePath of walkFiles(importRoot, (candidate) => candidate.endsWith(".foryou.md"))) {
        try {
          if (importRecordFile(filePath)) imported += 1;
        } catch (err) {
          log("import_failed", { filePath, message: err && err.message ? err.message : "unknown" });
        }
      }
    }
    return imported;
  }

  function syncNow() {
    if (!enabled) return { ok: true, enabled: false, rootDir };
    if (syncInProgress) return { ok: true, skipped: "already_running", rootDir };
    syncInProgress = true;
    try {
      openDb();
      ensureFolders();
      const imported = importChangedFiles();
      const exported = exportCatalogRecords();
      const runs = exportRunsAndScores(exported.rows);
      const chatlogs = exportChatlogs();
      exportIndexes(exported.rows);
      lastSyncAt = nowIso();
      lastError = "";
      return {
        ok: true,
        enabled: true,
        rootDir,
        imported,
        exportedRecordsChanged: exported.changed,
        runs,
        chatlogs,
        lastSyncAt,
      };
    } catch (err) {
      lastError = err && err.message ? err.message : "dropbox_catalog_sync_failed";
      log("sync_failed", { message: lastError });
      return { ok: false, enabled: true, rootDir, error: lastError };
    } finally {
      syncInProgress = false;
    }
  }

  function scheduleSync() {
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      debounceTimer = null;
      syncNow();
    }, debounceMs);
    if (debounceTimer && debounceTimer.unref) debounceTimer.unref();
  }

  function startWatcher() {
    try {
      watcher = fs.watch(rootDir, { recursive: true }, (eventType, filename) => {
        const name = String(filename || "");
        if (!name || name.includes(".tmp") || name.includes("10 Techniek & Sync/conflicts")) return;
        scheduleSync();
      });
      if (watcher && watcher.unref) watcher.unref();
    } catch (err) {
      log("watcher_unavailable", { message: err && err.message ? err.message : "unknown" });
    }
  }

  function start() {
    if (!enabled) {
      log("disabled", { reason: "dropbox_folder_not_found_or_disabled" });
      return { ok: true, enabled: false, rootDir };
    }
    if (running) return { ok: true, enabled: true, rootDir, running: true };
    running = true;
    const initial = syncNow();
    startWatcher();
    timer = setInterval(() => {
      syncNow();
    }, intervalMs);
    if (timer && timer.unref) timer.unref();
    log("started", { intervalMs, initialOk: !!initial.ok });
    return { ok: true, enabled: true, rootDir, running: true, initial };
  }

  function stop() {
    running = false;
    if (timer) clearInterval(timer);
    if (debounceTimer) clearTimeout(debounceTimer);
    timer = null;
    debounceTimer = null;
    if (watcher) {
      try { watcher.close(); } catch {}
      watcher = null;
    }
    closeDb();
  }

  function getStatus() {
    return {
      ok: true,
      enabled,
      running,
      rootDir,
      intervalMs,
      debounceMs,
      lastSyncAt,
      lastError,
    };
  }

  return {
    start,
    stop,
    syncNow,
    getStatus,
    rootDir,
    enabled,
  };
}

module.exports = {
  FORMAT_VERSION,
  ROOT_FOLDERS,
  createDropboxCatalogSync,
  defaultRootDir,
  descriptionWithSubject,
  parseMetadata,
};
