"use strict";

// De content warning: bij START SHOW komt er één keer een tekst in beeld, op het zaalscherm en/of op
// de telefoons. De tekst schrijft het team in Admin; zonder tekst komt er niets in beeld.

const INSTELLINGEN_KEY = "waarschuwing_instellingen";
const WAAR = ["beide", "zaalscherm", "telefoons"];

const STANDAARD = {
  tekst: "",
  // Zo lang blijft de tekst staan (seconden). 0: tot iemand hem weghaalt of de eerste scène begint.
  duur: 10,
  waar: "beide",
};

function normalizeInstellingen(raw) {
  const bron = raw && typeof raw === "object" ? raw : {};
  const duur = Number(bron.duur);
  return {
    tekst: String(bron.tekst == null ? "" : bron.tekst).replace(/\r/g, "").trim().slice(0, 600),
    duur: Number.isFinite(duur) ? Math.min(120, Math.max(0, Math.round(duur))) : STANDAARD.duur,
    waar: WAAR.includes(bron.waar) ? bron.waar : STANDAARD.waar,
  };
}

function createWaarschuwing(service) {
  const store = service.store;
  let instellingen = normalizeInstellingen(store.getSetting(INSTELLINGEN_KEY, null));
  let lopend = null;
  let timer = null;
  let teller = 0;

  function publiek() {
    if (!lopend) return null;
    return {
      id: lopend.id,
      tekst: lopend.tekst,
      waar: lopend.waar,
      // Hoe lang nog: de schermen rekenen vanaf hun eigen klok. null: blijft staan tot hij weggehaald wordt.
      overMs: lopend.tot === null ? null : Math.max(0, lopend.tot - Date.now()),
    };
  }

  function stand() {
    return { ok: true, instellingen, lopend: publiek() };
  }

  function weg() {
    if (timer) clearTimeout(timer);
    timer = null;
    if (!lopend) return false;
    lopend = null;
    service.emit("broadcast", { type: "waarschuwing", waarschuwing: null });
    service.emit("admin-state-changed");
    return true;
  }

  function toon() {
    weg();
    if (!instellingen.tekst) return null;
    teller += 1;
    lopend = {
      id: `${Date.now()}-${teller}`,
      tekst: instellingen.tekst,
      waar: instellingen.waar,
      tot: instellingen.duur > 0 ? Date.now() + instellingen.duur * 1000 : null,
    };
    if (lopend.tot !== null) {
      timer = setTimeout(weg, instellingen.duur * 1000);
      if (typeof timer.unref === "function") timer.unref();
    }
    service.emit("broadcast", { type: "waarschuwing", waarschuwing: publiek() });
    service.emit("admin-state-changed");
    return publiek();
  }

  function zetInstellingen(input = {}) {
    instellingen = normalizeInstellingen({ ...instellingen, ...(input && typeof input === "object" ? input : {}) });
    store.setSetting(INSTELLINGEN_KEY, instellingen);
    service.emit("admin-state-changed");
    return instellingen;
  }

  // Begint er een scène of is de run of de sessie voorbij, dan hoort de tekst niet meer in beeld.
  service.on("broadcast", (msg) => {
    if (!lopend || !msg) return;
    const scene = msg.type === "fase" && msg.fase === "scene";
    if (scene || msg.type === "session_reset" || msg.type === "session_closed") weg();
  });

  return { publiek, stand, toon, weg, zetInstellingen };
}

module.exports = { createWaarschuwing, normalizeInstellingen };
