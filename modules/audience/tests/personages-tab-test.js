"use strict";
// Test: personagestab op de telefoon. De stand volgt de runtime (vrij = gespeeld in deze run), dichte personages
// gaan niet mee, de foto zit achter de QR-pas met een lange cache, en RESET RUN maakt alles leeg.
// Start audience los: tijdelijke DB, fotomap en tabmap, nep-runtime en nep-catalogus; raakt de draaiende show niet.
const assert = require("node:assert/strict");
const path = require("node:path");
const fs = require("node:fs");
const os = require("node:os");
const http = require("node:http");
const { spawn } = require("node:child_process");

const ROOT = process.argv[2] || path.resolve(__dirname, "../../..");
const WebSocket = require(path.join(ROOT, "node_modules/ws"));
const { hussel } = require(path.join(ROOT, "modules/audience/server/personages.js"));
const LAN = 39436, PUB = 39440, RUNTIME = 39434, CATALOGUS = 39431;
const dbDir = fs.mkdtempSync(path.join(os.tmpdir(), "fy-aud-pk-"));
const fotoDir = fs.mkdtempSync(path.join(os.tmpdir(), "fy-aud-pk-foto-"));
const results = [];
const ok = (m) => { results.push("ok  " + m); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// Grijs vlak van 30×40 (geen persoon).
const JPEG = Buffer.from("/9j/4AAQSkZJRgABAQAASABIAAD/4QBMRXhpZgAATU0AKgAAAAgAAYdpAAQAAAABAAAAGgAAAAAAA6ABAAMAAAABAAEAAKACAAQAAAABAAAAHqADAAQAAAABAAAAKAAAAAD/7QA4UGhvdG9zaG9wIDMuMAA4QklNBAQAAAAAAAA4QklNBCUAAAAAABDUHYzZjwCyBOmACZjs+EJ+/8AAEQgAKAAeAwEiAAIRAQMRAf/EAB8AAAEFAQEBAQEBAAAAAAAAAAABAgMEBQYHCAkKC//EALUQAAIBAwMCBAMFBQQEAAABfQECAwAEEQUSITFBBhNRYQcicRQygZGhCCNCscEVUtHwJDNicoIJChYXGBkaJSYnKCkqNDU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6g4SFhoeIiYqSk5SVlpeYmZqio6Slpqeoqaqys7S1tre4ubrCw8TFxsfIycrS09TV1tfY2drh4uPk5ebn6Onq8fLz9PX29/j5+v/EAB8BAAMBAQEBAQEBAQEAAAAAAAABAgMEBQYHCAkKC//EALURAAIBAgQEAwQHBQQEAAECdwABAgMRBAUhMQYSQVEHYXETIjKBCBRCkaGxwQkjM1LwFWJy0QoWJDThJfEXGBkaJicoKSo1Njc4OTpDREVGR0hJSlNUVVZXWFlaY2RlZmdoaWpzdHV2d3h5eoKDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uLj5OXm5+jp6vLz9PX29/j5+v/bAEMAAgICAgICAwICAwUDAwMFBgUFBQUGCAYGBgYGCAoICAgICAgKCgoKCgoKCgwMDAwMDA4ODg4ODw8PDw8PDw8PD//bAEMBAgICBAQEBwQEBxALCQsQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEP/dAAQAAv/aAAwDAQACEQMRAD8Aw6KKK9QzCiiigD//0MOiiivUMwooooA//9HDooor1DMKKKKAP//Z", "base64");

const RUN = "show-run-test-1";
const catalog = {
  performers: [{ id: "performer:3", name: "Booi", performerSlot: 1 }, { id: "performer:1", name: "Megan", performerSlot: 2 }, { id: "performer:2", name: "Brent", performerSlot: 3 }],
  characters: [{ id: "character:15", name: "BobbieDeCrackhond" }, { id: "character:29", name: "Lisa" }, { id: "character:8", name: "Adolf" }, { id: "character:47", name: "Alex" }, { id: "character:99", name: "Nergens" }],
  situations: [
    { id: "situation:2", active: true, characterIds: ["character:15", "character:29"] },
    { id: "situation:5", active: true, characterIds: ["character:8", "character:47", "character:15"] },
    { id: "situation:6", active: false, characterIds: ["character:99"] },
  ],
};
const scene = (nr, title, slots) => ({ situationRunId: RUN + ":situation-run:000" + nr, status: "played", endedAt: "2026-11-19T14:10:00Z", resolved: { title, performerSlots: slots } });
let view = { status: "idle", showRunId: null, situationRuns: [] };
const runtime = http.createServer((req, res) => { res.setHeader("content-type", "application/json"); res.end(JSON.stringify(view)); });
const catalogus = http.createServer((req, res) => {
  res.setHeader("content-type", "application/json");
  res.end(JSON.stringify({ characters: [{ id: "character:15", description: "Bobbie is verslaafd." }, { id: "character:29", description: "Lisa werkt in de supermarkt." }, { id: "character:8", description: "Geheim" }] }));
});

let child;
let logs = "";
const lan = (p, o) => fetch(`http://127.0.0.1:${LAN}${p}`, o);
const pub = (p, o) => fetch(`http://127.0.0.1:${PUB}${p}`, { redirect: "manual", ...o });
const post = (p, body) => lan(p, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body || {}) }).then((r) => r.json());
const wachtOp = async (fn, ms = 4000) => {
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
const laatsteStand = (tel) => tel.msgs.filter((m) => m.type === "personages").pop();

(async () => {
  try {
    // Volgorde per run: vast voor dezelfde run, anders voor een andere.
    const ids = ["character:1", "character:2", "character:3", "character:4", "character:5", "character:6"];
    assert.deepEqual(hussel(ids, "a"), hussel(ids.slice().reverse(), "a"));
    assert.notDeepEqual(hussel(ids, "a"), hussel(ids, "b"));
    ok("vaste plek: dezelfde run geeft dezelfde volgorde, een andere run een andere");

    await new Promise((r) => runtime.listen(RUNTIME, "127.0.0.1", r));
    await new Promise((r) => catalogus.listen(CATALOGUS, "127.0.0.1", r));
    child = spawn(process.execPath, [path.join(ROOT, "modules/audience/server/server.js")], {
      cwd: ROOT,
      env: {
        ...process.env,
        AUDIENCE_PORT: String(LAN),
        AUDIENCE_PUBLIC_PORT: String(PUB),
        AUDIENCE_PUBLIC_JOIN_URL: "https://www.foryouniverse.nl/live",
        AUDIENCE_DB_DIR: dbDir,
        AUDIENCE_PERSONAGEFOTO_DIR: fotoDir,
        AUDIENCE_RUNTIME_URL: `http://127.0.0.1:${RUNTIME}`,
        AUDIENCE_CATALOG_URL: `http://127.0.0.1:${CATALOGUS}`,
        AUDIENCE_ALGORITHM_URL: "http://127.0.0.1:9",
        AUDIENCE_SHOW_CONTROL_URL: "http://127.0.0.1:9",
        AUDIENCE_PATHS_URL: "http://127.0.0.1:9",
        AUDIENCE_SCRIPT_AGENT_URL: "http://127.0.0.1:9",
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

    const start = await post("/audience/admin/sessions/start", { name: "personages-test" });
    const r = await pub(`/live?t=${start.join.token}`);
    const cookie = r.headers.get("set-cookie").split(";")[0];
    const tel = await openWs(cookie);
    assert.ok(await wachtOp(() => tel.msgs.some((m) => m.type === "hello")));
    const hello0 = tel.msgs.find((m) => m.type === "hello").personages;
    assert.ok(hello0 && hello0.run === null && hello0.totaal === 0 && hello0.vrij.length === 0);
    ok("zonder run: hello heeft een lege stand");

    // Run loopt, één scène gespeeld (Bobbie vast bij Booi, Lisa zonder speler op plek 2).
    view = { status: "running", showRunId: RUN, showRunSnapshot: { catalog }, situationRuns: [
      scene(1, "Bobbie betaalt in natura", [{ slotIndex: 1, performerId: "performer:3", performerName: "Booi", characterId: "character:15", characterName: "BobbieDeCrackhond" }, { slotIndex: 2, performerId: null, performerName: null, characterId: "character:29", characterName: "Lisa" }]),
      { situationRunId: RUN + ":situation-run:0002", status: "active", resolved: { title: "Loopt nog", performerSlots: [{ slotIndex: 1, characterId: "character:8", characterName: "Adolf" }] } },
    ] };
    // Foto van Bobbie, zoals personagefoto.js hem bewaart.
    fs.mkdirSync(path.join(fotoDir, RUN.replace(/[^a-zA-Z0-9_-]/g, "_")), { recursive: true });
    fs.writeFileSync(path.join(fotoDir, RUN.replace(/[^a-zA-Z0-9_-]/g, "_"), "character_15.jpg"), JPEG);
    assert.ok(await wachtOp(() => { const s = laatsteStand(tel); return s && s.run === RUN && s.vrij.length === 2 && s.vrij.some((v) => v.beschrijving); }));
    let s = laatsteStand(tel);
    assert.equal(s.totaal, 4, "alleen personages uit actieve situaties");
    const bobbie = s.vrij.find((v) => v.id === "character:15");
    const lisa = s.vrij.find((v) => v.id === "character:29");
    assert.deepEqual(bobbie.speler, ["Booi"]);
    assert.deepEqual(lisa.speler, ["Megan"], "vrije speler volgt de plek");
    assert.equal(bobbie.beschrijving, "Bobbie is verslaafd.");
    assert.equal(bobbie.scenes[0].nr, 1);
    assert.equal(bobbie.nog, 1, "nog één andere situatie met Bobbie");
    assert.match(bobbie.foto, /^\/audience\/public\/personagefoto\/character%3A15\?v=\d+$/);
    assert.equal(lisa.foto, null);
    const tekst = JSON.stringify(s);
    for (const geheim of ["Adolf", "character:8", "character:47", "Alex", "Geheim", "Loopt nog"]) assert.ok(!tekst.includes(geheim), "verklapt " + geheim);
    const plekken = s.vrij.map((v) => v.plek);
    assert.ok(plekken.every((p) => p >= 0 && p < s.totaal) && new Set(plekken).size === plekken.length);
    ok("gespeelde scène: twee vrij, speler, beschrijving, scènes, foto-adres; de lopende scène en dichte personages gaan niet mee");

    const aantal = tel.msgs.filter((m) => m.type === "personages").length;
    await sleep(900);
    assert.equal(tel.msgs.filter((m) => m.type === "personages").length, aantal);
    ok("niets veranderd: geen nieuw bericht");

    // Foto achter de pas.
    assert.equal((await pub(bobbie.foto)).status, 403);
    const foto = await pub(bobbie.foto, { headers: { cookie } });
    assert.equal(foto.status, 200);
    assert.equal(foto.headers.get("content-type"), "image/jpeg");
    assert.match(foto.headers.get("cache-control"), /max-age=86400.*immutable/);
    assert.ok((await foto.arrayBuffer()).byteLength > 100);
    for (const fout of ["/audience/public/personagefoto/character%3A8?v=1", "/audience/public/personagefoto/character%3A29?v=1", "/audience/public/personagefoto/..%2Fgeheim?v=1"]) {
      assert.equal((await pub(fout, { headers: { cookie } })).status, 404, fout);
    }
    assert.equal((await lan(bobbie.foto)).status, 200);
    ok("foto: alleen met pas, met lange cache, alleen van vrije personages; ook op de LAN-poort");

    // Tweede scène afgelopen.
    const revisie = s.revisie;
    view.situationRuns[1] = { ...view.situationRuns[1], status: "played", endedAt: "2026-11-19T14:15:00Z" };
    assert.ok(await wachtOp(() => { const t = laatsteStand(tel); return t.vrij.length === 3; }));
    s = laatsteStand(tel);
    assert.ok(s.revisie > revisie);
    const adolf = s.vrij.find((v) => v.id === "character:8");
    assert.deepEqual(adolf.speler, ["Booi"], "vrij personage op plek 1");
    ok("na de volgende scène: nieuw personage erbij, hogere revisie");

    // Herverbinding: hello heeft de hele stand.
    const tel2 = await openWs(cookie);
    assert.ok(await wachtOp(() => tel2.msgs.some((m) => m.type === "hello")));
    const h2 = tel2.msgs.find((m) => m.type === "hello").personages;
    assert.equal(h2.revisie, s.revisie);
    assert.deepEqual(h2.vrij, s.vrij);
    tel2.ws.close();
    ok("terugkomende telefoon krijgt de hele stand in hello");

    // RESET RUN.
    view = { status: "reset", showRunId: RUN, situationRuns: [] };
    assert.ok(await wachtOp(() => { const t = laatsteStand(tel); return t.run === null && t.vrij.length === 0; }));
    assert.equal((await pub(bobbie.foto, { headers: { cookie } })).status, 404);
    ok("RESET RUN: lege stand naar de telefoons, foto's niet meer op te vragen");

    const js = await pub("/audience/public/tabs/personages.js?v=1");
    assert.equal(js.status, 200);
    assert.match(await js.text(), /ForYouTabs\.registreer\("personages"/);
    ok("personages.js staat op de publieke poort");

    tel.ws.close();
    console.log(results.join("\n"));
    console.log("personages-tab-test: alles in orde");
  } catch (err) {
    console.log(results.join("\n"));
    console.error("MISLUKT:", err && err.stack ? err.stack : err);
    console.error(logs.slice(-2000));
    process.exitCode = 1;
  } finally {
    if (child) child.kill();
    runtime.close();
    catalogus.close();
    for (const d of [dbDir, fotoDir]) { try { fs.rmSync(d, { recursive: true, force: true }); } catch {} }
  }
})();
