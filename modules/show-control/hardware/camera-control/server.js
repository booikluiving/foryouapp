const http = require("http");
const fs = require("fs");
const path = require("path");
const { URL } = require("url");
const osc = require("../common/osc-compat");
const WebSocket = loadOptionalWebSocket();

const TOOL_PORT = Number(process.env.V2_SHOW_CONTROL_CAMERA_PORT || 3226);
const TOOL_HOST = normalizeBindHost(process.env.V2_SHOW_CONTROL_CAMERA_HOST || "127.0.0.1");
const CONTROL_TOKEN = String(process.env.V2_SHOW_CONTROL_CAMERA_TOKEN || "").trim();
const ALLOW_REMOTE = parseBooleanLike(process.env.V2_SHOW_CONTROL_CAMERA_ALLOW_REMOTE || "0");
const OSC_PORT = Number(process.env.V2_SHOW_CONTROL_CAMERA_OSC_PORT || 53260);
const OSC_LISTEN_ADDRESS = normalizeBindHost(process.env.V2_SHOW_CONTROL_CAMERA_OSC_LISTEN_ADDRESS || "127.0.0.1");
const CAMERA_TIMEOUT_MS = Number(process.env.V2_SHOW_CONTROL_CAMERA_TIMEOUT_MS || 1800);
const CAMERA_POLL_MS = Number(process.env.V2_SHOW_CONTROL_CAMERA_POLL_MS || 2000);
const WS_RECONNECT_BASE_MS = Number(process.env.V2_SHOW_CONTROL_CAMERA_WS_RECONNECT_BASE_MS || 1000);
const STATIC_DIR = path.join(__dirname, "public");

requireSafeBind("HTTP", TOOL_HOST, { allowToken: true });
requireSafeBind("OSC", OSC_LISTEN_ADDRESS, { allowRemoteFlag: true });

const CONTROL_ENDPOINTS = Object.freeze({
  "/lens/focus": { kind: "normalised" },
  "/lens/iris": { kind: "normalised" },
  "/lens/zoom": { kind: "normalised" },
  "/colorCorrection/contrast": { kind: "contrast" },
  "/colorCorrection/lift": { kind: "color4", min: -4, max: 4 },
  "/colorCorrection/gamma": { kind: "color4", min: -4, max: 4 },
  "/colorCorrection/gain": { kind: "color4", min: -4, max: 8 },
  "/colorCorrection/offset": { kind: "color4", min: -8, max: 8 },
});

const READ_ENDPOINTS = Object.freeze([
  "/system",
  "/system/format",
  "/camera/tallyStatus",
  "/lens/focus",
  "/lens/iris",
  "/lens/zoom",
  "/colorCorrection/contrast",
  "/colorCorrection/lift",
  "/colorCorrection/gamma",
  "/colorCorrection/gain",
  "/colorCorrection/offset",
]);

const SUBSCRIBE_PROPERTIES = Object.freeze([
  "/system/format",
  "/camera/tallyStatus",
  "/camera/power",
  "/camera/timingReferenceLock",
  "/lens/focus",
  "/lens/iris",
  "/lens/zoom",
  "/colorCorrection/contrast",
  "/colorCorrection/lift",
  "/colorCorrection/gamma",
  "/colorCorrection/gain",
  "/colorCorrection/offset",
  "/video/gain",
  "/video/whiteBalance",
  "/video/whiteBalanceTint",
  "/video/shutter",
]);

const state = {
  startedAt: new Date().toISOString(),
  http: {
    host: TOOL_HOST,
    port: TOOL_PORT,
    remoteEnabled: isRemoteBindHost(TOOL_HOST),
  },
  osc: {
    host: OSC_LISTEN_ADDRESS,
    port: OSC_PORT,
    remoteEnabled: isRemoteBindHost(OSC_LISTEN_ADDRESS),
  },
  cameras: buildCameraConfig(),
  activity: [],
};

const commandQueues = new Map();
const cameraSockets = new Map();
const browserClients = new Set();
let oscPort = null;
let pollTimer = null;

for (const camera of Object.values(state.cameras)) {
  commandQueues.set(camera.id, Promise.resolve());
}

