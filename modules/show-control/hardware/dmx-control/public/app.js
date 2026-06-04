"use strict";

const $ = (id) => document.getElementById(id);
const rawInputs = new Map();

let state = null;
let live = false;
let effectTimer = null;
let liveDebounce = null;
let wheelImageData = null;
let wheelPointerDown = false;
let activeFixtureIndex = 0;

const fixtures = [
  createFixture("Lamp 1", 1, "hsi", true),
  createFixture("Lamp 2", 11, "hsi", true),
  createFixture("Lamp 3", 21, "hsi", true),
  createFixture("Lamp 4", 31, "hsi", false),
  createFixture("Lamp 5", 41, "hsi", false),
  createFixture("Lamp 6", 51, "rgb", false),
  createFixture("Lamp 7", 61, "rgb", false),
  createFixture("Lamp 8", 71, "cct", false),
  createFixture("Lamp 9", 81, "hsi", false),
];

function createFixture(name, address, profile, enabled) {
  return {
    name,
    address,
    profile,
    enabled,
    values: {
      hsi: { hue: 0, saturation: 0, intensity: 220 },
      cct: { intensity: 255, temp: 128, gm: 128 },
      rgb: { red: 255, green: 79, blue: 61, brightness: 255 },
      raw: {},
    },
  };
}

