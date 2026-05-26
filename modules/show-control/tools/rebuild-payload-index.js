#!/usr/bin/env node
"use strict";

const { payloadIndexFilePath, rebuildPayloadIndex } = require("../cue-engine/state-store");

async function main() {
  const index = await rebuildPayloadIndex();
  console.log(JSON.stringify({
    ok: true,
    filePath: payloadIndexFilePath(),
    schemaVersion: index.schemaVersion,
    count: index.count,
    updatedAt: index.updatedAt,
  }, null, 2));
}

main().catch((err) => {
  console.error(err && err.stack ? err.stack : err);
  process.exitCode = 1;
});
