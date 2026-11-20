"use strict";

// Gedeeld door bouw.js, deck-actie.js en deck-status.js.

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const DIR = __dirname;
const HOME = os.homedir();

const env = (name, fallback) => (process.env[name] && String(process.env[name]).trim()) || fallback;

const CONFIG = {
  companionUrl: env("FY_DECK_COMPANION_URL", "http://127.0.0.1:8008").replace(/\/+$/, ""),
  showControlUrl: env("FY_DECK_SHOW_CONTROL_URL", "http://127.0.0.1:3025").replace(/\/+$/, ""),
  runtimeUrl: env("FY_DECK_RUNTIME_URL", "http://127.0.0.1:3024").replace(/\/+$/, ""),
  scriptAgentUrl: env("FY_DECK_SCRIPT_AGENT_URL", "http://127.0.0.1:3027").replace(/\/+$/, ""),
  sq5Url: env("FY_DECK_SQ5_URL", "http://127.0.0.1:3225").replace(/\/+$/, ""),
  cameraUrl: env("FY_DECK_CAMERA_URL", "http://127.0.0.1:3226").replace(/\/+$/, ""),
  audienceUrl: env("FY_DECK_AUDIENCE_URL", "http://127.0.0.1:3026").replace(/\/+$/, ""),
  // de helper van de microfoon van de operator (hardware/mic-dictation): knop ZAAL MIC
  micKnopUrl: env("FY_DECK_MIC_KNOP_URL", "http://127.0.0.1:3231").replace(/\/+$/, ""),
  mainDir: env("FY_DECK_MAIN_DIR", path.join(HOME, "ForYou", "main")),
  // droog = knoppen doen niets buiten Companion (test): alleen loggen
  droog: env("FY_DECK_DROOG", "") === "1",
  holdDir: env("FY_DECK_HOLD_DIR", path.join(HOME, "Library", "Caches", "ForYouApp", "deck-hold")),
  // stand van de knop SHOW MUZIEK: het bestand bestaat zolang de showmuziek uit staat
  showMuziekUitPath: env("FY_DECK_SHOWMUZIEK_UIT", path.join(HOME, "Library", "Application Support", "ForYouApp", "deck-showmuziek-uit")),
  // stand van de knop OPNAME: show control schrijft dit bestand zolang er een opname loopt
  opnamePath: env("FY_DECK_OPNAME", path.join(HOME, "Library", "Application Support", "ForYouApp", "registratie.json")),
  scenePlekkenPath: env("FY_DECK_SCENE_PLEKKEN", path.join(HOME, "Library", "Caches", "ForYouApp", "deck-scene-plekken.json")),
  logPath: env("FY_DECK_LOG", path.join(HOME, "Library", "Logs", "ForYou", "deck.log")),
};

function loadDeck() {
  return JSON.parse(fs.readFileSync(path.join(DIR, "deck.json"), "utf8"));
}

function allButtons(deck) {
  const out = [];
  for (const page of deck.paginas) for (const knop of page.knoppen) out.push({ ...knop, pagina: page.id });
  return out;
}

// Knoppen van deze scène (omgeving, extra's, personage). Ze hebben geen vaste plek:
// deck-status zet wat er is van links aangeschoven op de plekken sc1..sc6 (actie scenePlek).
function sceneKnoppen(deck) {
  return (deck.scene || []).map((knop) => ({ ...knop, pagina: "show" }));
}

// Waar de scèneknoppen nu staan: { sc1: "omg1", sc2: "extrashot", ... }. deck-status schrijft, deck-actie leest.
function leesScenePlekken() {
  try { return JSON.parse(fs.readFileSync(CONFIG.scenePlekkenPath, "utf8")) || {}; } catch (_err) { return {}; }
}
function schrijfScenePlekken(plekken) {
  try {
    fs.mkdirSync(path.dirname(CONFIG.scenePlekkenPath), { recursive: true });
    const tmp = `${CONFIG.scenePlekkenPath}.${process.pid}`;
    fs.writeFileSync(tmp, JSON.stringify(plekken));
    fs.renameSync(tmp, CONFIG.scenePlekkenPath);
  } catch (_err) {}
}

