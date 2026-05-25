"use strict";

const fs = require("node:fs/promises");
const path = require("node:path");

const {
  SHADOW_RUN_REPORT_SCHEMA_VERSION,
  createShadowRunId,
} = require("../../shared/contracts/shadow-run-v0");
const { buildV1OrderFromV2Snapshots } = require("../v1-oracle/v1-order-adapter");

const V2_ROOT = path.resolve(__dirname, "../..");
const DEFAULT_REPORTS_DIR = path.join(V2_ROOT, "shadow-run", "reports");

function toV2SituationId(legacyId) {
  const number = Number(legacyId);
  return Number.isInteger(number) && number > 0 ? `situation:${number}` : null;
}

function sortedUnique(values) {
  return Array.from(new Set(values.filter(Boolean))).sort((a, b) => {
    const na = Number(String(a).split(":").pop());
    const nb = Number(String(b).split(":").pop());
    if (Number.isFinite(na) && Number.isFinite(nb) && na !== nb) return na - nb;
    return String(a).localeCompare(String(b));
  });
}

function diffSets(left, right) {
  const leftSet = new Set(left);
  const rightSet = new Set(right);
  return {
    onlyInV1: left.filter((item) => !rightSet.has(item)),
    onlyInV2: right.filter((item) => !leftSet.has(item)),
    inBoth: left.filter((item) => rightSet.has(item)),
  };
}

function explainPreparedDifference(v1Prepared, v2Prepared, availableDiff) {
  if (v1Prepared === v2Prepared) return "matched";
  if (!v1Prepared || !v2Prepared) return "one_side_missing_prepared_next";
  if (availableDiff.inBoth.includes(v1Prepared) && availableDiff.inBoth.includes(v2Prepared)) {
    return "both_candidates_available_ordering_policy_differs";
  }
  if (availableDiff.onlyInV1.includes(v1Prepared)) return "v2_path_or_runtime_filter_excludes_v1_choice";
  if (availableDiff.onlyInV2.includes(v2Prepared)) return "v1_algorithm_or_path_filter_excludes_v2_choice";
  return "prepared_next_differs";
}

function explainAvailablePoolDifferences(availableDiff) {
  return {
    onlyInV1: availableDiff.onlyInV1.map((situationId) => ({
      situationId,
      cause: "v2_paths_or_runtime_policy_excludes_v1_available_candidate",
    })),
    onlyInV2: availableDiff.onlyInV2.map((situationId) => ({
      situationId,
      cause: "v2_paths_raw_availability_is_broader_than_v1_order_pool",
    })),
  };
}

function v1AvailablePool(order) {
  return sortedUnique((order.rows || [])
    .filter((entry) => !entry.played && !entry.active && !entry.invalid && !entry.blocked)
    .filter((entry) => String(entry.nodeStatus || "Available") === "Available")
    .map((entry) => toV2SituationId(entry.sceneId)));
}

function v2AvailablePool(pathEvaluation) {
  return sortedUnique((pathEvaluation.items || [])
    .filter((item) => item.status === "available" || item.pathAvailable)
    .map((item) => item.situationId));
}

function v2RuntimeEligiblePool(runtimeState) {
  return sortedUnique(((runtimeState && runtimeState.eligiblePool) || [])
    .map((item) => item.situationId || toV2SituationId(item.legacySituationId)));
}

function summarizeV1(order) {
  const next = order.next || null;
  return {
    source: {
      type: "v1-show-algorithm-library",
      readOnly: true,
    },
    availablePoolLayer: "v1-order-available-rows",
    availablePool: v1AvailablePool(order),
    preparedNext: next ? {
      situationId: toV2SituationId(next.sceneId),
      legacySituationId: Number(next.sceneId || 0),
      reason: next.reason || "",
      score: Number(next.score || 0),
    } : null,
    playableCount: Number(order.playableCount || 0),
    blockedContextCount: (order.blockedContext || []).length,
    blockedPathCount: (order.blockedPath || []).length,
    invalidCount: (order.invalid || []).length,
  };
}

