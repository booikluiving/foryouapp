"use strict";

function clamp(value, min = 0, max = 255) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return min;
  return Math.max(min, Math.min(max, parsed));
}

function scaled(value, brightness) {
  return Math.round(clamp(value) * (clamp(brightness) / 255));
}

const FIXTURES = Object.freeze([
  { name: "Lamp 1", address: 1 },
  { name: "Lamp 2", address: 11 },
  { name: "Lamp 3", address: 21 },
  { name: "Lamp 4", address: 31 },
  { name: "Lamp 5", address: 41 },
  { name: "Lamp 6", address: 51 },
  { name: "Lamp 7", address: 61 },
  { name: "Lamp 8", address: 71 },
  { name: "Lamp 9", address: 81 },
]);

const ENVIRONMENT_LOOKS = Object.freeze({
  auto: [
    ["hsi", { hue: 204, saturation: 54, intensity: 120 }],
    ["cct", { intensity: 190, temp: 90, gm: 128 }],
    ["cct", { intensity: 125, temp: 42, gm: 128 }],
    ["hsi", { hue: 28, saturation: 142, intensity: 75 }],
    ["hsi", { hue: 214, saturation: 180, intensity: 55 }],
    ["rgb", { red: 20, green: 70, blue: 255, brightness: 62 }],
    ["rgb", { red: 255, green: 116, blue: 36, brightness: 50 }],
    ["cct", { intensity: 95, temp: 30, gm: 128 }],
    ["hsi", { hue: 198, saturation: 90, intensity: 40 }],
  ],
  bioscoop: [
    ["hsi", { hue: 224, saturation: 210, intensity: 55 }],
    ["cct", { intensity: 45, temp: 10, gm: 128 }],
    ["cct", { intensity: 35, temp: 0, gm: 128 }],
    ["hsi", { hue: 28, saturation: 240, intensity: 42 }],
    ["hsi", { hue: 348, saturation: 190, intensity: 30 }],
    ["rgb", { red: 18, green: 28, blue: 255, brightness: 42 }],
    ["rgb", { red: 255, green: 48, blue: 24, brightness: 30 }],
    ["cct", { intensity: 25, temp: 0, gm: 128 }],
    ["hsi", { hue: 240, saturation: 180, intensity: 28 }],
  ],
  podcast: [
    ["hsi", { hue: 32, saturation: 110, intensity: 140 }],
    ["cct", { intensity: 210, temp: 118, gm: 128 }],
    ["cct", { intensity: 180, temp: 95, gm: 128 }],
    ["hsi", { hue: 195, saturation: 170, intensity: 80 }],
    ["hsi", { hue: 300, saturation: 115, intensity: 55 }],
    ["rgb", { red: 40, green: 190, blue: 255, brightness: 58 }],
    ["rgb", { red: 255, green: 84, blue: 190, brightness: 40 }],
    ["cct", { intensity: 130, temp: 100, gm: 128 }],
    ["hsi", { hue: 210, saturation: 105, intensity: 50 }],
  ],
  nacht: [
    ["hsi", { hue: 230, saturation: 230, intensity: 35 }],
    ["cct", { intensity: 18, temp: 0, gm: 128 }],
    ["cct", { intensity: 12, temp: 0, gm: 128 }],
    ["hsi", { hue: 260, saturation: 200, intensity: 25 }],
    ["hsi", { hue: 200, saturation: 210, intensity: 24 }],
    ["rgb", { red: 10, green: 14, blue: 120, brightness: 35 }],
    ["rgb", { red: 75, green: 0, blue: 120, brightness: 20 }],
    ["cct", { intensity: 10, temp: 0, gm: 128 }],
    ["hsi", { hue: 215, saturation: 160, intensity: 18 }],
  ],
});

function channelsForEntry(address, profile, values) {
  if (profile === "cct") {
    return {
      [address]: clamp(values.intensity),
      [address + 1]: clamp(values.temp),
      [address + 2]: clamp(values.gm),
    };
  }
  if (profile === "rgb") {
    return {
      [address]: scaled(values.red, values.brightness),
      [address + 1]: scaled(values.green, values.brightness),
      [address + 2]: scaled(values.blue, values.brightness),
    };
  }
  return {
    [address]: clamp(values.intensity),
    [address + 1]: Math.round((clamp(values.hue, 0, 360) / 360) * 255),
    [address + 2]: clamp(values.saturation),
  };
}

function channelsForPreset(name) {
  const presetName = String(name || "").trim().toLowerCase();
  const look = ENVIRONMENT_LOOKS[presetName];
  if (!look) throw new Error(`dmx_unknown_preset:${name || "missing"}`);
  const channels = {};
  look.forEach(([profile, values], index) => {
    const fixture = FIXTURES[index];
    if (!fixture) return;
    Object.assign(channels, channelsForEntry(fixture.address, profile, values));
  });
  return channels;
}

function listPresets() {
  return Object.keys(ENVIRONMENT_LOOKS).map((name) => ({
    name,
    fixtureCount: FIXTURES.length,
    channels: channelsForPreset(name),
  }));
}

module.exports = {
  FIXTURES,
  ENVIRONMENT_LOOKS,
  channelsForPreset,
  listPresets,
};
