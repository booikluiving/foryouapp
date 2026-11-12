"use strict";
// Test: bij een reset van de run wordt de chat leeg op de telefoons en op het zaalscherm.
// Start audience los: tijdelijke DB, nep-runtime op een eigen poort, raakt de draaiende show niet.
// Met "blijf" als tweede argument blijft de testdienst draaien (om de pagina's te bekijken).
const assert = require("node:assert/strict");
const path = require("node:path");
const fs = require("node:fs");
const os = require("node:os");
const http = require("node:http");
const { spawn } = require("node:child_process");

const ROOT = process.argv[2] || path.resolve(__dirname, "../../..");
const BLIJF = process.argv[3] === "blijf";
const WebSocket = require(path.join(ROOT, "node_modules/ws"));
const LAN = 39326, PUB = 39330, RUNTIME = 39324;
const dbDir = fs.mkdtempSync(path.join(os.tmpdir(), "fy-aud-chatreset-"));
const results = [];
const ok = (m) => { results.push("ok  " + m); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Nep-runtime: /v0/runtime/runs/current(/view); POST /run en /reset zetten de stand (voor "blijf").
let run = null;
let runtimeAan = true;
const runtime = http.createServer((req, res) => {
  if (!runtimeAan) { req.socket.destroy(); return; }
  if (req.method === "POST" && req.url === "/run") run = "show-" + Date.now();
  if (req.method === "POST" && req.url === "/reset") run = null;
  res.setHeader("content-type", "application/json");
  res.end(JSON.stringify(run ? { status: "running", showRunId: run, activeSituation: null } : { status: "idle", showRunId: null, activeSituation: null }));
});

let child;
let logs = "";
const lan = (p, o) => fetch(`http://127.0.0.1:${LAN}${p}`, o);
const pub = (p, o) => fetch(`http://127.0.0.1:${PUB}${p}`, { redirect: "manual", ...o });
const post = (p, body) => lan(p, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body || {}) }).then((r) => r.json());

function openWs(cookie) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${PUB}/audience/realtime`, { headers: cookie ? { cookie } : {} });
    const msgs = [];
    ws.on("message", (raw) => msgs.push(JSON.parse(String(raw))));
    ws.on("open", () => resolve({ ws, msgs }));
    ws.on("error", reject);
  });
}

async function openStroom() {
  const controller = new AbortController();
  const res = await fetch(`http://127.0.0.1:${LAN}/audience/stage/stroom`, { signal: controller.signal });
  const msgs = [];
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  (async () => {
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        let i;
        while ((i = buf.indexOf("\n\n")) >= 0) {
          const blok = buf.slice(0, i); buf = buf.slice(i + 2);
          const data = blok.split("\n").filter((l) => l.startsWith("data: ")).map((l) => l.slice(6)).join("\n");
          if (data) msgs.push(JSON.parse(data));
        }
      }
    } catch {}
  })();
  return { msgs, stop: () => controller.abort() };
}

const wachtOp = async (fn, ms = 3000) => {
  const eind = Date.now() + ms;
  while (Date.now() < eind) { if (fn()) return true; await sleep(50); }
  return false;
};

