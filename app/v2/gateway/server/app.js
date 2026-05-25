"use strict";

const path = require("node:path");

const {
  GATEWAY_ROUTE_SCHEMA_VERSION,
  GATEWAY_STATUS_SCHEMA_VERSION,
} = require("../../shared/contracts/gateway-v0");
const {
  buildGatewayStatus,
  forwardJson,
  routeManifest,
} = require("../client/service-clients");
const { loadExpress } = require("./express-loader");

const express = loadExpress();

function asyncRoute(handler) {
  return (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
}

function createGatewayApp(options = {}) {
  const app = express();
  const startedAt = new Date();
  const dashboardDir = path.resolve(__dirname, "../dashboard");
  app.use(express.json({ limit: "512kb" }));

  app.get("/health", (_req, res) => {
    const port = Number(process.env.GATEWAY_PORT || process.env.PORT || options.port || 3020);
    res.json({
      ok: true,
      service: "gateway",
      version: "v0",
      statusSchemaVersion: GATEWAY_STATUS_SCHEMA_VERSION,
      routeSchemaVersion: GATEWAY_ROUTE_SCHEMA_VERSION,
      port,
      startedAt: startedAt.toISOString(),
      uptimeSeconds: Math.round(process.uptime()),
    });
  });

  app.get("/", (_req, res) => {
    res.redirect("/dashboard/");
  });

  app.use("/dashboard", express.static(dashboardDir, { extensions: ["html"] }));

  app.get("/v0/gateway/status", asyncRoute(async (_req, res) => {
    res.json(await buildGatewayStatus());
  }));

  app.get("/v0/gateway/routes", (_req, res) => {
    res.json(routeManifest());
  });

  app.post("/v0/gateway/runtime/runs/start", asyncRoute(async (req, res) => {
    res.status(201).json(await forwardJson("runtime", "/v0/runtime/runs/start", {
      method: "POST",
      body: req.body || {},
    }));
  }));

  app.post("/v0/gateway/runtime/runs/:showRunId/start-situation", asyncRoute(async (req, res) => {
    res.json(await forwardJson("runtime", `/v0/runtime/runs/${encodeURIComponent(req.params.showRunId)}/start-situation`, {
      method: "POST",
      body: req.body || {},
    }));
  }));

  app.post("/v0/gateway/runtime/runs/:showRunId/stop-situation", asyncRoute(async (req, res) => {
    res.json(await forwardJson("runtime", `/v0/runtime/runs/${encodeURIComponent(req.params.showRunId)}/stop-situation`, {
      method: "POST",
      body: req.body || {},
    }));
  }));

  app.post("/v0/gateway/show-control/cues/prepare", asyncRoute(async (req, res) => {
    res.status(201).json(await forwardJson("showControl", "/v0/show-control/cues/prepare", {
      method: "POST",
      body: req.body || {},
    }));
  }));

  app.post("/v0/gateway/show-control/cues/go", asyncRoute(async (req, res) => {
    res.status(202).json(await forwardJson("showControl", "/v0/show-control/cues/go", {
      method: "POST",
      body: req.body || {},
    }));
  }));

  app.use((req, res) => {
    res.status(404).json({ ok: false, error: "not_found", path: req.path });
  });

  app.use((err, _req, res, _next) => {
    res.status(502).json({
      ok: false,
      error: "gateway_forwarding_error",
      message: err && err.message ? String(err.message) : "unknown_error",
    });
  });

  return app;
}

module.exports = {
  createGatewayApp,
};
