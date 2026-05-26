"use strict";

const $ = (selector) => document.querySelector(selector);

const els = {
  messages: $("#stageMessages"),
  draft: $("#stageDraft"),
  refresh: $("#stageRefresh"),
  clear: $("#stageClear"),
  submit: $("#stageSubmit"),
  status: $("#stageStatus"),
};

let ws = null;
let draftDirty = false;
let reconnectTimer = null;
let assistantId = null;
let assistantText = "";

function wsUrl() {
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${protocol}//${window.location.host}/v0/script-agent/operator/stage/ws`;
}

function setStatus(text) {
  els.status.textContent = text;
}

function send(payload) {
  if (!ws || ws.readyState !== WebSocket.OPEN) return false;
  ws.send(JSON.stringify(payload));
  return true;
}

function line(role, text) {
  const label = role ? `[${role}] ` : "";
  return `${label}${text || ""}`.trimEnd();
}

function append(role, text) {
  const block = document.createElement("div");
  block.textContent = line(role, text);
  els.messages.appendChild(block);
  els.messages.scrollTop = els.messages.scrollHeight;
}

function upsertAssistant(text) {
  assistantText = text || assistantText;
  if (!assistantId) {
    assistantId = `assistant-${Date.now()}`;
    const block = document.createElement("div");
    block.id = assistantId;
    els.messages.appendChild(block);
  }
  const block = document.getElementById(assistantId);
  if (block) {
    block.textContent = line("assistant", assistantText);
    els.messages.scrollTop = els.messages.scrollHeight;
  }
}

function applyStage(stage) {
  if (!stage) return;
  if (!draftDirty) els.draft.value = stage.draft || "";
  setStatus([
    stage.streaming ? "streaming" : "klaar",
    stage.model || "",
    stage.sessionId || "",
  ].filter(Boolean).join(" | "));
}

function handleChatEvent(event) {
  if (!event) return;
  if (event.type === "start") {
    assistantId = event.assistantId || `assistant-${Date.now()}`;
    assistantText = "";
    upsertAssistant("");
  }
  if (event.type === "delta") upsertAssistant(event.fullText || "");
  if (event.type === "done") {
    upsertAssistant(event.text || assistantText);
    assistantId = null;
    assistantText = "";
    setStatus("output opgeslagen");
  }
  if (event.type === "error") setStatus(`fout: ${event.error || "unknown"}`);
}

function connect() {
  if (reconnectTimer) clearTimeout(reconnectTimer);
  ws = new WebSocket(wsUrl());
  ws.addEventListener("open", () => {
    setStatus("verbonden");
    send({ type: "operator_stage_refresh" });
  });
  ws.addEventListener("message", (message) => {
    let payload = null;
    try {
      payload = JSON.parse(message.data);
    } catch {
      setStatus("ongeldige stage data");
      return;
    }
    if (payload.type === "operator_stage_hello") applyStage(payload.stage);
    if (payload.type === "operator_stage_state") applyStage(payload.stage);
    if (payload.type === "operator_stage_delta") upsertAssistant(payload.fullText || "");
    if (payload.type === "operator_stage_chat_event") handleChatEvent(payload.event);
    if (payload.type === "operator_stage_error") setStatus(`fout: ${payload.error || "unknown"}`);
  });
  ws.addEventListener("close", () => {
    setStatus("opnieuw verbinden...");
    reconnectTimer = setTimeout(connect, 1000);
  });
  ws.addEventListener("error", () => {
    setStatus("websocket fout");
  });
}

let draftTimer = null;
els.draft.addEventListener("input", () => {
  draftDirty = true;
  if (draftTimer) clearTimeout(draftTimer);
  draftTimer = setTimeout(() => {
    draftDirty = false;
    send({ type: "operator_stage_draft", text: els.draft.value });
  }, 250);
});

els.refresh.addEventListener("click", () => {
  draftDirty = false;
  send({ type: "operator_stage_refresh" });
});

els.clear.addEventListener("click", () => {
  els.draft.value = "";
  draftDirty = false;
  send({ type: "operator_stage_clear_draft" });
});

els.submit.addEventListener("click", () => {
  const text = els.draft.value.trim();
  if (!text) return;
  append("user", text);
  els.draft.value = "";
  draftDirty = false;
  send({ type: "operator_stage_submit", text });
});

connect();
