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
  mainDir: env("FY_DECK_MAIN_DIR", path.join(HOME, "ForYou", "main")),
  // droog = knoppen doen niets buiten Companion (test): alleen loggen
  droog: env("FY_DECK_DROOG", "") === "1",
  holdDir: env("FY_DECK_HOLD_DIR", path.join(HOME, "Library", "Caches", "ForYouApp", "deck-hold")),
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

const varTekst = (key) => `fy_${key}_t`;
const varStaat = (key) => `fy_${key}_s`;
const varMaat = (key) => `fy_${key}_m`;

// Lettergrootte voor een knop waarvan de langste regel `tekens` tekens heeft.
const fontSize = (tekens) => Math.floor(64 / (0.8 * Math.max(tekens, 3)));
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

module.exports = {
  CONFIG,
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
  teleprompterReadyGate,
  varMaat,
  varStaat,
  varTekst,
};
