"use strict";

function tryLoadExpress(moduleId) {
  try {
    return require(moduleId);
  } catch (err) {
    return { error: err };
  }
}

function loadExpress() {
  if (process.env.V2_SCRIPT_AGENT_EXPRESS_MODULE) {
    const configured = tryLoadExpress(process.env.V2_SCRIPT_AGENT_EXPRESS_MODULE);
    if (!configured || !configured.error) return configured;
    throw configured.error;
  }
  const primary = tryLoadExpress("express");
  if (!primary || !primary.error) return primary;
  throw primary.error;
}

module.exports = {
  loadExpress,
};
