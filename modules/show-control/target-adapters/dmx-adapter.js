"use strict";

const { fetchJson, joinUrl } = require("./http-json");

const DEFAULT_DMX_BASE_URL = "http://127.0.0.1:3229";

function dmxBaseUrl(options = {}) {
  return String(options.dmxBaseUrl || process.env.V2_SHOW_CONTROL_DMX_URL || DEFAULT_DMX_BASE_URL).replace(/\/+$/, "");
}

function passThroughPayload(payload = {}) {
  return { ...payload };
}

function requestForDmxAction(action) {
  const payload = action.payload || {};
  const command = action.command;
  if (command === "dmx.status") return { method: "GET", path: "/api/state", body: undefined };
  if (command === "dmx.config") return { method: "POST", path: "/api/config", body: passThroughPayload(payload) };
  if (command === "dmx.stop") return { method: "POST", path: "/api/stop", body: passThroughPayload(payload) };
  if (command === "dmx.blackout") return { method: "POST", path: "/api/blackout", body: passThroughPayload(payload) };
  if (command === "dmx.preset") return {
    method: "POST",
    path: "/api/preset",
    body: {
      ...passThroughPayload(payload),
      preset: payload.preset || payload.name || payload.look || "auto",
    },
  };
  if (command === "dmx.look") return {
    method: "POST",
    path: "/api/look",
    body: {
      label: payload.label || payload.name || "show-control-look",
      clearFirst: payload.clearFirst !== false,
      holdMs: payload.holdMs ?? 700,
      continuous: payload.continuous === true,
      start: payload.start === true,
      channels: payload.channels || {},
      fill: payload.fill,
      targetIp: payload.targetIp,
      universe: payload.universe,
      frameRate: payload.frameRate,
    },
  };
  throw new Error(`show_control_dmx_command_not_supported:${command}`);
}

async function sendDmxCommand(action, context = {}) {
  const options = context.adapterOptions || {};
  const request = requestForDmxAction(action);
  const result = await fetchJson(joinUrl(dmxBaseUrl(options), request.path), {
    method: request.method,
    body: request.body,
    timeoutMs: action.timeoutMs,
  });
  return {
    stage: "applied",
    state: "ok",
    message: `DMX ${request.method} ${request.path}`,
    data: {
      route: `${request.method} ${request.path}`,
      responseStatus: result.status,
      response: result.body,
    },
  };
}

module.exports = {
  DEFAULT_DMX_BASE_URL,
  dmxBaseUrl,
  requestForDmxAction,
  sendDmxCommand,
};
