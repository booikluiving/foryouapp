"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");

function defaultDatabasePath() {
  return path.resolve(__dirname, "..", "..", "..", "app", "data", "live.sqlite");
}

function resolveDatabasePath(inputPath = "") {
  if (inputPath) return path.resolve(process.cwd(), inputPath);
  return defaultDatabasePath();
}

function databaseExists(databasePath) {
  try {
    return fs.existsSync(databasePath);
  } catch {
    return false;
  }
}

function openReadOnlyDatabase(databasePath) {
  const safePath = resolveDatabasePath(databasePath);
  if (!databaseExists(safePath)) {
    const err = new Error("database_not_found");
    err.databasePath = safePath;
    throw err;
  }
  return new DatabaseSync(safePath, {
    readOnly: true,
    enableForeignKeyConstraints: true,
  });
}

function withReadOnlyDatabase(databasePath, callback) {
  const safePath = resolveDatabasePath(databasePath);
  const db = openReadOnlyDatabase(safePath);
  try {
    return callback(db, safePath);
  } finally {
    db.close();
  }
}

module.exports = {
  databaseExists,
  defaultDatabasePath,
  openReadOnlyDatabase,
  resolveDatabasePath,
  withReadOnlyDatabase,
};
