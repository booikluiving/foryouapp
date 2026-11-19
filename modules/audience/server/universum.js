"use strict";

// Het universum op de telefoon van het publiek.
// - De kaart (posities, lijnen, paden, en per scène titel/personages/omgeving) komt uit de
//   padendienst en verandert alleen als het team paden aanpast. De telefoon krijgt een kaart
//   ZONDER namen: alleen nummers, posities en lijnen.
// - De stand (gespeeld, speelt nu, straks, vrij) volgt de runtime-view die de dienst toch al elke
//   seconde ophaalt. Verandert er iets, dan gaat één bericht met de hele stand naar alle telefoons.
//   Geen deltas: de stand is klein, en zo maakt een gemist bericht nooit iets uit.
// - Spoilers worden hier gefilterd: van scènes op slot verlaat niets de show-Mac.

const { buildRuntimeOverlay } = require("../../paths/universe/build-runtime-overlay");

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

function omgevingIdVan(resolved) {
  if (!resolved) return "";
  return String(resolved.environmentId || (resolved.environment && resolved.environment.id) || "");
}

function omgevingVan(resolved) {
  const naam = resolved && resolved.environment && resolved.environment.name;
  return naam ? String(naam).replace(/_/g, " ").trim() : null;
}

// Wat het zaalscherm wil laten zien, met precies dezelfde regels (build-runtime-overlay.js uit de
// padendienst, die ook de stand van het zaalscherm maakt): gespeeld in volgorde, wat speelt, wat
// klaarstaat (niet vóór START SHOW of tijdens de startfase, behalve de winnaar) en wat vrij is.
// Puur, zodat het te testen is.
function doelUitView(view, stemming) {
  if (!view || !view.pathEvaluation || !Array.isArray(view.pathEvaluation.items)) return null;
  let overlay = null;
  try { overlay = buildRuntimeOverlay(view, stemming || null); } catch (_err) { overlay = null; }
  if (!overlay) return null;
  const run = view.showRunId && !["idle", "reset"].includes(String(view.status || "")) ? String(view.showRunId) : "";
  const gespeeld = (overlay.playedSceneIds || []).map(Number).filter(Boolean);
  const nu = overlay.currentScene ? Number(overlay.currentScene.sceneId) || 0 : 0;
  let klaar = overlay.preparedNextScenes && overlay.preparedNextScenes[0] ? Number(overlay.preparedNextScenes[0].sceneId) || 0 : 0;
  if (klaar === nu) klaar = 0;
  const rel = new Set(gespeeld);
  for (const item of overlay.availableScenes || []) if (Number(item.sceneId)) rel.add(Number(item.sceneId));
  if (nu) rel.add(nu);
  if (klaar) rel.add(klaar);
  // Wie er echt speelde (ook op een vrije plek) en waar.
  const echt = {};
  const runs = Array.isArray(view.situationRuns) ? view.situationRuns : [];
  for (const sr of runs) {
    const id = idVan(sr);
    if (id && gespeeld.includes(id) && sr.resolved) echt[id] = { w: namenVan(sr.resolved), o: omgevingVan(sr.resolved), e: omgevingIdVan(sr.resolved) };
  }
  if (nu && view.activeSituation) echt[nu] = { w: namenVan(view.activeSituation.resolved), o: omgevingVan(view.activeSituation.resolved), e: omgevingIdVan(view.activeSituation.resolved) };
  if (klaar && view.resolvedPreparedNext && idVan(view.resolvedPreparedNext) === klaar) {
    echt[klaar] = { w: namenVan(view.resolvedPreparedNext), o: omgevingVan(view.resolvedPreparedNext), e: omgevingIdVan(view.resolvedPreparedNext) };
  }
  // Stemming op de startscène: stemmen per scène, koplopers, winnaar (het zaalscherm laat ze oplichten).
  let stem = null;
  if (overlay.stem && Array.isArray(overlay.stem.stemmen)) {
    stem = {
      a: !!overlay.stem.actief,
      s: Object.fromEntries(overlay.stem.stemmen.map((keuze) => [Number(keuze.sceneId), Number(keuze.votes || 0)])),
      k: (overlay.stem.koplopers || []).map(Number),
      w: Number(overlay.stem.winnaar || 0),
    };
  }
  return { run, gespeeld, nu, klaar, rel, echt, stem };
}

// Hoe lang na een scène het universum hooguit wacht op het zaalscherm (zoals NA_SCENE_MAX daar).
const VANGNET_MS = 60 * 1000;

