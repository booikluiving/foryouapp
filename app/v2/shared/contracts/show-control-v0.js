"use strict";

const crypto = require("node:crypto");

const SHOW_CONTROL_CUE_SCHEMA_VERSION = "show-control.cue.v0";
const SHOW_CONTROL_ACK_SCHEMA_VERSION = "show-control.ack.v0";
const SHOW_CONTROL_STATUS_SCHEMA_VERSION = "show-control.status.v0";
const CUE_TYPES = Object.freeze(["prepare", "go", "pulse", "reset", "panic", "status", "compound"]);
const ACK_MODES = Object.freeze(["fire-and-forget", "acknowledged", "required-ready"]);

function stampForId(date = new Date()) {
  return date.toISOString().replace(/[-:.]/g, "").replace("T", "-").replace("Z", "Z");
}

function createShowControlId(prefix, date = new Date()) {
  const safePrefix = String(prefix || "").trim();
  if (!safePrefix) throw new Error("show_control_missing_id_prefix");
  return `${safePrefix}-${stampForId(date)}-${crypto.randomBytes(6).toString("hex")}`;
}

function validateCueShape(cue) {
  const issues = [];
  if (!cue || typeof cue !== "object" || Array.isArray(cue)) {
    return [{ code: "invalid_cue", message: "Cue must be an object." }];
  }
  if (cue.schemaVersion !== SHOW_CONTROL_CUE_SCHEMA_VERSION) {
    issues.push({ code: "invalid_schema_version", message: `Expected ${SHOW_CONTROL_CUE_SCHEMA_VERSION}.` });
  }
  if (!cue.cueId) issues.push({ code: "missing_cue_id", message: "Cue requires cueId." });
  if (!CUE_TYPES.includes(cue.cueType)) issues.push({ code: "invalid_cue_type", message: "Invalid cue type." });
  if (!Array.isArray(cue.actions)) issues.push({ code: "missing_actions", message: "Cue requires actions." });
  return issues;
}

function validateAckShape(ack) {
  const issues = [];
  if (!ack || typeof ack !== "object" || Array.isArray(ack)) {
    return [{ code: "invalid_ack", message: "Ack must be an object." }];
  }
  if (ack.schemaVersion !== SHOW_CONTROL_ACK_SCHEMA_VERSION) {
    issues.push({ code: "invalid_schema_version", message: `Expected ${SHOW_CONTROL_ACK_SCHEMA_VERSION}.` });
  }
  if (!ack.cueId) issues.push({ code: "missing_cue_id", message: "Ack requires cueId." });
  if (!ack.actionId) issues.push({ code: "missing_action_id", message: "Ack requires actionId." });
  if (!ack.targetId) issues.push({ code: "missing_target_id", message: "Ack requires targetId." });
  return issues;
}

module.exports = {
  ACK_MODES,
  CUE_TYPES,
  SHOW_CONTROL_ACK_SCHEMA_VERSION,
  SHOW_CONTROL_CUE_SCHEMA_VERSION,
  SHOW_CONTROL_STATUS_SCHEMA_VERSION,
  createShowControlId,
  validateAckShape,
  validateCueShape,
};
