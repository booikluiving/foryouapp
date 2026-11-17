"use strict";

// Eén beeld met de spelers erin (trolleyprobleem: de meme). De omgeving is één plaat; de drie
// camerabeelden staan er klein in, elk op een eigen plek, gedraaid en onderaan afgesneden. Elk shot
// is een uitsnede van die ene plaat: het overzicht en per camera een uitsnede dichtbij.
//
// Staat niet in de catalogus maar als bestanden bij de media van de omgeving:
//   <media>/environments/environment_<nr>/beeld/beeld.json
//   {
//     "label": "OVERZICHT",
//     "kader": { "kopX": 0.5, "kopBreedte": 0.32, "nekY": 0.48 },   waar de speler in zijn camerabeeld staat
//     "spelers": [ { "camera": 1, "nek": [2526, 538], "kop": 72, "draai": 30, "lijf": 167 }, ... ],
//     "uitsnedes": { "overzicht": { "x": 0, "y": -1827, "breedte": 3000 }, "1": {...}, "2": {...}, "3": {...} }
//   }
// Maten van spelers en uitsnedes zijn in beeldpunten van de plaat. "nek" is waar de nek van de
// speler komt, "kop" hoe breed zijn hoofd wordt, "draai" in graden met de klok mee, "lijf" hoeveel
// er onder de nek van het camerabeeld overblijft (daaronder neemt de tekening het over).
//
// Per uitsnede staan er naast beeld.json: achtergrond-<uitsnede>.png, voorgrond-<uitsnede>-begin.png
// en per stap van de knoppen (de naam van de clip in omvallen.json zonder extensie)
// voorgrond-<uitsnede>-<stap>.mov en voorgrond-<uitsnede>-<stap>-eind.png.
//
// TouchDesigner krijgt alles uitgerekend in de OSC-args van td.samen.beeld.

const fs = require("node:fs");
const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");

const DEFAULT_MEDIA_ROOT = path.resolve(__dirname, "../../catalog/media");
const DEFAULT_CATALOG_DB_PATH = path.resolve(__dirname, "../../catalog/db/catalog.sqlite");

// De plek van de spelers en de uitsnedes staan in de beeldcatalogus (composition.beeld): daar
// ziet het team ook wat de show laat zien. beeld.json bij de media is de terugval.
function beeldUitCatalogus(environmentId, options = {}) {
  if (options.catalogBeeld !== undefined) return options.catalogBeeld;
  let db;
  try {
    db = new DatabaseSync(String(options.catalogDbPath || process.env.CATALOG_DB_PATH || DEFAULT_CATALOG_DB_PATH), { readOnly: true });
    const row = db.prepare("SELECT record_json FROM environment_compositions WHERE environment_id = ?").get(environmentId);
    const record = row ? JSON.parse(row.record_json) : null;
    return record && record.beeld && typeof record.beeld === "object" ? record.beeld : null;
  } catch (_err) {
    return null;
  } finally {
    try { if (db) db.close(); } catch (_err) { /* niets */ }
  }
}
const SCHERM = { breedte: 1080, hoogte: 1920 };
const UITSNEDES = ["overzicht", "1", "2", "3"];
const STANDAARD_KADER = { kopX: 0.5, kopBreedte: 0.32, nekY: 0.48 };

function mediaRoot(options = {}) {
  return String(options.catalogMediaRoot || process.env.CATALOG_MEDIA_ROOT || DEFAULT_MEDIA_ROOT);
}

function beeldDir(environmentId, options = {}) {
  const nummer = String(environmentId || "").split(":").pop();
  return path.join(mediaRoot(options), "environments", `environment_${nummer}`, "beeld");
}

function fileExists(filePath, options = {}) {
  if (!filePath) return false;
  if (typeof options.fileExists === "function") return options.fileExists(filePath);
  try {
    return fs.statSync(filePath).isFile();
  } catch (_err) {
    return false;
  }
}

