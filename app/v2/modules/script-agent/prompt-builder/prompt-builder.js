"use strict";

const crypto = require("node:crypto");

const {
  SCRIPT_AGENT_PROMPT_INPUT_SCHEMA_VERSION,
  createScriptAgentId,
} = require("../../../shared/contracts/script-agent-v0");

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function hashContent(value) {
  return crypto.createHash("sha256").update(stableStringify(value)).digest("hex");
}

function byId(items = []) {
  return new Map(items.map((item) => [item.id, item]));
}

function situationFromCatalog(catalog, situationId) {
  return (catalog.situations || []).find((item) => item.id === situationId) || null;
}

function performerSlotsForResolved(resolved, catalog) {
  const performers = byId(catalog.performers || []);
  const seen = new Set();
  const slots = [];
  for (const character of resolved.characters || []) {
    const performerIds = character.performerIds && character.performerIds.length
      ? character.performerIds
      : [null];
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
        characterName: character.name,
      });
    }
  }
  return slots.sort((a, b) => {
    if (a.slotIndex !== b.slotIndex) return a.slotIndex - b.slotIndex;
    return String(a.characterName).localeCompare(String(b.characterName));
  });
}

function promptTextFor({ resolved, situation, performerSlots }) {
  const lines = [
    `Situation: ${resolved.title || ""}`,
    `Environment: ${resolved.environment ? resolved.environment.name : "none"}`,
    "Roles:",
    ...performerSlots.map((slot) => {
      const performer = slot.performerName || `slot ${slot.slotIndex}`;
      return `- Performer ${slot.slotIndex} (${performer}) plays ${slot.characterName}`;
    }),
    "Prompt:",
    resolved.promptText || (situation && situation.promptText) || "",
  ];
  return lines.join("\n").trim();
}

function buildPromptInput(runtimeState, createdAtDate = new Date()) {
  if (!runtimeState || typeof runtimeState !== "object") throw new Error("script_agent_missing_runtime_state");
  if (!runtimeState.showRunId) throw new Error("script_agent_missing_show_run_id");
  if (!runtimeState.resolvedPreparedNext) throw new Error("script_agent_missing_resolved_prepared_next");
  const catalog = runtimeState.showRunSnapshot && runtimeState.showRunSnapshot.catalog
    ? runtimeState.showRunSnapshot.catalog
    : {};
  const resolved = cloneJson(runtimeState.resolvedPreparedNext);
  const situation = situationFromCatalog(catalog, resolved.situationId);
  const performerSlots = performerSlotsForResolved(resolved, catalog);
  const stableInput = {
    showRunId: runtimeState.showRunId,
    situation: {
      situationId: resolved.situationId,
      legacySituationId: resolved.legacySituationId || null,
      title: resolved.title || "",
      promptText: resolved.promptText || (situation && situation.promptText) || "",
      labelIds: resolved.labelIds || [],
    },
    environment: resolved.environment || null,
    characters: (resolved.characters || []).map((character) => ({
      characterId: character.id,
      legacyCharacterId: character.legacyId || null,
      name: character.name,
      performerIds: character.performerIds || [],
    })),
    performerSlots,
    seed: resolved.seed || null,
  };
  return {
    schemaVersion: SCRIPT_AGENT_PROMPT_INPUT_SCHEMA_VERSION,
    promptInputId: createScriptAgentId("script-prompt-input", createdAtDate),
    createdAt: createdAtDate.toISOString(),
    contentHash: hashContent(stableInput),
    source: {
      type: "runtime-output",
      readOnly: true,
    },
    showRunId: runtimeState.showRunId,
    runtimeContext: {
      status: runtimeState.status || null,
      runtimeUpdatedAt: runtimeState.updatedAt || null,
      showRunSnapshotCreatedAt: runtimeState.showRunSnapshot ? runtimeState.showRunSnapshot.createdAt || null : null,
    },
    situation: stableInput.situation,
    environment: stableInput.environment,
    characters: stableInput.characters,
    performerSlots: stableInput.performerSlots,
    promptText: promptTextFor({ resolved, situation, performerSlots }),
  };
}

function defaultScriptText(promptInput) {
  const slots = promptInput.performerSlots || [];
  if (!slots.length) return `${promptInput.situation.title}: ...`;
  return slots
    .map((slot) => `${slot.characterName}: ${promptInput.situation.title}`)
    .join("\n");
}

module.exports = {
  buildPromptInput,
  defaultScriptText,
  hashContent,
  stableStringify,
};
