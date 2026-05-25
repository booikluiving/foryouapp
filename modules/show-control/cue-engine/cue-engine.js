"use strict";

const {
  SHOW_CONTROL_ACK_SCHEMA_VERSION,
  validateCueShape,
} = require("../../../shared/contracts/show-control-v0");
const {
  normalizeAckMode,
  resolveCommand,
} = require("../command-registry/command-registry");
const { createAdapters } = require("../target-adapters");
const { expectedStagesFor } = require("../target-adapters/touchdesigner-adapter");
const {
  isWarningAck,
  normalizeAckPayload,
  recordAck,
  registerAction,
  waitForAck,
} = require("./ack-tracker");
const { registerPayload } = require("./payload-cache");

function delay(ms) {
  const safeMs = Math.max(0, Number(ms || 0));
  if (!safeMs) return Promise.resolve();
  return new Promise((resolve) => setTimeout(resolve, safeMs));
}

function nowIso() {
  return new Date().toISOString();
}

function pad2(value) {
  return String(value).padStart(2, "0");
}

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function actionPayloadId(cueId, actionIndex) {
  return `${cueId}:payload:${pad2(actionIndex + 1)}`;
}

function actionId(cueId, actionIndex) {
  return `${cueId}:action:${pad2(actionIndex + 1)}`;
}

function baseActionStatus(stage = "queued", state = "queued") {
  return {
    stage,
    state,
    message: null,
    updatedAt: null,
  };
}

function ensureCueStatus(cue) {
  cue.status = cue.status && typeof cue.status === "object" ? cue.status : {};
  cue.status.stage = cue.status.stage || "queued";
  cue.status.state = cue.status.state || "queued";
  cue.status.warnings = Array.isArray(cue.status.warnings) ? cue.status.warnings : [];
  cue.status.sentOrder = Array.isArray(cue.status.sentOrder) ? cue.status.sentOrder : [];
  cue.status.targetStatus = cue.status.targetStatus && typeof cue.status.targetStatus === "object" ? cue.status.targetStatus : {};
  cue.status.updatedAt = cue.status.updatedAt || nowIso();
  cue.executionLog = Array.isArray(cue.executionLog) ? cue.executionLog : [];
}

function log(cue, entry) {
  cue.executionLog.push({
    at: nowIso(),
    ...entry,
  });
  cue.executionLog = cue.executionLog.slice(-120);
}

function warning(cue, action, stage, message, extra = {}) {
  const item = {
    actionId: action.actionId,
    targetId: action.targetId,
    command: action.command,
    stage,
    message,
    at: nowIso(),
    ...extra,
  };
  cue.status.warnings.push(item);
  return item;
}

function setActionStatus(cue, action, status) {
  const updated = {
    stage: status.stage || action.status.stage || "sent",
    state: status.state || status.status || action.status.state || "pending",
    message: status.message || null,
    updatedAt: status.updatedAt || status.ackedAt || nowIso(),
  };
  action.status = updated;
  cue.status.targetStatus[action.targetId] = {
    command: action.command,
    actionId: action.actionId,
    stage: updated.stage,
    state: updated.state,
    message: updated.message,
    updatedAt: updated.updatedAt,
  };
  cue.status.updatedAt = updated.updatedAt;
  return updated;
}

function publicResultStatus(result = {}) {
  return {
    stage: result.stage || "applied",
    state: result.state || result.status || "ok",
    message: result.message || null,
    updatedAt: nowIso(),
  };
}

function transportForAction(action, commandDefinition) {
  if (commandDefinition.adapter === "touchdesigner") {
    return {
      type: "osc-control-intent",
      address: "/td/cue",
      args: [action.cueId, action.command, action.payloadId || "-"],
    };
  }
  if (commandDefinition.request) {
    return {
      type: "http-sidecar",
      request: commandDefinition.request,
    };
  }
  return { type: commandDefinition.transport || "internal-contract" };
}

