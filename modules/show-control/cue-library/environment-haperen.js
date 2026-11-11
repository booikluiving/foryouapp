"use strict";

// Haperen: het camerabeeld van één speler krijgt een slechte verbinding (grove blokken, schokkerig).
// Welke speler hapert staat bij de stappen van de scène (omvallen-situation_<nr>.json of
// omvallen.json): "haper": { "camera": 3, "naam": "Adolf" }.
// Houd-knop op het deck: aan zolang de knop is ingedrukt, uit bij loslaten. De sterkte (1-3) staat
// erbij ("sterkte"), anders 2.

const {
  SHOW_CONTROL_CUE_SCHEMA_VERSION,
  createShowControlId,
} = require("../../../shared/contracts/show-control-v0");
const { environmentOmvallenStatus } = require("./environment-omvallen");

const MAX_STERKTE = 3;
const STANDAARD_STERKTE = 2;

// Per scène: staat het aan.
const state = { sleutel: "", aan: false };

function resetHaperenState() {
  state.sleutel = "";
  state.aan = false;
}

function environmentHaperenStatus(runtimeState, options = {}) {
  const omvallen = environmentOmvallenStatus(runtimeState, options);
  const base = { ok: true, environmentId: omvallen.environmentId, bron: omvallen.bron, klaar: false, reden: "", camera: 0, naam: "", aan: false, sterkte: 0 };
  if (!omvallen.environmentId) return { ...base, reden: "geen_omgeving" };
  const haper = omvallen.manifest && omvallen.manifest.haper;
  const camera = haper ? Number(haper.camera) : 0;
  if (![1, 2, 3].includes(camera)) return { ...base, reden: "geen_haperen" };
  const sterkte = Math.round(Number(haper.sterkte));
  return {
    ...base,
    klaar: true,
    camera,
    naam: String(haper.naam || "").trim(),
    aan: state.sleutel === omvallen.sleutel && state.aan,
    sterkte: sterkte >= 1 && sterkte <= MAX_STERKTE ? sterkte : STANDAARD_STERKTE,
    sleutel: omvallen.sleutel,
  };
}

function publicHaperenStatus(status) {
  const { sleutel, ...rest } = status || {};
  return rest;
}

function haperenError(code, status) {
  const err = new Error(code);
  err.statusCode = 409;
  err.code = code;
  err.haperen = status ? publicHaperenStatus(status) : null;
  return err;
}

// actie "aan" (knop ingedrukt), "uit" (knop losgelaten of BEGIN), "wissel" (standaard): aan als
// het uit staat, anders uit.
function buildEnvironmentHaperCue(runtimeState, input = {}, options = {}) {
  const status = environmentHaperenStatus(runtimeState, options);
  if (!status.environmentId) throw haperenError("geen_omgeving", status);
  if (!status.klaar) throw haperenError(status.reden || "geen_haperen", status);
  const actie = String(input.actie || "wissel");
  const aan = actie === "aan" ? true : actie === "uit" || actie === "begin" ? false : !status.aan;
  const sterkte = status.sterkte;
  const createdAtDate = options.createdAtDate || new Date();
  const cueId = createShowControlId("show-cue", createdAtDate);
  const payloadId = `${cueId}:payload:01`;
  state.sleutel = status.sleutel;
  state.aan = aan;
  return {
    schemaVersion: SHOW_CONTROL_CUE_SCHEMA_VERSION,
    cueId,
    cueType: "pulse",
    cueIntent: "environment-haperen",
    name: input.name || `Haperen: ${aan ? `aan (${sterkte})` : "uit"}`,
    createdAt: createdAtDate.toISOString(),
    source: { type: "show-control-v0", readOnly: false },
    runtimeRef: runtimeState ? {
      source: status.bron === "actief" ? "runtime.activeSituation" : "runtime.resolvedPreparedNext",
      showRunId: runtimeState.showRunId || null,
      runtimeUpdatedAt: runtimeState.updatedAt || null,
    } : null,
    status: { stage: "queued", state: "queued", warnings: [], sentOrder: [], updatedAt: createdAtDate.toISOString() },
    actions: [{
      actionId: `${cueId}:action:01`,
      targetId: "touchdesigner",
      command: "td.effect.haper",
      ackMode: "fire-and-forget",
      delayMs: 0,
      timeoutMs: 1500,
      parallelGroup: null,
      required: false,
      payloadId,
      payload: {
        environmentId: status.environmentId,
        source: String(input.source || "streamdeck"),
        cueIntent: "environment_haperen",
        camera: status.camera,
        sterkte: aan ? sterkte : 0,
      },
      transport: { type: "osc-control-intent", address: "/td/cue", args: [cueId, "td.effect.haper", payloadId] },
      simulate: null,
      status: { stage: "queued", state: "queued", message: null, updatedAt: null },
    }],
  };
}

module.exports = {
  MAX_STERKTE,
  buildEnvironmentHaperCue,
  environmentHaperenStatus,
  publicHaperenStatus,
  resetHaperenState,
};
