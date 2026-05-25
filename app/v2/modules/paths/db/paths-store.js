"use strict";

const fs = require("node:fs/promises");
const path = require("node:path");

const { PATHS_STORE_SCHEMA_VERSION, PathsInputError } = require("../contracts/paths-editor-v0");
const { readLegacyPathRows } = require("../legacy-readonly/sqlite-adapter");
const Graph = require("../rules-engine/paden-graph");

const PATHS_ROOT = path.resolve(__dirname, "..");
const V2_ROOT = path.resolve(__dirname, "../../..");
const DEFAULT_STORE_PATH = path.join(PATHS_ROOT, "db", "paths-store.json");

function nowIso() {
  return new Date().toISOString();
}

function assertPathUnderV2(targetPath) {
  const resolved = path.resolve(targetPath);
  const relative = path.relative(V2_ROOT, resolved);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`paths_store_path_outside_v2:${resolved}`);
  }
  return resolved;
}

function pathsStorePath(options = {}) {
  return assertPathUnderV2(options.storePath || process.env.V2_PATHS_STORE_PATH || DEFAULT_STORE_PATH);
}

function emptyStore() {
  const now = nowIso();
  return {
    schemaVersion: PATHS_STORE_SCHEMA_VERSION,
    createdAt: now,
    updatedAt: now,
    nextPathId: 1,
    seededFrom: null,
    paths: [],
    crossingThresholds: [],
  };
}

function numericPathId(value) {
  if (Number.isInteger(value) && value > 0) return value;
  const match = String(value || "").match(/^(?:path:)?(\d+)$/);
  if (!match) return 0;
  const id = Number(match[1]);
  return Number.isInteger(id) && id > 0 ? id : 0;
}

function sanitizeText(value, maxLength) {
  return String(value == null ? "" : value).replace(/\s+/g, " ").trim().slice(0, maxLength);
}

function normalizeStoredPath(raw = {}, fallbackSortOrder = 10) {
  const id = numericPathId(raw.id);
  const sceneIds = Graph.normalizeIdList(raw.sceneIds || []);
  const renderableEdges = Graph.normalizeEdges(
    Array.isArray(raw.edges) ? raw.edges : [],
    sceneIds
  );
  const pathForRules = {
    sceneIds,
    edges: renderableEdges,
    edgeMode: raw.edgeMode || "manual",
  };
  const fallbackEdges = Graph.getRenderableEdges(pathForRules, { fallback: true });
  const now = nowIso();
  return {
    id,
    name: sanitizeText(raw.name || "Naamloos pad", 140) || "Naamloos pad",
    description: sanitizeText(raw.description || "", 1800),
    sortOrder: Number.isFinite(Number(raw.sortOrder)) ? Number(raw.sortOrder) : fallbackSortOrder,
    color: sanitizeText(raw.color || "", 40),
    edgeMode: sanitizeText(raw.edgeMode || "manual", 20) || "manual",
    sceneIds,
    edges: renderableEdges,
    thresholds: Graph.normalizeThresholdsForEdges(raw.thresholds || [], sceneIds, fallbackEdges),
    endSceneIds: Graph.normalizeIdList(raw.endSceneIds || []).filter((sceneId) => sceneIds.includes(sceneId)),
    blockRules: Graph.normalizeBlockRules(raw.blockRules || [], sceneIds),
    ignoreCrossingBlockSceneIds: Graph.normalizeIgnoreCrossingBlockSceneIds(raw.ignoreCrossingBlockSceneIds || raw, sceneIds),
    isActive: raw.isActive !== false,
    archivedAt: raw.archivedAt || "",
    createdAt: raw.createdAt || now,
    updatedAt: raw.updatedAt || now,
  };
}

function normalizeCrossingThreshold(raw = {}) {
  const sceneId = Graph.normalizeId(raw.sceneId || raw.targetSceneId);
  const requiredCount = Math.max(1, Number.parseInt(String(raw.requiredCount || raw.required || raw.count || 1), 10));
  if (!sceneId) return null;
  return {
    sceneId,
    requiredCount,
    createdAt: raw.createdAt || nowIso(),
    updatedAt: raw.updatedAt || nowIso(),
  };
}

function normalizeStore(raw) {
  const base = emptyStore();
  const store = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
  const paths = (Array.isArray(store.paths) ? store.paths : [])
    .map((item, index) => normalizeStoredPath(item, (index + 1) * 10))
    .filter((item) => item.id > 0)
    .sort((a, b) => (a.archivedAt ? 1 : 0) - (b.archivedAt ? 1 : 0)
      || (a.isActive === b.isActive ? 0 : a.isActive ? -1 : 1)
      || a.sortOrder - b.sortOrder
      || String(a.name).localeCompare(String(b.name))
      || a.id - b.id);
  const maxId = paths.reduce((max, item) => Math.max(max, item.id), 0);
  return {
    ...base,
    ...store,
    schemaVersion: PATHS_STORE_SCHEMA_VERSION,
    nextPathId: Math.max(Number(store.nextPathId || 1), maxId + 1),
    paths,
    crossingThresholds: Graph.normalizeCrossingThresholdsForPaths(
      (Array.isArray(store.crossingThresholds) ? store.crossingThresholds : [])
        .map(normalizeCrossingThreshold)
        .filter(Boolean),
      paths
    ),
  };
}

