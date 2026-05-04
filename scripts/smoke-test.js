#!/usr/bin/env node
"use strict";

const WebSocket = require("ws");

const DEFAULT_URL = process.env.FORYOU_BASE_URL || "http://127.0.0.1:3000";
const DEFAULT_TIMEOUT_MS = 3000;

function printHelp() {
  console.log(`For You smoke test

Usage:
  npm run smoke -- --url http://127.0.0.1:3310

Options:
  --url <url>                Base URL to test (default: ${DEFAULT_URL})
  --admin-password <value>   Also test /admin/login and /admin/state
  --join-token <token>       Also test /join and authenticated chat WebSocket
  --send-comment [text]      Send a test chat comment after joining
  --timeout-ms <ms>          Per-check timeout (default: ${DEFAULT_TIMEOUT_MS})
  --help                     Show this help

Environment:
  FORYOU_BASE_URL
  SMOKE_ADMIN_PASSWORD
  SMOKE_JOIN_TOKEN
`);
}

function parseArgs(argv) {
  const options = {
    url: DEFAULT_URL,
    adminPassword: process.env.SMOKE_ADMIN_PASSWORD || "",
    joinToken: process.env.SMOKE_JOIN_TOKEN || "",
    sendComment: false,
    commentText: "Codex smoke test",
    timeoutMs: DEFAULT_TIMEOUT_MS,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--help" || arg === "-h") {
      options.help = true;
      continue;
    }
    if (arg === "--url") {
      options.url = argv[++i] || options.url;
      continue;
    }
    if (arg === "--admin-password") {
      options.adminPassword = argv[++i] || "";
      continue;
    }
    if (arg === "--join-token") {
      options.joinToken = argv[++i] || "";
      continue;
    }
    if (arg === "--send-comment") {
      options.sendComment = true;
      const next = argv[i + 1] || "";
      if (next && !next.startsWith("--")) {
        options.commentText = next;
        i += 1;
      }
      continue;
    }
    if (arg === "--timeout-ms") {
      const parsed = Number.parseInt(argv[++i] || "", 10);
      if (Number.isFinite(parsed) && parsed >= 500) options.timeoutMs = parsed;
      continue;
    }
    throw new Error(`Unknown option: ${arg}`);
  }

  return options;
}

function normalizeBaseUrl(input) {
  const parsed = new URL(String(input || DEFAULT_URL));
  if (!/^https?:$/.test(parsed.protocol)) throw new Error("Base URL must start with http:// or https://");
  parsed.pathname = parsed.pathname.replace(/\/+$/, "");
  parsed.search = "";
  parsed.hash = "";
  return parsed;
}

function toWsUrl(baseUrl, pathAndQuery = "/") {
  const next = new URL(pathAndQuery, baseUrl);
  next.protocol = next.protocol === "https:" ? "wss:" : "ws:";
  return next.toString();
}

function timeoutPromise(label, timeoutMs) {
  return new Promise((_, reject) => {
    setTimeout(() => reject(new Error(`${label} timed out after ${timeoutMs}ms`)), timeoutMs).unref();
  });
}

async function withTimeout(label, timeoutMs, promise) {
  return Promise.race([promise, timeoutPromise(label, timeoutMs)]);
}

async function httpRequest(baseUrl, path, options = {}) {
  const url = new URL(path, baseUrl);
  const res = await fetch(url, {
    method: options.method || "GET",
    headers: options.headers || {},
    body: options.body,
    redirect: options.redirect || "follow",
  });
  return res;
}

async function readJson(res) {
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`Expected JSON, got: ${text.slice(0, 120)}`);
  }
}

function getSetCookieHeaders(headers) {
  if (headers && typeof headers.getSetCookie === "function") return headers.getSetCookie();
  const single = headers && typeof headers.get === "function" ? headers.get("set-cookie") : "";
  return single ? [single] : [];
}

function extractCookiePair(setCookieHeaders, cookieName) {
  for (const header of setCookieHeaders) {
    const first = String(header || "").split(";")[0];
    const eq = first.indexOf("=");
    if (eq <= 0) continue;
    if (first.slice(0, eq) === cookieName) return first;
  }
  return "";
}

