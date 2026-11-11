"use strict";
// Test van de live reacties: fase uit de runtime (nagebootst), alleen emoji tijdens de scène,
// typen tussen de scènes, instelbare emoji-lijst en de live stroom voor de podiumlagen.
// Start audience los: tijdelijke DB, nep-runtime op een eigen poort, raakt de draaiende show niet.
const assert = require("node:assert/strict");
const path = require("node:path");
const fs = require("node:fs");
const os = require("node:os");
const http = require("node:http");
const { spawn } = require("node:child_process");

const ROOT = process.argv[2] || path.resolve(__dirname, "../../..");
const WebSocket = require(path.join(ROOT, "node_modules/ws"));
const LAN = 39226, PUB = 39230, RUNTIME = 39224;
const dbDir = fs.mkdtempSync(path.join(os.tmpdir(), "fy-aud-reac-"));
const results = [];
const ok = (m) => { results.push("ok  " + m); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Nep-runtime: alleen /v0/runtime/runs/current(/view)
let actief = null;
let runtimeAan = true;
const runtime = http.createServer((req, res) => {
  if (!runtimeAan) { req.socket.destroy(); return; }
  res.setHeader("content-type", "application/json");
  res.end(JSON.stringify({ showRunId: "show-test", activeSituation: actief }));
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
  assert.match(res.headers.get("content-type") || "", /text\/event-stream/);
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

    const start = await post("/audience/admin/sessions/start", { name: "reacties-test" });
    const r = await pub(`/live?t=${start.join.token}`);
    const cookie = r.headers.get("set-cookie").split(";")[0];
    const tel = await openWs(cookie);
    await wachtOp(() => tel.msgs.some((m) => m.type === "hello"));
    const hello = tel.msgs.find((m) => m.type === "hello");
    assert.equal(hello.fase.fase, "tussen");
    assert.deepEqual(hello.reacties.map((x) => x.telt), ["positief", "negatief"]);
    assert.equal(hello.naSceneVraag, "En?");
    ok("hello: fase 'tussen', standaard-emoji (positief, negatief) en vraag 'En?'");

    const stroom = await openStroom();
    await wachtOp(() => stroom.msgs.some((m) => m.type === "begin"));
    const begin = stroom.msgs.find((m) => m.type === "begin");
    assert.equal(begin.fase.fase, "tussen"); assert.ok(Array.isArray(begin.reacties) && begin.settings);
    ok("podiumstroom begint met fase, emoji-lijst en instellingen");

    tel.ws.send(JSON.stringify({ type: "register", name: "Testpubliek", clientTag: "t1" }));
    await sleep(150);
    tel.ws.send(JSON.stringify({ type: "comment", name: "Testpubliek", text: "wachten op de scene" }));
    assert.ok(await wachtOp(() => stroom.msgs.some((m) => m.type === "comment" && m.text === "wachten op de scene")));
    ok("tussen de scènes: getypte reactie komt in de podiumstroom");

    // Likes op comments
    const comment = tel.msgs.find((m) => m.type === "comment" && m.text === "wachten op de scene");
    assert.ok(comment && comment.id > 0 && comment.likes === 0, JSON.stringify(comment));
    const tel2 = await openWs(cookie);
    tel2.ws.send(JSON.stringify({ type: "register", name: "Tweede", clientTag: "t2" }));
    await sleep(150);
    tel2.ws.send(JSON.stringify({ type: "like", id: comment.id, liked: true, clientTag: "t2" }));
    assert.ok(await wachtOp(() => tel2.msgs.some((m) => m.type === "like_ok" && m.id === comment.id && m.likes === 1 && m.liked)));
    assert.ok(await wachtOp(() => stroom.msgs.some((m) => m.type === "comment_likes" && m.id === comment.id && m.likes === 1)));
    tel.ws.send(JSON.stringify({ type: "like", id: comment.id, liked: true, clientTag: "t1" }));
    assert.ok(await wachtOp(() => tel.msgs.some((m) => m.code === "like_eigen")));
    await sleep(200);
    tel2.ws.send(JSON.stringify({ type: "like", id: comment.id, liked: true, clientTag: "t2" }));
    await sleep(300);
    let hist = await (await pub("/audience/public/history", { headers: { cookie } })).json();
    assert.equal(hist.messages.find((m) => m.id === comment.id).likes, 1);
    tel2.ws.send(JSON.stringify({ type: "like", id: comment.id, liked: false, clientTag: "t2" }));
    assert.ok(await wachtOp(() => tel2.msgs.some((m) => m.type === "like_ok" && m.id === comment.id && m.likes === 0 && !m.liked)));
    await sleep(200);
    tel2.ws.send(JSON.stringify({ type: "like", id: comment.id, liked: true, clientTag: "t2" }));
    assert.ok(await wachtOp(() => tel2.msgs.filter((m) => m.type === "like_ok").length >= 3));
    hist = await (await pub("/audience/public/history", { headers: { cookie } })).json();
    assert.equal(hist.messages.find((m) => m.id === comment.id).likes, 1);
    tel2.ws.send(JSON.stringify({ type: "like", id: 999999, liked: true, clientTag: "t2" }));
    assert.ok(await wachtOp(() => tel2.msgs.some((m) => m.code === "like_invalid")));
    tel2.ws.close();
    ok("likes: comment heeft id, ander liket (1), eigen like geweigerd, dubbel telt niet, aan/uit werkt, in geschiedenis en podiumstroom");

    actief = { situationRunId: "sr-1", situationId: "situation:1", title: "Testscène", status: "active" };
    assert.ok(await wachtOp(() => tel.msgs.some((m) => m.type === "fase" && m.fase === "scene")), "fase scene");
    assert.ok(await wachtOp(() => stroom.msgs.some((m) => m.type === "fase" && m.fase === "scene")));
    ok("situatie start in de runtime: telefoon en podium krijgen fase 'scene'");

    const voor = tel.msgs.length;
    tel.ws.send(JSON.stringify({ type: "comment", name: "Testpubliek", text: "mag dit nu" }));
    assert.ok(await wachtOp(() => tel.msgs.slice(voor).some((m) => m.code === "scene_typen_dicht")));
    await sleep(200);
    assert.ok(!stroom.msgs.some((m) => m.type === "comment" && m.text === "mag dit nu"));
    ok("tijdens de scène: typen geweigerd ('scene_typen_dicht'), niets op het podium");

    tel.ws.send(JSON.stringify({ type: "reaction", reaction: "❤️", clientTag: "t1" }));
    assert.ok(await wachtOp(() => stroom.msgs.some((m) => m.type === "reaction_update" && m.emoji === "❤️" && m.reaction === "heart")));
    ok("tijdens de scène: emoji ❤️ komt op het podium (telt als heart)");

    await sleep(150);
    tel.ws.send(JSON.stringify({ type: "reaction", reaction: "bored", clientTag: "t1" }));
    assert.ok(await wachtOp(() => stroom.msgs.some((m) => m.type === "reaction_update" && m.reaction === "bored" && m.emoji === "👎")));
    ok("oude naam 'bored' (simulator) wijst naar 👎");

    await sleep(150);
    const v2 = tel.msgs.length;
    tel.ws.send(JSON.stringify({ type: "reaction", reaction: "🍕", clientTag: "t1" }));
    assert.ok(await wachtOp(() => tel.msgs.slice(v2).some((m) => m.code === "reaction_invalid")));
    ok("emoji die niet in de lijst staat wordt geweigerd");

    const opgeslagen = await post("/audience/admin/reacties", { vraag: "  Wat   vond je ervan? ", reacties: [
      { emoji: "🔥", telt: "positief" }, { emoji: "😂", telt: "niet" }, { emoji: "<b>", telt: "positief" }, { emoji: "🔥", telt: "negatief" },
    ] });
    assert.deepEqual(opgeslagen.reacties, [{ emoji: "🔥", telt: "positief" }, { emoji: "😂", telt: "niet" }]);
    assert.equal(opgeslagen.naSceneVraag, "Wat vond je ervan?");
    assert.ok(await wachtOp(() => tel.msgs.some((m) => m.type === "reacties" && m.reacties.length === 2 && m.naSceneVraag === "Wat vond je ervan?")));
    ok("Admin: emoji-lijst opslaan (dubbel en HTML eruit), telefoons krijgen de nieuwe lijst");

    const state1 = await (await lan("/audience/admin/state")).json();
    await sleep(150);
    tel.ws.send(JSON.stringify({ type: "reaction", reaction: "😂", clientTag: "t1" }));
    assert.ok(await wachtOp(() => stroom.msgs.some((m) => m.type === "reaction_update" && m.emoji === "😂" && m.reaction === "emoji")));
    const state2 = await (await lan("/audience/admin/state")).json();
    assert.deepEqual(state2.reactionCounts, state1.reactionCounts);
    assert.equal(state2.fase.fase, "scene"); assert.equal(state2.reacties.length, 2);
    ok("emoji die 'niet' telt: wel op het podium, niet in de algoritme-tellers");

    assert.equal(state2.ronde.titel, "Testscène");
    assert.deepEqual(state2.ronde.emoji, { "\u2764\ufe0f": 1, "\ud83d\udc4e": 1, "\ud83d\ude02": 1 });
    assert.equal(state2.ronde.eind, null);
    ok("tellingen per scène: ❤️ 1, 👎 1, 😂 1 voor 'Testscène'");

    runtimeAan = false;
    await sleep(800);
    assert.equal((await (await lan("/audience/admin/state")).json()).fase.fase, "scene");
    ok("runtime even onbereikbaar: fase blijft staan");
    runtimeAan = true;

    actief = null;
    assert.ok(await wachtOp(() => tel.msgs.filter((m) => m.type === "fase").pop()?.fase === "tussen"));
    await sleep(200);
    tel.ws.send(JSON.stringify({ type: "comment", name: "Testpubliek", text: "mooie scene" }));
    assert.ok(await wachtOp(() => stroom.msgs.some((m) => m.type === "comment" && m.text === "mooie scene")));
    ok("situatie stopt: fase 'tussen', typen werkt weer");

    const na = (await (await lan("/audience/admin/state")).json()).ronde;
    assert.ok(na.eind); assert.equal(na.emoji["\ud83d\ude02"], 1);
    const faseTussen = tel.msgs.filter((m) => m.type === "fase").pop();
    assert.equal(faseTussen.ronde.titel, "Testscène");
    ok("na de scène blijven de tellingen staan (met eindtijd) voor het tussenscherm");

    actief = { situationRunId: "sr-2", situationId: "situation:2", title: "Tweede scène", status: "active" };
    assert.ok(await wachtOp(() => tel.msgs.filter((m) => m.type === "fase").pop()?.fase === "scene"));
    const r2 = (await (await lan("/audience/admin/state")).json()).ronde;
    assert.equal(r2.titel, "Tweede scène"); assert.deepEqual(r2.emoji, {});
    ok("nieuwe scène: tellingen beginnen opnieuw");
    actief = null;
    assert.ok(await wachtOp(() => tel.msgs.filter((m) => m.type === "fase").pop()?.fase === "tussen"));

    for (const p of ["/audience/stage/emoji", "/audience/stage/chat", "/audience/stage/tussen"]) {
      const res = await lan(p);
      assert.equal(res.status, 200, p); assert.match(await res.text(), /EventSource\("\/audience\/stage\/stroom"\)/, p);
    }
    for (const p of ["/audience/stage/stroom", "/audience/stage/emoji", "/audience/stage/chat", "/audience/stage/tussen"]) {
      assert.equal((await pub(p)).status, 404, p);
    }
    assert.equal((await pub("/audience/admin/reacties", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" })).status, 404);
    ok("podiumlagen en stroom alleen op het LAN, niet op de publieke poort");

    stroom.stop();
    tel.ws.close();
    console.log(results.join("\n"));
    console.log("ALLES OK");
  } catch (err) {
    console.log(results.join("\n"));
    console.log("FOUT:", err && err.stack || err);
    console.log(logs.slice(-2000));
    process.exitCode = 1;
  } finally {
    if (child) child.kill();
    runtime.close();
    fs.rmSync(dbDir, { recursive: true, force: true });
    setTimeout(() => process.exit(), 200);
  }
})();
