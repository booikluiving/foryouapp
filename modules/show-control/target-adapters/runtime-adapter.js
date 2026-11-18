"use strict";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { beeldStartAction, beeldVoorbeeldAction } = require("../cue-library/environment-beeld");
const { fetchJson, joinUrl } = require("./http-json");
const {
  performerSlotsFromRuntimeState,
  resolvedPayloadFromRuntimeState,
  runtimeOutputFromRuntimeState,
} = require("../cue-library/runtime-output");
const { compactRuntimeStateForCue } = require("../cue-engine/compact-results");
const { channelsForAccentFixtures } = require("../../../shared/lighting/environment-lighting-v0");
const { startGeluidAction } = require("../cue-library/environment-startgeluid");
const { WACHT_VOOR_KLAARZETTEN_MS, sceneEindeActions } = require("../cue-library/scene-einde");
const { omvallenSpelerStartAction } = require("../cue-library/environment-omvallen");

const DEFAULT_RUNTIME_BASE_URL = "http://127.0.0.1:3024";

function runtimeBaseUrl(options = {}) {
  return String(options.runtimeBaseUrl || process.env.SHOW_CONTROL_RUNTIME_URL || DEFAULT_RUNTIME_BASE_URL).replace(/\/+$/, "");
}

async function getCurrentRuntimeState(options = {}) {
  const result = await fetchJson(joinUrl(runtimeBaseUrl(options), "/v0/runtime/runs/current"), {
    timeoutMs: options.timeoutMs || 1500,
  });
  return result.body;
}

function showRunIdFrom(action, context) {
  const payload = action.payload || {};
  if (payload.showRunId) return String(payload.showRunId);
  if (context.lastRuntimeState && context.lastRuntimeState.showRunId) return context.lastRuntimeState.showRunId;
  if (context.runtimeState && context.runtimeState.showRunId) return context.runtimeState.showRunId;
  return null;
}

function runtimeResultData(route, runtimeState) {
  return {
    route,
    runtimeStateRef: compactRuntimeStateForCue(runtimeState),
    runtimeStateOmitted: true,
  };
}

function runtimePayloadOptions(context = {}) {
  const options = context.adapterOptions || {};
  return {
    liveCatalog: options.liveCatalog || null,
    catalogDbPath: options.catalogDbPath || null,
    disableLiveCatalog: options.disableLiveCatalog === true,
  };
}

function generatedPrepareAction(action, runtimeState, context = {}) {
  const payload = resolvedPayloadFromRuntimeState(runtimeState, "resolvedPreparedNext", "", runtimePayloadOptions(context));
  payload.performerSlots = performerSlotsFromRuntimeState(runtimeState, "resolvedPreparedNext");
  return {
    command: "td.environment.prepare",
    targetId: "touchdesigner",
    ackMode: "required-ready",
    timeoutMs: action.timeoutMs || 2200,
    payload: {
      ...payload,
      cueIntent: "prepare_environment",
      generatedBy: action.command,
    },
  };
}

function generatedTeleprompterPrepareAction(action, runtimeState, context = {}) {
  const payload = resolvedPayloadFromRuntimeState(runtimeState, "resolvedPreparedNext", "", runtimePayloadOptions(context));
  payload.performerSlots = performerSlotsFromRuntimeState(runtimeState, "resolvedPreparedNext");
  return {
    command: "teleprompter.prepare",
    targetId: "teleprompter",
    ackMode: "fire-and-forget",
    timeoutMs: Math.min(Number(action.timeoutMs || 1500), 900),
    payload: {
      ...payload,
      cueIntent: "prepare_text_display",
      generatedBy: action.command,
    },
  };
}

function generatedOperatorPrepareDraftAction(action, runtimeState, context = {}) {
  const payload = resolvedPayloadFromRuntimeState(runtimeState, "resolvedPreparedNext", "", runtimePayloadOptions(context));
  return {
    command: "script-agent.operator.prepareDraft",
    targetId: "script-agent",
    ackMode: "fire-and-forget",
    timeoutMs: Math.min(Number(action.timeoutMs || 1500), 900),
    payload: {
      runtimeOutput: runtimeOutputFromRuntimeState(runtimeState, "resolvedPreparedNext", runtimePayloadOptions(context)),
      force: true,
      sourceId: "show-control-prepare",
      cueIntent: "prepare_operator_draft",
      generatedBy: action.command,
      situation: payload.situation,
    },
  };
}

