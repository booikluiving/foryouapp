"use strict";

const { normalizeAckMode } = require("../command-registry/command-registry");
const { sendOsc } = require("./osc-lite");
const beeld = require("../cue-library/environment-beeld");

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
  // td.samen.beeld: één beeld met de spelers erin; alles uitgerekend in de OSC-args.
  if (action.command === "td.samen.beeld") {
    args.push(...beeld.beeldOscArgs(action.payload || {}));
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
    // Losse laag over elk shot (Lingo-bord): midden x, midden y en breedte als deel van het beeld.
    if (payload.overlay) {
      args.push(String(Number(payload.overlay.x)), String(Number(payload.overlay.y)), String(Number(payload.overlay.breedte)));
    }
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
  // td.effect.speler: per camera spiegelen en zichtbaar ("1", "0" of "-"), en de duur van de fade.
  if (action.command === "td.effect.speler") {
    const payload = action.payload || {};
    args.push(String(payload.spiegel || "---"), String(payload.zichtbaar || "---"), String(Number(payload.fade) || 0));
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

// Eén beeld met de spelers erin (environment-beeld.js). Zolang dat aan staat:
// - is een stap van de knoppen (td.effect.omvallen) een stap in dat beeld, in de uitsnede van nu;
// - kiest een cameraknop de uitsnede dichtbij van die speler.
function beeldOpties(options = {}) {
  return {
    ...(options.catalogMediaRoot ? { catalogMediaRoot: options.catalogMediaRoot } : {}),
    ...(options.beeld !== undefined ? { beeld: options.beeld } : {}),
    ...(options.fileExists ? { fileExists: options.fileExists } : {}),
  };
}

function beeldActieVoor(action, options = {}) {
  const payload = action.payload || {};
  if (action.command === "td.effect.omvallen" && !payload.overlay && beeld.beeldStaatAan(payload.environmentId)) {
    const wens = payload.uit ? { stap: "begin" } : { stap: beeld.stapNaam(payload.filePath), duur: payload.duur };
    const nieuw = beeld.beeldPayload(payload.environmentId, wens, beeldOpties(options));
    return nieuw ? { ...action, command: "td.samen.beeld", payload: { ...payload, ...nieuw } } : null;
  }
  return null;
}

function beeldNaCamera(action, options = {}) {
  if (action.command !== "td.camera.set" || !beeld.beeldStaatAan()) return null;
  const payload = action.payload || {};
  const camera = Math.round(Number(payload.camera));
  if (![1, 2, 3].includes(camera)) return null;
  const environmentId = beeld.actieveOmgeving();
  const nieuw = beeld.beeldPayload(environmentId, { uitsnede: String(camera) }, beeldOpties(options));
  return nieuw ? [`${action.cueId}-beeld`, "td.samen.beeld", "-", ...beeld.beeldOscArgs(nieuw)] : null;
}

async function sendTouchDesignerCommand(inputAction, context = {}) {
  const options = context.adapterOptions || {};
  const action = beeldActieVoor(inputAction, options) || inputAction;
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
  // Na de camera: de uitsnede dichtbij van die speler in het ene beeld.
  const beeldArgs = beeldNaCamera(action, options);
  if (beeldArgs) await sendOscMessage(options, { address: "/td/cue", args: beeldArgs }).catch(() => {});
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
  beeldActieVoor,
  beeldNaCamera,
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
