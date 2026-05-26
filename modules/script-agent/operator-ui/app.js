"use strict";

const $ = (selector) => document.querySelector(selector);

const STORAGE_SESSION_KEY = "script_agent_operator_session_v1";
const STORAGE_SOURCE_KEY = "script_agent_operator_source_v1";

const els = {
  operatorStatusText: $("#operatorStatusText"),
  reloadCatalog: $("#reloadCatalog"),
  sessionId: $("#sessionId"),
  model: $("#model"),
  situation: $("#situation"),
  situationPreview: $("#situationPreview"),
  character: $("#character"),
  characterChips: $("#characterChips"),
  environment: $("#environment"),
  environmentPreview: $("#environmentPreview"),
  starterExtra: $("#starterExtra"),
  sceneToChat: $("#sceneToChat"),
  refreshRuntimeDraft: $("#refreshRuntimeDraft"),
  operatorMsg: $("#operatorMsg"),
  chatLog: $("#chatLog"),
  chatForm: $("#chatForm"),
  chatInput: $("#chatInput"),
  sendChat: $("#sendChat"),
  chatMeta: $("#chatMeta"),
  undoTurn: $("#undoTurn"),
  clearChat: $("#clearChat"),
  resetSession: $("#resetSession"),
  statTurns: $("#statTurns"),
  statTokens: $("#statTokens"),
  statCost: $("#statCost"),
  statSessions: $("#statSessions"),
  systemPrompt: $("#systemPrompt"),
  promptTemplate: $("#promptTemplate"),
  temperature: $("#temperature"),
  maxTokens: $("#maxTokens"),
  promptSettingsStatus: $("#promptSettingsStatus"),
  savePromptSettings: $("#savePromptSettings"),
  stageFont: $("#stageFont"),
  stageCursor: $("#stageCursor"),
  stageFontSize: $("#stageFontSize"),
  styleStatus: $("#styleStatus"),
  saveStageStyle: $("#saveStageStyle"),
  secretStatus: $("#secretStatus"),
  secretForm: $("#secretForm"),
  deepSeekApiKey: $("#deepSeekApiKey"),
  clearSecret: $("#clearSecret"),
};

let ws = null;
let reconnectTimer = null;
let catalogIndex = { situaties: [], personages: [], omgevingen: [], performers: [] };
let selectedSituation = null;
let selectedCharacters = new Map();
let stageRevision = 0;
let stageMessages = [];
let stageBubbles = new Map();
let streaming = false;
let applyingDraft = false;
let statusTimer = null;
let pendingDraftInfo = null;
let currentDraftInfo = null;
let manualSelectionDirty = false;

function sourceId() {
  try {
    const existing = String(localStorage.getItem(STORAGE_SOURCE_KEY) || "").trim();
    if (existing) return existing;
    const generated = `operator_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
    localStorage.setItem(STORAGE_SOURCE_KEY, generated);
    return generated;
  } catch {
    return `operator_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
  }
}

const SOURCE_ID = sourceId();
const SCENE_SOURCE_ID = `${SOURCE_ID}.scene`;

function esc(value) {
  return String(value || "").replace(/[&<>"']/g, (ch) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "\"": "&quot;",
    "'": "&#39;",
  }[ch]));
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

function setMsg(text, error = false) {
  els.operatorMsg.textContent = text || "";
  els.operatorMsg.style.color = error ? "var(--bad)" : "";
}

function setMeta(text, error = false) {
  els.chatMeta.textContent = text || "";
  els.chatMeta.style.color = error ? "var(--bad)" : "";
}

function setStreaming(value) {
  streaming = !!value;
  els.sendChat.disabled = streaming;
  els.sceneToChat.disabled = streaming;
  els.chatInput.disabled = streaming;
}

function currentSessionId() {
  return String(els.sessionId.value || "show_default").trim().replace(/[^\w.-]+/g, "_") || "show_default";
}

function selectedStageStyle() {
  return {
    font: els.stageFont.value || "jetbrains",
    cursor: els.stageCursor.value || "block",
    fontSize: Number(els.stageFontSize.value || 30),
  };
}

