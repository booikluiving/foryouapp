"use strict";

// Padendienst: alleen de kaart van het universum voor de publiekstelefoon.

const DEFAULT_PATHS_BASE_URL = "http://127.0.0.1:3022";

function pathsBaseUrl() {
  return String(process.env.AUDIENCE_PATHS_URL || DEFAULT_PATHS_BASE_URL).replace(/\/+$/, "");
}

async function fetchTelefoonKaart(timeoutMs = 8000) {
  const response = await fetch(`${pathsBaseUrl()}/v0/paths/telefoon-kaart`, {
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!response.ok) return null;
  return response.json();
}

module.exports = { fetchTelefoonKaart, pathsBaseUrl, DEFAULT_PATHS_BASE_URL };
