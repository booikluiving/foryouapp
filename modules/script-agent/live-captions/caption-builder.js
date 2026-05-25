"use strict";

const {
  SCRIPT_AGENT_CAPTIONS_SCHEMA_VERSION,
} = require("../../../shared/contracts/script-agent-v0");

function buildCaptions({ promptInput, parserOutput, createdAtDate = new Date() }) {
  const lines = parserOutput && Array.isArray(parserOutput.lines) ? parserOutput.lines : [];
  return {
    schemaVersion: SCRIPT_AGENT_CAPTIONS_SCHEMA_VERSION,
    createdAt: createdAtDate.toISOString(),
    promptInputId: promptInput.promptInputId,
    showRunId: promptInput.showRunId,
    situationId: promptInput.situation.situationId,
    segments: lines.map((line, index) => ({
      segmentIndex: index + 1,
      lineNumber: line.lineNumber,
      speaker: line.characterName || line.role || null,
      text: line.text,
    })),
  };
}

module.exports = {
  buildCaptions,
};
