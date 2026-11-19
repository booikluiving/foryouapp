"use strict";

// Autocam: bij elke regel gaat de camera naar wie er spreekt. De wissel gaat via show control als
// td.camera.set, dezelfde weg als CAM 1/2/3 op de Stream Deck. De naam begint met "Teleprompter":
// dat is een bron uit de zaal, die werkt altijd, ook als iemand de regie heeft.

const DEFAULT_SHOW_CONTROL_URL = "http://127.0.0.1:3025";
const CAMERA_ACK_MS = 1200;
const VERZEND_MS = 2500;

function cameraNummer(slot) {
  const nummer = Number.parseInt(String(slot), 10);
  return nummer >= 1 && nummer <= 3 ? nummer : 0;
}

function showControlUrl(env = process.env) {
  const basis = String(env.SCRIPT_AGENT_SHOW_CONTROL_URL || env.SHOW_CONTROL_URL || DEFAULT_SHOW_CONTROL_URL).trim();
  return (basis || DEFAULT_SHOW_CONTROL_URL).replace(/\/+$/, "");
}

function autocamCue(nummer) {
  const camera = String(nummer);
  return {
    name: `Teleprompter autocam CAM ${camera}`,
    actions: [{
      command: "td.camera.set",
      ackMode: "acknowledged-async",
      timeoutMs: CAMERA_ACK_MS,
      payload: { camera, cameraId: `camera:${camera}`, source: "autocam", cueIntent: "camera_trigger" },
    }],
  };
}

// Stuurt de wissel en wacht er niet op: de teleprompter loopt door, ook als show control traag is.
function stuurAutocamCamera(slot, options = {}) {
  const nummer = cameraNummer(slot);
  const reden = String(options.source || "teleprompter_auto_camera").slice(0, 120);
  if (!nummer) return { sent: false, reason: "camera_onbekend", source: reden };
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  const log = options.log || console;
  const url = `${showControlUrl(options.env)}/v0/show-control/cues`;
  Promise.resolve()
    .then(() => fetchImpl(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(autocamCue(nummer)),
      signal: AbortSignal.timeout(VERZEND_MS),
    }))
    .then((res) => {
      if (res && res.ok === false) log.warn(`Autocam: show control antwoordde ${res.status} op CAM ${nummer}`);
    })
    .catch((err) => log.warn(`Autocam: CAM ${nummer} niet verstuurd: ${err && err.message ? err.message : err}`));
  return { sent: true, camera: nummer, doel: "show-control", source: reden };
}

module.exports = {
  autocamCue,
  stuurAutocamCamera,
};
