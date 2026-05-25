"use strict";

const fs = require("node:fs/promises");
const path = require("node:path");

const V2_ROOT = path.resolve(__dirname, "../../..");
const DEFAULT_ALGORITHM_DB_DIR = path.join(V2_ROOT, "modules", "algorithm", "db");

function algorithmDbDir() {
  return path.resolve(process.env.V2_ALGORITHM_DB_DIR || DEFAULT_ALGORITHM_DB_DIR);
}

function assertPathUnderV2(targetPath) {
  const resolved = path.resolve(targetPath);
  const relative = path.relative(V2_ROOT, resolved);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`algorithm_path_outside_v2:${resolved}`);
  }
  return resolved;
}

function runsDir() {
  return assertPathUnderV2(path.join(algorithmDbDir(), "runs"));
}

function runFilePath(showRunId) {
  if (!/^show-run-\d{8}-\d{9}Z$/.test(String(showRunId || ""))) {
    throw new Error(`invalid_algorithm_show_run_id:${showRunId}`);
  }
  return assertPathUnderV2(path.join(runsDir(), `${showRunId}.json`));
}

async function saveAlgorithmRunState(state) {
  const filePath = runFilePath(state.showRunId);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(state, null, 2)}\n`, "utf8");
  return { filePath };
}

async function readAlgorithmRunState(showRunId) {
  const text = await fs.readFile(runFilePath(showRunId), "utf8");
  return JSON.parse(text);
}

module.exports = {
  V2_ROOT,
  algorithmDbDir,
  assertPathUnderV2,
  readAlgorithmRunState,
  runFilePath,
  saveAlgorithmRunState,
};
