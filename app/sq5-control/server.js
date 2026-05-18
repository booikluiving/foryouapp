const http = require("http");
const net = require("net");
const { URL } = require("url");
const osc = require("osc");

const TOOL_PORT = Number(process.env.SQ5_TOOL_PORT || 3105);
const TOOL_HOST = String(process.env.SQ5_TOOL_HOST || "127.0.0.1").trim() || "127.0.0.1";
const DEFAULT_MIXER_PORT = Number(process.env.SQ5_MIXER_PORT || 51325);
const DEFAULT_OSC_PORT = Number(process.env.SQ5_OSC_PORT || 53000);
const DEFAULT_OSC_LISTEN_ADDRESS = String(process.env.SQ5_OSC_LISTEN_ADDRESS || "127.0.0.1").trim() || "127.0.0.1";
const TCP_TIMEOUT_MS = Number(process.env.SQ5_TCP_TIMEOUT_MS || 1800);
const STATUS_POLL_MS = Number(process.env.SQ5_STATUS_POLL_MS || 1500);
const STREAMDECK_POLL_MS = Number(process.env.SQ5_STREAMDECK_POLL_MS || 500);
const MIDI_RESPONSE_WINDOW_MS = Number(process.env.SQ5_MIDI_RESPONSE_WINDOW_MS || 90);
const CONTROL_TOKEN = String(process.env.SQ5_CONTROL_TOKEN || "").trim();
const ALLOW_REMOTE = parseBooleanLike(process.env.SQ5_ALLOW_REMOTE || "0");

const state = {
  mixerHost: String(process.env.SQ5_HOST || "").trim(),
  mixerPort: DEFAULT_MIXER_PORT,
  midiChannel: clampInt(process.env.SQ5_MIDI_CHANNEL || 1, 1, 16),
  faderLaw: String(process.env.SQ5_FADER_LAW || "linear").toLowerCase() === "audio" ? "audio" : "linear",
  oscListenPort: DEFAULT_OSC_PORT,
  oscListenAddress: DEFAULT_OSC_LISTEN_ADDRESS,
  defaultDestination: "lr",
  channels: {
    brent: { key: "brent", label: "Brent", input: clampInt(process.env.SQ5_BRENT_INPUT || 1, 1, 48) },
    megan: { key: "megan", label: "Megan", input: clampInt(process.env.SQ5_MEGAN_INPUT || process.env.SQ5_MEGA_INPUT || 2, 1, 48) },
    booi: { key: "booi", label: "Booi", input: clampInt(process.env.SQ5_BOOI_INPUT || process.env.SQ5_BOY_INPUT || 3, 1, 48) },
  },
};

let activity = [];
let oscPort = null;
let controlState = {};
let lastSyncAt = "";
let lastStreamdeckSyncAt = "";
let syncInProgress = false;
let streamdeckSyncInProgress = false;
let syncTimer = null;
let streamdeckSyncTimer = null;
const midiClient = {
  socket: null,
  connecting: null,
  connected: false,
  host: "",
  port: 0,
  queue: Promise.resolve(),
  pending: null,
  lastError: "",
};

const OUTPUT_TARGETS = Object.freeze({
  mics: { key: "mics", label: "Mics", type: "group", index: 1, mute: [0x00, 0x30], level: [0x40, 0x30] },
  muziek: { key: "muziek", label: "Muziek", type: "group", index: 2, mute: [0x00, 0x31], level: [0x40, 0x31] },
  music: { key: "muziek", label: "Muziek", type: "group", index: 2, mute: [0x00, 0x31], level: [0x40, 0x31] },
  sub: { key: "sub", label: "Sub", type: "matrix", index: 1, mute: [0x00, 0x55], level: [0x4f, 0x11] },
  main: { key: "main", label: "Main LR", type: "lr", index: 1, mute: [0x00, 0x44], level: [0x4f, 0x00] },
  lr: { key: "main", label: "Main LR", type: "lr", index: 1, mute: [0x00, 0x44], level: [0x4f, 0x00] },
});

const INPUT_ALIASES = Object.freeze({
  mac: { key: "mac", label: "Mac", inputs: [5] },
  studio: { key: "studio", label: "Studio", inputs: [6] },
  macstudio: { key: "macstudio", label: "Mac + Studio", inputs: [5, 6] },
  minijack: { key: "minijack", label: "MiniJack", inputs: [7, 8] },
});

const SYNC_INPUT_TOKENS = Object.freeze(["brent", "megan", "booi", "mac", "studio", "minijack"]);
const SYNC_OUTPUT_TOKENS = Object.freeze(["mics", "muziek", "sub", "main"]);
const STREAMDECK_TARGETS = Object.freeze({
  brent: { key: "brent", label: "Brent", kind: "input", names: ["brent"], stateKeys: ["brent"] },
  megan: { key: "megan", label: "Megan", kind: "input", names: ["megan"], stateKeys: ["megan"] },
  booi: { key: "booi", label: "Booi", kind: "input", names: ["booi"], stateKeys: ["booi"] },
  allmics: { key: "allMics", label: "All mics", kind: "input", names: ["brent", "megan", "booi"], stateKeys: ["brent", "megan", "booi"] },
  mac: { key: "mac", label: "Mac", kind: "input", names: ["mac"], stateKeys: ["mac"] },
  studio: { key: "studio", label: "Studio", kind: "input", names: ["studio"], stateKeys: ["studio"] },
  macstudio: { key: "macstudio", label: "Mac + Studio", kind: "input", names: ["macstudio"], stateKeys: ["mac", "studio"] },
  minijack: { key: "minijack", label: "MiniJack", kind: "input", names: ["minijack"], stateKeys: ["minijack1", "minijack2"] },
  mics: { key: "mics", label: "Mics group", kind: "output", names: ["mics"], stateKeys: ["mics"] },
  muziek: { key: "muziek", label: "Muziek", kind: "output", names: ["muziek"], stateKeys: ["muziek"] },
  sub: { key: "sub", label: "Sub", kind: "output", names: ["sub"], stateKeys: ["sub"] },
  main: { key: "main", label: "Main LR", kind: "output", names: ["main"], stateKeys: ["main"] },
});

const LINEAR_LEVEL_POINTS = Object.freeze([
  [-90, 0x00, 0x00],
  [-89, 0x24, 0x16],
  [-85, 0x27, 0x71],
  [-80, 0x2c, 0x42],
  [-75, 0x31, 0x14],
  [-70, 0x35, 0x65],
  [-65, 0x3a, 0x37],
  [-60, 0x3f, 0x09],
  [-55, 0x43, 0x5a],
  [-50, 0x48, 0x2c],
  [-45, 0x4c, 0x7d],
  [-40, 0x51, 0x4f],
  [-38, 0x53, 0x3c],
  [-36, 0x55, 0x2a],
  [-35, 0x56, 0x21],
  [-34, 0x57, 0x17],
  [-33, 0x58, 0x0e],
  [-32, 0x59, 0x05],
  [-31, 0x59, 0x7c],
  [-30, 0x5a, 0x72],
  [-29, 0x5b, 0x69],
  [-28, 0x5c, 0x60],
  [-27, 0x5d, 0x56],
  [-26, 0x5e, 0x4d],
  [-25, 0x5f, 0x44],
  [-24, 0x60, 0x3b],
  [-23, 0x61, 0x31],
  [-22, 0x62, 0x28],
  [-21, 0x63, 0x1f],
  [-20, 0x64, 0x16],
  [-19, 0x65, 0x0c],
  [-18, 0x66, 0x03],
  [-17, 0x66, 0x7a],
  [-16, 0x67, 0x70],
  [-15, 0x68, 0x67],
  [-14, 0x69, 0x5e],
  [-13, 0x6a, 0x55],
  [-12, 0x6b, 0x4b],
  [-11, 0x6c, 0x42],
  [-10, 0x6d, 0x39],
  [-9, 0x6e, 0x2f],
  [-8, 0x6f, 0x26],
  [-7, 0x70, 0x1d],
  [-6, 0x71, 0x14],
  [-5, 0x72, 0x0a],
  [-4, 0x73, 0x01],
  [-3, 0x73, 0x78],
  [-2, 0x74, 0x6f],
  [-1, 0x75, 0x65],
  [0, 0x76, 0x5c],
  [1, 0x77, 0x53],
  [2, 0x78, 0x49],
  [3, 0x79, 0x40],
  [4, 0x7a, 0x37],
  [5, 0x7b, 0x2e],
  [6, 0x7c, 0x24],
  [7, 0x7d, 0x1b],
  [8, 0x7e, 0x12],
  [9, 0x7f, 0x08],
  [10, 0x7f, 0x7f],
]);

const AUDIO_LEVEL_POINTS = Object.freeze([
  [-90, 0x00, 0x00],
  [-89, 0x01, 0x40],
  [-85, 0x02, 0x00],
  [-80, 0x02, 0x40],
  [-75, 0x03, 0x40],
  [-70, 0x04, 0x00],
  [-65, 0x05, 0x00],
  [-60, 0x06, 0x00],
  [-55, 0x07, 0x00],
  [-50, 0x08, 0x00],
  [-45, 0x0c, 0x00],
  [-40, 0x0f, 0x40],
  [-38, 0x12, 0x40],
  [-36, 0x15, 0x40],
  [-35, 0x17, 0x00],
  [-34, 0x19, 0x00],
  [-33, 0x1a, 0x40],
  [-32, 0x1c, 0x00],
  [-31, 0x1d, 0x40],
  [-30, 0x1f, 0x00],
  [-29, 0x20, 0x40],
  [-28, 0x22, 0x00],
  [-27, 0x23, 0x40],
  [-26, 0x25, 0x00],
  [-25, 0x26, 0x40],
  [-24, 0x28, 0x40],
  [-23, 0x2a, 0x00],
  [-22, 0x2b, 0x40],
  [-21, 0x2d, 0x00],
  [-20, 0x2e, 0x40],
  [-19, 0x30, 0x00],
  [-18, 0x31, 0x40],
  [-17, 0x33, 0x00],
  [-16, 0x34, 0x40],
  [-15, 0x36, 0x00],
  [-14, 0x38, 0x00],
  [-13, 0x39, 0x40],
  [-12, 0x3b, 0x00],
  [-11, 0x3c, 0x40],
  [-10, 0x3e, 0x00],
  [-9, 0x41, 0x40],
  [-8, 0x44, 0x40],
  [-7, 0x48, 0x00],
  [-6, 0x4b, 0x00],
  [-5, 0x4e, 0x40],
  [-4, 0x52, 0x40],
  [-3, 0x56, 0x40],
  [-2, 0x5a, 0x00],
  [-1, 0x5e, 0x00],
  [0, 0x62, 0x00],
  [1, 0x65, 0x40],
  [2, 0x69, 0x00],
  [3, 0x6c, 0x40],
  [4, 0x70, 0x00],
  [5, 0x73, 0x40],
  [6, 0x75, 0x40],
  [7, 0x78, 0x00],
  [8, 0x7a, 0x40],
  [9, 0x7d, 0x00],
  [10, 0x7f, 0x40],
]);

const LINEAR_EXAMPLE_OVERRIDES = Object.freeze({
  "-24": [0x5f, 0x57],
  "-20": [0x63, 0x49],
  "-12": [0x6b, 0x06],
});

function clampInt(value, min, max) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return min;
  return Math.max(min, Math.min(max, parsed));
}

function clampNumber(value, min, max) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return min;
  return Math.max(min, Math.min(max, parsed));
}

function parseBooleanLike(value) {
  const raw = String(value === undefined || value === null ? "" : value).trim().toLowerCase();
  return raw === "1" || raw === "true" || raw === "yes" || raw === "on";
}

function normalizeBindHost(value) {
  const host = String(value || "").trim();
  return host || "127.0.0.1";
}

function isLoopbackBindHost(host) {
  const normalized = normalizeBindHost(host).toLowerCase();
  return normalized === "localhost"
    || normalized === "127.0.0.1"
    || normalized === "::1"
    || normalized === "[::1]";
}

function isWildcardBindHost(host) {
  const normalized = normalizeBindHost(host).toLowerCase();
  return normalized === "0.0.0.0" || normalized === "::" || normalized === "[::]";
}

function isRemoteBindHost(host) {
  return !isLoopbackBindHost(host);
}

