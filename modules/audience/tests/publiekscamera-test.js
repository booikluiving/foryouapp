"use strict";
// Test: de publiekscamera (show/publiekscamera/publiek_sensor.py --publiek) stuurt tellingen en uitsneden van
// lachende gezichten naar audience; die gaan mee naar het algoritme en staan klaar voor het rapport.
// Start audience los: tijdelijke DB, nep-runtime op een eigen poort, raakt de draaiende show niet.
const assert = require("node:assert/strict");
const path = require("node:path");
const fs = require("node:fs");
const os = require("node:os");
const http = require("node:http");
const { spawn, execFileSync } = require("node:child_process");

const ROOT = process.argv[2] || path.resolve(__dirname, "../../..");
const LAN = 39346, PUB = 39350, RUNTIME = 39344, ALGORITME = 39348;
const dbDir = fs.mkdtempSync(path.join(os.tmpdir(), "fy-aud-camera-"));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const RUN = "show-camera-test";
const SCENE = "run:camera:1";

const runtime = http.createServer((_req, res) => {
  res.setHeader("content-type", "application/json");
  res.end(JSON.stringify({ status: "running", showRunId: RUN, activeSituation: { situationRunId: SCENE, situationId: "situation:1", title: "Een" } }));
});

// Nep-algoritme: het rapport kent de scène, met cameracijfers.
const algoritme = http.createServer((_req, res) => {
  res.setHeader("content-type", "application/json");
  res.end(JSON.stringify({ weights: { cameraLaugh: 2, cameraBored: -2 }, labels: [], scenes: [{ nr: 1, situationRunId: SCENE, title: "Een", labels: [], durationSeconds: 12, viewers: 1, hearts: 0, bored: 0, messages: 0, score: 0, calculation: {}, camera: { seconds: 12, peopleAverage: 3, peopleMax: 3 } }] }));
});

const lan = (p, o) => fetch(`http://127.0.0.1:${LAN}${p}`, o);
const post = (base, p, body) => fetch(`http://127.0.0.1:${base}${p}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

let child;
async function main() {
  await new Promise((r) => runtime.listen(RUNTIME, "127.0.0.1", r));
  await new Promise((r) => algoritme.listen(ALGORITME, "127.0.0.1", r));
  child = spawn(process.execPath, [path.join(ROOT, "modules/audience/server/server.js")], {
    stdio: ["ignore", "pipe", "pipe"],
    env: {
      ...process.env,
      AUDIENCE_PORT: String(LAN),
      AUDIENCE_PUBLIC_PORT: String(PUB),
      AUDIENCE_DB_DIR: dbDir,
      AUDIENCE_RUNTIME_URL: `http://127.0.0.1:${RUNTIME}`,
      AUDIENCE_ALGORITHM_URL: `http://127.0.0.1:${ALGORITME}`,
      AUDIENCE_SHOW_CONTROL_URL: "http://127.0.0.1:9",
      AUDIENCE_FASE_POLL_MS: "250",
    },
  });
  for (let i = 0; i < 60; i++) {
    try { if ((await lan("/health")).ok) break; } catch {}
    await sleep(100);
  }

  // Zonder scène niets.
  assert.equal((await post(LAN, "/audience/camera", { stats: { seconds: 3 } })).status, 400);
  // De publieke ingang kent het adres niet.
  assert.equal((await post(PUB, "/audience/camera", { situationRunId: SCENE, stats: { seconds: 3 } })).status, 404);

  // De sensor zelf (Python): drie mensen, 12 seconden van 5 beelden. A lacht veel (en schuift een beetje),
  // B kijkt gewoon, C kijkt veel weg.
  const jpeg = execFileSync("/opt/homebrew/bin/python3", ["-I", "-c", [
    "import sys, json, time",
    `sys.path.insert(0, ${JSON.stringify(path.join(ROOT, "show/publiekscamera"))})`,
    "from publiek_sensor import Publiek",
    "jpg = '/9j/' + 'A' * 400",
    `p = Publiek('http://127.0.0.1:${LAN}/audience/camera')`,
    "rij = {'fase': 'scene', 'situationRunId': '" + SCENE + "', 't': '20:00:00', 'gezichten': 3, 'lachen': 1, 'aandacht': 2, 'weg': 1, 'omlaag': 0, 'ogen_dicht': 0, 'saai': 1, 'zonder_gezicht': 0, 'beweging': 1.0, 'personen': 3, 'handen': 0, 'klappen': 0}",
    "A, B, C = (0.20, 0.50, 0.010, 0.04), (0.30, 0.50, 0.010, 0.04), (0.40, 0.50, 0.010, 0.04)",
    "def beeld(i):",
    "    a = (A[0] + 0.0004 * i, A[1], A[2], A[3])",
    "    return [(a, i % 5 != 0, False, jpg), (B, False, i % 5 == 0, jpg), (C, False, i % 5 != 0, jpg)]",
    "for s in range(12):",
    "    p.laatst = 0 if s == 11 else time.time()",
    "    p.seconde(dict(rij), [beeld(s * 5 + k) for k in range(5)])",
    "time.sleep(1.5)",
    "print(jpg)",
  ].join("\n")]).toString().trim();

  const input = await lan(`/audience/algorithm-input?showRunId=${RUN}&situationRunId=${encodeURIComponent(SCENE)}`).then((r) => r.json());
  assert.ok(input.camera, "camera zit in de invoer voor het algoritme");
  assert.equal(input.camera.seconds, 12);
  assert.equal(input.camera.peopleMax, 3);

  // Het rapport: de zaal in twee helften, met per persoon het percentage.
  const rapport = await lan(`/audience/stage/rapport?situationRunId=${encodeURIComponent(SCENE)}`).then((r) => r.json());
  assert.equal(rapport.klaar, true);
  const groepen = rapport.scene.camera.groepen;
  assert.deepEqual(groepen.leukst.map((g) => g.pct), [80, 0], "A lachte 80 %, B hoort ook bij de leukste helft");
  assert.deepEqual(groepen.verveeld.map((g) => g.pct), [80], "C keek 80 % verveeld");
  const foto = await lan(groepen.leukst[0].src);
  assert.equal(foto.status, 200);
  assert.equal(foto.headers.get("content-type"), "image/jpeg");
  assert.equal(Buffer.from(await foto.arrayBuffer()).toString("base64"), jpeg);
  assert.equal((await lan(`/audience/stage/persoon/99/leukst?situationRunId=${encodeURIComponent(SCENE)}`)).status, 404);

  console.log("publiekscamera: ok");
}

main().catch((err) => { console.error(err); process.exitCode = 1; }).finally(() => {
  if (child) child.kill();
  runtime.close();
  algoritme.close();
  fs.rmSync(dbDir, { recursive: true, force: true });
});
