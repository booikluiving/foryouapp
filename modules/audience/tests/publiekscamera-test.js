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
const LAN = 39346, PUB = 39350, RUNTIME = 39344;
const dbDir = fs.mkdtempSync(path.join(os.tmpdir(), "fy-aud-camera-"));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const RUN = "show-camera-test";
const SCENE = "run:camera:1";

const runtime = http.createServer((_req, res) => {
  res.setHeader("content-type", "application/json");
  res.end(JSON.stringify({ status: "running", showRunId: RUN, activeSituation: { situationRunId: SCENE, situationId: "situation:1", title: "Een" } }));
});

const lan = (p, o) => fetch(`http://127.0.0.1:${LAN}${p}`, o);
const post = (base, p, body) => fetch(`http://127.0.0.1:${base}${p}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

let child;
async function main() {
  await new Promise((r) => runtime.listen(RUNTIME, "127.0.0.1", r));
  child = spawn(process.execPath, [path.join(ROOT, "modules/audience/server/server.js")], {
    stdio: ["ignore", "pipe", "pipe"],
    env: {
      ...process.env,
      AUDIENCE_PORT: String(LAN),
      AUDIENCE_PUBLIC_PORT: String(PUB),
      AUDIENCE_DB_DIR: dbDir,
      AUDIENCE_RUNTIME_URL: `http://127.0.0.1:${RUNTIME}`,
      AUDIENCE_ALGORITHM_URL: "http://127.0.0.1:9",
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

  // De sensor zelf (Python) stuurt een scène met een lachend gezicht.
  const jpeg = execFileSync("/opt/homebrew/bin/python3", ["-I", "-c", [
    "import sys, json, time",
    `sys.path.insert(0, ${JSON.stringify(path.join(ROOT, "show/publiekscamera"))})`,
    "from publiek_sensor import Publiek",
    "jpg = '/9j/' + 'A' * 400",
    `p = Publiek('http://127.0.0.1:${LAN}/audience/camera')`,
    "rij = lambda lach: {'fase': 'scene', 'situationRunId': '" + SCENE + "', 't': '20:00:00', 'gezichten': 4, 'lachen': lach, 'aandacht': 3, 'weg': 1, 'omlaag': 0, 'ogen_dicht': 0, 'saai': 1, 'zonder_gezicht': 0, 'beweging': 1.0, 'personen': 5, 'handen': 0, 'klappen': 0}",
    "een, een_verschoven, ander = (0.20, 0.50, 0.010, 0.04), (0.212, 0.53, 0.011, 0.04), (0.25, 0.50, 0.010, 0.04)",
    "for i in range(8): p.seconde(rij(2 if i < 3 else 0), [(een, jpg), (een_verschoven, jpg)] if i == 1 else [])",
    "p.laatst = 0; p.seconde(rij(0), [(ander, jpg), (een, jpg)])",
    "time.sleep(1.5)",
    "print(jpg)",
  ].join("\n")]).toString().trim();

  const input = await lan(`/audience/algorithm-input?showRunId=${RUN}&situationRunId=${encodeURIComponent(SCENE)}`).then((r) => r.json());
  assert.ok(input.camera, "camera zit in de invoer voor het algoritme");
  assert.equal(input.camera.seconds, 9);
  assert.equal(input.camera.peopleMax, 5);
  assert.equal(input.camera.laughMoments, 1);
  assert.equal(input.camera.headshots, 2, "dezelfde persoon maar één keer, ook als hij een beetje beweegt");

  const foto = await lan(`/audience/stage/lach/0?situationRunId=${encodeURIComponent(SCENE)}`);
  assert.equal(foto.status, 200);
  assert.equal(foto.headers.get("content-type"), "image/jpeg");
  assert.equal(Buffer.from(await foto.arrayBuffer()).toString("base64"), jpeg);
  assert.equal((await lan(`/audience/stage/lach/5?situationRunId=${encodeURIComponent(SCENE)}`)).status, 404);

  console.log("publiekscamera: ok");
}

main().catch((err) => { console.error(err); process.exitCode = 1; }).finally(() => {
  if (child) child.kill();
  runtime.close();
  fs.rmSync(dbDir, { recursive: true, force: true });
});
