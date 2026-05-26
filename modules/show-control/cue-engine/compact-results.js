"use strict";

const RUNTIME_ADAPTER_RESULT_SCHEMA_VERSION = "show-control.runtime-adapter-result.v0";

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function compactResolved(resolved = null) {
  if (!resolved || typeof resolved !== "object") return null;
  return {
    situationId: resolved.situationId || null,
    legacySituationId: resolved.legacySituationId || null,
    title: resolved.title || "",
    environmentId: resolved.environmentId || (resolved.environment && resolved.environment.id) || null,
    environmentName: resolved.environment && resolved.environment.name || null,
    characterIds: Array.isArray(resolved.characterIds)
      ? resolved.characterIds.slice()
      : (resolved.characters || []).map((character) => character.id).filter(Boolean),
    characterNames: (resolved.characters || []).map((character) => character.name).filter(Boolean),
    labelIds: Array.isArray(resolved.labelIds) ? resolved.labelIds.slice() : [],
  };
}

function compactPrepared(prepared = null, resolved = null) {
  if (!prepared && !resolved) return null;
  return {
    situationId: prepared && prepared.situationId || resolved && resolved.situationId || null,
    legacySituationId: prepared && prepared.legacySituationId || resolved && resolved.legacySituationId || null,
    title: prepared && prepared.title || resolved && resolved.title || "",
    chosenAt: prepared && prepared.chosenAt || null,
    reason: prepared && prepared.reason || null,
    resolved: compactResolved(resolved),
  };
}

function compactActive(active = null) {
  if (!active || typeof active !== "object") return null;
  return {
    situationRunId: active.situationRunId || null,
    situationId: active.situationId || null,
    legacySituationId: active.legacySituationId || null,
    title: active.title || "",
    status: active.status || null,
    startedAt: active.startedAt || null,
    resolved: compactResolved(active.resolved),
  };
}

function compactFinalization(finalizationStatus = null) {
  if (!finalizationStatus || typeof finalizationStatus !== "object") return null;
  return {
    status: finalizationStatus.status || null,
    queuedAt: finalizationStatus.queuedAt || null,
    updatedAt: finalizationStatus.updatedAt || null,
    showRunId: finalizationStatus.showRunId || null,
    situationRunId: finalizationStatus.situationRunId || null,
    situationId: finalizationStatus.situationId || null,
  };
}

function compactRuntimeStateForCue(runtimeState = null) {
  if (!runtimeState || typeof runtimeState !== "object") return null;
  const resolvedPreparedNext = runtimeState.resolvedPreparedNext || null;
  return {
    schemaVersion: RUNTIME_ADAPTER_RESULT_SCHEMA_VERSION,
    showRunId: runtimeState.showRunId || null,
    status: runtimeState.status || null,
    createdAt: runtimeState.createdAt || null,
    updatedAt: runtimeState.updatedAt || null,
    preparedNext: compactPrepared(runtimeState.preparedNext, resolvedPreparedNext),
    resolvedPreparedNext: compactResolved(resolvedPreparedNext),
    activeSituation: compactActive(runtimeState.activeSituation),
    finalizationStatus: compactFinalization(runtimeState.finalizationStatus),
    counts: {
      situationRuns: Array.isArray(runtimeState.situationRuns) ? runtimeState.situationRuns.length : 0,
      playedSituations: Array.isArray(runtimeState.playedSituations) ? runtimeState.playedSituations.length : 0,
      eligiblePool: Array.isArray(runtimeState.eligiblePool) ? runtimeState.eligiblePool.length : 0,
      runLog: Array.isArray(runtimeState.runLog) ? runtimeState.runLog.length : 0,
      scoreCount: runtimeState.lastScoreFeed && Array.isArray(runtimeState.lastScoreFeed.scores)
        ? runtimeState.lastScoreFeed.scores.length
        : 0,
    },
    omittedFields: [
      "showRunSnapshot",
      "catalogPreview",
      "pathEvaluation",
      "eligiblePool",
      "lastScoreFeed",
      "runLog",
      "compactRunLog",
      "situationRuns",
      "playedSituations",
    ],
  };
}

function compactAdapterResult(data = null) {
  if (!data || typeof data !== "object" || Array.isArray(data)) return data == null ? null : cloneJson(data);
  const copy = cloneJson(data);
  if (copy.runtimeState && typeof copy.runtimeState === "object") {
    copy.runtimeStateRef = compactRuntimeStateForCue(copy.runtimeState);
    copy.runtimeStateOmitted = true;
    delete copy.runtimeState;
  }
  return copy;
}

function compactCueForStorage(cue = null) {
  if (!cue || typeof cue !== "object") return cue;
  const copy = cloneJson(cue);
  copy.actions = Array.isArray(copy.actions)
    ? copy.actions.map((action) => ({
      ...action,
      adapterResult: compactAdapterResult(action.adapterResult),
    }))
    : [];
  return copy;
}

module.exports = {
  RUNTIME_ADAPTER_RESULT_SCHEMA_VERSION,
  compactAdapterResult,
  compactCueForStorage,
  compactRuntimeStateForCue,
};
