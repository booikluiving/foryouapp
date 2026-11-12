"use strict";

// Fases van de omgeving die nu speelt (of klaarstaat): Rijden, Aanrijding, ... Elke fase heeft
// een eigen beeld (of de gewone achtergrond), en kan met een schok en het extra geluid ingaan.
// Bron: de compositie in de catalogus (veld `fases`), live gelezen uit catalog.sqlite.

const fs = require("node:fs");
const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");
const {
  SHOW_CONTROL_CUE_SCHEMA_VERSION,
  createShowControlId,
} = require("../../../shared/contracts/show-control-v0");
const { currentEnvironmentRef } = require("./environment-extras");

const DEFAULT_CATALOG_DB_PATH = path.resolve(__dirname, "../../catalog/db/catalog.sqlite");
const DEFAULT_MEDIA_ROOT = path.resolve(__dirname, "../../catalog/media");

function catalogDbPath(options = {}) {
  return String(options.catalogDbPath || process.env.CATALOG_DB_PATH || DEFAULT_CATALOG_DB_PATH);
}

function mediaRoot(options = {}) {
  return String(options.catalogMediaRoot || process.env.CATALOG_MEDIA_ROOT || DEFAULT_MEDIA_ROOT);
}

function parseJson(text) {
  try {
    return text ? JSON.parse(text) : null;
  } catch (_err) {
    return null;
  }
}

function readFromCatalog(environmentId, options = {}) {
  if (options.catalog) {
    return {
      composition: (options.catalog.environmentCompositions || []).find((item) => item.environmentId === environmentId) || null,
      environment: (options.catalog.environments || []).find((item) => item.id === environmentId) || null,
      mediaAssets: (options.catalog.mediaAssets || []).filter((item) => item.environmentId === environmentId),
    };
  }
  let db = null;
  try {
    db = new DatabaseSync(catalogDbPath(options), { readOnly: true });
    const comp = db.prepare("SELECT record_json FROM environment_compositions WHERE environment_id = ? LIMIT 1").get(environmentId);
    const env = db.prepare("SELECT record_json FROM environments WHERE id = ? LIMIT 1").get(environmentId);
    const mediaAssets = db.prepare("SELECT record_json FROM media_assets WHERE environment_id = ? ORDER BY id").all(environmentId)
      .map((item) => parseJson(item.record_json)).filter(Boolean);
    return { composition: comp ? parseJson(comp.record_json) : null, environment: env ? parseJson(env.record_json) : null, mediaAssets };
  } catch (_err) {
    return { composition: null, environment: null, mediaAssets: [] };
  } finally {
    if (db) {
      try { db.close(); } catch (_err) {}
    }
  }
}

function isPresent(asset) {
  const status = String(asset && asset.status || "present");
  return status !== "deleted" && status !== "replaced" && status !== "missing";
}

