"use strict";

// Test pad op de universumpagina: welke scène kiest de show als volgende, met de echte code van de
// paden, het algoritme en de runtime (padwaarde, padvoorkeur, regels voor omgeving en personages).
// Het publiek is nagedaan met een richting; de catalogus en de paden zijn die van de website op dit
// moment. Het rekent zoals de show: de volgende scène wordt gekozen bij de start van de vorige.
//
// POST { gespeeld: [legacy-id, …], richting: "grof" | "subtiel" | "gemengd" }
//   → { gekozen: legacy-id | null, titel, kans, oordelen: [{ id, score }] }

const path = require("node:path");

const APP = path.resolve(__dirname, "../..");
const { evaluatePaths } = require(path.join(APP, "modules/paths/evaluation/evaluate-paths.js"));
const { buildScoreFeed, defaultAlgorithmConfig, padVoorgangersUitPaden } = require(path.join(APP, "modules/algorithm/scoring/score-engine.js"));
const runtime = require(path.join(APP, "modules/runtime/run-control/runtime-engine.js"));

// Smaak per label (-1..1). Gemengd: twee kampen door elkaar, met onrust per scène.
const RICHTINGEN = {
  grof: { Plat: 1, "Seks & drugs": 1, "Zwarte humor": 0.6, Absurd: 0.3, Ongemakkelijk: 0, Misverstand: -0.2, Actueel: -0.4, "Politiek correct": -0.6 },
  subtiel: { Ongemakkelijk: 0.8, Misverstand: 0.7, Actueel: 0.6, "Politiek correct": 0.5, Absurd: 0, "Zwarte humor": -0.3, "Seks & drugs": -0.8, Plat: -1 },
};

// Vaste "toevalsgetallen" (0..1), zodat dezelfde stap na Terug en Volgende hetzelfde uitvalt.
function vast(tekst) {
  let h = 2166136261;
  for (const teken of String(tekst)) h = Math.imul(h ^ teken.charCodeAt(0), 16777619);
  return (h >>> 0) / 4294967296;
}

function createTestpadKeuze({ catalogUrl, pathsUrl, cacheMs = 5000 }) {
  let cache = null;
  async function inhoud({ vers = false } = {}) {
    if (!vers && cache && Date.now() - cache.at < cacheMs) return cache;
    const [catalog, paths] = await Promise.all([
      fetch(`${catalogUrl}/v0/catalog/read-model`, { signal: AbortSignal.timeout(8000) }).then((res) => res.json()),
      fetch(`${pathsUrl}/v0/paths/snapshot`, { signal: AbortSignal.timeout(8000) }).then((res) => res.json()),
    ]);
    const metPaden = { ...catalog, padVoorgangers: padVoorgangersUitPaden(paths) };
    cache = {
      at: Date.now(),
      catalog: metPaden,
      paths,
      perLegacy: new Map((catalog.situations || []).map((s) => [Number(s.legacyId), s])),
      labelNaam: new Map((catalog.labels || []).map((l) => [l.id, String(l.name || "").trim()])),
    };
    return cache;
  }

  // Het oordeel van het nagedane publiek over een gespeelde scène, als score zoals de show rekent
  // (oordeel × 3 + chat × 1 + likes × 0,5, elk -1..1).
  function oordeel(c, situatie, richting, stap) {
    const labels = (situatie.labelIds || []).map((id) => c.labelNaam.get(id)).filter(Boolean);
    const smaak = (tabel) => (labels.length ? labels.reduce((t, l) => t + Number(tabel[l] || 0), 0) / labels.length : 0);
    const ruis = (vast(`${situatie.id}:${stap}:${richting}`) - 0.5) * 2;
    const zin = richting === "gemengd"
      ? (smaak(RICHTINGEN.grof) + smaak(RICHTINGEN.subtiel)) / 2 + ruis * 0.6
      : smaak(RICHTINGEN[richting] || {}) + ruis * 0.15;
    const o = Math.max(-1, Math.min(1, zin));
    const labelId = (situatie.labelIds || [])[0];
    return {
      observedScore: o * 3 + Math.max(-1, Math.min(1, o * 0.8)) + Math.max(-1, Math.min(1, o * 0.6)) * 0.5,
      labelVoorkeur: labelId ? { labelId, delta: Math.max(-1, Math.min(1, smaak(RICHTINGEN[richting] || {}) || o)) } : null,
    };
  }

  async function kies({ gespeeld = [], richting = "grof", vers = false } = {}) {
    const c = await inhoud({ vers });
    const config = defaultAlgorithmConfig();
    // Zoals op de show-Mac.
    config.weights.diversity = 0.5;
    config.weights.exploration = 0.5;
    const ids = gespeeld.map(Number).filter((n) => c.perLegacy.has(n)).map((n) => c.perLegacy.get(n).id);
    // De laatste gespeelde scène "speelt nog" op het moment van kiezen; de rest is gespeeld en beoordeeld.
    const klaar = ids.slice(0, -1);
    const actief = ids.length ? ids[ids.length - 1] : null;
    const observaties = klaar.map((id, stap) => {
      const s = c.catalog.situations.find((x) => x.id === id);
      return { situationId: id, labelIds: s.labelIds || [], characterIds: s.characterIds || [], ...oordeel(c, s, richting, stap) };
    });
    const evaluatie = evaluatePaths(c.paths, { playedSituationIds: klaar });
    const feed = buildScoreFeed({ showRunId: "testpad", catalog: c.catalog, observations: observaties, config });
    const sitMap = new Map(c.catalog.situations.map((s) => [s.id, s]));
    const pool = runtime.buildEligiblePool({
      catalog: c.catalog,
      pathEvaluation: evaluatie,
      playedSituations: klaar.map((situationId) => ({ situationId })),
      activeSituation: actief ? { situationId: actief } : null,
      lastPlayedSituation: klaar.length ? sitMap.get(klaar[klaar.length - 1]) : null,
      scoreFeed: feed,
      orderSettings: { startSceneCount: 0, randomizeEqualScores: true, vrijeSpeler: true, padWaarde: true },
      rankingTieBreaks: null,
      skippedSituations: [],
    });
    const oordelen = observaties.map((o) => ({ id: Number(sitMap.get(o.situationId).legacyId), score: Math.round(o.observedScore * 100) / 100 }));
    if (!pool.length) return { gekozen: null, oordelen };
    const { pool: getrokken, trekking } = runtime.trekMetPadwaarde(pool, { random: () => vast(`trek:${ids.join(",")}:${richting}`) });
    const winnaar = getrokken[0];
    const score = winnaar.score && winnaar.score.components ? winnaar.score.components : {};
    return {
      gekozen: Number(winnaar.legacySituationId),
      titel: winnaar.title,
      kans: trekking ? trekking.kans : 1,
      vrij: pool.length,
      padWaarde: winnaar.padWaarde,
      padVoorkeur: score.padVoorkeur || 0,
      oordelen,
    };
  }

  return { kies };
}

module.exports = { createTestpadKeuze, RICHTINGEN };
