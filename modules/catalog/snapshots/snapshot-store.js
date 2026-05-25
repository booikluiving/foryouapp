"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs/promises");
const path = require("node:path");

const {
  CATALOG_SNAPSHOT_SCHEMA_VERSION,
} = require("../../../shared/contracts/catalog-v0");
const { buildCatalogReadModel } = require("../read-model/build-read-model");
const { validateCatalogReadModel } = require("../validation/validate-catalog");

const V2_ROOT = path.resolve(__dirname, "../../..");
const DEFAULT_SNAPSHOT_DIR = path.join(V2_ROOT, "modules", "catalog", "snapshots", "data");

function snapshotDir() {
  return path.resolve(process.env.V2_CATALOG_SNAPSHOT_DIR || DEFAULT_SNAPSHOT_DIR);
}

function assertPathUnderV2(targetPath) {
  const resolved = path.resolve(targetPath);
  const relative = path.relative(V2_ROOT, resolved);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`snapshot_path_outside_v2:${resolved}`);
  }
  return resolved;
}

function createSnapshotId(createdAt = new Date()) {
  const stamp = createdAt.toISOString().replace(/[-:.]/g, "").replace("T", "-").replace("Z", "Z");
  return `catalog-${stamp}-${crypto.randomBytes(6).toString("hex")}`;
}

async function writeImmutableJson(filePath, payload) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(payload, null, 2)}\n`, {
    encoding: "utf8",
    flag: "wx",
  });
}

async function createCatalogSnapshot(options = {}) {
  const catalog = options.catalog || await buildCatalogReadModel(options);
  const validation = options.validation || validateCatalogReadModel(catalog);
  const createdAtDate = new Date();
  const createdAt = createdAtDate.toISOString();
  const snapshotId = createSnapshotId(createdAtDate);
  const targetDir = assertPathUnderV2(options.snapshotDir || snapshotDir());
  const filePath = assertPathUnderV2(path.join(targetDir, `${snapshotId}.json`));
  const payload = {
    snapshotId,
    createdAt,
    source: catalog.source,
    schemaVersion: CATALOG_SNAPSHOT_SCHEMA_VERSION,
    catalogSchemaVersion: catalog.schemaVersion,
    catalog,
    validation,
  };

  await writeImmutableJson(filePath, payload);

  return {
    snapshotId,
    createdAt,
    schemaVersion: payload.schemaVersion,
    catalogSchemaVersion: payload.catalogSchemaVersion,
    source: payload.source,
    filePath,
    relativePath: path.relative(V2_ROOT, filePath),
    catalogCounts: catalog.counts,
    validationCounts: validation.counts,
  };
}

module.exports = {
  DEFAULT_SNAPSHOT_DIR,
  V2_ROOT,
  createCatalogSnapshot,
  snapshotDir,
};
