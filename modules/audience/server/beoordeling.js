"use strict";

// Het beoordeelmoment: na elke scène krijgt het publiek op de telefoon een paar korte vragen, met
// een klok. De vragen gaan over de scène die net gespeeld is: wat vond je ervan en welk personage
// wil je nog een keer zien (met de foto van de speler als die er is), en een vraag over het label van de
// scène (te veel, precies goed, mag meer; of zelf iets typen bij Anders). De antwoorden worden per scène
// bewaard; het antwoord op de labelvraag gaat naar het algoritme als voorkeur voor dat label.

const { createPersonagefoto } = require("./personagefoto");
const { cameraVoor } = require("../../../shared/casting/camera-per-personage");

const INSTELLINGEN_KEY = "beoordeling_instellingen";
const UITSLAGEN_KEY = "beoordeling_uitslagen";
const MAX_FOTO_BYTES = 150 * 1024;
const MAX_UITSLAGEN = 60;
const ALGORITME_URL = String(process.env.AUDIENCE_ALGORITHM_URL || "http://127.0.0.1:3023").replace(/\/+$/, "");
const RUNTIME_URL = String(process.env.AUDIENCE_RUNTIME_URL || "http://127.0.0.1:3024").replace(/\/+$/, "");
// De drie antwoorden op de labelvraag en wat ze voor het algoritme betekenen.
const LABEL_KEUZES = [["minder", -1], ["goed", 0], ["meer", 1]];

const STANDAARD = {
  aan: true,
  // Seconden tussen het einde van de scène en het opengaan van de vragen (0: meteen).
  aanloop: 0,
  // Zo lang staat de klok (seconden). De klok is ook de omkleedtijd van de spelers.
  duur: 30,
  // De scène op een thermometer: van onder (slechtst) naar boven (best). Loslaten op een vak is het antwoord.
  scene: {
    aan: true,
    vraag: "Wat vond je van de scène?",
    // Vijf stappen; voor het algoritme -1, -½, 0, +½, +1 (gelijk verdeeld van onder naar boven).
    keuzes: [
      { id: "heelsaai", emoji: "😴", naam: "Heel saai" },
      { id: "saai", emoji: "🥱", naam: "Beetje saai" },
      { id: "medium", emoji: "😐", naam: "Medium" },
      { id: "leuk", emoji: "🙂", naam: "Leuk" },
      { id: "heelleuk", emoji: "😂", naam: "Heel leuk" },
    ],
  },
  personage: { aan: true, vraag: "Wie wil je terugzien?" },
  // Per label een eigen vraag en drie antwoorden (in te vullen in Admin). Niet ingevuld: de naam van het
  // label als vraag en de standaardantwoorden hieronder.
  label: { aan: true, anders: true, minder: "Te veel", goed: "Precies goed", meer: "Mag meer", vragen: {} },
  // Bots (de knop BOTS / PERSONAGES) beantwoorden de vragen ook, maar tellen standaard niet mee voor het
  // algoritme. Aan = wel meetellen, om met een nagespeeld publiek te testen.
  botsTellenMee: false,
};

// Per label de twee richtingen (vergrotende trap). Per label te overschrijven in Admin (vraag en antwoorden).
const RICHTINGEN = {
  absurd: { meer: "absurder", tegen: "herkenbaarder" },
  misverstand: { meer: "verwarrender", tegen: "duidelijker" },
  ongemakkelijk: { meer: "ongemakkelijker", tegen: "gezelliger" },
  "zwarte humor": { meer: "zwarter", tegen: "luchtiger" },
  "seks & drugs": { meer: "wilder", tegen: "braver" },
  plat: { meer: "platter", tegen: "netter" },
  "politiek correct": { meer: "politiek correcter", tegen: "politiek incorrecter" },
  actueel: { meer: "actueler", tegen: "tijdlozer" },
};
function richtingVan(labelNaam) {
  const naam = String(labelNaam || "").trim();
  return RICHTINGEN[naam.toLowerCase()] || { meer: `meer ${naam.toLowerCase()}`, tegen: `minder ${naam.toLowerCase()}` };
}
const hoofd = (woord) => woord.charAt(0).toUpperCase() + woord.slice(1);

function tekst(waarde, standaard, max = 120) {
  const schoon = String(waarde == null ? "" : waarde).trim().slice(0, max);
  return schoon || standaard;
}

