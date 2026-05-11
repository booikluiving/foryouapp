#!/usr/bin/env node
"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { DatabaseSync } = require("node:sqlite");
const { createDropboxCatalogSync } = require("../lib/dropbox-catalog-sync");

function makeTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "foryou-dropbox-catalog-"));
}

function setupDb(dbPath) {
  const db = new DatabaseSync(dbPath);
  db.exec(`
    CREATE TABLE settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      started_at TEXT NOT NULL,
      ended_at TEXT,
      updated_at TEXT
    );
    CREATE TABLE chat_messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id INTEGER NOT NULL,
      time TEXT NOT NULL,
      client_id INTEGER,
      client_key TEXT,
      ip TEXT,
      name TEXT,
      text TEXT,
      status TEXT NOT NULL,
      detail TEXT
    );
    CREATE TABLE algorithm_performers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      sort_order INTEGER NOT NULL DEFAULT 0,
      role_slot INTEGER NOT NULL DEFAULT 0,
      is_active INTEGER NOT NULL DEFAULT 1,
      archived_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE algorithm_characters (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      description TEXT,
      prompt_text TEXT,
      performer_id INTEGER,
      is_active INTEGER NOT NULL DEFAULT 1,
      archived_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE algorithm_situations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      description TEXT,
      prompt_text TEXT,
      required_character_ids_json TEXT NOT NULL DEFAULT '[]',
      allowed_character_ids_json TEXT NOT NULL DEFAULT '[]',
      is_active INTEGER NOT NULL DEFAULT 1,
      archived_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE algorithm_labels (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      sort_order INTEGER NOT NULL DEFAULT 0,
      is_active INTEGER NOT NULL DEFAULT 1,
      archived_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE algorithm_environments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      description TEXT,
      prompt_text TEXT,
      is_active INTEGER NOT NULL DEFAULT 1,
      archived_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE algorithm_scenes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      sort_order INTEGER NOT NULL DEFAULT 0,
      character_count INTEGER NOT NULL DEFAULT 1,
      character_slots_json TEXT NOT NULL DEFAULT '[]',
      character_ids_json TEXT NOT NULL DEFAULT '[]',
      situation_ids_json TEXT NOT NULL DEFAULT '[]',
      label_ids_json TEXT NOT NULL DEFAULT '[]',
      environment_id INTEGER,
      environment_mode TEXT NOT NULL DEFAULT 'selected',
      context_scene_id INTEGER,
      prompt_override TEXT,
      is_active INTEGER NOT NULL DEFAULT 1,
      archived_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE algorithm_scene_runs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id INTEGER NOT NULL,
      scene_id INTEGER NOT NULL,
      run_order INTEGER NOT NULL,
      selection_source TEXT,
      started_at TEXT NOT NULL,
      ended_at TEXT,
      heart_count INTEGER NOT NULL DEFAULT 0,
      bored_count INTEGER NOT NULL DEFAULT 0,
      comment_count INTEGER NOT NULL DEFAULT 0,
      score REAL,
      prompt_snapshot TEXT,
      reason TEXT,
      updated_at TEXT
    );
  `);
  const now = "2026-05-10T10:00:00.000Z";
  db.prepare("INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)").run("algorithm_global_prompt", "Originele stijl", now);
  db.prepare("INSERT INTO algorithm_performers (name, sort_order, role_slot, is_active, archived_at, created_at, updated_at) VALUES (?, ?, ?, 1, NULL, ?, ?)").run("Megan", 10, 1, now, now);
  db.prepare("INSERT INTO algorithm_characters (name, description, prompt_text, performer_id, is_active, archived_at, created_at, updated_at) VALUES (?, ?, '', 1, 1, NULL, ?, ?)").run("Lotte", "Originele beschrijving", now, now);
  db.prepare("INSERT INTO algorithm_environments (name, description, prompt_text, is_active, archived_at, created_at, updated_at) VALUES (?, ?, '', 1, NULL, ?, ?)").run("Supermarkt", "Originele omgeving", now, now);
  db.prepare("INSERT INTO algorithm_scenes (title, sort_order, character_count, character_slots_json, character_ids_json, situation_ids_json, label_ids_json, environment_id, environment_mode, context_scene_id, prompt_override, is_active, archived_at, created_at, updated_at) VALUES (?, 10, 1, '[1]', '[1]', '[]', '[]', 1, 'selected', NULL, ?, 1, NULL, ?, ?)").run("Lotte in de supermarkt", "Originele premise", now, now);
  db.prepare("INSERT INTO sessions (name, started_at, ended_at, updated_at) VALUES ('Test', ?, NULL, ?)").run(now, now);
  db.prepare("INSERT INTO chat_messages (session_id, time, client_id, client_key, ip, name, text, status, detail) VALUES (1, ?, 7, 'client|127.0.0.1', '127.0.0.1', 'Tester', 'Hallo catalogus', 'accepted', NULL)").run(now);
  db.prepare("INSERT INTO algorithm_scene_runs (session_id, scene_id, run_order, selection_source, started_at, ended_at, heart_count, bored_count, comment_count, score, prompt_snapshot, reason, updated_at) VALUES (1, 1, 1, 'manual', ?, ?, 3, 1, 2, 4.5, 'Prompt', 'test', ?)").run(now, now, now);
  db.close();
}

function read(filePath) {
  return fs.readFileSync(filePath, "utf8");
}

