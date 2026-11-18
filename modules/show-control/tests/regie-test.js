"use strict";

// Regie: één weg, één eigenaar, één voor één. Draait zonder diensten (nep-runtime, nep-cues).

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { createRegie, maakSlot } = require("../regie/regie");
const { executeCue, executeUitgesteld } = require("../cue-engine/cue-engine");
const { buildStopSituationCue } = require("../cue-library/runtime-cues");

const map = fs.mkdtempSync(path.join(os.tmpdir(), "regie-test-"));
let teller = 0;

function nepWereld() {
  const runtime = {
    showRunId: null,
    status: "idle",
    testRun: null,
    activeSituation: null,
    preparedNext: null,
    resolvedPreparedNext: null,
    playedSituations: [],
    pathEvaluation: { items: [{ situationId: "situation:1", isPathStart: true }] },
    showRunSnapshot: { catalog: { situations: [1, 2, 3, 4].map((n) => ({ id: `situation:${n}`, title: `Scène ${n}` })) } },
  };
  const log = [];
  const json = (body, status = 200) => ({ ok: status < 400, status, json: async () => body });
  async function fetchImpl(url, opts = {}) {
    const pad = url.replace(/^https?:\/\/[^/]+/, "");
    const body = opts.body ? JSON.parse(opts.body) : {};
    log.push(`${opts.method || "GET"} ${pad}`);
    if (pad === "/v0/runtime/runs/current") return json(runtime.showRunId ? runtime : { status: "idle" });
    if (pad.endsWith("/test-run")) { runtime.testRun = { enabled: body.enabled === true }; return json(runtime); }
    if (pad.endsWith("/prepare-situation")) {
      runtime.preparedNext = { situationId: body.situationId, title: `Scène ${body.situationId.split(":")[1]}` };
      runtime.resolvedPreparedNext = { situationId: body.situationId, environment: { name: "Kamer" } };
      return json(runtime);
    }
    if (pad.includes("/script-agent/operator/status")) return json({ stage: { sessionId: "sessie-1" } });
    if (pad.includes("/script-agent/operator/session/")) return json({ ok: true });
    return json({ error: "onbekend" }, 404);
  }
  const cues = [];
  const bouw = (soort) => (input = {}) => ({ cueId: `cue-${++teller}`, soort, name: input.name || soort, input });
  const nepCues = {
    buildCompoundCue: bouw("compound"),
    buildPhaseCue: bouw("phase"),
    buildPrepareCue: (state) => ({ cueId: `cue-${++teller}`, soort: "prepare", situationId: state.preparedNext && state.preparedNext.situationId }),
    buildSceneToChatCue: (state, options) => ({ cueId: `cue-${++teller}`, soort: "chat", schrijven: options.schrijven }),
    buildStartRunCue: bouw("start-run"),
    buildStartSituationCue: bouw("start"),
    buildStopSituationCue: bouw("stop"),
    async executeCue(cue) {
      cues.push(cue);
      if (cue.soort === "start-run") Object.assign(runtime, { showRunId: "run-1", status: "running" });
      if (cue.soort === "start") {
        runtime.activeSituation = { situationId: runtime.preparedNext.situationId, title: runtime.preparedNext.title };
      }
      if (cue.soort === "stop") {
        runtime.playedSituations.push(runtime.activeSituation);
        runtime.activeSituation = null;
      }
      if (cue.soort === "compound" && cue.input.actions[0].command === "runtime.resetRun") {
        Object.assign(runtime, { status: "reset", activeSituation: null, preparedNext: null, testRun: null });
      }
      return cue;
    },
    async executeUitgesteld() {},
    async saveCue() {},
  };
  return { runtime, log, cues, fetchImpl, nepCues };
}

function maakRegie(wereld, extra = {}) {
  let klok = Date.parse("2026-11-18T21:00:00Z");
  const regie = createRegie({
    bestand: path.join(map, `regie-${++teller}.json`),
    fetchImpl: wereld.fetchImpl,
    cues: wereld.nepCues,
    now: () => klok,
    wait: async () => {},
    ...extra,
  });
  return { regie, verzet: (ms) => { klok += ms; } };
}

const req = (wie, name = "") => ({ get: (kop) => (kop === "x-foryou-wie" ? wie : ""), body: { name } });

async function testSlot() {
  const slot = maakSlot(50);
  const volgorde = [];
  const a = slot(async () => { await new Promise((r) => setTimeout(r, 20)); volgorde.push("a"); });
  const b = slot(async () => { volgorde.push("b"); });
  await Promise.all([a, b]);
  assert.deepEqual(volgorde, ["a", "b"], "één voor één, in volgorde");
  // Een houder die blijft hangen houdt de rest niet langer op dan de grens.
  slot(() => new Promise(() => {}));
  const start = Date.now();
  await slot(async () => {});
  assert.ok(Date.now() - start < 1000, "na de grens gaat de volgende door");
  console.log("ok: slot");
}

async function testBewaking() {
  const wereld = nepWereld();
  const { regie } = maakRegie(wereld);
  assert.equal(regie.mag(req("iemand")).ok, true, "show zonder eigenaar: iedereen");
  await regie.overnemen({ wie: "escape-room", stand: "test" });
  assert.equal(wereld.runtime.status, "running", "overnemen start zo nodig een run");
  assert.equal(wereld.runtime.testRun.enabled, true, "en maakt hem een testrun");
  assert.equal(regie.mag(req("escape-room")).ok, true, "de eigenaar mag");
  const ander = regie.mag(req("operator"));
  assert.equal(ander.ok, false, "een ander niet");
  assert.equal(ander.status, 423);
  assert.match(ander.body.message, /escape-room/);
  assert.equal(regie.mag(req("", "Stream Deck stop situation")).ok, true, "de deck in de zaal wel");
  assert.equal(regie.mag(req("", "Teleprompter end scene")).ok, true, "de klikker wel");
  await assert.rejects(regie.overnemen({ wie: "operator", stand: "test" }), (err) => err.statusCode === 423, "overnemen terwijl bezet: nee");
  await regie.overnemen({ wie: "operator", stand: "test", forceer: true });
  assert.equal(regie.stand().eigenaar.wie, "operator", "forceer neemt toch over");
  console.log("ok: bewaking");
}

