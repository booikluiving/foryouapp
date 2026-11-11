"use strict";

// Extra geluid als wisselknop: druk = start, druk terwijl het speelt = uit, druk = opnieuw vanaf het begin.
// Speelt niets af: de speler is vervangen door `sleep`.

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { sendMacAudioCommand, stopCurrent } = require("../target-adapters/mac-audio-adapter");

async function main() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "wissel-"));
  const lied = path.join(dir, "30.wav");
  const ander = path.join(dir, "31.wav");
  fs.writeFileSync(lied, "");
  fs.writeFileSync(ander, "");
  const fakePlayer = path.join(dir, "speler.sh");
  fs.writeFileSync(fakePlayer, "#!/bin/sh\nexec sleep 30\n", { mode: 0o755 });
  const context = { adapterOptions: { macAudioPlayer: fakePlayer, macAudio: "on" } };
  const play = (filePath, wissel) => sendMacAudioCommand({ command: "audio.extra.play", payload: { filePath, volume: 1, wissel } }, context);

  const eerste = await play(lied, true);
  assert.match(eerste.message, /^speelt/);
  const tweede = await play(lied, true);
  assert.equal(tweede.data.gestopt, true, "tweede druk zet het geluid uit");
  const derde = await play(lied, true);
  assert.match(derde.message, /^speelt/, "derde druk begint opnieuw");

  // Een ander geluid terwijl er iets speelt: gewoon dat geluid starten.
  const vierde = await play(ander, true);
  assert.match(vierde.message, /^speelt/);

  // Zonder wissel (stappen van een effect): nog eens drukken = opnieuw beginnen.
  const vijfde = await play(ander, false);
  assert.match(vijfde.message, /^speelt/);

  // Een effect (stap van omvallen) kapt het lied niet af: het lied gaat daarna met een druk uit.
  stopCurrent();
  await play(lied, true);
  const effect = await play(ander, false);
  assert.equal(effect.data.spoor, "effect");
  const uit = await play(lied, true);
  assert.equal(uit.data.gestopt, true, "het lied speelde nog tijdens het effect");

  stopCurrent();
  fs.rmSync(dir, { recursive: true, force: true });
  console.log("mac-audio-wissel-test ok");
}

main().catch((err) => {
  stopCurrent();
  console.error(err);
  process.exit(1);
});
