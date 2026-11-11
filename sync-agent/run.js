"use strict";

// Entry point for launchd on the show Mac: one round every `intervalSeconds`.
// Config: FORYOU_SYNC_CONFIG or sync-agent/config.local.json (not in git; holds secrets).

const fs = require("node:fs");
const path = require("node:path");

const { createAgent } = require("./agent");

const configPath = process.env.FORYOU_SYNC_CONFIG || path.join(__dirname, "config.local.json");
const config = {
  catalogUrl: "http://127.0.0.1:3021",
  pathsUrl: "http://127.0.0.1:3022",
  runtimeUrl: "http://127.0.0.1:3024",
  intervalSeconds: 20,
  quietMinutes: 15,
  ...JSON.parse(fs.readFileSync(configPath, "utf8")),
};
for (const key of ["websiteUrl", "syncSecret"]) {
  if (!config[key]) {
    process.stderr.write(`sync-agent: ${key} ontbreekt in ${configPath}\n`);
    process.exit(1);
  }
}

const agent = createAgent(config);
let stopping = false;

async function loop() {
  while (!stopping) {
    await agent.tick();
    await new Promise((resolve) => setTimeout(resolve, Math.max(5, Number(config.intervalSeconds)) * 1000));
  }
}

for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => { stopping = true; });
if (process.argv.includes("--een-keer")) {
  agent.tick().then((report) => process.stdout.write(`${JSON.stringify(report, null, 2)}\n`));
} else {
  loop();
}
