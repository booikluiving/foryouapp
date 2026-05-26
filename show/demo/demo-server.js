"use strict";

const crypto = require("node:crypto");
const dgram = require("node:dgram");
const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");

const HOST = process.env.DEMO_HOST || "127.0.0.1";
const UI_PORT = Number(process.env.DEMO_UI_PORT || 3035);
const CATALOG_PORT = Number(process.env.DEMO_CATALOG_PORT || 3031);
const TD_OSC_PORT = Number(process.env.DEMO_TD_OSC_PORT || 9110);
const TD_ACK_PORT = Number(process.env.DEMO_TD_ACK_PORT || process.env.DEMO_ACK_PORT || 9111);

const ROOT_DIR = __dirname;
const ASSET_DIR = path.resolve(ROOT_DIR, "assets");
const UI_ORIGIN = `http://${HOST}:${UI_PORT}`;
const CATALOG_ORIGIN = `http://${HOST}:${CATALOG_PORT}`;

function assetPath(filename) {
  return path.resolve(ASSET_DIR, filename);
}

const ENVIRONMENTS = [
  {
    id: "tennis",
    environmentId: "environment:demo:tennis",
    legacyEnvironmentId: 13,
    name: "Tennis",
    situationTitle: "Peter en Adolf spelen tennis",
    filename: "tennis.jpg",
    mimeType: "image/jpeg",
  },
  {
    id: "ziekenhuis",
    environmentId: "environment:demo:ziekenhuis",
    legacyEnvironmentId: 12,
    name: "Ziekenhuis",
    situationTitle: "Marit in het ziekenhuis",
    filename: "ziekenhuis.jpg",
    mimeType: "image/jpeg",
  },
  {
    id: "keuken",
    environmentId: "environment:demo:keuken",
    legacyEnvironmentId: 20,
    name: "Keuken",
    situationTitle: "Een gesprek in de keuken",
    filename: "keuken.jpg",
    mimeType: "image/jpeg",
  },
].map((environment) => {
  const assetId = `media-asset:${environment.environmentId}:background`;
  return {
    ...environment,
    assetId,
    filePath: assetPath(environment.filename),
    assetUrl: `${CATALOG_ORIGIN}/v0/catalog/media-assets/file/${encodeURIComponent(assetId)}`,
    previewUrl: `${CATALOG_ORIGIN}/v0/catalog/media-assets/file/${encodeURIComponent(assetId)}`,
  };
});

const state = {
  startedAt: new Date().toISOString(),
  selectedEnvironmentId: ENVIRONMENTS[0].id,
  cueCounter: 0,
  payloads: new Map(),
  cues: [],
  acks: [],
  logs: [],
};

function pad4Length(length) {
  return length + ((4 - (length % 4)) % 4);
}

function stringBuffer(value) {
  const raw = Buffer.from(String(value == null ? "" : value), "utf8");
  const length = pad4Length(raw.length + 1);
  const buffer = Buffer.alloc(length);
  raw.copy(buffer, 0);
  return buffer;
}

function readOscString(buffer, offset) {
  let end = offset;
  while (end < buffer.length && buffer[end] !== 0) end += 1;
  const value = buffer.slice(offset, end).toString("utf8");
  return {
    value,
    nextOffset: pad4Length(end + 1),
  };
}

function encodeOscMessage(address, args = []) {
  const typeTags = `,${args.map(() => "s").join("")}`;
  return Buffer.concat([
    stringBuffer(address),
    stringBuffer(typeTags),
    ...args.map(stringBuffer),
  ]);
}

function decodeOscMessage(buffer) {
  const address = readOscString(buffer, 0);
  const typeTags = readOscString(buffer, address.nextOffset);
  const tags = typeTags.value.startsWith(",") ? typeTags.value.slice(1) : "";
  let offset = typeTags.nextOffset;
  const args = [];
  for (const tag of tags) {
    if (tag !== "s") throw new Error(`unsupported_osc_type:${tag}`);
    const arg = readOscString(buffer, offset);
    args.push(arg.value);
    offset = arg.nextOffset;
  }
  return {
    address: address.value,
    args,
  };
}

function log(message, details = {}) {
  const item = {
    at: new Date().toISOString(),
    message,
    ...details,
  };
  state.logs.unshift(item);
  state.logs = state.logs.slice(0, 50);
  console.log(`[${item.at}] ${message}`);
}

function findEnvironment(id) {
  return ENVIRONMENTS.find((environment) => environment.id === id || environment.environmentId === id)
    || ENVIRONMENTS[0];
}

