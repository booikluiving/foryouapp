"use strict";

const { fetchJson, joinUrl } = require("./http-json");

const DEFAULT_SCRIPT_AGENT_BASE_URL = "http://127.0.0.1:3027";

function scriptAgentBaseUrl(options = {}) {
  return String(
    options.scriptAgentBaseUrl
    || process.env.V2_SHOW_CONTROL_SCRIPT_AGENT_URL
    || DEFAULT_SCRIPT_AGENT_BASE_URL
  ).replace(/\/+$/, "");
}

function requestForScriptAgentAction(action) {
  const payload = action.payload || {};
  if (action.command === "script-agent.operator.prepareDraft") {
    return {
      method: "POST",
      path: "/v0/script-agent/operator/draft/from-runtime",
      body: payload,
    };
  }
  if (action.command === "script-agent.operator.sceneToChat") {
    return {
      method: "POST",
      path: "/v0/script-agent/operator/scene-to-chat",
      body: payload,
    };
  }
  throw new Error(`show_control_script_agent_command_not_supported:${action.command}`);
}

function expectedSituationIdFromPayload(payload = {}) {
  return String(
    payload.situation && payload.situation.situationId
    || payload.runtimeOutput && payload.runtimeOutput.resolvedPreparedNext && payload.runtimeOutput.resolvedPreparedNext.situationId
    || payload.runtimeOutput && payload.runtimeOutput.situation && payload.runtimeOutput.situation.situationId
    || payload.runtimeState && payload.runtimeState.resolvedPreparedNext && payload.runtimeState.resolvedPreparedNext.situationId
    || ""
  ).trim();
}

function responseSituationId(response = {}) {
  return String(
    response.draft && response.draft.situationId
    || response.draft && response.draft.promptInput && response.draft.promptInput.situation && response.draft.promptInput.situation.situationId
    || response.done && response.done.scriptOutput && response.done.scriptOutput.situationId
    || response.scriptOutput && response.scriptOutput.situationId
    || ""
  ).trim();
}

function verifyScriptAgentSituation(action, response = {}) {
  const expected = expectedSituationIdFromPayload(action.payload || {});
  if (!expected) return { expectedSituationId: null, actualSituationId: null };
  const actual = responseSituationId(response);
  if (!actual) {
    throw new Error(`show_control_script_agent_missing_situation_id:${expected}`);
  }
  if (actual !== expected) {
    throw new Error(`show_control_script_agent_situation_mismatch:${expected}:${actual}`);
  }
  return { expectedSituationId: expected, actualSituationId: actual };
}

async function sendScriptAgentCommand(action, context = {}) {
  const options = context.adapterOptions || {};
  const request = requestForScriptAgentAction(action);
  const result = await fetchJson(joinUrl(scriptAgentBaseUrl(options), request.path), {
    method: request.method,
    body: request.body,
    timeoutMs: action.timeoutMs,
  });
  const verification = verifyScriptAgentSituation(action, result.body);
  return {
    stage: "applied",
    state: "ok",
    message: `Script Agent ${request.method} ${request.path}`,
    data: {
      route: `${request.method} ${request.path}`,
      responseStatus: result.status,
      response: result.body,
      ...verification,
    },
  };
}

module.exports = {
  DEFAULT_SCRIPT_AGENT_BASE_URL,
  expectedSituationIdFromPayload,
  requestForScriptAgentAction,
  responseSituationId,
  scriptAgentBaseUrl,
  sendScriptAgentCommand,
  verifyScriptAgentSituation,
};
