"use strict";

const {
  SITUATION_OBSERVED_SCHEMA_VERSION,
} = require("../../../shared/contracts/algorithm-v0");
const {
  buildScoreFeed,
  catalogFromRunSnapshot,
  defaultAlgorithmConfig,
  normalizeAlgorithmConfig,
  personagesUitCatalogus,
  scoreOnderdelen,
} = require("./score-engine");
const { beoordeelMetModel, beoordeelMetWoorden } = require("./chat-toon");
const {
  listScoringContextStates,
  readAlgorithmConfigFile,
  readScoringContextState,
  saveAlgorithmConfigFile,
  saveScoringContextState,
} = require("../score-history/state-store");

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function assertNoRuntimeOwnershipFields(payload) {
  const forbidden = [
    "availablePool",
    "pathAvailablePool",
    "pathLockedPool",
    "pathAvailable",
    "pathLocked",
    "eligiblePool",
    "preparedNext",
    "resolvedPreparedNext",
    "activeSituation",
    "playedSituations",
    "playedHistory",
    "order",
    "currentOrder",
    "runtimeCandidates",
  ];
  const walk = (value) => {
    if (!value || typeof value !== "object") return null;
    if (Array.isArray(value)) {
      for (const item of value) {
        const nested = walk(item);
        if (nested) return nested;
      }
      return null;
    }
    for (const key of Object.keys(value)) {
      if (forbidden.includes(key)) return key;
      const nested = walk(value[key]);
      if (nested) return nested;
    }
    return null;
  };
  const found = walk(payload);
  if (found) throw new Error(`algorithm_forbidden_runtime_field:${found}`);
}

function assertNoPromptSettings(payload) {
  const forbidden = ["globalPrompt", "promptTemplate", "systemPrompt", "scenePrompt", "promptSettings"];
  for (const key of forbidden) {
    if (Object.prototype.hasOwnProperty.call(payload || {}, key)) {
      throw new Error(`algorithm_forbidden_prompt_field:${key}`);
    }
  }
}

async function readAlgorithmConfig() {
  try {
    return normalizeAlgorithmConfig(await readAlgorithmConfigFile());
  } catch (err) {
    if (!err || err.code !== "ENOENT") throw err;
    return defaultAlgorithmConfig();
  }
}

async function updateAlgorithmConfig(patch = {}, options = {}) {
  assertNoRuntimeOwnershipFields(patch);
  assertNoPromptSettings(patch);
  const current = options.replace ? defaultAlgorithmConfig() : await readAlgorithmConfig();
  const normalized = normalizeAlgorithmConfig(patch, { base: current });
  normalized.createdAt = current.createdAt || normalized.createdAt;
  normalized.updatedAt = new Date().toISOString();
  normalized.source = {
    type: "algorithm-v0-config",
    readOnly: false,
  };
  await saveAlgorithmConfigFile(normalized);
  return normalized;
}

async function getAlgorithmConfigSnapshot() {
  const config = normalizeAlgorithmConfig(await readAlgorithmConfig());
  return {
    ...config,
    source: {
      type: "algorithm-v0-config-snapshot",
      readOnly: true,
    },
    snapshotAt: new Date().toISOString(),
  };
}

function situationById(catalog, situationId) {
  return ((catalog && catalog.situations) || []).find((item) => item && item.id === situationId) || null;
}

function observationContext(catalog, situationId) {
  const situation = situationById(catalog, situationId);
  return {
    labelIds: situation && Array.isArray(situation.labelIds) ? situation.labelIds : [],
    characterIds: situation && Array.isArray(situation.characterIds) ? situation.characterIds : [],
  };
}

function eventHasAudienceSignalPayload(event = {}) {
  const chatAppSignals = event.chatAppSignals || {};
  const audience = event.audience || {};
  return Number(chatAppSignals.heartCount || 0) > 0
    || Number(chatAppSignals.boredCount || 0) > 0
    || (Array.isArray(chatAppSignals.rawMessages) && chatAppSignals.rawMessages.length > 0)
    || (Array.isArray(event.rawChat) && event.rawChat.length > 0)
    || Number(audience.linkedSignalCount || 0) > 0;
}

