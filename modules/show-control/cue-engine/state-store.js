"use strict";

const fs = require("node:fs/promises");
const path = require("node:path");
const { compactCueForStorage } = require("./compact-results");

const V2_ROOT = path.resolve(__dirname, "../../..");
const DEFAULT_SHOW_CONTROL_DB_DIR = path.join(V2_ROOT, "modules", "show-control", "db");
const PAYLOAD_INDEX_SCHEMA_VERSION = "show-control.payload-index.v0";
const writeQueues = new Map();
const cueFileCaches = new Map();

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function showControlDbDir() {
  return path.resolve(process.env.V2_SHOW_CONTROL_DB_DIR || DEFAULT_SHOW_CONTROL_DB_DIR);
}

function assertPathUnderV2(targetPath) {
  const resolved = path.resolve(targetPath);
  const relative = path.relative(V2_ROOT, resolved);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`show_control_path_outside_v2:${resolved}`);
  }
  return resolved;
}

function cuesFilePath() {
  return assertPathUnderV2(path.join(showControlDbDir(), "cues.json"));
}

function triggerBindingsFilePath() {
  return assertPathUnderV2(path.join(showControlDbDir(), "trigger-bindings.json"));
}

function payloadIndexFilePath() {
  return assertPathUnderV2(path.join(showControlDbDir(), "payload-index.json"));
}

function payloadStoreDir() {
  return assertPathUnderV2(path.join(showControlDbDir(), "payloads"));
}

function payloadFileName(payloadId) {
  return `${Buffer.from(String(payloadId || ""), "utf8").toString("base64url")}.json`;
}

function payloadFilePath(payloadId) {
  return assertPathUnderV2(path.join(payloadStoreDir(), payloadFileName(payloadId)));
}

async function readJsonArray(filePath) {
  try {
    const text = await fs.readFile(filePath, "utf8");
    const parsed = JSON.parse(text);
    return Array.isArray(parsed) ? parsed : [];
  } catch (err) {
    if (err && err.code === "ENOENT") return [];
    throw err;
  }
}

async function fileMtimeMs(filePath) {
  try {
    const stats = await fs.stat(filePath);
    return stats.mtimeMs;
  } catch (err) {
    if (err && err.code === "ENOENT") return null;
    throw err;
  }
}

async function readCueArrayCached(filePath = cuesFilePath()) {
  const mtimeMs = await fileMtimeMs(filePath);
  const cached = cueFileCaches.get(filePath);
  if (cached && cached.mtimeMs === mtimeMs) return cached.items;
  const items = await readJsonArray(filePath);
  cueFileCaches.set(filePath, { mtimeMs: await fileMtimeMs(filePath), items });
  return items;
}

async function readJsonObject(filePath, fallback = {}) {
  try {
    const text = await fs.readFile(filePath, "utf8");
    const parsed = JSON.parse(text);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : fallback;
  } catch (err) {
    if (err && err.code === "ENOENT") return fallback;
    throw err;
  }
}

async function withFileQueue(filePath, work) {
  const previous = writeQueues.get(filePath) || Promise.resolve();
  let release = null;
  const current = new Promise((resolve) => {
    release = resolve;
  });
  const currentQueue = previous.then(() => current, () => current);
  writeQueues.set(filePath, currentQueue);
  await previous.catch(() => undefined);
  try {
    return await work();
  } finally {
    release();
    if (writeQueues.get(filePath) === currentQueue) writeQueues.delete(filePath);
  }
}

async function writeJsonArray(filePath, items) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(tempPath, `${JSON.stringify(items, null, 2)}\n`, "utf8");
  await fs.rename(tempPath, filePath);
}

async function writeCueArrayCached(filePath, items) {
  await writeJsonArray(filePath, items);
  cueFileCaches.set(filePath, {
    mtimeMs: await fileMtimeMs(filePath),
    items: cloneJson(items),
  });
}

async function writeJsonObject(filePath, item) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(tempPath, `${JSON.stringify(item, null, 2)}\n`, "utf8");
  await fs.rename(tempPath, filePath);
}

