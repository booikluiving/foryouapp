"use strict";

const fs = require("fs");
const http = require("http");
const https = require("https");
const path = require("path");

const DEFAULT_API_BASE_URL = "https://192.168.1.1/proxy/network/integration/v1";
const DEFAULT_TIMEOUT_MS = 5000;
const MAX_RESPONSE_BYTES = 4 * 1024 * 1024;
const UNIFI_ENV_KEYS = new Set([
  "UNIFI_AGENT_ENABLED",
  "UNIFI_API_BASE_URL",
  "UNIFI_API_KEY",
  "UNIFI_API_INSECURE_TLS",
  "UNIFI_API_TIMEOUT_MS",
  "UNIFI_CONSOLE_URL",
]);

class UnifiNetworkError extends Error {
  constructor(message, options = {}) {
    super(message);
    this.name = "UnifiNetworkError";
    this.code = String(options.code || message || "unifi_error");
    this.statusCode = Number(options.statusCode || 0) || 0;
    this.upstreamStatus = Number(options.upstreamStatus || 0) || 0;
    this.detail = options.detail || null;
  }
}

function clampInt(input, min, max, fallback) {
  const value = Number.parseInt(String(input || ""), 10);
  if (!Number.isFinite(value)) return fallback;
  return Math.max(min, Math.min(max, value));
}

function parseBooleanLike(input, fallback = false) {
  if (input === undefined || input === null || input === "") return fallback;
  const value = String(input).trim().toLowerCase();
  if (["1", "true", "yes", "y", "on", "ja"].includes(value)) return true;
  if (["0", "false", "no", "n", "off", "nee"].includes(value)) return false;
  return fallback;
}

function stripInlineEnvComment(value) {
  let quote = "";
  for (let i = 0; i < value.length; i += 1) {
    const ch = value[i];
    if ((ch === "\"" || ch === "'") && value[i - 1] !== "\\") {
      quote = quote === ch ? "" : quote || ch;
      continue;
    }
    if (ch === "#" && !quote && /\s/.test(value[i - 1] || "")) {
      return value.slice(0, i).trimEnd();
    }
  }
  return value.trim();
}