function applyLiveObservationFallback(event = {}, state = {}) {
  if (eventHasAudienceSignalPayload(event)) return event;
  const live = state && state.liveAudienceObservation;
  if (!live || live.situationRunId !== event.situationRunId) return event;
  return {
    ...event,
    audience: cloneJson(live.audience || {}),
    chatAppSignals: cloneJson(live.chatAppSignals || {}),
    camera: event.camera || live.camera || null,
    rawChat: Array.isArray(live.rawChat) ? cloneJson(live.rawChat) : [],
    perTelefoon: live.perTelefoon || null,
    finalizedFromLiveAudience: true,
  };
}

function normalizeStoredState(state) {
  const catalog = catalogFromRunSnapshot(state && state.catalog ? state.catalog : state);
  const config = normalizeAlgorithmConfig(state && state.config ? state.config : defaultAlgorithmConfig());
  const observations = Array.isArray(state && state.observations) ? state.observations.map((observation) => ({
    ...observation,
    ...observationContext(catalog, observation.situationId),
  })) : [];
  const liveAudienceObservation = state && state.liveAudienceObservation
    ? {
      ...state.liveAudienceObservation,
      ...observationContext(catalog, state.liveAudienceObservation.situationId),
    }
    : null;
  const scoreFeed = buildScoreFeed({
    showRunId: state.showRunId,
    catalog,
    observations,
    liveObservation: liveAudienceObservation,
    config,
  });
  return {
    ...state,
    schemaVersion: "algorithm.score-state.v0",
    contextType: "scoring-context",
    config,
    catalog,
    observations,
    liveAudienceObservation,
    scoreFeed,
  };
}

function summarizeScoringContext(state) {
  return {
    schemaVersion: state.schemaVersion || "algorithm.score-state.v0",
    contextType: "scoring-context",
    showRunId: state.showRunId,
    createdAt: state.createdAt || null,
    updatedAt: state.updatedAt || null,
    source: state.source || null,
    situationCount: state.catalog && Array.isArray(state.catalog.situations) ? state.catalog.situations.length : 0,
    observationCount: Array.isArray(state.observations) ? state.observations.length : 0,
    latestSituationRunId: state.scoreFeed ? state.scoreFeed.updatedAfterSituationRunId : null,
    scoreCount: state.scoreFeed && Array.isArray(state.scoreFeed.scores) ? state.scoreFeed.scores.length : 0,
  };
}

async function createScoringContext({ showRunId, runSnapshot, catalog, config } = {}) {
  assertNoRuntimeOwnershipFields({ showRunId, runSnapshot, catalog, config });
  assertNoPromptSettings(config || {});
  if (!showRunId) throw new Error("algorithm_missing_show_run_id");
  const catalogSnapshot = catalogFromRunSnapshot(runSnapshot || catalog);
  if (!catalogSnapshot) throw new Error("algorithm_missing_catalog_snapshot");
  const scoringConfig = normalizeAlgorithmConfig(config || await readAlgorithmConfig());
  const state = {
    schemaVersion: "algorithm.score-state.v0",
    contextType: "scoring-context",
    showRunId,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    source: {
      type: runSnapshot ? "runtime-run-snapshot" : "catalog-snapshot",
      readOnly: true,
    },
    config: scoringConfig,
    catalog: catalogSnapshot,
    observations: [],
    scoreFeed: buildScoreFeed({
      showRunId,
      catalog: catalogSnapshot,
      observations: [],
      config: scoringConfig,
    }),
    log: [{
      type: "scoring_context_created",
      at: new Date().toISOString(),
      situationCount: (catalogSnapshot.situations || []).length,
    }],
  };
  await saveScoringContextState(state);
  return state;
}

async function createAlgorithmRun(options = {}) {
  return createScoringContext(options);
}

async function getScoringContext(showRunId) {
  return normalizeStoredState(await readScoringContextState(showRunId));
}

async function listScoringContexts() {
  const states = await listScoringContextStates();
  return {
    ok: true,
    contexts: states.map((state) => summarizeScoringContext(normalizeStoredState(state))),
  };
}

async function getScoreFeed(showRunId) {
  const state = await getScoringContext(showRunId);
  return state.scoreFeed;
}

