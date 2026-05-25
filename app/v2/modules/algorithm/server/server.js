"use strict";

const { createAlgorithmApp } = require("./app");

function algorithmPort() {
  return Number(process.env.ALGORITHM_PORT || process.env.PORT || 3023);
}

function startAlgorithmServer(options = {}) {
  const port = Number(options.port || algorithmPort());
  const app = createAlgorithmApp({ ...options, port });
  const server = app.listen(port, () => {
    process.stdout.write(`Algorithm Service V0 listening on ${port}\n`);
  });
  return server;
}

if (require.main === module) {
  startAlgorithmServer();
}

module.exports = {
  algorithmPort,
  startAlgorithmServer,
};
