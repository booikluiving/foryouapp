"use strict";

const crypto = require("node:crypto");

const AUDIENCE_SIGNAL_SCHEMA_VERSION = "audience.signal.v0";
const AUDIENCE_ALGORITHM_INPUT_SCHEMA_VERSION = "audience.algorithm-input.v0";
const AUDIENCE_SESSION_SCHEMA_VERSION = "audience.session.v0";
const AUDIENCE_SIGNAL_TYPES = Object.freeze(["heart", "bored", "chat"]);

function stampForId(date = new Date()) {
  return date.toISOString().replace(/[-:.]/g, "").replace("T", "-").replace("Z", "Z");
}

function createAudienceSignalId(date = new Date()) {
  return `audience-signal-${stampForId(date)}-${crypto.randomBytes(6).toString("hex")}`;
}

function createAudienceSessionId(date = new Date()) {
  return `audience-session-${stampForId(date)}-${crypto.randomBytes(4).toString("hex")}`;
}

function validateAudienceSignalShape(signal) {
  const issues = [];
  if (!signal || typeof signal !== "object" || Array.isArray(signal)) {
    return [{ code: "invalid_audience_signal", message: "Audience signal must be an object." }];
  }
  if (signal.schemaVersion !== AUDIENCE_SIGNAL_SCHEMA_VERSION) {
    issues.push({
      code: "invalid_schema_version",
      message: `Expected schemaVersion ${AUDIENCE_SIGNAL_SCHEMA_VERSION}.`,
    });
  }
  if (!signal.signalId) issues.push({ code: "missing_signal_id", message: "Audience signal requires signalId." });
  if (!AUDIENCE_SIGNAL_TYPES.includes(signal.type)) {
    issues.push({ code: "invalid_signal_type", message: "Audience signal type must be heart, bored or chat." });
  }
  if (!signal.link || typeof signal.link !== "object") {
    issues.push({ code: "missing_runtime_link", message: "Audience signal requires a Runtime link object." });
  }
  return issues;
}

function validateAudienceAlgorithmInputShape(input) {
  const issues = [];
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return [{ code: "invalid_audience_algorithm_input", message: "Algorithm input must be an object." }];
  }
  if (input.schemaVersion !== AUDIENCE_ALGORITHM_INPUT_SCHEMA_VERSION) {
    issues.push({
      code: "invalid_schema_version",
      message: `Expected schemaVersion ${AUDIENCE_ALGORITHM_INPUT_SCHEMA_VERSION}.`,
    });
  }
  if (!input.showRunId) issues.push({ code: "missing_show_run_id", message: "Algorithm input requires showRunId." });
  if (!input.situationRunId) {
    issues.push({ code: "missing_situation_run_id", message: "Algorithm input requires situationRunId." });
  }
  if (!input.chatAppSignals || typeof input.chatAppSignals !== "object") {
    issues.push({ code: "missing_chat_app_signals", message: "Algorithm input requires chatAppSignals." });
  }
  return issues;
}

module.exports = {
  AUDIENCE_ALGORITHM_INPUT_SCHEMA_VERSION,
  AUDIENCE_SESSION_SCHEMA_VERSION,
  AUDIENCE_SIGNAL_SCHEMA_VERSION,
  AUDIENCE_SIGNAL_TYPES,
  createAudienceSessionId,
  createAudienceSignalId,
  validateAudienceAlgorithmInputShape,
  validateAudienceSignalShape,
};
