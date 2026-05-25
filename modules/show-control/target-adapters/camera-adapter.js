"use strict";

const { fetchJson, joinUrl } = require("./http-json");

const DEFAULT_CAMERA_BASE_URL = "http://127.0.0.1:3226";

function cameraBaseUrl(options = {}) {
  return String(options.cameraBaseUrl || process.env.V2_SHOW_CONTROL_CAMERA_URL || DEFAULT_CAMERA_BASE_URL).replace(/\/+$/, "");
}

function encode(value) {
  return encodeURIComponent(String(value || ""));
}

function cameraFromPayload(payload = {}) {
  return payload.camera || payload.cameraId || payload.id || "cam1";
}

function normalisedBody(payload = {}) {
  return { normalised: payload.normalised ?? payload.value ?? payload.position ?? 0 };
}

function requestForCameraAction(action) {
  const payload = action.payload || {};
  const command = action.command;
  if (command === "camera.status") return { method: "GET", path: "/api/state", body: undefined };
  if (command === "camera.tally") return {
    method: "POST",
    path: "/api/tally",
    body: { camera: cameraFromPayload(payload), state: payload.state || payload.tally || "none" },
  };
  if (command === "camera.control") return {
    method: "POST",
    path: `/api/camera/${encode(cameraFromPayload(payload))}/control`,
    body: { endpoint: payload.endpoint, value: payload.value || payload.body || {} },
  };
  if (command === "camera.contrast") return {
    method: "POST",
    path: `/api/camera/${encode(cameraFromPayload(payload))}/contrast`,
    body: { pivot: payload.pivot, adjust: payload.adjust },
  };
  if (command === "camera.color") return {
    method: "POST",
    path: `/api/camera/${encode(cameraFromPayload(payload))}/color/${encode(payload.control || payload.color || "lift")}`,
    body: payload.value || {
      red: payload.red,
      green: payload.green,
      blue: payload.blue,
      luma: payload.luma,
    },
  };
  const lens = command.match(/^camera\.(focus|iris|zoom)$/);
  if (lens) {
    return {
      method: "POST",
      path: `/api/camera/${encode(cameraFromPayload(payload))}/${lens[1]}`,
      body: normalisedBody(payload),
    };
  }
  throw new Error(`show_control_camera_command_not_supported:${command}`);
}

async function sendCameraCommand(action, context = {}) {
  const options = context.adapterOptions || {};
  const request = requestForCameraAction(action);
  const result = await fetchJson(joinUrl(cameraBaseUrl(options), request.path), {
    method: request.method,
    body: request.body,
    timeoutMs: action.timeoutMs,
  });
  return {
    stage: "applied",
    state: "ok",
    message: `Camera ${request.method} ${request.path}`,
    data: {
      route: `${request.method} ${request.path}`,
      responseStatus: result.status,
      response: result.body,
    },
  };
}

module.exports = {
  DEFAULT_CAMERA_BASE_URL,
  cameraBaseUrl,
  requestForCameraAction,
  sendCameraCommand,
};
