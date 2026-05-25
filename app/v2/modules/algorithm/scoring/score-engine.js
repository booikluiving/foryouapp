"use strict";

const {
  ALGORITHM_CONFIG_SCHEMA_VERSION,
  ALGORITHM_SCORE_FEED_SCHEMA_VERSION,
} = require("../../../shared/contracts/algorithm-v0");

function defaultAlgorithmConfig() {
  return {
    schemaVersion: ALGORITHM_CONFIG_SCHEMA_VERSION,
    createdAt: new Date().toISOString(),
    source: {
      type: "algorithm-v0-default-config",
      readOnly: true,
    },
    weights: {
      heart: 1,
      bored: -1,
      message: 0.05,
      labelAffinity: 0.25,
      characterAffinity: 0.15,
    },
    neutralPredictedScore: 0,
  };
}

function catalogFromRunSnapshot(runSnapshotOrCatalog) {
  if (!runSnapshotOrCatalog || typeof runSnapshotOrCatalog !== "object") return null;
  if (runSnapshotOrCatalog.catalog && Array.isArray(runSnapshotOrCatalog.catalog.situations)) {
    return runSnapshotOrCatalog.catalog;
  }
  if (Array.isArray(runSnapshotOrCatalog.situations)) return runSnapshotOrCatalog;
  return null;
}

function activeSituations(catalog) {
  return (catalog && Array.isArray(catalog.situations) ? catalog.situations : [])
    .filter((item) => item.active !== false && !item.archivedAt);
}

function situationById(catalog, situationId) {
  return activeSituations(catalog).find((item) => item.id === situationId) || null;
}

function safeNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function durationFactor(durationSeconds) {
  const duration = Math.max(15, safeNumber(durationSeconds, 60));
  return Math.sqrt(60 / duration);
}

function audienceFactor(activeClients) {
  const clients = Math.max(1, safeNumber(activeClients, 1));
  return 1 / Math.sqrt(clients);
}

function signalCounts(event) {
  const chatApp = event.chatAppSignals || {};
  const audience = event.audience || {};
  return {
    hearts: Math.max(0, safeNumber(chatApp.heartCount, 0)),
    bored: Math.max(0, safeNumber(chatApp.boredCount, 0)),
    messages: Array.isArray(chatApp.rawMessages) ? chatApp.rawMessages.length : 0,
    activeClients: Math.max(1, safeNumber(audience.activeClients, 1)),
    durationSeconds: Math.max(1, safeNumber(event.durationSeconds, 60)),
  };
}

function observedScoreForEvent(event, config = defaultAlgorithmConfig()) {
  const counts = signalCounts(event);
  const weights = config.weights || {};
  const raw = (counts.hearts * safeNumber(weights.heart, 1))
    + (counts.bored * safeNumber(weights.bored, -1))
    + (counts.messages * safeNumber(weights.message, 0.05));
  return raw * audienceFactor(counts.activeClients) * durationFactor(counts.durationSeconds);
}

function affinityForSituation(situation, observedSituation, config) {
  if (!situation || !observedSituation) return 0;
  const weights = config.weights || {};
  const labels = new Set(observedSituation.labelIds || []);
  const characters = new Set(observedSituation.characterIds || []);
  const sharedLabels = (situation.labelIds || []).filter((id) => labels.has(id)).length;
  const sharedCharacters = (situation.characterIds || []).filter((id) => characters.has(id)).length;
  return (sharedLabels * safeNumber(weights.labelAffinity, 0.25))
    + (sharedCharacters * safeNumber(weights.characterAffinity, 0.15));
}

function buildScoreFeed({ showRunId, catalog, observations = [], config = defaultAlgorithmConfig() }) {
  const situations = activeSituations(catalog);
  const observedBySituation = new Map();
  for (const observation of observations) {
    observedBySituation.set(observation.situationId, observation);
  }
  const latestObservation = observations.length ? observations[observations.length - 1] : null;
  const observedSituation = latestObservation
    ? situationById(catalog, latestObservation.situationId)
    : null;

  const scores = situations.map((situation) => {
    const observation = observedBySituation.get(situation.id);
    const observedScore = observation ? observation.observedScore : null;
    let predictedScore = safeNumber(config.neutralPredictedScore, 0);
    if (latestObservation && observedSituation) {
      const base = latestObservation.observedScore * 0.2;
      predictedScore += base + affinityForSituation(situation, observedSituation, config);
    }
    if (observation) predictedScore = observation.observedScore;
    return {
      situationId: situation.id,
      legacySituationId: situation.legacyId || null,
      observedScore,
      predictedScore,
      confidence: observation ? 0.8 : latestObservation ? 0.45 : 0.1,
      reasons: observation ? ["observed"] : latestObservation ? ["predicted_from_latest_observation"] : ["neutral"],
    };
  });

  return {
    type: "situationScoresUpdated",
    schemaVersion: ALGORITHM_SCORE_FEED_SCHEMA_VERSION,
    showRunId,
    updatedAt: new Date().toISOString(),
    updatedAfterSituationRunId: latestObservation ? latestObservation.situationRunId : null,
    scores,
  };
}

module.exports = {
  activeSituations,
  buildScoreFeed,
  catalogFromRunSnapshot,
  defaultAlgorithmConfig,
  observedScoreForEvent,
  signalCounts,
};