// Ontwerpsysteem: de staat die de scripts zetten (fy_<key>_s) → de stand die je ziet.
// De soort bepaalt de strook, de stand het vlak. Kleuren staan alleen in deck.json → ontwerp.
const STAAT_NAAR_STAND = {
  leeg: "leeg", uit: "uit", onbekend: "onbekend",
  klaar: "kan", camera: "kan", knop: "kan", blauw: "kan", magenta: "kan", ok: "kan",
  volgende: "volgende",
  aan: "aan", gelukt: "aan",
  actief: "loopt", bezig: "loopt",
  mute: "muted",
  warn: "half",
  fout: "fout", mislukt: "fout",
};
const ALLE_STATEN = Object.keys(STAAT_NAAR_STAND);

function standVan(staat) {
  return STAAT_NAAR_STAND[staat] || "kan";
}

const varTekst = (key) => `fy_${key}_t`;
const varStaat = (key) => `fy_${key}_s`;
const varMaat = (key) => `fy_${key}_m`;

// Lettergrootte voor een knop waarvan de langste regel `tekens` tekens heeft.
// Zo groot mogelijk, maar onder de strook passen twee regels: hooguit 18.
const fontSize = (tekens) => Math.min(18, Math.floor(64 / (0.68 * Math.max(tekens, 4))));
const MAAT_MIN = 6;
const MAAT_MAX = 12;

// Vrije tekst (bijv. uit de catalogus) → hooguit twee regels, zo groot mogelijk.
// Breekt op spaties en na een "-". `weglaten`: voorloopwoord dat weg mag als dat kleiner uitvalt.
function pasLabel(tekst, weglaten = "") {
  const schoon = String(tekst || "").toUpperCase().replace(/\s+/g, " ").trim();
  const indeling = (t) => {
    const stukken = t.split(" ").flatMap((w, i) => w.split(/(?<=-)/).map((d, k) => ({ d, spatie: i > 0 && k === 0 })));
    const plak = (lijst) => lijst.map((x, i) => (i && x.spatie ? " " : "") + x.d).join("");
    let best = [plak(stukken)];
    for (let i = 1; i < stukken.length; i += 1) {
      const regels = [plak(stukken.slice(0, i)), plak(stukken.slice(i))];
      if (Math.max(...regels.map((r) => r.length)) < Math.max(...best.map((r) => r.length))) best = regels;
    }
    return best;
  };
  let regels = indeling(schoon);
  const voor = String(weglaten).toUpperCase();
  if (voor && schoon.startsWith(`${voor} `)) {
    const kort = indeling(schoon.slice(voor.length + 1));
    if (Math.max(...kort.map((r) => r.length)) < Math.max(...regels.map((r) => r.length))) regels = kort;
  }
  regels = regels.filter(Boolean).map((r) => (r.length > MAAT_MAX ? `${r.slice(0, MAAT_MAX - 1)}.` : r));
  return regels;
}

// Grootteklasse voor een tekst: aantal tekens van de langste regel, binnen MAAT_MIN..MAAT_MAX.
function maatVan(tekst) {
  const n = Math.max(...String(tekst).split("\n").map((r) => r.length));
  return String(Math.min(MAAT_MAX, Math.max(MAAT_MIN, n)));
}

function log(entry) {
  try {
    fs.mkdirSync(path.dirname(CONFIG.logPath), { recursive: true });
    fs.appendFileSync(CONFIG.logPath, `${JSON.stringify({ at: new Date().toISOString(), ...entry })}\n`);
  } catch (_err) {}
}

async function fetchJson(url, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Number(options.timeoutMs || 1000));
  try {
    const response = await fetch(url, {
      method: options.method || "GET",
      headers: options.body ? { "content-type": "application/json" } : {},
      body: options.body ? JSON.stringify(options.body) : undefined,
      signal: controller.signal,
    });
    const text = await response.text();
    let body = {};
    try { body = text ? JSON.parse(text) : {}; } catch (_err) { body = { raw: text }; }
    return { ok: response.ok, status: response.status, body };
  } catch (err) {
    return { ok: false, status: 0, body: { error: err && err.name === "AbortError" ? "timeout" : String(err && err.message || err) } };
  } finally {
    clearTimeout(timer);
  }
}

async function setVar(name, value) {
  const url = `${CONFIG.companionUrl}/api/custom-variable/${encodeURIComponent(name)}/value?value=${encodeURIComponent(value)}`;
  const result = await fetchJson(url, { method: "POST", timeoutMs: 800 });
  return result.ok;
}

