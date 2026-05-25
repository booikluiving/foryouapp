"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");

const MODULE_ROOT = path.resolve(__dirname, "..");
const APP_ROOT = path.resolve(MODULE_ROOT, "../..");
const LEGACY_DATA_ROOT = path.join(APP_ROOT, "legacy", "data");
const DEFAULT_DB_DIR = path.join(MODULE_ROOT, "db");
const DEFAULT_DB_PATH = path.join(DEFAULT_DB_DIR, "audience.sqlite");

function nowIso(date = new Date()) {
  return date.toISOString();
}

function safeJsonStringify(value, fallback = "{}") {
  try {
    return JSON.stringify(value);
  } catch {
    return fallback;
  }
}

function safeJsonParse(value, fallback) {
  try {
    return JSON.parse(String(value || ""));
  } catch {
    return fallback;
  }
}

function pathIsInside(parent, child) {
  const relative = path.relative(path.resolve(parent), path.resolve(child));
  return relative === "" || (!!relative && !relative.startsWith("..") && !path.isAbsolute(relative));
}

function assertAudienceStoragePath(filePath) {
  const resolved = path.resolve(filePath || DEFAULT_DB_PATH);
  if (pathIsInside(LEGACY_DATA_ROOT, resolved)) {
    throw new Error(`audience_refuses_legacy_data_path:${resolved}`);
  }
  return resolved;
}

function audienceDbPath() {
  if (process.env.V2_AUDIENCE_DB_PATH) {
    return assertAudienceStoragePath(process.env.V2_AUDIENCE_DB_PATH);
  }
  const dbDir = path.resolve(process.env.V2_AUDIENCE_DB_DIR || DEFAULT_DB_DIR);
  return assertAudienceStoragePath(path.join(dbDir, "audience.sqlite"));
}

function createToken(bytes = 18) {
  return crypto.randomBytes(bytes).toString("base64url").replace(/[^a-zA-Z0-9_-]/g, "");
}

function normalizeToken(input) {
  return String(input || "").trim().replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 120);
}

function toNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function fromBoolean(value) {
  return value ? 1 : 0;
}

function parseSessionRow(row) {
  if (!row) return null;
  return {
    id: Number(row.id || 0),
    publicId: String(row.public_id || ""),
    name: String(row.name || ""),
    startedAt: String(row.started_at || ""),
    endedAt: row.ended_at ? String(row.ended_at) : null,
    createdBy: row.created_by ? String(row.created_by) : null,
    isActive: !row.ended_at,
  };
}

function parseClientRow(row) {
  if (!row) return null;
  return {
    id: Number(row.id || 0),
    sessionId: Number(row.session_id || 0),
    clientId: Number(row.client_id || 0),
    clientKey: String(row.client_key || ""),
    clientTag: String(row.client_tag || ""),
    name: String(row.name || "Anoniem"),
    ip: String(row.ip || ""),
    ua: String(row.ua || ""),
    connectedAt: String(row.connected_at || ""),
    disconnectedAt: row.disconnected_at ? String(row.disconnected_at) : null,
    isBot: !!row.is_bot,
    isOnline: !!row.is_online,
  };
}

function parseChatRow(row) {
  if (!row) return null;
  return {
    id: Number(row.id || 0),
    sessionId: Number(row.session_id || 0),
    time: String(row.time || ""),
    clientId: Number(row.client_id || 0),
    clientKey: String(row.client_key || ""),
    ip: String(row.ip || ""),
    name: String(row.name || "Anoniem"),
    text: String(row.text || ""),
    status: String(row.status || "accepted"),
    detail: row.detail ? String(row.detail) : "",
    isBot: !!row.is_bot,
  };
}

function parsePollRow(row) {
  if (!row) return null;
  return {
    id: Number(row.id || 0),
    sessionId: Number(row.session_id || 0),
    question: String(row.question || ""),
    options: safeJsonParse(row.options_json, []),
    durationSeconds: Number(row.duration_seconds || 0),
    status: String(row.status || "active"),
    startedAt: String(row.started_at || ""),
    endedAt: row.ended_at ? String(row.ended_at) : null,
    createdBy: row.created_by ? String(row.created_by) : null,
  };
}

