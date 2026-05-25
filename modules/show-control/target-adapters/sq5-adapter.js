"use strict";

const { fetchJson, joinUrl } = require("./http-json");

const DEFAULT_SQ5_BASE_URL = "http://127.0.0.1:3225";

function sq5BaseUrl(options = {}) {
  return String(options.sq5BaseUrl || process.env.V2_SHOW_CONTROL_SQ5_URL || DEFAULT_SQ5_BASE_URL).replace(/\/+$/, "");
}

function encode(value) {
  return encodeURIComponent(String(value || ""));
}

function channelFromPayload(payload = {}) {
  return payload.channel || payload.input || payload.name || payload.mic || "brent";
}

function outputFromPayload(payload = {}) {
  return payload.output || payload.group || payload.name || "main";
}

function payloadWithoutRouting(payload = {}, omitted = []) {
  const result = { ...payload };
  for (const key of omitted) delete result[key];
  return result;
}

function requestForSq5Action(action) {
  const payload = action.payload || {};
  const command = action.command;
  if (command === "sq5.status") return { method: "GET", path: "/api/status", body: undefined };
  if (command === "sq5.scene.recall") return { method: "POST", path: "/api/scene", body: { scene: payload.scene || payload.sceneNumber } };
  if (command === "sq5.softkey") return {
    method: "POST",
    path: "/api/softkey",
    body: { softKey: payload.softKey || payload.key, action: payload.action || "tap" },
  };

  if (command.startsWith("sq5.input.")) {
    const actionName = command.slice("sq5.input.".length);
    return {
      method: "POST",
      path: `/api/input/${encode(channelFromPayload(payload))}/${encode(actionName)}`,
      body: payloadWithoutRouting(payload, ["channel", "input", "name", "mic"]),
    };
  }

  if (command.startsWith("sq5.output.")) {
    const actionName = command.slice("sq5.output.".length);
    return {
      method: "POST",
      path: `/api/output/${encode(outputFromPayload(payload))}/${encode(actionName)}`,
      body: payloadWithoutRouting(payload, ["output", "group", "name"]),
    };
  }

  throw new Error(`show_control_sq5_command_not_supported:${command}`);
}

async function sendSq5Command(action, context = {}) {
  const options = context.adapterOptions || {};
  const request = requestForSq5Action(action);
  const result = await fetchJson(joinUrl(sq5BaseUrl(options), request.path), {
    method: request.method,
    body: request.body,
    timeoutMs: action.timeoutMs,
  });
  return {
    stage: "applied",
    state: "ok",
    message: `SQ5 ${request.method} ${request.path}`,
    data: {
      route: `${request.method} ${request.path}`,
      responseStatus: result.status,
      response: result.body,
    },
  };
}

module.exports = {
  DEFAULT_SQ5_BASE_URL,
  requestForSq5Action,
  sendSq5Command,
  sq5BaseUrl,
};
