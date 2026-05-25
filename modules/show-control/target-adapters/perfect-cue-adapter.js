"use strict";

const { fetchJson, joinUrl } = require("./http-json");

const DEFAULT_PERFECT_CUE_BASE_URL = "http://127.0.0.1:3228";

function perfectCueBaseUrl(options = {}) {
  return String(options.perfectCueBaseUrl || process.env.V2_SHOW_CONTROL_PERFECT_CUE_URL || DEFAULT_PERFECT_CUE_BASE_URL).replace(/\/+$/, "");
}

function requestForPerfectCueAction(action) {
  const payload = action.payload || {};
  if (action.command === "perfectCue.trigger" || action.command === "keyboard.trigger") {
    return {
      method: "POST",
      path: "/api/trigger",
      body: {
        ...payload,
        source: payload.source || (action.command === "keyboard.trigger" ? "keyboard" : "perfect-cue"),
      },
    };
  }
  throw new Error(`show_control_perfect_cue_command_not_supported:${action.command}`);
}

async function sendPerfectCueCommand(action, context = {}) {
  const options = context.adapterOptions || {};
  const request = requestForPerfectCueAction(action);
  const result = await fetchJson(joinUrl(perfectCueBaseUrl(options), request.path), {
    method: request.method,
    body: request.body,
    timeoutMs: action.timeoutMs,
  });
  return {
    stage: "applied",
    state: "ok",
    message: `Perfect Cue ${request.method} ${request.path}`,
    data: {
      route: `${request.method} ${request.path}`,
      responseStatus: result.status,
      response: result.body,
    },
  };
}

module.exports = {
  DEFAULT_PERFECT_CUE_BASE_URL,
  perfectCueBaseUrl,
  requestForPerfectCueAction,
  sendPerfectCueCommand,
};
