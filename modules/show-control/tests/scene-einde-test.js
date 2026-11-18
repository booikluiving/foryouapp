"use strict";

// Einde van de scène: alles wat de knoppen van de scène hebben aangezet gaat uit.
// Speelt niets af en stuurt niets naar TouchDesigner: de speler is `sleep`, de runtime is een
// namaakserver en de OSC gaat naar een eigen poort waar deze test zelf op luistert.

const assert = require("node:assert/strict");
const dgram = require("node:dgram");
const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const { sendMacAudioCommand, stopCurrent } = require("../target-adapters/mac-audio-adapter");
const { sendRuntimeCommand } = require("../target-adapters/runtime-adapter");
const { oscArgsForAction } = require("../target-adapters/touchdesigner-adapter");
const { buildEnvironmentExtraCue, environmentExtrasStatus } = require("../cue-library/environment-extras");
const {
  WACHT_VOOR_KLAARZETTEN_MS,
  resetSceneEindeState,
  sceneEindeActions,
  sceneEindeTick,
} = require("../cue-library/scene-einde");

function listen(server) {
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(server.address().port)));
}

function tdUitSoorten(actions) {
  return actions.filter((action) => action.targetId === "touchdesigner").map((action) => {
    const args = oscArgsForAction({ ...action, cueId: "cue", payloadId: "-" }).slice(3);
    return `${action.command} ${args.join(",")}`;
  });
}

const VERWACHT_TD = [
  "td.effect.omvallen ,1,0",
  "td.effect.fase ,1,0,0,",
  "td.effect.haper 1,0",
  "td.effect.haper 2,0",
  "td.effect.haper 3,0",
  "td.extra.shot ,0,1",
  "td.samen.shot 1,2,3,,,0.6,0",
  "td.samen.beeld 1",
];

