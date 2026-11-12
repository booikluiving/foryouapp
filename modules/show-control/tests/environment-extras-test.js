"use strict";

// Extra shot en extra geluid per omgeving: status voor het deck en de cue die
// afgevuurd wordt. Raakt geen hardware: adapters zijn vervangen door opnemers.

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const tmp = path.resolve(__dirname, "..", `.tmp-extras-db-${process.pid}`);
fs.mkdirSync(tmp, { recursive: true });
process.env.SHOW_CONTROL_DB_DIR = path.join(tmp, "db");
process.env.SHOW_CONTROL_ADAPTER_MODE = "test";

const { createShowControlApp } = require("../server/app");
const { buildEnvironmentExtraCue, buildSfeerVolumeCue, environmentExtrasStatus, publicExtrasStatus, resetHoldState, samenStaatAan } = require("../cue-library/environment-extras");
const { oscArgsForAction, sendTouchDesignerCommand, shotUitArgsFor } = require("../target-adapters/touchdesigner-adapter");

const catalog = {
  environments: [
    {
      id: "environment:7",
      name: "Spelletjeskamer",
      extras: {
        shot: { label: "Shot spelbord", omschrijving: "Het bord", bron: "bestand", bestand: "media-asset:environment:7:extraShot:bord-1", duur: 4 },
        geluid: { label: "Bom", omschrijving: "Een bom", bron: "bestand", bestand: "media-asset:environment:7:extraGeluid:bom-1", volume: 0.8 },
      },
    },
    {
      id: "environment:12",
      name: "Ziekenhuis",
      extras: {
        shot: { label: "Shot kamer", bron: "achtergrond", duur: 0 },
        geluid: { label: "Piepjes", bron: "bestand", bestand: "ontbreekt" },
      },
    },
    { id: "environment:11", name: "Trein", extras: { shot: { label: "Cam 2", bron: "camera", camera: 2 } } },
    { id: "environment:99", name: "Leeg" },
  ],
  mediaAssets: [
    { id: "media-asset:environment:7:extraShot:bord-1", environmentId: "environment:7", type: "extra", role: "extraShot", status: "present", relativePath: "environments/environment_7/extra/bord-1.jpg" },
    { id: "media-asset:environment:7:extraGeluid:bom-1", environmentId: "environment:7", type: "extra", role: "extraGeluid", status: "present", relativePath: "environments/environment_7/extra/bom-1.mp3" },
    { id: "media-asset:environment:7:soundscape:x", environmentId: "environment:7", type: "soundscape", role: "soundscape", status: "present", relativePath: "environments/environment_7/soundscape/x.mp3" },
    { id: "media-asset:environment:12:background:zh", environmentId: "environment:12", type: "background", role: "background", status: "present", relativePath: "environments/environment_12/background/zh.jpg" },
  ],
};
const extrasOptions = { catalog, catalogMediaRoot: "/media", fileExists: () => true };
const runtimeFor = (environmentId, where = "active") => (where === "active"
  ? { showRunId: "run-1", activeSituation: { situationRunId: "s1", resolved: { environmentId } } }
  : { showRunId: "run-1", activeSituation: null, resolvedPreparedNext: { environmentId } });

function testStatus() {
  const geen = environmentExtrasStatus({}, extrasOptions);
  assert.equal(geen.bron, "geen");
  assert.equal(geen.shot.klaar, false);

  const spel = environmentExtrasStatus(runtimeFor("environment:7"), extrasOptions);
  assert.equal(spel.bron, "actief");
  assert.equal(spel.environmentName, "Spelletjeskamer");
  assert.equal(spel.shot.label, "Shot spelbord");
  assert.equal(spel.shot.klaar, true);
  assert.equal(spel.shot.filePath, "/media/environments/environment_7/extra/bord-1.jpg");
  assert.equal(spel.geluid.klaar, true);
  assert.equal(spel.geluid.volume, 0.8);

  const zh = environmentExtrasStatus(runtimeFor("environment:12", "prepared"), extrasOptions);
  assert.equal(zh.bron, "klaar");
  assert.equal(zh.shot.klaar, true, "achtergrond als shot");
  assert.equal(zh.shot.filePath, "/media/environments/environment_12/background/zh.jpg");
  assert.equal(zh.geluid.klaar, false);
  assert.equal(zh.geluid.reden, "geen_bestand");

  const leeg = environmentExtrasStatus(runtimeFor("environment:99"), extrasOptions);
  assert.equal(leeg.shot.reden, "geen_bron");
  assert.equal(leeg.geluid.klaar, false);

  const missing = environmentExtrasStatus(runtimeFor("environment:7"), { ...extrasOptions, fileExists: () => false });
  assert.equal(missing.shot.reden, "bestand_ontbreekt");
}

