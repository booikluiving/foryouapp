"use strict";

const http = require("node:http");
const { URL } = require("node:url");

const DEFAULT_PORT = 3227;
const DEFAULT_HOST = "127.0.0.1";
const DEFAULT_SHOW_CONTROL_URL = "http://127.0.0.1:3025";

function nowIso() {
  return new Date().toISOString();
}

function boolOrNull(value) {
  if (value === null || value === undefined) return null;
  if (value === true || value === false) return value;
  const raw = String(value).trim().toLowerCase();
  if (["1", "true", "on", "muted", "yes"].includes(raw)) return true;
  if (["0", "false", "off", "unmuted", "no"].includes(raw)) return false;
  return null;
}

function streamDeckPort(options = {}) {
  return Number(options.port || process.env.V2_SHOW_CONTROL_STREAMDECK_PORT || DEFAULT_PORT);
}

function streamDeckHost(options = {}) {
  return String(options.host || process.env.V2_SHOW_CONTROL_STREAMDECK_HOST || DEFAULT_HOST);
}

function showControlUrl(options = {}) {
  return String(options.showControlUrl || process.env.V2_SHOW_CONTROL_URL || DEFAULT_SHOW_CONTROL_URL).replace(/\/+$/, "");
}

function createState() {
  return {
    service: "streamdeck-control",
    startedAt: nowIso(),
    lastSyncAt: "",
    buttons: {},
    activity: [],
  };
}

function publicState(state) {
  const brent = state.buttons.brent ? boolOrNull(state.buttons.brent.muted) : null;
  const megan = state.buttons.megan ? boolOrNull(state.buttons.megan.muted) : null;
  const booi = state.buttons.booi ? boolOrNull(state.buttons.booi.muted) : null;
  const main = state.buttons.main ? boolOrNull(state.buttons.main.muted) : null;
  const allMicValues = [brent, megan, booi].filter((value) => value !== null);
  const allMicsMixed = allMicValues.length > 1 && new Set(allMicValues).size > 1;
  const allMics = allMicValues.length ? allMicValues.every(Boolean) : null;
  return {
    service: state.service,
    startedAt: state.startedAt,
    lastSyncAt: state.lastSyncAt,
    brent,
    megan,
    booi,
    allMics,
    allMicsMixed,
    main,
    buttons: state.buttons,
    activity: state.activity.slice(-80),
  };
}

function addActivity(state, item) {
  state.activity.push({ at: nowIso(), ...item });
  state.activity = state.activity.slice(-120);
}

function updateButton(state, buttonId, patch = {}, source = "http") {
  const id = String(buttonId || patch.button || patch.buttonId || "status").trim().toLowerCase();
  const previous = state.buttons[id] || {};
  state.buttons[id] = {
    ...previous,
    ...patch,
    button: id,
    updatedAt: nowIso(),
  };
  state.lastSyncAt = state.buttons[id].updatedAt;
  addActivity(state, {
    type: "button-status",
    source,
    button: id,
    state: patch.state || patch.status || null,
    label: patch.label || null,
  });
  return state.buttons[id];
}

async function triggerShowControl(options, body) {
  const cueId = body.cueId || body.cueID || null;
  if (cueId) {
    const response = await fetch(`${showControlUrl(options)}/v0/show-control/cues/${encodeURIComponent(cueId)}/execute`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body.execute || {}),
    });
    const text = await response.text();
    return { status: response.status, body: text ? JSON.parse(text) : {} };
  }
  if (body.command) {
    const response = await fetch(`${showControlUrl(options)}/v0/show-control/cues`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: body.name || `Stream Deck ${body.button || body.command}`,
        actions: [{
          command: body.command,
          ackMode: body.ackMode || "fire-and-forget",
          payload: body.payload || {},
        }],
      }),
    });
    const text = await response.text();
    return { status: response.status, body: text ? JSON.parse(text) : {} };
  }
  if (body.button || body.buttonId || body.triggerId) {
    const response = await fetch(`${showControlUrl(options)}/v0/show-control/triggers/fire`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        source: body.source || "streamdeck",
        triggerId: body.triggerId || body.button || body.buttonId,
        button: body.button || body.buttonId || body.triggerId,
        nonBlocking: body.nonBlocking !== false,
      }),
    });
    const text = await response.text();
    return { status: response.status, body: text ? JSON.parse(text) : {} };
  }
  return null;
}

