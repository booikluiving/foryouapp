"use strict";

const { buildCatalogReadModel } = require("../../catalog/read-model/build-read-model");

const DEFAULT_CATALOG_BASE_URL = "http://127.0.0.1:3021";

function catalogBaseUrl() {
  return String(process.env.V2_SCRIPT_AGENT_CATALOG_URL || DEFAULT_CATALOG_BASE_URL).replace(/\/+$/, "");
}

async function fetchCatalogSnapshot() {
  const url = `${catalogBaseUrl()}/v0/catalog/read-model`;
  let remoteError = "";
  try {
    const response = await fetch(url);
    const body = await response.json();
    if (!response.ok) {
      remoteError = `${url} returned ${response.status}: ${JSON.stringify(body)}`;
    } else {
      return { ok: true, catalog: body, source: "remote-catalog-service" };
    }
  } catch (err) {
    remoteError = err && err.message ? String(err.message) : "catalog_unavailable";
  }

  try {
    const catalog = await buildCatalogReadModel();
    return {
      ok: true,
      catalog,
      source: "local-catalog-read-model",
      warning: remoteError,
    };
  } catch (err) {
    const localError = err && err.message ? String(err.message) : "local_catalog_unavailable";
    return {
      ok: false,
      catalog: null,
      error: `${remoteError}; local fallback failed: ${localError}`,
    };
  }
}

module.exports = {
  DEFAULT_CATALOG_BASE_URL,
  catalogBaseUrl,
  fetchCatalogSnapshot,
};
