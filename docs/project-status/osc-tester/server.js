const http = require("http");
const osc = require("osc");
const WebSocket = require("ws");

const TOOL_PORT = Number(process.env.OSC_TOOL_PORT || 3099);
const APP_HOST = process.env.FORYOU_APP_HOST || "127.0.0.1";
const APP_PORT = Number(process.env.FORYOU_APP_PORT || 3010);
const FOR_UNIVERSE_PATH = process.env.FOR_UNIVERSE_PATH || "/universe";
const FOR_UNIVERSE_URL = process.env.FOR_UNIVERSE_URL || "";
let appOscPort = Number(process.env.FORYOU_OSC_RECEIVE_PORT || 1234);
let monitorPort = Number(process.env.FORYOU_OSC_MONITOR_PORT || 9002);

const clients = new Set();
let received = [];
let receivePort = null;
let sendPort = null;
let originalOscSettings = null;
let adminToken = String(process.env.FORYOU_ADMIN_TOKEN || "");

const FALLBACK_RECEIVE_COMMANDS = Object.freeze([
  { address: "/foryou/session/new", args: "[naam]", description: "Start een nieuwe sessie (zonder join-token).", feedback: true },
  { address: "/foryou/session/new_with_token", args: "[naam] [ttl_minutes]", description: "Start nieuwe sessie + genereer join-token/QR-link.", feedback: true },
  { address: "/foryou/session/end", args: "(geen)", description: "Beeindig de huidige sessie en verbreek clients.", feedback: true },
  { address: "/foryou/show/start", args: "(geen)", description: "Start show: sessie indien nodig, run resetten en run starten.", feedback: true },
  { address: "/foryou/show/stop", args: "(geen)", description: "Stop show: run resetten en sessie beeindigen zonder herstart.", feedback: true },
  { address: "/foryou/stage/show_qr", args: "0|1", description: "Zet QR op stage uit/aan.", feedback: false },
  { address: "/foryou/stage/show_chat", args: "0|1", description: "Zet stage-chat uit/aan.", feedback: false },
  { address: "/foryou/stage/show_emojis", args: "0|1", description: "Zet stage-emoji laag uit/aan.", feedback: false },
  { address: "/foryou/stage/background", args: "transparent|black", description: "Stel stage-achtergrond in.", feedback: false },
  { address: "/foryou/stage/patch_json", args: "{\"showQr\":true,...}", description: "Patch stage-instellingen via JSON object.", feedback: false },
  { address: "/foryou/sim/start", args: "[json_config]", description: "Start botsimulatie (optioneel met JSON config).", feedback: true },
  { address: "/foryou/sim/stop", args: "[reason]", description: "Stop botsimulatie.", feedback: true },
  { address: "/foryou/sim/toggle", args: "[json_config]", description: "Toggle botsimulatie (start/stop).", feedback: true },
  { address: "/foryou/sim/update_json", args: "{\"clients\":80,...}", description: "Update botsimulatie config live via JSON.", feedback: false },
  { address: "/foryou/sim/save_defaults_json", args: "{\"clients\":80,...}", description: "Sla bot-standaard op via JSON config.", feedback: false },
  { address: "/foryou/algorithm/state", args: "(geen)", description: "Vraag compacte algoritme-status op.", feedback: true },
  { address: "/foryou/algorithm/next", args: "(geen)", description: "Vraag de volgende concrete algoritme-situatie + prompt op.", feedback: true },
  { address: "/foryou/algorithm/start_run", args: "(geen)", description: "Start de algoritme-run en stuur Up Next naar TouchDesigner.", feedback: true },
  { address: "/foryou/algorithm/start_next", args: "(geen)", description: "Start de situatie die nu als Up Next klaarstaat.", feedback: true },
  { address: "/foryou/algorithm/start_scene", args: "[scene_id]", description: "Start een algoritme-situatie-run.", feedback: true },
  { address: "/foryou/algorithm/end_scene", args: "(geen)", description: "Eindig de actieve algoritme-situatie-run en geef de volgende situatie terug.", feedback: true },
  { address: "/foryou/algorithm/previous_scene", args: "(geen)", description: "Zet de vorige algoritme-situatie weer actief en stuur de nieuwe Up Next.", feedback: true },
  { address: "/foryou/algorithm/reset_run", args: "(geen)", description: "Reset alle algoritme-runs van de huidige sessie.", feedback: true },
  { address: "/foryou/algorithm/select_scene", args: "[scene_id]", description: "Selecteer een vaste situatie en ontvang de prompt zonder een run te starten.", feedback: true },
  { address: "/foryou/admin/restart", args: "(geen)", description: "Start server-restart flow (zelfde als admin knop).", feedback: true },
  { address: "/foryou/admin/stop", args: "(geen)", description: "Stop server-proces (zelfde als admin knop).", feedback: true },
]);

