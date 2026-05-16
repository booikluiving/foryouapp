#!/usr/bin/env node
"use strict";

const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");

const repoRoot = path.resolve(__dirname, "..", "..");
const appDbPath = path.join(repoRoot, "app", "data", "live.sqlite");
const starMapDbPath = path.join(repoRoot, "star-map", "data", "live.sqlite");

const TABLES = [
  { name: "algorithm_paths", key: (row) => String(row.id) },
  { name: "algorithm_path_scenes", key: (row) => `${row.path_id}:${row.scene_id}` },
  { name: "algorithm_path_edges", key: (row) => `${row.path_id}:${row.from_scene_id}:${row.to_scene_id}` },
  { name: "algorithm_crossing_thresholds", key: (row) => String(row.scene_id) },
  { name: "algorithm_scenes", key: (row) => String(row.id) },
];

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function readRows(db, table) {
  return db.prepare(`SELECT * FROM ${table.name} ORDER BY id ASC`).all();
}

function mapRows(rows, table) {
  return new Map(rows.map((row) => [table.key(row), row]));
}

function diffTable(appDb, starDb, table) {
  const appRows = readRows(appDb, table);
  const starRows = readRows(starDb, table);
  const appMap = mapRows(appRows, table);
  const starMap = mapRows(starRows, table);
  const appKeys = new Set(appMap.keys());
  const starKeys = new Set(starMap.keys());
  const onlyInApp = Array.from(appKeys).filter((key) => !starKeys.has(key)).sort();
  const onlyInStarMap = Array.from(starKeys).filter((key) => !appKeys.has(key)).sort();
  const changed = Array.from(appKeys)
    .filter((key) => starKeys.has(key) && stableJson(appMap.get(key)) !== stableJson(starMap.get(key)))
    .sort();

  return {
    table: table.name,
    appCount: appRows.length,
    starMapCount: starRows.length,
    onlyInApp,
    onlyInStarMap,
    changed,
  };
}

function main() {
  const strict = process.argv.includes("--strict");
  const appDb = new DatabaseSync(appDbPath, { readOnly: true });
  const starDb = new DatabaseSync(starMapDbPath, { readOnly: true });
  try {
    const tables = TABLES.map((table) => diffTable(appDb, starDb, table));
    const hasDiff = tables.some((table) => table.onlyInApp.length || table.onlyInStarMap.length || table.changed.length);
    console.log(JSON.stringify({
      ok: !strict || !hasDiff,
      canonicalDatabase: appDbPath,
      comparisonDatabase: starMapDbPath,
      hasDiff,
      tables,
    }, null, 2));
    if (strict && hasDiff) process.exitCode = 1;
  } finally {
    appDb.close();
    starDb.close();
  }
}

main();
