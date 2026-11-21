"use strict";

// Speelt een kort geluid af op de standaard geluidsuitgang van de show-Mac.
// Op de show-Mac is dat "SQ - Audio" (USB naar de SQ-5). Welk SQ-kanaal het
// wordt en of het naar de zaal gaat, regelt de geluidstechnicus op de tafel.

const { spawn } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const { sendOsc } = require("./osc-lite");
const { tdOscHost, tdOscPort } = require("./touchdesigner-adapter");

const AUDIO_EXTENSIONS = /\.(mp3|wav|aif|aiff|m4a|aac|flac)$/i;
function player(options = {}) {
  return String(options.macAudioPlayer || process.env.SHOW_CONTROL_AUDIO_PLAYER || "/usr/bin/afplay");
}

// Het extra geluid van de omgeving (de wisselknop) speelt via speel-fade als die gebouwd is:
// zelfde aanroep als afplay, maar bij uitzetten zakt het geluid in anderhalve seconde weg in
// plaats van hard te stoppen. Bouwen: swiftc -O speel-fade.swift -o speel-fade (in tools/speel-fade).
// Het sfeergeluid van een fase dat over de omgeving heen klinkt (spoor "fase") loopt er ook via.
// Stappen, fasegeluiden bij het ingaan en de intro blijven via afplay lopen.
const FADE_PLAYER = path.resolve(__dirname, "../tools/speel-fade/speel-fade");
function playerVoor(naam, options = {}) {
  if ((naam !== "lied" && naam !== "fase") || options.macAudioPlayer || process.env.SHOW_CONTROL_AUDIO_PLAYER) return player(options);
  const fade = String(process.env.SHOW_CONTROL_FADE_PLAYER || FADE_PLAYER);
  try {
    fs.accessSync(fade, fs.constants.X_OK);
    return fade;
  } catch (_err) {
    return player(options);
  }
}

function audioDisabled(options = {}) {
  const value = String(options.macAudio || process.env.SHOW_CONTROL_EXTRA_AUDIO || "on").toLowerCase();
  return value === "off" || value === "0" || value === "uit";
}

// Vier sporen: "lied" is het extra geluid van de omgeving (wisselknop, mag lang duren),
// "effect" zijn de korte geluiden van stappen (omvallen, fases), "intro" is het startgeluid van
// de scène, "fase" is het sfeergeluid van een fase dat over het sfeergeluid van de omgeving heen
// klinkt (in een lus tot de fase wisselt of de scène stopt). De sporen kappen elkaar niet af.
const sporen = {
  lied: { child: null, file: "" },
  effect: { child: null, file: "" },
  intro: { child: null, file: "" },
  fase: { child: null, file: "" },
};

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

// overgang (seconden): het sfeergeluid zakt in die tijd weg in plaats van meteen (de knop van een
// personage, zodat het nummer vloeiend overneemt).
let sfeerZakt = null;
function dempSfeer(options, terug, overgang = 0) {
  const volume = Math.min(1, Math.max(0, Number.isFinite(Number(terug)) ? Number(terug) : 1));
  if (sfeerZakt) clearInterval(sfeerZakt);
  sfeerZakt = null;
  gedempt = { terug: volume, options };
  const duur = Math.min(15, Math.max(0, Number(overgang) || 0));
  if (!duur || !volume) {
    stuurSfeerVolume(options, 0);
    return;
  }
  const begin = Date.now();
  sfeerZakt = setInterval(() => {
    const deel = Math.min(1, (Date.now() - begin) / (duur * 1000));
    stuurSfeerVolume(options, Math.round(volume * (1 - deel) * 1000) / 1000);
    if (deel >= 1) {
      clearInterval(sfeerZakt);
      sfeerZakt = null;
    }
  }, 100);
  if (typeof sfeerZakt.unref === "function") sfeerZakt.unref();
}

function herstelSfeer() {
  if (sfeerZakt) clearInterval(sfeerZakt);
  sfeerZakt = null;
  if (!gedempt) return;
  const { terug, options } = gedempt;
  gedempt = null;
  stuurSfeerVolume(options, terug);
}

// overgang (seconden): een spoor dat via speel-fade loopt zakt in die tijd weg (SIGUSR1, de tijd
// staat in /tmp/speel-fade-<pid>); een spoor via afplay stopt zoals altijd meteen.
function stopSpoor(naam, overgang = 0) {
  const spoor = sporen[naam];
  if (spoor.child && spoor.child.exitCode === null && !spoor.child.killed) {
    const duur = Math.min(15, Math.max(0, Number(overgang) || 0));
    let lang = false;
    if (duur && spoor.fade && spoor.child.pid) {
      try {
        fs.writeFileSync(`/tmp/speel-fade-${spoor.child.pid}`, String(duur));
        lang = spoor.child.kill("SIGUSR1");
      } catch (_err) {}
    }
    if (!lang) {
      try { spoor.child.kill("SIGTERM"); } catch (_err) {}
    }
  }
  spoor.child = null;
  spoor.file = "";
  if (naam === "lied") herstelSfeer();
}

