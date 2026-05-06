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
  --algorithm-flow           Create a temporary algorithm catalog and test a scene run
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
    algorithmFlow: process.env.SMOKE_ALGORITHM_FLOW === "1",
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
    if (arg === "--algorithm-flow") {
      options.algorithmFlow = true;
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

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
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

async function loginAdmin(baseUrl, password, timeoutMs) {
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
  return loginBody.token;
}

async function checkAdmin(baseUrl, password, timeoutMs) {
  const adminToken = await loginAdmin(baseUrl, password, timeoutMs);

  const stateRes = await withTimeout(
    "admin state",
    timeoutMs,
    httpRequest(baseUrl, "/admin/state", {
      headers: { "x-admin-token": adminToken },
    })
  );
  const stateBody = await readJson(stateRes);
  if (!stateRes.ok || !stateBody.ok || !stateBody.session || !stateBody.stage) {
    throw new Error(`Admin state failed: ${stateBody.error || stateRes.status}`);
  }
  return `session ${stateBody.session.id}`;
}

async function checkAlgorithmState(baseUrl, password, timeoutMs) {
  const adminToken = await loginAdmin(baseUrl, password, timeoutMs);
  const res = await withTimeout(
    "algorithm state",
    timeoutMs,
    httpRequest(baseUrl, "/admin/algorithm/state", {
      headers: { "x-admin-token": adminToken },
    })
  );
  const body = await readJson(res);
  if (!res.ok || !body.ok || !body.settings || !body.catalog || !body.recommendation) {
    throw new Error(`Algorithm state failed: ${body.error || res.status}`);
  }
  return `calibration ${body.settings.calibrationCount}`;
}

async function adminJson(baseUrl, path, adminToken, body, timeoutMs) {
  const res = await withTimeout(
    path,
    timeoutMs,
    httpRequest(baseUrl, path, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-admin-token": adminToken,
      },
      body: JSON.stringify(body || {}),
    })
  );
  const json = await readJson(res);
  if (!res.ok || !json.ok) throw new Error(`${path} failed: ${json.error || res.status}`);
  return json;
}