function generatedGoAction(action, runtimeState, context = {}) {
  const payload = resolvedPayloadFromRuntimeState(runtimeState, "activeSituation", "", runtimePayloadOptions(context));
  payload.performerSlots = performerSlotsFromRuntimeState(runtimeState, "activeSituation");
  return {
    command: "td.environment.go",
    targetId: "touchdesigner",
    ackMode: "fire-and-forget",
    timeoutMs: 900,
    payload: {
      ...payload,
      cueIntent: "go_environment",
      generatedBy: action.command,
    },
  };
}

// De microfoons van de spelers: open tijdens de scène, dicht bij inloop en loading. Het gaat per
// kanaal, zodat de mute op de tafel te zien is; wie met de hand dicht stond blijft dicht.
// Met de knop MICS OPEN op de deck (zenders testen, inregelen) blijven de kanalen met rust.
const MICS_OPEN_PATH = process.env.FY_MICS_OPEN
  || path.join(os.homedir(), "Library", "Application Support", "ForYouApp", "mics-altijd-open");

function micsVanzelf(payload = {}) {
  if (payload.autoMics === false) return false;
  try { return !fs.existsSync(MICS_OPEN_PATH); } catch (_err) { return true; }
}

function generatedMicsAction(action, gedempt) {
  return {
    command: "sq5.spelers",
    targetId: "sq5",
    ackMode: "fire-and-forget",
    timeoutMs: 1500,
    payload: { stand: gedempt ? "dicht" : "open", cueIntent: gedempt ? "mics_dicht" : "mics_open", generatedBy: action.command },
  };
}

function generatedDmxLightingAction(action, runtimeState, context = {}) {
  const payload = resolvedPayloadFromRuntimeState(runtimeState, "activeSituation", "", runtimePayloadOptions(context));
  const lighting = payload.environmentLighting || null;
  return {
    command: "dmx.look",
    targetId: "dmx",
    ackMode: "fire-and-forget",
    timeoutMs: 900,
    payload: {
      label: `environment-${payload.environmentId || "unknown"}-${lighting && lighting.presetId || "lighting"}`,
      channels: channelsForAccentFixtures(lighting && lighting.fixtures || {}, { environmentId: payload.environmentId }),
      clearFirst: false,
      continuous: true,
      cueIntent: "environment_lighting_go",
      generatedBy: action.command,
      environmentId: payload.environmentId || null,
      presetId: lighting && lighting.presetId || null,
      presetName: lighting && lighting.presetName || null,
      mode: lighting && lighting.mode || null,
    },
  };
}

function generatedTeleprompterRevealAction(action, runtimeState, context = {}) {
  const payload = resolvedPayloadFromRuntimeState(runtimeState, "activeSituation", "", runtimePayloadOptions(context));
  payload.performerSlots = performerSlotsFromRuntimeState(runtimeState, "activeSituation");
  return {
    command: "teleprompter.reveal",
    targetId: "teleprompter",
    ackMode: "fire-and-forget",
    timeoutMs: action.timeoutMs || 900,
    payload: {
      showRunId: runtimeState.showRunId,
      situationRunId: runtimeState.activeSituation ? runtimeState.activeSituation.situationRunId : null,
      situation: payload.situation,
      cueIntent: "reveal_text_display",
      generatedBy: action.command,
    },
  };
}

// Leest de catalogus; in tests zonder live catalogus (disableLiveCatalog) is er geen startgeluid.
function generatedStartGeluidAction(runtimeState, context = {}) {
  const options = context.adapterOptions || {};
  if (options.disableLiveCatalog === true && !options.liveCatalog) return null;
  try {
    return startGeluidAction(runtimeState, {
      ...(options.liveCatalog ? { catalog: options.liveCatalog } : {}),
      ...(options.catalogDbPath ? { catalogDbPath: options.catalogDbPath } : {}),
      ...(options.catalogMediaRoot ? { catalogMediaRoot: options.catalogMediaRoot } : {}),
    });
  } catch (_err) {
    return null;
  }
}

// Spelers die in deze scène gespiegeld in beeld staan (staat bij de stappen van de scène).
function generatedSpelerStartAction(runtimeState, context = {}) {
  const options = context.adapterOptions || {};
  try {
    return omvallenSpelerStartAction(runtimeState, {
      ...(options.catalogMediaRoot ? { catalogMediaRoot: options.catalogMediaRoot } : {}),
      ...(options.omvallenManifest ? { manifest: options.omvallenManifest } : {}),
    });
  } catch (_err) {
    return null;
  }
}

