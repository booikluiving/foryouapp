"use strict";

// Haperen: het camerabeeld van één speler krijgt een slechte verbinding (grove blokken, schokkerig).
// Welke speler hapert staat bij de stappen van de scène (omvallen-situation_<nr>.json of
// omvallen.json): "haper": { "camera": 3, "naam": "Adolf" }.
// De knop zet het aan en uit; elke keer dat het aangaat is het een stap erger (1, 2, 3).

const {
  SHOW_CONTROL_CUE_SCHEMA_VERSION,
  createShowControlId,
} = require("../../../shared/contracts/show-control-v0");
const { environmentOmvallenStatus } = require("./environment-omvallen");

const MAX_STERKTE = 3;

// Per scène: staat het aan, en hoe erg was het de laatste keer.
const state = { sleutel: "", aan: false, sterkte: 0 };

function resetHaperenState() {
  state.sleutel = "";
  state.aan = false;
  state.sterkte = 0;
}

function environmentHaperenStatus(runtimeState, options = {}) {
  const omvallen = environmentOmvallenStatus(runtimeState, options);
  const base = { ok: true, environmentId: omvallen.environmentId, bron: omvallen.bron, klaar: false, reden: "", camera: 0, naam: "", aan: false, sterkte: 0 };
  if (!omvallen.environmentId) return { ...base, reden: "geen_omgeving" };
  const haper = omvallen.manifest && omvallen.manifest.haper;
  const camera = haper ? Number(haper.camera) : 0;
  if (![1, 2, 3].includes(camera)) return { ...base, reden: "geen_haperen" };
  const zelfde = state.sleutel === omvallen.sleutel;
  return {
    ...base,
    klaar: true,
    camera,
    naam: String(haper.naam || "").trim(),
    aan: zelfde && state.aan,
    sterkte: zelfde ? state.sterkte : 0,
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

// actie "wissel" (standaard): aan als het uit staat (een stap erger dan de vorige keer), anders uit.
// actie "begin": uit, en de volgende keer begint het weer bij de lichtste stap.
function buildEnvironmentHaperCue(runtimeState, input = {}, options = {}) {
  const status = environmentHaperenStatus(runtimeState, options);
  if (!status.environmentId) throw haperenError("geen_omgeving", status);
  if (!status.klaar) throw haperenError(status.reden || "geen_haperen", status);
  const begin = String(input.actie || "wissel") === "begin";
  const aan = !begin && !status.aan;
  const sterkte = begin ? 0 : aan ? Math.min(MAX_STERKTE, status.sterkte + 1) : status.sterkte;
  const createdAtDate = options.createdAtDate || new Date();
  const cueId = createShowControlId("show-cue", createdAtDate);
  const payloadId = `${cueId}:payload:01`;
  state.sleutel = status.sleutel;
  state.aan = aan;
  state.sterkte = sterkte;
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
