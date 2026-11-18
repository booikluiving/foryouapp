"use strict";

const path = require("node:path");

const {
  SHOW_CONTROL_ACK_SCHEMA_VERSION,
  SHOW_CONTROL_CUE_SCHEMA_VERSION,
  SHOW_CONTROL_STATUS_SCHEMA_VERSION,
} = require("../../../shared/contracts/show-control-v0");
const { listCommands } = require("../command-registry/command-registry");
const { fetchCurrentRuntimeState } = require("../client/runtime-client");
const { listActiveStreamDeckCues } = require("../streamdeck-active-cues");
const { applyAck, executeCue, executeUitgesteld, normalizeCue } = require("../cue-engine/cue-engine");
const { recordAck } = require("../cue-engine/ack-tracker");
const { findCachedPayload } = require("../cue-engine/payload-cache");
const { summarizeCue, summarizeCues } = require("../cue-engine/cue-summary");
const {
  findCuePayload,
  readIndexedPayload,
  archiveCue,
  readCue,
  readCueSummary,
  readCues,
  readTriggerBinding,
  readTriggerBindings,
  saveCue: saveCueOpslag,
  saveTriggerBinding,
} = require("../cue-engine/state-store");
const {
  buildCompoundCue,
  buildEnvironmentMediaRefreshCue,
  buildGoCue,
  buildPhaseCue,
  buildPrepareCue,
  buildSceneToChatCue,
  buildStartRunCue,
  buildStartSituationCue,
  buildStopSituationCue,
} = require("../cue-library/runtime-cues");
const {
  buildEnvironmentExtraCue,
  buildSfeerVolumeCue,
  environmentExtrasStatus,
  publicExtrasStatus,
} = require("../cue-library/environment-extras");
const {
  environmentVanzelfTick,
  buildEnvironmentOmvallenCue,
  environmentOmvallenStatus,
  publicOmvallenStatus,
} = require("../cue-library/environment-omvallen");
const { buildEnvironmentFaseCue, environmentFasesStatus, publicFasesStatus } = require("../cue-library/environment-fases");
const { sceneEindeTick } = require("../cue-library/scene-einde");
const { buildEnvironmentKnopCue, environmentKnoppenStatus } = require("../cue-library/environment-knoppen");
const { buildPersonageKnopCue, personageKnopStatus, publicPersonageKnopStatus } = require("../cue-library/personage-knop");
const {
  registratieStatus,
  registratieTick,
  startRegistratie,
  stopRegistratie,
} = require("../registratie/registratie");
const { cameraBaseUrl } = require("../target-adapters/camera-adapter");
const { dmxBaseUrl } = require("../target-adapters/dmx-adapter");
const { perfectCueBaseUrl } = require("../target-adapters/perfect-cue-adapter");
const { sq5BaseUrl } = require("../target-adapters/sq5-adapter");
const { streamDeckBaseUrl } = require("../target-adapters/streamdeck-adapter");
const { loadExpress } = require("./express-loader");
const { createRegie } = require("../regie/regie");
const { createBewaker } = require("../regie/bewaker");

// Elke cue die show control bewaart, gaat langs de bewaker (welke fase TouchDesigner bevestigde).
let bewakerZag = null;
async function saveCue(cue) {
  if (bewakerZag) {
    try { bewakerZag(cue); } catch (_err) { /* de bewaker mag het bewaren nooit hinderen */ }
  }
  return saveCueOpslag(cue);
}

const express = loadExpress();