// Een knop "vasthouden": deck-status.js schrijft die knop niet tot `until`.
function hold(key, ms) {
  try {
    fs.mkdirSync(CONFIG.holdDir, { recursive: true });
    fs.writeFileSync(path.join(CONFIG.holdDir, key), String(Date.now() + ms));
  } catch (_err) {}
}

function heldUntil(key) {
  try {
    return Number(fs.readFileSync(path.join(CONFIG.holdDir, key), "utf8")) || 0;
  } catch (_err) {
    return 0;
  }
}

function clearHold(key) {
  try { fs.unlinkSync(path.join(CONFIG.holdDir, key)); } catch (_err) {}
}

function numericLegacyId(...values) {
  for (const value of values) {
    if (value == null || value === "") continue;
    if (/^\d+$/.test(String(value))) {
      const direct = Number.parseInt(String(value), 10);
      if (direct > 0) return direct;
    }
    const match = String(value).match(/(?:^|:)(\d+)$/);
    if (match && Number(match[1]) > 0) return Number(match[1]);
  }
  return 0;
}

// Zelfde regels als het oude foryou-show-control-cue-button.js.
function teleprompterReadyGate(runtimeState, teleprompterPayload) {
  if (!runtimeState || !runtimeState.showRunId || runtimeState.status === "idle") return { allowed: false, reason: "runtime_no_active_run" };
  if (runtimeState.activeSituation) return { allowed: false, reason: "runtime_active_situation" };
  const preparedRuntime = runtimeState.resolvedPreparedNext;
  if (!preparedRuntime) return { allowed: false, reason: "runtime_no_prepared_scene" };
  if (!teleprompterPayload || teleprompterPayload.ok === false) return { allowed: false, reason: "teleprompter_unavailable" };
  const preparedScene = teleprompterPayload.preparedScene || {};
  if (!preparedScene.sceneId && !preparedScene.title) return { allowed: false, reason: "teleprompter_no_prepared_scene" };
  if (String(preparedScene.status || "") !== "prepared") return { allowed: false, reason: "teleprompter_not_prepared" };
  if (preparedScene.ready) return { allowed: false, reason: "teleprompter_already_ready" };
  const teleprompt = teleprompterPayload.teleprompt || {};
  if (!Array.isArray(teleprompt.lines) || !teleprompt.lines.length) return { allowed: false, reason: "teleprompter_no_script_text" };
  const runtimeSceneId = numericLegacyId(preparedRuntime.legacySituationId, preparedRuntime.situationId);
  const preparedSceneId = numericLegacyId(preparedScene.sceneId);
  if (runtimeSceneId && preparedSceneId && runtimeSceneId !== preparedSceneId) return { allowed: false, reason: "teleprompter_prepared_scene_mismatch" };
  const telepromptSceneId = numericLegacyId(teleprompt.source && teleprompt.source.sceneId);
  if (!telepromptSceneId) return { allowed: false, reason: "teleprompter_text_not_from_scene_chat" };
  if (preparedSceneId && telepromptSceneId !== preparedSceneId) return { allowed: false, reason: "teleprompter_text_scene_mismatch" };
  return { allowed: true, reason: "ready_allowed" };
}

