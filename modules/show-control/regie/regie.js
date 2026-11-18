"use strict";

// Regie: de ene weg om de run en de scènes te bedienen.
//
// Standen:
//   show    het pad en het publiek kiezen de scènes (zoals in een voorstelling). Iedereen mag bedienen.
//   test    één iemand (de eigenaar) kiest met de hand welke scène er klaarstaat en start hem.
//   random  één iemand; de regie zet steeds een willekeurige scène klaar.
// In test en random heeft precies één iemand de regie, tot hij vrijgeeft of de tijd om is. Een ander
// krijgt "bezet". De knoppen in de zaal (Stream Deck, klikker, ready van de spelers) werken altijd.
// Vrijgeven = de scène stopt, de run gaat terug naar het begin (reset, inloop) en de stand wordt show.
//
// Alles wat de run of de scène verandert, gaat één voor één (slot): een stop, het klaarzetten daarna
// en een nieuwe keuze lopen nooit door elkaar.

const fs = require("node:fs");
const path = require("node:path");

const STANDEN = new Set(["show", "test", "random"]);
const STANDAARD_MINUTEN = 30;
const MAX_MINUTEN = 240;
const SLOT_MAX_MS = 30000;
// Bronnen in de zaal: die mogen altijd (de mensen in de ruimte gaan voor).
const ZAAL_BRONNEN = [/^Stream Deck/i, /^Teleprompter/i, /^Spelers ready/i, /^Perfect Cue/i];

function regieFout(status, code, message, extra = {}) {
  const err = new Error(message);
  err.statusCode = status;
  err.code = code;
  Object.assign(err, extra);
  return err;
}

// Eén tegelijk. Een houder die blijft hangen houdt de rest na SLOT_MAX_MS niet langer op.
function maakSlot(maxMs = SLOT_MAX_MS) {
  let staart = Promise.resolve();
  return function slot(fn) {
    const vorige = staart;
    const werk = vorige.then(() => fn());
    const grens = vorige.then(() => new Promise((resolve) => {
      const timer = setTimeout(resolve, maxMs);
      if (typeof timer.unref === "function") timer.unref();
    }));
    staart = Promise.race([werk.catch(() => {}), grens]);
    return werk;
  };
}

function standaardPad() {
  return process.env.SHOW_CONTROL_REGIE_PATH || path.join(__dirname, "..", "db", "regie.json");
}

function leesStand(bestand) {
  try {
    const data = JSON.parse(fs.readFileSync(bestand, "utf8"));
    return {
      stand: STANDEN.has(data.stand) ? data.stand : "show",
      eigenaar: data.eigenaar && data.eigenaar.wie ? data.eigenaar : null,
      schrijven: data.schrijven === true,
      bijgewerkt: data.bijgewerkt || null,
    };
  } catch (_err) {
    return { stand: "show", eigenaar: null, schrijven: false, bijgewerkt: null };
  }
}

function schrijfStand(bestand, stand) {
  fs.mkdirSync(path.dirname(bestand), { recursive: true });
  const tmp = `${bestand}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(stand, null, 2)}\n`);
  fs.renameSync(tmp, bestand);
}

function schoneNaam(waarde) {
  return String(waarde || "").trim().replace(/\s+/g, " ").slice(0, 60);
}

// Wie vraagt het: kop x-foryou-wie, of "wie" in de body.
function wieVan(req) {
  const kop = req && typeof req.get === "function" ? req.get("x-foryou-wie") : "";
  return schoneNaam(kop || (req && req.body && req.body.wie) || "");
}

function uitDeZaal(req) {
  const naam = String(req && req.body && req.body.name || "");
  return ZAAL_BRONNEN.some((patroon) => patroon.test(naam));
}

