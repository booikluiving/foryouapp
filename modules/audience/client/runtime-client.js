"use strict";

const DEFAULT_RUNTIME_BASE_URL = "http://127.0.0.1:3024";
const DEFAULT_ALGORITHM_BASE_URL = "http://127.0.0.1:3023";

function runtimeBaseUrl() {
  return String(process.env.V2_AUDIENCE_RUNTIME_URL || DEFAULT_RUNTIME_BASE_URL).replace(/\/+$/, "");
}

function algorithmBaseUrl() {
  return String(process.env.V2_AUDIENCE_ALGORITHM_URL || DEFAULT_ALGORITHM_BASE_URL).replace(/\/+$/, "");
}

async function fetchJsonWithTimeout(url, options = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => {
    try {
      controller.abort();
    } catch {}
  }, Number(process.env.V2_AUDIENCE_SERVICE_TIMEOUT_MS || process.env.V2_AUDIENCE_RUNTIME_TIMEOUT_MS || 1500));
  try {
    const response = await fetch(url, { ...options, signal: controller.signal });
    const body = await response.json();
    if (!response.ok) {
      throw new Error(`${url} returned ${response.status}: ${JSON.stringify(body)}`);
    }
    return body;
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchCurrentRuntimeState() {
  const url = `${runtimeBaseUrl()}/v0/runtime/runs/current`;
  const controller = new AbortController();
  const timeout = setTimeout(() => {
    try {
      controller.abort();
    } catch {}
  }, Number(process.env.V2_AUDIENCE_RUNTIME_TIMEOUT_MS || 1500));
  try {
    const response = await fetch(url, { signal: controller.signal });
    const body = await response.json();
    if (!response.ok) {
      return { ok: false, state: null, error: `${url} returned ${response.status}: ${JSON.stringify(body)}` };
    }
    return { ok: true, state: body };
  } catch (err) {
    return { ok: false, state: null, error: err && err.message ? String(err.message) : "runtime_unavailable" };
  } finally {
    clearTimeout(timeout);
  }
}

async function sendAudienceSignalsToAlgorithm(input = {}) {
  return fetchJsonWithTimeout(`${algorithmBaseUrl()}/v0/algorithm/events/audience-signals`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input || {}),
  });
}

async function sendScoreFeedToRuntime({ showRunId, scoreFeed, source = "audience_live_algorithm" } = {}) {
  if (!showRunId) throw new Error("audience_missing_show_run_id_for_runtime_scores");
  return fetchJsonWithTimeout(`${runtimeBaseUrl()}/v0/runtime/runs/${encodeURIComponent(showRunId)}/scores`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ source, scoreFeed }),
  });
}

async function restoreRuntimeAlgorithmContext({ showRunId, reason = "audience_live_missing_algorithm_context" } = {}) {
  if (!showRunId) throw new Error("audience_missing_show_run_id_for_runtime_algorithm_context_restore");
  return fetchJsonWithTimeout(`${runtimeBaseUrl()}/v0/runtime/runs/${encodeURIComponent(showRunId)}/algorithm-context/restore`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ reason }),
  });
}

module.exports = {
  DEFAULT_ALGORITHM_BASE_URL,
  DEFAULT_RUNTIME_BASE_URL,
  algorithmBaseUrl,
  fetchCurrentRuntimeState,
  restoreRuntimeAlgorithmContext,
  sendAudienceSignalsToAlgorithm,
  sendScoreFeedToRuntime,
  runtimeBaseUrl,
};
