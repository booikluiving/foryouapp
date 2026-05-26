"use strict";

const STAGE_W = 1080;
const STAGE_H = 1920;
const RECONNECT_MIN_MS = 500;
const RECONNECT_MAX_MS = 6000;
const SOURCE_KEY = "script_agent_operator_stage_source_v1";
const STYLE_DEFAULT = Object.freeze({ font: "jetbrains", cursor: "block", fontSize: 30 });
const FONT_STACKS = {
  jetbrains: '"JetBrains Mono", "IBM Plex Mono", ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
  ibm: '"IBM Plex Mono", "JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
  system: 'ui-monospace, SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace',
  courier: '"Courier New", Courier, monospace',
};
const CURSOR_CHOICES = new Set(["underscore", "bar", "block"]);

const stageEl = document.getElementById("stage");
const terminalEl = document.getElementById("terminal");
const typingEl = document.getElementById("typing");
const inputEl = document.getElementById("hiddenInput");
const logEl = document.getElementById("log");
const logInnerEl = document.getElementById("logInner");
const connectionStatusEl = document.getElementById("connectionStatus");
const usageStatusEl = document.getElementById("usageStatus");

let ws = null;
let reconnectTimer = null;
let reconnectDelayMs = RECONNECT_MIN_MS;
let draft = "";
let revision = 0;
let streaming = false;
let messages = [];
let bubbleById = new Map();
let connectionStatus = "connecting";
let stageProvider = "deepseek";
let stageModel = "";
let stageTokens = 0;
let stageCost = 0;
let stageStyle = { ...STYLE_DEFAULT };
let stageSessionId = "show_default";
let sourceId = loadSourceId();

function loadSourceId() {
  try {
    const existing = String(localStorage.getItem(SOURCE_KEY) || "").trim();
    if (existing) return existing;
    const generated = `stage_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
    localStorage.setItem(SOURCE_KEY, generated);
    return generated;
  } catch {
    return `stage_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
  }
}

function wsUrl() {
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${protocol}//${window.location.host}/v0/script-agent/operator/stage/ws`;
}

function fitStage() {
  const scale = Math.min(window.innerWidth / STAGE_W, window.innerHeight / STAGE_H);
  const tx = (window.innerWidth - STAGE_W * scale) / 2;
  const ty = (window.innerHeight - STAGE_H * scale) / 2;
  stageEl.style.transform = `translate(${tx}px, ${ty}px) scale(${scale})`;
}

function esc(value) {
  return String(value || "").replace(/[&<>"']/g, (ch) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "\"": "&quot;",
    "'": "&#39;",
  }[ch]));
}

function normalizeStyle(style = {}) {
  const source = style && typeof style === "object" ? style : {};
  const font = String(source.font || STYLE_DEFAULT.font).trim().toLowerCase();
  const cursor = String(source.cursor || STYLE_DEFAULT.cursor).trim().toLowerCase();
  const fontSize = Math.max(24, Math.min(42, Number(source.fontSize || STYLE_DEFAULT.fontSize) || STYLE_DEFAULT.fontSize));
  return {
    font: Object.prototype.hasOwnProperty.call(FONT_STACKS, font) ? font : STYLE_DEFAULT.font,
    cursor: CURSOR_CHOICES.has(cursor) ? cursor : STYLE_DEFAULT.cursor,
    fontSize,
  };
}

function applyStageStyle(style = {}) {
  stageStyle = normalizeStyle(style);
  document.documentElement.style.setProperty("--stage-font-family", FONT_STACKS[stageStyle.font]);
  document.documentElement.style.setProperty("--stage-message-size", `${stageStyle.fontSize}px`);
  document.documentElement.style.setProperty("--stage-prompt-size", `${stageStyle.fontSize + 4}px`);
  stageEl.dataset.cursor = stageStyle.cursor;
}

function renderTyping() {
  typingEl.innerHTML = "";
  if (draft && !streaming) typingEl.appendChild(document.createTextNode(draft));
  const cursor = document.createElement("span");
  cursor.className = "cursor";
  typingEl.appendChild(cursor);
  terminalEl.classList.toggle("streaming", streaming);
}

function scrollLogToBottom() {
  requestAnimationFrame(() => {
    logEl.scrollTop = logEl.scrollHeight;
  });
}

function renderAssistantContent(el, text) {
  const value = String(text || "");
  if (!value) {
    el.innerHTML = '<span class="stage-caret"></span>';
    return;
  }
  el.innerHTML = esc(value) + (el.classList.contains("streaming") ? '<span class="stage-caret"></span>' : "");
}