const COMMAND_LABELS = Object.freeze({
  "/foryou/session/new": "Nieuwe sessie",
  "/foryou/session/new_with_token": "Nieuwe sessie + join-token",
  "/foryou/session/end": "Stop sessie",
  "/foryou/show/start": "Start show",
  "/foryou/show/stop": "Stop show",
  "/foryou/stage/show_qr": "QR aan/uit",
  "/foryou/stage/show_chat": "Chat aan/uit",
  "/foryou/stage/show_emojis": "Emojis aan/uit",
  "/foryou/stage/background": "Stage achtergrond",
  "/foryou/stage/patch_json": "Stage patch JSON",
  "/foryou/sim/start": "Start botsimulatie",
  "/foryou/sim/stop": "Stop botsimulatie",
  "/foryou/sim/toggle": "Toggle botsimulatie",
  "/foryou/sim/update_json": "Update botsimulatie JSON",
  "/foryou/sim/save_defaults_json": "Sla bot defaults op",
  "/foryou/algorithm/state": "Check algoritme-status",
  "/foryou/algorithm/next": "Check volgende situatie",
  "/foryou/algorithm/start_run": "Start algorithm-run",
  "/foryou/algorithm/start_next": "Start volgende situatie",
  "/foryou/algorithm/start_scene": "Start situatie op ID",
  "/foryou/algorithm/end_scene": "Stop huidige situatie",
  "/foryou/algorithm/previous_scene": "Vorige situatie",
  "/foryou/algorithm/reset_run": "Reset run",
  "/foryou/algorithm/select_scene": "Selecteer situatie",
  "/foryou/admin/restart": "Restart server",
  "/foryou/admin/stop": "Stop server",
});

function labelCommand(cmd) {
  const address = String(cmd && cmd.address || "");
  return {
    ...cmd,
    label: COMMAND_LABELS[address] || String(cmd && cmd.label || "") || address,
  };
}

function nowIso() {
  return new Date().toISOString();
}

function sendJson(res, status, body) {
  const json = JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(json),
  });
  res.end(json);
}

function readRequestJson(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > 1024 * 1024) {
        reject(new Error("request_too_large"));
        req.destroy();
      }
    });
    req.on("end", () => {
      if (!body.trim()) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(body));
      } catch {
        reject(new Error("invalid_json"));
      }
    });
    req.on("error", reject);
  });
}

function broadcast(type, payload) {
  const message = JSON.stringify({ type, ...payload });
  for (const client of clients) {
    if (client.readyState !== WebSocket.OPEN) continue;
    client.send(message);
  }
}

function decodeArgs(args) {
  if (!Array.isArray(args)) return [];
  return args.map((arg) => {
    if (arg && typeof arg === "object" && Object.prototype.hasOwnProperty.call(arg, "value")) return arg.value;
    return arg;
  });
}

function openOscSendPort() {
  if (sendPort) return sendPort;
  sendPort = new osc.UDPPort({
    localAddress: "127.0.0.1",
    localPort: 0,
  });
  sendPort.on("error", (err) => broadcast("error", { message: `OSC send error: ${err.message || err}` }));
  sendPort.open();
  return sendPort;
}

function closeReceivePort() {
  if (!receivePort) return;
  try {
    receivePort.close();
  } catch {}
  receivePort = null;
}