function payloadIndexEntriesForCue(cue = {}, indexedAt = new Date().toISOString()) {
  const entries = {};
  for (const action of cue.actions || []) {
    if (!action.payloadId) continue;
    entries[String(action.payloadId)] = {
      payloadId: String(action.payloadId),
      cueId: cue.cueId || null,
      actionId: action.actionId || null,
      command: action.command || "",
      targetId: action.targetId || null,
      payloadFile: payloadFileName(action.payloadId),
      indexedAt,
    };
  }
  return entries;
}

async function writePayloadFile(payloadId, payload = {}) {
  await writeJsonObject(payloadFilePath(payloadId), payload || {});
}

async function payloadIndexFromCues(cues = [], indexedAt = new Date().toISOString()) {
  await fs.rm(payloadStoreDir(), { recursive: true, force: true });
  await fs.mkdir(payloadStoreDir(), { recursive: true });
  const entries = {};
  for (const cue of cues) {
    for (const action of cue.actions || []) {
      if (!action.payloadId) continue;
      await writePayloadFile(action.payloadId, action.payload || {});
    }
    Object.assign(entries, payloadIndexEntriesForCue(cue, indexedAt));
  }
  return {
    schemaVersion: PAYLOAD_INDEX_SCHEMA_VERSION,
    updatedAt: indexedAt,
    count: Object.keys(entries).length,
    entries,
  };
}

async function updatePayloadIndexForCue(cue) {
  const filePath = payloadIndexFilePath();
  return withFileQueue(filePath, async () => {
    const now = new Date().toISOString();
    const index = await readJsonObject(filePath, {
      schemaVersion: PAYLOAD_INDEX_SCHEMA_VERSION,
      updatedAt: now,
      count: 0,
      entries: {},
    });
    index.schemaVersion = PAYLOAD_INDEX_SCHEMA_VERSION;
    index.entries = index.entries && typeof index.entries === "object" && !Array.isArray(index.entries) ? index.entries : {};
    for (const [payloadId, entry] of Object.entries(index.entries)) {
      if (entry && entry.cueId === cue.cueId) {
        await fs.rm(payloadFilePath(payloadId), { force: true });
        delete index.entries[payloadId];
      }
    }
    for (const action of cue.actions || []) {
      if (!action.payloadId) continue;
      await writePayloadFile(action.payloadId, action.payload || {});
    }
    Object.assign(index.entries, payloadIndexEntriesForCue(cue, now));
    index.count = Object.keys(index.entries).length;
    index.updatedAt = now;
    await writeJsonObject(filePath, index);
    return index;
  });
}

async function rebuildPayloadIndex() {
  const cues = await readCueArrayCached(cuesFilePath());
  const index = await payloadIndexFromCues(cues);
  await writeJsonObject(payloadIndexFilePath(), index);
  return index;
}

async function readIndexedPayload(payloadId) {
  const index = await readJsonObject(payloadIndexFilePath(), null);
  const entry = index && index.entries ? index.entries[String(payloadId || "")] : null;
  if (!entry) return null;
  if (entry.payload) return entry.payload;
  try {
    const text = await fs.readFile(payloadFilePath(payloadId), "utf8");
    return JSON.parse(text);
  } catch (err) {
    if (err && err.code === "ENOENT") return null;
    throw err;
  }
}

async function saveCue(cue) {
  const filePath = cuesFilePath();
  const compactCue = compactCueForStorage(cue);
  if (cue && typeof cue === "object" && compactCue && compactCue !== cue) {
    for (const key of Object.keys(cue)) delete cue[key];
    Object.assign(cue, compactCue);
  }
  return withFileQueue(filePath, async () => {
    const cues = cloneJson(await readCueArrayCached(filePath));
    const index = cues.findIndex((item) => item.cueId === cue.cueId);
    if (index >= 0) cues[index] = cue;
    else cues.push(cue);
    await writeCueArrayCached(filePath, cues);
    await updatePayloadIndexForCue(cue);
    return cue;
  });
}

function triggerBindingId(source, triggerId) {
  return `${String(source || "manual").trim().toLowerCase()}:${String(triggerId || "").trim().toLowerCase()}`;
}

