"use strict";

const { enrichPayloadWithEnvironmentAssets } = require("./environment-assets");

const RUNTIME_RESOLVED_OUTPUT_SCHEMA_VERSION = "runtime.resolved-output.v0";

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function byId(items = []) {
  return new Map((Array.isArray(items) ? items : []).map((item) => [item.id, item]));
}

function resolvedForSource(runtimeState = {}, sourceKey = "resolvedPreparedNext") {
  return sourceKey === "activeSituation"
    ? runtimeState.activeSituation && runtimeState.activeSituation.resolved
    : runtimeState.resolvedPreparedNext;
}

function performerSlotsFromRuntimeState(runtimeState = {}, sourceKey = "resolvedPreparedNext") {
  const resolved = resolvedForSource(runtimeState, sourceKey);
  if (resolved && Array.isArray(resolved.performerSlots) && resolved.performerSlots.length) {
    return cloneJson(resolved.performerSlots);
  }
  const catalog = runtimeState.showRunSnapshot && runtimeState.showRunSnapshot.catalog
    ? runtimeState.showRunSnapshot.catalog
    : {};
  const performers = byId(catalog.performers || []);
  const slots = [];
  const seen = new Set();
  for (const character of resolved && resolved.characters || []) {
    const performerIds = character.performerIds && character.performerIds.length ? character.performerIds : [null];
    for (const performerId of performerIds) {
      const performer = performerId ? performers.get(performerId) : null;
      const slotIndex = performer && Number.isFinite(Number(performer.performerSlot))
        ? Number(performer.performerSlot)
        : slots.length + 1;
      const key = `${slotIndex}:${performerId || "unassigned"}:${character.id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      slots.push({
        slotIndex,
        performerId,
        performerName: performer ? performer.name : null,
        characterId: character.id,
        legacyCharacterId: character.legacyId || null,
        characterName: character.name,
      });
    }
  }
  return slots.sort((a, b) => {
    if (a.slotIndex !== b.slotIndex) return a.slotIndex - b.slotIndex;
    return String(a.characterName).localeCompare(String(b.characterName), "nl-NL");
  });
}

function sourceTypeFor(sourceKey = "resolvedPreparedNext", override = "") {
  if (override) return override;
  return sourceKey === "activeSituation" ? "runtime.active-situation" : "runtime.resolved-prepared-next";
}

function resolvedPayloadFromRuntimeState(runtimeState, sourceKey = "resolvedPreparedNext", sourceType = "") {
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
    labelIds: copy.labelIds || [],
    seed: copy.seed || null,
  };
  return enrichPayloadWithEnvironmentAssets(basePayload, runtimeState, copy);
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
    seed: payload.seed || null,
  };
}

function runtimeOutputFromRuntimeState(runtimeState, sourceKey = "resolvedPreparedNext") {
  const payload = resolvedPayloadFromRuntimeState(runtimeState, sourceKey, "runtime.resolved-output");
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
    labelIds: payload.labelIds,
    seed: payload.seed || null,
    resolvedPreparedNext: resolved,
  };
}

module.exports = {
  RUNTIME_RESOLVED_OUTPUT_SCHEMA_VERSION,
  performerSlotsFromRuntimeState,
  resolvedPayloadFromRuntimeState,
  runtimeOutputFromRuntimeState,
};
