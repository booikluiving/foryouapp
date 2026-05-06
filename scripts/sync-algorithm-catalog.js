#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const { DatabaseSync } = require("node:sqlite");

const TABLES = Object.freeze({
  algorithm_characters: [
    "id",
    "name",
    "description",
    "prompt_text",
    "is_active",
    "archived_at",
    "created_at",
    "updated_at",
  ],
  algorithm_situations: [
    "id",
    "name",
    "description",
    "prompt_text",
    "required_character_ids_json",
    "allowed_character_ids_json",
    "is_active",
    "archived_at",
    "created_at",
    "updated_at",
  ],
  algorithm_environments: [
    "id",
    "name",
    "description",
    "prompt_text",
    "is_active",
    "archived_at",
    "created_at",
    "updated_at",
  ],
  algorithm_scenes: [
    "id",
    "title",
    "sort_order",
    "character_count",
    "character_slots_json",
    "character_ids_json",
    "situation_ids_json",
    "environment_id",
    "environment_mode",
    "context_scene_id",
    "prompt_override",
    "is_active",
    "archived_at",
    "created_at",
    "updated_at",
  ],
});

const SETTINGS_KEYS = Object.freeze([
  "algorithm_calibration_count",
  "algorithm_global_prompt",
  "algorithm_prompt_template",
]);

function usage() {
  console.error([
    "Usage:",
    "  node scripts/sync-algorithm-catalog.js export --db data/live.sqlite",
    "  node scripts/sync-algorithm-catalog.js import --db data/live.sqlite --input catalog.json --backup",
  ].join("\n"));
  process.exit(2);
}

function argValue(args, name, fallback = "") {
  const index = args.indexOf(name);
  if (index < 0) return fallback;
  return args[index + 1] || fallback;
}

function quoteIdent(value) {
  return `"${String(value).replace(/"/g, "\"\"")}"`;
}

function quoteSqlString(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}

function ensureFileExists(filePath) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`file_not_found:${filePath}`);
  }
}

function openDb(dbPath) {
  ensureFileExists(dbPath);
  const db = new DatabaseSync(dbPath);
  ensureAlgorithmSchema(db);
  return db;
}

function ensureAlgorithmSchema(db) {
  const sceneColumns = db.prepare("PRAGMA table_info(algorithm_scenes)").all();
  if (!sceneColumns.some((column) => String(column.name || "") === "context_scene_id")) {
    db.exec("ALTER TABLE algorithm_scenes ADD COLUMN context_scene_id INTEGER");
  }
}

function exportCatalog(dbPath) {
  const db = openDb(dbPath);
  const tables = {};
  for (const [table, columns] of Object.entries(TABLES)) {
    const columnList = columns.map(quoteIdent).join(", ");
    tables[table] = db.prepare(`SELECT ${columnList} FROM ${quoteIdent(table)} ORDER BY id ASC`).all();
  }
  const settings = db.prepare(
    `SELECT key, value, updated_at FROM settings WHERE key IN (${SETTINGS_KEYS.map(() => "?").join(", ")}) ORDER BY key ASC`
  ).all(...SETTINGS_KEYS);
  return {
    version: 1,
    exportedAt: new Date().toISOString(),
    source: path.resolve(dbPath),
    tables,
    settings,
  };
}

function readPayload(inputPath) {
  const raw = inputPath
    ? fs.readFileSync(inputPath, "utf8")
    : fs.readFileSync(0, "utf8");
  const payload = JSON.parse(raw);
  if (!payload || payload.version !== 1 || !payload.tables || typeof payload.tables !== "object") {
    throw new Error("invalid_catalog_payload");
  }
  return payload;
}

function backupDb(dbPath) {
  const backupDir = path.join(path.dirname(dbPath), "sync-backups");
  fs.mkdirSync(backupDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const backupPath = path.join(backupDir, `live.sqlite.${stamp}.bak`);
  const db = openDb(dbPath);
  db.exec(`VACUUM INTO ${quoteSqlString(backupPath)}`);
  db.close();
  return backupPath;
}

function normalizeRows(payload, table) {
  const rows = payload.tables[table];
  return Array.isArray(rows) ? rows : [];
}

function importRows(db, table, columns, rows) {
  const quotedTable = quoteIdent(table);
  const columnList = columns.map(quoteIdent).join(", ");
  const placeholders = columns.map(() => "?").join(", ");
  const insert = db.prepare(`INSERT INTO ${quotedTable} (${columnList}) VALUES (${placeholders})`);
  db.prepare(`DELETE FROM ${quotedTable}`).run();
  for (const row of rows) {
    insert.run(...columns.map((column) => row[column] === undefined ? null : row[column]));
  }
}

function importSettings(db, settings) {
  const deleteSetting = db.prepare("DELETE FROM settings WHERE key = ?");
  const insertSetting = db.prepare("INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)");
  const byKey = new Map((Array.isArray(settings) ? settings : []).map((row) => [String(row.key || ""), row]));
  for (const key of SETTINGS_KEYS) {
    deleteSetting.run(key);
    const row = byKey.get(key);
    if (row) insertSetting.run(key, String(row.value || ""), String(row.updated_at || new Date().toISOString()));
  }
}

function importCatalog(dbPath, payload) {
  const db = openDb(dbPath);
  db.exec("PRAGMA foreign_keys = OFF");
  db.exec("BEGIN IMMEDIATE");
  try {
    importRows(db, "algorithm_scenes", TABLES.algorithm_scenes, normalizeRows(payload, "algorithm_scenes"));
    importRows(db, "algorithm_situations", TABLES.algorithm_situations, normalizeRows(payload, "algorithm_situations"));
    importRows(db, "algorithm_environments", TABLES.algorithm_environments, normalizeRows(payload, "algorithm_environments"));
    importRows(db, "algorithm_characters", TABLES.algorithm_characters, normalizeRows(payload, "algorithm_characters"));
    importSettings(db, payload.settings);
    db.exec("COMMIT");
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  } finally {
    db.close();
  }
}

function main() {
  const args = process.argv.slice(2);
  const mode = args[0] || "";
  const dbPath = argValue(args, "--db", path.join(process.cwd(), "data", "live.sqlite"));
  if (!mode || !["export", "import"].includes(mode)) usage();

  if (mode === "export") {
    process.stdout.write(JSON.stringify(exportCatalog(dbPath), null, 2) + "\n");
    return;
  }

  const inputPath = argValue(args, "--input", "");
  const shouldBackup = args.includes("--backup");
  const payload = readPayload(inputPath);
  let backupPath = "";
  if (shouldBackup) backupPath = backupDb(dbPath);
  importCatalog(dbPath, payload);
  const counts = Object.fromEntries(Object.keys(TABLES).map((table) => [table, normalizeRows(payload, table).length]));
  process.stdout.write(JSON.stringify({ ok: true, backupPath, counts }, null, 2) + "\n");
}

main();