function requireSafeBind(kind, host, options = {}) {
  const normalized = normalizeBindHost(host);
  if (!isRemoteBindHost(normalized)) return normalized;
  const tokenAllowed = !!options.allowToken && !!CONTROL_TOKEN;
  if (!ALLOW_REMOTE && !tokenAllowed) {
    throw new Error(`${kind} remote bind ${normalized} requires SQ5_ALLOW_REMOTE=1${options.allowToken ? " or SQ5_CONTROL_TOKEN" : ""}`);
  }
  return normalized;
}

function byte(value) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0 || parsed > 0x7f) {
    throw new Error(`MIDI data byte buiten bereik: ${value}`);
  }
  return parsed;
}

function statusByte(value) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0x80 || parsed > 0xff) {
    throw new Error(`MIDI status byte buiten bereik: ${value}`);
  }
  return parsed;
}

function controllerStatus(midiChannel = state.midiChannel) {
  const channel = clampInt(midiChannel, 1, 16);
  return statusByte(0xb0 + channel - 1);
}

function programStatus(midiChannel = state.midiChannel) {
  const channel = clampInt(midiChannel, 1, 16);
  return statusByte(0xc0 + channel - 1);
}

function noteOnStatus(midiChannel = state.midiChannel) {
  const channel = clampInt(midiChannel, 1, 16);
  return statusByte(0x90 + channel - 1);
}

function noteOffStatus(midiChannel = state.midiChannel) {
  const channel = clampInt(midiChannel, 1, 16);
  return statusByte(0x80 + channel - 1);
}

function bytesToHex(bytes) {
  return Array.from(bytes).map((value) => value.toString(16).padStart(2, "0").toUpperCase()).join(" ");
}

function parseHex(hex) {
  const cleaned = String(hex || "")
    .replace(/0x/gi, "")
    .replace(/[^0-9a-fA-F]/g, " ")
    .trim();
  if (!cleaned) throw new Error("Geen hex bytes opgegeven");
  const parts = cleaned.split(/\s+/);
  const bytes = parts.map((part) => {
    if (part.length > 2) throw new Error(`Ongeldige byte: ${part}`);
    const value = Number.parseInt(part, 16);
    if (!Number.isInteger(value) || value < 0 || value > 255) throw new Error(`Ongeldige byte: ${part}`);
    return value;
  });
  return bytes;
}

function pairFromCombined(combined) {
  if (!Number.isInteger(combined) || combined < 0 || combined > 0x3fff) {
    throw new Error(`Parameteradres buiten bereik: ${combined}`);
  }
  return [Math.floor(combined / 128), combined % 128];
}

function pairFromStart(msb, lsb, offset) {
  return pairFromCombined(msb * 128 + lsb + offset);
}

function parseDestination(destination = "lr") {
  const raw = String(destination || "lr").trim().toLowerCase().replace(/\s+/g, "");
  if (raw === "lr" || raw === "main" || raw === "mainlr") return { type: "lr", label: "LR" };
  const aux = raw.match(/^aux(?:iliary)?([1-9]|1[0-2])$/);
  if (aux) return { type: "aux", index: Number(aux[1]), label: `Aux${aux[1]}` };
  throw new Error(`Onbekende bestemming: ${destination}`);
}

function inputNumber(input) {
  return clampInt(input, 1, 48);
}

function inputMuteParam(input) {
  return [0x00, inputNumber(input) - 1];
}

function inputRoutedParam(input, destination, baseMsb) {
  const channel = inputNumber(input);
  const dest = parseDestination(destination);
  if (dest.type === "lr") return [baseMsb, channel - 1];
  return pairFromStart(baseMsb, 0x44, (channel - 1) * 12 + dest.index - 1);
}

function inputLevelParam(input, destination = "lr") {
  return inputRoutedParam(input, destination, 0x40);
}

function inputPanParam(input, destination = "lr") {
  return inputRoutedParam(input, destination, 0x50);
}

function inputAssignParam(input, destination = "lr") {
  return inputRoutedParam(input, destination, 0x60);
}

function nrpnSet(midiChannel, msb, lsb, valueCoarse, valueFine) {
  const status = controllerStatus(midiChannel);
  return [status, 0x63, byte(msb), status, 0x62, byte(lsb), status, 0x06, byte(valueCoarse), status, 0x26, byte(valueFine)];
}

function nrpnIncrement(midiChannel, msb, lsb) {
  const status = controllerStatus(midiChannel);
  return [status, 0x63, byte(msb), status, 0x62, byte(lsb), status, 0x60, 0x00];
}

function nrpnDecrement(midiChannel, msb, lsb) {
  const status = controllerStatus(midiChannel);
  return [status, 0x63, byte(msb), status, 0x62, byte(lsb), status, 0x61, 0x00];
}

function nrpnGet(midiChannel, msb, lsb) {
  const status = controllerStatus(midiChannel);
  return [status, 0x63, byte(msb), status, 0x62, byte(lsb), status, 0x60, 0x7f];
}

function onOffBytes(midiChannel, msb, lsb, enabled) {
  return nrpnSet(midiChannel, msb, lsb, 0x00, enabled ? 0x01 : 0x00);
}

function valueFromPair(msb, lsb) {
  return byte(msb) * 128 + byte(lsb);
}

function pairFromValue(value) {
  const safe = Math.max(0, Math.min(0x3fff, Math.round(value)));
  return [Math.floor(safe / 128), safe % 128];
}

function levelPairFromDb(db, law = state.faderLaw) {
  const table = law === "audio" ? AUDIO_LEVEL_POINTS : LINEAR_LEVEL_POINTS;
  const target = clampNumber(db, -90, 10);
  if (law !== "audio" && Object.prototype.hasOwnProperty.call(LINEAR_EXAMPLE_OVERRIDES, String(target))) {
    return LINEAR_EXAMPLE_OVERRIDES[String(target)];
  }
  if (target <= table[0][0]) return [table[0][1], table[0][2]];
  for (let index = 1; index < table.length; index += 1) {
    const previous = table[index - 1];
    const current = table[index];
    if (target > current[0]) continue;
    if (target === current[0]) return [current[1], current[2]];
    const previousValue = valueFromPair(previous[1], previous[2]);
    const currentValue = valueFromPair(current[1], current[2]);
    const progress = (target - previous[0]) / (current[0] - previous[0]);
    return pairFromValue(previousValue + (currentValue - previousValue) * progress);
  }
  const last = table[table.length - 1];
  return [last[1], last[2]];
}

function dbFromLevelPair(msb, lsb, law = state.faderLaw) {
  const table = law === "audio" ? AUDIO_LEVEL_POINTS : LINEAR_LEVEL_POINTS;
  const value = valueFromPair(msb, lsb);
  if (value <= valueFromPair(table[0][1], table[0][2])) return table[0][0];
  for (let index = 1; index < table.length; index += 1) {
    const previous = table[index - 1];
    const current = table[index];
    const previousValue = valueFromPair(previous[1], previous[2]);
    const currentValue = valueFromPair(current[1], current[2]);
    if (value > currentValue) continue;
    const progress = (value - previousValue) / Math.max(1, currentValue - previousValue);
    return previous[0] + (current[0] - previous[0]) * progress;
  }
  return table[table.length - 1][0];
}

function levelPairFromUnit(value01, law = state.faderLaw) {
  const normalized = clampNumber(value01, 0, 1);
  return levelPairFromDb(-60 + normalized * 70, law);
}

function panPairFromPercent(percent) {
  const pan = clampNumber(percent, -100, 100);
  const value = Math.floor(((pan + 100) / 200) * 0x3fff);
  return pairFromValue(value);
}

function percentFromPanPair(msb, lsb) {
  const value = valueFromPair(msb, lsb);
  return (value / 0x3fff) * 200 - 100;
}

function normalizedDestinationKey(destination = "lr") {
  return parseDestination(destination).label.toLowerCase();
}

function dataPairFromReceivedBytes(hex) {
  const bytes = parseHex(hex);
  let coarse = null;
  let fine = null;
  for (let index = 0; index < bytes.length - 2; index += 3) {
    if ((bytes[index] & 0xf0) !== 0xb0) continue;
    if (bytes[index + 1] === 0x06) coarse = bytes[index + 2];
    if (bytes[index + 1] === 0x26) fine = bytes[index + 2];
  }
  if (coarse === null || fine === null) return null;
  return { coarse, fine, value: valueFromPair(coarse, fine) };
}

function decodeResponse(receivedBytes, meta = {}) {
  const decoded = decodeResponseValue(receivedBytes, meta);
  return decoded ? decoded.display : "";
}

function decodeResponseValue(receivedBytes, meta = {}) {
  if (!receivedBytes || meta.action !== "get") return null;
  const pair = dataPairFromReceivedBytes(receivedBytes);
  if (!pair) return null;
  const parameter = String(meta.parameter || "").toLowerCase();
  if (parameter === "mute") {
    const value = Boolean(pair.fine);
    return { parameter, value, display: value ? "mute: on" : "mute: off" };
  }
  if (parameter === "assign") {
    const value = Boolean(pair.fine);
    return { parameter, value, display: value ? "assign: on" : "assign: off" };
  }
  if (parameter === "pan") {
    const value = percentFromPanPair(pair.coarse, pair.fine);
    return { parameter, value, display: `pan: ${value.toFixed(1)}%` };
  }
  if (parameter === "level") {
    const value = dbFromLevelPair(pair.coarse, pair.fine);
    return { parameter, value, display: `level: ${value.toFixed(1)} dB` };
  }
  return { parameter: parameter || "value", value: pair.value, display: `value: ${pair.value}` };
}

function sceneRecallBytes(scene, midiChannel = state.midiChannel) {
  const sceneNumber = clampInt(scene, 1, 300);
  const zeroBased = sceneNumber - 1;
  const bank = Math.floor(zeroBased / 128);
  const program = zeroBased % 128;
  return [controllerStatus(midiChannel), 0x00, bank, programStatus(midiChannel), program];
}

function softKeyBytes(softKey, action = "tap", midiChannel = state.midiChannel) {
  const key = clampInt(softKey, 1, 16);
  const note = 0x30 + key - 1;
  const normalized = String(action || "tap").toLowerCase();
  const press = [noteOnStatus(midiChannel), note, 0x7f];
  const release = [noteOffStatus(midiChannel), note, 0x00];
  if (normalized === "press" || normalized === "down") return press;
  if (normalized === "release" || normalized === "up") return release;
  return press.concat(release);
}

function inputMuteBytes(input, muted, midiChannel = state.midiChannel) {
  const [msb, lsb] = inputMuteParam(input);
  if (muted === "toggle") return nrpnIncrement(midiChannel, msb, lsb);
  return onOffBytes(midiChannel, msb, lsb, Boolean(muted));
}

function inputLevelBytes(input, db, destination = "lr", midiChannel = state.midiChannel, law = state.faderLaw) {
  const [msb, lsb] = inputLevelParam(input, destination);
  const [vc, vf] = levelPairFromDb(db, law);
  return nrpnSet(midiChannel, msb, lsb, vc, vf);
}

function inputLevelUnitBytes(input, value01, destination = "lr", midiChannel = state.midiChannel, law = state.faderLaw) {
  const [msb, lsb] = inputLevelParam(input, destination);
  const [vc, vf] = levelPairFromUnit(value01, law);
  return nrpnSet(midiChannel, msb, lsb, vc, vf);
}

function inputPanBytes(input, panPercent, destination = "lr", midiChannel = state.midiChannel) {
  const [msb, lsb] = inputPanParam(input, destination);
  const [vc, vf] = panPairFromPercent(panPercent);
  return nrpnSet(midiChannel, msb, lsb, vc, vf);
}

function inputAssignBytes(input, assigned, destination = "lr", midiChannel = state.midiChannel) {
  const [msb, lsb] = inputAssignParam(input, destination);
  if (assigned === "toggle") return nrpnIncrement(midiChannel, msb, lsb);
  return onOffBytes(midiChannel, msb, lsb, Boolean(assigned));
}

function inputGetBytes(input, parameter = "level", destination = "lr", midiChannel = state.midiChannel) {
  const normalized = String(parameter || "level").toLowerCase();
  const [msb, lsb] =
    normalized === "mute"
      ? inputMuteParam(input)
      : normalized === "pan"
        ? inputPanParam(input, destination)
        : normalized === "assign"
          ? inputAssignParam(input, destination)
          : inputLevelParam(input, destination);
  return nrpnGet(midiChannel, msb, lsb);
}

