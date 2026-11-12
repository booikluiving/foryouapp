"use strict";

const DEFAULT_RUNTIME_BASE_URL = "http://127.0.0.1:3024";
const DEFAULT_ALGORITHM_BASE_URL = "http://127.0.0.1:3023";

function runtimeBaseUrl() {
  return String(process.env.AUDIENCE_RUNTIME_URL || DEFAULT_RUNTIME_BASE_URL).replace(/\/+$/, "");
}

function algorithmBaseUrl() {
  return String(process.env.AUDIENCE_ALGORITHM_URL || DEFAULT_ALGORITHM_BASE_URL).replace(/\/+$/, "");
}

async function fetchJsonWithTimeout(url, options = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => {
    try {
      controller.abort();
    } catch {}
  }, Number(process.env.AUDIENCE_SERVICE_TIMEOUT_MS || process.env.AUDIENCE_RUNTIME_TIMEOUT_MS || 1500));
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
  }, Number(process.env.AUDIENCE_RUNTIME_TIMEOUT_MS || 1500));
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

// Kleine weergave van de huidige run (alleen voor de fase: loopt er een situatie?).
async function fetchRuntimeView() {
  const url = `${runtimeBaseUrl()}/v0/runtime/runs/current/view`;
  const controller = new AbortController();
  const timeout = setTimeout(() => {
    try {
      controller.abort();
    } catch {}
  }, Number(process.env.AUDIENCE_RUNTIME_TIMEOUT_MS || 1500));
  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) return { ok: false, state: null, error: `${url} returned ${response.status}` };
    return { ok: true, state: await response.json() };
  } catch (err) {
    return { ok: false, state: null, error: err && err.message ? String(err.message) : "runtime_unavailable" };
  } finally {
    clearTimeout(timeout);
  }
}

function showControlBaseUrl() {
  return String(process.env.AUDIENCE_SHOW_CONTROL_URL || "http://127.0.0.1:3025").replace(/\/+$/, "");
}

async function postJsonRuim(url, body, timeoutMs = 8000) {
  const controller = new AbortController();
  const timeout = setTimeout(() => {
    try { controller.abort(); } catch {}
  }, timeoutMs);
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body || {}),
      signal: controller.signal,
    });
    const json = await response.json().catch(() => null);
    if (!response.ok) throw new Error(`${url} returned ${response.status}`);
    return json;
  } finally {
    clearTimeout(timeout);
  }
}

// De winnaar van de stemming klaarzetten: eerst in de runtime, daarna via show control in
// TouchDesigner, de teleprompter en de operator.
async function prepareChosenSituation({ showRunId, situationId } = {}) {
  if (!showRunId || !situationId) throw new Error("audience_missing_prepare_input");
  const state = await postJsonRuim(
    `${runtimeBaseUrl()}/v0/runtime/runs/${encodeURIComponent(showRunId)}/prepare-situation`,
    { situationId }
  );
  let showControl = true;
  try {
    await postJsonRuim(`${showControlBaseUrl()}/v0/show-control/cues/prepare`, { runtimeState: state });
  } catch (_err) {
    showControl = false;
  }
  return { ok: true, showControl, state };
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
  fetchRuntimeView,
  prepareChosenSituation,
  restoreRuntimeAlgorithmContext,
  sendAudienceSignalsToAlgorithm,
  sendScoreFeedToRuntime,
  runtimeBaseUrl,
};
