"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs/promises");
const path = require("node:path");

const { buildPathsSnapshot } = require("../read-model/build-snapshot");
const { validatePathsSnapshot } = require("../validation/validate-paths");

const V2_ROOT = path.resolve(__dirname, "../../..");
const DEFAULT_SNAPSHOT_DIR = path.join(V2_ROOT, "modules", "paths", "snapshots", "data");

function snapshotDir() {
  return path.resolve(process.env.V2_PATHS_SNAPSHOT_DIR || DEFAULT_SNAPSHOT_DIR);
}

function assertPathUnderV2(targetPath) {
  const resolved = path.resolve(targetPath);
  const relative = path.relative(V2_ROOT, resolved);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`paths_snapshot_path_outside_v2:${resolved}`);
  }
  return resolved;
}

function createSnapshotId(createdAtDate = new Date()) {
  const stamp = createdAtDate.toISOString().replace(/[-:.]/g, "").replace("T", "-").replace("Z", "Z");
  return `paths-${stamp}-${crypto.randomBytes(6).toString("hex")}`;
}

async function writeImmutableJson(filePath, payload) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(payload, null, 2)}\n`, {
    encoding: "utf8",
    flag: "wx",
  });
}

async function createPathsSnapshot(options = {}) {
  const paths = options.paths || await buildPathsSnapshot(options);
  const validation = options.validation || validatePathsSnapshot(paths);
  const createdAtDate = new Date();
  const createdAt = createdAtDate.toISOString();
  const snapshotId = createSnapshotId(createdAtDate);
  const targetDir = assertPathUnderV2(options.snapshotDir || snapshotDir());
  const filePath = assertPathUnderV2(path.join(targetDir, `${snapshotId}.json`));
  const payload = {
    snapshotId,
    createdAt,
    source: paths.source,
    schemaVersion: paths.schemaVersion,
    paths,
    validation,
  };
  await writeImmutableJson(filePath, payload);
  return {
    snapshotId,
    createdAt,
    schemaVersion: payload.schemaVersion,
    source: payload.source,
    filePath,
    relativePath: path.relative(V2_ROOT, filePath),
    counts: paths.counts,
    validationCounts: validation.counts,
  };
}

module.exports = {
  DEFAULT_SNAPSHOT_DIR,
  V2_ROOT,
  createPathsSnapshot,
  snapshotDir,
};