async function testRoutes() {
  const calls = [];
  let runtimeState = runtimeFor("environment:7");
  const record = (name) => async (action) => {
    calls.push({ adapter: name, command: action.command, payload: action.payload });
    return { stage: "applied", state: "ok" };
  };
  const app = createShowControlApp({
    clients: { fetchCurrentRuntimeState: async () => ({ ok: true, state: runtimeState }) },
    adapters: { touchdesigner: record("touchdesigner"), macaudio: record("macaudio") },
    environmentExtras: extrasOptions,
    environmentExtrasCacheMs: 0,
  });
  const server = await new Promise((resolve) => {
    const s = app.listen(0, "127.0.0.1", () => resolve(s));
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  const post = (body) => fetch(`${base}/v0/show-control/cues/environment-extra`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  }).then(async (r) => ({ status: r.status, body: await r.json() }));
  try {
    const current = await fetch(`${base}/v0/show-control/environment-extras/current`).then((r) => r.json());
    assert.equal(current.shot.label, "Shot spelbord");
    assert.equal(current.shot.filePath, undefined, "deck krijgt geen paden");

    let r = await post({ soort: "geluid" });
    assert.equal(r.status, 201);
    assert.equal(calls.at(-1).adapter, "macaudio");
    assert.equal(calls.at(-1).command, "audio.extra.play");
    assert.equal(calls.at(-1).payload.filePath, "/media/environments/environment_7/extra/bom-1.mp3");

    r = await post({ soort: "shot" });
    assert.equal(r.status, 201);
    assert.equal(calls.at(-1).command, "td.extra.shot");
    assert.equal(calls.at(-1).payload.duur, 4);
    assert.equal(calls.at(-1).payload.uit, false);

    // duur 0: tweede druk haalt het shot weg
    resetHoldState();
    runtimeState = runtimeFor("environment:12");
    await post({ soort: "shot" });
    assert.equal(calls.at(-1).payload.uit, false);
    let cur = await fetch(`${base}/v0/show-control/environment-extras/current`).then((res) => res.json());
    assert.equal(cur.shot.aan, true, "shot blijft staan");
    await post({ soort: "shot" });
    assert.equal(calls.at(-1).payload.uit, true);
    cur = await fetch(`${base}/v0/show-control/environment-extras/current`).then((res) => res.json());
    assert.equal(cur.shot.aan, false);
    await post({ soort: "shot" });
    assert.equal(calls.at(-1).payload.uit, false);

    r = await post({ soort: "geluid" });
    assert.equal(r.status, 409);
    assert.equal(r.body.error, "geen_bestand");

    runtimeState = runtimeFor("environment:11");
    r = await post({ soort: "shot" });
    assert.equal(r.status, 201);
    assert.equal(calls.at(-1).command, "td.camera.set");
    assert.equal(calls.at(-1).payload.camera, 2);

    runtimeState = {};
    r = await post({ soort: "shot" });
    assert.equal(r.status, 409);
    assert.equal(r.body.error, "geen_omgeving");

    r = await post({ soort: "iets" });
    assert.equal(r.status, 400);

    const status = await fetch(`${base}/v0/show-control/status`).then((res) => res.json());
    assert.equal(status.environmentExtras.bron, "geen");
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

function testOscArgs() {
  const args = oscArgsForAction({ cueId: "c", command: "td.extra.shot", payloadId: "p", payload: { filePath: "/a b.jpg", duur: 4, uit: false } });
  assert.deepEqual(args, ["c", "td.extra.shot", "p", "/a b.jpg", "4", "0"]);
  assert.deepEqual(oscArgsForAction({ cueId: "c", command: "td.camera.set", payloadId: "p", payload: { camera: 2 } }), ["c", "td.camera.set", "p"]);
  assert.deepEqual(oscArgsForAction({ cueId: "c", command: "td.sfeer.volume", payloadId: "p", payload: { volume: 0.63 } }), ["c", "td.sfeer.volume", "p", "0.63"]);
}

// Een cameraknop wint van het extra shot: eerst gaat het shot weg, dan komt de camera.
async function testCameraWintVanShot() {
  assert.equal(shotUitArgsFor({ cueId: "c", command: "td.extra.shot" }), null);
  assert.deepEqual(shotUitArgsFor({ cueId: "c", command: "td.camera.set" }), ["c-shot-uit", "td.extra.shot", "-", "", "0", "1"]);

  // Een shot dat blijft staan (duur 0) is na een cameraknop weg: de volgende druk toont hem weer.
  resetHoldState();
  const runtime = runtimeFor("environment:12");
  assert.equal(buildEnvironmentExtraCue(runtime, { soort: "shot" }, extrasOptions).actions[0].payload.uit, false);
  assert.equal(environmentExtrasStatus(runtime, extrasOptions).shot.aan, true);

  const { createOscServer } = require("../target-adapters/osc-lite");
  const ontvangen = [];
  const port = 39000 + (process.pid % 1000);
  const server = createOscServer({ port, onMessage: (message) => ontvangen.push(message) });
  try {
    await new Promise((resolve) => setTimeout(resolve, 50));
    await sendTouchDesignerCommand(
      { cueId: "c", command: "td.camera.set", payloadId: "p", payload: { camera: 2 } },
      { adapterOptions: { tdOscHost: "127.0.0.1", tdOscPort: port } },
    );
    await new Promise((resolve) => setTimeout(resolve, 100));
  } finally {
    server.close();
  }
  const args = ontvangen.map((message) => message.args.map((arg) => (arg && typeof arg === "object" && "value" in arg ? arg.value : arg)));
  assert.deepEqual(args, [
    ["c-shot-uit", "td.extra.shot", "-", "", "0", "1"],
    ["c", "td.camera.set", "p"],
  ]);
  assert.equal(environmentExtrasStatus(runtime, extrasOptions).shot.aan, false);
  assert.equal(buildEnvironmentExtraCue(runtime, { soort: "shot" }, extrasOptions).actions[0].payload.uit, false);
  resetHoldState();
}

// Gezamenlijk shot: samen/samen.json bij de media maakt van de shotknop een aan/uit voor twee camera's.
async function testSamen() {
  resetHoldState();
  const samenJson = JSON.stringify({ label: "SAMEN", cameras: [2, 3], achtergrond: "bg.jpg", voorgrond: "desk.png", schaal: 0.6, omhoog: 0.08 });
  const options = {
    ...extrasOptions,
    readFile: (file) => {
      if (file === "/media/environments/environment_7/samen/samen.json") return samenJson;
      throw new Error("ENOENT");
    },
  };
  const runtime = runtimeFor("environment:7");
  const status = environmentExtrasStatus(runtime, options);
  assert.equal(status.shot.label, "SAMEN");
  assert.equal(status.shot.bron, "samen");
  assert.equal(status.shot.klaar, true);
  assert.equal(publicExtrasStatus(status).shot.samen, undefined);
  // Andere omgevingen houden hun gewone shot.
  assert.equal(environmentExtrasStatus(runtimeFor("environment:12"), options).shot.bron, "achtergrond");

  const aan = buildEnvironmentExtraCue(runtime, { soort: "shot" }, options).actions[0];
  assert.equal(aan.command, "td.samen.shot");
  assert.equal(aan.payload.uit, false);
  assert.deepEqual(oscArgsForAction({ ...aan, cueId: "c", payloadId: "p" }), [
    "c", "td.samen.shot", "p", "0", "2", "3",
    "/media/environments/environment_7/samen/bg.jpg", "/media/environments/environment_7/samen/desk.png", "0.6", "0.08",
  ]);
  assert.equal(samenStaatAan(), true);
  assert.equal(environmentExtrasStatus(runtime, options).shot.aan, true);
  assert.equal(buildEnvironmentExtraCue(runtime, { soort: "shot" }, options).actions[0].payload.uit, true);
  assert.equal(samenStaatAan(), false);

  // Een cameraknop haalt het gezamenlijke shot weg.
  assert.equal(buildEnvironmentExtraCue(runtime, { soort: "shot" }, options).actions[0].payload.uit, false);
  const { createOscServer } = require("../target-adapters/osc-lite");
  const ontvangen = [];
  const port = 40000 + (process.pid % 1000);
  const server = createOscServer({ port, onMessage: (message) => ontvangen.push(message) });
  try {
    await new Promise((resolve) => setTimeout(resolve, 50));
    await sendTouchDesignerCommand(
      { cueId: "c", command: "td.camera.set", payloadId: "p", payload: { camera: 2 } },
      { adapterOptions: { tdOscHost: "127.0.0.1", tdOscPort: port } },
    );
    await new Promise((resolve) => setTimeout(resolve, 100));
  } finally {
    server.close();
  }
  const args = ontvangen.map((message) => message.args.map((arg) => (arg && typeof arg === "object" && "value" in arg ? arg.value : arg)));
  assert.deepEqual(args[1], ["c-samen-uit", "td.samen.shot", "-", "1"]);
  assert.equal(args.length, 3);
  assert.equal(samenStaatAan(), false);

  // Kapot of onvolledig bestand: gewoon het shot uit de catalogus.
  const kapot = { ...extrasOptions, readFile: () => "{ kapot" };
  assert.equal(environmentExtrasStatus(runtime, kapot).shot.label, "Shot spelbord");
  const zonderBeeld = { ...options, fileExists: (file) => !file.endsWith("bg.jpg") };
  assert.equal(environmentExtrasStatus(runtime, zonderBeeld).shot.reden, "bestand_ontbreekt");
  resetHoldState();
}

// In de zaal afstellen vanuit de catalogus.
function testZaal() {
  const runtime = runtimeFor("environment:7");
  const sfeer = buildSfeerVolumeCue(runtime, { environmentId: "environment:7", volume: 0.4 }, extrasOptions);
  assert.equal(sfeer.actions[0].command, "td.sfeer.volume");
  assert.equal(sfeer.actions[0].payload.volume, 0.4);
  assert.equal(buildSfeerVolumeCue(runtime, { volume: 3 }, extrasOptions).actions[0].payload.volume, 1);
  assert.throws(() => buildSfeerVolumeCue(runtime, { environmentId: "environment:12", volume: 0.4 }, extrasOptions), (err) => err.code === "andere_omgeving");
  assert.throws(() => buildSfeerVolumeCue(runtime, { volume: "x" }, extrasOptions), (err) => err.statusCode === 400);
  assert.throws(() => buildSfeerVolumeCue({}, { volume: 0.4 }, extrasOptions), (err) => err.code === "geen_omgeving");

  const gewoon = buildEnvironmentExtraCue(runtime, { soort: "geluid" }, extrasOptions);
  assert.equal(gewoon.actions[0].payload.volume, 0.8);
  const proberen = buildEnvironmentExtraCue(runtime, { soort: "geluid", volume: 0.25, environmentId: "environment:7" }, extrasOptions);
  assert.equal(proberen.actions[0].payload.volume, 0.25);
  assert.throws(() => buildEnvironmentExtraCue(runtime, { soort: "geluid", environmentId: "environment:11" }, extrasOptions), (err) => err.code === "andere_omgeving");
}

(async () => {
  testStatus();
  testOscArgs();
  testZaal();
  await testCameraWintVanShot();
  await testSamen();
  await testRoutes();
  fs.rmSync(tmp, { recursive: true, force: true });
  console.log("environment-extras: ok");
})().catch((err) => {
  fs.rmSync(tmp, { recursive: true, force: true });
  console.error(err);
  process.exit(1);
});

// Het extra geluid is een wisselknop: de cue geeft dat door aan de speler.
{
  const cue = buildEnvironmentExtraCue(runtimeFor("environment:7"), { soort: "geluid" }, extrasOptions);
  assert.equal(cue.actions[0].command, "audio.extra.play");
  assert.equal(cue.actions[0].payload.wissel, true);
}
