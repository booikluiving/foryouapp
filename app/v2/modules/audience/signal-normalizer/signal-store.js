"use strict";

const fs = require("node:fs/promises");
const path = require("node:path");

const V2_ROOT = path.resolve(__dirname, "../../..");
const DEFAULT_AUDIENCE_DB_DIR = path.join(V2_ROOT, "modules", "audience", "db");

function audienceDbDir() {
  return path.resolve(process.env.V2_AUDIENCE_DB_DIR || DEFAULT_AUDIENCE_DB_DIR);
}

function assertPathUnderV2(targetPath) {
  const resolved = path.resolve(targetPath);
  const relative = path.relative(V2_ROOT, resolved);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`audience_path_outside_v2:${resolved}`);
  }
  return resolved;
}

function signalsFilePath() {
  return assertPathUnderV2(path.join(audienceDbDir(), "signals.json"));
}

function sessionsFilePath() {
  return assertPathUnderV2(path.join(audienceDbDir(), "sessions.json"));
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

async function appendAudienceSignal(signal) {
  const filePath = signalsFilePath();
  const signals = await readJsonArray(filePath);
  signals.push(signal);
  await writeJsonArray(filePath, signals);
  return signal;
}

async function readAudienceSignals(filter = {}) {
  const signals = await readJsonArray(signalsFilePath());
  return signals.filter((signal) => {
    if (filter.showRunId && (!signal.link || signal.link.showRunId !== filter.showRunId)) return false;
    if (filter.situationRunId && (!signal.link || signal.link.situationRunId !== filter.situationRunId)) return false;
    if (filter.linkStatus && (!signal.link || signal.link.status !== filter.linkStatus)) return false;
    return true;
  });
}

async function appendAudienceSession(session) {
  const filePath = sessionsFilePath();
  const sessions = await readJsonArray(filePath);
  sessions.push(session);
  await writeJsonArray(filePath, sessions);
  return session;
}

async function readAudienceSessions() {
  return readJsonArray(sessionsFilePath());
}

module.exports = {
  V2_ROOT,
  appendAudienceSession,
  appendAudienceSignal,
  assertPathUnderV2,
  audienceDbDir,
  readAudienceSessions,
  readAudienceSignals,
  sessionsFilePath,
  signalsFilePath,
};
