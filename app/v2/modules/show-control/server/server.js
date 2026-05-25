"use strict";

const { createShowControlApp } = require("./app");

function showControlPort() {
  return Number(process.env.SHOW_CONTROL_PORT || process.env.PORT || 3025);
}

function startShowControlServer(options = {}) {
  const port = Number(options.port || showControlPort());
  const app = createShowControlApp({ ...options, port });
  const server = app.listen(port, () => {
    process.stdout.write(`Show Control Service V0 listening on ${port}\n`);
  });
  return server;
}

if (require.main === module) {
  startShowControlServer();
}

module.exports = {
  showControlPort,
  startShowControlServer,
};