async function main() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "scene-einde-"));
  const lied = path.join(dir, "lied.wav");
  const stap = path.join(dir, "stap.wav");
  const intro = path.join(dir, "intro.wav");
  const shot = path.join(dir, "shot.jpg");
  for (const file of [lied, stap, intro, shot]) fs.writeFileSync(file, "");
  const speler = path.join(dir, "speler.sh");
  fs.writeFileSync(speler, "#!/bin/sh\nexec sleep 30\n", { mode: 0o755 });

  // Namaak-runtime: stop en reset geven een stand zonder scène, met een volgende klaar.
  const naStop = {
    showRunId: "show-run-test",
    status: "running",
    activeSituation: null,
    preparedNext: { situationId: "situation:2" },
    resolvedPreparedNext: { situationId: "situation:2", environmentId: "environment:2", environment: { id: "environment:2", name: "Volgende" } },
  };
  const runtime = http.createServer((req, res) => {
    req.resume();
    req.on("end", () => {
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify(naStop));
    });
  });
  const runtimePort = await listen(runtime);

  // Namaak-TouchDesigner: vangt het terugzetten van het sfeergeluid op.
  const td = dgram.createSocket("udp4");
  const tdOntvangen = [];
  td.on("message", (message) => tdOntvangen.push(message.toString("latin1")));
  const tdPort = await new Promise((resolve) => td.bind(0, "127.0.0.1", () => resolve(td.address().port)));

  const adapterOptions = {
    runtimeBaseUrl: `http://127.0.0.1:${runtimePort}`,
    macAudioPlayer: speler,
    macAudio: "on",
    tdOscPort: tdPort,
    disableLiveCatalog: true,
  };
  const context = { adapterOptions };
  const play = (payload) => sendMacAudioCommand({ command: "audio.extra.play", payload: { volume: 1, ...payload } }, context);
  const voerUit = async (actions) => {
    for (const action of actions.filter((item) => item.targetId === "mac-audio")) await sendMacAudioCommand(action, context);
  };

  // 1. De scène speelt met alles aan: lied in een lus dat de sfeer dempt, een stapgeluid, de intro
  //    en een extra shot dat blijft staan.
  const speelt = {
    showRunId: "show-run-test",
    activeSituation: { situationRunId: "sit-run-1", resolved: { environmentId: "environment:1", environment: { id: "environment:1", name: "Test" } } },
  };
  const catalogus = {
    catalog: {
      environments: [{ id: "environment:1", name: "Test", extras: { shot: { label: "SHOT", bron: "bestand", bestand: "asset:shot", duur: 0 } } }],
      mediaAssets: [{ id: "asset:shot", environmentId: "environment:1", role: "extraShot", filePath: shot }],
    },
  };
  buildEnvironmentExtraCue(speelt, { soort: "shot" }, catalogus);
  assert.equal(environmentExtrasStatus(speelt, catalogus).shot.aan, true, "het extra shot staat aan");
  await play({ filePath: lied, wissel: true, lus: true, dempSfeer: { terug: 0.7 } });
  await play({ filePath: stap });
  await play({ filePath: intro, spoor: "intro" });

  // 2. STOP: de runtime-adapter geeft de acties van het scène-einde mee, vóór het klaarzetten.
  const stop = await sendRuntimeCommand({ command: "runtime.stopSituation", payload: { showRunId: "show-run-test", autoMics: false } }, context);
  const acties = stop.generatedActions;
  assert.equal(acties[0].command, "audio.extra.stop", "eerst het geluid");
  assert.deepEqual(acties[0].payload.alleen, undefined, "alle sporen, niet alleen de intro");
  assert.deepEqual(tdUitSoorten(acties.slice(0, 9)), VERWACHT_TD, "elk effect in TouchDesigner krijgt zijn uit");
  const klaarzetten = acties.findIndex((action) => action.command === "teleprompter.prepare");
  assert.equal(acties[9].command, "teleprompter.bord", "het bord (blind ranking) gaat mee uit");
  assert.equal(klaarzetten, 10, "klaarzetten komt na het opruimen");
  assert.equal(acties[klaarzetten].delayMs, WACHT_VOOR_KLAARZETTEN_MS, "en wacht tot TouchDesigner klaar is met opruimen");
  assert.equal(acties[acties.length - 2].command, "td.environment.prepare");
  assert.equal(acties[acties.length - 1].command, "td.samen.beeld", "daarna de teleprompters (voorbeeld of terug)");

  // 3. Het geluid is echt uit: een druk op elk spoor begint opnieuw in plaats van uit te zetten.
  await voerUit(acties);
  await new Promise((resolve) => setTimeout(resolve, 100));
  assert.ok(tdOntvangen.some((message) => message.includes("td.sfeer.volume") && message.includes("0.7")), "de gedempte sfeer komt terug");
  const opnieuw = await play({ filePath: lied, wissel: true, lus: true });
  assert.match(opnieuw.message, /^speelt/, "het lied in een lus was gestopt");
  assert.equal(environmentExtrasStatus(speelt, catalogus).shot.aan, false, "show-control weet dat het shot weg is");

  // 4. RESET RUN doet hetzelfde.
  await play({ filePath: stap });
  const reset = await sendRuntimeCommand({ command: "runtime.resetRun", payload: { showRunId: "show-run-test", autoMics: false } }, context);
  assert.equal(reset.generatedActions[0].command, "audio.extra.stop");
  assert.deepEqual(tdUitSoorten(reset.generatedActions.filter((action) => action.command !== "td.instel")), VERWACHT_TD);
  // Terug bij het begin: de teleprompters in de instelstand (inloop).
  const instel = reset.generatedActions.find((action) => action.command === "td.instel");
  assert.ok(instel && instel.payload.speler === 0 && instel.payload.waarde === 1, "RESET RUN zet de instelstand aan");
  await voerUit(reset.generatedActions);

  // 5. Starten ruimt niets op: wat tussen twee scènes is aangezet hoort bij de scène die komt.
  const start = await sendRuntimeCommand({ command: "runtime.startSituation", payload: { showRunId: "show-run-test", autoStartGeluid: false, autoMics: false } }, context);
  assert.ok(!start.generatedActions.some((action) => action.command === "audio.extra.stop"));

  // 6. Vangnet: de scène eindigt buiten show-control om.
  resetSceneEindeState();
  assert.equal(sceneEindeTick(speelt, { now: 100000 }), null, "scène speelt: niets");
  assert.equal(sceneEindeTick(speelt, { now: 102000 }), null);
  const vangnet = sceneEindeTick(naStop, { now: 104000 });
  assert.ok(vangnet, "scène weg zonder stop via show-control: alsnog opruimen");
  assert.equal(vangnet.actions[0].command, "audio.extra.stop");
  assert.deepEqual(tdUitSoorten(vangnet.actions), VERWACHT_TD);
  assert.equal(sceneEindeTick(naStop, { now: 106000 }), null, "één keer");
  // Is er net via show-control gestopt, dan doet het vangnet niets dubbel.
  sceneEindeTick(speelt, { now: 200000 });
  sceneEindeActions({ now: 201000 });
  assert.equal(sceneEindeTick(naStop, { now: 202000 }), null, "net opgeruimd: niet nog eens");
  // Een andere scène zonder stop ertussen telt ook als einde.
  sceneEindeTick(speelt, { now: 300000 });
  const andere = { ...speelt, activeSituation: { ...speelt.activeSituation, situationRunId: "sit-run-2" } };
  assert.ok(sceneEindeTick(andere, { now: 302000 }), "andere scène: de vorige wordt opgeruimd");

  stopCurrent();
  td.close();
  runtime.close();
  fs.rmSync(dir, { recursive: true, force: true });
  console.log("scene-einde-test ok");
}

main().catch((err) => {
  stopCurrent();
  console.error(err);
  process.exit(1);
});