function normalizeAction(rawAction, cue, actionIndex, stepMeta = {}) {
  const definition = resolveCommand(rawAction.command);
  const command = definition.canonicalName;
  const ackMode = normalizeAckMode(rawAction.ackMode || definition.ackMode);
  const normalized = {
    ...cloneJson(rawAction),
    cueId: cue.cueId,
    actionId: rawAction.actionId || actionId(cue.cueId, actionIndex),
    targetId: rawAction.targetId || definition.targetId,
    command,
    requestedCommand: definition.requestedName && definition.requestedName !== command ? definition.requestedName : null,
    commandTitle: definition.title,
    adapter: definition.adapter,
    ackMode,
    delayMs: Math.max(0, Number(rawAction.delayMs || 0)),
    timeoutMs: Math.max(1, Number(rawAction.timeoutMs || definition.timeoutMs || 1500)),
    required: rawAction.required === true || ackMode === "required-ready",
    payloadId: rawAction.payloadId || actionPayloadId(cue.cueId, actionIndex),
    payload: rawAction.payload && typeof rawAction.payload === "object" ? cloneJson(rawAction.payload) : {},
    stepId: stepMeta.stepId || rawAction.stepId || `step-${pad2(actionIndex + 1)}`,
    parallelGroup: stepMeta.parallelGroup || rawAction.parallelGroup || null,
    status: rawAction.status || baseActionStatus(),
  };
  normalized.transport = rawAction.transport || transportForAction(normalized, definition);
  return normalized;
}

function flattenSteps(cue) {
  if (!Array.isArray(cue.steps)) return null;
  return cue.steps.flatMap((step) => {
    if (Array.isArray(step.actions)) return step.actions;
    if (step.action) return [step.action];
    return [];
  });
}

function actionStepsFromCue(cue) {
  if (Array.isArray(cue.steps) && cue.steps.length) {
    let actionIndex = 0;
    return cue.steps.map((step, stepIndex) => {
      const stepActions = Array.isArray(step.actions)
        ? step.actions
        : step.action
          ? [step.action]
          : [];
      const stepId = step.stepId || `step-${pad2(stepIndex + 1)}`;
      return {
        stepId,
        label: step.label || stepId,
        delayMs: Math.max(0, Number(step.delayMs || 0)),
        mode: step.mode || (stepActions.length > 1 ? "parallel" : "ordered"),
        actions: stepActions.map((action) => {
          const normalized = normalizeAction(action, cue, actionIndex, {
            stepId,
            parallelGroup: stepActions.length > 1 ? stepId : action.parallelGroup || null,
          });
          actionIndex += 1;
          return normalized;
        }),
      };
    }).filter((step) => step.actions.length);
  }

  const groupedSteps = [];
  let actionIndex = 0;
  const actions = Array.isArray(cue.actions) ? cue.actions : [];
  while (actionIndex < actions.length) {
    const rawAction = actions[actionIndex];
    const group = rawAction.parallelGroup || rawAction.groupId || null;
    const stepId = group ? `parallel-${String(group)}` : `step-${pad2(groupedSteps.length + 1)}`;
    const stepActions = [];
    if (group) {
      while (actionIndex < actions.length && (actions[actionIndex].parallelGroup || actions[actionIndex].groupId || null) === group) {
        stepActions.push(normalizeAction(actions[actionIndex], cue, actionIndex, { stepId, parallelGroup: group }));
        actionIndex += 1;
      }
    } else {
      stepActions.push(normalizeAction(rawAction, cue, actionIndex, { stepId }));
      actionIndex += 1;
    }
    groupedSteps.push({
      stepId,
      label: group ? `Parallel ${group}` : stepId,
      delayMs: 0,
      mode: stepActions.length > 1 ? "parallel" : "ordered",
      actions: stepActions,
    });
  }
  return groupedSteps;
}

function normalizeCue(cue) {
  if (!Array.isArray(cue.actions) && Array.isArray(cue.steps)) {
    cue.actions = flattenSteps(cue);
  }
  const issues = validateCueShape(cue);
  if (issues.length) throw new Error(`show_control_invalid_cue:${issues.map((issue) => issue.code).join(",")}`);
  ensureCueStatus(cue);
  const steps = actionStepsFromCue(cue);
  cue.actions = steps.flatMap((step) => step.actions);
  cue.steps = steps.map((step) => ({
    stepId: step.stepId,
    label: step.label,
    delayMs: step.delayMs,
    mode: step.mode,
    actionIds: step.actions.map((action) => action.actionId),
  }));
  return steps;
}

