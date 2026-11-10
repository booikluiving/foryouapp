"use strict";
// Test van de publieke ingang (AUDIENCE_PUBLIC_PORT). Start audience los: tijdelijke DB,
// runtime/algorithm op een dode poort, raakt de draaiende show niet.
const assert = require("node:assert/strict");
const path = require("node:path");
const fs = require("node:fs");
const os = require("node:os");
const { spawn, execSync } = require("node:child_process");

const ROOT = process.argv[2] || path.resolve(__dirname, "../../..");
const WebSocket = require(path.join(ROOT, "node_modules/ws"));
const LAN = 39126, PUB = 39130;
const dbDir = fs.mkdtempSync(path.join(os.tmpdir(), "fy-aud-"));
const results = [];
const ok = (m) => { results.push("ok  " + m); };

const child = spawn(process.execPath, [path.join(ROOT, "modules/audience/server/server.js")], {
  cwd: ROOT,
  env: {
    ...process.env,
    AUDIENCE_PORT: String(LAN),
    AUDIENCE_PUBLIC_PORT: String(PUB),
    AUDIENCE_PUBLIC_JOIN_URL: "https://www.foryouniverse.nl/live",
    V2_AUDIENCE_DB_DIR: dbDir,
    V2_AUDIENCE_RUNTIME_URL: "http://127.0.0.1:9",
    V2_AUDIENCE_ALGORITHM_URL: "http://127.0.0.1:9",
  },
  stdio: ["ignore", "pipe", "pipe"],
});
let logs = "";
child.stdout.on("data", (d) => { logs += d; });
child.stderr.on("data", (d) => { logs += d; });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const lan = (p, o) => fetch(`http://127.0.0.1:${LAN}${p}`, o);
const pub = (p, o) => fetch(`http://127.0.0.1:${PUB}${p}`, { redirect: "manual", ...o });

