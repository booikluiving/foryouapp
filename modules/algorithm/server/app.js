"use strict";

const path = require("node:path");

const {
  ALGORITHM_CONFIG_SCHEMA_VERSION,
  ALGORITHM_SCORE_FEED_SCHEMA_VERSION,
} = require("../../../shared/contracts/algorithm-v0");
const {
  createAlgorithmRun,
  createScoringContext,
  getAlgorithmConfigSnapshot,
  getScoringContext,
  getScoreFeed,
  listScoringContexts,
  observeAudienceSignals,
  observeSituation,
  readAlgorithmConfig,
  simulateSituationObservation,
  updateAlgorithmConfig,
} = require("../scoring/algorithm-service");
const { loadExpress } = require("./express-loader");

const express = loadExpress();

function asyncRoute(handler) {
  return (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
}

function createAlgorithmApp(options = {}) {
  const app = express();
  const startedAt = new Date();
  const uiRoot = path.resolve(__dirname, "../ui/control");
  const sharedUiRoot = path.resolve(__dirname, "../../../shared/ui");
  app.use(express.json({ limit: "2mb" }));

  app.get("/", (_req, res) => {
    res.redirect("/algorithm/");
  });

  app.use("/shared/ui", express.static(sharedUiRoot));
  app.use("/algorithm", express.static(uiRoot, { extensions: ["html"] }));

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

  app.get("/v0/algorithm/config", asyncRoute(async (_req, res) => {
    res.json(await readAlgorithmConfig());
  }));

  app.patch("/v0/algorithm/config", asyncRoute(async (req, res) => {
    res.json(await updateAlgorithmConfig(req.body || {}, { replace: false }));
  }));

  app.put("/v0/algorithm/config", asyncRoute(async (req, res) => {
    res.json(await updateAlgorithmConfig(req.body || {}, { replace: true }));
  }));

  app.get("/v0/algorithm/config-snapshot", asyncRoute(async (_req, res) => {
    res.json(await getAlgorithmConfigSnapshot());
  }));

  app.get("/v0/algorithm/scoring-contexts", asyncRoute(async (_req, res) => {
    res.json(await listScoringContexts());
  }));

  app.post("/v0/algorithm/scoring-contexts", asyncRoute(async (req, res) => {
    const state = await createScoringContext(req.body || {});
    res.status(201).json({
      ok: true,
      contextType: "scoring-context",
      showRunId: state.showRunId,
      config: state.config,
      scoreFeed: state.scoreFeed,
    });
  }));

  app.get("/v0/algorithm/scoring-contexts/:showRunId", asyncRoute(async (req, res) => {
    res.json(await getScoringContext(req.params.showRunId));
  }));

  app.get("/v0/algorithm/scoring-contexts/:showRunId/scores", asyncRoute(async (req, res) => {
    res.json(await getScoreFeed(req.params.showRunId));
  }));

  app.post("/v0/algorithm/runs", asyncRoute(async (req, res) => {
    const state = await createAlgorithmRun(req.body || {});
    res.status(201).json({
      ok: true,
      deprecated: true,
      replacement: "/v0/algorithm/scoring-contexts",
      contextType: "scoring-context",
      showRunId: state.showRunId,
      config: state.config,
      scoreFeed: state.scoreFeed,
    });
  }));

  app.get("/v0/algorithm/runs/:showRunId", asyncRoute(async (req, res) => {
    const state = await getScoringContext(req.params.showRunId);
    res.json({
      ...state,
      deprecated: true,
      replacement: `/v0/algorithm/scoring-contexts/${encodeURIComponent(req.params.showRunId)}`,
    });
  }));

  app.get("/v0/algorithm/runs/:showRunId/scores", asyncRoute(async (req, res) => {
    res.json(await getScoreFeed(req.params.showRunId));
  }));

  app.post("/v0/algorithm/events/situation-observed", asyncRoute(async (req, res) => {
    const result = await observeSituation(req.body || {});
    res.status(201).json(result);
  }));

  app.post("/v0/algorithm/events/audience-signals", asyncRoute(async (req, res) => {
    const result = await observeAudienceSignals(req.body || {});
    res.status(201).json(result);
  }));

  app.post("/v0/algorithm/simulate", asyncRoute(async (req, res) => {
    res.json(await simulateSituationObservation(req.body || {}));
  }));

  app.use((req, res) => {
    res.status(404).json({ ok: false, error: "not_found", path: req.path });
  });

  app.use((err, _req, res, _next) => {
    const message = err && err.message ? String(err.message) : "unknown_error";
    const missingContext = message.startsWith("algorithm_missing_scoring_context:");
    const statusCode = missingContext
      ? 404
      : message.startsWith("algorithm_") || message.startsWith("invalid_algorithm_") ? 400 : 500;
    res.status(statusCode).json({
      ok: false,
      error: missingContext ? "algorithm_missing_scoring_context" : statusCode === 400 ? "algorithm_validation_error" : "algorithm_service_error",
      message,
    });
  });

  return app;
}

module.exports = {
  createAlgorithmApp,
};
