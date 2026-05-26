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

async function sendScriptAgentCommand(action, context = {}) {
  const options = context.adapterOptions || {};
  const request = requestForScriptAgentAction(action);
  const result = await fetchJson(joinUrl(scriptAgentBaseUrl(options), request.path), {
    method: request.method,
    body: request.body,
    timeoutMs: action.timeoutMs,
  });
  return {
    stage: "applied",
    state: "ok",
    message: `Script Agent ${request.method} ${request.path}`,
    data: {
      route: `${request.method} ${request.path}`,
      responseStatus: result.status,
      response: result.body,
    },
  };
}

module.exports = {
  DEFAULT_SCRIPT_AGENT_BASE_URL,
  requestForScriptAgentAction,
  scriptAgentBaseUrl,
  sendScriptAgentCommand,
};