// Zaalgeluid van een scène: gemiddelde, piek, het verschil daartussen en een korte reeks voor de golfvorm.
function normalizeRoomSound(input) {
  if (!input || typeof input !== "object") return null;
  const number = (value) => (Number.isFinite(Number(value)) ? Math.round(Number(value) * 10) / 10 : null);
  const averageDb = number(input.averageDb);
  const peakDb = number(input.peakDb);
  if (averageDb == null || peakDb == null) return null;
  return {
    source: String(input.source || "onbekend").slice(0, 40),
    averageDb,
    peakDb,
    liftDb: Math.max(0, number(input.liftDb) ?? peakDb - averageDb),
    samples: Array.isArray(input.samples) ? input.samples.slice(0, 240).map(number).filter((value) => value != null) : [],
  };
}

// Wat de publiekscamera in de scène zag (publiek_sensor.py → audience → hier).
function normalizeCamera(input) {
  if (!input || typeof input !== "object") return null;
  const number = (value, digits = 1) => {
    const n = Number(value);
    if (!Number.isFinite(n)) return null;
    const factor = 10 ** digits;
    return Math.round(n * factor) / factor;
  };
  const seconds = number(input.seconds, 0);
  if (!seconds) return null;
  const count = (value) => Math.max(0, Math.round(Number(value) || 0));
  return {
    seconds,
    peopleAverage: number(input.peopleAverage),
    peopleMax: count(input.peopleMax),
    laughPct: number(input.laughPct, 0),
    attentionPct: number(input.attentionPct, 0),
    boredPct: number(input.boredPct, 0),
    laughMoments: count(input.laughMoments),
    boredMoments: count(input.boredMoments),
    clapMoments: count(input.clapMoments),
    handMoments: count(input.handMoments),
  };
}

// Per telefoon (geen bots) hoeveel likes en saai er kwamen: zo hoeft niet elke like bewaard te worden.
function telefoonsUitRefs(event = {}) {
  if (!Array.isArray(event.signalRefs)) return event.perTelefoon && typeof event.perTelefoon === "object" ? event.perTelefoon : null;
  const per = {};
  for (const ref of event.signalRefs) {
    if (!ref || ref.isBot || ref.simulated) continue;
    const sleutel = String(ref.clientKey || ref.clientId || ref.sessionId || "");
    if (!sleutel) continue;
    const rij = per[sleutel] || (per[sleutel] = { hart: 0, saai: 0 });
    if (ref.type === "heart") rij.hart += 1;
    else if (ref.type === "bored") rij.saai += 1;
  }
  return per;
}

// De chatberichten van mensen (geen bots) in een observatie.
function menselijkeChat(observation = {}) {
  return (Array.isArray(observation.rawChat) ? observation.rawChat : [])
    .filter((bericht) => bericht && !bericht.isBot && !bericht.simulated && bericht.signalId && String(bericht.text || "").trim());
}

// De score van een observatie (opnieuw) uitrekenen: met de beoordeling van de chat die er nu is,
// het oordeel na de scène als dat binnen is, en de likes per telefoon.
function berekenScore(observation, state) {
  const cache = state.chatOordeel && typeof state.chatOordeel === "object" ? state.chatOordeel : {};
  const chatOordeel = {};
  for (const bericht of menselijkeChat(observation)) {
    if (cache[bericht.signalId]) chatOordeel[bericht.signalId] = cache[bericht.signalId];
  }
  observation.chatOordeel = chatOordeel;
  const delen = scoreOnderdelen(observation, state.config, { personages: personagesUitCatalogus(state.catalog) });
  const { chatNamen, ...rest } = delen;
  observation.scoreDelen = rest;
  observation.chatNamen = chatNamen;
  observation.observedScore = delen.totaal;
  return observation;
}

