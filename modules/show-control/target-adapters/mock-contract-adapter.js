"use strict";

function contractStore(context) {
  if (!context.mockContracts) context.mockContracts = [];
  return context.mockContracts;
}

async function sendContractCommand(action, context = {}) {
  const entry = {
    at: new Date().toISOString(),
    targetId: action.targetId,
    command: action.command,
    payload: action.payload || {},
  };
  contractStore(context).push(entry);
  return {
    stage: action.ackMode === "required-ready" ? "loaded" : "applied",
    state: "ok",
    message: `${action.targetId} contract recorded`,
    data: { contract: entry },
  };
}

async function sendDebugCommand(action, context = {}) {
  return sendContractCommand(action, context);
}

module.exports = {
  sendContractCommand,
  sendDebugCommand,
};
