"use strict";

// Extra shot en extra geluid van de omgeving die nu speelt (of klaarstaat).
// Bron: het omgevingsrecord in de catalogus (veld `extras`), live gelezen uit
// catalog.sqlite, zodat een wijziging van het team meteen op het deck staat.

const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");
const {
  SHOW_CONTROL_CUE_SCHEMA_VERSION,
  createShowControlId,
} = require("../../../shared/contracts/show-control-v0");
const {
  describeAction,
  normalizeEnvironmentExtras,
} = require("../../../shared/environment-extras/environment-extras-v0");

const DEFAULT_CATALOG_DB_PATH = path.resolve(__dirname, "../../catalog/db/catalog.sqlite");
const DEFAULT_MEDIA_ROOT = path.resolve(__dirname, "../../catalog/media");
const EXTRA_KINDS = ["shot", "geluid"];

function catalogDbPath(options = {}) {
  return String(options.catalogDbPath || process.env.CATALOG_DB_PATH || DEFAULT_CATALOG_DB_PATH);
}

function mediaRoot(options = {}) {
  return String(options.catalogMediaRoot || process.env.CATALOG_MEDIA_ROOT || DEFAULT_MEDIA_ROOT);
}

function environmentIdOf(resolved) {
  if (!resolved || typeof resolved !== "object") return "";
  return String(resolved.environmentId || (resolved.environment && resolved.environment.id) || "").trim();
}

// Actieve situatie gaat voor; anders de klaargezette volgende situatie.
function currentEnvironmentRef(runtimeState = {}) {
  const state = runtimeState && typeof runtimeState === "object" ? runtimeState : {};
  const active = state.activeSituation && state.activeSituation.resolved;
  const activeId = environmentIdOf(active);
  if (activeId) return { environmentId: activeId, bron: "actief", resolved: active };
  const prepared = state.resolvedPreparedNext;
  const preparedId = environmentIdOf(prepared);
  if (preparedId) return { environmentId: preparedId, bron: "klaar", resolved: prepared };
  return { environmentId: "", bron: "geen", resolved: null };
}

function parseJson(text) {
  try {
    return text ? JSON.parse(text) : null;
  } catch (_err) {
    return null;
  }
}

