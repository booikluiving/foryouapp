"use strict";

const path = require("node:path");
const { hashJson } = require("../../../shared/sync/content-hash");

// What the team edits and what travels between the website and the show Mac: the
// catalog itself and the image catalog (media records, compositions, lighting presets).
// The media files travel separately, by relative path and SHA-256 (see mediaFilesFor).
const CONTENT_COLLECTIONS = Object.freeze([
  "performers", "characters", "environments", "labels", "situations",
  "mediaAssets", "environmentCompositions", "lightingPresets",
]);
const LOCAL_COLLECTIONS = Object.freeze([]);

// Absolute paths differ per machine; the relative paths are what counts.
const MACHINE_FIELDS = Object.freeze(["filePath", "backupFilePath"]);

function withoutMachineFields(asset) {
  if (!asset || typeof asset !== "object") return asset;
  const copy = { ...asset };
  for (const field of MACHINE_FIELDS) delete copy[field];
  return copy;
}

function catalogContent(store) {
  const content = { schemaVersion: store.schemaVersion, nextCounters: { ...(store.nextCounters || {}) } };
  for (const key of CONTENT_COLLECTIONS) content[key] = JSON.parse(JSON.stringify(store[key] || []));
  content.mediaAssets = content.mediaAssets.map(withoutMachineFields);
  return content;
}

// Counters are left out: numbers are never reused anyway (the next number is also
// derived from the highest existing one), and taking the highest counter on both
// sides must not count as a change.
function catalogContentHash(content) {
  const hashed = { schemaVersion: content.schemaVersion };
  for (const key of CONTENT_COLLECTIONS) hashed[key] = content[key] || [];
  hashed.mediaAssets = hashed.mediaAssets.map(withoutMachineFields);
  return hashJson(hashed);
}

function safeRelativePath(value) {
  const text = String(value || "");
  if (!text || path.isAbsolute(text) || text.includes("\\") || text.includes("\0")) return false;
  const normalized = path.posix.normalize(text);
  return normalized === text && !normalized.startsWith("../") && normalized !== "..";
}

// The files a catalog needs: every media record that is still in use. Deleted records
// have no file any more and replaced ones live on as backups on the machine itself.
function mediaFilesFor(content) {
  const files = new Map();
  for (const asset of (content && content.mediaAssets) || []) {
    if (!asset || asset.status === "deleted" || asset.status === "replaced") continue;
    if (!safeRelativePath(asset.relativePath)) continue;
    files.set(asset.relativePath, { sizeBytes: Number(asset.sizeBytes) || null, assetId: asset.id });
  }
  return files;
}

function contentIssues(content, expectedSchemaVersion) {
  const issues = [];
  if (!content || typeof content !== "object" || Array.isArray(content)) return [{ code: "content_missing" }];
  if (expectedSchemaVersion && content.schemaVersion !== expectedSchemaVersion) {
    issues.push({ code: "schema_version_mismatch", expected: expectedSchemaVersion, actual: content.schemaVersion || null });
  }
  for (const key of CONTENT_COLLECTIONS) {
    if (!Array.isArray(content[key])) {
      issues.push({ code: "collection_missing", collection: key });
      continue;
    }
    const seen = new Set();
    for (const item of content[key]) {
      const id = item && typeof item === "object" ? String(item.id || item.environmentId || "") : "";
      if (!id) issues.push({ code: "record_without_id", collection: key });
      else if (seen.has(id)) issues.push({ code: "duplicate_id", collection: key, id });
      seen.add(id);
    }
  }
  for (const asset of Array.isArray(content.mediaAssets) ? content.mediaAssets : []) {
    for (const field of ["relativePath", "backupRelativePath"]) {
      if (asset && asset[field] && !safeRelativePath(asset[field])) {
        issues.push({ code: "media_path_unsafe", id: asset.id || null, field });
      }
    }
  }
  return issues;
}

function maxCounters(left = {}, right = {}) {
  const merged = { ...left };
  for (const [key, value] of Object.entries(right || {})) {
    merged[key] = Math.max(Number(merged[key]) || 1, Number(value) || 1);
  }
  return merged;
}

function withCatalogContent(store, content, { mediaRoot } = {}) {
  const next = { ...store, nextCounters: maxCounters(store.nextCounters, content.nextCounters) };
  for (const key of CONTENT_COLLECTIONS) next[key] = JSON.parse(JSON.stringify(content[key]));
  // Give the records this machine's absolute paths again, as an upload here would.
  next.mediaAssets = next.mediaAssets.map((asset) => {
    const local = withoutMachineFields(asset);
    if (mediaRoot && local.relativePath) local.filePath = path.join(mediaRoot, local.relativePath);
    if (mediaRoot && local.backupRelativePath) local.backupFilePath = path.join(mediaRoot, local.backupRelativePath);
    return local;
  });
  return next;
}

module.exports = {
  CONTENT_COLLECTIONS,
  LOCAL_COLLECTIONS,
  catalogContent,
  catalogContentHash,
  contentIssues,
  mediaFilesFor,
  safeRelativePath,
  withCatalogContent,
};
