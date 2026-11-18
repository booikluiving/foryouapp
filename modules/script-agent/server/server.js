"use strict";

// Het netwerk op locatie verbreekt TLS-handdrukken met de post-quantum-sleutel (X25519MLKEM768) die
// Node sinds kort standaard stuurt: ECONNRESET naar de website, OpenRouter en Anthropic. Klassieke curves
// werken overal.
require("node:tls").DEFAULT_ECDH_CURVE = "X25519:P-256:P-384";

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
