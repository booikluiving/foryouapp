"use strict";

// Extra shot en extra geluid per omgeving.
// Staat in het omgevingsrecord van de catalogus als `extras`, zodat het met de
// catalogus meereist (website <-> show-Mac). Het team vult het in; de Stream Deck
// toont het label van de actieve omgeving en vuurt de actie af via Show Control.

const ENVIRONMENT_EXTRAS_SCHEMA_VERSION = "catalog.environment-extras.v0";

const EXTRA_KINDS = Object.freeze(["shot", "geluid"]);

// shot.bron: wat er in beeld komt
//   "achtergrond" = de achtergrond van de omgeving, schermvullend
//   "bestand"     = een eigen beeld of video (media-asset met rol extraShot)
//   "camera"      = schakel naar camera 1, 2 of 3
// geluid.bron:
//   "bestand"     = een eigen geluid (media-asset met rol extraGeluid)
const SHOT_SOURCES = Object.freeze(["", "achtergrond", "bestand", "camera"]);
const SOUND_SOURCES = Object.freeze(["", "bestand"]);

const DEFAULT_SHOT_SECONDS = 4;
const MAX_SHOT_SECONDS = 120;
const MAX_LABEL_LENGTH = 24;
const MAX_DESCRIPTION_LENGTH = 400;

function text(value, max) {
  const result = String(value == null ? "" : value).replace(/\r/g, "").trim();
  return max ? result.slice(0, max) : result;
}

function clampNumber(value, min, max, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, number));
}

function normalizeShot(input) {
  const source = input && typeof input === "object" ? input : {};
  const bron = SHOT_SOURCES.includes(text(source.bron)) ? text(source.bron) : "";
  const camera = Math.round(clampNumber(source.camera, 1, 3, 1));
  return {
    label: text(source.label, MAX_LABEL_LENGTH),
    omschrijving: text(source.omschrijving, MAX_DESCRIPTION_LENGTH),
    bron,
    bestand: bron === "bestand" ? text(source.bestand, 300) : "",
    camera: bron === "camera" ? camera : null,
    duur: clampNumber(source.duur, 0, MAX_SHOT_SECONDS, DEFAULT_SHOT_SECONDS),
  };
}

function normalizeSound(input) {
  const source = input && typeof input === "object" ? input : {};
  const bron = SOUND_SOURCES.includes(text(source.bron)) ? text(source.bron) : "";
  return {
    label: text(source.label, MAX_LABEL_LENGTH),
    omschrijving: text(source.omschrijving, MAX_DESCRIPTION_LENGTH),
    bron,
    bestand: bron === "bestand" ? text(source.bestand, 300) : "",
    volume: clampNumber(source.volume, 0, 1, 1),
  };
}

function normalizeEnvironmentExtras(input) {
  const source = input && typeof input === "object" ? input : {};
  return {
    schemaVersion: ENVIRONMENT_EXTRAS_SCHEMA_VERSION,
    shot: normalizeShot(source.shot),
    geluid: normalizeSound(source.geluid),
  };
}

function isEmptyExtra(extra) {
  return !extra || (!extra.label && !extra.omschrijving && !extra.bron);
}

// Wat er gebeurt als je drukt, in woorden (voor editor en deck-status).
function describeAction(kind, extra) {
  if (!extra || !extra.bron) return "";
  if (kind === "shot") {
    if (extra.bron === "camera") return `Schakelt naar camera ${extra.camera || 1}.`;
    const wat = extra.bron === "achtergrond" ? "de achtergrond van deze omgeving" : "het gekozen beeld";
    return extra.duur > 0
      ? `Toont ${wat} schermvullend, ${extra.duur} s.`
      : `Toont ${wat} schermvullend tot je opnieuw drukt.`;
  }
  return "Speelt het gekozen geluid af via de SQ-5.";
}

module.exports = {
  DEFAULT_SHOT_SECONDS,
  ENVIRONMENT_EXTRAS_SCHEMA_VERSION,
  EXTRA_KINDS,
  MAX_LABEL_LENGTH,
  SHOT_SOURCES,
  SOUND_SOURCES,
  describeAction,
  isEmptyExtra,
  normalizeEnvironmentExtras,
  normalizeShot,
  normalizeSound,
};
