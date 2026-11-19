"use strict";

// Het universum op de telefoon van het publiek.
// - De kaart (posities, lijnen, paden, en per scène titel/personages/omgeving) komt uit de
//   padendienst en verandert alleen als het team paden aanpast. De telefoon krijgt een kaart
//   ZONDER namen: alleen nummers, posities en lijnen.
// - De stand (gespeeld, speelt nu, straks, vrij) volgt de runtime-view die de dienst toch al elke
//   seconde ophaalt. Verandert er iets, dan gaat één bericht met de hele stand naar alle telefoons.
//   Geen deltas: de stand is klein, en zo maakt een gemist bericht nooit iets uit.
// - Spoilers worden hier gefilterd: van scènes op slot verlaat niets de show-Mac.

const KAART_VERVERS_MS = 60 * 1000;
const KAART_TIMEOUT_MS = 8000;

function idVan(item) {
  if (!item) return 0;
  const direct = Number(item.legacySituationId);
  if (Number.isInteger(direct) && direct > 0) return direct;
  const match = /(\d+)$/.exec(String(item.situationId || item.id || ""));
  return match ? Number(match[1]) : 0;
}

function namenVan(resolved) {
  if (!resolved || !Array.isArray(resolved.characters)) return null;
  const namen = resolved.characters.map((karakter) => String((karakter && karakter.name) || "").trim()).filter(Boolean);
  return namen.length ? namen : null;
}

function omgevingVan(resolved) {
  const naam = resolved && resolved.environment && resolved.environment.name;
  return naam ? String(naam).replace(/_/g, " ").trim() : null;
}

// Runtime-view → stand. Puur, zodat het te testen is.
function standUitView(view) {
  const leeg = { run: "", gespeeld: [], nu: 0, klaar: 0, vrij: [], echt: {} };
  if (!view || !view.showRunId || ["idle", "reset"].includes(String(view.status || ""))) return leeg;
  const echt = {};
  const runs = Array.isArray(view.situationRuns) ? view.situationRuns : [];
  const perRun = new Map(runs.map((run) => [String(run.situationRunId || ""), run]));
  const gespeeld = [];
  for (const item of Array.isArray(view.playedSituations) ? view.playedSituations : []) {
    const id = idVan(item);
    if (!id || gespeeld.includes(id)) continue;
    gespeeld.push(id);
    const run = perRun.get(String(item.situationRunId || "")) || runs.find((r) => idVan(r) === id);
    if (run && run.resolved) echt[id] = { w: namenVan(run.resolved), o: omgevingVan(run.resolved) };
  }
  const actief = view.activeSituation || null;
  const nu = idVan(actief);
  if (nu) echt[nu] = { w: namenVan(actief.resolved), o: omgevingVan(actief.resolved) };
  // Klaargezet: zoals op het zaalscherm. Tijdens de startfase kiest het publiek; dan staat er
  // niets klaar, behalve als de operator zelf koos.
  const prepared = view.preparedNext || null;
  const begin = !nu && (view.startPhase ? !!view.startPhase.active : gespeeld.length === 0);
  let klaar = idVan(prepared);
  if (klaar && begin && String(prepared.reason || "") !== "operator_chosen") klaar = 0;
  if (klaar && klaar !== nu && view.resolvedPreparedNext && idVan(view.resolvedPreparedNext) === klaar) {
    echt[klaar] = { w: namenVan(view.resolvedPreparedNext), o: omgevingVan(view.resolvedPreparedNext) };
  }
  const items = view.pathEvaluation && Array.isArray(view.pathEvaluation.items) ? view.pathEvaluation.items : [];
  const vrij = items
    .filter((item) => item && item.status === "available")
    .map(idVan)
    .filter((id) => id && id !== nu && !gespeeld.includes(id));
  if (klaar && !vrij.includes(klaar) && klaar !== nu && !gespeeld.includes(klaar)) vrij.push(klaar);
  vrij.sort((a, b) => a - b);
  return { run: String(view.showRunId), gespeeld, nu, klaar: klaar === nu ? 0 : klaar, vrij, echt };
}

