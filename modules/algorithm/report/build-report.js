"use strict";

// Publieksrapport: wat dit publiek van de gespeelde scènes vond, per scène, per label en per
// personage, en wat het algoritme daardoor verwacht van de scènes die nog komen.

const {
  audienceFactor,
  durationFactor,
  normalizeAlgorithmConfig,
  signalCounts,
} = require("../scoring/score-engine");

function round(value, digits = 2) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 0;
  const factor = 10 ** digits;
  return Math.round(number * factor) / factor;
}

function nameMap(items = []) {
  return new Map((items || []).map((item) => [item.id, String(item.name || item.title || item.id).replace(/_/g, " ")]));
}

function average(values) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}

// Eén rij per label of personage: hoe vaak gespeeld en wat het publiek ervan vond.
function groupRows(scenes, key, names) {
  const groups = new Map();
  for (const scene of scenes) {
    for (const id of scene[key]) {
      if (!groups.has(id)) groups.set(id, { id, name: names.get(id) || id, scores: [], hearts: 0, bored: 0, messages: 0 });
      const group = groups.get(id);
      group.scores.push(scene.score);
      group.hearts += scene.hearts;
      group.bored += scene.bored;
      group.messages += scene.messages;
    }
  }
  return Array.from(groups.values())
    .map((group) => ({
      id: group.id,
      name: group.name,
      scenes: group.scores.length,
      averageScore: round(average(group.scores)),
      hearts: group.hearts,
      bored: group.bored,
      messages: group.messages,
    }))
    .sort((a, b) => b.averageScore - a.averageScore || b.scenes - a.scenes || a.name.localeCompare(b.name));
}

