"use strict";

// Bord 1 t/m 5 (blind ranking). Het script zet op eigen regels [PLAATJE: naam] en [PLEK: cijfer].
// Die regels komen niet op de teleprompter; ze hangen aan de eerstvolgende gesproken regel en
// gaan af zodra de speler daar is. Wat het script vergeet of fout doet, wordt hier rechtgezet,
// zodat het bord altijd klopt: elk plaatje krijgt precies één plek en elke plek één plaatje.

const PLEKKEN = 5;
const PLAATJE_RE = /^[\[(*\s]*plaatje\s*:\s*(.+?)[\])*\s]*$/i;
const PLEK_RE = /^[\[(*\s]*plek\s*:\s*(\d+)[\])*\s]*$/i;

function leesBordregel(line) {
  const text = String(line || "").trim();
  let match = text.match(PLAATJE_RE);
  if (match) return { soort: "plaatje", naam: match[1].trim() };
  match = text.match(PLEK_RE);
  if (match) return { soort: "plek", plek: Number(match[1]) };
  return null;
}

function maakBord() {
  const bezet = new Array(PLEKKEN).fill(null);
  const namen = [];
  let open = null;

  const vrij = () => bezet.indexOf(null) + 1;

  function plaats(gevraagd) {
    if (!open) return null;
    const plek = gevraagd >= 1 && gevraagd <= PLEKKEN && !bezet[gevraagd - 1] ? gevraagd : vrij();
    if (!plek) return null;
    const stap = { soort: "plek", plek, naam: open };
    bezet[plek - 1] = open;
    open = null;
    return stap;
  }

  // Geeft de stappen terug die bij deze bordregel horen (soms twee: eerst het vorige plaatje wegzetten).
  function verwerk(regel) {
    const stappen = [];
    if (regel.soort === "plaatje") {
      if (!regel.naam || namen.includes(regel.naam) || namen.length >= PLEKKEN) return stappen;
      const eerst = plaats(0);
      if (eerst) stappen.push(eerst);
      namen.push(regel.naam);
      open = regel.naam;
      stappen.push({ soort: "plaatje", naam: regel.naam });
    } else if (regel.soort === "plek") {
      const stap = plaats(regel.plek);
      if (stap) stappen.push(stap);
    }
    return stappen;
  }

  function sluit() {
    const stap = plaats(0);
    return stap ? [stap] : [];
  }

  return { verwerk, sluit, namen: () => namen.slice() };
}

module.exports = { leesBordregel, maakBord, PLEKKEN };
