"use strict";

const { fetchJson, joinUrl } = require("./http-json");
const {
  performerSlotsFromRuntimeState,
  resolvedPayloadFromRuntimeState,
  runtimeOutputFromRuntimeState,
} = require("../cue-library/runtime-output");
const { compactRuntimeStateForCue } = require("../cue-engine/compact-results");

const DEFAULT_RUNTIME_BASE_URL = "http://127.0.0.1:3024";

function runtimeBaseUrl(options = {}) {
  return String(options.runtimeBaseUrl || process.env.V2_SHOW_CONTROL_RUNTIME_URL || DEFAULT_RUNTIME_BASE_URL).replace(/\/+$/, "");
}

async function getCurrentRuntimeState(options = {}) {
  const result = await fetchJson(joinUrl(runtimeBaseUrl(options), "/v0/runtime/runs/current"), {
    timeoutMs: options.timeoutMs || 1500,
  });
  return result.body;
}

function showRunIdFrom(action, context) {
  const payload = action.payload || {};
  if (payload.showRunId) return String(payload.showRunId);
  if (context.lastRuntimeState && context.lastRuntimeState.showRunId) return context.lastRuntimeState.showRunId;
  if (context.runtimeState && context.runtimeState.showRunId) return context.runtimeState.showRunId;
  return null;
}

function runtimeResultData(route, runtimeState) {
  return {
    route,
    runtimeStateRef: compactRuntimeStateForCue(runtimeState),
    runtimeStateOmitted: true,
  };
}

function runtimePayloadOptions(context = {}) {
  const options = context.adapterOptions || {};
  return {
    liveCatalog: options.liveCatalog || null,
    catalogDbPath: options.catalogDbPath || null,
    disableLiveCatalog: options.disableLiveCatalog === true,
  };
}

function generatedPrepareAction(action, runtimeState, context = {}) {
  const payload = resolvedPayloadFromRuntimeState(runtimeState, "resolvedPreparedNext", "", runtimePayloadOptions(context));
  payload.performerSlots = performerSlotsFromRuntimeState(runtimeState, "resolvedPreparedNext");
  return {
    command: "td.environment.prepare",
    targetId: "touchdesigner",
    ackMode: "required-ready",
    timeoutMs: action.timeoutMs || 2200,
    payload: {
      ...payload,
      cueIntent: "prepare_environment",
      generatedBy: action.command,
    },
  };
}

function generatedTeleprompterPrepareAction(action, runtimeState, context = {}) {
  const payload = resolvedPayloadFromRuntimeState(runtimeState, "resolvedPreparedNext", "", runtimePayloadOptions(context));
  payload.performerSlots = performerSlotsFromRuntimeState(runtimeState, "resolvedPreparedNext");
  return {
    command: "teleprompter.prepare",
    targetId: "teleprompter",
    ackMode: "fire-and-forget",
    timeoutMs: Math.min(Number(action.timeoutMs || 1500), 900),
    payload: {
      ...payload,
      cueIntent: "prepare_text_display",
      generatedBy: action.command,
    },
  };
}

function generatedOperatorPrepareDraftAction(action, runtimeState, context = {}) {
  const payload = resolvedPayloadFromRuntimeState(runtimeState, "resolvedPreparedNext", "", runtimePayloadOptions(context));
  return {
    command: "script-agent.operator.prepareDraft",
    targetId: "script-agent",
    ackMode: "fire-and-forget",
    timeoutMs: Math.min(Number(action.timeoutMs || 1500), 900),
    payload: {
      runtimeOutput: runtimeOutputFromRuntimeState(runtimeState, "resolvedPreparedNext", runtimePayloadOptions(context)),
      force: true,
      sourceId: "show-control-prepare",
      cueIntent: "prepare_operator_draft",
      generatedBy: action.command,
      situation: payload.situation,
    },
  };
}

function generatedGoAction(action, runtimeState, context = {}) {
  const payload = resolvedPayloadFromRuntimeState(runtimeState, "activeSituation", "", runtimePayloadOptions(context));
  payload.performerSlots = performerSlotsFromRuntimeState(runtimeState, "activeSituation");
  return {
    command: "td.environment.go",
    targetId: "touchdesigner",
    ackMode: "fire-and-forget",
    timeoutMs: 900,
    payload: {
      ...payload,
      cueIntent: "go_environment",
      generatedBy: action.command,
    },
  };
}

function generatedTeleprompterRevealAction(action, runtimeState, context = {}) {
  const payload = resolvedPayloadFromRuntimeState(runtimeState, "activeSituation", "", runtimePayloadOptions(context));
  payload.performerSlots = performerSlotsFromRuntimeState(runtimeState, "activeSituation");
  return {
    command: "teleprompter.reveal",
    targetId: "teleprompter",
    ackMode: "fire-and-forget",
    timeoutMs: action.timeoutMs || 900,
    payload: {
      showRunId: runtimeState.showRunId,
      situationRunId: runtimeState.activeSituation ? runtimeState.activeSituation.situationRunId : null,
      situation: payload.situation,
      cueIntent: "reveal_text_display",
      generatedBy: action.command,
    },
  };
}

function canGeneratePrepare(runtimeState) {
  return !!(runtimeState && runtimeState.resolvedPreparedNext);
}

