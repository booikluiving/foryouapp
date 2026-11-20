"use strict";

// Testpubliek: een nagespeelde zaal voor de proefshow. Een aantal telefoons doet mee zoals echte
// telefoons (meedoen via de QR-link, dezelfde verbinding, geen bots), dus het algoritme rekent er
// precies mee zoals in de show: oordeel na de scène, chat en likes. Elk publiek heeft een smaak per
// label; daaruit volgen per telefoon de likes, de chat, het oordeel, het personage en de labelvraag.
// De regie speelt de run vanzelf: READY → START → scène → STOP → stemmen → Up next → opnieuw.

const WebSocket = require("ws");

// Smaak per label van −1 (haakt af) tot +1 (wil meer). ruis = hoe wisselend; likes en chat = hoe druk;
// stemt = kans dat een telefoon de vragen na de scène beantwoordt.
const PUBLIEKEN = {
  grof: {
    naam: "Wil grof",
    telefoons: 14,
    smaak: { Grof: 1, Absurd: 0.4, Satirisch: 0.2, Verwarring: -0.1, Herkenbaar: -0.4, Maatschappelijk: -0.8 },
    ruis: 0.25,
    likes: 1,
    chat: 0.7,
    stemt: 0.95,
  },
  subtiel: {
    naam: "Wil subtiel",
    telefoons: 12,
    smaak: { Grof: -1, Maatschappelijk: 0.7, Herkenbaar: 0.6, Satirisch: 0.4, Verwarring: 0.1, Absurd: -0.3 },
    ruis: 0.2,
    likes: 0.4,
    chat: 0.3,
    stemt: 0.9,
  },
  onrustig: {
    naam: "Gemengd en onrustig",
    telefoons: 18,
    // Twee kampen door elkaar; elke telefoon zit in een van beide, met veel ruis per scène.
    kampen: [
      { Grof: 1, Absurd: 0.6, Verwarring: 0.3, Maatschappelijk: -0.6, Herkenbaar: -0.2, Satirisch: 0 },
      { Grof: -0.8, Maatschappelijk: 0.5, Herkenbaar: 0.7, Satirisch: 0.5, Absurd: -0.4, Verwarring: -0.5 },
    ],
    ruis: 0.7,
    likes: 1.6,
    chat: 1.2,
    stemt: 0.65,
  },
};

const NAMEN = ["Sanne", "Daan", "Fleur", "Milan", "Noor", "Thijs", "Lotte", "Bram", "Iris", "Ruben", "Eva", "Sem", "Lieke", "Jesse", "Roos", "Luuk", "Femke", "Tim", "Anouk", "Joris", "Maud", "Stijn", "Esmee", "Gijs"];
const CHAT_PLUS = ["haha", "hahaha geweldig", "dit is top", "meer van dit", "briljant", "😂😂", "🔥🔥", "lol", "zo grappig", "bravo"];
const CHAT_MIN = ["saai", "meh", "volgende", "boeit niet", "😴", "zwak", "skip", "🥱", "cringe", "bah"];
const CHAT_NEUTRAAL = ["wat gebeurt hier", "hmm", "oke", "wacht wat", "😮"];

const wacht = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const klem = (waarde, min = -1, max = 1) => Math.min(max, Math.max(min, waarde));
const kies = (lijst) => lijst[Math.floor(Math.random() * lijst.length)];
// Normaal verdeeld (Box-Muller), gemiddeld 0.
function ruis(sd) {
  const u = 1 - Math.random();
  const v = Math.random();
  return sd * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}
// Vaste voorkeur van een telefoon voor een personage (−1..1), zodat elke telefoon zijn lievelingen heeft.
function vasteVoorkeur(tekst) {
  let h = 2166136261;
  for (const teken of tekst) h = Math.imul(h ^ teken.charCodeAt(0), 16777619);
  return ((h >>> 0) % 2001) / 1000 - 1;
}

