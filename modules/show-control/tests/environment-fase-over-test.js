"use strict";

// Een fase met een sfeergeluid dat over het sfeergeluid van de omgeving heen klinkt (Ziekenhuis:
// de hartmonitor over het geroezemoes). Het speelt in een lus op de Mac, op een eigen spoor;
// TouchDesigner houdt het sfeergeluid van de omgeving. Een fase zonder zo'n geluid en het einde
// van de scène zetten het uit. Geen netwerk, geen catalogus, er speelt niets af.

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { buildEnvironmentFaseCue, resetFasesState } = require("../cue-library/environment-fases");
const { sceneEindeActions } = require("../cue-library/scene-einde");
const { sendMacAudioCommand, stopCurrent } = require("../target-adapters/mac-audio-adapter");

const asset = (naam) => ({ id: `geluid:${naam}`, environmentId: "environment:12", type: "extra", role: "extraGeluid", relativePath: `environments/environment_12/extra/${naam}.wav` });
const catalog = {
  environments: [{ id: "environment:12", name: "Ziekenhuis", extras: { geluid: { bron: "bestand", bestand: "geluid:alarm", volume: 1, lus: true } } }],
  mediaAssets: [asset("alarm"), asset("hart-1"), asset("hart-2"), asset("toon")],
  environmentCompositions: [
    { environmentId: "environment:12", fases: [
      { naam: "Rust", assetId: "", schok: false, schokNa: 0 },
      { naam: "Hartslag", assetId: "", schok: false, schokNa: 0, sfeerAssetId: "geluid:hart-1", sfeerOver: true },
      { naam: "Sneller", assetId: "", schok: false, schokNa: 0, sfeerAssetId: "geluid:hart-2", sfeerOver: true },
      // Zonder het vinkje: vervangt het sfeergeluid, zoals het was.
      { naam: "Lange toon", assetId: "", schok: false, schokNa: 0, sfeerAssetId: "geluid:toon" },
    ] },
  ],
};
const options = { catalog, catalogMediaRoot: "/media", fileExists: () => true };
const scene = { activeSituation: { runId: "a", resolved: { environmentId: "environment:12" } } };
const mac = (cue) => cue.actions.filter((action) => action.targetId === "mac-audio");
const td = (cue) => cue.actions.find((action) => action.targetId === "touchdesigner");

