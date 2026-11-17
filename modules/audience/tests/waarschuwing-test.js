"use strict";
// Test: bij START SHOW komt de content warning in beeld (zaalscherm en telefoons), alleen met tekst,
// één keer per run, en hij gaat weg na de ingestelde tijd. Ook: de stemklok na de scène staat op 45 s.
// Start audience los: tijdelijke DB, nep-runtime op een eigen poort, raakt de draaiende show niet.
const assert = require("node:assert/strict");
const path = require("node:path");
const fs = require("node:fs");
const os = require("node:os");
const http = require("node:http");
const { spawn } = require("node:child_process");

const ROOT = process.argv[2] || path.resolve(__dirname, "../../..");
const WebSocket = require(path.join(ROOT, "node_modules/ws"));
const LAN = 39346, PUB = 39350, RUNTIME = 39344;
const dbDir = fs.mkdtempSync(path.join(os.tmpdir(), "fy-aud-waarschuwing-"));
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

    const start = await post("/audience/admin/sessions/start", { name: "waarschuwing-test" });
    const r = await pub(`/live?t=${start.join.token}`);
    const cookie = r.headers.get("set-cookie").split(";")[0];
    const tel = await openWs(cookie);
    assert.ok(await wachtOp(() => tel.msgs.some((m) => m.type === "hello")));
    assert.equal(tel.msgs.find((m) => m.type === "hello").waarschuwing, null);
    const stroom = await openStroom();
    assert.ok(await wachtOp(() => stroom.msgs.some((m) => m.type === "begin")));
    const getoond = (lijst) => lijst.filter((m) => m.type === "waarschuwing" && m.waarschuwing);
    const weggehaald = (lijst) => lijst.filter((m) => m.type === "waarschuwing" && !m.waarschuwing);

    const beoordeling = await (await lan("/audience/stage/beoordeling")).json();
    assert.equal(beoordeling.instellingen.duur, 45);
    ok("stemklok na de scène: 45 s");

    let stand = await (await lan("/audience/stage/waarschuwing")).json();
    assert.deepEqual(stand.instellingen, { tekst: "", duur: 10, waar: "beide" });
    assert.equal((await post("/audience/admin/show/start")).error, "geen_run");
    run = "show-1";
    await sleep(700);
    assert.equal((await post("/audience/admin/show/start")).ok, true);
    await sleep(300);
    assert.equal(getoond(stroom.msgs).length, 0);
    assert.equal(getoond(tel.msgs).length, 0);
    ok("zonder tekst komt er bij START SHOW niets in beeld");

    const inst = await post("/audience/admin/waarschuwing/instellingen", { tekst: "  proeftekst\nregel twee ", duur: 1, waar: "beide" });
    assert.deepEqual(inst.instellingen, { tekst: "proeftekst\nregel twee", duur: 1, waar: "beide" });
    await post("/audience/admin/show/start");
    await sleep(300);
    assert.equal(getoond(stroom.msgs).length, 0);
    ok("START SHOW nog een keer in dezelfde run: niet opnieuw");

    run = null;
    await sleep(700);
    run = "show-2";
    await sleep(700);
    assert.equal((await post("/audience/admin/show/start")).ok, true);
    assert.ok(await wachtOp(() => getoond(stroom.msgs).length === 1 && getoond(tel.msgs).length === 1));
    const bericht = getoond(tel.msgs)[0].waarschuwing;
    assert.equal(bericht.tekst, "proeftekst\nregel twee");
    assert.equal(bericht.waar, "beide");
    assert.ok(bericht.overMs > 0 && bericht.overMs <= 1000);
    ok("START SHOW met tekst: zaalscherm en telefoon krijgen de tekst");

    const later = await openWs(cookie);
    assert.ok(await wachtOp(() => later.msgs.some((m) => m.type === "hello")));
    assert.equal(later.msgs.find((m) => m.type === "hello").waarschuwing.tekst, "proeftekst\nregel twee");
    later.ws.close();
    ok("wie nu verbindt krijgt de tekst ook");

    assert.ok(await wachtOp(() => weggehaald(stroom.msgs).length === 1 && weggehaald(tel.msgs).length === 1, 2500));
    ok("na de ingestelde tijd gaat hij weg");

    await post("/audience/admin/waarschuwing/instellingen", { duur: 0, waar: "zaalscherm" });
    const hand = await post("/audience/admin/waarschuwing/toon");
    assert.equal(hand.waarschuwing.overMs, null);
    assert.equal(hand.waarschuwing.waar, "zaalscherm");
    await sleep(1300);
    assert.equal(weggehaald(stroom.msgs).length, 1);
    assert.equal((await post("/audience/admin/waarschuwing/weg")).weg, true);
    assert.ok(await wachtOp(() => weggehaald(stroom.msgs).length === 2));
    ok("duur 0: blijft staan tot Weg");

    await post("/audience/admin/waarschuwing/instellingen", { tekst: "" });
    assert.equal((await post("/audience/admin/waarschuwing/toon")).error, "geen_tekst");
    ok("tekst leeg: Toon nu doet niets");

    tel.ws.close();
    stroom.stop();
    console.log(results.join("\n"));
    console.log("waarschuwing-test: geslaagd");
  } catch (err) {
    console.log(results.join("\n"));
    console.error("waarschuwing-test: MISLUKT\n", err, "\n", logs.slice(-2000));
    process.exitCode = 1;
  } finally {
    if (child) child.kill();
    runtime.close();
    fs.rmSync(dbDir, { recursive: true, force: true });
    setTimeout(() => process.exit(), 300).unref();
  }
})();
