"use strict";
// Test: tabs naast de chat op de telefoon. Aan/uit in Admin komt meteen op de telefoon (hello + bericht "tabs"),
// tabbestanden worden alleen met een platte naam geserveerd, op de LAN- én de publieke poort.
// Start audience los: tijdelijke DB en tabmap, nep-runtime; raakt de draaiende show niet.
// Met "blijf" als tweede argument blijft de testdienst draaien (om de telefoon te bekijken).
const assert = require("node:assert/strict");
const path = require("node:path");
const fs = require("node:fs");
const os = require("node:os");
const http = require("node:http");
const { spawn } = require("node:child_process");

const ROOT = process.argv[2] || path.resolve(__dirname, "../../..");
const BLIJF = process.argv[3] === "blijf";
const WebSocket = require(path.join(ROOT, "node_modules/ws"));
const LAN = 39426, PUB = 39430, RUNTIME = 39424;
const dbDir = fs.mkdtempSync(path.join(os.tmpdir(), "fy-aud-tabs-"));
const tabDir = fs.mkdtempSync(path.join(os.tmpdir(), "fy-aud-tabmap-"));
const results = [];
const ok = (m) => { results.push("ok  " + m); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Plekhouders voor de twee tabs (de echte inhoud maken andere sessies).
const plekhouder = (naam, titel) => `ForYouTabs.registreer(${JSON.stringify(naam)}, {
  start(vlak, api) { this.vlak = vlak; vlak.innerHTML = '<p style="margin:auto;color:var(--b)">${titel}</p>'; },
  bericht() {}, toon() { this.vlak.dataset.zichtbaar = "1"; }, verberg() { this.vlak.dataset.zichtbaar = "0"; },
});\n`;
fs.writeFileSync(path.join(tabDir, "universum.js"), plekhouder("universum", "for_youniverse"));
fs.writeFileSync(path.join(tabDir, "personages.js"), plekhouder("personages", "Personages"));
fs.writeFileSync(path.join(tabDir, "geheim.txt"), "nee");

const runtime = http.createServer((req, res) => {
  res.setHeader("content-type", "application/json");
  res.end(JSON.stringify({ status: "idle", showRunId: null, activeSituation: null }));
});

let child;
let logs = "";
const lan = (p, o) => fetch(`http://127.0.0.1:${LAN}${p}`, o);
const pub = (p, o) => fetch(`http://127.0.0.1:${PUB}${p}`, { redirect: "manual", ...o });
const post = (p, body) => lan(p, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body || {}) }).then((r) => r.json());
const wachtOp = async (fn, ms = 3000) => {
  const eind = Date.now() + ms;
  while (Date.now() < eind) { if (fn()) return true; await sleep(50); }
  return false;
};
function openWs(cookie) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${PUB}/audience/realtime`, { headers: cookie ? { cookie } : {} });
    const msgs = [];
    ws.on("message", (raw) => msgs.push(JSON.parse(String(raw))));
    ws.on("open", () => resolve({ ws, msgs }));
    ws.on("error", reject);
  });
}

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
        AUDIENCE_TABS_DIR: tabDir,
        AUDIENCE_RUNTIME_URL: `http://127.0.0.1:${RUNTIME}`,
        AUDIENCE_ALGORITHM_URL: "http://127.0.0.1:9",
        AUDIENCE_SHOW_CONTROL_URL: "http://127.0.0.1:9",
        AUDIENCE_PATHS_URL: "http://127.0.0.1:9",
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

    const start = await post("/audience/admin/sessions/start", { name: "tabs-test" });
    if (BLIJF) {
      await post("/audience/admin/tabs", { universum: true, personages: true });
      console.log(`telefoon: http://127.0.0.1:${PUB}/live?t=${start.join.token}`);
      console.log(`admin: http://127.0.0.1:${LAN}/audience/admin`);
      return;
    }

    const admin0 = await (await lan("/audience/admin/state")).json().catch(() => ({}));
    if (admin0 && admin0.telefoonTabs) assert.deepEqual(admin0.telefoonTabs, { universum: false, personages: false });
    const r = await pub(`/live?t=${start.join.token}`);
    const cookie = r.headers.get("set-cookie").split(";")[0];
    const tel = await openWs(cookie);
    assert.ok(await wachtOp(() => tel.msgs.some((m) => m.type === "hello")));
    assert.deepEqual(tel.msgs.find((m) => m.type === "hello").tabs, { universum: false, personages: false });
    ok("standaard staan de tabs uit (hello)");

    const aan = await post("/audience/admin/tabs", { universum: true });
    assert.deepEqual(aan.tabs, { universum: true, personages: false });
    assert.ok(await wachtOp(() => tel.msgs.some((m) => m.type === "tabs" && m.tabs.universum === true)));
    ok("Admin zet for_youniverse aan: telefoon krijgt 'tabs' meteen");

    await post("/audience/admin/tabs", { personages: true, onzin: true, universum: "ja" });
    const tel2 = await openWs(cookie);
    assert.ok(await wachtOp(() => tel2.msgs.some((m) => m.type === "hello")));
    assert.deepEqual(tel2.msgs.find((m) => m.type === "hello").tabs, { universum: true, personages: true });
    tel2.ws.close();
    ok("alleen echte aan/uit telt; een telefoon die terugkomt krijgt de stand in hello");

    await post("/audience/admin/tabs", { universum: false, personages: false });
    assert.ok(await wachtOp(() => tel.msgs.filter((m) => m.type === "tabs").pop().tabs.personages === false));
    ok("noodknop uit: telefoon krijgt het meteen");

    for (const [poort, haal] of [["LAN", lan], ["publiek", pub]]) {
      const js = await haal("/audience/public/tabs/universum.js?v=1");
      assert.equal(js.status, 200, poort);
      assert.match(js.headers.get("content-type"), /javascript/);
      assert.match(js.headers.get("cache-control"), /max-age=300/);
      assert.match(await js.text(), /ForYouTabs\.registreer/);
      for (const fout of ["/audience/public/tabs/geheim.txt", "/audience/public/tabs/../index.html", "/audience/public/tabs/%2e%2e%2fserver.js", "/audience/public/tabs/bestaatniet.js", "/audience/public/tabs/"]) {
        assert.equal((await haal(fout)).status, 404, poort + " " + fout);
      }
    }
    ok("tabbestanden: alleen <naam>.js, met korte cache, op beide poorten; de rest 404");

    assert.equal((await pub("/audience/admin/tabs", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" })).status, 404);
    ok("noodknop niet bereikbaar via de publieke poort");

    const pagina = await (await pub("/", { headers: { cookie } })).text();
    assert.match(pagina, /id="tabBalk"/);
    assert.match(pagina, /for_youniverse/);
    ok("telefoonpagina heeft de tabbalk");

    tel.ws.close();
    console.log(results.join("\n"));
    console.log("tabs-test: alles in orde");
  } catch (err) {
    console.log(results.join("\n"));
    console.error("MISLUKT:", err && err.stack ? err.stack : err);
    console.error(logs.slice(-2000));
    process.exitCode = 1;
  } finally {
    if (!BLIJF || process.exitCode) {
      if (child) child.kill();
      runtime.close();
      for (const d of [dbDir, tabDir]) { try { fs.rmSync(d, { recursive: true, force: true }); } catch {} }
    }
  }
})();