function nextEnvironment(currentId) {
  const index = ENVIRONMENTS.findIndex((environment) => environment.id === currentId);
  return ENVIRONMENTS[(index + 1 + ENVIRONMENTS.length) % ENVIRONMENTS.length];
}

function backgroundAsset(environment) {
  return {
    id: environment.assetId,
    assetId: environment.assetId,
    environmentId: environment.environmentId,
    legacyEnvironmentId: environment.legacyEnvironmentId,
    type: "background",
    role: "background",
    status: "present",
    name: environment.filename,
    filename: environment.filename,
    filePath: environment.filePath,
    url: environment.assetUrl,
    mimeType: environment.mimeType,
    extension: path.extname(environment.filename).replace(".", ""),
    relativePath: `assets/${environment.filename}`,
    source: {
      type: "standalone-demo",
    },
  };
}

function environmentPayload(environment, extra = {}) {
  const asset = backgroundAsset(environment);
  return {
    source: {
      type: "standalone-demo-ui",
      readOnly: true,
    },
    showRunId: "show-run:standalone-demo",
    situation: {
      situationId: `situation:demo:${environment.id}`,
      legacySituationId: environment.legacyEnvironmentId,
      title: environment.situationTitle,
    },
    environment: {
      id: environment.environmentId,
      legacyId: environment.legacyEnvironmentId,
      name: environment.name,
    },
    environmentId: environment.environmentId,
    characterIds: [],
    characters: [],
    labelIds: [],
    assets: {
      background: asset,
    },
    environmentAssets: {
      background: asset,
    },
    backgroundAsset: asset,
    assetId: asset.assetId,
    type: "background",
    role: "background",
    filePath: asset.filePath,
    url: asset.url,
    ...extra,
  };
}

function cueId() {
  state.cueCounter += 1;
  const stamp = new Date().toISOString().replace(/[-:.TZ]/g, "");
  return `demo-cue-${stamp}-${String(state.cueCounter).padStart(3, "0")}-${crypto.randomBytes(3).toString("hex")}`;
}

function payloadIdFor(cueIdValue) {
  return `${cueIdValue}:payload:01`;
}

function makeCue(requestBody = {}) {
  const action = String(requestBody.action || "prepare");
  let environment = findEnvironment(requestBody.environmentId || state.selectedEnvironmentId);
  let command = "td.environment.prepare";
  let payload = {};

  if (action === "prepare") {
    state.selectedEnvironmentId = environment.id;
    payload = environmentPayload(environment, {
      cueIntent: "prepare_environment",
    });
  } else if (action === "go") {
    environment = findEnvironment(state.selectedEnvironmentId);
    command = "td.environment.go";
    payload = environmentPayload(environment, {
      cueIntent: "go_environment",
      situationRunId: "situation-run:standalone-demo",
    });
  } else if (action === "stop-next") {
    environment = nextEnvironment(state.selectedEnvironmentId);
    state.selectedEnvironmentId = environment.id;
    payload = environmentPayload(environment, {
      cueIntent: "prepare_next_environment",
      generatedBy: "runtime.stopSituation",
    });
  } else if (action === "camera") {
    const camera = ["1", "2", "3"].includes(String(requestBody.camera)) ? String(requestBody.camera) : "1";
    command = "td.camera.set";
    payload = {
      source: {
        type: "standalone-demo-ui",
        readOnly: true,
      },
      showRunId: "show-run:standalone-demo",
      camera,
      cameraId: `camera:${camera}`,
      cueIntent: "camera_trigger",
    };
  } else if (action === "heartbeat") {
    command = "td.status.heartbeat";
    payload = {
      source: "standalone-demo-ui",
      heartbeatAt: new Date().toISOString(),
    };
  } else {
    throw Object.assign(new Error(`unknown_demo_action:${action}`), { statusCode: 400 });
  }

  const id = cueId();
  const payloadId = payloadIdFor(id);
  const cue = {
    cueId: id,
    payloadId,
    command,
    payload,
    createdAt: new Date().toISOString(),
    status: "sent",
    ack: null,
  };
  state.payloads.set(payloadId, payload);
  state.cues.unshift(cue);
  state.cues = state.cues.slice(0, 30);
  return cue;
}

function sendOscCue(cue) {
  const socket = dgram.createSocket("udp4");
  const packet = encodeOscMessage("/td/cue", [cue.cueId, cue.command, cue.payloadId]);
  return new Promise((resolve, reject) => {
    socket.send(packet, TD_OSC_PORT, HOST, (err) => {
      socket.close();
      if (err) reject(err);
      else resolve();
    });
  });
}

