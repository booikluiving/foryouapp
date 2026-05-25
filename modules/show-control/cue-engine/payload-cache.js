"use strict";

const payloads = new Map();

function registerPayload(action = {}) {
  if (!action.payloadId) return;
  payloads.set(action.payloadId, {
    cueId: action.cueId,
    actionId: action.actionId,
    command: action.command,
    targetId: action.targetId,
    payload: action.payload || {},
    registeredAt: new Date().toISOString(),
  });
  if (payloads.size > 250) {
    const firstKey = payloads.keys().next().value;
    payloads.delete(firstKey);
  }
}

function findCachedPayload(payloadId) {
  const entry = payloads.get(String(payloadId || ""));
  if (!entry) return null;
  return entry.payload;
}

function clearPayloadCache() {
  payloads.clear();
}

module.exports = {
  clearPayloadCache,
  findCachedPayload,
  registerPayload,
};
