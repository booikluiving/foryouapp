"use strict";

// Speelt een kort geluid af op de standaard geluidsuitgang van de show-Mac.
// Op de show-Mac is dat "SQ - Audio" (USB naar de SQ-5). Welk SQ-kanaal het
// wordt en of het naar de zaal gaat, regelt de geluidstechnicus op de tafel.

const { spawn } = require("node:child_process");
const fs = require("node:fs");

const AUDIO_EXTENSIONS = /\.(mp3|wav|aif|aiff|m4a|aac|flac)$/i;
let current = null;

function player(options = {}) {
  return String(options.macAudioPlayer || process.env.SHOW_CONTROL_AUDIO_PLAYER || "/usr/bin/afplay");
}

function audioDisabled(options = {}) {
  const value = String(options.macAudio || process.env.SHOW_CONTROL_EXTRA_AUDIO || "on").toLowerCase();
  return value === "off" || value === "0" || value === "uit";
}

function stopCurrent() {
  if (current && current.exitCode === null && !current.killed) {
    try { current.kill("SIGTERM"); } catch (_err) {}
  }
  current = null;
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
  // Nog eens drukken = opnieuw beginnen, niet over elkaar heen.
  stopCurrent();
  const child = spawn(player(options), ["-v", String(volume), filePath], { stdio: "ignore", detached: false });
  child.on("error", () => {});
  child.on("exit", () => {
    if (current === child) current = null;
  });
  current = child;
  return {
    stage: "applied",
    state: "ok",
    message: `speelt ${filePath.split("/").pop()} (volume ${Math.round(volume * 100)}%)`,
    data: { route: "mac-audio", transport: { type: "afplay", pid: child.pid || null } },
  };
}

module.exports = {
  sendMacAudioCommand,
  stopCurrent,
};
