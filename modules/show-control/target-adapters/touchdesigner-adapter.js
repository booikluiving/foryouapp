"use strict";

const { normalizeAckMode } = require("../command-registry/command-registry");
const { sendOsc } = require("./osc-lite");

const DEFAULT_TD_OSC_HOST = "127.0.0.1";
const DEFAULT_TD_OSC_PORT = 9100;
const DEFAULT_TD_ACK_PORT = 9101;

function tdOscHost(options = {}) {
  return String(options.tdOscHost || process.env.V2_SHOW_CONTROL_TD_OSC_HOST || DEFAULT_TD_OSC_HOST);
}

function tdOscPort(options = {}) {
  return Number(options.tdOscPort || process.env.V2_SHOW_CONTROL_TD_OSC_PORT || DEFAULT_TD_OSC_PORT);
}

function showControlAckPort(options = {}) {
  return Number(options.tdAckPort || process.env.V2_SHOW_CONTROL_TD_ACK_PORT || DEFAULT_TD_ACK_PORT);
}

function oscArgsForAction(action) {
  return [action.cueId, action.command, action.payloadId || "-"];
}

function normalizeTdAck(raw = {}) {
  const args = Array.isArray(raw.args)
    ? raw.args.map((arg) => (arg && typeof arg === "object" && Object.prototype.hasOwnProperty.call(arg, "value") ? arg.value : arg))
    : [];
  if (raw.address === "/td/ack" || args.length) {
    return {
      cueId: String(args[0] || raw.cueId || ""),
      command: String(args[1] || raw.command || ""),
      stage: String(args[2] || raw.stage || "received"),
      state: String(args[3] || raw.state || raw.status || "ok"),
      message: args[4] == null ? raw.message || null : String(args[4]),
    };
  }
  return {
    cueId: String(raw.cueId || ""),
    command: String(raw.command || ""),
    stage: String(raw.stage || "received"),
    state: String(raw.state || raw.status || "ok"),
    message: raw.message || null,
  };
}

function sendOscMessage(options, message) {
  return sendOsc({
    host: tdOscHost(options),
    port: tdOscPort(options),
    address: message.address,
    args: message.args,
  });
}

function expectedStagesFor(action) {
  const mode = normalizeAckMode(action.ackMode);
  if (mode === "required-ready") return ["loaded", "visible", "applied", "warning", "failed", "error"];
  return ["received", "applied", "loaded", "visible", "warning", "failed", "error"];
}

async function sendTouchDesignerCommand(action, context = {}) {
  const options = context.adapterOptions || {};
  const args = oscArgsForAction(action);
  await sendOscMessage(options, {
    address: "/td/cue",
    args,
  });
  return {
    stage: "sent",
    state: "pending",
    message: `TD OSC /td/cue ${args.join(" ")}`,
    data: {
      transport: {
        type: "osc",
        host: tdOscHost(options),
        port: tdOscPort(options),
        ackPort: showControlAckPort(options),
        address: "/td/cue",
        args,
      },
      expectedAckStages: expectedStagesFor(action),
    },
  };
}

module.exports = {
  DEFAULT_TD_ACK_PORT,
  DEFAULT_TD_OSC_HOST,
  DEFAULT_TD_OSC_PORT,
  expectedStagesFor,
  normalizeTdAck,
  oscArgsForAction,
  sendTouchDesignerCommand,
  showControlAckPort,
  tdOscHost,
  tdOscPort,
};