function readEnvironmentFromCatalog(environmentId, options = {}) {
  if (options.catalog) {
    const environment = (options.catalog.environments || []).find((item) => item.id === environmentId) || null;
    const mediaAssets = (options.catalog.mediaAssets || []).filter((item) => item.environmentId === environmentId);
    return { ok: !!environment, environment, mediaAssets };
  }
  let db = null;
  try {
    db = new DatabaseSync(catalogDbPath(options), { readOnly: true });
    const row = db.prepare("SELECT record_json FROM environments WHERE id = ? LIMIT 1").get(environmentId);
    const mediaAssets = db
      .prepare("SELECT record_json FROM media_assets WHERE environment_id = ? ORDER BY id")
      .all(environmentId)
      .map((item) => parseJson(item.record_json))
      .filter(Boolean);
    return { ok: !!row, environment: row ? parseJson(row.record_json) : null, mediaAssets };
  } catch (err) {
    return { ok: false, environment: null, mediaAssets: [], error: err && err.message ? String(err.message) : "catalog_read_failed" };
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
  const primary = asset.primaryFile && typeof asset.primaryFile === "object" ? asset.primaryFile : {};
  if (primary.absolutePath) return String(primary.absolutePath);
  if (asset.relativePath) return path.join(mediaRoot(options), String(asset.relativePath));
  return String(asset.filePath || "");
}

function backgroundAsset(mediaAssets) {
  return mediaAssets.filter(isPresent).find((asset) => (asset.role || asset.type) === "background") || null;
}

function extraAsset(mediaAssets, assetId, role) {
  if (!assetId) return null;
  return mediaAssets.filter(isPresent).find((asset) => asset.id === assetId && (asset.role || "") === role) || null;
}

function fileExists(filePath, options = {}) {
  if (!filePath) return false;
  if (typeof options.fileExists === "function") return options.fileExists(filePath);
  try {
    return require("node:fs").statSync(filePath).isFile();
  } catch (_err) {
    return false;
  }
}

// Bepaalt per extra of hij af te vuren is, en met welk bestand.
function resolveExtra(kind, extra, mediaAssets, options = {}) {
  const base = {
    label: extra.label || "",
    omschrijving: extra.omschrijving || "",
    bron: extra.bron || "",
    actie: describeAction(kind, extra),
    klaar: false,
    reden: "",
    filePath: "",
  };
  if (!extra.bron) return { ...base, reden: "geen_bron" };
  if (kind === "shot" && extra.bron === "camera") {
    return { ...base, klaar: true, camera: extra.camera || 1 };
  }
  let asset = null;
  if (kind === "shot" && extra.bron === "achtergrond") asset = backgroundAsset(mediaAssets);
  else if (extra.bron === "bestand") asset = extraAsset(mediaAssets, extra.bestand, kind === "shot" ? "extraShot" : "extraGeluid");
  if (!asset) return { ...base, reden: extra.bron === "achtergrond" ? "geen_achtergrond" : "geen_bestand" };
  const filePath = assetFilePath(asset, options);
  if (!fileExists(filePath, options)) return { ...base, reden: "bestand_ontbreekt", assetId: asset.id };
  return {
    ...base,
    klaar: true,
    assetId: asset.id,
    filePath,
    ...(kind === "shot" ? { duur: extra.duur } : { volume: extra.volume, lus: extra.lus === true }),
  };
}

function environmentExtrasStatus(runtimeState, options = {}) {
  const ref = currentEnvironmentRef(runtimeState);
  const empty = (reden) => ({
    label: "", omschrijving: "", bron: "", actie: "", klaar: false, reden, filePath: "",
  });
  if (!ref.environmentId) {
    return { ok: true, environmentId: "", environmentName: "", bron: "geen", shot: empty("geen_omgeving"), geluid: empty("geen_omgeving") };
  }
  const read = readEnvironmentFromCatalog(ref.environmentId, options);
  const record = read.environment || {};
  const extras = normalizeEnvironmentExtras(record.extras);
  const resolvedName = ref.resolved && ref.resolved.environment ? ref.resolved.environment.name : "";
  const result = {
    ok: true,
    environmentId: ref.environmentId,
    environmentName: record.name || resolvedName || ref.environmentId,
    bron: ref.bron,
    shot: resolveExtra("shot", extras.shot, read.mediaAssets || [], options),
    geluid: resolveExtra("geluid", extras.geluid, read.mediaAssets || [], options),
  };
  // Staat er nu een shot dat blijft staan (duur 0)? Dan kan het deck dat tonen.
  result.shot.aan = holdState.aan && holdState.environmentId === ref.environmentId;
  if (!read.ok && read.error) result.catalogError = read.error;
  return result;
}

// Een shot met duur 0 blijft staan; de volgende druk haalt hem weg.
const holdState = { environmentId: "", aan: false };

// Kort voor deck-status: geen bestandspaden.
function publicExtrasStatus(status) {
  const strip = (extra) => {
    const { filePath, assetId, ...rest } = extra || {};
    return rest;
  };
  return { ...status, shot: strip(status.shot), geluid: strip(status.geluid) };
}

function cueAction(cueId, index, targetId, command, ackMode, payload, timeoutMs = 1500) {
  const payloadId = `${cueId}:payload:${String(index + 1).padStart(2, "0")}`;
  return {
    actionId: `${cueId}:action:${String(index + 1).padStart(2, "0")}`,
    targetId,
    command,
    ackMode,
    delayMs: 0,
    timeoutMs,
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

function extraError(code, status) {
  const err = new Error(code);
  err.statusCode = 409;
  err.code = code;
  err.extras = status ? publicExtrasStatus(status) : null;
  return err;
}

function buildEnvironmentExtraCue(runtimeState, input = {}, options = {}) {
  const soort = String(input.soort || input.kind || "").trim();
  if (!EXTRA_KINDS.includes(soort)) {
    const err = new Error("show_control_invalid_extra_kind");
    err.statusCode = 400;
    throw err;
  }
  const status = environmentExtrasStatus(runtimeState, options);
  if (!status.environmentId) throw extraError("geen_omgeving", status);
  const wanted = String(input.environmentId || "").trim();
  if (wanted && wanted !== status.environmentId) throw extraError("andere_omgeving", status);
  const extra = status[soort];
  if (!extra.klaar) throw extraError(extra.reden === "geen_bron" ? "geen_extra" : extra.reden || "geen_extra", status);

  const createdAtDate = options.createdAtDate || new Date();
  const cueId = createShowControlId("show-cue", createdAtDate);
  const source = String(input.source || "streamdeck");
  const common = {
    soort,
    environmentId: status.environmentId,
    environmentName: status.environmentName,
    label: extra.label,
    source,
    cueIntent: `environment_extra_${soort}`,
  };
  const actions = [];
  if (soort === "geluid") {
    actions.push(cueAction(cueId, 0, "mac-audio", "audio.extra.play", "fire-and-forget", {
      ...common,
      filePath: extra.filePath,
      // De catalogus mag een volume meegeven om in de zaal te proberen, zonder te bewaren.
      volume: volumeOverride(input.volume, extra.volume),
      // De knop is aan/uit: drukken terwijl dit geluid speelt zet het uit, de druk daarna begint vooraan.
      wissel: true,
      // In een lus: het geluid begint vanzelf opnieuw tot de knop weer wordt ingedrukt.
      ...(extra.lus ? { lus: true } : {}),
    }));
  } else if (extra.camera) {
    actions.push(cueAction(cueId, 0, "touchdesigner", "td.camera.set", "acknowledged-async", {
      ...common,
      camera: extra.camera,
      cameraId: `camera:${extra.camera}`,
    }, 1200));
  } else {
    const blijft = Number(extra.duur) === 0;
    const uit = blijft && holdState.aan && holdState.environmentId === status.environmentId;
    holdState.environmentId = status.environmentId;
    holdState.aan = blijft && !uit;
    actions.push(cueAction(cueId, 0, "touchdesigner", "td.extra.shot", "fire-and-forget", {
      ...common,
      filePath: extra.filePath,
      duur: Number(extra.duur) || 0,
      uit,
    }));
  }
  return {
    schemaVersion: SHOW_CONTROL_CUE_SCHEMA_VERSION,
    cueId,
    cueType: "pulse",
    cueIntent: `environment-extra-${soort}`,
    name: input.name || `Extra ${soort}: ${extra.label || status.environmentName}`,
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

function volumeOverride(value, fallback) {
  if (value === undefined || value === null || value === "") return fallback;
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(0, Math.min(1, number));
}

// Volume van het sfeergeluid dat nu in TouchDesigner klaarstaat, meteen hoorbaar.
// Alleen voor de omgeving die nu in de show staat; bewaren gaat via de catalogus.
function buildSfeerVolumeCue(runtimeState, input = {}, options = {}) {
  const volume = volumeOverride(input.volume, null);
  if (volume === null) {
    const err = new Error("show_control_invalid_volume");
    err.statusCode = 400;
    throw err;
  }
  const status = environmentExtrasStatus(runtimeState, options);
  if (!status.environmentId) throw extraError("geen_omgeving", status);
  const wanted = String(input.environmentId || "").trim();
  if (wanted && wanted !== status.environmentId) throw extraError("andere_omgeving", status);
  const createdAtDate = options.createdAtDate || new Date();
  const cueId = createShowControlId("show-cue", createdAtDate);
  return {
    schemaVersion: SHOW_CONTROL_CUE_SCHEMA_VERSION,
    cueId,
    cueType: "pulse",
    cueIntent: "environment-sfeer-volume",
    name: `Sfeervolume ${Math.round(volume * 100)}%: ${status.environmentName}`,
    createdAt: createdAtDate.toISOString(),
    source: { type: "show-control-v0", readOnly: false },
    runtimeRef: null,
    status: { stage: "queued", state: "queued", warnings: [], sentOrder: [], updatedAt: createdAtDate.toISOString() },
    actions: [cueAction(cueId, 0, "touchdesigner", "td.sfeer.volume", "fire-and-forget", {
      environmentId: status.environmentId,
      environmentName: status.environmentName,
      volume,
      source: String(input.source || "catalogus"),
      cueIntent: "environment_sfeer_volume",
    })],
  };
}

function resetHoldState() {
  holdState.environmentId = "";
  holdState.aan = false;
}

module.exports = {
  buildEnvironmentExtraCue,
  buildSfeerVolumeCue,
  currentEnvironmentRef,
  environmentExtrasStatus,
  publicExtrasStatus,
  resetHoldState,
};