function sendJson(response, statusCode, body) {
  const text = JSON.stringify(body, null, 2);
  response.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(text),
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "GET,POST,OPTIONS",
    "access-control-allow-headers": "content-type",
  });
  response.end(text);
}

function sendText(response, statusCode, text, contentType = "text/plain; charset=utf-8") {
  response.writeHead(statusCode, {
    "content-type": contentType,
    "content-length": Buffer.byteLength(text),
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "GET,POST,OPTIONS",
    "access-control-allow-headers": "content-type",
  });
  response.end(text);
}

function readRequestBody(request) {
  return new Promise((resolve, reject) => {
    let raw = "";
    request.setEncoding("utf8");
    request.on("data", (chunk) => {
      raw += chunk;
      if (raw.length > 1024 * 1024) {
        reject(Object.assign(new Error("request_body_too_large"), { statusCode: 413 }));
      }
    });
    request.on("end", () => {
      if (!raw) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(raw));
      } catch (_err) {
        reject(Object.assign(new Error("invalid_json_body"), { statusCode: 400 }));
      }
    });
    request.on("error", reject);
  });
}

function catalogBody() {
  const mediaAssets = ENVIRONMENTS.map(backgroundAsset);
  return {
    ok: true,
    schemaVersion: "standalone-demo.catalog.v0",
    mediaAssets,
    v2MediaAssets: mediaAssets,
  };
}

function statusBody() {
  const selectedEnvironment = findEnvironment(state.selectedEnvironmentId);
  return {
    ok: true,
    schemaVersion: "standalone-demo.status.v0",
    startedAt: state.startedAt,
    ports: {
      ui: UI_PORT,
      catalog: CATALOG_PORT,
      tdOsc: TD_OSC_PORT,
      tdAck: TD_ACK_PORT,
    },
    selectedEnvironment,
    environments: ENVIRONMENTS.map((environment) => ({
      id: environment.id,
      environmentId: environment.environmentId,
      name: environment.name,
      situationTitle: environment.situationTitle,
      previewUrl: environment.previewUrl,
    })),
    latestCue: state.cues[0] || null,
    latestAck: state.acks[0] || null,
    cueCount: state.cues.length,
    ackCount: state.acks.length,
    cues: state.cues.slice(0, 10),
    acks: state.acks.slice(0, 10),
    logs: state.logs.slice(0, 10),
  };
}