async function buildObservation(event, state) {
  assertNoRuntimeOwnershipFields(event);
  if (!event || event.type !== "situationObserved") throw new Error("algorithm_invalid_observed_event_type");
  if (!event.showRunId) throw new Error("algorithm_missing_show_run_id");
  if (!event.situationRunId) throw new Error("algorithm_missing_situation_run_id");
  if (!event.situationId) throw new Error("algorithm_missing_situation_id");
  const sourceEvent = applyLiveObservationFallback(event, state);
  const context = observationContext(state.catalog, sourceEvent.situationId);
  return berekenScore({
    schemaVersion: SITUATION_OBSERVED_SCHEMA_VERSION,
    type: "situationObserved",
    showRunId: sourceEvent.showRunId,
    situationRunId: sourceEvent.situationRunId,
    situationId: sourceEvent.situationId,
    labelIds: context.labelIds,
    characterIds: context.characterIds,
    startedAt: sourceEvent.startedAt || null,
    endedAt: sourceEvent.endedAt || null,
    durationSeconds: Number(sourceEvent.durationSeconds || 0),
    audience: sourceEvent.audience || {},
    chatAppSignals: sourceEvent.chatAppSignals || {},
    reactionLabSignals: sourceEvent.reactionLabSignals || {},
    roomSound: normalizeRoomSound(sourceEvent.roomSound),
    camera: normalizeCamera(sourceEvent.camera),
    rawChat: Array.isArray(sourceEvent.rawChat) ? cloneJson(sourceEvent.rawChat) : [],
    perTelefoon: telefoonsUitRefs(sourceEvent),
    finalizedFromAudienceAggregate: !!sourceEvent.finalizedFromAudienceAggregate,
    finalizedFromLiveAudience: !!sourceEvent.finalizedFromLiveAudience,
    observedScore: 0,
    observedAt: new Date().toISOString(),
  }, state);
}

function durationSecondsForLiveEvent(event) {
  if (event && event.durationSeconds != null) return Number(event.durationSeconds || 0);
  const startedMs = Date.parse(String(event && event.startedAt || ""));
  const createdMs = Date.parse(String(event && (event.createdAt || event.receivedAt) || ""));
  const endedMs = Number.isFinite(createdMs) ? createdMs : Date.now();
  if (!Number.isFinite(startedMs) || !Number.isFinite(endedMs)) return 60;
  return Math.max(1, Math.round((endedMs - startedMs) / 1000));
}

async function buildLiveAudienceObservation(event, state) {
  assertNoRuntimeOwnershipFields(event);
  if (!event || typeof event !== "object") throw new Error("algorithm_invalid_audience_signal_event");
  if (!event.showRunId) throw new Error("algorithm_missing_show_run_id");
  if (!event.situationRunId) throw new Error("algorithm_missing_situation_run_id");
  if (!event.situationId) throw new Error("algorithm_missing_situation_id");
  const liveEvent = {
    ...event,
    durationSeconds: durationSecondsForLiveEvent(event),
  };
  const context = observationContext(state.catalog, event.situationId);
  return berekenScore({
    schemaVersion: "algorithm.audience-signals-live.v0",
    type: "audienceSignalsLive",
    scorePhase: "live",
    showRunId: event.showRunId,
    situationRunId: event.situationRunId,
    situationId: event.situationId,
    labelIds: context.labelIds,
    characterIds: context.characterIds,
    startedAt: event.startedAt || null,
    createdAt: event.createdAt || null,
    durationSeconds: liveEvent.durationSeconds,
    audience: event.audience || {},
    chatAppSignals: event.chatAppSignals || {},
    camera: normalizeCamera(event.camera),
    rawChat: Array.isArray(event.rawChat) ? cloneJson(event.rawChat) : [],
    perTelefoon: telefoonsUitRefs(liveEvent),
    audienceAggregateVersion: event.audienceAggregateVersion == null ? null : Number(event.audienceAggregateVersion),
    observedScore: 0,
    observedAt: new Date().toISOString(),
  }, state);
}

