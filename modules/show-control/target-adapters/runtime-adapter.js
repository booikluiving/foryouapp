"use strict";

const { fetchJson, joinUrl } = require("./http-json");

const DEFAULT_RUNTIME_BASE_URL = "http://127.0.0.1:3024";

function runtimeBaseUrl(options = {}) {
  return String(options.runtimeBaseUrl || process.env.V2_SHOW_CONTROL_RUNTIME_URL || DEFAULT_RUNTIME_BASE_URL).replace(/\/+$/, "");
}

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function resolvedPayloadFromRuntimeState(runtimeState, sourceKey = "resolvedPreparedNext") {
  if (!runtimeState || typeof runtimeState !== "object") throw new Error("show_control_missing_runtime_state");
  const resolved = sourceKey === "activeSituation"
    ? runtimeState.activeSituation && runtimeState.activeSituation.resolved
    : runtimeState.resolvedPreparedNext;
  if (!resolved) throw new Error(`show_control_missing_runtime_${sourceKey}`);
  const copy = cloneJson(resolved);
  return {
    source: {
      type: sourceKey === "activeSituation" ? "runtime.active-situation" : "runtime.resolved-prepared-next",
      readOnly: true,
    },
    showRunId: runtimeState.showRunId,
    situationRunId: runtimeState.activeSituation ? runtimeState.activeSituation.situationRunId : null,
    situation: {
      situationId: copy.situationId,
      legacySituationId: copy.legacySituationId || null,
      title: copy.title || "",
    },
    environment: copy.environment || null,
    characterIds: copy.characterIds || (copy.characters || []).map((character) => character.id),
    characters: (copy.characters || []).map((character) => ({
      characterId: character.id,
      legacyCharacterId: character.legacyId || null,
      name: character.name,
      performerIds: character.performerIds || [],
    })),
    labelIds: copy.labelIds || [],
  };
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

function generatedPrepareAction(action, runtimeState) {
  const payload = resolvedPayloadFromRuntimeState(runtimeState, "resolvedPreparedNext");
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
      data: { route: "GET /v0/runtime/runs/current", runtimeState: state },
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
      ? [generatedPrepareAction(action, result.body)]
      : [];
    return {
      stage: "applied",
      state: "ok",
      message: `runtime startRun called: ${result.body.showRunId || "unknown-run"}`,
      data: { route: "POST /v0/runtime/runs/start", runtimeState: result.body },
      generatedActions,
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
      data: { route: "GET /v0/runtime/runs/current", runtimeState },
      generatedActions: [generatedPrepareAction(action, runtimeState)],
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
    return {
      stage: "applied",
      state: "ok",
      message: `runtime ${endpoint} called`,
      data: { route: `POST ${route}`, runtimeState: result.body },
    };
  }

  throw new Error(`show_control_runtime_command_not_supported:${command}`);
}

module.exports = {
  DEFAULT_RUNTIME_BASE_URL,
  getCurrentRuntimeState,
  resolvedPayloadFromRuntimeState,
  runtimeBaseUrl,
  sendRuntimeCommand,
};
