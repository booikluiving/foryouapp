"use strict";

const path = require("path");
const { createTelepromptStore } = require("../runtime/teleprompt-store");

function mountTeleprompterParser(app, options = {}) {
  const express = options.express;
  const requireAdmin = typeof options.requireAdmin === "function" ? options.requireAdmin : (_req, _res, next) => next();
  const store = createTelepromptStore();
  const publicDir = path.join(__dirname, "..", "..", "public");
  const eventClients = new Set();

  function currentPayload(reason = "current") {
    return {
      ok: true,
      reason,
      teleprompt: store.getCurrent(),
      cue: store.getCue(),
      captionStyle: store.getCaptionStyle(),
    };
  }

  function sendEvent(res, payload) {
    res.write(`data: ${JSON.stringify(payload)}\n\n`);
  }

  function broadcast(reason) {
    if (!eventClients.size) return;
    const payload = currentPayload(reason);
    for (const res of eventClients) {
      sendEvent(res, payload);
    }
  }

  app.get("/teleprompter-parser", requireAdmin, (_req, res) => {
    res.sendFile(path.join(publicDir, "parser.html"));
  });

  app.get("/teleprompter-parser/stage", (_req, res) => {
    res.sendFile(path.join(publicDir, "stage.html"));
  });

  app.get("/teleprompter-parser/live-captions", (_req, res) => {
    res.sendFile(path.join(publicDir, "live-captions.html"));
  });

  app.use("/teleprompter-parser", express.static(publicDir));

  app.get("/api/teleprompter-parser/health", (_req, res) => {
    res.json({
      ok: true,
      currentVersion: store.getCurrent() ? store.getCurrent().version : 0,
      cue: store.getCue(),
      captionStyle: store.getCaptionStyle(),
    });
  });

  app.get("/api/teleprompter-parser/current", (_req, res) => {
    res.json(currentPayload());
  });

  app.get("/api/teleprompter-parser/events", (req, res) => {
    res.status(200);
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");
    res.setHeader("Connection", "keep-alive");
    res.flushHeaders && res.flushHeaders();
    eventClients.add(res);
    sendEvent(res, currentPayload("hello"));
    req.on("close", () => {
      eventClients.delete(res);
    });
  });

  app.post("/api/teleprompter-parser/cue", (req, res) => {
    const body = req.body && typeof req.body === "object" ? req.body : {};
    const result = store.setCueIndex(body.index);
    if (result.changed) broadcast("cue");
    res.json({
      ok: true,
      cue: result.cue,
      teleprompt: store.getCurrent(),
      captionStyle: store.getCaptionStyle(),
    });
  });

  app.post("/admin/teleprompter-parser/caption-style", requireAdmin, (req, res) => {
    const body = req.body && typeof req.body === "object" ? req.body : {};
    const styleInput = body.captionStyle && typeof body.captionStyle === "object" ? body.captionStyle : body;
    const result = store.setCaptionStyle(styleInput);
    if (result.changed) broadcast("caption_style");
    res.json({
      ok: true,
      captionStyle: result.captionStyle,
      cue: store.getCue(),
      teleprompt: store.getCurrent(),
    });
  });

  app.post("/admin/teleprompter-parser/parse", requireAdmin, (req, res) => {
    const body = req.body && typeof req.body === "object" ? req.body : {};
    const rawText = String(body.rawText || body.text || "");
    if (!rawText.trim()) {
      res.status(400).json({ ok: false, error: "raw_text_required" });
      return;
    }
    const teleprompt = store.ingest({
      title: body.title || "",
      rawText,
      source: body.source || "manual",
    });
    broadcast("parse");
    res.json({
      ok: true,
      teleprompt,
      cue: store.getCue(),
    });
  });

  function ingest(input = {}) {
    const teleprompt = store.ingest(input);
    broadcast("ingest");
    return teleprompt;
  }

  function getCurrent() {
    return store.getCurrent();
  }

  return {
    ingest,
    getCurrent,
    getCue: () => store.getCue(),
    getCaptionStyle: () => store.getCaptionStyle(),
  };
}

module.exports = {
  mountTeleprompterParser,
};
