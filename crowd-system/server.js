#!/usr/bin/env node
"use strict";

// Standalone Crowd System server.
// Run with: node crowd-system/server.js
// Connects to a running For You chat server via WebSocket to simulate a crowd.

const http = require("node:http");
const { CrowdEngine, CROWD_MODE_PRESETS, CROWD_CUES, normalizeCrowdConfig } = require("./index");

const PORT = parseInt(process.env.CROWD_PORT || "3020", 10);
const CHAT_WS_URL = process.env.CHAT_WS_URL || "ws://127.0.0.1:3010";

const engine = new CrowdEngine({ config: { crowdMode: "normal" } });

// ── HTTP API ──────────────────────────────────────────────
const server = http.createServer((req, res) => {
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Access-Control-Allow-Origin", "*");

  if (req.method === "GET" && req.url === "/status") {
    res.end(JSON.stringify({ ok: true, snapshot: engine.getSnapshot() }));
    return;
  }

  if (req.method === "GET" && req.url === "/modes") {
    const modes = Object.entries(CROWD_MODE_PRESETS).map(([key, val]) => ({ key, label: val.label }));
    res.end(JSON.stringify({ modes }));
    return;
  }

  if (req.method === "GET" && req.url === "/cues") {
    const cues = Object.entries(CROWD_CUES).map(([key, val]) => ({ key, label: val.label }));
    res.end(JSON.stringify({ cues }));
    return;
  }

  if (req.method === "POST" && req.url === "/config") {
    let body = "";
    req.on("data", (chunk) => { body += chunk; });
    req.on("end", () => {
      try {
        const config = JSON.parse(body || "{}");
        engine.updateConfig(config);
        res.end(JSON.stringify({ ok: true, config: engine.config }));
      } catch (err) {
        res.statusCode = 400;
        res.end(JSON.stringify({ ok: false, error: err.message }));
      }
    });
    return;
  }

  if (req.method === "POST" && req.url === "/cue") {
    let body = "";
    req.on("data", (chunk) => { body += chunk; });
    req.on("end", () => {
      try {
        const { cue } = JSON.parse(body || "{}");
        const applied = engine.applyCue(cue);
        res.end(JSON.stringify({ ok: true, applied }));
      } catch (err) {
        res.statusCode = 400;
        res.end(JSON.stringify({ ok: false, error: err.message }));
      }
    });
    return;
  }

  if (req.method === "POST" && req.url === "/observe") {
    let body = "";
    req.on("data", (chunk) => { body += chunk; });
    req.on("end", () => {
      try {
        const { type, payload } = JSON.parse(body || "{}");
        engine.observeStimulus(type, payload);
        res.end(JSON.stringify({ ok: true }));
      } catch (err) {
        res.statusCode = 400;
        res.end(JSON.stringify({ ok: false, error: err.message }));
      }
    });
    return;
  }

  if (req.method === "POST" && req.url === "/traits") {
    const count = Math.min(parseInt(req.headers["x-count"] || "1", 10) || 1, 100);
    const traits = Array.from({ length: count }, () => engine.createBotTraits());
    res.end(JSON.stringify({ traits }));
    return;
  }

  if (req.method === "POST" && req.url === "/plan") {
    let body = "";
    req.on("data", (chunk) => { body += chunk; });
    req.on("end", () => {
      try {
        const { botId, profile, options } = JSON.parse(body || "{}");
        const plan = engine.planComment(botId || 1, profile || {}, options || {});
        res.end(JSON.stringify({ ok: true, plan }));
      } catch (err) {
        res.statusCode = 400;
        res.end(JSON.stringify({ ok: false, error: err.message }));
      }
    });
    return;
  }

  res.statusCode = 404;
  res.end(JSON.stringify({ ok: false, error: "not_found" }));
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`Crowd System HTTP API → http://127.0.0.1:${PORT}`);
  console.log(`Chat WebSocket target → ${CHAT_WS_URL}`);
  console.log("Endpoints: GET /status, /modes, /cues | POST /config, /cue, /observe, /traits, /plan");
});

process.on("SIGINT", () => { server.close(); process.exit(0); });
