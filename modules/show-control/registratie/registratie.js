"use strict";

// Registratie van een run: één videobestand met het beeld van het hoofdscherm en het geluid van
// de spelers en de show. TouchDesigner neemt zelf op (/project1/fy_registratie, neergezet door
// show/td-qhub-test/apply_registratie_patch.py); hier staat alleen wanneer en waarheen.
//
// Start vanzelf bij START SHOW, stopt vanzelf als de run voorbij is (RESET RUN), en kan met de
// hand: POST /v0/show-control/registratie/start en /stop, of tools/registratie.js.
// Opdrachten gaan via de opdrachtenmap van TouchDesigner (~/ForYou/td-opdrachten), geen netwerk.
// De bestanden blijven op deze Mac, in ~/ForYou/testruns/<datum>-run-<tijd>/.

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const STUUR = "op('/project1/fy_registratie').op('stuur').module";
const MIN_VRIJ_START_GB = 8;
const MIN_VRIJ_DOOR_GB = 3;

function instellingen(options = {}) {
  const env = process.env;
  return {
    uit: /^(uit|off|0)$/i.test(String(options.registratie ?? env.SHOW_CONTROL_REGISTRATIE ?? "aan")),
    opdrachtenDir: options.opdrachtenDir || env.FY_TD_OPDRACHTEN || path.join(os.homedir(), "ForYou", "td-opdrachten"),
    doelDir: options.doelDir || env.SHOW_CONTROL_REGISTRATIE_DIR || path.join(os.homedir(), "ForYou", "testruns"),
    standPad: options.standPad || env.SHOW_CONTROL_REGISTRATIE_STAND
      || path.join(os.homedir(), "Library", "Application Support", "ForYouApp", "registratie.json"),
    wachtMs: Number(options.wachtMs ?? 5000),
  };
}

function leesStand(inst) {
  try {
    return JSON.parse(fs.readFileSync(inst.standPad, "utf8"));
  } catch (_err) {
    return null;
  }
}

function schrijfStand(inst, stand) {
  if (!stand) {
    fs.rmSync(inst.standPad, { force: true });
    return;
  }
  fs.mkdirSync(path.dirname(inst.standPad), { recursive: true });
  fs.writeFileSync(inst.standPad, JSON.stringify(stand, null, 2));
}

function twee(n) {
  return String(n).padStart(2, "0");
}

// Mapnaam en bestandsnaam: datum en begintijd van de run (lokale tijd), of van nu zonder run.
function naamVoor(runtimeState, nu = new Date()) {
  const run = runtimeState && runtimeState.showRunId && runtimeState.status === "running" ? runtimeState : null;
  const begin = run && run.createdAt ? new Date(run.createdAt) : nu;
  const datum = `${begin.getFullYear()}-${twee(begin.getMonth() + 1)}-${twee(begin.getDate())}`;
  const tijd = `${twee(begin.getHours())}${twee(begin.getMinutes())}`;
  return { map: `${datum}-${run ? "run" : "los"}-${tijd}`, showRunId: run ? run.showRunId : null };
}

function vrijGb(dir) {
  try {
    const s = fs.statfsSync(dir);
    return (s.bavail * s.bsize) / 1e9;
  } catch (_err) {
    return null;
  }
}

