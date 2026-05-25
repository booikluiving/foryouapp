"use strict";

const path = require("node:path");

const {
  AUDIENCE_ALGORITHM_INPUT_SCHEMA_VERSION,
  AUDIENCE_SESSION_SCHEMA_VERSION,
  AUDIENCE_SIGNAL_SCHEMA_VERSION,
  createAudienceSessionId,
} = require("../../../shared/contracts/audience-v0");
const {
  fetchCurrentRuntimeState,
  restoreRuntimeAlgorithmContext,
  sendAudienceSignalsToAlgorithm,
  sendScoreFeedToRuntime,
} = require("../client/runtime-client");
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
const { AudienceService } = require("./audience-service");
const { loadExpress } = require("./express-loader");

const express = loadExpress();
const PUBLIC_DIR = path.resolve(__dirname, "../public");

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
    restoreRuntimeAlgorithmContext,
    sendAudienceSignalsToAlgorithm,
    sendScoreFeedToRuntime,
  };
}

function sendJoinError(res, title, message, status = 400) {
  res.status(status).type("html").send(
    `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${title}</title></head><body style="font-family:system-ui,-apple-system,sans-serif;padding:20px;"><h1>${title}</h1><p>${message}</p><p><a href="/">Ga naar de live chat</a></p></body></html>`
  );
}

