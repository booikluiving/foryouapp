#!/usr/bin/env node
"use strict";

const { createUnifiNetworkAgent } = require("../lib/unifi-network-agent");

function printHelp() {
  console.log(`For_You UniFi network agent status

Usage:
  npm run unifi:status
  npm run unifi:status -- --json

Options:
  --json                    Print raw JSON snapshot
  --base-url <url>          Override UNIFI_API_BASE_URL for this run
  --timeout-ms <ms>         Override request timeout
  --help                    Show this help

Environment / .env:
  UNIFI_AGENT_ENABLED=1
  UNIFI_API_BASE_URL=https://192.168.1.1/proxy/network/integration/v1
  UNIFI_API_KEY=...
  UNIFI_API_INSECURE_TLS=1
`);
}

function parseArgs(argv) {
  const options = {
    json: false,
    apiBaseUrl: "",
    timeoutMs: 0,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--help" || arg === "-h") {
      options.help = true;
      continue;
    }
    if (arg === "--json") {
      options.json = true;
      continue;
    }
    if (arg === "--base-url") {
      options.apiBaseUrl = argv[++i] || "";
      continue;
    }
    if (arg === "--timeout-ms") {
      const parsed = Number.parseInt(String(argv[++i] || ""), 10);
      if (Number.isFinite(parsed) && parsed > 0) options.timeoutMs = parsed;
      continue;
    }
    throw new Error(`Unknown option: ${arg}`);
  }

  return options;
}

function printHuman(snapshot) {
  const agent = snapshot.agent || {};
  const totals = snapshot.totals || {};
  console.log("For_You UniFi network agent");
  console.log("============================");
  console.log(`API base: ${agent.apiBaseUrl || "-"}`);
  console.log(`Console:  ${agent.consoleUrl || "-"}`);
  console.log(`Mode:     ${agent.mode || "read-only"}`);
  console.log(`TLS:      ${agent.insecureTls ? "self-signed toegestaan" : "strict"}`);
  console.log(`Checked:  ${snapshot.checkedAt || "-"}`);
  console.log("");
  console.log(`Sites:    ${Number(totals.sites || 0)}`);
  console.log(`Devices:  ${Number(totals.devices || 0)}`);
  console.log(`Clients:  ${Number(totals.clients || 0)}`);
  console.log(`Networks: ${Number(totals.networks || 0)}`);

  for (const siteSnapshot of snapshot.sites || []) {
    const site = siteSnapshot.site || {};
    console.log("");
    console.log(`Site: ${site.name || site.id || "site"}`);
    for (const key of ["devices", "clients", "networks"]) {
      const result = siteSnapshot[key] || {};
      if (result.ok) {
        console.log(`  ${key}: ${Number(result.count || 0)}`);
      } else {
        const status = Number(result.error && result.error.upstreamStatus || 0);
        console.log(`  ${key}: niet beschikbaar${status ? ` (HTTP ${status})` : ""}`);
      }
    }
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    printHelp();
    return;
  }

  const agent = createUnifiNetworkAgent({
    rootDir: process.cwd(),
    apiBaseUrl: options.apiBaseUrl || undefined,
    timeoutMs: options.timeoutMs || undefined,
  });

  try {
    const snapshot = await agent.getSnapshot();
    if (options.json) {
      console.log(JSON.stringify(snapshot, null, 2));
    } else {
      printHuman(snapshot);
    }
  } catch (err) {
    const summary = agent.getConfigSummary();
    if (options.json) {
      console.log(JSON.stringify({
        ok: false,
        error: err && (err.code || err.message) || "unifi_error",
        detail: err && err.detail ? err.detail : null,
        agent: summary,
      }, null, 2));
    } else {
      console.error("UniFi status ophalen mislukt.");
      console.error(`Error: ${err && (err.code || err.message) || "unifi_error"}`);
      console.error(`API base: ${summary.apiBaseUrl}`);
      if (!summary.hasApiKey) {
        console.error("Geen UNIFI_API_KEY gevonden. Zet die in .env of als environment variable.");
      }
    }
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error(err && err.stack ? err.stack : err);
  process.exit(1);
});
