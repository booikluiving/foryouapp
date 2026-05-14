"use strict";

// Crowd System — standalone crowd generation engine for For You.
// Separated from the core app for independent development, testing, and deployment.

const engine = require("./lib/crowd-engine");

module.exports = {
  // Core engine
  CrowdEngine: engine.CrowdEngine,
  CROWD_MODE_PRESETS: engine.CROWD_MODE_PRESETS,
  CROWD_CUES: engine.CROWD_CUES,
  HUMAN_ROLES: engine.HUMAN_ROLES,

  // Normalizers
  normalizeBotLabelMode: engine.normalizeBotLabelMode,
  normalizeCrowdConfig: engine.normalizeCrowdConfig,
  normalizeCrowdCue: engine.normalizeCrowdCue,
  normalizeCrowdMode: engine.normalizeCrowdMode,

  // Utilities
  createSeededRng: engine.createSeededRng,
};
