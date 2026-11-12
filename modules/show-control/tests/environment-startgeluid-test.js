"use strict";

// Startgeluid (intro) van een omgeving: vanzelf bij het begin van de scène, en onder de knop INTRO.
// Dempen: een lied met dempSfeer zet het sfeergeluid op nul en daarna terug.
// Raakt geen hardware: de speler is `sleep`, het sfeervolume wordt opgevangen.

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { startGeluidAction, startGeluidStatus, buildStartGeluidCue } = require("../cue-library/environment-startgeluid");
const { buildEnvironmentKnopCue, environmentKnoppenStatus } = require("../cue-library/environment-knoppen");
const { buildEnvironmentExtraCue } = require("../cue-library/environment-extras");
const { sendMacAudioCommand, stopCurrent } = require("../target-adapters/mac-audio-adapter");
const { normalizeEnvironmentExtras } = require("../../../shared/environment-extras/environment-extras-v0");

const asset = (id, role, file) => ({ id, environmentId: id.split(":").slice(1, 3).join(":"), type: "extra", role, status: "present", relativePath: file });
const catalog = {
  environments: [
    { id: "environment:28", name: "The Voice", extras: { geluid: { label: "Espresso", bron: "bestand", bestand: "a:environment:28:lied", volume: 1, dempSfeer: true }, sfeer: { volume: 0.6 } } },
    { id: "environment:17", name: "Podcaststudio", extras: { geluid: { label: "Lach", bron: "bestand", bestand: "a:environment:17:lach" } } },
    { id: "environment:5", name: "Kaal" },
  ],
  environmentCompositions: [
    { environmentId: "environment:28", fases: [
      { naam: "Hannah H", situationId: "situation:80", geluidAssetId: "a:environment:28:intro" },
      { naam: "Boa", situationId: "situation:37" },
    ] },
    { environmentId: "environment:17", fases: [
      { naam: "Gesprek", geluidAssetId: "a:environment:17:jingle" },
      { naam: "Eindjingle", geluidAssetId: "a:environment:17:jingle" },
    ] },
  ],
  mediaAssets: [
    asset("a:environment:28:intro", "extraGeluid", "environments/environment_28/extra/intro.mp3"),
    asset("a:environment:28:lied", "extraGeluid", "environments/environment_28/extra/lied.mp3"),
    asset("a:environment:17:jingle", "extraGeluid", "environments/environment_17/extra/jingle.mp3"),
    asset("a:environment:17:lach", "extraGeluid", "environments/environment_17/extra/lach.mp3"),
  ],
};
const options = { catalog, catalogMediaRoot: "/media", fileExists: () => true };
const knopOptions = { environmentFases: options, environmentOmvallen: { ...options, manifest: null, fileExists: () => false } };
const scene = (environmentId, situationId) => ({ showRunId: "run-1", activeSituation: { runId: "s1", situationId, resolved: { environmentId, situationId } } });

function testStartgeluid() {
  // De fase die bij de scène hoort bepaalt het startgeluid.
  const hannah = startGeluidAction(scene("environment:28", "situation:80"), options);
  assert.equal(hannah.command, "audio.extra.play");
  assert.equal(hannah.targetId, "mac-audio");
  assert.equal(hannah.payload.filePath, "/media/environments/environment_28/extra/intro.mp3");
  assert.equal(hannah.payload.spoor, "intro");
  // Boa heeft een eigen fase zonder geluid: niets.
  assert.equal(startGeluidAction(scene("environment:28", "situation:37"), options), null);
  // Geen fase bij de scène: het geluid van de eerste fase.
  const podcast = startGeluidAction(scene("environment:17", "situation:9"), options);
  assert.equal(podcast.payload.filePath, "/media/environments/environment_17/extra/jingle.mp3");
  // Omgeving zonder fases of zonder omgeving: niets, geen fout.
  assert.equal(startGeluidAction(scene("environment:5", "situation:1"), options), null);
  assert.equal(startGeluidAction({}, options), null);
  assert.equal(startGeluidStatus(scene("environment:28", "situation:37"), options).reden, "geen_startgeluid");
}

