const cameraGrid = document.getElementById("cameraGrid");
const cameraTemplate = document.getElementById("cameraTemplate");
const activityLog = document.getElementById("activityLog");
const serverStatus = document.getElementById("serverStatus");
const syncButton = document.getElementById("syncButton");
const fineMode = document.getElementById("fineMode");

const cameraCards = new Map();
const controlTimers = new Map();
const colorTabs = new Map();
let appState = null;
let socket = null;

connectSocket();

syncButton.addEventListener("click", async () => {
  syncButton.disabled = true;
  try {
    await fetchJson("/api/sync", { method: "POST" });
  } finally {
    syncButton.disabled = false;
  }
});

fineMode.addEventListener("change", () => {
  for (const card of cameraCards.values()) {
    for (const input of card.node.querySelectorAll('input[type="range"]')) {
      const max = Number(input.max || 1);
      input.step = fineMode.checked ? String(max <= 1 ? 0.0002 : 0.0005) : "0.001";
    }
  }
});

function connectSocket() {
  const protocol = location.protocol === "https:" ? "wss:" : "ws:";
  socket = new WebSocket(`${protocol}//${location.host}/ws${location.search || ""}`);
  socket.addEventListener("open", () => setServerStatus("ok", "connected"));
  socket.addEventListener("close", () => {
    setServerStatus("bad", "offline");
    setTimeout(connectSocket, 1000);
  });
  socket.addEventListener("error", () => setServerStatus("bad", "error"));
  socket.addEventListener("message", (event) => {
    const message = JSON.parse(event.data);
    if (message.type === "state") {
      appState = message.state;
      renderState();
    }
  });
}

function renderState() {
  const cameras = appState.cameras || {};
  for (const camera of Object.values(cameras)) {
    renderCamera(camera);
  }
  renderActivity(appState.activity || []);
}

function renderCamera(camera) {
  let card = cameraCards.get(camera.id);
  if (!card) {
    card = createCameraCard(camera);
    cameraCards.set(camera.id, card);
    cameraGrid.appendChild(card.node);
  }

  card.fields.label.textContent = camera.label;
  card.fields.host.textContent = camera.host;
  card.fields.tally.textContent = camera.tally || "none";
  card.fields.tally.className = `tally ${camera.tally || "none"}`;
  for (const button of card.tallyButtons) {
    button.classList.toggle("active", button.dataset.tally === (camera.tally || "none"));
  }
  setPill(card.fields.online, camera.online ? "ok" : "bad", camera.online ? "online" : "offline");
  setPill(card.fields.rest, camera.restOk ? "ok" : "bad", camera.restOk ? "REST ok" : "REST bad");
  setPill(card.fields.ws, camera.wsStatus === "open" ? "ok" : "warn", `WS ${camera.wsStatus || "idle"}`);
  card.fields.updated.textContent = camera.lastUpdateAt ? `updated ${formatTime(camera.lastUpdateAt)}` : "waiting for camera state";
  card.fields.error.textContent = camera.lastError || "";

  renderPreview(card.fields.preview, camera);
  renderLens(card, camera);
  renderContrast(card, camera);
  renderColor(card, camera);
}

function createCameraCard(camera) {
  const node = cameraTemplate.content.firstElementChild.cloneNode(true);
  const fields = {};
  for (const element of node.querySelectorAll("[data-field]")) {
    fields[element.dataset.field] = element;
  }
  const controls = {};
  for (const input of node.querySelectorAll("[data-control]")) {
    controls[input.dataset.control] = input;
    input.addEventListener("input", () => handleLensOrContrastInput(camera.id, input.dataset.control, input));
  }
  const outputs = {};
  for (const output of node.querySelectorAll("[data-output]")) {
    outputs[output.dataset.output] = output;
  }
  const colorButtons = Array.from(node.querySelectorAll("[data-color-tab]"));
  const tallyButtons = Array.from(node.querySelectorAll("[data-tally]"));
  const colorInputs = {};
  const colorOutputs = {};
  for (const input of node.querySelectorAll("[data-color-component]")) {
    colorInputs[input.dataset.colorComponent] = input;
    input.addEventListener("input", () => handleColorInput(camera.id, input.dataset.colorComponent, input));
  }
  for (const output of node.querySelectorAll("[data-color-output]")) {
    colorOutputs[output.dataset.colorOutput] = output;
  }
  colorTabs.set(camera.id, "lift");
  for (const button of colorButtons) {
    button.addEventListener("click", () => {
      colorTabs.set(camera.id, button.dataset.colorTab);
      renderState();
    });
  }
  for (const button of tallyButtons) {
    button.addEventListener("click", () => setTally(camera.id, button.dataset.tally));
  }
  return { node, fields, controls, outputs, colorButtons, tallyButtons, colorInputs, colorOutputs };
}

