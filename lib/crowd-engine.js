"use strict";

const CROWD_MODE_PRESETS = Object.freeze({
  normal: {
    label: "Normaal",
    activity: 1,
    reaction: 1,
    silence: 0.08,
    hype: 0.48,
    confusion: 0.34,
    skepticism: 0.42,
    warmth: 0.48,
    chaos: 0.32,
  },
  soft: {
    label: "Zacht",
    activity: 0.62,
    reaction: 0.72,
    silence: 0.22,
    hype: 0.24,
    confusion: 0.26,
    skepticism: 0.22,
    warmth: 0.7,
    chaos: 0.14,
  },
  nervous: {
    label: "Nerveus",
    activity: 1.1,
    reaction: 1.12,
    silence: 0.1,
    hype: 0.36,
    confusion: 0.72,
    skepticism: 0.5,
    warmth: 0.34,
    chaos: 0.52,
  },
  chaotic: {
    label: "Chaotisch",
    activity: 1.42,
    reaction: 1.55,
    silence: 0.04,
    hype: 0.68,
    confusion: 0.64,
    skepticism: 0.5,
    warmth: 0.42,
    chaos: 0.84,
  },
  critical: {
    label: "Kritisch",
    activity: 0.96,
    reaction: 0.82,
    silence: 0.13,
    hype: 0.22,
    confusion: 0.42,
    skepticism: 0.82,
    warmth: 0.22,
    chaos: 0.36,
  },
  hyped: {
    label: "Hyped",
    activity: 1.32,
    reaction: 1.8,
    silence: 0.02,
    hype: 0.9,
    confusion: 0.32,
    skepticism: 0.22,
    warmth: 0.72,
    chaos: 0.52,
  },
  quiet: {
    label: "Stil",
    activity: 0.22,
    reaction: 0.35,
    silence: 0.62,
    hype: 0.14,
    confusion: 0.24,
    skepticism: 0.34,
    warmth: 0.32,
    chaos: 0.08,
  },
});

const CROWD_CUES = Object.freeze({
  quiet_down: {
    label: "Word stiller",
    intent: "room_observation",
    durationMs: 12000,
    mood: { attention: 0.2, hype: -0.26, boredom: -0.08, confusion: 0.08 },
    burst: 0.26,
  },
  build_tension: {
    label: "Bouw spanning",
    intent: "doubt",
    durationMs: 16000,
    mood: { attention: 0.28, hype: 0.1, confusion: 0.24, skepticism: 0.2 },
    burst: 0.48,
  },
  callback_last: {
    label: "Haak aan op laatste echte comment",
    intent: "callback",
    durationMs: 18000,
    mood: { attention: 0.24, insideJoke: 0.32, warmth: 0.08 },
    burst: 0.64,
  },
  make_awkward: {
    label: "Maak het ongemakkelijk",
    intent: "awkward",
    durationMs: 15000,
    mood: { attention: 0.16, hype: -0.1, confusion: 0.18, skepticism: 0.24, warmth: -0.2 },
    burst: 0.52,
  },
  follow_audience: {
    label: "Ga mee met publiek",
    intent: "agree",
    durationMs: 18000,
    mood: { attention: 0.18, hype: 0.18, warmth: 0.22, insideJoke: 0.18 },
    burst: 0.6,
  },
});