function createUniversum({ fetchKaart, log = () => {} } = {}) {
  let kaart = null; // volledige kaart uit de padendienst
  let kaartBezig = null;
  let kaartAt = 0;
  let stand = standUitView(null);
  let handtekening = "";
  let versie = 0;
  let publiekCache = null;
  let skeletCache = null;
  // Herkomst: na een herstart begint de versie opnieuw; de telefoon vergelijkt versies alleen
  // binnen dezelfde herkomst.
  const bron = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;

  function sceneMap() {
    return new Map(((kaart && kaart.scenes) || []).map((scene) => [scene.id, scene]));
  }

  async function laadKaart(force = false) {
    if (typeof fetchKaart !== "function") return kaart;
    if (!force && kaart && Date.now() - kaartAt < KAART_VERVERS_MS) return kaart;
    if (kaartBezig) return kaartBezig;
    kaartBezig = (async () => {
      try {
        const nieuw = await fetchKaart(KAART_TIMEOUT_MS);
        // Alleen een kaart met een echte indeling; anders de vorige houden.
        if (nieuw && nieuw.ok && Array.isArray(nieuw.scenes) && nieuw.scenes.length && nieuw.indeling !== "geen") {
          const anders = !kaart || kaart.versie !== nieuw.versie;
          kaart = nieuw;
          if (anders) {
            skeletCache = null;
            publiekCache = null;
            versie += 1;
            log(`universum: kaart ${nieuw.versie} (${nieuw.scenes.length} scènes, indeling ${nieuw.indeling})`);
          }
          return { kaart, anders };
        }
      } catch (_err) {
        // Padendienst weg of traag: de vorige kaart blijft.
      } finally {
        kaartAt = Date.now();
      }
      return { kaart, anders: false };
    })();
    try {
      return await kaartBezig;
    } finally {
      kaartBezig = null;
    }
  }

  // Geeft true als de telefoons een nieuwe stand moeten krijgen.
  function volg(view) {
    const nieuw = standUitView(view);
    const sleutel = JSON.stringify(nieuw);
    if (sleutel === handtekening) return false;
    handtekening = sleutel;
    stand = nieuw;
    versie += 1;
    publiekCache = null;
    return true;
  }

  // Wat het publiek ziet. Gespeeld, speelt nu, straks en vrij: titel, personages, omgeving.
  // Op slot: niets (de telefoon tekent alleen een grijze stip uit de kaart).
  function publiek() {
    if (publiekCache) return publiekCache;
    const scenes = sceneMap();
    const kaartjes = {};
    const open = [...stand.gespeeld, ...stand.vrij];
    if (stand.nu) open.push(stand.nu);
    if (stand.klaar) open.push(stand.klaar);
    for (const id of open) {
      const scene = scenes.get(id);
      if (!scene) continue;
      const echt = stand.echt[id] || {};
      kaartjes[id] = {
        t: scene.t,
        w: echt.w || scene.w,
        o: echt.o || scene.o || null,
      };
    }
    publiekCache = {
      type: "universum",
      v: versie,
      bron,
      run: stand.run,
      kaart: kaart ? kaart.versie : "",
      gespeeld: stand.gespeeld,
      nu: stand.nu || 0,
      klaar: stand.klaar || 0,
      vrij: stand.vrij,
      kaartjes,
    };
    return publiekCache;
  }

  // De kaart voor de telefoon: alleen nummers, posities en lijnen. Geen titels of namen.
  function skelet() {
    if (!kaart) return null;
    if (skeletCache) return skeletCache;
    skeletCache = {
      ok: true,
      versie: kaart.versie,
      s: kaart.scenes.map((scene) => [scene.id, scene.x, scene.y]),
      l: kaart.lijnen,
      p: (kaart.paden || []).map((pad) => ({ c: pad.c, s: pad.s, e: pad.e })),
    };
    return skeletCache;
  }

  return { laadKaart, volg, publiek, skelet, stand: () => stand };
}

// De kaart verandert alleen als de paden veranderen: met ?v=<versie> mag de telefoon hem bewaren.
function stuurKaart(universum, req, res) {
  const skelet = universum && universum.skelet();
  if (!skelet) {
    if (universum) universum.laadKaart().catch(() => {});
    res.status(503).set("Retry-After", "3").json({ ok: false, error: "kaart_nog_niet_klaar" });
    return;
  }
  const gevraagd = String((req.query && req.query.v) || "");
  res.set("Cache-Control", gevraagd && gevraagd === skelet.versie ? "private, max-age=86400, immutable" : "no-store");
  res.json(skelet);
}

module.exports = { createUniversum, standUitView, stuurKaart };