function inputRelativeBytes(input, target = "level", direction = "inc", destination = "lr", midiChannel = state.midiChannel) {
  const normalizedTarget = String(target || "level").toLowerCase();
  const normalizedDirection = String(direction || "inc").toLowerCase();
  const [msb, lsb] = normalizedTarget === "pan" ? inputPanParam(input, destination) : inputLevelParam(input, destination);
  if (normalizedDirection === "dec" || normalizedDirection === "down" || normalizedDirection === "left") {
    return nrpnDecrement(midiChannel, msb, lsb);
  }
  return nrpnIncrement(midiChannel, msb, lsb);
}

function outputMuteBytes(target, muted, midiChannel = state.midiChannel) {
  if (muted === "toggle") return nrpnIncrement(midiChannel, target.mute[0], target.mute[1]);
  return onOffBytes(midiChannel, target.mute[0], target.mute[1], Boolean(muted));
}

function outputLevelBytes(target, db, midiChannel = state.midiChannel, law = state.faderLaw) {
  if (!target.level) throw new Error(`${target.label} heeft geen level-parameter in deze bridge`);
  const [vc, vf] = levelPairFromDb(db, law);
  return nrpnSet(midiChannel, target.level[0], target.level[1], vc, vf);
}

function outputGetBytes(target, parameter = "level", midiChannel = state.midiChannel) {
  const normalized = String(parameter || "level").toLowerCase();
  const pair = normalized === "mute" ? target.mute : target.level;
  if (!pair) throw new Error(`${target.label} heeft geen ${normalized}-parameter in deze bridge`);
  return nrpnGet(midiChannel, pair[0], pair[1]);
}

function channelFromToken(token) {
  const raw = String(token || "").trim().toLowerCase();
  const compact = raw.replace(/[\s_-]+/g, "");
  if (raw === "mega") return state.channels.megan;
  if (raw === "boy") return state.channels.booi;
  if (state.channels[raw]) return state.channels[raw];
  if (INPUT_ALIASES[compact]) {
    const alias = INPUT_ALIASES[compact];
    return { key: alias.key, label: alias.label, input: alias.inputs[0] };
  }
  const numeric = Number.parseInt(raw.replace(/^ip|^ch|^input/, ""), 10);
  if (Number.isFinite(numeric)) {
    const input = inputNumber(numeric);
    return { key: `ip${input}`, label: `Ip${input}`, input };
  }
  throw new Error(`Onbekend kanaal: ${token}`);
}

function channelsFromToken(token) {
  const raw = String(token || "").trim().toLowerCase();
  const compact = raw.replace(/[\s_-]+/g, "");
  if (INPUT_ALIASES[compact]) {
    const alias = INPUT_ALIASES[compact];
    return alias.inputs.map((input, index) => ({
      key: alias.inputs.length > 1 ? `${alias.key}${index + 1}` : alias.key,
      label: alias.inputs.length > 1 ? `${alias.label} ${index + 1}` : alias.label,
      input,
    }));
  }
  return [channelFromToken(token)];
}

function outputTargetFromToken(token) {
  const raw = String(token || "").trim().toLowerCase().replace(/[\s_-]+/g, "");
  if (OUTPUT_TARGETS[raw]) return OUTPUT_TARGETS[raw];
  const group = raw.match(/^gr(?:ou)?p([1-9]|1[0-2])$/);
  if (group) {
    const index = Number(group[1]);
    return {
      key: `group${index}`,
      label: `Group ${index}`,
      type: "group",
      index,
      mute: [0x00, 0x30 + index - 1],
      level: [0x40, 0x30 + index - 1],
    };
  }
  const aux = raw.match(/^aux(?:iliary)?([1-9]|1[0-2])$/);
  if (aux) {
    const index = Number(aux[1]);
    return {
      key: `aux${index}`,
      label: `Aux ${index}`,
      type: "aux",
      index,
      mute: [0x00, 0x45 + index - 1],
      level: [0x4f, index],
    };
  }
  const matrix = raw.match(/^(?:mtx|matrix)([1-3])$/);
  if (matrix) {
    const index = Number(matrix[1]);
    return {
      key: `mtx${index}`,
      label: `Matrix ${index}`,
      type: "matrix",
      index,
      mute: [0x00, 0x55 + index - 1],
      level: [0x4f, 0x11 + index - 1],
    };
  }
  const dca = raw.match(/^dca([1-8])$/);
  if (dca) {
    const index = Number(dca[1]);
    return {
      key: `dca${index}`,
      label: `DCA ${index}`,
      type: "dca",
      index,
      mute: [0x02, index - 1],
      level: [0x4f, 0x20 + index - 1],
    };
  }
  const fxSend = raw.match(/^(?:fxsend|fxsnd)([1-4])$/);
  if (fxSend) {
    const index = Number(fxSend[1]);
    return {
      key: `fxsend${index}`,
      label: `FX Send ${index}`,
      type: "fx-send",
      index,
      mute: [0x00, 0x51 + index - 1],
      level: [0x4f, 0x0d + index - 1],
    };
  }
  const fxReturn = raw.match(/^(?:fxreturn|fxrtn)([1-8])$/);
  if (fxReturn) {
    const index = Number(fxReturn[1]);
    return {
      key: `fxreturn${index}`,
      label: `FX Return ${index}`,
      type: "fx-return",
      index,
      mute: [0x00, 0x3c + index - 1],
      level: [0x40, 0x3c + index - 1],
    };
  }
  const muteGroup = raw.match(/^(?:mutegroup|mgrp|mg)([1-8])$/);
  if (muteGroup) {
    const index = Number(muteGroup[1]);
    return {
      key: `mutegroup${index}`,
      label: `Mute Group ${index}`,
      type: "mute-group",
      index,
      mute: [0x04, index - 1],
      level: null,
    };
  }
  throw new Error(`Onbekende output: ${token}`);
}

function maybeOutputTargetFromToken(token) {
  try {
    return outputTargetFromToken(token);
  } catch {
    return null;
  }
}

function commandCatalog() {
  const names = Object.values(state.channels)
    .map((channel) => channel.key)
    .concat(["mac", "studio", "macstudio", "minijack"])
    .join("|");
  return [
    {
      group: "OSC naar bridge",
      commands: [
        { address: "/sq/raw", args: "hex_string", description: "Stuurt rauwe A&H MIDI bytes naar TCP 51325." },
        { address: "/sq/scene", args: "scene_number", description: "Recall scene 1-300." },
        { address: "/sq/softkey", args: "key_number, action=tap|press|release", description: "Bedient SoftKey 1-16." },
        { address: `/sq/input/{${names}|1-48}/mute`, args: "0|1|toggle", description: "Mute uit/aan/toggle." },
        { address: `/sq/input/{${names}|1-48}/level`, args: "dB, destination=lr|aux1..aux12", description: "Fader/send level in dB." },
        { address: `/sq/input/{${names}|1-48}/level01`, args: "0..1, destination=lr|aux1..aux12", description: "Genormaliseerde level slider." },
        { address: `/sq/input/{${names}|1-48}/pan`, args: "-100..100, destination=lr|aux1..aux12", description: "Pan/balance." },
        { address: `/sq/input/{${names}|1-48}/assign`, args: "0|1|toggle, destination=lr|aux1..aux12", description: "Routing assign uit/aan/toggle." },
        { address: `/sq/input/{${names}|1-48}/get`, args: "mute|level|pan|assign, destination=lr|aux1..aux12", description: "Vraagt actuele waarde op." },
        { address: `/sq/input/{${names}|1-48}/{lr|aux1..aux12}/level`, args: "dB", description: "Destination als padsegment." },
        { address: `/sq/input/{${names}|1-48}/{lr|aux1..aux12}/level/inc`, args: "", description: "Level +1 dB." },
        { address: `/sq/input/{${names}|1-48}/{lr|aux1..aux12}/level/dec`, args: "", description: "Level -1 dB." },
        { address: `/sq/input/{${names}|1-48}/{lr|aux1..aux12}/pan/right`, args: "", description: "Pan stap naar rechts." },
        { address: `/sq/input/{${names}|1-48}/{lr|aux1..aux12}/pan/left`, args: "", description: "Pan stap naar links." },
        { address: "/sq/mics/mute", args: "0|1|toggle", description: "Mute/unmute Group 1, Mics." },
        { address: "/sq/muziek/mute", args: "0|1|toggle", description: "Mute/unmute Group 2, gevonden als Muziek." },
        { address: "/sq/sub/mute", args: "0|1|toggle", description: "Mute/unmute Matrix 1, gevonden als Sub." },
        { address: "/sq/main/mute", args: "0|1|toggle", description: "Mute/unmute Main LR." },
        { address: "/sq/group/{1-12}/mute", args: "0|1|toggle", description: "Mute/unmute een SQ group." },
        { address: "/sq/{mics|muziek|sub|main|group1..12|aux1..12|mtx1..3|dca1..8}/level", args: "dB", description: "Output fader level." },
        { address: "/sq/{mics|muziek|sub|main|group1..12|aux1..12|mtx1..3|dca1..8}/get", args: "mute|level", description: "Vraagt output mute/level op." },
      ],
    },
    {
      group: "HTTP naar bridge",
      commands: [
        { method: "GET", path: "/api/status", body: "", description: "Bridge-status, log en kanaalmapping." },
        { method: "GET/POST", path: "/api/sync", body: "", description: "Lees mute/level/pan/assign live uit de SQ-5." },
        { method: "POST", path: "/api/config", body: "{ mixerHost, mixerPort, midiChannel, faderLaw, channels }", description: "Wijzigt bridge-config." },
        { method: "POST", path: "/api/probe", body: "{ host? }", description: "TCP connect-test naar poort 51325." },
        { method: "POST", path: "/api/raw", body: "{ hex }", description: "Rauwe MIDI-hex versturen." },
        { method: "POST", path: "/api/scene", body: "{ scene }", description: "Scene recall." },
        { method: "POST", path: "/api/softkey", body: "{ softKey, action }", description: "SoftKey sturen." },
        { method: "POST", path: "/api/input/:name/mute", body: "{ muted: true|false|'toggle' }", description: "Input mute." },
        { method: "POST", path: "/api/input/:name/level", body: "{ db, destination }", description: "Input naar LR/Aux level." },
        { method: "POST", path: "/api/input/:name/level01", body: "{ value, destination }", description: "Input naar LR/Aux level 0..1." },
        { method: "POST", path: "/api/input/:name/pan", body: "{ pan, destination }", description: "Input naar LR/Aux pan." },
        { method: "POST", path: "/api/input/:name/assign", body: "{ assigned: true|false|'toggle', destination }", description: "Input routing assign." },
        { method: "POST", path: "/api/input/:name/get", body: "{ parameter, destination }", description: "Get mute/level/pan/assign." },
        { method: "POST", path: "/api/input/:name/nudge", body: "{ target: 'level'|'pan', direction, destination }", description: "Relatieve stap." },
        { method: "POST", path: "/api/output/:name/mute", body: "{ muted: true|false|'toggle' }", description: "Output mute." },
        { method: "POST", path: "/api/output/:name/level", body: "{ db }", description: "Output fader level." },
        { method: "POST", path: "/api/output/:name/get", body: "{ parameter: 'mute'|'level' }", description: "Get output mute/level." },
        { method: "GET", path: "/api/streamdeck/state", body: "", description: "Compacte mute-state voor Companion feedback." },
        { method: "POST", path: "/api/streamdeck/:target/mute", body: "", description: "Expliciet muten voor Stream Deck." },
        { method: "POST", path: "/api/streamdeck/:target/unmute", body: "", description: "Expliciet unmuten voor Stream Deck." },
        { method: "POST", path: "/api/streamdeck/:target/toggle", body: "", description: "Toggle op basis van de laatst bekende mixer-state." },
      ],
    },
    {
      group: "A&H MIDI templates",
      commands: [
        { name: "Scene", template: "BN 00 BK CN PG" },
        { name: "SoftKey press/release", template: "9N SK 7F / 8N SK 00" },
        { name: "Mute on/off", template: "BN 63 MB BN 62 LB BN 06 00 BN 26 01|00" },
        { name: "Level absolute", template: "BN 63 MB BN 62 LB BN 06 VC BN 26 VF" },
        { name: "Level +1/-1 dB", template: "BN 63 MB BN 62 LB BN 60|61 00" },
        { name: "Pan absolute", template: "BN 63 MB BN 62 LB BN 06 VC BN 26 VF" },
        { name: "Assign on/off", template: "BN 63 MB BN 62 LB BN 06 00 BN 26 01|00" },
        { name: "Get value", template: "BN 63 MB BN 62 LB BN 60 7F" },
      ],
    },
  ];
}

function addActivity(entry) {
  activity.unshift({
    at: new Date().toISOString(),
    ...entry,
  });
  activity = activity.slice(0, 150);
}

