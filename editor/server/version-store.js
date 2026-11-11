"use strict";

const fs = require("node:fs");
const path = require("node:path");

const { CONTENT_COLLECTIONS } = require("../../modules/catalog/write-model/catalog-content");

// Every saved state of the show content is kept as a numbered, complete version.
// Nothing is ever overwritten: a restore or a show-Mac upload is a new version.

function writeFileAtomic(filePath, text) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const temp = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  const fd = fs.openSync(temp, "w");
  try {
    fs.writeFileSync(fd, text);
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  fs.renameSync(temp, filePath);
  try {
    const dirFd = fs.openSync(path.dirname(filePath), "r");
    try { fs.fsyncSync(dirFd); } finally { fs.closeSync(dirFd); }
  } catch (_err) {
    // Not every file system lets a directory be synced.
  }
}

function versionFileName(nr) {
  return `v${String(nr).padStart(6, "0")}.json`;
}

function recordLabel(collection, item, environmentNames = new Map()) {
  if (!item) return "";
  if (collection === "situations") return item.title || item.id;
  if (collection === "paths") return item.name || `pad ${item.id}`;
  if (collection === "crossingThresholds") return `kruising bij situatie ${item.sceneId}`;
  if (collection === "mediaAssets") {
    const where = item.environmentName || environmentNames.get(item.environmentId) || item.environmentId;
    return `${item.originalFilename || item.filename || item.id}${where ? ` (${where})` : ""}`;
  }
  if (collection === "environmentCompositions") return environmentNames.get(item.environmentId) || item.environmentId;
  return item.name || item.title || item.id;
}

// A composition has the id of its environment, so it needs a key of its own.
function recordKey(collection, item) {
  if (collection === "environmentCompositions") return `composition:${item.environmentId || item.id}`;
  if (collection === "lightingPresets") return `lighting:${item.id}`;
  return String(item.id);
}

function recordKeys(version) {
  const keys = new Map();
  const environmentNames = new Map(((version.catalog && version.catalog.environments) || []).map((item) => [item.id, item.name]));
  for (const collection of CONTENT_COLLECTIONS) {
    for (const item of (version.catalog && version.catalog[collection]) || []) {
      keys.set(recordKey(collection, item), { collection, item, label: recordLabel(collection, item, environmentNames) });
    }
  }
  for (const item of (version.paths && version.paths.paths) || []) keys.set(`path:${item.id}`, { collection: "paths", item });
  for (const item of (version.paths && version.paths.crossingThresholds) || []) {
    keys.set(`crossing:${item.sceneId}`, { collection: "crossingThresholds", item });
  }
  return keys;
}

function diffVersions(previous, next) {
  const before = previous ? recordKeys(previous) : new Map();
  const after = recordKeys(next);
  const changes = [];
  for (const [key, { collection, item, label }] of after) {
    const old = before.get(key);
    if (!old) changes.push({ key, collection, kind: "nieuw", label: label || recordLabel(collection, item) });
    else if (JSON.stringify(old.item) !== JSON.stringify(item)) {
      changes.push({ key, collection, kind: "gewijzigd", label: label || recordLabel(collection, item) });
    }
  }
  for (const [key, { collection, item, label }] of before) {
    if (!after.has(key)) changes.push({ key, collection, kind: "weg", label: label || recordLabel(collection, item) });
  }
  return changes;
}

function createVersionStore(dataDir) {
  const versionsDir = path.join(dataDir, "versies");
  const statePath = path.join(dataDir, "staat.json");
  fs.mkdirSync(versionsDir, { recursive: true });

  function readState() {
    try {
      return JSON.parse(fs.readFileSync(statePath, "utf8"));
    } catch (err) {
      if (err.code !== "ENOENT") throw err;
      return { head: 0, released: 0, showMac: null, conflict: null };
    }
  }

  function writeState(state) {
    writeFileAtomic(statePath, `${JSON.stringify(state, null, 2)}\n`);
    return state;
  }

  function updateState(change) {
    const state = readState();
    const next = { ...state, ...change(state) };
    return writeState(next);
  }

  function read(nr) {
    const text = fs.readFileSync(path.join(versionsDir, versionFileName(nr)), "utf8");
    return JSON.parse(text);
  }

  function summary(version) {
    if (!version) return null;
    const { catalog, paths, ...rest } = version;
    return rest;
  }

  function list({ limit = 100 } = {}) {
    const files = fs.readdirSync(versionsDir).filter((name) => /^v\d{6}\.json$/.test(name)).sort().reverse();
    return files.slice(0, limit).map((name) => summary(read(Number(name.slice(1, 7)))));
  }

  function head() {
    const state = readState();
    return state.head ? read(state.head) : null;
  }

  // Changes since version `basis` made by someone other than `author`, per record key.
  function changedSince(basis, author) {
    const state = readState();
    const changed = new Map();
    for (let nr = Number(basis) + 1; nr <= state.head; nr += 1) {
      const version = summary(read(nr));
      if (version.author === author) continue;
      for (const change of version.changes || []) changed.set(change.key, version);
    }
    return changed;
  }

  function add({ catalog, paths, hashes, author, reason, validation, kind = "bewerking", extra = {} }) {
    const state = readState();
    const previous = state.head ? read(state.head) : null;
    const nr = state.head + 1;
    const version = {
      nr,
      at: new Date().toISOString(),
      author,
      reason,
      kind,
      parent: previous ? previous.nr : null,
      hashes,
      validation,
      changes: diffVersions(previous, { catalog, paths }),
      ...extra,
      catalog,
      paths,
    };
    writeFileAtomic(path.join(versionsDir, versionFileName(nr)), JSON.stringify(version));
    writeState({ ...state, head: nr });
    return version;
  }

  return {
    add,
    changedSince,
    dataDir,
    head,
    list,
    read,
    readState,
    summary,
    updateState,
    writeFileAtomic,
  };
}

module.exports = {
  createVersionStore,
  diffVersions,
  writeFileAtomic,
};
