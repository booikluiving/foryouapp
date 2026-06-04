"use strict";

const { fetchJson, joinUrl } = require("./http-json");

const DEFAULT_SCRIPT_AGENT_BASE_URL = "http://127.0.0.1:3027";

function scriptAgentBaseUrl(options = {}) {
  return String(
    options.scriptAgentBaseUrl
    || process.env.V2_SHOW_CONTROL_SCRIPT_AGENT_URL
    || process.env.V2_SHOW_CONTROL_TELEPROMPTER_URL
    || DEFAULT_SCRIPT_AGENT_BASE_URL
  ).replace(/\/+$/, "");
}

function requestForTeleprompterAction(action) {
  const payload = action.payload || {};
  if (action.command === "teleprompter.prepare") {
    return { method: "POST", path: "/v0/script-agent/teleprompter-parser/prepare", body: payload };
  }
  if (action.command === "teleprompter.ready") {
    return {
      method: "POST",
      path: "/v0/script-agent/teleprompter-parser/ready",
      body: { ready: Object.prototype.hasOwnProperty.call(payload, "ready") ? payload.ready : true },
    };
  }
  if (action.command === "teleprompter.reveal") {
    return { method: "POST", path: "/v0/script-agent/teleprompter-parser/reveal", body: payload };
  }
  if (action.command === "teleprompter.cue") {
    return {
      method: "POST",
      path: "/v0/script-agent/teleprompter-parser/cue/advance",
      body: {
        ...payload,
        direction: payload.direction || payload.action || "next",
        source: payload.source || "show-control",
      },
    };
  }
  throw new Error(`show_control_teleprompter_command_not_supported:${action.command}`);
}

async function sendTeleprompterCommand(action, context = {}) {
  const options = context.adapterOptions || {};
  const request = requestForTeleprompterAction(action);
  const result = await fetchJson(joinUrl(scriptAgentBaseUrl(options), request.path), {
    method: request.method,
    body: request.body,
    timeoutMs: action.timeoutMs,
  });
  return {
    stage: "applied",
    state: "ok",
    message: `Teleprompter ${request.method} ${request.path}`,
    data: {
      route: `${request.method} ${request.path}`,
      responseStatus: result.status,
      response: result.body,
    },
  };
}

module.exports = {
  DEFAULT_SCRIPT_AGENT_BASE_URL,
  requestForTeleprompterAction,
  scriptAgentBaseUrl,
  sendTeleprompterCommand,
};
