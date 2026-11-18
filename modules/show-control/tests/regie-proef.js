"use strict";

// Losse proef van de regie: show control op :4325 met een nep-runtime (:4324) en een nep-script-agent
// (:4327). Raakt de show niet: geen TouchDesigner, licht, geluid of echte runtime.
//   node modules/show-control/tests/regie-proef.js        → open http://127.0.0.1:4325/regie/
//   node modules/show-control/tests/regie-proef.js --test → doorloop zonder browser, stopt daarna

const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const fs = require("node:fs");
const assert = require("node:assert/strict");

const RT = 4324;
const SA = 4327;
const SC = 4325;
process.env.SHOW_CONTROL_RUNTIME_URL = `http://127.0.0.1:${RT}`;
process.env.SHOW_CONTROL_SCRIPT_AGENT_URL = `http://127.0.0.1:${SA}`;
process.env.SHOW_CONTROL_AUDIENCE_URL = `http://127.0.0.1:${SA}`;

const catalogus = {
  situations: [
    { id: "situation:1", title: "Startscène", environmentId: "environment:1", environmentName: "Supermarkt" },
    { id: "situation:2", title: "Escape Room Marit", environmentId: "environment:36", environmentName: "Escape room" },
    { id: "situation:3", title: "Bobbie de Crackhond", environmentId: "environment:1", environmentName: "Supermarkt" },
    { id: "situation:4", title: "Trolleyprobleem", environmentId: "environment:30", environmentName: "Trolley" },
  ],
  environments: [
    { id: "environment:1", name: "Supermarkt" },
    { id: "environment:36", name: "Escape room" },
    { id: "environment:30", name: "Trolley" },
  ],
};

const rt = {
  showRunId: null,
  status: "idle",
  testRun: null,
  activeSituation: null,
  preparedNext: null,
  resolvedPreparedNext: null,
  playedSituations: [],
  pathEvaluation: { items: [{ situationId: "situation:1", isPathStart: true }] },
  showRunSnapshot: { catalog: { situations: catalogus.situations } },
  updatedAt: new Date().toISOString(),
};
const logboek = [];
let teleprompterKwijt = false;

function zetKlaar(situationId) {
  const s = catalogus.situations.find((item) => item.id === situationId) || catalogus.situations[1];
  rt.preparedNext = { situationId: s.id, title: s.title, chosenAt: new Date().toISOString() };
  rt.resolvedPreparedNext = {
    situationId: s.id,
    legacySituationId: Number(s.id.split(":")[1]),
    title: s.title,
    environmentId: s.environmentId,
    environment: { id: s.environmentId, name: s.environmentName },
    characters: [],
  };
}

function lees(req) {
  return new Promise((resolve) => {
    let data = "";
    req.on("data", (d) => { data += d; });
    req.on("end", () => { try { resolve(data ? JSON.parse(data) : {}); } catch (_e) { resolve({}); } });
  });
}

function stuur(res, body, status = 200) {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
}

const runtime = http.createServer(async (req, res) => {
  const body = await lees(req);
  const pad = req.url;
  logboek.push(`runtime ${req.method} ${pad.replace(/show-run-[^/]+/, ":run")}`);
  if (pad === "/v0/runtime/runs/current") return stuur(res, rt.showRunId ? rt : { status: "idle" });
  if (pad === "/v0/runtime/runs/start") {
    Object.assign(rt, { showRunId: `show-run-proef-${Date.now()}`, status: "running", playedSituations: [], testRun: null, activeSituation: null });
    zetKlaar("situation:1");
    return stuur(res, rt);
  }
  if (pad.endsWith("/test-run")) { rt.testRun = { enabled: body.enabled === true }; return stuur(res, rt); }
  if (pad.endsWith("/prepare-situation")) { zetKlaar(body.situationId); return stuur(res, rt); }
  if (pad.endsWith("/start-situation")) {
    if (rt.activeSituation) return stuur(res, { error: "runtime_active_situation_exists" }, 409);
    rt.activeSituation = { situationId: rt.preparedNext.situationId, title: rt.preparedNext.title, situationRunId: `sr-${Date.now()}`, resolved: rt.resolvedPreparedNext };
    return stuur(res, rt);
  }
  if (pad.endsWith("/stop-situation")) {
    if (!rt.activeSituation) return stuur(res, { error: "runtime_no_active_situation" }, 409);
    rt.playedSituations.push({ situationId: rt.activeSituation.situationId });
    rt.activeSituation = null;
    return stuur(res, rt);
  }
  if (pad.endsWith("/reset")) {
    Object.assign(rt, { status: "reset", activeSituation: null, preparedNext: null, resolvedPreparedNext: null, testRun: null });
    return stuur(res, rt);
  }
  if (pad.endsWith("/skip-prepared")) { zetKlaar("situation:3"); return stuur(res, { ...rt, skippedSituations: [] }); }
  return stuur(res, { error: "onbekend" }, 404);
});