function htmlPage() {
  const envButtons = ENVIRONMENTS.map((environment) => (
    `<button class="env-button" data-action="prepare" data-environment-id="${environment.id}">Prepare ${environment.name}</button>`
  )).join("");

  return `<!doctype html>
<html lang="nl">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>For You TD Demo</title>
  <style>
    :root {
      color-scheme: dark;
      --bg: #15171d;
      --panel: #20242c;
      --panel-2: #2a3039;
      --text: #f2f4f8;
      --muted: #aeb6c3;
      --line: #3a414d;
      --accent: #49b879;
      --accent-2: #5ca8ff;
      --warn: #f1b44c;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      min-height: 100vh;
      background: var(--bg);
      color: var(--text);
      font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      letter-spacing: 0;
    }
    main {
      width: min(1180px, calc(100vw - 32px));
      margin: 0 auto;
      padding: 28px 0 36px;
    }
    header {
      display: flex;
      justify-content: space-between;
      gap: 24px;
      align-items: flex-start;
      margin-bottom: 22px;
    }
    h1 {
      margin: 0 0 8px;
      font-size: 30px;
      line-height: 1.1;
      font-weight: 760;
    }
    p {
      margin: 0;
      color: var(--muted);
      line-height: 1.5;
    }
    .status-pill {
      border: 1px solid var(--line);
      background: var(--panel);
      color: var(--muted);
      border-radius: 999px;
      padding: 8px 12px;
      white-space: nowrap;
      font-size: 14px;
    }
    .status-pill.ok { color: #b9f6cf; border-color: rgba(73, 184, 121, 0.6); }
    .layout {
      display: grid;
      grid-template-columns: minmax(0, 1.1fr) minmax(320px, 0.9fr);
      gap: 18px;
      align-items: start;
    }
    section {
      border: 1px solid var(--line);
      background: var(--panel);
      border-radius: 8px;
      padding: 18px;
    }
    h2 {
      margin: 0 0 14px;
      font-size: 17px;
      line-height: 1.2;
    }
    .button-grid {
      display: grid;
      grid-template-columns: repeat(3, minmax(0, 1fr));
      gap: 10px;
    }
    button {
      min-height: 44px;
      border: 1px solid var(--line);
      border-radius: 7px;
      background: var(--panel-2);
      color: var(--text);
      font: inherit;
      font-weight: 690;
      cursor: pointer;
      transition: border-color 120ms ease, background 120ms ease, transform 120ms ease;
    }
    button:hover {
      border-color: var(--accent-2);
      background: #303947;
    }
    button:active {
      transform: translateY(1px);
    }
    button.primary {
      background: #1f6f47;
      border-color: #3aa56c;
    }
    button.warning {
      background: #6d5522;
      border-color: #b8892f;
    }
    .preview {
      display: grid;
      gap: 12px;
    }
    .preview-frame {
      width: 100%;
      aspect-ratio: 16 / 9;
      border: 1px solid var(--line);
      border-radius: 8px;
      overflow: hidden;
      background: #0f1116;
    }
    .preview-frame img {
      display: block;
      width: 100%;
      height: 100%;
      object-fit: cover;
    }
    .kv {
      display: grid;
      grid-template-columns: 116px minmax(0, 1fr);
      gap: 8px 12px;
      font-size: 14px;
    }
    .kv dt {
      color: var(--muted);
    }
    .kv dd {
      margin: 0;
      overflow-wrap: anywhere;
    }
    pre {
      min-height: 180px;
      max-height: 360px;
      overflow: auto;
      margin: 0;
      padding: 12px;
      border-radius: 7px;
      border: 1px solid var(--line);
      background: #11141a;
      color: #dbe4ef;
      font-size: 12px;
      line-height: 1.45;
      white-space: pre-wrap;
    }
    .stack {
      display: grid;
      gap: 18px;
    }
    .hint {
      margin-top: 12px;
      font-size: 14px;
      color: var(--muted);
    }
    @media (max-width: 840px) {
      header,
      .layout {
        grid-template-columns: 1fr;
        display: grid;
      }
      .button-grid {
        grid-template-columns: 1fr;
      }
      .status-pill {
        white-space: normal;
      }
    }
  </style>
</head>
<body>
  <main>
    <header>
      <div>
        <h1>For You TouchDesigner Demo</h1>
        <p>Open eerst <strong>ForYou TD Demo.toe</strong>. Klik daarna hieronder om echte OSC cues naar TouchDesigner te sturen.</p>
      </div>
      <div id="serverStatus" class="status-pill">Server status ophalen...</div>
    </header>

    <div class="layout">
      <div class="stack">
        <section>
          <h2>Omgeving voorbereiden</h2>
          <div class="button-grid">
            ${envButtons}
          </div>
          <p class="hint">Deze knoppen sturen <code>td.environment.prepare</code> en laden de background in <code>prepared_background</code>.</p>
        </section>

        <section>
          <h2>Situatie en camera</h2>
          <div class="button-grid">
            <button class="primary" data-action="go">Start Situatie</button>
            <button class="warning" data-action="stop-next">Stop + Prepare Next</button>
            <button data-action="heartbeat">Heartbeat</button>
            <button data-action="camera" data-camera="1">Camera 1</button>
            <button data-action="camera" data-camera="2">Camera 2</button>
            <button data-action="camera" data-camera="3">Camera 3</button>
          </div>
          <p class="hint">Camera 1/2/3 lichten nu de TD trigger-nodes op. Ze schakelen nog geen echte camera-feed.</p>
        </section>

        <section>
          <h2>Laatste cue / ack</h2>
          <pre id="eventLog">Nog geen cue verstuurd.</pre>
        </section>
      </div>

      <div class="stack">
        <section class="preview">
          <h2>Gekozen omgeving</h2>
          <div class="preview-frame">
            <img id="previewImage" alt="Voorbeeld background" src="">
          </div>
          <dl class="kv">
            <dt>Omgeving</dt>
            <dd id="envName">-</dd>
            <dt>Environment ID</dt>
            <dd id="envId">-</dd>
            <dt>UI poort</dt>
            <dd id="uiPort">-</dd>
            <dt>Catalog poort</dt>
            <dd id="catalogPort">-</dd>
            <dt>TD OSC</dt>
            <dd id="tdOscPort">-</dd>
            <dt>TD ack</dt>
            <dd id="tdAckPort">-</dd>
          </dl>
        </section>

        <section>
          <h2>Wat je in TouchDesigner moet zien</h2>
          <p>Bij prepare licht <code>trigger_start_run_prepare</code> op en verandert <code>prepared_background</code>. Bij start licht <code>trigger_start_situation_go</code> op. Bij camera knoppen lichten <code>trigger_camera_1</code>, <code>trigger_camera_2</code> of <code>trigger_camera_3</code> op.</p>
        </section>
      </div>
    </div>
  </main>

  <script>
    async function requestJson(path, options) {
      const response = await fetch(path, options);
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || response.statusText);
      return body;
    }

    async function sendCue(button) {
      const body = {
        action: button.dataset.action,
        environmentId: button.dataset.environmentId,
        camera: button.dataset.camera,
      };
      button.disabled = true;
      try {
        const result = await requestJson("/api/demo/cue", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        });
        renderStatus(result.status);
      } catch (err) {
        document.getElementById("eventLog").textContent = String(err.stack || err.message || err);
      } finally {
        button.disabled = false;
      }
    }

    function renderStatus(status) {
      document.getElementById("serverStatus").textContent = "Server actief";
      document.getElementById("serverStatus").classList.add("ok");
      const env = status.selectedEnvironment || {};
      document.getElementById("envName").textContent = env.name || "-";
      document.getElementById("envId").textContent = env.environmentId || "-";
      document.getElementById("uiPort").textContent = status.ports ? status.ports.ui : "-";
      document.getElementById("catalogPort").textContent = status.ports ? status.ports.catalog : "-";
      document.getElementById("tdOscPort").textContent = status.ports ? status.ports.tdOsc : "-";
      document.getElementById("tdAckPort").textContent = status.ports ? status.ports.tdAck : "-";
      if (env.previewUrl) document.getElementById("previewImage").src = env.previewUrl;

      const compact = {
        latestCue: status.latestCue && {
          cueId: status.latestCue.cueId,
          command: status.latestCue.command,
          payloadId: status.latestCue.payloadId,
          status: status.latestCue.status,
        },
        latestAck: status.latestAck,
        recentLogs: status.logs,
      };
      document.getElementById("eventLog").textContent = JSON.stringify(compact, null, 2);
    }

    async function pollStatus() {
      try {
        renderStatus(await requestJson("/api/demo/status"));
      } catch (err) {
        document.getElementById("serverStatus").textContent = "Server fout: " + err.message;
      }
    }

    for (const button of document.querySelectorAll("button[data-action]")) {
      button.addEventListener("click", () => sendCue(button));
    }

    pollStatus();
    setInterval(pollStatus, 1000);
  </script>
</body>
</html>`;
}

