"use strict";

const crypto = require("node:crypto");

const {
  SCRIPT_AGENT_PROMPT_INPUT_SCHEMA_VERSION,
  createScriptAgentId,
} = require("../../../shared/contracts/script-agent-v0");
const { assignPerformerSlots } = require("../../../shared/casting/performer-slots");

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

function situationFromCatalog(catalog, situationId) {
  return (catalog.situations || []).find((item) => item.id === situationId) || null;
}

function performerSlotsForResolved(resolved, catalog) {
  if (Array.isArray(resolved.performerSlots) && resolved.performerSlots.length) {
    return cloneJson(resolved.performerSlots).sort((a, b) => {
      if (Number(a.slotIndex || 0) !== Number(b.slotIndex || 0)) {
        return Number(a.slotIndex || 0) - Number(b.slotIndex || 0);
      }
      return String(a.characterName || "").localeCompare(String(b.characterName || ""));
    });
  }
  return assignPerformerSlots({
    characters: resolved.characters || [],
    performers: catalog.performers || [],
  }).performerSlots;
}

// Zelfde bron als de handmatige operatorroute: promptText, anders description.
function characterDescription(character, catalog) {
  const fromCatalog = (catalog.characters || []).find((item) => item.id === character.id) || {};
  return String(
    character.promptText || character.description || fromCatalog.promptText || fromCatalog.description || ""
  ).replace(/\s+/g, " ").trim();
}

function promptTextFor({ resolved, situation, catalog = {} }) {
  // Rollen staan al in de Performer-slots van het operatorsjabloon.
  const characters = (resolved.characters || [])
    .map((character) => ({ name: character.name, description: characterDescription(character, catalog) }));
  const lines = [
    `Situatie: ${resolved.title || ""}`,
    `Omgeving: ${resolved.environment ? resolved.environment.name : "geen"}`,
    "Personages:",
    ...(characters.length
      ? characters.map((item) => `- ${item.name}${item.description ? `: ${item.description}` : ""}`)
      : ["- geen personages"]),
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
      showRunSnapshotCreatedAt: runtimeState.showRunSnapshot
        ? runtimeState.showRunSnapshot.createdAt || null
        : runtimeState.showRunSnapshotCreatedAt || null,
    },
    situation: stableInput.situation,
    environment: stableInput.environment,
    characters: stableInput.characters,
    performerSlots: stableInput.performerSlots,
    promptText: promptTextFor({ resolved, situation, catalog }),
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
