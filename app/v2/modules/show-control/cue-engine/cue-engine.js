"use strict";

const {
  SHOW_CONTROL_ACK_SCHEMA_VERSION,
  validateCueShape,
} = require("../../../shared/contracts/show-control-v0");
const { sendAction } = require("../target-adapters/mock-adapter");

function delay(ms) {
  const safeMs = Math.max(0, Number(ms || 0));
  if (!safeMs) return Promise.resolve();
  return new Promise((resolve) => setTimeout(resolve, safeMs));
}

function nowIso() {
  return new Date().toISOString();
}

function actionPublicStatus(result) {
  return {
    stage: result.stage,
    state: result.state,
    message: result.message || null,
    updatedAt: nowIso(),
  };
}

async function executeCue(cue, options = {}) {
  const issues = validateCueShape(cue);
  if (issues.length) throw new Error(`show_control_invalid_cue:${issues.map((issue) => issue.code).join(",")}`);
  const nonBlocking = cue.cueType === "go" || options.nonBlocking === true;
  cue.status.stage = "running";
  cue.status.state = "running";
  cue.status.updatedAt = nowIso();

  for (const action of cue.actions) {
    await delay(action.delayMs);
    const sentAt = nowIso();
    action.sentAt = sentAt;
    action.status = {
      stage: "sent",
      state: "sent",
      message: null,
      updatedAt: sentAt,
    };
    cue.status.sentOrder.push(action.actionId);
    const result = await sendAction(action, { nonBlocking });
    action.status = actionPublicStatus(result);
    if (result.warning) {
      cue.status.warnings.push({
        actionId: action.actionId,
        targetId: action.targetId,
        stage: result.stage,
        message: result.message,
        at: action.status.updatedAt,
      });
    }
  }

  cue.status.stage = nonBlocking ? "sent" : cue.status.warnings.length ? "warning" : "ready";
  cue.status.state = nonBlocking ? "sent" : cue.status.warnings.length ? "warning" : "ok";
  cue.status.nonBlocking = nonBlocking;
  cue.status.updatedAt = nowIso();
  return cue;
}

function applyAck(cue, ackPayload, ackedAtDate = new Date()) {
  const action = (cue.actions || []).find((item) => item.actionId === ackPayload.actionId);
  if (!action) throw new Error(`show_control_ack_unknown_action:${ackPayload.actionId}`);
  const ack = {
    schemaVersion: SHOW_CONTROL_ACK_SCHEMA_VERSION,
    cueId: cue.cueId,
    actionId: action.actionId,
    targetId: action.targetId,
    stage: ackPayload.stage || "received",
    state: ackPayload.state || "ok",
    message: ackPayload.message || null,
    ackedAt: ackedAtDate.toISOString(),
  };
  action.status = {
    stage: ack.stage,
    state: ack.state,
    message: ack.message,
    updatedAt: ack.ackedAt,
  };
  cue.acks = Array.isArray(cue.acks) ? cue.acks : [];
  cue.acks.push(ack);
  cue.status.updatedAt = ack.ackedAt;
  return { cue, ack };
}

module.exports = {
  applyAck,
  executeCue,
};
