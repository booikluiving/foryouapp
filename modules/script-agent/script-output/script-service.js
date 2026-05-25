"use strict";

const {
  SCRIPT_AGENT_SCRIPT_OUTPUT_SCHEMA_VERSION,
  createScriptAgentId,
} = require("../../../shared/contracts/script-agent-v0");
const { buildCaptions } = require("../live-captions/caption-builder");
const { defaultScriptText } = require("../prompt-builder/prompt-builder");
const { buildTeleprompterView } = require("../teleprompter/teleprompter");
const { parseScriptText } = require("../text-parser/text-parser");

function createScriptOutput({ promptInput, scriptText, createdAtDate = new Date() }) {
  if (!promptInput || typeof promptInput !== "object") throw new Error("script_agent_missing_prompt_input");
  const text = String(scriptText == null || scriptText === "" ? defaultScriptText(promptInput) : scriptText);
  const parserOutput = parseScriptText({ promptInput, scriptText: text, parsedAtDate: createdAtDate });
  const teleprompter = buildTeleprompterView({ promptInput, parserOutput, createdAtDate });
  const captions = buildCaptions({ promptInput, parserOutput, createdAtDate });
  return {
    schemaVersion: SCRIPT_AGENT_SCRIPT_OUTPUT_SCHEMA_VERSION,
    scriptId: createScriptAgentId("script-output", createdAtDate),
    promptInputId: promptInput.promptInputId,
    showRunId: promptInput.showRunId,
    situationId: promptInput.situation.situationId,
    createdAt: createdAtDate.toISOString(),
    source: {
      type: "script-agent-v0",
      readOnly: false,
    },
    scriptText: text,
    parserOutput,
    teleprompter,
    captions,
  };
}

module.exports = {
  createScriptOutput,
};
