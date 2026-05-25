"use strict";

const DEFAULT_CATALOG_BASE_URL = "http://127.0.0.1:3021";
const DEFAULT_PATHS_BASE_URL = "http://127.0.0.1:3022";

function catalogBaseUrl() {
  return String(process.env.V2_RUNTIME_CATALOG_URL || DEFAULT_CATALOG_BASE_URL).replace(/\/+$/, "");
}

function pathsBaseUrl() {
  return String(process.env.V2_RUNTIME_PATHS_URL || DEFAULT_PATHS_BASE_URL).replace(/\/+$/, "");
}

async function fetchJson(url, options) {
  const response = await fetch(url, options);
  const body = await response.json();
  if (!response.ok) {
    throw new Error(`${url} returned ${response.status}: ${JSON.stringify(body)}`);
  }
  return body;
}

async function fetchCatalogSnapshot() {
  return fetchJson(`${catalogBaseUrl()}/v0/catalog/read-model`);
}

async function fetchPathsSnapshot() {
  return fetchJson(`${pathsBaseUrl()}/v0/paths/snapshot`);
}

async function evaluatePaths(playedSituationIds) {
  return fetchJson(`${pathsBaseUrl()}/v0/paths/evaluate`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ playedSituationIds: playedSituationIds || [] }),
  });
}

module.exports = {
  DEFAULT_CATALOG_BASE_URL,
  DEFAULT_PATHS_BASE_URL,
  catalogBaseUrl,
  evaluatePaths,
  fetchCatalogSnapshot,
  fetchPathsSnapshot,
  pathsBaseUrl,
};
