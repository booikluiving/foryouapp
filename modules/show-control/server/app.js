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
const { applyAck, executeCue, normalizeCue } = require("../cue-engine/cue-engine");
const { recordAck } = require("../cue-engine/ack-tracker");
const { findCachedPayload } = require("../cue-engine/payload-cache");
const { summarizeCue, summarizeCues } = require("../cue-engine/cue-summary");
const {
  findCuePayload,
  readIndexedPayload,
  archiveCue,
  readCue,
  readCues,
  readTriggerBinding,
  readTriggerBindings,
  saveCue,
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
const { cameraBaseUrl } = require("../target-adapters/camera-adapter");
const { dmxBaseUrl } = require("../target-adapters/dmx-adapter");
const { perfectCueBaseUrl } = require("../target-adapters/perfect-cue-adapter");
const { sq5BaseUrl } = require("../target-adapters/sq5-adapter");
const { streamDeckBaseUrl } = require("../target-adapters/streamdeck-adapter");
const { loadExpress } = require("./express-loader");

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
    runtimeBaseUrl: process.env.V2_SHOW_CONTROL_RUNTIME_URL,
    sq5BaseUrl: process.env.V2_SHOW_CONTROL_SQ5_URL,
    cameraBaseUrl: process.env.V2_SHOW_CONTROL_CAMERA_URL,
    dmxBaseUrl: process.env.V2_SHOW_CONTROL_DMX_URL,
    streamDeckBaseUrl: process.env.V2_SHOW_CONTROL_STREAMDECK_URL,
    perfectCueBaseUrl: process.env.V2_SHOW_CONTROL_PERFECT_CUE_URL,
    scriptAgentBaseUrl: process.env.V2_SHOW_CONTROL_SCRIPT_AGENT_URL,
    tdOscHost: process.env.V2_SHOW_CONTROL_TD_OSC_HOST,
    tdOscPort: process.env.V2_SHOW_CONTROL_TD_OSC_PORT,
    tdAckPort: process.env.V2_SHOW_CONTROL_TD_ACK_PORT,
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
  app.use(express.json({ limit: "1mb" }));

  app.get("/", (_req, res) => {
    res.redirect("/show-control/");
  });

  app.use("/shared/ui", express.static(sharedUiRoot));
  app.use("/show-control", express.static(uiRoot, { extensions: ["html"] }));

  app.get("/health", (_req, res) => {
    const port = Number(process.env.SHOW_CONTROL_PORT || process.env.PORT || options.port || 3025);
    const adapterMode = String(process.env.V2_SHOW_CONTROL_ADAPTER_MODE || "live");
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

  app.post("/v0/show-control/cues/prepare", asyncRoute(async (req, res) => {
    const runtimeState = await runtimeStateForRequest(req, clients);
    const cue = buildPrepareCue(runtimeState, {
      simulateTargetTimeout: !!(req.body && req.body.simulateTargetTimeout),
    });
    await executeCue(cue, executeOptions);
    await saveCue(cue);
    res.status(201).json({ ok: true, cue });
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
    await executeCue(cue, executeOptions);
    await saveCue(cue);
    res.status(201).json({ ok: true, cue });
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
    await executeCue(cue, executeOptions);
    await saveCue(cue);
    res.status(201).json({ ok: true, cue });
  }));

  app.post("/v0/show-control/cues/start-run", asyncRoute(async (req, res) => {
    const cue = buildStartRunCue({
      name: req.body ? req.body.name : null,
      autoPrepareNext: !(req.body && req.body.autoPrepareNext === false),
    });
    await executeCue(cue, executeOptions);
    await saveCue(cue);
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
    await executeCue(cue, { ...executeOptions, runtimeState });
    await saveCue(cue);
    res.status(201).json({ ok: true, cue });
  }));

  app.post("/v0/show-control/cues/stop-situation", asyncRoute(async (req, res) => {
    const runtimeState = req.body && req.body.runtimeState ? req.body.runtimeState : null;
    const showRunId = (req.body && req.body.showRunId) || (runtimeState && runtimeState.showRunId) || null;
    const cue = buildStopSituationCue({
      name: req.body ? req.body.name : null,
      showRunId,
    });
    await executeCue(cue, { ...executeOptions, runtimeState });
    await saveCue(cue);
    res.status(201).json({ ok: true, cue });
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
    const cues = await readCues();
    const archivedCues = await readCues({ archived: "only" });
    const bindings = await readTriggerBindings();
    const warnings = cues.flatMap((cue) => (cue.status && cue.status.warnings ? cue.status.warnings : []));
    const latestCue = cues[cues.length - 1] || null;
    const full = wantsFullDetail(req);
    const latestCueSummary = latestCue ? summarizeCue(latestCue, { actionLimit: 10, logLimit: 24 }) : null;
    const hardware = await hardwareStatus(executeOptions.adapterOptions);
    res.json({
      ok: true,
      schemaVersion: SHOW_CONTROL_STATUS_SCHEMA_VERSION,
      service: "show-control",
      detail: full ? "full" : "summary",
      cueCount: cues.length,
      archivedCueCount: archivedCues.length,
      bindingCount: bindings.length,
      warningCount: warnings.length,
      warnings,
      commandCount: listCommands().length,
      latestCue: full ? latestCue : null,
      latestCueSummary,
      targetStatus: latestCueSummary && latestCueSummary.status ? latestCueSummary.status.targetStatus || {} : {},
      hardware,
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
