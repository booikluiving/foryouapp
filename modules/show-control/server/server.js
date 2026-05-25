"use strict";

const { createShowControlApp } = require("./app");
const { startTdAckServer } = require("./td-ack-server");

function showControlPort() {
  return Number(process.env.SHOW_CONTROL_PORT || process.env.PORT || 3025);
}

function startShowControlServer(options = {}) {
  const port = Number(options.port || showControlPort());
  const app = createShowControlApp({ ...options, port });
  const tdAckServer = startTdAckServer(options);
  const server = app.listen(port, () => {
    process.stdout.write(`Show Control Service V0 listening on ${port}\n`);
    if (tdAckServer) {
      process.stdout.write(`Show Control TD ack OSC listening on ${tdAckServer.localAddress}:${tdAckServer.localPort}\n`);
    }
  });
  server.on("close", () => {
    if (tdAckServer) tdAckServer.close();
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
