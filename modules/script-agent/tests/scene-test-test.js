"use strict";

// Scènes testen: de operator start elke situatie in een testrun, via runtime en show control.
// Runtime en show control zijn hier nagebootst; er gaat niets naar de echte diensten.

const assert = require("node:assert/strict");
const { createSceneTest } = require("../operator/scene-test");

function fakeServices() {
  const calls = [];
  let run = { showRunId: "run-1", status: "running", activeSituation: null, finalizationStatus: { status: "idle" } };
  const json = (status, body) => ({ ok: status < 400, status, json: async () => body });
  const fetchImpl = async (url, options = {}) => {
    const method = options.method || "GET";
    const body = options.body ? JSON.parse(options.body) : null;
    const pathname = new URL(url).pathname;
    calls.push(`${method} ${pathname}`);
    if (pathname === "/v0/runtime/runs/current") return json(200, run);
    if (pathname.endsWith("/test-run")) {
      run = { ...run, testRun: { enabled: body.enabled === true, markedAt: "2026-11-11T12:00:00.000Z" } };
      return json(200, run);
    }
    if (pathname.endsWith("/prepare-situation")) {
      if (!run.testRun || !run.testRun.enabled) return json(409, { ok: false, error: "runtime_not_test_run" });
      if (body.situationId === "situation:weg") return json(404, { ok: false, error: "runtime_unknown_situation" });
      assert.equal(body.testRun, true);
      run = {
        ...run,
        preparedNext: { situationId: body.situationId || "situation:1", title: "Lingo met Myrthe" },
        resolvedPreparedNext: { environment: body.environmentId ? { id: body.environmentId, name: "Trein" } : null },
      };
      return json(200, run);
    }
    if (pathname === "/v0/show-control/cues/stop-situation") {
      run = { ...run, activeSituation: null, finalizationStatus: { status: "idle" } };
      return json(201, { ok: true });
    }
    if (pathname === "/v0/show-control/cues/prepare") {
      assert.equal(body.runtimeState.preparedNext.situationId, run.preparedNext.situationId);
      return json(201, { ok: true });
    }
    if (pathname === "/v0/show-control/cues/start-situation") {
      assert.equal(body.showRunId, "run-1");
      run = { ...run, activeSituation: { situationId: run.preparedNext.situationId, title: run.preparedNext.title }, preparedNext: null };
      return json(201, { ok: true });
    }
    return json(404, {});
  };
  return { calls, fetchImpl, setRun: (next) => { run = next; }, getRun: () => run };
}

async function main() {
  const services = fakeServices();
  const sceneTest = createSceneTest({
    fetchImpl: services.fetchImpl,
    runtimeUrl: "http://runtime.test",
    showControlUrl: "http://show-control.test",
    wait: async () => {},
  });

  assert.deepEqual((await sceneTest.status()).enabled, false);
  await assert.rejects(() => sceneTest.startScene("situation:84"), /Scènes testen/, "zonder testrun start er niets");
  assert.ok(!services.calls.some((call) => call.includes("start-situation")));

  assert.equal((await sceneTest.setEnabled(true)).enabled, true);
  const started = await sceneTest.startScene("situation:84");
  assert.equal(started.title, "Lingo met Myrthe");
  assert.equal(started.status.activeSituation.situationId, "situation:84");

  // Speelt er al een scène, dan stopt die eerst via show control.
  services.calls.length = 0;
  await sceneTest.startScene("situation:14");
  const order = services.calls.filter((call) => call.startsWith("POST"));
  assert.deepEqual(order, [
    "POST /v0/show-control/cues/stop-situation",
    "POST /v0/runtime/runs/run-1/prepare-situation",
    "POST /v0/show-control/cues/prepare",
    "POST /v0/show-control/cues/start-situation",
  ]);

  await assert.rejects(() => sceneTest.startScene("situation:weg"), /catalogus/);
  await assert.rejects(() => sceneTest.startScene(""), /Kies eerst/);

  // Met een omgeving erbij, of alleen een omgeving.
  const inTrein = await sceneTest.startScene("situation:84", "environment:7");
  assert.equal(inTrein.environment, "Trein");
  const alleenOmgeving = await sceneTest.startScene("", "environment:7");
  assert.equal(alleenOmgeving.situationId, "situation:1");
  assert.equal(alleenOmgeving.environment, "Trein");

  assert.equal((await sceneTest.setEnabled(false)).enabled, false);
  await assert.rejects(() => sceneTest.startScene("situation:84"), /Scènes testen/);

  services.setRun({ status: "idle" });
  assert.equal((await sceneTest.status()).running, false);
  await assert.rejects(() => sceneTest.setEnabled(true), /geen run/);

  process.stdout.write("script-agent scene-test: ok\n");
}

main().catch((err) => {
  process.stderr.write(`${err.stack || err.message}\n`);
  process.exit(1);
});
