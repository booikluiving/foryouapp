"use strict";

const {
  SCRIPT_AGENT_TELEPROMPTER_SCHEMA_VERSION,
} = require("../../../shared/contracts/script-agent-v0");

function buildTeleprompterView({ promptInput, parserOutput, createdAtDate = new Date() }) {
  const lines = parserOutput && Array.isArray(parserOutput.lines) ? parserOutput.lines : [];
  return {
    schemaVersion: SCRIPT_AGENT_TELEPROMPTER_SCHEMA_VERSION,
    createdAt: createdAtDate.toISOString(),
    promptInputId: promptInput.promptInputId,
    showRunId: promptInput.showRunId,
    situationId: promptInput.situation.situationId,
    title: promptInput.situation.title,
    performerSlots: (promptInput.performerSlots || []).map((slot) => ({
      slotIndex: slot.slotIndex,
      performerId: slot.performerId,
      performerName: slot.performerName,
      characterId: slot.characterId,
      characterName: slot.characterName,
      lines: lines
        .filter((line) => line.characterId === slot.characterId)
        .map((line) => ({
          lineNumber: line.lineNumber,
          text: line.text,
        })),
    })),
    narration: lines
      .filter((line) => line.type === "narration")
      .map((line) => ({
        lineNumber: line.lineNumber,
        text: line.text,
      })),
  };
}

module.exports = {
  buildTeleprompterView,
};