function groupBy(rows, key) {
  const map = new Map();
  for (const row of rows || []) {
    const id = Number(row[key] || 0);
    if (!map.has(id)) map.set(id, []);
    map.get(id).push(row);
  }
  return map;
}

function storeFromLegacyRows(rows) {
  const sceneRowsByPath = groupBy(rows.pathScenes, "path_id");
  const edgeRowsByPath = groupBy(rows.pathEdges, "path_id");
  const thresholdRowsByPath = groupBy(rows.pathThresholds, "path_id");
  const blockRowsByPath = groupBy(rows.pathNodeBlocks, "path_id");
  const paths = (rows.paths || []).map((row) => {
    const id = Number(row.id || 0);
    const sceneRows = sceneRowsByPath.get(id) || [];
    return normalizeStoredPath({
      id,
      name: row.name,
      description: row.description,
      sortOrder: row.sort_order,
      color: row.color,
      edgeMode: row.edge_mode || "legacy",
      sceneIds: sceneRows.map((item) => Number(item.scene_id || 0)),
      endSceneIds: sceneRows.filter((item) => Number(item.is_end_node || 0) > 0).map((item) => Number(item.scene_id || 0)),
      ignoreCrossingBlockSceneIds: sceneRows.filter((item) => Number(item.ignore_crossing_blocks || 0) > 0).map((item) => Number(item.scene_id || 0)),
      edges: (edgeRowsByPath.get(id) || []).map((item) => ({
        fromSceneId: item.from_scene_id,
        toSceneId: item.to_scene_id,
        edgeType: item.edge_type || "required",
      })),
      thresholds: (thresholdRowsByPath.get(id) || []).map((item) => ({
        sourceSceneId: item.source_scene_id,
        requiredCount: item.required_count,
      })),
      blockRules: (blockRowsByPath.get(id) || []).map((item) => ({
        sourceSceneId: item.source_scene_id,
        includeCrossingPaths: Number(item.include_crossing_paths || 0) > 0,
      })),
      isActive: Number(row.is_active || 0) > 0,
      archivedAt: row.archived_at || "",
      createdAt: row.created_at || "",
      updatedAt: row.updated_at || "",
    });
  });
  const crossingThresholds = (rows.crossingThresholds || [])
    .map((row) => normalizeCrossingThreshold({
      sceneId: row.scene_id,
      requiredCount: row.required_count,
      createdAt: row.created_at || "",
      updatedAt: row.updated_at || "",
    }))
    .filter(Boolean);
  return normalizeStore({
    ...emptyStore(),
    seededFrom: rows.source,
    paths,
    crossingThresholds,
  });
}

async function seedStoreFromLegacy(options = {}) {
  const rows = await readLegacyPathRows(options);
  return storeFromLegacyRows(rows);
}

async function readPathsStore(options = {}) {
  const filePath = pathsStorePath(options);
  try {
    return normalizeStore(JSON.parse(await fs.readFile(filePath, "utf8")));
  } catch (err) {
    if (!err || err.code !== "ENOENT") throw err;
  }
  const seeded = options.seedFromLegacy === false ? emptyStore() : await seedStoreFromLegacy(options);
  return writePathsStore(seeded, options);
}

async function writePathsStore(store, options = {}) {
  const filePath = pathsStorePath(options);
  const normalized = normalizeStore({ ...store, updatedAt: nowIso() });
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const tempPath = assertPathUnderV2(path.join(path.dirname(filePath), `.${path.basename(filePath)}.${process.pid}.${Date.now()}.tmp`));
  await fs.writeFile(tempPath, `${JSON.stringify(normalized, null, 2)}\n`, "utf8");
  await fs.rename(tempPath, filePath);
  return normalized;
}

function validatePathPayload(pathItem, catalog = {}) {
  const issues = [];
  if (!pathItem.name) issues.push({ code: "path_missing_name", message: "Path name is required." });
  if (!pathItem.sceneIds.length) issues.push({ code: "path_without_scenes", message: "Path needs at least one situation." });
  const knownSceneIds = new Set((catalog.scenes || []).filter((scene) => scene && scene.isActive !== false && !scene.archivedAt).map((scene) => Number(scene.id || 0)));
  for (const sceneId of pathItem.sceneIds) {
    if (knownSceneIds.size && !knownSceneIds.has(sceneId)) {
      issues.push({ code: "path_scene_missing", message: `Situation ${sceneId} does not exist.`, sceneId });
    }
  }
  const seenEdges = new Set();
  for (const edge of pathItem.edges) {
    if (!pathItem.sceneIds.includes(edge.fromSceneId) || !pathItem.sceneIds.includes(edge.toSceneId)) {
      issues.push({ code: "path_edge_scene_missing", message: "Edge references a situation outside the path.", edge });
    }
    if (edge.fromSceneId === edge.toSceneId) {
      issues.push({ code: "path_edge_self", message: "An edge cannot point to itself.", edge });
    }
    const key = Graph.edgeKey(edge);
    if (seenEdges.has(key)) issues.push({ code: "path_edge_duplicate", message: "Duplicate edge.", edge });
    seenEdges.add(key);
  }
  if (pathItem.edges.length && Graph.connectedComponentCount(pathItem.sceneIds, pathItem.edges) > 1) {
    issues.push({ code: "path_disconnected_components", message: "Disconnected path parts are not allowed." });
  }
  if (issues.length) throw new PathsInputError("path_invalid", issues);
}