function channelKeyFromMeta(meta = {}) {
  if (meta.channelKey) return String(meta.channelKey);
  const input = Number(meta.input);
  const known = Object.values(state.channels).find((channel) => channel.input === input);
  if (known) return known.key;
  if (Number.isFinite(input)) return `ip${input}`;
  return "";
}

function ensureControlChannel(meta = {}) {
  const key = channelKeyFromMeta(meta);
  if (!key) return null;
  if (!controlState[key]) {
    controlState[key] = {
      key,
      label: meta.channel || key,
      input: Number(meta.input) || null,
      updatedAt: "",
      mute: null,
      destinations: {},
    };
  }
  controlState[key].label = meta.channel || controlState[key].label || key;
  controlState[key].input = Number(meta.input) || controlState[key].input || null;
  controlState[key].updatedAt = new Date().toISOString();
  return controlState[key];
}

function rememberControlValue(meta = {}, decoded = null) {
  const channel = ensureControlChannel(meta);
  if (!channel) return;
  const at = new Date().toISOString();

  if (decoded) {
    const parameter = String(decoded.parameter || "").toLowerCase();
    if (parameter === "mute") {
      channel.mute = { value: Boolean(decoded.value), display: decoded.display, updatedAt: at };
      return;
    }
    const destination = normalizedDestinationKey(meta.destination || state.defaultDestination);
    channel.destinations[destination] = channel.destinations[destination] || {};
    channel.destinations[destination][parameter] = { value: decoded.value, display: decoded.display, updatedAt: at };
    return;
  }

  const action = String(meta.action || "").toLowerCase();
  if (action === "mute" && typeof meta.value === "boolean") {
    channel.mute = { value: meta.value, display: meta.value ? "mute: on" : "mute: off", updatedAt: at };
    return;
  }

  const destination = normalizedDestinationKey(meta.destination || state.defaultDestination);
  channel.destinations[destination] = channel.destinations[destination] || {};
  if (action === "level" && Number.isFinite(Number(meta.db))) {
    const value = Number(meta.db);
    channel.destinations[destination].level = { value, display: `level: ${value.toFixed(1)} dB`, updatedAt: at };
  } else if (action === "level01" && Number.isFinite(Number(meta.value))) {
    const value = -60 + clampNumber(meta.value, 0, 1) * 70;
    channel.destinations[destination].level = { value, display: `level: ${value.toFixed(1)} dB`, updatedAt: at };
  } else if (action === "pan" && Number.isFinite(Number(meta.pan))) {
    const value = Number(meta.pan);
    channel.destinations[destination].pan = { value, display: `pan: ${value.toFixed(1)}%`, updatedAt: at };
  } else if (action === "assign" && typeof meta.value === "boolean") {
    channel.destinations[destination].assign = { value: meta.value, display: meta.value ? "assign: on" : "assign: off", updatedAt: at };
  }
}

function publicState() {
  return {
    toolHost: TOOL_HOST,
    toolPort: TOOL_PORT,
    mixerHost: state.mixerHost,
    mixerPort: state.mixerPort,
    midiChannel: state.midiChannel,
    faderLaw: state.faderLaw,
    oscListenAddress: state.oscListenAddress,
    oscListenPort: state.oscListenPort,
    defaultDestination: state.defaultDestination,
    remoteAllowed: ALLOW_REMOTE,
    tokenProtected: !!CONTROL_TOKEN,
    channels: state.channels,
    controlState,
    lastSyncAt,
    lastStreamdeckSyncAt,
    syncInProgress,
    streamdeckSyncInProgress,
    statusPollMs: STATUS_POLL_MS,
    streamdeckPollMs: STREAMDECK_POLL_MS,
    activity,
    commands: commandCatalog(),
  };
}

function latestIsoTimestamp(values) {
  return values.filter(Boolean).sort().pop() || "";
}

function streamdeckTargetFromToken(token) {
  const raw = String(token || "").trim().toLowerCase().replace(/[\s_-]+/g, "");
  if (raw === "allmic" || raw === "allmics" || raw === "micall" || raw === "micsall") return STREAMDECK_TARGETS.allmics;
  if (STREAMDECK_TARGETS[raw]) return STREAMDECK_TARGETS[raw];
  throw new Error(`Onbekende Stream Deck target: ${token}`);
}

function streamdeckValueForTarget(target) {
  const states = target.stateKeys.map((key) => controlState[key]).filter(Boolean);
  const muteValues = states
    .map((channel) => (channel.mute && typeof channel.mute.value === "boolean" ? channel.mute.value : null))
    .filter((value) => typeof value === "boolean");
  const updatedAt = latestIsoTimestamp(states.map((channel) => channel.mute && channel.mute.updatedAt).concat(states.map((channel) => channel.updatedAt)));
  return {
    muted: muteValues.length ? muteValues.every(Boolean) : null,
    mixed: muteValues.length > 1 && muteValues.some(Boolean) && !muteValues.every(Boolean),
    updatedAt,
  };
}

function streamdeckState() {
  const result = {
    updatedAt: new Date().toISOString(),
    lastSyncAt,
    lastStreamdeckSyncAt,
  };

  for (const target of Object.values(STREAMDECK_TARGETS)) {
    const value = streamdeckValueForTarget(target);
    result[target.key] = value.muted;
    result[`${target.key}Mixed`] = value.mixed;
    result[`${target.key}UpdatedAt`] = value.updatedAt;
  }

  return result;
}

function sendJson(res, status, body) {
  const payload = JSON.stringify(body, null, 2);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(payload),
  });
  res.end(payload);
}

function requestControlToken(req, url) {
  const headerToken = String(req.headers["x-sq5-control-token"] || "").trim();
  if (headerToken) return headerToken;
  const auth = String(req.headers.authorization || "").trim();
  const bearer = auth.match(/^Bearer\s+(.+)$/i);
  if (bearer) return String(bearer[1] || "").trim();
  return String(url.searchParams.get("token") || url.searchParams.get("controlToken") || "").trim();
}

function isControlRequestAllowed(req, url) {
  if (!CONTROL_TOKEN) return true;
  return requestControlToken(req, url) === CONTROL_TOKEN;
}

function rejectUnauthorized(res) {
  sendJson(res, 401, { error: "sq5_control_token_required" });
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > 1024 * 1024) {
        reject(new Error("Request te groot"));
        req.destroy();
      }
    });
    req.on("end", () => {
      if (!body.trim()) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(body));
      } catch {
        reject(new Error("Ongeldige JSON"));
      }
    });
    req.on("error", reject);
  });
}

function finishMidiPending(error) {
  const pending = midiClient.pending;
  if (!pending) return;
  midiClient.pending = null;
  pending.finish(error);
}

function destroyMidiSocket() {
  if (midiClient.socket) {
    try {
      midiClient.socket.destroy();
    } catch {}
  }
  midiClient.socket = null;
  midiClient.connected = false;
  midiClient.connecting = null;
}

function handleMidiData(chunk) {
  if (midiClient.pending) {
    midiClient.pending.onData(chunk);
  }
}

function ensureMidiSocket(host = state.mixerHost, port = state.mixerPort) {
  if (!host) return Promise.reject(new Error("Mixer IP ontbreekt"));
  if (midiClient.socket && midiClient.connected && midiClient.host === host && midiClient.port === port) {
    return Promise.resolve(midiClient.socket);
  }
  if (midiClient.connecting && midiClient.host === host && midiClient.port === port) return midiClient.connecting;

  destroyMidiSocket();
  midiClient.host = host;
  midiClient.port = port;

  midiClient.connecting = new Promise((resolve, reject) => {
    const socket = net.createConnection({ host, port });
    let settled = false;
    const settleConnection = (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) {
        midiClient.lastError = error.message || String(error);
        destroyMidiSocket();
        reject(error);
        return;
      }
      midiClient.connected = true;
      midiClient.connecting = null;
      midiClient.lastError = "";
      resolve(socket);
    };
    const timer = setTimeout(() => {
      settleConnection(new Error(`TCP timeout naar ${host}:${port}`));
    }, TCP_TIMEOUT_MS);

    socket.setNoDelay(true);
    socket.setKeepAlive(true, 1000);
    midiClient.socket = socket;

    socket.on("connect", () => {
      settleConnection();
    });
    socket.on("data", handleMidiData);
    socket.on("error", (error) => {
      midiClient.lastError = error.message || String(error);
      settleConnection(error);
      finishMidiPending(error);
    });
    socket.on("close", () => {
      midiClient.connected = false;
      if (midiClient.socket === socket) midiClient.socket = null;
      settleConnection(new Error(midiClient.lastError || "TCP verbinding gesloten"));
      finishMidiPending(new Error(midiClient.lastError || "TCP verbinding gesloten"));
    });
  });

  return midiClient.connecting;
}

function transmitTcpOnce(bytes, host = state.mixerHost, port = state.mixerPort) {
  return new Promise((resolve, reject) => {
    ensureMidiSocket(host, port)
      .then((socket) => {
        const received = [];
        let settled = false;
        let quietTimer = null;
        const timeoutTimer = setTimeout(() => finish(new Error(`TCP timeout naar ${host}:${port}`)), TCP_TIMEOUT_MS);

        const armQuietTimer = () => {
          clearTimeout(quietTimer);
          quietTimer = setTimeout(() => finish(), MIDI_RESPONSE_WINDOW_MS);
        };

        const finish = (error) => {
          if (settled) return;
          settled = true;
          clearTimeout(quietTimer);
          clearTimeout(timeoutTimer);
          if (midiClient.pending && midiClient.pending.finish === finish) midiClient.pending = null;
          if (error) {
            destroyMidiSocket();
            reject(error);
            return;
          }
          resolve({
            receivedBytes: Buffer.concat(received).toString("hex").toUpperCase().replace(/(..)/g, "$1 ").trim(),
          });
        };

        midiClient.pending = {
          finish,
          onData: (chunk) => {
            received.push(chunk);
            armQuietTimer();
          },
        };

        socket.write(Buffer.from(bytes), (error) => {
          if (error) {
            finish(error);
            return;
          }
          armQuietTimer();
        });
      })
      .catch(reject);
  });
}

function transmitTcp(bytes, host = state.mixerHost, port = state.mixerPort) {
  const run = () => transmitTcpOnce(bytes, host, port);
  midiClient.queue = midiClient.queue.catch(() => {}).then(run);
  return midiClient.queue;
}

function probeTcp(host = state.mixerHost, port = state.mixerPort) {
  return new Promise((resolve, reject) => {
    if (!host) {
      reject(new Error("Mixer IP ontbreekt"));
      return;
    }
    const socket = net.createConnection({ host, port });
    let settled = false;
    const finish = (error) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      if (error) reject(error);
      else {
        if (host !== midiClient.host || port !== midiClient.port) destroyMidiSocket();
        resolve({ ok: true, host, port });
      }
    };
    socket.setTimeout(TCP_TIMEOUT_MS);
    socket.on("connect", () => finish());
    socket.on("timeout", () => finish(new Error(`TCP timeout naar ${host}:${port}`)));
    socket.on("error", finish);
  });
}

async function sendMidi(bytes, meta = {}) {
  const hex = bytesToHex(bytes);
  if (!state.mixerHost) {
    const entry = { status: "preview", hex, message: "Mixer IP ontbreekt; niet verzonden.", ...meta };
    addActivity(entry);
    return { sent: false, ...entry };
  }

  try {
    const result = await transmitTcp(bytes);
    const decoded = decodeResponseValue(result.receivedBytes, meta);
    if (decoded) rememberControlValue(meta, decoded);
    else rememberControlValue(meta);
    const response = decoded ? decoded.display : "";
    const entry = { status: "sent", hex, receivedBytes: result.receivedBytes, response, decoded, ...meta };
    if (!meta.silent) addActivity(entry);
    return { sent: true, ...entry };
  } catch (error) {
    const entry = { status: "error", hex, message: error.message || String(error), ...meta };
    if (!meta.silent) addActivity(entry);
    const wrapped = new Error(entry.message);
    wrapped.entry = entry;
    throw wrapped;
  }
}

