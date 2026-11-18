"use strict";

// Bord 1 t/m 5 (blind ranking): de knop BORD AAN. Eén druk aan het begin van de scène zet het
// bord met de rouleerde plaatjes in beeld; daarna loopt het vanzelf mee met de dialoog (de regels
// [PLAATJE] en [PLEK] in het script, bij de teleprompter van de script-agent). De knop is er bij
// een situatie met de schakelaar Blind ranking aan (catalogus, veld `blindRanking`) en doet het
// zodra de scène speelt.

const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");
const {
  SHOW_CONTROL_CUE_SCHEMA_VERSION,
  createShowControlId,
} = require("../../../shared/contracts/show-control-v0");
const { isBlindRanking } = require("../../../shared/blind-ranking/blind-ranking");
const { currentEnvironmentRef } = require("./environment-extras");
const { buildEnvironmentFaseCue } = require("./environment-fases");

const DEFAULT_CATALOG_DB_PATH = path.resolve(__dirname, "../../catalog/db/catalog.sqlite");

// Per scène: staat het bord aan.
const state = { sleutel: "", aan: false };

function resetBordState() {
  state.sleutel = "";
  state.aan = false;
}

function sleutelVoor(ref, runtimeState = {}) {
  const active = runtimeState && runtimeState.activeSituation ? runtimeState.activeSituation : {};
  const scene = active.situationRunId || active.runId || active.startedAt || active.situationId || (active.resolved && active.resolved.situationId) || "";
  return `${ref.environmentId}|${ref.bron}|${scene}`;
}

function situationIdVan(ref) {
  const resolved = ref.resolved || {};
  return String(resolved.situationId || (resolved.situation && resolved.situation.id) || "").trim();
}

function leesSituatie(situationId, options = {}) {
  if (!situationId) return null;
  if (options.catalog) return (options.catalog.situations || []).find((item) => item.id === situationId) || null;
  let db = null;
  try {
    db = new DatabaseSync(String(options.catalogDbPath || process.env.CATALOG_DB_PATH || DEFAULT_CATALOG_DB_PATH), { readOnly: true });
    const row = db.prepare("SELECT record_json FROM situations WHERE id = ? LIMIT 1").get(situationId);
    return row ? JSON.parse(row.record_json) : null;
  } catch (_err) {
    return null;
  } finally {
    if (db) {
      try { db.close(); } catch (_err) {}
    }
  }
}

function environmentBordStatus(runtimeState, options = {}) {
  const ref = currentEnvironmentRef(runtimeState);
  const base = { ok: true, environmentId: ref.environmentId, bron: ref.bron, klaar: false, speelt: false, reden: "", aan: false };
  if (!ref.environmentId) return { ...base, reden: "geen_omgeving" };
  if (!isBlindRanking(leesSituatie(situationIdVan(ref), options))) return { ...base, reden: "geen_bord" };
  const sleutel = sleutelVoor(ref, runtimeState);
  return {
    ...base,
    klaar: true,
    speelt: ref.bron === "actief",
    aan: state.sleutel === sleutel && state.aan,
    sleutel,
  };
}

// actie "aan" (standaard): het bord in beeld; "begin": weer weg.
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
  const actie = String(input.actie || "aan") === "begin" ? "begin" : "aan";
  if (!status.klaar || (actie === "aan" && !status.speelt)) {
    const err = new Error(status.reden || "scene_speelt_niet");
    err.statusCode = 409;
    err.code = status.reden || "scene_speelt_niet";
    throw err;
  }
  const wasAan = status.aan;
  state.sleutel = status.sleutel;
  state.aan = actie === "aan";
  // Heeft de omgeving fases (zoals "de ranking" met de muziek van het filter), dan gaat bij de
  // eerste druk de volgende fase mee aan: de muziek begint als het bord opkomt.
  let faseActies = [];
  if (actie === "aan" && !wasAan) {
    try {
      faseActies = buildEnvironmentFaseCue(runtimeState, { actie: "volgende", source: input.source }, options).actions;
    } catch (_err) {
      faseActies = [];
    }
  }
  const createdAtDate = options.createdAtDate || new Date();
  const cueId = createShowControlId("show-cue", createdAtDate);
  const payloadId = `${cueId}:payload:01`;
  return {
    schemaVersion: SHOW_CONTROL_CUE_SCHEMA_VERSION,
    cueId,
    cueType: "pulse",
    cueIntent: "environment-bord",
    name: input.name || (actie === "begin" ? "Bord: weg" : "Bord: aan"),
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
    }, ...faseActies],
  };
}

module.exports = {
  bordAction,
  buildEnvironmentBordCue,
  environmentBordStatus,
  resetBordState,
};