async function readTriggerBindings(filter = {}) {
  const bindings = await readJsonArray(triggerBindingsFilePath());
  return bindings.filter((binding) => {
    if (filter.source && binding.source !== filter.source) return false;
    if (filter.cueId && binding.cueId !== filter.cueId) return false;
    return true;
  });
}

async function saveTriggerBinding(binding) {
  const now = new Date().toISOString();
  const source = String(binding.source || "streamdeck").trim().toLowerCase();
  const triggerId = String(binding.triggerId || binding.button || "").trim();
  if (!triggerId) throw new Error("show_control_missing_trigger_id");
  if (!binding.cueId) throw new Error("show_control_missing_trigger_cue_id");
  const item = {
    bindingId: binding.bindingId || triggerBindingId(source, triggerId),
    source,
    triggerId,
    cueId: String(binding.cueId),
    label: binding.label || "",
    page: binding.page || "",
    color: binding.color || "",
    mode: binding.mode || "execute-cue",
    createdAt: binding.createdAt || now,
    updatedAt: now,
  };
  const filePath = triggerBindingsFilePath();
  return withFileQueue(filePath, async () => {
    const bindings = await readJsonArray(filePath);
    const index = bindings.findIndex((entry) => entry.bindingId === item.bindingId);
    if (index >= 0) bindings[index] = item;
    else bindings.push(item);
    await writeJsonArray(filePath, bindings);
    return item;
  });
}

async function readTriggerBinding(source, triggerId) {
  const bindingId = triggerBindingId(source, triggerId);
  const bindings = await readJsonArray(triggerBindingsFilePath());
  const binding = bindings.find((entry) => entry.bindingId === bindingId);
  if (!binding) throw new Error(`show_control_trigger_binding_not_found:${bindingId}`);
  return binding;
}

async function readCues(filter = {}) {
  const cues = await readCueArrayCached(cuesFilePath());
  return cues.filter((cue) => {
    const archived = !!cue.archivedAt;
    if (filter.archived === "only" && !archived) return false;
    if (filter.archived !== "only" && !filter.includeArchived && archived) return false;
    if (filter.cueType && cue.cueType !== filter.cueType) return false;
    if (filter.showRunId && (!cue.runtimeRef || cue.runtimeRef.showRunId !== filter.showRunId)) return false;
    return true;
  }).map(cloneJson);
}

async function archiveCue(cueId, options = {}) {
  const filePath = cuesFilePath();
  return withFileQueue(filePath, async () => {
    const cues = cloneJson(await readCueArrayCached(filePath));
    const cue = cues.find((item) => item.cueId === cueId);
    if (!cue) throw new Error(`show_control_cue_not_found:${cueId}`);
    const now = new Date().toISOString();
    cue.archivedAt = cue.archivedAt || now;
    cue.archivedReason = options.reason || cue.archivedReason || "manual_archive";
    cue.archivedBy = options.archivedBy || cue.archivedBy || "show-control";
    await writeCueArrayCached(filePath, cues);
    return cloneJson(cue);
  });
}

async function readCue(cueId) {
  const cues = await readCueArrayCached(cuesFilePath());
  const cue = cues.find((item) => item.cueId === cueId);
  if (!cue) throw new Error(`show_control_cue_not_found:${cueId}`);
  return cloneJson(cue);
}

function findCuePayload(cue, payloadId) {
  for (const action of cue.actions || []) {
    if (action.payloadId === payloadId) return action.payload;
  }
  throw new Error(`show_control_payload_not_found:${payloadId}`);
}

module.exports = {
  V2_ROOT,
  assertPathUnderV2,
  archiveCue,
  cuesFilePath,
  findCuePayload,
  payloadFilePath,
  payloadIndexFilePath,
  payloadStoreDir,
  readCue,
  readCues,
  readIndexedPayload,
  readTriggerBinding,
  readTriggerBindings,
  rebuildPayloadIndex,
  saveCue,
  saveTriggerBinding,
  showControlDbDir,
  triggerBindingsFilePath,
};
