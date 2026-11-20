"use strict";

// Zaaloordeel: de operator of de spelers zeggen hoe een scène viel ("ze lachten, dit werkte"), van -1 tot 1.
// Met de knop op het deck (lach = +1, nog een keer = terug naar 0) of de applausmeter op een telefoon
// op de wifi (/zaal/). Het gaat over de scène die speelt, of anders de scène die net voorbij is (tot de
// volgende start). Het algoritme telt het mee met gewicht "zaal" (standaard 1, naast het publiek: oordeel 3).
// Na elk oordeel gaan de nieuwe scores naar de runtime, zoals na de stemronde van het publiek.

const path = require("node:path");

const STAPPEN = [-1, -0.5, 0, 0.5, 1];

function createZaalOordeel({ fetchCurrentRuntimeState, runtimeUrl, algorithmUrl, log = () => {} }) {
  const runtimeBasis = String(runtimeUrl || "http://127.0.0.1:3024").replace(/\/+$/, "");
  const algoritmeBasis = String(algorithmUrl || "http://127.0.0.1:3023").replace(/\/+$/, "");
  // Per scène (situationRunId) het laatste oordeel; alleen in het geheugen, voor de knop en de pagina.
  const gegeven = new Map();

  async function post(url, body, ms = 4000) {
    const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(ms) });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data && data.error ? String(data.error) : `fout ${res.status}`);
    return data;
  }

  // De scène waar het oordeel over gaat: die nu speelt, of de laatste die gespeeld is.
  async function sceneNu() {
    const result = await fetchCurrentRuntimeState();
    const state = result && result.ok ? result.state : null;
    if (!state || !state.showRunId || state.status === "idle") return null;
    const actief = state.activeSituation;
    if (actief && actief.situationRunId) {
      return { showRunId: state.showRunId, situationRunId: actief.situationRunId, situationId: actief.situationId, titel: actief.title || "", speelt: true };
    }
    const runs = Array.isArray(state.situationRuns) ? state.situationRuns : [];
    const laatste = runs[runs.length - 1];
    if (!laatste || !laatste.situationRunId) return null;
    const bron = laatste.resolved || {};
    return { showRunId: state.showRunId, situationRunId: laatste.situationRunId, situationId: bron.situationId || laatste.situationId, titel: bron.title || "", speelt: false };
  }

  async function stand() {
    const scene = await sceneNu();
    const oordeel = scene ? gegeven.get(scene.situationRunId) || null : null;
    return { ok: true, scene, oordeel, stappen: STAPPEN };
  }

  // waarde: -1..1, of stap "lach" (deck): +1, en nog een keer op dezelfde scène = terug naar 0.
  async function geef({ waarde, stap, bron = "" } = {}) {
    const scene = await sceneNu();
    if (!scene) return { ok: false, status: 409, error: "geen_scene" };
    const eerder = gegeven.get(scene.situationRunId);
    let nieuw;
    if (stap === "lach") nieuw = eerder && eerder.waarde >= 1 ? 0 : 1;
    else nieuw = Number(waarde);
    if (!Number.isFinite(nieuw)) return { ok: false, status: 400, error: "waarde_ontbreekt" };
    nieuw = Math.max(-1, Math.min(1, nieuw));
    const uit = await post(`${algoritmeBasis}/v0/algorithm/events/zaal-oordeel`, {
      showRunId: scene.showRunId,
      situationRunId: scene.situationRunId,
      situationId: scene.situationId,
      waarde: nieuw,
      bron,
    });
    const oordeel = { waarde: nieuw, bron: String(bron || ""), at: new Date().toISOString(), titel: scene.titel };
    gegeven.set(scene.situationRunId, oordeel);
    while (gegeven.size > 60) gegeven.delete(gegeven.keys().next().value);
    // De nieuwste scores naar de runtime (de scène die al klaarstaat blijft staan).
    let scores = "niet nodig";
    if (!uit.wacht) {
      try {
        const feed = await fetch(`${algoritmeBasis}/v0/algorithm/scoring-contexts/${encodeURIComponent(scene.showRunId)}/scores`, { signal: AbortSignal.timeout(4000) }).then((res) => res.json());
        await post(`${runtimeBasis}/v0/runtime/runs/${encodeURIComponent(scene.showRunId)}/scores`, { ...feed, source: "zaal_oordeel" });
        scores = "ok";
      } catch (err) {
        scores = `niet bereikt (${err.message})`;
      }
    }
    log({ type: "zaal_oordeel", ...oordeel, situationRunId: scene.situationRunId, scores });
    return { ok: true, scene, oordeel, wacht: !!uit.wacht, scores };
  }

  function attach(app, express) {
    app.get("/v0/show-control/zaal", async (_req, res) => {
      try { res.json(await stand()); } catch (err) { res.status(502).json({ ok: false, error: String(err.message || err) }); }
    });
    app.post("/v0/show-control/zaal", async (req, res) => {
      try {
        const uit = await geef(req.body || {});
        res.status(uit.ok ? 201 : uit.status || 400).json(uit);
      } catch (err) {
        res.status(502).json({ ok: false, error: String(err.message || err) });
      }
    });
    // De applausmeter voor een telefoon op de wifi (show control is niet via de publieke tunnel bereikbaar).
    app.use("/zaal", express.static(path.resolve(__dirname, "../ui/zaal"), { extensions: ["html"] }));
  }

  return { attach, stand, geef };
}

module.exports = { createZaalOordeel, STAPPEN };
