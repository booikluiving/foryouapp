"use strict";

const fs = require("node:fs/promises");
const path = require("node:path");

const V2_ROOT = path.resolve(__dirname, "../../..");
const DEFAULT_SHOW_CONTROL_DB_DIR = path.join(V2_ROOT, "modules", "show-control", "db");

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

async function writeJsonArray(filePath, items) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(items, null, 2)}\n`, "utf8");
}

async function saveCue(cue) {
  const filePath = cuesFilePath();
  const cues = await readJsonArray(filePath);
  const index = cues.findIndex((item) => item.cueId === cue.cueId);
  if (index >= 0) cues[index] = cue;
  else cues.push(cue);
  await writeJsonArray(filePath, cues);
  return cue;
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
  const bindings = await readJsonArray(filePath);
  const index = bindings.findIndex((entry) => entry.bindingId === item.bindingId);
  if (index >= 0) bindings[index] = item;
  else bindings.push(item);
  await writeJsonArray(filePath, bindings);
  return item;
}

async function readTriggerBinding(source, triggerId) {
  const bindingId = triggerBindingId(source, triggerId);
  const bindings = await readJsonArray(triggerBindingsFilePath());
  const binding = bindings.find((entry) => entry.bindingId === bindingId);
  if (!binding) throw new Error(`show_control_trigger_binding_not_found:${bindingId}`);
  return binding;
}

async function readCues(filter = {}) {
  const cues = await readJsonArray(cuesFilePath());
  return cues.filter((cue) => {
    if (filter.cueType && cue.cueType !== filter.cueType) return false;
    if (filter.showRunId && (!cue.runtimeRef || cue.runtimeRef.showRunId !== filter.showRunId)) return false;
    return true;
  });
}

async function readCue(cueId) {
  const cues = await readJsonArray(cuesFilePath());
  const cue = cues.find((item) => item.cueId === cueId);
  if (!cue) throw new Error(`show_control_cue_not_found:${cueId}`);
  return cue;
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
  cuesFilePath,
  findCuePayload,
  readCue,
  readCues,
  readTriggerBinding,
  readTriggerBindings,
  saveCue,
  saveTriggerBinding,
  showControlDbDir,
  triggerBindingsFilePath,
};