function updateConfig(payload) {
  let shouldResetControlState = false;
  if (Object.prototype.hasOwnProperty.call(payload, "mixerHost")) {
    const nextHost = String(payload.mixerHost || "").trim();
    if (nextHost !== state.mixerHost) shouldResetControlState = true;
    state.mixerHost = nextHost;
  }
  if (Object.prototype.hasOwnProperty.call(payload, "mixerPort")) {
    const nextPort = clampInt(payload.mixerPort, 1, 65535);
    if (nextPort !== state.mixerPort) shouldResetControlState = true;
    state.mixerPort = nextPort;
  }
  if (Object.prototype.hasOwnProperty.call(payload, "midiChannel")) {
    const nextChannel = clampInt(payload.midiChannel, 1, 16);
    if (nextChannel !== state.midiChannel) shouldResetControlState = true;
    state.midiChannel = nextChannel;
  }
  if (Object.prototype.hasOwnProperty.call(payload, "faderLaw")) {
    state.faderLaw = String(payload.faderLaw || "linear").toLowerCase() === "audio" ? "audio" : "linear";
  }
  if (Object.prototype.hasOwnProperty.call(payload, "defaultDestination")) {
    state.defaultDestination = parseDestination(payload.defaultDestination).label.toLowerCase();
  }
  if (payload.channels && typeof payload.channels === "object") {
    for (const key of Object.keys(state.channels)) {
      const incoming = payload.channels[key] || {};
      if (Object.prototype.hasOwnProperty.call(incoming, "input")) {
        const nextInput = clampInt(incoming.input, 1, 48);
        if (nextInput !== state.channels[key].input) shouldResetControlState = true;
        state.channels[key].input = nextInput;
      }
      if (Object.prototype.hasOwnProperty.call(incoming, "label")) state.channels[key].label = String(incoming.label || state.channels[key].label).trim();
    }
  }
  if (Object.prototype.hasOwnProperty.call(payload, "oscListenPort")) {
    const nextPort = clampInt(payload.oscListenPort, 1, 65535);
    if (nextPort !== state.oscListenPort) {
      state.oscListenPort = nextPort;
      openOscPort();
    }
  }
  if (shouldResetControlState) controlState = {};
}

async function handleSingleInputAction(channel, action, payload = {}, source = "http", extraMeta = {}) {
  const destination = payload.destination || state.defaultDestination || "lr";
  let bytes;
  let detail = {};

  if (action === "mute") {
    const value = payload.muted === "toggle" || payload.toggle ? "toggle" : Boolean(payload.muted);
    bytes = inputMuteBytes(channel.input, value);
    detail = { action: "mute", value };
  } else if (action === "level") {
    const db = clampNumber(payload.db ?? payload.value ?? 0, -90, 10);
    bytes = inputLevelBytes(channel.input, db, destination);
    detail = { action: "level", db, destination };
  } else if (action === "level01") {
    const value = clampNumber(payload.value ?? payload.level ?? 0, 0, 1);
    bytes = inputLevelUnitBytes(channel.input, value, destination);
    detail = { action: "level01", value, destination };
  } else if (action === "pan") {
    const pan = clampNumber(payload.pan ?? payload.value ?? 0, -100, 100);
    bytes = inputPanBytes(channel.input, pan, destination);
    detail = { action: "pan", pan, destination };
  } else if (action === "assign") {
    const value = payload.assigned === "toggle" || payload.toggle ? "toggle" : Boolean(payload.assigned);
    bytes = inputAssignBytes(channel.input, value, destination);
    detail = { action: "assign", value, destination };
  } else if (action === "get") {
    const parameter = String(payload.parameter || "level").toLowerCase();
    bytes = inputGetBytes(channel.input, parameter, destination);
    detail = { action: "get", parameter, destination };
  } else if (action === "nudge") {
    const target = String(payload.target || "level").toLowerCase();
    const direction = String(payload.direction || "inc").toLowerCase();
    bytes = inputRelativeBytes(channel.input, target, direction, destination);
    detail = { action: "nudge", target, direction, destination };
  } else {
    throw new Error(`Onbekende inputactie: ${action}`);
  }

  return sendMidi(bytes, {
    source,
    channel: channel.label,
    channelKey: channel.key,
    input: channel.input,
    ...extraMeta,
    ...detail,
  });
}

async function handleInputAction(name, action, payload = {}, source = "http", extraMeta = {}) {
  const channels = channelsFromToken(name);
  if (channels.length === 1) return handleSingleInputAction(channels[0], action, payload, source, extraMeta);

  const results = [];
  for (const channel of channels) {
    results.push(await handleSingleInputAction(channel, action, payload, source, extraMeta));
  }
  return {
    sent: results.every((result) => result.sent),
    status: results.every((result) => result.status === "sent") ? "sent" : "partial",
    linked: true,
    source,
    action,
    channel: channels.map((channel) => channel.label).join(", "),
    channelKey: String(name || "").trim().toLowerCase().replace(/[\s_-]+/g, ""),
    inputs: channels.map((channel) => channel.input),
    results,
  };
}

async function handleOutputAction(name, action, payload = {}, source = "http", extraMeta = {}) {
  const target = outputTargetFromToken(name);
  let bytes;
  let detail = {};

  if (action === "mute") {
    const value = payload.muted === "toggle" || payload.toggle ? "toggle" : Boolean(payload.muted);
    bytes = outputMuteBytes(target, value);
    detail = { action: "mute", value };
  } else if (action === "level") {
    const db = clampNumber(payload.db ?? payload.value ?? 0, -90, 10);
    bytes = outputLevelBytes(target, db);
    detail = { action: "level", db, destination: "lr" };
  } else if (action === "get") {
    const parameter = String(payload.parameter || "level").toLowerCase();
    bytes = outputGetBytes(target, parameter);
    detail = { action: "get", parameter, destination: "lr" };
  } else {
    throw new Error(`Onbekende outputactie: ${action}`);
  }

  return sendMidi(bytes, {
    source,
    channel: target.label,
    channelKey: target.key,
    input: null,
    ...extraMeta,
    ...detail,
  });
}

async function handleStreamdeckAction(name, action, payload = {}, source = "http") {
  const target = streamdeckTargetFromToken(name);
  const normalizedAction = String(action || "").trim().toLowerCase();
  let muted;

  if (normalizedAction === "mute") muted = true;
  else if (normalizedAction === "unmute") muted = false;
  else if (normalizedAction === "toggle") {
    const current = streamdeckValueForTarget(target);
    muted = current.muted === true ? false : true;
  } else {
    throw new Error(`Onbekende Stream Deck actie: ${action}`);
  }

  const results = [];
  for (const item of target.names) {
    if (target.kind === "output") {
      results.push(await handleOutputAction(item, "mute", { muted }, source, { streamdeckTarget: target.key }));
    } else {
      results.push(await handleInputAction(item, "mute", { muted }, source, { streamdeckTarget: target.key }));
    }
  }

  addActivity({
    status: "sent",
    source,
    action: `streamdeck:${normalizedAction}`,
    channel: target.label,
    value: muted,
    message: `${target.label}: ${muted ? "mute" : "unmute"}`,
  });

  return {
    sent: results.every((result) => result.sent),
    status: results.every((result) => result.status === "sent") ? "sent" : "partial",
    target: target.key,
    muted,
    results,
    state: streamdeckState(),
  };
}

async function syncMixerState({ force = false } = {}) {
  if (!state.mixerHost) return publicState();
  if (syncInProgress && !force) return publicState();

  syncInProgress = true;
  try {
    for (const token of SYNC_INPUT_TOKENS) {
      await handleInputAction(token, "get", { parameter: "mute" }, "sync", { silent: true });
      await handleInputAction(token, "get", { parameter: "level", destination: "lr" }, "sync", { silent: true });
    }
    for (const token of SYNC_OUTPUT_TOKENS) {
      await handleOutputAction(token, "get", { parameter: "mute" }, "sync", { silent: true });
      await handleOutputAction(token, "get", { parameter: "level" }, "sync", { silent: true });
    }
    lastSyncAt = new Date().toISOString();
  } catch (error) {
    addActivity({ status: "error", source: "sync", message: error.message || String(error) });
  } finally {
    syncInProgress = false;
  }
  return publicState();
}

async function syncStreamdeckMuteState({ force = false } = {}) {
  if (!state.mixerHost) return streamdeckState();
  if (streamdeckSyncInProgress && !force) return streamdeckState();

  streamdeckSyncInProgress = true;
  try {
    await handleInputAction("brent", "get", { parameter: "mute" }, "streamdeck-sync", { silent: true });
    await handleInputAction("megan", "get", { parameter: "mute" }, "streamdeck-sync", { silent: true });
    await handleInputAction("booi", "get", { parameter: "mute" }, "streamdeck-sync", { silent: true });
    await handleOutputAction("main", "get", { parameter: "mute" }, "streamdeck-sync", { silent: true });
    lastStreamdeckSyncAt = new Date().toISOString();
  } catch (error) {
    addActivity({ status: "error", source: "streamdeck-sync", message: error.message || String(error) });
  } finally {
    streamdeckSyncInProgress = false;
  }
  return streamdeckState();
}

function startStatePolling() {
  if (syncTimer) clearInterval(syncTimer);
  syncTimer = setInterval(() => {
    syncMixerState().catch((error) => {
      addActivity({ status: "error", source: "sync", message: error.message || String(error) });
    });
  }, STATUS_POLL_MS);
  setTimeout(() => {
    syncMixerState().catch((error) => {
      addActivity({ status: "error", source: "sync", message: error.message || String(error) });
    });
  }, 250);
}

function startStreamdeckPolling() {
  if (streamdeckSyncTimer) clearInterval(streamdeckSyncTimer);
  streamdeckSyncTimer = setInterval(() => {
    syncStreamdeckMuteState().catch((error) => {
      addActivity({ status: "error", source: "streamdeck-sync", message: error.message || String(error) });
    });
  }, STREAMDECK_POLL_MS);
  setTimeout(() => {
    syncStreamdeckMuteState().catch((error) => {
      addActivity({ status: "error", source: "streamdeck-sync", message: error.message || String(error) });
    });
  }, 100);
}

async function routeApi(req, res, url) {
  if (req.method === "GET" && url.pathname === "/api/status") {
    sendJson(res, 200, publicState());
    return;
  }

  if ((req.method === "GET" || req.method === "POST") && url.pathname === "/api/sync") {
    const result = await syncMixerState({ force: req.method === "POST" });
    sendJson(res, 200, result);
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/streamdeck/state") {
    sendJson(res, 200, streamdeckState());
    return;
  }

  const payload = await readJson(req);

  if (req.method === "POST" && url.pathname === "/api/config") {
    updateConfig(payload);
    addActivity({ status: "config", message: "Config bijgewerkt", source: "http" });
    sendJson(res, 200, publicState());
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/probe") {
    const host = String(payload.host || state.mixerHost || "").trim();
    const port = clampInt(payload.port || state.mixerPort, 1, 65535);
    const result = await probeTcp(host, port);
    addActivity({ status: "ok", source: "http", action: "probe", message: `TCP open op ${host}:${port}` });
    sendJson(res, 200, result);
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/raw") {
    const bytes = parseHex(payload.hex);
    const result = await sendMidi(bytes, { source: "http", action: "raw" });
    sendJson(res, 200, result);
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/scene") {
    const scene = clampInt(payload.scene, 1, 300);
    const result = await sendMidi(sceneRecallBytes(scene), { source: "http", action: "scene", scene });
    sendJson(res, 200, result);
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/softkey") {
    const softKey = clampInt(payload.softKey || payload.key, 1, 16);
    const action = String(payload.action || "tap");
    const result = await sendMidi(softKeyBytes(softKey, action), { source: "http", action: "softkey", softKey, softKeyAction: action });
    sendJson(res, 200, result);
    return;
  }

  const streamdeckMatch = url.pathname.match(/^\/api\/streamdeck\/([^/]+)\/([^/]+)$/);
  if (req.method === "POST" && streamdeckMatch) {
    const result = await handleStreamdeckAction(decodeURIComponent(streamdeckMatch[1]), decodeURIComponent(streamdeckMatch[2]), payload, "streamdeck");
    sendJson(res, 200, result);
    return;
  }

  const inputMatch = url.pathname.match(/^\/api\/input\/([^/]+)\/([^/]+)$/);
  if (req.method === "POST" && inputMatch) {
    const result = await handleInputAction(decodeURIComponent(inputMatch[1]), decodeURIComponent(inputMatch[2]), payload);
    sendJson(res, 200, result);
    return;
  }

  const outputMatch = url.pathname.match(/^\/api\/output\/([^/]+)\/([^/]+)$/);
  if (req.method === "POST" && outputMatch) {
    const result = await handleOutputAction(decodeURIComponent(outputMatch[1]), decodeURIComponent(outputMatch[2]), payload);
    sendJson(res, 200, result);
    return;
  }

  sendJson(res, 404, { error: "not_found" });
}

