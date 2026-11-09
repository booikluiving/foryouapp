"use strict";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFile } = require("node:child_process");

const VENDOR_ID = 1155; // 0x0483
const PRODUCT_ID = 42046; // 0xA43E
const RULE_DESCRIPTION_PREFIX = "For_You: PerfectCue";
const DEFAULT_INTERVAL_MS = 3000;

function nowIso() {
  return new Date().toISOString();
}

function run(file, args, timeout = 1500) {
  return new Promise((resolve) => {
    execFile(file, args, { timeout, encoding: "utf8" }, (err, stdout) => {
      resolve({ ok: !err, code: err ? err.code : 0, stdout: String(stdout || "") });
    });
  });
}

async function probeDevice() {
  const matching = JSON.stringify({ VendorID: VENDOR_ID, ProductID: PRODUCT_ID });
  const result = await run("/usr/bin/hidutil", ["list", "--matching", matching]);
  if (!result.ok) return { connected: null, error: "hidutil_failed" };
  const connected = /\b0x483\s+0xa43e\b/i.test(result.stdout);
  const nameMatch = result.stdout.match(/Dsan[^\n]*?PerfectCue/i);
  return { connected, product: connected && nameMatch ? nameMatch[0] : null };
}

async function probeKarabiner(configPath) {
  const [core, consoleServer] = await Promise.all([
    run("/usr/bin/pgrep", ["-f", "Karabiner-Core-Service"]),
    run("/usr/bin/pgrep", ["-x", "karabiner_console_user_server"]),
  ]);
  let ruleInstalled = false;
  try {
    const config = JSON.parse(fs.readFileSync(configPath, "utf8"));
    const profile = (config.profiles || []).find((p) => p && p.selected) || (config.profiles || [])[0] || {};
    const rules = (profile.complex_modifications && profile.complex_modifications.rules) || [];
    ruleInstalled = rules.some((rule) => String(rule && rule.description || "").startsWith(RULE_DESCRIPTION_PREFIX));
  } catch (_err) {
    ruleInstalled = false;
  }
  return {
    running: core.ok && consoleServer.ok,
    coreService: core.ok,
    consoleUserServer: consoleServer.ok,
    ruleInstalled,
  };
}

async function probeConsoleUser() {
  const result = await run("/usr/bin/stat", ["-f", "%Su", "/dev/console"]);
  const consoleUser = result.ok ? result.stdout.trim() : null;
  const serviceUser = os.userInfo().username;
  return { consoleUser, serviceUser, onConsole: consoleUser ? consoleUser === serviceUser : null };
}

async function defaultProbe(options = {}) {
  const configPath = options.karabinerConfigPath || path.join(os.homedir(), ".config", "karabiner", "karabiner.json");
  const [device, karabiner, session] = await Promise.all([
    probeDevice(),
    probeKarabiner(configPath),
    probeConsoleUser(),
  ]);
  return { device, karabiner, session };
}

function createDeviceStatus() {
  return {
    checkedAt: null,
    device: {
      vendorId: VENDOR_ID,
      productId: PRODUCT_ID,
      product: null,
      connected: null,
      connectedSince: null,
      disconnectedAt: null,
      reconnects: 0,
    },
    karabiner: { running: null, coreService: null, consoleUserServer: null, ruleInstalled: null },
    session: { consoleUser: null, serviceUser: null, onConsole: null },
  };
}

function applyProbe(status, probe) {
  const at = nowIso();
  const wasConnected = status.device.connected;
  const connected = probe.device ? probe.device.connected : null;
  if (connected === true && wasConnected !== true) {
    if (wasConnected === false) status.device.reconnects += 1;
    status.device.connectedSince = at;
  }
  if (connected === false && wasConnected !== false) {
    status.device.disconnectedAt = at;
    status.device.connectedSince = null;
  }
  status.device.connected = connected;
  if (probe.device && probe.device.product) status.device.product = probe.device.product;
  if (probe.karabiner) status.karabiner = { ...status.karabiner, ...probe.karabiner };
  if (probe.session) status.session = { ...status.session, ...probe.session };
  status.checkedAt = at;
  return status;
}

function startDeviceMonitor(status, options = {}) {
  const probe = options.probe || (() => defaultProbe(options));
  const intervalMs = Number(options.intervalMs || process.env.V2_SHOW_CONTROL_PERFECT_CUE_PROBE_MS || DEFAULT_INTERVAL_MS);
  let running = false;
  let stopped = false;
  async function tick() {
    if (running || stopped) return;
    running = true;
    try {
      applyProbe(status, await probe());
    } catch (_err) {
      status.checkedAt = nowIso();
    } finally {
      running = false;
    }
  }
  tick();
  const timer = setInterval(tick, intervalMs);
  timer.unref();
  return {
    tick,
    stop() {
      stopped = true;
      clearInterval(timer);
    },
  };
}

module.exports = {
  PRODUCT_ID,
  RULE_DESCRIPTION_PREFIX,
  VENDOR_ID,
  applyProbe,
  createDeviceStatus,
  defaultProbe,
  startDeviceMonitor,
};