function asyncRoute(handler) {
  return (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
}

function httpError(statusCode, message) {
  const err = new Error(message);
  err.statusCode = statusCode;
  return err;
}

function showControlClients() {
  return {
    fetchCurrentRuntimeState,
  };
}

function showControlAdapterOptions(options = {}) {
  return {
    runtimeBaseUrl: process.env.SHOW_CONTROL_RUNTIME_URL,
    sq5BaseUrl: process.env.SHOW_CONTROL_SQ5_URL,
    cameraBaseUrl: process.env.SHOW_CONTROL_CAMERA_URL,
    dmxBaseUrl: process.env.SHOW_CONTROL_DMX_URL,
    streamDeckBaseUrl: process.env.SHOW_CONTROL_STREAMDECK_URL,
    perfectCueBaseUrl: process.env.SHOW_CONTROL_PERFECT_CUE_URL,
    scriptAgentBaseUrl: process.env.SHOW_CONTROL_SCRIPT_AGENT_URL,
    tdOscHost: process.env.SHOW_CONTROL_TD_OSC_HOST,
    tdOscPort: process.env.SHOW_CONTROL_TD_OSC_PORT,
    tdAckPort: process.env.SHOW_CONTROL_TD_ACK_PORT,
    ...(options.adapterOptions || {}),
  };
}

function wantsFullDetail(req) {
  return req.query.detail === "full" || req.query.full === "1" || req.query.full === "true";
}

async function runtimeStateForRequest(req, clients) {
  if (req.body && req.body.runtimeState) return req.body.runtimeState;
  const runtimeResult = await clients.fetchCurrentRuntimeState();
  if (!runtimeResult.ok) throw httpError(502, `show_control_runtime_unavailable:${runtimeResult.error || "unknown"}`);
  return runtimeResult.state;
}

// Voor de status van de omgevingsknoppen: nooit langer wachten dan even, zodat
// /status (elke seconde door deck-status) niet blijft hangen op Runtime.
async function runtimeStateQuick(req, clients, timeoutMs = 500) {
  let timer = null;
  try {
    return await Promise.race([
      runtimeStateForRequest(req, clients),
      new Promise((resolve) => { timer = setTimeout(() => resolve(null), timeoutMs); }),
    ]);
  } catch (_err) {
    return null;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function handleAckPayload(payload) {
  if (!payload || !payload.cueId) throw httpError(400, "show_control_missing_cue_id");
  try {
    const cue = await readCue(String(payload.cueId));
    const result = applyAck(cue, payload);
    await saveCue(result.cue);
    return { statusCode: 201, body: { ok: true, ack: result.ack, cue: result.cue } };
  } catch (err) {
    if (!String(err && err.message).startsWith("show_control_cue_not_found:")) throw err;
    const ack = recordAck(payload);
    return { statusCode: 202, body: { ok: true, ack, queued: true } };
  }
}

async function fetchHardwareProbe(name, baseUrl, pathName) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 350);
  const url = `${baseUrl}${pathName}`;
  try {
    const response = await fetch(url, { signal: controller.signal });
    const text = await response.text();
    let body = {};
    try {
      body = text ? JSON.parse(text) : {};
    } catch (_err) {
      body = { raw: text };
    }
    return {
      name,
      ok: response.ok,
      status: response.status,
      url,
      service: body.service || name,
      ...(body.summary && typeof body.summary === "object" ? { summary: body.summary } : {}),
      checkedAt: new Date().toISOString(),
    };
  } catch (err) {
    return {
      name,
      ok: false,
      status: 0,
      url,
      error: err && err.name === "AbortError" ? "timeout" : err.message || String(err),
      checkedAt: new Date().toISOString(),
    };
  } finally {
    clearTimeout(timeout);
  }
}

async function hardwareStatus(adapterOptions = {}) {
  const probes = await Promise.all([
    fetchHardwareProbe("sq5", sq5BaseUrl(adapterOptions), "/api/status"),
    fetchHardwareProbe("camera", cameraBaseUrl(adapterOptions), "/api/state"),
    fetchHardwareProbe("dmx", dmxBaseUrl(adapterOptions), "/api/state"),
    fetchHardwareProbe("streamdeck", streamDeckBaseUrl(adapterOptions), "/api/state"),
    fetchHardwareProbe("perfectCue", perfectCueBaseUrl(adapterOptions), "/api/state"),
  ]);
  return Object.fromEntries(probes.map((probe) => [probe.name, probe]));
}

function createShowControlApp(options = {}) {
  const app = express();
  const startedAt = new Date();
  const clients = options.clients || showControlClients();
  const uiRoot = path.resolve(__dirname, "../ui/control");
  const sharedUiRoot = path.resolve(__dirname, "../../../shared/ui");
  const executeOptions = {
    adapters: options.adapters || {},
    adapterOptions: showControlAdapterOptions(options),
  };
  // De run-stand die de teleprompter en Scènes testen meesturen is ruim 1 MB (de catalogus zit erin).
  app.use(express.json({ limit: "16mb" }));

  // Regie: de ene weg om run en scènes te bedienen (stand show/test/random, één eigenaar, één voor één).
  const regie = options.regie || createRegie({
    bestand: options.regiePath,
    fetchImpl: options.regieFetch,
    cues: {
      buildCompoundCue,
      buildPhaseCue,
      buildPrepareCue,
      buildSceneToChatCue,
      buildStartRunCue,
      buildStartSituationCue,
      buildStopSituationCue,
      executeCue: (cue, extra = {}) => executeCue(cue, { ...executeOptions, ...extra }),
      executeUitgesteld: (cue) => executeUitgesteld(cue, executeOptions),
      saveCue,
    },
  });
  app.locals.regie = regie;
  // Bewaker: TouchDesigner en teleprompter volgen de runtime; herstelt afwijkingen (zie bewaker.js).
  const bewaker = options.bewaker === false ? null : createBewaker({
    tdPad: options.tdShowPad,
    cues: {
      buildGoCue,
      buildPhaseCue,
      buildPrepareCue,
      executeCue: (cue, extra = {}) => executeCue(cue, { ...executeOptions, ...extra }),
      saveCue,
    },
  });
  app.locals.bewaker = bewaker;
  if (bewaker) {
    bewakerZag = (cue) => bewaker.zagCue(cue);
    // Bij het opstarten: de laatst bevestigde fase uit de bewaarde cues.
    readCues({ includeArchived: true })
      .then((lijst) => lijst
        .filter((cue) => (cue.actions || []).some((action) => action.command === "td.phase.set"))
        .sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)))
        .forEach((cue) => bewaker.zagCue(cue)))
      .catch(() => {});
  }
  const regieRoutes = [
    "/v0/show-control/cues/start-run",
    "/v0/show-control/cues/start-situation",
    "/v0/show-control/cues/stop-situation",
    "/v0/show-control/cues/prepare",
    "/v0/show-control/cues/prepare-situation",
    "/v0/show-control/cues/overslaan",
    "/v0/show-control/cues/scene-to-chat",
    "/v0/show-control/cues/phase",
  ];
  function regieWacht(req, res, next) {
    const uitkomst = regie.mag(req);
    if (!uitkomst.ok) {
      res.status(uitkomst.status).json(uitkomst.body);
      return;
    }
    next();
  }
  app.post(regieRoutes, regieWacht);
  // Losse cues die de run veranderen (RESET RUN op de deck) of READY: zelfde bewaking.
  function raaktRun(body) {
    const acties = [...(body && Array.isArray(body.actions) ? body.actions : []), ...((body && Array.isArray(body.steps) ? body.steps : []).flatMap((stap) => (stap && Array.isArray(stap.actions) ? stap.actions : [])))];
    return acties.some((actie) => actie && /^runtime\.|^teleprompter\.ready$/.test(String(actie.command || "")));
  }
  app.post("/v0/show-control/cues", (req, res, next) => (raaktRun(req.body) ? regieWacht(req, res, next) : next()));

  app.get("/", (_req, res) => {
    res.redirect("/show-control/");
  });

  app.use("/shared/ui", express.static(sharedUiRoot));
  app.use("/show-control", express.static(uiRoot, { extensions: ["html"] }));
  app.use("/regie", express.static(path.resolve(__dirname, "../ui/regie"), { extensions: ["html"] }));

  app.get("/health", (_req, res) => {
    const port = Number(process.env.SHOW_CONTROL_PORT || process.env.PORT || options.port || 3025);
    const adapterMode = String(process.env.SHOW_CONTROL_ADAPTER_MODE || "live");
    res.json({
      ok: true,
      service: "show-control",
      version: "v0",
      cueSchemaVersion: SHOW_CONTROL_CUE_SCHEMA_VERSION,
      ackSchemaVersion: SHOW_CONTROL_ACK_SCHEMA_VERSION,
      statusSchemaVersion: SHOW_CONTROL_STATUS_SCHEMA_VERSION,
      port,
      startedAt: startedAt.toISOString(),
      uptimeSeconds: Math.round(process.uptime()),
      adapterMode,
      liveHardwareDefault: adapterMode === "live",
    });
  });

  app.get("/v0/show-control/commands", (_req, res) => {
    const commands = listCommands();
    res.json({ ok: true, count: commands.length, commands });
  });

  app.get("/v0/show-control/active-cues", (_req, res) => {
    const commandNames = new Set(listCommands().map((command) => command.name));
    const cues = listActiveStreamDeckCues().map((cue) => ({
      ...cue,
      states: cue.states.map((state) => ({
        ...state,
        commandsAvailable: state.commands.every((command) => commandNames.has(command)),
      })),
    }));
    res.json({ ok: true, count: cues.length, cues });
  });

  // ---------- Regie ----------
  function regieRoute(fn) {
    return async (req, res) => {
      try {
        res.json(await fn(req));
      } catch (err) {
        res.status(err && err.statusCode ? err.statusCode : 500).json({
          ok: false,
          error: err && err.code ? err.code : "regie_fout",
          message: err && err.message ? err.message : "Er ging iets mis.",
          ...(err && err.eigenaar ? { eigenaar: err.eigenaar } : {}),
        });
      }
    };
  }
  const regieWie = (req) => (req.get("x-foryou-wie") || (req.body && req.body.wie) || "");
  app.get("/v0/show-control/regie", regieRoute(async () => ({ ...(await regie.overzicht()), controle: bewaker ? bewaker.status() : null })));
  app.get("/v0/show-control/regie/catalogus", regieRoute(() => regie.catalogus()));
  app.post("/v0/show-control/regie/overnemen", regieRoute((req) => regie.overnemen({ wie: regieWie(req), stand: req.body && req.body.stand, minuten: req.body && req.body.minuten, forceer: !!(req.body && req.body.forceer === true) })));
  app.post("/v0/show-control/regie/vrijgeven", regieRoute((req) => regie.vrijgeven({ wie: regieWie(req) })));
  app.post("/v0/show-control/regie/schrijven", regieRoute((req) => regie.zetSchrijven({ wie: regieWie(req), schrijven: req.body && req.body.schrijven === true })));
  app.post("/v0/show-control/regie/laad", regieRoute((req) => regie.laad({
    wie: regieWie(req),
    situationId: req.body && req.body.situationId,
    environmentId: req.body && req.body.environmentId,
    start: !!(req.body && req.body.start === true),
    schrijven: req.body && typeof req.body.schrijven === "boolean" ? req.body.schrijven : undefined,
  })));
  app.post("/v0/show-control/regie/start", regieRoute((req) => regie.start({ wie: regieWie(req) })));
  app.post("/v0/show-control/regie/stop", regieRoute((req) => regie.stop({ wie: regieWie(req) })));
  app.post("/v0/show-control/regie/random", regieRoute((req) => regie.volgendeRandom({ wie: regieWie(req) })));

  // Een gekozen scène klaarzetten (stemwinnaar): runtime én TouchDesigner/teleprompter in één stap,
  // via de ene weg. Vroeger zette het publiek de runtime zelf klaar en volgde show control misschien.
  app.post("/v0/show-control/cues/prepare-situation", asyncRoute(async (req, res) => {
    const body = req.body || {};
    const situationId = String(body.situationId || "").trim();
    if (!situationId) throw httpError(400, "show_control_missing_situation_id");
    await regie.slot(async () => {
      const huidig = await clients.fetchCurrentRuntimeState();
      const showRunId = String(body.showRunId || (huidig && huidig.ok && huidig.state ? huidig.state.showRunId : "") || "");
      if (!showRunId) throw httpError(409, "show_control_no_show_run");
      const runtimeBasis = String(process.env.SHOW_CONTROL_RUNTIME_URL || "http://127.0.0.1:3024").replace(/\/+$/, "");
      const antwoord = await fetch(`${runtimeBasis}/v0/runtime/runs/${encodeURIComponent(showRunId)}/prepare-situation`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ situationId }),
        signal: AbortSignal.timeout(8000),
      });
      const state = await antwoord.json().catch(() => null);
      if (!antwoord.ok || !state) throw httpError(antwoord.status || 502, (state && state.error) || "show_control_runtime_prepare_failed");
      const cue = buildPrepareCue(state);
      await executeCue(cue, executeOptions);
      await saveCue(cue);
      res.status(201).json({ ok: true, state, cueId: cue.cueId });
    });
  }));

  app.post("/v0/show-control/cues/prepare", asyncRoute(async (req, res) => {
    await regie.slot(async () => {
      const runtimeState = await runtimeStateForRequest(req, clients);
      const cue = buildPrepareCue(runtimeState, {
        simulateTargetTimeout: !!(req.body && req.body.simulateTargetTimeout),
      });
      await executeCue(cue, executeOptions);
      await saveCue(cue);
      res.status(201).json({ ok: true, cue });
    });
  }));

  app.post("/v0/show-control/cues/go", asyncRoute(async (req, res) => {
    const runtimeState = await runtimeStateForRequest(req, clients);
    const cue = buildGoCue(runtimeState);
    await executeCue(cue, { ...executeOptions, nonBlocking: true });
    await saveCue(cue);
    res.status(202).json({ ok: true, cue });
  }));

  app.post("/v0/show-control/cues/scene-to-chat", asyncRoute(async (req, res) => {
    const runtimeState = await runtimeStateForRequest(req, clients);
    const cue = buildSceneToChatCue(runtimeState, {
      name: req.body ? req.body.name : null,
      sessionId: req.body && req.body.sessionId,
      sourceId: req.body && req.body.sourceId,
      timeoutMs: req.body && req.body.timeoutMs,
    });
    await executeCue(cue, executeOptions);
    await saveCue(cue);
    res.status(201).json({ ok: true, cue });
  }));

  app.post("/v0/show-control/cues", asyncRoute(async (req, res) => {
    const cue = buildCompoundCue({
      name: req.body ? req.body.name : null,
      actions: req.body && Array.isArray(req.body.actions) ? req.body.actions : [],
      steps: req.body && Array.isArray(req.body.steps) ? req.body.steps : null,
    });
    if (raaktRun(req.body)) {
      await regie.slot(async () => { await executeCue(cue, executeOptions); await saveCue(cue); });
    } else {
      await executeCue(cue, executeOptions);
      await saveCue(cue);
    }
    res.status(201).json({ ok: true, cue });
    // READY (de spelers staan klaar): het stemmen na de scène hoeft niet uit te lopen.
    const acties = [...(req.body && Array.isArray(req.body.actions) ? req.body.actions : []), ...((req.body && Array.isArray(req.body.steps) ? req.body.steps : []).flatMap((stap) => (stap && Array.isArray(stap.actions) ? stap.actions : [])))];
    const readyActie = acties.find((actie) => actie && actie.command === "teleprompter.ready");
    if (readyActie) {
      const publiek = String(process.env.SHOW_CONTROL_AUDIENCE_URL || "http://127.0.0.1:3026").replace(/\/+$/, "");
      const ready = !(readyActie.payload && readyActie.payload.ready === false);
      if (ready) fetch(`${publiek}/audience/admin/beoordeling/sluit`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}", signal: AbortSignal.timeout(2000) }).catch(() => {});
      // Up next op het hoofdscherm laat zien dat de spelers klaar zijn.
      fetch(`${publiek}/audience/admin/ready`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ready }), signal: AbortSignal.timeout(3000) }).catch(() => {});
    }
  }));

  // START SHOW: de run loopt en het inloopscherm staat; nu mag de eerste scène gekozen worden.
  app.post("/v0/show-control/cues/start-show", asyncRoute(async (_req, res) => {
    const publiek = String(process.env.SHOW_CONTROL_AUDIENCE_URL || "http://127.0.0.1:3026").replace(/\/+$/, "");
    const antwoord = await fetch(`${publiek}/audience/admin/show/start`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}", signal: AbortSignal.timeout(3000) });
    const body = await antwoord.json().catch(() => ({}));
    res.status(antwoord.ok ? 201 : 409).json({ ok: antwoord.ok, ...body });
  }));

  // CONTENT WARNING: de stap tussen START RUN en START SHOW; de tekst van het team komt in beeld.
  app.post("/v0/show-control/cues/content-warning", asyncRoute(async (_req, res) => {
    const publiek = String(process.env.SHOW_CONTROL_AUDIENCE_URL || "http://127.0.0.1:3026").replace(/\/+$/, "");
    const antwoord = await fetch(`${publiek}/audience/admin/waarschuwing/toon`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}", signal: AbortSignal.timeout(3000) });
    const body = await antwoord.json().catch(() => ({}));
    res.status(antwoord.ok ? 201 : 409).json({ ok: antwoord.ok, ...body });
  }));

  // Registratie (beeld hoofdscherm + geluid): status, starten en stoppen. Alleen op verzoek
  // (knop OPNAME op de Stream Deck); er start niets vanzelf.
  app.get("/v0/show-control/registratie", asyncRoute(async (_req, res) => {
    res.json(await registratieStatus(options.registratie || {}));
  }));
  app.post("/v0/show-control/registratie/start", asyncRoute(async (req, res) => {
    const runtimeState = await runtimeStateQuick(req, clients);
    const uitkomst = await startRegistratie(runtimeState, options.registratie || {});
    res.status(uitkomst.ok ? 201 : 409).json(uitkomst);
  }));
  app.post("/v0/show-control/registratie/stop", asyncRoute(async (_req, res) => {
    const uitkomst = await stopRegistratie(options.registratie || {});
    res.status(uitkomst.ok ? 200 : 409).json(uitkomst);
  }));

  app.post("/v0/show-control/cues/save", asyncRoute(async (req, res) => {
    const cue = buildCompoundCue({
      name: req.body ? req.body.name : null,
      actions: req.body && Array.isArray(req.body.actions) ? req.body.actions : [],
      steps: req.body && Array.isArray(req.body.steps) ? req.body.steps : null,
    });
    normalizeCue(cue);
    cue.status.stage = "saved";
    cue.status.state = "saved";
    cue.status.updatedAt = new Date().toISOString();
    await saveCue(cue);
    res.status(201).json({ ok: true, cue });
  }));

  app.post("/v0/show-control/cues/dry-run", asyncRoute(async (req, res) => {
    const cue = buildCompoundCue({
      name: req.body ? req.body.name : null,
      actions: req.body && Array.isArray(req.body.actions) ? req.body.actions : [],
      steps: req.body && Array.isArray(req.body.steps) ? req.body.steps : null,
    });
    normalizeCue(cue);
    cue.status.stage = "dry-run";
    cue.status.state = "ok";
    cue.status.updatedAt = new Date().toISOString();
    cue.executionLog = [{
      at: cue.status.updatedAt,
      type: "dry-run",
      message: "Cue validated without firing hardware.",
      actionCount: cue.actions.length,
    }];
    res.status(200).json({ ok: true, cue });
  }));

  app.post("/v0/show-control/cues/phase", asyncRoute(async (req, res) => {
    const body = req.body || {};
    const numericPhase = Number(body.phase);
    if (!Number.isInteger(numericPhase) || numericPhase < 0) throw httpError(400, "show_control_invalid_phase");
    const cue = buildPhaseCue({
      name: body.name || null,
      phase: numericPhase,
      phaseName: body.phaseName || null,
    });
    await regie.slot(async () => { await executeCue(cue, executeOptions); await saveCue(cue); });
    res.status(201).json({ ok: true, cue });
  }));

  app.post("/v0/show-control/cues/start-run", asyncRoute(async (req, res) => {
    const cue = buildStartRunCue({
      name: req.body ? req.body.name : null,
      autoPrepareNext: !(req.body && req.body.autoPrepareNext === false),
    });
    await regie.slot(async () => { await executeCue(cue, executeOptions); await saveCue(cue); });
    res.status(201).json({ ok: true, cue });
  }));

  app.post("/v0/show-control/cues/start-situation", asyncRoute(async (req, res) => {
    const runtimeState = req.body && req.body.runtimeState ? req.body.runtimeState : null;
    const showRunId = (req.body && req.body.showRunId) || (runtimeState && runtimeState.showRunId) || null;
    const cue = buildStartSituationCue({
      name: req.body ? req.body.name : null,
      showRunId,
      actions: req.body && Array.isArray(req.body.actions) ? req.body.actions : [],
    });
    await regie.slot(async () => { await executeCue(cue, { ...executeOptions, runtimeState }); await saveCue(cue); });
    res.status(201).json({ ok: true, cue });
  }));

  // Komt op het zaalscherm het venster met de tekst in beeld, dan gaat de scène die klaarstaat
  // vanzelf naar de chat van de script-agent: het publiek ziet de tekst ontstaan. Eén keer per
  // klaargezette scène; opnieuw sturen kan met SCENE CHAT. Niet bij het testen van scènes, en niet
  // als de tekst van deze scène er al is.
  let vanzelfGestuurd = "";
  async function sceneVanzelfNaarChat() {
    const result = await clients.fetchCurrentRuntimeState();
    const state = result && result.ok ? result.state : null;
    if (!state || state.activeSituation || !state.resolvedPreparedNext || !state.preparedNext) return { gestuurd: false, reden: "niets_klaar" };
    if (state.testRun && state.testRun.enabled) return { gestuurd: false, reden: "testrun" };
    const sleutel = `${state.showRunId}|${state.preparedNext.situationId}|${state.preparedNext.chosenAt}`;
    if (sleutel === vanzelfGestuurd) return { gestuurd: false, reden: "al_gestuurd" };
    vanzelfGestuurd = sleutel;
    try {
      const basis = String(process.env.SHOW_CONTROL_SCRIPT_AGENT_URL || "http://127.0.0.1:3027").replace(/\/+$/, "");
      const [tele, status] = await Promise.all([
        fetch(`${basis}/v0/script-agent/teleprompter-parser/current`, { signal: AbortSignal.timeout(1500) }).then((r) => r.json()),
        fetch(`${basis}/v0/script-agent/operator/status`, { signal: AbortSignal.timeout(1500) }).then((r) => r.json()),
      ]);
      if (status && status.stage && status.stage.streaming) return { gestuurd: false, reden: "schrijft_al" };
      const nummer = (waarde) => Number((String(waarde || "").match(/(\d+)$/) || [])[1] || 0);
      const bron = tele && tele.teleprompt && tele.teleprompt.source ? nummer(tele.teleprompt.source.sceneId) : 0;
      const klaar = nummer(state.resolvedPreparedNext.legacySituationId || state.resolvedPreparedNext.situationId);
      const vers = tele && tele.teleprompt && Date.parse(tele.teleprompt.source && tele.teleprompt.source.generatedAt || "") >= Date.parse(state.preparedNext.chosenAt || "");
      if (bron && bron === klaar && vers) return { gestuurd: false, reden: "tekst_is_er" };
    } catch (_err) {
      // script-agent niet te bereiken om te kijken: gewoon sturen
    }
    const cue = buildSceneToChatCue(state, { name: "Scène vanzelf naar chat", sourceId: "show-control-scene-chat-vanzelf" });
    executeCue(cue, executeOptions).then(() => saveCue(cue)).catch(() => {});
    return { gestuurd: true, situationId: state.preparedNext.situationId };
  }

  app.post("/v0/show-control/cues/scene-to-chat-vanzelf", asyncRoute(async (_req, res) => {
    res.json({ ok: true, ...(await sceneVanzelfNaarChat()) });
  }));

  // OVERSLAAN: de scène die klaarstaat niet spelen. De runtime zet de volgende in de keten klaar
  // (de overgeslagen komt deze run niet terug) en die wordt meteen geschreven; wat er nog geschreven
  // werd, stopt. Klok, stemming en universum lopen gewoon door. Kan tot de scène start, ook vaker.
  let overslaanBezig = false;
  app.post("/v0/show-control/cues/overslaan", asyncRoute(async (req, res) => {
    if (overslaanBezig) {
      res.status(409).json({ ok: false, error: "overslaan_bezig" });
      return;
    }
    overslaanBezig = true;
    // Test of random: overslaan = een andere willekeurige scène klaarzetten.
    const regieStand = regie.stand();
    if (regieStand.stand !== "show" && regieStand.eigenaar && !regieStand.verlopen) {
      try {
        const klaar = await regie.slot(() => regie.binnen.overslaan());
        res.status(201).json({ ok: true, klaar: klaar && klaar.preparedNext ? { situationId: klaar.preparedNext.situationId, title: klaar.preparedNext.title || null } : null, stand: regieStand.stand });
      } catch (err) {
        res.status(err.statusCode || 409).json({ ok: false, error: err.code || "overslaan_mislukt", message: err.message });
      } finally {
        overslaanBezig = false;
      }
      return;
    }
    try {
      await regie.slot(async () => {
        const result = await clients.fetchCurrentRuntimeState();
        const state = result && result.ok ? result.state : null;
        if (!state || !state.showRunId || state.status !== "running") {
          res.status(409).json({ ok: false, error: "geen_run" });
          return;
        }
        if (state.activeSituation) {
          res.status(409).json({ ok: false, error: "scene_speelt" });
          return;
        }
        if (!state.preparedNext || !state.preparedNext.situationId) {
          res.status(409).json({ ok: false, error: "niets_klaar" });
          return;
        }
        const overgeslagen = state.preparedNext;
        const runtimeBasis = String(process.env.SHOW_CONTROL_RUNTIME_URL || "http://127.0.0.1:3024").replace(/\/+$/, "");
        const antwoord = await fetch(`${runtimeBasis}/v0/runtime/runs/${encodeURIComponent(state.showRunId)}/skip-prepared`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ situationId: overgeslagen.situationId }),
          signal: AbortSignal.timeout(8000),
        });
        const nieuw = await antwoord.json().catch(() => ({}));
        if (!antwoord.ok) {
          const fout = String(nieuw.error || `runtime_${antwoord.status}`);
          const meldingen = { runtime_skip_nothing_left: "niets_meer_vrij", runtime_skip_stale: "al_overgeslagen", runtime_skip_requires_no_active_situation: "scene_speelt" };
          res.status(409).json({ ok: false, error: meldingen[fout] || fout });
          return;
        }
        // De nieuwe scène ook klaarzetten in TouchDesigner en op de teleprompter (anders bleef daar de
        // overgeslagen omgeving staan).
        const klaarCue = buildPrepareCue(nieuw);
        await executeCue(klaarCue, executeOptions);
        await saveCue(klaarCue);
        // Niet ook nog vanzelf naar de chat als het tekstvenster straks in beeld komt.
        vanzelfGestuurd = `${nieuw.showRunId}|${nieuw.preparedNext.situationId}|${nieuw.preparedNext.chosenAt}`;
        const cue = buildSceneToChatCue(nieuw, {
          name: "Overslaan: volgende scène naar chat",
          sourceId: "show-control-overslaan",
          overslaan: true,
          overgeslagenSituationId: overgeslagen.situationId,
        });
        executeCue(cue, executeOptions).then(() => saveCue(cue)).catch(() => {});
        res.status(201).json({
          ok: true,
          overgeslagen: { situationId: overgeslagen.situationId, title: overgeslagen.title || null },
          klaar: { situationId: nieuw.preparedNext.situationId, title: nieuw.preparedNext.title || null },
          aantalOvergeslagen: Array.isArray(nieuw.skippedSituations) ? nieuw.skippedSituations.length : 0,
        });
      });
    } finally {
      overslaanBezig = false;
    }
  }));

  app.post("/v0/show-control/cues/stop-situation", asyncRoute(async (req, res) => {
    const runtimeState = req.body && req.body.runtimeState ? req.body.runtimeState : null;
    const showRunId = (req.body && req.body.showRunId) || (runtimeState && runtimeState.showRunId) || null;
    const cue = buildStopSituationCue({
      name: req.body ? req.body.name : null,
      showRunId,
    });
    // Eerst de stop zelf (scène uit, TouchDesigner naar loading, opruimen); het klaarzetten van de
    // volgende scène komt na het antwoord. Zo is een stop snel en wacht niemand op TouchDesigner.
    await regie.slot(async () => {
      await executeCue(cue, { ...executeOptions, runtimeState, uitstellen: true });
      await saveCue(cue);
      res.status(201).json({ ok: true, cue });
      await executeUitgesteld(cue, executeOptions).then(() => saveCue(cue)).catch(() => {});
      // Test of random: het script bij wat er nu klaarstaat (in random eerst een nieuwe keuze).
      await regie.binnen.naStop().catch(() => {});
    });
    // Na het antwoord: de operator krijgt even de tijd voor een opmerking over deze scène.
    opmerkingVensterOpen();
  }));

  // De scène is gestopt: in de operator-chat gaat een venster open voor een opmerking over die
  // scène ("te lang", "dit was grappig"). Wat de operator typt en met Enter bevestigt, gaat mee met
  // de volgende scène. Het venster sluit vanzelf, of zodra de volgende scène naar de chat gaat.
  // Niet bij het testen van scènes.
  const OPMERKING_VENSTER_MS = Number(process.env.SHOW_CONTROL_OPMERKING_VENSTER_MS || 20000);
  async function opmerkingVensterOpen() {
    try {
      const result = await clients.fetchCurrentRuntimeState();
      const state = result && result.ok ? result.state : null;
      if (!state || !state.showRunId || state.status !== "running") return;
      if (state.testRun && state.testRun.enabled) return;
      const basis = String(process.env.SHOW_CONTROL_SCRIPT_AGENT_URL || "http://127.0.0.1:3027").replace(/\/+$/, "");
      await fetch(`${basis}/v0/script-agent/operator/opmerking-venster`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ windowMs: OPMERKING_VENSTER_MS }),
        signal: AbortSignal.timeout(OPMERKING_VENSTER_MS + 30000),
      });
    } catch (_err) {
      // geen venster: de scène gaat gewoon door zonder opmerking
    }
  }

  // /status wordt elke seconde gevraagd (deck-status): de omgevingsknoppen hoeven
  // niet vaker dan eens per seconde opnieuw bepaald te worden.
  const extrasCache = { at: 0, value: null, pending: null };
  const omvallenCache = { value: null };
  const knoppenCache = { value: null };
  const knoppenOptions = {
    environmentFases: options.environmentFases || {},
    environmentOmvallen: options.environmentOmvallen || {},
  };
  function knoppenVoor(runtimeState) {
    try {
      return environmentKnoppenStatus(runtimeState || {}, knoppenOptions);
    } catch (_err) {
      return null;
    }
  }
  // Knop van een personage in de scène (het nummer van Marit).
  const personageCache = { value: null };
  const personageOptions = { ...(options.personageKnop || {}), environmentExtras: options.environmentExtras || {} };
  function personageVoor(runtimeState) {
    try {
      return publicPersonageKnopStatus(personageKnopStatus(runtimeState || {}, personageOptions));
    } catch (_err) {
      return null;
    }
  }
  const EXTRAS_CACHE_MS = Number(options.environmentExtrasCacheMs ?? 1000);
  async function cachedExtrasStatus(req) {
    if (extrasCache.value && Date.now() - extrasCache.at < EXTRAS_CACHE_MS) return extrasCache.value;
    // Verlopen: geef meteen de vorige stand en ververs op de achtergrond, zodat /status
    // nooit op Runtime wacht. Alleen de allereerste keer wordt er gewacht.
    if (extrasCache.value && EXTRAS_CACHE_MS > 0) {
      if (!extrasCache.pending) refreshExtras(req).catch(() => {});
      return extrasCache.value;
    }
    return refreshExtras(req);
  }
  function refreshExtras(req) {
    if (!extrasCache.pending) {
      extrasCache.pending = runtimeStateQuick(req, clients)
        .then((runtimeState) => {
          // Het effect omvallen leest dezelfde runtime-stand: in één keer mee.
          try {
            omvallenCache.value = publicOmvallenStatus(environmentOmvallenStatus(runtimeState || {}, options.environmentOmvallen || {}));
          } catch (_err) {
            omvallenCache.value = null;
          }
          knoppenCache.value = knoppenVoor(runtimeState);
          personageCache.value = personageVoor(runtimeState);
          return publicExtrasStatus(environmentExtrasStatus(runtimeState || {}, options.environmentExtras || {}));
        })
        .then((value) => {
          extrasCache.value = value;
          extrasCache.at = Date.now();
          return value;
        })
        .finally(() => { extrasCache.pending = null; });
    }
    return extrasCache.pending;
  }

  // Extra shot en extra geluid van de actieve (of klaargezette) omgeving.
  app.get("/v0/show-control/environment-extras/current", asyncRoute(async (req, res) => {
    const runtimeState = await runtimeStateQuick(req, clients);
    const value = publicExtrasStatus(environmentExtrasStatus(runtimeState || {}, options.environmentExtras || {}));
    extrasCache.value = value;
    extrasCache.at = Date.now();
    res.json(value);
  }));

  app.post("/v0/show-control/cues/environment-extra", asyncRoute(async (req, res) => {
    const runtimeState = await runtimeStateQuick(req, clients, 1500);
    let cue;
    try {
      cue = buildEnvironmentExtraCue(runtimeState || {}, req.body || {}, options.environmentExtras || {});
    } catch (err) {
      if (err && err.statusCode === 409) {
        res.status(409).json({ ok: false, error: err.code, extras: err.extras });
        return;
      }
      throw err;
    }
    await executeCue(cue, executeOptions);
    await saveCue(cue);
    extrasCache.at = 0;
    res.status(201).json({ ok: true, cue });
  }));

  // Volume van het sfeergeluid nu in de zaal (schuif in de catalogus). Wordt niet
  // in het cue-log bewaard: een schuif stuurt er veel achter elkaar.
  app.post("/v0/show-control/sound/sfeer-volume", asyncRoute(async (req, res) => {
    const runtimeState = await runtimeStateQuick(req, clients, 1500);
    let cue;
    try {
      cue = buildSfeerVolumeCue(runtimeState || {}, req.body || {}, options.environmentExtras || {});
    } catch (err) {
      if (err && err.statusCode === 409) {
        res.status(409).json({ ok: false, error: err.code, extras: err.extras });
        return;
      }
      throw err;
    }
    await executeCue(cue, executeOptions);
    res.json({ ok: true, volume: cue.actions[0].payload.volume, environmentId: cue.actions[0].payload.environmentId });
  }));

  // Effect omvallen van de actieve (of klaargezette) omgeving: elke druk de volgende stap.
  app.get("/v0/show-control/environment-omvallen/current", asyncRoute(async (req, res) => {
    const runtimeState = await runtimeStateQuick(req, clients);
    res.json(publicOmvallenStatus(environmentOmvallenStatus(runtimeState || {}, options.environmentOmvallen || {})));
  }));

  app.post("/v0/show-control/cues/environment-omvallen", asyncRoute(async (req, res) => {
    const runtimeState = await runtimeStateQuick(req, clients, 1500);
    let cue;
    try {
      cue = buildEnvironmentOmvallenCue(runtimeState || {}, req.body || {}, options.environmentOmvallen || {});
    } catch (err) {
      if (err && err.statusCode === 409) {
        res.status(409).json({ ok: false, error: err.code, omvallen: err.omvallen });
        return;
      }
      throw err;
    }
    // Niet wachten tot het geluid klaar is: de knop moet meteen antwoord krijgen.
    executeCue(cue, executeOptions).then(() => saveCue(cue)).catch(() => {});
    const na = publicOmvallenStatus(environmentOmvallenStatus(runtimeState || {}, options.environmentOmvallen || {}));
    omvallenCache.value = na;
    knoppenCache.value = knoppenVoor(runtimeState);
    res.status(201).json({
      ok: true,
      cueId: cue.cueId,
      name: cue.name,
      omvallen: na,
    });
  }));

  // Clips die vanzelf langskomen (flits bij de persconferentie): server.js roept dit om de
  // paar seconden aan. Zonder "vanzelf" in omvallen.json van de spelende omgeving gebeurt er niets.
  app.locals.environmentVanzelfTick = async () => {
    const runtimeResult = await clients.fetchCurrentRuntimeState();
    if (!runtimeResult || !runtimeResult.ok) return null;
    // Een lopende opname stopt als de schijf volloopt.
    registratieTick(options.registratie || {}).catch(() => {});
    // Een verlopen regie geeft zichzelf vrij (als er geen scène speelt).
    regie.tick().catch(() => {});
    // De bewaker kijkt of TouchDesigner en de teleprompter de runtime volgen (één voor één met de rest).
    if (bewaker) await regie.slot(async () => {
      const verse = await clients.fetchCurrentRuntimeState();
      await bewaker.ronde(verse && verse.ok ? verse.state : null);
    }).catch(() => {});
    // Vangnet: is de scène buiten show-control om geëindigd, dan gaat alsnog alles van die scène uit.
    const einde = sceneEindeTick(runtimeResult.state || {});
    if (einde) executeCue(einde, { ...executeOptions, runtimeState: runtimeResult.state }).then(() => saveCue(einde)).catch(() => {});
    const cue = environmentVanzelfTick(runtimeResult.state || {}, options.environmentOmvallen || {});
    if (!cue) return null;
    executeCue(cue, { ...executeOptions, runtimeState: runtimeResult.state }).then(() => saveCue(cue)).catch(() => {});
    return cue;
  };

  // Fases van de actieve (of klaargezette) omgeving.
  app.get("/v0/show-control/environment-fases/current", asyncRoute(async (req, res) => {
    const runtimeState = await runtimeStateQuick(req, clients);
    res.json(publicFasesStatus(environmentFasesStatus(runtimeState || {}, options.environmentFases || {})));
  }));

  app.post("/v0/show-control/cues/environment-fase", asyncRoute(async (req, res) => {
    const runtimeState = await runtimeStateQuick(req, clients, 1500);
    let cue;
    try {
      cue = buildEnvironmentFaseCue(runtimeState || {}, req.body || {}, options.environmentFases || {});
    } catch (err) {
      if (err && err.statusCode === 409) {
        res.status(409).json({ ok: false, error: err.code, fases: err.fases });
        return;
      }
      throw err;
    }
    executeCue(cue, executeOptions).then(() => saveCue(cue)).catch(() => {});
    knoppenCache.value = knoppenVoor(runtimeState);
    res.status(201).json({
      ok: true,
      cueId: cue.cueId,
      name: cue.name,
      fases: publicFasesStatus(environmentFasesStatus(runtimeState || {}, options.environmentFases || {})),
    });
  }));

  // Omgevingsknoppen voor het Stream Deck: één lijst per omgeving, en één adres om er een af te vuren.
  app.get("/v0/show-control/environment-knoppen/current", asyncRoute(async (req, res) => {
    const runtimeState = await runtimeStateQuick(req, clients);
    const value = knoppenVoor(runtimeState);
    knoppenCache.value = value;
    res.json(value || { ok: false, knoppen: [] });
  }));

  app.post("/v0/show-control/cues/environment-knop", asyncRoute(async (req, res) => {
    const runtimeState = await runtimeStateQuick(req, clients, 1500);
    let cue;
    try {
      cue = buildEnvironmentKnopCue(runtimeState || {}, req.body || {}, knoppenOptions);
    } catch (err) {
      if (err && err.statusCode === 409) {
        res.status(409).json({ ok: false, error: err.code, knoppen: err.knoppen || null });
        return;
      }
      throw err;
    }
    executeCue(cue, executeOptions).then(() => saveCue(cue)).catch(() => {});
    const value = knoppenVoor(runtimeState);
    knoppenCache.value = value;
    omvallenCache.value = publicOmvallenStatus(environmentOmvallenStatus(runtimeState || {}, options.environmentOmvallen || {}));
    res.status(201).json({ ok: true, cueId: cue.cueId, name: cue.name, knoppen: value });
  }));

  // Knop van een personage: het nummer dat bij een personage in de scène hoort, aan/uit.
  app.get("/v0/show-control/personage-knop/current", asyncRoute(async (req, res) => {
    const runtimeState = await runtimeStateQuick(req, clients);
    const value = personageVoor(runtimeState);
    personageCache.value = value;
    res.json(value || { ok: false, klaar: false, staat: "uit" });
  }));

  app.post("/v0/show-control/cues/personage-knop", asyncRoute(async (req, res) => {
    const runtimeState = await runtimeStateQuick(req, clients, 1500);
    let cue;
    try {
      cue = buildPersonageKnopCue(runtimeState || {}, req.body || {}, personageOptions);
    } catch (err) {
      if (err && err.statusCode === 409) {
        res.status(409).json({ ok: false, error: err.code, knop: err.knop || null });
        return;
      }
      throw err;
    }
    await executeCue(cue, executeOptions);
    saveCue(cue).catch(() => {});
    const value = personageVoor(runtimeState);
    personageCache.value = value;
    res.status(201).json({ ok: true, cueId: cue.cueId, name: cue.name, knop: value });
  }));

  app.post("/v0/show-control/media-assets/refresh", asyncRoute(async (req, res) => {
    const body = req.body || {};
    const environmentId = String(body.environmentId || "").trim();
    if (!environmentId) throw httpError(400, "show_control_missing_environment_id");
    const runtimeState = await runtimeStateForRequest(req, clients);
    const cue = buildEnvironmentMediaRefreshCue(runtimeState, {
      environmentId,
      roles: Array.isArray(body.roles) ? body.roles : [],
      reason: body.reason || "catalog_media_changed",
      source: body.source || "catalog",
      assetId: body.assetId || null,
      name: body.name || `Catalog media refresh ${environmentId}`,
    });
    if (!cue.actions.length) {
      res.status(200).json({
        ok: true,
        skipped: true,
        reason: "environment_not_active_or_prepared",
        environmentId,
        runtimeRef: {
          showRunId: runtimeState && runtimeState.showRunId || null,
          status: runtimeState && runtimeState.status || null,
          activeEnvironmentId: runtimeState && runtimeState.activeSituation && runtimeState.activeSituation.resolved
            ? runtimeState.activeSituation.resolved.environmentId || runtimeState.activeSituation.resolved.environment && runtimeState.activeSituation.resolved.environment.id || null
            : null,
          preparedEnvironmentId: runtimeState && runtimeState.resolvedPreparedNext
            ? runtimeState.resolvedPreparedNext.environmentId || runtimeState.resolvedPreparedNext.environment && runtimeState.resolvedPreparedNext.environment.id || null
            : null,
        },
      });
      return;
    }
    await executeCue(cue, { ...executeOptions, nonBlocking: true, runtimeState });
    await saveCue(cue);
    res.status(202).json({ ok: true, cue });
  }));

  app.get("/v0/show-control/cues", asyncRoute(async (req, res) => {
    const archivedMode = req.query.archived === "only" ? "only" : null;
    const cues = await readCues({
      cueType: req.query.cueType ? String(req.query.cueType) : null,
      showRunId: req.query.showRunId ? String(req.query.showRunId) : null,
      includeArchived: req.query.archived === "all",
      archived: archivedMode,
    });
    const full = wantsFullDetail(req);
    res.json({
      ok: true,
      detail: full ? "full" : "summary",
      count: cues.length,
      cues: full ? cues : summarizeCues(cues),
    });
  }));

  app.get("/v0/show-control/cues/:cueId", asyncRoute(async (req, res) => {
    res.json(await readCue(req.params.cueId));
  }));

  app.post("/v0/show-control/cues/:cueId/archive", asyncRoute(async (req, res) => {
    const cue = await archiveCue(req.params.cueId, {
      reason: req.body && req.body.reason ? String(req.body.reason) : "manual_archive",
      archivedBy: req.body && req.body.archivedBy ? String(req.body.archivedBy) : "show-control-ui",
    });
    res.json({ ok: true, cue });
  }));

  app.get("/v0/show-control/trigger-bindings", asyncRoute(async (req, res) => {
    const bindings = await readTriggerBindings({
      source: req.query.source ? String(req.query.source) : null,
      cueId: req.query.cueId ? String(req.query.cueId) : null,
    });
    res.json({ ok: true, count: bindings.length, bindings });
  }));

  app.post("/v0/show-control/trigger-bindings", asyncRoute(async (req, res) => {
    const body = req.body || {};
    await readCue(String(body.cueId || ""));
    const binding = await saveTriggerBinding(body);
    res.status(201).json({ ok: true, binding });
  }));

  app.post("/v0/show-control/triggers/fire", asyncRoute(async (req, res) => {
    const body = req.body || {};
    const source = String(body.source || "streamdeck").trim().toLowerCase();
    const triggerId = String(body.triggerId || body.button || body.buttonId || "").trim();
    if (!triggerId) throw httpError(400, "show_control_missing_trigger_id");
    const binding = await readTriggerBinding(source, triggerId);
    const cue = await readCue(binding.cueId);
    await executeCue(cue, {
      ...executeOptions,
      nonBlocking: body.nonBlocking !== false,
    });
    await saveCue(cue);
    res.status(cue.status && cue.status.nonBlocking ? 202 : 200).json({ ok: true, binding, cue });
  }));

  app.get("/v0/show-control/cues/:cueId/payload/:payloadId", asyncRoute(async (req, res) => {
    const cue = await readCue(req.params.cueId);
    res.json({
      ok: true,
      cueId: cue.cueId,
      payloadId: req.params.payloadId,
      payload: findCuePayload(cue, req.params.payloadId),
    });
  }));

  app.get("/api/show-control/cues/:cueId/payload/:payloadId", asyncRoute(async (req, res) => {
    const cue = await readCue(req.params.cueId);
    res.json(findCuePayload(cue, req.params.payloadId));
  }));

  app.get("/api/show-control/payloads/:payloadId", asyncRoute(async (req, res) => {
    const cachedPayload = findCachedPayload(req.params.payloadId);
    if (cachedPayload) {
      res.json(cachedPayload);
      return;
    }
    const indexedPayload = await readIndexedPayload(req.params.payloadId);
    if (indexedPayload) {
      res.json(indexedPayload);
      return;
    }
    const cues = await readCues();
    for (const cue of cues) {
      try {
        res.json(findCuePayload(cue, req.params.payloadId));
        return;
      } catch (_err) {
        // Keep scanning: payload IDs are globally unique in generated cues, but old fixtures may not be.
      }
    }
    throw httpError(404, `show_control_payload_not_found:${req.params.payloadId}`);
  }));

  app.post("/v0/show-control/cues/:cueId/execute", asyncRoute(async (req, res) => {
    const cue = await readCue(req.params.cueId);
    await executeCue(cue, {
      ...executeOptions,
      nonBlocking: !!(req.body && req.body.nonBlocking),
    });
    await saveCue(cue);
    res.status(cue.status && cue.status.nonBlocking ? 202 : 200).json({ ok: true, cue });
  }));

  app.post("/v0/show-control/acks", asyncRoute(async (req, res) => {
    const result = await handleAckPayload(req.body);
    res.status(result.statusCode).json(result.body);
  }));

  app.post("/api/show-control/acks", asyncRoute(async (req, res) => {
    const result = await handleAckPayload(req.body);
    res.status(result.statusCode).json(result.body);
  }));

  app.get("/v0/show-control/status", asyncRoute(async (req, res) => {
    const cueSummary = await readCueSummary();
    const bindings = await readTriggerBindings();
    const warnings = cueSummary.warnings;
    const latestCue = cueSummary.latestCue;
    const full = wantsFullDetail(req);
    const latestCueSummary = latestCue ? summarizeCue(latestCue, { actionLimit: 10, logLimit: 24 }) : null;
    const [hardware, environmentExtras] = await Promise.all([
      hardwareStatus(executeOptions.adapterOptions),
      cachedExtrasStatus(req),
    ]);
    res.json({
      ok: true,
      schemaVersion: SHOW_CONTROL_STATUS_SCHEMA_VERSION,
      service: "show-control",
      detail: full ? "full" : "summary",
      cueCount: cueSummary.count,
      archivedCueCount: cueSummary.archivedCount,
      bindingCount: bindings.length,
      warningCount: warnings.length,
      warnings,
      commandCount: listCommands().length,
      latestCue: full ? latestCue : null,
      latestCueSummary,
      targetStatus: latestCueSummary && latestCueSummary.status ? latestCueSummary.status.targetStatus || {} : {},
      hardware,
      environmentExtras,
      environmentOmvallen: omvallenCache.value,
      environmentKnoppen: knoppenCache.value,
      personageKnop: personageCache.value,
    });
  }));

  app.use((req, res) => {
    res.status(404).json({ ok: false, error: "not_found", path: req.path });
  });

  app.use((err, _req, res, _next) => {
    const status = err && err.statusCode ? err.statusCode : 500;
    res.status(status).json({
      ok: false,
      error: status >= 500 ? "show_control_service_error" : "show_control_bad_request",
      message: err && err.message ? String(err.message) : "unknown_error",
    });
  });

  return app;
}

module.exports = {
  createShowControlApp,
  showControlClients,
};