const HUMAN_ROLES = Object.freeze([
  {
    id: "lurker",
    label: "lurker",
    weight: 26,
    commentMultiplier: 0.38,
    reactionMultiplier: 1.28,
    emojiMultiplier: 0.82,
    gapBias: 1.72,
    callbackMultiplier: 0.72,
    typingCps: [7, 13],
    abandon: 0.22,
    intentBias: { agree: 1, emoji_wave: 1.2, room_observation: 0.7 },
  },
  {
    id: "fast_reactor",
    label: "snelle reacter",
    weight: 18,
    commentMultiplier: 1.08,
    reactionMultiplier: 1.95,
    emojiMultiplier: 1.5,
    gapBias: 0.78,
    callbackMultiplier: 0.9,
    typingCps: [11, 19],
    abandon: 0.08,
    intentBias: { hype: 1.4, emoji_wave: 1.8, agree: 1.18 },
  },
  {
    id: "leader",
    label: "leider",
    weight: 9,
    commentMultiplier: 1.42,
    reactionMultiplier: 0.92,
    emojiMultiplier: 0.78,
    gapBias: 0.72,
    callbackMultiplier: 1.25,
    typingCps: [8, 15],
    abandon: 0.06,
    intentBias: { callback: 1.42, ask: 1.18, doubt: 1.05, room_observation: 1.32 },
  },
  {
    id: "follower",
    label: "meeloper",
    weight: 20,
    commentMultiplier: 0.86,
    reactionMultiplier: 1.28,
    emojiMultiplier: 1.08,
    gapBias: 1.08,
    callbackMultiplier: 1.18,
    typingCps: [8, 17],
    abandon: 0.14,
    intentBias: { agree: 1.55, callback: 1.22, hype: 1.18 },
  },
  {
    id: "skeptic",
    label: "twijfelaar",
    weight: 12,
    commentMultiplier: 0.92,
    reactionMultiplier: 0.72,
    emojiMultiplier: 0.58,
    gapBias: 1.22,
    callbackMultiplier: 1.06,
    typingCps: [6, 12],
    abandon: 0.18,
    intentBias: { doubt: 1.72, ask: 1.32, awkward: 1.2, hype: 0.56 },
  },
  {
    id: "joker",
    label: "grapjas",
    weight: 10,
    commentMultiplier: 1.16,
    reactionMultiplier: 1.12,
    emojiMultiplier: 1.12,
    gapBias: 0.9,
    callbackMultiplier: 1.46,
    typingCps: [9, 18],
    abandon: 0.12,
    intentBias: { misread: 1.55, callback: 1.42, awkward: 1.12, emoji_wave: 1.18 },
  },
  {
    id: "slow_observer",
    label: "stille watcher",
    weight: 5,
    commentMultiplier: 0.48,
    reactionMultiplier: 0.74,
    emojiMultiplier: 0.55,
    gapBias: 2.08,
    callbackMultiplier: 1.28,
    typingCps: [4, 9],
    abandon: 0.28,
    intentBias: { room_observation: 1.7, callback: 1.25, ask: 1.12 },
  },
]);

const DEFAULT_CONFIG = Object.freeze({
  crowdMode: "normal",
  intensity: 0.56,
  realism: 0.82,
  chaos: 0.34,
  warmth: 0.48,
  skepticism: 0.54,
  callbackRate: 0.34,
  emojiLooseRate: 0.7,
  reactionRate: 0.35,
});

function clampNumber(value, min, max, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  if (n < min) return min;
  if (n > max) return max;
  return n;
}

function normalizeCrowdMode(value, fallback = "normal") {
  const key = String(value || "").trim().toLowerCase();
  return CROWD_MODE_PRESETS[key] ? key : fallback;
}

function normalizeBotLabelMode(value, fallback = "hidden") {
  const key = String(value || "").trim().toLowerCase();
  if (key === "shown" || key === "visible" || key === "show") return "shown";
  if (key === "hidden" || key === "hide") return "hidden";
  return fallback;
}

function normalizeCrowdCue(value) {
  const key = String(value || "").trim().toLowerCase();
  return CROWD_CUES[key] ? key : "";
}

function normalizeCrowdConfig(config = {}, base = DEFAULT_CONFIG) {
  const src = config && typeof config === "object" ? config : {};
  const fallback = base && typeof base === "object" ? base : DEFAULT_CONFIG;
  return {
    crowdMode: normalizeCrowdMode(src.crowdMode, fallback.crowdMode || DEFAULT_CONFIG.crowdMode),
    intensity: clampNumber(src.intensity, 0, 1, fallback.intensity ?? DEFAULT_CONFIG.intensity),
    realism: clampNumber(src.realism, 0, 1, fallback.realism ?? DEFAULT_CONFIG.realism),
    chaos: clampNumber(src.chaos, 0, 1, fallback.chaos ?? DEFAULT_CONFIG.chaos),
    warmth: clampNumber(src.warmth, 0, 1, fallback.warmth ?? DEFAULT_CONFIG.warmth),
    skepticism: clampNumber(src.skepticism, 0, 1, fallback.skepticism ?? DEFAULT_CONFIG.skepticism),
    callbackRate: clampNumber(src.callbackRate, 0, 1, fallback.callbackRate ?? DEFAULT_CONFIG.callbackRate),
    emojiLooseRate: clampNumber(src.emojiLooseRate, 0, 1, fallback.emojiLooseRate ?? DEFAULT_CONFIG.emojiLooseRate),
    reactionRate: clampNumber(src.reactionRate, 0, 4, fallback.reactionRate ?? DEFAULT_CONFIG.reactionRate),
  };
}

