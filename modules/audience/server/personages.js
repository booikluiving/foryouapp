"use strict";

// Personagestab op de publiekstelefoon: welke personages in deze run al gespeeld zijn.
//
// - Bron is de runtime (situationRuns van de lopende run), die de publieksdienst al elke seconde leest.
//   Geen eigen opslag: na RESET RUN of een herstart volgt de stand vanzelf de runtime.
// - Vrij = het personage stond in een scène die is afgelopen. Wie nog dicht is gaat niet mee: de telefoon
//   krijgt alleen het totaal, geen naam, id of foto.
// - Elk personage heeft een vaste plek in het rooster, per run gehusseld, zodat een plek niets verklapt.
// - De telefoon krijgt steeds de hele stand (bericht "personages" en hetzelfde in hello) en vervangt alles.
//   Alleen versturen als er iets verandert.
// - Foto = de snapshot van de speler als dat personage in deze run (personagefoto.js), via een adres met ?v=.
//   Verkleind tot 180×240 met sips, één keer per beeld; lukt dat niet, dan het beeld zelf.

const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFile } = require("node:child_process");

const CATALOGUS_VERS_MS = 5 * 60 * 1000;
const CATALOGUS_OPNIEUW_MS = 30 * 1000;
const MAX_BESCHRIJVING = 600;
const MAX_KLEIN = 120;
const ID_PATROON = /^character:[0-9]+$/;

function catalogusAdres() {
  return String(process.env.AUDIENCE_CATALOG_URL || "http://127.0.0.1:3021").replace(/\/+$/, "");
}

// Deterministische volgorde per run (Fisher–Yates met een hash van de run als zaad).
function hussel(ids, zaad) {
  const lijst = ids.slice().sort();
  let h = crypto.createHash("sha256").update(String(zaad)).digest().readUInt32BE(0) || 1;
  for (let i = lijst.length - 1; i > 0; i--) {
    h ^= h << 13; h >>>= 0; h ^= h >>> 17; h ^= h << 5; h >>>= 0;
    const j = h % (i + 1);
    [lijst[i], lijst[j]] = [lijst[j], lijst[i]];
  }
  return lijst;
}

