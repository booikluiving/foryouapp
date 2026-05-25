"use strict";

const {
  AUDIENCE_ALGORITHM_INPUT_SCHEMA_VERSION,
  AUDIENCE_SIGNAL_SCHEMA_VERSION,
  AUDIENCE_SIGNAL_TYPES,
  createAudienceSignalId,
} = require("../../../shared/contracts/audience-v0");

const FORBIDDEN_ORDER_FIELDS = Object.freeze([
  "availablePool",
  "pathAvailable",
  "pathLocked",
  "eligiblePool",
  "preparedNext",
  "resolvedPreparedNext",
  "playedSituations",
  "order",
  "scores",
  "scoreFeed",
]);

function hasOwn(value, key) {
  return Object.prototype.hasOwnProperty.call(value || {}, key);
}

function forbiddenFieldPath(value, prefix = "") {
  if (!value || typeof value !== "object") return null;
  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index += 1) {
      const found = forbiddenFieldPath(value[index], `${prefix}[${index}]`);
      if (found) return found;
    }
    return null;
  }
  for (const key of Object.keys(value)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (FORBIDDEN_ORDER_FIELDS.includes(key)) return path;
    const found = forbiddenFieldPath(value[key], path);
    if (found) return found;
  }
  return null;
}

function assertNoOrderFields(payload) {
  const found = forbiddenFieldPath(payload);
  if (found) throw new Error(`audience_forbidden_order_field:${found}`);
}

function cleanText(value) {
  if (value == null) return null;
  const text = String(value).trim();
  return text ? text.slice(0, 2000) : null;
}

function normalizeSignalPayload(payload = {}) {
  assertNoOrderFields(payload);
  const type = String(payload.type || "").trim().toLowerCase();
  if (!AUDIENCE_SIGNAL_TYPES.includes(type)) throw new Error(`audience_invalid_signal_type:${type || "missing"}`);
  const text = type === "chat" ? cleanText(payload.text || payload.message || payload.rawMessage) : null;
  if (type === "chat" && !text) throw new Error("audience_chat_requires_text");
  return {
    type,
    sessionId: cleanText(payload.sessionId),
    clientId: cleanText(payload.clientId),
    channel: cleanText(payload.channel) || "public-app",
    text,
  };
}

function linkFromRuntime(runtimeResult) {
  if (!runtimeResult || runtimeResult.ok === false) {
    return {
      status: "unlinked",
      reason: "runtime_unavailable",
      runtimeError: runtimeResult && runtimeResult.error ? String(runtimeResult.error) : null,
    };
  }
  const state = runtimeResult.state || runtimeResult;
  const active = state && state.activeSituation;
  if (!state || !active) {
    return {
      status: "unlinked",
      reason: "no_active_situation",
      showRunId: state && state.showRunId ? state.showRunId : null,
    };
  }
  return {
    status: "linked",
    source: {
      type: "runtime-current-state",
      readOnly: true,
    },
    showRunId: state.showRunId,
    situationRunId: active.situationRunId,
    situationId: active.situationId,
    legacySituationId: hasOwn(active, "legacySituationId") ? active.legacySituationId : null,
    title: active.title || null,
    startedAt: active.startedAt || null,
    activeStatus: active.status || null,
  };
}

function createAudienceSignal(payload, runtimeResult, receivedAtDate = new Date()) {
  const normalized = normalizeSignalPayload(payload);
  return {
    schemaVersion: AUDIENCE_SIGNAL_SCHEMA_VERSION,
    signalId: createAudienceSignalId(receivedAtDate),
    type: normalized.type,
    receivedAt: receivedAtDate.toISOString(),
    sessionId: normalized.sessionId,
    clientId: normalized.clientId,
    channel: normalized.channel,
    text: normalized.text,
    link: linkFromRuntime(runtimeResult),
    source: {
      type: "audience-v0-public-signal",
      readOnly: false,
    },
  };
}

function signalMatchesRuntime(signal, showRunId, situationRunId) {
  return signal
    && signal.link
    && signal.link.status === "linked"
    && signal.link.showRunId === showRunId
    && signal.link.situationRunId === situationRunId;
}

function uniqueCount(values) {
  return new Set(values.filter(Boolean)).size;
}

function buildAlgorithmInput({ showRunId, situationRunId, signals = [], createdAtDate = new Date() }) {
  if (!showRunId) throw new Error("audience_missing_show_run_id");
  if (!situationRunId) throw new Error("audience_missing_situation_run_id");
  const linked = signals
    .filter((signal) => signalMatchesRuntime(signal, showRunId, situationRunId))
    .sort((a, b) => String(a.receivedAt).localeCompare(String(b.receivedAt)));
  const rawMessages = linked
    .filter((signal) => signal.type === "chat" && signal.text)
    .map((signal) => signal.text);
  return {
    schemaVersion: AUDIENCE_ALGORITHM_INPUT_SCHEMA_VERSION,
    type: "audienceSignalsForAlgorithm",
    showRunId,
    situationRunId,
    situationId: linked.length ? linked[0].link.situationId : null,
    createdAt: createdAtDate.toISOString(),
    source: {
      type: "audience-v0",
      readOnly: true,
    },
    audience: {
      activeClients: Math.max(1, uniqueCount(linked.map((signal) => signal.sessionId || signal.clientId))),
      linkedSignalCount: linked.length,
    },
    chatAppSignals: {
      heartCount: linked.filter((signal) => signal.type === "heart").length,
      boredCount: linked.filter((signal) => signal.type === "bored").length,
      rawMessages,
    },
    signalRefs: linked.map((signal) => ({
      signalId: signal.signalId,
      type: signal.type,
      receivedAt: signal.receivedAt,
      sessionId: signal.sessionId,
    })),
  };
}

module.exports = {
  FORBIDDEN_ORDER_FIELDS,
  assertNoOrderFields,
  buildAlgorithmInput,
  createAudienceSignal,
  forbiddenFieldPath,
  linkFromRuntime,
  normalizeSignalPayload,
};
