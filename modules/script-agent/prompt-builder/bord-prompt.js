"use strict";

// Een situatie met de schakelaar Blind ranking aan krijgt dit blok achter de situatietekst, zodat
// het team het spel niet in elke situatie hoeft uit te leggen. De regels worden uit de tekst
// gehaald en sturen het bord op het zaalscherm (teleprompter-parser/src/domain/bord.js).
const { isBlindRanking, plaatjesNamen } = require("../../../shared/blind-ranking/blind-ranking");

const BORD_REGIE = [
  "Bord:",
  "- Zet op een eigen regel [PLAATJE: naam] vlak vóór de eerste regel over dat plaatje; daar komt het in beeld.",
  "- Zet op een eigen regel [PLEK: cijfer] direct ná de regel waarin het plaatje op die plek gezet wordt.",
  "- Gebruik de namen precies zoals hieronder, in die volgorde, en elke plek één keer.",
].join("\n");

function bordRegieVoor(situation) {
  if (!isBlindRanking(situation)) return "";
  const namen = plaatjesNamen(situation);
  return namen.length ? `${BORD_REGIE}\nPlaatjes: ${namen.join(", ")}` : BORD_REGIE;
}

module.exports = { bordRegieVoor, BORD_REGIE };
