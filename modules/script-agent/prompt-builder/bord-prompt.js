"use strict";

// Omgevingen met een bord 1 t/m 5 krijgen dit blok achter de situatietekst, zodat het team het
// niet in elke situatie hoeft te zetten. De regels worden uit de tekst gehaald en sturen het
// bord op het zaalscherm (teleprompter-parser/src/domain/bord.js).
const BORD_OMGEVING_RE = /blind\s*ranking/i;

const BORD_REGIE = [
  "Bord:",
  "- Zet op een eigen regel [PLAATJE: naam] op het moment dat een plaatje in beeld komt.",
  "- Zet op een eigen regel [PLEK: cijfer] op het moment dat het plaatje op een plek gezet wordt.",
  "- Gebruik de namen precies zoals in de situatie, in die volgorde, en elke plek één keer.",
].join("\n");

function bordRegieVoor(environmentName) {
  return BORD_OMGEVING_RE.test(String(environmentName || "")) ? BORD_REGIE : "";
}

module.exports = { bordRegieVoor, BORD_REGIE };
