"use strict";

const { fetchJson, joinUrl } = require("./http-json");

const DEFAULT_STREAMDECK_BASE_URL = "http://127.0.0.1:3227";

function streamDeckBaseUrl(options = {}) {
  return String(options.streamDeckBaseUrl || process.env.V2_SHOW_CONTROL_STREAMDECK_URL || DEFAULT_STREAMDECK_BASE_URL).replace(/\/+$/, "");
}

function encode(value) {
  return encodeURIComponent(String(value || ""));
}

function requestForStreamDeckAction(action) {
  const payload = action.payload || {};
  if (action.command === "streamdeck.status") {
    return {
      method: "POST",
      path: "/api/status",
      body: payload,
    };
  }
  if (action.command === "streamdeck.button") {
    const button = payload.button || payload.buttonId || payload.target || "button";
    return {
      method: "POST",
      path: `/api/buttons/${encode(button)}`,
      body: payload,
    };
  }
  throw new Error(`show_control_streamdeck_command_not_supported:${action.command}`);
}

async function sendStreamDeckCommand(action, context = {}) {
  const options = context.adapterOptions || {};
  const request = requestForStreamDeckAction(action);
  const result = await fetchJson(joinUrl(streamDeckBaseUrl(options), request.path), {
    method: request.method,
    body: request.body,
    timeoutMs: action.timeoutMs,
  });
  return {
    stage: "applied",
    state: "ok",
    message: `Stream Deck ${request.method} ${request.path}`,
    data: {
      route: `${request.method} ${request.path}`,
      responseStatus: result.status,
      response: result.body,
    },
  };
}

module.exports = {
  DEFAULT_STREAMDECK_BASE_URL,
  requestForStreamDeckAction,
  sendStreamDeckCommand,
  streamDeckBaseUrl,
};
