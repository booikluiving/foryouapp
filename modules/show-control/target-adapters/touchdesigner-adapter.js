"use strict";

const { normalizeAckMode } = require("../command-registry/command-registry");
const { sendOsc } = require("./osc-lite");

const DEFAULT_TD_OSC_HOST = "127.0.0.1";
const DEFAULT_TD_OSC_PORT = 9100;
const DEFAULT_TD_ACK_PORT = 9101;

function tdOscHost(options = {}) {
  return String(options.tdOscHost || process.env.SHOW_CONTROL_TD_OSC_HOST || DEFAULT_TD_OSC_HOST);
}

function tdOscPort(options = {}) {
  return Number(options.tdOscPort || process.env.SHOW_CONTROL_TD_OSC_PORT || DEFAULT_TD_OSC_PORT);
}

function showControlAckPort(options = {}) {
  return Number(options.tdAckPort || process.env.SHOW_CONTROL_TD_ACK_PORT || DEFAULT_TD_ACK_PORT);
}

function oscArgsForAction(action) {
  const args = [action.cueId, action.command, action.payloadId || "-"];
  // td.extra.shot: alles wat TD nodig heeft zit in de OSC-args, zodat TD de
  // payload niet synchroon hoeft op te halen (dat laat TD bevriezen).
  if (action.command === "td.extra.shot") {
    const payload = action.payload || {};
    args.push(String(payload.filePath || ""), String(Number(payload.duur) || 0), payload.uit ? "1" : "0");
  }
  // td.samen.shot: twee camera's naast elkaar; alles in de OSC-args.
  if (action.command === "td.samen.shot") {
    const payload = action.payload || {};
    const cameras = Array.isArray(payload.cameras) ? payload.cameras : [];
    args.push(
      payload.uit ? "1" : "0",
      String(Number(cameras[0]) || 2),
      String(Number(cameras[1]) || 3),
      String(payload.achtergrond || ""),
      String(payload.voorgrond || ""),
      String(Number(payload.schaal) || 0.6),
      String(Number(payload.omhoog) || 0),
    );
  }
  // td.sfeer.volume: het volume (0-1) van het sfeergeluid dat nu klaarstaat.
  if (action.command === "td.sfeer.volume") {
    const payload = action.payload || {};
    args.push(String(Number(payload.volume)));
  }
  // td.effect.omvallen: clip en uit in de OSC-args, om dezelfde reden.
  if (action.command === "td.effect.omvallen") {
    const payload = action.payload || {};
    args.push(String(payload.filePath || ""), payload.uit ? "1" : "0", String(Number(payload.duur) || 0));
  }
  // td.effect.fase: beeld, uit, schok, de wachttijd tot de klap en het sfeergeluid in de OSC-args.
  if (action.command === "td.effect.fase") {
    const payload = action.payload || {};
    args.push(String(payload.filePath || ""), payload.uit ? "1" : "0", payload.schok ? "1" : "0", String(Number(payload.schokNa) || 0), String(payload.sfeerPath || ""));
  }
  // td.effect.haper: welke camera hapert en hoe erg (0 = uit) in de OSC-args.
  if (action.command === "td.effect.haper") {
    const payload = action.payload || {};
    args.push(String(Number(payload.camera) || 0), String(Number(payload.sterkte) || 0));
  }
  return args;
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

// Een cameraknop wint altijd van het extra shot: staat er nog een shot van een
// omgeving over het beeld, dan gaat dat eerst weg. Zonder shot doet dit niets.
function shotUitArgsFor(action) {
  if (action.command !== "td.camera.set") return null;
  return [`${action.cueId}-shot-uit`, "td.extra.shot", "-", "", "0", "1"];
}

async function sendTouchDesignerCommand(action, context = {}) {
  const options = context.adapterOptions || {};
  const shotUitArgs = shotUitArgsFor(action);
  if (shotUitArgs) {
    // Een shot dat bleef staan (duur 0) is nu ook weg: de volgende druk toont hem weer.
    const extras = require("../cue-library/environment-extras");
    const samenAan = extras.samenStaatAan();
    extras.resetHoldState();
    await sendOscMessage(options, { address: "/td/cue", args: shotUitArgs }).catch(() => {});
    // Hetzelfde voor het gezamenlijke shot, alleen als dat aan staat.
    if (samenAan) {
      await sendOscMessage(options, { address: "/td/cue", args: [`${action.cueId}-samen-uit`, "td.samen.shot", "-", "1"] }).catch(() => {});
    }
  }
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
  shotUitArgsFor,
  showControlAckPort,
  tdOscHost,
  tdOscPort,
};