function argValue(arg) {
  if (arg && typeof arg === "object" && Object.prototype.hasOwnProperty.call(arg, "value")) return arg.value;
  return arg;
}

function truthyOsc(value) {
  const raw = argValue(value);
  if (String(raw).toLowerCase() === "toggle") return "toggle";
  return raw === true || raw === 1 || raw === "1" || String(raw).toLowerCase() === "true" || String(raw).toLowerCase() === "on";
}

async function handleOscMessage(message) {
  const address = String(message.address || "");
  const parts = address.split("/").filter(Boolean).map((part) => decodeURIComponent(part));
  const args = Array.isArray(message.args) ? message.args.map(argValue) : [];
  if (parts[0] !== "sq") return;

  try {
    if (parts[1] === "raw") {
      const bytes = parseHex(args[0]);
      await sendMidi(bytes, { source: "osc", oscAddress: address, action: "raw" });
      return;
    }

    if (parts[1] === "scene") {
      const scene = clampInt(args[0], 1, 300);
      await sendMidi(sceneRecallBytes(scene), { source: "osc", oscAddress: address, action: "scene", scene });
      return;
    }

    if (parts[1] === "softkey") {
      const softKey = clampInt(args[0], 1, 16);
      const action = String(args[1] || "tap");
      await sendMidi(softKeyBytes(softKey, action), { source: "osc", oscAddress: address, action: "softkey", softKey, softKeyAction: action });
      return;
    }

    const directOutputTarget =
      parts.length >= 3 && !["input", "raw", "scene", "softkey", "group"].includes(parts[1])
        ? maybeOutputTargetFromToken(parts[1])
        : null;
    if (directOutputTarget) {
      const action = parts[2];
      const payload = {};
      if (action === "mute") payload.muted = args.length ? truthyOsc(args[0]) : "toggle";
      if (action === "level") payload.db = args[0];
      if (action === "get") payload.parameter = args[0] || "level";
      await handleOutputAction(parts[1], action, payload, "osc", { oscAddress: address });
      return;
    }

    if (parts[1] === "group" && parts.length >= 4) {
      const action = parts[3];
      const payload = {};
      if (action === "mute") payload.muted = args.length ? truthyOsc(args[0]) : "toggle";
      if (action === "level") payload.db = args[0];
      if (action === "get") payload.parameter = args[0] || "level";
      await handleOutputAction(`group${parts[2]}`, action, payload, "osc", { oscAddress: address });
      return;
    }

    if (parts[1] !== "input" || parts.length < 4) {
      throw new Error(`Onbekend OSC-adres: ${address}`);
    }

    const name = parts[2];
    let destination = state.defaultDestination;
    let action = parts[3];
    let subAction = parts[4];

    if (parts.length >= 5 && /^(lr|main|mainlr|aux(?:iliary)?(?:[1-9]|1[0-2]))$/i.test(parts[3])) {
      destination = parts[3];
      action = parts[4];
      subAction = parts[5];
    }

    const payload = { destination };
    if (action === "mute") payload.muted = args.length ? truthyOsc(args[0]) : "toggle";
    if (action === "level") {
      if (subAction === "inc" || subAction === "dec") {
        await handleInputAction(name, "nudge", { destination, target: "level", direction: subAction }, "osc", { oscAddress: address });
        return;
      }
      payload.db = args[0];
    }
    if (action === "level01") payload.value = args[0];
    if (action === "pan") {
      if (subAction === "left" || subAction === "right") {
        await handleInputAction(name, "nudge", { destination, target: "pan", direction: subAction }, "osc", { oscAddress: address });
        return;
      }
      payload.pan = args[0];
    }
    if (action === "assign") payload.assigned = args.length ? truthyOsc(args[0]) : "toggle";
    if (action === "get") {
      payload.parameter = args[0] || "level";
      if (args[1]) payload.destination = args[1];
    }

    const mappedAction = action === "level01" ? "level01" : action;
    await handleInputAction(name, mappedAction, payload, "osc", { oscAddress: address });
  } catch (error) {
    addActivity({ status: "error", source: "osc", oscAddress: address, message: error.message || String(error) });
  }
}

function openOscPort() {
  if (oscPort) {
    try {
      oscPort.close();
    } catch {}
    oscPort = null;
  }

  oscPort = new osc.UDPPort({
    localAddress: state.oscListenAddress,
    localPort: state.oscListenPort,
    metadata: true,
  });

  oscPort.on("ready", () => {
    addActivity({ status: "ok", source: "osc", message: `OSC luistert op ${state.oscListenAddress}:${state.oscListenPort}` });
  });
  oscPort.on("message", (message) => {
    handleOscMessage(message);
  });
  oscPort.on("error", (error) => {
    addActivity({ status: "error", source: "osc", message: error.message || String(error) });
  });
  oscPort.open();
}