async function checkHttpRoute(baseUrl, path, expectedStatus = 200) {
  const res = await httpRequest(baseUrl, path, { method: "HEAD" });
  if (res.status !== expectedStatus) {
    throw new Error(`${path} returned HTTP ${res.status}, expected ${expectedStatus}`);
  }
  return `HTTP ${res.status}`;
}

function openWs(url, options = {}) {
  return new WebSocket(url, options);
}

async function waitForWsMessage(ws, predicate, timeoutMs, label) {
  return withTimeout(
    label,
    timeoutMs,
    new Promise((resolve, reject) => {
      const onMessage = (data) => {
        let msg;
        try {
          msg = JSON.parse(String(data || "{}"));
        } catch (err) {
          cleanup();
          reject(err);
          return;
        }
        if (!predicate || predicate(msg)) {
          cleanup();
          resolve(msg);
        }
      };
      const onError = (err) => {
        cleanup();
        reject(err);
      };
      const cleanup = () => {
        ws.off("message", onMessage);
        ws.off("error", onError);
      };
      ws.on("message", onMessage);
      ws.on("error", onError);
    })
  );
}

async function waitForWsClose(ws, timeoutMs, label) {
  return withTimeout(
    label,
    timeoutMs,
    new Promise((resolve, reject) => {
      const messages = [];
      const onMessage = (data) => {
        try {
          messages.push(JSON.parse(String(data || "{}")));
        } catch {}
      };
      const onClose = (code, reason) => {
        cleanup();
        resolve({ code, reason: String(reason || ""), messages });
      };
      const onError = (err) => {
        cleanup();
        reject(err);
      };
      const cleanup = () => {
        ws.off("message", onMessage);
        ws.off("close", onClose);
        ws.off("error", onError);
      };
      ws.on("message", onMessage);
      ws.on("close", onClose);
      ws.on("error", onError);
    })
  );
}

async function checkStageWs(baseUrl, timeoutMs) {
  const ws = openWs(toWsUrl(baseUrl, "/?stage=1"));
  const msg = await waitForWsMessage(ws, (item) => item.type === "stage_hello", timeoutMs, "stage WebSocket");
  ws.close();
  const session = msg.stage && msg.stage.session ? msg.stage.session : {};
  return `session ${session.isActive ? "active" : "inactive"}`;
}

async function checkUnauthenticatedChatWs(baseUrl, timeoutMs) {
  const ws = openWs(toWsUrl(baseUrl, "/"));
  const result = await waitForWsClose(ws, timeoutMs, "unauthenticated chat WebSocket");
  const error = result.messages.find((msg) => msg && msg.type === "error");
  if (![4008, 4009].includes(Number(result.code))) {
    throw new Error(`Unexpected chat close code ${result.code}`);
  }
  if (!error || !["session_join_required", "session_inactive"].includes(String(error.code || ""))) {
    throw new Error("Chat rejection did not include the expected session access error");
  }
  return `${error.code} (${result.code})`;
}

async function checkAdmin(baseUrl, password, timeoutMs) {
  const loginRes = await withTimeout(
    "admin login",
    timeoutMs,
    httpRequest(baseUrl, "/admin/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password, rememberDevice: false }),
    })
  );
  const loginBody = await readJson(loginRes);
  if (!loginRes.ok || !loginBody.ok || !loginBody.token) {
    throw new Error(`Admin login failed: ${loginBody.error || loginRes.status}`);
  }

  const stateRes = await withTimeout(
    "admin state",
    timeoutMs,
    httpRequest(baseUrl, "/admin/state", {
      headers: { "x-admin-token": loginBody.token },
    })
  );
  const stateBody = await readJson(stateRes);
  if (!stateRes.ok || !stateBody.ok || !stateBody.session || !stateBody.stage) {
    throw new Error(`Admin state failed: ${stateBody.error || stateRes.status}`);
  }
  return `session ${stateBody.session.id}`;
}