function renderMessages(forceBottom = false) {
  logInnerEl.innerHTML = "";
  bubbleById = new Map();
  const pairs = [];
  let current = null;
  for (const message of messages) {
    if (message.role === "user" || !current) {
      current = { user: null, assistant: null };
      pairs.push(current);
    }
    if (message.role === "user") current.user = message;
    else current.assistant = message;
  }
  for (const pair of pairs.slice(-12)) {
    const exchange = document.createElement("div");
    exchange.className = "exchange";
    if (pair.user) {
      const user = document.createElement("div");
      user.className = "stage-msg user";
      user.textContent = pair.user.content || "";
      exchange.appendChild(user);
      if (pair.user.id) bubbleById.set(String(pair.user.id), user);
    }
    if (pair.assistant) {
      const assistant = document.createElement("div");
      assistant.className = "stage-msg assistant" + (pair.assistant.streaming ? " streaming" : "") + (pair.assistant.error ? " error" : "");
      renderAssistantContent(assistant, pair.assistant.content || "");
      exchange.appendChild(assistant);
      if (pair.assistant.id) bubbleById.set(String(pair.assistant.id), assistant);
    }
    logInnerEl.appendChild(exchange);
  }
  if (forceBottom) scrollLogToBottom();
}

function numberValue(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : 0;
}

function latestUsageMeta() {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const meta = messages[index] && messages[index].meta;
    if (meta && typeof meta === "object") return meta;
  }
  return null;
}

function formatTokens(value) {
  return Math.round(numberValue(value)).toLocaleString("nl-NL");
}

function formatCost(value) {
  const cost = numberValue(value);
  if (cost >= 1) return `$${cost.toFixed(2)}`;
  if (cost >= 0.01) return `$${cost.toFixed(3)}`;
  return `$${cost.toFixed(4)}`;
}

function updateUsageFromState(stage) {
  const data = stage && typeof stage === "object" ? stage : {};
  const active = data.active && typeof data.active === "object" ? data.active : {};
  stageProvider = String(active.provider || data.provider || stageProvider || "deepseek").trim();
  stageModel = String(active.model || data.model || stageModel || "").trim();
  const meta = latestUsageMeta();
  if (!meta) {
    stageTokens = 0;
    stageCost = 0;
    return;
  }
  const providerUsage = meta.provider_usage && typeof meta.provider_usage === "object" ? meta.provider_usage : {};
  const bucket = providerUsage.deepseek && typeof providerUsage.deepseek === "object" ? providerUsage.deepseek : null;
  stageTokens = bucket ? numberValue(bucket.tokens_totaal) : numberValue(meta.provider_tokens_totaal) || numberValue(meta.sessie_tokens_totaal);
  stageCost = bucket ? numberValue(bucket.kosten_totaal) : numberValue(meta.provider_kosten_totaal) || numberValue(meta.sessie_kosten_totaal);
}

function renderStatus() {
  const modelLabel = [stageProvider, stageModel].filter(Boolean).join("/");
  connectionStatusEl.textContent = connectionStatus;
  usageStatusEl.textContent = `${modelLabel ? `${modelLabel} - ` : ""}${formatTokens(stageTokens)} tokens - ${formatCost(stageCost)}`;
}

function setStatus(text) {
  connectionStatus = String(text || "");
  renderStatus();
}

function setDraft(nextDraft, nextRevision, remoteSourceId = "", forceBottom = false) {
  draft = String(nextDraft || "");
  if (Number.isFinite(Number(nextRevision))) revision = Number(nextRevision);
  if (remoteSourceId !== sourceId) inputEl.value = draft;
  renderTyping();
  if (forceBottom) scrollLogToBottom();
}

function applyState(stage = {}, forceBottom = false) {
  applyStageStyle(stage.style || stageStyle);
  streaming = !!stage.streaming;
  stageSessionId = String(stage.sessionId || stageSessionId || "show_default");
  setDraft(stage.draft || "", stage.revision, stage.draftSourceId || "", forceBottom || streaming);
  messages = Array.isArray(stage.messages) ? stage.messages.slice() : [];
  updateUsageFromState(stage);
  renderMessages(forceBottom || streaming);
  setStatus(streaming ? "streaming" : ws && ws.readyState === WebSocket.OPEN ? "connected" : "offline");
}

function findMessage(id) {
  const safeId = String(id || "");
  return messages.find((message) => String(message.id || "") === safeId);
}

