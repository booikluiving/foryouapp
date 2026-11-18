"use strict";

// Trendscène: een situatie in de omgeving Trend. Die is puur beeld: geen tekst van de Script Agent,
// alleen de emoji uit de situatietekst. Elke druk op de klikker is één emoji verder; de druk na de
// laatste emoji eindigt de scène. Hernoem je de omgeving, pas dan TREND_OMGEVING_RE aan (ook in
// live-captions-app.js).

const TREND_OMGEVING_RE = /^\s*trend\s*$/i;

function isTrendOmgeving(environment) {
  return TREND_OMGEVING_RE.test(String(environment && (environment.name || environment.title) || ""));
}

// De emoji in de volgorde van de tekst, met hun variatieteken (🕊️ blijft 🕊️).
function trendEmoji(tekst) {
  const bron = String(tekst || "");
  const uit = [];
  const segmenter = new Intl.Segmenter("nl", { granularity: "grapheme" });
  for (const { segment } of segmenter.segment(bron)) {
    if (/\p{Extended_Pictographic}/u.test(segment)) uit.push(segment);
  }
  return uit;
}

// Het vaste script: per emoji één regel (een regieregel; het hoofdscherm toont in Trend geen tekst).
function trendScript(promptInput = {}) {
  const situation = promptInput.situation || {};
  const emoji = trendEmoji(situation.promptText || promptInput.promptText || "");
  return {
    emoji,
    scriptText: emoji.map((teken) => `*${teken}*`).join("\n"),
  };
}

module.exports = {
  TREND_OMGEVING_RE,
  isTrendOmgeving,
  trendEmoji,
  trendScript,
};