function serveAsset(response, assetId) {
  const environment = ENVIRONMENTS.find((item) => item.assetId === assetId);
  if (!environment) {
    sendJson(response, 404, { ok: false, error: "asset_not_found" });
    return;
  }
  response.writeHead(200, {
    "content-type": environment.mimeType,
    "access-control-allow-origin": "*",
    "cache-control": "no-store",
  });
  fs.createReadStream(environment.filePath).pipe(response);
}

async function handleUiRequest(request, response) {
  const url = new URL(request.url, UI_ORIGIN);
  if (request.method === "OPTIONS") {
    sendText(response, 204, "");
    return;
  }
  if (request.method === "GET" && url.pathname === "/") {
    sendText(response, 200, htmlPage(), "text/html; charset=utf-8");
    return;
  }
  if (request.method === "GET" && url.pathname === "/api/demo/status") {
    sendJson(response, 200, statusBody());
    return;
  }
  if (request.method === "POST" && url.pathname === "/api/demo/cue") {
    try {
      const body = await readRequestBody(request);
      const cue = makeCue(body);
      await sendOscCue(cue);
      log(`sent ${cue.command}`, { cueId: cue.cueId, payloadId: cue.payloadId });
      sendJson(response, 201, { ok: true, cue, status: statusBody() });
    } catch (err) {
      log("cue send failed", { error: err.message });
      sendJson(response, err.statusCode || 500, { ok: false, error: err.message || String(err) });
    }
    return;
  }
  if (request.method === "GET" && url.pathname.startsWith("/api/show-control/payloads/")) {
    const payloadId = decodeURIComponent(url.pathname.slice("/api/show-control/payloads/".length));
    const payload = state.payloads.get(payloadId);
    if (!payload) {
      sendJson(response, 404, { ok: false, error: "payload_not_found", payloadId });
      return;
    }
    sendJson(response, 200, payload);
    return;
  }
  sendJson(response, 404, { ok: false, error: "not_found" });
}