function applyStageStyle(style = {}) {
  els.stageFont.value = style.font || "jetbrains";
  els.stageCursor.value = style.cursor || "block";
  els.stageFontSize.value = String(style.fontSize || 30);
}

function applyOperatorSettings(settings = {}) {
  els.model.value = settings.model || els.model.value || "deepseek-chat";
  els.systemPrompt.value = settings.systemPrompt || "";
  els.promptTemplate.value = settings.promptTemplate || "";
  els.temperature.value = String(settings.temperature ?? 0.8);
  els.maxTokens.value = String(settings.maxTokens || 4096);
}

function settingsFromControls() {
  return {
    model: els.model.value || "deepseek-chat",
    systemPrompt: els.systemPrompt.value || "",
    promptTemplate: els.promptTemplate.value || "",
    temperature: Number(els.temperature.value || 0.8),
    maxTokens: Number(els.maxTokens.value || 4096),
  };
}

function wsUrl() {
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${protocol}//${window.location.host}/v0/script-agent/operator/stage/ws`;
}

function stageSend(payload = {}) {
  if (!ws || ws.readyState !== WebSocket.OPEN) return false;
  ws.send(JSON.stringify(payload));
  return true;
}

function sendStageControl() {
  return stageSend({
    type: "operator_stage_control",
    sourceId: SOURCE_ID,
    sessionId: currentSessionId(),
    model: els.model.value || "deepseek-chat",
  });
}

function sendStageDraft(text) {
  if (applyingDraft || streaming) return false;
  stageRevision += 1;
  return stageSend({
    type: "operator_stage_draft",
    sourceId: SOURCE_ID,
    text: String(text || ""),
    revision: stageRevision,
  });
}

function renderAssistantContent(bubble, text) {
  const lines = String(text || "").split("\n");
  let html = "";
  let buffer = [];
  const flush = () => {
    if (!buffer.length) return;
    html += esc(buffer.join("\n"));
    buffer = [];
  };
  for (const line of lines) {
    if (/^#\s+/.test(line)) {
      flush();
      html += `<div class="operator-scene-title">${esc(line.replace(/^#\s+/, ""))}</div>`;
    } else {
      buffer.push(line);
    }
  }
  flush();
  bubble.innerHTML = html || "";
}

function addMeta(bubble, meta = {}) {
  const div = document.createElement("div");
  div.className = "operator-meta";
  div.innerHTML = [
    `<span class="badge">${esc(meta.provider || "deepseek")} / ${esc(meta.model || "")}</span>`,
    `<span class="badge">${Number(meta.tokens_input || 0).toLocaleString()} in</span>`,
    `<span class="badge">${Number(meta.tokens_output || 0).toLocaleString()} uit</span>`,
    `<span class="badge">$${Number(meta.kosten_dollar || 0).toFixed(4)}</span>`,
  ].join("");
  bubble.appendChild(div);
}

function appendBubble(role, text, options = {}) {
  if (els.chatLog.querySelector(".empty-state")) els.chatLog.innerHTML = "";
  const bubble = document.createElement("div");
  bubble.className = `operator-bubble ${role}${options.streaming ? " streaming" : ""}`;
  if (options.id) {
    bubble.dataset.messageId = options.id;
    stageBubbles.set(String(options.id), bubble);
  }
  if (role === "assistant") renderAssistantContent(bubble, text);
  else bubble.textContent = text || "";
  els.chatLog.appendChild(bubble);
  if (options.meta && role === "assistant") addMeta(bubble, options.meta);
  els.chatLog.scrollTop = els.chatLog.scrollHeight;
  return bubble;
}

function emptyChat() {
  stageMessages = [];
  stageBubbles = new Map();
  els.chatLog.innerHTML = '<div class="empty-state meta-line" style="padding:20px;text-align:center;">Kies links een situatie of typ direct een opdracht.</div>';
}

