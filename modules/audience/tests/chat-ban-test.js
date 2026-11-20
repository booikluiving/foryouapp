"use strict";
// Test: namenvenster voor de operator, time-out en ban in de publiekschat, met melding in de chat.
// Start audience los: tijdelijke DB, nep-runtime op een eigen poort, raakt de draaiende show niet.
const assert = require("node:assert/strict");
const path = require("node:path");
const fs = require("node:fs");
const os = require("node:os");
const http = require("node:http");
const { spawn } = require("node:child_process");

const ROOT = process.argv[2] || path.resolve(__dirname, "../../..");
const WebSocket = require(path.join(ROOT, "node_modules/ws"));
const LAN = 39426, PUB = 39430, RUNTIME = 39424;
const dbDir = fs.mkdtempSync(path.join(os.tmpdir(), "fy-aud-chatban-"));
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

    const start = await post("/audience/admin/sessions/start", { name: "chat-ban-test" });
    const r = await pub(`/live?t=${start.join.token}`);
    const cookie = r.headers.get("set-cookie").split(";")[0];
    const tel = await openWs(cookie);
    assert.ok(await wachtOp(() => tel.msgs.some((m) => m.type === "hello")));
    const stroom = await openStroom();
    assert.ok(await wachtOp(() => stroom.msgs.some((m) => m.type === "begin")));
    tel.ws.send(JSON.stringify({ type: "register", name: "Lastpak", clientTag: "t1" }));
    await sleep(200);
    const mensen = async () => (await (await lan("/audience/admin/chat/mensen")).json()).mensen;
    let lijst = await mensen();
    assert.equal(lijst.length, 1);
    assert.equal(lijst[0].naam, "Lastpak");
    assert.equal(lijst[0].mutedUntil, null);
    ok("namenvenster: de telefoon staat erin met naam");
    assert.equal((await pub("/audience/admin/chat/mensen")).status, 404);
    ok("namenlijst niet via de publieke poort");

    const key = lijst[0].clientKey;
    let res = await post("/audience/admin/users/mute", { clientKey: key, targetKind: "client", minutes: 5 });
    assert.equal(res.ok, true);
    assert.ok(await wachtOp(() => stroom.msgs.some((m) => m.system && /time-out van 5 minuten/.test(m.text) && m.id)));
    assert.ok(await wachtOp(() => tel.msgs.some((m) => m.type === "moderation_notice" && m.code === "user_muted")));
    lijst = await mensen();
    assert.ok(lijst[0].mutedUntil && lijst[0].ban === false);
    ok("time-out: melding in de chat, telefoon hoort het, lijst zegt tot wanneer");

    tel.ws.send(JSON.stringify({ type: "comment", name: "Lastpak", text: "mag dit nog" }));
    await sleep(500);
    assert.ok(!stroom.msgs.some((m) => m.type === "comment" && m.text === "mag dit nog"));
    ok("gemute: bericht komt niet in de chat");

    res = await post("/audience/admin/users/unmute", { clientKey: key, targetKind: "client" });
    assert.ok(await wachtOp(() => stroom.msgs.some((m) => m.system && /weer toegelaten/.test(m.text))));
    res = await post("/audience/admin/users/mute", { clientKey: key, targetKind: "client", minutes: 600 });
    assert.ok(await wachtOp(() => stroom.msgs.some((m) => m.system && m.text === "De operator heeft Lastpak gebanned.")));
    lijst = await mensen();
    assert.equal(lijst[0].ban, true);
    ok("ban: 'De operator heeft Lastpak gebanned.' in de chat, lijst zegt gebanned");

    const stroom2 = await openStroom();
    assert.ok(await wachtOp(() => stroom2.msgs.some((m) => m.type === "begin")));
    assert.ok(stroom2.msgs.find((m) => m.type === "begin").berichten.some((m) => m.system && /gebanned/.test(m.text)));
    stroom2.stop();
    ok("zaalscherm dat opnieuw laadt krijgt de melding ook");

    stroom.stop();
    tel.ws.close();
    console.log(results.join("\n"));
    console.log("chat-ban-test: alles in orde");
  } catch (err) {
    console.log(results.join("\n"));
    console.error("MISLUKT:", err && err.stack ? err.stack : err);
    console.error(logs.slice(-2000));
    process.exitCode = 1;
  } finally {
    if (child) child.kill();
    runtime.close();
    try { fs.rmSync(dbDir, { recursive: true, force: true }); } catch {}
  }
})();