async function observeAudienceSignals(event) {
  const state = await getScoringContext(event && event.showRunId);
  const alreadyObserved = (state.observations || []).some((observation) => (
    observation && event && observation.situationRunId === event.situationRunId
  ));
  if (alreadyObserved) {
    return {
      ok: true,
      ignored: true,
      ignoredReason: "situation_already_observed",
      scorePhase: state.scoreFeed && state.scoreFeed.scorePhase ? state.scoreFeed.scorePhase : "definitive",
      scoreFeed: state.scoreFeed,
    };
  }
  const liveAudienceObservation = await buildLiveAudienceObservation(event, state);
  const scoreFeed = buildScoreFeed({
    showRunId: state.showRunId,
    catalog: state.catalog,
    observations: state.observations,
    liveObservation: liveAudienceObservation,
    config: state.config,
  });
  scoreFeed.audienceAggregateVersion = liveAudienceObservation.audienceAggregateVersion;
  scoreFeed.scoreFeedRevision = liveAudienceObservation.audienceAggregateVersion;
  state.liveAudienceObservation = liveAudienceObservation;
  state.liveAudienceInput = {
    showRunId: liveAudienceObservation.showRunId,
    situationRunId: liveAudienceObservation.situationRunId,
    situationId: liveAudienceObservation.situationId,
    createdAt: liveAudienceObservation.createdAt,
    observedAt: liveAudienceObservation.observedAt,
    audience: cloneJson(liveAudienceObservation.audience),
    chatAppSignals: cloneJson(liveAudienceObservation.chatAppSignals),
    audienceAggregateVersion: liveAudienceObservation.audienceAggregateVersion,
    rawChatCount: liveAudienceObservation.rawChat.length,
  };
  state.liveScoreFeed = scoreFeed;
  state.scoreFeed = scoreFeed;
  state.updatedAt = new Date().toISOString();
  state.log = Array.isArray(state.log) ? state.log : [];
  state.log.push({
    type: "audience_signals_live",
    at: state.updatedAt,
    situationRunId: liveAudienceObservation.situationRunId,
    situationId: liveAudienceObservation.situationId,
    observedScore: liveAudienceObservation.observedScore,
  });
  await saveScoringContextState(state);
  planChatBeoordeling(state.showRunId);
  return {
    ok: true,
    scorePhase: "live",
    liveAudienceObservation,
    scoreFeed,
  };
}

// Het antwoord van het publiek op de labelvraag na een scène (beoordeelmoment van de publieksdienst).
// Komt meestal na de observatie van die scène binnen; komt het eerder, dan wacht het tot die er is.
async function observeLabelVoorkeur(event = {}) {
  const state = await getScoringContext(event.showRunId);
  const delta = Math.max(-1, Math.min(1, Number(event.delta)));
  if (!event.labelId || !Number.isFinite(delta)) return { ok: false, error: "label_of_delta_ontbreekt" };
  const voorkeur = {
    labelId: String(event.labelId),
    delta: Math.round(delta * 1000) / 1000,
    stemmen: Math.max(0, Number(event.stemmen) || 0),
    situationRunId: String(event.situationRunId || ""),
    at: new Date().toISOString(),
  };
  const observations = Array.isArray(state.observations) ? state.observations : [];
  const observation = observations.find((item) => item && voorkeur.situationRunId && item.situationRunId === voorkeur.situationRunId)
    || (voorkeur.situationRunId ? null : observations[observations.length - 1]);
  if (observation) {
    observation.labelVoorkeur = voorkeur;
  } else {
    state.labelVoorkeurWacht = Array.isArray(state.labelVoorkeurWacht) ? state.labelVoorkeurWacht : [];
    state.labelVoorkeurWacht.push(voorkeur);
  }
  state.scoreFeed = buildScoreFeed({
    showRunId: state.showRunId,
    catalog: state.catalog,
    observations: state.observations,
    liveObservation: state.liveAudienceObservation || null,
    config: state.config,
  });
  state.updatedAt = new Date().toISOString();
  state.log = Array.isArray(state.log) ? state.log : [];
  state.log.push({ type: "publiek_label_voorkeur", at: state.updatedAt, ...voorkeur, wacht: !observation });
  await saveScoringContextState(state);
  return { ok: true, voorkeur, wacht: !observation, scoreFeed: state.scoreFeed };
}

