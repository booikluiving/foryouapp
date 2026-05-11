#!/usr/bin/env node
"use strict";

const path = require("path");
const { createDropboxCatalogSync } = require("../lib/dropbox-catalog-sync");

const dbPath = path.resolve(__dirname, "..", "data", "live.sqlite");
const sync = createDropboxCatalogSync({
  dbPath,
  enabled: process.env.FORYOU_DROPBOX_CATALOG_ENABLED || "1",
  intervalMs: process.env.FORYOU_DROPBOX_CATALOG_INTERVAL_MS || 600000,
  logger(event, meta) {
    if (!process.env.FORYOU_DROPBOX_CATALOG_VERBOSE) return;
    console.log(`[dropbox-catalog] ${event}`, JSON.stringify(meta));
  },
});

const result = sync.syncNow();
sync.stop();

const summary = {
  ok: result.ok,
  enabled: result.enabled,
  rootDir: result.rootDir,
  imported: result.imported || 0,
  exportedRecordsChanged: result.exportedRecordsChanged || 0,
  runRows: result.runs && result.runs.runRows ? result.runs.runRows : 0,
  chatlogSessions: result.chatlogs && result.chatlogs.sessions ? result.chatlogs.sessions : 0,
  lastSyncAt: result.lastSyncAt || "",
  error: result.error || "",
};

console.log(JSON.stringify(summary, null, 2));
process.exit(result.ok ? 0 : 1);