function renderMessages(messages = []) {
  stageMessages = Array.isArray(messages) ? messages.slice() : [];
  stageBubbles = new Map();
  els.chatLog.innerHTML = "";
  if (!stageMessages.length) {
    emptyChat();
    return;
  }
  for (const message of stageMessages) {
    const role = message.role === "assistant" ? "assistant" : "user";
    appendBubble(role, message.content || "", {
      id: message.id,
      streaming: !!message.streaming,
      meta: role === "assistant" ? message.meta : null,
    });
  }
}

function latestMeta() {
  for (let i = stageMessages.length - 1; i >= 0; i -= 1) {
    const meta = stageMessages[i] && stageMessages[i].meta;
    if (meta && typeof meta === "object") return meta;
  }
  return null;
}

function renderStats(meta = latestMeta()) {
  const providerUsage = meta && meta.provider_usage && meta.provider_usage.deepseek
    ? meta.provider_usage.deepseek
    : null;
  els.statTurns.textContent = Number(meta && meta.turn_count || Math.floor(stageMessages.length / 2) || 0).toLocaleString();
  els.statTokens.textContent = Number(meta && (meta.sessie_tokens_totaal || meta.provider_tokens_totaal) || providerUsage && providerUsage.tokens_totaal || 0).toLocaleString();
  els.statCost.textContent = `$${Number(meta && (meta.sessie_kosten_totaal || meta.provider_kosten_totaal) || providerUsage && providerUsage.kosten_totaal || 0).toFixed(4)}`;
}

function findStageMessage(id) {
  const safeId = String(id || "");
  return stageMessages.find((message) => String(message.id || "") === safeId);
}

function applyDelta(payload = {}) {
  const id = String(payload.assistantId || "");
  if (!id) return;
  let message = findStageMessage(id);
  if (!message) {
    message = { id, role: "assistant", content: "", streaming: true };
    stageMessages.push(message);
  }
  message.content = typeof payload.fullText === "string"
    ? payload.fullText
    : String(message.content || "") + String(payload.text || "");
  let bubble = stageBubbles.get(id);
  if (!bubble) {
    bubble = appendBubble("assistant", "", { id, streaming: true });
  }
  renderAssistantContent(bubble, message.content);
  bubble.classList.add("streaming");
  els.chatLog.scrollTop = els.chatLog.scrollHeight;
}

function shouldSyncDraftToChatInput(remoteSourceId = "") {
  return String(remoteSourceId || "").startsWith("stage_");
}

function applyDraft(text, remoteSourceId = "") {
  if (!shouldSyncDraftToChatInput(remoteSourceId)) return;
  if (remoteSourceId === SOURCE_ID && document.activeElement === els.chatInput) return;
  applyingDraft = true;
  els.chatInput.value = String(text || "");
  applyingDraft = false;
}

function selectHasValue(select, value) {
  const id = String(value || "");
  return !!id && Array.from(select.options || []).some((option) => String(option.value) === id);
}

function characterLabel(characterId, fallback = "") {
  const character = (catalogIndex.personages || []).find((item) => String(item.id) === String(characterId));
  return character ? character.naam : fallback || String(characterId || "");
}

function applyDraftInfo(info = {}) {
  if (!info || typeof info !== "object") return;
  if (!Array.isArray(catalogIndex.situaties) || !catalogIndex.situaties.length) {
    pendingDraftInfo = info;
    return;
  }
  currentDraftInfo = info;
  const situationId = String(info.situationId || "");
  if (selectHasValue(els.situation, situationId)) {
    els.situation.value = situationId;
  }
  updateSituationSelection({ preserveManualCharacters: true });

  selectedCharacters.clear();
  const namedCharacters = new Map((info.characters || []).map((character) => [
    String(character.characterId || ""),
    character.name || "",
  ]));
  const characterIds = Array.isArray(info.characterIds) && info.characterIds.length
    ? info.characterIds
    : Array.from(namedCharacters.keys()).filter(Boolean);
  for (const characterId of characterIds) {
    const id = String(characterId || "");
    if (!id) continue;
    selectedCharacters.set(id, characterLabel(id, namedCharacters.get(id)));
  }
  renderCharacterChips();

  const environmentId = String(info.environmentId || "");
  if (selectHasValue(els.environment, environmentId)) {
    els.environment.value = environmentId;
  } else if (selectedSituation && selectedSituation.environmentId && selectHasValue(els.environment, selectedSituation.environmentId)) {
    els.environment.value = selectedSituation.environmentId;
  }
  updateEnvironmentPreview();
  if (info.sourceType !== "manual-catalog-selection") manualSelectionDirty = false;
}