// Het antwoord van het publiek op de personagevraag na een scène: welk personage wil je nog een keer
// zien. Per personage het aandeel van de stemmen; wacht net als de labelvraag op de observatie.
async function observePersonageVoorkeur(event = {}) {
  const state = await getScoringContext(event.showRunId);
  const stemmen = Math.max(0, Number(event.stemmen) || 0);
  const keuzes = (Array.isArray(event.keuzes) ? event.keuzes : [])
    .filter((keuze) => keuze && keuze.characterId && Number.isFinite(Number(keuze.aandeel)))
    .map((keuze) => ({ characterId: String(keuze.characterId), aandeel: Math.round(Math.max(0, Math.min(1, Number(keuze.aandeel))) * 1000) / 1000 }));
  if (!keuzes.length || !stemmen) return { ok: false, error: "geen_stemmen" };
  const voorkeur = { keuzes, stemmen, situationRunId: String(event.situationRunId || ""), at: new Date().toISOString() };
  const observations = Array.isArray(state.observations) ? state.observations : [];
  const observation = observations.find((item) => item && voorkeur.situationRunId && item.situationRunId === voorkeur.situationRunId)
    || (voorkeur.situationRunId ? null : observations[observations.length - 1]);
  if (observation) {
    observation.personageVoorkeur = voorkeur;
  } else {
    state.personageVoorkeurWacht = Array.isArray(state.personageVoorkeurWacht) ? state.personageVoorkeurWacht : [];
    state.personageVoorkeurWacht.push(voorkeur);
  }
  state.scoreFeed = buildScoreFeed({
    showRunId: state.showRunId,
    catalog: state.catalog,
    observations: state.observations,
    liveObservation: state.liveAudienceObservation || null,
    config: state.config,
  });
  state.updatedAt = new Date().toISOString();
  state.log = Array.isArray(state.log) ? state.log : [];
  state.log.push({ type: "publiek_personage_voorkeur", at: state.updatedAt, ...voorkeur, wacht: !observation });
  await saveScoringContextState(state);
  return { ok: true, voorkeur, wacht: !observation, scoreFeed: state.scoreFeed };
}

async function observeSituation(event) {
  const state = await getScoringContext(event && event.showRunId);
  const observation = await buildObservation(event, state);
  const wacht = Array.isArray(state.labelVoorkeurWacht) ? state.labelVoorkeurWacht : [];
  const eerder = wacht.find((item) => item.situationRunId && item.situationRunId === observation.situationRunId);
  if (eerder) {
    observation.labelVoorkeur = eerder;
    state.labelVoorkeurWacht = wacht.filter((item) => item !== eerder);
  }
  const wachtPersonage = Array.isArray(state.personageVoorkeurWacht) ? state.personageVoorkeurWacht : [];
  const eerderPersonage = wachtPersonage.find((item) => item.situationRunId && item.situationRunId === observation.situationRunId);
  if (eerderPersonage) {
    observation.personageVoorkeur = eerderPersonage;
    state.personageVoorkeurWacht = wachtPersonage.filter((item) => item !== eerderPersonage);
  }
  const wachtOordeel = Array.isArray(state.oordeelWacht) ? state.oordeelWacht : [];
  const eerderOordeel = wachtOordeel.find((item) => item.situationRunId && item.situationRunId === observation.situationRunId);
  if (eerderOordeel) {
    observation.oordeel = eerderOordeel;
    state.oordeelWacht = wachtOordeel.filter((item) => item !== eerderOordeel);
  }
  berekenScore(observation, state);
  const observedScore = observation.observedScore;
  state.observations.push(observation);
  state.scoreFeed = buildScoreFeed({
    showRunId: state.showRunId,
    catalog: state.catalog,
    observations: state.observations,
    config: state.config,
  });
  state.liveAudienceObservation = null;
  state.liveAudienceInput = null;
  state.liveScoreFeed = null;
  state.updatedAt = new Date().toISOString();
  state.log = Array.isArray(state.log) ? state.log : [];
  state.log.push({
    type: "situation_observed",
    at: state.updatedAt,
    situationRunId: observation.situationRunId,
    situationId: observation.situationId,
    observedScore,
  });
  await saveScoringContextState(state);
  planChatBeoordeling(state.showRunId, 0);
  return {
    observation,
    scoreFeed: state.scoreFeed,
  };
}

