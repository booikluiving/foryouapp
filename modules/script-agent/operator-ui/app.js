"use strict";

const $ = (selector) => document.querySelector(selector);

const STORAGE_SESSION_KEY = "script_agent_operator_session";
const STORAGE_SOURCE_KEY = "script_agent_operator_source";
// Eenmalig: wat in deze browser nog onder de oude sleutelnaam staat, overnemen.
for (const key of [STORAGE_SESSION_KEY, STORAGE_SOURCE_KEY]) {
  try {
    const oldKey = key + "_v1";
    const oldValue = localStorage.getItem(oldKey);
    if (oldValue === null) continue;
    if (localStorage.getItem(key) === null) localStorage.setItem(key, oldValue);
    localStorage.removeItem(oldKey);
  } catch (_err) { /* opslag niet beschikbaar */ }
}

const els = {
  operatorStatusText: $("#operatorStatusText"),
  reloadCatalog: $("#reloadCatalog"),
  sessionId: $("#sessionId"),
  model: $("#model"),
  modelKeuze: $("#modelKeuze"),
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
  sceneTestToggle: $("#sceneTestToggle"),
  sceneTestStart: $("#sceneTestStart"),
  sceneTestRandom: $("#sceneTestRandom"),
  sceneTestMsg: $("#sceneTestMsg"),
  syncMsg: $("#syncMsg"),
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
  savedScenesCount: $("#savedScenesCount"),
  savedScenesList: $("#savedScenesList"),
  savedSceneView: $("#savedSceneView"),
  savedSceneText: $("#savedSceneText"),
  savedSceneCopy: $("#savedSceneCopy"),
  savedSceneToInput: $("#savedSceneToInput"),
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

// Bewaarde scènes: eerdere versies van de gekozen situatie teruglezen.
let savedScenes = [];
let savedSceneId = "";
let savedScenesFor = null;

function savedSceneLabel(scene) {
  const when = new Date(scene.createdAt);
  const stamp = Number.isNaN(when.getTime()) ? "" : when.toLocaleString("nl-NL", {
    day: "numeric", month: "short", hour: "2-digit", minute: "2-digit",
  });
  const first = String(scene.scriptText || "").split("\n").map((line) => line.trim())
    .find((line) => line && !line.startsWith("#")) || "";
  return `<b>${esc(stamp)}</b>${esc(first.slice(0, 80))}`;
}

function renderSavedScenes() {
  els.savedScenesCount.textContent = els.situation.value ? String(savedScenes.length) : "";
  els.savedScenesList.innerHTML = savedScenes.map((scene) =>
    `<button type="button" data-script-id="${esc(scene.scriptId)}"${scene.scriptId === savedSceneId ? ' class="active"' : ""}>${savedSceneLabel(scene)}</button>`
  ).join("");
  const current = savedScenes.find((scene) => scene.scriptId === savedSceneId) || null;
  els.savedSceneView.hidden = !current;
  els.savedSceneText.textContent = current ? current.scriptText : "";
}

async function loadSavedScenes(options = {}) {
  const situationId = String(els.situation.value || "");
  if (!options.force && situationId === savedScenesFor) return;
  savedScenesFor = situationId;
  if (!situationId) {
    savedScenes = [];
  } else {
    try {
      const body = await api(`/v0/script-agent/operator/saved-scenes?situationId=${encodeURIComponent(situationId)}`);
      if (savedScenesFor !== situationId) return;
      savedScenes = Array.isArray(body.scenes) ? body.scenes : [];
    } catch {
      savedScenes = [];
    }
  }
  if (!savedScenes.some((scene) => scene.scriptId === savedSceneId)) savedSceneId = "";
  renderSavedScenes();
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
  toonModel(settings.model || els.model.value || "deepseek-chat");
  els.systemPrompt.value = settings.systemPrompt || "";
  els.promptTemplate.value = settings.promptTemplate || "";
  els.temperature.value = String(settings.temperature ?? 0.8);
  els.maxTokens.value = String(settings.maxTokens || 4096);
}

// Het model dat nu schrijft: zichtbaar in de keuze boven de chat en in de statusregel.
let statusDraftLabel = "";
function toonModel(model) {
  const actief = String(model || "").trim();
  if (!actief) return;
  if (document.activeElement !== els.model) els.model.value = actief;
  for (const knop of els.modelKeuze.querySelectorAll("button")) {
    const aan = knop.dataset.model === actief;
    knop.classList.toggle("active", aan);
    knop.setAttribute("aria-pressed", aan ? "true" : "false");
  }
  els.operatorStatusText.textContent = ["DeepSeek", actief, statusDraftLabel].filter(Boolean).join(" | ");
}

async function kiesModel(model) {
  const body = await api("/v0/script-agent/operator/settings", {
    method: "PATCH",
    body: JSON.stringify({ model }),
  });
  toonModel(body.settings.model);
  sendStageControl();
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

// Alleen meescrollen als de operator al (bijna) onderaan staat.
function chatIsNearBottom() {
  const log = els.chatLog;
  return log.scrollHeight - log.scrollTop - log.clientHeight < 80;
}

function scrollChatToBottom() {
  els.chatLog.scrollTop = els.chatLog.scrollHeight;
}

function appendBubble(role, text, options = {}) {
  const stick = options.forceScroll || chatIsNearBottom();
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
  if (!options.noScroll && stick) scrollChatToBottom();
  return bubble;
}

function emptyChat() {
  stageMessages = [];
  stageBubbles = new Map();
  els.chatLog.innerHTML = '<div class="empty-state meta-line" style="padding:20px;text-align:center;">Kies links een situatie of typ direct een opdracht.</div>';
}

function renderMessages(messages = []) {
  const stick = chatIsNearBottom();
  const previousScrollTop = els.chatLog.scrollTop;
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
      noScroll: true,
    });
  }
  if (stick) scrollChatToBottom();
  else els.chatLog.scrollTop = previousScrollTop;
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
  const stick = chatIsNearBottom();
  let bubble = stageBubbles.get(id);
  if (!bubble) {
    bubble = appendBubble("assistant", "", { id, streaming: true });
  }
  renderAssistantContent(bubble, message.content);
  bubble.classList.add("streaming");
  if (stick) scrollChatToBottom();
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