function applyStageState(stage = {}, remoteSourceId = "") {
  if (Number.isFinite(Number(stage.revision))) stageRevision = Number(stage.revision);
  if (stage.model && document.activeElement !== els.model) els.model.value = stage.model;
  if (stage.sessionId && document.activeElement !== els.sessionId) {
    els.sessionId.value = stage.sessionId;
    try { localStorage.setItem(STORAGE_SESSION_KEY, currentSessionId()); } catch {}
  }
  if (stage.style) applyStageStyle(stage.style);
  if (stage.draftInfo) applyDraftInfo(stage.draftInfo);
  applyDraft(stage.draft || "", remoteSourceId || stage.draftSourceId || "");
  setStreaming(!!stage.streaming);
  if (Array.isArray(stage.messages)) renderMessages(stage.messages);
  renderStats();
  setMeta(stage.streaming ? "Streaming..." : ws && ws.readyState === WebSocket.OPEN ? "Verbonden." : "Offline.");
}

function handleChatEvent(event = {}) {
  if (event.type === "start") {
    const id = event.assistantId || `assistant_${Date.now()}`;
    appendBubble("assistant", "", { id, streaming: true });
    setStreaming(true);
  }
  if (event.type === "delta") applyDelta(event);
  if (event.type === "done") {
    const id = event.assistantId || "";
    const bubble = id ? stageBubbles.get(id) : null;
    if (bubble) {
      bubble.classList.remove("streaming");
      renderAssistantContent(bubble, event.text || "");
      addMeta(bubble, event);
    }
    renderStats(event);
    setStreaming(false);
    setMeta(`Output opgeslagen: ${event.scriptOutput ? event.scriptOutput.scriptId : "script"}`);
  }
  if (event.type === "error") {
    setStreaming(false);
    setMeta(`Fout: ${event.error || "unknown"}`, true);
  }
}

function handleStageMessage(raw) {
  let payload = {};
  try {
    payload = JSON.parse(String(raw || "{}"));
  } catch {
    setMeta("Ongeldige stage data.", true);
    return;
  }
  if (payload.type === "operator_stage_hello" || payload.type === "operator_stage_state") {
    applyStageState(payload.stage || {}, payload.sourceId || "");
    return;
  }
  if (payload.type === "operator_stage_draft") {
    if (Number.isFinite(Number(payload.revision))) stageRevision = Number(payload.revision);
    if (payload.stage && payload.stage.draftInfo) applyDraftInfo(payload.stage.draftInfo);
    applyDraft(payload.draft || "", payload.sourceId || "");
    if (payload.stage && Array.isArray(payload.stage.messages)) {
      renderMessages(payload.stage.messages);
      renderStats();
    }
    return;
  }
  if (payload.type === "operator_stage_style") {
    applyStageStyle(payload.style || payload.stage && payload.stage.style || {});
    els.styleStatus.textContent = payload.persisted ? "bewaard" : "preview";
    return;
  }
  if (payload.type === "operator_stage_delta") {
    applyDelta(payload);
    return;
  }
  if (payload.type === "operator_stage_chat_event") {
    handleChatEvent(payload.event || {});
    return;
  }
  if (payload.type === "operator_stage_error") {
    setStreaming(false);
    setMeta(`Fout: ${payload.error || payload.message || "unknown"}`, true);
    if (payload.stage) applyStageState(payload.stage);
  }
}