// Het oordeel na de scène (de thermometer): het gemiddelde van -1 tot 1, het zwaarste deel van de
// score van die scène. Komt na de observatie van de scène binnen; komt het eerder, dan wacht het.
async function observeSceneOordeel(event = {}) {
  const state = await getScoringContext(event.showRunId);
  const gemiddelde = Number(event.gemiddelde);
  const stemmen = Math.max(0, Number(event.stemmen) || 0);
  if (!Number.isFinite(gemiddelde) || !stemmen) return { ok: false, error: "geen_stemmen" };
  const oordeel = {
    gemiddelde: Math.round(Math.max(-1, Math.min(1, gemiddelde)) * 1000) / 1000,
    stemmen,
    mensen: Math.max(0, Number(event.mensen) || 0),
    telling: event.telling && typeof event.telling === "object" ? cloneJson(event.telling) : {},
    situationRunId: String(event.situationRunId || ""),
    at: new Date().toISOString(),
  };
  const observations = Array.isArray(state.observations) ? state.observations : [];
  const observation = observations.find((item) => item && oordeel.situationRunId && item.situationRunId === oordeel.situationRunId)
    || (oordeel.situationRunId ? null : observations[observations.length - 1]);
  if (observation) {
    observation.oordeel = oordeel;
    berekenScore(observation, state);
  } else {
    state.oordeelWacht = Array.isArray(state.oordeelWacht) ? state.oordeelWacht : [];
    state.oordeelWacht.push(oordeel);
  }
  state.scoreFeed = buildScoreFeed({
    showRunId: state.showRunId,
    catalog: state.catalog,
    observations: state.observations,
    liveObservation: state.liveAudienceObservation || null,
    config: state.config,
  });
  state.updatedAt = new Date().toISOString();
  state.log = Array.isArray(state.log) ? state.log : [];
  state.log.push({
    type: "publiek_oordeel",
    at: state.updatedAt,
    situationRunId: oordeel.situationRunId,
    gemiddelde: oordeel.gemiddelde,
    stemmen,
    observedScore: observation ? observation.observedScore : null,
    wacht: !observation,
  });
  await saveScoringContextState(state);
  return { ok: true, oordeel, wacht: !observation, observedScore: observation ? observation.observedScore : null, scoreDelen: observation ? observation.scoreDelen : null, scoreFeed: state.scoreFeed };
}

// De chat beoordelen met het taalmodel, op de achtergrond: kort na nieuwe berichten, en meteen na
// het einde van een scène. Tot het antwoord er is telt de woordenlijst. Lukt het model niet, dan
// blijft de woordenlijst staan (en wordt dat bericht niet opnieuw gevraagd).
const chatPlanning = new Map();
function planChatBeoordeling(showRunId, wachtMs = 1500) {
  if (!showRunId || process.env.ALGORITHM_CHAT_MODEL === "uit") return;
  const plan = chatPlanning.get(showRunId) || { timer: null, bezig: null, opnieuw: false };
  chatPlanning.set(showRunId, plan);
  if (plan.bezig) {
    plan.opnieuw = true;
    return;
  }
  if (plan.timer) clearTimeout(plan.timer);
  plan.timer = setTimeout(() => {
    plan.timer = null;
    plan.bezig = beoordeelChat(showRunId)
      .catch(() => {})
      .finally(() => {
        plan.bezig = null;
        if (plan.opnieuw) {
          plan.opnieuw = false;
          planChatBeoordeling(showRunId, 0);
        }
      });
  }, wachtMs);
}

// Wacht (hooguit ms) tot de geplande of lopende chatbeoordeling klaar is.
async function wachtOpChat(showRunId, ms = 3000) {
  const plan = chatPlanning.get(showRunId);
  if (!plan) return;
  if (plan.timer) {
    clearTimeout(plan.timer);
    plan.timer = null;
    plan.bezig = beoordeelChat(showRunId).catch(() => {}).finally(() => { plan.bezig = null; });
  }
  if (plan.bezig) await Promise.race([plan.bezig, new Promise((resolve) => setTimeout(resolve, ms))]);
}

