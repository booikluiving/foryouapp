"use strict";

const ENVIRONMENT_LIGHTING_SCHEMA_VERSION = "catalog.environment-lighting.v0";
const LIGHTING_PRESET_SCHEMA_VERSION = "catalog.lighting-preset.v0";

const ACCENT_FIXTURES = Object.freeze([
  { id: "lamp1", label: "Lamp 1", address: 1 },
  { id: "lamp2", label: "Lamp 2", address: 11 },
  { id: "lamp3", label: "Lamp 3", address: 21 },
]);

const BASE_FIXTURES = Object.freeze([
  { id: "lamp4", label: "Lamp 4", address: 31 },
  { id: "lamp5", label: "Lamp 5", address: 41 },
  { id: "lamp6", label: "Lamp 6", address: 51 },
  { id: "lamp7", label: "Lamp 7", address: 61 },
  { id: "lamp8", label: "Lamp 8", address: 71 },
  { id: "lamp9", label: "Lamp 9", address: 81 },
]);

const DEFAULT_STOP_PRESET_ID = "neutral-dim";
const DEFAULT_ENVIRONMENT_PRESET_ID = "studio-neutral";

const DEFAULT_LIGHTING_PRESETS = Object.freeze([
  preset("neutral-dim", "Neutraal gedimd", "Tussen situaties", {
    lamp1: hsi(0, 0, 30),
    lamp2: hsi(0, 0, 30),
    lamp3: hsi(0, 0, 30),
  }),
  preset("studio-neutral", "Neutraal studio", "Studio", {
    lamp1: hsi(0, 0, 160),
    lamp2: hsi(0, 0, 190),
    lamp3: hsi(0, 0, 140),
  }),
  preset("indoor-warm", "Binnen warm", "Binnen", {
    lamp1: hsi(34, 90, 130),
    lamp2: hsi(28, 80, 150),
    lamp3: hsi(38, 70, 115),
  }),
  preset("outdoor-day", "Buiten dag", "Buiten", {
    lamp1: hsi(45, 25, 180),
    lamp2: hsi(0, 0, 200),
    lamp3: hsi(205, 20, 150),
  }),
  preset("cinema-dark", "Donker / bioscoop", "Donker", {
    lamp1: hsi(224, 180, 45),
    lamp2: hsi(0, 0, 30),
    lamp3: hsi(350, 120, 28),
  }),
  preset("festival-color", "Festival / kleur", "Kleur", {
    lamp1: hsi(315, 170, 130),
    lamp2: hsi(34, 180, 150),
    lamp3: hsi(205, 170, 120),
  }),
  preset("tv-show", "TV show", "Studio", {
    lamp1: hsi(0, 0, 190),
    lamp2: hsi(210, 40, 120),
    lamp3: hsi(320, 35, 110),
  }),
  preset("night-blue", "Nacht blauw", "Donker", {
    lamp1: hsi(230, 210, 50),
    lamp2: hsi(210, 160, 35),
    lamp3: hsi(260, 150, 30),
  }),
]);

function hsi(hue, saturation, intensity) {
  return { hue, saturation, intensity };
}

function preset(id, name, category, fixtures) {
  return Object.freeze({
    schemaVersion: LIGHTING_PRESET_SCHEMA_VERSION,
    id,
    name,
    category,
    fixtureGroup: "accent",
    fixtures: Object.freeze(fixtures),
  });
}

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function clamp(value, min = 0, max = 255, fallback = min) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(min, Math.min(max, Math.round(number)));
}

function normalizeHsi(value = {}, fallback = {}) {
  const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const base = fallback && typeof fallback === "object" ? fallback : {};
  return {
    hue: clamp(source.hue, 0, 360, clamp(base.hue, 0, 360, 0)),
    saturation: clamp(source.saturation, 0, 255, clamp(base.saturation, 0, 255, 0)),
    intensity: clamp(source.intensity, 0, 255, clamp(base.intensity, 0, 255, 0)),
  };
}

