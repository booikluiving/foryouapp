"use strict";

const fs = require("node:fs/promises");
const fsSync = require("node:fs");
const path = require("node:path");
const { compactCueForStorage } = require("./compact-results");

const V2_ROOT = path.resolve(__dirname, "../../..");
const DEFAULT_SHOW_CONTROL_DB_DIR = path.join(V2_ROOT, "modules", "show-control", "db");
const PAYLOAD_INDEX_SCHEMA_VERSION = "show-control.payload-index.v0";
const writeQueues = new Map();
const cueFileCaches = new Map();
// cues.json wordt niet meer bij elke cue/ack volledig herschreven: wijzigingen gaan eerst
// in het geheugen en worden kort daarna in één keer (compact) weggeschreven.
const pendingCueFlushes = new Map();
const CUE_FLUSH_DELAY_MS = Number(process.env.V2_SHOW_CONTROL_CUE_FLUSH_MS || 150);
const DEFAULT_MAX_ACTIVE_CUES = 200;

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

function cueArchiveDir() {
  return assertPathUnderV2(path.join(showControlDbDir(), "cue-archief"));
}

function maxActiveCues() {
  const value = Number(process.env.V2_SHOW_CONTROL_MAX_CUES || DEFAULT_MAX_ACTIVE_CUES);
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : DEFAULT_MAX_ACTIVE_CUES;
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
  const cached = cueFileCaches.get(filePath);
  // Nog niet weggeschreven wijzigingen: het geheugen is nieuwer dan het bestand.
  if (cached && pendingCueFlushes.has(filePath)) return cached.items;
  const mtimeMs = await fileMtimeMs(filePath);
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

async function writeCueArrayCompact(filePath, items) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(tempPath, `${JSON.stringify(items)}\n`, "utf8");
  await fs.rename(tempPath, filePath);
}

async function readBoundCueIds() {
  try {
    const bindings = await readJsonArray(triggerBindingsFilePath());
    return new Set(bindings.map((binding) => binding && binding.cueId).filter(Boolean));
  } catch (_err) {
    return new Set();
  }
}

// Houdt cues.json klein: de oudste cues boven het maximum gaan naar
// db/cue-archief/cues-JJJJ-MM-DD.jsonl (één cue per regel). Cues waar een
// trigger-binding naar wijst, blijven staan.
async function pruneCueArray(items) {
  const max = maxActiveCues();
  if (items.length <= max) return [];
  const bound = await readBoundCueIds();
  let excess = items.length - max;
  const keep = [];
  const pruned = [];
  for (const cue of items) {
    if (excess > 0 && !(cue && bound.has(cue.cueId))) {
      pruned.push(cue);
      excess -= 1;
    } else {
      keep.push(cue);
    }
  }
  if (!pruned.length) return [];
  const day = new Date().toISOString().slice(0, 10);
  const archivePath = path.join(cueArchiveDir(), `cues-${day}.jsonl`);
  await fs.mkdir(path.dirname(archivePath), { recursive: true });
  await fs.appendFile(archivePath, pruned.map((cue) => JSON.stringify(cue)).join("\n") + "\n", "utf8");
  items.splice(0, items.length, ...keep);
  return pruned;
}

async function flushCueFile(filePath) {
  const pending = pendingCueFlushes.get(filePath);
  if (pending && pending.timer) clearTimeout(pending.timer);
  return withFileQueue(filePath, async () => {
    if (!pendingCueFlushes.has(filePath)) return;
    pendingCueFlushes.delete(filePath);
    const cached = cueFileCaches.get(filePath);
    if (!cached) return;
    const pruned = await pruneCueArray(cached.items);
    await writeCueArrayCompact(filePath, cached.items);
    cached.mtimeMs = await fileMtimeMs(filePath);
    if (pruned.length) await prunePayloadIndex(cached.items);
  });
}

function scheduleCueFlush(filePath) {
  if (pendingCueFlushes.has(filePath)) return;
  const entry = { timer: null };
  pendingCueFlushes.set(filePath, entry);
  entry.timer = setTimeout(() => {
    flushCueFile(filePath).catch((err) => {
      process.stderr.write(`Show Control cue flush failed: ${err && err.message ? err.message : err}\n`);
    });
  }, CUE_FLUSH_DELAY_MS);
  if (entry.timer.unref) entry.timer.unref();
}

async function flushCueStore() {
  await Promise.all([...pendingCueFlushes.keys()].map((filePath) => flushCueFile(filePath)));
}

