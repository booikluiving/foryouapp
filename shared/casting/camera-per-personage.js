"use strict";

// Welke camera een personage in beeld brengt, als dat niet de camera van zijn plek is (twee spelers
// samen op één camera), en een vaste foto per personage voor het stemmen als het camerabeeld niet
// klopt. Bron: camera-per-personage.json naast dit bestand.

const fs = require("node:fs");
const path = require("node:path");

const BESTAND = path.join(__dirname, "camera-per-personage.json");

// "character:19", "19" en 19 zijn hetzelfde.
function sleutel(soort, waarde) {
  if (waarde && typeof waarde === "object") waarde = waarde.id || waarde.legacyId;
  const tekst = String(waarde == null ? "" : waarde).trim();
  if (!tekst) return "";
  return tekst.includes(":") ? tekst : `${soort}:${tekst}`;
}

let cache = null;
function lees() {
  try {
    const stat = fs.statSync(BESTAND);
    if (cache && cache.mtimeMs === stat.mtimeMs) return cache.data;
    const data = JSON.parse(fs.readFileSync(BESTAND, "utf8"));
    cache = { mtimeMs: stat.mtimeMs, data };
    return data;
  } catch (_err) {
    return { camera: [], foto: {} };
  }
}

// Camera (1–3) voor een personage in een scène; zonder regel de camera van de plek.
function cameraVoor({ omgeving, situatie, personage, plek } = {}) {
  const eigen = Number(plek) || 0;
  const o = sleutel("environment", omgeving);
  const s = sleutel("situation", situatie);
  const p = sleutel("character", personage);
  if (!p) return eigen;
  for (const regel of lees().camera || []) {
    if (sleutel("character", regel.personage) !== p) continue;
    if (regel.omgeving && sleutel("environment", regel.omgeving) !== o) continue;
    if (Array.isArray(regel.nietIn) && s && regel.nietIn.some((id) => sleutel("situation", id) === s)) continue;
    const camera = Number(regel.camera);
    if (camera >= 1 && camera <= 3) return camera;
  }
  return eigen;
}

// Pad naar de vaste foto (JPEG) van een personage, of "".
function vasteFoto(personage) {
  const p = sleutel("character", personage);
  const naam = p ? (lees().foto || {})[p] : "";
  if (!naam) return "";
  const pad = path.resolve(__dirname, naam);
  return fs.existsSync(pad) ? pad : "";
}

module.exports = { cameraVoor, vasteFoto, BESTAND };
