"use strict";

const dgram = require("node:dgram");
const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");
const { URL } = require("node:url");
const { channelsForPreset, listPresets } = require("./look-presets");

const DEFAULT_HOST = "127.0.0.1";
const DEFAULT_PORT = 3229;
const DEFAULT_TARGET_IP = "192.168.1.230";
const ARTNET_PORT = 6454;
const STATIC_DIR = path.join(__dirname, "public");

function clampInt(value, min, max, fallback = min) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, parsed));
}

function nowIso() {
  return new Date().toISOString();
}

function createState(options = {}) {
  const channels = Buffer.alloc(512, 0);
  return {
    service: "dmx-control",
    protocol: "artnet",
    startedAt: nowIso(),
    config: {
      targetIp: String(options.targetIp || process.env.V2_SHOW_CONTROL_DMX_TARGET_IP || DEFAULT_TARGET_IP).trim(),
      universe: clampInt(options.universe || process.env.V2_SHOW_CONTROL_DMX_UNIVERSE, 0, 32767, 1),
      frameRate: clampInt(options.frameRate || process.env.V2_SHOW_CONTROL_DMX_FRAME_RATE, 1, 44, 35),
    },
    channels,
    active: false,
    sequence: 1,
    socket: null,
    interval: null,
    lastSentAt: "",
    lastLook: null,
    activity: [],
  };
}

function channelsToObject(buffer, options = {}) {
  const result = {};
  for (let index = 0; index < buffer.length; index += 1) {
    const value = buffer[index];
    if (options.nonZeroOnly && value === 0) continue;
    result[String(index + 1)] = value;
  }
  return result;
}

function publicState(state) {
  return {
    service: state.service,
    protocol: "artnet",
    startedAt: state.startedAt,
    config: {
      ...state.config,
      artnetPort: ARTNET_PORT,
    },
    active: state.active,
    lastSentAt: state.lastSentAt,
    lastLook: state.lastLook,
    nonZeroChannels: channelsToObject(state.channels, { nonZeroOnly: true }),
    firstChannels: Array.from(state.channels.slice(0, 24)),
    activity: state.activity.slice(-80),
  };
}

function addActivity(state, item) {
  state.activity.push({ at: nowIso(), ...item });
  state.activity = state.activity.slice(-120);
}

function setChannels(state, channels = {}, options = {}) {
  if (options.clearFirst !== false) state.channels.fill(0);
  for (const [channel, value] of Object.entries(channels || {})) {
    const index = clampInt(channel, 1, 512, 1) - 1;
    state.channels[index] = clampInt(value, 0, 255, 0);
  }
  state.lastLook = {
    label: options.label || "custom",
    channels: channelsToObject(state.channels, { nonZeroOnly: true }),
    updatedAt: nowIso(),
  };
}

function fillChannels(state, value) {
  state.channels.fill(clampInt(value, 0, 255, 0));
  state.lastLook = {
    label: `fill ${clampInt(value, 0, 255, 0)}`,
    channels: channelsToObject(state.channels, { nonZeroOnly: true }),
    updatedAt: nowIso(),
  };
}

function buildArtNetDmxPacket(state) {
  const packet = Buffer.alloc(18 + 512, 0);
  const portAddress = clampInt(state.config.universe, 0, 32767, 1);
  let offset = 0;

  Buffer.from("Art-Net\0", "ascii").copy(packet, offset); offset += 8;
  packet.writeUInt16LE(0x5000, offset); offset += 2;
  packet.writeUInt16BE(14, offset); offset += 2;
  packet.writeUInt8(state.sequence, offset); offset += 1;
  packet.writeUInt8(0, offset); offset += 1;
  packet.writeUInt8(portAddress & 0xff, offset); offset += 1;
  packet.writeUInt8((portAddress >> 8) & 0x7f, offset); offset += 1;
  packet.writeUInt16BE(512, offset); offset += 2;
  state.channels.copy(packet, offset);

  state.sequence = state.sequence >= 255 ? 1 : state.sequence + 1;
  return packet;
}

function ensureSocket(state) {
  if (state.socket) return state.socket;
  state.socket = dgram.createSocket("udp4");
  state.socket.on("error", (err) => {
    addActivity(state, { type: "udp-error", message: err.message || String(err) });
  });
  state.socket.bind(() => {
    state.socket.setTTL(1);
  });
  return state.socket;
}

