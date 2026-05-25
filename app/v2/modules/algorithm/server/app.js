"use strict";

const {
  ALGORITHM_CONFIG_SCHEMA_VERSION,
  ALGORITHM_SCORE_FEED_SCHEMA_VERSION,
} = require("../../../shared/contracts/algorithm-v0");
const {
  createAlgorithmRun,
  getScoreFeed,
  observeSituation,
} = require("../scoring/algorithm-service");
const { defaultAlgorithmConfig } = require("../scoring/score-engine");
const { readAlgorithmRunState } = require("../score-history/state-store");
const { loadExpress } = require("./express-loader");

const express = loadExpress();

function asyncRoute(handler) {
  return (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
}

function createAlgorithmApp(options = {}) {
  const app = express();
  const startedAt = new Date();
  app.use(express.json({ limit: "2mb" }));

  app.get("/health", (_req, res) => {
    const port = Number(process.env.ALGORITHM_PORT || process.env.PORT || options.port || 3023);
    res.json({
      ok: true,
      service: "algorithm",
      version: "v0",
      configSchemaVersion: ALGORITHM_CONFIG_SCHEMA_VERSION,
      scoreFeedSchemaVersion: ALGORITHM_SCORE_FEED_SCHEMA_VERSION,
      port,
      startedAt: startedAt.toISOString(),
      uptimeSeconds: Math.round(process.uptime()),
    });
  });

  app.get("/v0/algorithm/config-snapshot", (_req, res) => {
    res.json(defaultAlgorithmConfig());
  });

  app.post("/v0/algorithm/runs", asyncRoute(async (req, res) => {
    const state = await createAlgorithmRun(req.body || {});
    res.status(201).json({
      ok: true,
      showRunId: state.showRunId,
      config: state.config,
      scoreFeed: state.scoreFeed,
    });
  }));

  app.get("/v0/algorithm/runs/:showRunId", asyncRoute(async (req, res) => {
    res.json(await readAlgorithmRunState(req.params.showRunId));
  }));

  app.get("/v0/algorithm/runs/:showRunId/scores", asyncRoute(async (req, res) => {
    res.json(await getScoreFeed(req.params.showRunId));
  }));

  app.post("/v0/algorithm/events/situation-observed", asyncRoute(async (req, res) => {
    const result = await observeSituation(req.body || {});
    res.status(201).json(result);
  }));

  app.use((req, res) => {
    res.status(404).json({ ok: false, error: "not_found", path: req.path });
  });

  app.use((err, _req, res, _next) => {
    res.status(500).json({
      ok: false,
      error: "algorithm_service_error",
      message: err && err.message ? String(err.message) : "unknown_error",
    });
  });

  return app;
}

module.exports = {
  createAlgorithmApp,
};
