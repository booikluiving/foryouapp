"use strict";

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function compactPayload(payload = {}) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return {};
  const compact = {};
  for (const key of [
    "cueIntent",
    "showRunId",
    "situationRunId",
    "environmentId",
    "button",
    "state",
    "label",
    "channel",
    "muted",
    "camera",
    "cameraId",
    "normalised",
    "preset",
    "key",
  ]) {
    if (payload[key] != null) compact[key] = payload[key];
  }
  if (payload.situation && typeof payload.situation === "object") {
    compact.situation = {
      situationId: payload.situation.situationId || null,
      legacySituationId: payload.situation.legacySituationId || null,
      title: payload.situation.title || "",
    };
  }
  if (payload.runtimeOutput && typeof payload.runtimeOutput === "object") {
    compact.runtimeOutput = {
      showRunId: payload.runtimeOutput.showRunId || null,
      situationId: payload.runtimeOutput.resolvedPreparedNext && payload.runtimeOutput.resolvedPreparedNext.situationId || null,
      title: payload.runtimeOutput.situation && payload.runtimeOutput.situation.title || "",
    };
  }
  return compact;
}

function summarizeAction(action = {}, index = 0) {
  return {
    actionId: action.actionId || null,
    stepId: action.stepId || null,
    targetId: action.targetId || null,
    command: action.command || "",
    commandTitle: action.commandTitle || action.command || "",
    ackMode: action.ackMode || null,
    delayMs: Number(action.delayMs || 0),
    timeoutMs: Number(action.timeoutMs || 0),
    parallelGroup: action.parallelGroup || null,
    generatedByActionId: action.generatedByActionId || null,
    payloadId: action.payloadId || null,
    payloadSummary: compactPayload(action.payload || {}),
    status: action.status ? cloneJson(action.status) : null,
    adapterResult: action.adapterResult ? cloneJson(action.adapterResult) : null,
    order: index + 1,
  };
}

function summarizeCue(cue = {}, options = {}) {
  const actions = Array.isArray(cue.actions) ? cue.actions : [];
  const warnings = cue.status && Array.isArray(cue.status.warnings) ? cue.status.warnings : [];
  const executionLog = Array.isArray(cue.executionLog) ? cue.executionLog : [];
  const actionLimit = Number.isFinite(Number(options.actionLimit)) ? Math.max(0, Number(options.actionLimit)) : 8;
  const logLimit = Number.isFinite(Number(options.logLimit)) ? Math.max(0, Number(options.logLimit)) : 12;
  return {
    cueId: cue.cueId || null,
    cueType: cue.cueType || null,
    name: cue.name || "",
    schemaVersion: cue.schemaVersion || null,
    createdAt: cue.createdAt || null,
    updatedAt: cue.status && cue.status.updatedAt || cue.updatedAt || null,
    archivedAt: cue.archivedAt || null,
    archivedReason: cue.archivedReason || null,
    runtimeRef: cue.runtimeRef ? cloneJson(cue.runtimeRef) : null,
    runtimeSelection: cue.runtimeSelection || null,
    status: cue.status ? {
      stage: cue.status.stage || null,
      state: cue.status.state || null,
      nonBlocking: !!cue.status.nonBlocking,
      startedAt: cue.status.startedAt || null,
      completedAt: cue.status.completedAt || null,
      updatedAt: cue.status.updatedAt || null,
      sentOrder: Array.isArray(cue.status.sentOrder) ? cue.status.sentOrder.slice(-12) : [],
      targetStatus: cue.status.targetStatus ? cloneJson(cue.status.targetStatus) : {},
      warnings: warnings.slice(-5).map(cloneJson),
    } : null,
    warningCount: warnings.length,
    actionCount: actions.length,
    ackCount: Array.isArray(cue.acks) ? cue.acks.length : 0,
    actions: actions.slice(0, actionLimit).map(summarizeAction),
    actionOverflow: Math.max(0, actions.length - actionLimit),
    executionLog: executionLog.slice(-logLimit).map(cloneJson),
  };
}

function summarizeCues(cues = [], options = {}) {
  return (Array.isArray(cues) ? cues : []).map((cue) => summarizeCue(cue, options));
}

module.exports = {
  compactPayload,
  summarizeAction,
  summarizeCue,
  summarizeCues,
};