function esc(value) {
  return String(value == null ? "" : value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function clamp(value, min = 0, max = 255) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return min;
  return Math.max(min, Math.min(max, parsed));
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
  if (!response.ok) throw new Error(body.error || body.message || `${pathname} ${response.status}`);
  return body;
}

function post(pathname, body = {}) {
  return api(pathname, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function configBody() {
  return {
    targetIp: $("targetIpInput").value.trim(),
    universe: clamp($("universeInput").value, 0, 32767),
    frameRate: clamp($("frameRateInput").value, 1, 44),
  };
}

function startAddress() {
  return clamp($("addressInput").value, 1, 512);
}

function activeFixture() {
  return fixtures[activeFixtureIndex] || fixtures[0];
}

function hueOffset() {
  return clamp($("hueOffsetInput").value, -180, 180);
}

function correctedHue(hue) {
  return ((clamp(hue, 0, 360) + hueOffset()) % 360 + 360) % 360;
}

function hueToDmx(hue) {
  return Math.round((correctedHue(hue) / 360) * 255);
}

function setMessage(text, isError = false) {
  $("statusLine").textContent = text;
  $("activeBadge").className = isError ? "badge bad" : state && state.active ? "badge good" : "badge";
}

function logBody(body) {
  $("logOutput").textContent = JSON.stringify(body, null, 2);
}

function scaled(value, brightness) {
  return Math.round(clamp(value) * (clamp(brightness) / 255));
}

function rgbFromHex(hex) {
  const raw = String(hex || "#000000").replace("#", "");
  return {
    red: Number.parseInt(raw.slice(0, 2), 16) || 0,
    green: Number.parseInt(raw.slice(2, 4), 16) || 0,
    blue: Number.parseInt(raw.slice(4, 6), 16) || 0,
  };
}

function hexFromRgb(red, green, blue) {
  return `#${[red, green, blue].map((value) => clamp(value).toString(16).padStart(2, "0")).join("")}`;
}

function hsvToRgb(hue, saturation, value) {
  const h = ((Number(hue) % 360) + 360) % 360;
  const s = Math.max(0, Math.min(1, Number(saturation) / 255));
  const v = Math.max(0, Math.min(1, Number(value) / 255));
  const c = v * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = v - c;
  let r = 0;
  let g = 0;
  let b = 0;
  if (h < 60) [r, g, b] = [c, x, 0];
  else if (h < 120) [r, g, b] = [x, c, 0];
  else if (h < 180) [r, g, b] = [0, c, x];
  else if (h < 240) [r, g, b] = [0, x, c];
  else if (h < 300) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];
  return {
    red: Math.round((r + m) * 255),
    green: Math.round((g + m) * 255),
    blue: Math.round((b + m) * 255),
  };
}

function rgbToHsv(red, green, blue) {
  const r = clamp(red) / 255;
  const g = clamp(green) / 255;
  const b = clamp(blue) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const delta = max - min;
  let hue = 0;
  if (delta !== 0) {
    if (max === r) hue = 60 * (((g - b) / delta) % 6);
    else if (max === g) hue = 60 * ((b - r) / delta + 2);
    else hue = 60 * ((r - g) / delta + 4);
  }
  if (hue < 0) hue += 360;
  return {
    hue: Math.round(hue),
    saturation: max === 0 ? 0 : Math.round((delta / max) * 255),
    intensity: Math.round(max * 255),
  };
}

function hsiPreviewRgb() {
  return hsvToRgb($("hueInput").value, $("saturationInput").value, 255);
}

function readCurrentValues(profile = $("fixtureModeInput").value) {
  if (profile === "cct") {
    return {
      intensity: clamp($("cctIntensityInput").value),
      temp: clamp($("cctTempInput").value),
      gm: clamp($("cctGmInput").value),
    };
  }
  if (profile === "rgb") {
    return {
      red: clamp($("redInput").value),
      green: clamp($("greenInput").value),
      blue: clamp($("blueInput").value),
      brightness: clamp($("rgbBrightnessInput").value),
    };
  }
  if (profile === "hsi") {
    return {
      hue: clamp($("hueInput").value, 0, 360),
      saturation: clamp($("saturationInput").value),
      intensity: clamp($("hsiIntensityInput").value),
    };
  }
  return rawChannels();
}

function saveActiveFixtureFromControls() {
  const fixture = activeFixture();
  const profile = $("fixtureModeInput").value;
  fixture.address = startAddress();
  fixture.profile = profile;
  fixture.values[profile] = readCurrentValues(profile);
}

function applyFixtureToControls(index = activeFixtureIndex) {
  const fixture = fixtures[index] || fixtures[0];
  $("activeFixtureInput").value = String(index);
  $("addressInput").value = String(fixture.address);
  $("fixtureModeInput").value = fixture.profile;
  const cct = fixture.values.cct;
  setCctValues(cct.intensity, cct.temp, cct.gm);
  const rgb = fixture.values.rgb;
  setRgbValues(rgb.red, rgb.green, rgb.blue, rgb.brightness);
  const hsi = fixture.values.hsi;
  setHsiValues(hsi.hue, hsi.saturation, hsi.intensity);
  clearRaw();
  for (const [channel, value] of Object.entries(fixture.values.raw || {})) {
    const controls = rawInputs.get(String(channel));
    if (!controls) continue;
    controls.range.value = String(clamp(value));
    controls.number.value = String(clamp(value));
  }
  renderModePanels();
  renderFixtureGrid();
}

function cctChannels() {
  const address = startAddress();
  return {
    [address]: clamp($("cctIntensityInput").value),
    [address + 1]: clamp($("cctTempInput").value),
    [address + 2]: clamp($("cctGmInput").value),
  };
}

function rgbChannels() {
  const address = startAddress();
  const brightness = clamp($("rgbBrightnessInput").value);
  return {
    [address]: scaled($("redInput").value, brightness),
    [address + 1]: scaled($("greenInput").value, brightness),
    [address + 2]: scaled($("blueInput").value, brightness),
  };
}

function hsiChannels() {
  const address = startAddress();
  return {
    [address]: clamp($("hsiIntensityInput").value),
    [address + 1]: hueToDmx($("hueInput").value),
    [address + 2]: clamp($("saturationInput").value),
  };
}

function rawChannels() {
  const channels = {};
  for (const [channel, controls] of rawInputs.entries()) {
    const value = clamp(controls.number.value);
    if (value > 0) channels[channel] = value;
  }
  return channels;
}

function channelsForFixture(fixture) {
  const address = clamp(fixture.address, 1, 512);
  const profile = fixture.profile;
  if (profile === "cct") {
    const values = fixture.values.cct;
    return {
      [address]: clamp(values.intensity),
      [address + 1]: clamp(values.temp),
      [address + 2]: clamp(values.gm),
    };
  }
  if (profile === "rgb") {
    const values = fixture.values.rgb;
    return {
      [address]: scaled(values.red, values.brightness),
      [address + 1]: scaled(values.green, values.brightness),
      [address + 2]: scaled(values.blue, values.brightness),
    };
  }
  if (profile === "hsi") {
    const values = fixture.values.hsi;
    return {
      [address]: clamp(values.intensity),
      [address + 1]: hueToDmx(values.hue),
      [address + 2]: clamp(values.saturation),
    };
  }
  const channels = {};
  for (const [channel, value] of Object.entries(fixture.values.raw || {})) {
    channels[channel] = clamp(value);
  }
  return channels;
}

function combineFixtureChannels() {
  const channels = {};
  for (const fixture of fixtures) {
    if (!fixture.enabled) continue;
    Object.assign(channels, channelsForFixture(fixture));
  }
  return channels;
}

function setFixtureProfileValues(fixture, profile, values) {
  fixture.profile = profile;
  fixture.values[profile] = {
    ...(fixture.values[profile] || {}),
    ...values,
  };
}

function setCurrentProfile(profile) {
  $("fixtureModeInput").value = profile;
  activeFixture().profile = profile;
  renderModePanels();
  renderFixtureGrid();
}

function applyCurrentControlsToEnabledFixtures() {
  const profile = $("fixtureModeInput").value;
  const values = readCurrentValues(profile);
  const selected = activeFixture();
  selected.address = startAddress();
  setFixtureProfileValues(selected, profile, values);
  for (const fixture of fixtures) {
    if (!fixture.enabled || fixture === selected) continue;
    setFixtureProfileValues(fixture, profile, values);
  }
}

function sendHsiLook(label, hue, saturation, intensity, holdMs = 1200) {
  stopEffect();
  setCurrentProfile("hsi");
  setHsiValues(hue, saturation, intensity);
  const channels = currentChannels();
  renderFixtureGrid();
  sendLook(label, channels, { holdMs }).catch((err) => setMessage(err.message, true));
}

const environmentLooks = {
  auto: [
    ["hsi", { hue: 204, saturation: 54, intensity: 120 }],
    ["hsi", { hue: 0, saturation: 0, intensity: 190 }],
    ["hsi", { hue: 0, saturation: 0, intensity: 125 }],
    ["hsi", { hue: 28, saturation: 142, intensity: 75 }],
    ["hsi", { hue: 214, saturation: 180, intensity: 55 }],
    ["rgb", { red: 20, green: 70, blue: 255, brightness: 62 }],
    ["rgb", { red: 255, green: 116, blue: 36, brightness: 50 }],
    ["cct", { intensity: 95, temp: 30, gm: 128 }],
    ["hsi", { hue: 198, saturation: 90, intensity: 40 }],
  ],
  bioscoop: [
    ["hsi", { hue: 224, saturation: 210, intensity: 55 }],
    ["hsi", { hue: 0, saturation: 0, intensity: 45 }],
    ["hsi", { hue: 0, saturation: 0, intensity: 35 }],
    ["hsi", { hue: 28, saturation: 240, intensity: 42 }],
    ["hsi", { hue: 348, saturation: 190, intensity: 30 }],
    ["rgb", { red: 18, green: 28, blue: 255, brightness: 42 }],
    ["rgb", { red: 255, green: 48, blue: 24, brightness: 30 }],
    ["cct", { intensity: 25, temp: 0, gm: 128 }],
    ["hsi", { hue: 240, saturation: 180, intensity: 28 }],
  ],
  podcast: [
    ["hsi", { hue: 32, saturation: 110, intensity: 140 }],
    ["hsi", { hue: 0, saturation: 0, intensity: 210 }],
    ["hsi", { hue: 0, saturation: 0, intensity: 180 }],
    ["hsi", { hue: 195, saturation: 170, intensity: 80 }],
    ["hsi", { hue: 300, saturation: 115, intensity: 55 }],
    ["rgb", { red: 40, green: 190, blue: 255, brightness: 58 }],
    ["rgb", { red: 255, green: 84, blue: 190, brightness: 40 }],
    ["cct", { intensity: 130, temp: 100, gm: 128 }],
    ["hsi", { hue: 210, saturation: 105, intensity: 50 }],
  ],
  nacht: [
    ["hsi", { hue: 230, saturation: 230, intensity: 35 }],
    ["hsi", { hue: 0, saturation: 0, intensity: 18 }],
    ["hsi", { hue: 0, saturation: 0, intensity: 12 }],
    ["hsi", { hue: 260, saturation: 200, intensity: 25 }],
    ["hsi", { hue: 200, saturation: 210, intensity: 24 }],
    ["rgb", { red: 10, green: 14, blue: 120, brightness: 35 }],
    ["rgb", { red: 75, green: 0, blue: 120, brightness: 20 }],
    ["cct", { intensity: 10, temp: 0, gm: 128 }],
    ["hsi", { hue: 215, saturation: 160, intensity: 18 }],
  ],
};

function applyEnvironmentLook(name) {
  const look = environmentLooks[name];
  if (!look) return;
  fixtures.forEach((fixture, index) => {
    const entry = look[index];
    if (!entry) return;
    setFixtureProfileValues(fixture, entry[0], entry[1]);
  });
  applyFixtureToControls(activeFixtureIndex);
}

function currentChannels(options = {}) {
  if (options.propagate === false) {
    saveActiveFixtureFromControls();
    return combineFixtureChannels();
  }
  applyCurrentControlsToEnabledFixtures();
  return combineFixtureChannels();
}

function updateOutputs() {
  $("cctIntensityOut").textContent = $("cctIntensityInput").value;
  $("cctTempOut").textContent = $("cctTempInput").value;
  $("cctGmOut").textContent = $("cctGmInput").value;
  $("rgbBrightnessOut").textContent = $("rgbBrightnessInput").value;
  $("redOut").textContent = $("redInput").value;
  $("greenOut").textContent = $("greenInput").value;
  $("blueOut").textContent = $("blueInput").value;
  $("hsiIntensityOut").textContent = $("hsiIntensityInput").value;
  $("hueOut").textContent = $("hueInput").value;
  $("hueOffsetOut").textContent = String(hueOffset());
  $("saturationOut").textContent = $("saturationInput").value;
  const rgb = hsiPreviewRgb();
  const hex = hexFromRgb(rgb.red, rgb.green, rgb.blue).toUpperCase();
  $("hsiColorSwatch").style.background = `rgb(${rgb.red}, ${rgb.green}, ${rgb.blue})`;
  $("hsiColorLabel").textContent = `Hue ${$("hueInput").value} · Sat ${$("saturationInput").value} · Int ${$("hsiIntensityInput").value}`;
  if (document.activeElement !== $("hsiHexInput")) $("hsiHexInput").value = hex;
  const address = startAddress();
  $("hsiDmxInput").value = `${address}:${clamp($("hsiIntensityInput").value)} ${address + 1}:${hueToDmx($("hueInput").value)} ${address + 2}:${clamp($("saturationInput").value)}`;
  drawColorWheel();
}

function renderModePanels() {
  const profile = $("fixtureModeInput").value;
  document.querySelectorAll(".mode-panel").forEach((panel) => {
    panel.hidden = profile === "raw" ? true : panel.dataset.modePanel !== profile;
  });
}

async function refresh() {
  const data = await api("/api/state");
  state = data.state;
  $("targetIpInput").value = state.config.targetIp || "192.168.1.230";
  $("universeInput").value = state.config.universe ?? 1;
  $("frameRateInput").value = state.config.frameRate || 35;
  $("activeBadge").textContent = state.active ? "live" : "idle";
  $("activeBadge").className = state.active ? "badge good" : "badge";
  $("lastSentBadge").textContent = state.lastSentAt || "nog niets";
  $("statusLine").textContent = `Art-Net · ${state.config.targetIp} · universe ${state.config.universe} · udp ${state.config.artnetPort}`;
  logBody(data);
}

async function sendLook(label, channels, options = {}) {
  const body = {
    ...configBody(),
    label,
    channels,
    clearFirst: options.clearFirst !== false,
    holdMs: options.holdMs || 700,
    continuous: options.continuous === true,
  };
  const result = await post("/api/look", body);
  state = result.state;
  logBody(result);
  await refresh();
  return result;
}

function queueLiveSend() {
  if (!live) {
    live = true;
    $("liveBtn").textContent = "Live uit";
  }
  if (liveDebounce) clearTimeout(liveDebounce);
  liveDebounce = setTimeout(() => {
    sendLook("live", currentChannels(), { continuous: true }).catch((err) => setMessage(err.message, true));
  }, 80);
}

function stopEffect() {
  if (effectTimer) clearInterval(effectTimer);
  effectTimer = null;
  $("cycleBtn").textContent = "Color cycle";
}

async function blackout(holdMs = 900) {
  live = false;
  $("liveBtn").textContent = "Live aan";
  stopEffect();
  if (liveDebounce) clearTimeout(liveDebounce);
  liveDebounce = null;
  setCctValues(0, clamp($("cctTempInput").value), clamp($("cctGmInput").value));
  $("rgbBrightnessInput").value = "0";
  $("hsiIntensityInput").value = "0";
  clearRaw();
  updateOutputs();
  await post("/api/stop", {});
  const result = await post("/api/blackout", { ...configBody(), holdMs });
  state = result.state;
  logBody(result);
  await refresh();
}

function setCctValues(intensity, temp, gm) {
  $("cctIntensityInput").value = String(clamp(intensity));
  $("cctTempInput").value = String(clamp(temp));
  $("cctGmInput").value = String(clamp(gm));
  updateOutputs();
}

function setRgbValues(red, green, blue, brightness = 255) {
  $("redInput").value = String(clamp(red));
  $("greenInput").value = String(clamp(green));
  $("blueInput").value = String(clamp(blue));
  $("rgbBrightnessInput").value = String(clamp(brightness));
  $("colorInput").value = hexFromRgb(red, green, blue);
  updateOutputs();
}

function setHsiValues(hue, saturation, intensity) {
  $("hueInput").value = String(clamp(hue, 0, 360));
  $("saturationInput").value = String(clamp(saturation));
  $("hsiIntensityInput").value = String(clamp(intensity));
  updateOutputs();
}

function generateWheelImage(canvas) {
  const ctx = canvas.getContext("2d");
  const size = canvas.width;
  const center = size / 2;
  const radius = center - 4;
  const image = ctx.createImageData(size, size);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const dx = x - center;
      const dy = y - center;
      const distance = Math.sqrt(dx * dx + dy * dy);
      const offset = (y * size + x) * 4;
      if (distance > radius) {
        image.data[offset + 3] = 0;
        continue;
      }
      const hue = ((Math.atan2(dy, dx) * 180 / Math.PI) + 360) % 360;
      const saturation = Math.round((distance / radius) * 255);
      const rgb = hsvToRgb(hue, saturation, 255);
      image.data[offset] = rgb.red;
      image.data[offset + 1] = rgb.green;
      image.data[offset + 2] = rgb.blue;
      image.data[offset + 3] = 255;
    }
  }
  return image;
}