function connectStage() {
  if (reconnectTimer) clearTimeout(reconnectTimer);
  ws = new WebSocket(wsUrl());
  ws.addEventListener("open", () => {
    setMeta("Verbonden.");
    sendStageControl();
    stageSend({ type: "operator_stage_refresh", sourceId: SOURCE_ID });
  });
  ws.addEventListener("message", (event) => handleStageMessage(event.data));
  ws.addEventListener("close", () => {
    setMeta("Opnieuw verbinden...");
    reconnectTimer = setTimeout(connectStage, 1000);
  });
  ws.addEventListener("error", () => setMeta("WebSocket fout.", true));
}

function renderSecretStatus(status = {}) {
  const secret = status.deepseek || status.secrets && status.secrets.deepseek || {};
  els.secretStatus.textContent = secret.configured ? `DeepSeek key ingesteld (${secret.source || "env"})` : "DeepSeek key ontbreekt";
}

async function loadStatus() {
  const status = await api("/v0/script-agent/operator/status");
  els.operatorStatusText.textContent = [
    "DeepSeek",
    status.model || els.model.value || "deepseek-chat",
    status.draft ? `draft ${status.draft.situationTitle || status.draft.situationId}` : "geen draft",
  ].join(" | ");
  els.model.value = status.model || els.model.value || "deepseek-chat";
  els.statSessions.textContent = Number(status.activeSessions || 0).toLocaleString();
  renderSecretStatus(status.secrets || {});
  if (status.stage) applyStageState(status.stage);
}

async function loadStageStyle() {
  const body = await api("/v0/script-agent/operator/stage-style");
  applyStageStyle(body.style || {});
}

async function loadSettings() {
  const body = await api("/v0/script-agent/operator/settings");
  applyOperatorSettings(body.settings || {});
  els.promptSettingsStatus.textContent = "geladen";
}

async function saveStageStyle() {
  const body = await api("/v0/script-agent/operator/stage-style", {
    method: "PATCH",
    body: JSON.stringify({ style: selectedStageStyle() }),
  });
  applyStageStyle(body.style || {});
  els.styleStatus.textContent = "bewaard";
}

async function saveModel() {
  const body = await api("/v0/script-agent/operator/settings", {
    method: "PATCH",
    body: JSON.stringify({ model: els.model.value || "deepseek-chat" }),
  });
  els.model.value = body.settings.model || els.model.value;
  sendStageControl();
}

async function savePromptSettings() {
  const body = await api("/v0/script-agent/operator/settings", {
    method: "PATCH",
    body: JSON.stringify(settingsFromControls()),
  });
  applyOperatorSettings(body.settings || {});
  sendStageControl();
  if (els.situation.value) sendManualDraftPreview();
  els.promptSettingsStatus.textContent = "bewaard";
  setMeta("Prompt instellingen opgeslagen.");
}

async function loadCatalog() {
  const data = await api("/v0/script-agent/operator/catalog/index");
  catalogIndex = data;
  populateDropdowns();
  setMsg(`${(data.situaties || []).length} situaties geladen.`);
}

function populateDropdowns() {
  const currentSituation = els.situation.value;
  els.situation.innerHTML = '<option value="">Kies een situatie</option>' +
    (catalogIndex.situaties || []).map((item) => `<option value="${esc(item.id)}">${esc(item.naam)}</option>`).join("");
  const runtimeSituation = catalogIndex.runtimeSelection && catalogIndex.runtimeSelection.situationId || "";
  els.situation.value = currentSituation || runtimeSituation || "";

  els.character.innerHTML = '<option value="">+ personage</option>' +
    (catalogIndex.personages || []).map((item) => `<option value="${esc(item.id)}">${esc(item.naam)}</option>`).join("");

  const currentEnvironment = els.environment.value;
  els.environment.innerHTML = '<option value="">Geen / situatie kiest</option>' +
    (catalogIndex.omgevingen || []).map((item) => `<option value="${esc(item.id)}">${esc(item.naam)}</option>`).join("");
  els.environment.value = currentEnvironment;
  updateSituationSelection({ preserveManualCharacters: false });
  if (pendingDraftInfo) {
    const info = pendingDraftInfo;
    pendingDraftInfo = null;
    applyDraftInfo(info);
  } else if (currentDraftInfo) {
    applyDraftInfo(currentDraftInfo);
  }
  updateEnvironmentPreview();
}

