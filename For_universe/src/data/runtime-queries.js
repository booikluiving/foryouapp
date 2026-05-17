"use strict";

const LOCKED_QUEUE_PREFIX = "algorithm_locked_queue_session_";
const RUN_STARTED_PREFIX = "algorithm_run_started_session_";

function all(db, sql, ...params) {
  return db.prepare(sql).all(...params);
}

function get(db, sql, ...params) {
  return db.prepare(sql).get(...params);
}

function readCurrentSession(db) {
  return get(db, `
    SELECT id, name, started_at AS startedAt, ended_at AS endedAt, updated_at AS updatedAt
    FROM sessions
    WHERE ended_at IS NULL
    ORDER BY started_at DESC, id DESC
    LIMIT 1
  `) || get(db, `
    SELECT id, name, started_at AS startedAt, ended_at AS endedAt, updated_at AS updatedAt
    FROM sessions
    ORDER BY started_at DESC, id DESC
    LIMIT 1
  `) || null;
}

function readSessionRuns(db, sessionId) {
  const safeSessionId = Number(sessionId || 0);
  if (!safeSessionId) return [];
  return all(db, `
    SELECT id, session_id AS sessionId, scene_id AS sceneId, run_order AS runOrder,
      selection_source AS selectionSource, started_at AS startedAt, ended_at AS endedAt,
      heart_count AS heartCount, bored_count AS boredCount, comment_count AS commentCount,
      score, reason, updated_at AS updatedAt
    FROM algorithm_scene_runs
    WHERE session_id = ?
    ORDER BY run_order ASC, id ASC
  `, safeSessionId);
}

function readSetting(db, key) {
  if (!key) return null;
  return get(db, `
    SELECT key, value, updated_at AS updatedAt
    FROM settings
    WHERE key = ?
  `, key) || null;
}

function readRuntimeSource(db) {
  const currentSession = readCurrentSession(db);
  const sessionId = Number(currentSession && currentSession.id || 0);
  const runs = readSessionRuns(db, sessionId);
  const activeRun = runs.find((run) => !run.endedAt) || null;
  const lockedQueueKey = `${LOCKED_QUEUE_PREFIX}${sessionId || 0}`;
  const runStartedKey = `${RUN_STARTED_PREFIX}${sessionId || 0}`;

  return {
    currentSession,
    runs,
    activeRun,
    settings: {
      lockedQueue: readSetting(db, lockedQueueKey),
      runStarted: readSetting(db, runStartedKey),
    },
  };
}

module.exports = {
  LOCKED_QUEUE_PREFIX,
  RUN_STARTED_PREFIX,
  readRuntimeSource,
};