// Zet een opdracht in de map van TouchDesigner en wacht op het antwoord.
async function tdOpdracht(inst, regel) {
  const inDir = path.join(inst.opdrachtenDir, "in");
  if (!fs.existsSync(inDir)) return { ok: false, fout: "opdrachtenmap van TouchDesigner ontbreekt" };
  const naam = `registratie-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  const uit = path.join(inst.opdrachtenDir, "uit", `${naam}.txt`);
  fs.writeFileSync(path.join(inDir, `${naam}.py`), `${regel}\n`);
  const tot = Date.now() + inst.wachtMs;
  while (Date.now() < tot) {
    await new Promise((klaar) => setTimeout(klaar, 250));
    if (!fs.existsSync(uit)) continue;
    const tekst = fs.readFileSync(uit, "utf8");
    fs.rmSync(uit, { force: true });
    fs.rmSync(path.join(inst.opdrachtenDir, "gedaan", `${naam}.py`), { force: true });
    const stand = tekst.split("\n").find((r) => r.startsWith("REGISTRATIE "));
    if (!tekst.startsWith("ok") || !stand) {
      const ontbreekt = /NoneType/.test(tekst);
      return { ok: false, fout: ontbreekt ? "fy_registratie staat niet in TouchDesigner (patch draaien)" : tekst.trim().split("\n").pop() };
    }
    return { ok: true, td: JSON.parse(stand.slice("REGISTRATIE ".length)) };
  }
  fs.rmSync(path.join(inDir, `${naam}.py`), { force: true });
  return { ok: false, fout: "geen antwoord van TouchDesigner" };
}

async function startRegistratie(runtimeState, options = {}) {
  const inst = instellingen(options);
  const loopt = leesStand(inst);
  if (loopt) return { ok: true, opname: true, alBezig: true, ...loopt };
  const vrij = vrijGb(fs.existsSync(inst.doelDir) ? inst.doelDir : os.homedir());
  if (vrij !== null && vrij < MIN_VRIJ_START_GB) {
    return { ok: false, opname: false, fout: `te weinig schijfruimte (${vrij.toFixed(1)} GB vrij, ${MIN_VRIJ_START_GB} nodig)` };
  }
  const { map, showRunId } = naamVoor(runtimeState, options.nu);
  const dir = path.join(inst.doelDir, map);
  fs.mkdirSync(dir, { recursive: true });
  let nummer = 1;
  let pad;
  do {
    pad = path.join(dir, `${map}-registratie${nummer > 1 ? `-${nummer}` : ""}.mov`);
    nummer += 1;
  } while (fs.existsSync(pad));
  const antwoord = await tdOpdracht(inst, `${STUUR}.start(${JSON.stringify(pad)})`);
  if (!antwoord.ok) return { ok: false, opname: false, fout: antwoord.fout };
  const stand = { pad: antwoord.td.pad, showRunId, bron: options.bron || "hand", gestartOp: new Date().toISOString() };
  schrijfStand(inst, stand);
  return { ok: true, opname: true, ...stand, td: antwoord.td };
}

async function stopRegistratie(options = {}) {
  const inst = instellingen(options);
  const loopt = leesStand(inst);
  const antwoord = await tdOpdracht(inst, `${STUUR}.stop()`);
  if (antwoord.ok || !loopt) schrijfStand(inst, null);
  if (!antwoord.ok) return { ok: false, opname: Boolean(loopt), fout: antwoord.fout };
  return { ok: true, opname: false, pad: antwoord.td.pad, bytes: antwoord.td.bytes, td: antwoord.td };
}

async function registratieStatus(options = {}) {
  const inst = instellingen(options);
  const loopt = leesStand(inst);
  const antwoord = await tdOpdracht(inst, `${STUUR}.stand()`);
  return {
    ok: antwoord.ok,
    opname: antwoord.ok ? antwoord.td.opname : Boolean(loopt),
    vanzelf: !inst.uit,
    vrijGb: vrijGb(fs.existsSync(inst.doelDir) ? inst.doelDir : os.homedir()),
    ...(loopt || {}),
    ...(antwoord.ok ? { td: antwoord.td } : { fout: antwoord.fout }),
  };
}

// START SHOW: de opname van deze run begint. Doet niets als het vanzelf starten uit staat.
async function registratieBijStartShow(runtimeState, options = {}) {
  if (instellingen(options).uit) return null;
  return startRegistratie(runtimeState, { ...options, bron: "start-show" });
}

// Vanuit de klok van de server: hoort de lopende opname bij een run en is die run weg of een
// andere (RESET RUN), dan stopt de opname. Ook als de schijf volloopt. Een opname die met de hand
// buiten een run is gestart, stopt alleen met de hand (of bij een volle schijf).
let bezig = false;
async function registratieTick(runtimeState, options = {}) {
  const inst = instellingen(options);
  const loopt = leesStand(inst);
  if (!loopt || bezig) return null;
  const state = runtimeState || {};
  const runWeg = loopt.showRunId && (state.showRunId !== loopt.showRunId || state.status !== "running");
  const vrij = vrijGb(path.dirname(loopt.pad));
  const vol = vrij !== null && vrij < MIN_VRIJ_DOOR_GB;
  if (!runWeg && !vol) return null;
  bezig = true;
  try {
    return await stopRegistratie(options);
  } finally {
    bezig = false;
  }
}

module.exports = {
  naamVoor,
  registratieBijStartShow,
  registratieStatus,
  registratieTick,
  startRegistratie,
  stopRegistratie,
};