function assetFilePath(asset, options = {}) {
  if (!asset) return "";
  if (asset.relativePath) return path.join(mediaRoot(options), String(asset.relativePath));
  return String(asset.filePath || "");
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

// Welke fase aan staat: per omgeving en per scène; een nieuwe scène begint bij fase 1.
const state = { sleutel: "", index: 0 };

function resetFasesState() {
  state.sleutel = "";
  state.index = 0;
}

function sleutelVoor(ref, runtimeState = {}) {
  const active = runtimeState && runtimeState.activeSituation ? runtimeState.activeSituation : {};
  const scene = active.runId || active.startedAt || active.situationId || (active.resolved && active.resolved.situationId) || "";
  return `${ref.environmentId}|${ref.bron}|${scene}`;
}

function environmentFasesStatus(runtimeState, options = {}) {
  const ref = currentEnvironmentRef(runtimeState);
  const base = { ok: true, environmentId: ref.environmentId, bron: ref.bron, klaar: false, reden: "", actief: 0, fases: [] };
  if (!ref.environmentId) return { ...base, reden: "geen_omgeving" };
  const read = readFromCatalog(ref.environmentId, options);
  // Een fase die bij een situatie hoort gaat vanzelf aan met die situatie: geen stap van de knop.
  const lijst = (read.composition && Array.isArray(read.composition.fases) ? read.composition.fases : [])
    .filter((fase) => fase && !fase.situationId);
  if (!lijst.length) return { ...base, reden: "geen_fases" };
  const assets = (read.mediaAssets || []).filter(isPresent);
  const sleutel = sleutelVoor(ref, runtimeState);
  const actief = state.sleutel === sleutel ? Math.min(state.index, lijst.length - 1) : 0;
  const extras = read.environment && read.environment.extras ? read.environment.extras : {};
  const geluidId = extras.geluid && extras.geluid.bron === "bestand" ? extras.geluid.bestand : "";
  const geluid = assets.find((asset) => asset.id === geluidId && asset.role === "extraGeluid") || null;
  const fases = lijst.map((fase, index) => {
    const asset = fase.assetId ? assets.find((item) => item.id === fase.assetId) || null : null;
    const filePath = asset ? assetFilePath(asset, options) : "";
    return {
      index,
      naam: fase.naam || `Fase ${index + 1}`,
      schok: fase.schok === true,
      schokNa: Number(fase.schokNa) || 0,
      aan: index === actief,
      // Zonder beeld toont de fase de gewone achtergrond: dat kan altijd.
      klaar: !fase.assetId || fileExists(filePath, options),
      filePath,
      // Eigen sfeergeluid van deze fase (bijvoorbeeld na de aanrijding: tikken en vogels).
      sfeerPath: sfeerPathVoor(fase, assets, options),
      // Eigen geluid bij het ingaan (bijvoorbeeld de bom). Het zet het extra geluid van de omgeving uit.
      geluidPath: geluidPathVoor(fase, assets, options),
    };
  });
  return {
    ...base,
    klaar: true,
    actief,
    fases,
    sleutel,
    geluidPath: geluid ? assetFilePath(geluid, options) : "",
    geluidVolume: extras.geluid && Number.isFinite(Number(extras.geluid.volume)) ? Number(extras.geluid.volume) : 1,
  };
}

function sfeerPathVoor(fase, assets, options = {}) {
  if (!fase.sfeerAssetId) return "";
  const asset = assets.find((item) => item.id === fase.sfeerAssetId) || null;
  const filePath = asset ? assetFilePath(asset, options) : "";
  return fileExists(filePath, options) ? filePath : "";
}

function geluidPathVoor(fase, assets, options = {}) {
  if (!fase.geluidAssetId) return "";
  const asset = assets.find((item) => item.id === fase.geluidAssetId) || null;
  const filePath = asset ? assetFilePath(asset, options) : "";
  return fileExists(filePath, options) ? filePath : "";
}

function publicFasesStatus(status) {
  const { sleutel, geluidPath, geluidVolume, ...rest } = status || {};
  return { ...rest, fases: (rest.fases || []).map(({ filePath, sfeerPath, geluidPath, ...fase }) => ({ ...fase, sfeer: !!sfeerPath, eigenGeluid: !!geluidPath })) };
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

function fasesError(code, status) {
  const err = new Error(code);
  err.statusCode = 409;
  err.code = code;
  err.fases = status ? publicFasesStatus(status) : null;
  return err;
}

// input.index = de fase (0 = eerste); input.actie "volgende" = de volgende fase.
function buildEnvironmentFaseCue(runtimeState, input = {}, options = {}) {
  const status = environmentFasesStatus(runtimeState, options);
  if (!status.environmentId) throw fasesError("geen_omgeving", status);
  if (!status.klaar) throw fasesError(status.reden || "geen_fases", status);
  let index = Number.isInteger(Number(input.index)) && input.index !== undefined && input.index !== null && input.index !== ""
    ? Number(input.index)
    : NaN;
  if (String(input.actie || "") === "volgende") index = (status.actief + 1) % status.fases.length;
  if (!Number.isInteger(index) || index < 0 || index >= status.fases.length) throw fasesError("onbekende_fase", status);
  const fase = status.fases[index];
  if (!fase.klaar) throw fasesError("beeld_ontbreekt", status);

  const createdAtDate = options.createdAtDate || new Date();
  const cueId = createShowControlId("show-cue", createdAtDate);
  const common = {
    environmentId: status.environmentId,
    source: String(input.source || "streamdeck"),
    cueIntent: "environment_fase",
    fase: index,
    naam: fase.naam,
  };
  const actions = [];
  // Met schok: het geluid begint meteen; TD schudt de aanloop, wisselt het beeld op de klap
  // (schokNa seconden later) en schudt dan uit. Zo loopt het ook in de editor.
  // Een fase met een eigen geluid speelt dat (ook zonder schok) en zet het extra geluid van de
  // omgeving uit: de bom stopt het piepje.
  const geluidPath = fase.geluidPath || (fase.schok && fileExists(status.geluidPath, options) ? status.geluidPath : "");
  if (geluidPath) {
    actions.push(cueAction(cueId, actions.length, "mac-audio", "audio.extra.play", {
      ...common,
      soort: "geluid",
      label: fase.naam,
      filePath: geluidPath,
      volume: status.geluidVolume,
      ...(fase.geluidPath ? { stopLied: true } : {}),
    }));
  }
  actions.push(cueAction(cueId, actions.length, "touchdesigner", "td.effect.fase", {
    ...common,
    filePath: fase.filePath,
    uit: !fase.filePath,
    schok: fase.schok,
    schokNa: fase.schok ? fase.schokNa : 0,
    sfeerPath: fase.sfeerPath || "",
  }));
  state.sleutel = status.sleutel;
  state.index = index;
  return {
    schemaVersion: SHOW_CONTROL_CUE_SCHEMA_VERSION,
    cueId,
    cueType: "pulse",
    cueIntent: "environment-fase",
    name: input.name || `Fase: ${fase.naam}`,
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

module.exports = {
  assetFilePath,
  buildEnvironmentFaseCue,
  environmentFasesStatus,
  fileExists,
  isPresent,
  publicFasesStatus,
  readFromCatalog,
  resetFasesState,
};
