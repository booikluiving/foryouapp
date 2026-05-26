"use strict";

const { sendCameraCommand } = require("./camera-adapter");
const { sendDmxCommand } = require("./dmx-adapter");
const { sendDebugCommand } = require("./mock-contract-adapter");
const { sendPerfectCueCommand } = require("./perfect-cue-adapter");
const { sendRuntimeCommand } = require("./runtime-adapter");
const { sendScriptAgentCommand } = require("./script-agent-adapter");
const { sendSq5Command } = require("./sq5-adapter");
const { sendStreamDeckCommand } = require("./streamdeck-adapter");
const { sendTeleprompterCommand } = require("./teleprompter-adapter");
const { sendTouchDesignerCommand } = require("./touchdesigner-adapter");

function createAdapters(overrides = {}) {
  return {
    runtime: overrides.runtime || sendRuntimeCommand,
    scriptagent: overrides.scriptagent || sendScriptAgentCommand,
    sq5: overrides.sq5 || sendSq5Command,
    camera: overrides.camera || sendCameraCommand,
    dmx: overrides.dmx || sendDmxCommand,
    touchdesigner: overrides.touchdesigner || sendTouchDesignerCommand,
    streamdeck: overrides.streamdeck || sendStreamDeckCommand,
    perfectcue: overrides.perfectcue || sendPerfectCueCommand,
    keyboard: overrides.keyboard || sendPerfectCueCommand,
    teleprompter: overrides.teleprompter || sendTeleprompterCommand,
    debug: overrides.debug || sendDebugCommand,
  };
}

module.exports = {
  createAdapters,
};
