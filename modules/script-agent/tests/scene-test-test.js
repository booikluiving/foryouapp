"use strict";

// Scènes testen vanuit de operator loopt via de regie van show control (één weg). Show control is
// hier nagebootst; er gaat niets naar de echte diensten.

const assert = require("node:assert/strict");
const { createSceneTest } = require("../operator/scene-test");

function fakeRegie() {
  const calls = [];
  let overzicht = { ok: true, stand: "show", eigenaar: null, verlopen: false, schrijven: false, run: { showRunId: "run-1", status: "running", testRun: false, speelt: null, klaar: null } };
  const json = (status, body) => ({ ok: status < 400, status, json: async () => body });
  const fetchImpl = async (url, options = {}) => {
    const method = options.method || "GET";
    const body = options.body ? JSON.parse(options.body) : null;
    const pathname = new URL(url).pathname;
    calls.push({ method, pathname, wie: options.headers && options.headers["x-foryou-wie"], body });
    if (pathname === "/v0/show-control/regie") return json(200, overzicht);
    if (pathname === "/v0/show-control/regie/overnemen") {
      if (overzicht.eigenaar && overzicht.eigenaar.wie !== body.wie) return json(423, { ok: false, error: "regie_bezet", message: `De regie is van ${overzicht.eigenaar.wie}.` });
      overzicht = { ...overzicht, stand: body.stand, eigenaar: { wie: body.wie }, run: { ...overzicht.run, testRun: true } };
      return json(200, overzicht);
    }
    if (pathname === "/v0/show-control/regie/vrijgeven") {
      overzicht = { ...overzicht, stand: "show", eigenaar: null, run: { ...overzicht.run, status: "reset", testRun: false } };
      return json(200, overzicht);
    }
    if (pathname === "/v0/show-control/regie/laad") {
      overzicht = { ...overzicht, run: { ...overzicht.run, speelt: body.start ? { situationId: body.situationId, title: "Lingo met Myrthe" } : null, klaar: { situationId: body.situationId, title: "Lingo met Myrthe" } } };
      return json(200, overzicht);
    }
    return json(404, { ok: false });
  };
  return { calls, fetchImpl, zetEigenaar: (wie) => { overzicht = { ...overzicht, stand: "test", eigenaar: { wie } }; } };
}

(async () => {
  const regie = fakeRegie();
  const test = createSceneTest({ fetchImpl: regie.fetchImpl, showControlUrl: "http://sc.test" });

  let status = await test.status();
  assert.equal(status.enabled, false);
  assert.equal(status.running, true);

  status = await test.setEnabled(true);
  assert.equal(status.enabled, true, "aanzetten = regie overnemen als operator");
  assert.equal(regie.calls.at(-1).wie, "operator");
  assert.equal(regie.calls.at(-1).body.stand, "test");

  const gestart = await test.startScene("situation:29", "");
  assert.equal(gestart.situationId, "situation:29");
  assert.equal(regie.calls.at(-1).pathname, "/v0/show-control/regie/laad");
  assert.equal(regie.calls.at(-1).body.start, true, "start scène = inladen en starten via de regie");

  status = await test.setRandom(true);
  assert.equal(status.random.enabled, true);

  status = await test.setEnabled(false);
  assert.equal(status.enabled, false, "uitzetten = vrijgeven");
  assert.equal(regie.calls.at(-1).pathname, "/v0/show-control/regie/vrijgeven");

  // Iemand anders heeft de regie: de operator krijgt de melding van de regie.
  regie.zetEigenaar("escape-room");
  await assert.rejects(test.setEnabled(true), (err) => err.statusCode === 423 && /escape-room/.test(err.message));
  status = await test.status();
  assert.equal(status.enabled, false);
  assert.equal(status.regie.eigenaar.wie, "escape-room");

  await assert.rejects(test.startScene("", ""), (err) => err.statusCode === 400);
  console.log("scene-test-test: ok");
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
