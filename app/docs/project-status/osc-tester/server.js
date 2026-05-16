const http = require("http");
const osc = require("osc");
const WebSocket = require("ws");

const TOOL_PORT = Number(process.env.OSC_TOOL_PORT || 3099);
const APP_HOST = process.env.FORYOU_APP_HOST || "127.0.0.1";
const APP_PORT = Number(process.env.FORYOU_APP_PORT || 3010);
let appOscPort = Number(process.env.FORYOU_OSC_RECEIVE_PORT || 1234);
let monitorPort = Number(process.env.FORYOU_OSC_MONITOR_PORT || 9002);

const clients = new Set();
let received = [];
let receivePort = null;
let sendPort = null;
let originalOscSettings = null;

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
    metadata: true,
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

function requestApp(method, path, body) {
  return new Promise((resolve, reject) => {
    const payload = body ? JSON.stringify(body) : "";
    const req = http.request(
      {
        host: APP_HOST,
        port: APP_PORT,
        path,
        method,
        headers: payload
          ? {
              "Content-Type": "application/json",
              "Content-Length": Buffer.byteLength(payload),
            }
          : {},
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

async function getAppOscState() {
  const result = await requestApp("GET", "/admin/algorithm/state");
  if (!result.json || !result.json.osc) throw new Error(`App state failed (${result.status})`);
  return result.json.osc;
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
  if (!result.json || !result.json.ok) throw new Error(result.body || "configure failed");
  return result.json.osc;
}

async function restoreAppOsc() {
  if (!originalOscSettings) return await getAppOscState();
  const result = await requestApp("POST", "/admin/algorithm/osc/settings", originalOscSettings);
  if (!result.json || !result.json.ok) throw new Error(result.body || "restore failed");
  return result.json.osc;
}

function sendOsc(address) {
  return new Promise((resolve, reject) => {
    const port = openOscSendPort();
    const packet = { address, args: [] };
    const send = () => {
      try {
        port.send(packet, APP_HOST, appOscPort);
        const entry = { at: nowIso(), address, appHost: APP_HOST, appOscPort };
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
    main { max-width: 1120px; margin: 0 auto; padding: 28px; }
    h1 { font-size: 28px; margin: 0 0 6px; }
    p { color: #556070; margin: 0; }
    .bar { display: flex; flex-wrap: wrap; gap: 10px; margin: 22px 0; align-items: center; }
    button { border: 1px solid #bcc4d0; background: #fff; color: #15181f; border-radius: 7px; padding: 10px 13px; font-weight: 650; cursor: pointer; }
    button.primary { background: #155eef; border-color: #155eef; color: #fff; }
    button.danger { background: #b42318; border-color: #b42318; color: #fff; }
    button:disabled { opacity: .55; cursor: wait; }
    .grid { display: grid; grid-template-columns: 1fr 1.5fr; gap: 16px; align-items: start; }
    .panel { background: #fff; border: 1px solid #d9dee7; border-radius: 8px; padding: 16px; }
    .panel h2 { margin: 0 0 12px; font-size: 16px; }
    .status { display: grid; gap: 8px; font-size: 14px; }
    .pill { display: inline-flex; align-items: center; gap: 6px; border-radius: 999px; background: #eef2f7; padding: 4px 9px; color: #344054; }
    .ok { color: #067647; }
    .bad { color: #b42318; }
    .log { display: grid; gap: 10px; max-height: 620px; overflow: auto; }
    .entry { border: 1px solid #edf0f4; border-radius: 7px; padding: 10px; background: #fbfcfe; }
    .entry strong { display: block; font-size: 13px; }
    .entry code { display: block; white-space: pre-wrap; word-break: break-word; font-size: 12px; color: #344054; margin-top: 6px; }
    @media (max-width: 800px) { .grid { grid-template-columns: 1fr; } main { padding: 18px; } }
  </style>
</head>
<body>
  <main>
    <h1>For You OSC Tester</h1>
    <p>Stuur show-commands naar de app en monitor feedback op <code>/foryou/control/feedback</code>.</p>
    <div class="bar">
      <button id="configure" class="primary">Gebruik lokale feedback target</button>
      <button id="restore">Herstel originele OSC target</button>
      <button id="start" class="primary">Send /foryou/show/start</button>
      <button id="stop" class="danger">Send /foryou/show/stop</button>
      <button id="clear">Clear log</button>
    </div>
    <div class="grid">
      <section class="panel">
        <h2>Status</h2>
        <div class="status">
          <div><span class="pill">App OSC receive: <b id="receive">127.0.0.1:${appOscPort}</b></span></div>
          <div><span class="pill">Monitor feedback: <b id="monitor">0.0.0.0:${monitorPort}</b></span></div>
          <div><span class="pill">App feedback target: <b id="target">onbekend</b></span></div>
          <div id="connection" class="bad">Browser bridge: disconnected</div>
          <div id="message"></div>
        </div>
      </section>
      <section class="panel">
        <h2>OSC log</h2>
        <div id="log" class="log"></div>
      </section>
    </div>
  </main>
  <script>
    const logEl = document.getElementById("log");
    const messageEl = document.getElementById("message");
    const receiveEl = document.getElementById("receive");
    const monitorEl = document.getElementById("monitor");
    const targetEl = document.getElementById("target");
    const connectionEl = document.getElementById("connection");
    const buttons = [...document.querySelectorAll("button")];
    function setBusy(busy) { buttons.forEach((btn) => btn.disabled = busy); }
    function addLog(kind, data) {
      const div = document.createElement("div");
      div.className = "entry";
      const title = data.entry ? data.entry.address || kind : kind;
      div.innerHTML = "<strong>" + new Date().toLocaleTimeString() + " · " + title + "</strong><code></code>";
      div.querySelector("code").textContent = JSON.stringify(data, null, 2);
      logEl.prepend(div);
    }
    async function post(path) {
      setBusy(true);
      try {
        const res = await fetch(path, { method: "POST" });
        const json = await res.json();
        if (!json.ok) throw new Error(json.error || "request failed");
        messageEl.textContent = json.message || "OK";
        if (json.osc) {
          receiveEl.textContent = "127.0.0.1:" + json.osc.listenPort;
          monitorEl.textContent = "0.0.0.0:${monitorPort}";
          targetEl.textContent = (json.osc.feedbackHost || "reply-to-sender") + ":" + (json.osc.feedbackPort || 0);
        }
        addLog("http", json);
      } catch (err) {
        messageEl.textContent = err.message || String(err);
        addLog("error", { message: messageEl.textContent });
      } finally {
        setBusy(false);
      }
    }
    document.getElementById("configure").onclick = () => post("/api/configure-local");
    document.getElementById("restore").onclick = () => post("/api/restore");
    document.getElementById("start").onclick = () => post("/api/send-start");
    document.getElementById("stop").onclick = () => post("/api/send-stop");
    document.getElementById("clear").onclick = () => { logEl.textContent = ""; };
    const ws = new WebSocket((location.protocol === "https:" ? "wss://" : "ws://") + location.host + "/ws");
    ws.onopen = () => { connectionEl.textContent = "Browser bridge: connected"; connectionEl.className = "ok"; };
    ws.onclose = () => { connectionEl.textContent = "Browser bridge: disconnected"; connectionEl.className = "bad"; };
    ws.onmessage = (event) => {
      const data = JSON.parse(event.data);
      if (data.type === "status") {
        receiveEl.textContent = "127.0.0.1:" + data.appOscPort;
        monitorEl.textContent = "0.0.0.0:" + data.monitorPort;
        if (data.target) targetEl.textContent = data.target;
        messageEl.textContent = data.message || "";
      }
      addLog(data.type, data);
    };
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
    if (req.method === "POST" && req.url === "/api/send-start") {
      const entry = await sendOsc("/foryou/show/start");
      sendJson(res, 200, { ok: true, message: "Sent /foryou/show/start", sent: entry });
      return;
    }
    if (req.method === "POST" && req.url === "/api/send-stop") {
      const entry = await sendOsc("/foryou/show/stop");
      sendJson(res, 200, { ok: true, message: "Sent /foryou/show/stop", sent: entry });
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
  ws.send(JSON.stringify({ type: "status", monitorPort, appOscPort, message: "Connected" }));
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