function openReceivePort(port = monitorPort) {
  closeReceivePort();
  monitorPort = Number(port || monitorPort);
  receivePort = new osc.UDPPort({
    localAddress: "0.0.0.0",
    localPort: monitorPort,
    metadata: true,
  });
  receivePort.on("ready", () => {
    broadcast("status", {
      monitorPort,
      appOscPort,
      adminReady: !!adminToken,
      message: `Listening for OSC feedback on ${monitorPort}`,
    });
  });
  receivePort.on("message", (msg, timeTag, info) => {
    const entry = {
      at: nowIso(),
      address: String(msg.address || ""),
      args: decodeArgs(msg.args || []),
      from: info || null,
    };
    received.unshift(entry);
    received = received.slice(0, 100);
    broadcast("osc", { entry, received });
  });
  receivePort.on("error", (err) => {
    broadcast("error", { message: `OSC receive error: ${err.message || err}` });
  });
  receivePort.open();
}

function appHeaders(payload) {
  const headers = payload
    ? {
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(payload),
      }
    : {};
  if (adminToken) headers["x-admin-token"] = adminToken;
  return headers;
}

function requestApp(method, path, body, options = {}) {
  return new Promise((resolve, reject) => {
    const payload = body ? JSON.stringify(body) : "";
    const token = String(options.token !== undefined ? options.token : adminToken || "");
    const headers = appHeaders(payload);
    if (token) headers["x-admin-token"] = token;
    const req = http.request(
      {
        host: APP_HOST,
        port: APP_PORT,
        path,
        method,
        headers,
      },
      (res) => {
        let data = "";
        res.on("data", (chunk) => {
          data += chunk;
        });
        res.on("end", () => {
          let json = null;
          try {
            json = data ? JSON.parse(data) : null;
          } catch {}
          resolve({ status: res.statusCode, body: data, json });
        });
      }
    );
    req.on("error", reject);
    if (payload) req.write(payload);
    req.end();
  });
}

async function loginToApp(password) {
  const result = await requestApp("POST", "/admin/login", {
    password: String(password || ""),
    rememberDevice: false,
    deviceLabel: "For You OSC Tester",
  }, { token: "" });
  if (!result.json || !result.json.ok || !result.json.token) {
    const error = result.json && result.json.error ? result.json.error : `login_failed_${result.status}`;
    throw new Error(error);
  }
  adminToken = String(result.json.token || "");
  broadcast("status", { monitorPort, appOscPort, adminReady: !!adminToken, message: "Admin login OK" });
  return result.json;
}

async function getAppState() {
  const result = await requestApp("GET", "/admin/algorithm/state");
  if (result.status === 401) throw new Error("admin_token_required");
  if (!result.json || !result.json.ok) throw new Error(result.body || `App state failed (${result.status})`);
  return result.json;
}

async function getAppOscState() {
  const state = await getAppState();
  if (!state.osc) throw new Error("osc_state_missing");
  return state.osc;
}

async function getCommands() {
  const state = await getAppState();
  const oscState = state.osc || {};
  appOscPort = Number(oscState.listenPort || appOscPort);
  return {
    osc: oscState,
    receiveCommands: Array.isArray(oscState.receiveCommands) ? oscState.receiveCommands.map(labelCommand) : [],
    sendCommands: Array.isArray(oscState.sendCommands) ? oscState.sendCommands.map(labelCommand) : [],
  };
}

async function configureAppLocal() {
  const oscState = await getAppOscState();
  if (!originalOscSettings) {
    originalOscSettings = {
      listenPort: Number(oscState.listenPort || appOscPort),
      sendEnabled: !!oscState.sendEnabled,
      sendHost: String(oscState.feedbackHost || ""),
      sendPort: Number(oscState.feedbackPort || 0),
      currentScenePort: Number(oscState.currentScenePort || 8005),
    };
  }
  appOscPort = Number(oscState.listenPort || appOscPort);
  const result = await requestApp("POST", "/admin/algorithm/osc/settings", {
    listenPort: appOscPort,
    sendEnabled: true,
    sendHost: "127.0.0.1",
    sendPort: monitorPort,
    currentScenePort: Number(oscState.currentScenePort || 8005),
  });
  if (result.status === 401) throw new Error("admin_token_required");
  if (!result.json || !result.json.ok) throw new Error(result.body || "configure failed");
  return result.json.osc;
}

