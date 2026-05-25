"use strict";

const { recordAck } = require("../cue-engine/ack-tracker");
const { applyAck } = require("../cue-engine/cue-engine");
const { readCue, saveCue } = require("../cue-engine/state-store");
const {
  DEFAULT_TD_ACK_PORT,
  normalizeTdAck,
  showControlAckPort,
} = require("../target-adapters/touchdesigner-adapter");
const { createOscServer } = require("../target-adapters/osc-lite");

function ackListenHost(options = {}) {
  return String(options.tdAckHost || process.env.V2_SHOW_CONTROL_TD_ACK_HOST || "127.0.0.1");
}

async function storeAck(payload) {
  try {
    const cue = await readCue(payload.cueId);
    const result = applyAck(cue, payload);
    await saveCue(result.cue);
    return result.ack;
  } catch (err) {
    if (!String(err && err.message).startsWith("show_control_cue_not_found:")) throw err;
    return recordAck(payload);
  }
}

function startTdAckServer(options = {}) {
  if (options.disableTdAckServer || process.env.V2_SHOW_CONTROL_TD_ACK_DISABLED === "1") return null;
  const localAddress = ackListenHost(options);
  const localPort = Number(options.tdAckPort || showControlAckPort(options) || DEFAULT_TD_ACK_PORT);
  const server = createOscServer({
    host: localAddress,
    port: localPort,
    onMessage: (message) => {
      if (message.error) {
        process.stderr.write(`Show Control TD ack OSC decode error: ${message.error.message || message.error}\n`);
        return;
      }
      const ack = {
        ...normalizeTdAck(message),
        targetId: "touchdesigner",
      };
      if (!ack.cueId || !ack.command) return;
      storeAck(ack).catch((err) => {
        process.stderr.write(`Show Control TD ack store failed: ${err.message || err}\n`);
      });
    },
  });
  return {
    close() {
      server.close();
    },
    localAddress,
    localPort,
  };
}

module.exports = {
  startTdAckServer,
  storeAck,
};
