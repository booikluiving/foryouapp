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
  // Random scènes testen: de dienst zet zelf steeds een willekeurige scène klaar (nooit een
  // startscène, nooit een scène die in deze run al gespeeld is). Starten en stoppen gaan zoals
  // altijd via de deck. De stand staat alleen in het geheugen en hoort bij de lopende run.
  const onPrepared = typeof options.onPrepared === "function" ? options.onPrepared : null;
  const randomTickMs = Number(options.randomTickMs || 1500);
  const random = { enabled: false, showRunId: null, current: null, title: "", gehad: new Set(), scriptVoor: null, bezig: false, timer: null, fout: "" };

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
      random: {
        enabled: random.enabled && Boolean(run && run.showRunId === random.showRunId),
        next: random.enabled && random.current ? { situationId: random.current, title: random.title } : null,
        error: random.fout || "",
      },
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
    if (enabled !== true) stopRandom();
    return statusFrom(result.json);
  }

  function stopRandom() {
    random.enabled = false;
    random.current = null;
    random.title = "";
    random.scriptVoor = null;
    random.fout = "";
    if (random.timer) clearInterval(random.timer);
    random.timer = null;
  }

  // Een startscène is een scène waarmee de run mag beginnen (startnode in de paden).
  function isStartScene(item) {
    return item.isPathStart === true;
  }

  function kiesRandom(run) {
    const items = (run.pathEvaluation && run.pathEvaluation.items) || [];
    const start = new Set(items.filter(isStartScene).map((item) => item.situationId));
    const gespeeld = new Set((run.playedSituations || []).map((item) => item.situationId));
    const actief = run.activeSituation ? run.activeSituation.situationId : null;
    const catalog = (run.showRunSnapshot && run.showRunSnapshot.catalog) || {};
    const alle = (catalog.situations || [])
      .filter((item) => item && item.id && item.active !== false && item.isActive !== false && !start.has(item.id) && item.id !== actief);
    let keuze = alle.filter((item) => !gespeeld.has(item.id) && !random.gehad.has(item.id));
    // Alles is geweest: opnieuw beginnen, zonder de scène die net speelde.
    if (!keuze.length) {
      random.gehad.clear();
      keuze = alle.filter((item) => item.id !== random.current);
    }
    return keuze.length ? keuze[Math.floor(Math.random() * keuze.length)] : null;
  }

  async function zetRandomKlaar(run, situationId) {
    const prepared = await request(runtimeUrl, `/v0/runtime/runs/${encodeURIComponent(run.showRunId)}/prepare-situation`, {
      method: "POST",
      body: { situationId, testRun: true },
    });
    if (!prepared.ok) {
      random.gehad.add(situationId);
      if (random.current === situationId) random.current = null;
      return null;
    }
    const next = prepared.json && prepared.json.preparedNext ? prepared.json.preparedNext : {};
    random.current = next.situationId || situationId;
    random.title = next.title || "";
    random.gehad.add(random.current);
    return prepared.json;
  }

  async function randomTick() {
    if (!random.enabled || random.bezig) return;
    random.bezig = true;
    try {
      const result = await request(runtimeUrl, "/v0/runtime/runs/current");
      const run = result.ok ? result.json : null;
      if (!statusFrom(run).enabled || run.showRunId !== random.showRunId) {
        stopRandom();
        return;
      }
      const actief = run.activeSituation ? run.activeSituation.situationId : null;
      const klaar = run.preparedNext ? run.preparedNext.situationId : null;
      // De scène die klaarstond speelt: de volgende kiezen. Die staat dan alvast klaar in de
      // runtime; bij het stoppen zet show control hem klaar in TouchDesigner.
      if (!random.current || actief === random.current) {
        const keuze = kiesRandom(run);
        if (!keuze) {
          random.fout = "Er is geen scène om te kiezen.";
          return;
        }
        await zetRandomKlaar(run, keuze.id);
      } else if (klaar !== random.current) {
        // Er is iets anders klaargezet (een scène met de hand gestart): de random scène komt terug.
        await zetRandomKlaar(run, random.current);
      }
      random.fout = "";
      if (busy(run) || !random.current || random.scriptVoor === random.current) return;
      // Er speelt niets: de scène ook klaarzetten in TouchDesigner en het script laten schrijven.
      const latest = await request(runtimeUrl, "/v0/runtime/runs/current");
      if (!latest.ok || !latest.json.preparedNext || latest.json.preparedNext.situationId !== random.current) return;
      random.scriptVoor = random.current;
      await request(showControlUrl, "/v0/show-control/cues/prepare", { method: "POST", body: { runtimeState: latest.json } });
      if (onPrepared) Promise.resolve(onPrepared({ situationId: random.current, title: random.title })).catch(() => {});
    } catch (err) {
      random.fout = err && err.message ? err.message : "Random scènes testen: er ging iets mis.";
    } finally {
      random.bezig = false;
    }
  }

  // Aan: de run wordt (zo nodig) een testrun en er staat meteen een willekeurige scène klaar.
  async function setRandom(enabled) {
    if (enabled !== true) {
      stopRandom();
      return status();
    }
    let run = await currentRun();
    if (!statusFrom(run).enabled) {
      await setEnabled(true);
      run = await currentRun();
    }
    stopRandom();
    random.enabled = true;
    random.showRunId = run.showRunId;
    random.gehad = new Set();
    random.timer = setInterval(randomTick, randomTickMs);
    if (typeof random.timer.unref === "function") random.timer.unref();
    await randomTick();
    return status();
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

  // Met een omgeving erbij speelt de situatie in die omgeving. Alleen een omgeving kan ook:
  // de runtime kiest er dan een situatie bij.
  async function startScene(situationId, environmentId) {
    const wanted = String(situationId || "").trim();
    const wantedEnvironment = String(environmentId || "").trim();
    if (!wanted && !wantedEnvironment) throw sceneTestError(400, "geen_situatie", "Kies eerst een situatie of een omgeving.");
    let run = await currentRun();
    if (!statusFrom(run).enabled) throw sceneTestError(409, "geen_testrun", "Zet eerst 'Scènes testen' aan.");
    if (busy(run)) run = await stopActive(run);

    const prepared = await request(runtimeUrl, `/v0/runtime/runs/${encodeURIComponent(run.showRunId)}/prepare-situation`, {
      method: "POST",
      body: { situationId: wanted, ...(wantedEnvironment ? { environmentId: wantedEnvironment } : {}), testRun: true },
    });
    if (!prepared.ok) {
      const code = prepared.json && prepared.json.error;
      if (code === "runtime_unknown_situation") throw sceneTestError(404, "onbekend", "Deze situatie staat niet (actief) in de catalogus.");
      if (code === "runtime_unknown_environment") throw sceneTestError(404, "onbekend", "Deze omgeving staat niet in de catalogus.");
      if (code === "runtime_not_test_run") throw sceneTestError(409, "geen_testrun", "Zet eerst 'Scènes testen' aan.");
      throw sceneTestError(502, "klaarzetten_mislukt", "De scène klaarzetten lukte niet.");
    }

    // De gekozen scène ook klaarzetten in TouchDesigner, de teleprompter en de operator. Zonder
    // deze stap staat daar nog de volgende scène van het pad klaar en springt het beeld daarheen.
    const readied = await request(showControlUrl, "/v0/show-control/cues/prepare", {
      method: "POST",
      body: { runtimeState: prepared.json },
    });
    if (!readied.ok) throw sceneTestError(502, "klaarzetten_mislukt", "De scène klaarzetten in TouchDesigner lukte niet.");

    const started = await request(showControlUrl, "/v0/show-control/cues/start-situation", {
      method: "POST",
      body: { name: "Scènes testen: start situatie", showRunId: run.showRunId, runtimeState: prepared.json },
    });
    if (!started.ok) throw sceneTestError(502, "start_mislukt", "De scène staat klaar, maar starten via show control lukte niet.");
    const next = prepared.json && prepared.json.preparedNext ? prepared.json.preparedNext : {};
    const resolved = prepared.json && prepared.json.resolvedPreparedNext ? prepared.json.resolvedPreparedNext : {};
    return {
      ok: true,
      situationId: next.situationId || wanted,
      title: next.title || "",
      environment: resolved.environment ? resolved.environment.name || "" : "",
      status: await status(),
    };
  }

  return { setEnabled, setRandom, startScene, status };
}

module.exports = {
  createSceneTest,
  showControlBaseUrl,
};
