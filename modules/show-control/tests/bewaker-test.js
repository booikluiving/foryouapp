"use strict";

// Bewaker: TouchDesigner en teleprompter volgen de runtime. Zonder diensten (nep-cues, nep-teleprompter).

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { createBewaker } = require("../regie/bewaker");

const map = fs.mkdtempSync(path.join(os.tmpdir(), "bewaker-test-"));
const tdPad = path.join(map, "td-show.json");
const zetPid = (pid) => fs.writeFileSync(tdPad, JSON.stringify({ pid }));

function wereld({ tdAntwoordt = true } = {}) {
  const verstuurd = [];
  const bewaard = [];
  const tele = { preparedScene: { sceneId: 52 } };
  let klok = 1000000;
  let n = 0;
  const cues = {
    buildPhaseCue: ({ phase, name }) => ({ cueId: `c${++n}`, name, actions: [{ command: "td.phase.set", payload: { phase }, status: {} }] }),
    buildGoCue: () => ({ cueId: `c${++n}`, name: "go", actions: [] }),
    buildPrepareCue: () => ({ cueId: `c${++n}`, name: "prepare", actions: [] }),
    async executeCue(cue) {
      verstuurd.push(cue.name);
      for (const a of cue.actions) a.status = { state: tdAntwoordt ? "ok" : "warning" };
      return cue;
    },
    async saveCue(cue) { bewaard.push(cue.name); bewaker.zagCue(cue); },
  };
  const fetchImpl = async () => ({ ok: true, json: async () => tele });
  const bewaker = createBewaker({ cues, fetchImpl, tdPad, now: () => klok, opnieuwMs: 10000 });
  return { bewaker, verstuurd, bewaard, tele, verzet: (ms) => { klok += ms; }, zetAntwoord: (v) => { tdAntwoordt = v; } };
}

const runtime = (extra = {}) => ({
  showRunId: "run-1",
  status: "running",
  activeSituation: null,
  playedSituations: [{ situationId: "situation:1" }],
  resolvedPreparedNext: { situationId: "situation:52", legacySituationId: 52 },
  ...extra,
});
const fase = (f) => ({ actions: [{ command: "td.phase.set", payload: { phase: f }, status: { state: "ok" } }] });

(async () => {
  zetPid(111);
  {
    const w = wereld();
    w.bewaker.zagCue(fase(1));
    await w.bewaker.ronde(runtime());
    await w.bewaker.ronde(runtime());
    assert.deepEqual(w.verstuurd, [], "alles klopt: niets sturen");
    assert.equal(w.bewaker.status().meldingen.length, 0);
    console.log("ok: alles klopt, niets gestuurd");
  }
  {
    const w = wereld();
    w.bewaker.zagCue(fase(1));
    const speelt = runtime({ activeSituation: { situationId: "situation:52", resolved: {} } });
    await w.bewaker.ronde(speelt);
    assert.deepEqual(w.verstuurd, [], "eerste ronde wacht (wissel kan bezig zijn)");
    await w.bewaker.ronde(speelt);
    assert.equal(w.verstuurd.length, 1);
    assert.match(w.verstuurd[0], /fase 2/);
    assert.match(w.bewaker.status().meldingen[0].tekst, /fase 1, hoort 2/);
    assert.equal(w.bewaker.status().fase, 2);
    console.log("ok: scène speelt maar TD op loading → fase 2 hersteld");
  }
  {
    const w = wereld();
    w.bewaker.zagCue(fase(0));
    await w.bewaker.ronde(runtime());
    await w.bewaker.ronde(runtime());
    assert.deepEqual(w.verstuurd, [], "inloop tussen de scènes blijft inloop (keuze van de operator)");
    w.bewaker.zagCue(fase(2));
    await w.bewaker.ronde(runtime());
    await w.bewaker.ronde(runtime());
    assert.match(w.verstuurd[0], /fase 1/, "scène voorbij en TD nog op 2 → loading");
    console.log("ok: tussen de scènes: inloop blijft, 2 wordt loading");
  }
  {
    const w = wereld();
    w.bewaker.zagCue(fase(2));
    const speelt = runtime({ activeSituation: { situationId: "situation:52", resolved: {} } });
    await w.bewaker.ronde(speelt);
    zetPid(222);
    await w.bewaker.ronde(speelt);
    assert.deepEqual(w.verstuurd, ["Bewaker: TouchDesigner herstart, fase 2", "go"], "herstart TD: fase en omgeving opnieuw");
    assert.match(w.bewaker.status().meldingen[0].tekst, /herstart/);
    zetPid(111);
    console.log("ok: TouchDesigner herstart → fase en omgeving opnieuw");
  }
  {
    const w = wereld();
    w.bewaker.zagCue(fase(1));
    w.tele.preparedScene = null;
    await w.bewaker.ronde(runtime());
    assert.deepEqual(w.verstuurd, [], "teleprompter: eerste keer afwachten");
    await w.bewaker.ronde(runtime());
    assert.deepEqual(w.verstuurd, ["prepare"], "teleprompter zonder scène → opnieuw klaarzetten");
    assert.match(w.bewaker.status().meldingen[0].tekst, /Teleprompter/);
    console.log("ok: teleprompter kwijt (script-agent herstart) → opnieuw klaargezet");
  }
  {
    const w = wereld({ tdAntwoordt: false });
    w.bewaker.zagCue(fase(1));
    const speelt = runtime({ activeSituation: { situationId: "situation:52", resolved: {} } });
    await w.bewaker.ronde(speelt);
    await w.bewaker.ronde(speelt);
    assert.equal(w.verstuurd.length, 1);
    assert.deepEqual(w.bewaard, [], "zonder antwoord niet bewaren (geen volle cuelijst)");
    assert.equal(w.bewaker.status().td.reageert, false);
    await w.bewaker.ronde(speelt);
    await w.bewaker.ronde(speelt);
    assert.equal(w.verstuurd.length, 1, "niet elke ronde opnieuw zolang TD niet antwoordt");
    w.verzet(11000);
    w.zetAntwoord(true);
    await w.bewaker.ronde(speelt);
    await w.bewaker.ronde(speelt);
    assert.equal(w.verstuurd.length, 2, "na de wachttijd opnieuw");
    assert.equal(w.bewaker.status().td.reageert, true);
    console.log("ok: TouchDesigner antwoordt niet → melden, later opnieuw");
  }
  {
    const w = wereld();
    await w.bewaker.ronde(runtime({ playedSituations: [] }));
    await w.bewaker.ronde(runtime({ playedSituations: [] }));
    assert.match(w.verstuurd[0] || "", /fase 0/, "na opstarten zonder bekende fase: inloop als er nog niets gespeeld is");
    assert.equal(w.bewaker.status().meldingen.length, 0, "geen melding bij het opstarten");
    console.log("ok: opstarten zonder bekende fase");
  }
  console.log("bewaker-test: alles ok");
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
