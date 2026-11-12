"use strict";
// Test van het stemmen op de startscène. Start audience los: tijdelijke DB, nep-runtime en
// nep-show-control op eigen poorten; raakt de draaiende show niet.
const assert = require("node:assert/strict");
const path = require("node:path");
const fs = require("node:fs");
const os = require("node:os");
const http = require("node:http");
const { spawn } = require("node:child_process");

const ROOT = process.argv[2] || path.resolve(__dirname, "../../..");
const WebSocket = require(path.join(ROOT, "node_modules/ws"));
const LAN = 39326, PUB = 39330, RUNTIME = 39324, SHOW = 39325;
const dbDir = fs.mkdtempSync(path.join(os.tmpdir(), "fy-aud-stem-"));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const ok = (m) => results.push("ok  " + m);

const situaties = [2, 3, 6, 39].map((n) => ({ id: `situation:${n}`, legacyId: n, title: `Scène ${n}` }));
const view = {
  status: "running",
  showRunId: "show-test",
  activeSituation: null,
  catalogPreview: { situations: [...situaties, { id: "situation:9", title: "Dicht" }] },
  pathEvaluation: { items: [...situaties.map((s) => ({ situationId: s.id, status: "available", pathAvailable: true })), { situationId: "situation:9", status: "locked" }] },
};
const klaargezet = [];
const cues = [];
const lees = (req) => new Promise((r) => { let b = ""; req.on("data", (d) => { b += d; }); req.on("end", () => r(b ? JSON.parse(b) : {})); });
const runtime = http.createServer(async (req, res) => {
  res.setHeader("content-type", "application/json");
  if (req.method === "POST" && req.url.endsWith("/prepare-situation")) {
    const body = await lees(req);
    klaargezet.push(body.situationId);
    res.end(JSON.stringify({ showRunId: "show-test", preparedNext: { situationId: body.situationId } }));
    return;
  }
  res.end(JSON.stringify(view));
});
const show = http.createServer(async (req, res) => {
  cues.push({ url: req.url, body: await lees(req) });
  res.setHeader("content-type", "application/json");
  res.end(JSON.stringify({ ok: true }));
});