function drawColorWheel() {
  const canvas = $("hsiWheelCanvas");
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  if (!wheelImageData) wheelImageData = generateWheelImage(canvas);
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.putImageData(wheelImageData, 0, 0);

  const center = canvas.width / 2;
  const radius = center - 4;
  const hueRadians = clamp($("hueInput").value, 0, 360) * Math.PI / 180;
  const saturationRadius = (clamp($("saturationInput").value) / 255) * radius;
  const x = center + Math.cos(hueRadians) * saturationRadius;
  const y = center + Math.sin(hueRadians) * saturationRadius;

  ctx.beginPath();
  ctx.arc(x, y, 11, 0, Math.PI * 2);
  ctx.fillStyle = "#ffffff";
  ctx.fill();
  ctx.lineWidth = 3;
  ctx.strokeStyle = "#10120f";
  ctx.stroke();
}

function setHsiFromWheel(event) {
  const canvas = $("hsiWheelCanvas");
  const rect = canvas.getBoundingClientRect();
  const scale = canvas.width / rect.width;
  const x = (event.clientX - rect.left) * scale;
  const y = (event.clientY - rect.top) * scale;
  const center = canvas.width / 2;
  const radius = center - 4;
  const dx = x - center;
  const dy = y - center;
  const distance = Math.min(radius, Math.sqrt(dx * dx + dy * dy));
  const hue = Math.round(((Math.atan2(dy, dx) * 180 / Math.PI) + 360) % 360);
  const saturation = Math.round((distance / radius) * 255);
  setHsiValues(hue, saturation, $("hsiIntensityInput").value);
  queueLiveSend();
}