function html() {
  return `<!doctype html>
<html lang="nl">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>SQ5 Control</title>
  <style>
    :root {
      color-scheme: light;
      --bg: #f4f2ed;
      --panel: #ffffff;
      --ink: #222222;
      --muted: #6d6a62;
      --line: #d9d3c8;
      --accent: #0f766e;
      --accent-dark: #115e59;
      --danger: #b42318;
      --warn: #a15c07;
      --ok: #16703a;
      --shadow: 0 12px 30px rgba(45, 38, 28, 0.08);
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      background: var(--bg);
      color: var(--ink);
      font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    }
    main {
      width: min(1440px, calc(100vw - 32px));
      margin: 0 auto;
      padding: 24px 0 40px;
    }
    header {
      display: flex;
      justify-content: space-between;
      gap: 16px;
      align-items: end;
      margin-bottom: 18px;
    }
    h1, h2, h3 { margin: 0; line-height: 1.1; letter-spacing: 0; }
    h1 { font-size: 28px; }
    h2 { font-size: 18px; margin-bottom: 12px; }
    h3 { font-size: 15px; }
    .source-links { display: flex; gap: 10px; flex-wrap: wrap; justify-content: flex-end; }
    a { color: var(--accent-dark); text-decoration: none; font-weight: 700; }
    .grid { display: grid; gap: 14px; }
    .top-grid { grid-template-columns: minmax(320px, 1.2fr) minmax(320px, 0.8fr); align-items: start; }
    .channels {
      display: flex;
      gap: 10px;
      align-items: stretch;
      overflow-x: auto;
      padding: 2px 2px 12px;
      scrollbar-color: var(--line) transparent;
    }
    .panel {
      background: var(--panel);
      border: 1px solid var(--line);
      border-radius: 8px;
      box-shadow: var(--shadow);
      padding: 16px;
    }
    .row {
      display: flex;
      gap: 10px;
      align-items: center;
      flex-wrap: wrap;
    }
    .form-grid {
      display: grid;
      grid-template-columns: repeat(5, minmax(110px, 1fr));
      gap: 10px;
      align-items: end;
    }
    label { display: grid; gap: 5px; font-size: 12px; color: var(--muted); font-weight: 700; }
    input, select, button, textarea {
      font: inherit;
      border-radius: 6px;
      border: 1px solid var(--line);
      min-height: 38px;
    }
    input, select, textarea { background: #fffefa; color: var(--ink); padding: 8px 10px; width: 100%; }
    button {
      background: var(--accent);
      color: white;
      border-color: var(--accent-dark);
      padding: 8px 12px;
      font-weight: 800;
      cursor: pointer;
    }
    button.secondary { background: #f8f5ef; color: var(--ink); border-color: var(--line); }
    button.danger { background: var(--danger); border-color: #7a271a; }
    button.tiny { min-height: 30px; padding: 4px 8px; font-size: 12px; }
    .status {
      display: inline-flex;
      align-items: center;
      min-height: 30px;
      padding: 5px 9px;
      border-radius: 6px;
      border: 1px solid var(--line);
      background: #fbf8f1;
      color: var(--muted);
      font-size: 12px;
      font-weight: 700;
    }
    .status.ok { color: var(--ok); }
    .status.error { color: var(--danger); }
    .status.preview { color: var(--warn); }
    .channel-head {
      display: flex;
      justify-content: space-between;
      gap: 8px;
      align-items: center;
      margin-bottom: 12px;
    }
    .channel-name { font-size: 22px; font-weight: 900; }
    .input-number { width: 86px; }
    .slider-row {
      display: grid;
      grid-template-columns: 72px 1fr 58px;
      gap: 10px;
      align-items: center;
      margin: 10px 0;
      min-height: 38px;
    }
    input[type="range"] {
      padding: 0;
      accent-color: var(--accent);
      min-height: 30px;
    }
    .value-pill {
      min-width: 54px;
      padding: 5px 7px;
      border: 1px solid var(--line);
      background: #fbf8f1;
      border-radius: 6px;
      font-size: 12px;
      font-weight: 800;
      text-align: right;
      font-variant-numeric: tabular-nums;
    }
    .switches {
      display: grid;
      grid-template-columns: repeat(2, 1fr);
      gap: 8px;
      margin: 12px 0;
    }
    .toggle {
      display: flex;
      gap: 8px;
      align-items: center;
      justify-content: center;
      border: 1px solid var(--line);
      border-radius: 6px;
      padding: 8px;
      font-size: 13px;
      font-weight: 800;
      background: #fbf8f1;
      min-height: 38px;
    }
    .toggle input { width: 16px; min-height: 16px; accent-color: var(--accent); }
    .mixer-panel {
      background: #ebe7df;
      border: 1px solid var(--line);
      border-radius: 8px;
      padding: 12px;
      box-shadow: var(--shadow);
    }
    .mixer-head {
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 12px;
      margin-bottom: 10px;
    }
    .mixer-head .status { white-space: nowrap; }
    .fader-strip {
      flex: 0 0 108px;
      min-height: 430px;
      display: grid;
      grid-template-rows: auto 1fr auto;
      gap: 10px;
      padding: 10px;
      border: 1px solid #c9c1b5;
      border-radius: 8px;
      background: #fffefa;
    }
    .fader-strip.output { background: #f8fbfb; }
    .fader-strip.linked { background: #fffaf0; }
    .strip-title {
      display: grid;
      gap: 5px;
      min-height: 92px;
    }
    .strip-name {
      font-size: 14px;
      font-weight: 950;
      line-height: 1.12;
      color: var(--ink);
      overflow-wrap: anywhere;
    }
    .strip-meta {
      font-size: 10px;
      font-weight: 850;
      color: var(--muted);
      line-height: 1.2;
      overflow-wrap: anywhere;
    }
    .strip-live {
      font-size: 10px;
      min-height: 24px;
      padding: 4px 6px;
    }
    .fader-zone {
      display: grid;
      grid-template-rows: auto 1fr auto;
      justify-items: center;
      gap: 8px;
      min-height: 270px;
    }
    .vertical-fader {
      writing-mode: vertical-lr;
      direction: rtl;
      width: 38px;
      height: 235px;
      min-height: 235px;
      padding: 0;
      margin: 0;
    }
    .fader-db {
      min-width: 72px;
      text-align: center;
      font-size: 13px;
    }
    .strip-actions {
      display: grid;
      gap: 7px;
    }
    .strip-actions .toggle {
      min-height: 32px;
      padding: 6px;
      font-size: 12px;
    }
    .strip-input {
      display: grid;
      grid-template-columns: 1fr;
      gap: 4px;
      color: var(--muted);
      font-size: 10px;
      font-weight: 850;
    }
    .strip-input input {
      min-height: 30px;
      padding: 4px 6px;
      text-align: center;
    }
    .strip-route {
      min-height: 28px;
      display: grid;
      place-items: center;
      border: 1px solid var(--line);
      border-radius: 6px;
      background: #fbf8f1;
      color: var(--muted);
      font-size: 10px;
      font-weight: 900;
      text-align: center;
      padding: 4px;
    }
    details {
      border-top: 1px solid var(--line);
      padding-top: 10px;
      margin-top: 12px;
    }
    summary { cursor: pointer; font-weight: 900; color: var(--accent-dark); }
    .aux-grid {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 7px 10px;
      margin-top: 10px;
    }
    .aux-row {
      display: grid;
      grid-template-columns: 46px 1fr 48px;
      gap: 6px;
      align-items: center;
      font-size: 12px;
    }
    textarea { min-height: 78px; resize: vertical; font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; }
    pre, code {
      font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
      font-size: 12px;
    }
    .catalog {
      display: grid;
      grid-template-columns: repeat(3, minmax(260px, 1fr));
      gap: 14px;
    }
    .cmd-list {
      display: grid;
      gap: 7px;
    }
    .cmd {
      border: 1px solid var(--line);
      border-radius: 6px;
      background: #fffefa;
      padding: 8px;
      display: grid;
      gap: 5px;
    }
    .cmd strong { font-size: 12px; overflow-wrap: anywhere; }
    .cmd span { color: var(--muted); font-size: 12px; overflow-wrap: anywhere; }
    .log {
      display: grid;
      gap: 8px;
      max-height: 420px;
      overflow: auto;
      padding-right: 4px;
    }
    .log-entry {
      border: 1px solid var(--line);
      border-left: 5px solid var(--muted);
      border-radius: 6px;
      padding: 8px;
      background: #fffefa;
    }
    .log-entry.sent, .log-entry.ok { border-left-color: var(--ok); }
    .log-entry.error { border-left-color: var(--danger); }
    .log-entry.preview { border-left-color: var(--warn); }
    .log-meta {
      display: flex;
      justify-content: space-between;
      gap: 8px;
      color: var(--muted);
      font-size: 11px;
      font-weight: 800;
    }
    .hex { overflow-wrap: anywhere; margin-top: 5px; }
    @media (max-width: 980px) {
      main { width: min(100vw - 20px, 760px); }
      header, .source-links { align-items: start; justify-content: flex-start; }
      header { flex-direction: column; }
      .top-grid, .catalog, .form-grid { grid-template-columns: 1fr; }
      .fader-strip { flex-basis: 100px; }
    }
  </style>
</head>
<body>
  <main>
    <header>
      <div>
        <h1>SQ5 Control</h1>
        <div class="status" id="bridgeStatus">laden</div>
      </div>
      <div class="source-links">
        <a href="https://www.allen-heath.com/content/uploads/2023/11/SQ-MIDI-Protocol-Issue5.pdf" target="_blank" rel="noreferrer">SQ MIDI Protocol</a>
        <a href="https://support.allen-heath.com/hc/en-gb/articles/41332471203985-SQ-5-SQ-6-SQ-7-Getting-Started-Guide" target="_blank" rel="noreferrer">A&H setup</a>
      </div>
    </header>

    <section class="mixer-panel" style="margin-top: 14px;">
      <div class="mixer-head">
        <h2>Mix</h2>
        <span class="status" id="mixStatus">live faders</span>
      </div>
      <div class="channels" id="channels"></div>
    </section>

    <section class="grid top-grid" style="margin-top: 14px;">
      <div class="panel">
        <h2>Bridge</h2>
        <div class="form-grid">
          <label>Mixer IP <input id="mixerHost" placeholder="192.168.1.x" autocomplete="off" /></label>
          <label>TCP poort <input id="mixerPort" type="number" min="1" max="65535" /></label>
          <label>MIDI kanaal <input id="midiChannel" type="number" min="1" max="16" /></label>
          <label>Fader law
            <select id="faderLaw">
              <option value="linear">Linear</option>
              <option value="audio">Audio</option>
            </select>
          </label>
          <label>OSC poort <input id="oscListenPort" type="number" min="1" max="65535" /></label>
        </div>
        <div class="row" style="margin-top: 12px;">
          <button id="saveConfig">Bewaar config</button>
          <button id="probe" class="secondary">Probe TCP</button>
          <button id="syncNow" class="secondary">Sync status</button>
          <span class="status" id="probeStatus">geen probe</span>
        </div>
      </div>

      <div class="panel">
        <h2>Raw</h2>
        <label>Hex bytes <textarea id="rawHex" spellcheck="false">B0 63 40 B0 62 00 B0 60 7F</textarea></label>
        <div class="row" style="margin-top: 10px;">
          <button id="sendRaw">Send raw</button>
          <label style="width: 120px;">Scene <input id="scene" type="number" min="1" max="300" value="1" /></label>
          <button id="sendScene" class="secondary">Recall</button>
          <label style="width: 110px;">SoftKey <input id="softKey" type="number" min="1" max="16" value="1" /></label>
          <button id="sendSoftKey" class="secondary">Tap</button>
        </div>
      </div>
    </section>

    <section class="grid top-grid" style="margin-top: 14px;">
      <div class="panel">
        <h2>Commands</h2>
        <div class="catalog" id="catalog"></div>
      </div>
      <div class="panel">
        <h2>Log</h2>
        <div class="log" id="log"></div>
      </div>
    </section>
  </main>

  <script>
    const controlToken = new URLSearchParams(location.search).get("token") || new URLSearchParams(location.search).get("controlToken") || "";
    const app = {
      status: null,
      sliderTimers: new Map(),
      local: JSON.parse(localStorage.getItem("sq5-control") || "{}"),
    };
    const STORAGE_VERSION = "sq5-v2";
    if (app.local.version !== STORAGE_VERSION) app.local = {};
    const CONFIG_FIELD_IDS = ["mixerHost", "mixerPort", "midiChannel", "faderLaw", "oscListenPort"];

    const qs = (selector) => document.querySelector(selector);

    function currentLocalConfig() {
      return {
        version: STORAGE_VERSION,
        mixerHost: qs("#mixerHost").value,
        mixerPort: Number(qs("#mixerPort").value),
        midiChannel: Number(qs("#midiChannel").value),
        faderLaw: qs("#faderLaw").value,
        oscListenPort: Number(qs("#oscListenPort").value),
        channels: Object.fromEntries([...document.querySelectorAll("[data-input-key]")].map((input) => [input.dataset.inputKey, { input: Number(input.value) }]))
      };
    }

    function saveLocal() {
      app.local = currentLocalConfig();
      localStorage.setItem("sq5-control", JSON.stringify(app.local));
    }

    function setConfigValue(id, value) {
      const field = qs("#" + id);
      if (!field) return;
      if (document.activeElement === field || field.dataset.dirty === "1") return;
      field.value = value ?? "";
    }

    function initialValue(id, fallback) {
      if (app.status) return fallback;
      const value = app.local[id];
      if (value === undefined || value === null || value === "") return fallback;
      return value;
    }

    function bindConfigControls() {
      CONFIG_FIELD_IDS.forEach((id) => {
        const field = qs("#" + id);
        if (!field) return;
        field.addEventListener("input", () => {
          field.dataset.dirty = "1";
          saveLocal();
        });
        field.addEventListener("change", () => {
          field.dataset.dirty = "1";
          saveLocal();
        });
      });
    }

    async function api(path, body, options = {}) {
      const headers = body === undefined ? {} : { "Content-Type": "application/json" };
      if (controlToken) headers["x-sq5-control-token"] = controlToken;
      const response = await fetch(path, {
        method: body === undefined ? "GET" : "POST",
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || data.message || "Request mislukt");
      if (!options.quiet) await refresh();
      return data;
    }

    function statusClass(status) {
      if (status === "sent" || status === "ok" || status === "config") return "ok";
      if (status === "error") return "error";
      if (status === "preview") return "preview";
      return "";
    }

    function setStatus(el, text, status) {
      el.textContent = text;
      el.className = "status " + statusClass(status);
    }

    function displayDb(value) {
      const number = Number(value);
      if (number <= -90) return "-inf";
      return (number > 0 ? "+" : "") + number.toFixed(1);
    }

    function displayPan(value) {
      const number = Number(value);
      return Number.isFinite(number) ? number.toFixed(0) : "0";
    }

    function markUserControl(control, ms = 1200) {
      if (!control) return;
      control.dataset.userHoldUntil = String(Date.now() + ms);
    }

    function canApplyControl(control) {
      if (!control) return false;
      if (document.activeElement === control) return false;
      return Number(control.dataset.userHoldUntil || 0) < Date.now();
    }

    function setRangeValue(control, value, valueEl, formatter) {
      if (!control || !Number.isFinite(Number(value))) return;
      if (canApplyControl(control)) control.value = String(value);
      if (valueEl) valueEl.textContent = formatter(value);
    }

    function setCheckedValue(control, value) {
      if (!control || typeof value !== "boolean") return;
      if (canApplyControl(control)) control.checked = value;
    }

    function debounceSend(key, fn) {
      clearTimeout(app.sliderTimers.get(key));
      app.sliderTimers.set(key, setTimeout(fn, 90));
    }

    function mixerStrips(channels) {
      return [
        { key: "brent", label: "Brent", type: "input", controlName: "brent", stateKeys: ["brent"], osc: "/sq/input/brent", inputKey: "brent", input: channels.brent.input },
        { key: "megan", label: "Megan", type: "input", controlName: "megan", stateKeys: ["megan"], osc: "/sq/input/megan", inputKey: "megan", input: channels.megan.input },
        { key: "booi", label: "Booi", type: "input", controlName: "booi", stateKeys: ["booi"], osc: "/sq/input/booi", inputKey: "booi", input: channels.booi.input },
        { key: "mac", label: "Mac", type: "input", controlName: "macstudio", stateKeys: ["mac"], osc: "/sq/input/macstudio", routeLabel: "input 5", linkedGroup: "macstudio" },
        { key: "studio", label: "Studio", type: "input", controlName: "macstudio", stateKeys: ["studio"], osc: "/sq/input/macstudio", routeLabel: "input 6", linkedGroup: "macstudio" },
        { key: "minijack", label: "MiniJack", type: "input", controlName: "minijack", stateKeys: ["minijack1", "minijack2"], osc: "/sq/input/minijack", routeLabel: "inputs 7+8", linkedGroup: "minijack" },
        { key: "mics", label: "Mics", type: "output", controlName: "mics", stateKeys: ["mics"], osc: "/sq/mics", routeLabel: "Group 1" },
        { key: "muziek", label: "Muziek", type: "output", controlName: "muziek", stateKeys: ["muziek"], osc: "/sq/muziek", routeLabel: "Group 2" },
        { key: "sub", label: "Sub", type: "output", controlName: "sub", stateKeys: ["sub"], osc: "/sq/sub", routeLabel: "Matrix 1" },
        { key: "main", label: "Main", type: "output", controlName: "main", stateKeys: ["main"], osc: "/sq/main", routeLabel: "LR" },
      ];
    }

    function stripByKey(key) {
      return (app.strips || []).find((strip) => strip.key === key);
    }

    function stripEndpoint(strip, action) {
      return \`/api/\${strip.type}/\${strip.controlName}/\${action}\`;
    }

    function stripBody(strip, action, value) {
      if (action === "level") return strip.type === "input" ? { db: Number(value), destination: "lr" } : { db: Number(value) };
      if (action === "mute") return { muted: Boolean(value) };
      if (action === "get") return strip.type === "input" ? { parameter: value, destination: "lr" } : { parameter: value };
      return {};
    }

    function stripCard(strip) {
      const classes = ["fader-strip", strip.type === "output" ? "output" : "", strip.linkedGroup ? "linked" : ""].filter(Boolean).join(" ");
      const route = strip.inputKey
        ? \`<label class="strip-input">Input <input data-input-key="\${strip.inputKey}" type="number" min="1" max="48" value="\${strip.input}" /></label>\`
        : \`<div class="strip-route">\${strip.routeLabel}</div>\`;

      return \`
        <article class="\${classes}" data-strip-key="\${strip.key}">
          <div class="strip-title">
            <div class="strip-name">\${strip.label}</div>
            <div class="strip-meta">\${strip.osc}</div>
            <div class="status strip-live" data-live="\${strip.key}">wachten</div>
          </div>
          <div class="fader-zone">
            <span class="value-pill fader-db" data-fader-value="\${strip.key}">-inf</span>
            <input class="vertical-fader" data-fader="\${strip.key}" data-linked-group="\${strip.linkedGroup || ""}" type="range" min="-90" max="10" step="0.5" value="-90" />
            \${route}
          </div>
          <div class="strip-actions">
            <label class="toggle"><input data-strip-mute="\${strip.key}" data-linked-group="\${strip.linkedGroup || ""}" type="checkbox" /> Mute</label>
            <button class="tiny secondary" data-strip-get="\${strip.key}">Get</button>
          </div>
        </article>\`;
    }

    function renderChannels(channels) {
      app.strips = mixerStrips(channels);
      qs("#channels").innerHTML = app.strips.map(stripCard).join("");
      for (const [key, config] of Object.entries(app.local.channels || {})) {
        const input = document.querySelector(\`[data-input-key="\${key}"]\`);
        if (input && config.input) input.value = config.input;
      }
      bindChannelControls();
    }

    function bindChannelControls() {
      document.querySelectorAll("[data-input-key]").forEach((input) => {
        input.addEventListener("change", saveConfigFromForm);
      });

      document.querySelectorAll("[data-fader]").forEach((slider) => {
        slider.addEventListener("input", () => {
          markUserControl(slider);
          const strip = stripByKey(slider.dataset.fader);
          if (!strip) return;
          updateLinkedLevelDisplays(strip, slider.value);
          debounceSend(\`\${strip.key}:level\`, () => api(stripEndpoint(strip, "level"), stripBody(strip, "level", slider.value), { quiet: true }).catch(showError));
        });
      });

      document.querySelectorAll("[data-strip-mute]").forEach((checkbox) => {
        checkbox.addEventListener("change", () => {
          markUserControl(checkbox);
          const strip = stripByKey(checkbox.dataset.stripMute);
          if (!strip) return;
          updateLinkedMuteDisplays(strip, checkbox.checked);
          api(stripEndpoint(strip, "mute"), stripBody(strip, "mute", checkbox.checked), { quiet: true }).catch(showError);
        });
      });

      document.querySelectorAll("[data-strip-get]").forEach((button) => {
        button.addEventListener("click", async () => {
          try {
            const strip = stripByKey(button.dataset.stripGet);
            if (!strip) return;
            await api(stripEndpoint(strip, "get"), stripBody(strip, "get", "level"), { quiet: true });
            await api(stripEndpoint(strip, "get"), stripBody(strip, "get", "mute"), { quiet: true });
            await refresh();
          } catch (error) {
            showError(error);
          }
        });
      });
    }

    function renderCatalog(commands) {
      qs("#catalog").innerHTML = commands.map((group) => \`
        <div>
          <h3>\${group.group}</h3>
          <div class="cmd-list">
            \${group.commands.map((cmd) => \`
              <div class="cmd">
                <strong>\${cmd.address || [cmd.method, cmd.path].filter(Boolean).join(" ") || cmd.name}</strong>
                <span>\${cmd.args || cmd.body || cmd.template || ""}</span>
                <span>\${cmd.description || ""}</span>
              </div>
            \`).join("")}
          </div>
        </div>
      \`).join("");
    }

    function latestTimestamp(parts) {
      const values = parts.filter(Boolean).map((part) => part.updatedAt).filter(Boolean).sort();
      return values[values.length - 1] || "";
    }

    function updateLinkedLevelDisplays(strip, value) {
      const targets = strip.linkedGroup ? (app.strips || []).filter((candidate) => candidate.linkedGroup === strip.linkedGroup) : [strip];
      targets.forEach((target) => {
        const slider = document.querySelector(\`[data-fader="\${target.key}"]\`);
        const valueEl = document.querySelector(\`[data-fader-value="\${target.key}"]\`);
        if (slider && slider !== document.activeElement) slider.value = String(value);
        if (valueEl) valueEl.textContent = displayDb(value);
      });
    }

    function updateLinkedMuteDisplays(strip, value) {
      const targets = strip.linkedGroup ? (app.strips || []).filter((candidate) => candidate.linkedGroup === strip.linkedGroup) : [strip];
      targets.forEach((target) => {
        const checkbox = document.querySelector(\`[data-strip-mute="\${target.key}"]\`);
        if (!checkbox) return;
        checkbox.indeterminate = false;
        if (checkbox !== document.activeElement) checkbox.checked = Boolean(value);
      });
    }

    function stripControlState(strip, controlState = {}) {
      const states = strip.stateKeys.map((key) => controlState[key]).filter(Boolean);
      const levelValues = states
        .map((channel) => channel.destinations && channel.destinations.lr && channel.destinations.lr.level ? channel.destinations.lr.level.value : null)
        .filter((value) => Number.isFinite(Number(value)))
        .map(Number);
      const muteValues = states
        .map((channel) => channel.mute && typeof channel.mute.value === "boolean" ? channel.mute.value : null)
        .filter((value) => typeof value === "boolean");
      const stamps = [];
      states.forEach((channel) => {
        const lr = channel.destinations && channel.destinations.lr ? channel.destinations.lr : {};
        stamps.push(channel.mute, lr.level);
      });
      return {
        level: levelValues.length ? levelValues.reduce((sum, value) => sum + value, 0) / levelValues.length : null,
        mute: muteValues.length ? muteValues.every(Boolean) : null,
        mixedMute: muteValues.length > 1 && muteValues.some(Boolean) && !muteValues.every(Boolean),
        stamp: latestTimestamp(stamps),
      };
    }

    function applyControlState(controlState = {}) {
      for (const strip of app.strips || []) {
        const state = stripControlState(strip, controlState);
        const mute = document.querySelector(\`[data-strip-mute="\${strip.key}"]\`);
        if (mute && state.mute !== null && canApplyControl(mute)) {
          mute.checked = state.mute;
          mute.indeterminate = state.mixedMute;
        }

        const level = document.querySelector(\`[data-fader="\${strip.key}"]\`);
        const levelValue = document.querySelector(\`[data-fader-value="\${strip.key}"]\`);
        if (state.level !== null) setRangeValue(level, state.level, levelValue, displayDb);

        const live = document.querySelector(\`[data-live="\${strip.key}"]\`);
        if (live) {
          const stamp = state.stamp;
          live.textContent = stamp ? new Date(stamp).toLocaleTimeString() : "wachten";
          live.className = stamp ? "status ok" : "status";
        }
      }
    }

    function renderLog(entries) {
      qs("#log").innerHTML = entries.map((entry) => \`
        <div class="log-entry \${entry.status || ""}">
          <div class="log-meta">
            <span>\${entry.status || "log"} \${entry.source ? " - " + entry.source : ""} \${entry.channel ? " - " + entry.channel : ""}</span>
            <span>\${new Date(entry.at).toLocaleTimeString()}</span>
          </div>
          <div>\${entry.action || entry.message || ""} \${entry.destination ? " - " + entry.destination : ""}</div>
          \${entry.response ? \`<div class="status ok">\${entry.response}</div>\` : ""}
          \${entry.hex ? \`<pre class="hex">\${entry.hex}</pre>\` : ""}
          \${entry.receivedBytes ? \`<pre class="hex">rx \${entry.receivedBytes}</pre>\` : ""}
          \${entry.message && entry.action ? \`<div class="status \${statusClass(entry.status)}">\${entry.message}</div>\` : ""}
        </div>
      \`).join("");
    }

    function applyStatus(data) {
      app.status = data;
      setConfigValue("mixerHost", initialValue("mixerHost", data.mixerHost ?? ""));
      setConfigValue("mixerPort", initialValue("mixerPort", data.mixerPort));
      setConfigValue("midiChannel", initialValue("midiChannel", data.midiChannel));
      setConfigValue("faderLaw", initialValue("faderLaw", data.faderLaw));
      setConfigValue("oscListenPort", initialValue("oscListenPort", data.oscListenPort));
      setStatus(qs("#bridgeStatus"), \`HTTP :\${location.port} - OSC :\${qs("#oscListenPort").value} - TCP \${qs("#mixerHost").value || "geen IP"}:\${qs("#mixerPort").value}\`, data.mixerHost ? "ok" : "preview");
      setStatus(qs("#mixStatus"), data.syncInProgress ? "sync loopt" : \`sync \${data.lastSyncAt ? new Date(data.lastSyncAt).toLocaleTimeString() : "wachten"}\`, data.mixerHost ? "ok" : "preview");
    }

    function collectConfig() {
      const channels = {};
      document.querySelectorAll("[data-input-key]").forEach((input) => {
        channels[input.dataset.inputKey] = { input: Number(input.value) };
      });
      return {
        mixerHost: qs("#mixerHost").value.trim(),
        mixerPort: Number(qs("#mixerPort").value),
        midiChannel: Number(qs("#midiChannel").value),
        faderLaw: qs("#faderLaw").value,
        oscListenPort: Number(qs("#oscListenPort").value),
        channels,
      };
    }

    async function saveConfigFromForm() {
      saveLocal();
      await api("/api/config", collectConfig());
      CONFIG_FIELD_IDS.forEach((id) => {
        const field = qs("#" + id);
        if (field) delete field.dataset.dirty;
      });
      document.querySelectorAll("[data-input-key]").forEach((field) => delete field.dataset.dirty);
    }

    function showError(error) {
      setStatus(qs("#probeStatus"), error.message || String(error), "error");
      refresh().catch(() => {});
    }

    async function refresh() {
      const data = await api("/api/status", undefined, { quiet: true });
      const first = !app.status;
      applyStatus(data);
      if (first) renderChannels(data.channels);
      applyControlState(data.controlState || {});
      renderCatalog(data.commands);
      renderLog(data.activity || []);
    }

    qs("#saveConfig").addEventListener("click", () => saveConfigFromForm().catch(showError));
    qs("#probe").addEventListener("click", async () => {
      try {
        await saveConfigFromForm();
        const result = await api("/api/probe", { host: qs("#mixerHost").value.trim(), port: Number(qs("#mixerPort").value) });
        setStatus(qs("#probeStatus"), \`open: \${result.host}:\${result.port}\`, "ok");
      } catch (error) {
        showError(error);
      }
    });
    qs("#syncNow").addEventListener("click", async () => {
      try {
        const data = await api("/api/sync", {}, { quiet: true });
        applyControlState(data.controlState || {});
        renderLog(data.activity || []);
        setStatus(qs("#probeStatus"), "status gesynct", "ok");
      } catch (error) {
        showError(error);
      }
    });
    qs("#sendRaw").addEventListener("click", () => api("/api/raw", { hex: qs("#rawHex").value }).catch(showError));
    qs("#sendScene").addEventListener("click", () => api("/api/scene", { scene: Number(qs("#scene").value) }).catch(showError));
    qs("#sendSoftKey").addEventListener("click", () => api("/api/softkey", { softKey: Number(qs("#softKey").value), action: "tap" }).catch(showError));

    bindConfigControls();
    refresh().catch(showError);
    setInterval(() => refresh().catch(() => {}), 1500);
  </script>
</body>
</html>`;
}

