"use strict";

const { assignPerformerSlots } = require("../../../shared/casting/performer-slots");
const { enrichPayloadWithEnvironmentAssets } = require("./environment-assets");

const RUNTIME_RESOLVED_OUTPUT_SCHEMA_VERSION = "runtime.resolved-output.v0";

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function resolvedForSource(runtimeState = {}, sourceKey = "resolvedPreparedNext") {
  return sourceKey === "activeSituation"
    ? runtimeState.activeSituation && runtimeState.activeSituation.resolved
    : runtimeState.resolvedPreparedNext;
}

function castAssignmentFromRuntimeState(runtimeState = {}, sourceKey = "resolvedPreparedNext") {
  const resolved = resolvedForSource(runtimeState, sourceKey);
  const catalog = runtimeState.showRunSnapshot && runtimeState.showRunSnapshot.catalog
    ? runtimeState.showRunSnapshot.catalog
    : {};
  if (!resolved) return { ok: true, performerSlots: [], issues: [] };
  return assignPerformerSlots({
    characters: resolved.characters || [],
    performers: catalog.performers || [],
  });
}

function performerSlotsFromRuntimeState(runtimeState = {}, sourceKey = "resolvedPreparedNext") {
  const resolved = resolvedForSource(runtimeState, sourceKey);
  if (resolved && Array.isArray(resolved.performerSlots) && resolved.performerSlots.length) {
    return cloneJson(resolved.performerSlots);
  }
  return castAssignmentFromRuntimeState(runtimeState, sourceKey).performerSlots;
}

function castWarningsFromRuntimeState(runtimeState = {}, sourceKey = "resolvedPreparedNext") {
  const resolved = resolvedForSource(runtimeState, sourceKey);
  if (resolved && Array.isArray(resolved.castWarnings)) return cloneJson(resolved.castWarnings);
  return castAssignmentFromRuntimeState(runtimeState, sourceKey).issues;
}

function sourceTypeFor(sourceKey = "resolvedPreparedNext", override = "") {
  if (override) return override;
  return sourceKey === "activeSituation" ? "runtime.active-situation" : "runtime.resolved-prepared-next";
}

function resolvedPayloadFromRuntimeState(runtimeState, sourceKey = "resolvedPreparedNext", sourceType = "", options = {}) {
  if (!runtimeState || typeof runtimeState !== "object") throw new Error("show_control_missing_runtime_state");
  const resolved = resolvedForSource(runtimeState, sourceKey);
  if (!resolved) throw new Error(`show_control_missing_runtime_${sourceKey}`);
  const copy = cloneJson(resolved);
  const basePayload = {
    source: {
      type: sourceTypeFor(sourceKey, sourceType),
      readOnly: true,
    },
    showRunId: runtimeState.showRunId,
    situationRunId: runtimeState.activeSituation ? runtimeState.activeSituation.situationRunId : null,
    situation: {
      situationId: copy.situationId,
      legacySituationId: copy.legacySituationId || null,
      title: copy.title || "",
      promptText: copy.promptText || "",
    },
    environment: copy.environment || null,
    environmentId: copy.environmentId || copy.environment && copy.environment.id || null,
    characterIds: copy.characterIds || (copy.characters || []).map((character) => character.id),
    characters: (copy.characters || []).map((character) => ({
      characterId: character.id,
      legacyCharacterId: character.legacyId || null,
      name: character.name,
      performerIds: character.performerIds || [],
    })),
    performerSlots: performerSlotsFromRuntimeState(runtimeState, sourceKey),
    castWarnings: castWarningsFromRuntimeState(runtimeState, sourceKey),
    labelIds: copy.labelIds || [],
    seed: copy.seed || null,
  };
  return enrichPayloadWithEnvironmentAssets(basePayload, runtimeState, copy, options);
}

function compactResolvedFromPayload(payload = {}) {
  return {
    situationId: payload.situation && payload.situation.situationId || null,
    legacySituationId: payload.situation && payload.situation.legacySituationId || null,
    title: payload.situation && payload.situation.title || "",
    promptText: payload.situation && payload.situation.promptText || "",
    characterIds: Array.isArray(payload.characterIds) ? payload.characterIds.slice() : [],
    characters: (payload.characters || []).map((character) => ({
      id: character.characterId,
      legacyId: character.legacyCharacterId || null,
      name: character.name,
      performerIds: Array.isArray(character.performerIds) ? character.performerIds.slice() : [],
    })),
    environmentId: payload.environmentId || payload.environment && payload.environment.id || null,
    environment: payload.environment || null,
    labelIds: Array.isArray(payload.labelIds) ? payload.labelIds.slice() : [],
    performerSlots: cloneJson(payload.performerSlots || []),
    castWarnings: cloneJson(payload.castWarnings || []),
    seed: payload.seed || null,
  };
}

function runtimeOutputFromRuntimeState(runtimeState, sourceKey = "resolvedPreparedNext", options = {}) {
  const payload = resolvedPayloadFromRuntimeState(runtimeState, sourceKey, "runtime.resolved-output", options);
  const resolved = compactResolvedFromPayload(payload);
  return {
    schemaVersion: RUNTIME_RESOLVED_OUTPUT_SCHEMA_VERSION,
    source: payload.source,
    selection: sourceKey,
    showRunId: payload.showRunId,
    situationRunId: payload.situationRunId || null,
    status: runtimeState.status || null,
    updatedAt: runtimeState.updatedAt || null,
    runtimeUpdatedAt: runtimeState.updatedAt || null,
    showRunSnapshotCreatedAt: runtimeState.showRunSnapshot ? runtimeState.showRunSnapshot.createdAt || null : null,
    situation: payload.situation,
    environment: payload.environment,
    environmentId: payload.environmentId || null,
    characterIds: payload.characterIds,
    characters: payload.characters,
    performerSlots: payload.performerSlots,
    castWarnings: payload.castWarnings,
    labelIds: payload.labelIds,
    seed: payload.seed || null,
    resolvedPreparedNext: resolved,
  };
}

module.exports = {
  RUNTIME_RESOLVED_OUTPUT_SCHEMA_VERSION,
  castWarningsFromRuntimeState,
  performerSlotsFromRuntimeState,
  resolvedPayloadFromRuntimeState,
  runtimeOutputFromRuntimeState,
};