const server = http.createServer(async (req, res) => {
  try {
    await handleRequest(req, res);
  } catch (error) {
    sendJson(res, 500, { ok: false, error: error.message || String(error) });
  }
});

const browserWss = WebSocket && WebSocket.Server ? new WebSocket.Server({ noServer: true }) : null;
if (browserWss) {
  browserWss.on("connection", (socket) => {
    browserClients.add(socket);
    socket.send(JSON.stringify({ type: "state", state: publicState() }));
    socket.on("close", () => browserClients.delete(socket));
  });
}

server.on("upgrade", (req, socket, head) => {
  if (!browserWss) {
    socket.destroy();
    return;
  }
  const url = new URL(req.url, `http://${req.headers.host || "127.0.0.1"}`);
  if (url.pathname !== "/ws") {
    socket.destroy();
    return;
  }
  if (!isRequestAuthorized(req, url)) {
    socket.destroy();
    return;
  }
  browserWss.handleUpgrade(req, socket, head, (ws) => {
    browserWss.emit("connection", ws, req);
  });
});

server.listen(TOOL_PORT, TOOL_HOST, () => {
  logActivity("system", `Camera Control listening on http://${TOOL_HOST}:${TOOL_PORT}`);
  startOsc();
  for (const camera of Object.values(state.cameras)) {
    connectCameraEvents(camera.id);
  }
  pollAllCameras();
  pollTimer = setInterval(pollAllCameras, CAMERA_POLL_MS);
});

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

async function handleRequest(req, res) {
  const url = new URL(req.url, `http://${req.headers.host || "127.0.0.1"}`);
  if (!isRequestAuthorized(req, url)) {
    sendJson(res, 403, { ok: false, error: "Forbidden" });
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/state") {
    sendJson(res, 200, publicState());
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/tally") {
    const body = await readJson(req);
    const camera = normalizeCameraId(body.camera);
    const tallyState = normalizeTallyState(body.state);
    setTally(camera, tallyState, "http");
    sendJson(res, 200, { ok: true, camera, state: tallyState });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/tally/all") {
    const body = await readJson(req);
    const tallyState = normalizeTallyState(body.state);
    for (const cameraId of Object.keys(state.cameras)) {
      setTally(cameraId, tallyState, "http");
    }
    sendJson(res, 200, { ok: true, state: tallyState });
    return;
  }

  const focusMatch = url.pathname.match(/^\/api\/camera\/([^/]+)\/(focus|iris|zoom)$/);
  if (req.method === "POST" && focusMatch) {
    const camera = normalizeCameraId(focusMatch[1]);
    const endpoint = `/lens/${focusMatch[2]}`;
    const body = await readJson(req);
    const result = await enqueueCameraCommand(camera, endpoint, { normalised: body.normalised }, "http");
    sendJson(res, result.ok ? 200 : 502, result);
    return;
  }

  const contrastMatch = url.pathname.match(/^\/api\/camera\/([^/]+)\/contrast$/);
  if (req.method === "POST" && contrastMatch) {
    const camera = normalizeCameraId(contrastMatch[1]);
    const body = await readJson(req);
    const result = await enqueueCameraCommand(camera, "/colorCorrection/contrast", body, "http");
    sendJson(res, result.ok ? 200 : 502, result);
    return;
  }

  const colorMatch = url.pathname.match(/^\/api\/camera\/([^/]+)\/color\/(lift|gamma|gain|offset)$/);
  if (req.method === "POST" && colorMatch) {
    const camera = normalizeCameraId(colorMatch[1]);
    const endpoint = `/colorCorrection/${colorMatch[2]}`;
    const body = await readJson(req);
    const result = await enqueueCameraCommand(camera, endpoint, body, "http");
    sendJson(res, result.ok ? 200 : 502, result);
    return;
  }

  const genericMatch = url.pathname.match(/^\/api\/camera\/([^/]+)\/control$/);
  if (req.method === "POST" && genericMatch) {
    const camera = normalizeCameraId(genericMatch[1]);
    const body = await readJson(req);
    const result = await enqueueCameraCommand(camera, body.endpoint, body.value, "http");
    sendJson(res, result.ok ? 200 : 502, result);
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/sync") {
    await pollAllCameras();
    sendJson(res, 200, { ok: true, state: publicState() });
    return;
  }

  if (req.method === "GET") {
    serveStatic(url.pathname === "/" ? "/index.html" : url.pathname, res);
    return;
  }

  sendJson(res, 404, { ok: false, error: "Not found" });
}

