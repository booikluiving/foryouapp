"use strict";

// Scènes testen vanuit de operator. Dit loopt via de regie van show control (de ene weg): de operator
// neemt de regie over als "operator" (stand test of random), laadt en start scènes daar, en geeft
// vrij als hij klaar is. Heeft iemand anders de regie, dan meldt de regie wie.

const DEFAULT_SHOW_CONTROL_BASE_URL = "http://127.0.0.1:3025";
const OPERATOR = "operator";

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
  const showControlUrl = options.showControlUrl || showControlBaseUrl(env);

  async function regie(pad, { method = "GET", body, timeoutMs = 20000 } = {}) {
    let antwoord;
    try {
      antwoord = await fetchImpl(`${showControlUrl}/v0/show-control/regie${pad}`, {
        method,
        headers: { "content-type": "application/json", "x-foryou-wie": OPERATOR },
        body: body === undefined ? undefined : JSON.stringify({ wie: OPERATOR, ...body }),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (_err) {
      throw sceneTestError(502, "onbereikbaar", "Show control is niet bereikbaar.");
    }
    const json = await antwoord.json().catch(() => ({}));
    if (!antwoord.ok) throw sceneTestError(antwoord.status, json.error || "regie_fout", json.message || "De regie weigerde.");
    return json;
  }

  // Zelfde vorm als vroeger, voor de operatorpagina.
  function statusFrom(overzicht) {
    const run = overzicht && overzicht.run ? overzicht.run : null;
    const eigen = !!(overzicht && overzicht.eigenaar && overzicht.eigenaar.wie === OPERATOR && !overzicht.verlopen);
    return {
      running: !!(run && run.status === "running"),
      showRunId: run ? run.showRunId : null,
      enabled: eigen && overzicht.stand !== "show",
      markedAt: run && run.testRun ? "testrun" : null,
      activeSituation: run && run.speelt ? run.speelt : null,
      regie: overzicht ? { stand: overzicht.stand, eigenaar: overzicht.eigenaar, schrijven: overzicht.schrijven } : null,
      random: {
        enabled: eigen && overzicht.stand === "random",
        next: eigen && overzicht.stand === "random" && run && run.klaar ? run.klaar : null,
        error: overzicht && overzicht.random ? overzicht.random.fout || "" : "",
      },
    };
  }

  async function status() {
    try {
      return statusFrom(await regie(""));
    } catch (_err) {
      return statusFrom(null);
    }
  }

  async function setEnabled(enabled) {
    if (enabled === true) return statusFrom(await regie("/overnemen", { method: "POST", body: { stand: "test" } }));
    return statusFrom(await regie("/vrijgeven", { method: "POST", body: {}, timeoutMs: 40000 }));
  }

  async function setRandom(enabled) {
    return statusFrom(await regie("/overnemen", { method: "POST", body: { stand: enabled === true ? "random" : "test" }, timeoutMs: 40000 }));
  }

  async function startScene(situationId, environmentId) {
    const wanted = String(situationId || "").trim();
    const wantedEnvironment = String(environmentId || "").trim();
    if (!wanted && !wantedEnvironment) throw sceneTestError(400, "geen_situatie", "Kies eerst een situatie of een omgeving.");
    const overzicht = await regie("/laad", {
      method: "POST",
      body: { situationId: wanted, environmentId: wantedEnvironment, start: true },
      timeoutMs: 120000,
    });
    const run = overzicht.run || {};
    return {
      ok: true,
      situationId: run.speelt ? run.speelt.situationId : wanted,
      title: run.speelt ? run.speelt.title : "",
      environment: "",
      status: statusFrom(overzicht),
    };
  }

  return { setEnabled, setRandom, startScene, status };
}

module.exports = {
  createSceneTest,
  showControlBaseUrl,
};
