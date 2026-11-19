"use strict";

// De telefoonpagina op /audience/kijk is het kijkvenster van de operator. De pagina zelf is dezelfde
// als op de telefoons; een verzoek of verbinding is te herkennen aan de pagina waar hij vandaan komt.
// Een kijkvenster heeft geen QR nodig, telt niet als publiek en kan niets insturen.
const KIJK_PATH = "/audience/kijk";

function isKijkvenster(req) {
  const referer = String(req && req.headers && (req.headers.referer || req.headers.referrer) || "");
  if (!referer) return false;
  try {
    return new URL(referer).pathname.replace(/\/+$/, "") === KIJK_PATH;
  } catch {
    return false;
  }
}

module.exports = { KIJK_PATH, isKijkvenster };