function buildAudienceReport(state = {}) {
  const catalog = state.catalog || {};
  const situations = new Map((catalog.situations || []).map((item) => [item.id, item]));
  const labelNames = nameMap(catalog.labels);
  const characterNames = nameMap(catalog.characters);
  const observations = Array.isArray(state.observations) ? state.observations : [];
  const config = normalizeAlgorithmConfig(state.config || {});
  const weights = config.weights || {};

  const scenes = observations.map((observation, index) => {
    const situation = situations.get(observation.situationId) || {};
    const counts = signalCounts(observation);
    const labelIds = observation.labelIds || situation.labelIds || [];
    const characterIds = observation.characterIds || situation.characterIds || [];
    const sound = observation.roomSound && typeof observation.roomSound === "object" ? observation.roomSound : null;
    return {
      nr: index + 1,
      situationRunId: observation.situationRunId || null,
      situationId: observation.situationId,
      title: situation.title || observation.situationId,
      labelIds,
      characterIds,
      labels: labelIds.map((id) => labelNames.get(id) || id),
      characters: characterIds.map((id) => characterNames.get(id) || id),
      startedAt: observation.startedAt || null,
      endedAt: observation.endedAt || null,
      durationSeconds: Math.round(counts.durationSeconds),
      viewers: (observation.audience && Number(observation.audience.activeClients)) || 0,
      hearts: counts.hearts,
      bored: counts.bored,
      messages: counts.messages,
      score: round(observation.observedScore),
      heartsPerMinute: round(counts.hearts / (counts.durationSeconds / 60), 1),
      // De som achter de score, zodat te zien is waar het getal vandaan komt.
      calculation: {
        raw: round((counts.hearts * Number(weights.heart)) + (counts.bored * Number(weights.bored)) + (counts.messages * Number(weights.message))),
        durationFactor: round(durationFactor(counts.durationSeconds, config)),
        audienceFactor: round(audienceFactor(counts.activeClients, config)),
      },
      roomSound: sound,
    };
  });

  const runAverage = round(average(scenes.map((scene) => scene.score)));
  for (const scene of scenes) scene.versusAverage = round(scene.score - runAverage);

  const totalSeconds = scenes.reduce((sum, scene) => sum + scene.durationSeconds, 0);
  const totalHearts = scenes.reduce((sum, scene) => sum + scene.hearts, 0);
  const totalBored = scenes.reduce((sum, scene) => sum + scene.bored, 0);
  const byScore = scenes.slice().sort((a, b) => b.score - a.score);
  const kort = (scene) => (scene ? { nr: scene.nr, title: scene.title, score: scene.score } : null);
  const stats = {
    totalMinutes: round(totalSeconds / 60, 1),
    averageViewers: round(average(scenes.map((scene) => scene.viewers)), 0),
    heartsPerMinute: totalSeconds ? round(totalHearts / (totalSeconds / 60), 1) : 0,
    // Aandeel hartjes in alle hartjes en verveeld samen, in procenten.
    heartShare: totalHearts + totalBored ? Math.round((totalHearts / (totalHearts + totalBored)) * 100) : null,
    best: scenes.length > 1 ? kort(byScore[0]) : null,
    worst: scenes.length > 1 ? kort(byScore[byScore.length - 1]) : null,
  };

  const labels = groupRows(scenes, "labelIds", labelNames);
  const characters = groupRows(scenes, "characterIds", characterNames);

  // Een conclusie pas als er iets te vergelijken valt: twee labels met een verschillende score.
  let conclusion = null;
  if (labels.length >= 2 && labels[0].averageScore !== labels[labels.length - 1].averageScore) {
    // Bij een gelijke stand staan alle labels met die score erin.
    conclusion = {
      best: labels.filter((row) => row.averageScore === labels[0].averageScore),
      worst: labels.filter((row) => row.averageScore === labels[labels.length - 1].averageScore),
    };
  }

  const playedIds = new Set(scenes.map((scene) => scene.situationId));
  const scores = state.scoreFeed && Array.isArray(state.scoreFeed.scores) ? state.scoreFeed.scores : [];
  // De scène die nu speelt heeft al een voorlopige score uit de reacties tot nu toe.
  const isLive = (score) => !!score.components && score.components.liveAudience != null && !playedIds.has(score.situationId);
  const liveScore = scores.find(isLive) || null;
  const liveSituation = liveScore ? situations.get(liveScore.situationId) : null;
  const live = liveSituation ? {
    situationId: liveScore.situationId,
    title: liveSituation.title || liveScore.situationId,
    labels: (liveSituation.labelIds || []).map((id) => labelNames.get(id) || id),
    score: round(liveScore.components.liveAudience),
  } : null;
  const forecast = scores
    .filter((score) => !playedIds.has(score.situationId) && situations.has(score.situationId) && !isLive(score))
    .map((score) => {
      const situation = situations.get(score.situationId);
      const components = score.components || {};
      return {
        situationId: score.situationId,
        title: situation.title || score.situationId,
        labels: (situation.labelIds || []).map((id) => labelNames.get(id) || id),
        predictedScore: round(score.predictedScore),
        fromLabels: round(components.profileLabelAffinity),
        fromCharacters: round(components.profileCharacterAffinity),
        exploration: round(components.explorationBonus),
        diversity: round(-Number(components.diversityPenalty || 0)),
      };
    })
    .sort((a, b) => b.predictedScore - a.predictedScore || a.title.localeCompare(b.title));

  return {
    ok: true,
    showRunId: state.showRunId || null,
    createdAt: state.createdAt || null,
    updatedAt: state.updatedAt || null,
    totals: {
      scenes: scenes.length,
      hearts: scenes.reduce((sum, scene) => sum + scene.hearts, 0),
      bored: scenes.reduce((sum, scene) => sum + scene.bored, 0),
      messages: scenes.reduce((sum, scene) => sum + scene.messages, 0),
      averageScore: runAverage,
    },
    stats,
    conclusion,
    live,
    labels,
    characters,
    scenes,
    forecast: {
      highest: forecast.slice(0, 5),
      lowest: forecast.length > 5 ? forecast.slice(-3).reverse() : [],
    },
    weights,
  };
}

module.exports = { buildAudienceReport };