function renderCharacterChips() {
  const rows = Array.from(selectedCharacters.entries());
  els.characterChips.innerHTML = rows.map(([id, name]) => `
    <span class="chip">${esc(name)} <button type="button" data-character-id="${esc(id)}" title="verwijder">x</button></span>
  `).join("") || '<span class="meta-line">Geen personages gekozen.</span>';
  els.characterChips.querySelectorAll("button[data-character-id]").forEach((button) => {
    button.addEventListener("click", () => {
      selectedCharacters.delete(button.getAttribute("data-character-id"));
      renderCharacterChips();
      sendManualDraftPreview();
    });
  });
}

function updateSituationSelection(options = {}) {
  const id = String(els.situation.value || "");
  selectedSituation = (catalogIndex.situaties || []).find((item) => String(item.id) === id) || null;
  els.situationPreview.textContent = selectedSituation ? selectedSituation.beschrijving || "" : "";
  if (!selectedSituation) {
    if (!options.preserveManualCharacters) {
      selectedCharacters.clear();
      renderCharacterChips();
    }
    return;
  }
  if (!options.preserveManualCharacters) {
    selectedCharacters.clear();
    const ids = selectedSituation.characterIds && selectedSituation.characterIds.length
      ? selectedSituation.characterIds
      : catalogIndex.runtimeSelection && catalogIndex.runtimeSelection.characterIds || [];
    for (const characterId of ids) {
      const character = (catalogIndex.personages || []).find((item) => String(item.id) === String(characterId));
      if (character) selectedCharacters.set(String(character.id), character.naam);
    }
    renderCharacterChips();
  }
  if (selectedSituation.environmentId && !els.environment.value) {
    els.environment.value = selectedSituation.environmentId;
  }
  updateEnvironmentPreview();
}

function updateEnvironmentPreview() {
  const environment = (catalogIndex.omgevingen || []).find((item) => String(item.id) === String(els.environment.value || ""));
  els.environmentPreview.textContent = environment ? environment.beschrijving || "" : "";
}

function manualDraftBody() {
  return {
    sessionId: currentSessionId(),
    situationId: els.situation.value,
    characterIds: Array.from(selectedCharacters.keys()),
    environmentId: els.environment.value,
    extra: els.starterExtra.value,
    sourceId: SCENE_SOURCE_ID,
  };
}

let manualDraftPreviewTimer = null;
function sendManualDraftPreview() {
  if (!els.situation.value || streaming) return;
  if (manualDraftPreviewTimer) clearTimeout(manualDraftPreviewTimer);
  manualDraftPreviewTimer = setTimeout(async () => {
    manualDraftPreviewTimer = null;
    try {
      const body = await api("/v0/script-agent/operator/draft/manual", {
        method: "POST",
        body: JSON.stringify(manualDraftBody()),
      });
      setMsg("Scène klaargezet.");
    } catch (err) {
      setMsg(err.message || "manual draft failed", true);
    }
  }, 250);
}

async function sceneToChat() {
  if (manualSelectionDirty) {
    if (!els.situation.value) {
      setMsg("Kies eerst een situatie.", true);
      return;
    }
    const body = await api("/v0/script-agent/operator/draft/manual", {
      method: "POST",
      body: JSON.stringify(manualDraftBody()),
    });
    await submitChat({ text: body.draft ? body.draft.text || "" : "", promptInput: body.promptInput });
    manualSelectionDirty = false;
    return;
  }
  setStreaming(true);
  setMeta("Scene naar chat...");
  const body = await api("/v0/script-agent/operator/scene-to-chat", {
    method: "POST",
    body: JSON.stringify({
      sessionId: currentSessionId(),
      sourceId: SCENE_SOURCE_ID,
      force: true,
    }),
  });
  if (body.stage) applyStageState(body.stage, SCENE_SOURCE_ID);
  setStreaming(false);
  setMsg(`Scene verstuurd: ${body.draft && body.draft.situationTitle || "runtime draft"}`);
}

