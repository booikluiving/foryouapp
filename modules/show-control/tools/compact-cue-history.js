#!/usr/bin/env node
"use strict";

const fs = require("node:fs/promises");
const path = require("node:path");
const { compactCueForStorage } = require("../cue-engine/compact-results");
const { cuesFilePath } = require("../cue-engine/state-store");

function usage() {
  return [
    "Usage: node modules/show-control/tools/compact-cue-history.js [--write]",
    "",
    "Default is dry-run. With --write, the tool first copies cues.json to",
    "cues.json.backup-<timestamp>, then writes the compacted cue history.",
  ].join("\n");
}

function timestamp() {
  return new Date().toISOString().replace(/[-:]/g, "").replace(/\..+$/, "Z");
}

function byteLength(value) {
  return Buffer.byteLength(value, "utf8");
}

function countRuntimeStates(cues = []) {
  let count = 0;
  for (const cue of cues) {
    for (const action of cue.actions || []) {
      if (action.adapterResult && action.adapterResult.runtimeState) count += 1;
    }
  }
  return count;
}

async function main() {
  const args = new Set(process.argv.slice(2));
  if (args.has("--help") || args.has("-h")) {
    console.log(usage());
    return;
  }
  const write = args.has("--write");
  const filePath = cuesFilePath();
  const beforeText = await fs.readFile(filePath, "utf8");
  const cues = JSON.parse(beforeText);
  if (!Array.isArray(cues)) throw new Error("show_control_cues_file_not_array");

  const compacted = cues.map(compactCueForStorage);
  const afterText = `${JSON.stringify(compacted, null, 2)}\n`;
  const beforeBytes = byteLength(beforeText);
  const afterBytes = byteLength(afterText);
  const removedBytes = Math.max(0, beforeBytes - afterBytes);
  const result = {
    filePath,
    mode: write ? "write" : "dry-run",
    cueCount: cues.length,
    runtimeStatesBefore: countRuntimeStates(cues),
    runtimeStatesAfter: countRuntimeStates(compacted),
    beforeBytes,
    afterBytes,
    removedBytes,
    removedPercent: beforeBytes ? Math.round((removedBytes / beforeBytes) * 1000) / 10 : 0,
  };

  if (!write) {
    console.log(JSON.stringify(result, null, 2));
    console.log("Dry-run only. Run again with --write to create a backup and compact cues.json.");
    return;
  }

  const backupPath = `${filePath}.backup-${timestamp()}`;
  const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  await fs.copyFile(filePath, backupPath);
  await fs.writeFile(tempPath, afterText, "utf8");
  await fs.rename(tempPath, filePath);
  console.log(JSON.stringify({ ...result, backupPath: path.relative(process.cwd(), backupPath) }, null, 2));
}

main().catch((err) => {
  console.error(err && err.stack ? err.stack : err);
  process.exitCode = 1;
});
