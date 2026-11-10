"use strict";

const fs = require("node:fs/promises");
const path = require("node:path");

const APP_ROOT = path.resolve(__dirname, "../../..");
const DEFAULT_ALGORITHM_DB_DIR = path.join(APP_ROOT, "modules", "algorithm", "db");

function algorithmDbDir() {
  return path.resolve(process.env.ALGORITHM_DB_DIR || DEFAULT_ALGORITHM_DB_DIR);
}

function assertPathUnderApp(targetPath) {
  const resolved = path.resolve(targetPath);
  const relative = path.relative(APP_ROOT, resolved);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`algorithm_path_outside_app:${resolved}`);
  }
  return resolved;
}

function runsDir() {
  return assertPathUnderApp(path.join(algorithmDbDir(), "runs"));
}

function scoringContextsDir() {
  return assertPathUnderApp(path.join(algorithmDbDir(), "scoring-contexts"));
}

function configDir() {
  return assertPathUnderApp(path.join(algorithmDbDir(), "config"));
}

function assertShowRunId(showRunId) {
  if (!/^show-run-\d{8}-\d{9}Z$/.test(String(showRunId || ""))) {
    throw new Error(`invalid_algorithm_show_run_id:${showRunId}`);
  }
  return String(showRunId);
}

function legacyRunFilePath(showRunId) {
  return assertPathUnderApp(path.join(runsDir(), `${assertShowRunId(showRunId)}.json`));
}

function scoringContextFilePath(showRunId) {
  return assertPathUnderApp(path.join(scoringContextsDir(), `${assertShowRunId(showRunId)}.json`));
}

function configFilePath() {
  return assertPathUnderApp(path.join(configDir(), "algorithm-config.json"));
}

async function fileExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch (_err) {
    return false;
  }
}

async function saveScoringContextState(state) {
  const filePath = scoringContextFilePath(state.showRunId);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(state, null, 2)}\n`, "utf8");
  return { filePath };
}

async function readScoringContextState(showRunId) {
  const safeShowRunId = assertShowRunId(showRunId);
  const primaryPath = scoringContextFilePath(safeShowRunId);
  const legacyPath = legacyRunFilePath(safeShowRunId);
  let filePath = null;
  if (await fileExists(primaryPath)) {
    filePath = primaryPath;
  } else if (await fileExists(legacyPath)) {
    filePath = legacyPath;
  }
  if (!filePath) {
    const err = new Error(`algorithm_missing_scoring_context:${safeShowRunId}`);
    err.code = "ALGORITHM_MISSING_SCORING_CONTEXT";
    throw err;
  }
  const text = await fs.readFile(filePath, "utf8");
  return JSON.parse(text);
}

async function listJsonFiles(dirPath) {
  try {
    const entries = await fs.readdir(dirPath, { withFileTypes: true });
    return entries
      .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
      .map((entry) => path.join(dirPath, entry.name));
  } catch (err) {
    if (err && err.code === "ENOENT") return [];
    throw err;
  }
}

async function listScoringContextStates() {
  const files = [
    ...await listJsonFiles(scoringContextsDir()),
    ...await listJsonFiles(runsDir()),
  ];
  const seen = new Set();
  const states = [];
  for (const filePath of files) {
    try {
      const state = JSON.parse(await fs.readFile(filePath, "utf8"));
      if (!state || !state.showRunId || seen.has(state.showRunId)) continue;
      seen.add(state.showRunId);
      states.push(state);
    } catch (_err) {
      // Ignore broken debug files so one bad context does not hide the rest.
    }
  }
  return states.sort((a, b) => String(b.updatedAt || b.createdAt || "").localeCompare(String(a.updatedAt || a.createdAt || "")));
}

async function readAlgorithmConfigFile() {
  const text = await fs.readFile(configFilePath(), "utf8");
  return JSON.parse(text);
}

async function saveAlgorithmConfigFile(config) {
  const filePath = configFilePath();
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(config, null, 2)}\n`, "utf8");
  return { filePath };
}

module.exports = {
  APP_ROOT,
  algorithmDbDir,
  assertPathUnderApp,
  assertShowRunId,
  configFilePath,
  legacyRunFilePath,
  listScoringContextStates,
  readAlgorithmConfigFile,
  readAlgorithmRunState: readScoringContextState,
  readScoringContextState,
  runFilePath: legacyRunFilePath,
  saveAlgorithmConfigFile,
  saveAlgorithmRunState: saveScoringContextState,
  saveScoringContextState,
  scoringContextFilePath,
};
