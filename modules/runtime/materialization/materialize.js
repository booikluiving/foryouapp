"use strict";

const { assignPerformerSlots } = require("../../../shared/casting/performer-slots");

function situationById(catalog, situationId) {
  return (catalog.situations || []).find((item) => item.id === situationId) || null;
}

function characterById(catalog, characterId) {
  return (catalog.characters || []).find((item) => item.id === characterId) || null;
}

function environmentById(catalog, environmentId) {
  return (catalog.environments || []).find((item) => item.id === environmentId) || null;
}

function activeEnvironments(catalog) {
  return (catalog.environments || []).filter((item) => item.active && !item.archivedAt);
}

function materializePreparedNext({ catalog, preparedNext, seed = "" }) {
  if (!preparedNext || !preparedNext.situationId) return null;
  const situation = situationById(catalog, preparedNext.situationId);
  if (!situation) throw new Error(`runtime_materialize_missing_situation:${preparedNext.situationId}`);
  const characters = (situation.characterIds || [])
    .map((id) => characterById(catalog, id))
    .filter(Boolean);
  let environment = situation.environmentId ? environmentById(catalog, situation.environmentId) : null;
  if (!environment && situation.environmentMode === "random") {
    environment = activeEnvironments(catalog)[0] || null;
  }
  const castAssignment = assignPerformerSlots({
    characters,
    performers: catalog.performers || [],
  });
  return {
    situationId: situation.id,
    legacySituationId: situation.legacyId,
    title: situation.title,
    promptText: situation.promptText,
    characterIds: characters.map((item) => item.id),
    characters: characters.map((item) => ({
      id: item.id,
      legacyId: item.legacyId,
      name: item.name,
      performerIds: item.performerIds || [],
    })),
    performerSlots: castAssignment.performerSlots,
    ...(castAssignment.issues.length ? { castWarnings: castAssignment.issues } : {}),
    environmentId: environment ? environment.id : null,
    environment: environment ? {
      id: environment.id,
      legacyId: environment.legacyId,
      name: environment.name,
    } : null,
    labelIds: situation.labelIds || [],
    seed,
    materializedAt: new Date().toISOString(),
  };
}

module.exports = {
  materializePreparedNext,
};