async function main() {
  resetFasesState();
  // Hartslag: over het sfeergeluid heen.
  const hart = buildEnvironmentFaseCue(scene, { actie: "volgende" }, options);
  assert.equal(mac(hart).length, 1);
  assert.equal(mac(hart)[0].command, "audio.extra.play");
  assert.equal(mac(hart)[0].payload.filePath, "/media/environments/environment_12/extra/hart-1.wav");
  assert.equal(mac(hart)[0].payload.spoor, "fase");
  assert.equal(mac(hart)[0].payload.lus, true);
  assert.equal(mac(hart)[0].payload.stopLied, undefined, "het alarm blijft");
  assert.equal(td(hart).payload.sfeerPath, "", "TouchDesigner houdt het sfeergeluid van de omgeving");

  // Sneller: het volgende geluid op hetzelfde spoor.
  const sneller = buildEnvironmentFaseCue(scene, { actie: "volgende" }, options);
  assert.equal(mac(sneller)[0].payload.filePath, "/media/environments/environment_12/extra/hart-2.wav");

  // Lange toon zonder vinkje: het spoor uit, TouchDesigner wisselt het sfeergeluid.
  const toon = buildEnvironmentFaseCue(scene, { actie: "volgende" }, options);
  assert.equal(mac(toon).length, 1);
  assert.equal(mac(toon)[0].command, "audio.extra.stop");
  assert.equal(mac(toon)[0].payload.spoor, "fase");
  assert.equal(td(toon).payload.sfeerPath, "/media/environments/environment_12/extra/toon.wav");

  // BEGIN (fase 1): het spoor uit.
  const begin = buildEnvironmentFaseCue(scene, { index: 0 }, options);
  assert.equal(mac(begin)[0].command, "audio.extra.stop");
  assert.equal(mac(begin)[0].payload.spoor, "fase");

  // Een omgeving zonder het vinkje krijgt geen extra opdracht naar de Mac.
  const zonder = { ...catalog, environmentCompositions: [{ environmentId: "environment:12", fases: catalog.environmentCompositions[0].fases.map(({ sfeerOver, ...fase }) => fase) }] };
  resetFasesState();
  const oud = buildEnvironmentFaseCue(scene, { actie: "volgende" }, { ...options, catalog: zonder });
  assert.equal(mac(oud).length, 0);
  assert.equal(td(oud).payload.sfeerPath, "/media/environments/environment_12/extra/hart-1.wav");

  // De speler: lus op het spoor fase; het lied (alarm) loopt door; wisselen en stoppen.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fase-over-"));
  const bestand = (naam) => { const p = path.join(dir, naam); fs.writeFileSync(p, ""); return p; };
  const alarm = bestand("alarm.wav");
  const hart1 = bestand("hart-1.wav");
  const hart2 = bestand("hart-2.wav");
  const teller = path.join(dir, "teller");
  const fakePlayer = path.join(dir, "speler.sh");
  fs.writeFileSync(fakePlayer, `#!/bin/sh\necho "$3" >> ${teller}\nsleep 0.2\n`, { mode: 0o755 });
  const context = { adapterOptions: { macAudioPlayer: fakePlayer, macAudio: "on" } };
  const stuur = (command, payload) => sendMacAudioCommand({ command, payload }, context);
  const wacht = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const regels = () => (fs.existsSync(teller) ? fs.readFileSync(teller, "utf8").trim().split("\n") : []);

  await stuur("audio.extra.play", { filePath: alarm, volume: 1, wissel: true, lus: true });
  const eerste = await stuur("audio.extra.play", { filePath: hart1, volume: 1, spoor: "fase", lus: true });
  assert.equal(eerste.data.spoor, "fase");
  await wacht(700);
  assert.ok(regels().filter((r) => r === hart1).length >= 3, "het fasegeluid loopt in een lus");
  const nogEens = await stuur("audio.extra.play", { filePath: hart1, volume: 1, spoor: "fase", lus: true });
  assert.match(nogEens.message, /speelt al/, "dezelfde fase begint niet opnieuw");
  await stuur("audio.extra.play", { filePath: hart2, volume: 1, spoor: "fase", lus: true });
  await wacht(300);
  const hart1Keren = regels().filter((r) => r === hart1).length;
  await wacht(400);
  assert.equal(regels().filter((r) => r === hart1).length, hart1Keren, "het vorige fasegeluid is gestopt");
  assert.ok(regels().filter((r) => r === hart2).length >= 2);

  // Alleen het spoor fase uit: het alarm loopt door.
  await stuur("audio.extra.stop", { spoor: "fase" });
  const hart2Keren = regels().filter((r) => r === hart2).length;
  const alarmKeren = regels().filter((r) => r === alarm).length;
  await wacht(500);
  assert.equal(regels().filter((r) => r === hart2).length, hart2Keren, "spoor fase is uit");
  assert.ok(regels().filter((r) => r === alarm).length > alarmKeren, "het alarm loopt door");

  // Einde van de scène: alles uit, ook het fasegeluid.
  await stuur("audio.extra.play", { filePath: hart1, volume: 1, spoor: "fase", lus: true });
  const einde = sceneEindeActions({ now: 1 }).find((action) => action.targetId === "mac-audio");
  await stuur(einde.command, einde.payload);
  await wacht(100);
  const totaal = regels().length;
  await wacht(500);
  assert.equal(regels().length, totaal, "na het einde van de scène speelt er niets meer");

  stopCurrent();
  fs.rmSync(dir, { recursive: true, force: true });
  console.log("environment-fase-over-test ok");
}

main().catch((err) => {
  stopCurrent();
  console.error(err);
  process.exit(1);
});
