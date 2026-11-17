"use strict";

// Het camerabeeld van een speler spiegelen of laten wegfaden (cue td.effect.speler).
// Staat bij de stappen van de scène (omvallen-situation_<nr>.json of omvallen.json):
// - "spelers": [{ "camera": 3, "spiegel": true }]  geldt vanaf het begin van de scène;
// - bij een stap: "speler": { "camera": 1, "zichtbaar": false, "fade": 0.5 }  (of een lijst)
//   de speler fadet weg of komt terug op het moment van die stap.
// Naar TouchDesigner gaan twee codes van drie tekens, één teken per camera:
// "1" = aan, "0" = uit, "-" = laten zoals het is. Plus de duur van de fade in seconden.

const STANDAARD_FADE = 0.5;

function lijst(waarde) {
  if (Array.isArray(waarde)) return waarde.filter((item) => item && typeof item === "object");
  return waarde && typeof waarde === "object" ? [waarde] : [];
}

function code(items, veld) {
  const tekens = ["-", "-", "-"];
  for (const item of items) {
    const camera = Number(item.camera);
    if (![1, 2, 3].includes(camera) || typeof item[veld] !== "boolean") continue;
    tekens[camera - 1] = item[veld] ? "1" : "0";
  }
  return tekens.join("");
}

// Payload voor td.effect.speler, of null als er niets te doen is.
function spelerPayload(waarde, extra = {}) {
  const items = lijst(waarde);
  const spiegel = code(items, "spiegel");
  const zichtbaar = code(items, "zichtbaar");
  if (spiegel === "---" && zichtbaar === "---") return null;
  const fades = items.map((item) => Number(item.fade)).filter((fade) => Number.isFinite(fade) && fade >= 0);
  return { ...extra, spiegel, zichtbaar, fade: fades.length ? Math.max(...fades) : STANDAARD_FADE };
}

// Heeft een stap van deze scène een speler laten wegfaden, dan zet BEGIN iedereen terug.
function spelerTerugPayload(manifest, extra = {}) {
  const drukken = manifest && Array.isArray(manifest.drukken) ? manifest.drukken : [];
  const geraakt = drukken.flatMap((druk) => lijst(druk && druk.speler)).filter((item) => typeof item.zichtbaar === "boolean");
  if (!geraakt.length) return null;
  return spelerPayload(geraakt.map((item) => ({ camera: item.camera, zichtbaar: true })), { ...extra, fade: 0 });
}

// Actie die bij het starten van een scène meegaat; null als de scène geen "spelers" heeft.
// TouchDesigner zet bij elke nieuwe omgeving alle spelers terug (zichtbaar, niet gespiegeld);
// deze actie komt daar kort na.
function spelerStartAction(manifest, extra = {}) {
  const payload = spelerPayload(manifest && manifest.spelers, { ...extra, cueIntent: "scene_start_spelers" });
  if (!payload) return null;
  return {
    command: "td.effect.speler",
    targetId: "touchdesigner",
    ackMode: "fire-and-forget",
    delayMs: 400,
    timeoutMs: 900,
    payload: { ...payload, fade: 0 },
  };
}

module.exports = {
  spelerPayload,
  spelerStartAction,
  spelerTerugPayload,
};