const scriptAgent = http.createServer(async (req, res) => {
  const body = await lees(req);
  const pad = req.url;
  logboek.push(`script-agent ${req.method} ${pad}${body.schrijven === false ? " (bewaard script)" : ""}`);
  if (pad === "/v0/script-agent/operator/catalog/index") return stuur(res, { ok: true, ...catalogus });
  if (pad === "/v0/script-agent/teleprompter-parser/current") {
    return stuur(res, { preparedScene: teleprompterKwijt || !rt.preparedNext ? null : { sceneId: Number(rt.preparedNext.situationId.split(":")[1]) } });
  }
  if (pad === "/v0/script-agent/operator/status") return stuur(res, { stage: { sessionId: rt.showRunId } });
  if (pad.startsWith("/v0/script-agent/operator/session/")) return stuur(res, { ok: true });
  if (pad === "/audience/admin/show/start") return stuur(res, { ok: true, showGestart: true });
  const sit = body.situation && body.situation.situationId
    || body.runtimeOutput && body.runtimeOutput.resolvedPreparedNext && body.runtimeOutput.resolvedPreparedNext.situationId
    || rt.preparedNext && rt.preparedNext.situationId || "";
  if (pad === "/v0/script-agent/operator/scene-to-chat" || pad === "/v0/script-agent/operator/draft/from-runtime") {
    return stuur(res, { ok: true, draft: { situationId: sit } }, 201);
  }
  return stuur(res, { ok: true });
});

// TouchDesigner, licht, geluid, deck: nep, alleen opschrijven.
const nep = (doel) => async (action) => {
  logboek.push(`${doel} ${action.command}${action.payload && action.payload.phase !== undefined ? ` ${action.payload.phase}` : ""}`);
  return { stage: "applied", state: "ok", message: "proef" };
};

