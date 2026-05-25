"use strict";

const path = require("node:path");

const {
  MODULE_ROOT,
  audienceDbPath,
  assertAudienceStoragePath,
  getAudienceStore,
} = require("../db/audience-store");

const V2_ROOT = path.resolve(MODULE_ROOT, "../..");

function audienceDbDir() {
  return path.dirname(audienceDbPath());
}

function signalsFilePath() {
  return audienceDbPath();
}

function sessionsFilePath() {
  return audienceDbPath();
}

async function appendAudienceSignal(signal) {
  getAudienceStore().insertSignal(signal, {
    sessionRef: signal && signal.sessionId ? String(signal.sessionId) : null,
  });
  return signal;
}

async function readAudienceSignals(filter = {}) {
  return getAudienceStore().readSignals(filter);
}

async function appendAudienceSession(session) {
  const store = getAudienceStore();
  const existing = store.getActiveSession();
  if (existing && existing.publicId === session.sessionId) return session;
  store.startSession({
    name: session.sessionId || "Audience session",
    publicId: session.sessionId || "",
    createdBy: "v0-compat",
    now: session.createdAt || new Date().toISOString(),
  });
  return session;
}

async function readAudienceSessions() {
  return getAudienceStore().listSessions(100).map((session) => ({
    schemaVersion: "audience.session.v0",
    sessionId: session.publicId,
    createdAt: session.startedAt,
    endedAt: session.endedAt,
    source: {
      type: "audience-v2-sqlite-session",
      readOnly: true,
    },
  }));
}

module.exports = {
  V2_ROOT,
  appendAudienceSession,
  appendAudienceSignal,
  assertPathUnderV2: assertAudienceStoragePath,
  audienceDbDir,
  readAudienceSessions,
  readAudienceSignals,
  sessionsFilePath,
  signalsFilePath,
};