function createUniversum({ fetchKaart, beeldVersie, log = () => {} } = {}) {
  let kaart = null; // volledige kaart uit de padendienst
  let kaartBezig = null;
  let kaartAt = 0;
  const LEEG = { run: "", gespeeld: [], nu: 0, klaar: 0, vrij: [], echt: {}, stem: null };
  let stand = LEEG;
  let doel = null; // wat het zaalscherm uiteindelijk wil tonen
  // Wat de telefoon al mag tonen. Net als het zaalscherm: nieuwe scènes komen pas vrij na het stemmen,
  // de volgende scène pas als de kiezer op het zaalscherm geland is ("keuze getoond").
  let getoond = { run: null, rel: new Set(), gespeeld: [] };
  let vrijgegeven = false;
  let keuze = 0;
  let wachtSinds = 0;
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

  function bereken(nu = Date.now()) {
    if (!doel) return LEEG;
    let g = getoond;
    const nieuweRun = g.run !== doel.run || g.gespeeld.some((id) => !doel.gespeeld.includes(id));
    if (nieuweRun) {
      // Nieuwe run, reset of eerste blik: meteen de hele stand, zoals het zaalscherm dan springt.
      getoond = { run: doel.run, rel: new Set(doel.rel), gespeeld: doel.gespeeld.slice() };
      g = getoond;
      keuze = doel.klaar;
      vrijgegeven = false;
      wachtSinds = 0;
    } else if (doel.nu) {
      // Er speelt een scène: wat nu vrijkomt bewaart het zaalscherm voor na de scène.
      for (const id of doel.gespeeld) g.rel.add(id);
      g.rel.add(doel.nu);
      keuze = 0;
      vrijgegeven = false;
      wachtSinds = 0;
    } else {
      const pasGespeeld = doel.gespeeld.length > g.gespeeld.length;
      if (pasGespeeld) { wachtSinds = nu; vrijgegeven = false; keuze = 0; }
      for (const id of doel.gespeeld) g.rel.add(id);
      // Vóór de eerste scène zijn de startscènes meteen vrij; daarna na het stemmen (of het vangnet).
      const inloop = !doel.gespeeld.length;
      if (inloop || vrijgegeven || (wachtSinds && nu - wachtSinds > VANGNET_MS)) {
        for (const id of doel.rel) g.rel.add(id);
      }
    }
    g.gespeeld = doel.gespeeld.slice();
    const klaar = !doel.nu && keuze && keuze === doel.klaar ? keuze : 0;
    if (klaar) g.rel.add(klaar);
    const vrij = [...g.rel].filter((id) => id !== doel.nu && id !== klaar && !doel.gespeeld.includes(id)).sort((a, b) => a - b);
    return { run: doel.run, gespeeld: doel.gespeeld, nu: doel.nu, klaar, vrij, echt: doel.echt, stem: doel.stem };
  }

  function zet(nieuw) {
    const sleutel = JSON.stringify(nieuw);
    if (sleutel === handtekening) return false;
    handtekening = sleutel;
    stand = nieuw;
    versie += 1;
    publiekCache = null;
    return true;
  }

  // Elke blik op de runtime (± elke seconde). Geeft true als de telefoons een nieuwe stand moeten krijgen.
  function volg(view, stemming) {
    doel = doelUitView(view, stemming);
    return zet(bereken());
  }
  // Het stemmen na de scène is voorbij: het zaalscherm laat de nieuwe scènes vrijkomen.
  function vrijgave() {
    vrijgegeven = true;
    return zet(bereken());
  }
  // De kiezer op het zaalscherm is geland op de scène die klaarstaat.
  function keuzeGetoond() {
    vrijgegeven = true;
    keuze = doel ? doel.klaar : 0;
    return zet(bereken());
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
      // Omgeving is de verrassing: alleen bij wat gespeeld is, nu speelt, of gekozen is (het zaalscherm
      // toont het vakje van de omgeving zodra de kiezer landt).
      const gezien = id === stand.nu || id === stand.klaar || stand.gespeeld.includes(id);
      kaartjes[id] = {
        t: scene.t,
        w: echt.w || scene.w,
        o: gezien ? (echt.o || scene.o || null) : null,
      };
      // Het beeld van de omgeving, zoals het vakje op het zaalscherm (omgevingsbeeld.js).
      const nr = gezien && echt.e ? Number(String(echt.e).replace(/\D+/g, "")) : 0;
      const v = nr && typeof beeldVersie === "function" ? beeldVersie(echt.e) : "";
      if (nr && v) kaartjes[id].b = `/audience/public/omgevingsbeeld/${nr}?v=${v}`;
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
      stem: stand.stem,
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
      s: kaart.scenes.map((scene) => (scene.r ? [scene.id, scene.x, scene.y, scene.r] : [scene.id, scene.x, scene.y])),
      l: kaart.lijnen,
      p: (kaart.paden || []).map((pad) => ({ c: pad.c, s: pad.s, e: pad.e })),
    };
    return skeletCache;
  }

  // Mag het publiek het beeld van deze omgeving zien? Alleen van gespeeld, wat nu speelt en de gekozen scène.
  function omgevingZichtbaar(environmentId) {
    const id = String(environmentId || "");
    if (!id) return false;
    const gezien = [...stand.gespeeld, stand.nu, stand.klaar].filter(Boolean);
    return gezien.some((sceneId) => stand.echt[sceneId] && stand.echt[sceneId].e === id);
  }

  // Iets buiten de stand veranderde (bv. de beelden van de omgevingen): nieuwe versie van het bericht.
  function vernieuw() {
    versie += 1;
    publiekCache = null;
  }

  return { laadKaart, volg, vrijgave, keuzeGetoond, publiek, skelet, omgevingZichtbaar, vernieuw, stand: () => stand };
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

module.exports = { createUniversum, doelUitView, stuurKaart };
