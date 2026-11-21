"use strict";

// Knop van een personage: het nummer van Marit in elke scène waarin ze meespeelt.
// Speelt niets af en stuurt niets naar TouchDesigner: de speler is `sleep` en de OSC gaat naar
// een eigen poort waar deze test zelf op luistert.

const assert = require("node:assert/strict");
const dgram = require("node:dgram");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { sendMacAudioCommand, stopCurrent } = require("../target-adapters/mac-audio-adapter");
const { buildPersonageKnopCue, personageKnopStatus, publicPersonageKnopStatus } = require("../cue-library/personage-knop");
const { sceneEindeActions } = require("../cue-library/scene-einde");

async function main() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "personage-knop-"));
  const knopDir = path.join(dir, "characters", "character_28", "knop");
  fs.mkdirSync(knopDir, { recursive: true });
  const nummer = path.join(knopDir, "marit.wav");
  fs.writeFileSync(nummer, "");
  fs.writeFileSync(path.join(knopDir, "knop.json"), JSON.stringify({ label: "MARIT", geluid: "marit.wav", volume: 0.8, overgang: 0.3 }));
  const extra = path.join(dir, "extra.wav");
  const stap = path.join(dir, "stap.wav");
  const faseSfeer = path.join(dir, "fase.wav");
  for (const file of [extra, stap, faseSfeer]) fs.writeFileSync(file, "");
  const speler = path.join(dir, "speler.sh");
  fs.writeFileSync(speler, "#!/bin/sh\nexec sleep 30\n", { mode: 0o755 });

  const td = dgram.createSocket("udp4");
  const tdOntvangen = [];
  td.on("message", (message) => tdOntvangen.push(message.toString("latin1")));
  const tdPort = await new Promise((resolve) => td.bind(0, "127.0.0.1", () => resolve(td.address().port)));
  const even = () => new Promise((resolve) => setTimeout(resolve, 100));

  const context = { adapterOptions: { macAudioPlayer: speler, macAudio: "on", tdOscPort: tdPort } };
  const play = (payload) => sendMacAudioCommand({ command: "audio.extra.play", payload: { volume: 1, ...payload } }, context);
  const options = {
    catalogMediaRoot: dir,
    environmentExtras: { catalog: { environments: [{ id: "environment:36", name: "Escape room", extras: { sfeer: { volume: 0.6 } } }], mediaAssets: [] } },
  };
  const scene = (characterIds) => ({
    situationId: "situation:1",
    environmentId: "environment:36",
    environment: { id: "environment:36", name: "Escape room" },
    characterIds,
    characters: characterIds.map((id) => ({ id, name: id === "character:28" ? "Escape Room Marit" : "Iemand" })),
  });
  const metMarit = { showRunId: "run", activeSituation: { situationRunId: "sit-1", resolved: scene(["character:15", "character:28"]) } };
  const zonderMarit = { showRunId: "run", activeSituation: { situationRunId: "sit-2", resolved: scene(["character:15"]) } };
  const maritKlaar = { showRunId: "run", activeSituation: null, resolvedPreparedNext: scene(["character:28"]) };

  // 1. De knop hangt aan het personage: er is er een in elke scène met Marit, anders niet.
  const status = personageKnopStatus(metMarit, options);
  assert.equal(status.klaar, true);
  assert.equal(status.staat, "klaar");
  assert.equal(status.label, "MARIT");
  assert.equal(status.characterId, "character:28");
  assert.equal(publicPersonageKnopStatus(status).filePath, undefined, "geen bestandspad naar het deck");
  assert.equal(personageKnopStatus(zonderMarit, options).klaar, false);
  assert.equal(personageKnopStatus(zonderMarit, options).label, "", "zonder Marit is de knop leeg");
  assert.throws(() => buildPersonageKnopCue(zonderMarit, {}, options), (err) => err.statusCode === 409 && err.code === "geen_personage");
  // Staat de scène met Marit klaar, dan is de knop te zien maar nog donker.
  const klaar = personageKnopStatus(maritKlaar, options);
  assert.equal(klaar.label, "MARIT");
  assert.equal(klaar.staat, "uit");
  assert.throws(() => buildPersonageKnopCue(maritKlaar, {}, options), (err) => err.code === "scene_speelt_niet");
  // Speelt er een scène zonder Marit terwijl er een met Marit klaarstaat: geen knop.
  assert.equal(personageKnopStatus({ ...zonderMarit, resolvedPreparedNext: scene(["character:28"]) }, options).label, "");

  // 2. Een druk start het nummer en zet het andere geluid van de scène uit.
  await play({ filePath: extra, wissel: true, lus: true });
  await play({ filePath: stap });
  await play({ filePath: faseSfeer, spoor: "fase", lus: true });
  const cue = buildPersonageKnopCue(metMarit, { source: "test" }, options);
  assert.equal(cue.actions.length, 1);
  const actie = cue.actions[0];
  assert.equal(actie.command, "audio.extra.play");
  assert.equal(actie.payload.filePath, nummer);
  assert.equal(actie.payload.volume, 0.8);
  assert.equal(actie.payload.lus, undefined, "speelt één keer");
  assert.deepEqual(actie.payload.dempSfeer, { terug: 0.6 }, "het sfeergeluid komt terug op het niveau van de omgeving");
  assert.equal(actie.payload.overgang, 0.3, "de overgang uit knop.json gaat mee");
  const gestart = await sendMacAudioCommand(actie, context);
  assert.match(gestart.message, /^speelt marit\.wav/);
  // Het sfeergeluid zakt in stappen weg en eindigt op nul.
  await new Promise((resolve) => setTimeout(resolve, 600));
  const sfeer = tdOntvangen.filter((message) => message.includes("td.sfeer.volume")).map((message) => Number((message.split("td.sfeer.volume")[1].match(/[0-9.]+/g) || []).pop()));
  assert.ok(sfeer.length >= 2 && sfeer[0] > 0 && sfeer[0] < 0.6, "het sfeergeluid zakt in stappen");
  assert.equal(sfeer[sfeer.length - 1], 0, "het sfeergeluid gaat naar nul");
  assert.equal(personageKnopStatus(metMarit, options).staat, "actief", "de knop toont dat het nummer speelt");
  // Het extra geluid, het stapgeluid en het sfeergeluid van de fase zijn weg: een druk begint ze opnieuw.
  const faseOpnieuw = await play({ filePath: faseSfeer, spoor: "fase", lus: true });
  assert.match(faseOpnieuw.message, /^speelt/, "het sfeergeluid van de fase was gestopt");

  // 3. Nog een druk zet het nummer uit en het sfeergeluid komt terug.
  tdOntvangen.length = 0;
  const uit = await sendMacAudioCommand(buildPersonageKnopCue(metMarit, {}, options).actions[0], context);
  assert.equal(uit.data.gestopt, true);
  await even();
  assert.ok(tdOntvangen.some((message) => message.includes("td.sfeer.volume") && message.includes("0.6")), "de sfeer komt terug");
  assert.equal(personageKnopStatus(metMarit, options).staat, "klaar");

  // 4. Stop en RESET RUN (scene-einde.js) zetten het nummer uit.
  await sendMacAudioCommand(buildPersonageKnopCue(metMarit, {}, options).actions[0], context);
  assert.equal(personageKnopStatus(metMarit, options).aan, true);
  for (const action of sceneEindeActions({ generatedBy: "test" }).filter((item) => item.targetId === "mac-audio")) {
    await sendMacAudioCommand(action, context);
  }
  assert.equal(personageKnopStatus(metMarit, options).aan, false, "het nummer stopt met de scène");

  // 4b. Met "over" in knop.json klinkt het nummer over het geluid van de scène heen: niets gaat weg,
  // geen overgang; de knop blijft een wissel die vanaf het begin start.
  fs.writeFileSync(path.join(knopDir, "knop.json"), JSON.stringify({ label: "MARIT", geluid: "marit.wav", volume: 0.8, over: true, overgang: 5 }));
  await play({ filePath: faseSfeer, spoor: "fase", lus: true });
  await even();
  tdOntvangen.length = 0;
  const over = buildPersonageKnopCue(metMarit, {}, options).actions[0];
  assert.equal(over.payload.stopAnder, undefined);
  assert.equal(over.payload.dempSfeer, undefined);
  assert.equal(over.payload.overgang, undefined);
  assert.equal(over.payload.wissel, true);
  assert.equal(over.payload.hard, true, "zonder overgang is het een harde cut");
  await sendMacAudioCommand(over, context);
  await even();
  assert.ok(!tdOntvangen.some((message) => message.includes("td.sfeer.volume")), "het sfeergeluid blijft staan");
  assert.match((await play({ filePath: faseSfeer, spoor: "fase", lus: true })).message, /speelt al/, "het sfeergeluid van de fase loopt door");
  assert.equal((await sendMacAudioCommand(buildPersonageKnopCue(metMarit, {}, options).actions[0], context)).data.gestopt, true, "nog een druk zet het uit");
  assert.match((await sendMacAudioCommand(buildPersonageKnopCue(metMarit, {}, options).actions[0], context)).message, /^speelt marit\.wav/, "en de druk daarna begint opnieuw");
  for (const action of sceneEindeActions({ generatedBy: "test" }).filter((item) => item.targetId === "mac-audio")) await sendMacAudioCommand(action, context);

  // 5. Bestand weg: de knop is donker.
  fs.rmSync(nummer);
  assert.equal(personageKnopStatus(metMarit, options).reden, "bestand_ontbreekt");

  stopCurrent();
  td.close();
  fs.rmSync(dir, { recursive: true, force: true });
  console.log("personage-knop-test ok");
}

main().catch((err) => {
  stopCurrent();
  console.error(err);
  process.exit(1);
});
