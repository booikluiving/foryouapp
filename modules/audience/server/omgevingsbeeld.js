"use strict";

// Omgevingsbeeld voor het kaartje in for_youniverse op de telefoon: hetzelfde beeld en dezelfde uitsnede
// als het vakje op het zaalscherm (paths/universe/omgevingsbeeld.json + beeld uit de catalogus), maar
// klein (± 30 kB) en als JPEG. Elk beeld wordt één keer verkleind en in het geheugen bewaard.
// Welke omgevingen het publiek mag zien, bepaalt universum.js (alleen gespeeld, nu en gekozen).

const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFile } = require("node:child_process");
const { beeldenPerOmgeving } = require("../../paths/universe/build-runtime-overlay");

const LIJST_VERS_MS = 5 * 60 * 1000;
const LIJST_OPNIEUW_MS = 30 * 1000;
const BREED = 520; // langste zijde in pixels
const MAX_IN_GEHEUGEN = 40;

function catalogusAdres() {
  return String(process.env.AUDIENCE_CATALOG_URL || "http://127.0.0.1:3021").replace(/\/+$/, "");
}

function keuzeBestand() {
  try {
    return JSON.parse(fs.readFileSync(path.resolve(__dirname, "../../paths/universe/omgevingsbeeld.json"), "utf8"));
  } catch (_err) {
    return {};
  }
}

function sipsUit(sips, args) {
  return new Promise((resolve) => {
    execFile(sips, args, { timeout: 15000 }, (err, stdout) => resolve(err ? null : String(stdout || "")));
  });
}