async function refreshRuntimeDraft() {
  const body = await api("/v0/script-agent/operator/draft/from-runtime", {
    method: "POST",
    body: JSON.stringify({ force: true, sourceId: SCENE_SOURCE_ID }),
  });
  setMsg("Runtime draft geladen.");
}

function parseSseBuffer(buffer, onEvent) {
  let remaining = buffer;
  let index = remaining.indexOf("\n\n");
  while (index >= 0) {
    const raw = remaining.slice(0, index);
    remaining = remaining.slice(index + 2);
    const data = raw.split(/\n/).filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).trimStart()).join("\n");
    if (data) onEvent(JSON.parse(data));
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

async function fallbackHttpSubmit(text, promptInput = null) {
  appendBubble("user", text || els.chatInput.value);
  const assistant = appendBubble("assistant", "", { id: `assistant_${Date.now()}`, streaming: true });
  const response = await fetch("/v0/script-agent/operator/chat/stream", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      sessionId: currentSessionId(),
      message: text || els.chatInput.value,
      promptInput,
      sourceId: SOURCE_ID,
    }),
  });
  if (!response.ok || !response.body) throw new Error(`stream failed ${response.status}`);
  let fullText = "";
  await readSse(response, (event) => {
    if (event.type === "delta") {
      fullText = event.fullText || `${fullText}${event.text || ""}`;
      renderAssistantContent(assistant, fullText);
    }
    if (event.type === "done") {
      assistant.classList.remove("streaming");
      renderAssistantContent(assistant, event.text || fullText);
      addMeta(assistant, event);
      renderStats(event);
      setMeta(`Output opgeslagen: ${event.scriptOutput ? event.scriptOutput.scriptId : "script"}`);
    }
    if (event.type === "error") throw new Error(event.error || "stream error");
  });
}

async function submitChat(options = {}) {
  const text = String(options.text == null ? els.chatInput.value : options.text).trim();
  if (!text && !options.promptInput) return;
  setStreaming(true);
  setMeta("Streaming...");
  sendStageControl();
  if (text) sendStageDraft(text);
  const sent = stageSend({
    type: "operator_stage_submit",
    sourceId: SOURCE_ID,
    sessionId: currentSessionId(),
    text,
  });
  if (!sent) {
    await fallbackHttpSubmit(text, options.promptInput || null);
    setStreaming(false);
  }
}

async function loadSession() {
  const body = await api(`/v0/script-agent/operator/session/${encodeURIComponent(currentSessionId())}`);
  if (!stageMessages.length && body.messages) renderMessages(body.messages);
  renderStats({
    turn_count: body.turnCount,
    sessie_tokens_totaal: body.tokensTotal,
    sessie_kosten_totaal: body.costTotal,
    provider_usage: body.providerUsage,
  });
}

async function undoTurn() {
  await api(`/v0/script-agent/operator/session/${encodeURIComponent(currentSessionId())}/undo`, { method: "POST" });
  await loadStatus();
  setMeta("Laatste beurt verwijderd.");
}

async function clearChat() {
  await api(`/v0/script-agent/operator/session/${encodeURIComponent(currentSessionId())}`, { method: "DELETE" });
  emptyChat();
  setMeta("Chat gewist.");
}

async function resetSession() {
  await clearChat();
  els.chatInput.value = "";
  sendStageDraft("");
  setMeta("Sessie gereset.");
}

async function saveSecret(event) {
  event.preventDefault();
  const key = els.deepSeekApiKey.value.trim();
  if (!key) return;
  const status = await api("/v0/script-agent/operator/secrets", {
    method: "POST",
    body: JSON.stringify({ deepSeekApiKey: key }),
  });
  els.deepSeekApiKey.value = "";
  renderSecretStatus(status);
  setMeta("API key opgeslagen.");
}

async function clearSecret() {
  const status = await api("/v0/script-agent/operator/secrets", {
    method: "POST",
    body: JSON.stringify({ clearDeepSeekApiKey: true }),
  });
  renderSecretStatus(status);
  setMeta("Lokale API key verwijderd.");
}