// De vragen per label: { "label:1": { vraag, minder, goed, meer } }. Lege velden vallen terug op de standaard.
function labelVragen(raw) {
  const uit = {};
  if (!raw || typeof raw !== "object") return uit;
  for (const [id, waarde] of Object.entries(raw)) {
    if (!/^label:\d+$/.test(id) || !waarde || typeof waarde !== "object") continue;
    const item = { vraag: tekst(waarde.vraag, "", 120), minder: tekst(waarde.minder, "", 30), goed: tekst(waarde.goed, "", 30), meer: tekst(waarde.meer, "", 30) };
    if (item.vraag || item.minder || item.goed || item.meer) uit[id] = item;
  }
  return uit;
}

function normalizeInstellingen(raw) {
  const bron = raw && typeof raw === "object" ? raw : {};
  const deel = (naam) => (bron[naam] && typeof bron[naam] === "object" ? bron[naam] : {});
  const duur = Number(bron.duur);
  const aanloop = Number(bron.aanloop);
  const keuzes = Array.isArray(deel("scene").keuzes)
    ? deel("scene").keuzes.map((keuze) => ({ id: tekst(keuze && keuze.id, "", 20), emoji: tekst(keuze && keuze.emoji, "", 8), naam: tekst(keuze && keuze.naam, "", 30) })).filter((keuze) => keuze.id && keuze.emoji).slice(0, 5)
    : [];
  return {
    aan: bron.aan === undefined ? STANDAARD.aan : Boolean(bron.aan),
    duur: Number.isFinite(duur) ? Math.min(300, Math.max(10, Math.round(duur))) : STANDAARD.duur,
    aanloop: Number.isFinite(aanloop) ? Math.min(10, Math.max(0, aanloop)) : STANDAARD.aanloop,
    botsTellenMee: bron.botsTellenMee === undefined ? STANDAARD.botsTellenMee : Boolean(bron.botsTellenMee),
    scene: {
      aan: deel("scene").aan === undefined ? true : Boolean(deel("scene").aan),
      vraag: tekst(deel("scene").vraag, STANDAARD.scene.vraag),
      keuzes: keuzes.length >= 2 ? keuzes : STANDAARD.scene.keuzes.map((keuze) => ({ ...keuze })),
    },
    personage: { aan: deel("personage").aan === undefined ? true : Boolean(deel("personage").aan), vraag: tekst(deel("personage").vraag, STANDAARD.personage.vraag) },
    label: {
      aan: deel("label").aan === undefined ? STANDAARD.label.aan : Boolean(deel("label").aan),
      anders: deel("label").anders === undefined ? STANDAARD.label.anders : Boolean(deel("label").anders),
      minder: tekst(deel("label").minder, STANDAARD.label.minder, 30),
      goed: tekst(deel("label").goed, STANDAARD.label.goed, 30),
      meer: tekst(deel("label").meer, STANDAARD.label.meer, 30),
      vragen: labelVragen(deel("label").vragen),
    },
  };
}