function createOmgevingsbeeld({ fetchImpl = globalThis.fetch, sips = process.env.AUDIENCE_SIPS || "/usr/bin/sips", log = () => {}, opNieuweLijst = () => {} } = {}) {
  const lijst = { at: 0, poging: 0, bezig: null, perOmgeving: new Map() };
  const beelden = new Map(); // sleutel → Promise<{ jpeg, at } | null>

  function laadLijst() {
    const nu = Date.now();
    if (lijst.bezig) return lijst.bezig;
    if (lijst.at && nu - lijst.at < LIJST_VERS_MS) return Promise.resolve();
    if (nu - lijst.poging < LIJST_OPNIEUW_MS) return Promise.resolve();
    lijst.poging = nu;
    lijst.bezig = Promise.resolve()
      .then(() => fetchImpl(`${catalogusAdres()}/v0/catalog/media-assets`, { signal: AbortSignal.timeout(6000) }))
      .then((res) => (res && res.ok ? res.json() : null))
      .then((payload) => {
        if (!payload || !Array.isArray(payload.mediaAssets)) return;
        const vorige = JSON.stringify([...lijst.perOmgeving]);
        lijst.perOmgeving = beeldenPerOmgeving(payload, keuzeBestand());
        lijst.at = Date.now();
        // Andere beelden (of de eerste keer): de telefoons krijgen de adressen opnieuw.
        if (JSON.stringify([...lijst.perOmgeving]) !== vorige) { try { opNieuweLijst(); } catch (_err) {} }
      })
      .catch(() => {})
      .finally(() => { lijst.bezig = null; });
    return lijst.bezig;
  }

  // Wat de telefoon in het adres zet (?v=): verandert als het team een ander beeld of andere uitsnede kiest.
  function versie(environmentId) {
    laadLijst();
    const keuze = lijst.perOmgeving.get(String(environmentId || ""));
    if (!keuze || keuze.soort === "video") return "";
    return crypto.createHash("sha1").update(`${keuze.beeld}|${keuze.uitsnede}`).digest("hex").slice(0, 10);
  }

  async function verklein(bron, uitsnede) {
    let map;
    try { map = fs.mkdtempSync(path.join(os.tmpdir(), "fy-omgeving-")); } catch { return null; }
    const ruw = path.join(map, "ruw");
    const deel = path.join(map, "deel.jpg");
    const klein = path.join(map, "klein.jpg");
    try {
      fs.writeFileSync(ruw, bron);
      let invoer = ruw;
      // links / midden: een derde van de achtergrond (de achtergrond is drie camera's breed).
      if (uitsnede === "links" || uitsnede === "midden") {
        const maat = await sipsUit(sips, ["-g", "pixelWidth", "-g", "pixelHeight", ruw]);
        const breed = Number((/pixelWidth:\s*(\d+)/.exec(maat || "") || [])[1]);
        const hoog = Number((/pixelHeight:\s*(\d+)/.exec(maat || "") || [])[1]);
        if (breed > 0 && hoog > 0) {
          const derde = Math.floor(breed / 3);
          const gelukt = await sipsUit(sips, ["-c", String(hoog), String(derde), "--cropOffset", "0", String(uitsnede === "links" ? 0 : derde), ruw, "--out", deel]);
          if (gelukt !== null && fs.existsSync(deel)) invoer = deel;
        }
      }
      const gelukt = await sipsUit(sips, ["-s", "format", "jpeg", "-s", "formatOptions", "60", "-Z", String(BREED), invoer, "--out", klein]);
      if (gelukt === null) return null;
      const buf = fs.readFileSync(klein);
      return buf.length > 100 ? buf : null;
    } catch {
      return null;
    } finally {
      try { fs.rmSync(map, { recursive: true, force: true }); } catch {}
    }
  }

  // Het kleine beeld van een omgeving, of null (geen beeld, video, catalogus weg).
  async function beeld(environmentId) {
    await laadLijst();
    const id = String(environmentId || "");
    const keuze = lijst.perOmgeving.get(id);
    if (!keuze || keuze.soort === "video" || !keuze.beeld) return null;
    const sleutel = `${id}|${keuze.beeld}|${keuze.uitsnede}`;
    if (!beelden.has(sleutel)) {
      const klaar = (async () => {
        try {
          const res = await fetchImpl(`${catalogusAdres()}${keuze.beeld}`, { signal: AbortSignal.timeout(15000) });
          if (!res || !res.ok) return null;
          const bron = Buffer.from(await res.arrayBuffer());
          const jpeg = await verklein(bron, keuze.uitsnede);
          if (jpeg) log(`omgevingsbeeld: ${id} ${keuze.uitsnede} ${Math.round(jpeg.length / 1024)} kB`);
          return jpeg ? { jpeg, at: Date.now() } : null;
        } catch {
          return null;
        }
      })();
      beelden.set(sleutel, klaar);
      // Mislukt: niet bewaren, de volgende vraag probeert het opnieuw.
      klaar.then((uit) => { if (!uit) beelden.delete(sleutel); });
      while (beelden.size > MAX_IN_GEHEUGEN) beelden.delete(beelden.keys().next().value);
    }
    return beelden.get(sleutel);
  }

  return { laadLijst, versie, beeld };
}

// /audience/public/omgevingsbeeld/:nr — alleen een omgeving die het publiek al mag zien.
function omgevingsbeeldRoute(service, magKijken) {
  return async (req, res) => {
    try {
      if (typeof magKijken === "function" && !magKijken(req)) {
        res.status(403).set("Cache-Control", "no-store").type("text").send("Geen toegang");
        return;
      }
      const nr = Number(req.params.nr);
      const id = Number.isInteger(nr) && nr > 0 ? `environment:${nr}` : "";
      const mag = id && service.universum && service.universum.omgevingZichtbaar(id);
      const foto = mag && service.omgevingsbeeld ? await service.omgevingsbeeld.beeld(id) : null;
      if (!foto) {
        res.status(404).set("Cache-Control", "no-store").type("text").send("Niet gevonden");
        return;
      }
      res.set({ "Content-Type": "image/jpeg", "Cache-Control": "private, max-age=86400", "X-Content-Type-Options": "nosniff" });
      res.send(foto.jpeg);
    } catch (_err) {
      res.status(500).set("Cache-Control", "no-store").type("text").send("Er ging iets mis");
    }
  };
}

module.exports = { createOmgevingsbeeld, omgevingsbeeldRoute };
