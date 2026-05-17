"use strict";

const { databaseExists, resolveDatabasePath, withReadOnlyDatabase } = require("../data/sqlite");
const { readAlgorithmSource, readCounts, readSourceSchema } = require("../data/queries");
const { readRuntimeSource } = require("../data/runtime-queries");
const { buildGraph } = require("./normalize-paths");
const { buildRuntimeState } = require("./runtime-state");

function timestamp() {
  return new Date().toISOString();
}

function createGraphService(options = {}) {
  const databasePath = resolveDatabasePath(options.databasePath);
  const runtimeProvider = typeof options.runtimeProvider === "function"
    ? options.runtimeProvider
    : null;

  function sourceMeta(extra = {}) {
    return {
      databasePath,
      readOnly: true,
      ...extra,
    };
  }

  function health() {
    const exists = databaseExists(databasePath);
    if (!exists) {
      return {
        ok: false,
        generatedAt: timestamp(),
        source: sourceMeta({ exists }),
        error: "database_not_found",
      };
    }
    return withReadOnlyDatabase(databasePath, (db) => ({
      ok: true,
      generatedAt: timestamp(),
      source: sourceMeta({ exists }),
      counts: readCounts(db),
    }));
  }

  function sourceSchema() {
    return withReadOnlyDatabase(databasePath, (db) => ({
      ok: true,
      generatedAt: timestamp(),
      source: sourceMeta({ exists: true }),
      tables: readSourceSchema(db),
    }));
  }

  function graph() {
    return withReadOnlyDatabase(databasePath, (db) => {
      const raw = readAlgorithmSource(db);
      return {
        ok: true,
        generatedAt: timestamp(),
        source: sourceMeta({ exists: true }),
        graph: buildGraph(raw),
      };
    });
  }

  function runtime() {
    return withReadOnlyDatabase(databasePath, (db) => {
      const raw = readAlgorithmSource(db);
      const graphModel = buildGraph(raw);
      const runtimeSource = readRuntimeSource(db);
      if (runtimeProvider) {
        const appRuntime = runtimeProvider();
        if (appRuntime && typeof appRuntime === "object") runtimeSource.appRuntime = appRuntime;
      }
      return {
        ok: true,
        generatedAt: timestamp(),
        source: sourceMeta({ exists: true }),
        runtime: buildRuntimeState(runtimeSource, graphModel),
      };
    });
  }

  return {
    graph,
    health,
    runtime,
    sourceSchema,
  };
}

module.exports = {
  createGraphService,
};