function createAudienceApp(options = {}) {
  const app = express();
  const service = options.service || new AudienceService({
    ...options,
    clients: options.clients || audienceClients(),
  });
  app.locals.audienceService = service;
  app.use(express.json({ limit: "512kb" }));
  app.use("/v2/audience/vendor", express.static(path.join(PUBLIC_DIR, "vendor"), { fallthrough: false }));

  app.get("/health", (_req, res) => {
    res.json(service.health());
  });

  app.get(["/", "/app", "/v2/audience/public"], (_req, res) => {
    res.sendFile(path.join(PUBLIC_DIR, "index.html"));
  });

  app.get(["/admin", "/v2/audience/admin"], (_req, res) => {
    res.sendFile(path.join(PUBLIC_DIR, "admin.html"));
  });

  app.get("/v2/audience/stage", (_req, res) => {
    res.sendFile(path.join(PUBLIC_DIR, "stage.html"));
  });

  app.get("/v2/audience/stage/session-qr", (_req, res) => {
    res.sendFile(path.join(PUBLIC_DIR, "stage-qr.html"));
  });

  app.get("/join", (req, res) => {
    const token = String(req.query && req.query.token || "");
    if (!token) {
      service.clearAccessCookie(res, req);
      sendJoinError(res, "Join-link ongeldig", "Deze link bevat geen geldige token.", 400);
      return;
    }
    const joined = service.registerJoinFromToken(token, req);
    if (!joined.ok) {
      service.clearAccessCookie(res, req);
      const inactive = joined.error === "session_inactive";
      sendJoinError(
        res,
        inactive ? "Sessie is beeindigd" : "Join-link verlopen",
        inactive
          ? "Deze sessie is gesloten. Vraag de moderator om een nieuwe QR-code."
          : "Deze sessie-link is niet meer geldig. Vraag een nieuwe QR-code aan de moderator.",
        joined.status || 410
      );
      return;
    }
    service.setAccessCookie(res, req, joined.grant);
    res.redirect(302, "/");
  });

  app.get("/v2/audience/status", asyncRoute(async (req, res) => {
    res.json(await service.adminState(req));
  }));

  app.get("/v2/audience/public/history", (req, res) => {
    const ip = req.socket && req.socket.remoteAddress;
    const access = service.ensureSessionAccessForRequest(req, ip);
    if (!access.ok) {
      res.status(access.reason === "session_inactive" ? 410 : 403).json({
        ok: false,
        error: access.reason,
        messages: [],
      });
      return;
    }
    res.json(service.publicHistory(req.query.limit));
  });

  app.post("/v2/audience/public/debug", (_req, res) => {
    res.status(204).end();
  });

  app.get("/v2/audience/public/debug-log", (_req, res) => {
    res.json({ ok: true, lines: [] });
  });

  app.get("/v2/audience/admin/state", asyncRoute(async (req, res) => {
    res.json(await service.adminState(req));
  }));

  app.post("/v2/audience/admin/settings/message-slowdown", (req, res) => {
    const settings = service.updateMessageSlowdown(req.body && req.body.ms);
    res.json({
      ok: true,
      messageSlowdownMs: settings.messageSlowdownMs,
      messageSlowdownMinMs: 500,
      messageSlowdownMaxMs: 8000,
    });
  });

  app.post("/v2/audience/admin/settings/engagement-comment-points", (req, res) => {
    const settings = service.updateEngagementCommentPoints(req.body && req.body.points);
    res.json({
      ok: true,
      commentPoints: settings.engagementCommentPoints,
      commentPointsMin: 2,
      commentPointsMax: 150,
      emojiPoints: 1,
      commentMinChars: 4,
      duplicateWindowMs: 30000,
    });
  });

  app.post("/v2/audience/admin/stage/settings", (req, res) => {
    res.json({ ok: true, stage: service.updateStageSettings(req.body || {}, req) });
  });

  app.post("/v2/audience/admin/stage/test-emoji", (_req, res) => {
    service.emit("broadcast", {
      type: "stage_reaction",
      reaction: "heart",
      burst: 2,
      counts: { ...service.reactionCounts },
    });
    res.json({ ok: true, reaction: "heart", burst: 2 });
  });

  app.post("/v2/audience/admin/sessions/start", (req, res) => {
    const tokenTtlMinutes = req.body && req.body.tokenTtlMinutes;
    const result = service.startSession(req, {
      name: req.body && req.body.name,
      tokenTtlMinutes,
      createdBy: "admin",
    });
    res.status(201).json({ ok: true, session: result.session, join: result.join });
  });

  app.post("/v2/audience/admin/sessions/stop", (_req, res) => {
    const session = service.stopSession();
    res.json({ ok: true, session });
  });

  app.post("/v2/audience/admin/sessions/join-token", (req, res) => {
    const join = service.issueJoinToken(req, {
      ttlMinutes: req.body && req.body.ttlMinutes,
      createdBy: "admin",
    });
    res.status(201).json({ ok: true, join });
  });

  app.post("/v2/audience/admin/users/:action", (req, res) => {
    const action = String(req.params.action || "");
    if (!["mute", "unmute", "block", "unblock", "kick"].includes(action)) {
      res.status(404).json({ ok: false, error: "not_found" });
      return;
    }
    const result = service.setModeration(action, {
      clientKey: req.body && req.body.clientKey,
      ip: req.body && req.body.ip,
      targetKind: req.body && req.body.targetKind,
    }, req.body || {});
    res.json(result);
  });

  app.get("/v2/audience/admin/user-history", (req, res) => {
    const session = service.getActiveSession();
    if (!session) {
      res.status(409).json({ ok: false, error: "session_inactive" });
      return;
    }
    const clientKey = String(req.query.clientKey || "");
    const ip = String(req.query.ip || "");
    const limit = Math.max(10, Math.min(200, Number(req.query.limit || 80)));
    let messages = [];
    if (clientKey) {
      messages = service.store.recentChatMessagesByClientKey({ sessionId: session.id, clientKey, limit });
    } else if (ip) {
      messages = service.store.recentChatMessagesByIp({ sessionId: session.id, ip, limit });
    } else {
      messages = service.store.recentChatMessages({ sessionId: session.id, limit });
    }
    res.json({ ok: true, sessionId: session.id, targetIp: ip || null, targetClientKey: clientKey || null, messages });
  });

  app.post("/v2/audience/admin/polls/start", (req, res) => {
    const poll = service.startPoll(req.body || {});
    res.status(201).json({ ok: true, poll });
  });

  app.post("/v2/audience/admin/polls/close", (_req, res) => {
    const pollId = service.closePoll("admin_close");
    if (!pollId) {
      res.status(400).json({ ok: false, error: "no_active_poll" });
      return;
    }
    res.json({ ok: true, pollId });
  });

  app.post("/v2/audience/admin/simulation/start", (req, res) => {
    service.activeSessionRequired();
    res.json({ ok: true, simulation: service.simulation.start(req.body || {}) });
  });

  app.post("/v2/audience/admin/simulation/update", (req, res) => {
    res.json({ ok: true, simulation: service.simulation.update(req.body || {}) });
  });

  app.post("/v2/audience/admin/simulation/defaults", (req, res) => {
    const defaults = service.simulation.saveDefaults(req.body || {});
    res.json({ ok: true, defaults, simulation: service.simulation.getState() });
  });

  app.post("/v2/audience/admin/simulation/cue", (req, res) => {
    const accepted = service.simulation.issueCue(req.body && req.body.cue);
    if (!accepted) {
      res.status(400).json({ ok: false, error: "invalid_crowd_cue" });
      return;
    }
    res.json({ ok: true, accepted, simulation: service.simulation.getState() });
  });

  app.post("/v2/audience/admin/simulation/stop", (req, res) => {
    const reason = String(req.body && req.body.reason || "admin_stop").slice(0, 120);
    res.json({ ok: true, simulation: service.simulation.stop(reason) });
  });

  app.get("/v2/audience/algorithm-input", asyncRoute(async (req, res) => {
    res.json(await service.algorithmInput({
      showRunId: req.query.showRunId,
      situationRunId: req.query.situationRunId,
      sessionId: req.query.sessionId,
    }));
  }));

  app.post("/v2/audience/signals", asyncRoute(async (req, res) => {
    const session = service.getActiveSession();
    const meta = {
      sessionId: session ? session.id : 0,
      sessionPublicId: session ? session.publicId : "",
      clientId: req.body && req.body.clientId || "api",
      clientTag: req.body && req.body.clientTag || "api",
      clientKey: req.body && req.body.clientKey || "api|api",
      name: req.body && req.body.name || "API",
      ip: req.socket && req.socket.remoteAddress || "api",
      isBot: !!(req.body && req.body.isBot),
      simulated: !!(req.body && req.body.simulated),
    };
    const type = String(req.body && req.body.type || "").trim().toLowerCase();
    const signalType = type === "reaction" ? String(req.body.reaction || "").trim().toLowerCase() : type;
    const signal = await service.recordSignal({
      type: signalType,
      meta,
      text: req.body && (req.body.text || req.body.message) || null,
      reaction: req.body && req.body.reaction || null,
    });
    res.status(201).json({ ok: true, signal });
  }));

  app.get("/v2/audience/signals", (req, res) => {
    const signals = service.store.readSignals({
      showRunId: req.query.showRunId ? String(req.query.showRunId) : null,
      situationRunId: req.query.situationRunId ? String(req.query.situationRunId) : null,
      linkStatus: req.query.linkStatus ? String(req.query.linkStatus) : null,
      sessionId: req.query.sessionId ? Number(req.query.sessionId) : null,
    });
    res.json({ ok: true, count: signals.length, signals });
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
    const runtimeResult = await service.clients.fetchCurrentRuntimeState();
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
  AUDIENCE_ALGORITHM_INPUT_SCHEMA_VERSION,
  AUDIENCE_SIGNAL_SCHEMA_VERSION,
  audienceClients,
  createAudienceApp,
};