function createBeoordeling(service) {
  const store = service.store;
  let instellingen = normalizeInstellingen(store.getSetting(INSTELLINGEN_KEY, null));
  let uitslagen = store.getSetting(UITSLAGEN_KEY, null);
  if (!Array.isArray(uitslagen)) uitslagen = [];
  // De scène die nu speelt of net gespeeld is: wie speelde wat, en de labels.
  let scene = null;
  // Foto's van de spelers per scène, op de plek van de speler (1, 2, 3). Alleen in het geheugen.
  const fotos = new Map();
  // Dezelfde foto per personage, voor de hele run (toppersonages op het zaalscherm).
  const personagefoto = createPersonagefoto();
  let lopend = null;
  let timer = null;
  // Alle labels uit de catalogus van de run, voor de vragen per label in Admin.
  let labelLijst = [];

  function onthoudScene(state = {}) {
    const runs = Array.isArray(state.situationRuns) ? state.situationRuns : [];
    const laatste = runs[runs.length - 1];
    const bron = (laatste && laatste.resolved) || null;
    if (!bron || !laatste.situationRunId) return;
    if (scene && scene.situationRunId === laatste.situationRunId) return;
    const catalog = (state.showRunSnapshot && state.showRunSnapshot.catalog) || {};
    const labelNaam = new Map((catalog.labels || []).map((label) => [label.id, String(label.name || "").trim()]));
    if ((catalog.labels || []).length) labelLijst = catalog.labels.filter((label) => label.active !== false && !label.archivedAt).map((label) => ({ id: String(label.id), naam: String(label.name || "").trim() })).filter((label) => label.naam);
    const plek = new Map((catalog.performers || []).map((speler) => [speler.id, Number(speler.performerSlot) || 0]));
    scene = {
      situationRunId: String(laatste.situationRunId),
      showRunId: String(state.showRunId || ""),
      situationId: String(bron.situationId || ""),
      titel: String(bron.title || "").trim(),
      personages: (bron.performerSlots || []).filter((slot) => slot && slot.characterId).map((slot) => ({
        id: String(slot.characterId),
        naam: String(slot.characterName || "").trim(),
        speler: String(slot.performerName || "").trim(),
        // De camera waarop de speler staat: die van zijn plek in de ring (1, 2 of 3), tenzij hij in deze
        // scène bij een ander op de camera staat (shared/casting/camera-per-personage.json).
        plek: cameraVoor({
          omgeving: bron.environmentId || (bron.environment && bron.environment.id),
          situatie: bron.situationId,
          personage: slot.characterId,
          plek: plek.get(slot.performerId) || Number(slot.slotIndex) || 0,
        }),
        vast: !!personagefoto.vast(slot.characterId),
      })),
      labels: (bron.labelIds || []).map((id) => ({ id: String(id), naam: labelNaam.get(id) || "" })).filter((label) => label.naam),
    };
  }

  function fotoVan(situationRunId, plek) {
    const van = fotos.get(situationRunId);
    return (van && van.get(Number(plek))) || "";
  }

  // De vaste foto van een personage als data-URL (zie personagefoto.js), of "".
  function vasteFotoUrl(characterId) {
    const foto = personagefoto.vast(characterId);
    return foto ? `data:image/jpeg;base64,${foto.jpeg.toString("base64")}` : "";
  }

  // Een foto van een speler uit de scène (JPEG), aangeleverd door wie de camera's heeft.
  function zetFoto({ situationRunId, plek, jpeg, punten }) {
    const id = String(situationRunId || (scene && scene.situationRunId) || "");
    const nummer = Number(plek);
    if (!id || !Number.isInteger(nummer) || nummer < 1 || nummer > 6) return { ok: false, error: "plek_of_scene_ontbreekt" };
    if (!Buffer.isBuffer(jpeg) || jpeg.length < 100 || jpeg.length > MAX_FOTO_BYTES) return { ok: false, error: "foto_te_groot_of_leeg" };
    if (!fotos.has(id)) {
      fotos.set(id, new Map());
      while (fotos.size > 4) fotos.delete(fotos.keys().next().value);
    }
    fotos.get(id).set(nummer, `data:image/jpeg;base64,${jpeg.toString("base64")}`);
    // Wie op die plek speelde in deze scène krijgt het beeld als snapshot van het personage.
    const personage = scene && scene.situationRunId === id ? scene.personages.find((rij) => rij.plek === nummer && !rij.vast) : null;
    const snapshot = personage ? personagefoto.zet({ showRunId: scene.showRunId, characterId: personage.id, jpeg, punten: punten == null || punten === "" ? undefined : Number(punten) }) : null;
    return { ok: true, situationRunId: id, plek: nummer, personage: snapshot && snapshot.ok ? personage.id : null };
  }

  // Volgorde: de scène (thermometer), het personage (kaarten), dan het label (meter).
  function vragenVoor(van) {
    const vragen = [];
    if (instellingen.scene.aan) {
      vragen.push({ id: "scene", soort: "thermometer", vraag: instellingen.scene.vraag, keuzes: instellingen.scene.keuzes.map((keuze) => ({ id: keuze.id, emoji: keuze.emoji, naam: keuze.naam || "" })) });
    }
    if (instellingen.personage.aan && van.personages.length >= 1) {
      const keuzes = van.personages.map((personage) => ({ id: personage.id, naam: personage.naam, speler: personage.speler, foto: vasteFotoUrl(personage.id) || fotoVan(van.situationRunId, personage.plek) }));
      // Eén personage: niets te kiezen, dus ja (de kaart) of "Hoeft niet".
      const een = keuzes.length === 1;
      if (een) keuzes.push({ id: "nee", naam: "Hoeft niet", nee: true });
      vragen.push({ id: "personage", soort: "personage", vraag: een ? `Wil je ${keuzes[0].naam} terugzien?` : instellingen.personage.vraag, keuzes });
    }
    if (instellingen.label.aan && van.labels.length) {
      // Het eerste label van de scène, tegenover zijn tegendeel: "Mag het platter of netter?".
      // Links (minder) het tegendeel, midden zo houden, rechts (meer) meer van het label.
      const label = van.labels[0];
      const eigen = instellingen.label.vragen[label.id] || {};
      const r = richtingVan(label.naam);
      const keuzes = [
        { id: "minder", naam: eigen.minder || hoofd(r.tegen) },
        { id: "goed", naam: eigen.goed || "Zo houden" },
        { id: "meer", naam: eigen.meer || hoofd(r.meer) },
      ];
      vragen.push({ id: "label", soort: "meter", labelId: label.id, labelNaam: label.naam, vraag: eigen.vraag || `Mag het ${r.meer} of ${r.tegen}?`, keuzes });
    }
    return vragen.slice(0, 3);
  }

  // Wie meetelt: mensen, en bots alleen als dat aan staat.
  const telt = (antwoord) => !antwoord.bot || instellingen.botsTellenMee;

  function tellingen() {
    if (!lopend) return {};
    const uit = {};
    for (const vraag of lopend.vragen) uit[vraag.id] = Object.fromEntries(vraag.keuzes.map((keuze) => [keuze.id, 0]));
    for (const antwoord of lopend.antwoorden.values()) {
      if (!telt(antwoord)) continue;
      for (const [vraag, keuze] of Object.entries(antwoord.keuzes)) {
        if (uit[vraag] && uit[vraag][keuze] !== undefined) uit[vraag][keuze] += 1;
      }
    }
    return uit;
  }

  function publiek() {
    if (!lopend) return null;
    const nu = Date.now();
    return {
      id: lopend.id,
      titel: lopend.titel,
      opentAt: lopend.opentAt,
      endsAt: lopend.endsAt,
      // Hoe lang nog tot de vragen opengaan en tot ze sluiten: de schermen rekenen vanaf hun eigen klok.
      aanloopMs: Math.max(0, Date.parse(lopend.opentAt) - nu),
      overMs: Math.max(0, Date.parse(lopend.endsAt) - nu),
      vragen: lopend.vragen,
      gestemd: lopend.antwoorden.size,
      mensen: service.onlineMensen(),
    };
  }

  function stand() {
    return {
      ok: true,
      instellingen,
      lopend: lopend ? { ...publiek(), deelnemers: lopend.antwoorden.size, tellingen: tellingen() } : null,
      laatste: uitslagen[uitslagen.length - 1] || null,
      labels: labelLijst,
    };
  }

  function sluit(reden = "klok") {
    if (timer) clearTimeout(timer);
    timer = null;
    if (!lopend) return null;
    const uitslag = {
      id: lopend.id,
      showRunId: lopend.showRunId,
      situationId: lopend.situationId,
      titel: lopend.titel,
      startedAt: lopend.startedAt,
      closedAt: new Date().toISOString(),
      reden,
      deelnemers: [...lopend.antwoorden.values()].filter(telt).length,
      bots: [...lopend.antwoorden.values()].filter((antwoord) => antwoord.bot).length,
      botsTellenMee: instellingen.botsTellenMee,
      // Zonder de foto's: alleen wat er gevraagd is en wat er gekozen is.
      vragen: lopend.vragen.map((vraag) => ({ id: vraag.id, vraag: vraag.vraag, keuzes: vraag.keuzes.map((keuze) => ({ id: keuze.id, naam: keuze.naam || keuze.emoji || "" })) })),
      tellingen: tellingen(),
      anders: [...lopend.anders.entries()].filter(([sleutel]) => telt(lopend.antwoorden.get(sleutel) || {})).map(([, item]) => item),
    };
    const labelVraag = lopend.vragen.find((vraag) => vraag.id === "label");
    if (labelVraag) uitslag.label = { id: labelVraag.labelId, naam: labelVraag.labelNaam };
    lopend = null;
    uitslagen.push(uitslag);
    while (uitslagen.length > MAX_UITSLAGEN) uitslagen.shift();
    store.setSetting(UITSLAGEN_KEY, uitslagen);
    // De uitslag gaat naar het algoritme. De volgende scène ligt al vast (de keuze loopt één scène
    // vooruit): het oordeel telt mee voor de keuze daarna.
    service.emit("broadcast", { type: "beoordeling_dicht", id: uitslag.id });
    service.emit("admin-state-changed");
    Promise.all([stuurOordeel(uitslag), stuurLabelVoorkeur(uitslag), stuurPersonageVoorkeur(uitslag)])
      .then(() => stuurScoresNaarRuntime(uitslag));
    return uitslag;
  }

  // De nieuwste scores (met het oordeel erin) naar de runtime, zodat de keuze bij de start van de
  // volgende scène ermee rekent. De scène die al klaarstaat blijft staan.
  async function stuurScoresNaarRuntime(uitslag) {
    if (!uitslag.showRunId || typeof fetch !== "function") return;
    try {
      const res = await fetch(`${ALGORITME_URL}/v0/algorithm/scoring-contexts/${encodeURIComponent(uitslag.showRunId)}/scores`, {
        signal: AbortSignal.timeout ? AbortSignal.timeout(4000) : undefined,
      });
      if (!res.ok) throw new Error(`algoritme ${res.status}`);
      const scoreFeed = await res.json();
      await post(`${RUNTIME_URL}/v0/runtime/runs/${encodeURIComponent(uitslag.showRunId)}/scores`, { ...scoreFeed, source: "publiek_oordeel" });
      uitslag.scoresNaarRuntime = "ok";
    } catch (err) {
      uitslag.scoresNaarRuntime = `niet bereikt (${err.message})`;
    }
    store.setSetting(UITSLAGEN_KEY, uitslagen);
  }

  // Een POST naar een andere dienst; geeft het antwoord (of gooit een fout).
  async function post(url, body, ms = 4000) {
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout ? AbortSignal.timeout(ms) : undefined,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(`fout ${res.status}`);
    return data;
  }

  // Het oordeel over de scène (de thermometer): van onder (-1) tot boven (+1), gelijk verdeeld over de
  // keuzes (Nooit meer -1, Matig -1/3, Goed +1/3, Nog een keer +1); het gemiddelde gaat naar het algoritme.
  async function stuurOordeel(uitslag) {
    const vraag = (uitslag.vragen || []).find((item) => item.id === "scene");
    const telling = uitslag.tellingen && uitslag.tellingen.scene;
    if (!vraag || !telling || !uitslag.showRunId) return;
    const n = vraag.keuzes.length;
    let stemmen = 0;
    let som = 0;
    vraag.keuzes.forEach((keuze, i) => {
      const aantal = Number(telling[keuze.id]) || 0;
      stemmen += aantal;
      som += aantal * (n > 1 ? -1 + (2 * i) / (n - 1) : 0);
    });
    if (!stemmen) return;
    // Hoeveel telefoons er zijn, voor het delen in het algoritme: zonder bots als die niet meetellen.
    uitslag.oordeel = { gemiddelde: Math.round((som / stemmen) * 1000) / 1000, stemmen, mensen: service.onlineMensen({ zonderBots: !instellingen.botsTellenMee }) };
    store.setSetting(UITSLAGEN_KEY, uitslagen);
    if (typeof fetch !== "function") return;
    try {
      const data = await post(`${ALGORITME_URL}/v0/algorithm/events/scene-oordeel`, {
        showRunId: uitslag.showRunId,
        situationRunId: uitslag.id,
        situationId: uitslag.situationId,
        ...uitslag.oordeel,
        telling,
      }, 8000);
      uitslag.oordeel.algoritme = "ok";
      if (data && data.observedScore != null) uitslag.oordeel.score = data.observedScore;
    } catch (err) {
      uitslag.oordeel.algoritme = `niet bereikt (${err.message})`;
    }
    store.setSetting(UITSLAGEN_KEY, uitslagen);
  }

  // Het antwoord op de personagevraag als voorkeur: per personage het aandeel van de stemmen.
  function stuurPersonageVoorkeur(uitslag) {
    const telling = uitslag.tellingen && uitslag.tellingen.personage;
    if (!telling || !uitslag.showRunId) return;
    const stemmen = Object.values(telling).reduce((som, n) => som + (Number(n) || 0), 0);
    if (!stemmen) return;
    const keuzes = Object.entries(telling).map(([characterId, n]) => ({ characterId, aandeel: Math.round(((Number(n) || 0) / stemmen) * 1000) / 1000 }));
    uitslag.personageVoorkeur = { keuzes, stemmen };
    store.setSetting(UITSLAGEN_KEY, uitslagen);
    if (typeof fetch !== "function") return;
    return fetch(`${ALGORITME_URL}/v0/algorithm/events/personage-voorkeur`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ showRunId: uitslag.showRunId, situationRunId: uitslag.id, situationId: uitslag.situationId, keuzes, stemmen }),
      signal: AbortSignal.timeout ? AbortSignal.timeout(4000) : undefined,
    }).then((res) => { uitslag.personageVoorkeur.algoritme = res.ok ? "ok" : `fout ${res.status}`; })
      .catch((err) => { uitslag.personageVoorkeur.algoritme = `niet bereikt (${err.message})`; })
      .finally(() => store.setSetting(UITSLAGEN_KEY, uitslagen));
  }

  // Het antwoord op de labelvraag als voorkeur: (mag meer − te veel) / alle antwoorden, van −1 tot 1.
  function stuurLabelVoorkeur(uitslag) {
    const telling = uitslag.tellingen && uitslag.tellingen.label;
    if (!uitslag.label || !telling || !uitslag.showRunId) return;
    const stemmen = LABEL_KEUZES.reduce((som, [id]) => som + (Number(telling[id]) || 0), 0);
    if (!stemmen) return;
    const delta = LABEL_KEUZES.reduce((som, [id, richting]) => som + richting * (Number(telling[id]) || 0), 0) / stemmen;
    uitslag.labelVoorkeur = { labelId: uitslag.label.id, delta: Math.round(delta * 1000) / 1000, stemmen };
    store.setSetting(UITSLAGEN_KEY, uitslagen);
    if (typeof fetch !== "function") return;
    return fetch(`${ALGORITME_URL}/v0/algorithm/events/label-voorkeur`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ showRunId: uitslag.showRunId, situationRunId: uitslag.id, situationId: uitslag.situationId, labelId: uitslag.label.id, delta: uitslag.labelVoorkeur.delta, stemmen }),
      signal: AbortSignal.timeout ? AbortSignal.timeout(4000) : undefined,
    }).then((res) => { uitslag.labelVoorkeur.algoritme = res.ok ? "ok" : `fout ${res.status}`; })
      .catch((err) => { uitslag.labelVoorkeur.algoritme = `niet bereikt (${err.message})`; })
      .finally(() => store.setSetting(UITSLAGEN_KEY, uitslagen));
  }

  // Het zaalscherm laat de klok zien (na de keuze van de volgende scène): de klok begint opnieuw bij
  // de volle duur, op het scherm en op de telefoons. Eén keer per stemronde.
  function klokOpnieuw() {
    if (!lopend || lopend.klokOpnieuw) return null;
    const nu = Date.now();
    if (Date.parse(lopend.endsAt) <= nu) return null;
    lopend.klokOpnieuw = true;
    lopend.opentAt = new Date(nu).toISOString();
    lopend.endsAt = new Date(nu + instellingen.duur * 1000).toISOString();
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => sluit("klok"), instellingen.duur * 1000);
    if (typeof timer.unref === "function") timer.unref();
    service.emit("broadcast", { type: "beoordeling", beoordeling: publiek() });
    service.emit("admin-state-changed");
    return publiek();
  }

  // De scène is afgelopen: de vragen gaan open, de klok loopt.
  function start() {
    sluit("nieuwe_scene");
    if (!instellingen.aan || !scene || !service.getActiveSession()) return null;
    if (uitslagen.some((uitslag) => uitslag.id === scene.situationRunId)) return null;
    const vragen = vragenVoor(scene);
    if (!vragen.length) return null;
    const nu = Date.now();
    const opent = nu + instellingen.aanloop * 1000;
    lopend = {
      id: scene.situationRunId,
      showRunId: scene.showRunId,
      situationId: scene.situationId,
      titel: scene.titel,
      startedAt: new Date(nu).toISOString(),
      opentAt: new Date(opent).toISOString(),
      endsAt: new Date(opent + instellingen.duur * 1000).toISOString(),
      vragen,
      antwoorden: new Map(),
      anders: new Map(),
    };
    timer = setTimeout(() => sluit("klok"), (instellingen.aanloop + instellingen.duur) * 1000);
    if (typeof timer.unref === "function") timer.unref();
    service.emit("broadcast", { type: "beoordeling", beoordeling: publiek() });
    service.emit("admin-state-changed");
    return publiek();
  }

  // Eén antwoord van één telefoon. Per vraag telt het laatste antwoord.
  function antwoord(clientKey, { id, vraag, keuze, tekst: getypt, naam } = {}, { bot = false } = {}) {
    if (!lopend || String(id) !== lopend.id) return { error: { code: "beoordeling_voorbij", message: "De vragen zijn gesloten." } };
    const gevraagd = lopend.vragen.find((item) => item.id === String(vraag));
    if (!gevraagd || !gevraagd.keuzes.some((item) => item.id === String(keuze))) return { error: { code: "beoordeling_ongeldig", message: "Ongeldig antwoord." } };
    const sleutel = String(clientKey || "");
    if (!sleutel) return { error: { code: "beoordeling_ongeldig", message: "Ongeldig antwoord." } };
    const eersteStem = !lopend.antwoorden.has(sleutel);
    const van = lopend.antwoorden.get(sleutel) || { keuzes: {}, bot: Boolean(bot) };
    if (String(keuze) === "anders") {
      const zin = String(getypt || "").replace(/\s+/g, " ").trim().slice(0, 140);
      if (!zin) return { error: { code: "beoordeling_leeg", message: "Typ eerst iets." } };
      lopend.anders.set(sleutel, { naam: String(naam || "").slice(0, 40), tekst: zin, vraag: gevraagd.vraag });
    }
    van.keuzes[gevraagd.id] = String(keuze);
    lopend.antwoorden.set(sleutel, van);
    // Het zaalscherm laat zien dát er gestemd wordt en door hoeveel mensen, niet waarop.
    service.emit("broadcast", { type: "beoordeling_stem", id: lopend.id, gestemd: lopend.antwoorden.size, mensen: service.onlineMensen() });
    // Eerste antwoord van een echte telefoon met een naam: "NAAM heeft gestemd!" in de chat op het zaalscherm.
    const stemNaam = String(naam || "").trim();
    if (eersteStem && !bot && stemNaam && stemNaam !== "Anoniem") service.emit("broadcast", { type: "gestemd", naam: stemNaam, kleur: service.naamKleur(stemNaam), time: new Date().toISOString() });
    // Heeft iedereen die er is alles beantwoord, dan hoeft de klok niet uit te lopen.
    const klaar = [...lopend.antwoorden.values()].filter((item) => lopend.vragen.every((v) => item.keuzes[v.id])).length;
    const mensen = service.onlineMensen();
    if (mensen > 0 && klaar >= mensen) {
      const uit = { ok: true, id: lopend.id, vraag: gevraagd.id, keuze: String(keuze) };
      setTimeout(() => sluit("iedereen"), 600);
      return uit;
    }
    return { ok: true, id: lopend.id, vraag: gevraagd.id, keuze: String(keuze) };
  }

  function zetInstellingen(input = {}) {
    const deel = (naam) => ({ ...instellingen[naam], ...(input[naam] && typeof input[naam] === "object" ? input[naam] : {}) });
    // Vragen per label: wat binnenkomt vult aan of vervangt per label; de rest blijft staan.
    if (input.label && input.label.vragen && typeof input.label.vragen === "object") {
      input = { ...input, label: { ...input.label, vragen: { ...instellingen.label.vragen, ...input.label.vragen } } };
    }
    instellingen = normalizeInstellingen({ ...instellingen, ...input, scene: deel("scene"), personage: deel("personage"), label: deel("label") });
    store.setSetting(INSTELLINGEN_KEY, instellingen);
    service.emit("admin-state-changed");
    return instellingen;
  }

  // Een nieuwe run: wat openstond is weg, de foto's ook.
  function reset() {
    if (timer) clearTimeout(timer);
    timer = null;
    if (lopend) service.emit("broadcast", { type: "beoordeling_dicht", id: lopend.id });
    lopend = null;
    scene = null;
    fotos.clear();
    personagefoto.reset();
  }

  return { onthoudScene, zetFoto, personagefoto: (showRunId, characterId) => personagefoto.van(showRunId, characterId), personagekaart: (showRunId, characterId) => personagefoto.kaart(showRunId, characterId), start, sluit, klokOpnieuw, antwoord, publiek, stand, zetInstellingen, reset, uitslagen: () => uitslagen.slice() };
}

module.exports = { createBeoordeling, normalizeInstellingen };
