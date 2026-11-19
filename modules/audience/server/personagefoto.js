"use strict";

// Snapshot per personage: het beeld van de speler als dat personage, uit de scène waarin het speelde.
// Geldt voor de run: per run een eigen map, de nieuwste scène wint. Staat op schijf, zodat een
// herstart van de dienst de beelden niet kwijtraakt; bij de eerste snapshot van een nieuwe run gaan
// de mappen van eerdere runs weg.

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const MAX_BYTES = 150 * 1024;
// Onder dit cijfer staat er niemand in beeld (zie show/spelersfoto/spelersfoto.py).
const MIN_PUNTEN = 0.2;

const veilig = (tekst) => String(tekst || "").replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 120);

function createPersonagefoto(opties = {}) {
  const map = opties.map || process.env.AUDIENCE_PERSONAGEFOTO_DIR || path.join(os.homedir(), "ForYou", "spelersfoto", "personages");
  // run → (personage → { jpeg, at })
  const geheugen = new Map();

  const runMap = (showRunId) => path.join(map, veilig(showRunId));
  const bestand = (showRunId, characterId) => path.join(runMap(showRunId), `${veilig(characterId)}.jpg`);

  function zet({ showRunId, characterId, jpeg, punten }) {
    if (!showRunId || !characterId) return { ok: false, error: "run_of_personage_ontbreekt" };
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
    return { ok: true, characterId: String(characterId), at };
  }

  function van(showRunId, characterId) {
    if (!showRunId || !characterId) return null;
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

  return { zet, van, reset: () => geheugen.clear(), map };
}

module.exports = { createPersonagefoto };