function openWs(cookie) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${PUB}/v2/audience/realtime`, { headers: cookie ? { cookie } : {} });
    const msgs = [];
    ws.on("message", (raw) => msgs.push(JSON.parse(String(raw))));
    ws.on("open", () => resolve({ ws, msgs }));
    ws.on("error", reject);
  });
}

(async () => {
  try {
    for (let i = 0; i < 50; i++) {
      try { if ((await pub("/health")).ok) break; } catch {}
      await sleep(100);
    }
    const listen = execSync(`lsof -nP -iTCP:${PUB} -sTCP:LISTEN || true`).toString();
    assert.match(listen, /127\.0\.0\.1:39130/);
    ok("publieke poort luistert alleen op 127.0.0.1");

    const h = await (await pub("/health")).json();
    assert.equal(h.db, undefined); assert.equal(h.port, undefined);
    ok("publieke /health zonder db-pad of poort");

    for (const p of ["/admin", "/v2/audience/admin", "/v2/audience/admin/state", "/v2/audience/status", "/v2/audience/stage", "/v2/audience/stage/session-qr", "/v2/audience/signals", "/v2/audience/algorithm-input", "/v0/audience/sessions"]) {
      assert.equal((await pub(p)).status, 404, p);
    }
    for (const p of ["/v2/audience/admin/sessions/stop", "/v2/audience/admin/users/kick", "/v2/audience/signals", "/v2/audience/admin/polls/start"]) {
      assert.equal((await pub(p, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" })).status, 404, p);
    }
    ok("admin/stage/signalen/status geven 404 op de publieke poort");

    let r = await pub("/live");
    assert.equal(r.status, 200); assert.match(await r.text(), /Scan de QR-code/);
    ok("/live zonder code: 'Scan de QR-code in de zaal'");

    const start = await (await lan("/v2/audience/admin/sessions/start", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: "test-run" }) })).json();
    const join = start.join || (start.session && start.sessionJoin);
    assert.ok(join && join.token, JSON.stringify(start).slice(0, 300));
    assert.equal(join.joinUrl, `https://www.foryouniverse.nl/live?t=${join.token}`);
    assert.match(join.lanJoinUrl, /^http:\/\/.*:39126\/join\?token=/);
    ok("QR-link = https://www.foryouniverse.nl/live?t=<token> (LAN-link apart bewaard)");

    const st = await (await lan("/v2/audience/admin/state?stage=qr")).json();
    assert.equal(st.sessionJoin.joinUrl, join.joinUrl);
    ok("stage-QR (admin/state) toont de publieke link");

    r = await pub("/live?t=fout");
    assert.equal(r.status, 410);
    ok("verkeerde code: 410 'QR-code verlopen'");

    r = await pub(`/live?t=${join.token}`);
    assert.equal(r.status, 302); assert.equal(r.headers.get("location"), "/");
    const setCookie = r.headers.get("set-cookie");
    assert.match(setCookie, /fy_audience_access=/); assert.match(setCookie, /HttpOnly/);
    const cookie = setCookie.split(";")[0];
    ok("/live?t=<token>: pas gezet (HttpOnly), door naar /");

    r = await pub(`/live?t=${join.token}`, { headers: { "x-forwarded-proto": "https" } });
    assert.match(r.headers.get("set-cookie"), /Secure/);
    ok("achter de tunnel (https): pas is Secure");

    assert.equal((await pub("/v2/audience/public/history")).status, 403);
    assert.equal((await pub("/v2/audience/public/history", { headers: { cookie } })).status, 200);
    ok("chatgeschiedenis alleen met pas");

    assert.equal((await pub("/", { headers: { cookie } })).status, 200);
    assert.equal((await pub("/v2/audience/socket.io/socket.io.js")).status, 200);
    ok("publieke app en socket.io-client laden");

    const noPass = await openWs("");
    await sleep(300);
    assert.ok(noPass.msgs.some((m) => m.code === "session_join_required"));
    ok("WebSocket zonder pas wordt geweigerd");

    const a = await openWs(cookie);
    await sleep(200);
    a.ws.send(JSON.stringify({ type: "register", name: "Testpubliek", clientTag: "t1" }));
    await sleep(150);
    a.ws.send(JSON.stringify({ type: "comment", name: "Testpubliek", text: "hallo zaal" }));
    await sleep(1000);
    assert.ok(a.msgs.some((m) => m.type === "comment" && m.text === "hallo zaal"), JSON.stringify(a.msgs).slice(0, 400));
    ok("chatbericht via de publieke poort komt aan");

    a.ws.send(JSON.stringify({ type: "comment", name: "Testpubliek", text: "wat een k4nker show" }));
    await sleep(1000);
    assert.ok(a.msgs.some((m) => m.code === "moderation_blocked"), JSON.stringify(a.msgs.slice(-3)));
    ok("scheldwoord (ook k4nker) wordt tegengehouden");

    a.ws.send(JSON.stringify({ type: "register", name: "kankerman", clientTag: "t1" }));
    await sleep(200);
    assert.ok(a.msgs.some((m) => m.code === "name_word_blocked"));
    ok("scheldwoord in naam wordt tegengehouden");

    const users = (await (await lan("/v2/audience/admin/state")).json());
    const txt = JSON.stringify(users);
    assert.ok(!/127\.0\.0\.1\|t1/.test(txt));
    assert.match(txt, /pub-[0-9a-f]{12}\|t1/);
    ok("in admin heet de telefoon pub-<schuilnaam>, niet 127.0.0.1");

    const { DatabaseSync } = require("node:sqlite");
    const dbFile = fs.readdirSync(dbDir).find((f) => f.endsWith(".sqlite"));
    const db = new DatabaseSync(path.join(dbDir, dbFile));
    const je = db.prepare("SELECT ip, user_agent AS ua, source FROM session_join_events").all();
    assert.ok(je.length >= 1 && je.every((e) => !e.ip && !e.ua && e.source === "join_public"), JSON.stringify(je));
    const gr = db.prepare("SELECT ip, user_agent AS ua FROM session_access_grants").all();
    assert.ok(gr.every((g) => !g.ip && !g.ua), JSON.stringify(gr));
    const cols = db.prepare("PRAGMA table_info(clients)").all().map((c) => c.name);
    if (cols.includes("ip")) {
      const cl = db.prepare(`SELECT ip${cols.includes("user_agent") ? ", user_agent AS ua" : ""} FROM clients`).all();
      assert.ok(cl.every((c) => String(c.ip).startsWith("pub-") && !c.ua), JSON.stringify(cl));
    }
    db.close();
    ok("database: geen IP-adres of apparaat opgeslagen voor publieke deelnemers");

    const closed = new Promise((res) => a.ws.on("close", (code) => res(code)));
    await lan("/v2/audience/admin/sessions/stop", { method: "POST" });
    assert.equal(await closed, 4011);
    ok("sessie stoppen: telefoon eruit (4011)");

    r = await pub(`/live?t=${join.token}`);
    assert.equal(r.status, 410); assert.match(await r.text(), /afgelopen/);
    assert.equal((await pub("/v2/audience/public/history", { headers: { cookie } })).status, 410);
    ok("na stop: oude QR en oude pas werken niet meer");

    const start2 = await (await lan("/v2/audience/admin/sessions/start", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" })).json();
    assert.notEqual(start2.join.token, join.token);
    const old = await openWs(cookie); await sleep(300);
    assert.ok(old.msgs.some((m) => m.code === "session_join_required"));
    ok("nieuwe sessie: nieuwe QR, oude pas geweigerd");

    console.log(results.join("\n"));
    console.log("ALLES OK");
  } catch (err) {
    console.log(results.join("\n"));
    console.log("FOUT:", err && err.stack || err);
    console.log(logs.slice(-2000));
    process.exitCode = 1;
  } finally {
    child.kill();
    fs.rmSync(dbDir, { recursive: true, force: true });
    setTimeout(() => process.exit(), 200);
  }
})();
