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
      diversity: 0,
      exploration: 0,
      retry: 0,
      sceneRepeatPenalty: 0,
    },
    normalization: {
      timeCorrection: 1,
      audienceSize: 1,
    },
    profile: {
      memoryMode: "cumulative_recency",
      recencyHalfLifeObservations: 6,
      liveWeightMultiplier: 1.25,
    },
    neutralPredictedScore: 0,
  };
}

function safeNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function clampNumber(value, min, max, fallback) {
  const number = safeNumber(value, fallback);
  if (number < min) return min;
  if (number > max) return max;
  return number;
}

function rounded(value, digits = 4) {
  const factor = 10 ** digits;
  return Math.round(safeNumber(value, 0) * factor) / factor;
}

function normalizeAlgorithmConfig(input = {}, options = {}) {
  const defaults = defaultAlgorithmConfig();
  const base = options.base && typeof options.base === "object" ? options.base : defaults;
  const source = input && typeof input === "object" ? input : {};
  const sourceWeights = source.weights && typeof source.weights === "object" ? source.weights : {};
  const baseWeights = base.weights && typeof base.weights === "object" ? base.weights : defaults.weights;
  const sourceNormalization = source.normalization && typeof source.normalization === "object" ? source.normalization : {};
  const baseNormalization = base.normalization && typeof base.normalization === "object"
    ? base.normalization
    : defaults.normalization;
  const sourceProfile = source.profile && typeof source.profile === "object" ? source.profile : {};
  const baseProfile = base.profile && typeof base.profile === "object" ? base.profile : defaults.profile;
  const now = new Date().toISOString();
  const memoryMode = sourceProfile.memoryMode || source.memoryMode || baseProfile.memoryMode;
  return {
    schemaVersion: ALGORITHM_CONFIG_SCHEMA_VERSION,
    createdAt: source.createdAt || base.createdAt || now,
    updatedAt: source.updatedAt || base.updatedAt || now,
    source: {
      type: source.source && source.source.type ? String(source.source.type).slice(0, 80) : "algorithm-v0-config",
      readOnly: !!(source.source && source.source.readOnly),
    },
    weights: {
      heart: rounded(clampNumber(sourceWeights.heart ?? source.heartWeight, -10, 10, baseWeights.heart), 3),
      bored: rounded(clampNumber(sourceWeights.bored ?? source.boredWeight, -10, 10, baseWeights.bored), 3),
      message: rounded(clampNumber(sourceWeights.message ?? source.messageWeight ?? source.chatWeight, -10, 10, baseWeights.message), 3),
      labelAffinity: rounded(clampNumber(sourceWeights.labelAffinity ?? source.labelAffinity, -10, 10, baseWeights.labelAffinity), 3),
      characterAffinity: rounded(clampNumber(sourceWeights.characterAffinity ?? source.characterAffinity, -10, 10, baseWeights.characterAffinity), 3),
      diversity: rounded(clampNumber(sourceWeights.diversity ?? source.diversityWeight, 0, 50, baseWeights.diversity), 3),
      exploration: rounded(clampNumber(sourceWeights.exploration ?? source.explorationWeight, 0, 50, baseWeights.exploration), 3),
      retry: rounded(clampNumber(sourceWeights.retry ?? source.retryWeight, 0, 50, baseWeights.retry), 3),
      sceneRepeatPenalty: rounded(clampNumber(
        sourceWeights.sceneRepeatPenalty ?? source.sceneRepeatPenalty,
        0,
        50,
        baseWeights.sceneRepeatPenalty
      ), 3),
    },
    normalization: {
      timeCorrection: rounded(clampNumber(
        sourceNormalization.timeCorrection ?? source.timeCorrection ?? source.durationNormalization,
        0,
        1,
        baseNormalization.timeCorrection
      ), 3),
      audienceSize: rounded(clampNumber(
        sourceNormalization.audienceSize ?? source.audienceSizeNormalization,
        0,
        1,
        baseNormalization.audienceSize
      ), 3),
    },
    profile: {
      memoryMode: memoryMode === "cumulative_recency" ? "cumulative_recency" : defaults.profile.memoryMode,
      recencyHalfLifeObservations: rounded(clampNumber(
        sourceProfile.recencyHalfLifeObservations ?? source.recencyHalfLifeObservations,
        1,
        100,
        baseProfile.recencyHalfLifeObservations
      ), 3),
      liveWeightMultiplier: rounded(clampNumber(
        sourceProfile.liveWeightMultiplier ?? source.liveWeightMultiplier,
        0,
        10,
        baseProfile.liveWeightMultiplier
      ), 3),
    },
    neutralPredictedScore: rounded(clampNumber(source.neutralPredictedScore, -1000, 1000, base.neutralPredictedScore), 3),
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

function durationFactor(durationSeconds, config = defaultAlgorithmConfig()) {
  const duration = Math.max(15, safeNumber(durationSeconds, 60));
  const fullCorrection = Math.sqrt(60 / duration);
  const correction = config.normalization ? safeNumber(config.normalization.timeCorrection, 1) : 1;
  return fullCorrection ** clampNumber(correction, 0, 1, 1);
}

function audienceFactor(activeClients, config = defaultAlgorithmConfig()) {
  const clients = Math.max(1, safeNumber(activeClients, 1));
  const fullCorrection = 1 / Math.sqrt(clients);
  const correction = config.normalization ? safeNumber(config.normalization.audienceSize, 1) : 1;
  return fullCorrection ** clampNumber(correction, 0, 1, 1);
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
  const normalizedConfig = normalizeAlgorithmConfig(config);
  const counts = signalCounts(event);
  const weights = normalizedConfig.weights || {};
  const raw = (counts.hearts * safeNumber(weights.heart, 1))
    + (counts.bored * safeNumber(weights.bored, -1))
    + (counts.messages * safeNumber(weights.message, 0.05));
  return rounded(raw * audienceFactor(counts.activeClients, normalizedConfig) * durationFactor(counts.durationSeconds, normalizedConfig), 4);
}

function affinityForSituation(situation, observedSituation, config) {
  if (!situation || !observedSituation) return 0;
  const normalizedConfig = normalizeAlgorithmConfig(config);
  const weights = normalizedConfig.weights || {};
  const labels = new Set(observedSituation.labelIds || []);
  const characters = new Set(observedSituation.characterIds || []);
  const sharedLabels = (situation.labelIds || []).filter((id) => labels.has(id)).length;
  const sharedCharacters = (situation.characterIds || []).filter((id) => characters.has(id)).length;
  return (sharedLabels * safeNumber(weights.labelAffinity, 0.25))
    + (sharedCharacters * safeNumber(weights.characterAffinity, 0.15));
}

function average(values = []) {
  const safeValues = values.map((value) => safeNumber(value, NaN)).filter(Number.isFinite);
  if (!safeValues.length) return 0;
  return safeValues.reduce((sum, value) => sum + value, 0) / safeValues.length;
}

function observationStats(observations = []) {
  const bySituation = new Map();
  const characterCounts = new Map();
  for (const observation of observations) {
    if (!observation || !observation.situationId) continue;
    const current = bySituation.get(observation.situationId) || {
      count: 0,
      total: 0,
      latest: null,
    };
    current.count += 1;
    current.total += safeNumber(observation.observedScore, 0);
    current.latest = observation;
    bySituation.set(observation.situationId, current);
    for (const characterId of observation.characterIds || []) {
      characterCounts.set(characterId, Number(characterCounts.get(characterId) || 0) + 1);
    }
  }
  return { bySituation, characterCounts };
}

function recencyWeightForObservation(index, total, config) {
  const profile = (normalizeAlgorithmConfig(config).profile || {});
  if (profile.memoryMode !== "cumulative_recency") return 1;
  const age = Math.max(0, Number(total || 0) - 1 - Number(index || 0));
  const halfLife = Math.max(1, safeNumber(profile.recencyHalfLifeObservations, 6));
  return 0.5 ** (age / halfLife);
}

function addWeightedProfile(map, id, observedScore, weight, source = {}) {
  if (!id) return;
  const current = map.get(id) || {
    total: 0,
    weight: 0,
    count: 0,
    liveWeight: 0,
  };
  current.total += safeNumber(observedScore, 0) * weight;
  current.weight += weight;
  current.count += 1;
  if (source.live) current.liveWeight += weight;
  map.set(id, current);
}

function profileEntryValue(entry) {
  if (!entry || !entry.weight) return 0;
  return entry.total / entry.weight;
}

function profileAverageForIds(map, ids = []) {
  const values = (ids || [])
    .map((id) => map.get(id))
    .filter((entry) => entry && entry.weight > 0)
    .map(profileEntryValue);
  return values.length ? average(values) : 0;
}

function profileLiveWeightForIds(map, ids = []) {
  return (ids || [])
    .map((id) => map.get(id))
    .filter(Boolean)
    .reduce((sum, entry) => sum + safeNumber(entry.liveWeight, 0), 0);
}

function buildRunProfile(observations = [], liveObservation = null, config = defaultAlgorithmConfig()) {
  const normalizedConfig = normalizeAlgorithmConfig(config);
  const profile = {
    situations: new Map(),
    labels: new Map(),
    characters: new Map(),
    includesLive: !!liveObservation,
  };
  const addObservation = (observation, weight, source = {}) => {
    if (!observation || !observation.situationId) return;
    const score = safeNumber(observation.observedScore, 0);
    addWeightedProfile(profile.situations, observation.situationId, score, weight, source);
    for (const labelId of observation.labelIds || []) {
      addWeightedProfile(profile.labels, labelId, score, weight, source);
    }
    for (const characterId of observation.characterIds || []) {
      addWeightedProfile(profile.characters, characterId, score, weight, source);
    }
  };
  observations.forEach((observation, index) => {
    addObservation(observation, recencyWeightForObservation(index, observations.length, normalizedConfig));
  });
  if (liveObservation) {
    addObservation(liveObservation, safeNumber(normalizedConfig.profile.liveWeightMultiplier, 1.25), { live: true });
  }
  return profile;
}

function recentCharacterPenalty(situation, observations = [], weight = 0) {
  if (!weight || !situation) return 0;
  const characterIds = new Set(situation.characterIds || []);
  if (!characterIds.size) return 0;
  const recent = observations.slice(-3);
  let penalty = 0;
  recent.forEach((observation, index) => {
    const observationCharacters = observation.characterIds || [];
    const overlap = observationCharacters.filter((id) => characterIds.has(id)).length;
    if (!overlap) return;
    const recency = (index + 1) / recent.length;
    penalty += overlap * recency * weight;
  });
  return penalty;
}

function explorationBonusForSituation(situation, stats, weight = 0) {
  if (!weight || !situation) return 0;
  const situationCount = Number((stats.bySituation.get(situation.id) || {}).count || 0);
  const characterCounts = (situation.characterIds || []).map((id) => Number(stats.characterCounts.get(id) || 0));
  const characterExploration = characterCounts.length
    ? average(characterCounts.map((count) => 1 / (1 + count)))
    : 1;
  return weight * average([1 / (1 + situationCount), characterExploration]);
}

function retryBonusForSituation(situation, stats, weight = 0) {
  if (!weight || !situation) return 0;
  const item = stats.bySituation.get(situation.id);
  if (!item || !item.count) return 0;
  const averageObserved = item.total / item.count;
  if (averageObserved > 0) return 0;
  return weight / (1 + item.count);
}

function scoreFeedDebugSummary({ catalog, scores }) {
  const situations = activeSituations(catalog);
  const scoreBySituation = new Map((scores || []).map((score) => [score.situationId, score]));
  const topSituations = situations
    .map((situation) => ({
      id: situation.id,
      title: situation.title || situation.name || situation.id,
      score: safeNumber((scoreBySituation.get(situation.id) || {}).predictedScore, 0),
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 8);

  const labelScores = new Map();
  const characterScores = new Map();
  for (const situation of situations) {
    const score = safeNumber((scoreBySituation.get(situation.id) || {}).predictedScore, 0);
    for (const labelId of situation.labelIds || []) {
      const current = labelScores.get(labelId) || { total: 0, count: 0 };
      current.total += score;
      current.count += 1;
      labelScores.set(labelId, current);
    }
    for (const characterId of situation.characterIds || []) {
      const current = characterScores.get(characterId) || { total: 0, count: 0 };
      current.total += score;
      current.count += 1;
      characterScores.set(characterId, current);
    }
  }

  const labelsById = new Map(((catalog && catalog.labels) || []).map((item) => [item.id, item]));
  const charactersById = new Map(((catalog && catalog.characters) || []).map((item) => [item.id, item]));
  const topFromMap = (map, byId) => Array.from(map.entries())
    .map(([id, item]) => ({
      id,
      name: (byId.get(id) && (byId.get(id).name || byId.get(id).title)) || id,
      score: rounded(item.total / Math.max(1, item.count), 4),
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 8);

  return {
    topSituations,
    topLabels: topFromMap(labelScores, labelsById),
    topCharacters: topFromMap(characterScores, charactersById),
  };
}

function buildScoreFeed({
  showRunId,
  catalog,
  observations = [],
  liveObservation = null,
  config = defaultAlgorithmConfig(),
}) {
  const normalizedConfig = normalizeAlgorithmConfig(config);
  const situations = activeSituations(catalog);
  const observedBySituation = new Map();
  for (const observation of observations) {
    observedBySituation.set(observation.situationId, observation);
  }
  const latestObservation = liveObservation || (observations.length ? observations[observations.length - 1] : null);
  const latestIsLive = !!liveObservation;
  const observedSituation = latestObservation
    ? situationById(catalog, latestObservation.situationId)
    : null;
  const stats = observationStats(observations);
  const runProfile = buildRunProfile(observations, liveObservation, normalizedConfig);

  const scores = situations.map((situation) => {
    const observation = observedBySituation.get(situation.id);
    const observedScore = observation ? observation.observedScore : null;
    const liveScore = liveObservation && liveObservation.situationId === situation.id
      ? liveObservation.observedScore
      : null;
    let predictedScore = safeNumber(normalizedConfig.neutralPredictedScore, 0);
    const components = {
      neutral: safeNumber(normalizedConfig.neutralPredictedScore, 0),
      observed: observedScore,
      liveAudience: liveScore,
      latestObservation: 0,
      affinity: 0,
      profileLabel: 0,
      profileCharacter: 0,
      profileSituation: 0,
      profileLabelAffinity: 0,
      profileCharacterAffinity: 0,
      diversityPenalty: 0,
      explorationBonus: 0,
      retryBonus: 0,
      sceneRepeatPenalty: 0,
    };
    const reasons = [];
    const labelProfile = profileAverageForIds(runProfile.labels, situation.labelIds || []);
    const characterProfile = profileAverageForIds(runProfile.characters, situation.characterIds || []);
    const situationProfile = profileEntryValue(runProfile.situations.get(situation.id));
    const labelAffinity = labelProfile * safeNumber(normalizedConfig.weights.labelAffinity, 0.25);
    const characterAffinity = characterProfile * safeNumber(normalizedConfig.weights.characterAffinity, 0.15);
    components.profileLabel = rounded(labelProfile, 4);
    components.profileCharacter = rounded(characterProfile, 4);
    components.profileSituation = rounded(situationProfile, 4);
    components.profileLabelAffinity = rounded(labelAffinity, 4);
    components.profileCharacterAffinity = rounded(characterAffinity, 4);
    components.affinity = rounded(labelAffinity + characterAffinity, 4);
    predictedScore += labelAffinity + characterAffinity;
    if (labelProfile !== 0) reasons.push("profile_label_affinity");
    if (characterProfile !== 0) reasons.push("profile_character_affinity");
    if (runProfile.includesLive && (
      profileLiveWeightForIds(runProfile.labels, situation.labelIds || []) > 0
      || profileLiveWeightForIds(runProfile.characters, situation.characterIds || []) > 0
      || (runProfile.situations.get(situation.id) || {}).liveWeight > 0
    )) {
      reasons.push("live_audience_profile");
    }
    if (liveScore != null) {
      predictedScore = liveScore;
      reasons.length = 0;
      reasons.push("live_audience_signals");
    }
    if (observation) {
      predictedScore = observation.observedScore;
      reasons.length = 0;
      reasons.push("observed");
      if (observation.finalizedFromAudienceAggregate) reasons.push("finalized_from_audience_aggregate");
      if (observation.finalizedFromLiveAudience) reasons.push("finalized_from_live_audience");
    }
    components.diversityPenalty = rounded(recentCharacterPenalty(
      situation,
      observations,
      safeNumber(normalizedConfig.weights.diversity, 0)
    ), 4);
    components.explorationBonus = rounded(explorationBonusForSituation(
      situation,
      stats,
      safeNumber(normalizedConfig.weights.exploration, 0)
    ), 4);
    components.retryBonus = rounded(retryBonusForSituation(
      situation,
      stats,
      safeNumber(normalizedConfig.weights.retry, 0)
    ), 4);
    const runCount = Number((stats.bySituation.get(situation.id) || {}).count || 0);
    components.sceneRepeatPenalty = rounded(
      runCount > 0 ? safeNumber(normalizedConfig.weights.sceneRepeatPenalty, 0) : 0,
      4
    );
    predictedScore = predictedScore
      - components.diversityPenalty
      + components.explorationBonus
      + components.retryBonus
      - components.sceneRepeatPenalty;
    if (components.diversityPenalty > 0) reasons.push("diversity_penalty");
    if (components.explorationBonus > 0) reasons.push("exploration_bonus");
    if (components.retryBonus > 0) reasons.push("retry_bonus");
    if (components.sceneRepeatPenalty > 0) reasons.push("scene_repeat_penalty");
    if (!reasons.length) {
      reasons.push(latestObservation
        ? latestIsLive ? "predicted_from_live_audience_signals" : "predicted_from_latest_observation"
        : "neutral");
    }
    components.final = rounded(predictedScore, 4);
    return {
      situationId: situation.id,
      legacySituationId: situation.legacyId || null,
      observedScore,
      predictedScore: rounded(predictedScore, 4),
      confidence: observation ? 0.8 : liveScore != null ? 0.55 : latestObservation ? latestIsLive ? 0.35 : 0.45 : 0.1,
      reasons,
      components,
    };
  });

  const feed = {
    type: "situationScoresUpdated",
    schemaVersion: ALGORITHM_SCORE_FEED_SCHEMA_VERSION,
    showRunId,
    scorePhase: liveObservation ? "live" : "definitive",
    updatedAt: new Date().toISOString(),
    updatedAfterSituationRunId: latestObservation ? latestObservation.situationRunId : null,
    scores,
  };
  feed.debugSummary = scoreFeedDebugSummary({ catalog, scores });
  return feed;
}

module.exports = {
  activeSituations,
  buildScoreFeed,
  catalogFromRunSnapshot,
  defaultAlgorithmConfig,
  durationFactor,
  audienceFactor,
  normalizeAlgorithmConfig,
  observedScoreForEvent,
  scoreFeedDebugSummary,
  signalCounts,
};
