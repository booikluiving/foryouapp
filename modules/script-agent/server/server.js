"use strict";

const { createScriptAgentApp } = require("./app");

function scriptAgentPort() {
  return Number(process.env.SCRIPT_AGENT_PORT || process.env.PORT || 3027);
}

function startScriptAgentServer(options = {}) {
  const port = Number(options.port || scriptAgentPort());
  const app = createScriptAgentApp({ ...options, port });
  const server = app.listen(port, () => {
    process.stdout.write(`Script Agent Service V0 listening on ${port}\n`);
  });
  return server;
}

if (require.main === module) {
  startScriptAgentServer();
}

module.exports = {
  scriptAgentPort,
  startScriptAgentServer,
};