// De vaste volgorde van een scène op het deck:
//   (in de startfase eerst STEM) → SCENE CHAT → READY → START SCENE → STOP SCENE.
// Geeft per knop of hij nu mag, en anders in twee korte regels waarom niet. De statusdienst maakt
// een knop die niet mag donker; een druk erop doet niets en laat even de reden zien.
// rt = stand van de runtime, tp = stand van de teleprompter, stem = stand van de stemming.
function showVolgorde(rt, tp, stem) {
  const mag = { mag: true, waarom: "" };
  const nee = (waarom) => ({ mag: false, waarom });
  const run = !!(rt && rt.showRunId && rt.status !== "idle");
  const scene = !!(rt && rt.activeSituation);
  const prepared = rt ? rt.resolvedPreparedNext : null;
  const reden = rt && rt.preparedNext ? String(rt.preparedNext.reason || "") : "";
  // In de startfase kiest het publiek de scène: tot de uitslag er is staat er nog niets vast.
  const startfase = !!(rt && rt.startPhase && rt.startPhase.active);
  const gekozen = reden === "operator_chosen" || reden === "test_run_hold";
  const stemLoopt = !!(stem && stem.actief);
  const wachtOpStem = startfase && !gekozen;
  const ps = (tp && tp.preparedScene) || {};
  const runtimeId = prepared ? numericLegacyId(prepared.legacySituationId, prepared.situationId) : 0;
  const teleId = numericLegacyId(ps.sceneId);
  // READY is gegeven voor de scène die klaarstaat.
  const ready = !!prepared && !!ps.ready && String(ps.status || "") === "prepared" && (!runtimeId || !teleId || runtimeId === teleId);
  const gate = teleprompterReadyGate(rt, tp);
  const geenTeleprompter = !tp || tp.ok === false;

  const algemeen = !run ? nee("NO\nRUN") : scene ? nee("SCENE\nLOOPT") : null;
  const voorScene = algemeen || (stemLoopt ? nee("STEM\nLOOPT") : wachtOpStem ? nee("EERST\nSTEM") : !prepared ? nee("GEEN\nSCENE") : null);
  return {
    ready,
    stemLoopt,
    // Een run resetten kan niet terwijl er een scène speelt: eerst de scène stoppen.
    run: !rt ? nee("RUN\n--") : run && scene ? nee("EERST\nSTOP") : mag,
    // Stemmen kan alleen in de startfase, tussen twee scènes. Loopt de stemming, dan sluit de knop hem.
    stem: algemeen || (stemLoopt ? mag : !startfase ? nee("STARTS\nKLAAR") : gekozen ? nee("AL\nGEKOZEN") : mag),
    chat: voorScene || mag,
    // OVERSLAAN: de scène die klaarstaat vervalt; kan tot de scène start, ook vaker achter elkaar.
    overslaan: voorScene || mag,
    ready_knop: voorScene || (ready ? nee("AL\nREADY") : gate.allowed ? mag : nee(geenTeleprompter ? "READY\n--" : "EERST\nCHAT")),
    // Stoppen mag altijd; starten pas als READY is gegeven voor de scène die klaarstaat.
    sit: !run ? nee("NO\nRUN") : scene ? mag : voorScene || (ready ? mag : nee(gate.allowed || geenTeleprompter ? "EERST\nREADY" : "EERST\nCHAT")),
    // INLOOP en LOADING zetten het beeld om; tijdens een scène niet.
    fase: scene ? nee("SCENE\nLOOPT") : mag,
  };
}

// ZAAL MIC: de microfoon van de operator over de speakers. Wat de knop toont:
// mic = antwoord van de helper (/api/state) of null, sq5 = mute-stand van de tafel.
function zaalMicStand(mic, sq5 = {}) {
  const zaal = mic && mic.zaal;
  if (!zaal) return { t: "MIC\n?", s: "onbekend" };
  if (zaal.open) {
    // Open, maar de weg van de Mac naar de speakers staat dicht op de tafel: niemand hoort het.
    const dicht = ["mac", "muziek", "main"].some((k) => sq5[k] === true);
    return dicht ? { t: "TAFEL\nDICHT", s: "mute" } : { t: "MIC\nOPEN", s: "actief" };
  }
  if (mic.verbonden === false) return { t: "MIC\nLOS", s: "uit" };
  if (mic.claudeNeemtOp === true) return { t: "MIC\nBEZET", s: "uit" };
  return { t: "ZAAL\nMIC", s: "klaar" };
}

// De microfoon gaat dicht zodra een scène begint (hij mag daarna in de scène wel weer open).
function zaalMicDichtBijStart(speeldeAl, speeltNu, open) {
  return speeldeAl === false && speeltNu === true && open === true;
}

module.exports = {
  ALLE_STATEN,
  zaalMicDichtBijStart,
  zaalMicStand,
  CONFIG,
  leesScenePlekken,
  sceneKnoppen,
  schrijfScenePlekken,
  standVan,
  DIR,
  allButtons,
  clearHold,
  fetchJson,
  heldUntil,
  hold,
  loadDeck,
  MAAT_MAX,
  MAAT_MIN,
  fontSize,
  log,
  maatVan,
  pasLabel,
  setVar,
  showVolgorde,
  teleprompterReadyGate,
  varMaat,
  varStaat,
  varTekst,
};