function sendUdp(socket, packet, target) {
  return new Promise((resolve, reject) => {
    socket.send(packet, ARTNET_PORT, target, (err) => (err ? reject(err) : resolve()));
  });
}

async function sendFrame(state, reason = "manual") {
  const socket = ensureSocket(state);
  const packet = buildArtNetDmxPacket(state);
  const target = state.config.targetIp;
  await sendUdp(socket, packet, target);
  state.lastSentAt = nowIso();
  return {
    reason,
    protocol: "artnet",
    target,
    port: ARTNET_PORT,
    universe: state.config.universe,
    sentAt: state.lastSentAt,
  };
}

function frameIntervalMs(state) {
  return Math.max(23, Math.round(1000 / clampInt(state.config.frameRate, 1, 44, 35)));
}

function stopContinuous(state, source = "http") {
  if (state.interval) clearInterval(state.interval);
  state.interval = null;
  state.active = false;
  addActivity(state, { type: "stop", source });
}

function startContinuous(state, source = "http") {
  stopContinuous(state, source);
  state.active = true;
  const intervalMs = frameIntervalMs(state);
  state.interval = setInterval(() => {
    sendFrame(state, "continuous").catch((err) => {
      addActivity(state, { type: "send-error", message: err.message || String(err) });
    });
  }, intervalMs);
  sendFrame(state, "start").catch((err) => {
    addActivity(state, { type: "send-error", message: err.message || String(err) });
  });
  addActivity(state, { type: "start", source, frameRate: state.config.frameRate, intervalMs });
}

