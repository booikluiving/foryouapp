"use strict";

const { RUNTIME_STATE_SCHEMA_VERSION } = require("../../../shared/contracts/runtime-v0");
const {
  evaluatePaths,
  fetchCatalogSnapshot,
  fetchPathsSnapshot,
} = require("../client/service-clients");
const {
  receiveScores,
  startRun,
  startSituation,
  stopSituation,
} = require("../run-control/runtime-engine");
const {
  readCurrentRunState,
  readRunState,
  saveRunState,
} = require("../run-control/state-store");
const { loadExpress } = require("./express-loader");

const express = loadExpress();

function asyncRoute(handler) {
  return (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
}

function runtimeClients() {
  return {
    fetchCatalogSnapshot,
    fetchPathsSnapshot,
    evaluatePaths,
  };
}

function createRuntimeApp(options = {}) {
  const app = express();
  const startedAt = new Date();
  const clients = options.clients || runtimeClients();
  app.use(express.json({ limit: "512kb" }));

  app.get("/health", (_req, res) => {
    const port = Number(process.env.RUNTIME_PORT || process.env.PORT || options.port || 3024);
    res.json({
      ok: true,
      service: "runtime",
      version: "v0",
      schemaVersion: RUNTIME_STATE_SCHEMA_VERSION,
      port,
      startedAt: startedAt.toISOString(),
      uptimeSeconds: Math.round(process.uptime()),
    });
  });

  app.post("/v0/runtime/runs/start", asyncRoute(async (_req, res) => {
    const state = await startRun({ clients });
    res.status(201).json(state);
  }));

  app.get("/v0/runtime/runs/current", asyncRoute(async (_req, res) => {
    res.json(await readCurrentRunState());
  }));

  app.get("/v0/runtime/runs/:showRunId", asyncRoute(async (req, res) => {
    res.json(await readRunState(req.params.showRunId));
  }));

  app.post("/v0/runtime/runs/:showRunId/start-situation", asyncRoute(async (req, res) => {
    const state = await readRunState(req.params.showRunId);
    res.json(await startSituation(state, clients));
  }));

  app.post("/v0/runtime/runs/:showRunId/stop-situation", asyncRoute(async (req, res) => {
    const state = await readRunState(req.params.showRunId);
    res.json(await stopSituation(state, clients));
  }));

  app.post("/v0/runtime/runs/:showRunId/scores", asyncRoute(async (req, res) => {
    const state = await readRunState(req.params.showRunId);
    const before = state.preparedNext ? state.preparedNext.situationId : null;
    receiveScores(state, req.body || {});
    await saveRunState(state);
    const after = state.preparedNext ? state.preparedNext.situationId : null;
    res.json({
      ok: true,
      preparedNextUnchanged: before === after,
      preparedNextSituationId: after,
      state,
    });
  }));

  app.use((req, res) => {
    res.status(404).json({ ok: false, error: "not_found", path: req.path });
  });

  app.use((err, _req, res, _next) => {
    res.status(500).json({
      ok: false,
      error: "runtime_service_error",
      message: err && err.message ? String(err.message) : "unknown_error",
    });
  });

  return app;
}

module.exports = {
  createRuntimeApp,
};