function generatedBeeldStartAction(runtimeState, context = {}) {
  const options = context.adapterOptions || {};
  try {
    const resolved = runtimeState && runtimeState.activeSituation && runtimeState.activeSituation.resolved;
    const environmentId = resolved && (resolved.environmentId || (resolved.environment && resolved.environment.id));
    if (!environmentId) return null;
    return beeldStartAction(String(environmentId), {
      ...(options.catalogMediaRoot ? { catalogMediaRoot: options.catalogMediaRoot } : {}),
      ...(options.beeld !== undefined ? { beeld: options.beeld } : {}),
    });
  } catch (_err) {
    return null;
  }
}

// Na het klaarzetten: de teleprompters tonen al het ene beeld van de volgende omgeving (trolleyprobleem),
// of gaan terug naar het gewone beeld als die omgeving er geen heeft.
function generatedBeeldVoorbeeldAction(runtimeState, context = {}) {
  const options = context.adapterOptions || {};
  try {
    const resolved = runtimeState && runtimeState.resolvedPreparedNext;
    const environmentId = resolved && (resolved.environmentId || (resolved.environment && resolved.environment.id));
    return beeldVoorbeeldAction(environmentId ? String(environmentId) : "", {
      ...(options.catalogMediaRoot ? { catalogMediaRoot: options.catalogMediaRoot } : {}),
      ...(options.beeld !== undefined ? { beeld: options.beeld } : {}),
    });
  } catch (_err) {
    return null;
  }
}

function canGeneratePrepare(runtimeState) {
  return !!(runtimeState && runtimeState.resolvedPreparedNext);
}

function canGenerateGo(runtimeState) {
  return !!(runtimeState && runtimeState.activeSituation && runtimeState.activeSituation.resolved);
}

