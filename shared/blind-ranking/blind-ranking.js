"use strict";

// Blind ranking per situatie: een schakelaar en vijf plaatjes (naam + beeld).
// Staat in het situatierecord van de catalogus als `blindRanking`, zodat het met de
// catalogus meereist (website -> show-Mac). Het beeld is een media-asset (rol fxImage,
// tag "bord-plaatje") bij de omgeving van de situatie.

const PLEKKEN = 5;
const BORD_PLAATJE_TAG = "bord-plaatje";
const MAX_NAAM = 60;

function tekst(value, max) {
  return String(value == null ? "" : value).replace(/\s+/g, " ").trim().slice(0, max);
}

function normalizeBlindRanking(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const plaatjes = (Array.isArray(value.plaatjes) ? value.plaatjes : [])
    .slice(0, PLEKKEN)
    .map((item) => ({
      naam: tekst(item && item.naam, MAX_NAAM),
      assetId: tekst(item && item.assetId, 200),
    }));
  while (plaatjes.length < PLEKKEN) plaatjes.push({ naam: "", assetId: "" });
  return { aan: value.aan === true, plaatjes };
}

function isBlindRanking(situation) {
  return !!(situation && situation.blindRanking && situation.blindRanking.aan === true);
}

// De namen die ingevuld zijn, in volgorde.
function plaatjesNamen(situation) {
  if (!isBlindRanking(situation)) return [];
  return situation.blindRanking.plaatjes.map((item) => tekst(item && item.naam, MAX_NAAM)).filter(Boolean);
}

// Zelfde schrijfwijze als het bord gebruikt voor de bestandsnaam: "Eva Braun" -> "eva-braun".
function plaatjeSlug(naam) {
  return String(naam || "")
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

module.exports = {
  BORD_PLAATJE_TAG,
  PLEKKEN,
  isBlindRanking,
  normalizeBlindRanking,
  plaatjeSlug,
  plaatjesNamen,
};
