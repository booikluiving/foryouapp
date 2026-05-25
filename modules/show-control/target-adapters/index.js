"use strict";

const { sendCameraCommand } = require("./camera-adapter");
const { sendContractCommand, sendDebugCommand } = require("./mock-contract-adapter");
const { sendPerfectCueCommand } = require("./perfect-cue-adapter");
const { sendRuntimeCommand } = require("./runtime-adapter");
const { sendSq5Command } = require("./sq5-adapter");
const { sendStreamDeckCommand } = require("./streamdeck-adapter");
const { sendTouchDesignerCommand } = require("./touchdesigner-adapter");

function createAdapters(overrides = {}) {
  return {
    runtime: overrides.runtime || sendRuntimeCommand,
    sq5: overrides.sq5 || sendSq5Command,
    camera: overrides.camera || sendCameraCommand,
    touchdesigner: overrides.touchdesigner || sendTouchDesignerCommand,
    streamdeck: overrides.streamdeck || sendStreamDeckCommand,
    perfectcue: overrides.perfectcue || sendPerfectCueCommand,
    keyboard: overrides.keyboard || sendPerfectCueCommand,
    teleprompter: overrides.teleprompter || sendContractCommand,
    debug: overrides.debug || sendDebugCommand,
  };
}

module.exports = {
  createAdapters,
};