async function restoreAppOsc() {
  if (!originalOscSettings) return await getAppOscState();
  const result = await requestApp("POST", "/admin/algorithm/osc/settings", originalOscSettings);
  if (result.status === 401) throw new Error("admin_token_required");
  if (!result.json || !result.json.ok) throw new Error(result.body || "restore failed");
  return result.json.osc;
}

function coerceArgValue(value) {
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (value === null || value === undefined) return "";
  if (typeof value !== "string") return JSON.stringify(value);
  const trimmed = value.trim();
  if (!trimmed) return "";
  if (trimmed === "true") return true;
  if (trimmed === "false") return false;
  if (/^-?\d+$/.test(trimmed)) return Number.parseInt(trimmed, 10);
  if (/^-?\d+\.\d+$/.test(trimmed)) return Number.parseFloat(trimmed);
  return value;
}

function parseOscArgs(rawArgs) {
  const raw = String(rawArgs || "").trim();
  if (!raw) return [];
  if (raw.startsWith("[")) {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) throw new Error("args_json_must_be_array");
    return parsed.map(coerceArgValue);
  }
  if (raw.startsWith("{")) return [raw];
  return raw.split(",").map((part) => coerceArgValue(part.trim()));
}

function sendOsc(address, args = []) {
  return new Promise((resolve, reject) => {
    const safeAddress = String(address || "").trim();
    if (!safeAddress.startsWith("/")) {
      reject(new Error("invalid_osc_address"));
      return;
    }
    const port = openOscSendPort();
    const packet = { address: safeAddress, args: Array.isArray(args) ? args : [] };
    const send = () => {
      try {
        port.send(packet, APP_HOST, appOscPort);
        const entry = { at: nowIso(), address: safeAddress, args: packet.args, appHost: APP_HOST, appOscPort };
        broadcast("sent", { entry });
        resolve(entry);
      } catch (err) {
        reject(err);
      }
    };
    if (port.socket) send();
    else port.once("ready", send);
  });
}