async function holdLook(state, holdMs, source = "http") {
  const frames = Math.max(1, Math.ceil(clampInt(holdMs, 1, 60000, 250) / frameIntervalMs(state)));
  for (let index = 0; index < frames; index += 1) {
    await sendFrame(state, source);
    await new Promise((resolve) => setTimeout(resolve, frameIntervalMs(state)));
  }
  return frames;
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

function contentTypeFor(filePath) {
  if (filePath.endsWith(".html")) return "text/html; charset=utf-8";
  if (filePath.endsWith(".css")) return "text/css; charset=utf-8";
  if (filePath.endsWith(".js")) return "application/javascript; charset=utf-8";
  return "application/octet-stream";
}

function serveStatic(urlPath, res) {
  const normalized = urlPath === "/" ? "/index.html" : urlPath;
  const filePath = path.resolve(STATIC_DIR, `.${normalized}`);
  if (!filePath.startsWith(STATIC_DIR)) {
    sendJson(res, 403, { ok: false, error: "forbidden" });
    return;
  }
  fs.readFile(filePath, (err, data) => {
    if (err) {
      sendJson(res, 404, { ok: false, error: "not_found", path: normalized });
      return;
    }
    res.writeHead(200, { "content-type": contentTypeFor(filePath), "cache-control": "no-cache" });
    res.end(data);
  });
}

function applyConfig(state, body = {}) {
  if (body.targetIp !== undefined) state.config.targetIp = String(body.targetIp || DEFAULT_TARGET_IP).trim();
  if (body.universe !== undefined) state.config.universe = clampInt(body.universe, 0, 32767, 1);
  if (body.frameRate !== undefined) state.config.frameRate = clampInt(body.frameRate, 1, 44, 35);
}

async function applyLookAndMaybeSend(state, body = {}, source = "http") {
  applyConfig(state, body);
  if (body.fill !== undefined) {
    fillChannels(state, body.fill);
  } else {
    setChannels(state, body.channels || {}, {
      clearFirst: body.clearFirst !== false,
      label: body.label || "custom",
    });
  }

  if (body.continuous === true || body.start === true) {
    if (state.active) {
      await sendFrame(state, source);
    } else {
      startContinuous(state, source);
    }
    return { frames: 1, continuous: true };
  }
  const holdMs = clampInt(body.holdMs, 1, 60000, 250);
  const frames = await holdLook(state, holdMs, source);
  return { frames, holdMs, continuous: false };
}

function createDmxApp(options = {}) {
  const state = options.state || createState(options);
  return http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, `http://${req.headers.host || "127.0.0.1"}`);

      if (req.method === "GET" && url.pathname === "/api/state") {
        sendJson(res, 200, { ok: true, state: publicState(state) });
        return;
      }

      if (req.method === "GET" && url.pathname === "/api/presets") {
        sendJson(res, 200, { ok: true, presets: listPresets() });
        return;
      }

      if (req.method === "GET" && url.pathname === "/health") {
        sendJson(res, 200, { ok: true, service: "dmx-control", state: publicState(state) });
        return;
      }

      if (req.method === "POST" && url.pathname === "/api/config") {
        const body = await readJson(req);
        applyConfig(state, body);
        if (state.active) startContinuous(state, "config-update");
        addActivity(state, { type: "config", config: state.config });
        sendJson(res, 200, { ok: true, state: publicState(state) });
        return;
      }

      if (req.method === "POST" && url.pathname === "/api/look") {
        const body = await readJson(req);
        const result = await applyLookAndMaybeSend(state, body, "look");
        addActivity(state, { type: "look", label: body.label || "custom", ...result });
        sendJson(res, 200, { ok: true, result, state: publicState(state) });
        return;
      }

      if (req.method === "POST" && url.pathname === "/api/preset") {
        const body = await readJson(req);
        const preset = String(body.preset || body.name || body.look || "").trim().toLowerCase();
        const result = await applyLookAndMaybeSend(state, {
          ...body,
          label: body.label || `preset-${preset}`,
          channels: channelsForPreset(preset),
          clearFirst: body.clearFirst !== false,
        }, "preset");
        addActivity(state, { type: "preset", preset, ...result });
        sendJson(res, 200, { ok: true, preset, result, state: publicState(state) });
        return;
      }

      if (req.method === "POST" && url.pathname === "/api/blackout") {
        const body = await readJson(req);
        const result = await applyLookAndMaybeSend(state, {
          ...body,
          label: "blackout",
          channels: {},
          clearFirst: true,
        }, "blackout");
        addActivity(state, { type: "blackout", ...result });
        sendJson(res, 200, { ok: true, result, state: publicState(state) });
        return;
      }

      if (req.method === "POST" && url.pathname === "/api/start") {
        const body = await readJson(req);
        applyConfig(state, body);
        startContinuous(state, "http");
        sendJson(res, 200, { ok: true, state: publicState(state) });
        return;
      }

      if (req.method === "POST" && url.pathname === "/api/stop") {
        stopContinuous(state, "http");
        sendJson(res, 200, { ok: true, state: publicState(state) });
        return;
      }

      if (req.method === "POST" && url.pathname === "/api/send") {
        const body = await readJson(req);
        applyConfig(state, body);
        const frames = await holdLook(state, body.holdMs || 250, "send-current");
        addActivity(state, { type: "send-current", frames });
        sendJson(res, 200, { ok: true, result: { frames }, state: publicState(state) });
        return;
      }

      if (req.method === "GET") {
        serveStatic(url.pathname, res);
        return;
      }

      sendJson(res, 404, { ok: false, error: "not_found", path: url.pathname });
    } catch (err) {
      addActivity(state, { type: "error", message: err.message || String(err) });
      sendJson(res, 500, { ok: false, error: err.message || String(err), state: publicState(state) });
    }
  });
}

function dmxPort(options = {}) {
  return Number(options.port || process.env.V2_SHOW_CONTROL_DMX_PORT || DEFAULT_PORT);
}

function dmxHost(options = {}) {
  return String(options.host || process.env.V2_SHOW_CONTROL_DMX_HOST || DEFAULT_HOST);
}

function startDmxServer(options = {}) {
  const server = createDmxApp(options);
  const host = dmxHost(options);
  const port = dmxPort(options);
  server.listen(port, host, () => {
    process.stdout.write(`DMX Control Art-Net listening on http://${host}:${port}\n`);
  });
  return server;
}

if (require.main === module) {
  startDmxServer();
}

module.exports = {
  buildArtNetDmxPacket,
  createDmxApp,
  createState,
  dmxHost,
  dmxPort,
  publicState,
  setChannels,
  startDmxServer,
  stopContinuous,
};
