"use strict";

const {
  SCRIPT_AGENT_PARSER_OUTPUT_SCHEMA_VERSION,
} = require("../../../shared/contracts/script-agent-v0");

function normalizeName(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function roleMap(promptInput) {
  const map = new Map();
  for (const character of promptInput.characters || []) {
    map.set(normalizeName(character.name), {
      characterId: character.characterId,
      characterName: character.name,
    });
  }
  for (const slot of promptInput.performerSlots || []) {
    if (slot.performerName) {
      map.set(normalizeName(slot.performerName), {
        characterId: slot.characterId,
        characterName: slot.characterName,
      });
    }
  }
  return map;
}

function slotForCharacter(promptInput, characterId) {
  return (promptInput.performerSlots || []).find((slot) => slot.characterId === characterId) || null;
}

function parseScriptText({ promptInput, scriptText, parsedAtDate = new Date() }) {
  if (!promptInput || typeof promptInput !== "object") throw new Error("script_agent_missing_prompt_input");
  const map = roleMap(promptInput);
  const issues = [];
  const lines = String(scriptText || "")
    .split(/\r?\n/)
    .map((rawLine, index) => ({ rawLine, index: index + 1 }))
    .filter((line) => line.rawLine.trim())
    .map((line) => {
      const match = line.rawLine.match(/^([^:]{1,120}):\s*(.*)$/);
      if (!match) {
        return {
          lineNumber: line.index,
          type: "narration",
          role: null,
          characterId: null,
          characterName: null,
          performerSlot: null,
          text: line.rawLine.trim(),
        };
      }
      const role = match[1].trim();
      const text = match[2].trim();
      const known = map.get(normalizeName(role));
      if (!known) {
        issues.push({
          severity: "error",
          code: "unknown_role",
          lineNumber: line.index,
          role,
          message: `Unknown role ${role}.`,
        });
        return {
          lineNumber: line.index,
          type: "dialogue",
          role,
          characterId: null,
          characterName: null,
          performerSlot: null,
          text,
        };
      }
      const slot = slotForCharacter(promptInput, known.characterId);
      return {
        lineNumber: line.index,
        type: "dialogue",
        role,
        characterId: known.characterId,
        characterName: known.characterName,
        performerSlot: slot ? {
          slotIndex: slot.slotIndex,
          performerId: slot.performerId,
          performerName: slot.performerName,
        } : null,
        text,
      };
    });

  const usedCharacterIds = new Set(lines.map((line) => line.characterId).filter(Boolean));
  for (const character of promptInput.characters || []) {
    if (!usedCharacterIds.has(character.characterId)) {
      issues.push({
        severity: "warning",
        code: "character_without_line",
        characterId: character.characterId,
        characterName: character.name,
        message: `${character.name} has no parsed line.`,
      });
    }
  }

  return {
    schemaVersion: SCRIPT_AGENT_PARSER_OUTPUT_SCHEMA_VERSION,
    parsedAt: parsedAtDate.toISOString(),
    promptInputId: promptInput.promptInputId,
    showRunId: promptInput.showRunId,
    situationId: promptInput.situation.situationId,
    verified: !issues.some((issue) => issue.severity === "error"),
    issues,
    lines,
  };
}

module.exports = {
  normalizeName,
  parseScriptText,
};
