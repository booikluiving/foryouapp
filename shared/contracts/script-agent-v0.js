"use strict";

const crypto = require("node:crypto");

const SCRIPT_AGENT_PROMPT_INPUT_SCHEMA_VERSION = "script-agent.prompt-input.v0";
const SCRIPT_AGENT_PARSER_OUTPUT_SCHEMA_VERSION = "script-agent.parser-output.v0";
const SCRIPT_AGENT_SCRIPT_OUTPUT_SCHEMA_VERSION = "script-agent.script-output.v0";
const SCRIPT_AGENT_TELEPROMPTER_SCHEMA_VERSION = "script-agent.teleprompter.v0";
const SCRIPT_AGENT_CAPTIONS_SCHEMA_VERSION = "script-agent.captions.v0";

function stampForId(date = new Date()) {
  return date.toISOString().replace(/[-:.]/g, "").replace("T", "-").replace("Z", "Z");
}

function createScriptAgentId(prefix, date = new Date()) {
  const safePrefix = String(prefix || "").trim();
  if (!safePrefix) throw new Error("script_agent_missing_id_prefix");
  return `${safePrefix}-${stampForId(date)}-${crypto.randomBytes(6).toString("hex")}`;
}

function validatePromptInputShape(promptInput) {
  const issues = [];
  if (!promptInput || typeof promptInput !== "object" || Array.isArray(promptInput)) {
    return [{ code: "invalid_prompt_input", message: "Prompt input must be an object." }];
  }
  if (promptInput.schemaVersion !== SCRIPT_AGENT_PROMPT_INPUT_SCHEMA_VERSION) {
    issues.push({
      code: "invalid_schema_version",
      message: `Expected schemaVersion ${SCRIPT_AGENT_PROMPT_INPUT_SCHEMA_VERSION}.`,
    });
  }
  if (!promptInput.promptInputId) {
    issues.push({ code: "missing_prompt_input_id", message: "Prompt input requires promptInputId." });
  }
  if (!promptInput.showRunId) issues.push({ code: "missing_show_run_id", message: "Prompt input requires showRunId." });
  if (!promptInput.situation || !promptInput.situation.situationId) {
    issues.push({ code: "missing_situation", message: "Prompt input requires a situation." });
  }
  if (!Array.isArray(promptInput.performerSlots)) {
    issues.push({ code: "missing_performer_slots", message: "Prompt input requires performerSlots array." });
  }
  return issues;
}

function validateScriptOutputShape(scriptOutput) {
  const issues = [];
  if (!scriptOutput || typeof scriptOutput !== "object" || Array.isArray(scriptOutput)) {
    return [{ code: "invalid_script_output", message: "Script output must be an object." }];
  }
  if (scriptOutput.schemaVersion !== SCRIPT_AGENT_SCRIPT_OUTPUT_SCHEMA_VERSION) {
    issues.push({
      code: "invalid_schema_version",
      message: `Expected schemaVersion ${SCRIPT_AGENT_SCRIPT_OUTPUT_SCHEMA_VERSION}.`,
    });
  }
  if (!scriptOutput.scriptId) issues.push({ code: "missing_script_id", message: "Script output requires scriptId." });
  if (!scriptOutput.promptInputId) {
    issues.push({ code: "missing_prompt_input_id", message: "Script output requires promptInputId." });
  }
  if (!scriptOutput.parserOutput) {
    issues.push({ code: "missing_parser_output", message: "Script output requires parserOutput." });
  }
  if (!scriptOutput.teleprompter) {
    issues.push({ code: "missing_teleprompter", message: "Script output requires teleprompter." });
  }
  if (!scriptOutput.captions) {
    issues.push({ code: "missing_captions", message: "Script output requires captions." });
  }
  return issues;
}

module.exports = {
  SCRIPT_AGENT_CAPTIONS_SCHEMA_VERSION,
  SCRIPT_AGENT_PARSER_OUTPUT_SCHEMA_VERSION,
  SCRIPT_AGENT_PROMPT_INPUT_SCHEMA_VERSION,
  SCRIPT_AGENT_SCRIPT_OUTPUT_SCHEMA_VERSION,
  SCRIPT_AGENT_TELEPROMPTER_SCHEMA_VERSION,
  createScriptAgentId,
  validatePromptInputShape,
  validateScriptOutputShape,
};
