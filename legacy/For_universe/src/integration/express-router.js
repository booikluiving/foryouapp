"use strict";

const path = require("node:path");

const { createGraphService } = require("../domain/graph-model");

const PUBLIC_DIR = path.join(__dirname, "..", "public");

function sendJson(res, statusCode, payload) {
  res.status(statusCode).json(payload);
}

function sendServicePayload(res, payload) {
  sendJson(res, payload && payload.ok === false ? 500 : 200, payload);
}

function sendServiceError(res, err) {
  sendJson(res, 500, {
    ok: false,
    error: err && err.message ? err.message : "server_error",
  });
}

function routeService(router, pathName, callback) {
  router.get(pathName, (req, res) => {
    try {
      sendServicePayload(res, callback());
    } catch (err) {
      sendServiceError(res, err);
    }
  });
}

function mountUniverse(app, options = {}) {
  const express = options.express;
  if (!app || !express || typeof express.Router !== "function") {
    throw new Error("express_app_required");
  }

  const mountPath = options.mountPath || "/universe";
  const apiPath = options.apiPath || "/api/universe";
  const service = createGraphService({
    databasePath: options.databasePath,
    runtimeProvider: options.runtimeProvider,
  });

  const apiRouter = express.Router();
  routeService(apiRouter, "/health", () => service.health());
  routeService(apiRouter, "/source-schema", () => service.sourceSchema());
  routeService(apiRouter, "/graph", () => service.graph());
  routeService(apiRouter, "/runtime", () => service.runtime());

  const uiRouter = express.Router();
  uiRouter.get(["/", ""], (req, res) => {
    res.sendFile(path.join(PUBLIC_DIR, "index.html"));
  });
  uiRouter.get(["/stage", "/stage/"], (req, res) => {
    res.sendFile(path.join(PUBLIC_DIR, "stage.html"));
  });
  uiRouter.use(express.static(PUBLIC_DIR, {
    fallthrough: true,
    index: false,
    maxAge: "30s",
  }));

  app.use(apiPath, apiRouter);
  app.use(mountPath, uiRouter);

  return {
    apiPath,
    mountPath,
    service,
  };
}

module.exports = {
  PUBLIC_DIR,
  mountUniverse,
};
