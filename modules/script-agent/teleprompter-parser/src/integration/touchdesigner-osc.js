"use strict";

const dgram = require("node:dgram");

const DEFAULT_TD_OSC_HOST = "127.0.0.1";
const DEFAULT_TD_STAGE_OSC_PORT = 8008;
const DEFAULT_TD_PULSE_RESET_MS = 220;
const CAMERA_ADDRESSES = Object.freeze({
  1: "/osc/osc25",
  2: "/osc/osc26",
  3: "/osc/osc27",
});

function clampInt(value, min, max, fallback) {
  const numeric = Number.parseInt(String(value), 10);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.max(min, Math.min(max, numeric));
}

function pad4Length(length) {
  return length + ((4 - (length % 4)) % 4);
}

function stringBuffer(value) {
  const raw = Buffer.from(String(value == null ? "" : value), "utf8");
  const length = pad4Length(raw.length + 1);
  const buffer = Buffer.alloc(length);
  raw.copy(buffer, 0);
  return buffer;
}

function intBuffer(value) {
  const buffer = Buffer.alloc(4);
  buffer.writeInt32BE(Number(value || 0), 0);
  return buffer;
}

function encodeOscMessage(address, args = []) {
  const typeTags = `,${args.map((arg) => String(arg && arg.type || "s")).join("")}`;
  return Buffer.concat([
    stringBuffer(address),
    stringBuffer(typeTags),
    ...args.map((arg) => {
      const type = String(arg && arg.type || "s");
      if (type === "i") return intBuffer(arg.value);
      return stringBuffer(arg && arg.value);
    }),
  ]);
}

function sendPacket({ host, port, address, args }) {
  const socket = dgram.createSocket("udp4");
  const packet = encodeOscMessage(address, args);
  return new Promise((resolve, reject) => {
    socket.send(packet, Number(port), String(host), (err) => {
      socket.close();
      if (err) reject(err);
      else resolve();
    });
  });
}

function tdOscHost(env = process.env) {
  return String(env.V2_SCRIPT_AGENT_TELEPROMPTER_TD_OSC_HOST || DEFAULT_TD_OSC_HOST).trim() || DEFAULT_TD_OSC_HOST;
}

function tdStageOscPort(env = process.env) {
  return clampInt(env.V2_SCRIPT_AGENT_TELEPROMPTER_TD_STAGE_OSC_PORT, 1, 65535, DEFAULT_TD_STAGE_OSC_PORT);
}

function tdPulseResetMs(env = process.env) {
  return clampInt(env.V2_SCRIPT_AGENT_TELEPROMPTER_TD_PULSE_RESET_MS, 20, 1000, DEFAULT_TD_PULSE_RESET_MS);
}

function sendTouchDesignerPulse(address, options = {}) {
  const env = options.env || process.env;
  const oscAddress = String(address || "").trim();
  const host = tdOscHost(env);
  const port = tdStageOscPort(env);
  const resetMs = tdPulseResetMs(env);
  const source = String(options.source || "unknown").slice(0, 120);
  if (!oscAddress) return { sent: false, reason: "address_required", source };

  sendPacket({
    host,
    port,
    address: oscAddress,
    args: [{ type: "i", value: 1 }],
  }).then(() => {
    const timer = setTimeout(() => {
      sendPacket({
        host,
        port,
        address: oscAddress,
        args: [{ type: "i", value: 0 }],
      }).catch(() => {});
    }, resetMs);
    if (timer && typeof timer.unref === "function") timer.unref();
  }).catch(() => {});

  return { sent: true, address: oscAddress, targetHost: host, targetPort: port, source };
}

function sendTouchDesignerCameraPulse(slot, options = {}) {
  const numericSlot = clampInt(slot, 1, 3, 0);
  const address = CAMERA_ADDRESSES[numericSlot] || "";
  return sendTouchDesignerPulse(address, {
    ...options,
    source: `camera_${numericSlot}:${options.source || "teleprompter_auto_camera"}`,
  });
}

module.exports = {
  CAMERA_ADDRESSES,
  DEFAULT_TD_OSC_HOST,
  DEFAULT_TD_PULSE_RESET_MS,
  DEFAULT_TD_STAGE_OSC_PORT,
  encodeOscMessage,
  sendTouchDesignerCameraPulse,
  sendTouchDesignerPulse,
};