async function checkAlgorithmFlow(baseUrl, password, timeoutMs) {
  const adminToken = await loginAdmin(baseUrl, password, timeoutMs);
  const suffix = Date.now().toString(36);
  const created = { character: [], situation: [], environment: [], scene: [] };

  const initialStateRes = await httpRequest(baseUrl, "/admin/algorithm/state", {
    headers: { "x-admin-token": adminToken },
  });
  const initialState = await readJson(initialStateRes);
  const initialSettings = initialState.settings || {};

  const session = await adminJson(
    baseUrl,
    "/admin/session/new-with-token",
    adminToken,
    { confirm: true, name: `Algorithm smoke ${suffix}`, tokenTtlMinutes: 5 },
    timeoutMs
  );
  const joinToken = session.join && session.join.token;
  if (!joinToken) throw new Error("Algorithm flow did not receive a join token");
  const cookie = await getJoinCookie(baseUrl, joinToken, timeoutMs);

  const peter = await adminJson(baseUrl, "/admin/algorithm/characters/upsert", adminToken, {
    name: `Smoke Peter ${suffix}`,
    description: "Smoke Peter is nerveus en wil aardig gevonden worden.",
  }, timeoutMs);
  created.character.push(peter.character.id);
  const penelope = await adminJson(baseUrl, "/admin/algorithm/characters/upsert", adminToken, {
    name: `Smoke Penelope ${suffix}`,
    description: "Smoke Penelope stelt te directe vragen.",
  }, timeoutMs);
  created.character.push(penelope.character.id);
  const situation = await adminJson(baseUrl, "/admin/algorithm/situations/upsert", adminToken, {
    name: `Smoke misverstand ${suffix}`,
    description: "Een klein misverstand wordt veel te serieus genomen.",
    requiredCharacterIds: [peter.character.id],
    allowedCharacterIds: [peter.character.id, penelope.character.id],
  }, timeoutMs);
  created.situation.push(situation.situation.id);
  const environment = await adminJson(baseUrl, "/admin/algorithm/environments/upsert", adminToken, {
    name: `Smoke kamer ${suffix}`,
    description: "Een neutrale testruimte.",
  }, timeoutMs);
  created.environment.push(environment.environment.id);

  const scene1 = await adminJson(baseUrl, "/admin/algorithm/scenes/upsert", adminToken, {
    title: `Smoke scene 1 ${suffix}`,
    characterIds: [peter.character.id, penelope.character.id],
    situationIds: [situation.situation.id],
    environmentId: environment.environment.id,
    promptOverride: "Peter probeert rustig te blijven.",
  }, timeoutMs);
  created.scene.push(scene1.scene.id);
  const scene2 = await adminJson(baseUrl, "/admin/algorithm/scenes/upsert", adminToken, {
    title: `Smoke scene 2 ${suffix}`,
    characterIds: [peter.character.id],
    situationIds: [situation.situation.id],
    environmentId: environment.environment.id,
    promptOverride: "Peter komt terug in een nieuwe poging.",
  }, timeoutMs);
  created.scene.push(scene2.scene.id);

  await adminJson(baseUrl, "/admin/algorithm/settings", adminToken, {
    calibrationCount: 1,
    globalPrompt: initialSettings.globalPrompt,
    promptTemplate: initialSettings.promptTemplate,
  }, timeoutMs);

  await adminJson(baseUrl, "/admin/algorithm/runs/start", adminToken, {
    sceneId: scene1.scene.id,
    selectionSource: "smoke",
  }, timeoutMs);

  const ws = openWs(toWsUrl(baseUrl, "/"), { headers: { Cookie: cookie } });
  const hello = await waitForWsMessage(ws, (msg) => msg.type === "hello", timeoutMs, "algorithm flow chat hello");
  const clientTag = `alg-${suffix}`;
  ws.send(JSON.stringify({ type: "register", clientTag, name: "Algorithm Smoke" }));
  ws.send(JSON.stringify({ type: "reaction", reaction: "heart", clientTag }));
  await delay(160);
  ws.send(JSON.stringify({ type: "reaction", reaction: "bored", clientTag }));
  await delay(160);
  ws.send(JSON.stringify({
    type: "comment",
    clientTag,
    name: "Algorithm Smoke",
    text: `algorithm smoke ${suffix}`,
  }));
  await waitForWsMessage(
    ws,
    (msg) => msg.type === "comment" && msg.text === `algorithm smoke ${suffix}`,
    timeoutMs,
    "algorithm flow comment"
  );
  ws.close();

  await delay(120);
  const ended = await adminJson(baseUrl, "/admin/algorithm/runs/end", adminToken, { reason: "smoke" }, timeoutMs);
  const endedRun = ended.run || {};
  if (Number(endedRun.heartCount || 0) < 1 || Number(endedRun.boredCount || 0) < 1 || Number(endedRun.commentCount || 0) < 1) {
    throw new Error("Algorithm run did not count live reactions/comments");
  }
  const recommendation = ended.state && ended.state.recommendation;
  if (!recommendation || !recommendation.scene || !recommendation.prompt) {
    throw new Error("Algorithm flow did not produce a recommendation prompt");
  }

  for (const sceneId of created.scene) await adminJson(baseUrl, "/admin/algorithm/archive", adminToken, { kind: "scene", id: sceneId }, timeoutMs);
  for (const situationId of created.situation) await adminJson(baseUrl, "/admin/algorithm/archive", adminToken, { kind: "situation", id: situationId }, timeoutMs);
  for (const environmentId of created.environment) await adminJson(baseUrl, "/admin/algorithm/archive", adminToken, { kind: "environment", id: environmentId }, timeoutMs);
  for (const characterId of created.character) await adminJson(baseUrl, "/admin/algorithm/archive", adminToken, { kind: "character", id: characterId }, timeoutMs);
  await adminJson(baseUrl, "/admin/algorithm/settings", adminToken, initialSettings, timeoutMs);

  return `session ${hello.sessionId}, next ${recommendation.scene.title}`;
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
  await runCheck(results, "algorithm page", () => checkHttpRoute(baseUrl, "/algoritme"));
  await runCheck(results, "stage page", () => checkHttpRoute(baseUrl, "/stage"));
  await runCheck(results, "stage WebSocket", () => checkStageWs(baseUrl, options.timeoutMs));
  await runCheck(results, "chat access guard", () => checkUnauthenticatedChatWs(baseUrl, options.timeoutMs));

  if (options.adminPassword) {
    await runCheck(results, "admin API", () => checkAdmin(baseUrl, options.adminPassword, options.timeoutMs));
    await runCheck(results, "algorithm API", () => checkAlgorithmState(baseUrl, options.adminPassword, options.timeoutMs));
    if (options.algorithmFlow) {
      await runCheck(results, "algorithm flow", () => checkAlgorithmFlow(baseUrl, options.adminPassword, options.timeoutMs));
    } else {
      results.push({ name: "algorithm flow", ok: null, detail: "skipped (pass --algorithm-flow)" });
    }
  } else {
    results.push({ name: "admin API", ok: null, detail: "skipped (set SMOKE_ADMIN_PASSWORD or --admin-password)" });
    results.push({ name: "algorithm API", ok: null, detail: "skipped (set SMOKE_ADMIN_PASSWORD or --admin-password)" });
    results.push({ name: "algorithm flow", ok: null, detail: "skipped" });
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