function serveStatic(requestPath, res) {
  let decoded = "";
  try {
    decoded = decodeURIComponent(requestPath);
  } catch {
    sendJson(res, 400, { ok: false, error: "Bad request" });
    return;
  }
  const rootDir = path.resolve(STATIC_DIR);
  const filePath = path.resolve(path.join(rootDir, decoded));
  if (filePath !== rootDir && !filePath.startsWith(rootDir + path.sep)) {
    sendJson(res, 403, { ok: false, error: "Forbidden" });
    return;
  }
  fs.readFile(filePath, (error, data) => {
    if (error) {
      sendJson(res, 404, { ok: false, error: "Not found" });
      return;
    }
    res.writeHead(200, { "content-type": contentTypeFor(filePath), "cache-control": "no-cache" });
    res.end(data);
  });
}

async function enqueueCameraCommand(cameraId, endpoint, rawValue, source) {
  const camera = getCamera(cameraId);
  const previous = commandQueues.get(cameraId) || Promise.resolve();
  const next = previous
    .catch(() => undefined)
    .then(() => sendCameraCommand(camera, endpoint, rawValue, source));
  commandQueues.set(cameraId, next);
  return next;
}

async function sendCameraCommand(camera, endpoint, rawValue, source) {
  const spec = CONTROL_ENDPOINTS[endpoint];
  if (!spec) {
    return commandFailure(camera, endpoint, `Unsupported control endpoint: ${endpoint}`);
  }
  const value = normalizeControlValue(spec, rawValue);
  camera.pending[endpoint] = value;
  camera.lastCommand = { endpoint, value, source, status: "pending", at: new Date().toISOString() };
  broadcastState();

  try {
    const response = await cameraRequest(camera, "PUT", endpoint, value);
    if (response.status >= 200 && response.status < 300) {
      camera.properties[endpoint] = { ...(camera.properties[endpoint] || {}), ...value };
      delete camera.pending[endpoint];
      camera.online = true;
      camera.restOk = true;
      camera.lastError = "";
      camera.lastCommand = { endpoint, value, source, status: "ok", at: new Date().toISOString() };
      camera.lastUpdateAt = new Date().toISOString();
      logActivity(camera.id, `${source} ${endpoint} ${JSON.stringify(value)}`);
      broadcastState();
      return { ok: true, camera: camera.id, endpoint, value, status: response.status };
    }
    return commandFailure(camera, endpoint, `Camera returned HTTP ${response.status}`);
  } catch (error) {
    return commandFailure(camera, endpoint, error.message || String(error));
  }
}

function commandFailure(camera, endpoint, message) {
  delete camera.pending[endpoint];
  camera.lastError = message;
  camera.lastCommand = {
    endpoint,
    status: "error",
    error: message,
    at: new Date().toISOString(),
  };
  logActivity(camera.id, message, "error");
  broadcastState();
  return { ok: false, camera: camera.id, endpoint, error: message };
}

async function pollAllCameras() {
  await Promise.all(Object.values(state.cameras).map((camera) => pollCamera(camera)));
  broadcastState();
}

async function pollCamera(camera) {
  for (const endpoint of READ_ENDPOINTS) {
    try {
      const response = await cameraRequest(camera, "GET", endpoint);
      camera.restOk = true;
      camera.online = true;
      if (response.status === 204) {
        camera.properties[endpoint] = { ok: true };
      } else if (response.status >= 200 && response.status < 300 && response.body !== undefined) {
        camera.properties[endpoint] = response.body;
      }
      camera.lastUpdateAt = new Date().toISOString();
      camera.lastError = "";
    } catch (error) {
      camera.restOk = false;
      camera.online = false;
      camera.lastError = error.message || String(error);
      break;
    }
  }
}