function renderRawGrid() {
  const root = $("rawGrid");
  const rows = [];
  for (let channel = 1; channel <= 12; channel += 1) {
    rows.push(`
      <div class="raw-channel">
        <strong>CH ${channel}</strong>
        <input class="raw-range" data-channel="${channel}" type="range" min="0" max="255" value="0">
        <input class="raw-number" data-channel="${channel}" type="number" min="0" max="255" value="0">
      </div>
    `);
  }
  root.innerHTML = rows.join("");
  root.querySelectorAll(".raw-range").forEach((range) => {
    const channel = range.dataset.channel;
    const number = root.querySelector(`.raw-number[data-channel="${esc(channel)}"]`);
    rawInputs.set(channel, { range, number });
    range.addEventListener("input", () => {
      number.value = range.value;
      queueLiveSend();
    });
  });
  root.querySelectorAll(".raw-number").forEach((number) => {
    const channel = number.dataset.channel;
    const controls = rawInputs.get(channel);
    number.addEventListener("input", () => {
      controls.range.value = String(clamp(number.value));
      queueLiveSend();
    });
  });
}

function renderFixtureGrid() {
  const root = $("fixtureGrid");
  root.innerHTML = fixtures.map((fixture, index) => `
    <div class="fixture-card ${index === activeFixtureIndex ? "active" : ""}" data-fixture="${index}">
      <header>
        <strong>${esc(fixture.name)}</strong>
        <span class="badge">${esc(fixture.profile.toUpperCase())}</span>
      </header>
      <label class="check-label">
        <input class="fixture-enabled" data-fixture="${index}" type="checkbox" ${fixture.enabled ? "checked" : ""}>
        <span>Meesturen</span>
      </label>
      <div class="fixture-row">
        <label>Adres
          <input class="fixture-address" data-fixture="${index}" type="number" min="1" max="512" value="${esc(fixture.address)}">
        </label>
        <label>Profiel
          <select class="fixture-profile" data-fixture="${index}">
            ${["hsi", "cct", "rgb", "raw"].map((profile) => `<option value="${profile}" ${fixture.profile === profile ? "selected" : ""}>${profile.toUpperCase()}</option>`).join("")}
          </select>
        </label>
      </div>
      <button class="fixture-select" data-fixture="${index}" type="button">Selecteer</button>
    </div>
  `).join("");
  root.querySelectorAll(".fixture-select").forEach((button) => {
    button.addEventListener("click", () => {
      saveActiveFixtureFromControls();
      activeFixtureIndex = Number(button.dataset.fixture);
      applyFixtureToControls(activeFixtureIndex);
    });
  });
  root.querySelectorAll(".fixture-enabled").forEach((input) => {
    input.addEventListener("input", () => {
      fixtures[Number(input.dataset.fixture)].enabled = input.checked;
      queueLiveSend();
      renderFixtureGrid();
    });
  });
  root.querySelectorAll(".fixture-address").forEach((input) => {
    input.addEventListener("input", () => {
      const index = Number(input.dataset.fixture);
      fixtures[index].address = clamp(input.value, 1, 512);
      if (index === activeFixtureIndex) $("addressInput").value = String(fixtures[index].address);
      updateOutputs();
      queueLiveSend();
    });
  });
  root.querySelectorAll(".fixture-profile").forEach((select) => {
    select.addEventListener("input", () => {
      const index = Number(select.dataset.fixture);
      fixtures[index].profile = select.value;
      if (index === activeFixtureIndex) {
        $("fixtureModeInput").value = select.value;
        renderModePanels();
      }
      queueLiveSend();
      renderFixtureGrid();
    });
  });
}

