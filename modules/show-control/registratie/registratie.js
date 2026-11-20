"use strict";

// Registratie van een run: één videobestand met het beeld van het hoofdscherm en het geluid van
// de spelers en de show. TouchDesigner neemt zelf op (/project1/fy_registratie, neergezet door
// show/td-qhub-test/apply_registratie_patch.py); hier staat alleen wanneer en waarheen.
//
// Er wordt alleen opgenomen als iemand daar zelf om vraagt: de knop OPNAME op de Stream Deck
// (OVERZICHT), POST /v0/show-control/registratie/start en /stop, of tools/registratie.js.
// Niets start vanzelf. Een opname stopt alleen vanzelf als de schijf volloopt.
// Opdrachten gaan via de opdrachtenmap van TouchDesigner (~/ForYou/td-opdrachten), geen netwerk.
// De bestanden staan op de externe schijf Expansion, in /Volumes/Expansion/gedocumenteerde-shows/.
// Zit de schijf er niet in, dan gaat de opname naar ~/ForYou/gedocumenteerde-shows/ op deze Mac
// en zegt het antwoord dat erbij: een opname gaat nooit verloren om een losse kabel.
//
// Gelijk lopen van beeld en geluid. TouchDesigner schrijft het geluid op één vaste samplerate
// (zie de patch); het beeld volgt de klok. Wat overblijft is een vaste verschuiving tussen de
// camera's en de microfoons. Die zet de stop recht in het bestand zelf (GELUID_MS, zonder opnieuw
// te coderen) en de stop meet elke opname na: beeld, geluid en klok moeten even lang zijn.

const { execFile } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const STUUR = "op('/project1/fy_registratie').op('stuur').module";
const SCHIJF = "/Volumes/Expansion";
const MIN_VRIJ_START_GB = 8;
const MIN_VRIJ_DOOR_GB = 3;
// Zoveel milliseconden komt het geluid in het bestand later dan TouchDesigner het schreef
// (negatief = eerder). Gemeten met een klap in beeld en geluid; 0 = niets verschuiven.
const GELUID_MS = 0;
// Meer verschil dan dit tussen beeld, geluid en klok is geen vaste verschuiving meer maar
// wegdrijven (samplerate) of weggevallen beelden: dat meldt de stop, rechtzetten kan dan niet blind.
const MAX_VERSCHIL_S = 0.5;

// Een schijf zit erin als zijn map op een ander apparaat staat dan de map erboven. Alleen kijken
// of de map bestaat is niet genoeg: een lege map /Volumes/Expansion staat op de Mac zelf.
function schijfAanwezig(schijf) {
  try {
    return fs.statSync(schijf).dev !== fs.statSync(path.dirname(schijf)).dev;
  } catch (_err) {
    return false;
  }
}

function instellingen(options = {}) {
  const env = process.env;
  const vast = options.doelDir || env.SHOW_CONTROL_REGISTRATIE_DIR;
  const schijf = options.schijf || env.SHOW_CONTROL_REGISTRATIE_SCHIJF || SCHIJF;
  const opSchijf = !vast && schijfAanwezig(schijf);
  return {
    opdrachtenDir: options.opdrachtenDir || env.FY_TD_OPDRACHTEN || path.join(os.homedir(), "ForYou", "td-opdrachten"),
    doelDir: vast || (opSchijf ? path.join(schijf, "gedocumenteerde-shows") : path.join(os.homedir(), "ForYou", "gedocumenteerde-shows")),
    melding: vast || opSchijf ? null : `schijf ${path.basename(schijf)} zit er niet in: de opname staat op de Mac`,
    standPad: options.standPad || env.SHOW_CONTROL_REGISTRATIE_STAND
      || path.join(os.homedir(), "Library", "Application Support", "ForYouApp", "registratie.json"),
    wachtMs: Number(options.wachtMs ?? 5000),
    geluidMs: Number(options.geluidMs ?? env.SHOW_CONTROL_REGISTRATIE_GELUID_MS ?? GELUID_MS) || 0,
    ffmpeg: options.ffmpeg || env.SHOW_CONTROL_FFMPEG || programma("ffmpeg"),
    ffprobe: options.ffprobe || env.SHOW_CONTROL_FFPROBE || programma("ffprobe"),
    nazorg: options.nazorg !== false,
  };
}