const page = `<!doctype html>
<html lang="nl">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>For You OSC Tester</title>
  <style>
    :root { color-scheme: light; font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
    body { margin: 0; background: #f6f7f9; color: #15181f; }
    main { max-width: 1280px; margin: 0 auto; padding: 28px; }
    h1 { font-size: 28px; margin: 0 0 6px; }
    p { color: #556070; margin: 0; }
    input { border: 1px solid #bcc4d0; border-radius: 7px; padding: 9px 10px; font: inherit; min-width: 0; }
    button { border: 1px solid #bcc4d0; background: #fff; color: #15181f; border-radius: 7px; padding: 10px 13px; font-weight: 650; cursor: pointer; }
    button.primary { background: #155eef; border-color: #155eef; color: #fff; }
    button.danger { background: #b42318; border-color: #b42318; color: #fff; }
    button.small { padding: 7px 10px; font-size: 13px; }
    button:disabled { opacity: .55; cursor: wait; }
    a.buttonLink { display: inline-flex; align-items: center; justify-content: center; border: 1px solid #bcc4d0; background: #fff; color: #15181f; border-radius: 7px; padding: 10px 13px; font-weight: 650; text-decoration: none; }
    a.buttonLink.primary { background: #155eef; border-color: #155eef; color: #fff; }
    .bar { display: flex; flex-wrap: wrap; gap: 10px; margin: 18px 0; align-items: center; }
    .grid { display: grid; grid-template-columns: minmax(360px, 0.92fr) minmax(480px, 1.35fr); gap: 16px; align-items: start; }
    .panel { background: #fff; border: 1px solid #d9dee7; border-radius: 8px; padding: 16px; }
    .panel h2 { margin: 0 0 12px; font-size: 16px; }
    .status { display: grid; gap: 8px; font-size: 14px; }
    .pill { display: inline-flex; align-items: center; gap: 6px; border-radius: 999px; background: #eef2f7; padding: 4px 9px; color: #344054; }
    .ok { color: #067647; }
    .bad { color: #b42318; }
    .muted { color: #667085; font-size: 13px; }
    .loginRow { display: grid; grid-template-columns: 1fr auto; gap: 8px; }
    .commandTools { display: grid; grid-template-columns: 1fr; gap: 8px; margin-bottom: 12px; }
    .commandList { display: grid; gap: 10px; max-height: 660px; overflow: auto; }
    .command { border: 1px solid #edf0f4; border-radius: 7px; padding: 10px; background: #fbfcfe; display: grid; gap: 8px; }
    .commandHeader { display: flex; gap: 8px; justify-content: space-between; align-items: start; }
    .commandTitle { font-size: 15px; font-weight: 800; margin-bottom: 3px; }
    .commandAddress { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 13px; font-weight: 700; }
    .commandDesc { color: #475467; font-size: 13px; }
    .commandSend { display: grid; grid-template-columns: minmax(120px, 1fr) auto; gap: 8px; }
    .quickGrid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 10px; margin-bottom: 14px; }
    .quickGrid button { min-height: 48px; }
    .log { display: grid; gap: 10px; max-height: 620px; overflow: auto; }
    .entry { border: 1px solid #edf0f4; border-radius: 7px; padding: 10px; background: #fbfcfe; }
    .entry strong { display: block; font-size: 13px; }
    .entry code { display: block; white-space: pre-wrap; word-break: break-word; font-size: 12px; color: #344054; margin-top: 6px; }
    details { border: 1px solid #e4e7ec; border-radius: 8px; padding: 10px 12px; background: #fff; }
    details + details { margin-top: 12px; }
    summary { cursor: pointer; font-weight: 700; }
    @media (max-width: 980px) { .grid { grid-template-columns: 1fr; } main { padding: 18px; } .quickGrid { grid-template-columns: 1fr; } }
  </style>
</head>
<body>
  <main>
    <h1>For You OSC Tester</h1>
    <p>Alle OSC receive-commands uit de app-state, met werkende send-knoppen en feedbackmonitor.</p>
    <div class="bar">
      <button id="configure" class="primary">Gebruik lokale feedback target</button>
      <button id="restore">Herstel originele OSC target</button>
      <button id="reloadCommands">Reload commands</button>
      <a id="universeLink" class="buttonLink primary" href="${FOR_UNIVERSE_URL || "#"}" data-app-port="${APP_PORT}" data-universe-path="${FOR_UNIVERSE_PATH}" data-universe-url="${FOR_UNIVERSE_URL}" target="_blank" rel="noreferrer">Open For_universe</a>
      <button id="clear">Clear log</button>
    </div>
    <div class="grid">
      <section class="panel">
        <h2>Status</h2>
        <div class="status">
          <div><span class="pill">App OSC receive: <b id="receive">127.0.0.1:${appOscPort}</b></span></div>
          <div><span class="pill">Monitor feedback: <b id="monitor">0.0.0.0:${monitorPort}</b></span></div>
          <div><span class="pill">For_universe: <b id="universeUrl">wordt bepaald...</b></span></div>
          <div><span class="pill">App feedback target: <b id="target">onbekend</b></span></div>
          <div><span class="pill">Admin: <b id="admin">onbekend</b></span></div>
          <div id="connection" class="bad">Browser bridge: disconnected</div>
          <div id="message"></div>
        </div>
        <div class="bar">
          <div class="loginRow" style="width:100%;">
            <input id="password" type="password" placeholder="Admin wachtwoord of leeg bij auth disabled" />
            <button id="login" class="small">Login</button>
          </div>
          <div class="loginRow" style="width:100%;">
            <input id="token" type="password" placeholder="Of plak x-admin-token" />
            <button id="setToken" class="small">Use token</button>
          </div>
        </div>
        <details open>
          <summary>OSC log</summary>
          <div id="log" class="log" style="margin-top:10px;"></div>
        </details>
      </section>
      <section class="panel">
        <h2>Commands</h2>
        <div class="quickGrid">
          <button class="primary quickCommand" data-command="/foryou/algorithm/next">Check volgende situatie</button>
          <button class="primary quickCommand" data-command="/foryou/algorithm/start_next">Start volgende situatie</button>
          <button class="danger quickCommand" data-command="/foryou/algorithm/end_scene">Stop huidige situatie</button>
        </div>
        <div class="commandTools">
          <input id="filter" placeholder="Filter commands..." />
          <div class="muted" id="commandCount">Nog geen commands geladen.</div>
        </div>
        <div id="commands" class="commandList"></div>
        <details>
          <summary>Uitgaande OSC adressen vanuit de app</summary>
          <div id="sendCommands" class="commandList" style="margin-top:10px;"></div>
        </details>
      </section>
    </div>
  </main>
  <script>
    const logEl = document.getElementById("log");
    const messageEl = document.getElementById("message");
    const receiveEl = document.getElementById("receive");
    const monitorEl = document.getElementById("monitor");
    const targetEl = document.getElementById("target");
    const adminEl = document.getElementById("admin");
    const connectionEl = document.getElementById("connection");
    const commandsEl = document.getElementById("commands");
    const sendCommandsEl = document.getElementById("sendCommands");
    const commandCountEl = document.getElementById("commandCount");
    const filterEl = document.getElementById("filter");
    const universeLinkEl = document.getElementById("universeLink");
    const universeUrlEl = document.getElementById("universeUrl");
    const buttons = [...document.querySelectorAll("button")];
    let receiveCommands = [];
    let sendCommands = [];
    const commandLabels = ${JSON.stringify(COMMAND_LABELS)};

    function resolveUniverseUrl() {
      const explicit = String(universeLinkEl.dataset.universeUrl || "").trim();
      if (explicit) return explicit;
      const protocol = window.location.protocol || "http:";
      const hostname = window.location.hostname || "127.0.0.1";
      const appPort = String(universeLinkEl.dataset.appPort || "3010").trim();
      const universePath = String(universeLinkEl.dataset.universePath || "/universe").trim() || "/universe";
      return protocol + "//" + hostname + ":" + appPort + universePath;
    }
    function updateUniverseLink() {
      const url = resolveUniverseUrl();
      universeLinkEl.href = url;
      universeUrlEl.textContent = url;
    }

    function setBusy(busy) { buttons.forEach((btn) => btn.disabled = busy); }
    function setMessage(text, error) {
      messageEl.textContent = text || "";
      messageEl.className = error ? "bad" : "";
    }
    function updateOscStatus(osc) {
      if (!osc) return;
      receiveEl.textContent = "127.0.0.1:" + (osc.listenPort || ${appOscPort});
      monitorEl.textContent = "0.0.0.0:${monitorPort}";
      targetEl.textContent = (osc.feedbackHost || "reply-to-sender") + ":" + (osc.feedbackPort || 0);
    }
    function addLog(kind, data) {
      const div = document.createElement("div");
      div.className = "entry";
      const title = data.entry ? data.entry.address || kind : kind;
      div.innerHTML = "<strong>" + new Date().toLocaleTimeString() + " · " + title + "</strong><code></code>";
      div.querySelector("code").textContent = JSON.stringify(data, null, 2);
      logEl.prepend(div);
    }
    async function postJson(path, body) {
      const res = await fetch(path, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body || {}),
      });
      const json = await res.json();
      if (!json.ok) throw new Error(json.error || "request failed");
      return json;
    }
    async function post(path, body) {
      setBusy(true);
      try {
        const json = await postJson(path, body);
        setMessage(json.message || "OK", false);
        if (json.osc) updateOscStatus(json.osc);
        addLog("http", json);
        return json;
      } catch (err) {
        setMessage(err.message || String(err), true);
        addLog("error", { message: messageEl.textContent });
        throw err;
      } finally {
        setBusy(false);
      }
    }
    function argsPlaceholder(cmd) {
      const args = String(cmd.args || "").trim();
      if (!args || args === "(geen)") return "geen args";
      if (args.includes("json") || args.includes("{")) return args;
      return args + "  (comma separated or JSON array)";
    }
    function friendlyCommandName(cmd) {
      const address = String(cmd && cmd.address || "");
      return String((cmd && cmd.label) || commandLabels[address] || address || "Command");
    }
    function commandMatches(cmd, filter) {
      const text = [friendlyCommandName(cmd), cmd.address, cmd.args, cmd.description].join(" ").toLowerCase();
      return text.includes(filter);
    }
    function renderCommands() {
      const filter = filterEl.value.trim().toLowerCase();
      const visible = receiveCommands.filter((cmd) => commandMatches(cmd, filter));
      commandCountEl.textContent = visible.length + " van " + receiveCommands.length + " receive commands";
      commandsEl.textContent = "";
      for (const cmd of visible) {
        const row = document.createElement("div");
        row.className = "command";
        const noArgs = !cmd.args || cmd.args === "(geen)";
        row.innerHTML =
          '<div class="commandHeader"><div><div class="commandTitle"></div><div class="commandAddress"></div><div class="commandDesc"></div></div><span class="pill"></span></div>' +
          '<div class="commandSend"><input class="argInput" /><button class="small primary">Send</button></div>';
        row.querySelector(".commandTitle").textContent = friendlyCommandName(cmd);
        row.querySelector(".commandAddress").textContent = cmd.address || "";
        row.querySelector(".commandDesc").textContent = cmd.description || "";
        row.querySelector(".pill").textContent = cmd.args || "(geen)";
        const input = row.querySelector(".argInput");
        input.placeholder = argsPlaceholder(cmd);
        input.disabled = noArgs;
        const button = row.querySelector("button");
        button.onclick = () => {
          const address = String(cmd.address || "");
          const risky = address === "/foryou/admin/stop"
            || address === "/foryou/admin/restart"
            || address === "/foryou/session/new"
            || address === "/foryou/session/new_with_token"
            || address === "/foryou/session/end"
            || address === "/foryou/show/stop";
          if (risky && !window.confirm("OSC command sturen: " + address + "?")) return;
          post("/api/send-command", { address: cmd.address, argsText: input.value });
        };
        commandsEl.appendChild(row);
      }
      sendCommandsEl.textContent = "";
      for (const cmd of sendCommands) {
        const row = document.createElement("div");
        row.className = "command";
        row.innerHTML = '<div class="commandTitle"></div><div class="commandAddress"></div><div class="commandDesc"></div><span class="pill"></span>';
        row.querySelector(".commandTitle").textContent = friendlyCommandName(cmd);
        row.querySelector(".commandAddress").textContent = cmd.address || "";
        row.querySelector(".commandDesc").textContent = cmd.description || "";
        row.querySelector(".pill").textContent = cmd.args || "";
        sendCommandsEl.appendChild(row);
      }
    }
    async function loadCommands() {
      setBusy(true);
      try {
        const res = await fetch("/api/commands");
        const json = await res.json();
        if (!json.ok) throw new Error(json.error || "commands_failed");
        receiveCommands = json.receiveCommands || [];
        sendCommands = json.sendCommands || [];
        updateOscStatus(json.osc);
        renderCommands();
        setMessage(json.fallback ? "Statische commandlijst geladen. Login voor live OSC-settings." : "Commands geladen.", false);
        addLog("commands", { receiveCommands: receiveCommands.length, sendCommands: sendCommands.length });
      } catch (err) {
        setMessage(err.message || String(err), true);
        addLog("error", { message: messageEl.textContent });
      } finally {
        setBusy(false);
      }
    }
    document.getElementById("configure").onclick = () => post("/api/configure-local");
    document.getElementById("restore").onclick = () => post("/api/restore");
    document.getElementById("reloadCommands").onclick = loadCommands;
    document.getElementById("clear").onclick = () => { logEl.textContent = ""; };
    document.querySelectorAll(".quickCommand").forEach((button) => {
      button.onclick = () => {
        const address = button.getAttribute("data-command") || "";
        if (address === "/foryou/algorithm/end_scene" && !window.confirm("Stop huidige situatie via OSC?")) return;
        post("/api/send-command", { address, argsText: "" });
      };
    });
    document.getElementById("login").onclick = async () => {
      const password = document.getElementById("password").value;
      await post("/api/login", { password });
      adminEl.textContent = "ok";
      await loadCommands();
    };
    document.getElementById("setToken").onclick = async () => {
      const token = document.getElementById("token").value.trim();
      await post("/api/set-token", { token });
      adminEl.textContent = token ? "token set" : "geen token";
      await loadCommands();
    };
    filterEl.oninput = renderCommands;
    const ws = new WebSocket((location.protocol === "https:" ? "wss://" : "ws://") + location.host + "/ws");
    ws.onopen = () => { connectionEl.textContent = "Browser bridge: connected"; connectionEl.className = "ok"; };
    ws.onclose = () => { connectionEl.textContent = "Browser bridge: disconnected"; connectionEl.className = "bad"; };
    ws.onmessage = (event) => {
      const data = JSON.parse(event.data);
      if (data.type === "status") {
        receiveEl.textContent = "127.0.0.1:" + data.appOscPort;
        monitorEl.textContent = "0.0.0.0:" + data.monitorPort;
        adminEl.textContent = data.adminReady ? "ok" : "nodig";
        if (data.target) targetEl.textContent = data.target;
        if (data.message) setMessage(data.message, false);
      }
      addLog(data.type, data);
    };
    updateUniverseLink();
    loadCommands();
  </script>
</body>
</html>`;