async function getJoinCookie(baseUrl, token, timeoutMs) {
  const res = await withTimeout(
    "join token",
    timeoutMs,
    httpRequest(baseUrl, `/join?token=${encodeURIComponent(token)}`, { redirect: "manual" })
  );
  if (![302, 303].includes(res.status)) {
    const text = await res.text();
    throw new Error(`/join returned HTTP ${res.status}: ${text.slice(0, 120)}`);
  }
  const cookie = extractCookiePair(getSetCookieHeaders(res.headers), "session_access");
  if (!cookie) throw new Error("/join did not set a session_access cookie");
  return cookie;
}

async function checkJoinedChat(baseUrl, cookie, options) {
  const clientTag = `smoke-${Date.now().toString(36)}`;
  const ws = openWs(toWsUrl(baseUrl, "/"), {
    headers: { Cookie: cookie },
  });
  const hello = await waitForWsMessage(ws, (msg) => msg.type === "hello", options.timeoutMs, "joined chat hello");
  ws.send(JSON.stringify({ type: "register", clientTag, name: "Codex Smoke" }));
  ws.send(JSON.stringify({ type: "ping" }));
  await waitForWsMessage(ws, (msg) => msg.type === "pong", options.timeoutMs, "joined chat pong");

  let suffix = `session ${hello.sessionId}`;
  if (options.sendComment) {
    ws.send(
      JSON.stringify({
        type: "comment",
        clientTag,
        name: "Codex Smoke",
        text: options.commentText,
      })
    );
    const comment = await waitForWsMessage(
      ws,
      (msg) => msg.type === "comment" && msg.text === options.commentText,
      options.timeoutMs,
      "joined chat comment"
    );
    suffix += `, comment by ${comment.name}`;
  }

  ws.close();
  return suffix;
}

async function runCheck(results, name, fn) {
  try {
    const detail = await fn();
    results.push({ name, ok: true, detail: detail || "ok" });
  } catch (err) {
    results.push({ name, ok: false, detail: err && err.message ? err.message : String(err) });
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    printHelp();
    return;
  }

  const baseUrl = normalizeBaseUrl(options.url);
  const results = [];

  await runCheck(results, "health", async () => {
    const res = await withTimeout("health", options.timeoutMs, httpRequest(baseUrl, "/health"));
    const body = await readJson(res);
    if (!res.ok || !body.ok || !body.buildLabel) throw new Error(`Unexpected health response: ${res.status}`);
    return body.buildLabel;
  });
  await runCheck(results, "public page", () => checkHttpRoute(baseUrl, "/"));
  await runCheck(results, "admin page", () => checkHttpRoute(baseUrl, "/admin"));
  await runCheck(results, "stage page", () => checkHttpRoute(baseUrl, "/stage"));
  await runCheck(results, "stage WebSocket", () => checkStageWs(baseUrl, options.timeoutMs));
  await runCheck(results, "chat access guard", () => checkUnauthenticatedChatWs(baseUrl, options.timeoutMs));

  if (options.adminPassword) {
    await runCheck(results, "admin API", () => checkAdmin(baseUrl, options.adminPassword, options.timeoutMs));
  } else {
    results.push({ name: "admin API", ok: null, detail: "skipped (set SMOKE_ADMIN_PASSWORD or --admin-password)" });
  }

  if (options.joinToken) {
    let cookie = "";
    await runCheck(results, "join token", async () => {
      cookie = await getJoinCookie(baseUrl, options.joinToken, options.timeoutMs);
      return "session_access cookie set";
    });
    if (cookie) {
      await runCheck(results, "joined chat WebSocket", () => checkJoinedChat(baseUrl, cookie, options));
    }
  } else {
    results.push({ name: "join token", ok: null, detail: "skipped (set SMOKE_JOIN_TOKEN or --join-token)" });
    results.push({ name: "joined chat WebSocket", ok: null, detail: "skipped" });
  }

  for (const result of results) {
    const prefix = result.ok === true ? "OK" : result.ok === false ? "FAIL" : "SKIP";
    console.log(`${prefix} ${result.name}: ${result.detail}`);
  }

  if (results.some((result) => result.ok === false)) process.exitCode = 1;
}

main().catch((err) => {
  console.error(`FAIL smoke: ${err && err.message ? err.message : String(err)}`);
  process.exit(1);
});