function setAllFixturesEnabled(enabled) {
  fixtures.forEach((fixture, index) => {
    fixture.enabled = enabled || index === activeFixtureIndex;
  });
  renderFixtureGrid();
  queueLiveSend();
}

function clearRaw() {
  for (const controls of rawInputs.values()) {
    controls.range.value = "0";
    controls.number.value = "0";
  }
}

async function toggleLive() {
  live = !live;
  $("liveBtn").textContent = live ? "Live uit" : "Live aan";
  if (live) {
    await sendLook("live", currentChannels(), { continuous: true });
  } else {
    await post("/api/stop", {});
    await refresh();
  }
}

function startCycle() {
  if (effectTimer) {
    stopEffect();
    post("/api/stop", {}).catch(() => undefined);
    return;
  }
  $("cycleBtn").textContent = "Cycle stop";
  $("fixtureModeInput").value = "hsi";
  activeFixture().profile = "hsi";
  renderModePanels();
  live = true;
  $("liveBtn").textContent = "Live uit";
  let hue = 0;
  effectTimer = setInterval(() => {
    setHsiValues(hue, 255, $("hsiIntensityInput").value || 255);
    sendLook("hsi-cycle", currentChannels(), { continuous: true }).catch((err) => setMessage(err.message, true));
    hue = (hue + 9) % 360;
  }, 140);
}