function main() {
  const tempDir = makeTempDir();
  const dbPath = path.join(tempDir, "live.sqlite");
  const rootDir = path.join(tempDir, "Dropbox", "For You", "Database");
  setupDb(dbPath);

  const sync = createDropboxCatalogSync({
    dbPath,
    rootDir,
    enabled: "1",
    intervalMs: 600000,
  });

  let result = sync.syncNow();
  assert.equal(result.ok, true);
  assert.equal(result.exportedRecordsChanged > 0, true);

  const characterFile = path.join(rootDir, "02 Personages", "Characters", "lotte-character-0001.foryou.md");
  const environmentFile = path.join(rootDir, "03 Omgevingen", "supermarkt-environment-0001.foryou.md");
  const sceneSituationFile = path.join(rootDir, "04 Situaties", "lotte-in-de-supermarkt-situation-scene-0001.foryou.md");
  assert.equal(fs.existsSync(characterFile), true);
  assert.equal(fs.existsSync(environmentFile), true);
  assert.equal(fs.existsSync(sceneSituationFile), true);
  assert.equal(fs.existsSync(path.join(rootDir, "05 Scènes")), false);
  assert.equal(read(characterFile).includes("foryou:metadata"), false);
  assert.equal(read(environmentFile).includes("foryou:metadata"), false);
  assert.equal(read(sceneSituationFile).includes("foryou:metadata"), false);
  assert.equal(read(characterFile).includes("## Koppeling"), false);
  assert.equal(read(characterFile).includes("## Beschrijving"), false);
  assert.equal(read(characterFile).includes("Originele beschrijving"), true);
  assert.equal(read(characterFile).includes("Lotte is originele beschrijving"), false);
  assert.equal(read(environmentFile).includes("## Status"), false);
  assert.equal(read(environmentFile).includes("## Beschrijving"), false);
  assert.equal(read(environmentFile).includes("Originele omgeving"), true);
  assert.equal(read(environmentFile).includes("Supermarkt is originele omgeving"), false);
  assert.equal(read(sceneSituationFile).includes("Deze file beheert"), false);
  assert.equal(read(sceneSituationFile).includes("## Premise"), false);
  assert.equal(read(sceneSituationFile).includes("Originele premise"), true);
  assert.equal(fs.existsSync(path.join(rootDir, "04 Situaties", "Uit Scènes")), false);
  const legacyCharacterFile = path.join(rootDir, "02 Personages", "Characters", "character-0001.foryou.md");
  const legacySlugCharacterFile = path.join(rootDir, "02 Personages", "Characters", "character-0001-lotte.foryou.md");
  fs.copyFileSync(characterFile, legacyCharacterFile);
  fs.copyFileSync(characterFile, legacySlugCharacterFile);
  result = sync.syncNow();
  assert.equal(result.ok, true);
  assert.equal(fs.existsSync(legacyCharacterFile), false, "legacy generic character filenames should be removed after slugged export");
  assert.equal(fs.existsSync(legacySlugCharacterFile), false, "legacy type-first character filenames should be removed after name-first export");
  assert.equal(fs.existsSync(path.join(rootDir, "08 Runs & Scores", "runs.jsonl")), true);
  assert.equal(fs.existsSync(path.join(rootDir, "09 Chatlogs", "raw", "session-00001.jsonl")), true);
  const transcriptFile = path.join(rootDir, "09 Chatlogs", "transcripts", "session-00001-test.md");
  assert.equal(fs.existsSync(transcriptFile), true);
  assert.equal(read(transcriptFile).includes("Hallo catalogus"), true);
  assert.equal(read(transcriptFile).includes("Tester"), true);

  result = sync.syncNow();
  assert.equal(result.exportedRecordsChanged, 0, "unchanged export should not rewrite catalog records");

  fs.writeFileSync(characterFile, read(characterFile).replace("Originele beschrijving", "Nieuwe Dropbox beschrijving"));
  result = sync.syncNow();
  assert.equal(result.ok, true);
  const db = new DatabaseSync(dbPath);
  assert.equal(db.prepare("SELECT description FROM algorithm_characters WHERE id = 1").get().description, "Nieuwe Dropbox beschrijving");
  assert.equal(db.prepare("SELECT performer_id FROM algorithm_characters WHERE id = 1").get().performer_id, 1, "clean character files should not clear performer links");
  assert.equal(db.prepare("SELECT character_slots_json FROM algorithm_scenes WHERE id = 1").get().character_slots_json, "[1]", "clean scene files should not clear scene composition");

  db.prepare("UPDATE algorithm_environments SET description = ?, updated_at = ? WHERE id = 1").run("DB wijziging", "2026-05-10T10:05:00.000Z");
  result = sync.syncNow();
  assert.equal(result.ok, true);
  assert.equal(read(environmentFile).includes("DB wijziging"), true, "DB edits should export to Dropbox file");

  fs.writeFileSync(characterFile, read(characterFile).replace("Nieuwe Dropbox beschrijving", "Conflicterende Dropbox beschrijving"));
  db.prepare("UPDATE algorithm_characters SET description = ?, updated_at = ? WHERE id = 1").run("Conflicterende DB beschrijving", "2026-05-10T10:10:00.000Z");
  result = sync.syncNow();
  assert.equal(result.ok, true);
  assert.equal(db.prepare("SELECT description FROM algorithm_characters WHERE id = 1").get().description, "Conflicterende DB beschrijving");
  assert.equal(read(characterFile).includes("Conflicterende Dropbox beschrijving"), true, "conflicting file should not be overwritten");
  const conflictsDir = path.join(rootDir, "10 Techniek & Sync", "conflicts");
  assert.equal(fs.readdirSync(conflictsDir).some((name) => name.endsWith(".md")), true, "conflict report should be written");

  db.close();
  sync.stop();
  fs.rmSync(tempDir, { recursive: true, force: true });
  console.log("dropbox catalog sync tests passed");
}

main();