const server = http.createServer(async (req, res) => {
  try {
    if (req.method === "GET" && req.url === "/") {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(page);
      return;
    }
    if (req.method === "GET" && req.url === "/api/commands") {
      try {
        sendJson(res, 200, { ok: true, ...(await getCommands()) });
      } catch (err) {
        if (String(err && err.message || "") === "admin_token_required") {
          sendJson(res, 200, {
            ok: true,
            fallback: true,
            osc: {
              listenPort: appOscPort,
              feedbackHost: "",
              feedbackPort: 0,
            },
            receiveCommands: FALLBACK_RECEIVE_COMMANDS.map(labelCommand),
            sendCommands: [],
          });
          return;
        }
        throw err;
      }
      return;
    }
    if (req.method === "POST" && req.url === "/api/login") {
      const body = await readRequestJson(req);
      const login = await loginToApp(body.password);
      sendJson(res, 200, { ok: true, message: "Admin login OK", authDisabled: !!login.authDisabled });
      return;
    }
    if (req.method === "POST" && req.url === "/api/set-token") {
      const body = await readRequestJson(req);
      adminToken = String(body.token || "").trim();
      broadcast("status", { monitorPort, appOscPort, adminReady: !!adminToken, message: adminToken ? "Admin token set" : "Admin token cleared" });
      sendJson(res, 200, { ok: true, message: adminToken ? "Admin token set" : "Admin token cleared" });
      return;
    }
    if (req.method === "POST" && req.url === "/api/configure-local") {
      const oscState = await configureAppLocal();
      sendJson(res, 200, { ok: true, message: "App feedback target set to 127.0.0.1 monitor", osc: oscState });
      return;
    }
    if (req.method === "POST" && req.url === "/api/restore") {
      const oscState = await restoreAppOsc();
      sendJson(res, 200, { ok: true, message: "Original OSC target restored", osc: oscState });
      return;
    }
    if (req.method === "POST" && req.url === "/api/send-command") {
      const body = await readRequestJson(req);
      const entry = await sendOsc(body.address, parseOscArgs(body.argsText || ""));
      sendJson(res, 200, { ok: true, message: `Sent ${entry.address}`, sent: entry });
      return;
    }
    sendJson(res, 404, { ok: false, error: "not_found" });
  } catch (err) {
    sendJson(res, 500, { ok: false, error: err.message || String(err) });
  }
});

const wss = new WebSocket.Server({ server, path: "/ws" });
wss.on("connection", (ws) => {
  clients.add(ws);
  ws.send(JSON.stringify({ type: "status", monitorPort, appOscPort, adminReady: !!adminToken, message: "Connected" }));
  ws.send(JSON.stringify({ type: "history", received }));
  ws.on("close", () => clients.delete(ws));
});

server.listen(TOOL_PORT, "127.0.0.1", () => {
  openReceivePort(monitorPort);
  console.log(`For You OSC Tester: http://127.0.0.1:${TOOL_PORT}`);
});

function shutdown() {
  restoreAppOsc().catch(() => {}).finally(() => {
    closeReceivePort();
    if (sendPort) {
      try {
        sendPort.close();
      } catch {}
    }
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 1000).unref();
  });
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