function createTestpubliek({ url, vraag, runNu, knoppen, log }) {
  let loopt = null;
  let telefoons = [];
  let verloop = [];
  let fase = "";
  let foutmelding = "";
  // Zelf doorklikken: de regie wacht op "verder" met deze knoptekst.
  let wachtKnop = null;
  // Wat de publieksdienst denkt dat er speelt (zoals de telefoons het horen).
  let publiekFase = { fase: "tussen", situationRunId: null };

  function wachtOpKlik(run, label) {
    if (!run.stappen || loopt !== run) return Promise.resolve();
    return new Promise((resolve) => { wachtKnop = { label, resolve }; });
  }

  function verder() {
    if (!wachtKnop) return { ok: false, status: 409, body: { error: "niets_om_op_te_wachten" } };
    const { resolve } = wachtKnop;
    wachtKnop = null;
    resolve();
    return { ok: true, status: 200, body: {} };
  }

  // ---- De telefoons ----
  async function meedoen(publiek, nr, token) {
    const naam = `${NAMEN[nr % NAMEN.length]}${nr >= NAMEN.length ? ` ${Math.floor(nr / NAMEN.length) + 1}` : ""}`;
    const clientTag = `tp-${publiek.id}-${nr}-${Math.random().toString(36).slice(2, 8)}`;
    const join = await fetch(`${url("audience")}/join?token=${encodeURIComponent(token)}`, { redirect: "manual", signal: AbortSignal.timeout(5000) });
    const koekjes = (join.headers.getSetCookie ? join.headers.getSetCookie() : []).map((regel) => regel.split(";")[0]);
    if (join.status !== 302 || !koekjes.length) throw new Error(`meedoen lukt niet (${join.status})`);
    const smaak = publiek.kampen ? publiek.kampen[nr % publiek.kampen.length] : publiek.smaak;
    const telefoon = { nr, naam, clientTag, smaak, eigen: ruis(publiek.ruis * 0.5), ws: null, open: false, beantwoord: new Set() };
    await new Promise((resolve, reject) => {
      const ws = new WebSocket(`${url("audience").replace(/^http/, "ws")}/audience/realtime?sid=${Date.now()}`, { headers: { cookie: koekjes.join("; ") } });
      telefoon.ws = ws;
      const klaar = setTimeout(() => reject(new Error("verbinding duurt te lang")), 5000);
      ws.on("open", () => {
        clearTimeout(klaar);
        telefoon.open = true;
        stuur(telefoon, { type: "register", clientTag, name: naam });
        resolve();
      });
      ws.on("message", (raw) => {
        let bericht = null;
        try { bericht = JSON.parse(String(raw)); } catch (_err) { return; }
        if (bericht && bericht.type === "beoordeling" && bericht.beoordeling) beantwoord(telefoon, bericht.beoordeling);
        if (bericht && bericht.type === "fase") publiekFase = { fase: bericht.fase, situationRunId: bericht.situationRunId || null };
      });
      ws.on("close", () => { telefoon.open = false; });
      ws.on("error", (err) => { clearTimeout(klaar); reject(err); });
    });
    return telefoon;
  }

  function stuur(telefoon, bericht) {
    if (!telefoon.open) return;
    try { telefoon.ws.send(JSON.stringify({ ...bericht, clientTag: telefoon.clientTag })); } catch (_err) {}
  }

  function sluitTelefoons() {
    for (const telefoon of telefoons) {
      try { telefoon.ws.close(); } catch (_err) {}
    }
    telefoons = [];
  }

  // Wat deze telefoon van deze scène vindt: de smaak voor de labels, plus zijn eigen kleur en de stemming van nu.
  function zin(telefoon, scene, publiek) {
    const labels = scene.labels.length ? scene.labels : [""];
    const basis = labels.reduce((som, label) => som + Number(telefoon.smaak[label] || 0), 0) / labels.length;
    return klem(basis + telefoon.eigen + ruis(publiek.ruis));
  }

  // Tijdens de scène: likes (hart of saai) en een paar chatberichten, verspreid over de scène.
  function speelMee(telefoon, scene, publiek, duurMs, stop, snel = false) {
    const t = zin(telefoon, scene, publiek);
    telefoon.zin = t;
    const acties = [];
    const likes = Math.round(Math.random() * 12 * publiek.likes * Math.abs(t));
    for (let i = 0; i < likes; i += 1) acties.push({ op: snel ? i * 140 : Math.random() * duurMs, doe: () => stuur(telefoon, { type: "reaction", reaction: t >= 0 ? "heart" : "bored" }) });
    // Snel: hooguit één bericht per telefoon (de chat remt een tweede bericht kort na het eerste af).
    const berichten = Math.min(snel ? 1 : 9, Math.round(Math.random() * 2 * publiek.chat * (0.4 + Math.abs(t))));
    for (let i = 0; i < berichten; i += 1) {
      let tekst = Math.abs(t) < 0.2 ? kies(CHAT_NEUTRAAL) : t > 0 ? kies(CHAT_PLUS) : kies(CHAT_MIN);
      // Wie het goed vindt noemt soms een personage bij naam (telt als personagevoorkeur).
      if (t > 0.4 && scene.personages.length && Math.random() < 0.35) tekst = `meer ${kies(scene.personages).naam}!`;
      acties.push({ op: snel ? Math.random() * duurMs : 1500 + Math.random() * (duurMs - 1500), doe: () => stuur(telefoon, { type: "comment", name: telefoon.naam, text: tekst }) });
    }
    for (const actie of acties) {
      const timer = setTimeout(() => { if (!stop()) actie.doe(); }, actie.op);
      if (typeof timer.unref === "function") timer.unref();
    }
  }

  // Na de scène: de vragen op de telefoon, één voor één, met een beetje bedenktijd.
  async function beantwoord(telefoon, beoordeling) {
    if (!loopt || telefoon.beantwoord.has(beoordeling.id)) return;
    telefoon.beantwoord.add(beoordeling.id);
    const publiek = loopt.publiek;
    const snel = loopt.stappen;
    // Snel (zelf doorklikken): iedereen stemt meteen, anders met bedenktijd en niet iedereen.
    if (!snel && Math.random() > publiek.stemt) return;
    const t = Number.isFinite(telefoon.zin) ? telefoon.zin : 0;
    await wacht(Number(beoordeling.aanloopMs || 0) + (snel ? Math.random() * 300 : 1200 + Math.random() * 5000));
    for (const v of beoordeling.vragen || []) {
      if (!loopt) return;
      let keuze = null;
      if (v.id === "scene") {
        // De thermometer van onder naar boven: nooit, matig, goed, top.
        const ids = (v.keuzes || []).map((k) => k.id);
        const stap = klem(Math.floor(((t + 1) / 2) * ids.length), 0, ids.length - 1);
        keuze = ids[stap];
      } else if (v.id === "personage") {
        const echte = (v.keuzes || []).filter((k) => !k.nee);
        if (echte.length === 1) keuze = t + vasteVoorkeur(`${telefoon.clientTag}${echte[0].id}`) * 0.5 > 0 ? echte[0].id : "nee";
        else if (echte.length) keuze = echte.slice().sort((a, b) => vasteVoorkeur(`${telefoon.clientTag}${b.id}`) - vasteVoorkeur(`${telefoon.clientTag}${a.id}`))[0].id;
      } else if (v.id === "label") {
        const s = Number(telefoon.smaak[v.labelNaam] || 0) + ruis(publiek.ruis * 0.6);
        keuze = s > 0.3 ? "meer" : s < -0.3 ? "minder" : "goed";
      }
      if (!keuze) continue;
      stuur(telefoon, { type: "beoordeling_antwoord", id: beoordeling.id, vraag: v.id, keuze });
      await wacht(snel ? 30 : 600 + Math.random() * 2200);
    }
  }

  // ---- De regie ----
  function sceneVan(rt) {
    const actief = rt.activeSituation || {};
    const catalog = (rt.showRunSnapshot && rt.showRunSnapshot.catalog) || {};
    const situatie = (catalog.situations || []).find((item) => item.id === actief.situationId) || {};
    const labelNaam = new Map((catalog.labels || []).map((label) => [label.id, String(label.name || "").trim()]));
    const personageNaam = new Map((catalog.characters || []).map((item) => [item.id, String(item.name || "").trim()]));
    const slots = Array.isArray(actief.performerSlots) ? actief.performerSlots : [];
    const personages = slots.filter((slot) => slot && slot.characterId)
      .map((slot) => ({ id: slot.characterId, naam: String(slot.characterName || personageNaam.get(slot.characterId) || "").trim() }))
      .filter((p) => p.naam);
    return {
      situationRunId: actief.situationRunId || "",
      situationId: actief.situationId || "",
      titel: String(actief.title || situatie.title || actief.situationId || ""),
      labels: (actief.labelIds || situatie.labelIds || []).map((id) => labelNaam.get(id)).filter(Boolean),
      personages,
    };
  }

  async function wachtTot(voorwaarde, maxMs, stapMs = 700) {
    const tot = Date.now() + maxMs;
    while (loopt && Date.now() < tot) {
      const uit = await voorwaarde();
      if (uit) return uit;
      await wacht(stapMs);
    }
    return null;
  }

  const beoordelingLoopt = async () => {
    const stand = await vraag("audience", "/audience/stage/beoordeling", { timeoutMs: 1500 });
    return Boolean(stand.ok && stand.body && stand.body.lopend);
  };
  const schrijft = async () => {
    const status = await vraag("script-agent", "/v0/script-agent/operator/status", { timeoutMs: 1500 });
    return Boolean(status.ok && status.body && status.body.stage && status.body.stage.streaming);
  };

  // De score van elke gespeelde scène, zoals het algoritme hem berekende.
  async function werkScoresBij(showRunId) {
    const rapport = await vraag("algorithm", `/v0/algorithm/scoring-contexts/${encodeURIComponent(showRunId)}/report`, { timeoutMs: 3000 });
    const scenes = rapport.ok && rapport.body ? (rapport.body.report || rapport.body).scenes : null;
    if (!Array.isArray(scenes)) return;
    for (const rij of verloop) {
      const gevonden = scenes.find((s) => s.situationRunId === rij.situationRunId);
      if (!gevonden) continue;
      const c = gevonden.calculation || {};
      rij.score = { oordeel: c.oordeel, chat: c.chat, likes: c.likes, totaal: c.totaal, telefoons: c.telefoons };
    }
  }

  // De run klaarzetten: verse run zonder startscènes (zoals in de show), telefoons erin, START SHOW.
  async function zetKlaar(run) {
    const publiek = run.publiek;
    const gestopt = () => loopt !== run;
    let rt = await runNu();
    if (rt && rt.showRunId && rt.status !== "idle") await knoppen.run();
    await knoppen.run();
    rt = await wachtTot(async () => { const nu = await runNu(); return nu && nu.showRunId && nu.status !== "idle" ? nu : null; }, 10000, 200);
    if (!rt) throw new Error("de run start niet");
    run.showRunId = rt.showRunId;
    await vraag("runtime", `/v0/runtime/runs/${encodeURIComponent(rt.showRunId)}/order-settings`, { method: "PATCH", body: { startSceneCount: 0, randomizeEqualScores: true } });
    const sessie = await wachtTot(async () => {
      const stand = await vraag("audience", "/audience/admin/state", { timeoutMs: 2000 });
      return stand.ok && stand.body && stand.body.sessionJoin && stand.body.sessionJoin.token ? String(stand.body.sessionJoin.token) : null;
    }, 8000, 200);
    if (!sessie) throw new Error("geen publiekssessie");
    const binnen = await Promise.all(Array.from({ length: publiek.telefoons }, (_x, nr) => meedoen(publiek, nr, sessie)));
    if (gestopt()) { binnen.forEach((t) => { try { t.ws.close(); } catch (_err) {} }); return; }
    telefoons.push(...binnen);
    // START SHOW (met de content warning als die er is): de eerste scène wordt gekozen.
    for (let i = 0; i < 3 && !gestopt(); i += 1) {
      const stemming = await vraag("audience", "/audience/stage/start-stemming", { timeoutMs: 1500 });
      if (!(stemming.ok && stemming.body && stemming.body.showGestart === false)) break;
      await knoppen.run();
    }
  }

  // Na de scène: wachten tot de telefoons gestemd hebben (snel: hooguit kort, dan dicht).
  async function stemronde(run, rij, snel) {
    await wachtTot(beoordelingLoopt, 6000, 200);
    if (snel) {
      await wachtTot(async () => {
        const stand = await vraag("audience", "/audience/stage/beoordeling", { timeoutMs: 1500 });
        const lopend = stand.ok && stand.body ? stand.body.lopend : null;
        return !lopend || Number(lopend.gestemd || 0) >= telefoons.length;
      }, 2500, 200);
      if (await beoordelingLoopt()) await vraag("audience", "/audience/admin/beoordeling/sluit", { method: "POST", body: { reden: "operator" } });
    } else {
      await wachtTot(async () => !(await beoordelingLoopt()), 45000);
    }
    const stand = await vraag("audience", "/audience/stage/beoordeling", { timeoutMs: 1500 });
    const laatste = stand.ok && stand.body ? stand.body.laatste : null;
    if (laatste && laatste.tellingen) rij.stemmen = { scene: laatste.tellingen.scene || null, deelnemers: laatste.deelnemers };
    // De scores komen even later (het algoritme rekent op de achtergrond).
    for (const na of [800, 2500, 6000]) setTimeout(() => { werkScoresBij(run.showRunId).catch(() => {}); }, na).unref();
  }

  async function regie(run, { scenes, sceneSec, upNextSec }) {
    const publiek = run.publiek;
    const gestopt = () => loopt !== run;
    const snel = run.stappen;
    fase = "";
    await zetKlaar(run);

    for (let nr = 1; nr <= scenes && !gestopt(); nr += 1) {
      const rt0 = await wachtTot(async () => { const nu = await runNu(); return nu && nu.preparedNext ? nu : null; }, 20000, 200);
      if (!rt0) throw new Error("er staat geen scène klaar");
      fase = "";
      if (snel) {
        await wachtOpKlik(run, `Start scène ${nr}`);
      } else {
        await wachtTot(async () => !(await schrijft()), 60000, 1000);
        await wacht(upNextSec * 1000);
      }
      if (gestopt()) return;
      await knoppen.ready();
      const gestart = await knoppen.scene();
      if (!gestart.ok) throw new Error(`scène start niet (${gestart.status})`);
      const rt = await wachtTot(async () => { const nu = await runNu(); return nu && nu.activeSituation ? nu : null; }, 10000, 200);
      if (!rt) throw new Error("scène speelt niet");
      const scene = sceneVan(rt);
      const rij = { nr, titel: scene.titel, labels: scene.labels, situationRunId: scene.situationRunId, stemmen: null, score: null };
      verloop.push(rij);
      fase = `scène ${nr} speelt`;
      log(`testpubliek ${publiek.id}: scène ${nr} ${scene.titel} [${scene.labels.join(", ")}]`);
      // Pas reageren als de publieksdienst de scène ziet (die kijkt eens per seconde naar de runtime);
      // anders tellen de reacties niet voor deze scène en komt er na de stop geen stemronde.
      await wachtTot(async () => publiekFase.fase === "scene" && publiekFase.situationRunId === scene.situationRunId, 4000, 100);
      run.sceneNr = nr;
      // Reacties stoppen zodra de run stopt of deze scène voorbij is. Snel: alles in de eerste seconde.
      const voorbij = () => gestopt() || run.sceneNr !== nr;
      for (const telefoon of telefoons) speelMee(telefoon, scene, publiek, snel ? 1200 : sceneSec * 1000, voorbij, snel);
      rij.zin = Math.round((telefoons.reduce((som, telefoon) => som + telefoon.zin, 0) / Math.max(1, telefoons.length)) * 100) / 100;
      if (snel) await wachtOpKlik(run, `Stop scène ${nr}`);
      else await wacht(sceneSec * 1000);
      if (gestopt()) return;
      run.sceneNr = 0;
      await knoppen.scene();
      fase = "stemmen";
      await stemronde(run, rij, snel);
    }
    fase = "klaar";
  }

  async function start({ publiek: id, stappen = true, scenes, sceneSec = 20, upNextSec = 5 } = {}) {
    const profiel = PUBLIEKEN[id];
    if (!profiel) return { ok: false, status: 400, body: { error: "onbekend_publiek" } };
    await stop();
    const run = { publiek: { ...profiel, id }, stappen: Boolean(stappen), startedAt: new Date().toISOString() };
    loopt = run;
    verloop = [];
    foutmelding = "";
    const opties = { scenes: klem(Number(scenes) || (run.stappen ? 30 : 8), 1, 30), sceneSec: klem(Number(sceneSec) || 20, 6, 180), upNextSec: klem(Number(upNextSec) || 5, 1, 60) };
    regie(run, opties)
      .catch((err) => {
        if (loopt !== run) return;
        foutmelding = String(err && err.message || err);
        log(`testpubliek: ${foutmelding}`);
      })
      .finally(() => {
        if (loopt !== run) return;
        loopt = null;
        fase = foutmelding ? "gestopt" : "klaar";
        sluitTelefoons();
      });
    return { ok: true, status: 200, body: { publiek: id } };
  }

  async function stop() {
    const was = loopt;
    loopt = null;
    if (wachtKnop) verder();
    sluitTelefoons();
    if (!was) return { ok: true, status: 200, body: {} };
    fase = "gestopt";
    const rt = await runNu();
    if (rt && rt.activeSituation) await knoppen.scene();
    return { ok: true, status: 200, body: {} };
  }

  function stand() {
    return {
      publieken: Object.entries(PUBLIEKEN).map(([id, p]) => ({ id, naam: p.naam, telefoons: p.telefoons })),
      loopt: Boolean(loopt),
      publiek: loopt ? loopt.publiek.id : null,
      telefoons: telefoons.filter((t) => t.open).length,
      fase,
      stappen: Boolean(loopt && loopt.stappen),
      // De knop waarop de regie wacht (zelf doorklikken), of null.
      wacht: wachtKnop ? wachtKnop.label : null,
      fout: foutmelding,
      verloop,
    };
  }

  return { start, stop, verder, stand };
}

module.exports = { createTestpubliek, PUBLIEKEN };
