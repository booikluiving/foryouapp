"use strict";

// Effect "omvallen" van de omgeving die nu speelt (of klaarstaat): elke druk op de knop laat
// de volgende kast vallen. De clips en omvallen.json maakt modules/catalog/tools/omvallen-clips.js
// uit de compositie in de catalogus; ze staan bij de media van de omgeving.

const fs = require("node:fs");
const path = require("node:path");
const {
  SHOW_CONTROL_CUE_SCHEMA_VERSION,
  createShowControlId,
} = require("../../../shared/contracts/show-control-v0");
const { currentEnvironmentRef } = require("./environment-extras");

const DEFAULT_MEDIA_ROOT = path.resolve(__dirname, "../../catalog/media");

function mediaRoot(options = {}) {
  return String(options.catalogMediaRoot || process.env.CATALOG_MEDIA_ROOT || DEFAULT_MEDIA_ROOT);
}

function omvallenDir(environmentId, options = {}) {
  return path.join(mediaRoot(options), "environments", String(environmentId).replace(":", "_"), "omvallen");
}

function readManifestFile(filePath) {
  try {
    const manifest = JSON.parse(fs.readFileSync(filePath, "utf8"));
    return manifest && Array.isArray(manifest.drukken) ? manifest : null;
  } catch (_err) {
    return null;
  }
}

// Een omgeving kan per situatie eigen stappen hebben: omvallen-situation_<nr>.json naast
// omvallen.json. Speelt die situatie, dan gelden haar stappen; anders die van de omgeving.
function readManifest(environmentId, options = {}, situationId = "") {
  if (options.manifest) return options.manifest;
  const dir = omvallenDir(environmentId, options);
  const eigen = situationId
    ? readManifestFile(path.join(dir, `omvallen-${String(situationId).replace(":", "_")}.json`))
    : null;
  return eigen || readManifestFile(path.join(dir, "omvallen.json"));
}