function createPersonages({ service, fotoVan, fetchImpl = globalThis.fetch, sips = process.env.AUDIENCE_SIPS || "/usr/bin/sips" } = {}) {
  let stand = { run: null, revisie: 0, totaal: 0, vrij: [] };
  let handtekening = "";
  let revisie = 0;
  let plekVoor = { run: null, plekken: new Map(), sleutel: "" };
  const catalogus = { beschrijving: new Map(), geladen: 0, bezig: false, laatstePoging: 0 };
  const klein = new Map(); // sleutel run|id|at → Promise<Buffer>

  function laadCatalogus() {
    const nu = Date.now();
    if (catalogus.bezig || typeof fetchImpl !== "function") return;
    if (catalogus.geladen && nu - catalogus.geladen < CATALOGUS_VERS_MS) return;
    if (nu - catalogus.laatstePoging < CATALOGUS_OPNIEUW_MS) return;
    catalogus.bezig = true;
    catalogus.laatstePoging = nu;
    const controller = new AbortController();
    const klok = setTimeout(() => { try { controller.abort(); } catch {} }, 4000);
    Promise.resolve()
      .then(() => fetchImpl(`${catalogusAdres()}/v0/catalog/read-model`, { signal: controller.signal }))
      .then((res) => (res && res.ok ? res.json() : null))
      .then((model) => {
        if (!model || !Array.isArray(model.characters)) return;
        const kaart = new Map();
        for (const c of model.characters) {
          if (c && c.id) kaart.set(String(c.id), String(c.description || "").trim().slice(0, MAX_BESCHRIJVING));
        }
        catalogus.beschrijving = kaart;
        catalogus.geladen = Date.now();
      })
      .catch(() => {})
      .finally(() => { clearTimeout(klok); catalogus.bezig = false; });
  }

  // De personages die in deze run kunnen verschijnen: in een actieve situatie van de catalogus van de run.
  function kandidaten(catalog) {
    const situaties = Array.isArray(catalog.situations) ? catalog.situations : [];
    const ids = new Set();
    for (const s of situaties) {
      if (!s || s.active === false || s.archivedAt) continue;
      for (const id of Array.isArray(s.characterIds) ? s.characterIds : []) if (id) ids.add(String(id));
    }
    const tellen = new Map();
    for (const s of situaties) {
      if (!s || s.active === false || s.archivedAt) continue;
      for (const id of new Set((s.characterIds || []).map(String))) tellen.set(id, (tellen.get(id) || 0) + 1);
    }
    return { ids: [...ids], tellen };
  }

  function bereken(state = {}) {
    const status = String(state.status || "");
    const run = state.showRunId && !["idle", "reset"].includes(status) ? String(state.showRunId) : null;
    if (!run) return { run: null, totaal: 0, vrij: [] };
    const catalog = (state.showRunSnapshot && state.showRunSnapshot.catalog) || {};
    const namen = new Map((catalog.characters || []).map((c) => [String(c.id), String(c.name || "").trim()]));
    const spelerOpPlek = new Map((catalog.performers || []).map((p) => [Number(p.performerSlot) || 0, String(p.name || "").trim()]));
    const plekVanSpeler = new Map((catalog.performers || []).map((p) => [String(p.id), Number(p.performerSlot) || 0]));
    const { ids, tellen } = kandidaten(catalog);
    const sleutel = run + "|" + ids.length;
    if (plekVoor.sleutel !== sleutel) {
      plekVoor = { run, sleutel, plekken: new Map(hussel(ids, run).map((id, i) => [id, i])) };
    }

    const vrij = new Map();
    const runs = Array.isArray(state.situationRuns) ? state.situationRuns : [];
    runs.forEach((sr, index) => {
      const afgelopen = sr && (sr.status === "played" || sr.endedAt);
      if (!afgelopen || !sr.resolved) return;
      for (const slot of sr.resolved.performerSlots || []) {
        const id = slot && slot.characterId ? String(slot.characterId) : "";
        if (!ID_PATROON.test(id) || !plekVoor.plekken.has(id)) continue;
        // Speler: de vaste speler, anders wie op die plek in de ring stond (zoals in beoordeling.js).
        const plek = plekVanSpeler.get(String(slot.performerId || "")) || Number(slot.slotIndex) || 0;
        const speler = String(slot.performerName || spelerOpPlek.get(plek) || "").trim();
        if (!vrij.has(id)) vrij.set(id, { id, naam: String(slot.characterName || namen.get(id) || "").trim(), spelers: [], scenes: [] });
        const rij = vrij.get(id);
        if (speler && !rij.spelers.includes(speler)) rij.spelers.push(speler);
        rij.scenes.push({ nr: index + 1, titel: String(sr.resolved.title || sr.title || "").trim().slice(0, 160) });
      }
    });

    laadCatalogus();
    return {
      run,
      totaal: plekVoor.plekken.size,
      vrij: [...vrij.values()].map((rij) => {
        const foto = typeof fotoVan === "function" ? fotoVan(run, rij.id) : null;
        return {
          id: rij.id,
          plek: plekVoor.plekken.get(rij.id),
          naam: rij.naam || namen.get(rij.id) || "",
          beschrijving: catalogus.beschrijving.get(rij.id) || "",
          speler: rij.spelers,
          scenes: rij.scenes,
          nog: Math.max(0, (tellen.get(rij.id) || 0) - new Set(rij.scenes.map((s) => s.titel)).size),
          foto: foto && foto.at ? `/audience/public/personagefoto/${encodeURIComponent(rij.id)}?v=${foto.at}` : null,
        };
      }).sort((a, b) => a.plek - b.plek),
    };
  }

  // Elke poll van de runtime. Gooit nooit: een fout hier mag de fase en de chat niet raken.
  function volg(state) {
    try {
      const nieuw = bereken(state);
      const teken = JSON.stringify(nieuw);
      if (teken === handtekening) return false;
      handtekening = teken;
      // Oplopend over een herstart heen: een telefoon die de oude stand heeft, neemt de nieuwe altijd over.
      revisie = Math.max(revisie + 1, Date.now());
      stand = { ...nieuw, revisie };
      if (service && typeof service.emit === "function") service.emit("broadcast", { type: "personages", ...stand });
      return true;
    } catch (_err) {
      return false;
    }
  }

  function publiek() {
    return { ...stand, vrij: stand.vrij.map((v) => ({ ...v })) };
  }

  // Verkleinde foto (JPEG). Alleen voor een personage dat in de huidige stand vrij is.
  function kleineFoto(characterId) {
    const id = String(characterId || "");
    if (!ID_PATROON.test(id) || !stand.run) return Promise.resolve(null);
    if (!stand.vrij.some((v) => v.id === id)) return Promise.resolve(null);
    const foto = typeof fotoVan === "function" ? fotoVan(stand.run, id) : null;
    if (!foto || !Buffer.isBuffer(foto.jpeg)) return Promise.resolve(null);
    const sleutel = `${stand.run}|${id}|${foto.at}`;
    if (!klein.has(sleutel)) {
      klein.set(sleutel, verklein(foto.jpeg).then((buf) => ({ jpeg: buf || foto.jpeg, at: foto.at })));
      while (klein.size > MAX_KLEIN) klein.delete(klein.keys().next().value);
    }
    return klein.get(sleutel);
  }

  function verklein(jpeg) {
    return new Promise((resolve) => {
      let map;
      try { map = fs.mkdtempSync(path.join(os.tmpdir(), "fy-personage-")); } catch { resolve(null); return; }
      const bron = path.join(map, "bron.jpg");
      const doel = path.join(map, "klein.jpg");
      const klaar = (buf) => { try { fs.rmSync(map, { recursive: true, force: true }); } catch {} resolve(buf); };
      try { fs.writeFileSync(bron, jpeg); } catch { klaar(null); return; }
      execFile(sips, ["-s", "format", "jpeg", "-s", "formatOptions", "60", "--resampleHeightWidth", "240", "180", bron, "--out", doel], { timeout: 5000 }, (err) => {
        if (err) { klaar(null); return; }
        try {
          const buf = fs.readFileSync(doel);
          klaar(buf.length > 100 ? buf : null);
        } catch { klaar(null); }
      });
    });
  }

  return { volg, publiek, kleineFoto, _bereken: bereken };
}

// Route voor de foto: /audience/public/personagefoto/:characterId?v=…
// magKijken(req) → true/false; op de publieke poort is dat de QR-pas.
function personagefotoRoute(service, magKijken) {
  return async (req, res) => {
    try {
      if (typeof magKijken === "function" && !magKijken(req)) {
        res.status(403).set("Cache-Control", "no-store").type("text").send("Geen toegang");
        return;
      }
      const foto = service.personages ? await service.personages.kleineFoto(req.params.characterId) : null;
      if (!foto) {
        res.status(404).set("Cache-Control", "no-store").type("text").send("Niet gevonden");
        return;
      }
      res.set({
        "Content-Type": "image/jpeg",
        "Cache-Control": "private, max-age=86400, immutable",
        "X-Content-Type-Options": "nosniff",
      });
      res.send(foto.jpeg);
    } catch (_err) {
      res.status(500).set("Cache-Control", "no-store").type("text").send("Er ging iets mis");
    }
  };
}

module.exports = { createPersonages, personagefotoRoute, hussel };