async function handleCatalogRequest(request, response) {
  const url = new URL(request.url, CATALOG_ORIGIN);
  if (request.method === "OPTIONS") {
    sendText(response, 204, "");
    return;
  }
  if (request.method === "GET" && url.pathname === "/v0/catalog/media-assets") {
    sendJson(response, 200, catalogBody());
    return;
  }
  if (request.method === "GET" && url.pathname.startsWith("/v0/catalog/media-assets/file/")) {
    const assetId = decodeURIComponent(url.pathname.slice("/v0/catalog/media-assets/file/".length));
    serveAsset(response, assetId);
    return;
  }
  sendJson(response, 404, { ok: false, error: "not_found" });
}

function listen(server, port, label) {
  return new Promise((resolve, reject) => {
    server.once("error", (err) => {
      if (err.code === "EADDRINUSE") {
        reject(new Error(`${label} kan niet starten: poort ${port} is al in gebruik.`));
      } else {
        reject(err);
      }
    });
    server.listen(port, HOST, () => resolve());
  });
}

function startAckServer() {
  const socket = dgram.createSocket("udp4");
  socket.on("message", (buffer) => {
    try {
      const message = decodeOscMessage(buffer);
      if (message.address !== "/td/ack") return;
      const [cueIdValue, command, stage, status, ackMessage] = message.args;
      const ack = {
        at: new Date().toISOString(),
        cueId: cueIdValue || "",
        command: command || "",
        stage: stage || "",
        status: status || "",
        message: ackMessage || "",
      };
      state.acks.unshift(ack);
      state.acks = state.acks.slice(0, 30);
      const cue = state.cues.find((item) => item.cueId === ack.cueId);
      if (cue) {
        cue.ack = ack;
        cue.status = ack.status === "ok" ? "acked" : ack.status;
      }
      log(`ack ${ack.command} ${ack.stage}/${ack.status}`, { cueId: ack.cueId });
    } catch (err) {
      log("ack decode failed", { error: err.message });
    }
  });
  return new Promise((resolve, reject) => {
    socket.once("error", (err) => {
      if (err.code === "EADDRINUSE") {
        reject(new Error(`TD ack listener kan niet starten: poort ${TD_ACK_PORT} is al in gebruik.`));
      } else {
        reject(err);
      }
    });
    socket.bind(TD_ACK_PORT, HOST, () => resolve(socket));
  });
}

async function main() {
  for (const environment of ENVIRONMENTS) {
    if (!fs.existsSync(environment.filePath)) {
      throw new Error(`Demo asset ontbreekt: ${environment.filePath}`);
    }
  }

  const uiServer = http.createServer((request, response) => {
    handleUiRequest(request, response).catch((err) => {
      sendJson(response, err.statusCode || 500, { ok: false, error: err.message || String(err) });
    });
  });
  const catalogServer = http.createServer((request, response) => {
    handleCatalogRequest(request, response).catch((err) => {
      sendJson(response, err.statusCode || 500, { ok: false, error: err.message || String(err) });
    });
  });

  const ackSocket = await startAckServer();
  await listen(uiServer, UI_PORT, "Demo webserver");
  await listen(catalogServer, CATALOG_PORT, "Demo catalog server");

  log("For You TD demo server gestart");
  console.log("");
  console.log(`Webpagina:       ${UI_ORIGIN}`);
  console.log(`Catalog API:     ${CATALOG_ORIGIN}/v0/catalog/media-assets`);
  console.log(`Naar TD OSC:     ${HOST}:${TD_OSC_PORT}`);
  console.log(`TD ack listener: ${HOST}:${TD_ACK_PORT}`);
  console.log("");
  console.log("Open nu 'ForYou TD Demo.toe' in TouchDesigner en klik op de knoppen in de webpagina.");

  function shutdown() {
    console.log("\nDemo server stopt...");
    ackSocket.close();
    uiServer.close();
    catalogServer.close();
    setTimeout(() => process.exit(0), 50).unref();
  }
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((err) => {
  console.error("");
  console.error(err.message || String(err));
  console.error("");
  console.error("Sluit eventueel andere ForYou/Show Control processen, of wijzig tijdelijk de poorten met:");
  console.error("DEMO_UI_PORT=3045 DEMO_CATALOG_PORT=3041 DEMO_TD_OSC_PORT=9120 DEMO_TD_ACK_PORT=9121 node demo-server.js");
  process.exit(1);
});