async function withUiError(action) {
  try {
    await action();
  } catch (err) {
    setStreaming(false);
    const message = err && err.message ? err.message : "unknown";
    setMeta(`Fout: ${message}`, true);
    setMsg(message, true);
  }
}

els.sessionId.value = localStorage.getItem(STORAGE_SESSION_KEY) || els.sessionId.value;
els.reloadCatalog.addEventListener("click", () => withUiError(loadCatalog));
els.sessionId.addEventListener("change", () => {
  localStorage.setItem(STORAGE_SESSION_KEY, currentSessionId());
  sendStageControl();
  withUiError(loadSession);
});
els.model.addEventListener("change", () => withUiError(saveModel));
els.situation.addEventListener("change", () => {
  manualSelectionDirty = true;
  updateSituationSelection({ preserveManualCharacters: false });
  sendManualDraftPreview();
});
els.character.addEventListener("change", () => {
  const id = String(els.character.value || "");
  const character = (catalogIndex.personages || []).find((item) => String(item.id) === id);
  if (character) {
    manualSelectionDirty = true;
    selectedCharacters.set(String(character.id), character.naam);
    renderCharacterChips();
    sendManualDraftPreview();
  }
  els.character.value = "";
});
els.environment.addEventListener("change", () => {
  manualSelectionDirty = true;
  updateEnvironmentPreview();
  sendManualDraftPreview();
});
els.starterExtra.addEventListener("input", () => {
  manualSelectionDirty = true;
  sendManualDraftPreview();
});
els.sceneToChat.addEventListener("click", () => withUiError(sceneToChat));
els.refreshRuntimeDraft.addEventListener("click", () => withUiError(refreshRuntimeDraft));
els.chatForm.addEventListener("submit", (event) => {
  event.preventDefault();
  withUiError(submitChat);
});
els.chatInput.addEventListener("input", () => {
  sendStageControl();
  sendStageDraft(els.chatInput.value || "");
});
els.chatInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && !event.shiftKey) {
    event.preventDefault();
    withUiError(submitChat);
  }
});
els.undoTurn.addEventListener("click", () => withUiError(undoTurn));
els.clearChat.addEventListener("click", () => withUiError(clearChat));
els.resetSession.addEventListener("click", () => withUiError(resetSession));
els.savePromptSettings.addEventListener("click", () => withUiError(savePromptSettings));
["stageFont", "stageCursor", "stageFontSize"].forEach((id) => {
  els[id].addEventListener("change", () => {
    stageSend({
      type: "operator_stage_style",
      sourceId: SOURCE_ID,
      style: selectedStageStyle(),
    });
    els.styleStatus.textContent = "preview";
  });
});
els.saveStageStyle.addEventListener("click", () => withUiError(saveStageStyle));
els.secretForm.addEventListener("submit", (event) => withUiError(() => saveSecret(event)));
els.clearSecret.addEventListener("click", () => withUiError(clearSecret));

async function boot() {
  emptyChat();
  applyStageStyle({ font: "jetbrains", cursor: "block", fontSize: 30 });
  connectStage();
  await Promise.all([
    loadStageStyle().catch((err) => setMsg(err.message || "stage style niet geladen", true)),
    loadSettings().catch((err) => {
      els.promptSettingsStatus.textContent = "niet geladen";
      setMsg(err.message || "settings niet geladen", true);
    }),
    loadStatus().catch((err) => {
      els.operatorStatusText.textContent = "Status niet geladen";
      setMeta(`Fout: ${err.message || "status niet geladen"}`, true);
    }),
  ]);
  await loadCatalog().catch((err) => setMsg(err.message || "catalog niet geladen", true));
  await loadSession().catch((err) => setMeta(`Fout: ${err.message || "sessie niet geladen"}`, true));
  if (statusTimer) clearInterval(statusTimer);
  statusTimer = setInterval(() => withUiError(loadStatus), 5000);
}

withUiError(boot);
