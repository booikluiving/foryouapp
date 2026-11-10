"use strict";

// Publieke ingang van de audience-app: alleen wat een telefoon van het publiek nodig heeft.
// Draait naast de LAN-server (:3026) op een eigen poort, alleen op 127.0.0.1; de Cloudflare Tunnel
// op de show-Mac wijst hierheen. Admin, stage, signalen en status bestaan hier niet.

const path = require("node:path");
const { loadExpress } = require("./express-loader");

const express = loadExpress();
const PUBLIC_DIR = path.resolve(__dirname, "../public");

function escapeHtml(value) {
  return String(value || "").replace(/[&<>"']/g, (ch) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[ch]);
}

function sendPage(res, title, message, status = 200) {
  res.status(status).type("html").send(
    `<!doctype html><html lang="nl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>For_You</title></head>`
    + `<body style="font-family:system-ui,-apple-system,sans-serif;padding:24px;max-width:32rem;margin:auto;">`
    + `<h1>${escapeHtml(title)}</h1><p>${escapeHtml(message)}</p></body></html>`
  );
}

function createAudiencePublicApp({ service } = {}) {
  if (!service) throw new Error("audience_service_required");
  const app = express();
  app.disable("x-powered-by");

  app.use((req, res, next) => {
    req.fyPublic = true;
    res.set({
      "X-Content-Type-Options": "nosniff",
      "X-Frame-Options": "DENY",
      "Referrer-Policy": "no-referrer",
      "Cache-Control": "no-store",
    });
    next();
  });

  app.use(express.json({ limit: "16kb" }));
  app.use("/v2/audience/vendor", express.static(path.join(PUBLIC_DIR, "vendor"), { fallthrough: false }));

  app.get("/health", (_req, res) => {
    const health = service.health();
    res.json({
      ok: true,
      service: health.service,
      instanceId: health.instanceId,
      buildVersion: health.buildVersion,
      buildLabel: health.buildLabel,
    });
  });

  app.get(["/", "/app"], (_req, res) => {
    res.sendFile(path.join(PUBLIC_DIR, "index.html"));
  });

  // QR: https://www.foryouniverse.nl/live?t=<token> → (doorverwijzing) → hier.
  app.get(["/live", "/join"], (req, res) => {
    const token = String(req.query && (req.query.t || req.query.token) || "");
    if (!token) {
      const access = service.ensureSessionAccessForRequest(req, service.requestAddress(req));
      if (access.ok) {
        res.redirect(302, "/");
        return;
      }
      sendPage(res, "For_You", "Scan de QR-code in de zaal om mee te doen.");
      return;
    }
    const joined = service.registerJoinFromToken(token, req);
    if (!joined.ok) {
      service.clearAccessCookie(res, req);
      const inactive = joined.error === "session_inactive";
      sendPage(
        res,
        inactive ? "De voorstelling is afgelopen" : "Deze QR-code is verlopen",
        inactive
          ? "Er loopt nu geen voorstelling. Bedankt voor het meedoen."
          : "Scan de QR-code die nu in de zaal te zien is.",
        joined.status || 410
      );
      return;
    }
    service.setAccessCookie(res, req, joined.grant);
    res.redirect(302, "/");
  });

  app.get("/v2/audience/public/history", (req, res) => {
    const access = service.ensureSessionAccessForRequest(req, service.requestAddress(req));
    if (!access.ok) {
      res.status(access.reason === "session_inactive" ? 410 : 403).json({ ok: false, error: access.reason, messages: [] });
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

  app.use((_req, res) => {
    res.status(404).type("text").send("Niet gevonden");
  });

  app.use((err, _req, res, _next) => {
    const status = Number(err && (err.statusCode || err.status)) || 500;
    res.status(status >= 400 && status < 600 ? status : 500).type("text").send(status === 404 ? "Niet gevonden" : "Er ging iets mis");
  });

  return app;
}

module.exports = {
  createAudiencePublicApp,
};
