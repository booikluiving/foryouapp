"use strict";

function joinUrl(baseUrl, pathname) {
  return `${String(baseUrl || "").replace(/\/+$/, "")}${pathname.startsWith("/") ? pathname : `/${pathname}`}`;
}

async function fetchJson(url, options = {}) {
  const timeoutMs = Number(options.timeoutMs || 1500);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      method: options.method || "GET",
      headers: options.body === undefined ? options.headers : {
        "content-type": "application/json",
        ...(options.headers || {}),
      },
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      signal: controller.signal,
    });
    const text = await response.text();
    let body = {};
    try {
      body = text ? JSON.parse(text) : {};
    } catch (_err) {
      body = { raw: text };
    }
    if (!response.ok) {
      const detail = body && (body.message || body.error) ? body.message || body.error : JSON.stringify(body);
      throw new Error(`${url} returned ${response.status}: ${detail}`);
    }
    return { status: response.status, body };
  } finally {
    clearTimeout(timeout);
  }
}

module.exports = {
  fetchJson,
  joinUrl,
};