(async () => {
  try {
    await new Promise((r) => runtime.listen(RUNTIME, "127.0.0.1", r));
    child = spawn(process.execPath, [path.join(ROOT, "modules/audience/server/server.js")], {
      cwd: ROOT,
      env: {
        ...process.env,
        AUDIENCE_PORT: String(LAN),
        AUDIENCE_PUBLIC_PORT: String(PUB),
        AUDIENCE_PUBLIC_JOIN_URL: "https://www.foryouniverse.nl/live",
        AUDIENCE_DB_DIR: dbDir,
        AUDIENCE_RUNTIME_URL: `http://127.0.0.1:${RUNTIME}`,
        AUDIENCE_ALGORITHM_URL: "http://127.0.0.1:9",
        AUDIENCE_SHOW_CONTROL_URL: "http://127.0.0.1:9",
        AUDIENCE_FASE_POLL_MS: "250",
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    child.stdout.on("data", (d) => { logs += d; });
    child.stderr.on("data", (d) => { logs += d; });
    for (let i = 0; i < 60; i++) {
      try { if ((await pub("/health")).ok) break; } catch {}
      await sleep(100);
    }

    const start = await post("/audience/admin/sessions/start", { name: "chat-reset-test" });
    if (BLIJF) {
      console.log(`telefoon: http://127.0.0.1:${PUB}/live?t=${start.join.token}`);
      console.log(`zaalscherm: http://127.0.0.1:${LAN}/audience/stage/chat en /audience/stage/tussen`);
      console.log(`run starten / resetten: curl -X POST http://127.0.0.1:${RUNTIME}/run of /reset`);
      return;
    }
    const r = await pub(`/live?t=${start.join.token}`);
    const cookie = r.headers.get("set-cookie").split(";")[0];
    const historie = async () => (await (await pub("/audience/public/history", { headers: { cookie } })).json()).messages.map((m) => m.text);
    const tel = await openWs(cookie);
    assert.ok(await wachtOp(() => tel.msgs.some((m) => m.type === "hello")));
    assert.equal(tel.msgs.find((m) => m.type === "hello").chatGewistTot, 0);
    const stroom = await openStroom();
    assert.ok(await wachtOp(() => stroom.msgs.some((m) => m.type === "begin")));
    tel.ws.send(JSON.stringify({ type: "register", name: "Testpubliek", clientTag: "t1" }));
    await sleep(150);
    const zeg = async (text) => {
      tel.ws.send(JSON.stringify({ type: "comment", name: "Testpubliek", text }));
      assert.ok(await wachtOp(() => stroom.msgs.some((m) => m.type === "comment" && m.text === text)), text);
      await sleep(1100);
    };

    await zeg("tijdens de inloop");
    run = "show-1";
    await sleep(700);
    assert.ok(!tel.msgs.some((m) => m.type === "chat_reset"));
    assert.deepEqual(await historie(), ["tijdens de inloop"]);
    ok("run start: de chat van de inloop blijft staan");

    await zeg("tijdens de run");
    runtimeAan = false;
    await sleep(700);
    runtimeAan = true;
    await sleep(500);
    assert.ok(!tel.msgs.some((m) => m.type === "chat_reset"));
    ok("runtime even onbereikbaar: geen reset");

    run = null;
    assert.ok(await wachtOp(() => tel.msgs.some((m) => m.type === "chat_reset")));
    assert.ok(await wachtOp(() => stroom.msgs.some((m) => m.type === "chat_reset")));
    const reset = tel.msgs.find((m) => m.type === "chat_reset");
    assert.equal(reset.reden, "reset_run");
    ok("reset van de run: telefoons en zaalscherm krijgen 'chat_reset' zonder herladen");

    assert.deepEqual(await historie(), []);
    const stroom2 = await openStroom();
    assert.ok(await wachtOp(() => stroom2.msgs.some((m) => m.type === "begin")));
    assert.deepEqual(stroom2.msgs.find((m) => m.type === "begin").berichten, []);
    assert.equal(stroom2.msgs.find((m) => m.type === "begin").ronde.start, null);
    stroom2.stop();
    const tel2 = await openWs(cookie);
    assert.ok(await wachtOp(() => tel2.msgs.some((m) => m.type === "hello")));
    assert.equal(tel2.msgs.find((m) => m.type === "hello").chatGewistTot, reset.tot);
    tel2.ws.close();
    ok("daarna: geschiedenis leeg, zaalscherm begint leeg, een telefoon die terugkomt hoort het ook");
    assert.equal(tel.ws.readyState, WebSocket.OPEN);
    ok("telefoons blijven verbonden (geen nieuwe sessie)");

    await sleep(600);
    assert.equal(tel.msgs.filter((m) => m.type === "chat_reset").length, 1);
    ok("één reset, niet elke seconde opnieuw");

    await zeg("na de reset");
    assert.deepEqual(await historie(), ["na de reset"]);
    ok("nieuwe berichten na de reset komen gewoon door");

    const admin = await post("/audience/admin/chat/wis", {});
    assert.equal(admin.ok, true);
    assert.ok(await wachtOp(() => tel.msgs.filter((m) => m.type === "chat_reset").pop()?.reden === "admin"));
    assert.deepEqual(await historie(), []);
    assert.equal((await pub("/audience/admin/chat/wis", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" })).status, 404);
    ok("knop Chat wissen in Admin doet hetzelfde; niet bereikbaar via de publieke poort");

    stroom.stop();
    tel.ws.close();
    console.log(results.join("\n"));
    console.log("chat-reset-test: alles in orde");
  } catch (err) {
    console.log(results.join("\n"));
    console.error("MISLUKT:", err && err.stack ? err.stack : err);
    console.error(logs.slice(-2000));
    process.exitCode = 1;
  } finally {
    if (!BLIJF || process.exitCode) {
      if (child) child.kill();
      runtime.close();
      try { fs.rmSync(dbDir, { recursive: true, force: true }); } catch {}
    }
  }
})();
