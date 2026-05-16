#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");

const repoRoot = path.resolve(__dirname, "..", "..");
const serverPath = path.join(repoRoot, "app", "server.js");
const source = fs.readFileSync(serverPath, "utf8");

function functionBody(name) {
  const marker = `function ${name}`;
  const start = source.indexOf(marker);
  if (start < 0) throw new Error(`missing_function:${name}`);
  const open = source.indexOf("{", start);
  if (open < 0) throw new Error(`missing_function_body:${name}`);
  let depth = 0;
  for (let index = open; index < source.length; index += 1) {
    const char = source[index];
    if (char === "{") depth += 1;
    if (char === "}") depth -= 1;
    if (depth === 0) return source.slice(open + 1, index);
  }
  throw new Error(`unterminated_function:${name}`);
}

const guardedFunctions = [
  "getUniverseReadOnlyAlgorithmState",
  "getUniverseAlgorithmRuntimeOverlay",
];
const blockedCalls = [
  "getAlgorithmState(",
  "renormalizeAlgorithmScenesForPerformerRoles(",
];

for (const name of guardedFunctions) {
  const body = functionBody(name);
  for (const call of blockedCalls) {
    if (body.includes(call)) {
      throw new Error(`${name} must not call ${call}`);
    }
  }
}

console.log("Universe runtime provider read-only guard passed");
