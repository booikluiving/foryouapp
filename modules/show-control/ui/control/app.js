"use strict";

const $ = (id) => document.getElementById(id);

const tabs = [
  ["hub", "Cue Hub"],
  ["builder", "Cue Builder"],
  ["library", "Cue Library"],
  ["triggers", "Triggers"],
  ["runtime", "Runtime"],
  ["td", "TouchDesigner"],
  ["audio", "Audio/SQ5"],
  ["cameras", "Cameras"],
  ["deck", "Deck/Cue"],
  ["logs", "Logs"],
];

const humanCommands = [
  "runtime.startRun",
  "runtime.prepareNext",
  "runtime.startSituation",
  "runtime.stopSituation",
  "td.camera.set",
  "td.environment.prepare",
  "td.environment.go",
  "td.phase.set",
  "td.audio.go",
  "td.fx.trigger",
  "td.blackout",
  "sq5.input.mute",
  "sq5.input.level",
  "camera.focus",
  "camera.iris",
  "camera.zoom",
  "streamdeck.status",
  "streamdeck.button",
  "perfectCue.trigger",
  "keyboard.trigger",
  "debug.noop",
];

let commands = [];
let commandMap = new Map();
let status = null;
let cues = [];
let bindings = [];
let builderActions = [];
let currentCueId = null;
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

function commandInfo(name) {
  return commandMap.get(name) || {
    name,
    title: name,
    targetId: "debug",
    ackMode: "fire-and-forget",
    timeoutMs: 900,
  };
}

function defaultAckMode(command) {
  if (command === "td.camera.set" || command === "td.environment.go" || command === "td.fx.trigger" || command === "td.audio.go") return "fire-and-forget";
  if (command.includes(".prepare")) return "required-ready";
  return commandInfo(command).ackMode || "acknowledged-async";
}

function defaultTimeout(command) {
  if (command === "td.camera.set") return 250;
  if (command === "td.environment.go" || command === "td.fx.trigger") return 500;
  if (command.includes(".prepare")) return 2200;
  return commandInfo(command).timeoutMs || 1500;
}

function baseAction(command, payload = {}, overrides = {}) {
  return {
    command,
    ackMode: overrides.ackMode || defaultAckMode(command),
    delayMs: Number(overrides.delayMs || 0),
    timeoutMs: Number(overrides.timeoutMs || defaultTimeout(command)),
    parallelGroup: overrides.parallelGroup || null,
    payload,
  };
}

function actionTitle(action) {
  const payload = action.payload || {};
  if (action.command === "td.camera.set") return `TD camera ${payload.camera || payload.cameraId || "?"}`;
  if (action.command === "runtime.startSituation") return "Start situatie";
  if (action.command === "runtime.stopSituation") return "Stop situatie";
  if (action.command === "runtime.startRun") return "Start run";
  if (action.command === "td.environment.go") return "TD go omgeving";
  if (action.command === "td.environment.prepare") return "TD prepare omgeving";
  if (action.command === "sq5.input.mute") return `Mic ${payload.channel || "?"} ${payload.muted ? "uit" : "aan"}`;
  if (action.command === "streamdeck.status") return `Deck ${payload.button || "status"} ${payload.label || payload.state || ""}`.trim();
  if (action.command === "camera.focus") return `Camera ${payload.camera || "?"} focus`;
  return commandInfo(action.command).title || action.command;
}

function actionSummary(action) {
  const parts = [];
  if (action.parallelGroup) parts.push(`parallel ${action.parallelGroup}`);
  if (Number(action.delayMs || 0) > 0) parts.push(`${action.delayMs} ms delay`);
  parts.push(action.ackMode || defaultAckMode(action.command));
  return parts.join(" · ");
}

