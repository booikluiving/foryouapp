"use strict";

// Startgeluid van een omgeving: een geluid dat vanzelf klinkt als de scène begint (de intro van
// The Voice, de jingle van de Podcaststudio) en dat de operator met de knop INTRO opnieuw kan
// laten horen. Geen eigen veld: het is "Geluid bij ingaan" (geluidAssetId) van de fase die bij de
// scène hoort (situationId), en anders van de eerste fase van de omgeving.

const {
  SHOW_CONTROL_CUE_SCHEMA_VERSION,
  createShowControlId,
} = require("../../../shared/contracts/show-control-v0");
const { currentEnvironmentRef } = require("./environment-extras");
const { assetFilePath, fileExists, isPresent, readFromCatalog } = require("./environment-fases");

function situationIdVan(runtimeState, ref) {
  const active = runtimeState && runtimeState.activeSituation ? runtimeState.activeSituation : null;
  if (ref.bron === "actief" && active) return String(active.situationId || (active.resolved && active.resolved.situationId) || "");
  const next = runtimeState && runtimeState.resolvedPreparedNext ? runtimeState.resolvedPreparedNext : null;
  const prepared = runtimeState && runtimeState.preparedNext ? runtimeState.preparedNext : null;
  return String((next && next.situationId) || (prepared && prepared.situationId) || "");
}

function startGeluidStatus(runtimeState, options = {}) {
  const ref = currentEnvironmentRef(runtimeState);
  const base = { ok: true, environmentId: ref.environmentId, bron: ref.bron, klaar: false, reden: "", naam: "", filePath: "" };
  if (!ref.environmentId) return { ...base, reden: "geen_omgeving" };
  const read = readFromCatalog(ref.environmentId, options);
  const lijst = (read.composition && Array.isArray(read.composition.fases) ? read.composition.fases : []).filter(Boolean);
  if (!lijst.length) return { ...base, reden: "geen_fases" };
  const situationId = situationIdVan(runtimeState, ref);
  const fase = (situationId && lijst.find((item) => item.situationId === situationId)) || lijst[0];
  if (!fase.geluidAssetId) return { ...base, reden: "geen_startgeluid" };
  const asset = (read.mediaAssets || []).filter(isPresent).find((item) => item.id === fase.geluidAssetId) || null;
  const filePath = asset ? assetFilePath(asset, options) : "";
  if (!fileExists(filePath, options)) return { ...base, reden: "bestand_ontbreekt" };
  return { ...base, klaar: true, naam: fase.naam || "Intro", filePath };
}

function payloadVoor(status, source) {
  return {
    soort: "geluid",
    environmentId: status.environmentId,
    label: "Intro",
    filePath: status.filePath,
    volume: 1,
    // Eigen spoor: een stap (stoel, buzzer) of het lied kapt de intro niet af, en andersom.
    spoor: "intro",
    source,
    cueIntent: "environment_startgeluid",
  };
}

// Actie die bij het starten van een scène meegaat; null als de omgeving geen startgeluid heeft.
function startGeluidAction(runtimeState, options = {}) {
  const status = startGeluidStatus(runtimeState, options);
  if (!status.klaar) return null;
  return {
    command: "audio.extra.play",
    targetId: "mac-audio",
    ackMode: "fire-and-forget",
    timeoutMs: 900,
    payload: payloadVoor(status, "scene-start"),
  };
}

// De knop INTRO: speelt het startgeluid opnieuw vanaf het begin.
function buildStartGeluidCue(runtimeState, input = {}, options = {}) {
  const status = startGeluidStatus(runtimeState, options);
  if (!status.klaar) {
    const err = new Error(status.reden || "geen_startgeluid");
    err.statusCode = 409;
    err.code = status.reden || "geen_startgeluid";
    throw err;
  }
  const createdAtDate = options.createdAtDate || new Date();
  const cueId = createShowControlId("show-cue", createdAtDate);
  const payloadId = `${cueId}:payload:01`;
  return {
    schemaVersion: SHOW_CONTROL_CUE_SCHEMA_VERSION,
    cueId,
    cueType: "pulse",
    cueIntent: "environment-startgeluid",
    name: input.name || "Intro",
    createdAt: createdAtDate.toISOString(),
    source: { type: "show-control-v0", readOnly: false },
    runtimeRef: null,
    status: { stage: "queued", state: "queued", warnings: [], sentOrder: [], updatedAt: createdAtDate.toISOString() },
    actions: [{
      actionId: `${cueId}:action:01`,
      targetId: "mac-audio",
      command: "audio.extra.play",
      ackMode: "fire-and-forget",
      delayMs: 0,
      timeoutMs: 1500,
      parallelGroup: null,
      required: false,
      payloadId,
      payload: payloadVoor(status, String(input.source || "streamdeck")),
      transport: { type: "http-or-internal" },
      simulate: null,
      status: { stage: "queued", state: "queued", message: null, updatedAt: null },
    }],
  };
}

module.exports = {
  buildStartGeluidCue,
  startGeluidAction,
  startGeluidStatus,
};
