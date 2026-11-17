"use strict";

// Eén beeld met de spelers erin (trolleyprobleem): plaats van de camera's per uitsnede, de
// shotknop als overzicht, cameraknoppen als uitsnede dichtbij, stappen (de tram) in dat beeld.
// Geen netwerk, geen catalogus, geen TouchDesigner.

const assert = require("node:assert/strict");
const beeld = require("../cue-library/environment-beeld");
const { oscArgsForAction } = require("../target-adapters/touchdesigner-adapter");
const { buildEnvironmentExtraCue, environmentExtrasStatus } = require("../cue-library/environment-extras");
const { sceneEindeActions } = require("../cue-library/scene-einde");

const kader = { kopX: 0.5, kopBreedte: 0.32, nekY: 0.48 };
const manifest = {
  dir: "/media/environments/environment_30/beeld",
  label: "OVERZICHT",
  spelers: [
    { camera: 1, nek: [2526, 538], kop: 72, draai: 30, lijf: 167, kader },
    { camera: 2, nek: [1576, 148], kop: 72, draai: 0, lijf: 142, kader },
    { camera: 3, nek: [2386, 1107], kop: 73, draai: 30, lijf: 170, kader },
  ],
  uitsnedes: {
    overzicht: { x: 0, y: -1827, breedte: 3000 },
    1: { x: 2255, y: 290, breedte: 470 },
    2: { x: 1330, y: -60, breedte: 470 },
    3: { x: 2130, y: 860, breedte: 470 },
  },
};
const options = { beeld: manifest, fileExists: () => true, now: 1000 };

// Narekenen zoals TouchDesigner het doet: eerst omlaag schuiven (afsnijden), dan schalen en draaien
// om het midden, dan verschuiven. De nek van de speler moet op zijn plek in de plaat uitkomen.
function nekOpScherm(speler, plaats) {
  const W = 1080, H = 1920;
  let x = speler.kader.kopX * W - W / 2;
  let y = speler.kader.nekY * H + plaats.snij * H - H / 2;
  x *= plaats.schaal; y *= plaats.schaal;
  const hoek = (-plaats.draai * Math.PI) / 180;            // draai is tegen de klok in; y loopt omlaag
  const rx = Math.cos(hoek) * x - Math.sin(hoek) * y;
  const ry = Math.sin(hoek) * x + Math.cos(hoek) * y;
  return { x: rx + W / 2 + plaats.tx * W, y: ry + H / 2 - plaats.ty * H };
}
for (const naam of ["overzicht", "1", "2", "3"]) {
  const uitsnede = manifest.uitsnedes[naam];
  const k = 1080 / uitsnede.breedte;
  for (const speler of manifest.spelers) {
    const plaats = beeld.plaatsSpeler(speler, uitsnede);
    const nek = nekOpScherm(speler, plaats);
    assert.ok(Math.abs(nek.x - (speler.nek[0] - uitsnede.x) * k) < 1.5, `nek x ${naam} camera ${speler.camera}`);
    assert.ok(Math.abs(nek.y - (speler.nek[1] - uitsnede.y) * k) < 1.5, `nek y ${naam} camera ${speler.camera}`);
    // hoofd even breed als gevraagd
    assert.ok(Math.abs(plaats.schaal * speler.kader.kopBreedte * 1080 - speler.kop * k) < 0.5);
    assert.ok(plaats.snij >= 0 && plaats.snij < 0.95);
  }
}
// Speler 1 ligt 30 graden met de klok mee gedraaid, speler 2 staat recht.
assert.equal(beeld.plaatsSpeler(manifest.spelers[0], manifest.uitsnedes.overzicht).draai, -30);
assert.equal(beeld.plaatsSpeler(manifest.spelers[1], manifest.uitsnedes.overzicht).draai, 0);

// Start van de scène: het overzicht, de tram staat aan het begin.
beeld.resetBeeldState();
const start = beeld.beeldStartAction("environment:30", options);
assert.equal(start.command, "td.samen.beeld");
assert.equal(start.payload.uitsnede, "overzicht");
assert.equal(start.payload.voorgrond, "/media/environments/environment_30/beeld/voorgrond-overzicht-begin.png");
let args = oscArgsForAction({ cueId: "c", command: "td.samen.beeld", payloadId: "p", payload: start.payload });
assert.equal(args.length, 3 + 3 + 18);
assert.deepEqual(args.slice(3, 6), ["0", "/media/environments/environment_30/beeld/achtergrond-overzicht.png", "/media/environments/environment_30/beeld/voorgrond-overzicht-begin.png"]);
assert.deepEqual([args[6], args[12], args[18]], ["1", "2", "3"]);
assert.ok(beeld.beeldStaatAan("environment:30"));

