"use strict";

// Het beoordeelmoment: na elke scène krijgt het publiek op de telefoon een paar korte vragen, met
// een klok. De vragen gaan over de scène die net gespeeld is: wat vond je ervan, welk personage
// vond je het leukst (met de foto van de speler als die er is), en waar wil je meer van (de labels
// van de scène). De antwoorden worden per scène bewaard.

const INSTELLINGEN_KEY = "beoordeling_instellingen";
const UITSLAGEN_KEY = "beoordeling_uitslagen";
const MAX_FOTO_BYTES = 150 * 1024;
const MAX_UITSLAGEN = 60;

const STANDAARD = {
  aan: true,
  // Zo lang staat de klok (seconden). De klok is ook de omkleedtijd van de spelers.
  duur: 60,
  scene: { aan: true, vraag: "Wat vond je van de scène?", keuzes: [{ id: "leuk", emoji: "❤️" }, { id: "saai", emoji: "🥱" }] },
  personage: { aan: true, vraag: "Welk personage vond je het leukst?" },
  label: { aan: true, vraag: "Waar wil je meer van?", meer: "Meer", minder: "Minder" },
};

function tekst(waarde, standaard, max = 120) {
  const schoon = String(waarde == null ? "" : waarde).trim().slice(0, max);
  return schoon || standaard;
}