function canGenerateGo(runtimeState) {
  return !!(runtimeState && runtimeState.activeSituation && runtimeState.activeSituation.resolved);
}

async function sendRuntimeCommand(action, context = {}) {
  const options = context.adapterOptions || {};
  const command = action.command;
  if (command === "runtime.status") {
    const state = await getCurrentRuntimeState(options);
    context.lastRuntimeState = state;
    return {
      stage: "applied",
      state: "ok",
      message: "runtime status fetched",
      data: runtimeResultData("GET /v0/runtime/runs/current", state),
    };
  }

  if (command === "runtime.startRun") {
    const result = await fetchJson(joinUrl(runtimeBaseUrl(options), "/v0/runtime/runs/start"), {
      method: "POST",
      body: action.payload || {},
      timeoutMs: action.timeoutMs,
    });
    context.lastRuntimeState = result.body;
    const generatedActions = action.payload && action.payload.autoPrepareNext
      ? [
        generatedTeleprompterPrepareAction(action, result.body, context),
        generatedOperatorPrepareDraftAction(action, result.body, context),
        generatedPrepareAction(action, result.body, context),
      ]
      : [];
    return {
      stage: "applied",
      state: "ok",
      message: `runtime startRun called: ${result.body.showRunId || "unknown-run"}`,
      data: runtimeResultData("POST /v0/runtime/runs/start", result.body),
      generatedActions,
    };
  }

  if (command === "runtime.resetRun") {
    let showRunId = showRunIdFrom(action, context);
    if (!showRunId) {
      const runtimeState = await getCurrentRuntimeState({ ...options, timeoutMs: action.timeoutMs });
      context.lastRuntimeState = runtimeState;
      showRunId = runtimeState.showRunId;
    }
    const route = showRunId ? `/v0/runtime/runs/${encodeURIComponent(showRunId)}/reset` : "/v0/runtime/runs/reset";
    const payload = { ...(action.payload || {}) };
    delete payload.showRunId;
    const result = await fetchJson(joinUrl(runtimeBaseUrl(options), route), {
      method: "POST",
      body: payload,
      timeoutMs: action.timeoutMs,
    });
    context.lastRuntimeState = result.body;
    return {
      stage: "applied",
      state: "ok",
      message: `runtime resetRun called: ${showRunId || "current"}`,
      data: runtimeResultData(`POST ${route}`, result.body),
    };
  }

  if (command === "runtime.prepareNext") {
    const runtimeState = action.payload && action.payload.runtimeState
      ? action.payload.runtimeState
      : await getCurrentRuntimeState({ ...options, timeoutMs: action.timeoutMs });
    context.lastRuntimeState = runtimeState;
    return {
      stage: "applied",
      state: "ok",
      message: `preparedNext resolved: ${runtimeState.preparedNext ? runtimeState.preparedNext.situationId : "none"}`,
      data: runtimeResultData("GET /v0/runtime/runs/current", runtimeState),
      generatedActions: [
        generatedTeleprompterPrepareAction(action, runtimeState, context),
        generatedOperatorPrepareDraftAction(action, runtimeState, context),
        generatedPrepareAction(action, runtimeState, context),
      ],
    };
  }

  if (command === "runtime.startSituation" || command === "runtime.stopSituation") {
    let showRunId = showRunIdFrom(action, context);
    if (!showRunId) {
      const runtimeState = await getCurrentRuntimeState({ ...options, timeoutMs: action.timeoutMs });
      context.lastRuntimeState = runtimeState;
      showRunId = runtimeState.showRunId;
    }
    if (!showRunId) throw new Error("show_control_runtime_missing_show_run_id");
    const endpoint = command === "runtime.startSituation" ? "start-situation" : "stop-situation";
    const route = `/v0/runtime/runs/${encodeURIComponent(showRunId)}/${endpoint}`;
    const result = await fetchJson(joinUrl(runtimeBaseUrl(options), route), {
      method: "POST",
      body: action.payload || {},
      timeoutMs: action.timeoutMs,
    });
    context.lastRuntimeState = result.body;
    const generatedActions = [];
    if (command === "runtime.startSituation" && action.payload.autoGoEnvironment !== false && canGenerateGo(result.body)) {
      generatedActions.push(generatedGoAction(action, result.body, context));
    }
    if (command === "runtime.startSituation" && action.payload.autoRevealTeleprompter !== false && canGenerateGo(result.body)) {
      generatedActions.push(generatedTeleprompterRevealAction(action, result.body, context));
    }
    if (command === "runtime.stopSituation" && action.payload.autoPrepareNext !== false && canGeneratePrepare(result.body)) {
      generatedActions.push(generatedTeleprompterPrepareAction(action, result.body, context));
      generatedActions.push(generatedOperatorPrepareDraftAction(action, result.body, context));
      generatedActions.push(generatedPrepareAction(action, result.body, context));
    }
    return {
      stage: "applied",
      state: "ok",
      message: `runtime ${endpoint} called`,
      data: runtimeResultData(`POST ${route}`, result.body),
      generatedActions,
    };
  }

  throw new Error(`show_control_runtime_command_not_supported:${command}`);
}

module.exports = {
  DEFAULT_RUNTIME_BASE_URL,
  getCurrentRuntimeState,
  performerSlotsFromRuntimeState,
  resolvedPayloadFromRuntimeState,
  runtimeBaseUrl,
  sendRuntimeCommand,
};