// De tram komt: in het overzicht speelt de clip.
let payload = beeld.beeldPayload("environment:30", { stap: beeld.stapNaam("/x/omvallen/tram-komt.mov"), duur: 5 }, options);
assert.equal(payload.voorgrond, "/media/environments/environment_30/beeld/voorgrond-overzicht-tram-komt.mov");
// Cameraknop 1 terwijl de tram er staat: dichtbij, met het eindbeeld (de clip begint niet opnieuw).
payload = beeld.beeldPayload("environment:30", { uitsnede: "1" }, options);
assert.equal(payload.achtergrond, "/media/environments/environment_30/beeld/achtergrond-1.png");
assert.equal(payload.voorgrond, "/media/environments/environment_30/beeld/voorgrond-1-tram-komt-eind.png");
// Links, gezien vanuit de uitsnede van camera 1.
payload = beeld.beeldPayload("environment:30", { stap: "links", duur: 2.6 }, options);
assert.equal(payload.voorgrond, "/media/environments/environment_30/beeld/voorgrond-1-links.mov");
// Begin: de tram is weg, de uitsnede blijft.
payload = beeld.beeldPayload("environment:30", { stap: "begin" }, options);
assert.equal(payload.voorgrond, "/media/environments/environment_30/beeld/voorgrond-1-begin.png");

// De shotknop is het overzicht.
const scene = { activeSituation: { runId: "a", resolved: { environmentId: "environment:30" } } };
const extraOptions = { ...options, catalog: { environments: [{ id: "environment:30", name: "Trolleyprobleem" }], mediaAssets: [] } };
const status = environmentExtrasStatus(scene, extraOptions);
assert.equal(status.shot.label, "OVERZICHT");
assert.equal(status.shot.klaar, true);
const cue = buildEnvironmentExtraCue(scene, { soort: "shot" }, extraOptions);
assert.equal(cue.actions[0].command, "td.samen.beeld");
assert.equal(cue.actions[0].payload.uitsnede, "overzicht");

// Einde van de scène: het beeld gaat uit en show control begint opnieuw.
const einde = sceneEindeActions({ now: 2000 });
const uit = einde.find((action) => action.command === "td.samen.beeld");
assert.equal(uit.payload.uit, true);
assert.deepEqual(oscArgsForAction({ cueId: "c", command: "td.samen.beeld", payloadId: "p", payload: uit.payload }).slice(3), ["1"]);
assert.equal(beeld.beeldStaatAan(), false);

// De adapter: zolang het beeld aan staat is een stap van de knoppen een stap in het beeld, en
// kiest een cameraknop de uitsnede dichtbij. Staat het uit, dan gaat alles zoals altijd.
const { beeldActieVoor, beeldNaCamera } = require("../target-adapters/touchdesigner-adapter");
const stapActie = { cueId: "c1", command: "td.effect.omvallen", payloadId: "p", payload: { environmentId: "environment:30", filePath: "/media/environments/environment_30/omvallen/rechts.mov", uit: false, duur: 2.6 } };
const cameraActie = { cueId: "c2", command: "td.camera.set", payloadId: "p", payload: { camera: 3 } };
assert.equal(beeldActieVoor(stapActie, options), null);
assert.equal(beeldNaCamera(cameraActie, options), null);
beeld.beeldStartAction("environment:30", options);
const vertaald = beeldActieVoor(stapActie, options);
assert.equal(vertaald.command, "td.samen.beeld");
assert.equal(vertaald.payload.voorgrond, "/media/environments/environment_30/beeld/voorgrond-overzicht-rechts.mov");
const naCamera = beeldNaCamera(cameraActie, options);
assert.deepEqual(naCamera.slice(0, 6), ["c2-beeld", "td.samen.beeld", "-", "0", "/media/environments/environment_30/beeld/achtergrond-3.png", "/media/environments/environment_30/beeld/voorgrond-3-rechts-eind.png"]);
// Een stap met een eigen laag (Lingo-bord) of van een andere omgeving blijft een gewone stap.
assert.equal(beeldActieVoor({ ...stapActie, payload: { ...stapActie.payload, environmentId: "environment:29" } }, options), null);
assert.equal(beeldActieVoor({ ...stapActie, payload: { ...stapActie.payload, overlay: { x: 0.5, y: 0.5, breedte: 0.5 } } }, options), null);
beeld.resetBeeldState();

// Een omgeving zonder beeld.json: niets.
assert.equal(beeld.beeldStartAction("environment:5", { beeld: null }), null);

console.log("environment-beeld-test ok");
