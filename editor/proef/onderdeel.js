"use strict";

// Start één onderdeel van de proefshow: node onderdeel.js <naam>. De instellingen (poort, map met
// gegevens, adressen van de andere onderdelen) komen uit de omgeving die proefshow.js meegeeft.

const naam = process.argv[2];
const APP = "../../modules";

// Apparaten bestaan niet in de proef: elke opdracht aan licht, geluid, camera's, de deck of
// TouchDesigner wordt meteen als gelukt beantwoord.
async function nagespeeld(action, options = {}) {
  if (options.nonBlocking || action.ackMode === "fire-and-forget") {
    return { stage: "sent", state: "pending", message: "proef: verstuurd", warning: false };
  }
  return { stage: action.ackMode === "required-ready" ? "loaded" : "applied", state: "ok", message: "proef: nagespeeld", warning: false };
}

if (naam === "algorithm") require(`${APP}/algorithm/server/server.js`).startAlgorithmServer();
else if (naam === "runtime") require(`${APP}/runtime/server/server.js`).startRuntimeServer();
else if (naam === "audience") require(`${APP}/audience/server/server.js`).startAudienceServer();
else if (naam === "script-agent") require(`${APP}/script-agent/server/server.js`).startScriptAgentServer();
else if (naam === "show-control") {
  const adapters = {};
  for (const doel of ["sq5", "camera", "dmx", "touchdesigner", "streamdeck", "perfectcue", "keyboard", "macaudio"]) adapters[doel] = nagespeeld;
  require(`${APP}/show-control/server/server.js`).startShowControlServer({ adapters, vanzelfTickMs: 0 });
} else {
  process.stderr.write(`proef: onbekend onderdeel ${naam}\n`);
  process.exit(2);
}
