"use strict";

// Speelt een kort geluid af op de standaard geluidsuitgang van de show-Mac.
// Op de show-Mac is dat "SQ - Audio" (USB naar de SQ-5). Welk SQ-kanaal het
// wordt en of het naar de zaal gaat, regelt de geluidstechnicus op de tafel.

const { spawn } = require("node:child_process");
const fs = require("node:fs");
const { sendOsc } = require("./osc-lite");
const { tdOscHost, tdOscPort } = require("./touchdesigner-adapter");

const AUDIO_EXTENSIONS = /\.(mp3|wav|aif|aiff|m4a|aac|flac)$/i;
function player(options = {}) {
  return String(options.macAudioPlayer || process.env.SHOW_CONTROL_AUDIO_PLAYER || "/usr/bin/afplay");
}

function audioDisabled(options = {}) {
  const value = String(options.macAudio || process.env.SHOW_CONTROL_EXTRA_AUDIO || "on").toLowerCase();
  return value === "off" || value === "0" || value === "uit";
}

// Drie sporen: "lied" is het extra geluid van de omgeving (wisselknop, mag lang duren),
// "effect" zijn de korte geluiden van stappen (omvallen, fases), "intro" is het startgeluid van
// de scène. De sporen kappen elkaar niet af.
const sporen = { lied: { child: null, file: "" }, effect: { child: null, file: "" }, intro: { child: null, file: "" } };

// Dempen: zolang een lied met dempSfeer speelt staat het sfeergeluid in TouchDesigner op nul.
// Hier staat waar het daarna naar terug moet.
let gedempt = null;

function stuurSfeerVolume(options, volume) {
  if (typeof options.sfeerVolumeSender === "function") {
    try { options.sfeerVolumeSender(volume); } catch (_err) {}
    return;
  }
  sendOsc({
    host: tdOscHost(options),
    port: tdOscPort(options),
    address: "/td/cue",
    args: [`mac-audio-sfeer-${Date.now()}`, "td.sfeer.volume", "-", String(volume)],
  }).catch(() => {});
}

function dempSfeer(options, terug) {
  const volume = Math.min(1, Math.max(0, Number.isFinite(Number(terug)) ? Number(terug) : 1));
  gedempt = { terug: volume, options };
  stuurSfeerVolume(options, 0);
}

function herstelSfeer() {
  if (!gedempt) return;
  const { terug, options } = gedempt;
  gedempt = null;
  stuurSfeerVolume(options, terug);
}

function stopSpoor(naam) {
  const spoor = sporen[naam];
  if (spoor.child && spoor.child.exitCode === null && !spoor.child.killed) {
    try { spoor.child.kill("SIGTERM"); } catch (_err) {}
  }
  spoor.child = null;
  spoor.file = "";
  if (naam === "lied") herstelSfeer();
}

function stopCurrent() {
  stopSpoor("lied");
  stopSpoor("effect");
  stopSpoor("intro");
}

function isPlaying(naam, filePath) {
  const spoor = sporen[naam];
  return Boolean(spoor.child && spoor.child.exitCode === null && !spoor.child.killed && spoor.file === filePath);
}

async function sendMacAudioCommand(action, context = {}) {
  const options = context.adapterOptions || {};
  const payload = action.payload || {};
  if (action.command === "audio.extra.stop") {
    // Einde van de scène: alleen de intro en een lied dat het sfeergeluid dempt gaan uit;
    // een extra geluid in een lus (de plas) mag doorlopen zoals het deed.
    if (payload.alleen === "scene") {
      stopSpoor("intro");
      if (gedempt) stopSpoor("lied");
      return { stage: "applied", state: "ok", message: "intro en gedempt lied gestopt" };
    }
    stopCurrent();
    return { stage: "applied", state: "ok", message: "extra geluid gestopt" };
  }
  if (action.command !== "audio.extra.play") {
    throw new Error(`show_control_mac_audio_command_not_supported:${action.command}`);
  }
  const filePath = String(payload.filePath || "");
  if (!filePath || !AUDIO_EXTENSIONS.test(filePath)) throw new Error("show_control_mac_audio_invalid_file");
  if (!fs.existsSync(filePath)) throw new Error("show_control_mac_audio_file_missing");
  const volume = Math.min(1, Math.max(0, Number(payload.volume ?? 1)));
  if (audioDisabled(options)) {
    return { stage: "applied", state: "warning", warning: true, message: "extra geluid staat uit (SHOW_CONTROL_EXTRA_AUDIO=off)" };
  }
  const naam = payload.wissel ? "lied" : payload.spoor === "intro" ? "intro" : "effect";
  // Wisselknop: speelt dit geluid nog, dan zet een druk het uit; de druk daarna begint weer vooraan.
  if (payload.wissel && isPlaying("lied", filePath)) {
    stopSpoor("lied");
    return { stage: "applied", state: "ok", message: `${filePath.split("/").pop()} uit`, data: { route: "mac-audio", gestopt: true } };
  }
  // Een effect kan het lied uitzetten (de bom stopt het piepje).
  if (payload.stopLied) stopSpoor("lied");
  // Binnen een spoor: nog eens drukken = opnieuw beginnen, niet over elkaar heen.
  stopSpoor(naam);
  const spoor = sporen[naam];
  const lus = payload.lus === true && naam === "lied";
  const start = () => {
    const child = spawn(player(options), ["-v", String(volume), filePath], { stdio: "ignore", detached: false });
    child.on("error", () => {});
    child.on("exit", (code) => {
      if (spoor.child !== child) return;
      // In een lus: afgelopen (niet gestopt) = opnieuw vanaf het begin.
      if (lus && code === 0) {
        start();
        return;
      }
      spoor.child = null;
      spoor.file = "";
      // Het lied is afgelopen: het sfeergeluid komt terug.
      if (naam === "lied") herstelSfeer();
    });
    spoor.child = child;
    spoor.file = filePath;
    return child;
  };
  const child = start();
  if (naam === "lied" && payload.dempSfeer) dempSfeer(options, payload.dempSfeer.terug);
  return {
    stage: "applied",
    state: "ok",
    message: `speelt ${filePath.split("/").pop()} (volume ${Math.round(volume * 100)}%)`,
    data: { route: "mac-audio", spoor: naam, transport: { type: "afplay", pid: child.pid || null } },
  };
}

module.exports = {
  sendMacAudioCommand,
  stopCurrent,
};
