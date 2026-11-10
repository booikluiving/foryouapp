#!/usr/bin/env node
"use strict";

// Gebruik: node karabiner-install.js install|rollback|status [--dry-run]
//          [--config PAD] [--agents-dir PAD] [--backup-dir PAD] [--no-launchctl]

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const { RULE_DESCRIPTION_PREFIX, VENDOR_ID, PRODUCT_ID } = require("./device-monitor");

const OLD_RULE_DESCRIPTIONS = ["For You: PerfectCue Page Up/Down controls teleprompter only"];
const OLD_AGENT_LABEL = "com.foryou.perfectcue-remap";
const OLD_AGENT_DISABLED_SUFFIX = ".uit-perfectcue-karabiner";
const TRIGGER_URL = process.env.SHOW_CONTROL_PERFECT_CUE_TRIGGER_URL || "http://127.0.0.1:3228/api/trigger?async=1";

function parseArgs(argv) {
  const args = { action: argv[0] || "status", dryRun: false, launchctl: true };
  for (let i = 1; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--dry-run") args.dryRun = true;
    else if (arg === "--no-launchctl") args.launchctl = false;
    else if (arg === "--config") args.config = argv[++i];
    else if (arg === "--agents-dir") args.agentsDir = argv[++i];
    else if (arg === "--backup-dir") args.backupDir = argv[++i];
    else throw new Error(`onbekende optie: ${arg}`);
  }
  const home = os.homedir();
  args.config ||= path.join(home, ".config", "karabiner", "karabiner.json");
  args.agentsDir ||= path.join(home, "Library", "LaunchAgents");
  args.backupDir ||= path.join(home, "Library", "Application Support", "ForYou", "perfectcue", "karabiner-backups");
  args.logFile = path.join(home, "Library", "Logs", "ForYou", "perfectcue-karabiner-fouten.log");
  return args;
}