function createRegie(options = {}) {
  const bestand = options.bestand || standaardPad();
  const nu = options.now || (() => Date.now());
  const wacht = options.wait || ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  const runtimeUrl = String(options.runtimeUrl || process.env.SHOW_CONTROL_RUNTIME_URL || "http://127.0.0.1:3024").replace(/\/+$/, "");
  const scriptAgentUrl = String(options.scriptAgentUrl || process.env.SHOW_CONTROL_SCRIPT_AGENT_URL || "http://127.0.0.1:3027").replace(/\/+$/, "");
  const audienceUrl = String(options.audienceUrl || process.env.SHOW_CONTROL_AUDIENCE_URL || "http://127.0.0.1:3026").replace(/\/+$/, "");
  // Cues bouwen en afvuren: dezelfde functies als de routes van show control.
  const cues = options.cues;
  const slot = options.slot || maakSlot();
  const random = { huidige: null, titel: "", gehad: new Set(), fout: "" };

  function stand() {
    const s = leesStand(bestand);
    if (s.eigenaar && Date.parse(s.eigenaar.tot || "") <= nu()) s.verlopen = true;
    return s;
  }

  function bewaar(nieuw) {
    const s = { ...nieuw, bijgewerkt: new Date(nu()).toISOString() };
    schrijfStand(bestand, s);
    return s;
  }

  // Mag deze vraag de run of de scène veranderen?
  function mag(req) {
    const s = stand();
    if (!s.eigenaar || s.verlopen) return { ok: true };
    if (uitDeZaal(req)) return { ok: true, zaal: true };
    if (wieVan(req) === s.eigenaar.wie) return { ok: true };
    return {
      ok: false,
      status: 423,
      body: {
        ok: false,
        error: "regie_bezet",
        message: `De regie is van ${s.eigenaar.wie} (${s.stand}) tot ${tijd(s.eigenaar.tot)}. Wacht tot die vrijgeeft.`,
        eigenaar: s.eigenaar,
        stand: s.stand,
      },
    };
  }

  function tijd(iso) {
    const d = new Date(iso || "");
    return Number.isNaN(d.getTime()) ? "?" : d.toLocaleTimeString("nl-NL", { hour: "2-digit", minute: "2-digit" });
  }

  function eisEigenaar(wie) {
    const s = stand();
    if (s.stand === "show" || !s.eigenaar || s.verlopen) throw regieFout(409, "geen_regie", "Neem eerst de regie over (test of random).");
    if (s.eigenaar.wie !== wie) throw regieFout(423, "regie_bezet", `De regie is van ${s.eigenaar.wie}.`, { eigenaar: s.eigenaar });
    return s;
  }

  // Elke handeling van de eigenaar verlengt de tijd.
  function verleng(s) {
    if (!s.eigenaar) return s;
    const minuten = Number(s.eigenaar.minuten || STANDAARD_MINUTEN);
    return bewaar({ ...s, eigenaar: { ...s.eigenaar, tot: new Date(nu() + minuten * 60000).toISOString() } });
  }

  async function vraag(basis, pad, { method = "GET", body, timeoutMs = 8000 } = {}) {
    let antwoord;
    try {
      antwoord = await fetchImpl(`${basis}${pad}`, {
        method,
        headers: body === undefined ? {} : { "content-type": "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (_err) {
      throw regieFout(502, "onbereikbaar", `${basis} is niet bereikbaar.`);
    }
    const json = await antwoord.json().catch(() => null);
    return { ok: antwoord.ok, status: antwoord.status, json };
  }

  async function run() {
    const r = await vraag(runtimeUrl, "/v0/runtime/runs/current", { timeoutMs: 3000 });
    return r.ok ? r.json : null;
  }

  function loopt(state) {
    return !!(state && state.showRunId && state.status === "running");
  }

  function bezig(state) {
    const fin = state && state.finalizationStatus && state.finalizationStatus.status;
    return !!(state && state.activeSituation) || fin === "pending" || fin === "running";
  }

  // ---------- de handelingen (binnen het slot) ----------

  async function stopScene(naam) {
    const state = await run();
    if (!state || !state.activeSituation) return state;
    const cue = cues.buildStopSituationCue({ name: naam, showRunId: state.showRunId });
    await cues.executeCue(cue, { runtimeState: state, uitstellen: true });
    await cues.executeUitgesteld(cue);
    await cues.saveCue(cue);
    // Wachten tot de runtime de scène heeft afgerond.
    const grens = nu() + 15000;
    let laatste = await run();
    while (bezig(laatste)) {
      if (nu() > grens) throw regieFout(504, "stop_te_lang", "De scène is nog niet afgerond. Probeer het zo opnieuw.");
      await wacht(300);
      laatste = await run();
    }
    return laatste;
  }

  async function zorgVoorTestrun() {
    let state = await run();
    if (!loopt(state)) {
      const cue = cues.buildStartRunCue({ name: "Regie: start run", autoPrepareNext: true });
      await cues.executeCue(cue, {});
      await cues.saveCue(cue);
      state = await run();
      if (!loopt(state)) throw regieFout(502, "geen_run", "De run starten lukte niet.");
    }
    if (!(state.testRun && state.testRun.enabled === true)) {
      const r = await vraag(runtimeUrl, `/v0/runtime/runs/${encodeURIComponent(state.showRunId)}/test-run`, { method: "POST", body: { enabled: true } });
      if (!r.ok) throw regieFout(502, "runtime_fout", "De run testrun maken lukte niet.");
      state = r.json;
    }
    return state;
  }

  // Het script bij de scène die klaarstaat: schrijven met het taalmodel, of het bewaarde script.
  async function scriptVoorKlaar(state, schrijven) {
    if (!state || !state.resolvedPreparedNext) return null;
    const cue = cues.buildSceneToChatCue(state, {
      name: schrijven ? "Regie: scène schrijven" : "Regie: bewaard script",
      sourceId: schrijven ? "regie-schrijven" : "regie-zonder-schrijven",
      schrijven,
      timeoutMs: schrijven ? 90000 : 8000,
    });
    if (schrijven) {
      // Schrijven duurt even: niet in het slot wachten. Wie wil starten als de tekst er is, wacht op .klaar.
      const klaar = cues.executeCue(cue, {}).then(() => cues.saveCue(cue)).catch(() => {});
      return { schrijven: true, klaar };
    }
    await cues.executeCue(cue, {});
    await cues.saveCue(cue);
    return { schrijven: false };
  }

  async function zetKlaar(state, keuze, schrijven) {
    const r = await vraag(runtimeUrl, `/v0/runtime/runs/${encodeURIComponent(state.showRunId)}/prepare-situation`, {
      method: "POST",
      body: { ...(keuze.situationId ? { situationId: keuze.situationId } : {}), ...(keuze.environmentId ? { environmentId: keuze.environmentId } : {}), testRun: true },
    });
    if (!r.ok) {
      const code = r.json && r.json.error;
      if (code === "runtime_unknown_situation") throw regieFout(404, "onbekend", "Deze situatie staat niet (actief) in de catalogus.");
      if (code === "runtime_unknown_environment") throw regieFout(404, "onbekend", "Deze omgeving staat niet in de catalogus.");
      throw regieFout(502, "klaarzetten_mislukt", "De scène klaarzetten lukte niet.");
    }
    const klaar = r.json;
    const cue = cues.buildPrepareCue(klaar);
    await cues.executeCue(cue, { runtimeState: klaar });
    await cues.saveCue(cue);
    const script = await scriptVoorKlaar(klaar, schrijven);
    Object.defineProperty(klaar, "_schrijft", { value: script && script.klaar ? script.klaar : null, enumerable: false });
    return klaar;
  }

  async function startScene(naam) {
    const state = await run();
    if (!loopt(state)) throw regieFout(409, "geen_run", "Er loopt geen run.");
    if (state.activeSituation) return state;
    const cue = cues.buildStartSituationCue({ name: naam, showRunId: state.showRunId });
    await cues.executeCue(cue, { runtimeState: state });
    await cues.saveCue(cue);
    return run();
  }

  async function resetRun(naam) {
    const state = await run();
    if (state && state.showRunId && state.status !== "idle") {
      const cue = cues.buildCompoundCue({
        name: naam,
        actions: [{ command: "runtime.resetRun", ackMode: "acknowledged-async", payload: { showRunId: state.showRunId }, timeoutMs: 5000 }],
      });
      await cues.executeCue(cue, {});
      await cues.saveCue(cue);
    }
    const fase = cues.buildPhaseCue({ name: `${naam}: terug naar inloop`, phase: 0, phaseName: "inloop" });
    await cues.executeCue(fase, {});
    await cues.saveCue(fase);
    // Het script dat nog op het tussenscherm stond weg (zoals RESET RUN op de deck).
    const status = await vraag(scriptAgentUrl, "/v0/script-agent/operator/status", { timeoutMs: 1500 }).catch(() => null);
    const sessies = new Set([state && state.showRunId, status && status.ok && status.json && status.json.stage ? status.json.stage.sessionId : null].filter(Boolean));
    for (const sessie of sessies) {
      await vraag(scriptAgentUrl, `/v0/script-agent/operator/session/${encodeURIComponent(sessie)}`, { method: "DELETE", timeoutMs: 2500 }).catch(() => null);
    }
    random.huidige = null;
    random.gehad = new Set();
  }

  function kiesRandom(state) {
    const items = (state.pathEvaluation && state.pathEvaluation.items) || [];
    const start = new Set(items.filter((item) => item.isPathStart === true).map((item) => item.situationId));
    const gespeeld = new Set((state.playedSituations || []).map((item) => item.situationId));
    const actief = state.activeSituation ? state.activeSituation.situationId : null;
    const catalogus = (state.showRunSnapshot && state.showRunSnapshot.catalog) || {};
    const alle = (catalogus.situations || [])
      .filter((item) => item && item.id && item.active !== false && item.isActive !== false && !start.has(item.id) && item.id !== actief);
    let keuze = alle.filter((item) => !gespeeld.has(item.id) && !random.gehad.has(item.id));
    if (!keuze.length) {
      random.gehad.clear();
      keuze = alle.filter((item) => item.id !== random.huidige);
    }
    return keuze.length ? keuze[Math.floor(Math.random() * keuze.length)] : null;
  }

  async function laadRandom(schrijven) {
    let state = await run();
    if (bezig(state)) state = await stopScene("Regie: stop voor random");
    const keuze = kiesRandom(state);
    if (!keuze) throw regieFout(409, "niets_vrij", "Er is geen scène om te kiezen.");
    random.huidige = keuze.id;
    random.titel = keuze.title || keuze.naam || "";
    random.gehad.add(keuze.id);
    return zetKlaar(state, { situationId: keuze.id }, schrijven);
  }

  // ---------- publieke functies ----------

  // forceer: alleen vanaf de regiepagina, na een bevestiging (iemand vergat vrij te geven).
  async function overnemen({ wie, stand: nieuweStand = "test", minuten, forceer = false } = {}) {
    const naam = schoneNaam(wie);
    if (!naam) throw regieFout(400, "geen_naam", "Zeg wie de regie overneemt (wie).");
    if (!["test", "random"].includes(nieuweStand)) throw regieFout(400, "stand", "Stand is test of random.");
    const min = Math.max(1, Math.min(MAX_MINUTEN, Number(minuten) || STANDAARD_MINUTEN));
    return slot(async () => {
      const s = stand();
      if (s.eigenaar && !s.verlopen && s.eigenaar.wie !== naam && forceer !== true) {
        throw regieFout(423, "regie_bezet", `De regie is van ${s.eigenaar.wie} tot ${tijd(s.eigenaar.tot)}.`, { eigenaar: s.eigenaar });
      }
      await zorgVoorTestrun();
      const nieuw = bewaar({
        stand: nieuweStand,
        eigenaar: { wie: naam, sinds: s.eigenaar && s.eigenaar.wie === naam ? s.eigenaar.sinds : new Date(nu()).toISOString(), minuten: min, tot: new Date(nu() + min * 60000).toISOString() },
        schrijven: s.schrijven === true,
      });
      if (nieuweStand === "random") {
        random.gehad = new Set();
        const state = await run();
        if (!bezig(state)) await laadRandom(nieuw.schrijven);
      }
      return overzicht();
    });
  }

  async function vrijgeven({ wie, systeem = false } = {}) {
    const naam = schoneNaam(wie);
    return slot(async () => {
      const s = stand();
      if (!systeem && s.eigenaar && !s.verlopen && s.eigenaar.wie !== naam) {
        throw regieFout(423, "regie_bezet", `De regie is van ${s.eigenaar.wie}; alleen die kan vrijgeven.`, { eigenaar: s.eigenaar });
      }
      if (s.stand !== "show") {
        await stopScene("Regie: vrijgeven, stop scène");
        await resetRun("Regie: vrijgeven, reset run");
      }
      bewaar({ stand: "show", eigenaar: null, schrijven: s.schrijven === true });
      return overzicht();
    });
  }

  async function zetSchrijven({ wie, schrijven } = {}) {
    return slot(async () => {
      const s = eisEigenaar(schoneNaam(wie));
      verleng({ ...s, schrijven: schrijven === true });
      return overzicht();
    });
  }

  // Een scène inladen (klaarzetten in TouchDesigner, teleprompter en script) en desgewenst starten.
  async function laad({ wie, situationId, environmentId, start = false, schrijven } = {}) {
    const naam = schoneNaam(wie);
    const sit = String(situationId || "").trim();
    const omg = String(environmentId || "").trim();
    if (!sit && !omg) throw regieFout(400, "geen_keuze", "Kies een situatie of een omgeving.");
    const geladen = await slot(async () => {
      const s = verleng(eisEigenaar(naam));
      const metSchrijven = schrijven === undefined ? s.schrijven === true : schrijven === true;
      let state = await zorgVoorTestrun();
      if (bezig(state)) state = await stopScene("Regie: stop voor inladen");
      const klaar = await zetKlaar(state, { situationId: sit, environmentId: omg }, metSchrijven);
      if (s.stand === "random") random.huidige = klaar.preparedNext ? klaar.preparedNext.situationId : sit;
      if (start && !klaar._schrijft) await startScene("Regie: start scène");
      return klaar;
    });
    // Met schrijven: pas starten als de tekst er is (buiten het slot gewacht, zodat de deck blijft werken).
    if (start && geladen._schrijft) {
      await geladen._schrijft;
      await slot(async () => {
        verleng(eisEigenaar(naam));
        await startScene("Regie: start scène");
      });
    }
    return overzicht();
  }

  async function start({ wie } = {}) {
    return slot(async () => {
      verleng(eisEigenaar(schoneNaam(wie)));
      await startScene("Regie: start scène");
      return overzicht();
    });
  }

  async function stop({ wie } = {}) {
    return slot(async () => {
      verleng(eisEigenaar(schoneNaam(wie)));
      await stopScene("Regie: stop scène");
      await naStop();
      return overzicht();
    });
  }

  async function volgendeRandom({ wie } = {}) {
    return slot(async () => {
      const s = verleng(eisEigenaar(schoneNaam(wie)));
      await laadRandom(s.schrijven === true);
      return overzicht();
    });
  }

  // Na een stop (ook via de deck of de klikker) in test of random: het script bij wat er nu klaarstaat.
  // In random eerst een nieuwe willekeurige scène.
  async function naStop() {
    const s = stand();
    if (s.stand === "show" || !s.eigenaar || s.verlopen) return null;
    if (s.stand === "random") return laadRandom(s.schrijven === true);
    return scriptVoorKlaar(await run(), s.schrijven === true);
  }

  // OVERSLAAN (deck, operator) in test of random: een andere willekeurige scène klaarzetten.
  async function overslaan() {
    const s = stand();
    return laadRandom(s.schrijven === true);
  }

  async function overzicht() {
    const s = stand();
    const state = await run().catch(() => null);
    return {
      ok: true,
      stand: s.stand,
      eigenaar: s.eigenaar,
      verlopen: !!s.verlopen,
      schrijven: s.schrijven === true,
      run: state ? {
        showRunId: state.showRunId || null,
        status: state.status || null,
        testRun: !!(state.testRun && state.testRun.enabled),
        speelt: state.activeSituation ? { situationId: state.activeSituation.situationId, title: state.activeSituation.title || "" } : null,
        klaar: state.preparedNext ? { situationId: state.preparedNext.situationId, title: state.preparedNext.title || "" } : null,
        omgevingKlaar: state.resolvedPreparedNext && state.resolvedPreparedNext.environment ? state.resolvedPreparedNext.environment.name || "" : "",
      } : null,
      random: s.stand === "random" ? { fout: random.fout } : null,
    };
  }

  // Klok: een verlopen regie geeft zichzelf vrij zodra er geen scène speelt.
  async function tick() {
    const s = stand();
    if (!s.eigenaar || !s.verlopen) return null;
    const state = await run().catch(() => null);
    if (state && state.activeSituation) return null;
    return vrijgeven({ systeem: true });
  }

  async function catalogus() {
    const r = await vraag(scriptAgentUrl, "/v0/script-agent/operator/catalog/index", { timeoutMs: 5000 });
    if (!r.ok || !r.json) throw regieFout(502, "catalogus", "De catalogus is niet te lezen.");
    const omgevingen = new Map((r.json.environments || []).map((item) => [item.id, item.name || item.naam || item.id]));
    return {
      ok: true,
      situaties: (r.json.situations || []).map((item) => ({
        id: item.id,
        titel: item.title || item.naam || item.id,
        omgevingId: item.environmentId || "",
        omgeving: item.environmentName || omgevingen.get(item.environmentId) || "",
      })),
      omgevingen: [...omgevingen].map(([id, naam]) => ({ id, naam })),
    };
  }

  return {
    // Voor routes die al in het slot zitten (stop, overslaan): niet nog een keer het slot pakken.
    binnen: { naStop, overslaan },
    catalogus,
    laad,
    mag,
    overnemen,
    overzicht,
    slot,
    stand,
    start,
    stop,
    tick,
    volgendeRandom,
    vrijgeven,
    zetSchrijven,
  };
}

module.exports = {
  ZAAL_BRONNEN,
  createRegie,
  maakSlot,
  uitDeZaal,
  wieVan,
};