async function upsertPath(payload = {}, options = {}) {
  const store = await readPathsStore(options);
  const incomingId = numericPathId(payload.id);
  const existing = incomingId ? store.paths.find((item) => item.id === incomingId) : null;
  if (incomingId && !existing) throw new PathsInputError("path_not_found", [], 404);
  const nextSortOrder = Object.prototype.hasOwnProperty.call(payload, "sortOrder")
    ? Number(payload.sortOrder || 0)
    : existing
      ? existing.sortOrder
      : store.paths.reduce((max, item) => Math.max(max, Number(item.sortOrder || 0)), 0) + 10;
  const id = existing ? existing.id : store.nextPathId;
  const pathItem = normalizeStoredPath({
    ...(existing || {}),
    ...payload,
    id,
    sortOrder: nextSortOrder,
    isActive: payload.isActive !== false,
    archivedAt: payload.isActive === false ? (existing && existing.archivedAt || "") : "",
    createdAt: existing && existing.createdAt || nowIso(),
    updatedAt: nowIso(),
  }, nextSortOrder);
  if (options.catalog) validatePathPayload(pathItem, options.catalog);
  const nextStore = {
    ...store,
    nextPathId: existing ? store.nextPathId : Math.max(store.nextPathId, id + 1),
    paths: existing
      ? store.paths.map((item) => item.id === id ? pathItem : item)
      : [...store.paths, pathItem],
  };
  const written = await writePathsStore(nextStore, options);
  return written.paths.find((item) => item.id === id);
}

async function upsertCrossingThreshold(payload = {}, options = {}) {
  const store = await readPathsStore(options);
  const sceneId = Graph.normalizeId(payload.sceneId || payload.targetSceneId);
  if (!sceneId) throw new PathsInputError("scene_not_found", [], 404);
  const activePaths = store.paths.filter((item) => item.isActive !== false && !item.archivedAt);
  const incomingRoutes = Graph.crossingIncomingRoutesForPaths(activePaths, sceneId);
  const incomingPathCount = new Set(incomingRoutes.map((route) => Graph.normalizeId(route.pathId))).size;
  const incomingCount = incomingRoutes.length;
  const maxRequired = Math.max(incomingCount, 1);
  const requiredCount = Math.min(maxRequired, Math.max(1, Number.parseInt(String(payload.requiredCount || payload.required || payload.count || maxRequired), 10)));
  const now = nowIso();
  const existing = store.crossingThresholds.find((item) => item.sceneId === sceneId);
  const others = store.crossingThresholds.filter((item) => item.sceneId !== sceneId);
  const crossingThresholds = incomingCount <= 1 || incomingPathCount <= 1 || requiredCount >= incomingCount
    ? others
    : [...others, {
      sceneId,
      requiredCount,
      createdAt: existing && existing.createdAt || now,
      updatedAt: now,
    }];
  const written = await writePathsStore({ ...store, crossingThresholds }, options);
  return written.crossingThresholds.find((item) => item.sceneId === sceneId) || null;
}

async function archivePath(id, options = {}) {
  const store = await readPathsStore(options);
  const safeId = numericPathId(id);
  const existing = store.paths.find((item) => item.id === safeId);
  if (!existing) throw new PathsInputError("path_not_found", [], 404);
  const archivedAt = nowIso();
  const archived = { ...existing, isActive: false, archivedAt, updatedAt: archivedAt };
  await writePathsStore({
    ...store,
    paths: store.paths.map((item) => item.id === safeId ? archived : item),
  }, options);
  return { kind: "path", id: safeId };
}

async function deleteInactivePath(id, options = {}) {
  const store = await readPathsStore(options);
  const safeId = numericPathId(id);
  const existing = store.paths.find((item) => item.id === safeId);
  if (!existing) throw new PathsInputError("path_not_found", [], 404);
  if (existing.isActive !== false && !existing.archivedAt) {
    throw new PathsInputError("path_must_be_archived_first", [], 409);
  }
  await writePathsStore({
    ...store,
    paths: store.paths.filter((item) => item.id !== safeId),
  }, options);
  return { kind: "path", id: safeId };
}

module.exports = {
  DEFAULT_STORE_PATH,
  PATHS_ROOT,
  V2_ROOT,
  archivePath,
  deleteInactivePath,
  normalizeStore,
  numericPathId,
  pathsStorePath,
  readPathsStore,
  storeFromLegacyRows,
  upsertCrossingThreshold,
  upsertPath,
  validatePathPayload,
  writePathsStore,
};
