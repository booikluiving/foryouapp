"use strict";

const {
  SHOW_CONTROL_CUE_SCHEMA_VERSION,
  createShowControlId,
} = require("../../../shared/contracts/show-control-v0");
const {
  resolvedPayloadFromRuntimeState,
  runtimeOutputFromRuntimeState,
} = require("./runtime-output");
const {
  DEFAULT_STOP_PRESET_ID,
  channelsForPreset,
} = require("../../../shared/lighting/environment-lighting-v0");

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
    timeoutMs: Number(overrides.timeoutMs || 1500),
    parallelGroup: overrides.parallelGroup || null,
    required: ackMode === "required-ready",
    payloadId: actionPayloadId(cueId, actionIndex),
    payload,
    transport: targetId === "touchdesigner"
      ? {
        type: "osc-control-intent",
        address: "/td/cue",
        args: [cueId, command, actionPayloadId(cueId, actionIndex)],
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

function phasePayload(phase, phaseName, cueIntent) {
  return {
    phase,
    phaseName,
    source: "show-control",
    cueIntent,
  };
}

function buildPhaseCue({ phase, phaseName, name, createdAtDate = new Date() } = {}) {
  const numericPhase = Number(phase);
  if (!Number.isInteger(numericPhase) || numericPhase < 0) throw new Error("show_control_invalid_phase");
  const safePhaseName = phaseName ? String(phaseName) : `phase-${numericPhase}`;
  const cueId = createShowControlId("show-cue", createdAtDate);
  return makeCue({
    cueType: "compound",
    name: name || `Set TD phase ${numericPhase}`,
    runtimeState: null,
    runtimeSelection: null,
    actions: [
      action(cueId, 0, "touchdesigner", "td.phase.set", "acknowledged-async", phasePayload(
        numericPhase,
        safePhaseName,
        `phase_${safePhaseName}`
      ), { timeoutMs: 1200 }),
    ],
    createdAtDate,
    cueId,
  });
}

function buildPrepareCue(runtimeState, options = {}) {
  if (!runtimeState || typeof runtimeState !== "object") throw new Error("show_control_missing_runtime_state");
  if (!runtimeState.resolvedPreparedNext) throw new Error("show_control_missing_runtime_resolved_output");
  const createdAtDate = options.createdAtDate || new Date();
  const cueId = createShowControlId("show-cue", createdAtDate);
  const payload = resolvedPayloadFromRuntimeState(runtimeState, "resolvedPreparedNext", "runtime.resolved-output", options);
  const runtimeOutput = runtimeOutputFromRuntimeState(runtimeState, "resolvedPreparedNext", options);
  const actions = [
    action(cueId, 0, "teleprompter", "teleprompter.prepare", "fire-and-forget", {
      ...payload,
      cueIntent: "prepare_text_display",
    }, { timeoutMs: 900 }),
    action(cueId, 1, "script-agent", "script-agent.operator.prepareDraft", "fire-and-forget", {
      runtimeOutput,
      force: true,
      sourceId: "show-control-prepare",
      cueIntent: "prepare_operator_draft",
      situation: payload.situation,
    }, { timeoutMs: 900 }),
    action(cueId, 2, "touchdesigner", "td.environment.prepare", "required-ready", {
      ...payload,
      cueIntent: "prepare_environment",
    }, { simulate: options.simulateTargetTimeout ? "timeout" : null }),
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
  const payload = resolvedPayloadFromRuntimeState(runtimeState, "activeSituation", "runtime.active-situation", options);
  const actions = [
    action(cueId, 0, "touchdesigner", "td.environment.go", "fire-and-forget", {
      ...payload,
      situationRunId: runtimeState.activeSituation.situationRunId,
      cueIntent: "go_environment",
    }),
    action(cueId, 1, "streamdeck", "streamdeck.status", "fire-and-forget", {
      showRunId: runtimeState.showRunId,
      situationRunId: runtimeState.activeSituation.situationRunId,
      situation: payload.situation,
      cueIntent: "operator_feedback",
    }),
    action(cueId, 2, "teleprompter", "teleprompter.reveal", "fire-and-forget", {
      showRunId: runtimeState.showRunId,
      situationRunId: runtimeState.activeSituation.situationRunId,
      situation: payload.situation,
      cueIntent: "reveal_text_display",
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

function buildCompoundCue({ name, actions: requestedActions = [], steps = null, createdAtDate = new Date() }) {
  const cueId = createShowControlId("show-cue", createdAtDate);
  const actions = requestedActions.map((item, index) => action(
    cueId,
    index,
    item.targetId ? String(item.targetId) : null,
    String(item.command || "debug.noop"),
    String(item.ackMode || "acknowledged-async"),
    item.payload || {},
    {
      delayMs: item.delayMs || 0,
      timeoutMs: item.timeoutMs || 1500,
      simulate: item.simulate || null,
      parallelGroup: item.parallelGroup || item.groupId || null,
    }
  ));
  const cue = makeCue({
    cueType: "compound",
    name: name || "Compound cue",
    runtimeState: null,
    runtimeSelection: null,
    actions,
    createdAtDate,
    cueId,
  });
  if (Array.isArray(steps)) cue.steps = steps;
  return cue;
}

function buildStartRunCue({ name, autoPrepareNext = true, createdAtDate = new Date() } = {}) {
  const cueId = createShowControlId("show-cue", createdAtDate);
  return makeCue({
    cueType: "compound",
    name: name || "Start run and prepare next",
    runtimeState: null,
    runtimeSelection: null,
    actions: [
      action(cueId, 0, "runtime", "runtime.startRun", "acknowledged-async", {
        autoPrepareNext,
      }, { timeoutMs: 4000 }),
    ],
    createdAtDate,
    cueId,
  });
}

function buildStartSituationCue({ name, showRunId, actions: technicalActions = [], createdAtDate = new Date() } = {}) {
  const cueId = createShowControlId("show-cue", createdAtDate);
  const hasExplicitTdGo = technicalActions.some((item) => String(item.command || "") === "td.environment.go");
  const hasExplicitDmxLighting = technicalActions.some((item) => String(item.command || "").startsWith("dmx."));
  const actions = [
    action(cueId, 0, "runtime", "runtime.startSituation", "acknowledged-async", {
      showRunId,
      autoGoEnvironment: !hasExplicitTdGo,
      autoGoLighting: !hasExplicitDmxLighting,
      autoRevealTeleprompter: true,
    }, { parallelGroup: "start-situation", timeoutMs: 4000 }),
    action(cueId, 1, "touchdesigner", "td.phase.set", "acknowledged-async", phasePayload(
      2,
      "situation",
      "phase_situation_start"
    ), { parallelGroup: "start-situation", timeoutMs: 1200 }),
    ...technicalActions.map((item, index) => action(
      cueId,
      index + 2,
      item.targetId ? String(item.targetId) : null,
      String(item.command || "debug.noop"),
      String(item.ackMode || "acknowledged-async"),
      item.payload || {},
      {
        delayMs: item.delayMs || 0,
        timeoutMs: item.timeoutMs || 1500,
        parallelGroup: item.parallelGroup || "start-situation",
      }
    )),
  ];
  return makeCue({
    cueType: "compound",
    name: name || "Start situation with technical fan-out",
    runtimeState: null,
    runtimeSelection: null,
    actions,
    createdAtDate,
    cueId,
  });
}

function buildStopSituationCue({ name, showRunId, createdAtDate = new Date() } = {}) {
  const cueId = createShowControlId("show-cue", createdAtDate);
  return makeCue({
    cueType: "compound",
    name: name || "Stop situation and set loading phase",
    runtimeState: null,
    runtimeSelection: null,
    actions: [
      action(cueId, 0, "runtime", "runtime.stopSituation", "acknowledged-async", {
        ...(showRunId ? { showRunId } : {}),
        autoPrepareNext: true,
      }, { parallelGroup: "stop-situation", timeoutMs: 4000 }),
      action(cueId, 1, "touchdesigner", "td.phase.set", "acknowledged-async", phasePayload(
        1,
        "loading",
        "phase_loading_after_stop"
      ), { parallelGroup: "stop-situation", timeoutMs: 1200 }),
      action(cueId, 2, "dmx", "dmx.look", "fire-and-forget", {
        label: "neutral-dim-between-situations",
        channels: channelsForPreset(DEFAULT_STOP_PRESET_ID),
        clearFirst: false,
        continuous: true,
        cueIntent: "environment_lighting_stop",
        presetId: DEFAULT_STOP_PRESET_ID,
      }, { parallelGroup: "stop-situation", timeoutMs: 900 }),
    ],
    createdAtDate,
    cueId,
  });
}

function buildSceneToChatCue(runtimeState, options = {}) {
  if (!runtimeState || typeof runtimeState !== "object") throw new Error("show_control_missing_runtime_state");
  if (!runtimeState.resolvedPreparedNext) throw new Error("show_control_missing_runtime_resolved_output");
  const createdAtDate = options.createdAtDate || new Date();
  const cueId = createShowControlId("show-cue", createdAtDate);
  const payload = resolvedPayloadFromRuntimeState(runtimeState, "resolvedPreparedNext", "runtime.resolved-output", options);
  const runtimeOutput = runtimeOutputFromRuntimeState(runtimeState, "resolvedPreparedNext", options);
  return makeCue({
    cueType: "compound",
    name: options.name || "Scene naar Script Agent chat",
    runtimeState,
    runtimeSelection: "runtime.resolvedPreparedNext",
    actions: [
      action(cueId, 0, "script-agent", "script-agent.operator.sceneToChat", "acknowledged-async", {
        runtimeOutput,
        sessionId: options.sessionId || runtimeState.showRunId || null,
        sourceId: options.sourceId || "show-control-scene-chat",
        force: true,
        cueIntent: "operator_scene_to_chat",
        situation: payload.situation,
      }, { timeoutMs: options.timeoutMs || 90000 }),
    ],
    createdAtDate,
    cueId,
  });
}

function environmentIdForResolved(resolved = {}) {
  return String(
    resolved.environmentId
    || (resolved.environment && resolved.environment.id)
    || ""
  ).trim();
}

function buildEnvironmentMediaRefreshCue(runtimeState, options = {}) {
  if (!runtimeState || typeof runtimeState !== "object") throw new Error("show_control_missing_runtime_state");
  const environmentId = String(options.environmentId || "").trim();
  if (!environmentId) throw new Error("show_control_missing_environment_id");
  const createdAtDate = options.createdAtDate || new Date();
  const cueId = createShowControlId("show-cue", createdAtDate);
  const refresh = {
    environmentId,
    roles: Array.isArray(options.roles) ? options.roles.map((role) => String(role)).filter(Boolean) : [],
    reason: options.reason || "catalog_media_changed",
    source: options.source || "catalog",
    assetId: options.assetId || null,
    requestedAt: createdAtDate.toISOString(),
  };
  const actions = [];
  const activeResolved = runtimeState.activeSituation && runtimeState.activeSituation.resolved;
  if (activeResolved && environmentIdForResolved(activeResolved) === environmentId) {
    const payload = resolvedPayloadFromRuntimeState(runtimeState, "activeSituation", "runtime.active-situation", options);
    actions.push(action(cueId, actions.length, "touchdesigner", "td.environment.go", "acknowledged-async", {
      ...payload,
      mediaRefresh: refresh,
      situationRunId: runtimeState.activeSituation ? runtimeState.activeSituation.situationRunId : null,
      cueIntent: "live_media_refresh_active",
    }, { timeoutMs: options.timeoutMs || 1200 }));
  }

  const preparedResolved = runtimeState.resolvedPreparedNext;
  if (!actions.length && preparedResolved && environmentIdForResolved(preparedResolved) === environmentId) {
    const payload = resolvedPayloadFromRuntimeState(runtimeState, "resolvedPreparedNext", "runtime.resolved-output", options);
    actions.push(action(cueId, actions.length, "touchdesigner", "td.environment.prepare", "acknowledged-async", {
      ...payload,
      mediaRefresh: refresh,
      cueIntent: "live_media_refresh_prepared",
    }, { timeoutMs: options.timeoutMs || 1200 }));
  }

  return makeCue({
    cueType: "compound",
    name: options.name || `Refresh media for ${environmentId}`,
    runtimeState,
    runtimeSelection: "runtime.media-refresh",
    actions,
    createdAtDate,
    cueId,
  });
}

module.exports = {
  actionPayloadId,
  buildCompoundCue,
  buildEnvironmentMediaRefreshCue,
  buildGoCue,
  buildPhaseCue,
  buildPrepareCue,
  buildSceneToChatCue,
  buildStartRunCue,
  buildStartSituationCue,
  buildStopSituationCue,
};
