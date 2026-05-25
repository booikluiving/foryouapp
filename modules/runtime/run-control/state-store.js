"use strict";

const fs = require("node:fs/promises");
const path = require("node:path");

const { RUNTIME_STATE_SCHEMA_VERSION } = require("../../../shared/contracts/runtime-v0");

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

function createIdleRuntimeState(details = {}) {
  const now = new Date().toISOString();
  return {
    schemaVersion: RUNTIME_STATE_SCHEMA_VERSION,
    status: "idle",
    showRunId: null,
    createdAt: null,
    updatedAt: now,
    showRunSnapshot: null,
    preparedNext: null,
    resolvedPreparedNext: null,
    activeSituation: null,
    situationRuns: [],
    playedSituations: [],
    pathEvaluation: null,
    eligiblePool: [],
    lastScoreFeed: null,
    orderSettings: {
      randomizeEqualScores: false,
    },
    rankingRevision: 0,
    rankingTieBreaks: {
      schemaVersion: "runtime.ranking-tie-breaks.v0",
      epoch: 0,
      groups: {},
      updatedAt: null,
    },
    lastRankChangeSummary: null,
    lastAppliedScoreFeedRevision: null,
    finalizationStatus: {
      status: "idle",
      updatedAt: now,
    },
    compactRunLog: {
      schemaVersion: "runtime.compact-run-log.v0",
      liveScoreFeeds: {
        count: 0,
        lastAt: null,
        lastSource: null,
        lastScorePhase: null,
        lastSituationRunId: null,
      },
    },
    runLog: [],
    ...details,
  };
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

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function tempFilePath(filePath) {
  const suffix = `${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2)}.tmp`;
  return assertPathUnderV2(`${filePath}.${suffix}`);
}

async function writeJsonAtomic(filePath, value) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const tmpPath = tempFilePath(filePath);
  try {
    await fs.writeFile(tmpPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
    await fs.rename(tmpPath, filePath);
  } catch (err) {
    try {
      await fs.unlink(tmpPath);
    } catch (unlinkErr) {
      if (!unlinkErr || unlinkErr.code !== "ENOENT") {
        err.cleanupError = unlinkErr;
      }
    }
    throw err;
  }
}

async function readJsonFile(filePath) {
  let parseError = null;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const text = await fs.readFile(filePath, "utf8");
    try {
      return JSON.parse(text);
    } catch (err) {
      if (!(err instanceof SyntaxError)) throw err;
      const trailingJunk = String(err.message || "").match(/after JSON at position (\d+)/);
      if (trailingJunk) {
        try {
          return JSON.parse(text.slice(0, Number(trailingJunk[1])));
        } catch (_prefixErr) {
          // Fall through to retry; a concurrent write may still be in progress.
        }
      }
      parseError = err;
      await sleep(8 * (attempt + 1));
    }
  }
  throw new Error(`runtime_state_json_parse_failed:${path.basename(filePath)}:${parseError.message}`);
}

async function saveRunState(state, options = {}) {
  const filePath = runFilePath(state.showRunId);
  const currentPath = assertPathUnderV2(path.join(runtimeDbDir(), "current-run.json"));
  await writeJsonAtomic(filePath, state);
  if (options.updateCurrent === false || state.status === "reset") {
    return { filePath };
  }
  await writeJsonAtomic(currentPath, {
    showRunId: state.showRunId,
    filePath,
    updatedAt: new Date().toISOString(),
  });
  return { filePath };
}

async function readRunState(showRunId) {
  return readJsonFile(runFilePath(showRunId));
}

async function readCurrentRunState() {
  const currentPath = assertPathUnderV2(path.join(runtimeDbDir(), "current-run.json"));
  try {
    const current = await readJsonFile(currentPath);
    const state = await readRunState(current.showRunId);
    if (state && state.status === "reset") {
      await clearCurrentRunState();
      return createIdleRuntimeState({
        reset: {
          showRunId: state.showRunId,
          resetAt: state.updatedAt || null,
        },
      });
    }
    return state;
  } catch (err) {
    if (err && err.code === "ENOENT") return createIdleRuntimeState();
    throw err;
  }
}

async function clearCurrentRunState() {
  const currentPath = assertPathUnderV2(path.join(runtimeDbDir(), "current-run.json"));
  try {
    await fs.unlink(currentPath);
  } catch (err) {
    if (!err || err.code !== "ENOENT") throw err;
  }
}

module.exports = {
  CURRENT_RUN_FILE,
  V2_ROOT,
  assertPathUnderV2,
  clearCurrentRunState,
  createIdleRuntimeState,
  readCurrentRunState,
  readRunState,
  runFilePath,
  runtimeDbDir,
  runsDir,
  saveRunState,
};
