"use strict";

// Snapshot per personage: het beeld van de speler als dat personage, uit de scène waarin het speelde.
// Geldt voor de run: per run een eigen map, de nieuwste scène wint. Staat op schijf, zodat een
// herstart van de dienst de beelden niet kwijtraakt; bij de eerste snapshot van een nieuwe run gaan
// de mappen van eerdere runs weg.

const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { vasteFoto } = require("../../../shared/casting/camera-per-personage");

const MAX_BYTES = 150 * 1024;
// Onder dit cijfer staat er niemand in beeld (zie show/spelersfoto/spelersfoto.py).
const MIN_PUNTEN = 0.2;
// Archief over runs heen: per personage de vier nieuwste snapshots met iemand in beeld, om uit te kiezen.
// Een bestand dat met "vast-" begint is gekozen: dat wordt het kaartje en gaat nooit weg.
const ARCHIEF_MAX = 4;

const veilig = (tekst) => String(tekst || "").replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 120);

function createPersonagefoto(opties = {}) {
  const map = opties.map || process.env.AUDIENCE_PERSONAGEFOTO_DIR || path.join(os.homedir(), "ForYou", "spelersfoto", "personages");
  const archief = opties.archief || process.env.AUDIENCE_PERSONAGEARCHIEF_DIR || path.join(os.homedir(), "ForYou", "spelersfoto", "archief");
  // bestand → { jpeg, at } van gelezen archieffoto's
  const archiefGeheugen = new Map();
  // run → (personage → { jpeg, at })
  const geheugen = new Map();

  // Een personage met een vaste foto (shared/casting) krijgt nooit het camerabeeld: dat klopt niet
  // als twee spelers op één camera staan.
  function vasteVan(characterId) {
    const pad = vasteFoto(characterId);
    if (!pad) return null;
    const foto = leesArchief(pad);
    return foto ? { ...foto, bron: "vast" } : null;
  }

  const runMap = (showRunId) => path.join(map, veilig(showRunId));
  const bestand = (showRunId, characterId) => path.join(runMap(showRunId), `${veilig(characterId)}.jpg`);

  function zet({ showRunId, characterId, jpeg, punten }) {
    if (!showRunId || !characterId) return { ok: false, error: "run_of_personage_ontbreekt" };
    if (vasteFoto(characterId)) return { ok: false, error: "vaste_foto" };
    if (!Buffer.isBuffer(jpeg) || jpeg.length < 100 || jpeg.length > MAX_BYTES) return { ok: false, error: "foto_te_groot_of_leeg" };
    // Niemand in beeld: alleen als dit personage nog geen snapshot heeft (beter de omgeving dan niets);
    // een snapshot met iemand erop wordt er nooit door vervangen.
    if (Number.isFinite(punten) && punten < MIN_PUNTEN && van(showRunId, characterId)) return { ok: false, error: "niemand_in_beeld" };
    const at = Date.now();
    if (!geheugen.has(showRunId)) { geheugen.clear(); geheugen.set(showRunId, new Map()); }
    geheugen.get(showRunId).set(String(characterId), { jpeg, at });
    try {
      fs.mkdirSync(runMap(showRunId), { recursive: true });
      for (const naam of fs.readdirSync(map)) {
        if (naam !== veilig(showRunId)) fs.rmSync(path.join(map, naam), { recursive: true, force: true });
      }
      const doel = bestand(showRunId, characterId);
      fs.writeFileSync(`${doel}.tmp`, jpeg);
      fs.renameSync(`${doel}.tmp`, doel);
    } catch (_err) {
      // Schijf niet beschikbaar: het beeld staat nog in het geheugen.
    }
    if (!(Number.isFinite(punten) && punten < MIN_PUNTEN)) bewaarInArchief(showRunId, characterId, jpeg, at);
    return { ok: true, characterId: String(characterId), at };
  }

  function van(showRunId, characterId) {
    if (!showRunId || !characterId) return null;
    const vaste = vasteVan(characterId);
    if (vaste) return vaste;
    const inGeheugen = geheugen.get(showRunId) && geheugen.get(showRunId).get(String(characterId));
    if (inGeheugen) return inGeheugen;
    try {
      const doel = bestand(showRunId, characterId);
      const at = Math.round(fs.statSync(doel).mtimeMs);
      const jpeg = fs.readFileSync(doel);
      if (jpeg.length < 100) return null;
      if (!geheugen.has(showRunId)) { geheugen.clear(); geheugen.set(showRunId, new Map()); }
      geheugen.get(showRunId).set(String(characterId), { jpeg, at });
      return { jpeg, at };
    } catch (_err) {
      return null;
    }
  }

  const archiefMap = (characterId) => path.join(archief, veilig(characterId).replace(/^character_?/, "character_"));
  const stempel = (ms) => new Date(ms).toISOString().replace(/[-:]/g, "").replace("T", "-").slice(0, 19);

  function bewaarInArchief(showRunId, characterId, jpeg, at) {
    try {
      const doelMap = archiefMap(characterId);
      fs.mkdirSync(doelMap, { recursive: true });
      const hash = crypto.createHash("sha1").update(jpeg).digest("hex").slice(0, 10);
      const namen = fs.readdirSync(doelMap).filter((naam) => naam.endsWith(".jpg"));
      if (namen.some((naam) => naam.includes(hash))) return;
      const doel = path.join(doelMap, `${stempel(at)}-${veilig(showRunId)}-${hash}.jpg`);
      fs.writeFileSync(`${doel}.tmp`, jpeg);
      fs.renameSync(`${doel}.tmp`, doel);
      const alle = fs.readdirSync(doelMap).filter((naam) => naam.endsWith(".jpg"));
      const vast = alle.filter((naam) => naam.startsWith("vast-")).length;
      const los = alle.filter((naam) => !naam.startsWith("vast-")).sort().reverse();
      for (const naam of los.slice(Math.max(0, ARCHIEF_MAX - vast))) fs.rmSync(path.join(doelMap, naam), { force: true });
    } catch (_err) {
      // Archief niet beschikbaar: de show gaat gewoon door.
    }
  }

  function leesArchief(bestand) {
    try {
      const at = Math.round(fs.statSync(bestand).mtimeMs);
      const bekend = archiefGeheugen.get(bestand);
      if (bekend && bekend.at === at) return bekend;
      const jpeg = fs.readFileSync(bestand);
      if (jpeg.length < 100) return null;
      if (archiefGeheugen.size > 200) archiefGeheugen.clear();
      const foto = { jpeg, at };
      archiefGeheugen.set(bestand, foto);
      return foto;
    } catch (_err) {
      return null;
    }
  }

  // De foto voor het kaartje van een personage: de gekozen foto uit het archief, anders de snapshot van
  // deze run, anders de nieuwste uit het archief.
  function kaart(showRunId, characterId) {
    if (!characterId) return null;
    const vaste = vasteVan(characterId);
    if (vaste) return vaste;
    let namen = [];
    try { namen = fs.readdirSync(archiefMap(characterId)).filter((naam) => naam.endsWith(".jpg")).sort().reverse(); } catch (_err) { namen = []; }
    const vast = namen.find((naam) => naam.startsWith("vast-"));
    if (vast) { const foto = leesArchief(path.join(archiefMap(characterId), vast)); if (foto) return { ...foto, bron: "gekozen" }; }
    const run = van(showRunId, characterId);
    if (run) return { ...run, bron: "run" };
    const nieuwste = namen.find((naam) => !naam.startsWith("vast-"));
    if (nieuwste) { const foto = leesArchief(path.join(archiefMap(characterId), nieuwste)); if (foto) return { ...foto, bron: "archief" }; }
    return null;
  }

  return { zet, van, kaart, vast: vasteVan, reset: () => geheugen.clear(), map, archief };
}

module.exports = { createPersonagefoto };