function parseModerationRow(row) {
  if (!row) return null;
  return {
    id: Number(row.id || 0),
    sessionId: Number(row.session_id || 0),
    time: String(row.time || ""),
    actionType: String(row.action_type || ""),
    scopeKey: String(row.scope_key || ""),
    targetKind: String(row.target_kind || ""),
    targetKey: String(row.target_key || ""),
    targetIp: row.target_ip ? String(row.target_ip) : null,
    targetClientKey: row.target_client_key ? String(row.target_client_key) : null,
    clientLabel: String(row.client_label || ""),
    reason: row.reason ? String(row.reason) : "",
    expiresAt: row.expires_at ? String(row.expires_at) : null,
    createdBy: row.created_by ? String(row.created_by) : null,
  };
}

function parseSignalRow(row) {
  if (!row) return null;
  const payload = safeJsonParse(row.payload_json, null);
  if (payload && typeof payload === "object") return payload;
  return {
    signalId: String(row.signal_id || ""),
    type: String(row.type || ""),
    receivedAt: String(row.received_at || ""),
    sessionId: row.session_ref ? String(row.session_ref) : null,
    clientId: row.client_id ? String(row.client_id) : null,
    clientKey: String(row.client_key || ""),
    channel: String(row.channel || ""),
    text: row.text ? String(row.text) : null,
    reaction: row.reaction ? String(row.reaction) : null,
    pollId: row.poll_id ? Number(row.poll_id) : null,
    pollOptionIndex: row.poll_option_index === null || row.poll_option_index === undefined
      ? null
      : Number(row.poll_option_index),
    isBot: !!row.is_bot,
    simulated: !!row.simulated,
    link: safeJsonParse(row.link_json, { status: String(row.link_status || "unlinked") }),
  };
}

class AudienceStore {
  constructor(options = {}) {
    this.dbPath = assertAudienceStoragePath(options.dbPath || audienceDbPath());
    fs.mkdirSync(path.dirname(this.dbPath), { recursive: true });
    this.db = new DatabaseSync(this.dbPath);
    this.db.exec("PRAGMA journal_mode = WAL;");
    this.db.exec("PRAGMA synchronous = NORMAL;");
    this.migrate();
  }

  close() {
    this.db.close();
  }

  migrate() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS sessions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        public_id TEXT NOT NULL UNIQUE,
        name TEXT NOT NULL,
        started_at TEXT NOT NULL,
        ended_at TEXT,
        created_by TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_sessions_active ON sessions(ended_at, id);

