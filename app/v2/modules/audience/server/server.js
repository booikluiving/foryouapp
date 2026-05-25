"use strict";

const { createAudienceApp } = require("./app");

function audiencePort() {
  return Number(process.env.AUDIENCE_PORT || process.env.PORT || 3026);
}

function startAudienceServer(options = {}) {
  const port = Number(options.port || audiencePort());
  const app = createAudienceApp({ ...options, port });
  const server = app.listen(port, () => {
    process.stdout.write(`Audience Service V0 listening on ${port}\n`);
  });
  return server;
}

if (require.main === module) {
  startAudienceServer();
}

module.exports = {
  audiencePort,
  startAudienceServer,
};
