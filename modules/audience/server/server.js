"use strict";

const http = require("node:http");
const { createAudienceApp } = require("./app");
const { attachAudienceRealtime } = require("./realtime");

function audiencePort() {
  return Number(process.env.AUDIENCE_PORT || process.env.PORT || 3026);
}

function startAudienceServer(options = {}) {
  const port = Number(options.port || audiencePort());
  const app = createAudienceApp({ ...options, port });
  const server = http.createServer(app);
  const realtime = attachAudienceRealtime(server, app.locals.audienceService);
  server.listen(port, () => {
    process.stdout.write(`Audience Service V2 listening on ${port}\n`);
  });
  server.audienceRealtime = realtime;
  return server;
}

if (require.main === module) {
  startAudienceServer();
}

module.exports = {
  audiencePort,
  startAudienceServer,
};