      CREATE TABLE IF NOT EXISTS session_join_tokens (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id INTEGER NOT NULL,
        token TEXT NOT NULL UNIQUE,
        created_at TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        created_by TEXT,
        use_count INTEGER NOT NULL DEFAULT 0,
        last_used_at TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_join_tokens_session ON session_join_tokens(session_id, expires_at, id);

      CREATE TABLE IF NOT EXISTS session_join_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id INTEGER NOT NULL,
        token TEXT,
        joined_at TEXT NOT NULL,
        ip TEXT,
        user_agent TEXT,
        source TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_join_events_session ON session_join_events(session_id, id);

      CREATE TABLE IF NOT EXISTS session_access_grants (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id INTEGER NOT NULL,
        grant_id TEXT NOT NULL UNIQUE,
        token TEXT,
        created_at TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        last_seen_at TEXT,
        ip TEXT,
        user_agent TEXT,
        source TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_access_grants_session ON session_access_grants(session_id, expires_at, id);

      CREATE TABLE IF NOT EXISTS clients (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id INTEGER NOT NULL,
        client_id INTEGER NOT NULL,
        client_key TEXT NOT NULL,
        client_tag TEXT NOT NULL,
        name TEXT NOT NULL,
        ip TEXT,
        ua TEXT,
        connected_at TEXT NOT NULL,
        disconnected_at TEXT,
        is_bot INTEGER NOT NULL DEFAULT 0,
        is_online INTEGER NOT NULL DEFAULT 1,
        UNIQUE(session_id, client_id)
      );
      CREATE INDEX IF NOT EXISTS idx_clients_session_online ON clients(session_id, is_online, id);
      CREATE INDEX IF NOT EXISTS idx_clients_key ON clients(session_id, client_key, id);

      CREATE TABLE IF NOT EXISTS chat_messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id INTEGER,
        time TEXT NOT NULL,
        client_id INTEGER,
        client_key TEXT,
        ip TEXT,
        name TEXT,
        text TEXT NOT NULL,
        status TEXT NOT NULL,
        detail TEXT,
        is_bot INTEGER NOT NULL DEFAULT 0
      );
      CREATE INDEX IF NOT EXISTS idx_chat_session ON chat_messages(session_id, id);
      CREATE INDEX IF NOT EXISTS idx_chat_client ON chat_messages(session_id, client_key, id);

      CREATE TABLE IF NOT EXISTS signals (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        signal_id TEXT NOT NULL UNIQUE,
        session_id INTEGER,
        session_ref TEXT,
        type TEXT NOT NULL,
        received_at TEXT NOT NULL,
        client_id TEXT,
        client_key TEXT,
        client_tag TEXT,
        channel TEXT,
        text TEXT,
        reaction TEXT,
        poll_id INTEGER,
        poll_option_index INTEGER,
        is_bot INTEGER NOT NULL DEFAULT 0,
        simulated INTEGER NOT NULL DEFAULT 0,
        link_status TEXT,
        show_run_id TEXT,
        situation_run_id TEXT,
        situation_id TEXT,
        legacy_situation_id INTEGER,
        link_json TEXT,
        payload_json TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_signals_runtime ON signals(show_run_id, situation_run_id, link_status, id);
      CREATE INDEX IF NOT EXISTS idx_signals_session ON signals(session_id, id);
      CREATE INDEX IF NOT EXISTS idx_signals_type ON signals(type, id);

      CREATE TABLE IF NOT EXISTS polls (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id INTEGER NOT NULL,
        question TEXT NOT NULL,
        options_json TEXT NOT NULL,
        duration_seconds INTEGER NOT NULL,
        status TEXT NOT NULL DEFAULT 'active',
        started_at TEXT NOT NULL,
        ended_at TEXT,
        created_by TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_polls_session ON polls(session_id, status, id);

      CREATE TABLE IF NOT EXISTS poll_votes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        poll_id INTEGER NOT NULL,
        session_id INTEGER NOT NULL,
        client_key TEXT NOT NULL,
        option_index INTEGER NOT NULL,
        voted_at TEXT NOT NULL,
        is_bot INTEGER NOT NULL DEFAULT 0,
        UNIQUE(poll_id, client_key)
      );
      CREATE INDEX IF NOT EXISTS idx_poll_votes_poll ON poll_votes(poll_id, option_index);

      CREATE TABLE IF NOT EXISTS moderation_actions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id INTEGER,
        time TEXT NOT NULL,
        action_type TEXT NOT NULL,
        scope_key TEXT NOT NULL,
        target_kind TEXT,
        target_key TEXT,
        target_ip TEXT,
        target_client_key TEXT,
        client_label TEXT,
        reason TEXT,
        expires_at TEXT,
        created_by TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_moderation_session ON moderation_actions(session_id, id);
      CREATE INDEX IF NOT EXISTS idx_moderation_scope ON moderation_actions(session_id, scope_key, id);

      CREATE TABLE IF NOT EXISTS simulation_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id INTEGER,
        time TEXT NOT NULL,
        event_type TEXT NOT NULL,
        payload_json TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_sim_events_session ON simulation_events(session_id, id);

      CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value_json TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
    `);
  }

  getActiveSession() {
    return parseSessionRow(this.db.prepare(
      "SELECT * FROM sessions WHERE ended_at IS NULL ORDER BY id DESC LIMIT 1"
    ).get());
  }

  getSessionById(id) {
    return parseSessionRow(this.db.prepare("SELECT * FROM sessions WHERE id = ?").get(Number(id || 0)));
  }

  listSessions(limit = 50) {
    return this.db.prepare("SELECT * FROM sessions ORDER BY id DESC LIMIT ?")
      .all(Math.max(1, Math.min(200, Number(limit || 50))))
      .map(parseSessionRow);
  }

  startSession({ name, publicId: requestedPublicId, createdBy = "admin", now = nowIso() } = {}) {
    const sessionName = String(name || "").trim() || `Performance ${now.slice(0, 16).replace("T", " ")}`;
    const publicId = String(requestedPublicId || "").trim()
      || `audience-session-${now.replace(/[-:.]/g, "").replace("T", "-").replace("Z", "Z")}-${createToken(4)}`;
    this.db.exec("BEGIN IMMEDIATE");
    try {
      this.db.prepare("UPDATE polls SET status = 'closed', ended_at = ? WHERE ended_at IS NULL").run(now);
      this.db.prepare("UPDATE sessions SET ended_at = ? WHERE ended_at IS NULL").run(now);
      const insert = this.db.prepare(
        "INSERT INTO sessions (public_id, name, started_at, created_by) VALUES (?, ?, ?, ?)"
      ).run(publicId, sessionName, now, String(createdBy || "admin"));
      this.db.exec("COMMIT");
      return this.getSessionById(Number(insert.lastInsertRowid));
    } catch (err) {
      try { this.db.exec("ROLLBACK"); } catch {}
      throw err;
    }
  }

  stopActiveSession({ createdBy = "admin", now = nowIso() } = {}) {
    const active = this.getActiveSession();
    if (!active) return null;
    this.db.exec("BEGIN IMMEDIATE");
    try {
      this.db.prepare("UPDATE polls SET status = 'closed', ended_at = ? WHERE session_id = ? AND ended_at IS NULL")
        .run(now, active.id);
      this.db.prepare("UPDATE sessions SET ended_at = ? WHERE id = ? AND ended_at IS NULL").run(now, active.id);
      this.deleteSessionAccessArtifacts(active.id);
      this.insertSimulationEvent({ sessionId: active.id, eventType: "session_stop", payload: { createdBy }, now });
      this.db.exec("COMMIT");
      return this.getSessionById(active.id);
    } catch (err) {
      try { this.db.exec("ROLLBACK"); } catch {}
      throw err;
    }
  }

  deleteSessionAccessArtifacts(sessionId) {
    const id = Number(sessionId || 0);
    this.db.prepare("DELETE FROM session_join_tokens WHERE session_id = ?").run(id);
    this.db.prepare("DELETE FROM session_access_grants WHERE session_id = ?").run(id);
  }

  pruneAccess(now = nowIso()) {
    this.db.prepare("DELETE FROM session_join_tokens WHERE expires_at <= ?").run(now);
    this.db.prepare("DELETE FROM session_access_grants WHERE expires_at <= ?").run(now);
  }

  issueJoinToken({ sessionId, ttlMinutes = 720, createdBy = "admin", now = nowIso() } = {}) {
    const safeSessionId = Number(sessionId || 0);
    if (!Number.isInteger(safeSessionId) || safeSessionId < 1) throw new Error("invalid_session_id");
    const safeTtlMinutes = Math.max(5, Math.min(7 * 24 * 60, Number(ttlMinutes || 720)));
    const expiresAt = new Date(Date.parse(now) + safeTtlMinutes * 60 * 1000).toISOString();
    this.pruneAccess(now);
    for (let attempt = 0; attempt < 8; attempt += 1) {
      const token = normalizeToken(createToken(18));
      try {
        const insert = this.db.prepare(
          `INSERT INTO session_join_tokens (session_id, token, created_at, expires_at, created_by)
           VALUES (?, ?, ?, ?, ?)`
        ).run(safeSessionId, token, now, expiresAt, String(createdBy || "admin"));
        return {
          id: Number(insert.lastInsertRowid),
          sessionId: safeSessionId,
          token,
          createdAt: now,
          expiresAt,
          ttlMinutes: safeTtlMinutes,
        };
      } catch (err) {
        if (!String(err && err.message || "").toLowerCase().includes("unique")) throw err;
      }
    }
    throw new Error("token_generation_failed");
  }

  getLatestJoinToken(sessionId, now = nowIso()) {
    const row = this.db.prepare(
      `SELECT id, session_id AS sessionId, token, created_at AS createdAt, expires_at AS expiresAt,
              created_by AS createdBy, use_count AS useCount, last_used_at AS lastUsedAt
       FROM session_join_tokens
       WHERE session_id = ? AND expires_at > ?
       ORDER BY id DESC LIMIT 1`
    ).get(Number(sessionId || 0), now);
    return row || null;
  }

  getJoinToken(token, now = nowIso()) {
    const safeToken = normalizeToken(token);
    if (!safeToken) return null;
    const row = this.db.prepare(
      `SELECT id, session_id AS sessionId, token, created_at AS createdAt, expires_at AS expiresAt,
              created_by AS createdBy, use_count AS useCount, last_used_at AS lastUsedAt
       FROM session_join_tokens
       WHERE token = ? AND expires_at > ?`
    ).get(safeToken, now);
    return row || null;
  }

  touchJoinToken(id, now = nowIso()) {
    this.db.prepare("UPDATE session_join_tokens SET use_count = use_count + 1, last_used_at = ? WHERE id = ?")
      .run(now, Number(id || 0));
  }

  insertJoinEvent({ sessionId, token, ip, userAgent, source = "join_link", now = nowIso() } = {}) {
    this.db.prepare(
      `INSERT INTO session_join_events (session_id, token, joined_at, ip, user_agent, source)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).run(Number(sessionId || 0), normalizeToken(token), now, String(ip || ""), String(userAgent || "").slice(0, 300), String(source || ""));
  }

