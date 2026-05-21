#!/usr/bin/env node
"use strict";

const path = require("path");
const fs = require("fs");
const { createDropboxCatalogSync } = require("../lib/dropbox-catalog-sync");
const { writeCatalogDatabaseMarkdown } = require("../lib/catalog-database-md");

const appDir = path.resolve(__dirname, "..");
const dbPath = path.join(appDir, "data", "live.sqlite");

function isTruthy(value) {
  return ["1", "true", "yes", "ja", "on"].includes(String(value || "").trim().toLowerCase());
}

function outputPaths(rootDir) {
  const primary = path.resolve(
    process.env.FORYOU_CLOUD_API_DATABASE_MD || path.join(appDir, "output", "cloud-api", "database.md")
  );
  const outputs = [primary];
  if (rootDir) {
    const legacy = path.join(path.dirname(rootDir), "Claude API", "database.md");
    const shouldWriteLegacy = isTruthy(process.env.FORYOU_WRITE_LEGACY_CLAUDE_DATABASE_MD)
      || fs.existsSync(path.dirname(legacy));
    if (shouldWriteLegacy && path.resolve(legacy) !== primary) outputs.push(legacy);
  }
  return outputs;
}

function safeError(err, fallback) {
  return String(err && err.message ? err.message : fallback).slice(0, 300);
}

const reason = String(process.env.FORYOU_CATALOG_MIRROR_REASON || "catalog_save").slice(0, 80);
const sync = createDropboxCatalogSync({
  dbPath,
  enabled: process.env.FORYOU_DROPBOX_CATALOG_ENABLED,
  intervalMs: process.env.FORYOU_DROPBOX_CATALOG_INTERVAL_MS || 600000,
});

const result = {
  ok: true,
  reason,
  dropbox: null,
  databaseMd: null,
};

try {
  result.dropbox = sync.syncNow();
} catch (err) {
  result.ok = false;
  result.dropbox = { ok: false, error: safeError(err, "dropbox_catalog_sync_failed") };
} finally {
  sync.stop();
}

try {
  result.databaseMd = writeCatalogDatabaseMarkdown({
    rootDir: sync.rootDir,
    outputPaths: outputPaths(sync.rootDir),
  });
} catch (err) {
  result.ok = false;
  result.databaseMd = { ok: false, error: safeError(err, "database_md_sync_failed") };
}

if (result.dropbox && result.dropbox.ok === false) result.ok = false;
if (result.databaseMd && result.databaseMd.ok === false) result.ok = false;

console.log(JSON.stringify(result));
process.exit(result.ok ? 0 : 1);
