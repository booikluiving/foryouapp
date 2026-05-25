"use strict";

const DEFAULT_RUNTIME_BASE_URL = "http://127.0.0.1:3024";

function runtimeBaseUrl() {
  return String(process.env.V2_SCRIPT_AGENT_RUNTIME_URL || DEFAULT_RUNTIME_BASE_URL).replace(/\/+$/, "");
}

async function fetchCurrentRuntimeState() {
  const url = `${runtimeBaseUrl()}/v0/runtime/runs/current`;
  try {
    const response = await fetch(url);
    const body = await response.json();
    if (!response.ok) {
      return { ok: false, state: null, error: `${url} returned ${response.status}: ${JSON.stringify(body)}` };
    }
    return { ok: true, state: body };
  } catch (err) {
    return { ok: false, state: null, error: err && err.message ? String(err.message) : "runtime_unavailable" };
  }
}

module.exports = {
  DEFAULT_RUNTIME_BASE_URL,
  fetchCurrentRuntimeState,
  runtimeBaseUrl,
};
