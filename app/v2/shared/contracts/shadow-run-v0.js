"use strict";

const crypto = require("node:crypto");

const SHADOW_RUN_REPORT_SCHEMA_VERSION = "shadow-run.report.v0";

function stampForId(date = new Date()) {
  return date.toISOString().replace(/[-:.]/g, "").replace("T", "-").replace("Z", "Z");
}

function createShadowRunId(date = new Date()) {
  return `shadow-run-${stampForId(date)}-${crypto.randomBytes(6).toString("hex")}`;
}

function validateShadowRunReportShape(report) {
  const issues = [];
  if (!report || typeof report !== "object" || Array.isArray(report)) {
    return [{ code: "invalid_shadow_report", message: "Shadow report must be an object." }];
  }
  if (report.schemaVersion !== SHADOW_RUN_REPORT_SCHEMA_VERSION) {
    issues.push({ code: "invalid_schema_version", message: `Expected ${SHADOW_RUN_REPORT_SCHEMA_VERSION}.` });
  }
  if (!report.shadowRunId) issues.push({ code: "missing_shadow_run_id", message: "Report requires shadowRunId." });
  if (!report.v1 || !report.v2) issues.push({ code: "missing_sides", message: "Report requires v1 and v2 sections." });
  if (!report.comparison) issues.push({ code: "missing_comparison", message: "Report requires comparison." });
  return issues;
}

module.exports = {
  SHADOW_RUN_REPORT_SCHEMA_VERSION,
  createShadowRunId,
  validateShadowRunReportShape,
};
