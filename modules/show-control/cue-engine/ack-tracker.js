"use strict";

const pendingWaiters = new Map();
const queuedAcks = new Map();
const actionLookup = new Map();

function waiterKey(cueId, actionId) {
  return `${cueId}::${actionId}`;
}

function normalizeAckPayload(payload = {}) {
  const cueId = payload.cueId ? String(payload.cueId) : "";
  const payloadId = payload.payloadId ? String(payload.payloadId) : "";
  const command = payload.command ? String(payload.command) : "";
  const actionId = payload.actionId
    ? String(payload.actionId)
    : actionLookup.get(`${cueId}::payload::${payloadId}`) || actionLookup.get(`${cueId}::command::${command}`) || "";
  return {
    cueId,
    actionId,
    targetId: payload.targetId ? String(payload.targetId) : "",
    payloadId,
    command,
    stage: payload.stage ? String(payload.stage) : "received",
    state: payload.state || payload.status || "ok",
    message: payload.message || null,
    ackedAt: payload.ackedAt || new Date().toISOString(),
  };
}

function isWarningAck(ack) {
  const state = String(ack.state || "").toLowerCase();
  const stage = String(ack.stage || "").toLowerCase();
  return state === "warning" || state === "error" || state === "failed"
    || stage === "warning" || stage === "failed" || stage === "error" || stage === "timedout";
}

function matchesAck(ack, action, expectedStages = []) {
  if (!ack || !action) return false;
  if (ack.actionId && ack.actionId !== action.actionId) return false;
  if (ack.command && ack.command !== action.command) return false;
  if (expectedStages.length && !expectedStages.includes(ack.stage)) return false;
  return true;
}

function recordAck(rawPayload) {
  const ack = normalizeAckPayload(rawPayload);
  const key = waiterKey(ack.cueId, ack.actionId);
  const waiters = pendingWaiters.get(key) || [];
  const remaining = [];
  for (const waiter of waiters) {
    if (matchesAck(ack, waiter.action, waiter.expectedStages)) {
      waiter.resolve(ack);
    } else {
      remaining.push(waiter);
    }
  }
  if (remaining.length) pendingWaiters.set(key, remaining);
  else pendingWaiters.delete(key);

  if (!waiters.length || remaining.length) {
    const existing = queuedAcks.get(key) || [];
    existing.push(ack);
    queuedAcks.set(key, existing.slice(-12));
  }
  return ack;
}

function registerAction(action = {}) {
  if (!action.cueId || !action.actionId) return;
  if (action.payloadId) actionLookup.set(`${action.cueId}::payload::${action.payloadId}`, action.actionId);
  if (action.command) actionLookup.set(`${action.cueId}::command::${action.command}`, action.actionId);
}

function waitForAck(action, options = {}) {
  const timeoutMs = Math.max(1, Number(options.timeoutMs || action.timeoutMs || 1500));
  const expectedStages = Array.isArray(options.expectedStages) ? options.expectedStages : [];
  const key = waiterKey(action.cueId, action.actionId);
  const queued = queuedAcks.get(key) || [];
  const matched = queued.find((ack) => matchesAck(ack, action, expectedStages));
  if (matched) return Promise.resolve(matched);

  return new Promise((resolve, reject) => {
    const waiter = {
      action,
      expectedStages,
      resolve: (ack) => {
        clearTimeout(timer);
        resolve(ack);
      },
      reject: (err) => {
        clearTimeout(timer);
        reject(err);
      },
    };
    const timer = setTimeout(() => {
      const waiters = (pendingWaiters.get(key) || []).filter((item) => item !== waiter);
      if (waiters.length) pendingWaiters.set(key, waiters);
      else pendingWaiters.delete(key);
      reject(new Error(`show_control_ack_timeout:${action.actionId}`));
    }, timeoutMs);
    const waiters = pendingWaiters.get(key) || [];
    waiters.push(waiter);
    pendingWaiters.set(key, waiters);
  });
}

function clearAckTracker() {
  for (const waiters of pendingWaiters.values()) {
    for (const waiter of waiters) {
      waiter.reject(new Error("show_control_ack_tracker_cleared"));
    }
  }
  pendingWaiters.clear();
  queuedAcks.clear();
  actionLookup.clear();
}

module.exports = {
  clearAckTracker,
  isWarningAck,
  normalizeAckPayload,
  registerAction,
  recordAck,
  waitForAck,
};