function flushCueStoreSync() {
  for (const filePath of [...pendingCueFlushes.keys()]) {
    const pending = pendingCueFlushes.get(filePath);
    if (pending && pending.timer) clearTimeout(pending.timer);
    pendingCueFlushes.delete(filePath);
    const cached = cueFileCaches.get(filePath);
    if (!cached) continue;
    try {
      fsSync.mkdirSync(path.dirname(filePath), { recursive: true });
      const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
      fsSync.writeFileSync(tempPath, `${JSON.stringify(cached.items)}\n`, "utf8");
      fsSync.renameSync(tempPath, filePath);
    } catch (err) {
      process.stderr.write(`Show Control cue flush (exit) failed: ${err && err.message ? err.message : err}\n`);
    }
  }
}

let exitFlushInstalled = false;
function installExitFlush() {
  if (exitFlushInstalled) return;
  exitFlushInstalled = true;
  for (const signal of ["SIGTERM", "SIGINT"]) {
    process.once(signal, () => {
      flushCueStoreSync();
      process.exit(0);
    });
  }
}

// Wijzigt de cue-lijst in het geheugen en plant één schrijfactie in.
function markCueArrayChanged(filePath, items, mtimeMs) {
  const cached = cueFileCaches.get(filePath);
  if (!cached || cached.items !== items) cueFileCaches.set(filePath, { mtimeMs, items });
  installExitFlush();
  scheduleCueFlush(filePath);
}

async function writeJsonObject(filePath, item) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(tempPath, `${JSON.stringify(item)}\n`, "utf8");
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

// Haalt payloads van cues die niet meer in cues.json staan uit de index (de cue zelf,
// met payload, staat in het cue-archief).
async function prunePayloadIndex(activeCues) {
  const filePath = payloadIndexFilePath();
  return withFileQueue(filePath, async () => {
    const index = await readJsonObject(filePath, null);
    if (!index || !index.entries || typeof index.entries !== "object") return 0;
    const active = new Set(activeCues.map((cue) => cue && cue.cueId).filter(Boolean));
    const removed = [];
    for (const [payloadId, entry] of Object.entries(index.entries)) {
      if (!entry || !active.has(entry.cueId)) {
        removed.push(payloadId);
        delete index.entries[payloadId];
      }
    }
    if (!removed.length) return 0;
    index.count = Object.keys(index.entries).length;
    index.updatedAt = new Date().toISOString();
    await writeJsonObject(filePath, index);
    for (let i = 0; i < removed.length; i += 100) {
      await Promise.all(removed.slice(i, i + 100).map((payloadId) => fs.rm(payloadFilePath(payloadId), { force: true })));
    }
    return removed.length;
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
    const cues = await readCueArrayCached(filePath);
    const cached = cueFileCaches.get(filePath);
    const stored = cloneJson(cue);
    const index = cues.findIndex((item) => item.cueId === cue.cueId);
    if (index >= 0) cues[index] = stored;
    else cues.push(stored);
    markCueArrayChanged(filePath, cues, cached ? cached.mtimeMs : null);
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
    const cues = await readCueArrayCached(filePath);
    const cached = cueFileCaches.get(filePath);
    const index = cues.findIndex((item) => item.cueId === cueId);
    if (index < 0) throw new Error(`show_control_cue_not_found:${cueId}`);
    const cue = cloneJson(cues[index]);
    const now = new Date().toISOString();
    cue.archivedAt = cue.archivedAt || now;
    cue.archivedReason = options.reason || cue.archivedReason || "manual_archive";
    cue.archivedBy = options.archivedBy || cue.archivedBy || "show-control";
    cues[index] = cue;
    markCueArrayChanged(filePath, cues, cached ? cached.mtimeMs : null);
    return cloneJson(cue);
  });
}

// Voor /status: tellingen, waarschuwingen en de laatste cue zonder alle cues te kopiëren.
async function readCueSummary() {
  const cues = await readCueArrayCached(cuesFilePath());
  let count = 0;
  let archivedCount = 0;
  let latestCue = null;
  const warnings = [];
  for (const cue of cues) {
    if (cue.archivedAt) {
      archivedCount += 1;
      continue;
    }
    count += 1;
    latestCue = cue;
    if (cue.status && Array.isArray(cue.status.warnings)) warnings.push(...cue.status.warnings);
  }
  return {
    count,
    archivedCount,
    warnings: cloneJson(warnings),
    latestCue: latestCue ? cloneJson(latestCue) : null,
  };
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
  flushCueStore,
  payloadFilePath,
  payloadIndexFilePath,
  payloadStoreDir,
  readCue,
  readCueSummary,
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
