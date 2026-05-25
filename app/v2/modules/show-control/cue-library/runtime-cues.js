"use strict";

const {
  SHOW_CONTROL_CUE_SCHEMA_VERSION,
  createShowControlId,
} = require("../../../shared/contracts/show-control-v0");

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function basePayloadFromResolved(runtimeState, resolved, sourceType) {
  return {
    source: {
      type: sourceType,
      readOnly: true,
    },
    showRunId: runtimeState.showRunId,
    situation: {
      situationId: resolved.situationId,
      legacySituationId: resolved.legacySituationId || null,
      title: resolved.title || "",
    },
    environment: resolved.environment || null,
    characterIds: resolved.characterIds || (resolved.characters || []).map((character) => character.id),
    characters: (resolved.characters || []).map((character) => ({
      characterId: character.id,
      legacyCharacterId: character.legacyId || null,
      name: character.name,
      performerIds: character.performerIds || [],
    })),
    labelIds: resolved.labelIds || [],
  };
}

function actionPayloadId(cueId, actionIndex) {
  return `${cueId}:payload:${String(actionIndex + 1).padStart(2, "0")}`;
}

function action(cueId, actionIndex, targetId, command, ackMode, payload, overrides = {}) {
  return {
    actionId: `${cueId}:action:${String(actionIndex + 1).padStart(2, "0")}`,
    targetId,
    command,
    ackMode,
    delayMs: Number(overrides.delayMs || 0),
    required: ackMode === "required-ready",
    payloadId: actionPayloadId(cueId, actionIndex),
    payload,
    transport: targetId === "touchdesigner"
      ? {
        type: "osc-control-intent",
        address: "/td/cue",
        args: [command, cueId, actionPayloadId(cueId, actionIndex)],
      }
      : { type: "http-or-internal" },
    simulate: overrides.simulate || null,
    status: {
      stage: "queued",
      state: "queued",
      message: null,
      updatedAt: null,
    },
  };
}

function makeCue({ cueId, cueType, name, runtimeState, runtimeSelection, actions, createdAtDate = new Date() }) {
  return {
    schemaVersion: SHOW_CONTROL_CUE_SCHEMA_VERSION,
    cueId,
    cueType,
    name,
    createdAt: createdAtDate.toISOString(),
    source: {
      type: "show-control-v0",
      readOnly: false,
    },
    runtimeRef: runtimeState ? {
      source: runtimeSelection,
      showRunId: runtimeState.showRunId,
      runtimeUpdatedAt: runtimeState.updatedAt || null,
    } : null,
    status: {
      stage: "queued",
      state: "queued",
      warnings: [],
      sentOrder: [],
      updatedAt: createdAtDate.toISOString(),
    },
    actions,
  };
}

function buildPrepareCue(runtimeState, options = {}) {
  if (!runtimeState || typeof runtimeState !== "object") throw new Error("show_control_missing_runtime_state");
  if (!runtimeState.resolvedPreparedNext) throw new Error("show_control_missing_runtime_resolved_output");
  const createdAtDate = options.createdAtDate || new Date();
  const cueId = createShowControlId("show-cue", createdAtDate);
  const payload = basePayloadFromResolved(runtimeState, cloneJson(runtimeState.resolvedPreparedNext), "runtime.resolved-output");
  const actions = [
    action(cueId, 0, "touchdesigner", "td.environment.prepare", "required-ready", {
      ...payload,
      cueIntent: "prepare_environment",
    }, { simulate: options.simulateTargetTimeout ? "timeout" : null }),
    action(cueId, 1, "teleprompter", "teleprompter.prepare", "acknowledged", {
      showRunId: runtimeState.showRunId,
      situation: payload.situation,
      cueIntent: "prepare_text_display",
    }),
  ];
  return makeCue({
    cueType: "prepare",
    name: "Prepare runtime output",
    runtimeState,
    runtimeSelection: "runtime.resolvedPreparedNext",
    actions,
    createdAtDate,
    cueId,
  });
}

function buildGoCue(runtimeState, options = {}) {
  if (!runtimeState || typeof runtimeState !== "object") throw new Error("show_control_missing_runtime_state");
  if (!runtimeState.activeSituation || !runtimeState.activeSituation.resolved) {
    throw new Error("show_control_missing_runtime_active_situation");
  }
  const createdAtDate = options.createdAtDate || new Date();
  const cueId = createShowControlId("show-cue", createdAtDate);
  const payload = basePayloadFromResolved(runtimeState, cloneJson(runtimeState.activeSituation.resolved), "runtime.active-situation");
  const actions = [
    action(cueId, 0, "touchdesigner", "td.environment.go", "fire-and-forget", {
      ...payload,
      situationRunId: runtimeState.activeSituation.situationRunId,
      cueIntent: "go_environment",
    }),
    action(cueId, 1, "stream-deck", "streamdeck.status.active", "fire-and-forget", {
      showRunId: runtimeState.showRunId,
      situationRunId: runtimeState.activeSituation.situationRunId,
      situation: payload.situation,
      cueIntent: "operator_feedback",
    }),
  ];
  return makeCue({
    cueType: "go",
    name: "Go active runtime output",
    runtimeState,
    runtimeSelection: "runtime.activeSituation",
    actions,
    createdAtDate,
    cueId,
  });
}

function buildCompoundCue({ name, actions: requestedActions = [], createdAtDate = new Date() }) {
  const cueId = createShowControlId("show-cue", createdAtDate);
  const actions = requestedActions.map((item, index) => action(
    cueId,
    index,
    String(item.targetId || "debug"),
    String(item.command || "debug.noop"),
    String(item.ackMode || "acknowledged"),
    item.payload || {},
    { delayMs: item.delayMs || 0, simulate: item.simulate || null }
  ));
  return makeCue({
    cueType: "compound",
    name: name || "Compound cue",
    runtimeState: null,
    runtimeSelection: null,
    actions,
    createdAtDate,
    cueId,
  });
}

module.exports = {
  actionPayloadId,
  buildCompoundCue,
  buildGoCue,
  buildPrepareCue,
};
