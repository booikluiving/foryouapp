"use strict";

// Autocam: bij elke regel gaat de camera naar wie er spreekt, via show control (td.camera.set), en
// aan/uit blijft bewaard na een herstart. Show control is nagebootst; er gaat niets naar de echte diensten.

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const express = require("express");
const { mountTeleprompterParser } = require("../teleprompter-parser/src/integration/express-router");
const { stuurAutocamCamera } = require("../teleprompter-parser/src/integration/autocam-camera");

const map = fs.mkdtempSync(path.join(os.tmpdir(), "autocam-test-"));
const bestand = path.join(map, "teleprompter-autocam.json");
const verstuurd = [];
const nepFetch = async (url, opts) => {
  verstuurd.push({ url, body: JSON.parse(opts.body) });
  return { ok: true, status: 200 };
};
const scene = {
  sceneId: 96,
  status: "playing",
  characters: [{ name: "Ada", slot: 1 }, { name: "Bo", slot: 2 }, { name: "Cas", slot: 3 }],
};
const wacht = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function start() {
  const app = express();
  app.use(express.json());
  mountTeleprompterParser(app, {
    express,
    autoCameraPath: bestand,
    captionStylePath: path.join(map, "caption.json"),
    getShowState: () => ({ active: true }),
    getAutoCameraScene: () => scene,
    onAutoCameraSwitch: (event) => stuurAutocamCamera(event.slot, { fetchImpl: nepFetch, source: event.source }),
  });
  const server = await new Promise((resolve) => { const s = app.listen(0, "127.0.0.1", () => resolve(s)); });
  const basis = `http://127.0.0.1:${server.address().port}`;
  const post = async (pad, body) => (await fetch(basis + pad, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) })).json();
  const get = async (pad) => (await fetch(basis + pad)).json();
  return { server, post, get };
}

const camerasNa = (vanaf) => verstuurd.slice(vanaf).map((v) => Number(v.body.actions[0].payload.camera));

(async () => {
  // Zonder bewaarde stand staat de autocam uit.
  let dienst = await start();
  assert.equal((await dienst.get("/api/teleprompter-parser/current")).autoCameraSwitch.enabled, false, "standaard uit");

  await dienst.post("/admin/teleprompter-parser/parse", { rawText: "Ada: hoi\nBo: hallo\nBo: nog iets\nCas: daag", sceneId: 96 });
  const aantal = (await dienst.get("/api/teleprompter-parser/current")).teleprompt.lines.length;

  // Uit: geen wissel.
  for (let i = 1; i <= aantal; i += 1) await dienst.post("/api/teleprompter-parser/cue", { index: i });
  await wacht(20);
  assert.equal(verstuurd.length, 0, "uit: er gaat niets naar show control");
  console.log("ok: uit stuurt niets");

  // Aan: de camera volgt de spreker; dezelfde spreker twee keer = één wissel.
  const aan = await dienst.post("/admin/teleprompter-parser/auto-camera", { enabled: true });
  assert.equal(aan.autoCameraSwitch.enabled, true);
  assert.equal(JSON.parse(fs.readFileSync(bestand, "utf8")).enabled, true, "aan is bewaard");
  await dienst.post("/api/teleprompter-parser/cue", { index: 0 });
  for (let i = 1; i <= aantal; i += 1) await dienst.post("/api/teleprompter-parser/cue", { index: i });
  await wacht(20);
  assert.deepEqual(camerasNa(0), [1, 2, 3], "camera volgt Ada, Bo, Cas");
  const eerste = verstuurd[0];
  assert.equal(eerste.url, "http://127.0.0.1:3025/v0/show-control/cues", "via show control");
  assert.match(eerste.body.name, /^Teleprompter autocam/, "naam begint met Teleprompter (bron uit de zaal)");
  assert.equal(eerste.body.actions.length, 1);
  assert.equal(eerste.body.actions[0].command, "td.camera.set", "zelfde opdracht als CAM 1/2/3");
  assert.deepEqual(eerste.body.actions[0].payload, { camera: "1", cameraId: "camera:1", source: "autocam", cueIntent: "camera_trigger" });
  console.log("ok: aan volgt de spreker via show control");

  // Herstart: de stand blijft aan.
  dienst.server.close();
  dienst = await start();
  assert.equal((await dienst.get("/api/teleprompter-parser/current")).autoCameraSwitch.enabled, true, "na herstart nog aan");
  console.log("ok: aan blijft na herstart");

  // Uit, herstart: blijft uit.
  await dienst.post("/admin/teleprompter-parser/auto-camera", { enabled: false });
  dienst.server.close();
  dienst = await start();
  assert.equal((await dienst.get("/api/teleprompter-parser/current")).autoCameraSwitch.enabled, false, "na herstart nog uit");
  console.log("ok: uit blijft na herstart");

  // Een onbekende plek stuurt niets; show control onbereikbaar laat de teleprompter niet vallen.
  assert.equal(stuurAutocamCamera(0, { fetchImpl: nepFetch }).sent, false);
  const stil = { warn: () => {} };
  assert.equal(stuurAutocamCamera(2, { fetchImpl: async () => { throw new Error("weg"); }, log: stil }).sent, true);
  await wacht(20);
  console.log("ok: fouten blijven binnen");

  dienst.server.close();
  fs.rmSync(map, { recursive: true, force: true });
  console.log("autocam-test: alles ok");
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
