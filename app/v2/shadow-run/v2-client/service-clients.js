"use strict";

const DEFAULT_CATALOG_BASE_URL = "http://127.0.0.1:3021";
const DEFAULT_PATHS_BASE_URL = "http://127.0.0.1:3022";
const DEFAULT_RUNTIME_BASE_URL = "http://127.0.0.1:3024";

function baseUrl(envName, fallback) {
  return String(process.env[envName] || fallback).replace(/\/+$/, "");
}

async function fetchJson(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    signal: AbortSignal.timeout(Number(process.env.V2_SHADOW_FETCH_TIMEOUT_MS || 5000)),
  });
  const body = await response.json();
  if (!response.ok) throw new Error(`${url} returned ${response.status}: ${JSON.stringify(body)}`);
  return body;
}

async function fetchCatalogReadModel() {
  return fetchJson(`${baseUrl("V2_SHADOW_CATALOG_URL", DEFAULT_CATALOG_BASE_URL)}/v0/catalog/read-model`);
}

async function fetchPathsSnapshot() {
  return fetchJson(`${baseUrl("V2_SHADOW_PATHS_URL", DEFAULT_PATHS_BASE_URL)}/v0/paths/snapshot`);
}

async function evaluateV2Paths(playedSituationIds = []) {
  return fetchJson(`${baseUrl("V2_SHADOW_PATHS_URL", DEFAULT_PATHS_BASE_URL)}/v0/paths/evaluate`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ playedSituationIds }),
  });
}

async function startV2RuntimeRun() {
  return fetchJson(`${baseUrl("V2_SHADOW_RUNTIME_URL", DEFAULT_RUNTIME_BASE_URL)}/v0/runtime/runs/start`, {
    method: "POST",
  });
}

module.exports = {
  evaluateV2Paths,
  fetchCatalogReadModel,
  fetchPathsSnapshot,
  startV2RuntimeRun,
};