function getal(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function leesKader(raw, basis) {
  const bron = raw && typeof raw === "object" ? raw : {};
  return {
    kopX: Math.min(1, Math.max(0, getal(bron.kopX, basis.kopX))),
    kopBreedte: Math.min(1, Math.max(0.05, getal(bron.kopBreedte, basis.kopBreedte))),
    nekY: Math.min(1, Math.max(0, getal(bron.nekY, basis.nekY))),
  };
}

function readBeeld(environmentId, options = {}) {
  if (!environmentId) return null;
  if (options.beeld !== undefined) return options.beeld;
  const dir = beeldDir(environmentId, options);
  let manifest = beeldUitCatalogus(environmentId, options);
  if (!manifest) {
    try {
      const read = typeof options.readFile === "function" ? options.readFile : (file) => fs.readFileSync(file, "utf8");
      manifest = JSON.parse(read(path.join(dir, "beeld.json")));
    } catch (_err) {
      return null;
    }
  }
  if (!manifest || typeof manifest !== "object") return null;
  const kader = leesKader(manifest.kader, STANDAARD_KADER);
  const spelers = (Array.isArray(manifest.spelers) ? manifest.spelers : [])
    .map((speler) => ({
      camera: Math.round(Number(speler && speler.camera)),
      nek: Array.isArray(speler && speler.nek) ? [getal(speler.nek[0], NaN), getal(speler.nek[1], NaN)] : [NaN, NaN],
      kop: getal(speler && speler.kop, NaN),
      draai: getal(speler && speler.draai, 0),
      lijf: Math.max(0, getal(speler && speler.lijf, 0)),
      kader: leesKader(speler && speler.kader, kader),
    }))
    .filter((speler) => [1, 2, 3].includes(speler.camera) && speler.nek.every(Number.isFinite) && speler.kop > 0);
  const uitsnedes = {};
  for (const naam of UITSNEDES) {
    const raw = manifest.uitsnedes && manifest.uitsnedes[naam];
    if (!raw || !(getal(raw.breedte, 0) > 0)) return null;
    uitsnedes[naam] = { x: getal(raw.x, 0), y: getal(raw.y, 0), breedte: getal(raw.breedte, 0) };
  }
  if (!spelers.length) return null;
  return { dir, label: String(manifest.label || "OVERZICHT").slice(0, 24), spelers, uitsnedes };
}

// Waar het camerabeeld van één speler op het scherm komt bij een uitsnede. Geeft wat de
// Transform TOP's in TouchDesigner nodig hebben: schaal, draaiing (graden, tegen de klok in),
// verschuiving als deel van het scherm (rechts en omhoog positief) en hoeveel er onderaan afgaat.
function plaatsSpeler(speler, uitsnede) {
  const k = SCHERM.breedte / uitsnede.breedte;                       // plaat → scherm
  const schaal = (speler.kop * k) / (speler.kader.kopBreedte * SCHERM.breedte);
  const nekScherm = { x: (speler.nek[0] - uitsnede.x) * k, y: (speler.nek[1] - uitsnede.y) * k };
  const nekKader = { x: speler.kader.kopX * SCHERM.breedte, y: speler.kader.nekY * SCHERM.hoogte };
  // Onder de nek blijft "lijf" (in de plaat) over; de rest van het camerabeeld gaat eraf.
  const snijY = nekKader.y + (speler.lijf * k) / schaal;
  const snij = Math.min(0.95, Math.max(0, 1 - snijY / SCHERM.hoogte));
  const hoek = (speler.draai * Math.PI) / 180;
  const cos = Math.cos(hoek);
  const sin = Math.sin(hoek);
  const draaiSchaal = (dx, dy) => ({ x: schaal * (cos * dx - sin * dy), y: schaal * (sin * dx + cos * dy) });
  // Midden van het camerabeeld zo dat de nek op zijn plek komt. Het afsnijden schuift het beeld
  // eerst omlaag (wat onder de rand valt is weg); dat stuk tellen we hier terug.
  const vanMidden = draaiSchaal(nekKader.x - SCHERM.breedte / 2, nekKader.y - SCHERM.hoogte / 2 + snij * SCHERM.hoogte);
  const midden = { x: nekScherm.x - vanMidden.x, y: nekScherm.y - vanMidden.y };
  const rond = (value) => (Math.round(value * 10000) / 10000) + 0;   // + 0: geen min nul
  return {
    camera: speler.camera,
    schaal: rond(schaal),
    draai: rond(-speler.draai),
    tx: rond((midden.x - SCHERM.breedte / 2) / SCHERM.breedte),
    ty: rond((SCHERM.hoogte / 2 - midden.y) / SCHERM.hoogte),
    snij: rond(snij),
  };
}

// Wat er nu staat: welke omgeving, welke uitsnede en welke stap (de tram). Een stap is een clip
// die eenmaal speelt; daarna geldt het stilstaande eindbeeld.
const state = { environmentId: "", aan: false, uitsnede: "overzicht", stap: "begin", stapKlaarOp: 0 };

function resetBeeldState() {
  state.environmentId = "";
  state.aan = false;
  state.uitsnede = "overzicht";
  state.stap = "begin";
  state.stapKlaarOp = 0;
}

function beeldStaatAan(environmentId) {
  return state.aan && (!environmentId || state.environmentId === environmentId);
}

function actieveOmgeving() {
  return state.aan ? state.environmentId : "";
}

function stapNaam(filePath) {
  const naam = path.basename(String(filePath || "")).replace(/\.[^.]+$/, "");
  return naam || "begin";
}

// De payload voor td.samen.beeld. `wens` zegt wat er verandert: { uitsnede } bij een cameraknop of
// het overzicht, { stap, duur } bij een stap van de knoppen, niets bij het starten van de scène.
function beeldPayload(environmentId, wens = {}, options = {}) {
  const beeld = readBeeld(environmentId, options);
  if (!beeld) return null;
  const now = Number(options.now ?? Date.now());
  const zelfde = state.aan && state.environmentId === environmentId;
  let uitsnede = zelfde ? state.uitsnede : "overzicht";
  let stap = zelfde ? state.stap : "begin";
  let stapKlaarOp = zelfde ? state.stapKlaarOp : 0;
  let stapStart = false;
  if (wens.uitsnede !== undefined && UITSNEDES.includes(String(wens.uitsnede))) uitsnede = String(wens.uitsnede);
  if (wens.stap !== undefined) {
    stap = String(wens.stap) || "begin";
    stapStart = stap !== "begin";
    stapKlaarOp = stapStart ? now + Math.round((Number(wens.duur) || 0) * 1000) : 0;
  }
  const bestand = (naam) => path.join(beeld.dir, naam);
  const achtergrond = bestand(`achtergrond-${uitsnede}.png`);
  if (!fileExists(achtergrond, options)) return null;
  // De clip alleen op het moment dat de stap begint; bij een andere uitsnede daarna het eindbeeld.
  const kandidaten = stap === "begin"
    ? [`voorgrond-${uitsnede}-begin.png`]
    : stapStart
      ? [`voorgrond-${uitsnede}-${stap}.mov`, `voorgrond-${uitsnede}-${stap}-eind.png`, `voorgrond-${uitsnede}-begin.png`]
      : [`voorgrond-${uitsnede}-${stap}-eind.png`, `voorgrond-${uitsnede}-begin.png`];
  const voorgrond = kandidaten.map(bestand).find((file) => fileExists(file, options)) || "";
  state.environmentId = environmentId;
  state.aan = true;
  state.uitsnede = uitsnede;
  state.stap = stap;
  state.stapKlaarOp = stapKlaarOp;
  return {
    environmentId,
    uit: false,
    uitsnede,
    stap,
    achtergrond,
    voorgrond,
    // Een clip speelt eenmaal en blijft op het laatste beeld staan; 0 = stilstaand beeld.
    duur: stapStart && /\.mov$/i.test(voorgrond) ? Number(wens.duur) || 0 : 0,
    spelers: beeld.spelers.map((speler) => plaatsSpeler(speler, beeld.uitsnedes[uitsnede])),
  };
}

function beeldUitPayload(extra = {}) {
  resetBeeldState();
  return { ...extra, uit: true };
}

// OSC-args na cueId/command/payloadId: uit, achtergrond, voorgrond, duur, en per speler zes getallen
// (camera, schaal, draai, tx, ty, snij). Een camera die niet meedoet staat op schaal 0.
function beeldOscArgs(payload = {}) {
  if (payload.uit) return ["1"];
  const args = ["0", String(payload.achtergrond || ""), String(payload.voorgrond || ""), String(Number(payload.duur) || 0)];
  const spelers = Array.isArray(payload.spelers) ? payload.spelers : [];
  for (const camera of [1, 2, 3]) {
    const speler = spelers.find((item) => Number(item.camera) === camera);
    args.push(String(camera), ...(speler
      ? [speler.schaal, speler.draai, speler.tx, speler.ty, speler.snij].map((value) => String(Number(value) || 0))
      : ["0", "0", "0", "0", "0"]));
  }
  return args;
}

// Voor de knop van het extra shot: bij zo'n omgeving is dat het overzicht.
function beeldLabel(environmentId, options = {}) {
  const beeld = readBeeld(environmentId, options);
  return beeld ? beeld.label : "";
}

// Actie die bij het starten van een scène meegaat; null als de omgeving geen beeld.json heeft.
// TouchDesigner zet bij elke nieuwe omgeving het beeld uit; deze actie komt daar kort na.
function beeldStartAction(environmentId, options = {}) {
  resetBeeldState();
  const payload = beeldPayload(environmentId, {}, options);
  if (!payload) return null;
  return {
    command: "td.samen.beeld",
    targetId: "touchdesigner",
    ackMode: "fire-and-forget",
    delayMs: 450,
    timeoutMs: 900,
    payload: { ...payload, cueIntent: "scene_start_beeld" },
  };
}

module.exports = {
  SCHERM,
  actieveOmgeving,
  beeldStartAction,
  beeldLabel,
  beeldOscArgs,
  beeldPayload,
  beeldStaatAan,
  beeldUitPayload,
  plaatsSpeler,
  readBeeld,
  resetBeeldState,
  stapNaam,
};
