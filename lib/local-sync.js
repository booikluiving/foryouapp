"use strict";

const SYNC_VERSION = 1;

function normalizeSyncText(value, max = 4000) {
  return String(value === undefined || value === null ? "" : value)
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .trim()
    .slice(0, max);
}

function normalizeSyncIso(value, fallback = "") {
  const raw = normalizeSyncText(value, 80);
  const ts = Date.parse(raw);
  if (!Number.isFinite(ts)) return fallback || "";
  return new Date(ts).toISOString();
}

function compareSyncStamp(left, right) {
  const leftTs = Date.parse(String(left || ""));
  const rightTs = Date.parse(String(right || ""));
  const safeLeft = Number.isFinite(leftTs) ? leftTs : 0;
  const safeRight = Number.isFinite(rightTs) ? rightTs : 0;
  if (safeLeft > safeRight) return 1;
  if (safeLeft < safeRight) return -1;
  return 0;
}

function incomingWins(localUpdatedAt, incomingUpdatedAt) {
  return compareSyncStamp(incomingUpdatedAt, localUpdatedAt) >= 0;
}

function normalizePeerUrl(value) {
  const raw = normalizeSyncText(value, 300).replace(/\/+$/, "");
  if (!raw) return "";
  let parsed = null;
  try {
    parsed = new URL(raw);
  } catch {
    return "";
  }
  if (!["http:", "https:"].includes(parsed.protocol)) return "";
  return `${parsed.protocol}//${parsed.host}${parsed.pathname.replace(/\/+$/, "")}`;
}

function normalizePeerUrls(value) {
  const raw = Array.isArray(value) ? value : [];
  const out = [];
  const seen = new Set();
  for (const item of raw) {
    const url = normalizePeerUrl(typeof item === "string" ? item : item && item.url);
    if (!url || seen.has(url)) continue;
    seen.add(url);
    out.push(url);
  }
  return out;
}

function safeSyncJsonParse(value, fallback) {
  try {
    return JSON.parse(String(value || ""));
  } catch {
    return fallback;
  }
}

function syncSettingIsAllowed(key) {
  const safeKey = String(key || "");
  if (!safeKey) return false;
  if (safeKey === "admin_password_hash_scrypt_v1") return false;
  if (safeKey.startsWith("sync_secret")) return false;
  if (safeKey.startsWith("admin_")) return false;
  if (safeKey.startsWith("osc_profile_")) return true;
  if (safeKey.startsWith("algorithm_run_started_session_")) return true;
  return [
    "algorithm_calibration_count",
    "algorithm_global_prompt",
    "algorithm_prompt_template",
    "algorithm_score_heart_weight",
    "algorithm_score_bored_weight",
    "algorithm_score_comment_weight",
    "algorithm_score_time_normalized_blend",
    "algorithm_variation_character_cooldown_window",
    "algorithm_variation_diversity_weight",
    "algorithm_variation_exploration_weight",
    "algorithm_variation_retry_weight",
    "algorithm_variation_scene_repeat_penalty",
    "stage_output_settings_json",
    "message_slowdown_ms",
    "engagement_comment_points",
    "poll_duration_seconds",
    "sim_defaults_json",
    "osc_commands_json",
  ].includes(safeKey);
}

function normalizeSyncSettingRows(rows = []) {
  return (Array.isArray(rows) ? rows : [])
    .filter((row) => row && syncSettingIsAllowed(row.key))
    .map((row) => ({
      key: String(row.key || ""),
      value: String(row.value === undefined || row.value === null ? "" : row.value),
      updated_at: normalizeSyncIso(row.updated_at || row.updatedAt, new Date(0).toISOString()),
    }));
}

function normalizeOscProfile(input = {}, defaults = {}) {
  const src = input && typeof input === "object" ? input : {};
  const fallback = defaults && typeof defaults === "object" ? defaults : {};
  const listenPort = Number.parseInt(String(src.listenPort ?? src.receivePort ?? fallback.listenPort ?? 1234), 10);
  const sendPort = Number.parseInt(String(src.sendPort ?? fallback.sendPort ?? 0), 10);
  const sendHost = normalizeSyncText(src.sendHost ?? src.feedbackHost ?? fallback.sendHost ?? "", 120);
  return {
    sendEnabled: !!src.sendEnabled && !!sendHost && Number.isInteger(sendPort) && sendPort > 0,
    listenPort: Number.isInteger(listenPort) && listenPort >= 1 && listenPort <= 65535 ? listenPort : 1234,
    sendHost,
    sendPort: Number.isInteger(sendPort) && sendPort >= 0 && sendPort <= 65535 ? sendPort : 0,
    updatedAt: normalizeSyncIso(src.updatedAt || src.updated_at || fallback.updatedAt, ""),
  };
}

module.exports = {
  SYNC_VERSION,
  compareSyncStamp,
  incomingWins,
  normalizeOscProfile,
  normalizePeerUrl,
  normalizePeerUrls,
  normalizeSyncIso,
  normalizeSyncSettingRows,
  safeSyncJsonParse,
  syncSettingIsAllowed,
};
