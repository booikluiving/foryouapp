"use strict";

const http = require("node:http");
const { URL } = require("node:url");

const DEFAULT_PORT = 3228;
const DEFAULT_HOST = "127.0.0.1";
const DEFAULT_SHOW_CONTROL_URL = "http://127.0.0.1:3025";

function nowIso() {
  return new Date().toISOString();
}

function perfectCuePort(options = {}) {
  return Number(options.port || process.env.V2_SHOW_CONTROL_PERFECT_CUE_PORT || DEFAULT_PORT);
}

function perfectCueHost(options = {}) {
  return String(options.host || process.env.V2_SHOW_CONTROL_PERFECT_CUE_HOST || DEFAULT_HOST);
}

function showControlUrl(options = {}) {
  return String(options.showControlUrl || process.env.V2_SHOW_CONTROL_URL || DEFAULT_SHOW_CONTROL_URL).replace(/\/+$/, "");
}

function createState() {
  return {
    service: "perfect-cue-control",
    startedAt: nowIso(),
    mappings: {
      ArrowRight: { label: "Next / GO", command: "runtime.startSituation" },
      ArrowLeft: { label: "Stop", command: "runtime.stopSituation" },
      Space: { label: "GO", command: "runtime.startSituation" },
    },
    triggers: [],
  };
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

function htmlPage() {
  return `<!doctype html>
<html lang="nl">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Perfect Cue Control V2</title>
  <style>
    body { font-family: system-ui, sans-serif; margin: 24px; background: #f7f3ea; color: #1f1d1a; }
    main { max-width: 760px; display: grid; gap: 16px; }
    button { min-height: 44px; border: 1px solid #2a2724; border-radius: 8px; background: #2a2724; color: #fff; font-weight: 800; }
    pre { background: #fff; border: 1px solid #d8d3c7; border-radius: 8px; padding: 12px; overflow: auto; }
  </style>
</head>
<body>
  <main>
    <h1>Perfect Cue Control V2</h1>
    <p>Focus deze pagina en druk een Perfect Cue/keyboard toets. De key wordt naar deze V2 sidecar gestuurd.</p>
    <button id="arm">Keyboard capture actief</button>
    <pre id="log">Wachten op input...</pre>
  </main>
  <script>
    const log = document.getElementById("log");
    window.addEventListener("keydown", async (event) => {
      event.preventDefault();
      const body = { key: event.key, code: event.code, source: "browser-keyboard", at: new Date().toISOString() };
      const response = await fetch("/api/key", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      log.textContent = JSON.stringify(await response.json(), null, 2);
    });
  </script>
</body>
</html>`;
}

async function triggerShowControl(options, trigger) {
  const cueId = trigger.cueId || null;
  if (cueId) {
    const response = await fetch(`${showControlUrl(options)}/v0/show-control/cues/${encodeURIComponent(cueId)}/execute`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(trigger.execute || {}),
    });
    const text = await response.text();
    return { status: response.status, body: text ? JSON.parse(text) : {} };
  }
  if (trigger.command) {
    const response = await fetch(`${showControlUrl(options)}/v0/show-control/cues`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: trigger.name || `Perfect Cue ${trigger.key || trigger.command}`,
        actions: [{
          command: trigger.command,
          ackMode: trigger.ackMode || "fire-and-forget",
          payload: trigger.payload || {},
        }],
      }),
    });
    const text = await response.text();
    return { status: response.status, body: text ? JSON.parse(text) : {} };
  }
  return null;
}

async function handleTrigger(state, options, rawTrigger = {}) {
  const key = String(rawTrigger.key || rawTrigger.code || rawTrigger.button || "").trim();
  const mapping = key && state.mappings[key] ? state.mappings[key] : {};
  const trigger = {
    ...mapping,
    ...rawTrigger,
    key,
    at: nowIso(),
  };
  const showControl = await triggerShowControl(options, trigger);
  const record = {
    key,
    source: trigger.source || "http",
    cueId: trigger.cueId || null,
    command: trigger.command || null,
    showControlStatus: showControl ? showControl.status : null,
    at: trigger.at,
  };
  state.triggers.push(record);
  state.triggers = state.triggers.slice(-120);
  return { trigger: record, showControl };
}

function publicState(state) {
  return {
    service: state.service,
    startedAt: state.startedAt,
    mappings: state.mappings,
    triggers: state.triggers.slice(-80),
  };
}

function createPerfectCueApp(options = {}) {
  const state = options.state || createState();
  return http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, `http://${req.headers.host || "127.0.0.1"}`);
      if (req.method === "GET" && url.pathname === "/") {
        res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-cache" });
        res.end(htmlPage());
        return;
      }
      if (req.method === "GET" && url.pathname === "/health") {
        sendJson(res, 200, { ok: true, service: "perfect-cue-control", state: publicState(state) });
        return;
      }
      if (req.method === "GET" && url.pathname === "/api/state") {
        sendJson(res, 200, publicState(state));
        return;
      }
      if (req.method === "GET" && url.pathname === "/api/mappings") {
        sendJson(res, 200, { ok: true, mappings: state.mappings });
        return;
      }
      if (req.method === "POST" && url.pathname === "/api/mappings") {
        const body = await readJson(req);
        state.mappings = { ...state.mappings, ...(body.mappings || body) };
        sendJson(res, 200, { ok: true, mappings: state.mappings });
        return;
      }
      if (req.method === "POST" && (url.pathname === "/api/key" || url.pathname === "/api/trigger")) {
        const body = await readJson(req);
        const result = await handleTrigger(state, options, body);
        sendJson(res, 200, { ok: true, ...result, state: publicState(state) });
        return;
      }
      sendJson(res, 404, { ok: false, error: "not_found", path: url.pathname });
    } catch (err) {
      sendJson(res, 500, { ok: false, error: err.message || String(err) });
    }
  });
}

function startPerfectCueServer(options = {}) {
  const server = createPerfectCueApp(options);
  const port = perfectCuePort(options);
  const host = perfectCueHost(options);
  server.listen(port, host, () => {
    process.stdout.write(`Perfect Cue Control V2 listening on http://${host}:${port}\n`);
  });
  return server;
}

if (require.main === module) {
  startPerfectCueServer();
}

module.exports = {
  createPerfectCueApp,
  createState,
  handleTrigger,
  perfectCueHost,
  perfectCuePort,
  publicState,
  startPerfectCueServer,
};
