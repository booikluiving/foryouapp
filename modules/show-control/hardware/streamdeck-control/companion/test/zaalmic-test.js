"use strict";

// ZAAL MIC: de microfoon van de operator over de speakers.
//   node test/zaalmic-test.js
const assert = require("node:assert/strict");
const http = require("node:http");
const path = require("node:path");
const { loadDeck, standVan, zaalMicDichtBijStart, zaalMicStand } = require("../lib");
const { validate } = require("../bouw");

const deck = loadDeck();
const knop = deck.paginas.flatMap((p) => p.knoppen).find((k) => k.actie && k.actie.zaalmic);
assert.ok(knop, "de knop staat op het deck");
assert.equal(knop.soort, "geluid");

// de controle
const kapot = (wijzig) => { const d = JSON.parse(JSON.stringify(deck)); wijzig(d.paginas.flatMap((p) => p.knoppen).find((k) => k.key === knop.key)); return () => validate(d); };
assert.throws(kapot((k) => { k.actie.zaalmic = "altijd"; }), /zaalmic altijd onbekend/);
assert.throws(kapot((k) => { k.soort = "run"; }), /zaalmic is soort geluid/);

// wat de knop toont; elke stand hoort bij de soort geluid
const dicht = { verbonden: true, claudeNeemtOp: false, zaal: { open: false } };
const open = { ...dicht, zaal: { open: true } };
const toon = (mic, sq5) => { const v = zaalMicStand(mic, sq5); assert.ok(deck.ontwerp.soorten.geluid.standen.includes(standVan(v.s)), v.s); return `${v.t.replace("\n", " ")}/${standVan(v.s)}`; };
assert.equal(toon(null), "MIC ?/onbekend");
assert.equal(toon({ stand: "rood" }), "MIC ?/onbekend", "helper zonder zaal: niet doen alsof");
assert.equal(toon(dicht), "ZAAL MIC/kan");
assert.equal(toon(open, { mac: false, muziek: false, main: false }), "MIC OPEN/loopt");
assert.equal(toon(open, { muziek: true }), "TAFEL DICHT/muted");
assert.equal(toon({ ...dicht, claudeNeemtOp: true }), "MIC BEZET/uit");
assert.equal(toon({ ...dicht, verbonden: false }), "MIC LOS/uit");

// dicht bij de start van een scène, niet daarna en niet bij de eerste ronde van de dienst
assert.equal(zaalMicDichtBijStart(false, true, true), true);
assert.equal(zaalMicDichtBijStart(true, true, true), false, "in de scène mag hij weer open");
assert.equal(zaalMicDichtBijStart(null, true, true), false);
assert.equal(zaalMicDichtBijStart(false, true, false), false);

// de knop zelf tegen een nagebootste helper: wissel = aan, uit; geweigerd tijdens dicteren
(async () => {
  const stand = { open: false, dicteert: false, vragen: [] };
  const server = http.createServer((req, res) => {
    stand.vragen.push(`${req.method} ${req.url}`);
    let code = 200;
    let body = { verbonden: true, zaal: { open: stand.open } };
    if (req.url.startsWith("/api/zaal/aan")) { if (stand.dicteert) { code = 409; body = { fout: "dicteren loopt" }; } else { stand.open = true; body.zaal.open = true; } }
    if (req.url === "/api/zaal/uit") { stand.open = false; body.zaal.open = false; }
    res.writeHead(code, { "content-type": "application/json" }); res.end(JSON.stringify(body));
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const env = { ...process.env, FY_DECK_MIC_KNOP_URL: `http://127.0.0.1:${server.address().port}`, FY_DECK_COMPANION_URL: "http://127.0.0.1:9", FY_DECK_LOG: "/dev/null", FY_DECK_HOLD_DIR: path.join(require("node:os").tmpdir(), `zaalmic-test-${process.pid}`) };
  const druk = (...extra) => new Promise((r) => require("node:child_process").execFile(process.execPath, [path.join(__dirname, "..", "deck-actie.js"), "--nu", knop.key, ...extra], { env }, r));
  await druk();
  assert.equal(stand.open, true, "eerste druk: open");
  assert.ok(stand.vragen.includes(`POST /api/zaal/aan${knop.actie.max ? `?max=${knop.actie.max}` : ""}`));
  await druk();
  assert.equal(stand.open, false, "tweede druk: dicht");
  stand.dicteert = true;
  await druk();
  assert.equal(stand.open, false, "tijdens dicteren gaat hij niet open");
  server.close();
  require("node:fs").rmSync(env.FY_DECK_HOLD_DIR, { recursive: true, force: true });
  console.log("zaalmic-test: ok");
})().catch((err) => { console.error(err); process.exit(1); });
