"use strict";

const $ = (selector) => document.querySelector(selector);

const els = {
  statusModel: $("#statusModel"),
  secretStatus: $("#secretStatus"),
  draftStatus: $("#draftStatus"),
  outputStatus: $("#outputStatus"),
  draftText: $("#draftText"),
  draftMeta: $("#draftMeta"),
  refreshDraft: $("#refreshDraft"),
  saveDraft: $("#saveDraft"),
  sendDraft: $("#sendDraft"),
  settingsForm: $("#settingsForm"),
  model: $("#model"),
  maxTokens: $("#maxTokens"),
  temperature: $("#temperature"),
  systemPrompt: $("#systemPrompt"),
  promptTemplate: $("#promptTemplate"),
  secretForm: $("#secretForm"),
  deepSeekApiKey: $("#deepSeekApiKey"),
  clearSecret: $("#clearSecret"),
  chatLog: $("#chatLog"),
  chatMeta: $("#chatMeta"),
  undoTurn: $("#undoTurn"),
  clearSession: $("#clearSession"),
};

let currentDraft = null;
let currentSessionId = "show_default";
let draftDirty = false;
let streaming = false;

function setBusy(value) {
  streaming = value;
  els.sendDraft.disabled = value;
}

async function api(pathname, options = {}) {
  const response = await fetch(pathname, {
    ...options,
    headers: {
      "content-type": "application/json",
      ...(options.headers || {}),
    },
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.message || body.error || `${pathname} ${response.status}`);
  return body;
}

function setMeta(text) {
  els.chatMeta.textContent = text;
}

function renderStatus(status) {
  els.statusModel.textContent = status.model || "-";
  const secret = status.secrets && status.secrets.deepseek;
  els.secretStatus.textContent = secret && secret.configured ? `ingesteld (${secret.source})` : "ontbreekt";
  els.draftStatus.textContent = status.draft
    ? `${status.draft.situationTitle || status.draft.situationId} rev ${status.draft.revision}`
    : "geen draft";
  els.outputStatus.textContent = status.latestScriptOutput
    ? status.latestScriptOutput.situationId
    : "geen output";
}

function renderSettings(settings) {
  els.model.value = settings.model || "deepseek-chat";
  els.maxTokens.value = settings.maxTokens || 4096;
  els.temperature.value = settings.temperature ?? 0.8;
  els.systemPrompt.value = settings.systemPrompt || "";
  els.promptTemplate.value = settings.promptTemplate || "";
}

function renderDraft(draft, { force = false } = {}) {
  if (!draft) return;
  const isNewPrepared = currentDraft && currentDraft.contentHash !== draft.contentHash;
  currentDraft = draft;
  currentSessionId = draft.showRunId || currentSessionId;
  if (force || isNewPrepared || !draftDirty) {
    els.draftText.value = draft.text || "";
    draftDirty = false;
  }
  els.draftMeta.textContent = [
    draft.situationTitle || draft.situationId || "prepared next",
    draft.promptInputId || "",
    `rev ${draft.revision || 0}`,
  ].filter(Boolean).join(" | ");
}

function appendChatMessage(role, text, id) {
  let row = id ? document.getElementById(id) : null;
  if (!row) {
    row = document.createElement("div");
    row.className = `chat-message ${role}`;
    if (id) row.id = id;
    row.innerHTML = `<strong></strong><pre></pre>`;
    els.chatLog.appendChild(row);
  }
  row.querySelector("strong").textContent = role;
  row.querySelector("pre").textContent = text || "";
  els.chatLog.scrollTop = els.chatLog.scrollHeight;
}

async function loadStatus() {
  const status = await api("/v0/script-agent/operator/status");
  renderStatus(status);
}

async function loadSettings() {
  const body = await api("/v0/script-agent/operator/settings");
  renderSettings(body.settings);
}

async function loadDraft({ refreshRuntime = true, force = false } = {}) {
  const body = await api(`/v0/script-agent/operator/draft?refreshRuntime=${refreshRuntime ? "1" : "0"}`);
  renderDraft(body.draft, { force });
}

async function refreshDraft() {
  const body = await api("/v0/script-agent/operator/draft/from-runtime", {
    method: "POST",
    body: JSON.stringify({ force: true }),
  });
  renderDraft(body.draft, { force: true });
  await loadStatus();
}

async function saveDraft() {
  const body = await api("/v0/script-agent/operator/draft", {
    method: "PATCH",
    body: JSON.stringify({ text: els.draftText.value }),
  });
  renderDraft(body.draft, { force: true });
  draftDirty = false;
}

function parseSseBuffer(buffer, onEvent) {
  let remaining = buffer;
  let index = remaining.indexOf("\n\n");
  while (index >= 0) {
    const raw = remaining.slice(0, index);
    remaining = remaining.slice(index + 2);
    const data = raw.split(/\n/).filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).trimStart()).join("\n");
    if (data) {
      try {
        onEvent(JSON.parse(data));
      } catch {
        onEvent({ type: "error", error: data });
      }
    }
    index = remaining.indexOf("\n\n");
  }
  return remaining;
}

