"use strict";

// Speelt een kort geluid af op de standaard geluidsuitgang van de show-Mac.
// Op de show-Mac is dat "SQ - Audio" (USB naar de SQ-5). Welk SQ-kanaal het
// wordt en of het naar de zaal gaat, regelt de geluidstechnicus op de tafel.

const { spawn } = require("node:child_process");
const fs = require("node:fs");

const AUDIO_EXTENSIONS = /\.(mp3|wav|aif|aiff|m4a|aac|flac)$/i;
function player(options = {}) {
  return String(options.macAudioPlayer || process.env.SHOW_CONTROL_AUDIO_PLAYER || "/usr/bin/afplay");
}

function audioDisabled(options = {}) {
  const value = String(options.macAudio || process.env.SHOW_CONTROL_EXTRA_AUDIO || "on").toLowerCase();
  return value === "off" || value === "0" || value === "uit";
}

// Twee sporen: "lied" is het extra geluid van de omgeving (wisselknop, mag lang duren),
// "effect" zijn de korte geluiden van stappen (omvallen, fases). Een effect kapt het lied niet af.
const sporen = { lied: { child: null, file: "" }, effect: { child: null, file: "" } };

function stopSpoor(naam) {
  const spoor = sporen[naam];
  if (spoor.child && spoor.child.exitCode === null && !spoor.child.killed) {
    try { spoor.child.kill("SIGTERM"); } catch (_err) {}
  }
  spoor.child = null;
  spoor.file = "";
}

function stopCurrent() {
  stopSpoor("lied");
  stopSpoor("effect");
}

function isPlaying(naam, filePath) {
  const spoor = sporen[naam];
  return Boolean(spoor.child && spoor.child.exitCode === null && !spoor.child.killed && spoor.file === filePath);
}

async function sendMacAudioCommand(action, context = {}) {
  const options = context.adapterOptions || {};
  const payload = action.payload || {};
  if (action.command === "audio.extra.stop") {
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
  const naam = payload.wissel ? "lied" : "effect";
  // Wisselknop: speelt dit geluid nog, dan zet een druk het uit; de druk daarna begint weer vooraan.
  if (payload.wissel && isPlaying("lied", filePath)) {
    stopSpoor("lied");
    return { stage: "applied", state: "ok", message: `${filePath.split("/").pop()} uit`, data: { route: "mac-audio", gestopt: true } };
  }
  // Een effect kan het lied uitzetten (de bom stopt het piepje).
  if (payload.stopLied) stopSpoor("lied");
  // Binnen een spoor: nog eens drukken = opnieuw beginnen, niet over elkaar heen.
  stopSpoor(naam);
  const child = spawn(player(options), ["-v", String(volume), filePath], { stdio: "ignore", detached: false });
  const spoor = sporen[naam];
  child.on("error", () => {});
  child.on("exit", () => {
    if (spoor.child === child) {
      spoor.child = null;
      spoor.file = "";
    }
  });
  spoor.child = child;
  spoor.file = filePath;
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