function stopCurrent() {
  stopSpoor("lied");
  stopSpoor("effect");
  stopSpoor("intro");
  stopSpoor("fase");
}

function isPlaying(naam, filePath) {
  const spoor = sporen[naam];
  return Boolean(spoor.child && spoor.child.exitCode === null && !spoor.child.killed && spoor.file === filePath);
}

async function sendMacAudioCommand(action, context = {}) {
  const options = context.adapterOptions || {};
  const payload = action.payload || {};
  if (action.command === "audio.extra.stop") {
    // Eén spoor (de fase wisselt naar een fase zonder eigen geluid eroverheen).
    if (payload.spoor && Object.prototype.hasOwnProperty.call(sporen, String(payload.spoor))) {
      stopSpoor(String(payload.spoor));
      return { stage: "applied", state: "ok", message: `spoor ${payload.spoor} gestopt` };
    }
    // Ook aan het einde van de scène (cue-library/scene-einde.js): alle sporen uit, ook een lus.
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
  const naam = payload.wissel ? "lied" : payload.spoor === "intro" ? "intro" : payload.spoor === "fase" ? "fase" : "effect";
  // De fase staat al aan met dit geluid: laten lopen, niet opnieuw beginnen.
  if (naam === "fase" && isPlaying("fase", filePath)) {
    return { stage: "applied", state: "ok", message: `${filePath.split("/").pop()} speelt al`, data: { route: "mac-audio", spoor: naam } };
  }
  // Wisselknop: speelt dit geluid nog, dan zet een druk het uit; de druk daarna begint weer vooraan.
  if (payload.wissel && isPlaying("lied", filePath)) {
    stopSpoor("lied");
    return { stage: "applied", state: "ok", message: `${filePath.split("/").pop()} uit`, data: { route: "mac-audio", gestopt: true } };
  }
  // Een effect kan het lied uitzetten (de bom stopt het piepje).
  if (payload.stopLied) stopSpoor("lied");
  // Het nummer van een personage zet het andere geluid van de scène uit (cue-library/personage-knop.js).
  if (payload.stopAnder) {
    for (const ander of Object.keys(sporen)) if (ander !== naam) stopSpoor(ander, payload.overgang);
  }
  // Binnen een spoor: nog eens drukken = opnieuw beginnen, niet over elkaar heen.
  stopSpoor(naam, payload.overgang);
  const spoor = sporen[naam];
  // Ook het startgeluid kan in een lus (het nummer van een trendscène).
  const lus = payload.lus === true && (naam === "lied" || naam === "fase" || naam === "intro");
  // hard: zonder fade, ook bij uitzetten (de knop van een personage): dan loopt het via afplay,
  // dat bij stoppen meteen stil is.
  const speler = payload.hard === true ? player(options) : playerVoor(lus && naam === "intro" ? "fase" : naam, options);
  // speel-fade kan zelf zonder naad herhalen (--lus); met afplay begint het bestand opnieuw
  // zodra het afloopt (hieronder), met een klein gaatje.
  const naadloos = lus && (naam === "fase" || naam === "intro") && speler !== player(options);
  const metFade = speler !== player(options);
  // Met een overgang komt het geluid op in plaats van meteen op volle sterkte (alleen de eerste keer).
  const opkomst = metFade ? Math.min(15, Math.max(0, Number(payload.overgang) || 0)) : 0;
  let eerste = true;
  const start = () => {
    const child = spawn(speler, ["-v", String(volume), ...(naadloos ? ["--lus"] : []), ...(opkomst && eerste ? ["--in", String(opkomst)] : []), filePath], { stdio: "ignore", detached: false });
    eerste = false;
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
    spoor.fade = metFade;
    return child;
  };
  const child = start();
  if (naam === "lied" && payload.dempSfeer) dempSfeer(options, payload.dempSfeer.terug, payload.overgang);
  return {
    stage: "applied",
    state: "ok",
    message: `speelt ${filePath.split("/").pop()} (volume ${Math.round(volume * 100)}%)`,
    data: { route: "mac-audio", spoor: naam, transport: { type: "afplay", pid: child.pid || null } },
  };
}

// Speelt dit bestand nu als lied (de wisselknop)? Voor de stand van de knop op het deck.
function liedSpeelt(filePath) {
  return isPlaying("lied", String(filePath || ""));
}

module.exports = {
  liedSpeelt,
  sendMacAudioCommand,
  stopCurrent,
};