function testKnopIntro() {
  // The Voice (scène 80): alleen INTRO, want de fases horen bij scènes en er is hier geen omvallen.
  const voice = environmentKnoppenStatus(scene("environment:28", "situation:80"), knopOptions);
  assert.deepEqual(voice.knoppen.map((k) => k.soort), ["intro"]);
  assert.equal(voice.knoppen[0].label, "INTRO");
  const cue = buildEnvironmentKnopCue(scene("environment:28", "situation:80"), { plek: 0, source: "test" }, knopOptions);
  assert.equal(cue.actions[0].command, "audio.extra.play");
  assert.equal(cue.actions[0].payload.spoor, "intro");
  assert.equal(buildStartGeluidCue(scene("environment:28", "situation:80"), {}, options).cueIntent, "environment-startgeluid");
  // Podcaststudio: faseknop, BEGIN en dan INTRO als derde.
  const podcast = environmentKnoppenStatus(scene("environment:17", "situation:9"), knopOptions);
  assert.deepEqual(podcast.knoppen.map((k) => k.soort), ["fase", "begin", "intro"]);
  // Zonder startgeluid geen knop.
  assert.deepEqual(environmentKnoppenStatus(scene("environment:28", "situation:37"), knopOptions).knoppen, []);
}

function testDempVlag() {
  assert.equal(normalizeEnvironmentExtras({ geluid: { bron: "bestand", bestand: "x", dempSfeer: true } }).geluid.dempSfeer, true);
  assert.equal("dempSfeer" in normalizeEnvironmentExtras({ geluid: { bron: "bestand", bestand: "x" } }).geluid, false);
  const voice = buildEnvironmentExtraCue(scene("environment:28", "situation:80"), { soort: "geluid" }, options);
  assert.deepEqual(voice.actions[0].payload.dempSfeer, { terug: 0.6 });
  const podcast = buildEnvironmentExtraCue(scene("environment:17", "situation:9"), { soort: "geluid" }, options);
  assert.equal("dempSfeer" in podcast.actions[0].payload, false);
}

async function testDempenInDeSpeler() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "demp-"));
  const lied = path.join(dir, "lied.wav");
  const knop = path.join(dir, "knop.wav");
  const intro = path.join(dir, "intro.wav");
  for (const f of [lied, knop, intro]) fs.writeFileSync(f, "");
  const lang = path.join(dir, "lang.sh");
  fs.writeFileSync(lang, "#!/bin/sh\nexec sleep 30\n", { mode: 0o755 });
  const kort = path.join(dir, "kort.sh");
  fs.writeFileSync(kort, "#!/bin/sh\nexec sleep 0.2\n", { mode: 0o755 });
  const sfeer = [];
  const ctx = (speler) => ({ adapterOptions: { macAudioPlayer: speler, macAudio: "on", sfeerVolumeSender: (v) => sfeer.push(v) } });
  const play = (payload, speler = lang) => sendMacAudioCommand({ command: "audio.extra.play", payload: { volume: 1, ...payload } }, ctx(speler));

  // Lied aan: sfeer naar 0. Een stoel en de intro veranderen daar niets aan.
  await play({ filePath: lied, wissel: true, dempSfeer: { terug: 0.6 } });
  assert.deepEqual(sfeer, [0]);
  await play({ filePath: knop });
  const i = await play({ filePath: intro, spoor: "intro" });
  assert.equal(i.data.spoor, "intro");
  assert.deepEqual(sfeer, [0]);
  // Lied uit met de knop: sfeer terug.
  const uit = await play({ filePath: lied, wissel: true, dempSfeer: { terug: 0.6 } });
  assert.equal(uit.data.gestopt, true);
  assert.deepEqual(sfeer, [0, 0.6]);

  // Lied loopt vanzelf af: sfeer terug.
  await play({ filePath: lied, wissel: true, dempSfeer: { terug: 0.6 } }, kort);
  await new Promise((resolve) => setTimeout(resolve, 700));
  assert.deepEqual(sfeer, [0, 0.6, 0, 0.6]);

  // Einde van de scène: intro uit en een dempend lied uit (sfeer terug); een gewoon lied loopt door.
  await play({ filePath: lied, wissel: true, dempSfeer: { terug: 1 } });
  await play({ filePath: intro, spoor: "intro" });
  await sendMacAudioCommand({ command: "audio.extra.stop", payload: { alleen: "scene" } }, ctx(lang));
  assert.deepEqual(sfeer, [0, 0.6, 0, 0.6, 0, 1]);
  await play({ filePath: lied, wissel: true });
  await sendMacAudioCommand({ command: "audio.extra.stop", payload: { alleen: "scene" } }, ctx(lang));
  const nog = await play({ filePath: lied, wissel: true });
  assert.equal(nog.data.gestopt, true, "een lied zonder dempen loopt door na het einde van de scène");
  assert.equal(sfeer.length, 6);

  stopCurrent();
  fs.rmSync(dir, { recursive: true, force: true });
}

async function main() {
  testStartgeluid();
  testKnopIntro();
  testDempVlag();
  await testDempenInDeSpeler();
  console.log("environment-startgeluid: ok");
}

main().catch((err) => {
  stopCurrent();
  console.error(err);
  process.exit(1);
});
