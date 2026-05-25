"use strict";

const fs = require("node:fs");

const FALLBACK_EXPRESS_MODULES = Object.freeze([
  "/opt/homebrew/lib/node_modules/node-red/node_modules/express",
]);

function tryLoadExpress(moduleId) {
  try {
    return require(moduleId);
  } catch (err) {
    return { error: err };
  }
}

function loadExpress() {
  if (process.env.V2_ALGORITHM_EXPRESS_MODULE) {
    const configured = tryLoadExpress(process.env.V2_ALGORITHM_EXPRESS_MODULE);
    if (!configured || !configured.error) return configured;
    throw configured.error;
  }
  const primary = tryLoadExpress("express");
  if (!primary || !primary.error) return primary;
  const fallbackErrors = [];
  for (const candidate of FALLBACK_EXPRESS_MODULES) {
    if (!fs.existsSync(candidate)) continue;
    const fallback = tryLoadExpress(candidate);
    if (!fallback || !fallback.error) return fallback;
    fallbackErrors.push(`${candidate}: ${fallback.error.message}`);
  }
  primary.error.message = [primary.error.message, ...fallbackErrors].join("\n");
  throw primary.error;
}

module.exports = {
  loadExpress,
};