  countJoinEvents(sessionId) {
    const row = this.db.prepare("SELECT COUNT(*) AS n FROM session_join_events WHERE session_id = ?")
      .get(Number(sessionId || 0));
    return Number(row && row.n || 0);
  }

  countActiveAccessGrants(sessionId, now = nowIso()) {
    const row = this.db.prepare(
      "SELECT COUNT(*) AS n FROM session_access_grants WHERE session_id = ? AND expires_at > ?"
    ).get(Number(sessionId || 0), now);
    return Number(row && row.n || 0);
  }

  issueAccessGrant({ sessionId, token, ip, userAgent, source = "join_link", maxExpiresAt, now = nowIso(), ttlMinutes = 720 } = {}) {
    const safeSessionId = Number(sessionId || 0);
    if (!Number.isInteger(safeSessionId) || safeSessionId < 1) throw new Error("invalid_session_id");
    const nowTs = Date.parse(now);
    const defaultExpiresTs = nowTs + Math.max(5, Math.min(7 * 24 * 60, Number(ttlMinutes || 720))) * 60 * 1000;
    const capTs = Date.parse(String(maxExpiresAt || ""));
    const expiresAt = new Date(Number.isFinite(capTs) ? Math.min(defaultExpiresTs, capTs) : defaultExpiresTs).toISOString();
    this.pruneAccess(now);
    for (let attempt = 0; attempt < 8; attempt += 1) {
      const grantId = normalizeToken(createToken(20));
      try {
        const insert = this.db.prepare(
          `INSERT INTO session_access_grants
             (session_id, grant_id, token, created_at, expires_at, last_seen_at, ip, user_agent, source)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
        ).run(
          safeSessionId,
          grantId,
          normalizeToken(token) || null,
          now,
          expiresAt,
          now,
          String(ip || ""),
          String(userAgent || "").slice(0, 300),
          String(source || "join_link").slice(0, 80)
        );
        return { id: Number(insert.lastInsertRowid), sessionId: safeSessionId, grantId, createdAt: now, expiresAt };
      } catch (err) {
        if (!String(err && err.message || "").toLowerCase().includes("unique")) throw err;
      }
    }
    throw new Error("session_access_grant_issue_failed");
  }

  getAccessGrant(grantId, now = nowIso()) {
    const safeGrantId = normalizeToken(grantId);
    if (!safeGrantId) return null;
    const row = this.db.prepare(
      `SELECT id, session_id AS sessionId, grant_id AS grantId, token, created_at AS createdAt,
              expires_at AS expiresAt, last_seen_at AS lastSeenAt, ip, user_agent AS userAgent, source
       FROM session_access_grants
       WHERE grant_id = ? AND expires_at > ?`
    ).get(safeGrantId, now);
    return row || null;
  }

  touchAccessGrant(id, { ip, now = nowIso() } = {}) {
    this.db.prepare("UPDATE session_access_grants SET last_seen_at = ?, ip = ? WHERE id = ?")
      .run(now, String(ip || ""), Number(id || 0));
  }

  upsertClient(meta = {}) {
    const sessionId = Number(meta.sessionId || 0);
    const clientId = Number(meta.clientId || 0);
    if (!sessionId || !clientId) return null;
    this.db.prepare(
      `INSERT INTO clients
        (session_id, client_id, client_key, client_tag, name, ip, ua, connected_at, disconnected_at, is_bot, is_online)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, 1)
       ON CONFLICT(session_id, client_id) DO UPDATE SET
         client_key = excluded.client_key,
         client_tag = excluded.client_tag,
         name = excluded.name,
         ip = excluded.ip,
         ua = excluded.ua,
         is_bot = excluded.is_bot,
         is_online = 1`
    ).run(
      sessionId,
      clientId,
      String(meta.clientKey || ""),
      String(meta.clientTag || "anon"),
      String(meta.name || "Anoniem"),
      String(meta.ip || ""),
      String(meta.ua || ""),
      String(meta.connectedAt || nowIso()),
      fromBoolean(meta.isBot)
    );
    return parseClientRow(this.db.prepare("SELECT * FROM clients WHERE session_id = ? AND client_id = ?")
      .get(sessionId, clientId));
  }

  disconnectClient({ sessionId, clientId, now = nowIso() } = {}) {
    this.db.prepare(
      "UPDATE clients SET is_online = 0, disconnected_at = ? WHERE session_id = ? AND client_id = ?"
    ).run(now, Number(sessionId || 0), Number(clientId || 0));
  }

  listOnlineClients(sessionId) {
    return this.db.prepare("SELECT * FROM clients WHERE session_id = ? AND is_online = 1 ORDER BY id")
      .all(Number(sessionId || 0))
      .map(parseClientRow);
  }

  insertChatMessage(message = {}) {
    const insert = this.db.prepare(
      `INSERT INTO chat_messages
         (session_id, time, client_id, client_key, ip, name, text, status, detail, is_bot)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      message.sessionId ? Number(message.sessionId) : null,
      String(message.time || nowIso()),
      message.clientId ? Number(message.clientId) : null,
      String(message.clientKey || ""),
      String(message.ip || ""),
      String(message.name || "Anoniem"),
      String(message.text || ""),
      String(message.status || "accepted"),
      message.detail ? String(message.detail) : null,
      fromBoolean(message.isBot)
    );
    return Number(insert.lastInsertRowid);
  }

  recentChatMessages({ sessionId, limit = 80, status } = {}) {
    const safeLimit = Math.max(1, Math.min(240, Number(limit || 80)));
    const rows = status
      ? this.db.prepare(
        "SELECT * FROM chat_messages WHERE session_id = ? AND status = ? ORDER BY id DESC LIMIT ?"
      ).all(Number(sessionId || 0), String(status), safeLimit)
      : this.db.prepare(
        "SELECT * FROM chat_messages WHERE session_id = ? ORDER BY id DESC LIMIT ?"
      ).all(Number(sessionId || 0), safeLimit);
    return rows.map(parseChatRow);
  }

  chatMessages({ sessionId, limit = 5000, status } = {}) {
    const safeLimit = Math.max(1, Math.min(10000, Number(limit || 5000)));
    const rows = status
      ? this.db.prepare(
        "SELECT * FROM chat_messages WHERE session_id = ? AND status = ? ORDER BY id DESC LIMIT ?"
      ).all(Number(sessionId || 0), String(status), safeLimit)
      : this.db.prepare(
        "SELECT * FROM chat_messages WHERE session_id = ? ORDER BY id DESC LIMIT ?"
      ).all(Number(sessionId || 0), safeLimit);
    return rows.map(parseChatRow);
  }

  recentChatMessagesByClientKey({ sessionId, clientKey, limit = 80 } = {}) {
    return this.db.prepare(
      "SELECT * FROM chat_messages WHERE session_id = ? AND client_key = ? ORDER BY id DESC LIMIT ?"
    ).all(Number(sessionId || 0), String(clientKey || ""), Math.max(10, Math.min(200, Number(limit || 80))))
      .map(parseChatRow);
  }

  recentChatMessagesByIp({ sessionId, ip, limit = 80 } = {}) {
    return this.db.prepare(
      "SELECT * FROM chat_messages WHERE session_id = ? AND ip = ? ORDER BY id DESC LIMIT ?"
    ).all(Number(sessionId || 0), String(ip || ""), Math.max(10, Math.min(200, Number(limit || 80))))
      .map(parseChatRow);
  }

  countChatMessages(sessionId, status) {
    const row = this.db.prepare("SELECT COUNT(*) AS n FROM chat_messages WHERE session_id = ? AND status = ?")
      .get(Number(sessionId || 0), String(status || "accepted"));
    return Number(row && row.n || 0);
  }

  insertSignal(signal = {}, meta = {}) {
    const link = signal.link && typeof signal.link === "object" ? signal.link : {};
    this.db.prepare(
      `INSERT OR IGNORE INTO signals
        (signal_id, session_id, session_ref, type, received_at, client_id, client_key, client_tag, channel,
         text, reaction, poll_id, poll_option_index, is_bot, simulated, link_status, show_run_id,
         situation_run_id, situation_id, legacy_situation_id, link_json, payload_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      String(signal.signalId || meta.signalId || `audience-signal-${Date.now()}-${createToken(6)}`),
      meta.sessionDbId ? Number(meta.sessionDbId) : (meta.sessionId ? Number(meta.sessionId) : null),
      signal.sessionId ? String(signal.sessionId) : (meta.sessionRef ? String(meta.sessionRef) : null),
      String(signal.type || ""),
      String(signal.receivedAt || nowIso()),
      signal.clientId ? String(signal.clientId) : (meta.clientId ? String(meta.clientId) : null),
      String(signal.clientKey || meta.clientKey || ""),
      String(signal.clientTag || meta.clientTag || ""),
      String(signal.channel || "public-app"),
      signal.text ? String(signal.text) : null,
      signal.reaction ? String(signal.reaction) : null,
      signal.pollId ? Number(signal.pollId) : null,
      signal.pollOptionIndex === null || signal.pollOptionIndex === undefined ? null : Number(signal.pollOptionIndex),
      fromBoolean(signal.isBot || meta.isBot),
      fromBoolean(signal.simulated || meta.simulated),
      String(link.status || "unlinked"),
      link.showRunId ? String(link.showRunId) : null,
      link.situationRunId ? String(link.situationRunId) : null,
      link.situationId ? String(link.situationId) : null,
      link.legacySituationId === null || link.legacySituationId === undefined ? null : Number(link.legacySituationId),
      safeJsonStringify(link, "{}"),
      safeJsonStringify(signal, "{}")
    );
    return signal;
  }

  readSignals(filter = {}) {
    const clauses = [];
    const args = [];
    if (filter.showRunId) {
      clauses.push("show_run_id = ?");
      args.push(String(filter.showRunId));
    }
    if (filter.situationRunId) {
      clauses.push("situation_run_id = ?");
      args.push(String(filter.situationRunId));
    }
    if (filter.linkStatus) {
      clauses.push("link_status = ?");
      args.push(String(filter.linkStatus));
    }
    if (filter.sessionDbId || filter.sessionId) {
      clauses.push("session_id = ?");
      args.push(Number(filter.sessionDbId || filter.sessionId));
    }
    const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
    return this.db.prepare(`SELECT * FROM signals ${where} ORDER BY id`).all(...args).map(parseSignalRow);
  }

  createPoll({ sessionId, question, options, durationSeconds, createdBy = "admin", now = nowIso() } = {}) {
    this.closeActivePoll(sessionId, { reason: "replaced", now });
    const insert = this.db.prepare(
      `INSERT INTO polls (session_id, question, options_json, duration_seconds, status, started_at, created_by)
       VALUES (?, ?, ?, ?, 'active', ?, ?)`
    ).run(
      Number(sessionId || 0),
      String(question || ""),
      safeJsonStringify(options || [], "[]"),
      Math.max(5, Math.min(3600, Number(durationSeconds || 60))),
      now,
      String(createdBy || "admin")
    );
    return this.getPollById(Number(insert.lastInsertRowid));
  }

  getPollById(id) {
    return parsePollRow(this.db.prepare("SELECT * FROM polls WHERE id = ?").get(Number(id || 0)));
  }

  getActivePoll(sessionId) {
    return parsePollRow(this.db.prepare(
      "SELECT * FROM polls WHERE session_id = ? AND status = 'active' AND ended_at IS NULL ORDER BY id DESC LIMIT 1"
    ).get(Number(sessionId || 0)));
  }

  getLatestPoll(sessionId) {
    return parsePollRow(this.db.prepare(
      "SELECT * FROM polls WHERE session_id = ? ORDER BY id DESC LIMIT 1"
    ).get(Number(sessionId || 0)));
  }

  closeActivePoll(sessionId, { reason = "closed", now = nowIso() } = {}) {
    const poll = this.getActivePoll(sessionId);
    if (!poll) return null;
    this.db.prepare("UPDATE polls SET status = ?, ended_at = ? WHERE id = ?")
      .run(String(reason || "closed"), now, poll.id);
    return this.getPollById(poll.id);
  }

  insertPollVote({ pollId, sessionId, clientKey, optionIndex, isBot = false, now = nowIso() } = {}) {
    const result = this.db.prepare(
      `INSERT OR IGNORE INTO poll_votes (poll_id, session_id, client_key, option_index, voted_at, is_bot)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).run(Number(pollId || 0), Number(sessionId || 0), String(clientKey || ""), Number(optionIndex || 0), now, fromBoolean(isBot));
    return Number(result.changes || 0) > 0;
  }

  pollResults(pollId, optionCount = 0) {
    const counts = Array.from({ length: Math.max(0, Number(optionCount || 0)) }, () => 0);
    const rows = this.db.prepare(
      "SELECT option_index AS optionIndex, COUNT(*) AS n FROM poll_votes WHERE poll_id = ? GROUP BY option_index"
    ).all(Number(pollId || 0));
    let totalVotes = 0;
    for (const row of rows) {
      const index = Number(row.optionIndex || 0);
      const count = Number(row.n || 0);
      if (index >= 0 && index < counts.length) counts[index] = count;
      totalVotes += count;
    }
    return { counts, totalVotes };
  }

  insertModerationAction(action = {}) {
    const insert = this.db.prepare(
      `INSERT INTO moderation_actions
        (session_id, time, action_type, scope_key, target_kind, target_key, target_ip, target_client_key,
         client_label, reason, expires_at, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      action.sessionId ? Number(action.sessionId) : null,
      String(action.time || nowIso()),
      String(action.actionType || ""),
      String(action.scopeKey || ""),
      String(action.targetKind || ""),
      String(action.targetKey || ""),
      action.targetIp ? String(action.targetIp) : null,
      action.targetClientKey ? String(action.targetClientKey) : null,
      String(action.clientLabel || ""),
      action.reason ? String(action.reason) : null,
      action.expiresAt ? String(action.expiresAt) : null,
      action.createdBy ? String(action.createdBy) : null
    );
    return Number(insert.lastInsertRowid);
  }

  moderationActions(sessionId) {
    return this.db.prepare("SELECT * FROM moderation_actions WHERE session_id = ? ORDER BY id")
      .all(Number(sessionId || 0))
      .map(parseModerationRow);
  }

  recentModerationActions({ sessionId, limit = 30 } = {}) {
    return this.db.prepare("SELECT * FROM moderation_actions WHERE session_id = ? ORDER BY id DESC LIMIT ?")
      .all(Number(sessionId || 0), Math.max(1, Math.min(100, Number(limit || 30))))
      .map(parseModerationRow);
  }

  insertSimulationEvent({ sessionId, eventType, payload, now = nowIso() } = {}) {
    this.db.prepare(
      "INSERT INTO simulation_events (session_id, time, event_type, payload_json) VALUES (?, ?, ?, ?)"
    ).run(sessionId ? Number(sessionId) : null, now, String(eventType || ""), safeJsonStringify(payload || {}, "{}"));
  }

  getSetting(key, fallback = null) {
    const row = this.db.prepare("SELECT value_json FROM settings WHERE key = ?").get(String(key || ""));
    if (!row) return fallback;
    return safeJsonParse(row.value_json, fallback);
  }

  setSetting(key, value, now = nowIso()) {
    this.db.prepare(
      `INSERT INTO settings (key, value_json, updated_at)
       VALUES (?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at`
    ).run(String(key || ""), safeJsonStringify(value, "null"), now);
    return value;
  }

  dbInfo() {
    return {
      path: this.dbPath,
      adapter: "node:sqlite",
    };
  }
}

let defaultStore = null;

function getAudienceStore(options = {}) {
  if (options.fresh) return new AudienceStore(options);
  if (!defaultStore) defaultStore = new AudienceStore(options);
  return defaultStore;
}

function resetDefaultAudienceStoreForTests() {
  if (defaultStore) {
    try { defaultStore.close(); } catch {}
  }
  defaultStore = null;
}

module.exports = {
  AudienceStore,
  DEFAULT_DB_PATH,
  MODULE_ROOT,
  audienceDbPath,
  assertAudienceStoragePath,
  getAudienceStore,
  normalizeToken,
  nowIso,
  resetDefaultAudienceStoreForTests,
  safeJsonParse,
  safeJsonStringify,
};
