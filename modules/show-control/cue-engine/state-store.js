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
  saveCue,
  showControlDbDir,
};
