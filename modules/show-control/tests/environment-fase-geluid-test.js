"use strict";

// Een fase met een eigen geluid: dat geluid speelt bij het ingaan en zet het extra geluid uit
// (Spelletjeskamer: de bom stopt het piepje). Geen netwerk, geen catalogus, er speelt niets af.

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { buildEnvironmentFaseCue, publicFasesStatus, environmentFasesStatus, resetFasesState } = require("../cue-library/environment-fases");
const { sendMacAudioCommand, stopCurrent } = require("../target-adapters/mac-audio-adapter");

const catalog = {
  environments: [{ id: "environment:7", name: "Spelletjeskamer", extras: { geluid: { bron: "bestand", bestand: "geluid:piep", volume: 0.5 } } }],
  mediaAssets: [
    { id: "geluid:piep", environmentId: "environment:7", type: "extra", role: "extraGeluid", relativePath: "environments/environment_7/extra/piep.wav" },
    { id: "geluid:bom", environmentId: "environment:7", type: "extra", role: "extraGeluid", relativePath: "environments/environment_7/extra/bom.wav" },
  ],
  environmentCompositions: [
    { environmentId: "environment:7", fases: [
      { naam: "Spelen", assetId: "", schok: false, schokNa: 0 },
      { naam: "Bom", assetId: "", schok: true, schokNa: 0.2, geluidAssetId: "geluid:bom" },
    ] },
  ],
};
const options = { catalog, catalogMediaRoot: "/media", fileExists: () => true };
const scene = { activeSituation: { runId: "a", resolved: { environmentId: "environment:7" } } };

async function main() {
  resetFasesState();
  assert.equal(publicFasesStatus(environmentFasesStatus(scene, options)).fases[1].eigenGeluid, true);
  const cue = buildEnvironmentFaseCue(scene, { actie: "volgende" }, options);
  const audio = cue.actions.find((action) => action.targetId === "mac-audio");
  assert.equal(audio.payload.filePath, "/media/environments/environment_7/extra/bom.wav", "het eigen geluid, niet het extra geluid");
  assert.equal(audio.payload.stopLied, true);
  assert.equal(audio.payload.wissel, undefined);
  assert.equal(cue.actions.find((action) => action.targetId === "touchdesigner").payload.schok, true);

  // Terug naar de eerste fase: geen geluid.
  const terug = buildEnvironmentFaseCue(scene, { actie: "volgende" }, options);
  assert.equal(terug.actions.some((action) => action.targetId === "mac-audio"), false);

  // De speler: het effect met stopLied zet het lied uit.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fase-geluid-"));
  const piep = path.join(dir, "piep.wav");
  const bom = path.join(dir, "bom.wav");
  fs.writeFileSync(piep, "");
  fs.writeFileSync(bom, "");
  const fakePlayer = path.join(dir, "speler.sh");
  fs.writeFileSync(fakePlayer, "#!/bin/sh\nexec sleep 30\n", { mode: 0o755 });
  const context = { adapterOptions: { macAudioPlayer: fakePlayer, macAudio: "on" } };
  const play = (payload) => sendMacAudioCommand({ command: "audio.extra.play", payload: { volume: 1, ...payload } }, context);
  await play({ filePath: piep, wissel: true });
  await play({ filePath: bom, stopLied: true });
  const druk = await play({ filePath: piep, wissel: true });
  assert.match(druk.message, /^speelt/, "het piepje was gestopt door de bom: een druk start het opnieuw");
  stopCurrent();
  fs.rmSync(dir, { recursive: true, force: true });
  console.log("environment-fase-geluid-test ok");
}

main().catch((err) => { console.error(err); process.exit(1); });