async function readSse(response, onEvent) {
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, "\n").replace(/\r/g, "\n");
    buffer = parseSseBuffer(buffer, onEvent);
  }
}

async function sendDraft() {
  await saveDraft();
  setBusy(true);
  setMeta("Streaming...");
  appendChatMessage("user", els.draftText.value);
  const response = await fetch("/v0/script-agent/operator/chat/stream", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      sessionId: currentSessionId,
      message: els.draftText.value,
      promptInput: currentDraft && currentDraft.promptInput,
    }),
  });
  if (!response.ok || !response.body) {
    setBusy(false);
    throw new Error(`stream failed ${response.status}`);
  }
  let assistantId = "assistant_current";
  await readSse(response, (event) => {
    if (event.type === "start" && event.assistantId) {
      assistantId = event.assistantId;
      appendChatMessage("assistant", "", assistantId);
    }
    if (event.type === "delta") appendChatMessage("assistant", event.fullText || "", assistantId);
    if (event.type === "done") {
      appendChatMessage("assistant", event.text || "", assistantId);
      setMeta(`Output opgeslagen: ${event.scriptOutput ? event.scriptOutput.scriptId : "script"}`);
    }
    if (event.type === "error") setMeta(`Fout: ${event.error || "unknown"}`);
  });
  setBusy(false);
  await loadStatus();
}

async function saveSettings(event) {
  event.preventDefault();
  const body = {
    model: els.model.value,
    maxTokens: Number(els.maxTokens.value),
    temperature: Number(els.temperature.value),
    systemPrompt: els.systemPrompt.value,
    promptTemplate: els.promptTemplate.value,
  };
  const result = await api("/v0/script-agent/operator/settings", {
    method: "PATCH",
    body: JSON.stringify(body),
  });
  renderSettings(result.settings);
  setMeta("Instellingen opgeslagen.");
}

async function saveSecret(event) {
  event.preventDefault();
  const key = els.deepSeekApiKey.value.trim();
  if (!key) return;
  await api("/v0/script-agent/operator/secrets", {
    method: "POST",
    body: JSON.stringify({ deepSeekApiKey: key }),
  });
  els.deepSeekApiKey.value = "";
  await loadStatus();
  setMeta("API key opgeslagen.");
}

async function clearSecret() {
  await api("/v0/script-agent/operator/secrets", {
    method: "POST",
    body: JSON.stringify({ clearDeepSeekApiKey: true }),
  });
  await loadStatus();
  setMeta("Lokale API key verwijderd.");
}

async function undoTurn() {
  await api(`/v0/script-agent/operator/session/${encodeURIComponent(currentSessionId)}/undo`, { method: "POST" });
  await loadStatus();
  setMeta("Laatste turn verwijderd.");
}

async function clearSession() {
  await api(`/v0/script-agent/operator/session/${encodeURIComponent(currentSessionId)}`, { method: "DELETE" });
  els.chatLog.innerHTML = "";
  await loadStatus();
  setMeta("Sessie gereset.");
}

async function withUiError(action) {
  try {
    await action();
  } catch (err) {
    setBusy(false);
    setMeta(`Fout: ${err && err.message ? err.message : "unknown"}`);
  }
}

els.draftText.addEventListener("input", () => {
  draftDirty = true;
});
els.refreshDraft.addEventListener("click", () => withUiError(refreshDraft));
els.saveDraft.addEventListener("click", () => withUiError(saveDraft));
els.sendDraft.addEventListener("click", () => withUiError(sendDraft));
els.settingsForm.addEventListener("submit", (event) => withUiError(() => saveSettings(event)));
els.secretForm.addEventListener("submit", (event) => withUiError(() => saveSecret(event)));
els.clearSecret.addEventListener("click", () => withUiError(clearSecret));
els.undoTurn.addEventListener("click", () => withUiError(undoTurn));
els.clearSession.addEventListener("click", () => withUiError(clearSession));

async function boot() {
  await loadSettings();
  await loadStatus();
  await loadDraft({ refreshRuntime: true, force: true });
  setInterval(() => withUiError(loadStatus), 4000);
  setInterval(() => {
    if (!streaming) withUiError(() => loadDraft({ refreshRuntime: true }));
  }, 3000);
}

withUiError(boot);