function renderPreview(container, camera) {
  if (container.dataset.renderedFor === camera.previewUrl) return;
  container.dataset.renderedFor = camera.previewUrl || "";
  container.innerHTML = "";
  if (!camera.previewUrl) {
    container.textContent = "No preview source configured";
    return;
  }
  const iframe = document.createElement("iframe");
  iframe.src = camera.previewUrl;
  iframe.title = `${camera.label} preview`;
  iframe.allow = "autoplay; fullscreen";
  container.appendChild(iframe);
}

function renderLens(card, camera) {
  const focus = camera.properties["/lens/focus"] || {};
  const iris = camera.properties["/lens/iris"] || {};
  const zoom = camera.properties["/lens/zoom"] || {};
  setRange(card.controls.focus, card.outputs.focus, focus.normalised, 0, 1);
  setRange(card.controls.iris, card.outputs.iris, iris.normalised, 0, 1);
  setRange(card.controls.zoom, card.outputs.zoom, zoom.normalised, 0, 1);
  const irisLabel = Number.isFinite(iris.apertureStop) ? `T${Number(iris.apertureStop).toFixed(1)}` : "iris";
  const zoomLabel = Number.isFinite(zoom.focalLength) ? `${zoom.focalLength}mm` : "zoom";
  card.fields.lensReadout.textContent = `${irisLabel} · ${zoomLabel}`;
}

function renderContrast(card, camera) {
  const contrast = camera.properties["/colorCorrection/contrast"] || {};
  setRange(card.controls["contrast-pivot"], card.outputs["contrast-pivot"], contrast.pivot, 0.5, 1);
  setRange(card.controls["contrast-adjust"], card.outputs["contrast-adjust"], contrast.adjust, 1, 2);
}

function renderColor(card, camera) {
  const active = colorTabs.get(camera.id) || "lift";
  for (const button of card.colorButtons) {
    button.classList.toggle("active", button.dataset.colorTab === active);
  }
  const values = camera.properties[`/colorCorrection/${active}`] || {};
  for (const key of ["luma", "red", "green", "blue"]) {
    setRange(card.colorInputs[key], card.colorOutputs[key], values[key], 0, 4);
  }
}

function handleLensOrContrastInput(cameraId, control, input) {
  const value = Number(input.value);
  if (control === "focus" || control === "iris" || control === "zoom") {
    scheduleControl(`${cameraId}:${control}`, `/api/camera/${cameraId}/${control}`, { normalised: value });
    return;
  }
  const camera = appState.cameras[cameraId];
  const current = camera.properties["/colorCorrection/contrast"] || {};
  const body = {
    pivot: control === "contrast-pivot" ? value : current.pivot,
    adjust: control === "contrast-adjust" ? value : current.adjust,
  };
  scheduleControl(`${cameraId}:contrast`, `/api/camera/${cameraId}/contrast`, body);
}

function handleColorInput(cameraId, component, input) {
  const active = colorTabs.get(cameraId) || "lift";
  const camera = appState.cameras[cameraId];
  const current = camera.properties[`/colorCorrection/${active}`] || {};
  scheduleControl(`${cameraId}:color:${active}`, `/api/camera/${cameraId}/color/${active}`, {
    ...current,
    [component]: Number(input.value),
  });
}

function scheduleControl(key, url, body) {
  clearTimeout(controlTimers.get(key));
  controlTimers.set(key, setTimeout(async () => {
    try {
      await fetchJson(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
    } catch (error) {
      console.warn(error);
    }
  }, fineMode.checked ? 130 : 80));
}

async function setTally(cameraId, tallyState) {
  try {
    await fetchJson("/api/tally", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ camera: cameraId, state: tallyState }),
    });
  } catch (error) {
    console.warn(error);
  }
}

async function fetchJson(url, options) {
  const response = await fetch(url, options);
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.ok === false) {
    throw new Error(data.error || `HTTP ${response.status}`);
  }
  return data;
}

function setRange(input, output, rawValue, fallback, max) {
  const value = Number.isFinite(Number(rawValue)) ? Number(rawValue) : fallback;
  if (document.activeElement !== input) input.value = String(value);
  output.textContent = formatNumber(value, max <= 1 ? 3 : 2);
}

function setPill(element, status, text) {
  element.className = `pill ${status}`;
  element.textContent = text;
}

function setServerStatus(status, text) {
  serverStatus.className = `pill ${status}`;
  serverStatus.textContent = text;
}

function renderActivity(items) {
  activityLog.innerHTML = "";
  for (const item of items.slice(-40).reverse()) {
    const node = document.createElement("div");
    node.className = `activity-item ${item.level === "error" ? "error" : ""}`;
    node.innerHTML = `
      <div class="activity-meta">
        <span>${escapeHtml(item.scope || "system")}</span>
        <span>${escapeHtml(formatTime(item.at))}</span>
      </div>
      <div class="activity-message">${escapeHtml(item.message || "")}</div>
    `;
    activityLog.appendChild(node);
  }
}

function formatNumber(value, digits) {
  return Number(value || 0).toFixed(digits);
}

function formatTime(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
