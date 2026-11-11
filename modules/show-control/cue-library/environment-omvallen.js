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

function readManifest(environmentId, options = {}) {
  if (options.manifest) return options.manifest;
  try {
    const manifest = JSON.parse(fs.readFileSync(path.join(omvallenDir(environmentId, options), "omvallen.json"), "utf8"));
    return manifest && Array.isArray(manifest.drukken) ? manifest : null;
  } catch (_err) {
    return null;
  }
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

function resetOmvallenState() {
  state.sleutel = "";
  state.pos = 0;
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
  const manifest = readManifest(ref.environmentId, options);
  if (!manifest || !manifest.drukken.length) return { ...base, reden: "geen_effect" };
  const sleutel = sleutelVoor(ref, runtimeState);
  const pos = state.sleutel === sleutel ? Math.min(state.pos, manifest.drukken.length) : 0;
  const volgende = manifest.drukken[pos];
  return {
    ...base,
    klaar: true,
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
  const naarBegin = actie === "begin" || status.pos >= status.totaal;
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
    state.sleutel = status.sleutel;
    state.pos = 0;
  } else {
    const druk = status.manifest.drukken[status.pos];
    const dir = omvallenDir(status.environmentId, options);
    const clip = path.join(dir, String(druk.clip || ""));
    if (!fileExists(clip, options)) throw omvallenError("clip_ontbreekt", status);
    naam = druk.naam || `stap ${druk.druk}`;
    actions.push(cueAction(cueId, 0, "touchdesigner", "td.effect.omvallen", { ...common, filePath: clip, uit: false, druk: druk.druk, duur: Number(druk.duur) || 0 }));
    const geluid = druk.geluid ? path.join(mediaRoot(options), String(druk.geluid)) : "";
    if (geluid && fileExists(geluid, options)) {
      actions.push(cueAction(cueId, 1, "mac-audio", "audio.extra.play", {
        ...common,
        soort: "geluid",
        label: naam,
        filePath: geluid,
        volume: 1,
      }, Math.round(Number(druk.klap || 0) * 1000)));
    }
    state.sleutel = status.sleutel;
    state.pos = status.pos + 1;
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

module.exports = {
  buildEnvironmentOmvallenCue,
  environmentOmvallenStatus,
  publicOmvallenStatus,
  resetOmvallenState,
};