function summarizeV2({ pathEvaluation, runtimeState }) {
  const availablePool = v2AvailablePool(pathEvaluation);
  const runtimeEligiblePool = v2RuntimeEligiblePool(runtimeState);
  const runtimeEligibleDiff = runtimeState && Array.isArray(runtimeState.eligiblePool)
    ? diffSets(availablePool, runtimeEligiblePool)
    : null;
  return {
    source: {
      type: "v2-service-contracts",
      readOnly: true,
    },
    availablePoolLayer: "v2-paths-pathAvailable",
    availablePool,
    availablePoolPolicy: "Paths exposes only globally reachable available nodes; local path starts with required incoming routes in other active paths stay locked until reached.",
    runtimeEligiblePoolLayer: "v2-runtime-eligiblePool",
    runtimeEligiblePool,
    runtimeEligiblePoolMatchesPathAvailable: runtimeEligibleDiff
      ? runtimeEligibleDiff.onlyInV1.length === 0 && runtimeEligibleDiff.onlyInV2.length === 0
      : null,
    runtimeEligibleVsPathAvailable: runtimeEligibleDiff,
    preparedNext: runtimeState && runtimeState.preparedNext ? {
      situationId: runtimeState.preparedNext.situationId,
      legacySituationId: Number(runtimeState.preparedNext.legacySituationId || 0),
      reason: runtimeState.preparedNext.reason || "",
    } : null,
    showRunId: runtimeState ? runtimeState.showRunId || null : null,
    eligiblePoolCount: runtimeState && Array.isArray(runtimeState.eligiblePool) ? runtimeEligiblePool.length : null,
  };
}

function compareShadowRun({ catalog, paths, pathEvaluation, runtimeState, createdAtDate = new Date() }) {
  const v1Order = buildV1OrderFromV2Snapshots({ catalog, paths });
  const v1 = summarizeV1(v1Order);
  const v2 = summarizeV2({ pathEvaluation, runtimeState });
  const availablePool = diffSets(v1.availablePool, v2.availablePool);
  const preparedNext = {
    v1: v1.preparedNext ? v1.preparedNext.situationId : null,
    v2: v2.preparedNext ? v2.preparedNext.situationId : null,
  };
  preparedNext.matches = preparedNext.v1 === preparedNext.v2;
  preparedNext.explanation = explainPreparedDifference(preparedNext.v1, preparedNext.v2, availablePool);
  return {
    schemaVersion: SHADOW_RUN_REPORT_SCHEMA_VERSION,
    shadowRunId: createShadowRunId(createdAtDate),
    createdAt: createdAtDate.toISOString(),
    mode: "shadow",
    source: {
      v1Oracle: "app/lib/show-algorithm.js",
      v2Contracts: ["catalog", "paths", "runtime"],
      readOnly: true,
    },
    v1,
    v2,
    comparison: {
      availablePool,
      availablePoolExplanations: explainAvailablePoolDifferences(availablePool),
      preparedNext,
      summary: {
        availablePoolMatches: availablePool.onlyInV1.length === 0 && availablePool.onlyInV2.length === 0,
        preparedNextMatches: preparedNext.matches,
        runtimeEligibleMatchesPathAvailable: v2.runtimeEligiblePoolMatchesPathAvailable,
        differenceCount: availablePool.onlyInV1.length + availablePool.onlyInV2.length + (preparedNext.matches ? 0 : 1),
      },
    },
  };
}

function assertPathUnderV2(targetPath) {
  const resolved = path.resolve(targetPath);
  const relative = path.relative(V2_ROOT, resolved);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`shadow_run_path_outside_v2:${resolved}`);
  }
  return resolved;
}

function reportPath(report) {
  return assertPathUnderV2(path.join(process.env.V2_SHADOW_REPORTS_DIR || DEFAULT_REPORTS_DIR, `${report.shadowRunId}.json`));
}

async function saveShadowReport(report) {
  const filePath = reportPath(report);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  return { filePath };
}

module.exports = {
  compareShadowRun,
  diffSets,
  reportPath,
  saveShadowReport,
  v1AvailablePool,
  v2AvailablePool,
  v2RuntimeEligiblePool,
};