async function beoordeelChat(showRunId) {
  const state = await getScoringContext(showRunId);
  const cache = state.chatOordeel && typeof state.chatOordeel === "object" ? state.chatOordeel : {};
  const bronnen = [state.liveAudienceObservation, ...(state.observations || []).slice(-2)].filter(Boolean);
  const open = new Map();
  for (const bron of bronnen) {
    for (const bericht of menselijkeChat(bron)) {
      if (!cache[bericht.signalId]) open.set(bericht.signalId, { id: bericht.signalId, tekst: String(bericht.text) });
    }
  }
  if (!open.size) return;
  const personages = personagesUitCatalogus(state.catalog);
  const berichten = [...open.values()];
  let uit = {};
  try {
    uit = await beoordeelMetModel(berichten, personages);
  } catch {
    uit = {};
  }
  for (const bericht of berichten) {
    if (!uit[bericht.id]) uit[bericht.id] = beoordeelMetWoorden(bericht.tekst, personages);
  }
  await module.exports.bewaarChatOordeel({ showRunId, uit });
}

async function bewaarChatOordeel({ showRunId, uit = {} }) {
  const state = await getScoringContext(showRunId);
  state.chatOordeel = { ...(state.chatOordeel || {}), ...uit };
  for (const observation of (state.observations || []).slice(-2)) berekenScore(observation, state);
  if (state.liveAudienceObservation) berekenScore(state.liveAudienceObservation, state);
  state.scoreFeed = buildScoreFeed({
    showRunId: state.showRunId,
    catalog: state.catalog,
    observations: state.observations,
    liveObservation: state.liveAudienceObservation || null,
    config: state.config,
  });
  state.updatedAt = new Date().toISOString();
  await saveScoringContextState(state);
  return { ok: true, beoordeeld: Object.keys(uit).length };
}

async function simulateSituationObservation(event) {
  const state = await getScoringContext(event && event.showRunId);
  const observation = await buildObservation({
    ...event,
    type: "situationObserved",
    situationRunId: event && event.situationRunId ? event.situationRunId : `${state.showRunId}:simulation`,
  }, state);
  const simulatedObservations = [...state.observations, {
    ...observation,
    simulated: true,
  }];
  const scoreFeed = buildScoreFeed({
    showRunId: state.showRunId,
    catalog: state.catalog,
    observations: simulatedObservations,
    config: state.config,
  });
  return {
    ok: true,
    persisted: false,
    observation: {
      ...observation,
      simulated: true,
    },
    scoreFeed,
  };
}

// Per run één wijziging tegelijk: lezen, aanpassen en bewaren van de stand mogen elkaar niet
// overlappen (de labelvraag, de personagevraag en de live reacties komen vaak tegelijk binnen;
// anders gaat er een wijziging verloren of raakt het bestand beschadigd).
const rijen = new Map();
function achterElkaar(sleutelVan, fn) {
  return (...args) => {
    const sleutel = String(sleutelVan(...args) || "");
    const vorige = rijen.get(sleutel) || Promise.resolve();
    const deze = vorige.catch(() => {}).then(() => fn(...args));
    const staart = deze.catch(() => {});
    rijen.set(sleutel, staart);
    staart.then(() => { if (rijen.get(sleutel) === staart) rijen.delete(sleutel); });
    return deze;
  };
}
const perRun = (event) => (event && event.showRunId) || "";
const sceneOordeelInRij = achterElkaar(perRun, observeSceneOordeel);

module.exports = {
  assertNoPromptSettings,
  assertNoRuntimeOwnershipFields,
  createAlgorithmRun: achterElkaar(perRun, createAlgorithmRun),
  createScoringContext: achterElkaar(perRun, createScoringContext),
  getAlgorithmConfigSnapshot,
  getScoreFeed,
  getScoringContext,
  listScoringContexts,
  observeAudienceSignals: achterElkaar(perRun, observeAudienceSignals),
  observeLabelVoorkeur: achterElkaar(perRun, observeLabelVoorkeur),
  observePersonageVoorkeur: achterElkaar(perRun, observePersonageVoorkeur),
  observeSituation: achterElkaar(perRun, observeSituation),
  // Eerst de chat van die scène laten beoordelen (hooguit 3 s), dan het oordeel verwerken.
  observeSceneOordeel: async (event = {}) => {
    await wachtOpChat(event.showRunId, 3000);
    return sceneOordeelInRij(event);
  },
  bewaarChatOordeel: achterElkaar(perRun, bewaarChatOordeel),
  readAlgorithmConfig,
  simulateSituationObservation,
  summarizeScoringContext,
  updateAlgorithmConfig,
};