function pickWeighted(items, rng = Math.random) {
  if (!Array.isArray(items) || !items.length) return null;
  let total = 0;
  for (const item of items) total += Math.max(0, Number(item && item.weight) || 0);
  if (total <= 0) return items[Math.floor(rng() * items.length)] || null;
  let roll = rng() * total;
  for (const item of items) {
    roll -= Math.max(0, Number(item && item.weight) || 0);
    if (roll <= 0) return item;
  }
  return items[items.length - 1] || null;
}

function normalizeText(input) {
  return String(input || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function extractMotifs(text) {
  const tokens = normalizeText(text)
    .split(" ")
    .filter((token) => token.length >= 4 && token.length <= 18);
  const stop = new Set([
    "maar",
    "niet",
    "voor",
    "hier",
    "deze",
    "dit",
    "dat",
    "waar",
    "waarom",
    "echt",
    "gewoon",
    "even",
    "alleen",
    "omdat",
    "heeft",
    "wordt",
    "zijn",
    "naar",
    "alsof",
  ]);
  return Array.from(new Set(tokens.filter((token) => !stop.has(token)))).slice(0, 4);
}

function createSeededRng(seedInput = 1) {
  let seed = 0;
  const raw = String(seedInput || "1");
  for (let i = 0; i < raw.length; i += 1) {
    seed = (seed * 31 + raw.charCodeAt(i)) >>> 0;
  }
  if (!seed) seed = 0x9e3779b9;
  return function rng() {
    seed += 0x6d2b79f5;
    let t = seed;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

class CrowdEngine {
  constructor(options = {}) {
    this.rng = typeof options.rng === "function" ? options.rng : Math.random;
    this.config = normalizeCrowdConfig(options.config || {});
    this.reset();
  }

  random() {
    return this.rng();
  }

  randomRange(min, max) {
    return min + this.random() * (max - min);
  }

  randomInt(min, max) {
    if (max <= min) return min;
    return min + Math.floor(this.random() * (max - min + 1));
  }

  sample(list, fallback = "") {
    if (!Array.isArray(list) || !list.length) return fallback;
    return list[this.randomInt(0, list.length - 1)] || fallback;
  }

  reset() {
    this.mood = {
      attention: 0.42,
      hype: 0.32,
      confusion: 0.24,
      skepticism: 0.34,
      warmth: 0.44,
      boredom: 0.18,
      insideJoke: 0.08,
    };
    this.memory = [];
    this.motifs = [];
    this.pendingIntents = [];
    this.lastTickAt = 0;
    this.lastStimulusAt = 0;
    this.activeCue = "";
    this.activeCueUntil = 0;
    this.waveUntil = 0;
    this.waveIntent = "";
    this.intentCounts = new Map();
  }

  updateConfig(config = {}) {
    this.config = normalizeCrowdConfig(config, this.config || DEFAULT_CONFIG);
  }

  getModePreset() {
    return CROWD_MODE_PRESETS[this.config.crowdMode] || CROWD_MODE_PRESETS.normal;
  }

  nudgeMood(delta = {}) {
    for (const key of Object.keys(this.mood)) {
      const change = Number(delta[key] || 0);
      if (!change) continue;
      this.mood[key] = clampNumber(this.mood[key] + change, 0, 1, this.mood[key]);
    }
  }

  tick(now = Date.now()) {
    const ts = Number(now) || Date.now();
    const previous = this.lastTickAt || ts;
    this.lastTickAt = ts;
    const dtSec = Math.max(0, Math.min(30, (ts - previous) / 1000));
    if (dtSec <= 0) return;

    const mode = this.getModePreset();
    const targets = {
      attention: Math.max(0.2, 0.46 + this.config.intensity * 0.22 - mode.silence * 0.28),
      hype: mode.hype * 0.55 + this.config.intensity * 0.24,
      confusion: mode.confusion * 0.6 + this.config.chaos * 0.24,
      skepticism: mode.skepticism * 0.58 + this.config.skepticism * 0.3,
      warmth: mode.warmth * 0.58 + this.config.warmth * 0.3,
      boredom: Math.max(0.04, mode.silence * 0.64 + (1 - this.config.intensity) * 0.18),
      insideJoke: 0.08 + this.config.chaos * 0.1,
    };
    const drift = Math.min(0.18, dtSec * 0.012);
    for (const key of Object.keys(this.mood)) {
      this.mood[key] += (targets[key] - this.mood[key]) * drift;
      this.mood[key] = clampNumber(this.mood[key], 0, 1, 0.5);
    }

    if (ts > this.activeCueUntil) this.activeCue = "";
    this.pendingIntents = this.pendingIntents.filter((item) => item && Number(item.expiresAt || 0) > ts);
    if (ts > this.waveUntil) this.waveIntent = "";
  }

  rememberComment(payload = {}, isBot = false, now = Date.now()) {
    const text = String(payload.text || "").replace(/\s+/g, " ").trim();
    if (!text) return;
    const entry = {
      name: String(payload.name || "iemand").replace(/\s+/g, " ").trim().slice(0, 32) || "iemand",
      text: text.slice(0, 140),
      normalized: normalizeText(text),
      isBot: !!isBot,
      ts: Number(now) || Date.now(),
      motifs: extractMotifs(text),
    };
    this.memory.push(entry);
    if (this.memory.length > 120) this.memory.splice(0, this.memory.length - 120);

    for (const motif of entry.motifs) {
      const known = this.motifs.find((item) => item && item.key === motif);
      if (known) {
        known.count += 1;
        known.lastSeenAt = entry.ts;
        known.weight = clampNumber(known.weight + (isBot ? 0.08 : 0.18), 0, 3, 1);
      } else {
        this.motifs.push({ key: motif, count: 1, lastSeenAt: entry.ts, weight: isBot ? 0.55 : 1 });
      }
    }
    this.motifs = this.motifs
      .filter((item) => entry.ts - Number(item.lastSeenAt || 0) < 8 * 60 * 1000)
      .sort((a, b) => Number(b.weight || 0) - Number(a.weight || 0))
      .slice(0, 28);
  }

  observeStimulus(type, payload = {}, now = Date.now()) {
    const ts = Number(now) || Date.now();
    this.tick(ts);
    const kind = String(type || "");
    if (kind === "human_comment" || kind === "bot_comment") {
      const isBot = kind === "bot_comment" || payload.isBot === true;
      this.rememberComment(payload, isBot, ts);
      this.lastStimulusAt = ts;
      if (isBot) {
        this.nudgeMood({ attention: 0.015, hype: 0.008, boredom: -0.012 });
        return;
      }
      const text = String(payload.text || "");
      const longish = text.length > 42;
      const hasQuestion = /\?/.test(text);
      const laughs = /\b(haha|lol|lmao|grappig|stuk|huil)\b/i.test(text);
      this.nudgeMood({
        attention: longish ? 0.16 : 0.1,
        hype: laughs ? 0.16 : 0.05,
        confusion: hasQuestion ? 0.16 : 0.04,
        warmth: laughs ? 0.08 : 0.03,
        boredom: -0.12,
        insideJoke: laughs ? 0.12 : 0.04,
      });
      this.queueIntent(hasQuestion ? "ask" : laughs ? "hype" : "callback", 0.56, ts, 26000, {
        reference: this.memory[this.memory.length - 1] || null,
      });
      return;
    }

    if (kind === "reaction") {
      const reaction = String(payload.reaction || "");
      const positive = reaction === "heart" || reaction === "fire" || reaction === "laugh";
      this.nudgeMood({
        attention: 0.03,
        hype: positive ? 0.06 : -0.01,
        warmth: reaction === "heart" ? 0.04 : 0,
        skepticism: reaction === "bored" ? 0.04 : 0,
        boredom: reaction === "bored" ? 0.06 : -0.025,
      });
      if (positive && this.random() < 0.12 + this.config.intensity * 0.18) {
        this.queueIntent("emoji_wave", 0.34, ts, 9000);
      }
      return;
    }

    if (kind === "poll_started") {
      this.lastStimulusAt = ts;
      this.nudgeMood({ attention: 0.2, hype: 0.06, confusion: 0.08, boredom: -0.12 });
      this.queueIntent("poll_pressure", 0.72, ts, 28000, { poll: payload.poll || null });
      return;
    }

    if (kind === "admin_cue") {
      this.applyCue(payload.cue, ts);
    }
  }

  queueIntent(intent, strength = 0.5, now = Date.now(), ttlMs = 16000, extra = {}) {
    const safeIntent = String(intent || "agree");
    this.pendingIntents.push({
      intent: safeIntent,
      strength: clampNumber(strength, 0, 1, 0.5),
      createdAt: Number(now) || Date.now(),
      expiresAt: (Number(now) || Date.now()) + Math.max(500, Number(ttlMs) || 16000),
      ...extra,
    });
    if (this.pendingIntents.length > 18) this.pendingIntents.splice(0, this.pendingIntents.length - 18);
  }

  applyCue(cue, now = Date.now()) {
    const key = normalizeCrowdCue(cue);
    if (!key) return false;
    const preset = CROWD_CUES[key];
    const ts = Number(now) || Date.now();
    this.activeCue = key;
    this.activeCueUntil = ts + Number(preset.durationMs || 12000);
    this.waveIntent = preset.intent;
    this.waveUntil = this.activeCueUntil;
    this.nudgeMood(preset.mood || {});
    this.queueIntent(preset.intent, Number(preset.burst || 0.5), ts, Number(preset.durationMs || 12000), {
      cue: key,
      reference: this.pickRecentHumanMemory(ts),
    });
    return true;
  }

  createBotTraits() {
    const role = pickWeighted(HUMAN_ROLES, this.rng) || HUMAN_ROLES[0];
    const typingMin = Array.isArray(role.typingCps) ? Number(role.typingCps[0] || 7) : 7;
    const typingMax = Array.isArray(role.typingCps) ? Number(role.typingCps[1] || 14) : 14;
    return {
      roleId: role.id,
      roleLabel: role.label,
      role,
      commentMultiplier: Number(role.commentMultiplier || 1),
      reactionMultiplier: Number(role.reactionMultiplier || 1),
      emojiMultiplier: Number(role.emojiMultiplier || 1),
      roleGapBias: Number(role.gapBias || 1),
      callbackMultiplier: Number(role.callbackMultiplier || 1),
      typingCps: this.randomRange(typingMin, Math.max(typingMin, typingMax)),
      abandonChance: Number(role.abandon || 0.1),
      intentBias: role.intentBias || {},
      socialPhase: this.random(),
    };
  }

  pickRecentHumanMemory(now = Date.now()) {
    const ts = Number(now) || Date.now();
    const recent = this.memory.filter((entry) => entry && !entry.isBot && ts - Number(entry.ts || 0) < 4 * 60 * 1000);
    if (!recent.length) return null;
    const start = Math.max(0, recent.length - 18);
    return recent[this.randomInt(start, recent.length - 1)] || recent[recent.length - 1] || null;
  }

  pickMotif() {
    if (!this.motifs.length) return "";
    const weighted = this.motifs.map((item) => ({ ...item, weight: Math.max(0.1, Number(item.weight || 0.1)) }));
    const picked = pickWeighted(weighted, this.rng);
    return picked && picked.key ? String(picked.key) : "";
  }

  pickIntent(profile = {}, now = Date.now()) {
    const ts = Number(now) || Date.now();
    const mode = this.getModePreset();
    const pending = this.pendingIntents
      .filter((item) => item && Number(item.expiresAt || 0) > ts)
      .sort((a, b) => Number(b.strength || 0) - Number(a.strength || 0));
    if (pending.length && this.random() < 0.42 + Number(pending[0].strength || 0) * 0.42) {
      return pending[0];
    }

    const mood = this.mood;
    const choices = [
      { intent: "agree", weight: 5 + mood.warmth * 9 + mode.warmth * 3 },
      { intent: "doubt", weight: 3 + mood.skepticism * 10 + this.config.skepticism * 5 },
      { intent: "ask", weight: 3 + mood.confusion * 9 },
      { intent: "misread", weight: 1 + this.config.chaos * 8 + mood.insideJoke * 4 },
      { intent: "hype", weight: 2 + mood.hype * 12 + mode.hype * 4 },
      { intent: "awkward", weight: 1 + mood.skepticism * 4 + mood.confusion * 4 + (1 - mood.warmth) * 2 },
      { intent: "callback", weight: 2 + this.config.callbackRate * 9 + mood.insideJoke * 7 },
      { intent: "emoji_wave", weight: 1 + this.config.emojiLooseRate * 7 + mood.hype * 5 },
      { intent: "room_observation", weight: 2 + mood.attention * 5 + mode.silence * 4 },
    ];
    const bias = profile && profile.intentBias ? profile.intentBias : {};
    for (const choice of choices) {
      const mult = Number(bias[choice.intent] || 1);
      choice.weight *= Number.isFinite(mult) && mult > 0 ? mult : 1;
    }
    return pickWeighted(choices, this.rng) || choices[0];
  }

  planComment(botId, profile = {}, options = {}) {
    const now = Number(options.now || 0) || Date.now();
    this.tick(now);
    const mode = this.getModePreset();
    if (this.random() < mode.silence * (0.24 + this.config.realism * 0.5)) return null;

    const baseChance = clampNumber(options.baseChance, 0, 1, 0.02);
    const roleMultiplier = clampNumber(profile.commentMultiplier || 1, 0.1, 3.5, 1);
    const attentionBoost = 0.72 + this.mood.attention * 0.52;
    const boredomDrag = 1 - this.mood.boredom * 0.58;
    const waveBoost = this.waveIntent ? 1.5 : 1;
    const intensityBoost = 0.44 + this.config.intensity * 1.18;
    const modeBoost = Number(mode.activity || 1);
    const chance = clampNumber(
      baseChance * roleMultiplier * attentionBoost * boredomDrag * waveBoost * intensityBoost * modeBoost,
      0,
      0.88,
      baseChance
    );
    if (this.random() > chance) return null;

    const selected = this.pickIntent(profile, now);
    const intent = String(selected && selected.intent || "agree");
    const reference = selected && selected.reference ? selected.reference : (
      intent === "callback" || intent === "misread" || this.random() < this.config.callbackRate * 0.28
        ? this.pickRecentHumanMemory(now)
        : null
    );
    const motif = this.pickMotif();
    const chars = clampNumber(options.estimatedChars, 4, 120, intent === "emoji_wave" ? 5 : 32);
    const cps = clampNumber(profile.typingCps, 4, 24, 10);
    const realismDelay = 180 + chars / cps * 1000 * (0.55 + this.config.realism * 0.78);
    const intentDelay = intent === "emoji_wave" || intent === "hype" ? 0.58 : intent === "room_observation" ? 1.24 : 1;
    const typingDelayMs = Math.round(clampNumber(realismDelay * intentDelay + this.randomRange(-180, 420), 120, 5600, 900));
    const abandonChance = clampNumber(
      Number(profile.abandonChance || 0.1) * (0.5 + this.config.realism * 0.9) * (intent === "room_observation" ? 1.25 : 1),
      0,
      0.55,
      0.1
    );
    const abandon = this.random() < abandonChance;
    this.intentCounts.set(intent, (this.intentCounts.get(intent) || 0) + 1);
    return {
      kind: "comment",
      botId,
      intent,
      cue: selected && selected.cue ? selected.cue : this.activeCue,
      reference,
      motif,
      typingDelayMs,
      abandon,
      mood: { ...this.mood },
    };
  }

  planReaction(profile = {}, tickMs = 1000, options = {}) {
    const now = Number(options.now || 0) || Date.now();
    this.tick(now);
    const mode = this.getModePreset();
    const baseRate = clampNumber(options.baseRate, 0, 6, this.config.reactionRate);
    const seconds = clampNumber(tickMs / 1000, 0.05, 3, 1);
    const roleMultiplier = clampNumber(profile.reactionMultiplier || 1, 0.15, 4, 1);
    const chance = clampNumber(
      baseRate * seconds * roleMultiplier * Number(mode.reaction || 1) * (0.36 + this.config.intensity * 0.86),
      0,
      0.98,
      0.1
    );
    if (this.random() > chance) return null;
    const mood = this.mood;
    const choices = [
      { reaction: "heart", weight: 1 + mood.warmth * 8 },
      { reaction: "fire", weight: 1 + mood.hype * 9 },
      { reaction: "laugh", weight: 1 + mood.insideJoke * 6 + this.config.chaos * 3 },
      { reaction: "bored", weight: 0.4 + mood.boredom * 7 + mood.skepticism * 2 },
    ];
    const picked = pickWeighted(choices, this.rng) || choices[0];
    return {
      kind: "reaction",
      reaction: picked.reaction,
      mood: { ...this.mood },
    };
  }

  getSnapshot() {
    const mode = this.getModePreset();
    return {
      mode: this.config.crowdMode,
      modeLabel: mode.label,
      activeCue: this.activeCue,
      waveIntent: this.waveIntent,
      mood: { ...this.mood },
      memoryCount: this.memory.length,
      motifCount: this.motifs.length,
      topMotifs: this.motifs.slice(0, 5).map((item) => item.key),
      pendingIntents: this.pendingIntents.length,
      intentCounts: Object.fromEntries(this.intentCounts.entries()),
      aiDirector: {
        mode: "off",
        readyForLocalModel: true,
      },
    };
  }
}

module.exports = {
  CROWD_MODE_PRESETS,
  CROWD_CUES,
  HUMAN_ROLES,
  CrowdEngine,
  createSeededRng,
  normalizeBotLabelMode,
  normalizeCrowdConfig,
  normalizeCrowdCue,
  normalizeCrowdMode,
};
