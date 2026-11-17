"use strict";

// Bord 1 t/m 5 (blind ranking): de knop PLAATJE. Elke druk zet het volgende plaatje in beeld op
// het zaalscherm; een plaatje dat getoond is blijft staan. Het bord zelf (welke plaatjes, welke
// plek) staat in het script en leeft bij de teleprompter van de script-agent: de knop stuurt
// alleen "volgende". De knop is er bij een omgeving met "blind ranking" in de naam en doet het
// zodra de scène speelt.

const {
  SHOW_CONTROL_CUE_SCHEMA_VERSION,
  createShowControlId,
} = require("../../../shared/contracts/show-control-v0");
const { currentEnvironmentRef } = require("./environment-extras");
const { readFromCatalog } = require("./environment-fases");

const BORD_OMGEVING_RE = /blind\s*ranking/i;
const MAX_PLAATJES = 5;

// Per scène: hoeveel plaatjes er getoond zijn (voor de teller op de knop).
const state = { sleutel: "", getoond: 0 };

function resetBordState() {
  state.sleutel = "";
  state.getoond = 0;
}

function sleutelVoor(ref, runtimeState = {}) {
  const active = runtimeState && runtimeState.activeSituation ? runtimeState.activeSituation : {};
  const scene = active.situationRunId || active.runId || active.startedAt || active.situationId || (active.resolved && active.resolved.situationId) || "";
  return `${ref.environmentId}|${ref.bron}|${scene}`;
}

function omgevingsnaam(ref, options) {
  const resolved = ref.resolved || {};
  const naam = resolved.environment && resolved.environment.name || resolved.environmentName || "";
  if (naam) return String(naam);
  try {
    const read = readFromCatalog(ref.environmentId, options);
    return String(read && read.environment && read.environment.name || "");
  } catch (_err) {
    return "";
  }
}

function environmentBordStatus(runtimeState, options = {}) {
  const ref = currentEnvironmentRef(runtimeState);
  const base = { ok: true, environmentId: ref.environmentId, bron: ref.bron, klaar: false, speelt: false, reden: "", getoond: 0, totaal: MAX_PLAATJES };
  if (!ref.environmentId) return { ...base, reden: "geen_omgeving" };
  if (!BORD_OMGEVING_RE.test(omgevingsnaam(ref, options))) return { ...base, reden: "geen_bord" };
  const sleutel = sleutelVoor(ref, runtimeState);
  return {
    ...base,
    klaar: true,
    speelt: ref.bron === "actief",
    getoond: state.sleutel === sleutel ? state.getoond : 0,
    sleutel,
  };
}

// actie "volgende" (standaard): het volgende plaatje in beeld; "begin": alles weer weg.
function bordAction(actie, extra = {}) {
  return {
    targetId: "teleprompter",
    command: "teleprompter.bord",
    ackMode: "fire-and-forget",
    timeoutMs: 1500,
    payload: { ...extra, actie },
  };
}

function buildEnvironmentBordCue(runtimeState, input = {}, options = {}) {
  const status = environmentBordStatus(runtimeState, options);
  const actie = String(input.actie || "volgende") === "begin" ? "begin" : "volgende";
  if (!status.klaar || (actie === "volgende" && !status.speelt)) {
    const err = new Error(status.reden || "scene_speelt_niet");
    err.statusCode = 409;
    err.code = status.reden || "scene_speelt_niet";
    throw err;
  }
  state.sleutel = status.sleutel;
  state.getoond = actie === "begin" ? 0 : Math.min(status.getoond + 1, MAX_PLAATJES);
  const createdAtDate = options.createdAtDate || new Date();
  const cueId = createShowControlId("show-cue", createdAtDate);
  const payloadId = `${cueId}:payload:01`;
  return {
    schemaVersion: SHOW_CONTROL_CUE_SCHEMA_VERSION,
    cueId,
    cueType: "pulse",
    cueIntent: "environment-bord",
    name: input.name || (actie === "begin" ? "Bord: leeg" : `Bord: plaatje ${state.getoond}`),
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
      ...bordAction(actie, { environmentId: status.environmentId, source: String(input.source || "streamdeck"), cueIntent: "environment_bord" }),
      delayMs: 0,
      parallelGroup: null,
      required: false,
      payloadId,
      transport: { type: "http-or-internal" },
      simulate: null,
      status: { stage: "queued", state: "queued", message: null, updatedAt: null },
    }],
  };
}

module.exports = {
  MAX_PLAATJES,
  bordAction,
  buildEnvironmentBordCue,
  environmentBordStatus,
  resetBordState,
};