async function sendRuntimeCommand(action, context = {}) {
  const options = context.adapterOptions || {};
  const command = action.command;
  if (command === "runtime.status") {
    const state = await getCurrentRuntimeState(options);
    context.lastRuntimeState = state;
    return {
      stage: "applied",
      state: "ok",
      message: "runtime status fetched",
      data: runtimeResultData("GET /v0/runtime/runs/current", state),
    };
  }

  if (command === "runtime.startRun") {
    const result = await fetchJson(joinUrl(runtimeBaseUrl(options), "/v0/runtime/runs/start"), {
      method: "POST",
      body: action.payload || {},
      timeoutMs: action.timeoutMs,
    });
    context.lastRuntimeState = result.body;
    const generatedActions = action.payload && action.payload.autoPrepareNext
      ? [
        generatedTeleprompterPrepareAction(action, result.body, context),
        generatedOperatorPrepareDraftAction(action, result.body, context),
        generatedPrepareAction(action, result.body, context),
        generatedBeeldVoorbeeldAction(result.body, context),
      ].filter(Boolean)
      : [];
    return {
      stage: "applied",
      state: "ok",
      message: `runtime startRun called: ${result.body.showRunId || "unknown-run"}`,
      data: runtimeResultData("POST /v0/runtime/runs/start", result.body),
      generatedActions,
    };
  }

  if (command === "runtime.resetRun") {
    let showRunId = showRunIdFrom(action, context);
    if (!showRunId) {
      const runtimeState = await getCurrentRuntimeState({ ...options, timeoutMs: action.timeoutMs });
      context.lastRuntimeState = runtimeState;
      showRunId = runtimeState.showRunId;
    }
    const route = showRunId ? `/v0/runtime/runs/${encodeURIComponent(showRunId)}/reset` : "/v0/runtime/runs/reset";
    const payload = { ...(action.payload || {}) };
    delete payload.showRunId;
    const result = await fetchJson(joinUrl(runtimeBaseUrl(options), route), {
      method: "POST",
      body: payload,
      timeoutMs: action.timeoutMs,
    });
    context.lastRuntimeState = result.body;
    return {
      stage: "applied",
      state: "ok",
      message: `runtime resetRun called: ${showRunId || "current"}`,
      data: runtimeResultData(`POST ${route}`, result.body),
      // Terug naar de inloop: de spelers zijn niet te horen.
      // De run is terug bij af: alles wat de scène had aangezet gaat uit.
      generatedActions: [
        ...(micsVanzelf(action.payload) ? [generatedMicsAction(action, true)] : []),
        ...sceneEindeActions({ generatedBy: action.command }),
      ],
    };
  }

  if (command === "runtime.prepareNext") {
    const runtimeState = action.payload && action.payload.runtimeState
      ? action.payload.runtimeState
      : await getCurrentRuntimeState({ ...options, timeoutMs: action.timeoutMs });
    context.lastRuntimeState = runtimeState;
    return {
      stage: "applied",
      state: "ok",
      message: `preparedNext resolved: ${runtimeState.preparedNext ? runtimeState.preparedNext.situationId : "none"}`,
      data: runtimeResultData("GET /v0/runtime/runs/current", runtimeState),
      generatedActions: [
        generatedTeleprompterPrepareAction(action, runtimeState, context),
        generatedOperatorPrepareDraftAction(action, runtimeState, context),
        generatedPrepareAction(action, runtimeState, context),
        generatedBeeldVoorbeeldAction(runtimeState, context),
      ].filter(Boolean),
    };
  }

  if (command === "runtime.startSituation" || command === "runtime.stopSituation") {
    let showRunId = showRunIdFrom(action, context);
    if (!showRunId) {
      const runtimeState = await getCurrentRuntimeState({ ...options, timeoutMs: action.timeoutMs });
      context.lastRuntimeState = runtimeState;
      showRunId = runtimeState.showRunId;
    }
    if (!showRunId) throw new Error("show_control_runtime_missing_show_run_id");
    const endpoint = command === "runtime.startSituation" ? "start-situation" : "stop-situation";
    const route = `/v0/runtime/runs/${encodeURIComponent(showRunId)}/${endpoint}`;
    const result = await fetchJson(joinUrl(runtimeBaseUrl(options), route), {
      method: "POST",
      body: action.payload || {},
      timeoutMs: action.timeoutMs,
    });
    context.lastRuntimeState = result.body;
    const generatedActions = [];
    const payload = action.payload || {};
    if (command === "runtime.startSituation" && payload.autoGoLighting !== false && canGenerateGo(result.body)) {
      generatedActions.push(generatedDmxLightingAction(action, result.body, context));
    }
    if (command === "runtime.startSituation" && payload.autoGoEnvironment !== false && canGenerateGo(result.body)) {
      generatedActions.push(generatedGoAction(action, result.body, context));
    }
    if (command === "runtime.startSituation" && payload.autoRevealTeleprompter !== false && canGenerateGo(result.body)) {
      generatedActions.push(generatedTeleprompterRevealAction(action, result.body, context));
    }
    // De spelers zijn alleen tijdens de scène te horen.
    if (micsVanzelf(payload) && (command === "runtime.stopSituation" || canGenerateGo(result.body))) {
      generatedActions.push(generatedMicsAction(action, command === "runtime.stopSituation"));
    }
    // Startgeluid van de omgeving (de intro) begint vanzelf met de scène.
    if (command === "runtime.startSituation" && payload.autoStartGeluid !== false && canGenerateGo(result.body)) {
      const startGeluid = generatedStartGeluidAction(result.body, context);
      if (startGeluid) generatedActions.push(startGeluid);
    }
    // Na de omgeving (TouchDesigner zet dan iedereen terug): wie in deze scène gespiegeld staat.
    if (command === "runtime.startSituation" && canGenerateGo(result.body)) {
      const spelers = generatedSpelerStartAction(result.body, context);
      if (spelers) generatedActions.push(spelers);
      // Eén beeld met de spelers erin (trolleyprobleem): het overzicht, als de omgeving dat heeft.
      const beeldStart = generatedBeeldStartAction(result.body, context);
      if (beeldStart) generatedActions.push(beeldStart);
    }
    // Aan het eind van de scène: alles wat de knoppen van de scène hebben aangezet gaat uit
    // (geluid, fase, stappen, haperen, extra shot). Eén plek: cue-library/scene-einde.js.
    if (command === "runtime.stopSituation") {
      generatedActions.push(...sceneEindeActions({ generatedBy: action.command }));
    }
    if (command === "runtime.stopSituation" && payload.autoPrepareNext !== false && canGeneratePrepare(result.body)) {
      // Even wachten: het opruimen in TouchDesigner is klaar voordat de volgende scène klaargezet wordt.
      generatedActions.push({ ...generatedTeleprompterPrepareAction(action, result.body, context), delayMs: WACHT_VOOR_KLAARZETTEN_MS });
      generatedActions.push(generatedOperatorPrepareDraftAction(action, result.body, context));
      generatedActions.push(generatedPrepareAction(action, result.body, context));
      const voorbeeld = generatedBeeldVoorbeeldAction(result.body, context);
      if (voorbeeld) generatedActions.push(voorbeeld);
    }
    return {
      stage: "applied",
      state: "ok",
      message: `runtime ${endpoint} called`,
      data: runtimeResultData(`POST ${route}`, result.body),
      generatedActions,
    };
  }

  throw new Error(`show_control_runtime_command_not_supported:${command}`);
}

module.exports = {
  DEFAULT_RUNTIME_BASE_URL,
  getCurrentRuntimeState,
  performerSlotsFromRuntimeState,
  resolvedPayloadFromRuntimeState,
  runtimeBaseUrl,
  sendRuntimeCommand,
};
