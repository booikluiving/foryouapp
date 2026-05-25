"use strict";

const crypto = require("node:crypto");
const EventEmitter = require("node:events");
const os = require("node:os");

const {
  AUDIENCE_SIGNAL_SCHEMA_VERSION,
  createAudienceSignalId,
} = require("../../../shared/contracts/audience-v0");
const {
  buildAlgorithmInput,
  linkFromRuntime,
} = require("../signal-normalizer/signal-normalizer");
const { getAudienceStore, normalizeToken, nowIso, safeJsonStringify } = require("../db/audience-store");
const {
  fetchCurrentRuntimeState,
  restoreRuntimeAlgorithmContext,
  sendAudienceSignalsToAlgorithm,
  sendScoreFeedToRuntime,
} = require("../client/runtime-client");
const {
  CROWD_CUES,
  CROWD_MODE_PRESETS,
  ChatSimulator,
} = require("../simulation/chat-simulator");

const SERVICE_VERSION = "v2-audience.0";
const ACCESS_COOKIE = "fy_audience_access";
const ACCESS_TTL_MINUTES = 720;
const JOIN_TOKEN_TTL_MINUTES = 720;
const ALLOWED_REACTIONS = Object.freeze(["heart", "bored"]);
const MESSAGE_SLOWDOWN_MIN_MS = 500;
const MESSAGE_SLOWDOWN_MAX_MS = 8000;
const MESSAGE_SLOWDOWN_DEFAULT_MS = 850;
const ENGAGEMENT_COMMENT_POINTS_MIN = 2;
const ENGAGEMENT_COMMENT_POINTS_MAX = 150;
const ENGAGEMENT_COMMENT_POINTS_DEFAULT = 75;
const ENGAGEMENT_EMOJI_POINTS = 1;
const ENGAGEMENT_COMMENT_MIN_CHARS = 4;
const ENGAGEMENT_DUPLICATE_WINDOW_MS = 30000;
const ADMIN_SETTINGS_KEY = "admin_settings";
const STAGE_SETTINGS_KEY = "stage_output_settings";
const STAGE_OUTPUT_DEFAULTS = Object.freeze({
  showQr: true,
  showChat: true,
  showEmojis: true,
  showLeaderboard: true,
  background: "transparent",
  chatScale: 1,
  chatBottom: 36,
  chatHeight: 940,
  chatX: 0,
  chatFadeStart: 52,
  qrScale: 1,
  qrX: 86,
  qrY: 10,
  emojiScale: 1,
  emojiBurst: 1,
  emojiSpread: 6,
  emojiHeartX: 50,
  emojiFireX: 50,
  emojiLaughX: 50,
  emojiBoredX: 50,
  leaderboardScale: 1,
  leaderboardWidth: 360,
  leaderboardX: 98,
  leaderboardY: 18,
  leaderboardFadeStart: 74,
});
const DIRECT_LINK_RE = /\b(?:https?:\/\/|www\.)\S+/i;
const DOMAIN_RE = /\b(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+(?:com|net|org|nl|be|de|eu|io|gg|tv|co|me|app|dev|info|xyz|ly|to|ai)\b/i;
const PHONE_CANDIDATE_RE = /(?:\+?\d[\d\s().-]{7,}\d)/g;

function clampInt(value, min, max, fallback) {
  const n = Number.parseInt(String(value), 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

function clampFloat(value, min, max, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

function normalizeAdminSettings(raw = {}) {
  const src = raw && typeof raw === "object" ? raw : {};
  return {
    messageSlowdownMs: clampInt(src.messageSlowdownMs, MESSAGE_SLOWDOWN_MIN_MS, MESSAGE_SLOWDOWN_MAX_MS, MESSAGE_SLOWDOWN_DEFAULT_MS),
    engagementCommentPoints: clampInt(
      src.engagementCommentPoints,
      ENGAGEMENT_COMMENT_POINTS_MIN,
      ENGAGEMENT_COMMENT_POINTS_MAX,
      ENGAGEMENT_COMMENT_POINTS_DEFAULT
    ),
  };
}

function normalizeStageSettings(raw = {}, base = STAGE_OUTPUT_DEFAULTS) {
  const src = raw && typeof raw === "object" ? raw : {};
  return {
    showQr: src.showQr === undefined ? !!base.showQr : !!src.showQr,
    showChat: src.showChat === undefined ? !!base.showChat : !!src.showChat,
    showEmojis: src.showEmojis === undefined ? !!base.showEmojis : !!src.showEmojis,
    showLeaderboard: src.showLeaderboard === undefined ? !!base.showLeaderboard : !!src.showLeaderboard,
    background: ["transparent", "black"].includes(String(src.background || base.background))
      ? String(src.background || base.background)
      : "transparent",
    chatScale: clampFloat(src.chatScale, 0.6, 2.2, Number(base.chatScale || 1)),
    chatBottom: clampInt(src.chatBottom, 0, 700, Number(base.chatBottom || 36)),
    chatHeight: clampInt(src.chatHeight, 180, 1800, Number(base.chatHeight || 940)),
    chatX: clampFloat(src.chatX, -50, 50, Number(base.chatX || 0)),
    chatFadeStart: clampInt(src.chatFadeStart, 0, 90, Number(base.chatFadeStart || 52)),
    qrScale: clampFloat(src.qrScale, 0.35, 2.5, Number(base.qrScale || 1)),
    qrX: clampFloat(src.qrX, 0, 100, Number(base.qrX || 86)),
    qrY: clampFloat(src.qrY, 0, 100, Number(base.qrY || 10)),
    emojiScale: clampFloat(src.emojiScale, 0.4, 2.8, Number(base.emojiScale || 1)),
    emojiBurst: clampInt(src.emojiBurst, 1, 6, Number(base.emojiBurst || 2)),
    emojiSpread: clampFloat(src.emojiSpread, 0, 30, Number(base.emojiSpread || 6)),
    emojiHeartX: clampFloat(src.emojiHeartX, 0, 100, Number(base.emojiHeartX || 18)),
    emojiFireX: clampFloat(src.emojiFireX, 0, 100, Number(base.emojiFireX || 38)),
    emojiLaughX: clampFloat(src.emojiLaughX, 0, 100, Number(base.emojiLaughX || 58)),
    emojiBoredX: clampFloat(src.emojiBoredX, 0, 100, Number(base.emojiBoredX || 78)),
    leaderboardScale: clampFloat(src.leaderboardScale, 0.45, 2.4, Number(base.leaderboardScale || 1)),
    leaderboardWidth: clampInt(src.leaderboardWidth, 220, 760, Number(base.leaderboardWidth || 360)),
    leaderboardX: clampFloat(src.leaderboardX, 0, 100, Number(base.leaderboardX || 98)),
    leaderboardY: clampFloat(src.leaderboardY, 0, 100, Number(base.leaderboardY || 18)),
    leaderboardFadeStart: clampInt(src.leaderboardFadeStart, 30, 100, Number(base.leaderboardFadeStart || 74)),
  };
}

function normalizeIp(ip) {
  const raw = String(ip || "unknown");
  if (raw === "::1") return "127.0.0.1";
  if (raw.startsWith("::ffff:")) return raw.slice(7);
  return raw;
}

function sanitizeClientTag(input) {
  const tag = String(input || "").trim().toLowerCase().replace(/[^a-z0-9_-]/g, "").slice(0, 40);
  return tag || "anon";
}

function sanitizeName(input) {
  const name = String(input || "").trim().replace(/\s+/g, " ");
  if (!name) return "Anoniem";
  return name.slice(0, 24);
}

function sanitizeText(input) {
  const text = String(input || "").trim();
  if (!text) return "";
  return text.slice(0, 140);
}

function buildClientKey(ip, clientTag) {
  return `${normalizeIp(ip)}|${sanitizeClientTag(clientTag)}`;
}

function normalizeClientKey(value) {
  const raw = String(value || "").trim();
  const separator = raw.indexOf("|");
  if (separator <= 0) return "";
  return buildClientKey(raw.slice(0, separator), raw.slice(separator + 1));
}

function extractIpFromClientKey(value) {
  const raw = String(value || "").trim();
  const separator = raw.indexOf("|");
  return normalizeIp(separator >= 0 ? raw.slice(0, separator) : raw);
}

function isBotDisplayName(name) {
  return /\(bot\)\s*$/i.test(String(name || "").trim());
}

function isSimulatorClientTag(tag) {
  return sanitizeClientTag(tag).startsWith("sim-");
}

function isSimulatorBotIdentity(meta, name = "", clientTag = "") {
  const resolvedName = sanitizeName(name || (meta && meta.name) || "");
  const resolvedTag = sanitizeClientTag(clientTag || (meta && meta.clientTag) || "");
  if (meta && meta.isInternalSimulator === true && isSimulatorClientTag(resolvedTag)) return true;
  return isSimulatorClientTag(resolvedTag) && (isBotDisplayName(resolvedName) || meta && meta.simulated);
}

function getNameColorHex(name) {
  const hash = crypto.createHash("md5").update(String(name || "Anoniem")).digest();
  const toChannel = (n) => 0x55 + (n % 128);
  const r = toChannel(hash[0]);
  const g = toChannel(hash[1]);
  const b = toChannel(hash[2]);
  return `#${r.toString(16).padStart(2, "0")}${g.toString(16).padStart(2, "0")}${b.toString(16).padStart(2, "0")}`.toUpperCase();
}

function containsLink(input) {
  const text = String(input || "");
  if (!text.trim()) return false;
  const normalized = text.toLowerCase().replace(/\s+/g, "");
  return DIRECT_LINK_RE.test(text) || DOMAIN_RE.test(text) || DOMAIN_RE.test(normalized);
}

function containsPhoneNumber(input) {
  const text = String(input || "");
  if (!text.trim()) return false;
  const candidates = text.toLowerCase().replace(/[o]/g, "0").replace(/[il]/g, "1").match(PHONE_CANDIDATE_RE) || [];
  return candidates.some((candidate) => {
    const digits = candidate.replace(/\D/g, "");
    return digits.length >= 10 && digits.length <= 15;
  });
}

function parseCookieHeader(header) {
  const out = {};
  for (const part of String(header || "").split(";")) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    try {
      out[trimmed.slice(0, eq)] = decodeURIComponent(trimmed.slice(eq + 1));
    } catch {
      out[trimmed.slice(0, eq)] = trimmed.slice(eq + 1);
    }
  }
  return out;
}

function serializeCookie(name, value, options = {}) {
  const parts = [`${name}=${encodeURIComponent(String(value || ""))}`];
  parts.push(`Path=${options.path || "/"}`);
  if (typeof options.maxAge === "number") parts.push(`Max-Age=${Math.max(0, Math.floor(options.maxAge))}`);
  if (options.expires instanceof Date) parts.push(`Expires=${options.expires.toUTCString()}`);
  if (options.httpOnly !== false) parts.push("HttpOnly");
  parts.push(`SameSite=${options.sameSite || "Lax"}`);
  if (options.secure) parts.push("Secure");
  return parts.join("; ");
}

function isHttpsRequest(req) {
  if (req && req.secure) return true;
  return String(req && req.headers && req.headers["x-forwarded-proto"] || "").toLowerCase().includes("https");
}

function isLoopbackIp(ip) {
  const normalized = normalizeIp(ip || "");
  return normalized === "127.0.0.1" || normalized === "localhost";
}

function isLoopbackHostname(hostname) {
  const host = String(hostname || "").toLowerCase();
  return host === "localhost" || host === "127.0.0.1" || host === "::1" || host === "[::1]";
}

function preferredLanIpv4() {
  const privateCandidates = [];
  const otherCandidates = [];
  for (const entries of Object.values(os.networkInterfaces() || {})) {
    for (const entry of entries || []) {
      if (!entry || entry.family !== "IPv4" || entry.internal) continue;
      const ip = String(entry.address || "").trim();
      if (!ip) continue;
      if (ip.startsWith("10.") || ip.startsWith("192.168.") || /^172\.(1[6-9]|2\d|3[0-1])\./.test(ip)) {
        privateCandidates.push(ip);
      } else {
        otherCandidates.push(ip);
      }
    }
  }
  return privateCandidates[0] || otherCandidates[0] || "";
}

function buildBaseUrl(req, port) {
  const protocol = isHttpsRequest(req) ? "https" : "http";
  const lanIp = preferredLanIpv4();
  if (lanIp) return `${protocol}://${lanIp}:${port}`;
  const forwardedHost = String(req && req.headers && req.headers["x-forwarded-host"] || "").split(",")[0].trim();
  const hostHeader = forwardedHost || String(req && req.headers && req.headers.host || "").trim();
  let parsed;
  try {
    parsed = new URL(`${protocol}://${hostHeader || `127.0.0.1:${port}`}`);
  } catch {
    parsed = new URL(`${protocol}://127.0.0.1:${port}`);
  }
  if (isLoopbackHostname(parsed.hostname)) parsed.hostname = "127.0.0.1";
  if (!parsed.port) parsed.port = String(port);
  return parsed.origin;
}

function resolveScope(target = {}, clients = []) {
  const targetKind = String(target.targetKind || target.kind || "").trim().toLowerCase();
  const rawClientKey = String(target.clientKey || target.targetClientKey || "").trim();
  const clientKey = normalizeClientKey(rawClientKey);
  const ip = normalizeIp(target.ip || target.targetIp || extractIpFromClientKey(rawClientKey) || "");
  const preferredKind = targetKind === "client" || targetKind === "ip" ? targetKind : "";
  const matchedClient = clientKey
    ? clients.find((client) => client.clientKey === clientKey)
    : null;
  const inferredKind = preferredKind || (matchedClient && matchedClient.isBot ? "client" : ip ? "ip" : clientKey ? "client" : "");
  if (inferredKind === "client" && clientKey) {
    return {
      kind: "client",
      clientKey,
      ip: extractIpFromClientKey(clientKey),
      scopeKey: `client:${clientKey}`,
    };
  }
  if (inferredKind === "ip" && ip) {
    return {
      kind: "ip",
      ip,
      clientKey,
      scopeKey: `ip:${ip}`,
    };
  }
  return null;
}

function parseScopeKey(scopeKey) {
  const raw = String(scopeKey || "").trim();
  if (raw.startsWith("client:")) {
    const clientKey = normalizeClientKey(raw.slice(7));
    if (!clientKey) return null;
    return { kind: "client", clientKey, ip: extractIpFromClientKey(clientKey), scopeKey: `client:${clientKey}` };
  }
  if (raw.startsWith("ip:")) {
    const ip = normalizeIp(raw.slice(3));
    return ip ? { kind: "ip", ip, clientKey: "", scopeKey: `ip:${ip}` } : null;
  }
  return null;
}

function isMissingAlgorithmScoringContextError(err) {
  const message = err && err.message ? String(err.message) : "";
  return message.includes("algorithm_missing_scoring_context")
    || (message.includes("ENOENT") && message.includes("/algorithm/db/"));
}

class AudienceService extends EventEmitter {
  constructor(options = {}) {
    super();
    this.store = options.store || getAudienceStore(options);
    this.clients = options.clients || {
      fetchCurrentRuntimeState,
      restoreRuntimeAlgorithmContext,
      sendAudienceSignalsToAlgorithm,
      sendScoreFeedToRuntime,
    };
    this.port = Number(options.port || process.env.AUDIENCE_PORT || process.env.PORT || 3026);
    this.startedAt = new Date();
    this.serverInstanceId = `audience-${this.startedAt.getTime().toString(36)}-${crypto.randomBytes(3).toString("hex")}`;
    this.nextClientId = 1;
    this.mutedUsers = new Map();
    this.blockedUsers = new Map();
    this.reactionCounts = { heart: 0, bored: 0 };
    this.messageRate = new Map();
    this.reactionRate = new Map();
    this.adminSettings = normalizeAdminSettings(this.store.getSetting(ADMIN_SETTINGS_KEY, {}));
    this.stageOutputSettings = normalizeStageSettings(this.store.getSetting(STAGE_SETTINGS_KEY, {}));
    this.pollAutoCloseTimer = null;
    this.internalSimulatorKey = crypto.randomBytes(16).toString("hex");
    this.liveScoreDispatchWork = Promise.resolve();
    this.liveScoreDispatchChain = Promise.resolve();
    this.liveScoreDispatchDelayMs = Number.isFinite(Number(options.liveScoreDispatchDelayMs))
      ? Math.max(0, Number(options.liveScoreDispatchDelayMs))
      : 180;
    this.liveScoreDispatchPending = new Map();
    this.liveScoreDispatchTimers = new Map();
    this.liveScoreAggregateVersions = new Map();
    this.liveScoreStatus = {
      ok: null,
      lastAttemptAt: null,
      lastSuccessAt: null,
      lastErrorAt: null,
      error: null,
      scoreCount: 0,
      showRunId: null,
      situationRunId: null,
      runtime: null,
      recoveredMissingAlgorithmContext: false,
      lastRecoveryAt: null,
      recoveryCount: 0,
      queueDepth: 0,
      coalescedCount: 0,
      lastAudienceAggregateVersion: null,
    };
    this.simulation = new ChatSimulator(this);
    this.rebuildEnforcementState();
    this.refreshReactionCounts();
    this.scheduleActivePollAutoClose();
  }

  health() {
    return {
      ok: true,
      service: "audience",
      version: SERVICE_VERSION,
      instanceId: this.serverInstanceId,
      buildVersion: SERVICE_VERSION,
      buildLabel: "Audience V2",
      port: this.port,
      startedAt: this.startedAt.toISOString(),
      uptimeSeconds: Math.round(process.uptime()),
      db: this.store.dbInfo(),
      liveScoreDispatch: { ...this.liveScoreStatus },
    };
  }

  getAdminSettings() {
    this.adminSettings = normalizeAdminSettings(this.adminSettings);
    return { ...this.adminSettings };
  }

  saveAdminSettings(nextSettings = {}) {
    this.adminSettings = normalizeAdminSettings({ ...this.adminSettings, ...nextSettings });
    this.store.setSetting(ADMIN_SETTINGS_KEY, this.adminSettings);
    this.emit("admin-state-changed");
    return this.getAdminSettings();
  }

  updateMessageSlowdown(ms) {
    return this.saveAdminSettings({ messageSlowdownMs: ms });
  }

  updateEngagementCommentPoints(points) {
    return this.saveAdminSettings({ engagementCommentPoints: points });
  }

  getStageControl(req) {
    const baseUrl = buildBaseUrl(req, this.port);
    return {
      path: "/v2/audience/stage",
      url: `${baseUrl}/v2/audience/stage`,
      sessionQrPath: "/v2/audience/stage/session-qr",
      sessionQrUrl: `${baseUrl}/v2/audience/stage/session-qr`,
      settings: normalizeStageSettings(this.stageOutputSettings),
    };
  }

  updateStageSettings(incoming = {}, req = null) {
    this.stageOutputSettings = normalizeStageSettings(incoming, this.stageOutputSettings);
    this.store.setSetting(STAGE_SETTINGS_KEY, this.stageOutputSettings);
    this.emit("broadcast", { type: "stage_settings", stage: this.getStageControl(req) });
    this.emit("admin-state-changed");
    return this.getStageControl(req);
  }

  getActiveSession() {
    return this.store.getActiveSession();
  }

  activeSessionRequired() {
    const session = this.getActiveSession();
    if (!session) {
      const err = new Error("session_inactive");
      err.statusCode = 409;
      throw err;
    }
    return session;
  }

  refreshReactionCounts() {
    const session = this.getActiveSession();
    this.reactionCounts = { heart: 0, bored: 0 };
    if (!session) return this.reactionCounts;
    for (const signal of this.store.readSignals({ sessionId: session.id })) {
      if (signal && signal.type === "heart") this.reactionCounts.heart += 1;
      if (signal && signal.type === "bored") this.reactionCounts.bored += 1;
    }
    return this.reactionCounts;
  }

  buildEngagementLeaderboard(session, users = []) {
    if (!session) {
      return {
        top: [],
        totalPoints: 0,
        totalComments: 0,
        totalReactions: 0,
        uniqueSenders: 0,
      };
    }
    const settings = this.getAdminSettings();
    const onlineByClientKey = new Map();
    const onlineByIp = new Map();
    for (const user of users || []) {
      if (user && user.clientKey) onlineByClientKey.set(String(user.clientKey), user);
      if (user && user.ip) onlineByIp.set(normalizeIp(user.ip), user);
    }
    const entries = new Map();
    const ensureEntry = ({ clientKey = "", ip = "", name = "Anoniem", isBot = false, activityAt = "" } = {}) => {
      const safeClientKey = normalizeClientKey(clientKey);
      const safeIp = normalizeIp(ip || extractIpFromClientKey(safeClientKey) || "");
      const onlineUser = safeClientKey && onlineByClientKey.get(safeClientKey)
        || safeIp && onlineByIp.get(safeIp)
        || null;
      const bot = !!(isBot || onlineUser && onlineUser.isBot);
      const key = bot && safeClientKey ? `client:${safeClientKey}` : `ip:${safeIp || "unknown"}`;
      const existing = entries.get(key) || {
        engagementKey: key,
        clientKey: safeClientKey,
        clientTag: safeClientKey.includes("|") ? safeClientKey.split("|").slice(1).join("|") : "",
        ip: safeIp,
        name: sanitizeName(name || onlineUser && onlineUser.name || "Anoniem"),
        nameColor: getNameColorHex(name || onlineUser && onlineUser.name || "Anoniem"),
        isBot: bot,
        online: !!onlineUser,
        commentCount: 0,
        emojiCount: 0,
        commentPoints: 0,
        emojiPoints: 0,
        score: 0,
        total: 0,
        lastActivityAt: activityAt || "",
      };
      if (onlineUser) {
        existing.online = true;
        existing.name = sanitizeName(onlineUser.name || existing.name);
        existing.nameColor = getNameColorHex(existing.name);
        existing.isBot = !!onlineUser.isBot;
      } else if (name) {
        existing.name = sanitizeName(name);
        existing.nameColor = getNameColorHex(existing.name);
      }
      if (activityAt && String(activityAt) > String(existing.lastActivityAt || "")) {
        existing.lastActivityAt = String(activityAt);
      }
      entries.set(key, existing);
      return existing;
    };

    const duplicateWindowByKey = new Map();
    const comments = this.store.chatMessages({ sessionId: session.id, status: "accepted", limit: 10000 })
      .slice()
      .reverse();
    for (const message of comments) {
      if (!message || String(message.detail || "").startsWith("moderation_notice:")) continue;
      const text = String(message.text || "").trim();
      if (text.length < ENGAGEMENT_COMMENT_MIN_CHARS) continue;
      const entry = ensureEntry({
        clientKey: message.clientKey,
        ip: message.ip,
        name: message.name,
        isBot: message.isBot,
        activityAt: message.time,
      });
      const duplicateKey = `${entry.engagementKey}:${text.toLowerCase()}`;
      const lastTs = Number(duplicateWindowByKey.get(duplicateKey) || 0);
      const thisTs = Date.parse(message.time || "");
      if (Number.isFinite(thisTs) && lastTs && thisTs - lastTs < ENGAGEMENT_DUPLICATE_WINDOW_MS) continue;
      if (Number.isFinite(thisTs)) duplicateWindowByKey.set(duplicateKey, thisTs);
      entry.commentCount += 1;
      entry.commentPoints += settings.engagementCommentPoints;
    }

    for (const signal of this.store.readSignals({ sessionId: session.id })) {
      if (!signal || !["heart", "bored"].includes(String(signal.type || ""))) continue;
      const entry = ensureEntry({
        clientKey: signal.clientKey,
        name: "Anoniem",
        isBot: signal.isBot,
        activityAt: signal.receivedAt,
      });
      entry.emojiCount += 1;
      entry.emojiPoints += ENGAGEMENT_EMOJI_POINTS;
    }

    const top = Array.from(entries.values())
      .map((entry) => {
        const score = Math.max(0, Number(entry.commentPoints || 0) + Number(entry.emojiPoints || 0));
        return {
          ...entry,
          score,
          total: score,
          lastReactionAt: entry.lastActivityAt,
        };
      })
      .filter((entry) => entry.score > 0 || entry.commentCount > 0 || entry.emojiCount > 0)
      .sort((a, b) => b.score - a.score || String(b.lastActivityAt || "").localeCompare(String(a.lastActivityAt || "")));

    return {
      top,
      totalPoints: top.reduce((sum, entry) => sum + Number(entry.score || 0), 0),
      totalComments: top.reduce((sum, entry) => sum + Number(entry.commentCount || 0), 0),
      totalReactions: top.reduce((sum, entry) => sum + Number(entry.emojiCount || 0), 0),
      uniqueSenders: top.length,
    };
  }

  buildJoinPayload(req, tokenInfo) {
    if (!tokenInfo || !tokenInfo.token) return null;
    const token = normalizeToken(tokenInfo.token);
    return {
      sessionId: Number(tokenInfo.sessionId || 0),
      token,
      expiresAt: tokenInfo.expiresAt || null,
      ttlMinutes: Number(tokenInfo.ttlMinutes || JOIN_TOKEN_TTL_MINUTES),
      joinPath: `/join?token=${encodeURIComponent(token)}`,
      joinUrl: `${buildBaseUrl(req, this.port)}/join?token=${encodeURIComponent(token)}`,
    };
  }

  currentJoinPayload(req) {
    const session = this.getActiveSession();
    if (!session) return null;
    return this.buildJoinPayload(req, this.store.getLatestJoinToken(session.id));
  }

  issueJoinToken(req, { ttlMinutes = JOIN_TOKEN_TTL_MINUTES, createdBy = "admin" } = {}) {
    const session = this.activeSessionRequired();
    const token = this.store.issueJoinToken({ sessionId: session.id, ttlMinutes, createdBy });
    return this.buildJoinPayload(req, token);
  }

  startSession(req, { name, tokenTtlMinutes = JOIN_TOKEN_TTL_MINUTES, createdBy = "admin" } = {}) {
    this.simulation.stop("new_session", { quiet: true });
    const session = this.store.startSession({ name, createdBy });
    this.mutedUsers.clear();
    this.blockedUsers.clear();
    this.messageRate.clear();
    this.reactionRate.clear();
    this.reactionCounts = { heart: 0, bored: 0 };
    this.clearPollAutoCloseTimer();
    const join = this.issueJoinToken(req, { ttlMinutes: tokenTtlMinutes, createdBy });
    this.emit("broadcast", { type: "session_reset", message: "Nieuwe sessie gestart. Verbind opnieuw." });
    this.emit("close-all", { code: 4010, reason: "new session" });
    this.emit("admin-state-changed");
    return { session, join };
  }

  stopSession() {
    this.simulation.stop("session_stop", { quiet: true });
    const session = this.store.stopActiveSession({ createdBy: "admin" });
    this.mutedUsers.clear();
    this.blockedUsers.clear();
    this.messageRate.clear();
    this.reactionRate.clear();
    this.reactionCounts = { heart: 0, bored: 0 };
    this.clearPollAutoCloseTimer();
    this.emit("broadcast", { type: "session_closed", message: "Sessie is beeindigd door de moderator." });
    this.emit("close-all", { code: 4011, reason: "session ended" });
    this.emit("admin-state-changed");
    return session;
  }

  registerJoinFromToken(token, req) {
    const active = this.getActiveSession();
    if (!active) return { ok: false, status: 410, error: "session_inactive" };
    const joined = this.store.getJoinToken(token);
    if (!joined || Number(joined.sessionId || 0) !== active.id) {
      return { ok: false, status: 410, error: "join_token_invalid" };
    }
    const ip = normalizeIp(req.socket && req.socket.remoteAddress || "unknown");
    const ua = String(req.headers["user-agent"] || "unknown");
    this.store.touchJoinToken(joined.id);
    this.store.insertJoinEvent({ sessionId: active.id, token, ip, userAgent: ua, source: "join_qr" });
    const grant = this.store.issueAccessGrant({
      sessionId: active.id,
      token,
      ip,
      userAgent: ua,
      source: "join_qr",
      maxExpiresAt: joined.expiresAt,
      ttlMinutes: ACCESS_TTL_MINUTES,
    });
    return { ok: true, grant, session: active };
  }

  setAccessCookie(res, req, grant) {
    const expiresTs = Date.parse(String(grant && grant.expiresAt || ""));
    const finalTs = Number.isFinite(expiresTs) ? expiresTs : Date.now() + ACCESS_TTL_MINUTES * 60 * 1000;
    res.append("Set-Cookie", serializeCookie(ACCESS_COOKIE, grant.grantId, {
      path: "/",
      maxAge: Math.max(0, Math.floor((finalTs - Date.now()) / 1000)),
      expires: new Date(finalTs),
      httpOnly: true,
      sameSite: "Lax",
      secure: isHttpsRequest(req),
    }));
  }

  clearAccessCookie(res, req) {
    res.append("Set-Cookie", serializeCookie(ACCESS_COOKIE, "", {
      path: "/",
      maxAge: 0,
      expires: new Date(0),
      httpOnly: true,
      sameSite: "Lax",
      secure: isHttpsRequest(req),
    }));
  }

  ensureSessionAccessForRequest(req, ip) {
    const active = this.getActiveSession();
    if (!active) return { ok: false, reason: "session_inactive" };
    if (this.hasInternalSimulatorAccess(req, ip)) return { ok: true, reason: "internal_simulator", session: active };
    const cookies = parseCookieHeader(req && req.headers ? req.headers.cookie : "");
    const grant = this.store.getAccessGrant(cookies[ACCESS_COOKIE] || "");
    if (!grant || Number(grant.sessionId || 0) !== active.id) {
      return { ok: false, reason: "session_join_required" };
    }
    this.store.touchAccessGrant(grant.id, { ip: normalizeIp(ip || "") });
    return { ok: true, reason: "grant", grant, session: active };
  }

  hasInternalSimulatorAccess(req, ip) {
    if (!isLoopbackIp(ip)) return false;
    try {
      const parsed = new URL(String(req && req.url || "/"), "ws://localhost");
      return parsed.searchParams.get("simKey") === this.internalSimulatorKey;
    } catch {
      return false;
    }
  }

  createClientMeta(req, access) {
    const clientId = this.nextClientId++;
    const ip = normalizeIp(req.socket && req.socket.remoteAddress || "unknown");
    const clientTag = "anon";
    const session = access && access.session ? access.session : this.getActiveSession();
    return {
      sessionId: session ? session.id : 0,
      sessionPublicId: session ? session.publicId : "",
      clientId,
      ip,
      ua: String(req.headers["user-agent"] || "unknown"),
      connectedAt: nowIso(),
      clientTag,
      name: "Anoniem",
      clientKey: buildClientKey(ip, clientTag),
      isBot: false,
      simulated: false,
      isInternalSimulator: access && access.reason === "internal_simulator",
    };
  }

  persistClient(meta) {
    const isBot = isSimulatorBotIdentity(meta, meta.name, meta.clientTag) || !!meta.isBot || !!meta.simulated;
    meta.isBot = isBot;
    meta.clientKey = buildClientKey(meta.ip, meta.clientTag);
    this.store.upsertClient(meta);
    this.emit("admin-state-changed");
  }

  registerClient(meta, payload = {}) {
    meta.clientTag = sanitizeClientTag(payload.clientTag || meta.clientTag);
    const nextName = sanitizeName(payload.name || meta.name);
    if (!isSimulatorBotIdentity(meta, nextName, meta.clientTag)) {
      if (containsLink(nextName)) return { ok: false, error: { code: "name_link_blocked", message: "Gebruikersnaam mag geen links bevatten." } };
      if (containsPhoneNumber(nextName)) return { ok: false, error: { code: "name_phone_blocked", message: "Gebruikersnaam mag geen telefoonnummers bevatten." } };
    }
    meta.name = nextName;
    meta.clientKey = buildClientKey(meta.ip, meta.clientTag);
    this.persistClient(meta);
    return { ok: true, meta };
  }

  disconnectClient(meta) {
    if (!meta || !meta.sessionId || !meta.clientId) return;
    this.store.disconnectClient({ sessionId: meta.sessionId, clientId: meta.clientId });
    this.emit("admin-state-changed");
  }

  registerSimulatedClient(bot) {
    const session = this.getActiveSession();
    if (!session) return;
    const meta = {
      sessionId: session.id,
      sessionPublicId: session.publicId,
      clientId: bot.clientId,
      clientTag: bot.clientTag,
      clientKey: bot.clientKey,
      name: bot.name,
      ip: bot.ip,
      ua: bot.ua,
      connectedAt: bot.connectedAt || nowIso(),
      isBot: true,
      simulated: true,
      isInternalSimulator: true,
    };
    bot.sessionId = session.id;
    bot.sessionPublicId = session.publicId;
    bot.clientKey = meta.clientKey;
    this.persistClient(meta);
  }

  disconnectSimulatedClient(bot) {
    if (!bot || !bot.sessionId || !bot.clientId) return;
    this.store.disconnectClient({ sessionId: bot.sessionId, clientId: bot.clientId });
    this.emit("admin-state-changed");
  }

  scopeMatchesClient(scope, client) {
    if (!scope || !client) return false;
    if (scope.kind === "client") return String(client.clientKey || "") === String(scope.clientKey || "");
    return normalizeIp(client.ip || "") === String(scope.ip || "");
  }

  getClientLabel(scope) {
    const session = this.getActiveSession();
    const clients = session ? this.store.listOnlineClients(session.id) : [];
    const matched = clients.find((client) => this.scopeMatchesClient(scope, client));
    return sanitizeName(matched && matched.name ? matched.name : "iemand");
  }

  rebuildEnforcementState() {
    this.mutedUsers.clear();
    this.blockedUsers.clear();
    const session = this.getActiveSession();
    if (!session) return;
    for (const action of this.store.moderationActions(session.id)) {
      const scope = parseScopeKey(action.scopeKey);
      if (!scope) continue;
      const state = {
        expiresAt: action.expiresAt || null,
        targetKind: action.targetKind || scope.kind,
        targetIp: action.targetIp || scope.ip || null,
        targetClientKey: action.targetClientKey || scope.clientKey || null,
        targetLabel: action.clientLabel || "iemand",
      };
      if (action.actionType === "mute") this.mutedUsers.set(scope.scopeKey, state);
      if (action.actionType === "unmute") this.mutedUsers.delete(scope.scopeKey);
      if (action.actionType === "block") this.blockedUsers.set(scope.scopeKey, state);
      if (action.actionType === "unblock") this.blockedUsers.delete(scope.scopeKey);
    }
    this.cleanupEnforcementMaps();
  }

  cleanupEnforcementMaps() {
    const now = Date.now();
    for (const [key, state] of this.mutedUsers.entries()) {
      const ts = Date.parse(String(state && state.expiresAt || ""));
      if (Number.isFinite(ts) && ts <= now) this.mutedUsers.delete(key);
    }
    for (const [key, state] of this.blockedUsers.entries()) {
      const ts = Date.parse(String(state && state.expiresAt || ""));
      if (Number.isFinite(ts) && ts <= now) this.blockedUsers.delete(key);
    }
  }

  getMuteState(metaOrScope) {
    this.cleanupEnforcementMaps();
    if (metaOrScope && !metaOrScope.scopeKey) {
      const clientKey = normalizeClientKey(metaOrScope.clientKey || "");
      if (clientKey && this.mutedUsers.has(`client:${clientKey}`)) return this.mutedUsers.get(`client:${clientKey}`);
      const ip = normalizeIp(metaOrScope.ip || extractIpFromClientKey(clientKey) || "");
      if (ip && this.mutedUsers.has(`ip:${ip}`)) return this.mutedUsers.get(`ip:${ip}`);
    }
    const session = this.getActiveSession();
    const clients = session ? this.store.listOnlineClients(session.id) : [];
    const scope = metaOrScope && metaOrScope.scopeKey ? metaOrScope : resolveScope(metaOrScope, clients);
    return scope ? this.mutedUsers.get(scope.scopeKey) || null : null;
  }

  getBlockState(metaOrScope) {
    this.cleanupEnforcementMaps();
    if (metaOrScope && !metaOrScope.scopeKey) {
      const clientKey = normalizeClientKey(metaOrScope.clientKey || "");
      if (clientKey && this.blockedUsers.has(`client:${clientKey}`)) return this.blockedUsers.get(`client:${clientKey}`);
      const ip = normalizeIp(metaOrScope.ip || extractIpFromClientKey(clientKey) || "");
      if (ip && this.blockedUsers.has(`ip:${ip}`)) return this.blockedUsers.get(`ip:${ip}`);
    }
    const session = this.getActiveSession();
    const clients = session ? this.store.listOnlineClients(session.id) : [];
    const scope = metaOrScope && metaOrScope.scopeKey ? metaOrScope : resolveScope(metaOrScope, clients);
    return scope ? this.blockedUsers.get(scope.scopeKey) || null : null;
  }

  recordModerationAction(actionType, scope, meta = {}) {
    const session = this.activeSessionRequired();
    const targetKey = scope.kind === "client" ? scope.clientKey : scope.ip;
    const label = String(meta.targetLabel || "").trim() || this.getClientLabel(scope);
    this.store.insertModerationAction({
      sessionId: session.id,
      actionType,
      scopeKey: scope.scopeKey,
      targetKind: scope.kind,
      targetKey,
      targetIp: scope.ip || null,
      targetClientKey: scope.clientKey || null,
      clientLabel: label,
      reason: meta.reason || "",
      expiresAt: meta.expiresAt || null,
      createdBy: meta.createdBy || "admin",
    });
    return { targetKey, label };
  }

  moderationFeedText(actionType, label, minutes = 0) {
    if (actionType === "mute") return `Moderator heeft ${label} gemute${minutes ? ` (${minutes}m)` : ""}.`;
    if (actionType === "unmute") return `Moderator heeft de mute van ${label} opgeheven.`;
    if (actionType === "block") return `Moderator heeft ${label} geblokkeerd.`;
    if (actionType === "unblock") return `Moderator heeft de blokkade van ${label} opgeheven.`;
    if (actionType === "kick") return `Moderator heeft ${label} verwijderd.`;
    return "";
  }

  publishModerationNotice(actionType, scope, meta = {}) {
    const session = this.getActiveSession();
    if (!session) return null;
    const label = String(meta.targetLabel || "").trim() || this.getClientLabel(scope);
    const text = this.moderationFeedText(actionType, label, Number(meta.minutes || 0));
    if (!text) return null;
    this.store.insertChatMessage({
      sessionId: session.id,
      time: nowIso(),
      clientId: 0,
      clientKey: scope.scopeKey,
      ip: scope.ip || "",
      name: "Melding",
      text,
      status: "accepted",
      detail: `moderation_notice:${actionType}`,
    });
    const payload = { type: "comment", time: nowIso(), name: "Melding", text, system: true };
    this.emit("broadcast", payload);
    return payload;
  }

  setModeration(actionType, target = {}, body = {}) {
    const session = this.activeSessionRequired();
    const scope = resolveScope(target, this.store.listOnlineClients(session.id));
    if (!scope) {
      const err = new Error("clientKey_required");
      err.statusCode = 400;
      throw err;
    }
    const reason = String(body.reason || "").slice(0, 200);
    const targetLabel = this.getClientLabel(scope);
    let response = { ok: true, targetKind: scope.kind, targetKey: scope.kind === "client" ? scope.clientKey : scope.ip };
    if (actionType === "mute") {
      const minutes = clampInt(body.minutes, 1, 180, 5);
      const expiresAt = new Date(Date.now() + minutes * 60 * 1000).toISOString();
      this.mutedUsers.set(scope.scopeKey, { expiresAt, targetKind: scope.kind, targetIp: scope.ip || null, targetClientKey: scope.clientKey || null, targetLabel });
      this.recordModerationAction("mute", scope, { reason, expiresAt, targetLabel });
      this.emit("target", {
        scope,
        message: {
          type: "moderation_notice",
          code: "user_muted",
          message: "Je bent tijdelijk gemute door de moderator.",
          mutedUntil: expiresAt,
          remainingMs: Math.max(0, Date.parse(expiresAt) - Date.now()),
        },
      });
      this.publishModerationNotice("mute", scope, { targetLabel, minutes });
      response = { ...response, mutedUntil: expiresAt };
    } else if (actionType === "unmute") {
      this.mutedUsers.delete(scope.scopeKey);
      this.recordModerationAction("unmute", scope, { reason, targetLabel });
      this.emit("target", { scope, message: { type: "moderation_notice", code: "user_unmuted", message: "Je mute is opgeheven. Je kunt weer reageren." } });
      this.publishModerationNotice("unmute", scope, { targetLabel });
    } else if (actionType === "block") {
      this.blockedUsers.set(scope.scopeKey, { expiresAt: null, targetKind: scope.kind, targetIp: scope.ip || null, targetClientKey: scope.clientKey || null, targetLabel });
      this.recordModerationAction("block", scope, { reason, targetLabel });
      this.emit("target", { scope, message: { type: "moderation_notice", code: "user_blocked", message: "Je bent geblokkeerd door de moderator en wordt verwijderd." } });
      this.publishModerationNotice("block", scope, { targetLabel });
      this.emit("close-scope", { scope, code: 4004, reason: "blocked", delayMs: 120 });
    } else if (actionType === "unblock") {
      this.blockedUsers.delete(scope.scopeKey);
      this.recordModerationAction("unblock", scope, { reason, targetLabel });
      this.publishModerationNotice("unblock", scope, { targetLabel });
    } else if (actionType === "kick") {
      this.recordModerationAction("kick", scope, { reason: reason || "moderator", targetLabel });
      this.emit("target", { scope, message: { type: "moderation_notice", code: "kicked", message: "Je bent verwijderd door de moderator." } });
      this.publishModerationNotice("kick", scope, { targetLabel });
      this.emit("close-scope", { scope, code: 4003, reason: "kicked", delayMs: 80 });
    }
    this.emit("admin-state-changed");
    return response;
  }

  allowRate(map, key, cooldownMs) {
    const now = Date.now();
    const last = map.get(key) || 0;
    if (now - last < cooldownMs) return false;
    map.set(key, now);
    return true;
  }

  async runtimeLink() {
    return linkFromRuntime(await this.clients.fetchCurrentRuntimeState());
  }

  updateLiveScoreStatus(patch = {}) {
    this.liveScoreStatus = {
      ...this.liveScoreStatus,
      ...patch,
    };
    this.emit("admin-state-changed");
  }

  async dispatchLiveScoreForSignal(signal, dispatchContext = {}) {
    if (!signal || !signal.link || signal.link.status !== "linked") return null;
    if (!["heart", "bored", "chat"].includes(String(signal.type || ""))) return null;
    const link = signal.link;
    const currentLink = await this.runtimeLink();
    if (!currentLink
      || currentLink.status !== "linked"
      || currentLink.showRunId !== link.showRunId
      || currentLink.situationRunId !== link.situationRunId) {
      this.updateLiveScoreStatus({
        ok: true,
        skipped: true,
        skippedReason: "runtime_active_situation_changed",
        lastSkippedAt: nowIso(),
        showRunId: link.showRunId || null,
        situationRunId: link.situationRunId || null,
        runtime: null,
      });
      return null;
    }
    const input = await this.algorithmInput({
      showRunId: link.showRunId,
      situationRunId: link.situationRunId,
      sessionId: signal.sessionId,
    });
    if (!input || !input.showRunId || !input.situationRunId || !input.situationId) {
      throw new Error("audience_live_score_missing_algorithm_input");
    }
    if (!input.startedAt && link.startedAt) input.startedAt = link.startedAt;
    if (dispatchContext.audienceAggregateVersion != null) {
      input.audienceAggregateVersion = dispatchContext.audienceAggregateVersion;
    }
    input.createdAt = input.createdAt || nowIso();
    if (!this.clients || typeof this.clients.sendAudienceSignalsToAlgorithm !== "function") {
      throw new Error("audience_algorithm_client_unavailable");
    }
    if (!this.clients || typeof this.clients.sendScoreFeedToRuntime !== "function") {
      throw new Error("audience_runtime_scores_client_unavailable");
    }
    let recoveredMissingAlgorithmContext = false;
    let algorithmResult;
    try {
      algorithmResult = await this.clients.sendAudienceSignalsToAlgorithm(input);
    } catch (err) {
      if (!isMissingAlgorithmScoringContextError(err)
        || !this.clients
        || typeof this.clients.restoreRuntimeAlgorithmContext !== "function") {
        throw err;
      }
      await this.clients.restoreRuntimeAlgorithmContext({
        showRunId: input.showRunId,
        reason: "audience_live_missing_algorithm_context",
      });
      recoveredMissingAlgorithmContext = true;
      algorithmResult = await this.clients.sendAudienceSignalsToAlgorithm(input);
    }
    const scoreFeed = algorithmResult && algorithmResult.scoreFeed;
    if (!scoreFeed || !Array.isArray(scoreFeed.scores)) {
      throw new Error("audience_algorithm_missing_score_feed");
    }
    const runtimeResult = await this.clients.sendScoreFeedToRuntime({
      showRunId: input.showRunId,
      scoreFeed,
      source: "audience_live_algorithm",
    });
    const successAt = nowIso();
    this.updateLiveScoreStatus({
      ok: true,
      lastSuccessAt: successAt,
      error: null,
      showRunId: input.showRunId,
      situationRunId: input.situationRunId,
      scoreCount: scoreFeed.scores.length,
      lastAudienceAggregateVersion: input.audienceAggregateVersion ?? null,
      recoveredMissingAlgorithmContext,
      lastRecoveryAt: recoveredMissingAlgorithmContext ? successAt : this.liveScoreStatus.lastRecoveryAt,
      recoveryCount: recoveredMissingAlgorithmContext ? Number(this.liveScoreStatus.recoveryCount || 0) + 1 : this.liveScoreStatus.recoveryCount,
      runtime: {
        accepted: !!runtimeResult,
        scoreApplied: !!(runtimeResult && runtimeResult.eligiblePoolResorted),
      },
    });
    return { algorithmResult, runtimeResult };
  }

  scheduleLiveScoreDispatch(signal) {
    if (!signal || !signal.link || signal.link.status !== "linked") return;
    if (!["heart", "bored", "chat"].includes(String(signal.type || ""))) return;
    const key = `${signal.link.showRunId || ""}|${signal.link.situationRunId || ""}`;
    const nextVersion = Number(this.liveScoreAggregateVersions.get(key) || 0) + 1;
    this.liveScoreAggregateVersions.set(key, nextVersion);
    const previous = this.liveScoreDispatchPending.get(key);
    this.liveScoreDispatchPending.set(key, {
      signal,
      audienceAggregateVersion: nextVersion,
    });
    this.updateLiveScoreStatus({
      ok: this.liveScoreStatus.ok,
      lastAttemptAt: nowIso(),
      showRunId: signal.link.showRunId || null,
      situationRunId: signal.link.situationRunId || null,
      recoveredMissingAlgorithmContext: false,
      queueDepth: this.liveScoreDispatchPending.size,
      coalescedCount: previous ? Number(this.liveScoreStatus.coalescedCount || 0) + 1 : this.liveScoreStatus.coalescedCount,
      lastAudienceAggregateVersion: nextVersion,
    });
    if (this.liveScoreDispatchTimers.has(key)) return;
    this.liveScoreDispatchChain = new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.liveScoreDispatchTimers.delete(key);
        const pending = this.liveScoreDispatchPending.get(key);
        this.liveScoreDispatchPending.delete(key);
        if (!pending) {
          resolve(null);
          return;
        }
        this.liveScoreDispatchWork = this.liveScoreDispatchWork
          .catch(() => null)
          .then(() => this.dispatchLiveScoreForSignal(pending.signal, {
            audienceAggregateVersion: pending.audienceAggregateVersion,
          }))
          .catch((err) => {
            this.updateLiveScoreStatus({
              ok: false,
              lastErrorAt: nowIso(),
              error: err && err.message ? String(err.message).slice(0, 240) : "unknown_error",
              runtime: null,
              queueDepth: this.liveScoreDispatchPending.size,
            });
          })
          .finally(() => {
            this.updateLiveScoreStatus({
              queueDepth: this.liveScoreDispatchPending.size,
            });
            resolve(null);
          });
      }, this.liveScoreDispatchDelayMs);
      this.liveScoreDispatchTimers.set(key, timer);
    });
  }

  async recordSignal({ type, meta, text = null, reaction = null, pollId = null, pollOptionIndex = null } = {}) {
    const session = this.getActiveSession();
    const link = await this.runtimeLink();
    const signal = {
      schemaVersion: AUDIENCE_SIGNAL_SCHEMA_VERSION,
      signalId: createAudienceSignalId(new Date()),
      type,
      receivedAt: nowIso(),
      sessionId: session ? session.publicId : null,
      clientId: meta && meta.clientKey ? String(meta.clientKey) : null,
      clientKey: meta && meta.clientKey ? String(meta.clientKey) : "",
      clientTag: meta && meta.clientTag ? String(meta.clientTag) : "",
      channel: meta && meta.simulated ? "simulation" : "public-app",
      text,
      reaction,
      pollId,
      pollOptionIndex,
      isBot: !!(meta && meta.isBot),
      simulated: !!(meta && meta.simulated),
      link,
      source: {
        type: "audience-v2-signal",
        readOnly: false,
      },
    };
    this.store.insertSignal(signal, {
      sessionDbId: session ? session.id : null,
      sessionRef: session ? session.publicId : null,
      clientKey: meta && meta.clientKey,
      clientTag: meta && meta.clientTag,
      isBot: meta && meta.isBot,
      simulated: meta && meta.simulated,
    });
    this.scheduleLiveScoreDispatch(signal);
    return signal;
  }

  enforceClient(meta) {
    const block = this.getBlockState(meta);
    if (block) return { ok: false, code: "user_blocked", message: "Je bent geblokkeerd door de moderator." };
    const mute = this.getMuteState(meta);
    if (mute) {
      const ts = Date.parse(String(mute.expiresAt || ""));
      return {
        ok: false,
        code: "user_muted",
        message: "Je bent tijdelijk gemute.",
        mutedUntil: mute.expiresAt || null,
        remainingMs: Number.isFinite(ts) ? Math.max(0, ts - Date.now()) : null,
      };
    }
    return { ok: true };
  }

  async acceptComment(meta, { name, text, skipRateLimit = false } = {}) {
    const session = this.activeSessionRequired();
    meta.clientTag = sanitizeClientTag(meta.clientTag);
    meta.clientKey = buildClientKey(meta.ip, meta.clientTag);
    const cleanName = sanitizeName(name || meta.name);
    const cleanText = sanitizeText(text);
    if (!cleanText) return null;
    const isBot = isSimulatorBotIdentity(meta, cleanName, meta.clientTag) || !!meta.isBot || !!meta.simulated;
    meta.name = cleanName;
    meta.isBot = isBot;
    this.persistClient(meta);

    const enforcement = this.enforceClient(meta);
    if (!enforcement.ok) {
      this.store.insertChatMessage({
        sessionId: session.id,
        clientId: meta.clientId,
        clientKey: meta.clientKey,
        ip: meta.ip,
        name: cleanName,
        text: cleanText,
        status: enforcement.code === "user_muted" ? "muted_user" : "blocked_user",
        detail: enforcement.code,
        isBot,
      });
      return { error: enforcement };
    }
    if (!isBot) {
      if (containsLink(cleanName)) return { error: { code: "name_link_blocked", message: "Gebruikersnaam mag geen links bevatten." } };
      if (containsPhoneNumber(cleanName)) return { error: { code: "name_phone_blocked", message: "Gebruikersnaam mag geen telefoonnummers bevatten." } };
      if (containsLink(cleanText)) return { error: { code: "link_blocked", message: "Bericht verwijderd: links zijn niet toegestaan." } };
      if (containsPhoneNumber(cleanText)) return { error: { code: "phone_blocked", message: "Bericht verwijderd: telefoonnummers zijn niet toegestaan." } };
    }
    const messageSlowdownMs = this.getAdminSettings().messageSlowdownMs;
    if (!skipRateLimit && !isBot && !this.allowRate(this.messageRate, meta.clientKey, messageSlowdownMs)) {
      this.store.insertChatMessage({
        sessionId: session.id,
        clientId: meta.clientId,
        clientKey: meta.clientKey,
        ip: meta.ip,
        name: cleanName,
        text: cleanText,
        status: "rate_limited",
        detail: "slow down",
        isBot,
      });
      return { error: { code: "rate_limited", message: "slow down" } };
    }

    const payload = {
      type: "comment",
      time: nowIso(),
      name: cleanName,
      text: cleanText,
      nameColor: getNameColorHex(cleanName),
      isBot,
      simulated: !!meta.simulated,
    };
    this.store.insertChatMessage({
      sessionId: session.id,
      clientId: meta.clientId,
      clientKey: meta.clientKey,
      ip: meta.ip,
      name: cleanName,
      text: cleanText,
      status: "accepted",
      detail: "",
      isBot,
    });
    await this.recordSignal({ type: "chat", meta, text: cleanText });
    this.emit("broadcast", payload);
    this.simulation.observeAcceptedComment({ ...payload, isBot });
    this.emit("admin-state-changed");
    return { ok: true, payload };
  }

  async acceptReaction(meta, reaction) {
    this.activeSessionRequired();
    const normalized = String(reaction || "").trim().toLowerCase();
    if (!ALLOWED_REACTIONS.includes(normalized)) return { error: { code: "reaction_invalid", message: "Ongeldige reactie." } };
    meta.clientTag = sanitizeClientTag(meta.clientTag);
    meta.clientKey = buildClientKey(meta.ip, meta.clientTag);
    meta.isBot = isSimulatorBotIdentity(meta, meta.name, meta.clientTag) || !!meta.isBot || !!meta.simulated;
    this.persistClient(meta);
    const enforcement = this.enforceClient(meta);
    if (!enforcement.ok) return { error: enforcement };
    if (!meta.isBot && !this.allowRate(this.reactionRate, meta.clientKey, 120)) return { ok: true, throttled: true };
    this.reactionCounts[normalized] = Number(this.reactionCounts[normalized] || 0) + 1;
    await this.recordSignal({ type: normalized, meta, reaction: normalized });
    this.simulation.observeReaction(normalized, !!meta.isBot);
    this.emit("broadcast", { type: "reaction_update", reaction: normalized, counts: { ...this.reactionCounts } });
    this.emit("admin-state-changed");
    return { ok: true, reaction: normalized, counts: { ...this.reactionCounts } };
  }

  getPollEndsAt(poll) {
    if (!poll || !poll.startedAt) return null;
    const started = Date.parse(poll.startedAt);
    if (!Number.isFinite(started)) return null;
    return new Date(started + Math.max(5, Number(poll.durationSeconds || 60)) * 1000).toISOString();
  }

  pollSnapshot(poll) {
    if (!poll) return null;
    const results = this.store.pollResults(poll.id, Array.isArray(poll.options) ? poll.options.length : 0);
    const endsAt = this.getPollEndsAt(poll);
    const endsAtTs = Date.parse(String(endsAt || ""));
    return {
      id: poll.id,
      question: poll.question,
      options: poll.options,
      counts: results.counts,
      totalVotes: results.totalVotes,
      status: poll.status,
      startedAt: poll.startedAt,
      endedAt: poll.endedAt,
      endsAt,
      durationSeconds: poll.durationSeconds,
      remainingMs: Number.isFinite(endsAtTs) ? Math.max(0, endsAtTs - Date.now()) : null,
    };
  }

  getActivePollSnapshot() {
    const session = this.getActiveSession();
    return session ? this.pollSnapshot(this.store.getActivePoll(session.id)) : null;
  }

  clearPollAutoCloseTimer() {
    if (this.pollAutoCloseTimer) clearTimeout(this.pollAutoCloseTimer);
    this.pollAutoCloseTimer = null;
  }

  scheduleActivePollAutoClose() {
    this.clearPollAutoCloseTimer();
    const snapshot = this.getActivePollSnapshot();
    if (!snapshot || !snapshot.endsAt) return;
    const delay = Date.parse(snapshot.endsAt) - Date.now();
    if (delay <= 0) {
      this.closePoll("timeout");
      return;
    }
    this.pollAutoCloseTimer = setTimeout(() => this.closePoll("timeout"), delay);
  }

  startPoll({ question, options, optionsText, durationSeconds = 60 } = {}) {
    const session = this.activeSessionRequired();
    const pollQuestion = String(question || "").trim().slice(0, 180);
    let pollOptions = Array.isArray(options)
      ? options.map((item) => String(item || "").trim()).filter(Boolean)
      : String(optionsText || "").split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    pollOptions = Array.from(new Set(pollOptions.map((item) => item.slice(0, 80)).filter(Boolean)));
    if (!pollQuestion) {
      const err = new Error("question_required");
      err.statusCode = 400;
      throw err;
    }
    if (pollOptions.length < 2 || pollOptions.length > 6) {
      const err = new Error("options_invalid");
      err.statusCode = 400;
      throw err;
    }
    const previous = this.store.getActivePoll(session.id);
    if (previous) this.emit("broadcast", { type: "poll_closed", pollId: previous.id });
    const poll = this.store.createPoll({
      sessionId: session.id,
      question: pollQuestion,
      options: pollOptions,
      durationSeconds,
      createdBy: "admin",
    });
    const snapshot = this.pollSnapshot(poll);
    this.scheduleActivePollAutoClose();
    this.emit("broadcast", { type: "poll_started", poll: snapshot });
    this.simulation.observePollStarted(snapshot);
    this.emit("admin-state-changed");
    return snapshot;
  }

  closePoll(reason = "admin_close") {
    const session = this.getActiveSession();
    if (!session) return null;
    const active = this.store.getActivePoll(session.id);
    if (!active) return null;
    this.store.closeActivePoll(session.id, { reason });
    this.clearPollAutoCloseTimer();
    this.emit("broadcast", { type: "poll_closed", pollId: active.id, reason });
    this.emit("admin-state-changed");
    return active.id;
  }

  async acceptPollVote(meta, pollId, optionIndex) {
    const session = this.activeSessionRequired();
    const poll = this.store.getActivePoll(session.id);
    if (!poll || Number(poll.id) !== Number(pollId)) return { error: { code: "poll_vote_invalid", message: "Ongeldige poll." } };
    const index = Number.parseInt(String(optionIndex), 10);
    if (!Number.isInteger(index) || index < 0 || index >= poll.options.length) {
      return { error: { code: "poll_vote_invalid", message: "Ongeldige poll-optie." } };
    }
    meta.clientTag = sanitizeClientTag(meta.clientTag);
    meta.clientKey = buildClientKey(meta.ip, meta.clientTag);
    meta.isBot = isSimulatorBotIdentity(meta, meta.name, meta.clientTag) || !!meta.isBot || !!meta.simulated;
    this.persistClient(meta);
    const enforcement = this.enforceClient(meta);
    if (!enforcement.ok) return { error: enforcement };
    const inserted = this.store.insertPollVote({
      pollId: poll.id,
      sessionId: session.id,
      clientKey: meta.clientKey,
      optionIndex: index,
      isBot: meta.isBot,
    });
    if (!inserted) return { error: { code: "poll_vote_locked", message: "Je stem is al opgeslagen." } };
    await this.recordSignal({ type: "poll_vote", meta, pollId: poll.id, pollOptionIndex: index });
    const snapshot = this.pollSnapshot(poll);
    this.emit("broadcast", { type: "poll_update", pollId: poll.id, counts: snapshot.counts, totalVotes: snapshot.totalVotes });
    this.emit("admin-state-changed");
    return { ok: true, pollId: poll.id, optionIndex: index };
  }

  async acceptSimulatedComment(bot, text) {
    const session = this.getActiveSession();
    if (!session) return null;
    const meta = {
      sessionId: session.id,
      sessionPublicId: session.publicId,
      clientId: bot.clientId,
      clientTag: bot.clientTag,
      clientKey: bot.clientKey,
      name: bot.name,
      ip: bot.ip,
      ua: bot.ua,
      connectedAt: bot.connectedAt || nowIso(),
      isBot: true,
      simulated: true,
      isInternalSimulator: true,
    };
    return this.acceptComment(meta, { name: bot.name, text, skipRateLimit: true });
  }

  async acceptSimulatedReaction(bot, reaction) {
    const session = this.getActiveSession();
    if (!session) return null;
    const meta = {
      sessionId: session.id,
      sessionPublicId: session.publicId,
      clientId: bot.clientId,
      clientTag: bot.clientTag,
      clientKey: bot.clientKey,
      name: bot.name,
      ip: bot.ip,
      ua: bot.ua,
      connectedAt: bot.connectedAt || nowIso(),
      isBot: true,
      simulated: true,
      isInternalSimulator: true,
    };
    return this.acceptReaction(meta, reaction);
  }

  async acceptSimulatedPollVote(bot, pollId, optionIndex) {
    const session = this.getActiveSession();
    if (!session) return false;
    const meta = {
      sessionId: session.id,
      sessionPublicId: session.publicId,
      clientId: bot.clientId,
      clientTag: bot.clientTag,
      clientKey: bot.clientKey,
      name: bot.name,
      ip: bot.ip,
      ua: bot.ua,
      connectedAt: bot.connectedAt || nowIso(),
      isBot: true,
      simulated: true,
      isInternalSimulator: true,
    };
    const result = await this.acceptPollVote(meta, pollId, optionIndex);
    return !!(result && result.ok);
  }

  recordSimulationEvent(eventType, payload = {}) {
    const session = this.getActiveSession();
    this.store.insertSimulationEvent({ sessionId: session && session.id, eventType, payload });
    this.emit("admin-state-changed");
  }

  publicHistory(limit = 80) {
    const session = this.getActiveSession();
    if (!session) return { ok: false, error: "session_inactive", messages: [] };
    const messages = this.store.recentChatMessages({ sessionId: session.id, limit, status: "accepted" })
      .reverse()
      .map((message) => ({
        type: "comment",
        time: message.time,
        name: message.name || "Anoniem",
        text: message.text,
        nameColor: getNameColorHex(message.name),
        system: String(message.detail || "").startsWith("moderation_notice:"),
        isBot: message.isBot,
      }));
    return { ok: true, sessionId: session.id, messages };
  }

  async adminState(req) {
    const session = this.getActiveSession() || this.store.listSessions(1)[0] || null;
    const active = this.getActiveSession();
    const runtimeResult = await this.clients.fetchCurrentRuntimeState();
    const users = active ? this.store.listOnlineClients(active.id).map((client) => {
      const targetKind = client.isBot ? "client" : "ip";
      const scope = resolveScope({ clientKey: client.clientKey, ip: client.ip, targetKind }, [client]);
      const mute = scope ? this.getMuteState(scope) : null;
      const block = scope ? this.getBlockState(scope) : null;
      return {
        clientId: client.clientId,
        clientKey: client.clientKey,
        clientTag: client.clientTag,
        name: client.name,
        nameColor: getNameColorHex(client.name),
        ip: client.ip,
        ua: client.ua,
        connectedAt: client.connectedAt,
        isBot: client.isBot,
        moderationTargetKind: targetKind,
        moderationTargetKey: targetKind === "client" ? client.clientKey : client.ip,
        isMuted: !!mute,
        mutedUntil: mute && mute.expiresAt ? mute.expiresAt : null,
        isBlocked: !!block,
        blockedUntil: block && block.expiresAt ? block.expiresAt : null,
      };
    }) : [];
    const recentMessages = active ? this.store.recentChatMessages({ sessionId: active.id, limit: 40 }) : [];
    const latestPoll = active ? this.store.getLatestPoll(active.id) : null;
    const activePoll = active ? this.store.getActivePoll(active.id) : null;
    const engagementLeaderboard = active ? this.buildEngagementLeaderboard(active, users) : this.buildEngagementLeaderboard(null, users);
    const activeMuted = Array.from(this.mutedUsers.entries()).map(([scopeKey, state]) => ({
      scopeKey,
      targetKind: state.targetKind,
      targetKey: state.targetKind === "client" ? state.targetClientKey : state.targetIp,
      targetIp: state.targetIp,
      targetClientKey: state.targetClientKey,
      targetLabel: state.targetLabel,
      mutedUntil: state.expiresAt || null,
    }));
    const activeBlocked = Array.from(this.blockedUsers.entries()).map(([scopeKey, state]) => ({
      scopeKey,
      targetKind: state.targetKind,
      targetKey: state.targetKind === "client" ? state.targetClientKey : state.targetIp,
      targetIp: state.targetIp,
      targetClientKey: state.targetClientKey,
      targetLabel: state.targetLabel,
      blockedUntil: state.expiresAt || null,
    }));
    return {
      ok: true,
      now: nowIso(),
      runtime: {
        serviceVersion: SERVICE_VERSION,
        port: this.port,
        dbPath: this.store.dbInfo().path,
        runtimeAvailable: !!(runtimeResult && runtimeResult.ok),
        activeSituation: runtimeResult && runtimeResult.state ? runtimeResult.state.activeSituation || null : null,
        runtimeError: runtimeResult && runtimeResult.error ? runtimeResult.error : null,
        liveScoreDispatch: { ...this.liveScoreStatus },
        messageSlowdownMs: this.getAdminSettings().messageSlowdownMs,
        messageSlowdownMinMs: MESSAGE_SLOWDOWN_MIN_MS,
        messageSlowdownMaxMs: MESSAGE_SLOWDOWN_MAX_MS,
        engagementCommentPoints: this.getAdminSettings().engagementCommentPoints,
        engagementCommentPointsMin: ENGAGEMENT_COMMENT_POINTS_MIN,
        engagementCommentPointsMax: ENGAGEMENT_COMMENT_POINTS_MAX,
        engagementEmojiPoints: ENGAGEMENT_EMOJI_POINTS,
        engagementCommentMinChars: ENGAGEMENT_COMMENT_MIN_CHARS,
        engagementDuplicateWindowMs: ENGAGEMENT_DUPLICATE_WINDOW_MS,
      },
      session: session ? {
        id: session.id,
        publicId: session.publicId,
        name: session.name,
        startedAt: session.startedAt,
        endedAt: session.endedAt,
        isActive: !!(active && session.id === active.id),
        registeredCount: active ? this.store.countJoinEvents(active.id) : 0,
        activeGrantCount: active ? this.store.countActiveAccessGrants(active.id) : 0,
        onlineCount: users.filter((user) => !user.isBot).length,
        onlineBotCount: users.filter((user) => user.isBot).length,
        messageCount: active ? this.store.countChatMessages(active.id, "accepted") : 0,
        rejectedCount: active ? this.store.countChatMessages(active.id, "blocked_user") + this.store.countChatMessages(active.id, "muted_user") : 0,
      } : null,
      users,
      enforcement: {
        muted: activeMuted,
        blocked: activeBlocked,
      },
      reactionCounts: { ...this.reactionCounts },
      activePoll: this.pollSnapshot(activePoll),
      lastPoll: this.pollSnapshot(latestPoll),
      engagementLeaderboard,
      emojiLeaderboard: engagementLeaderboard,
      recentActions: active ? this.store.recentModerationActions({ sessionId: active.id, limit: 30 }) : [],
      recentMessages: recentMessages.map((message) => ({
        ...message,
        nameColor: getNameColorHex(message.name),
      })),
      sessionJoin: req && active ? this.currentJoinPayload(req) : null,
      stage: req ? this.getStageControl(req) : {
        path: "/v2/audience/stage",
        url: "",
        sessionQrPath: "/v2/audience/stage/session-qr",
        sessionQrUrl: "",
        settings: normalizeStageSettings(this.stageOutputSettings),
      },
      simulation: this.simulation.getState(),
      simulationCatalog: {
        crowdModes: Object.entries(CROWD_MODE_PRESETS).map(([id, preset]) => ({ id, label: String(preset.label || id) })),
        crowdCues: Object.entries(CROWD_CUES).map(([id, cue]) => ({ id, label: String(cue.label || id) })),
      },
    };
  }

  async algorithmInput({ showRunId, situationRunId, sessionId } = {}) {
    let resolvedShowRunId = showRunId ? String(showRunId) : "";
    let resolvedSituationRunId = situationRunId ? String(situationRunId) : "";
    const runtimeResult = await this.clients.fetchCurrentRuntimeState();
    if ((!resolvedShowRunId || !resolvedSituationRunId) && runtimeResult && runtimeResult.ok && runtimeResult.state) {
      resolvedShowRunId = resolvedShowRunId || String(runtimeResult.state.showRunId || "");
      resolvedSituationRunId = resolvedSituationRunId
        || String(runtimeResult.state.activeSituation && runtimeResult.state.activeSituation.situationRunId || "");
    }
    if (!resolvedShowRunId || !resolvedSituationRunId) {
      return {
        ok: true,
        schemaVersion: "audience.algorithm-input.v2",
        type: "audienceSignalsForAlgorithm",
        showRunId: resolvedShowRunId || null,
        situationRunId: resolvedSituationRunId || null,
        runtimeLink: linkFromRuntime(runtimeResult),
        audience: { activeClients: 0, linkedSignalCount: 0 },
        chatAppSignals: { heartCount: 0, boredCount: 0, rawMessages: [] },
        rawChat: [],
        metadata: {
          reason: runtimeResult && runtimeResult.ok ? "no_active_situation" : "runtime_unavailable",
          sessionId: sessionId || null,
        },
      };
    }
    const signals = this.store.readSignals({
      showRunId: resolvedShowRunId,
      situationRunId: resolvedSituationRunId,
      linkStatus: "linked",
    });
    const input = buildAlgorithmInput({
      showRunId: resolvedShowRunId,
      situationRunId: resolvedSituationRunId,
      signals,
    });
    input.rawChat = signals
      .filter((signal) => signal.type === "chat" && signal.text)
      .map((signal) => ({
        signalId: signal.signalId,
        receivedAt: signal.receivedAt,
        sessionId: signal.sessionId || null,
        clientId: signal.clientId || null,
        clientKey: signal.clientKey || "",
        text: signal.text,
        isBot: !!signal.isBot,
        simulated: !!signal.simulated,
      }));
    input.metadata = {
      runtimeAvailable: !!(runtimeResult && runtimeResult.ok),
      runtimeError: runtimeResult && runtimeResult.error ? String(runtimeResult.error) : null,
      sessionId: sessionId || null,
      includesRawChatMetadata: true,
    };
    return input;
  }
}

module.exports = {
  ACCESS_COOKIE,
  AudienceService,
  SERVICE_VERSION,
  buildClientKey,
  containsLink,
  containsPhoneNumber,
  getNameColorHex,
  isSimulatorBotIdentity,
  normalizeIp,
  resolveScope,
  sanitizeClientTag,
  sanitizeName,
  sanitizeText,
};
