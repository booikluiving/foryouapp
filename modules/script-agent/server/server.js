"use strict";

const { attachOperatorStageRealtime } = require("../operator/realtime");
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
  attachOperatorStageRealtime(server, app.locals.operatorService);
  server.on("close", () => {
    if (typeof app.locals.stopOperatorDraftSync === "function") app.locals.stopOperatorDraftSync();
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