const lan = (p, o) => fetch(`http://127.0.0.1:${LAN}${p}`, o);
const post = (p, body) => lan(p, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body || {}) }).then(async (r) => ({ status: r.status, ...(await r.json()) }));
const wachtOp = async (fn, ms = 4000) => {
  const eind = Date.now() + ms;
  while (Date.now() < eind) { if (await fn()) return true; await sleep(50); }
  return false;
};
function telefoon(cookie, tag) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${PUB}/audience/realtime`, { headers: { cookie } });
    const msgs = [];
    ws.on("message", (raw) => msgs.push(JSON.parse(String(raw))));
    ws.on("open", () => { ws.send(JSON.stringify({ type: "register", name: tag, clientTag: tag })); resolve({ ws, msgs, tag }); });
    ws.on("error", reject);
  });
}

let child, logs = "";
(async () => {
  try {
    await new Promise((r) => runtime.listen(RUNTIME, "127.0.0.1", r));
    await new Promise((r) => show.listen(SHOW, "127.0.0.1", r));
    child = spawn(process.execPath, [path.join(ROOT, "modules/audience/server/server.js")], {
      cwd: ROOT,
      env: {
        ...process.env,
        AUDIENCE_PORT: String(LAN),
        AUDIENCE_PUBLIC_PORT: String(PUB),
        AUDIENCE_PUBLIC_JOIN_URL: "https://www.foryouniverse.nl/live",
        AUDIENCE_DB_DIR: dbDir,
        AUDIENCE_RUNTIME_URL: `http://127.0.0.1:${RUNTIME}`,
        AUDIENCE_SHOW_CONTROL_URL: `http://127.0.0.1:${SHOW}`,
        AUDIENCE_ALGORITHM_URL: "http://127.0.0.1:9",
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    child.stdout.on("data", (d) => { logs += d; });
    child.stderr.on("data", (d) => { logs += d; });
    for (let i = 0; i < 60; i++) {
      try { if ((await fetch(`http://127.0.0.1:${PUB}/health`)).ok) break; } catch {}
      await sleep(100);
    }
    const start = await post("/audience/admin/sessions/start", { name: "stem-test" });
    const r = await fetch(`http://127.0.0.1:${PUB}/live?t=${start.join.token}`, { redirect: "manual" });
    const cookie = r.headers.get("set-cookie").split(";")[0];
    const tels = [];
    for (const tag of ["a", "b", "c"]) tels.push(await telefoon(cookie, tag));
    await sleep(300);

    // 1. Stemming met een duidelijke winnaar
    let s = await post("/audience/admin/start-stemming/start", { durationSeconds: 10, minVotes: 2 });
    assert.equal(s.status, 201, JSON.stringify(s));
    assert.deepEqual(s.poll.options, ["Scène 2", "Scène 3", "Scène 6", "Scène 39"]);
    assert.ok(await wachtOp(() => tels.every((t) => t.msgs.some((m) => m.type === "poll_started"))));
    ok("stemming open: telefoons krijgen de vier vrije scènes, de gesloten scène niet");
    const pollId = s.poll.id;
    tels[0].ws.send(JSON.stringify({ type: "poll_vote", pollId, optionIndex: 2, clientTag: "a" }));
    tels[1].ws.send(JSON.stringify({ type: "poll_vote", pollId, optionIndex: 2, clientTag: "b" }));
    tels[2].ws.send(JSON.stringify({ type: "poll_vote", pollId, optionIndex: 0, clientTag: "c" }));
    assert.ok(await wachtOp(async () => (await (await lan("/audience/stage/start-stemming")).json()).totalVotes === 3), "stemmen tellen");
    const stand = await (await lan("/audience/stage/start-stemming")).json();
    assert.equal(stand.actief, true);
    assert.deepEqual(stand.keuzes.map((k) => k.votes), [1, 0, 2, 0]);
    ok("stand voor zaalscherm en universum: 1, 0, 2, 0");
    await post("/audience/admin/polls/close");
    assert.ok(await wachtOp(() => klaargezet.length === 1 && cues.length === 1));
    assert.equal(klaargezet[0], "situation:6");
    assert.equal(cues[0].url, "/v0/show-control/cues/prepare");
    assert.ok(tels[0].msgs.some((m) => m.type === "start_stemming_uitslag" && m.uitslag.titel === "Scène 6" && m.uitslag.geloot === null));
    const na = await (await lan("/audience/stage/start-stemming")).json();
    assert.equal(na.actief, false);
    assert.ok(await wachtOp(async () => (await (await lan("/audience/stage/start-stemming")).json()).uitslag.klaargezet === "ja"));
    ok("meeste stemmen wint: Scène 6 klaargezet in runtime en via show control");

    // 2. Te weinig stemmen: loten uit alle vier
    s = await post("/audience/admin/start-stemming/start", { durationSeconds: 10, minVotes: 5 });
    tels[0].ws.send(JSON.stringify({ type: "poll_vote", pollId: s.poll.id, optionIndex: 1, clientTag: "a" }));
    await sleep(300);
    await post("/audience/admin/polls/close");
    assert.ok(await wachtOp(() => klaargezet.length === 2));
    let u = (await (await lan("/audience/stage/start-stemming")).json()).uitslag;
    assert.equal(u.geloot, "te_weinig_stemmen");
    assert.ok(situaties.some((x) => x.id === klaargezet[1]));
    ok("te weinig stemmen: geloot uit alle vrije scènes (" + u.titel + ")");

    // 3. Gelijke stand: loten tussen de koplopers, en vanzelf sluiten na de tijd
    s = await post("/audience/admin/start-stemming/start", { durationSeconds: 10, minVotes: 1 });
    tels[0].ws.send(JSON.stringify({ type: "poll_vote", pollId: s.poll.id, optionIndex: 1, clientTag: "a" }));
    tels[1].ws.send(JSON.stringify({ type: "poll_vote", pollId: s.poll.id, optionIndex: 3, clientTag: "b" }));
    assert.ok(await wachtOp(() => klaargezet.length === 3, 14000), "sluit vanzelf");
    u = (await (await lan("/audience/stage/start-stemming")).json()).uitslag;
    assert.equal(u.geloot, "gelijke_stand");
    assert.ok(["situation:3", "situation:39"].includes(klaargezet[2]));
    ok("gelijke stand: geloot tussen de twee koplopers, stemming sloot vanzelf");

    // 3b. Startfase: alleen startscènes in de stemming; daarna weer alles wat vrij is
    await sleep(300);
    const alleItems = view.pathEvaluation.items;
    view.pathEvaluation = { items: alleItems.map((item) => ({ ...item, isPathStart: ["situation:2", "situation:6"].includes(item.situationId) })) };
    view.startPhase = { required: 3, played: 1, open: 2, active: true };
    s = await post("/audience/admin/start-stemming/start", { durationSeconds: 10, minVotes: 0 });
    assert.equal(s.ok, true, JSON.stringify(s));
    assert.deepEqual(s.poll.options, ["Scène 2", "Scène 6"]);
    view.startPhase = { required: 3, played: 3, open: 2, active: false };
    s = await post("/audience/admin/start-stemming/start", { durationSeconds: 10, minVotes: 0 });
    assert.equal(s.poll.options.length, 4);
    ok("startfase: stemming alleen over startscènes, daarna over alles wat vrij is");

    // 4. Geen run of lopende scène: weigeren
    view.activeSituation = { situationId: "situation:2" };
    s = await post("/audience/admin/start-stemming/start", {});
    assert.equal(s.status, 409); assert.equal(s.error, "scene_loopt");
    view.activeSituation = null; view.status = "idle"; view.showRunId = null;
    s = await post("/audience/admin/start-stemming/start", {});
    assert.equal(s.error, "geen_run");
    ok("zonder run of tijdens een scène opent de stemming niet");

    console.log(results.join("\n"));
    console.log("ALLES OK");
  } catch (err) {
    console.log(results.join("\n"));
    console.error("FOUT:", err && err.stack ? err.stack : err);
    console.error(logs.slice(-1500));
    process.exitCode = 1;
  } finally {
    if (child) child.kill();
    runtime.close(); show.close();
    setTimeout(() => process.exit(), 300);
  }
})();
