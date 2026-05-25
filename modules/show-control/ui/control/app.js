"use strict";

const $ = (id) => document.getElementById(id);

const tabs = [
  ["hub", "Cue Hub"],
  ["builder", "Cue Builder"],
  ["library", "Cue Library"],
  ["runtime", "Runtime"],
  ["td", "TouchDesigner"],
  ["audio", "Audio/SQ5"],
  ["cameras", "Cameras"],
  ["deck", "Stream Deck/Perfect Cue"],
  ["logs", "Logs/Warnings"],
];

let commands = [];
let status = null;
let cues = [];
let builderActions = [];
let selectedTab = "hub";

function esc(value) {
  return String(value == null ? "" : value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

async function api(pathname, options = {}) {
  const response = await fetch(pathname, options);
  const text = await response.text();
  let body = {};
  try {
    body = text ? JSON.parse(text) : {};
  } catch (_err) {
    body = { message: text };
  }
  if (!response.ok) throw new Error(body.message || body.error || `${pathname} ${response.status}`);
  return body;
}

function post(pathname, body = {}) {
  return api(pathname, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function commandOptions(selected) {
  return commands.map((command) => `<option value="${esc(command.name)}" ${command.name === selected ? "selected" : ""}>${esc(command.name)}</option>`).join("");
}

function targetCommands(target) {
  if (target === "deck") {
    return commands.filter((command) => ["streamdeck", "perfectcue", "keyboard"].includes(command.targetId));
  }
  return commands.filter((command) => command.targetId === target);
}

function setTab(tabId) {
  selectedTab = tabId;
  document.querySelectorAll(".tab-button").forEach((button) => {
    button.classList.toggle("active", button.dataset.tab === tabId);
  });
  document.querySelectorAll(".tab-panel").forEach((panel) => {
    panel.classList.toggle("active", panel.id === `tab-${tabId}`);
  });
}

function renderTabs() {
  $("tabs").innerHTML = tabs.map(([id, label]) => `
    <button class="tab-button ${id === selectedTab ? "active" : ""}" data-tab="${esc(id)}" type="button">${esc(label)}</button>
  `).join("");
  $("tabs").querySelectorAll("button").forEach((button) => {
    button.addEventListener("click", () => setTab(button.dataset.tab));
  });
}

function badgeClass(state) {
  const raw = String(state || "").toLowerCase();
  if (raw === "ok" || raw === "ready" || raw === "applied" || raw === "loaded") return "fy-badge fy-badge-good";
  if (raw === "warning" || raw === "timedout" || raw === "pending") return "fy-badge fy-badge-warning";
  if (raw === "failed" || raw === "error") return "fy-badge fy-badge-bad";
  return "fy-badge";
}

function renderHub() {
  const latest = status && status.latestCue ? status.latestCue : null;
  $("topMeta").textContent = status ? `${status.cueCount} cues · ${status.warningCount} warnings` : "offline";
  $("serviceBadge").textContent = status && status.ok ? "online" : "offline";
  $("serviceBadge").className = status && status.ok ? "fy-badge fy-badge-good" : "fy-badge fy-badge-bad";
  $("cueCount").textContent = status ? status.cueCount : 0;
  $("warningCount").textContent = status ? status.warningCount : 0;
  $("commandCount").textContent = status ? status.commandCount : commands.length;
  $("warningBadge").textContent = status ? status.warningCount : 0;
  $("latestCue").innerHTML = latest
    ? `<strong>${esc(latest.name || latest.cueId)}</strong><span class="${badgeClass(latest.status && latest.status.state)}">${esc(latest.status && latest.status.state || "queued")}</span><span>${esc(latest.cueId)}</span>`
    : '<span class="fy-small">Geen cue.</span>';

  const targetStatus = status && status.targetStatus ? Object.entries(status.targetStatus) : [];
  const hardwareStatus = status && status.hardware ? Object.entries(status.hardware) : [];
  const hardwareHtml = hardwareStatus.map(([targetId, item]) => `
    <div class="target-item">
      <strong>${esc(targetId)}</strong>
      <span>${esc(item.service || item.url || "")}</span>
      <span class="${item.ok ? "fy-badge fy-badge-good" : "fy-badge fy-badge-bad"}">${item.ok ? "online" : "offline"}</span>
    </div>
  `).join("");
  const targetHtml = targetStatus.length ? targetStatus.map(([targetId, item]) => `
    <div class="target-item">
      <strong>${esc(targetId)}</strong>
      <span>${esc(item.command || "")}</span>
      <span class="${badgeClass(item.state)}">${esc(item.stage || item.state || "")}</span>
    </div>
  `).join("") : "";
  $("targetStatus").innerHTML = hardwareHtml || targetHtml
    ? `${hardwareHtml}${targetHtml}`
    : '<div class="fy-small">Geen hardwarestatus.</div>';

  const warnings = status && Array.isArray(status.warnings) ? status.warnings.slice(-10).reverse() : [];
  const warningHtml = warnings.length ? warnings.map((item) => `
    <div class="log-row">
      <strong>${esc(item.targetId)} · ${esc(item.command)}</strong>
      <span>${esc(item.stage)} · ${esc(item.message)}</span>
    </div>
  `).join("") : '<div class="fy-small">Geen warnings.</div>';
  $("warningList").innerHTML = warningHtml;
  $("warningsFull").innerHTML = warningHtml;
}

function actionPayload(action) {
  try {
    return JSON.stringify(action.payload || {}, null, 2);
  } catch (_err) {
    return "{}";
  }
}

function parsePayload(text) {
  const trimmed = String(text || "").trim();
  if (!trimmed) return {};
  return JSON.parse(trimmed);
}

function renderBuilder() {
  $("builderActions").innerHTML = builderActions.map((action, index) => `
    <div class="action-card" data-index="${index}">
      <div class="action-fields">
        <label class="fy-label">Command
          <select class="fy-select action-command">${commandOptions(action.command)}</select>
        </label>
        <label class="fy-label">Ack
          <select class="fy-select action-ack">
            ${["fire-and-forget", "acknowledged-async", "required-ready"].map((mode) => `<option value="${mode}" ${mode === action.ackMode ? "selected" : ""}>${mode}</option>`).join("")}
          </select>
        </label>
        <label class="fy-label">Delay
          <input class="fy-input action-delay" type="number" min="0" value="${esc(action.delayMs || 0)}">
        </label>
        <label class="fy-label">Timeout
          <input class="fy-input action-timeout" type="number" min="1" value="${esc(action.timeoutMs || 1500)}">
        </label>
        <label class="fy-label">Group
          <input class="fy-input action-group" value="${esc(action.parallelGroup || "")}">
        </label>
      </div>
      <textarea class="fy-textarea action-payload" spellcheck="false">${esc(actionPayload(action))}</textarea>
      <div class="fy-actions fy-actions-end">
        <button class="fy-button fy-button-danger remove-action" type="button">Verwijder</button>
      </div>
    </div>
  `).join("");
  syncBuilderEvents();
  updatePayloadPreview();
}

function syncBuilderFromDom() {
  builderActions = Array.from(document.querySelectorAll(".action-card")).map((card) => ({
    command: card.querySelector(".action-command").value,
    ackMode: card.querySelector(".action-ack").value,
    delayMs: Number(card.querySelector(".action-delay").value || 0),
    timeoutMs: Number(card.querySelector(".action-timeout").value || 1500),
    parallelGroup: card.querySelector(".action-group").value.trim() || null,
    payload: parsePayload(card.querySelector(".action-payload").value),
  }));
}

function updatePayloadPreview() {
  try {
    syncBuilderFromDom();
    $("payloadPreview").value = JSON.stringify({
      name: $("cueNameInput").value,
      actions: builderActions,
    }, null, 2);
    $("payloadBadge").textContent = "JSON";
    $("payloadBadge").className = "fy-badge fy-badge-good";
    $("builderMessage").textContent = "";
    $("builderMessage").classList.remove("error");
  } catch (err) {
    $("payloadBadge").textContent = "invalid";
    $("payloadBadge").className = "fy-badge fy-badge-bad";
    $("builderMessage").textContent = err.message;
    $("builderMessage").classList.add("error");
  }
}

function syncBuilderEvents() {
  document.querySelectorAll(".action-card input, .action-card select, .action-card textarea").forEach((input) => {
    input.addEventListener("input", updatePayloadPreview);
  });
  document.querySelectorAll(".remove-action").forEach((button) => {
    button.addEventListener("click", () => {
      const card = button.closest(".action-card");
      const index = Number(card.dataset.index);
      builderActions.splice(index, 1);
      renderBuilder();
    });
  });
}

function addAction(parallel = false) {
  const group = parallel ? `p${Math.max(1, builderActions.length)}` : "";
  builderActions.push({
    command: parallel && builderActions.length % 2 === 0 ? "sq5.input.mute" : "td.environment.go",
    ackMode: parallel ? "acknowledged-async" : "fire-and-forget",
    delayMs: parallel ? 0 : 20,
    timeoutMs: 900,
    parallelGroup: group,
    payload: parallel
      ? { channel: "brent", muted: false }
      : { environmentId: "prepared" },
  });
  renderBuilder();
}

async function runBuilderCue() {
  updatePayloadPreview();
  const body = JSON.parse($("payloadPreview").value);
  const result = await post("/v0/show-control/cues", body);
  $("builderMessage").textContent = `Cue uitgevoerd: ${result.cue.cueId}`;
  await refresh();
  setTab("logs");
}

function renderLibrary() {
  $("libraryCount").textContent = String(cues.length);
  $("cueLibrary").innerHTML = cues.length ? cues.slice().reverse().map((cue) => `
    <div class="fy-list-item library-row">
      <div>
        <strong>${esc(cue.name || cue.cueId)}</strong>
        <div class="fy-small">${esc(cue.cueId)} · ${esc(cue.status && cue.status.state || "queued")}</div>
      </div>
      <div class="fy-actions">
        <button class="fy-button execute-cue" data-cue-id="${esc(cue.cueId)}" type="button">Run</button>
      </div>
    </div>
  `).join("") : '<div class="fy-small">Geen cues.</div>';
  document.querySelectorAll(".execute-cue").forEach((button) => {
    button.addEventListener("click", async () => {
      await post(`/v0/show-control/cues/${encodeURIComponent(button.dataset.cueId)}/execute`, {});
      await refresh();
    });
  });
}

function renderCommands() {
  const renderCards = (selector, commandList) => {
    const root = document.querySelector(selector);
    if (!root) return;
    root.innerHTML = commandList.map((command) => `
      <div class="command-card">
        <strong>${esc(command.name)}</strong>
        <span>${esc(command.transport)} · ${esc(command.ackMode)}</span>
        <span>${esc(command.request ? `${command.request.method} ${command.request.path}` : command.description || "")}</span>
      </div>
    `).join("");
  };
  renderCards(".runtime-stack", targetCommands("runtime"));
  renderCards('[data-target="touchdesigner"]', targetCommands("touchdesigner"));
  renderCards('[data-target="sq5"]', targetCommands("sq5"));
  renderCards('[data-target="camera"]', targetCommands("camera"));
  renderCards('[data-target="deck"]', targetCommands("deck"));
}

function renderLogs() {
  const latest = status && status.latestCue ? status.latestCue : null;
  $("runtimeOutput").textContent = latest ? JSON.stringify(latest.adapterResult || latest.status || latest, null, 2) : "{}";
  const logRows = latest && Array.isArray(latest.executionLog) ? latest.executionLog.slice().reverse() : [];
  $("executionLog").innerHTML = logRows.length ? logRows.map((item) => `
    <div class="log-row">
      <strong>${esc(item.type)} · ${esc(item.command || item.stepId || "")}</strong>
      <span>${esc(item.targetId || "")} ${esc(item.stage || "")} ${esc(item.state || "")}</span>
    </div>
  `).join("") : '<div class="fy-small">Geen logs.</div>';
}

async function refresh() {
  const [commandData, statusData, cueData] = await Promise.all([
    api("/v0/show-control/commands"),
    api("/v0/show-control/status"),
    api("/v0/show-control/cues"),
  ]);
  commands = commandData.commands || [];
  status = statusData;
  cues = cueData.cues || [];
  renderAll();
}

function renderAll() {
  renderHub();
  renderBuilder();
  renderLibrary();
  renderCommands();
  renderLogs();
}

async function quickStartRun() {
  const result = await post("/v0/show-control/cues/start-run", { autoPrepareNext: true });
  $("runtimeOutput").textContent = JSON.stringify(result.cue, null, 2);
  await refresh();
}

async function quickStartSituation() {
  const result = await post("/v0/show-control/cues/start-situation", {
    actions: [
      { command: "td.environment.go", ackMode: "fire-and-forget", payload: { environmentId: "prepared" }, parallelGroup: "go" },
      { command: "sq5.input.mute", ackMode: "acknowledged-async", payload: { channel: "brent", muted: false }, parallelGroup: "go" },
      { command: "camera.focus", ackMode: "acknowledged-async", payload: { camera: "cam1", normalised: 0.5 }, parallelGroup: "go" },
      { command: "streamdeck.status", ackMode: "fire-and-forget", payload: { button: "start", state: "active" }, parallelGroup: "go" },
    ],
  });
  $("runtimeOutput").textContent = JSON.stringify(result.cue, null, 2);
  await refresh();
}

function initBuilderDefaults() {
  builderActions = [
    {
      command: "runtime.startSituation",
      ackMode: "acknowledged-async",
      delayMs: 0,
      timeoutMs: 1500,
      parallelGroup: "go",
      payload: {},
    },
    {
      command: "td.environment.go",
      ackMode: "fire-and-forget",
      delayMs: 0,
      timeoutMs: 900,
      parallelGroup: "go",
      payload: { environmentId: "prepared" },
    },
    {
      command: "sq5.input.mute",
      ackMode: "acknowledged-async",
      delayMs: 0,
      timeoutMs: 1500,
      parallelGroup: "go",
      payload: { channel: "brent", muted: false },
    },
    {
      command: "camera.focus",
      ackMode: "acknowledged-async",
      delayMs: 0,
      timeoutMs: 1500,
      parallelGroup: "go",
      payload: { camera: "cam1", normalised: 0.5 },
    },
    {
      command: "streamdeck.status",
      ackMode: "fire-and-forget",
      delayMs: 0,
      timeoutMs: 500,
      parallelGroup: "go",
      payload: { button: "start", state: "active" },
    },
  ];
}

function init() {
  renderTabs();
  initBuilderDefaults();
  $("refreshBtn").addEventListener("click", () => refresh().catch(console.error));
  $("addActionBtn").addEventListener("click", () => addAction(false));
  $("addParallelBtn").addEventListener("click", () => addAction(true));
  $("runBuilderBtn").addEventListener("click", () => runBuilderCue().catch((err) => {
    $("builderMessage").textContent = err.message;
    $("builderMessage").classList.add("error");
  }));
  $("cueNameInput").addEventListener("input", updatePayloadPreview);
  $("startRunBtn").addEventListener("click", () => quickStartRun().catch(console.error));
  $("startSituationBtn").addEventListener("click", () => quickStartSituation().catch(console.error));
  refresh().catch((err) => {
    $("topMeta").textContent = err.message;
    $("serviceBadge").textContent = "offline";
    $("serviceBadge").className = "fy-badge fy-badge-bad";
    renderBuilder();
  });
  setInterval(() => refresh().catch(() => undefined), 2500);
}

init();
