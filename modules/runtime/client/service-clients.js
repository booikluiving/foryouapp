"use strict";

const DEFAULT_CATALOG_BASE_URL = "http://127.0.0.1:3021";
const DEFAULT_PATHS_BASE_URL = "http://127.0.0.1:3022";
const DEFAULT_ALGORITHM_BASE_URL = "http://127.0.0.1:3023";
const DEFAULT_AUDIENCE_BASE_URL = "http://127.0.0.1:3026";

function catalogBaseUrl() {
  return String(process.env.V2_RUNTIME_CATALOG_URL || DEFAULT_CATALOG_BASE_URL).replace(/\/+$/, "");
}

function pathsBaseUrl() {
  return String(process.env.V2_RUNTIME_PATHS_URL || DEFAULT_PATHS_BASE_URL).replace(/\/+$/, "");
}

function algorithmBaseUrl() {
  return String(process.env.V2_RUNTIME_ALGORITHM_URL || DEFAULT_ALGORITHM_BASE_URL).replace(/\/+$/, "");
}

function audienceBaseUrl() {
  return String(process.env.V2_RUNTIME_AUDIENCE_URL || DEFAULT_AUDIENCE_BASE_URL).replace(/\/+$/, "");
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

async function fetchAlgorithmConfigSnapshot() {
  return fetchJson(`${algorithmBaseUrl()}/v0/algorithm/config-snapshot`);
}

async function evaluatePaths(playedSituationIds) {
  return fetchJson(`${pathsBaseUrl()}/v0/paths/evaluate`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ playedSituationIds: playedSituationIds || [] }),
  });
}

async function initializeAlgorithmScoringContext({ showRunId, runSnapshot, config }) {
  return fetchJson(`${algorithmBaseUrl()}/v0/algorithm/runs`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ showRunId, runSnapshot, config }),
  });
}

async function observeSituation(event) {
  return fetchJson(`${algorithmBaseUrl()}/v0/algorithm/events/situation-observed`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(event || {}),
  });
}

async function fetchAudienceAlgorithmInput({ showRunId, situationRunId }) {
  if (!showRunId) throw new Error("runtime_missing_show_run_id_for_audience_input");
  if (!situationRunId) throw new Error("runtime_missing_situation_run_id_for_audience_input");
  const query = new URLSearchParams({
    showRunId,
    situationRunId,
  });
  return fetchJson(`${audienceBaseUrl()}/v2/audience/algorithm-input?${query.toString()}`);
}

module.exports = {
  DEFAULT_ALGORITHM_BASE_URL,
  DEFAULT_AUDIENCE_BASE_URL,
  DEFAULT_CATALOG_BASE_URL,
  DEFAULT_PATHS_BASE_URL,
  algorithmBaseUrl,
  audienceBaseUrl,
  catalogBaseUrl,
  evaluatePaths,
  fetchAudienceAlgorithmInput,
  fetchAlgorithmConfigSnapshot,
  fetchCatalogSnapshot,
  fetchPathsSnapshot,
  initializeAlgorithmScoringContext,
  observeSituation,
  pathsBaseUrl,
};