// De lijsten volgen de scène die klaarstaat, maar alleen als er een andere scène klaar komt te
// staan. De stand komt elke paar seconden opnieuw binnen; zonder deze grens sprong een keuze die
// je net gemaakt had terug naar de scène die al klaarstond.
let toegepasteDraft = "";
function applyDraftInfo(info = {}, opnieuw = false) {
  if (!info || typeof info !== "object") return;
  if (!Array.isArray(catalogIndex.situaties) || !catalogIndex.situaties.length) {
    pendingDraftInfo = info;
    return;
  }
  currentDraftInfo = info;
  const sleutel = String(info.promptInputId || `${info.situationId || ""}|${info.environmentId || ""}`);
  if (!opnieuw && sleutel === toegepasteDraft) return;
  toegepasteDraft = sleutel;
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
  if (stage.model) toonModel(stage.model);
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
    loadSavedScenes({ force: true });
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
  loadSceneTest().catch(() => {
    sceneTestState = { running: false, enabled: false, activeSituation: null };
    renderSceneTest();
    renderSync(null);
  });
  const status = await api("/v0/script-agent/operator/status");
  statusDraftLabel = status.draft ? `draft ${status.draft.situationTitle || status.draft.situationId}` : "geen draft";
  toonModel(status.model || els.model.value || "deepseek-chat");
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
  toonModel(body.settings.model || els.model.value);
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
    applyDraftInfo(info, true);
  } else if (currentDraftInfo) {
    applyDraftInfo(currentDraftInfo, true);
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
  loadSavedScenes();
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

// Scènes testen: elke situatie starten, los van de paden. Kan alleen in een testrun; aanzetten
// maakt de lopende run een testrun (tot de reset).
let sceneTestState = { running: false, enabled: false, activeSituation: null };

function renderSceneTest(message, error = false) {
  const { running, enabled, activeSituation } = sceneTestState;
  els.sceneTestToggle.checked = enabled;
  els.sceneTestToggle.disabled = !running;
  els.sceneTestToggle.closest(".scene-test").classList.toggle("on", enabled);
  els.sceneTestStart.hidden = !enabled;
  const random = sceneTestState.random || {};
  els.sceneTestRandom.checked = !!random.enabled;
  els.sceneTestRandom.disabled = !running;
  els.sceneTestRandom.closest(".scene-test").classList.toggle("on", !!random.enabled);
  els.sceneTestStart.disabled = !els.situation.value && !els.environment.value;
  const standaard = !running
    ? "Kan alleen als er een run loopt."
    : random.enabled
      ? `Random. ${activeSituation ? `Nu: ${activeSituation.title}. ` : ""}${random.error || (random.next ? `Klaar: ${random.next.title}. Start en stop met de deck.` : "Scène kiezen...")}`
    : enabled
      ? `Testrun. ${activeSituation ? `Nu: ${activeSituation.title}. ` : ""}Kies een situatie, een omgeving of allebei en druk op Start scène.`
      : "";
  els.sceneTestMsg.textContent = message || standaard;
  els.sceneTestMsg.style.color = error ? "var(--bad)" : "";
}

function klokTijd(iso) {
  const date = new Date(iso || "");
  return Number.isNaN(date.getTime())
    ? ""
    : date.toLocaleTimeString("nl-NL", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

// De laatste update van de website, zoals de sync-agent op de show-Mac hem meldt.
function renderSync(sync) {
  let text = "";
  let error = false;
  if (!sync || !sync.available) {
    text = "Website: geen sync op deze machine.";
  } else {
    const versie = sync.appliedVersion ? `versie ${sync.appliedVersion}` : "nog geen versie";
    const sinds = sync.appliedAt ? `, laatste update ${klokTijd(sync.appliedAt)}` : "";
    text = `Website: ${versie}${sinds}.`;
    if (sync.stale) {
      text += ` Sync meldt zich niet meer (laatst ${klokTijd(sync.reportedAt) || "onbekend"}).`;
      error = true;
    } else if (sync.state === "wacht" || sync.state === "conflict") {
      text += ` ${sync.message}`;
    } else if (sync.state === "offline" || sync.state === "fout") {
      text += ` ${sync.message}`;
      error = true;
    }
  }
  els.syncMsg.textContent = text;
  els.syncMsg.style.color = error ? "var(--bad)" : "";
}

async function loadSceneTest() {
  const body = await api("/v0/script-agent/operator/scene-test");
  sceneTestState = body;
  renderSceneTest();
  renderSync(body.sync);
}

async function toggleSceneTest() {
  const enabled = els.sceneTestToggle.checked;
  if (enabled && !sceneTestState.markedAt
    && !confirm("Scènes testen maakt van de lopende run een testrun, tot de reset. Doorgaan?")) {
    renderSceneTest();
    return;
  }
  try {
    sceneTestState = await api("/v0/script-agent/operator/scene-test", {
      method: "POST",
      body: JSON.stringify({ enabled }),
    });
    renderSceneTest();
    // Bij het aanzetten: lijsten van nu, en situatie en omgeving bij elkaar.
    if (sceneTestState.enabled) {
      await verversLijsten();
      testKeuzeGelijk();
      els.sceneTestStart.disabled = !els.situation.value && !els.environment.value;
    }
  } catch (err) {
    renderSceneTest(err.message || "Scènes testen zetten lukte niet.", true);
  }
}

// Random scènes testen: de dienst zet steeds een willekeurige scène klaar, nooit een startscène.
async function toggleSceneTestRandom() {
  const enabled = els.sceneTestRandom.checked;
  if (enabled && !sceneTestState.markedAt
    && !confirm("Random scènes testen maakt van de lopende run een testrun, tot de reset. Doorgaan?")) {
    renderSceneTest();
    return;
  }
  try {
    sceneTestState = await api("/v0/script-agent/operator/scene-test/random", {
      method: "POST",
      body: JSON.stringify({ enabled }),
    });
    renderSceneTest();
  } catch (err) {
    renderSceneTest(err.message || "Random scènes testen zetten lukte niet.", true);
  }
}

// Het script op de teleprompter hoort bij de scène die start. Staat er nog het script van een
// andere scène (in een testrun schrijft niets vanzelf), dan wordt het eerst geschreven. Zonder dit
// speelde de nieuwe omgeving met de tekst en de titel van de vorige scène.
async function schrijfTestScript() {
  const nummer = (waarde) => Number((String(waarde || "").match(/(\d+)$/) || [])[1] || 0);
  const wil = nummer(els.situation.value);
  if (!wil) return true;
  const bron = async () => {
    const tele = await api("/v0/script-agent/teleprompter-parser/current").catch(() => null);
    return tele && tele.teleprompt && tele.teleprompt.source ? tele.teleprompt.source : {};
  };
  const eerst = await bron();
  if (nummer(eerst.sceneId) === wil) return true;
  renderSceneTest("Script schrijven voor deze scène...");
  manualSelectionDirty = true;
  await sceneToChat();
  const tot = Date.now() + 120000;
  while (Date.now() < tot) {
    await new Promise((resolve) => setTimeout(resolve, 1000));
    const nu = await bron();
    if (nummer(nu.sceneId) === wil && nu.generatedAt !== eerst.generatedAt) return true;
  }
  return false;
}

async function startTestScene() {
  if (!els.situation.value && !els.environment.value) return;
  els.sceneTestStart.disabled = true;
  try {
    if (!(await schrijfTestScript())) {
      renderSceneTest("Het script voor deze scène kwam niet. De scène is niet gestart; probeer het opnieuw.", true);
      return;
    }
    renderSceneTest("Scène starten...");
    const body = await api("/v0/script-agent/operator/scene-test/start", {
      method: "POST",
      body: JSON.stringify({ situationId: els.situation.value, environmentId: els.environment.value }),
    });
    sceneTestState = body.status || sceneTestState;
    manualSelectionDirty = false;
    renderSceneTest(`Gestart: ${body.title || "scène"}${body.environment ? ` in ${body.environment}` : ""}.`);
  } catch (err) {
    renderSceneTest(err.message || "Scène starten lukte niet.", true);
  } finally {
    els.sceneTestStart.disabled = !els.situation.value && !els.environment.value;
  }
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
  appendBubble("user", text || els.chatInput.value, { forceScroll: true });
  const assistant = appendBubble("assistant", "", { id: `assistant_${Date.now()}`, streaming: true, forceScroll: true });
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
      loadSavedScenes({ force: true });
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
els.modelKeuze.addEventListener("click", (event) => {
  const knop = event.target.closest("button[data-model]");
  if (knop) withUiError(() => kiesModel(knop.dataset.model));
});
els.savedScenesList.addEventListener("click", (event) => {
  const button = event.target.closest("button[data-script-id]");
  if (!button) return;
  savedSceneId = savedSceneId === button.dataset.scriptId ? "" : button.dataset.scriptId;
  renderSavedScenes();
});
els.savedSceneCopy.addEventListener("click", () => withUiError(async () => {
  await navigator.clipboard.writeText(els.savedSceneText.textContent || "");
  setMsg("Scène gekopieerd.");
}));
els.savedSceneToInput.addEventListener("click", () => {
  const text = els.savedSceneText.textContent || "";
  if (!text) return;
  els.chatInput.value = `${els.chatInput.value ? `${els.chatInput.value}\n\n` : ""}Eerdere versie van deze scène:\n\n${text}`;
  els.chatInput.focus();
});
// Vaste opmerkingen voor de volgende scène: een druk zet de opmerking klaar; ze gaat mee zodra de
// volgende scène naar de chat gaat.
function toonOpmerkingen(body) {
  const stand = document.getElementById("opmerkingStand");
  if (!stand) return;
  const regels = String(body && body.bewaard || "").split("\n").filter(Boolean);
  stand.textContent = regels.length ? `Gaat mee: ${regels.join(" · ")}` : "";
}
async function stuurOpmerking(body) {
  toonOpmerkingen(await api("/v0/script-agent/operator/opmerking", { method: "POST", body: JSON.stringify(body) }));
}
document.querySelectorAll("[data-opmerking]").forEach((knop) => {
  knop.addEventListener("click", () => withUiError(() => stuurOpmerking({ tekst: knop.dataset.opmerking })));
});
document.getElementById("opmerkingWis").addEventListener("click", () => withUiError(() => stuurOpmerking({ wis: true })));
setInterval(() => api("/v0/script-agent/operator/opmerking").then(toonOpmerkingen).catch(() => {}), 3000);
els.sceneTestToggle.addEventListener("change", () => toggleSceneTest());
els.sceneTestRandom.addEventListener("change", () => toggleSceneTestRandom());
els.sceneTestStart.addEventListener("click", () => startTestScene());
els.situation.addEventListener("change", () => {
  els.sceneTestStart.disabled = !els.situation.value && !els.environment.value;
  manualSelectionDirty = true;
  laatstGekozen = "situatie";
  updateSituationSelection({ preserveManualCharacters: false });
  matchEnvironmentToSituation();
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
// In de testmodus wisselt de situatie mee met de omgeving: er staat dan meteen een scène klaar
// die bij die omgeving hoort. Past de gekozen situatie al bij de omgeving, dan blijft hij staan.
function matchSituationToEnvironment() {
  if (!sceneTestState.enabled) return;
  const environmentId = String(els.environment.value || "");
  if (!environmentId) return;
  const situaties = catalogIndex.situaties || [];
  const current = situaties.find((item) => String(item.id) === String(els.situation.value || ""));
  if (current && String(current.environmentId || "") === environmentId) return;
  const match = situaties.find((item) => String(item.environmentId || "") === environmentId);
  if (!match || !selectHasValue(els.situation, match.id)) {
    // Bij deze omgeving hoort geen situatie: de gekozen situatie blijft staan en speelt hier.
    const omgeving = (catalogIndex.omgevingen || []).find((item) => String(item.id) === environmentId);
    if (current) renderSceneTest(`Bij ${omgeving ? omgeving.naam : "deze omgeving"} hoort geen situatie. Start scène speelt "${current.naam}" in deze omgeving.`);
    return;
  }
  els.situation.value = match.id;
  updateSituationSelection({ preserveManualCharacters: false });
  renderSceneTest();
}

// Andersom ook: in de testmodus gaat de omgeving mee met de gekozen situatie. Zonder dit bleef de
// omgeving van de vorige scène staan en speelde de nieuwe situatie daarin.
function matchEnvironmentToSituation() {
  if (!sceneTestState.enabled) return;
  const current = (catalogIndex.situaties || []).find((item) => String(item.id) === String(els.situation.value || ""));
  if (!current) return;
  // Heeft de situatie geen eigen omgeving (of staat die niet in de lijst), dan gaat de omgeving
  // leeg: zo blijft de omgeving van de vorige scène er niet onder staan.
  const eigen = String(current.environmentId || "");
  const environmentId = eigen && selectHasValue(els.environment, eigen) ? eigen : "";
  if (String(els.environment.value || "") === environmentId) return;
  els.environment.value = environmentId;
  updateEnvironmentPreview();
  renderSceneTest();
}

// Wat het laatst met de hand gekozen is, wint als de testmodus pas daarna aangaat.
let laatstGekozen = "situatie";
function testKeuzeGelijk() {
  if (laatstGekozen === "omgeving") matchSituationToEnvironment();
  else matchEnvironmentToSituation();
}

// Situaties en omgevingen die tijdens de run in de catalogus zijn gezet, komen in de lijsten
// zonder de pagina te herladen. Wat gekozen is blijft staan.
let catalogusKijkt = false;
async function verversLijsten() {
  if (catalogusKijkt) return;
  if (document.activeElement === els.situation || document.activeElement === els.environment) return;
  catalogusKijkt = true;
  try {
    const data = await api("/v0/script-agent/operator/catalog/index");
    const ids = (index) => [...(index.situaties || []), ...(index.omgevingen || [])]
      .map((item) => `${item.id}|${item.naam}|${item.environmentId || ""}`).join("\n");
    if (ids(data) === ids(catalogIndex)) return;
    const situatie = els.situation.value;
    const omgeving = els.environment.value;
    catalogIndex = data;
    els.situation.innerHTML = '<option value="">Kies een situatie</option>' +
      (catalogIndex.situaties || []).map((item) => `<option value="${esc(item.id)}">${esc(item.naam)}</option>`).join("");
    els.situation.value = selectHasValue(els.situation, situatie) ? situatie : "";
    els.environment.innerHTML = '<option value="">Geen / situatie kiest</option>' +
      (catalogIndex.omgevingen || []).map((item) => `<option value="${esc(item.id)}">${esc(item.naam)}</option>`).join("");
    els.environment.value = selectHasValue(els.environment, omgeving) ? omgeving : "";
  } catch (_err) {
    // de lijsten van daarnet blijven staan
  } finally {
    catalogusKijkt = false;
  }
}
setInterval(() => { if (sceneTestState.enabled) verversLijsten(); }, 10000);

els.environment.addEventListener("change", () => {
  laatstGekozen = "omgeving";
  matchSituationToEnvironment();
  els.sceneTestStart.disabled = !els.situation.value && !els.environment.value;
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

// Publiek: het kijkvenster met de telefoonpagina en het invoerveld voor de publiekschat.
const STORAGE_PUBLIEK_NAAM_KEY = "script_agent_operator_publiek_naam";
const publiek = {
  kijk: $("#telefoonKijk"),
  form: $("#publiekChatForm"),
  naam: $("#publiekChatNaam"),
  input: $("#publiekChatInput"),
  msg: $("#publiekChatMsg"),
};

function setPubliekMsg(text, isError = false) {
  publiek.msg.textContent = text || "";
  publiek.msg.style.color = isError ? "var(--bad)" : "";
}

async function loadPubliek() {
  try { publiek.naam.value = localStorage.getItem(STORAGE_PUBLIEK_NAAM_KEY) || ""; } catch (_err) { /* opslag niet beschikbaar */ }
  const info = await api("/v0/script-agent/operator/publiek");
  publiek.kijk.src = `${location.protocol}//${location.hostname}:${info.port}${info.kijkPath}`;
}

async function submitPubliekChat() {
  const name = publiek.naam.value.trim();
  const text = publiek.input.value.trim();
  if (!text) return;
  if (!name) {
    setPubliekMsg("Vul eerst een naam in.", true);
    publiek.naam.focus();
    return;
  }
  try {
    await api("/v0/script-agent/operator/publiek/chat", { method: "POST", body: JSON.stringify({ name, text }) });
  } catch (err) {
    setPubliekMsg(err.message || "Bericht niet geplaatst.", true);
    return;
  }
  publiek.input.value = "";
  setPubliekMsg("");
}

publiek.naam.addEventListener("change", () => {
  try { localStorage.setItem(STORAGE_PUBLIEK_NAAM_KEY, publiek.naam.value.trim()); } catch (_err) { /* opslag niet beschikbaar */ }
});
publiek.form.addEventListener("submit", (event) => {
  event.preventDefault();
  submitPubliekChat();
});

async function boot() {
  emptyChat();
  applyStageStyle({ font: "jetbrains", cursor: "block", fontSize: 30 });
  connectStage();
  loadPubliek().catch((err) => setPubliekMsg(err.message || "publiek niet geladen", true));
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