function bindEvents() {
  $("activeFixtureInput").addEventListener("change", () => {
    saveActiveFixtureFromControls();
    activeFixtureIndex = Number($("activeFixtureInput").value);
    applyFixtureToControls(activeFixtureIndex);
  });
  $("syncFixtureBtn").addEventListener("click", () => {
    saveActiveFixtureFromControls();
    renderFixtureGrid();
    queueLiveSend();
  });
  $("allFixturesBtn").addEventListener("click", () => setAllFixturesEnabled(true));
  $("soloFixtureBtn").addEventListener("click", () => setAllFixturesEnabled(false));
  document.querySelectorAll(".environment-button").forEach((button) => {
    button.addEventListener("click", () => {
      stopEffect();
      applyEnvironmentLook(button.dataset.look);
      sendLook(`environment-${button.dataset.look}`, currentChannels({ propagate: false }), { holdMs: 1200 }).catch((err) => setMessage(err.message, true));
    });
  });
  $("fixtureModeInput").addEventListener("change", () => {
    stopEffect();
    activeFixture().profile = $("fixtureModeInput").value;
    renderModePanels();
    renderFixtureGrid();
    queueLiveSend();
  });
  $("addressInput").addEventListener("input", () => {
    activeFixture().address = startAddress();
    updateOutputs();
    renderFixtureGrid();
    queueLiveSend();
  });
  $("refreshBtn").addEventListener("click", () => refresh().catch((err) => setMessage(err.message, true)));
  $("liveBtn").addEventListener("click", () => toggleLive().catch((err) => setMessage(err.message, true)));
  $("stopBtn").addEventListener("click", async () => {
    live = false;
    $("liveBtn").textContent = "Live aan";
    stopEffect();
    const result = await post("/api/stop", {});
    logBody(result);
    await refresh();
  });
  $("blackoutBtn").addEventListener("click", () => blackout(1200).catch((err) => setMessage(err.message, true)));
  $("hsiWhiteBtn").addEventListener("click", () => {
    sendHsiLook("hsi-white", $("hueInput").value, 0, 255);
  });
  $("hsiAmberBtn").addEventListener("click", () => {
    sendHsiLook("hsi-amber", 34, 255, 220);
  });
  $("hsiBlueBtn").addEventListener("click", () => {
    sendHsiLook("hsi-blue", 220, 255, 220);
  });
  $("cctFullBtn").addEventListener("click", () => {
    sendHsiLook("cct-5600k-as-hsi-white", 0, 0, 255);
  });
  $("cctWarmBtn").addEventListener("click", () => {
    sendHsiLook("cct-warm-dim-as-hsi", 34, 150, 80);
  });
  $("rgbWhiteBtn").addEventListener("click", () => {
    sendHsiLook("rgb-white-as-hsi-white", 0, 0, 255);
  });
  document.querySelectorAll(".swatch").forEach((button) => {
    button.addEventListener("click", () => {
      const [red, green, blue] = button.dataset.rgb.split(",").map((value) => clamp(value));
      const hsv = rgbToHsv(red, green, blue);
      setCurrentProfile("hsi");
      setRgbValues(red, green, blue, 255);
      setHsiValues(hsv.hue, hsv.saturation, hsv.intensity);
      sendLook(`hsi-${button.textContent.trim().toLowerCase()}`, currentChannels(), { holdMs: 1200 }).catch((err) => setMessage(err.message, true));
    });
  });
  $("cycleBtn").addEventListener("click", () => startCycle());
  $("sendCctBtn").addEventListener("click", () => sendLook("cct-custom", currentChannels(), { holdMs: 900 }).catch((err) => setMessage(err.message, true)));
  $("sendRgbBtn").addEventListener("click", () => sendLook("rgb-custom", currentChannels(), { holdMs: 900 }).catch((err) => setMessage(err.message, true)));
  $("sendHsiBtn").addEventListener("click", () => sendLook("hsi-custom", currentChannels(), { holdMs: 900 }).catch((err) => setMessage(err.message, true)));
  $("sendRawBtn").addEventListener("click", () => sendLook("raw-1-12", currentChannels(), { holdMs: 900 }).catch((err) => setMessage(err.message, true)));
  $("allChannelBtn").addEventListener("click", async () => {
    const result = await post("/api/look", { ...configBody(), label: "all-channels-45", fill: 115, holdMs: 1200 });
    logBody(result);
    await refresh();
  });
  $("clearRawBtn").addEventListener("click", () => {
    clearRaw();
    blackout(900).catch((err) => setMessage(err.message, true));
  });
  $("colorInput").addEventListener("input", () => {
    const rgb = rgbFromHex($("colorInput").value);
    setRgbValues(rgb.red, rgb.green, rgb.blue, $("rgbBrightnessInput").value);
    queueLiveSend();
  });
  $("hsiHexInput").addEventListener("input", () => {
    const raw = $("hsiHexInput").value.trim();
    if (!/^#?[0-9a-fA-F]{6}$/.test(raw)) return;
    const rgb = rgbFromHex(raw);
    const hsv = rgbToHsv(rgb.red, rgb.green, rgb.blue);
    setHsiValues(hsv.hue, hsv.saturation, hsv.intensity);
    queueLiveSend();
  });
  [
    "cctIntensityInput",
    "cctTempInput",
    "cctGmInput",
    "rgbBrightnessInput",
    "redInput",
    "greenInput",
    "blueInput",
    "hsiIntensityInput",
    "hueInput",
    "hueOffsetInput",
    "saturationInput",
  ].forEach((id) => {
    $(id).addEventListener("input", () => {
      updateOutputs();
      if (id === "redInput" || id === "greenInput" || id === "blueInput") {
        $("colorInput").value = hexFromRgb($("redInput").value, $("greenInput").value, $("blueInput").value);
      }
      queueLiveSend();
    });
  });
  $("hsiWheelCanvas").addEventListener("pointerdown", (event) => {
    wheelPointerDown = true;
    $("hsiWheelCanvas").setPointerCapture(event.pointerId);
    setHsiFromWheel(event);
  });
  $("hsiWheelCanvas").addEventListener("pointermove", (event) => {
    if (!wheelPointerDown) return;
    setHsiFromWheel(event);
  });
  $("hsiWheelCanvas").addEventListener("pointerup", () => {
    wheelPointerDown = false;
  });
  $("hsiWheelCanvas").addEventListener("pointercancel", () => {
    wheelPointerDown = false;
  });
}

function init() {
  renderRawGrid();
  applyFixtureToControls(0);
  bindEvents();
  refresh().catch((err) => {
    setMessage(err.message, true);
    logBody({ ok: false, error: err.message });
  });
  setInterval(() => refresh().catch(() => undefined), 2500);
}

init();