async function testLaden() {
  const wereld = nepWereld();
  const { regie } = maakRegie(wereld);
  await assert.rejects(regie.laad({ wie: "x", situationId: "situation:2" }), (err) => err.statusCode === 409, "zonder regie geen laden");
  await regie.overnemen({ wie: "x", stand: "test" });
  wereld.cues.length = 0;
  await regie.laad({ wie: "x", situationId: "situation:2" });
  assert.deepEqual(wereld.cues.map((c) => c.soort), ["prepare", "chat"], "klaarzetten en bewaard script");
  assert.equal(wereld.cues[1].schrijven, false, "standaard zonder schrijven");
  assert.equal(wereld.runtime.activeSituation, null, "inladen start niet");
  wereld.cues.length = 0;
  await regie.laad({ wie: "x", situationId: "situation:3", start: true });
  assert.deepEqual(wereld.cues.map((c) => c.soort), ["prepare", "chat", "start"], "inladen + start");
  assert.equal(wereld.runtime.activeSituation.situationId, "situation:3");
  wereld.cues.length = 0;
  await regie.laad({ wie: "x", situationId: "situation:4" });
  assert.deepEqual(wereld.cues.map((c) => c.soort), ["stop", "prepare", "chat"], "speelt er iets: eerst stoppen");
  assert.equal(wereld.runtime.preparedNext.situationId, "situation:4");
  console.log("ok: laden");
}

async function testRandomEnVrijgeven() {
  const wereld = nepWereld();
  const { regie, verzet } = maakRegie(wereld);
  await regie.overnemen({ wie: "r", stand: "random" });
  const eerste = wereld.runtime.preparedNext.situationId;
  assert.notEqual(eerste, "situation:1", "random kiest nooit een startscène");
  await regie.start({ wie: "r" });
  await regie.stop({ wie: "r" });
  assert.ok(wereld.runtime.preparedNext.situationId !== eerste, "na de stop staat er een andere random scène klaar");
  wereld.cues.length = 0;
  await regie.vrijgeven({ wie: "r" });
  assert.deepEqual(wereld.cues.map((c) => c.soort), ["compound", "phase"], "vrijgeven: reset en inloop");
  assert.equal(regie.stand().stand, "show");
  assert.equal(regie.stand().eigenaar, null);
  assert.ok(wereld.log.some((regel) => regel.startsWith("DELETE /v0/script-agent/operator/session/")), "script van het tussenscherm weg");
  // Verlopen: geeft zichzelf vrij als er niets speelt.
  await regie.overnemen({ wie: "r", stand: "test", minuten: 1 });
  verzet(2 * 60000);
  await regie.tick();
  assert.equal(regie.stand().stand, "show", "verlopen regie is vrijgegeven");
  console.log("ok: random en vrijgeven");
}

async function testStopAntwoordtVoorKlaarzetten() {
  const volgorde = [];
  const adapters = {
    runtime: async (action) => {
      volgorde.push(action.command);
      return {
        stage: "applied",
        state: "ok",
        generatedActions: [
          { command: "audio.extra.stop", targetId: "mac-audio", ackMode: "fire-and-forget", payload: {} },
          { command: "teleprompter.prepare", targetId: "teleprompter", ackMode: "fire-and-forget", payload: {}, naAntwoord: true },
        ],
      };
    },
    touchdesigner: async (action) => { volgorde.push(action.command); return { stage: "applied", state: "ok" }; },
    dmx: async (action) => { volgorde.push(action.command); return { stage: "applied", state: "ok" }; },
    macaudio: async (action) => { volgorde.push(action.command); return { stage: "applied", state: "ok" }; },
    teleprompter: async (action) => { volgorde.push(action.command); return { stage: "applied", state: "ok" }; },
  };
  const cue = buildStopSituationCue({ name: "test", showRunId: "run-1" });
  await executeCue(cue, { adapters, uitstellen: true });
  assert.ok(!volgorde.includes("teleprompter.prepare"), "klaarzetten nog niet gedaan als de stop klaar is");
  assert.ok(volgorde.includes("audio.extra.stop"), "opruimen hoort bij de stop zelf");
  assert.ok(volgorde.includes("td.phase.set"), "loading hoort bij de stop zelf");
  await executeUitgesteld(cue, { adapters });
  assert.equal(volgorde.at(-1), "teleprompter.prepare", "daarna het klaarzetten");
  assert.ok(!JSON.stringify(cue).includes("_uitgesteld"), "niet in de opgeslagen cue");
  console.log("ok: stop antwoordt voor het klaarzetten");
}

// Het slot laat zijn grens-timer los (unref); deze timer houdt de test in leven.
const houd = setInterval(() => {}, 1000);

(async () => {
  await testSlot();
  await testBewaking();
  await testLaden();
  await testRandomEnVrijgeven();
  await testStopAntwoordtVoorKlaarzetten();
  console.log("regie-test: alles ok");
  clearInterval(houd);
})().catch((err) => {
  console.error(err);
  clearInterval(houd);
  process.exit(1);
});
