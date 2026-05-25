"use strict";

const GATEWAY_STATUS_SCHEMA_VERSION = "gateway.status.v0";
const GATEWAY_ROUTE_SCHEMA_VERSION = "gateway.routes.v0";

const GATEWAY_SERVICE_KEYS = Object.freeze([
  "catalog",
  "paths",
  "algorithm",
  "runtime",
  "showControl",
  "audience",
  "scriptAgent",
]);

function validateGatewayStatusShape(status) {
  const issues = [];
  if (!status || typeof status !== "object" || Array.isArray(status)) {
    return [{ code: "invalid_gateway_status", message: "Gateway status must be an object." }];
  }
  if (status.schemaVersion !== GATEWAY_STATUS_SCHEMA_VERSION) {
    issues.push({ code: "invalid_schema_version", message: `Expected ${GATEWAY_STATUS_SCHEMA_VERSION}.` });
  }
  if (!Array.isArray(status.services)) {
    issues.push({ code: "missing_services", message: "Gateway status requires services array." });
  }
  return issues;
}

module.exports = {
  GATEWAY_ROUTE_SCHEMA_VERSION,
  GATEWAY_SERVICE_KEYS,
  GATEWAY_STATUS_SCHEMA_VERSION,
  validateGatewayStatusShape,
};