function connectCameraEvents(cameraId) {
  if (!WebSocket) {
    const camera = getCamera(cameraId);
    camera.wsStatus = "disabled";
    camera.lastError = "WebSocket dependency unavailable; event stream disabled.";
    broadcastState();
    return;
  }
  const camera = getCamera(cameraId);
  const existing = cameraSockets.get(cameraId);
  if (existing && existing.readyState === WebSocket.OPEN) return;

  const socket = new WebSocket(`ws://${camera.host}/control/api/v1/event/websocket`);
  cameraSockets.set(cameraId, socket);
  camera.wsStatus = "connecting";
  broadcastState();

  socket.on("open", () => {
    camera.wsStatus = "open";
    camera.wsReconnectAttempts = 0;
    socket.send(JSON.stringify({ type: "request", data: { action: "listProperties" } }));
    for (const property of SUBSCRIBE_PROPERTIES) {
      socket.send(JSON.stringify({ type: "request", data: { action: "subscribe", properties: [property] } }));
    }
    logActivity(camera.id, "event websocket opened");
    broadcastState();
  });

  socket.on("message", (buffer) => {
    try {
      handleCameraEvent(camera, JSON.parse(String(buffer)));
    } catch (error) {
      camera.lastError = `Bad websocket message: ${error.message}`;
    }
  });

  socket.on("error", (error) => {
    camera.wsStatus = "error";
    camera.lastError = error.message || String(error);
    broadcastState();
  });

  socket.on("close", () => {
    camera.wsStatus = "closed";
    broadcastState();
    const attempts = camera.wsReconnectAttempts + 1;
    camera.wsReconnectAttempts = attempts;
    const delay = Math.min(15000, WS_RECONNECT_BASE_MS * attempts);
    setTimeout(() => connectCameraEvents(cameraId), delay);
  });
}

function handleCameraEvent(camera, event) {
  const data = event && event.data ? event.data : {};
  if (data.action === "listProperties") {
    camera.availableProperties = Array.isArray(data.properties) ? data.properties : [];
  }
  if (event.type === "response" && data.values && typeof data.values === "object") {
    Object.assign(camera.properties, data.values);
  }
  if (data.action === "propertyValueChanged" && data.property) {
    camera.properties[data.property] = data.value;
  }
  camera.online = true;
  camera.lastUpdateAt = new Date().toISOString();
  broadcastState();
}

async function cameraRequest(camera, method, endpoint, body) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), CAMERA_TIMEOUT_MS);
  try {
    const response = await fetch(`http://${camera.host}/control/api/v1${endpoint}`, {
      method,
      headers: body === undefined ? {} : { "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: controller.signal,
    });
    const text = await response.text();
    let parsed;
    if (text) {
      try {
        parsed = JSON.parse(text);
      } catch {
        parsed = text;
      }
    }
    return { status: response.status, body: parsed };
  } finally {
    clearTimeout(timeout);
  }
}

function startOsc() {
  oscPort = new osc.UDPPort({
    localAddress: OSC_LISTEN_ADDRESS,
    localPort: OSC_PORT,
    metadata: true,
  });

  oscPort.on("message", (message) => {
    handleOscMessage(message).catch((error) => {
      logActivity("osc", error.message || String(error), "error");
    });
  });

  oscPort.on("error", (error) => {
    logActivity("osc", error.message || String(error), "error");
  });

  oscPort.open();
}