function badgeClass(state) {
  const raw = String(state || "").toLowerCase();
  if (["ok", "ready", "applied", "loaded", "saved", "sent"].includes(raw)) return "fy-badge fy-badge-good";
  if (["warning", "timedout", "pending", "running"].includes(raw)) return "fy-badge fy-badge-warning";
  if (["failed", "error"].includes(raw)) return "fy-badge fy-badge-bad";
  return "fy-badge";
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

function commandOptions(selected) {
  const known = humanCommands.filter((name) => commandMap.has(name));
  const fallback = commands.map((command) => command.name).filter((name) => !known.includes(name)).sort();
  return [...known, ...fallback].map((name) => {
    const info = commandInfo(name);
    return `<option value="${esc(name)}" ${name === selected ? "selected" : ""}>${esc(info.title || name)}</option>`;
  }).join("");
}

function fieldValue(action, field, fallback = "") {
  const value = action.payload && action.payload[field] != null ? action.payload[field] : fallback;
  return esc(value);
}

function commandFields(action) {
  const command = action.command;
  if (command === "td.camera.set") {
    return `
      <label class="fy-label">Camera
        <select class="fy-select payload-field" data-field="camera">
          ${["1", "2", "3"].map((camera) => `<option value="${camera}" ${String(action.payload.camera || "") === camera ? "selected" : ""}>Camera ${camera}</option>`).join("")}
        </select>
      </label>
      <label class="fy-label">Knop feedback
        <input class="fy-input payload-field" data-field="button" value="${fieldValue(action, "button", "")}" placeholder="cam-2">
      </label>
    `;
  }
  if (command === "sq5.input.mute") {
    return `
      <label class="fy-label">Kanaal
        <input class="fy-input payload-field" data-field="channel" value="${fieldValue(action, "channel", "brent")}">
      </label>
      <label class="check-row">
        <input class="payload-field" data-field="muted" type="checkbox" ${action.payload.muted ? "checked" : ""}>
        <span>Muted</span>
      </label>
    `;
  }
  if (command === "streamdeck.status" || command === "streamdeck.button") {
    return `
      <label class="fy-label">Knop
        <input class="fy-input payload-field" data-field="button" value="${fieldValue(action, "button", "start-stop")}">
      </label>
      <label class="fy-label">Label
        <input class="fy-input payload-field" data-field="label" value="${fieldValue(action, "label", "")}">
      </label>
      <label class="fy-label">State
        <select class="fy-select payload-field" data-field="state">
          ${["active", "ready", "stop", "warning", "off"].map((stateValue) => `<option value="${stateValue}" ${String(action.payload.state || "") === stateValue ? "selected" : ""}>${stateValue}</option>`).join("")}
        </select>
      </label>
    `;
  }
  if (command === "runtime.startRun") {
    return `
      <label class="check-row">
        <input class="payload-field" data-field="autoPrepareNext" type="checkbox" ${action.payload.autoPrepareNext !== false ? "checked" : ""}>
        <span>Auto prepare next</span>
      </label>
    `;
  }
  if (command === "runtime.startSituation" || command === "runtime.stopSituation") {
    return `
      <label class="fy-label">Show run ID
        <input class="fy-input payload-field" data-field="showRunId" value="${fieldValue(action, "showRunId", "")}" placeholder="leeg = huidige run">
      </label>
    `;
  }
  if (command === "td.environment.prepare" || command === "td.environment.go") {
    return `
      <label class="fy-label">Environment
        <input class="fy-input payload-field" data-field="environmentId" value="${fieldValue(action, "environmentId", "prepared")}">
      </label>
    `;
  }
  if (command === "td.phase.set") {
    return `
      <label class="fy-label">Fase
        <select class="fy-select payload-field" data-field="phase">
          ${["inloop", "wait", "cams"].map((phase) => `<option value="${phase}" ${String(action.payload.phase || "") === phase ? "selected" : ""}>${phase}</option>`).join("")}
        </select>
      </label>
    `;
  }
  if (command === "camera.focus" || command === "camera.iris" || command === "camera.zoom") {
    return `
      <label class="fy-label">Camera
        <input class="fy-input payload-field" data-field="camera" value="${fieldValue(action, "camera", "cam1")}">
      </label>
      <label class="fy-label">Waarde
        <input class="fy-input payload-field" data-field="normalised" type="number" min="0" max="1" step="0.01" value="${fieldValue(action, "normalised", "0.5")}">
      </label>
    `;
  }
  return `
    <details class="payload-details" open>
      <summary>Payload</summary>
      <textarea class="fy-textarea raw-payload" spellcheck="false">${esc(JSON.stringify(action.payload || {}, null, 2))}</textarea>
    </details>
  `;
}

function normalizePayloadValue(input) {
  if (input.type === "checkbox") return input.checked;
  if (input.type === "number") return Number(input.value);
  return input.value;
}

function syncBuilderFromDom() {
  builderActions = Array.from(document.querySelectorAll(".action-card")).map((card) => {
    const command = card.querySelector(".action-command").value;
    let payload = {};
    const rawPayload = card.querySelector(".raw-payload");
    if (rawPayload) {
      payload = rawPayload.value.trim() ? JSON.parse(rawPayload.value) : {};
    } else {
      card.querySelectorAll(".payload-field").forEach((input) => {
        const field = input.dataset.field;
        if (!field) return;
        const value = normalizePayloadValue(input);
        if (value !== "") payload[field] = value;
      });
      if (command === "td.camera.set" && payload.camera) payload.cameraId = `camera:${payload.camera}`;
    }
    return {
      command,
      ackMode: card.querySelector(".action-ack").value,
      delayMs: Number(card.querySelector(".action-delay").value || 0),
      timeoutMs: Number(card.querySelector(".action-timeout").value || defaultTimeout(command)),
      parallelGroup: card.querySelector(".action-group").value.trim() || null,
      payload,
    };
  });
}

function cueBodyFromBuilder() {
  syncBuilderFromDom();
  return {
    name: $("cueNameInput").value.trim() || "Nieuwe cue",
    actions: builderActions,
  };
}

function renderCueSheet(actions = builderActions) {
  $("sheetBadge").textContent = String(actions.length);
  $("cueSheet").innerHTML = actions.length ? actions.map((action, index) => `
    <div class="sheet-row">
      <span>${index + 1}</span>
      <strong>${esc(actionTitle(action))}</strong>
      <em>${esc(actionSummary(action))}</em>
    </div>
  `).join("") : '<div class="fy-small">Geen acties.</div>';
}

function renderBuilder() {
  $("builderCueBadge").textContent = currentCueId ? currentCueId : "nieuw";
  $("builderActions").innerHTML = builderActions.map((action, index) => `
    <div class="action-card" data-index="${index}">
      <div class="action-head">
        <div>
          <strong>${esc(actionTitle(action))}</strong>
          <span>${esc(actionSummary(action))}</span>
        </div>
        <div class="fy-actions fy-actions-end">
          <button class="fy-button move-action" data-dir="-1" type="button" ${index === 0 ? "disabled" : ""}>Omhoog</button>
          <button class="fy-button move-action" data-dir="1" type="button" ${index === builderActions.length - 1 ? "disabled" : ""}>Omlaag</button>
          <button class="fy-button fy-button-danger remove-action" type="button">Verwijder</button>
        </div>
      </div>
      <div class="action-fields human-fields">
        <label class="fy-label wide">Actie
          <select class="fy-select action-command">${commandOptions(action.command)}</select>
        </label>
        <label class="fy-label">Ack
          <select class="fy-select action-ack">
            ${["fire-and-forget", "acknowledged-async", "required-ready"].map((mode) => `<option value="${mode}" ${mode === action.ackMode ? "selected" : ""}>${mode}</option>`).join("")}
          </select>
        </label>
        <label class="fy-label">Delay ms
          <input class="fy-input action-delay" type="number" min="0" value="${esc(action.delayMs || 0)}">
        </label>
        <label class="fy-label">Timeout
          <input class="fy-input action-timeout" type="number" min="1" value="${esc(action.timeoutMs || defaultTimeout(action.command))}">
        </label>
        <label class="fy-label">Groep
          <input class="fy-input action-group" value="${esc(action.parallelGroup || "")}">
        </label>
      </div>
      <div class="payload-grid">${commandFields(action)}</div>
    </div>
  `).join("");
  bindBuilderEvents();
  renderCueSheet();
}

function setBuilderMessage(text, kind = "") {
  $("builderMessage").textContent = text;
  $("builderMessage").className = `message ${kind}`.trim();
}

function bindBuilderEvents() {
  document.querySelectorAll(".action-card input, .action-card select, .action-card textarea").forEach((input) => {
    input.addEventListener("input", () => {
      try {
        syncBuilderFromDom();
        renderCueSheet();
        setBuilderMessage("");
      } catch (err) {
        setBuilderMessage(err.message, "error");
      }
    });
  });
  document.querySelectorAll(".action-command").forEach((select) => {
    select.addEventListener("change", () => {
      const index = Number(select.closest(".action-card").dataset.index);
      const command = select.value;
      builderActions[index] = baseAction(command, defaultPayload(command), {
        ackMode: defaultAckMode(command),
        timeoutMs: defaultTimeout(command),
      });
      renderBuilder();
    });
  });
  document.querySelectorAll(".remove-action").forEach((button) => {
    button.addEventListener("click", () => {
      const index = Number(button.closest(".action-card").dataset.index);
      builderActions.splice(index, 1);
      renderBuilder();
    });
  });
  document.querySelectorAll(".move-action").forEach((button) => {
    button.addEventListener("click", () => {
      const index = Number(button.closest(".action-card").dataset.index);
      const next = index + Number(button.dataset.dir);
      if (next < 0 || next >= builderActions.length) return;
      const item = builderActions[index];
      builderActions[index] = builderActions[next];
      builderActions[next] = item;
      renderBuilder();
    });
  });
}

function defaultPayload(command) {
  if (command === "runtime.startRun") return { autoPrepareNext: true };
  if (command === "td.camera.set") return { camera: "2", cameraId: "camera:2" };
  if (command === "td.environment.prepare" || command === "td.environment.go") return { environmentId: "prepared" };
  if (command === "td.phase.set") return { phase: "cams" };
  if (command === "sq5.input.mute") return { channel: "brent", muted: false };
  if (command === "sq5.input.level") return { channel: "brent", db: 0 };
  if (command === "camera.focus" || command === "camera.iris" || command === "camera.zoom") return { camera: "cam1", normalised: 0.5 };
  if (command === "streamdeck.status" || command === "streamdeck.button") return { button: "start-stop", state: "active", label: "STOP" };
  if (command === "perfectCue.trigger") return { key: "Space" };
  if (command === "keyboard.trigger") return { key: "Space" };
  return {};
}

function loadTemplate(name) {
  currentCueId = null;
  if (name === "camera2") {
    $("cueNameInput").value = "Stream Deck camera 2";
    $("bindingButtonInput").value = "cam-2";
    $("bindingPageInput").value = "camera";
    $("bindingLabelInput").value = "CAM 2";
    builderActions = [
      baseAction("td.camera.set", { camera: "2", cameraId: "camera:2" }, { ackMode: "fire-and-forget", timeoutMs: 250 }),
      baseAction("streamdeck.status", { button: "cam-2", state: "active", label: "CAM 2" }, { ackMode: "fire-and-forget", timeoutMs: 300, delayMs: 5 }),
    ];
  } else if (name === "startStop") {
    $("cueNameInput").value = "Start situatie";
    $("bindingButtonInput").value = "start-stop";
    $("bindingPageInput").value = "runtime";
    $("bindingLabelInput").value = "START/STOP";
    builderActions = [
      baseAction("runtime.startSituation", {}, { ackMode: "acknowledged-async", timeoutMs: 1800, parallelGroup: "go" }),
      baseAction("td.environment.go", { environmentId: "prepared" }, { ackMode: "fire-and-forget", timeoutMs: 500, parallelGroup: "go" }),
      baseAction("streamdeck.status", { button: "start-stop", state: "stop", label: "STOP" }, { ackMode: "fire-and-forget", timeoutMs: 300, parallelGroup: "go" }),
    ];
  } else if (name === "tdGo") {
    $("cueNameInput").value = "TD go";
    builderActions = [baseAction("td.environment.go", { environmentId: "prepared" }, { ackMode: "fire-and-forget", timeoutMs: 500 })];
  } else if (name === "sq5Mic") {
    $("cueNameInput").value = "Mic brent aan";
    builderActions = [baseAction("sq5.input.mute", { channel: "brent", muted: false }, { ackMode: "acknowledged-async", timeoutMs: 800 })];
  } else if (name === "streamDeckStatus") {
    $("cueNameInput").value = "Deck feedback";
    builderActions = [baseAction("streamdeck.status", { button: "start-stop", state: "active", label: "ACTIVE" }, { ackMode: "fire-and-forget", timeoutMs: 300 })];
  }
  renderBuilder();
}

function addAction(parallel = false) {
  const group = parallel ? `p${Math.max(1, builderActions.length)}` : "";
  builderActions.push(baseAction("td.camera.set", { camera: "2", cameraId: "camera:2" }, {
    ackMode: "fire-and-forget",
    timeoutMs: 250,
    parallelGroup: group,
  }));
  renderBuilder();
}

function editCue(cue, duplicate = false) {
  currentCueId = duplicate ? null : cue.cueId;
  $("cueNameInput").value = duplicate ? `${cue.name || cue.cueId} kopie` : (cue.name || cue.cueId);
  builderActions = (cue.actions || []).map((action) => ({
    command: action.command,
    ackMode: action.ackMode || defaultAckMode(action.command),
    delayMs: Number(action.delayMs || 0),
    timeoutMs: Number(action.timeoutMs || defaultTimeout(action.command)),
    parallelGroup: action.parallelGroup || null,
    payload: action.payload || {},
  }));
  renderBuilder();
  setTab("builder");
}

async function saveCurrentCue() {
  const result = await post("/v0/show-control/cues/save", cueBodyFromBuilder());
  currentCueId = result.cue.cueId;
  setBuilderMessage(`Opgeslagen: ${result.cue.cueId}`);
  await refresh({ keepBuilder: true });
  return result.cue;
}

async function dryRunCue() {
  const result = await post("/v0/show-control/cues/dry-run", cueBodyFromBuilder());
  $("debugOutput").textContent = JSON.stringify(result.cue, null, 2);
  setBuilderMessage(`Dry run ok: ${result.cue.actions.length} acties`);
  renderCueSheet(result.cue.actions || builderActions);
}

async function fireLiveCue() {
  const result = await post("/v0/show-control/cues", cueBodyFromBuilder());
  currentCueId = result.cue.cueId;
  $("debugOutput").textContent = JSON.stringify(result.cue, null, 2);
  setBuilderMessage(`Live gefuurd: ${result.cue.cueId}`);
  await refresh({ keepBuilder: true });
  setTab("logs");
}

async function saveBindingForCurrentCue() {
  let cueId = currentCueId;
  if (!cueId) {
    const cue = await saveCurrentCue();
    cueId = cue.cueId;
  }
  const binding = await post("/v0/show-control/trigger-bindings", {
    source: "streamdeck",
    triggerId: $("bindingButtonInput").value.trim(),
    cueId,
    page: $("bindingPageInput").value.trim(),
    label: $("bindingLabelInput").value.trim(),
  });
  $("bindingBadge").textContent = binding.binding.triggerId;
  setBuilderMessage(`Stream Deck gekoppeld: ${binding.binding.triggerId}`);
  await refresh({ keepBuilder: true });
}

function renderHub() {
  const latest = status && status.latestCue ? status.latestCue : null;
  $("topMeta").textContent = status ? `${status.cueCount} cues · ${status.bindingCount || 0} bindings · ${status.warningCount} warnings` : "offline";
  $("serviceBadge").textContent = status && status.ok ? "online" : "offline";
  $("serviceBadge").className = status && status.ok ? "fy-badge fy-badge-good" : "fy-badge fy-badge-bad";
  $("cueCount").textContent = status ? status.cueCount : 0;
  $("bindingCount").textContent = status ? status.bindingCount || bindings.length : bindings.length;
  $("warningCount").textContent = status ? status.warningCount : 0;
  $("warningBadge").textContent = status ? status.warningCount : 0;
  $("latestCue").innerHTML = latest
    ? `<strong>${esc(latest.name || latest.cueId)}</strong><span class="${badgeClass(latest.status && latest.status.state)}">${esc(latest.status && latest.status.state || "queued")}</span><span>${esc(latest.cueId)}</span>`
    : '<span class="fy-small">Geen cue.</span>';

  const hardwareStatus = status && status.hardware ? Object.entries(status.hardware) : [];
  $("targetStatus").innerHTML = hardwareStatus.length ? hardwareStatus.map(([targetId, item]) => `
    <div class="target-item">
      <strong>${esc(targetId)}</strong>
      <span>${esc(item.service || item.url || "")}</span>
      <span class="${item.ok ? "fy-badge fy-badge-good" : "fy-badge fy-badge-bad"}">${item.ok ? "online" : "offline"}</span>
    </div>
  `).join("") : '<div class="fy-small">Geen hardwarestatus.</div>';

  const warnings = status && Array.isArray(status.warnings) ? status.warnings.slice(-10).reverse() : [];
  $("warningList").innerHTML = warnings.length ? warnings.map((item) => `
    <div class="log-row">
      <strong>${esc(actionTitle(item))}</strong>
      <span>${esc(item.stage)} · ${esc(item.message)}</span>
    </div>
  `).join("") : '<div class="fy-small">Geen warnings.</div>';
}

function renderLibrary() {
  $("libraryCount").textContent = String(cues.length);
  $("cueLibrary").innerHTML = cues.length ? cues.slice().reverse().map((cue) => `
    <div class="fy-list-item library-row">
      <div>
        <strong>${esc(cue.name || cue.cueId)}</strong>
        <div class="fy-small">${esc(cue.cueId)} · ${esc(cue.status && cue.status.state || "queued")} · ${(cue.actions || []).length} acties</div>
        <div class="mini-sheet">
          ${(cue.actions || []).slice(0, 4).map((action, index) => `<span>${index + 1}. ${esc(actionTitle(action))}</span>`).join("")}
        </div>
      </div>
      <div class="fy-actions">
        <button class="fy-button edit-cue" data-cue-id="${esc(cue.cueId)}" type="button">Edit</button>
        <button class="fy-button duplicate-cue" data-cue-id="${esc(cue.cueId)}" type="button">Dupliceer</button>
        <button class="fy-button fy-button-primary execute-cue" data-cue-id="${esc(cue.cueId)}" type="button">Fire</button>
      </div>
    </div>
  `).join("") : '<div class="fy-small">Geen cues.</div>';
  document.querySelectorAll(".execute-cue").forEach((button) => {
    button.addEventListener("click", async () => {
      await post(`/v0/show-control/cues/${encodeURIComponent(button.dataset.cueId)}/execute`, { nonBlocking: true });
      await refresh();
      setTab("logs");
    });
  });
  document.querySelectorAll(".edit-cue").forEach((button) => {
    button.addEventListener("click", () => editCue(cues.find((cue) => cue.cueId === button.dataset.cueId), false));
  });
  document.querySelectorAll(".duplicate-cue").forEach((button) => {
    button.addEventListener("click", () => editCue(cues.find((cue) => cue.cueId === button.dataset.cueId), true));
  });
}

function renderBindings() {
  $("triggerCount").textContent = String(bindings.length);
  $("triggerBindings").innerHTML = bindings.length ? bindings.map((binding) => {
    const cue = cues.find((item) => item.cueId === binding.cueId);
    return `
      <div class="fy-list-item library-row">
        <div>
          <strong>${esc(binding.source)} · ${esc(binding.triggerId)}</strong>
          <div class="fy-small">${esc(binding.page || "geen pagina")} · ${esc(binding.label || "")}</div>
          <div class="fy-small">${esc(cue ? cue.name || cue.cueId : binding.cueId)}</div>
        </div>
        <div class="fy-actions">
          <button class="fy-button test-trigger" data-source="${esc(binding.source)}" data-trigger-id="${esc(binding.triggerId)}" type="button">Test trigger</button>
        </div>
      </div>
    `;
  }).join("") : '<div class="fy-small">Geen bindings.</div>';
  document.querySelectorAll(".test-trigger").forEach((button) => {
    button.addEventListener("click", async () => {
      const result = await post("/v0/show-control/triggers/fire", {
        source: button.dataset.source,
        triggerId: button.dataset.triggerId,
        nonBlocking: true,
      });
      $("debugOutput").textContent = JSON.stringify(result, null, 2);
      await refresh();
      setTab("logs");
    });
  });
}

function targetCommands(target) {
  if (target === "deck") return commands.filter((command) => ["streamdeck", "perfectcue", "keyboard"].includes(command.targetId));
  return commands.filter((command) => command.targetId === target);
}

function renderCommands() {
  const renderCards = (selector, commandList) => {
    const root = document.querySelector(selector);
    if (!root) return;
    root.innerHTML = commandList.map((command) => `
      <div class="command-card">
        <strong>${esc(command.title || command.name)}</strong>
        <span>${esc(command.name)}</span>
        <span>${esc(command.transport)} · ${esc(command.ackMode)}</span>
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
  const logRows = latest && Array.isArray(latest.executionLog) ? latest.executionLog.slice().reverse() : [];
  $("executionLog").innerHTML = logRows.length ? logRows.map((item) => `
    <div class="log-row">
      <strong>${esc(item.type)} · ${esc(item.command || item.stepId || "")}</strong>
      <span>${esc(item.targetId || "")} ${esc(item.stage || "")} ${esc(item.state || "")}</span>
    </div>
  `).join("") : '<div class="fy-small">Geen logs.</div>';
  $("runtimeOutput").textContent = latest ? JSON.stringify(latest.adapterResult || latest.status || latest, null, 2) : "{}";
  $("debugOutput").textContent = latest ? JSON.stringify(latest, null, 2) : "{}";
}

async function refresh(options = {}) {
  const [commandData, statusData, cueData, bindingData] = await Promise.all([
    api("/v0/show-control/commands"),
    api("/v0/show-control/status"),
    api("/v0/show-control/cues"),
    api("/v0/show-control/trigger-bindings"),
  ]);
  commands = commandData.commands || [];
  commandMap = new Map(commands.map((command) => [command.name, command]));
  status = statusData;
  cues = cueData.cues || [];
  bindings = bindingData.bindings || [];
  renderAll(options);
}

function renderAll(options = {}) {
  renderHub();
  if (!options.skipBuilder) renderBuilder();
  renderLibrary();
  renderBindings();
  renderCommands();
  renderLogs();
}

async function quickStartRun() {
  const result = await post("/v0/show-control/cues/start-run", { autoPrepareNext: true });
  $("debugOutput").textContent = JSON.stringify(result.cue, null, 2);
  await refresh();
}

async function quickStartSituation() {
  loadTemplate("startStop");
  await fireLiveCue();
}

function initBuilderDefaults() {
  loadTemplate("camera2");
}

function init() {
  renderTabs();
  initBuilderDefaults();
  $("refreshBtn").addEventListener("click", () => refresh({ keepBuilder: true }).catch(console.error));
  $("addActionBtn").addEventListener("click", () => addAction(false));
  $("addParallelBtn").addEventListener("click", () => addAction(true));
  $("clearBuilderBtn").addEventListener("click", () => {
    currentCueId = null;
    builderActions = [];
    renderBuilder();
  });
  $("dryRunBtn").addEventListener("click", () => dryRunCue().catch((err) => setBuilderMessage(err.message, "error")));
  $("saveCueBtn").addEventListener("click", () => saveCurrentCue().catch((err) => setBuilderMessage(err.message, "error")));
  $("runBuilderBtn").addEventListener("click", () => fireLiveCue().catch((err) => setBuilderMessage(err.message, "error")));
  $("saveBindingBtn").addEventListener("click", () => saveBindingForCurrentCue().catch((err) => setBuilderMessage(err.message, "error")));
  $("cueNameInput").addEventListener("input", () => {
    currentCueId = null;
    renderCueSheet();
  });
  document.querySelectorAll(".template-button").forEach((button) => {
    button.addEventListener("click", () => loadTemplate(button.dataset.template));
  });
  $("startRunBtn").addEventListener("click", () => quickStartRun().catch(console.error));
  $("startSituationBtn").addEventListener("click", () => quickStartSituation().catch(console.error));
  refresh({ skipBuilder: false }).catch((err) => {
    $("topMeta").textContent = err.message;
    $("serviceBadge").textContent = "offline";
    $("serviceBadge").className = "fy-badge fy-badge-bad";
    renderBuilder();
  });
  setInterval(() => refresh({ skipBuilder: true }).catch(() => undefined), 2500);
}

init();