function shouldWaitForAck(action, result, options = {}) {
  const ackMode = normalizeAckMode(action.ackMode);
  if (ackMode === "fire-and-forget") return false;
  if (result && result.stage && result.stage !== "sent" && result.state !== "pending") return false;
  if (options.nonBlocking === true && ackMode !== "required-ready") return false;
  return true;
}

async function maybeWaitForAck(cue, action, result, options) {
  if (!shouldWaitForAck(action, result, options)) return null;
  const expectedStages = action.adapter === "touchdesigner"
    ? expectedStagesFor(action)
    : [];
  try {
    const ack = await waitForAck(action, { timeoutMs: action.timeoutMs, expectedStages });
    const status = setActionStatus(cue, action, {
      stage: ack.stage,
      state: ack.state,
      message: ack.message,
      ackedAt: ack.ackedAt,
    });
    cue.acks = Array.isArray(cue.acks) ? cue.acks : [];
    cue.acks.push({
      schemaVersion: SHOW_CONTROL_ACK_SCHEMA_VERSION,
      cueId: cue.cueId,
      actionId: action.actionId,
      targetId: action.targetId,
      command: action.command,
      payloadId: action.payloadId,
      stage: status.stage,
      state: status.state,
      message: status.message,
      ackedAt: status.updatedAt,
    });
    if (isWarningAck(ack)) warning(cue, action, ack.stage, ack.message || ack.state, { state: ack.state });
    log(cue, {
      type: "ack",
      stepId: action.stepId,
      actionId: action.actionId,
      targetId: action.targetId,
      command: action.command,
      stage: status.stage,
      state: status.state,
    });
    return ack;
  } catch (err) {
    const message = err && err.message ? String(err.message) : "target acknowledgement timed out";
    setActionStatus(cue, action, {
      stage: "timedOut",
      state: "warning",
      message,
    });
    warning(cue, action, "timedOut", message);
    log(cue, {
      type: "timeout",
      stepId: action.stepId,
      actionId: action.actionId,
      targetId: action.targetId,
      command: action.command,
      timeoutMs: action.timeoutMs,
    });
    return null;
  }
}

function normalizeGeneratedAction(rawAction, cue, sourceAction) {
  const index = cue.actions.length;
  const generated = normalizeAction(rawAction, cue, index, {
    stepId: `${sourceAction.stepId}:generated`,
  });
  generated.generatedByActionId = sourceAction.actionId;
  cue.actions.push(generated);
  return generated;
}

async function executeAction(cue, action, context, options) {
  await delay(action.delayMs);
  registerAction(action);
  registerPayload(action);
  const sentAt = nowIso();
  action.sentAt = sentAt;
  setActionStatus(cue, action, {
    stage: "sent",
    state: "sent",
    updatedAt: sentAt,
  });
  cue.status.sentOrder.push(action.actionId);
  log(cue, {
    type: "sent",
    stepId: action.stepId,
    parallelGroup: action.parallelGroup,
    actionId: action.actionId,
    targetId: action.targetId,
    command: action.command,
    delayMs: action.delayMs,
  });

  const adapter = context.adapters[action.adapter];
  if (typeof adapter !== "function") {
    throw new Error(`show_control_missing_adapter:${action.adapter}`);
  }

  try {
    if (action.simulate === "timeout") {
      await delay(action.timeoutMs);
      throw new Error(`show_control_ack_timeout:${action.actionId}`);
    }
    const result = await adapter(action, context);
    action.adapterResult = result && result.data ? result.data : null;
    setActionStatus(cue, action, publicResultStatus(result));
    log(cue, {
      type: "adapter-result",
      stepId: action.stepId,
      actionId: action.actionId,
      targetId: action.targetId,
      command: action.command,
      stage: action.status.stage,
      state: action.status.state,
      route: result && result.data ? result.data.route : undefined,
      transport: result && result.data ? result.data.transport : undefined,
    });
    if (result && result.warning) {
      warning(cue, action, result.stage || "warning", result.message || "target warning");
    }
    await maybeWaitForAck(cue, action, result, options);
    if (result && Array.isArray(result.generatedActions) && result.generatedActions.length) {
      for (const rawGenerated of result.generatedActions) {
        const generatedAction = normalizeGeneratedAction(rawGenerated, cue, action);
        await executeAction(cue, generatedAction, context, options);
      }
    }
    return result;
  } catch (err) {
    const message = err && err.message ? String(err.message) : "show_control_action_failed";
    const stage = message.includes("ack_timeout") ? "timedOut" : "failed";
    const state = stage === "timedOut" ? "warning" : "failed";
    setActionStatus(cue, action, {
      stage,
      state,
      message,
    });
    warning(cue, action, stage, message);
    log(cue, {
      type: stage,
      stepId: action.stepId,
      actionId: action.actionId,
      targetId: action.targetId,
      command: action.command,
      message,
    });
    return { stage, state, message, warning: true };
  }
}