function normalizeFixtureMap(fixtures = {}, fallback = {}) {
  const source = fixtures && typeof fixtures === "object" && !Array.isArray(fixtures) ? fixtures : {};
  const base = fallback && typeof fallback === "object" && !Array.isArray(fallback) ? fallback : {};
  const result = {};
  for (const fixture of ACCENT_FIXTURES) {
    result[fixture.id] = normalizeHsi(source[fixture.id], base[fixture.id]);
  }
  return result;
}

function sanitizeId(value, fallback = "") {
  return String(value || fallback)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

function defaultPresetById(id) {
  return DEFAULT_LIGHTING_PRESETS.find((presetItem) => presetItem.id === id) || null;
}

function mergeLightingPresets(records = []) {
  const map = new Map(DEFAULT_LIGHTING_PRESETS.map((item) => [item.id, cloneJson(item)]));
  for (const record of records || []) {
    const normalized = normalizeLightingPreset(record, map.get(String(record && record.id || "")) || null);
    if (normalized) map.set(normalized.id, normalized);
  }
  return Array.from(map.values());
}

function normalizeLightingPreset(record = {}, base = null) {
  const source = record && typeof record === "object" && !Array.isArray(record) ? record : {};
  const id = sanitizeId(source.id, base && base.id || "");
  if (!id) return null;
  const fallback = base || defaultPresetById(id) || defaultPresetById(DEFAULT_ENVIRONMENT_PRESET_ID);
  return {
    schemaVersion: LIGHTING_PRESET_SCHEMA_VERSION,
    id,
    name: String(source.name || fallback && fallback.name || id).trim(),
    category: String(source.category || fallback && fallback.category || "Custom").trim(),
    fixtureGroup: "accent",
    fixtures: normalizeFixtureMap(source.fixtures, fallback && fallback.fixtures),
    updatedAt: source.updatedAt || null,
  };
}

function presetMap(presets = DEFAULT_LIGHTING_PRESETS) {
  return new Map(mergeLightingPresets(presets).map((presetItem) => [presetItem.id, presetItem]));
}

function presetForId(presets, id, fallbackId = DEFAULT_ENVIRONMENT_PRESET_ID) {
  const map = presetMap(presets);
  return map.get(String(id || "")) || map.get(fallbackId) || map.get(DEFAULT_ENVIRONMENT_PRESET_ID) || mergeLightingPresets(presets)[0];
}

function normalizeEnvironmentLighting(input = {}, presets = DEFAULT_LIGHTING_PRESETS) {
  const source = input && typeof input === "object" && !Array.isArray(input) ? input : {};
  const mode = source.mode === "custom" ? "custom" : "preset";
  const preset = presetForId(presets, source.presetId, DEFAULT_ENVIRONMENT_PRESET_ID);
  return {
    schemaVersion: ENVIRONMENT_LIGHTING_SCHEMA_VERSION,
    mode,
    presetId: preset.id,
    stopBehavior: source.stopBehavior === "off" ? "off" : "neutral-dim",
    fixtures: mode === "custom" ? normalizeFixtureMap(source.fixtures, preset.fixtures) : {},
  };
}

function resolveEnvironmentLighting(input = {}, presets = DEFAULT_LIGHTING_PRESETS) {
  const normalized = normalizeEnvironmentLighting(input, presets);
  const preset = presetForId(presets, normalized.presetId, DEFAULT_ENVIRONMENT_PRESET_ID);
  const fixtures = normalized.mode === "custom"
    ? normalizeFixtureMap(normalized.fixtures, preset.fixtures)
    : normalizeFixtureMap(preset.fixtures);
  return {
    ...normalized,
    presetName: preset.name,
    category: preset.category,
    fixtures,
  };
}

function hueToDmx(hue) {
  return Math.round((clamp(hue, 0, 360, 0) / 360) * 255);
}

// De drie lampen staan in kleurtemperatuurmodus: kanaal 2 is warm (0) tot koel (255),
// kanaal 3 is magenta (0) tot groen (255). Tint en verzadiging uit een stand worden
// daarom omgerekend naar warmer of koeler wit. Zet de lampen in kleurmodus (HSI) en
// deze waarde op "hsi" om weer tint en verzadiging te sturen.
const ACCENT_LAMP_MODE = process.env.FORYOU_ACCENT_LAMP_MODE === "hsi" ? "hsi" : "cct";
const CCT_NEUTRAL = 128;
const CCT_GM_NEUTRAL = 128;

function cctForHsi(hue, saturation) {
  const strength = clamp(saturation) / 255;
  const warmth = Math.cos(((clamp(hue, 0, 360, 0) - 30) * Math.PI) / 180) * strength;
  const span = warmth > 0 ? CCT_NEUTRAL : 255 - CCT_NEUTRAL;
  return clamp(Math.round(CCT_NEUTRAL - warmth * span));
}

// Per omgeving een eigen kleurtemperatuur, zodat het licht meekleurt met het beeld
// (warm bij een gelig beeld, koel bij een wit of blauw beeld). Het bestand wordt bij
// elke scène opnieuw gelezen.
function kleurtemperatuurVoorOmgeving(environmentId) {
  if (ACCENT_LAMP_MODE !== "cct" || !environmentId) return null;
  try {
    const bestand = require("node:path").join(__dirname, "omgevingslicht.json");
    const data = JSON.parse(require("node:fs").readFileSync(bestand, "utf8"));
    const item = data && data.omgevingen && data.omgevingen[String(environmentId)];
    const waarde = item && Number(item.kleurtemperatuur);
    return Number.isFinite(waarde) ? clamp(waarde) : null;
  } catch (_error) {
    return null;
  }
}

function channelsForAccentFixtures(fixtures = {}, options = {}) {
  const normalized = normalizeFixtureMap(fixtures);
  const omgevingCct = kleurtemperatuurVoorOmgeving(options.environmentId);
  const channels = {};
  for (const fixture of ACCENT_FIXTURES) {
    const values = normalized[fixture.id];
    channels[fixture.address] = clamp(values.intensity);
    if (ACCENT_LAMP_MODE === "hsi") {
      channels[fixture.address + 1] = hueToDmx(values.hue);
      channels[fixture.address + 2] = clamp(values.saturation);
    } else {
      channels[fixture.address + 1] = omgevingCct === null ? cctForHsi(values.hue, values.saturation) : omgevingCct;
      channels[fixture.address + 2] = CCT_GM_NEUTRAL;
    }
  }
  return channels;
}

function channelsForLighting(lighting = {}, presets = DEFAULT_LIGHTING_PRESETS) {
  return channelsForAccentFixtures(resolveEnvironmentLighting(lighting, presets).fixtures);
}

function channelsForPreset(presetId, presets = DEFAULT_LIGHTING_PRESETS) {
  const preset = presetForId(presets, presetId, DEFAULT_ENVIRONMENT_PRESET_ID);
  return channelsForAccentFixtures(preset.fixtures);
}

module.exports = {
  ACCENT_FIXTURES,
  ACCENT_LAMP_MODE,
  BASE_FIXTURES,
  DEFAULT_ENVIRONMENT_PRESET_ID,
  DEFAULT_LIGHTING_PRESETS,
  DEFAULT_STOP_PRESET_ID,
  ENVIRONMENT_LIGHTING_SCHEMA_VERSION,
  LIGHTING_PRESET_SCHEMA_VERSION,
  channelsForAccentFixtures,
  channelsForLighting,
  channelsForPreset,
  cloneJson,
  kleurtemperatuurVoorOmgeving,
  mergeLightingPresets,
  normalizeEnvironmentLighting,
  normalizeFixtureMap,
  normalizeHsi,
  normalizeLightingPreset,
  resolveEnvironmentLighting,
};
