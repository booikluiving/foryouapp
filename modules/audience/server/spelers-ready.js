"use strict";

// Ready per speler. Zodra de scène die klaarstaat geschreven is, drukt elke speler zelf op READY:
// Booi en Megan op hun telefoon (/audience/ready), Brent met de klikker. Staan alle spelers van de
// scène op ready, dan telt het zaalscherm af (3, 2, 1) en begint de scène vanzelf.
// De operator hoeft geen READY meer te geven; READY en START op de deck blijven als noodgreep werken.

const AFTEL_MS = 3000;
// Vaste plekken in de ring: wie op welke plek staat (ook de klikker hoort bij een plek).
const SPELERS = [
  { plek: 1, naam: "Booi" },
  { plek: 2, naam: "Megan" },
  { plek: 3, naam: "Brent" },
];
const KLIKKER_PLEK = Number(process.env.AUDIENCE_KLIKKER_PLEK) || 3;

const nummer = (id) => {
  const match = String(id || "").match(/(\d+)$/);
  return match ? Number(match[1]) : 0;
};

function createSpelersReady({ service, fetchRuntimeView }) {
  const scriptUrl = String(process.env.AUDIENCE_SCRIPT_AGENT_URL || "http://127.0.0.1:3027").replace(/\/+$/, "");
  const showControlUrl = String(process.env.AUDIENCE_SHOW_CONTROL_URL || "http://127.0.0.1:3025").replace(/\/+$/, "");
  const stand = { sleutel: "", plekken: new Set(), aftellenTot: 0, timer: null, start: false, nodig: [1, 2, 3], geschreven: false };
  let wachter = null;

  // De scène die klaarstaat, wie erin speelt en of de tekst er is.
  async function kijk() {
    const result = await fetchRuntimeView().catch(() => null);
    const view = result && result.ok ? result.state : null;
    const klaar = view && view.resolvedPreparedNext;
    if (!view || !view.showRunId || view.status === "idle" || !klaar) return { sleutel: "", speelt: !!(view && view.activeSituation) };
    // In de startfase kiest het publiek: pas als de winnaar klaarstaat, kan er ready gedrukt worden.
    const reden = view.preparedNext ? String(view.preparedNext.reason || "") : "";
    if (view.startPhase && view.startPhase.active && reden !== "operator_chosen") return { sleutel: "", speelt: !!view.activeSituation };
    // Alle drie de spelers drukken op READY, ook wie niet in de scène speelt.
    let geschreven = false;
    try {
      const tp = await fetch(`${scriptUrl}/v0/script-agent/teleprompter-parser/current`, { signal: AbortSignal.timeout(1500) }).then((res) => res.json());
      const ps = (tp && tp.preparedScene) || {};
      const tekst = (tp && tp.teleprompt) || {};
      const bron = nummer(tekst.source && tekst.source.sceneId);
      const scene = nummer(klaar.legacySituationId || klaar.situationId);
      geschreven = String(ps.status || "") === "prepared"
        && Array.isArray(tekst.lines) && tekst.lines.length > 0
        && !!bron && (!scene || bron === scene)
        && (!nummer(ps.sceneId) || !scene || nummer(ps.sceneId) === scene);
    } catch (_err) {
      geschreven = false;
    }
    // In de proefshow wordt geen tekst geschreven: daar hoeft de tekst er niet te zijn.
    if (process.env.AUDIENCE_READY_ZONDER_TEKST === "1") geschreven = true;
    return { sleutel: `${view.showRunId}|${klaar.situationId}`, speelt: !!view.activeSituation, nodig: SPELERS.map((speler) => speler.plek), geschreven };
  }

  function publiek() {
    return {
      spelers: SPELERS,
      plekken: [...stand.plekken].sort(),
      nodig: stand.nodig,
      geschreven: stand.geschreven,
      aftellenTot: stand.aftellenTot || 0,
      klaar: !!stand.sleutel,
      nu: Date.now(),
    };
  }
  const meld = () => service.emit("broadcast", { type: "spelers_ready", ...publiek() });

  function stopAftellen() {
    if (stand.timer) clearTimeout(stand.timer);
    stand.timer = null;
    stand.aftellenTot = 0;
  }

  // Stand bijwerken: bij een andere scène begint iedereen weer bij niet-ready.
  async function bij() {
    const nu = await kijk();
    if (nu.sleutel !== stand.sleutel || nu.speelt) {
      const had = stand.plekken.size || stand.aftellenTot;
      stand.sleutel = nu.speelt ? "" : nu.sleutel;
      stand.plekken.clear();
      stopAftellen();
      if (had) meld();
    }
    stand.nodig = nu.nodig || [1, 2, 3];
    const wasGeschreven = stand.geschreven;
    stand.geschreven = !!nu.geschreven;
    if (wasGeschreven !== stand.geschreven) meld();
    return nu;
  }

  const iedereen = () => stand.nodig.every((plek) => stand.plekken.has(plek));

  function controleer() {
    if (stand.aftellenTot && !iedereen()) { stopAftellen(); meld(); return; }
    if (stand.aftellenTot || stand.start || !stand.sleutel || !stand.geschreven || !iedereen()) return;
    stand.aftellenTot = Date.now() + AFTEL_MS;
    meld();
    const sleutel = stand.sleutel;
    stand.timer = setTimeout(() => { start(sleutel).catch(() => {}); }, AFTEL_MS);
  }

  async function cue(pad, body) {
    const antwoord = await fetch(`${showControlUrl}${pad}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(8000),
    });
    return antwoord.ok;
  }

  // Na het aftellen: dezelfde weg als READY en daarna START SCENE op de deck.
  async function start(sleutel) {
    stand.timer = null;
    stand.start = true;
    try {
      const nu = await bij();
      if (nu.sleutel !== sleutel || nu.speelt || !iedereen() || !stand.geschreven) { stopAftellen(); meld(); return; }
      await cue("/v0/show-control/cues", { name: "Spelers ready: READY", actions: [{ command: "teleprompter.ready", ackMode: "acknowledged-async", payload: { ready: true }, timeoutMs: 3000 }] });
      const result = await fetchRuntimeView().catch(() => null);
      const rt = result && result.ok ? result.state : null;
      if (rt && !rt.activeSituation) await cue("/v0/show-control/cues/start-situation", { name: "Spelers ready: start scène", showRunId: rt.showRunId, runtimeState: rt });
    } finally {
      stand.start = false;
      stopAftellen();
      stand.plekken.clear();
      meld();
    }
  }

  // Zolang er iemand ready staat: blijven kijken of de tekst klaar is (dan begint het aftellen).
  function volg() {
    if (wachter) return;
    wachter = setInterval(() => {
      if (!stand.plekken.size || stand.start) { clearInterval(wachter); wachter = null; return; }
      bij().then(controleer).catch(() => {});
    }, 1000);
  }

  async function zet(plek, ready) {
    plek = Number(plek);
    if (!SPELERS.some((speler) => speler.plek === plek)) return { ok: false, fout: "onbekende_plek" };
    const nu = await bij();
    if (!stand.sleutel) return { ok: false, fout: nu.speelt ? "scene_speelt" : "geen_scene", ...publiek() };
    if (stand.start) return { ok: true, ...publiek() };
    const was = stand.plekken.has(plek);
    if (ready) stand.plekken.add(plek); else stand.plekken.delete(plek);
    if (was !== !!ready) service.emit("broadcast", { type: "speler_ready", plek, ready: !!ready });
    meld();
    controleer();
    volg();
    return { ok: true, ...publiek() };
  }

  async function haal() {
    await bij().catch(() => {});
    return publiek();
  }

  return { zet, haal, publiek, KLIKKER_PLEK, SPELERS };
}

module.exports = { createSpelersReady, SPELERS };