async function main() {
  await new Promise((r) => runtime.listen(RT, "127.0.0.1", r));
  await new Promise((r) => scriptAgent.listen(SA, "127.0.0.1", r));
  const { createShowControlApp } = require("../server/app");
  const { createRegie } = require("../regie/regie");
  const regiePath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "regie-proef-")), "regie.json");
  const tdShowPad = path.join(path.dirname(regiePath), "td-show.json");
  fs.writeFileSync(tdShowPad, JSON.stringify({ pid: 111 }));
  const app = createShowControlApp({
    regiePath,
    tdShowPad,
    adapters: {
      touchdesigner: nep("td"),
      dmx: nep("dmx"),
      sq5: nep("sq5"),
      macaudio: nep("geluid"),
      teleprompter: nep("teleprompter"),
      streamdeck: nep("deck"),
      camera: nep("camera"),
      perfectcue: nep("perfectcue"),
      keyboard: nep("keyboard"),
    },
  });
  void createRegie;
  const server = await new Promise((r) => { const s = app.listen(SC, "127.0.0.1", () => r(s)); });
  console.log(`regie-proef: http://127.0.0.1:${SC}/regie/`);
  if (!process.argv.includes("--test")) return;

  const post = async (pad, body, wie = "") => {
    const r = await fetch(`http://127.0.0.1:${SC}${pad}`, { method: "POST", headers: { "content-type": "application/json", ...(wie ? { "x-foryou-wie": wie } : {}) }, body: JSON.stringify(body || {}) });
    return { status: r.status, json: await r.json().catch(() => ({})) };
  };
  const stap = (naam) => { console.log(`\n== ${naam}`); logboek.length = 0; };
  const toon = () => console.log(logboek.map((regel) => `   ${regel}`).join("\n"));

  stap("Inloop: START RUN van de deck zet niets klaar, teleprompters in de instelstand");
  let r = await post("/v0/show-control/cues/start-run", { name: "Stream Deck start run", autoPrepareNext: true });
  assert.equal(r.status, 201);
  let inst = await (await fetch(`http://127.0.0.1:${SC}/v0/show-control/instel`)).json();
  assert.equal(inst.aan, true, "instelstand aan na START RUN");
  assert.ok(!logboek.some((regel) => regel.includes("environment.prepare")), "START RUN zet niets klaar in TouchDesigner");
  toon();

  stap("Hand omhoog (speler 2): key aan, nog een keer: weer rauw");
  r = await post("/v0/show-control/instel/key", { plek: 2, key: "wissel", bron: "hand" });
  assert.equal(r.json.keys["2"], true);
  r = await post("/v0/show-control/instel/key", { plek: 2, key: "wissel", bron: "hand" });
  assert.equal(r.json.keys["2"], false);
  toon();

  stap("START SHOW: eerste scène klaar, instelstand uit");
  r = await post("/v0/show-control/cues/start-show", {});
  console.log(`   ${r.status} klaargezet: ${r.json.klaargezet}`);
  inst = await (await fetch(`http://127.0.0.1:${SC}/v0/show-control/instel`)).json();
  assert.equal(inst.aan, false, "instelstand uit na START SHOW");
  toon();

  stap("RESET RUN van de deck: instelstand weer aan");
  r = await post("/v0/show-control/cues", { name: "Stream Deck reset run", actions: [{ command: "runtime.resetRun", ackMode: "acknowledged-async", payload: { showRunId: rt.showRunId }, timeoutMs: 5000 }] });
  inst = await (await fetch(`http://127.0.0.1:${SC}/v0/show-control/instel`)).json();
  assert.equal(inst.aan, true, "instelstand aan na RESET RUN");

  stap("Test overnemen door escape-room (geen run: start run, testrun)");
  r = await post("/v0/show-control/regie/overnemen", { stand: "test" }, "escape-room");
  assert.equal(r.status, 200); toon();

  stap("Operator probeert te starten: bezet");
  r = await post("/v0/show-control/cues/start-situation", { name: "Operator start" }, "operator");
  assert.equal(r.status, 423); console.log(`   ${r.json.message}`);

  stap("Escape-room laadt situation:2 en start (zonder schrijven)");
  r = await post("/v0/show-control/regie/laad", { situationId: "situation:2", start: true }, "escape-room");
  assert.equal(r.status, 200); assert.equal(r.json.run.speelt.situationId, "situation:2"); toon();

  stap("Deck in de zaal stopt de scène (mag altijd); stop antwoordt, daarna klaarzetten");
  const t0 = Date.now();
  r = await post("/v0/show-control/cues/stop-situation", { name: "Stream Deck stop situation", showRunId: rt.showRunId });
  console.log(`   antwoord na ${Date.now() - t0} ms, status ${r.status}`);
  assert.equal(r.status, 201);
  await new Promise((res) => setTimeout(res, 800)); toon();

  stap("Vrijgeven: stop, reset, inloop, stand show");
  r = await post("/v0/show-control/regie/vrijgeven", {}, "escape-room");
  assert.equal(r.json.stand, "show"); toon();

  stap("Random overnemen door operator: random scène klaar");
  r = await post("/v0/show-control/regie/overnemen", { stand: "random" }, "operator");
  console.log(`   klaar: ${r.json.run && r.json.run.klaar && r.json.run.klaar.title}`); toon();

  stap("Overslaan (deck) in random: andere random scène");
  r = await post("/v0/show-control/cues/overslaan", { name: "Stream Deck overslaan" });
  console.log(`   ${r.status} klaar: ${r.json.klaar && r.json.klaar.title}`); toon();

  stap("Bewaker: alles klopt (twee rondes)");
  await app.locals.environmentVanzelfTick(); await app.locals.environmentVanzelfTick();
  let regie = await (await fetch(`http://127.0.0.1:${SC}/v0/show-control/regie`)).json();
  console.log(`   meldingen: ${regie.controle.meldingen.length}, fase ${regie.controle.fase}`);
  toon();

  stap("Bewaker: script-agent herstart (teleprompter kwijt) → opnieuw klaargezet");
  teleprompterKwijt = true;
  await app.locals.environmentVanzelfTick();
  teleprompterKwijt = false;
  await app.locals.environmentVanzelfTick();
  teleprompterKwijt = true;
  await app.locals.environmentVanzelfTick(); await app.locals.environmentVanzelfTick();
  teleprompterKwijt = false;
  regie = await (await fetch(`http://127.0.0.1:${SC}/v0/show-control/regie`)).json();
  console.log(`   ${regie.controle.meldingen.map((m) => `${m.tekst} → ${m.herstel}`).join(" | ")}`);
  toon();

  stap("Bewaker: TouchDesigner herstart (andere pid)");
  fs.writeFileSync(tdShowPad, JSON.stringify({ pid: 222 }));
  await app.locals.environmentVanzelfTick();
  regie = await (await fetch(`http://127.0.0.1:${SC}/v0/show-control/regie`)).json();
  console.log(`   ${regie.controle.meldingen[0].tekst} → ${regie.controle.meldingen[0].herstel}`);
  toon();

  stap("Vrijgeven");
  r = await post("/v0/show-control/regie/vrijgeven", {}, "operator");
  assert.equal(r.json.stand, "show");
  console.log("\nregie-proef: doorloop ok");
  server.close(); runtime.close(); scriptAgent.close();
  process.exit(0);
}

main().catch((err) => { console.error(err); process.exit(1); });
