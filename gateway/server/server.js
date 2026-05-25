"use strict";

const { createGatewayApp } = require("./app");

function gatewayPort() {
  return Number(process.env.GATEWAY_PORT || process.env.PORT || 3020);
}

function startGatewayServer(options = {}) {
  const port = Number(options.port || gatewayPort());
  const app = createGatewayApp({ ...options, port });
  const server = app.listen(port, () => {
    process.stdout.write(`Gateway / Dashboard V0 listening on ${port}\n`);
  });
  return server;
}

if (require.main === module) {
  startGatewayServer();
}

module.exports = {
  gatewayPort,
  startGatewayServer,
};