function situationIdOf(resolved) {
  if (!resolved || typeof resolved !== "object") return "";
  return String(resolved.situationId || (resolved.situation && resolved.situation.id) || "").trim();
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

// Waar het effect staat: per omgeving en per scène; een nieuwe scène begint weer bij het begin.
const state = { sleutel: "", pos: 0 };

// Vanzelf: zolang de scène speelt komt er af en toe uit zichzelf een korte clip langs
// (bij de persconferentie: één flits). Staat in omvallen.json onder "vanzelf":
// { clips: [...], duur, geluid of geluiden: [...], volume, minSec, maxSec }. Telt niet mee als druk.
const vanzelf = { sleutel: "", volgendeOp: 0, bezigTot: 0, teller: 0 };

function resetOmvallenState() {
  state.sleutel = "";
  state.pos = 0;
  vanzelf.sleutel = "";
  vanzelf.volgendeOp = 0;
  vanzelf.bezigTot = 0;
  vanzelf.teller = 0;
}

function vanzelfConfig(manifest) {
  const v = manifest && manifest.vanzelf;
  if (!v || !Array.isArray(v.clips) || !v.clips.length) return null;
  const minSec = Math.max(1, Number(v.minSec) || 10);
  return {
    clips: v.clips.map(String),
    duur: Number(v.duur) || 0,
    // "geluiden": meerdere geluiden die om de beurt klinken; anders het ene "geluid".
    geluiden: (Array.isArray(v.geluiden) && v.geluiden.length ? v.geluiden : [v.geluid]).filter(Boolean).map(String),
    volume: Number.isFinite(Number(v.volume)) ? Number(v.volume) : 1,
    minSec,
    maxSec: Math.max(minSec, Number(v.maxSec) || minSec),
  };
}

function vanzelfWachttijdMs(config, options = {}) {
  const random = typeof options.random === "function" ? options.random : Math.random;
  return Math.round((config.minSec + random() * (config.maxSec - config.minSec)) * 1000);
}

function sleutelVoor(ref, runtimeState = {}) {
  const active = runtimeState && runtimeState.activeSituation ? runtimeState.activeSituation : {};
  const scene = active.runId || active.startedAt || active.situationId || (active.resolved && active.resolved.situationId) || "";
  return `${ref.environmentId}|${ref.bron}|${scene}`;
}

function environmentOmvallenStatus(runtimeState, options = {}) {
  const ref = currentEnvironmentRef(runtimeState);
  const base = { ok: true, environmentId: ref.environmentId, bron: ref.bron, klaar: false, reden: "", pos: 0, totaal: 0, volgende: "" };
  if (!ref.environmentId) return { ...base, reden: "geen_omgeving" };
  const manifest = readManifest(ref.environmentId, options, situationIdOf(ref.resolved));
  if (!manifest || !manifest.drukken.length) return { ...base, reden: "geen_effect" };
  const sleutel = sleutelVoor(ref, runtimeState);
  // "herhaal" in omvallen.json: de knop blijft doorgaan (salvo flitsen), zonder einde en zonder teller.
  const herhaal = manifest.herhaal === true;
  const gedrukt = state.sleutel === sleutel ? state.pos : 0;
  const pos = herhaal ? gedrukt : Math.min(gedrukt, manifest.drukken.length);
  const volgende = manifest.drukken[herhaal ? pos % manifest.drukken.length : pos];
  return {
    ...base,
    klaar: true,
    herhaal,
    pos,
    totaal: manifest.drukken.length,
    volgende: volgende ? volgende.naam : "begin",
    sleutel,
    manifest,
  };
}

function publicOmvallenStatus(status) {
  const { manifest, sleutel, ...rest } = status || {};
  return rest;
}

function cueAction(cueId, index, targetId, command, payload, delayMs = 0) {
  const payloadId = `${cueId}:payload:${String(index + 1).padStart(2, "0")}`;
  return {
    actionId: `${cueId}:action:${String(index + 1).padStart(2, "0")}`,
    targetId,
    command,
    ackMode: "fire-and-forget",
    delayMs,
    timeoutMs: 1500,
    parallelGroup: null,
    required: false,
    payloadId,
    payload,
    transport: targetId === "touchdesigner"
      ? { type: "osc-control-intent", address: "/td/cue", args: [cueId, command, payloadId] }
      : { type: "http-or-internal" },
    simulate: null,
    status: { stage: "queued", state: "queued", message: null, updatedAt: null },
  };
}

function omvallenError(code, status) {
  const err = new Error(code);
  err.statusCode = 409;
  err.code = code;
  err.omvallen = status ? publicOmvallenStatus(status) : null;
  return err;
}

// actie "volgende" (standaard): de volgende stap; na de laatste stap terug naar het begin.
// actie "begin": terug naar het begin.
function buildEnvironmentOmvallenCue(runtimeState, input = {}, options = {}) {
  const status = environmentOmvallenStatus(runtimeState, options);
  if (!status.environmentId) throw omvallenError("geen_omgeving", status);
  if (!status.klaar) throw omvallenError(status.reden || "geen_effect", status);
  const actie = String(input.actie || "volgende");
  const naarBegin = actie === "begin" || (!status.herhaal && status.pos >= status.totaal);
  const createdAtDate = options.createdAtDate || new Date();
  const cueId = createShowControlId("show-cue", createdAtDate);
  const common = {
    environmentId: status.environmentId,
    source: String(input.source || "streamdeck"),
    cueIntent: "environment_omvallen",
  };
  const actions = [];
  let naam = "begin";
  if (naarBegin) {
    actions.push(cueAction(cueId, 0, "touchdesigner", "td.effect.omvallen", { ...common, filePath: "", uit: true, druk: 0 }));
    // Heeft een stap het sfeergeluid gewisseld, dan komt bij het begin dat van de omgeving terug.
    if (status.manifest.drukken.some((druk) => druk && druk.sfeer)) {
      actions.push(cueAction(cueId, actions.length, "touchdesigner", "td.effect.fase", { ...common, filePath: "", uit: true, schok: false, schokNa: 0, sfeerPath: "" }));
    }
    state.sleutel = status.sleutel;
    state.pos = 0;
  } else {
    const druk = status.manifest.drukken[status.herhaal ? status.pos % status.totaal : status.pos];
    const dir = omvallenDir(status.environmentId, options);
    const clip = path.join(dir, String(druk.clip || ""));
    if (!fileExists(clip, options)) throw omvallenError("clip_ontbreekt", status);
    naam = druk.naam || `stap ${druk.druk}`;
    actions.push(cueAction(cueId, 0, "touchdesigner", "td.effect.omvallen", { ...common, filePath: clip, uit: false, druk: druk.druk, duur: Number(druk.duur) || 0 }));
    const geluid = druk.geluid ? path.join(mediaRoot(options), String(druk.geluid)) : "";
    if (geluid && fileExists(geluid, options)) {
      actions.push(cueAction(cueId, actions.length, "mac-audio", "audio.extra.play", {
        ...common,
        soort: "geluid",
        label: naam,
        filePath: geluid,
        volume: 1,
      }, Math.round(Number(druk.klap || 0) * 1000)));
    }
    // Een stap kan het sfeergeluid wisselen (bijvoorbeeld: er wordt opgenomen, het bellen stopt).
    // Dat gaat langs de weg van de fases; de achtergrond blijft staan.
    const sfeer = druk.sfeer ? path.join(mediaRoot(options), String(druk.sfeer)) : "";
    if (sfeer && fileExists(sfeer, options)) {
      actions.push(cueAction(cueId, actions.length, "touchdesigner", "td.effect.fase", {
        ...common, filePath: "", uit: true, schok: false, schokNa: 0, sfeerPath: sfeer,
      }, Math.round(Number(druk.klap || 0) * 1000)));
    }
    state.sleutel = status.sleutel;
    state.pos = status.pos + 1;
    // Tijdens deze clip geen flits vanzelf eroverheen.
    vanzelf.bezigTot = Number(options.now ?? Date.now()) + Math.round((Number(druk.duur) || 0) * 1000) + 500;
  }
  return {
    schemaVersion: SHOW_CONTROL_CUE_SCHEMA_VERSION,
    cueId,
    cueType: "pulse",
    cueIntent: "environment-omvallen",
    name: input.name || `Omvallen: ${naam}`,
    createdAt: createdAtDate.toISOString(),
    source: { type: "show-control-v0", readOnly: false },
    runtimeRef: runtimeState ? {
      source: status.bron === "actief" ? "runtime.activeSituation" : "runtime.resolvedPreparedNext",
      showRunId: runtimeState.showRunId || null,
      runtimeUpdatedAt: runtimeState.updatedAt || null,
    } : null,
    status: { stage: "queued", state: "queued", warnings: [], sentOrder: [], updatedAt: createdAtDate.toISOString() },
    actions,
  };
}

// Eén tik van de klok (de server roept dit om de paar seconden aan). Geeft een cue als het
// tijd is voor de volgende clip vanzelf, anders null. Alleen bij een scène die speelt.
function environmentVanzelfTick(runtimeState, options = {}) {
  const now = Number(options.now ?? Date.now());
  let status;
  try {
    status = environmentOmvallenStatus(runtimeState, options);
  } catch (_err) {
    status = null;
  }
  const config = status && status.klaar && status.bron === "actief" ? vanzelfConfig(status.manifest) : null;
  if (!config) {
    vanzelf.sleutel = "";
    return null;
  }
  if (vanzelf.sleutel !== status.sleutel) {
    vanzelf.sleutel = status.sleutel;
    vanzelf.volgendeOp = now + vanzelfWachttijdMs(config, options);
    return null;
  }
  if (now < vanzelf.volgendeOp || now < vanzelf.bezigTot) return null;
  vanzelf.volgendeOp = now + vanzelfWachttijdMs(config, options);
  const dir = omvallenDir(status.environmentId, options);
  const clip = path.join(dir, config.clips[vanzelf.teller % config.clips.length]);
  vanzelf.teller += 1;
  if (!fileExists(clip, options)) return null;
  const createdAtDate = options.createdAtDate || new Date(now);
  const cueId = createShowControlId("show-cue", createdAtDate);
  const common = { environmentId: status.environmentId, source: "vanzelf", cueIntent: "environment_omvallen" };
  const actions = [cueAction(cueId, 0, "touchdesigner", "td.effect.omvallen", { ...common, filePath: clip, uit: false, druk: 0, duur: config.duur })];
  const geluid = config.geluiden.length ? path.join(mediaRoot(options), config.geluiden[(vanzelf.teller - 1) % config.geluiden.length]) : "";
  if (geluid && config.volume > 0 && fileExists(geluid, options)) {
    actions.push(cueAction(cueId, 1, "mac-audio", "audio.extra.play", { ...common, soort: "geluid", label: "vanzelf", filePath: geluid, volume: config.volume }));
  }
  vanzelf.bezigTot = now + Math.round(config.duur * 1000) + 500;
  return {
    schemaVersion: SHOW_CONTROL_CUE_SCHEMA_VERSION,
    cueId,
    cueType: "pulse",
    cueIntent: "environment-omvallen",
    name: "Omvallen: vanzelf",
    createdAt: createdAtDate.toISOString(),
    source: { type: "show-control-v0", readOnly: false },
    runtimeRef: runtimeState ? {
      source: "runtime.activeSituation",
      showRunId: runtimeState.showRunId || null,
      runtimeUpdatedAt: runtimeState.updatedAt || null,
    } : null,
    status: { stage: "queued", state: "queued", warnings: [], sentOrder: [], updatedAt: createdAtDate.toISOString() },
    actions,
  };
}

module.exports = {
  buildEnvironmentOmvallenCue,
  environmentVanzelfTick,
  environmentOmvallenStatus,
  publicOmvallenStatus,
  resetOmvallenState,
};
