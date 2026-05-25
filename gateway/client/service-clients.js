"use strict";

const {
  GATEWAY_ROUTE_SCHEMA_VERSION,
  GATEWAY_SERVICE_KEYS,
  GATEWAY_STATUS_SCHEMA_VERSION,
} = require("../../shared/contracts/gateway-v0");

const SERVICE_DEFINITIONS = Object.freeze({
  catalog: { key: "catalog", label: "Catalog", env: "V2_GATEWAY_CATALOG_URL", defaultBaseUrl: "http://127.0.0.1:3021" },
  paths: { key: "paths", label: "Paths", env: "V2_GATEWAY_PATHS_URL", defaultBaseUrl: "http://127.0.0.1:3022" },
  algorithm: { key: "algorithm", label: "Algorithm", env: "V2_GATEWAY_ALGORITHM_URL", defaultBaseUrl: "http://127.0.0.1:3023" },
  runtime: { key: "runtime", label: "Runtime", env: "V2_GATEWAY_RUNTIME_URL", defaultBaseUrl: "http://127.0.0.1:3024" },
  showControl: { key: "showControl", label: "Show Control", env: "V2_GATEWAY_SHOW_CONTROL_URL", defaultBaseUrl: "http://127.0.0.1:3025" },
  audience: { key: "audience", label: "Audience", env: "V2_GATEWAY_AUDIENCE_URL", defaultBaseUrl: "http://127.0.0.1:3026" },
  scriptAgent: { key: "scriptAgent", label: "Script Agent", env: "V2_GATEWAY_SCRIPT_AGENT_URL", defaultBaseUrl: "http://127.0.0.1:3027" },
});

function serviceBaseUrl(serviceKey) {
  const definition = SERVICE_DEFINITIONS[serviceKey];
  if (!definition) throw new Error(`gateway_unknown_service:${serviceKey}`);
  return String(process.env[definition.env] || definition.defaultBaseUrl).replace(/\/+$/, "");
}

async function fetchJson(url, options = {}, fetchImpl = fetch) {
  const response = await fetchImpl(url, options);
  const text = await response.text();
  const body = text ? JSON.parse(text) : null;
  if (!response.ok) throw new Error(`${url} returned ${response.status}: ${JSON.stringify(body)}`);
  return body;
}

async function fetchServiceHealth(serviceKey, fetchImpl = fetch) {
  const definition = SERVICE_DEFINITIONS[serviceKey];
  const url = `${serviceBaseUrl(serviceKey)}/health`;
  try {
    const health = await fetchJson(url, {}, fetchImpl);
    return {
      key: serviceKey,
      label: definition.label,
      ok: !!health.ok,
      service: health.service || serviceKey,
      version: health.version || null,
      port: health.port || null,
      baseUrl: serviceBaseUrl(serviceKey),
      health,
    };
  } catch (err) {
    return {
      key: serviceKey,
      label: definition.label,
      ok: false,
      service: serviceKey,
      version: null,
      port: null,
      baseUrl: serviceBaseUrl(serviceKey),
      error: err && err.message ? String(err.message) : "health_unavailable",
    };
  }
}

async function buildGatewayStatus(fetchImpl = fetch) {
  const services = await Promise.all(GATEWAY_SERVICE_KEYS.map((key) => fetchServiceHealth(key, fetchImpl)));
  return {
    schemaVersion: GATEWAY_STATUS_SCHEMA_VERSION,
    service: "gateway",
    generatedAt: new Date().toISOString(),
    ok: services.every((item) => item.ok),
    services,
  };
}

function routeManifest() {
  return {
    schemaVersion: GATEWAY_ROUTE_SCHEMA_VERSION,
    service: "gateway",
    routes: [
      { method: "GET", path: "/v0/gateway/status", forwardsTo: "module health endpoints" },
      { method: "POST", path: "/v0/gateway/runtime/runs/start", forwardsTo: "runtime:/v0/runtime/runs/start" },
      { method: "POST", path: "/v0/gateway/runtime/runs/:showRunId/start-situation", forwardsTo: "runtime:/v0/runtime/runs/:showRunId/start-situation" },
      { method: "POST", path: "/v0/gateway/runtime/runs/:showRunId/stop-situation", forwardsTo: "runtime:/v0/runtime/runs/:showRunId/stop-situation" },
      { method: "POST", path: "/v0/gateway/show-control/cues/prepare", forwardsTo: "show-control:/v0/show-control/cues/prepare" },
      { method: "POST", path: "/v0/gateway/show-control/cues/go", forwardsTo: "show-control:/v0/show-control/cues/go" },
    ],
  };
}

async function forwardJson(serviceKey, pathname, options = {}, fetchImpl = fetch) {
  return fetchJson(`${serviceBaseUrl(serviceKey)}${pathname}`, {
    method: options.method || "GET",
    headers: {
      "content-type": "application/json",
      ...(options.headers || {}),
    },
    body: options.body == null ? undefined : JSON.stringify(options.body),
  }, fetchImpl);
}

module.exports = {
  SERVICE_DEFINITIONS,
  buildGatewayStatus,
  fetchJson,
  fetchServiceHealth,
  forwardJson,
  routeManifest,
  serviceBaseUrl,
};