async function executeStep(cue, step, context, options) {
  await delay(step.delayMs);
  log(cue, {
    type: "step-start",
    stepId: step.stepId,
    mode: step.mode,
    actionIds: step.actions.map((action) => action.actionId),
  });
  if (step.actions.length > 1 || step.mode === "parallel") {
    await Promise.all(step.actions.map((action) => executeAction(cue, action, context, options)));
  } else if (step.actions[0]) {
    await executeAction(cue, step.actions[0], context, options);
  }
  log(cue, {
    type: "step-complete",
    stepId: step.stepId,
  });
}

async function executeCue(cue, options = {}) {
  const steps = normalizeCue(cue);
  const nonBlocking = cue.cueType === "go" || options.nonBlocking === true;
  cue.status.stage = "running";
  cue.status.state = "running";
  cue.status.nonBlocking = nonBlocking;
  cue.status.startedAt = nowIso();
  cue.status.updatedAt = cue.status.startedAt;

  const context = {
    adapters: createAdapters(options.adapters || {}),
    adapterOptions: options.adapterOptions || {},
    runtimeState: options.runtimeState || null,
    lastRuntimeState: null,
  };

  for (const step of steps) {
    await executeStep(cue, step, context, { ...options, nonBlocking });
  }

  const failed = cue.actions.some((action) => action.status && action.status.state === "failed");
  const warnings = cue.status.warnings.length > 0;
  cue.status.stage = failed ? "failed" : nonBlocking ? "sent" : warnings ? "warning" : "ready";
  cue.status.state = failed ? "failed" : nonBlocking ? "sent" : warnings ? "warning" : "ok";
  cue.status.completedAt = nowIso();
  cue.status.updatedAt = cue.status.completedAt;
  return cue;
}

function applyAck(cue, ackPayload, ackedAtDate = new Date()) {
  ensureCueStatus(cue);
  const normalizedPayload = normalizeAckPayload({
    ...ackPayload,
    ackedAt: ackPayload.ackedAt || ackedAtDate.toISOString(),
  });
  const action = (cue.actions || []).find((item) => {
    if (normalizedPayload.actionId) return item.actionId === normalizedPayload.actionId;
    if (normalizedPayload.payloadId) return item.payloadId === normalizedPayload.payloadId;
    if (normalizedPayload.command) return item.command === normalizedPayload.command;
    return false;
  });
  if (!action) throw new Error(`show_control_ack_unknown_action:${normalizedPayload.actionId || normalizedPayload.command || "missing"}`);
  const ack = {
    schemaVersion: SHOW_CONTROL_ACK_SCHEMA_VERSION,
    cueId: cue.cueId,
    actionId: action.actionId,
    targetId: action.targetId,
    command: action.command,
    payloadId: action.payloadId,
    stage: normalizedPayload.stage,
    state: normalizedPayload.state,
    message: normalizedPayload.message,
    ackedAt: normalizedPayload.ackedAt,
  };
  setActionStatus(cue, action, ack);
  cue.acks = Array.isArray(cue.acks) ? cue.acks : [];
  cue.acks.push(ack);
  if (isWarningAck(ack)) warning(cue, action, ack.stage, ack.message || ack.state, { state: ack.state });
  recordAck(ack);
  return { cue, ack };
}

module.exports = {
  applyAck,
  executeCue,
  normalizeCue,
};
