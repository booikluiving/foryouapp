"use strict";

const { createPathsApp } = require("./app");

function pathsPort() {
  return Number(process.env.PATHS_PORT || process.env.PORT || 3022);
}

function startPathsServer(options = {}) {
  const port = Number(options.port || pathsPort());
  const app = createPathsApp({ ...options, port });
  const server = app.listen(port, () => {
    process.stdout.write(`Paths Service V0 listening on ${port}\n`);
  });
  return server;
}

if (require.main === module) {
  startPathsServer();
}

module.exports = {
  pathsPort,
  startPathsServer,
};
