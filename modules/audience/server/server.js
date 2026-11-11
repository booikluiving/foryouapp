"use strict";

const http = require("node:http");
const { createAudienceApp } = require("./app");
const { createAudiencePublicApp } = require("./public-app");
const { attachAudienceRealtime } = require("./realtime");

function audiencePort() {
  return Number(process.env.AUDIENCE_PORT || process.env.PORT || 3026);
}

function audiencePublicPort() {
  const raw = process.env.AUDIENCE_PUBLIC_PORT;
  return raw ? Number(raw) : 0;
}

// Publieke ingang (alleen als AUDIENCE_PUBLIC_PORT gezet is). Luistert standaard alleen op 127.0.0.1,
// zodat alleen cloudflared op deze Mac erbij kan.
function startAudiencePublicServer(service, options = {}) {
  const port = Number(options.publicPort || audiencePublicPort());
  if (!port) return null;
  const host = String(options.publicHost || process.env.AUDIENCE_PUBLIC_HOST || "127.0.0.1");
  const app = createAudiencePublicApp({ service });
  const server = http.createServer(app);
  server.audienceRealtime = attachAudienceRealtime(server, service, { publicMode: true });
  server.listen(port, host, () => {
    process.stdout.write(`Audience public entry listening on ${host}:${port}\n`);
  });
  return server;
}

function startAudienceServer(options = {}) {
  const port = Number(options.port || audiencePort());
  const app = createAudienceApp({ ...options, port });
  const server = http.createServer(app);
  const realtime = attachAudienceRealtime(server, app.locals.audienceService);
  server.listen(port, () => {
    process.stdout.write(`Audience Service listening on ${port}\n`);
  });
  server.audienceRealtime = realtime;
  if (options.faseWatch !== false) app.locals.audienceService.startFaseWatch();
  server.audiencePublicServer = startAudiencePublicServer(app.locals.audienceService, options);
  return server;
}

if (require.main === module) {
  startAudienceServer();
}

module.exports = {
  audiencePort,
  audiencePublicPort,
  startAudiencePublicServer,
  startAudienceServer,
};
