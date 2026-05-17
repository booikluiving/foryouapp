"use strict";

const SOURCE_TABLES = [
  "algorithm_paths",
  "algorithm_path_scenes",
  "algorithm_path_edges",
  "algorithm_path_thresholds",
  "algorithm_path_node_blocks",
  "algorithm_crossing_thresholds",
  "algorithm_scenes",
  "algorithm_scene_runs",
  "sessions",
  "settings",
];

function all(db, sql) {
  return db.prepare(sql).all();
}

function readAlgorithmSource(db) {
  return {
    paths: all(db, `
      SELECT id, name, description, sort_order AS sortOrder, color, edge_mode AS edgeMode,
        is_active AS isActive, archived_at AS archivedAt, created_at AS createdAt, updated_at AS updatedAt
      FROM algorithm_paths
      ORDER BY archived_at IS NOT NULL ASC, is_active DESC, sort_order ASC, name COLLATE NOCASE ASC, id ASC
    `),
    pathScenes: all(db, `
      SELECT id, path_id AS pathId, scene_id AS sceneId, sort_order AS sortOrder,
        is_end_node AS isEndNode, ignore_crossing_blocks AS ignoreCrossingBlocks,
        created_at AS createdAt, updated_at AS updatedAt
      FROM algorithm_path_scenes
      ORDER BY path_id ASC, sort_order ASC, id ASC
    `),
    pathEdges: all(db, `
      SELECT id, path_id AS pathId, from_scene_id AS fromSceneId, to_scene_id AS toSceneId,
        edge_type AS edgeType, sort_order AS sortOrder, created_at AS createdAt, updated_at AS updatedAt
      FROM algorithm_path_edges
      ORDER BY path_id ASC, sort_order ASC, id ASC
    `),
    thresholds: all(db, `
      SELECT id, path_id AS pathId, source_scene_id AS sourceSceneId, required_count AS requiredCount,
        created_at AS createdAt, updated_at AS updatedAt
      FROM algorithm_path_thresholds
      ORDER BY path_id ASC, source_scene_id ASC, id ASC
    `),
    nodeBlocks: all(db, `
      SELECT id, path_id AS pathId, source_scene_id AS sourceSceneId,
        include_crossing_paths AS includeCrossingPaths, created_at AS createdAt, updated_at AS updatedAt
      FROM algorithm_path_node_blocks
      ORDER BY path_id ASC, source_scene_id ASC, id ASC
    `),
    crossingThresholds: all(db, `
      SELECT id, scene_id AS sceneId, required_count AS requiredCount, created_at AS createdAt, updated_at AS updatedAt
      FROM algorithm_crossing_thresholds
      ORDER BY scene_id ASC, id ASC
    `),
    scenes: all(db, `
      SELECT id, title, sort_order AS sortOrder, character_count AS characterCount,
        character_slots_json AS characterSlotsJson, character_ids_json AS characterIdsJson,
        situation_ids_json AS situationIdsJson, label_ids_json AS labelIdsJson,
        environment_id AS environmentId, environment_mode AS environmentMode,
        context_scene_id AS contextSceneId, prompt_override AS promptOverride,
        is_active AS isActive, archived_at AS archivedAt, created_at AS createdAt, updated_at AS updatedAt
      FROM algorithm_scenes
      ORDER BY archived_at IS NOT NULL ASC, is_active DESC, sort_order ASC, title COLLATE NOCASE ASC, id ASC
    `),
    runs: all(db, `
      SELECT id, session_id AS sessionId, scene_id AS sceneId, run_order AS runOrder,
        selection_source AS selectionSource, started_at AS startedAt, ended_at AS endedAt,
        heart_count AS heartCount, bored_count AS boredCount, comment_count AS commentCount,
        score, reason, updated_at AS updatedAt
      FROM algorithm_scene_runs
      ORDER BY session_id ASC, run_order ASC, id ASC
    `),
  };
}

function readSourceSchema(db) {
  return SOURCE_TABLES.map((tableName) => ({
    table: tableName,
    columns: all(db, `PRAGMA table_info(${tableName})`).map((column) => ({
      cid: Number(column.cid || 0),
      name: String(column.name || ""),
      type: String(column.type || ""),
      notNull: Number(column.notnull || 0) > 0,
      defaultValue: column.dflt_value,
      primaryKey: Number(column.pk || 0) > 0,
    })),
  }));
}

function readCounts(db) {
  const counts = {};
  for (const tableName of SOURCE_TABLES) {
    const row = db.prepare(`SELECT COUNT(*) AS count FROM ${tableName}`).get();
    counts[tableName] = Number(row && row.count || 0);
  }
  return counts;
}

module.exports = {
  SOURCE_TABLES,
  readAlgorithmSource,
  readCounts,
  readSourceSchema,
};
