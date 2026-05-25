"use strict";

const { createRuntimeApp } = require("./app");

function runtimePort() {
  return Number(process.env.RUNTIME_PORT || process.env.PORT || 3024);
}

function startRuntimeServer(options = {}) {
  const port = Number(options.port || runtimePort());
  const app = createRuntimeApp({ ...options, port });
  const server = app.listen(port, () => {
    process.stdout.write(`Runtime Service V0 listening on ${port}\n`);
  });
  return server;
}

if (require.main === module) {
  startRuntimeServer();
}

module.exports = {
  runtimePort,
  startRuntimeServer,
};