async function handleOscMessage(message) {
  const address = String(message.address || "");
  const args = Array.isArray(message.args) ? message.args.map((arg) => arg.value) : [];
  const control = address.match(/^\/camera\/(cam[123])\/(focus|iris|zoom)$/);
  if (control) {
    await enqueueCameraCommand(control[1], `/lens/${control[2]}`, { normalised: args[0] }, "osc");
    return;
  }

  const contrast = address.match(/^\/camera\/(cam[123])\/contrast\/(pivot|adjust)$/);
  if (contrast) {
    const current = state.cameras[contrast[1]].properties["/colorCorrection/contrast"] || {};
    await enqueueCameraCommand(contrast[1], "/colorCorrection/contrast", {
      pivot: contrast[2] === "pivot" ? args[0] : current.pivot,
      adjust: contrast[2] === "adjust" ? args[0] : current.adjust,
    }, "osc");
    return;
  }

  const color = address.match(/^\/camera\/(cam[123])\/color\/(lift|gamma|gain|offset)\/(red|green|blue|luma)$/);
  if (color) {
    const endpoint = `/colorCorrection/${color[2]}`;
    const current = state.cameras[color[1]].properties[endpoint] || {};
    await enqueueCameraCommand(color[1], endpoint, { ...current, [color[3]]: args[0] }, "osc");
    return;
  }

  const tally = address.match(/^\/camera\/tally\/(cam[123])$/);
  if (tally) {
    setTally(tally[1], normalizeTallyState(args[0]), "osc");
    return;
  }
}

function setTally(cameraId, tallyState, source) {
  const camera = getCamera(cameraId);
  camera.tally = tallyState;
  camera.lastTallyAt = new Date().toISOString();
  logActivity(camera.id, `${source} tally ${tallyState}`);
  broadcastState();
}

function normalizeControlValue(spec, rawValue) {
  const value = rawValue && typeof rawValue === "object" ? rawValue : {};
  if (spec.kind === "normalised") {
    return { normalised: clampNumber(value.normalised, 0, 1) };
  }
  if (spec.kind === "contrast") {
    return {
      pivot: clampNumber(value.pivot, 0, 1),
      adjust: clampNumber(value.adjust, 0, 2),
    };
  }
  if (spec.kind === "color4") {
    const result = {};
    for (const key of ["red", "green", "blue", "luma"]) {
      if (value[key] !== undefined) {
        result[key] = clampNumber(value[key], spec.min, spec.max);
      }
    }
    if (!Object.keys(result).length) {
      throw new Error("Color control requires at least one component");
    }
    return result;
  }
  throw new Error(`Unknown control kind: ${spec.kind}`);
}

function publicState() {
  return {
    startedAt: state.startedAt,
    http: state.http,
    osc: state.osc,
    cameras: Object.fromEntries(Object.entries(state.cameras).map(([id, camera]) => [id, {
      id: camera.id,
      label: camera.label,
      host: camera.host,
      previewUrl: camera.previewUrl,
      tally: camera.tally,
      online: camera.online,
      restOk: camera.restOk,
      wsStatus: camera.wsStatus,
      lastUpdateAt: camera.lastUpdateAt,
      lastTallyAt: camera.lastTallyAt,
      lastError: camera.lastError,
      lastCommand: camera.lastCommand,
      pending: camera.pending,
      properties: camera.properties,
    }])),
    activity: state.activity.slice(-80),
  };
}

function broadcastState() {
  if (!WebSocket) return;
  const payload = JSON.stringify({ type: "state", state: publicState() });
  for (const client of browserClients) {
    if (client.readyState === WebSocket.OPEN) client.send(payload);
  }
}

function buildCameraConfig() {
  const defaults = [
    ["cam1", "CAM1", process.env.V2_SHOW_CONTROL_CAMERA_CAM1_HOST || "192.168.1.165"],
    ["cam2", "CAM2", process.env.V2_SHOW_CONTROL_CAMERA_CAM2_HOST || "192.168.1.166"],
    ["cam3", "CAM3", process.env.V2_SHOW_CONTROL_CAMERA_CAM3_HOST || "192.168.1.167"],
  ];
  return Object.fromEntries(defaults.map(([id, label, host]) => [id, {
    id,
    label,
    host: String(host).trim(),
    previewUrl: String(process.env[`V2_SHOW_CONTROL_CAMERA_${id.toUpperCase()}_PREVIEW_URL`] || "").trim(),
    tally: "none",
    online: false,
    restOk: false,
    wsStatus: "idle",
    wsReconnectAttempts: 0,
    lastUpdateAt: "",
    lastTallyAt: "",
    lastError: "",
    lastCommand: null,
    pending: {},
    properties: {},
    availableProperties: [],
  }]));
}

