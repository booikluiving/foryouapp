"use strict";

// Scènes testen vanuit de operator: elke situatie starten, los van de paden. Kan alleen in een
// testrun. De runtime zet de gekozen situatie klaar met de catalogus van nu; starten en stoppen
// gaan via show control, precies zoals de Stream Deck dat doet.

const { runtimeBaseUrl } = require("../client/runtime-client");

const DEFAULT_SHOW_CONTROL_BASE_URL = "http://127.0.0.1:3025";

function showControlBaseUrl(env = process.env) {
  return String(env.SCRIPT_AGENT_SHOW_CONTROL_URL || env.SHOW_CONTROL_URL || DEFAULT_SHOW_CONTROL_BASE_URL).replace(/\/+$/, "");
}

function sceneTestError(statusCode, code, message) {
  const err = new Error(message);
  err.statusCode = statusCode;
  err.code = code;
  return err;
}

function createSceneTest(options = {}) {
  const env = options.env || process.env;
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  const runtimeUrl = options.runtimeUrl || runtimeBaseUrl();
  const showControlUrl = options.showControlUrl || showControlBaseUrl(env);
  const wait = options.wait || ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  const stopTimeoutMs = Number(options.stopTimeoutMs || 15000);

  async function request(baseUrl, pathname, { method = "GET", body } = {}) {
    let response;
    try {
      response = await fetchImpl(`${baseUrl}${pathname}`, {
        method,
        headers: body === undefined ? {} : { "content-type": "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    } catch (err) {
      throw sceneTestError(502, "onbereikbaar", `${baseUrl} is niet bereikbaar.`);
    }
    const json = await response.json().catch(() => null);
    return { ok: response.ok, status: response.status, json };
  }

  async function currentRun() {
    const result = await request(runtimeUrl, "/v0/runtime/runs/current");
    const run = result.ok ? result.json : null;
    if (!run || !run.showRunId || run.status !== "running") {
      throw sceneTestError(409, "geen_run", "Er loopt geen run. Start eerst een run.");
    }
    return run;
  }

  function statusFrom(run) {
    const testRun = run && run.testRun ? run.testRun : null;
    return {
      running: Boolean(run && run.showRunId && run.status === "running"),
      showRunId: run && run.showRunId ? run.showRunId : null,
      enabled: Boolean(testRun && testRun.enabled === true),
      markedAt: testRun && testRun.markedAt ? testRun.markedAt : null,
      activeSituation: run && run.activeSituation
        ? { situationId: run.activeSituation.situationId, title: run.activeSituation.title || "" }
        : null,
    };
  }

  async function status() {
    try {
      const result = await request(runtimeUrl, "/v0/runtime/runs/current");
      return statusFrom(result.ok ? result.json : null);
    } catch (_err) {
      return statusFrom(null);
    }
  }

  async function setEnabled(enabled) {
    const run = await currentRun();
    const result = await request(runtimeUrl, `/v0/runtime/runs/${encodeURIComponent(run.showRunId)}/test-run`, {
      method: "POST",
      body: { enabled: enabled === true },
    });
    if (!result.ok) throw sceneTestError(502, "runtime_fout", "De runtime kon de testrun niet zetten.");
    return statusFrom(result.json);
  }

  function busy(run) {
    const finalization = run && run.finalizationStatus && run.finalizationStatus.status;
    return Boolean(run && run.activeSituation) || finalization === "pending" || finalization === "running";
  }

  async function stopActive(run) {
    const stopped = await request(showControlUrl, "/v0/show-control/cues/stop-situation", {
      method: "POST",
      body: { name: "Scènes testen: stop situatie", showRunId: run.showRunId, runtimeState: run },
    });
    if (!stopped.ok) throw sceneTestError(502, "stop_mislukt", "De lopende scène stoppen lukte niet.");
    const deadline = Date.now() + stopTimeoutMs;
    let latest = await currentRun();
    while (busy(latest)) {
      if (Date.now() > deadline) throw sceneTestError(504, "stop_te_lang", "De lopende scène is nog niet afgerond. Probeer het zo opnieuw.");
      await wait(400);
      latest = await currentRun();
    }
    return latest;
  }

  async function startScene(situationId) {
    const wanted = String(situationId || "").trim();
    if (!wanted) throw sceneTestError(400, "geen_situatie", "Kies eerst een situatie.");
    let run = await currentRun();
    if (!statusFrom(run).enabled) throw sceneTestError(409, "geen_testrun", "Zet eerst 'Scènes testen' aan.");
    if (busy(run)) run = await stopActive(run);

    const prepared = await request(runtimeUrl, `/v0/runtime/runs/${encodeURIComponent(run.showRunId)}/prepare-situation`, {
      method: "POST",
      body: { situationId: wanted, testRun: true },
    });
    if (!prepared.ok) {
      const code = prepared.json && prepared.json.error;
      if (code === "runtime_unknown_situation") throw sceneTestError(404, "onbekend", "Deze situatie staat niet (actief) in de catalogus.");
      if (code === "runtime_not_test_run") throw sceneTestError(409, "geen_testrun", "Zet eerst 'Scènes testen' aan.");
      throw sceneTestError(502, "klaarzetten_mislukt", "De scène klaarzetten lukte niet.");
    }

    const started = await request(showControlUrl, "/v0/show-control/cues/start-situation", {
      method: "POST",
      body: { name: "Scènes testen: start situatie", showRunId: run.showRunId, runtimeState: prepared.json },
    });
    if (!started.ok) throw sceneTestError(502, "start_mislukt", "De scène staat klaar, maar starten via show control lukte niet.");
    const title = prepared.json && prepared.json.preparedNext ? prepared.json.preparedNext.title || "" : "";
    return { ok: true, situationId: wanted, title, status: await status() };
  }

  return { setEnabled, startScene, status };
}

module.exports = {
  createSceneTest,
  showControlBaseUrl,
};
