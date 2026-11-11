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
  // Flits (of een andere clip) die vanzelf langskomt bij de omgeving die speelt.
  const vanzelfMs = Number(options.vanzelfTickMs ?? process.env.SHOW_CONTROL_VANZELF_TICK_MS ?? 2000);
  let vanzelfBezig = false;
  const vanzelfTimer = vanzelfMs > 0 ? setInterval(() => {
    if (vanzelfBezig) return;
    vanzelfBezig = true;
    Promise.resolve()
      .then(() => app.locals.environmentVanzelfTick())
      .catch(() => {})
      .finally(() => { vanzelfBezig = false; });
  }, vanzelfMs) : null;
  if (vanzelfTimer) vanzelfTimer.unref();
  server.on("close", () => {
    if (vanzelfTimer) clearInterval(vanzelfTimer);
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