function getCamera(id) {
  const cameraId = normalizeCameraId(id);
  const camera = state.cameras[cameraId];
  if (!camera) throw new Error(`Unknown camera: ${id}`);
  return camera;
}

function normalizeCameraId(value) {
  const raw = String(value || "").trim().toLowerCase();
  if (/^[123]$/.test(raw)) return `cam${raw}`;
  if (/^cam[123]$/.test(raw)) return raw;
  throw new Error(`Invalid camera id: ${value}`);
}

function normalizeTallyState(value) {
  const raw = String(value || "").trim().toLowerCase();
  if (raw === "program" || raw === "live" || raw === "pgm") return "program";
  if (raw === "preview" || raw === "pvw") return "preview";
  if (raw === "none" || raw === "off" || raw === "0" || raw === "false") return "none";
  throw new Error(`Invalid tally state: ${value}`);
}

function logActivity(scope, message, level = "info") {
  state.activity.push({
    at: new Date().toISOString(),
    level,
    scope,
    message,
  });
  state.activity = state.activity.slice(-120);
  console.log(`[${level}] [${scope}] ${message}`);
}

function sendJson(res, status, data) {
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-cache",
  });
  res.end(JSON.stringify(data, null, 2));
}

async function readJson(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString("utf8").trim();
  if (!raw) return {};
  return JSON.parse(raw);
}

function contentTypeFor(filePath) {
  if (filePath.endsWith(".html")) return "text/html; charset=utf-8";
  if (filePath.endsWith(".css")) return "text/css; charset=utf-8";
  if (filePath.endsWith(".js")) return "application/javascript; charset=utf-8";
  if (filePath.endsWith(".svg")) return "image/svg+xml";
  return "application/octet-stream";
}

function normalizeBindHost(value) {
  const host = String(value || "").trim();
  return host || "127.0.0.1";
}

function isLoopbackBindHost(host) {
  const normalized = normalizeBindHost(host).toLowerCase();
  return normalized === "localhost" || normalized === "127.0.0.1" || normalized === "::1" || normalized === "[::1]";
}

function isRemoteBindHost(host) {
  return !isLoopbackBindHost(host);
}

function requireSafeBind(kind, host, options = {}) {
  const remote = isRemoteBindHost(host);
  if (!remote) return;
  if (options.allowToken && CONTROL_TOKEN) return;
  if (options.allowRemoteFlag && ALLOW_REMOTE) return;
  const suffix = options.allowToken
    ? "Set V2_SHOW_CONTROL_CAMERA_TOKEN to allow remote HTTP binding."
    : "Set V2_SHOW_CONTROL_CAMERA_ALLOW_REMOTE=1 to allow remote OSC binding.";
  throw new Error(`${kind} bind host ${host} is remote. ${suffix}`);
}

function isRequestAuthorized(req, url) {
  if (!CONTROL_TOKEN) return true;
  const remoteAddress = req.socket && req.socket.remoteAddress ? req.socket.remoteAddress : "";
  if (remoteAddress === "127.0.0.1" || remoteAddress === "::1" || remoteAddress === "::ffff:127.0.0.1") return true;
  const bearer = String(req.headers.authorization || "").replace(/^Bearer\s+/i, "").trim();
  return bearer === CONTROL_TOKEN || url.searchParams.get("token") === CONTROL_TOKEN;
}

function parseBooleanLike(value) {
  const raw = String(value === undefined || value === null ? "" : value).trim().toLowerCase();
  return raw === "1" || raw === "true" || raw === "yes" || raw === "on";
}

function loadOptionalWebSocket() {
  try {
    return require("ws");
  } catch (error) {
    process.stderr.write(`Camera Control V2: WebSocket dependency unavailable; HTTP/OSC mode stays active. ${error.message || error}\n`);
    return null;
  }
}

function clampNumber(value, min, max) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return min;
  return Math.max(min, Math.min(max, parsed));
}

function shutdown() {
  if (pollTimer) clearInterval(pollTimer);
  for (const socket of cameraSockets.values()) {
    try { socket.close(); } catch {}
  }
  if (oscPort) {
    try { oscPort.close(); } catch {}
  }
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 1000).unref();
}