function applyDelta(data = {}) {
  const id = String(data.assistantId || "");
  if (!id) return;
  let message = findMessage(id);
  if (!message) {
    message = { id, role: "assistant", content: "", streaming: true };
    messages.push(message);
  }
  message.content = typeof data.fullText === "string"
    ? data.fullText
    : String(message.content || "") + String(data.text || "");
  let bubble = bubbleById.get(id);
  if (!bubble) {
    renderMessages();
    bubble = bubbleById.get(id);
  }
  if (bubble) {
    bubble.classList.add("streaming");
    renderAssistantContent(bubble, message.content);
  }
  scrollLogToBottom();
}

function send(message) {
  if (!ws || ws.readyState !== WebSocket.OPEN) return false;
  ws.send(JSON.stringify(message));
  return true;
}

function sendDraft() {
  if (streaming) return;
  revision += 1;
  send({
    type: "operator_stage_draft",
    sourceId,
    text: draft,
    revision,
  });
}

function submit() {
  if (streaming || !draft.trim()) return;
  const submittedText = draft;
  sendDraft();
  draft = "";
  inputEl.value = "";
  streaming = true;
  renderTyping();
  scrollLogToBottom();
  send({
    type: "operator_stage_submit",
    sourceId,
    sessionId: stageSessionId,
    text: submittedText,
  });
}

function clearDraft() {
  if (streaming) return;
  draft = "";
  inputEl.value = "";
  revision += 1;
  renderTyping();
  scrollLogToBottom();
  send({
    type: "operator_stage_clear_draft",
    sourceId,
    revision,
  });
}

function handleChatEvent(event = {}) {
  if (event.type === "start") {
    streaming = true;
    renderTyping();
  }
  if (event.type === "delta") applyDelta(event);
  if (event.type === "done") {
    const message = findMessage(event.assistantId);
    if (message) {
      message.streaming = false;
      message.meta = event;
      message.content = event.text || message.content || "";
    }
    streaming = false;
    renderTyping();
    renderMessages(true);
    updateUsageFromState({ provider: event.provider, model: event.model });
    renderStatus();
  }
  if (event.type === "error") {
    streaming = false;
    setStatus("error");
    renderTyping();
  }
}

function onSocketMessage(raw) {
  let msg = {};
  try { msg = JSON.parse(String(raw || "{}")); } catch { return; }
  if (msg.type === "operator_stage_hello" || msg.type === "operator_stage_state") {
    applyState(msg.stage || {}, true);
    return;
  }
  if (msg.type === "operator_stage_draft") {
    setDraft(msg.draft || "", msg.revision, msg.sourceId || "", true);
    return;
  }
  if (msg.type === "operator_stage_style") {
    applyStageStyle(msg.style || msg.stage && msg.stage.style || {});
    return;
  }
  if (msg.type === "operator_stage_delta") {
    applyDelta(msg);
    return;
  }
  if (msg.type === "operator_stage_chat_event") {
    handleChatEvent(msg.event || {});
    return;
  }
  if (msg.type === "operator_stage_error") {
    if (msg.stage) applyState(msg.stage || {}, true);
    setStatus("error");
  }
}

function scheduleReconnect() {
  if (reconnectTimer) return;
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    connect();
  }, reconnectDelayMs);
  reconnectDelayMs = Math.min(RECONNECT_MAX_MS, Math.floor(reconnectDelayMs * 1.6));
}

function connect() {
  if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) return;
  setStatus("connecting");
  try {
    ws = new WebSocket(wsUrl());
  } catch {
    setStatus("offline");
    scheduleReconnect();
    return;
  }
  ws.addEventListener("open", () => {
    reconnectDelayMs = RECONNECT_MIN_MS;
    setStatus("connected");
    send({ type: "operator_stage_refresh", sourceId });
  });
  ws.addEventListener("message", (event) => onSocketMessage(event && event.data));
  ws.addEventListener("close", () => {
    ws = null;
    setStatus("reconnecting");
    scheduleReconnect();
  });
  ws.addEventListener("error", () => setStatus("reconnecting"));
}

function refocus() {
  try { inputEl.focus({ preventScroll: true }); } catch {}
}

inputEl.addEventListener("input", () => {
  if (streaming) {
    inputEl.value = draft;
    return;
  }
  draft = inputEl.value;
  renderTyping();
  sendDraft();
});

inputEl.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && !event.shiftKey) {
    event.preventDefault();
    submit();
    return;
  }
  if (event.key === "Escape") {
    event.preventDefault();
    clearDraft();
    return;
  }
  if (streaming) event.preventDefault();
});

document.addEventListener("click", refocus);
document.addEventListener("touchstart", refocus, { passive: true });
window.addEventListener("resize", fitStage);
setInterval(refocus, 500);
fitStage();
applyStageStyle(STYLE_DEFAULT);
renderTyping();
renderMessages();
renderStatus();
refocus();
connect();