function normalizeInstellingen(raw) {
  const bron = raw && typeof raw === "object" ? raw : {};
  const deel = (naam) => (bron[naam] && typeof bron[naam] === "object" ? bron[naam] : {});
  const duur = Number(bron.duur);
  const keuzes = Array.isArray(deel("scene").keuzes)
    ? deel("scene").keuzes.map((keuze) => ({ id: tekst(keuze && keuze.id, "", 20), emoji: tekst(keuze && keuze.emoji, "", 8) })).filter((keuze) => keuze.id && keuze.emoji).slice(0, 4)
    : [];
  return {
    aan: bron.aan === undefined ? STANDAARD.aan : Boolean(bron.aan),
    duur: Number.isFinite(duur) ? Math.min(300, Math.max(10, Math.round(duur))) : STANDAARD.duur,
    scene: {
      aan: deel("scene").aan === undefined ? true : Boolean(deel("scene").aan),
      vraag: tekst(deel("scene").vraag, STANDAARD.scene.vraag),
      keuzes: keuzes.length >= 2 ? keuzes : STANDAARD.scene.keuzes.map((keuze) => ({ ...keuze })),
    },
    personage: { aan: deel("personage").aan === undefined ? true : Boolean(deel("personage").aan), vraag: tekst(deel("personage").vraag, STANDAARD.personage.vraag) },
    label: {
      aan: deel("label").aan === undefined ? true : Boolean(deel("label").aan),
      vraag: tekst(deel("label").vraag, STANDAARD.label.vraag),
      meer: tekst(deel("label").meer, STANDAARD.label.meer, 30),
      minder: tekst(deel("label").minder, STANDAARD.label.minder, 30),
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
  let lopend = null;
  let timer = null;

  function onthoudScene(state = {}) {
    const runs = Array.isArray(state.situationRuns) ? state.situationRuns : [];
    const laatste = runs[runs.length - 1];
    const bron = (laatste && laatste.resolved) || null;
    if (!bron || !laatste.situationRunId) return;
    if (scene && scene.situationRunId === laatste.situationRunId) return;
    const catalog = (state.showRunSnapshot && state.showRunSnapshot.catalog) || {};
    const labelNaam = new Map((catalog.labels || []).map((label) => [label.id, String(label.name || "").trim()]));
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
        // De plek van de speler in de ring (camera 1, 2 of 3).
        plek: plek.get(slot.performerId) || Number(slot.slotIndex) || 0,
      })),
      labels: (bron.labelIds || []).map((id) => ({ id: String(id), naam: labelNaam.get(id) || "" })).filter((label) => label.naam),
    };
  }

  function fotoVan(situationRunId, plek) {
    const van = fotos.get(situationRunId);
    return (van && van.get(Number(plek))) || "";
  }

  // Een foto van een speler uit de scène (JPEG), aangeleverd door wie de camera's heeft.
  function zetFoto({ situationRunId, plek, jpeg }) {
    const id = String(situationRunId || (scene && scene.situationRunId) || "");
    const nummer = Number(plek);
    if (!id || !Number.isInteger(nummer) || nummer < 1 || nummer > 6) return { ok: false, error: "plek_of_scene_ontbreekt" };
    if (!Buffer.isBuffer(jpeg) || jpeg.length < 100 || jpeg.length > MAX_FOTO_BYTES) return { ok: false, error: "foto_te_groot_of_leeg" };
    if (!fotos.has(id)) {
      fotos.set(id, new Map());
      while (fotos.size > 4) fotos.delete(fotos.keys().next().value);
    }
    fotos.get(id).set(nummer, `data:image/jpeg;base64,${jpeg.toString("base64")}`);
    return { ok: true, situationRunId: id, plek: nummer };
  }

  function vragenVoor(van) {
    const vragen = [];
    if (instellingen.scene.aan) {
      vragen.push({ id: "scene", soort: "emoji", vraag: instellingen.scene.vraag, keuzes: instellingen.scene.keuzes.map((keuze) => ({ id: keuze.id, emoji: keuze.emoji })) });
    }
    if (instellingen.personage.aan && van.personages.length >= 2) {
      vragen.push({
        id: "personage",
        soort: "personage",
        vraag: instellingen.personage.vraag,
        keuzes: van.personages.map((personage) => ({ id: personage.id, naam: personage.naam, speler: personage.speler, foto: fotoVan(van.situationRunId, personage.plek) })),
      });
    }
    if (instellingen.label.aan && van.labels.length) {
      // Eén label: meer of minder daarvan. Meer labels: kies waar je meer van wilt.
      const keuzes = van.labels.length === 1
        ? [{ id: `meer:${van.labels[0].id}`, naam: `${instellingen.label.meer} ${van.labels[0].naam.toLowerCase()}` }, { id: `minder:${van.labels[0].id}`, naam: `${instellingen.label.minder} ${van.labels[0].naam.toLowerCase()}` }]
        : van.labels.map((label) => ({ id: `meer:${label.id}`, naam: label.naam }));
      vragen.push({ id: "label", soort: "tekst", vraag: instellingen.label.vraag, keuzes });
    }
    return vragen.slice(0, 3);
  }

  function tellingen() {
    if (!lopend) return {};
    const uit = {};
    for (const vraag of lopend.vragen) uit[vraag.id] = Object.fromEntries(vraag.keuzes.map((keuze) => [keuze.id, 0]));
    for (const antwoord of lopend.antwoorden.values()) {
      for (const [vraag, keuze] of Object.entries(antwoord.keuzes)) {
        if (uit[vraag] && uit[vraag][keuze] !== undefined) uit[vraag][keuze] += 1;
      }
    }
    return uit;
  }

  function publiek() {
    if (!lopend) return null;
    return { id: lopend.id, titel: lopend.titel, endsAt: lopend.endsAt, vragen: lopend.vragen };
  }

  function stand() {
    return {
      ok: true,
      instellingen,
      lopend: lopend ? { ...publiek(), deelnemers: lopend.antwoorden.size, tellingen: tellingen() } : null,
      laatste: uitslagen[uitslagen.length - 1] || null,
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
      deelnemers: lopend.antwoorden.size,
      // Zonder de foto's: alleen wat er gevraagd is en wat er gekozen is.
      vragen: lopend.vragen.map((vraag) => ({ id: vraag.id, vraag: vraag.vraag, keuzes: vraag.keuzes.map((keuze) => ({ id: keuze.id, naam: keuze.naam || keuze.emoji || "" })) })),
      tellingen: tellingen(),
    };
    lopend = null;
    uitslagen.push(uitslag);
    while (uitslagen.length > MAX_UITSLAGEN) uitslagen.shift();
    store.setSetting(UITSLAGEN_KEY, uitslagen);
    service.emit("broadcast", { type: "beoordeling_dicht", id: uitslag.id });
    service.emit("admin-state-changed");
    return uitslag;
  }

  // De scène is afgelopen: de vragen gaan open, de klok loopt.
  function start() {
    sluit("nieuwe_scene");
    if (!instellingen.aan || !scene || !service.getActiveSession()) return null;
    if (uitslagen.some((uitslag) => uitslag.id === scene.situationRunId)) return null;
    const vragen = vragenVoor(scene);
    if (!vragen.length) return null;
    const nu = Date.now();
    lopend = {
      id: scene.situationRunId,
      showRunId: scene.showRunId,
      situationId: scene.situationId,
      titel: scene.titel,
      startedAt: new Date(nu).toISOString(),
      endsAt: new Date(nu + instellingen.duur * 1000).toISOString(),
      vragen,
      antwoorden: new Map(),
    };
    timer = setTimeout(() => sluit("klok"), instellingen.duur * 1000);
    if (typeof timer.unref === "function") timer.unref();
    service.emit("broadcast", { type: "beoordeling", beoordeling: publiek() });
    service.emit("admin-state-changed");
    return publiek();
  }

  // Eén antwoord van één telefoon. Per vraag telt het laatste antwoord.
  function antwoord(clientKey, { id, vraag, keuze } = {}) {
    if (!lopend || String(id) !== lopend.id) return { error: { code: "beoordeling_voorbij", message: "De vragen zijn gesloten." } };
    const gevraagd = lopend.vragen.find((item) => item.id === String(vraag));
    if (!gevraagd || !gevraagd.keuzes.some((item) => item.id === String(keuze))) return { error: { code: "beoordeling_ongeldig", message: "Ongeldig antwoord." } };
    const sleutel = String(clientKey || "");
    if (!sleutel) return { error: { code: "beoordeling_ongeldig", message: "Ongeldig antwoord." } };
    const van = lopend.antwoorden.get(sleutel) || { keuzes: {} };
    van.keuzes[gevraagd.id] = String(keuze);
    lopend.antwoorden.set(sleutel, van);
    return { ok: true, id: lopend.id, vraag: gevraagd.id, keuze: String(keuze) };
  }

  function zetInstellingen(input = {}) {
    const deel = (naam) => ({ ...instellingen[naam], ...(input[naam] && typeof input[naam] === "object" ? input[naam] : {}) });
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
  }

  return { onthoudScene, zetFoto, start, sluit, antwoord, publiek, stand, zetInstellingen, reset, uitslagen: () => uitslagen.slice() };
}

module.exports = { createBeoordeling, normalizeInstellingen };