function unquoteEnvValue(value) {
  const trimmed = stripInlineEnvComment(String(value || "").trim());
  if (trimmed.length >= 2) {
    const first = trimmed[0];
    const last = trimmed[trimmed.length - 1];
    if ((first === "\"" && last === "\"") || (first === "'" && last === "'")) {
      const inner = trimmed.slice(1, -1);
      if (first === "\"") {
        return inner
          .replace(/\\n/g, "\n")
          .replace(/\\r/g, "\r")
          .replace(/\\t/g, "\t")
          .replace(/\\"/g, "\"")
          .replace(/\\\\/g, "\\");
      }
      return inner.replace(/\\'/g, "'");
    }
  }
  return trimmed;
}

function parseEnvFile(text) {
  const values = {};
  for (const rawLine of String(text || "").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const normalized = line.startsWith("export ") ? line.slice(7).trim() : line;
    const eq = normalized.indexOf("=");
    if (eq <= 0) continue;
    const key = normalized.slice(0, eq).trim();
    if (!UNIFI_ENV_KEYS.has(key)) continue;
    values[key] = unquoteEnvValue(normalized.slice(eq + 1));
  }
  return values;
}

function loadUnifiEnv(rootDir = process.cwd()) {
  const values = {};
  const loadedFiles = [];
  const explicitPath = String(process.env.UNIFI_ENV_PATH || "").trim();
  const candidates = explicitPath
    ? [explicitPath]
    : [path.join(rootDir, ".env"), path.join(rootDir, ".env.local")];

  for (const candidate of candidates) {
    if (!candidate) continue;
    try {
      if (!fs.existsSync(candidate)) continue;
      Object.assign(values, parseEnvFile(fs.readFileSync(candidate, "utf8")));
      loadedFiles.push(candidate);
    } catch {
      // A bad env file should not prevent the show app from booting.
    }
  }

  for (const key of UNIFI_ENV_KEYS) {
    if (process.env[key] !== undefined) values[key] = process.env[key];
  }

  return { values, loadedFiles };
}

function normalizeBaseUrl(input) {
  const raw = String(input || DEFAULT_API_BASE_URL).trim() || DEFAULT_API_BASE_URL;
  const parsed = new URL(raw);
  if (!/^https?:$/.test(parsed.protocol)) {
    throw new UnifiNetworkError("unifi_invalid_base_url", {
      code: "unifi_invalid_base_url",
      statusCode: 500,
      detail: "UNIFI_API_BASE_URL must start with http:// or https://",
    });
  }
  parsed.hash = "";
  parsed.search = "";
  if (!parsed.pathname.endsWith("/")) parsed.pathname += "/";
  return parsed.toString();
}

function deriveConsoleUrl(apiBaseUrl, configuredConsoleUrl) {
  const direct = String(configuredConsoleUrl || "").trim();
  if (direct) return direct;
  try {
    const parsed = new URL(apiBaseUrl);
    parsed.pathname = "/";
    parsed.search = "";
    parsed.hash = "";
    return parsed.toString().replace(/\/$/, "");
  } catch {
    return "https://192.168.1.1";
  }
}

function makeConfig(options = {}) {
  const rootDir = options.rootDir || process.cwd();
  const env = loadUnifiEnv(rootDir);
  const values = Object.assign({}, env.values, options.env || {});
  const apiBaseUrl = normalizeBaseUrl(options.apiBaseUrl || values.UNIFI_API_BASE_URL || DEFAULT_API_BASE_URL);
  const apiKey = String(options.apiKey || values.UNIFI_API_KEY || "").trim();
  const enabled = parseBooleanLike(
    options.enabled !== undefined ? options.enabled : values.UNIFI_AGENT_ENABLED,
    !!apiKey
  );
  const insecureTls = parseBooleanLike(
    options.insecureTls !== undefined ? options.insecureTls : values.UNIFI_API_INSECURE_TLS,
    true
  );
  const timeoutMs = clampInt(
    options.timeoutMs || values.UNIFI_API_TIMEOUT_MS || DEFAULT_TIMEOUT_MS,
    750,
    60000,
    DEFAULT_TIMEOUT_MS
  );

  return {
    enabled,
    apiBaseUrl,
    consoleUrl: deriveConsoleUrl(apiBaseUrl, options.consoleUrl || values.UNIFI_CONSOLE_URL),
    apiKey,
    insecureTls,
    timeoutMs,
    loadedEnvFiles: env.loadedFiles,
  };
}

function safeString(input, max = 160) {
  return String(input === undefined || input === null ? "" : input).trim().slice(0, max);
}

function pickFirst(obj, keys) {
  if (!obj || typeof obj !== "object") return "";
  for (const key of keys) {
    if (key.includes(".")) {
      const parts = key.split(".");
      let cursor = obj;
      for (const part of parts) {
        cursor = cursor && typeof cursor === "object" ? cursor[part] : undefined;
      }
      if (cursor !== undefined && cursor !== null && cursor !== "") return cursor;
      continue;
    }
    if (obj[key] !== undefined && obj[key] !== null && obj[key] !== "") return obj[key];
  }
  return "";
}

function normalizeCollection(body) {
  if (Array.isArray(body)) return body;
  if (!body || typeof body !== "object") return [];
  if (Array.isArray(body.data)) return body.data;
  if (body.data && typeof body.data === "object") {
    if (Array.isArray(body.data.data)) return body.data.data;
    if (Array.isArray(body.data.items)) return body.data.items;
    if (Array.isArray(body.data.results)) return body.data.results;
  }
  if (Array.isArray(body.items)) return body.items;
  if (Array.isArray(body.results)) return body.results;
  return [];
}

function normalizeCount(collectionResult) {
  if (!collectionResult || !collectionResult.ok) return 0;
  return Number(collectionResult.count || 0);
}

function summarizeSite(site) {
  const id = safeString(pickFirst(site, ["id", "siteId", "_id"]), 120);
  return {
    id,
    name: safeString(pickFirst(site, ["name", "desc", "meta.name", "meta.desc"]), 120) || id || "site",
    timezone: safeString(pickFirst(site, ["timezone", "meta.timezone"]), 80),
    permission: safeString(pickFirst(site, ["permission"]), 80),
    gatewayMac: safeString(pickFirst(site, ["gatewayMac", "meta.gatewayMac"]), 80),
  };
}

function summarizeDevice(device) {
  return {
    id: safeString(pickFirst(device, ["id", "deviceId", "_id", "macAddress", "mac"]), 120),
    name: safeString(pickFirst(device, ["name", "displayName", "hostname", "model", "shortname"]), 120),
    type: safeString(pickFirst(device, ["type", "category", "deviceType"]), 80),
    model: safeString(pickFirst(device, ["model", "shortname", "hardwareId"]), 80),
    ip: safeString(pickFirst(device, ["ipAddress", "ip", "lastIp"]), 80),
    mac: safeString(pickFirst(device, ["macAddress", "mac"]), 80),
    state: safeString(pickFirst(device, ["state", "status", "connectionState"]), 80),
  };
}

function summarizeClient(client) {
  const access = client && typeof client.access === "object" ? client.access : {};
  return {
    id: safeString(pickFirst(client, ["id", "clientId", "_id", "macAddress", "mac"]), 120),
    name: safeString(pickFirst(client, ["name", "displayName", "hostname", "deviceName"]), 120),
    type: safeString(pickFirst(client, ["type", "clientType"]), 80),
    ip: safeString(pickFirst(client, ["ipAddress", "ip", "lastIp"]), 80),
    mac: safeString(pickFirst(client, ["macAddress", "mac"]), 80),
    network: safeString(pickFirst(client, ["networkName", "network", "vlanName", "ssid"]), 120),
    authorized: access.authorized === undefined ? null : !!access.authorized,
  };
}

function summarizeNetwork(network) {
  return {
    id: safeString(pickFirst(network, ["id", "networkId", "_id"]), 120),
    name: safeString(pickFirst(network, ["name", "displayName", "purpose"]), 120),
    vlanId: pickFirst(network, ["vlanId", "vlan", "vlan_id"]) || null,
    subnet: safeString(pickFirst(network, ["subnet", "ipSubnet", "gatewayIp/subnet", "gatewayIp"]), 120),
    purpose: safeString(pickFirst(network, ["purpose", "type"]), 80),
    enabled: pickFirst(network, ["enabled", "isEnabled"]) === "" ? null : !!pickFirst(network, ["enabled", "isEnabled"]),
  };
}

function sanitizeError(err) {
  const code = String(err && (err.code || err.message) || "unifi_error");
  return {
    code,
    message: code,
    statusCode: Number(err && err.statusCode || 0) || 0,
    upstreamStatus: Number(err && err.upstreamStatus || 0) || 0,
    detail: err && err.detail ? err.detail : null,
  };
}

class UnifiNetworkAgent {
  constructor(options = {}) {
    this.config = makeConfig(options);
  }

  getConfigSummary() {
    return {
      enabled: !!this.config.enabled,
      configured: !!this.config.enabled && !!this.config.apiKey,
      hasApiKey: !!this.config.apiKey,
      apiBaseUrl: this.config.apiBaseUrl,
      consoleUrl: this.config.consoleUrl,
      timeoutMs: this.config.timeoutMs,
      insecureTls: !!this.config.insecureTls,
      loadedEnvFiles: this.config.loadedEnvFiles.map((file) => path.basename(file)),
      mode: "read-only",
    };
  }

  ensureConfigured() {
    if (!this.config.enabled) {
      throw new UnifiNetworkError("unifi_agent_disabled", {
        code: "unifi_agent_disabled",
        statusCode: 503,
      });
    }
    if (!this.config.apiKey) {
      throw new UnifiNetworkError("unifi_api_key_missing", {
        code: "unifi_api_key_missing",
        statusCode: 503,
      });
    }
  }

  buildUrl(endpoint) {
    const relative = String(endpoint || "").replace(/^\/+/, "");
    return new URL(relative, this.config.apiBaseUrl);
  }

  async requestJson(endpoint, options = {}) {
    this.ensureConfigured();
    const url = this.buildUrl(endpoint);
    const method = String(options.method || "GET").toUpperCase();
    if (method !== "GET") {
      throw new UnifiNetworkError("unifi_write_disabled", {
        code: "unifi_write_disabled",
        statusCode: 405,
      });
    }

    const body = await requestJsonWithNode(url, {
      method,
      apiKey: this.config.apiKey,
      timeoutMs: this.config.timeoutMs,
      insecureTls: this.config.insecureTls,
    });
    return body;
  }

  async fetchCollection(endpoint, summarizer) {
    try {
      const body = await this.requestJson(endpoint);
      const items = normalizeCollection(body);
      const summary = items.slice(0, 60).map(summarizer);
      return {
        ok: true,
        endpoint,
        count: items.length,
        items: summary,
      };
    } catch (err) {
      return {
        ok: false,
        endpoint,
        supported: ![404, 405].includes(Number(err && err.upstreamStatus || 0)),
        error: sanitizeError(err),
      };
    }
  }

  async getSnapshot() {
    const startedAt = Date.now();
    const sitesBody = await this.requestJson("/sites");
    const rawSites = normalizeCollection(sitesBody);
    const sites = rawSites.map(summarizeSite).filter((site) => site.id);

    const siteSnapshots = await Promise.all(
      sites.map(async (site) => {
        const siteId = encodeURIComponent(site.id);
        const [devices, clients, networks] = await Promise.all([
          this.fetchCollection(`/sites/${siteId}/devices`, summarizeDevice),
          this.fetchCollection(`/sites/${siteId}/clients`, summarizeClient),
          this.fetchCollection(`/sites/${siteId}/networks`, summarizeNetwork),
        ]);
        return {
          site,
          devices,
          clients,
          networks,
        };
      })
    );

    return {
      ok: true,
      mode: "read-only",
      checkedAt: new Date().toISOString(),
      durationMs: Date.now() - startedAt,
      agent: this.getConfigSummary(),
      totals: {
        sites: sites.length,
        devices: siteSnapshots.reduce((sum, item) => sum + normalizeCount(item.devices), 0),
        clients: siteSnapshots.reduce((sum, item) => sum + normalizeCount(item.clients), 0),
        networks: siteSnapshots.reduce((sum, item) => sum + normalizeCount(item.networks), 0),
      },
      sites: siteSnapshots,
    };
  }
}

function requestJsonWithNode(url, options) {
  return new Promise((resolve, reject) => {
    const isHttps = url.protocol === "https:";
    const transport = isHttps ? https : http;
    const req = transport.request(
      {
        protocol: url.protocol,
        hostname: url.hostname,
        port: url.port || (isHttps ? 443 : 80),
        path: `${url.pathname}${url.search}`,
        method: options.method || "GET",
        rejectUnauthorized: isHttps ? !options.insecureTls : undefined,
        timeout: options.timeoutMs,
        headers: {
          Accept: "application/json",
          "X-API-Key": options.apiKey,
          "User-Agent": "For_You-Network-Agent/0.1",
        },
      },
      (res) => {
        const chunks = [];
        let size = 0;
        res.on("data", (chunk) => {
          size += chunk.length;
          if (size > MAX_RESPONSE_BYTES) {
            req.destroy(new Error("unifi_response_too_large"));
            return;
          }
          chunks.push(chunk);
        });
        res.on("end", () => {
          const text = Buffer.concat(chunks).toString("utf8");
          let body = {};
          if (text.trim()) {
            try {
              body = JSON.parse(text);
            } catch {
              body = { raw: text.slice(0, 800) };
            }
          }

          const status = Number(res.statusCode || 0);
          if (status < 200 || status >= 300) {
            reject(new UnifiNetworkError("unifi_http_error", {
              code: status === 401 || status === 403 ? "unifi_auth_failed" : "unifi_http_error",
              statusCode: 502,
              upstreamStatus: status,
              detail: body && typeof body === "object" ? body : null,
            }));
            return;
          }
          resolve(body);
        });
      }
    );

    req.on("timeout", () => {
      req.destroy(new UnifiNetworkError("unifi_timeout", {
        code: "unifi_timeout",
        statusCode: 504,
      }));
    });
    req.on("error", (err) => {
      if (err instanceof UnifiNetworkError) {
        reject(err);
        return;
      }
      reject(new UnifiNetworkError("unifi_connection_failed", {
        code: "unifi_connection_failed",
        statusCode: 502,
        detail: err && err.message ? err.message : String(err || "unknown"),
      }));
    });
    req.end();
  });
}

function createUnifiNetworkAgent(options = {}) {
  return new UnifiNetworkAgent(options);
}

module.exports = {
  DEFAULT_API_BASE_URL,
  UnifiNetworkAgent,
  UnifiNetworkError,
  createUnifiNetworkAgent,
  loadUnifiEnv,
};
