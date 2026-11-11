"use strict";

// De stand van de sync met de website, zoals de sync-agent hem op deze machine bijhoudt
// (sync-agent/data). Alleen lezen; draait de agent niet, dan is er geen stand.

const fs = require("node:fs");
const path = require("node:path");

const DEFAULT_DATA_DIR = path.resolve(__dirname, "../../..", "sync-agent", "data");
const STALE_MS = 2 * 60 * 1000;

function readJson(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (_err) {
    return null;
  }
}

function readSyncStatus(options = {}) {
  const dataDir = options.dataDir || process.env.SCRIPT_AGENT_SYNC_DATA_DIR || DEFAULT_DATA_DIR;
  const now = options.now || Date.now();
  const status = readJson(path.join(dataDir, "status.json"));
  const state = readJson(path.join(dataDir, "staat.json"));
  if (!status) return { available: false };
  const reportedAt = status.at || null;
  return {
    available: true,
    state: status.state || "",
    message: status.message || "",
    appliedVersion: status.appliedVersion || (state && state.appliedVersion) || null,
    appliedAt: (state && state.appliedAt) || null,
    reportedAt,
    stale: !reportedAt || now - Date.parse(reportedAt) > STALE_MS,
  };
}

module.exports = { readSyncStatus };
