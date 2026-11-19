"use strict";

// Scène met een lange intro: in The Voice of Holland klinkt eerst de intro, pas daarna valt de eerste
// zin. Het script krijgt daarom vooraan de regieregel *intro*, zodat de eerste zin niet al die tijd
// in beeld staat. De klikker gaat na de intro naar de eerste zin. Hernoem je de omgeving, pas dan
// INTRO_OMGEVING_RE aan.

const INTRO_OMGEVING_RE = /^\s*the voice of holland\s*$/i;
const INTRO_REGEL = "*intro*";

function isIntroOmgeving(environment) {
  return INTRO_OMGEVING_RE.test(String(environment && (environment.name || environment.title) || ""));
}

function metIntroRegel(promptInput, scriptText) {
  const tekst = String(scriptText || "");
  if (!tekst.trim() || !isIntroOmgeving(promptInput && promptInput.environment)) return tekst;
  const eerste = tekst.split("\n").map((regel) => regel.trim()).find(Boolean) || "";
  if (/^[*\[(]+\s*intro\s*[*\])]+$/i.test(eerste)) return tekst;
  return `${INTRO_REGEL}\n${tekst.replace(/^\s+/, "")}`;
}

module.exports = {
  INTRO_OMGEVING_RE,
  INTRO_REGEL,
  isIntroOmgeving,
  metIntroRegel,
};
