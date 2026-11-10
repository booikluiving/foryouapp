"use strict";

// Extra shot en extra geluid per omgeving: status voor het deck en de cue die
// afgevuurd wordt. Raakt geen hardware: adapters zijn vervangen door opnemers.

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const tmp = path.resolve(__dirname, "..", `.tmp-extras-db-${process.pid}`);
fs.mkdirSync(tmp, { recursive: true });
process.env.V2_SHOW_CONTROL_DB_DIR = path.join(tmp, "db");
process.env.V2_SHOW_CONTROL_ADAPTER_MODE = "test";

const { createShowControlApp } = require("../server/app");
const { environmentExtrasStatus, resetHoldState } = require("../cue-library/environment-extras");
const { oscArgsForAction } = require("../target-adapters/touchdesigner-adapter");

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
}

(async () => {
  testStatus();
  testOscArgs();
  await testRoutes();
  fs.rmSync(tmp, { recursive: true, force: true });
  console.log("environment-extras: ok");
})().catch((err) => {
  fs.rmSync(tmp, { recursive: true, force: true });
  console.error(err);
  process.exit(1);
});