function serveIndex(res) {
  const body = html();
  res.writeHead(200, {
    "Content-Type": "text/html; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
  });
  res.end(body);
}

function createServer() {
  return http.createServer(async (req, res) => {
    const url = new URL(req.url, `http://${req.headers.host || "127.0.0.1"}`);
    try {
      if (!isControlRequestAllowed(req, url)) {
        rejectUnauthorized(res);
        return;
      }
      if (url.pathname === "/") {
        serveIndex(res);
        return;
      }
      if (url.pathname.startsWith("/api/")) {
        await routeApi(req, res, url);
        return;
      }
      sendJson(res, 404, { error: "not_found" });
    } catch (error) {
      const status = error.entry ? 502 : 400;
      sendJson(res, status, { error: error.message || String(error), entry: error.entry || null });
    }
  });
}

function start() {
  const httpHost = requireSafeBind("HTTP", TOOL_HOST, { allowToken: true });
  state.oscListenAddress = requireSafeBind("OSC", state.oscListenAddress, { allowToken: false });
  openOscPort();
  startStatePolling();
  startStreamdeckPolling();
  const server = createServer();
  server.listen(TOOL_PORT, httpHost, () => {
    const displayHost = isWildcardBindHost(httpHost) ? "127.0.0.1" : httpHost;
    const message = `SQ5 Control: http://${displayHost}:${TOOL_PORT}`;
    addActivity({ status: "ok", source: "http", message });
    console.log(message);
  });

  process.on("SIGINT", () => {
    if (syncTimer) clearInterval(syncTimer);
    if (streamdeckSyncTimer) clearInterval(streamdeckSyncTimer);
    if (oscPort) {
      try {
        oscPort.close();
      } catch {}
    }
    server.close(() => process.exit(0));
  });
}

const protocol = {
  bytesToHex,
  parseHex,
  sceneRecallBytes,
  softKeyBytes,
  inputMuteBytes,
  inputLevelBytes,
  inputLevelUnitBytes,
  inputPanBytes,
  inputAssignBytes,
  inputGetBytes,
  inputRelativeBytes,
  outputMuteBytes,
  outputLevelBytes,
  outputGetBytes,
  outputTargetFromToken,
  maybeOutputTargetFromToken,
  channelFromToken,
  channelsFromToken,
  streamdeckTargetFromToken,
  streamdeckState,
  inputLevelParam,
  inputPanParam,
  inputAssignParam,
  inputMuteParam,
  levelPairFromDb,
  dbFromLevelPair,
  panPairFromPercent,
  percentFromPanPair,
  decodeResponse,
  decodeResponseValue,
  commandCatalog,
};

module.exports = { createServer, protocol, state };

if (require.main === module) start();
