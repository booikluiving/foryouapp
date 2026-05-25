"use strict";

const {
  SHOW_CONTROL_ACK_SCHEMA_VERSION,
  SHOW_CONTROL_CUE_SCHEMA_VERSION,
  SHOW_CONTROL_STATUS_SCHEMA_VERSION,
} = require("../../../shared/contracts/show-control-v0");
const { fetchCurrentRuntimeState } = require("../client/runtime-client");
const { applyAck, executeCue } = require("../cue-engine/cue-engine");
const {
  findCuePayload,
  readCue,
  readCues,
  saveCue,
} = require("../cue-engine/state-store");
const {
  buildCompoundCue,
  buildGoCue,
  buildPrepareCue,
} = require("../cue-library/runtime-cues");
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

async function runtimeStateForRequest(req, clients) {
  if (req.body && req.body.runtimeState) return req.body.runtimeState;
  const runtimeResult = await clients.fetchCurrentRuntimeState();
  if (!runtimeResult.ok) throw httpError(502, `show_control_runtime_unavailable:${runtimeResult.error || "unknown"}`);
  return runtimeResult.state;
}

function createShowControlApp(options = {}) {
  const app = express();
  const startedAt = new Date();
  const clients = options.clients || showControlClients();
  app.use(express.json({ limit: "1mb" }));

  app.get("/health", (_req, res) => {
    const port = Number(process.env.SHOW_CONTROL_PORT || process.env.PORT || options.port || 3025);
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
    });
  });

  app.post("/v0/show-control/cues/prepare", asyncRoute(async (req, res) => {
    const runtimeState = await runtimeStateForRequest(req, clients);
    const cue = buildPrepareCue(runtimeState, {
      simulateTargetTimeout: !!(req.body && req.body.simulateTargetTimeout),
    });
    await executeCue(cue);
    await saveCue(cue);
    res.status(201).json({ ok: true, cue });
  }));

  app.post("/v0/show-control/cues/go", asyncRoute(async (req, res) => {
    const runtimeState = await runtimeStateForRequest(req, clients);
    const cue = buildGoCue(runtimeState);
    await executeCue(cue, { nonBlocking: true });
    await saveCue(cue);
    res.status(202).json({ ok: true, cue });
  }));

  app.post("/v0/show-control/cues", asyncRoute(async (req, res) => {
    const cue = buildCompoundCue({
      name: req.body ? req.body.name : null,
      actions: req.body && Array.isArray(req.body.actions) ? req.body.actions : [],
    });
    await executeCue(cue);
    await saveCue(cue);
    res.status(201).json({ ok: true, cue });
  }));

  app.get("/v0/show-control/cues", asyncRoute(async (req, res) => {
    const cues = await readCues({
      cueType: req.query.cueType ? String(req.query.cueType) : null,
      showRunId: req.query.showRunId ? String(req.query.showRunId) : null,
    });
    res.json({ ok: true, count: cues.length, cues });
  }));

  app.get("/v0/show-control/cues/:cueId", asyncRoute(async (req, res) => {
    res.json(await readCue(req.params.cueId));
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

  app.post("/v0/show-control/acks", asyncRoute(async (req, res) => {
    if (!req.body || !req.body.cueId) throw httpError(400, "show_control_missing_cue_id");
    const cue = await readCue(String(req.body.cueId));
    const result = applyAck(cue, req.body);
    await saveCue(result.cue);
    res.status(201).json({ ok: true, ack: result.ack, cue: result.cue });
  }));

  app.get("/v0/show-control/status", asyncRoute(async (_req, res) => {
    const cues = await readCues();
    const warnings = cues.flatMap((cue) => (cue.status && cue.status.warnings ? cue.status.warnings : []));
    res.json({
      ok: true,
      schemaVersion: SHOW_CONTROL_STATUS_SCHEMA_VERSION,
      service: "show-control",
      cueCount: cues.length,
      warningCount: warnings.length,
      warnings,
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
