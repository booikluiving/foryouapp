"use strict";

const fs = require("node:fs/promises");
const path = require("node:path");

const V2_ROOT = path.resolve(__dirname, "../../..");
const DEFAULT_RUNTIME_DB_DIR = path.join(V2_ROOT, "modules", "runtime", "db");
const DEFAULT_RUNS_DIR = path.join(DEFAULT_RUNTIME_DB_DIR, "runs");
const CURRENT_RUN_FILE = path.join(DEFAULT_RUNTIME_DB_DIR, "current-run.json");

function runtimeDbDir() {
  return path.resolve(process.env.V2_RUNTIME_DB_DIR || DEFAULT_RUNTIME_DB_DIR);
}

function assertPathUnderV2(targetPath) {
  const resolved = path.resolve(targetPath);
  const relative = path.relative(V2_ROOT, resolved);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`runtime_path_outside_v2:${resolved}`);
  }
  return resolved;
}

function runsDir() {
  return assertPathUnderV2(path.join(runtimeDbDir(), "runs"));
}

function runFilePath(showRunId) {
  if (!/^show-run-\d{8}-\d{9}Z$/.test(String(showRunId || ""))) {
    throw new Error(`invalid_show_run_id:${showRunId}`);
  }
  return assertPathUnderV2(path.join(runsDir(), `${showRunId}.json`));
}

async function saveRunState(state) {
  const filePath = runFilePath(state.showRunId);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(state, null, 2)}\n`, "utf8");
  const currentPath = assertPathUnderV2(path.join(runtimeDbDir(), "current-run.json"));
  await fs.mkdir(path.dirname(currentPath), { recursive: true });
  await fs.writeFile(currentPath, `${JSON.stringify({
    showRunId: state.showRunId,
    filePath,
    updatedAt: new Date().toISOString(),
  }, null, 2)}\n`, "utf8");
  return { filePath };
}

async function readRunState(showRunId) {
  const text = await fs.readFile(runFilePath(showRunId), "utf8");
  return JSON.parse(text);
}

async function readCurrentRunState() {
  const currentPath = assertPathUnderV2(path.join(runtimeDbDir(), "current-run.json"));
  const text = await fs.readFile(currentPath, "utf8");
  const current = JSON.parse(text);
  return readRunState(current.showRunId);
}

module.exports = {
  CURRENT_RUN_FILE,
  V2_ROOT,
  assertPathUnderV2,
  readCurrentRunState,
  readRunState,
  runFilePath,
  runtimeDbDir,
  runsDir,
  saveRunState,
};