function shellQuote(value) {
  return `'${String(value).replace(/'/g, `'\\''`)}'`;
}

function triggerCommand(direction, deviceKey, logFile) {
  const body = JSON.stringify({ direction, source: "perfectcue-usb", deviceKey });
  return [
    "/usr/bin/curl -fsS -m 3 -H 'content-type: application/json'",
    `-d ${shellQuote(body)}`,
    `${shellQuote(TRIGGER_URL)} >/dev/null 2>&1`,
    `|| echo "$(/bin/date -u +%Y-%m-%dT%H:%M:%SZ) ${direction} ${deviceKey} niet aangekomen" >> ${shellQuote(logFile)}`,
  ].join(" ");
}

function buildRule(logFile) {
  const template = JSON.parse(fs.readFileSync(path.join(__dirname, "karabiner-rule.json"), "utf8"));
  if (!String(template.description || "").startsWith(RULE_DESCRIPTION_PREFIX)) {
    throw new Error("karabiner-rule.json: description moet beginnen met " + RULE_DESCRIPTION_PREFIX);
  }
  for (const manipulator of template.manipulators) {
    for (const to of manipulator.to || []) {
      if (typeof to.shell_command !== "string") continue;
      const match = to.shell_command.match(/^__TRIGGER__ (next|prev) (\S+)$/);
      if (!match) throw new Error(`onverwachte shell_command: ${to.shell_command}`);
      to.shell_command = triggerCommand(match[1], match[2], logFile);
    }
  }
  return template;
}

function selectedProfile(config) {
  const profiles = Array.isArray(config.profiles) ? config.profiles : [];
  return profiles.find((profile) => profile && profile.selected) || profiles[0] || null;
}

function isOurRule(rule) {
  const description = String(rule && rule.description || "");
  return description.startsWith(RULE_DESCRIPTION_PREFIX) || OLD_RULE_DESCRIPTIONS.includes(description);
}

function isPerfectCueDevice(device) {
  const ids = device && device.identifiers ? device.identifiers : {};
  return Number(ids.vendor_id) === VENDOR_ID && Number(ids.product_id) === PRODUCT_ID;
}

function applyRule(config, rule) {
  const profile = selectedProfile(config);
  if (!profile) throw new Error("geen Karabiner-profiel gevonden");
  profile.complex_modifications ||= {};
  const rules = Array.isArray(profile.complex_modifications.rules) ? profile.complex_modifications.rules : [];
  profile.complex_modifications.rules = [rule, ...rules.filter((existing) => !isOurRule(existing))];
  profile.devices = Array.isArray(profile.devices) ? profile.devices : [];
  const device = profile.devices.find(isPerfectCueDevice);
  if (device) {
    device.ignore = false;
  } else {
    profile.devices.push({
      identifiers: { vendor_id: VENDOR_ID, product_id: PRODUCT_ID, is_keyboard: true },
      ignore: false,
      manipulate_caps_lock_led: false,
    });
  }
  return profile.name || "(naamloos)";
}

function writeAtomic(file, text, mode) {
  const tmp = `${file}.foryou-tmp-${process.pid}`;
  fs.writeFileSync(tmp, text, { mode });
  fs.renameSync(tmp, file);
}

function launchctl(args) {
  try {
    execFileSync("/bin/launchctl", args, { stdio: "pipe" });
    return true;
  } catch (_err) {
    return false;
  }
}

function disableOldAgent(args, report) {
  const plist = path.join(args.agentsDir, `${OLD_AGENT_LABEL}.plist`);
  if (!fs.existsSync(plist)) {
    report.oldAgent = "niet aanwezig";
    return;
  }
  if (args.dryRun) {
    report.oldAgent = `zou uitzetten: ${plist}`;
    return;
  }
  if (args.launchctl) launchctl(["bootout", `gui/${process.getuid()}/${OLD_AGENT_LABEL}`]);
  fs.renameSync(plist, plist + OLD_AGENT_DISABLED_SUFFIX);
  if (args.launchctl) {
    try {
      execFileSync("/usr/bin/hidutil", [
        "property", "--matching", JSON.stringify({ VendorID: VENDOR_ID, ProductID: PRODUCT_ID }),
        "--set", JSON.stringify({ UserKeyMapping: [] }),
      ], { stdio: "pipe" });
    } catch (_err) {
      // apparaat niet aangesloten: niets te wissen
    }
  }
  report.oldAgent = `uitgezet: ${plist}${OLD_AGENT_DISABLED_SUFFIX}`;
}

function restoreOldAgent(args, report) {
  const plist = path.join(args.agentsDir, `${OLD_AGENT_LABEL}.plist`);
  const disabled = plist + OLD_AGENT_DISABLED_SUFFIX;
  if (!fs.existsSync(disabled)) {
    report.oldAgent = "niets terug te zetten";
    return;
  }
  if (args.dryRun) {
    report.oldAgent = `zou terugzetten: ${plist}`;
    return;
  }
  fs.renameSync(disabled, plist);
  if (args.launchctl) launchctl(["bootstrap", `gui/${process.getuid()}`, plist]);
  report.oldAgent = `teruggezet: ${plist}`;
}

function install(args) {
  const report = { action: "install", dryRun: args.dryRun, config: args.config };
  const original = fs.readFileSync(args.config, "utf8");
  const mode = fs.statSync(args.config).mode & 0o777;
  const config = JSON.parse(original);
  const rule = buildRule(args.logFile);
  report.profile = applyRule(config, rule);
  report.rule = rule.description;
  const next = `${JSON.stringify(config, null, 2)}\n`;
  if (args.dryRun) {
    report.result = next;
  } else {
    fs.mkdirSync(args.backupDir, { recursive: true });
    fs.mkdirSync(path.dirname(args.logFile), { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const backup = path.join(args.backupDir, `karabiner-${stamp}.json`);
    fs.writeFileSync(backup, original, { mode: 0o600 });
    const pointer = path.join(args.backupDir, "LAATSTE");
    const profileBefore = selectedProfile(JSON.parse(original)) || {};
    const alreadyInstalled = ((profileBefore.complex_modifications || {}).rules || [])
      .some((existing) => String(existing && existing.description || "").startsWith(RULE_DESCRIPTION_PREFIX));
    // Bij herinstallatie blijft LAATSTE naar de versie van vóór de eerste installatie wijzen.
    if (!alreadyInstalled || !fs.existsSync(pointer)) fs.writeFileSync(pointer, `${backup}\n`);
    writeAtomic(args.config, next, mode);
    report.backup = backup;
  }
  disableOldAgent(args, report);
  return report;
}

function rollback(args) {
  const report = { action: "rollback", dryRun: args.dryRun, config: args.config };
  const pointer = path.join(args.backupDir, "LAATSTE");
  if (!fs.existsSync(pointer)) throw new Error(`geen back-up gevonden in ${args.backupDir}`);
  const backup = fs.readFileSync(pointer, "utf8").trim();
  const text = fs.readFileSync(backup, "utf8");
  JSON.parse(text);
  report.backup = backup;
  if (!args.dryRun) {
    const mode = fs.existsSync(args.config) ? fs.statSync(args.config).mode & 0o777 : 0o600;
    writeAtomic(args.config, text, mode);
  }
  restoreOldAgent(args, report);
  return report;
}

async function status(args) {
  const report = { action: "status", config: args.config };
  try {
    const config = JSON.parse(fs.readFileSync(args.config, "utf8"));
    const profile = selectedProfile(config) || {};
    const rules = (profile.complex_modifications && profile.complex_modifications.rules) || [];
    report.rules = rules.filter(isOurRule).map((rule) => rule.description);
    report.ruleFirst = rules.length > 0 && String(rules[0].description || "").startsWith(RULE_DESCRIPTION_PREFIX);
  } catch (err) {
    report.configError = err.message;
  }
  const plist = path.join(args.agentsDir, `${OLD_AGENT_LABEL}.plist`);
  report.oldAgent = fs.existsSync(plist) ? "actief (plist aanwezig)"
    : fs.existsSync(plist + OLD_AGENT_DISABLED_SUFFIX) ? "uitgezet" : "niet aanwezig";
  try {
    const response = await fetch(TRIGGER_URL.replace(/\/api\/trigger(\?.*)?$/, "/api/state"), { signal: AbortSignal.timeout(1000) });
    const body = await response.json();
    report.sidecar = body.summary || "sidecar heeft nog geen statusveld (oude versie)";
  } catch (err) {
    report.sidecar = `niet bereikbaar: ${err.message}`;
  }
  return report;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  let report;
  if (args.action === "install") report = install(args);
  else if (args.action === "rollback") report = rollback(args);
  else if (args.action === "status") report = await status(args);
  else throw new Error("gebruik: install | rollback | status");
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}

if (require.main === module) {
  main().catch((err) => {
    process.stderr.write(`${err.message}\n`);
    process.exit(1);
  });
}

module.exports = { applyRule, buildRule, isOurRule, triggerCommand };
