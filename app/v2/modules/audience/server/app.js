"use strict";

const {
  AUDIENCE_ALGORITHM_INPUT_SCHEMA_VERSION,
  AUDIENCE_SESSION_SCHEMA_VERSION,
  AUDIENCE_SIGNAL_SCHEMA_VERSION,
  createAudienceSessionId,
} = require("../../../shared/contracts/audience-v0");
const { fetchCurrentRuntimeState } = require("../client/runtime-client");
const {
  appendAudienceSession,
  appendAudienceSignal,
  readAudienceSessions,
  readAudienceSignals,
} = require("../signal-normalizer/signal-store");
const {
  buildAlgorithmInput,
  createAudienceSignal,
} = require("../signal-normalizer/signal-normalizer");
const { loadExpress } = require("./express-loader");

const express = loadExpress();

function asyncRoute(handler) {
  return (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
}

function badRequest(message) {
  const err = new Error(message);
  err.statusCode = 400;
  return err;
}

function audienceClients() {
  return {
    fetchCurrentRuntimeState,
  };
}

function createAudienceApp(options = {}) {
  const app = express();
  const startedAt = new Date();
  const clients = options.clients || audienceClients();
  app.use(express.json({ limit: "256kb" }));

  app.get("/health", (_req, res) => {
    const port = Number(process.env.AUDIENCE_PORT || process.env.PORT || options.port || 3026);
    res.json({
      ok: true,
      service: "audience",
      version: "v0",
      signalSchemaVersion: AUDIENCE_SIGNAL_SCHEMA_VERSION,
      algorithmInputSchemaVersion: AUDIENCE_ALGORITHM_INPUT_SCHEMA_VERSION,
      port,
      startedAt: startedAt.toISOString(),
      uptimeSeconds: Math.round(process.uptime()),
    });
  });

  app.post("/v0/audience/sessions", asyncRoute(async (req, res) => {
    const now = new Date();
    const session = {
      schemaVersion: AUDIENCE_SESSION_SCHEMA_VERSION,
      sessionId: req.body && req.body.sessionId ? String(req.body.sessionId).trim() : createAudienceSessionId(now),
      createdAt: now.toISOString(),
      source: {
        type: "audience-v0-session",
        readOnly: false,
      },
    };
    await appendAudienceSession(session);
    res.status(201).json({ ok: true, session });
  }));

  app.get("/v0/audience/sessions", asyncRoute(async (_req, res) => {
    const sessions = await readAudienceSessions();
    res.json({ ok: true, sessions });
  }));

  app.post("/v0/audience/signals", asyncRoute(async (req, res) => {
    const runtimeResult = await clients.fetchCurrentRuntimeState();
    const signal = createAudienceSignal(req.body || {}, runtimeResult);
    await appendAudienceSignal(signal);
    res.status(201).json({ ok: true, signal });
  }));

  app.get("/v0/audience/signals", asyncRoute(async (req, res) => {
    const signals = await readAudienceSignals({
      showRunId: req.query.showRunId ? String(req.query.showRunId) : null,
      situationRunId: req.query.situationRunId ? String(req.query.situationRunId) : null,
      linkStatus: req.query.linkStatus ? String(req.query.linkStatus) : null,
    });
    res.json({ ok: true, count: signals.length, signals });
  }));

  app.get("/v0/audience/algorithm-input", asyncRoute(async (req, res) => {
    const showRunId = req.query.showRunId ? String(req.query.showRunId) : null;
    const situationRunId = req.query.situationRunId ? String(req.query.situationRunId) : null;
    if (!showRunId) throw badRequest("audience_missing_show_run_id");
    if (!situationRunId) throw badRequest("audience_missing_situation_run_id");
    const signals = await readAudienceSignals({ showRunId, situationRunId, linkStatus: "linked" });
    res.json(buildAlgorithmInput({ showRunId, situationRunId, signals }));
  }));

  app.use((req, res) => {
    res.status(404).json({ ok: false, error: "not_found", path: req.path });
  });

  app.use((err, _req, res, _next) => {
    const status = err && err.statusCode ? err.statusCode : 500;
    res.status(status).json({
      ok: false,
      error: status >= 500 ? "audience_service_error" : "audience_bad_request",
      message: err && err.message ? String(err.message) : "unknown_error",
    });
  });

  return app;
}

module.exports = {
  audienceClients,
  createAudienceApp,
};