async function readJson(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString("utf8").trim();
  return raw ? JSON.parse(raw) : {};
}

function sendJson(res, status, body) {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-cache" });
  res.end(JSON.stringify(body, null, 2));
}

function createStreamDeckApp(options = {}) {
  const state = options.state || createState();
  return http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, `http://${req.headers.host || "127.0.0.1"}`);
      if (req.method === "GET" && (url.pathname === "/" || url.pathname === "/health")) {
        sendJson(res, 200, { ok: true, service: "streamdeck-control", state: publicState(state) });
        return;
      }
      if (req.method === "GET" && (url.pathname === "/api/state" || url.pathname === "/api/streamdeck/state")) {
        sendJson(res, 200, publicState(state));
        return;
      }
      if (req.method === "POST" && (url.pathname === "/api/status" || url.pathname === "/api/buttons/status")) {
        const body = await readJson(req);
        const button = updateButton(state, body.button || body.buttonId || body.target, body, "show-control");
        sendJson(res, 200, { ok: true, button, state: publicState(state) });
        return;
      }
      const buttonStatusMatch = url.pathname.match(/^\/api\/buttons\/([^/]+)$/);
      if (req.method === "POST" && buttonStatusMatch) {
        const body = await readJson(req);
        const button = updateButton(state, decodeURIComponent(buttonStatusMatch[1]), body, "show-control");
        sendJson(res, 200, { ok: true, button, state: publicState(state) });
        return;
      }
      const streamdeckMatch = url.pathname.match(/^\/api\/streamdeck\/([^/]+)\/([^/]+)$/);
      if (req.method === "POST" && streamdeckMatch) {
        const target = decodeURIComponent(streamdeckMatch[1]).toLowerCase();
        const action = decodeURIComponent(streamdeckMatch[2]).toLowerCase();
        const current = state.buttons[target] || {};
        const nextMuted = action === "toggle" ? !boolOrNull(current.muted) : action === "mute";
        const button = updateButton(state, target, { muted: nextMuted, state: nextMuted ? "muted" : "on", action }, "companion");
        sendJson(res, 200, { ok: true, target, action, muted: nextMuted, button, state: publicState(state) });
        return;
      }
      if (req.method === "POST" && (url.pathname === "/api/trigger" || url.pathname === "/api/button/trigger")) {
        const body = await readJson(req);
        addActivity(state, { type: "trigger", source: "companion", button: body.button || null, cueId: body.cueId || null, command: body.command || null });
        const showControl = await triggerShowControl(options, body);
        sendJson(res, 200, { ok: true, triggered: body, showControl, state: publicState(state) });
        return;
      }
      sendJson(res, 404, { ok: false, error: "not_found", path: url.pathname });
    } catch (err) {
      sendJson(res, 500, { ok: false, error: err.message || String(err) });
    }
  });
}

function startStreamDeckServer(options = {}) {
  const server = createStreamDeckApp(options);
  const port = streamDeckPort(options);
  const host = streamDeckHost(options);
  server.listen(port, host, () => {
    process.stdout.write(`Stream Deck Control V2 listening on http://${host}:${port}\n`);
  });
  return server;
}

if (require.main === module) {
  startStreamDeckServer();
}

module.exports = {
  createState,
  createStreamDeckApp,
  publicState,
  startStreamDeckServer,
  streamDeckHost,
  streamDeckPort,
};