function programma(naam) {
  return ["/opt/homebrew/bin", "/usr/local/bin"].map((d) => path.join(d, naam)).find((p) => fs.existsSync(p)) || naam;
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

// Bestandsnaam: datum en tijd van de start van de opname, en de begintijd van de run die loopt.
function naamVoor(runtimeState, nu = new Date()) {
  const run = runtimeState && runtimeState.showRunId && runtimeState.status === "running" ? runtimeState : null;
  const stempel = (d) => `${twee(d.getHours())}${twee(d.getMinutes())}`;
  const datum = `${nu.getFullYear()}-${twee(nu.getMonth() + 1)}-${twee(nu.getDate())}`;
  const deel = run && run.createdAt ? `run-${stempel(new Date(run.createdAt))}` : "los";
  return { naam: `${datum}-${stempel(nu)}-${deel}`, showRunId: run ? run.showRunId : null };
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
  const { naam, showRunId } = naamVoor(runtimeState, options.nu);
  fs.mkdirSync(inst.doelDir, { recursive: true });
  let nummer = 1;
  let pad;
  do {
    pad = path.join(inst.doelDir, `${naam}${nummer > 1 ? `-${nummer}` : ""}.mov`);
    nummer += 1;
  } while (fs.existsSync(pad));
  const antwoord = await tdOpdracht(inst, `${STUUR}.start(${JSON.stringify(pad)})`);
  if (!antwoord.ok) return { ok: false, opname: false, fout: antwoord.fout };
  const stand = { pad: antwoord.td.pad, showRunId, gestartOp: new Date().toISOString(), ...(inst.melding ? { melding: inst.melding } : {}) };
  schrijfStand(inst, stand);
  return { ok: true, opname: true, ...stand, td: antwoord.td };
}

function draai(cmd, args) {
  return new Promise((klaar) => {
    execFile(cmd, args, { maxBuffer: 4 * 1024 * 1024 }, (err, stdout, stderr) => {
      klaar({ ok: !err, uit: String(stdout || ""), fout: err ? String(stderr || err.message).trim().split("\n").pop() : "" });
    });
  });
}

// Lengte van beeld en geluid in het bestand, in seconden.
async function meetBestand(inst, pad) {
  const r = await draai(inst.ffprobe, ["-v", "error", "-show_entries", "stream=codec_type,start_time,duration,sample_rate", "-of", "json", pad]);
  if (!r.ok) return null;
  const streams = JSON.parse(r.uit).streams || [];
  const van = (soort) => streams.find((s) => s.codec_type === soort);
  const beeld = van("video");
  const geluid = van("audio");
  if (!beeld || !geluid) return null;
  return {
    beeldS: Number(beeld.duration),
    geluidS: Number(geluid.duration),
    beeldStartS: Number(beeld.start_time) || 0,
    geluidStartS: Number(geluid.start_time) || 0,
    rate: Number(geluid.sample_rate),
  };
}

// TouchDesigner sluit het bestand kort na de stop: wacht tot het leesbaar is en niet meer groeit.
async function wachtOpBestand(inst, pad, maxMs = 30000) {
  const tot = Date.now() + maxMs;
  let vorige = -1;
  while (Date.now() < tot) {
    const grootte = fs.existsSync(pad) ? fs.statSync(pad).size : -1;
    if (grootte > 0 && grootte === vorige) {
      const meting = await meetBestand(inst, pad);
      if (meting) return meting;
    }
    vorige = grootte;
    await new Promise((klaar) => setTimeout(klaar, 500));
  }
  return null;
}

// Na de stop: meet de opname na en zet de vaste verschuiving recht in het bestand zelf.
// Beeld en geluid worden gekopieerd, niet opnieuw gecodeerd; alleen het begin van het geluid
// (of, bij een negatieve waarde, van het beeld) schuift op. Het bestand houdt zijn naam.
async function gelijkzetten(pad, { gestartOp, gestoptOp } = {}, options = {}) {
  const inst = instellingen(options);
  const meting = await wachtOpBestand(inst, pad, options.maxWachtMs);
  if (!meting) return { ok: false, pad, fout: "opname niet leesbaar (ffprobe)" };
  const klokS = gestartOp && gestoptOp ? (new Date(gestoptOp) - new Date(gestartOp)) / 1000 : null;
  const controle = {
    ...meting,
    klokS,
    beeldGeluidS: Number((meting.geluidS - meting.beeldS).toFixed(3)),
    beeldKlokS: klokS === null ? null : Number((meting.beeldS - klokS).toFixed(3)),
  };
  // De klok begint te lopen na het antwoord van TouchDesigner: tot een seconde speling is gewoon.
  const meldingen = [];
  if (Math.abs(controle.beeldGeluidS) > MAX_VERSCHIL_S) meldingen.push(`geluid is ${controle.beeldGeluidS} s langer dan het beeld`);
  if (klokS !== null && Math.abs(controle.beeldKlokS) > MAX_VERSCHIL_S + 1) meldingen.push(`beeld is ${controle.beeldKlokS} s langer dan de klok`);
  const uit = { ok: true, pad, controle, gelijk: meldingen.length === 0, meldingen, verschovenMs: 0 };
  const ms = Math.round(inst.geluidMs);
  if (!ms) return uit;
  const vrij = vrijGb(path.dirname(pad));
  const nodig = fs.statSync(pad).size / 1e9 + 1;
  if (vrij !== null && vrij < nodig) {
    return { ...uit, ok: false, fout: `te weinig schijfruimte om gelijk te zetten (${vrij.toFixed(1)} GB vrij, ${nodig.toFixed(1)} nodig)` };
  }
  const tijdelijk = path.join(path.dirname(pad), `.${path.basename(pad, ".mov")}.gelijk.mov`);
  const s = String(Math.abs(ms) / 1000);
  // Eerste ingang = beeld, tweede = geluid; -itsoffset schuift de ingang die erna komt later.
  const ingangen = ms > 0 ? ["-i", pad, "-itsoffset", s, "-i", pad] : ["-itsoffset", s, "-i", pad, "-i", pad];
  const r = await draai("/usr/bin/nice", ["-n", "15", inst.ffmpeg, "-v", "error", "-y", ...ingangen,
    "-map", "0:v:0", "-map", "1:a:0", "-c", "copy", "-map_metadata", "0", tijdelijk]);
  if (!r.ok || !fs.existsSync(tijdelijk) || fs.statSync(tijdelijk).size < fs.statSync(pad).size * 0.9) {
    fs.rmSync(tijdelijk, { force: true });
    return { ...uit, ok: false, fout: `gelijkzetten mislukt: ${r.fout || "bestand te klein"}` };
  }
  fs.renameSync(tijdelijk, pad);
  return { ...uit, verschovenMs: ms };
}

let laatsteNazorg = null;

async function stopRegistratie(options = {}) {
  const inst = instellingen(options);
  const loopt = leesStand(inst);
  const antwoord = await tdOpdracht(inst, `${STUUR}.stop()`);
  const gestoptOp = new Date().toISOString();
  if (antwoord.ok || !loopt) schrijfStand(inst, null);
  if (!antwoord.ok) return { ok: false, opname: Boolean(loopt), fout: antwoord.fout };
  const uit = { ok: true, opname: false, pad: antwoord.td.pad, bytes: antwoord.td.bytes, td: antwoord.td };
  if (!loopt || !inst.nazorg) return uit;
  // Het nameten en rechtzetten loopt door na het antwoord: de knop hoeft er niet op te wachten.
  laatsteNazorg = { pad: loopt.pad, bezig: true };
  const nazorg = gelijkzetten(loopt.pad, { gestartOp: loopt.gestartOp, gestoptOp }, options)
    .catch((err) => ({ ok: false, pad: loopt.pad, fout: err.message }))
    .then((n) => {
      laatsteNazorg = n;
      console.log(`[registratie] ${path.basename(n.pad)}: ${n.ok ? "nagemeten" : n.fout}${n.verschovenMs ? `, geluid ${n.verschovenMs} ms verschoven` : ""}${n.meldingen && n.meldingen.length ? `; LET OP ${n.meldingen.join("; ")}` : ""}`);
      return n;
    });
  return options.wachtOpNazorg ? { ...uit, nazorg: await nazorg } : uit;
}

async function registratieStatus(options = {}) {
  const inst = instellingen(options);
  const loopt = leesStand(inst);
  const antwoord = await tdOpdracht(inst, `${STUUR}.stand()`);
  return {
    ok: antwoord.ok,
    opname: antwoord.ok ? antwoord.td.opname : Boolean(loopt),
    vrijGb: vrijGb(fs.existsSync(inst.doelDir) ? inst.doelDir : os.homedir()),
    map: inst.doelDir,
    ...(inst.melding ? { melding: inst.melding } : {}),
    ...(loopt || {}),
    ...(laatsteNazorg ? { nazorg: laatsteNazorg } : {}),
    ...(antwoord.ok ? { td: antwoord.td } : { fout: antwoord.fout }),
  };
}

// Vanuit de klok van de server: loopt de schijf vol, dan stopt de opname. Verder nergens om.
let bezig = false;
async function registratieTick(options = {}) {
  const inst = instellingen(options);
  const loopt = leesStand(inst);
  if (!loopt || bezig) return null;
  const vrij = options.vrijGb ?? vrijGb(path.dirname(loopt.pad));
  if (vrij === null || vrij >= MIN_VRIJ_DOOR_GB) return null;
  bezig = true;
  try {
    return await stopRegistratie(options);
  } finally {
    bezig = false;
  }
}

module.exports = {
  gelijkzetten,
  naamVoor,
  registratieStatus,
  registratieTick,
  startRegistratie,
  stopRegistratie,
};
