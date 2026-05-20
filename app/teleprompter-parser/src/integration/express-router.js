"use strict";

const path = require("node:path");

const { createTelepromptStore } = require("../runtime/teleprompt-store");

const PUBLIC_DIR = path.join(__dirname, "..", "..", "public");

function sendJson(res, statusCode, payload) {
  res.status(statusCode).json(payload);
}

function publicError(err, fallback) {
  return err && err.message ? String(err.message) : fallback;
}

function normalizeBody(req) {
  return req && req.body && typeof req.body === "object" ? req.body : {};
}

function normalizeRawText(body) {
  return String(body.rawText || body.text || "");
}

function mountTeleprompterParser(app, options = {}) {
  const express = options.express;
  if (!app || !express || typeof express.Router !== "function") {
    throw new Error("express_app_required");
  }

  const requireAdmin = typeof options.requireAdmin === "function"
    ? options.requireAdmin
    : (req, res, next) => next();
  const service = options.service || createTelepromptStore();
  const mountPath = options.mountPath || "/teleprompter-parser";
  const apiPath = options.apiPath || "/api/teleprompter-parser";
  const adminPath = options.adminPath || "/admin/teleprompter-parser";

  const apiRouter = express.Router();
  apiRouter.get("/health", (req, res) => {
    sendJson(res, 200, {
      ok: true,
      service: "teleprompter-parser",
      currentVersion: service.current().version,
    });
  });
  apiRouter.get("/current", (req, res) => {
    sendJson(res, 200, {
      ok: true,
      teleprompt: service.current(),
    });
  });

  const adminRouter = express.Router();
  adminRouter.post("/parse", (req, res) => {
    try {
      const body = normalizeBody(req);
      const rawText = normalizeRawText(body);
      if (!rawText.trim()) {
        sendJson(res, 400, { ok: false, error: "raw_text_required" });
        return;
      }
      const teleprompt = service.ingest({
        title: body.title,
        rawText,
        source: body.source || "manual",
      });
      sendJson(res, 200, { ok: true, teleprompt });
    } catch (err) {
      sendJson(res, 500, { ok: false, error: publicError(err, "teleprompt_parse_failed") });
    }
  });

  const uiRouter = express.Router();
  uiRouter.get(["/", ""], requireAdmin, (req, res) => {
    res.sendFile(path.join(PUBLIC_DIR, "parser.html"));
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
  app.use(adminPath, requireAdmin, adminRouter);
  app.use(mountPath, uiRouter);

  return {
    adminPath,
    apiPath,
    mountPath,
    service,
    current: service.current,
    ingest: service.ingest,
  };
}

module.exports = {
  PUBLIC_DIR,
  mountTeleprompterParser,
};

