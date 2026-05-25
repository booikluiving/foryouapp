#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { URL } = require("node:url");
const WebSocket = require("ws");
const {
  CrowdEngine,
  normalizeBotLabelMode,
  normalizeCrowdMode,
} = require("../../crowd-system");

const DEFAULTS = {
  url: "ws://127.0.0.1:3010",
  clients: 50,
  durationSec: 180,
  spawnMs: 80,
  statsMs: 5000,
  msgRate: 0.03,
  reactionRate: 0.35,
  minGapMs: 2300,
  crowdMode: "normal",
  intensity: 0.56,
  realism: 0.82,
  chaos: 0.34,
  warmth: 0.48,
  skepticism: 0.54,
  callbackRate: 0.34,
  emojiInlineRate: 0.18,
  emojiLooseRate: 0.7,
  botLabelMode: "hidden",
  pollVoteChance: 0.9,
  voteDelayMinMs: 400,
  voteDelayMaxMs: 3200,
  autoVote: true,
  namePrefix: "SimUser",
};

const SAMPLE_SHORT_REACTIONS = [
  "wow",
  "haha",
  "hahaha",
  "lol",
  "lmao",
  "ik ga stuk",
  "ik ben klaar",
  "ik lig dubbel",
  "ik ben weg",
  "ik kan niet meer",
  "hoe dan",
  "wat is dit",
  "wat gebeurt hier",
  "wat een timing",
  "wat een bocht",
  "wat een entree",
  "ik had dit niet verwacht",
  "dit escaleerde snel",
  "dit liep uit de hand",
  "dit was hard",
  "dit was raak",
  "dit was gemeen goed",
  "dit was pijnlijk grappig",
  "dit was illegaal grappig",
  "dit was premium chaos",
  "dit is te goed",
  "dit is zo dom goed",
  "dit is exact mijn humor",
  "dit is content",
  "dit is goud",
  "dit is cinema",
  "dit is theater",
  "ik huil",
  "ik huil van het lachen",
  "ik ben om",
  "ik ben verkocht",
  "ik mopper maar ik geniet",
  "ik wil klagen maar ik lach",
  "ik voel me gezien",
  "ik stuur dit door",
  "dit ga ik sturen",
  "dit ga ik aan vrienden laten zien",
  "ik wil een replay",
  "meer hiervan",
  "ga door",
  "niet normaal",
  "te goed",
  "te scherp",
  "nee joh",
  "hou op hoor",
  "stop ik kan niet meer",
  "ik ga kapot",
  "die kwam hard binnen",
  "die zat goed",
  "deze was raak",
  "deze was gemeen",
  "ik had dit nodig",
  "dit redt mijn dag",
  "dit pakt me onverwacht",
  "dit landt veel te goed",
  "ik ben officieel fan",
  "ik was niet voorbereid",
  "deze energie is verdacht goed",
  "dit was zo droog",
  "ik wil meer chaos",
  "dit ging van 0 naar 100",
  "ik kijk dit terug",
  "ik ben te makkelijk hier",
];
const SAMPLE_PREFIXES = [
  "eerlijk",
  "ik zweer",
  "nee maar",
  "ok maar",
  "bro",
  "chef",
  "help",
  "luister",
  "serieus",
  "kleine update",
  "mini recap",
  "fact check",
  "zonder grap",
  "tussen ons",
];
const SAMPLE_AFTERTHOUGHTS = [
  "ik herstel hier niet van.",
  "mijn dag is gemaakt.",
  "ik had dit nodig.",
  "dit ging direct mijn favorieten in.",
  "ik was hier niet klaar voor.",
  "de timing was belachelijk goed.",
  "ik ga dit later weer kijken.",
  "dit was een replay-moment.",
  "mijn cynisme verloor hier.",
  "ik ben overtuigd zonder argumenten.",
  "dit is waarom ik niet weg klik.",
  "ik ga hier straks nog om lachen.",
  "dit was onnodig en perfect.",
  "ik weet niet wie dit schreef maar bedankt.",
];
const SAMPLE_TEMPLATES = [
  "{hit}",
  "{prefix}, {hit}",
  "{hit}. {after}",
  "{prefix}, {hit}. {after}",
  "{hit} {hit2}",
  "{prefix}, {hit} {hit2}",
];
const SAMPLE_EMOJIS = [
  "🥰",
  "🥵",
  "🤮",
  "🫦",
  "🍆",
  "💀",
  "😭",
  "🙏",
  "🔥",
  "✨",
  "🤡",
  "🫶",
  "🤭",
  "😩",
  "😮‍💨",
  "😳",
  "🤔",
  "🙄",
  "😬",
  "🫠",
  "😤",
  "😏",
  "👀",
  "🤨",
  "💅",
  "🧍",
  "🫥",
  "🚩",
  "🤌",
  "🗣️",
  "🫡",
  "☕️",
];
const SAMPLE_EMOJI_COMBOS = [
  "👁️👄👁️",
  "👉👈",
  "💀⚰️",
  "✍️🔥",
  "📸🤨",
  "🍿👀",
  "🗿🍷",
];
const FIRST_NAMES = [
  "Noah",
  "Emma",
  "Liam",
  "Olivia",
  "Mila",
  "Levi",
  "Julia",
  "Finn",
  "Nora",
  "Daan",
  "Saar",
  "Mason",
  "Tess",
  "Sem",
  "Yara",
  "Vince",
  "Lotte",
  "Mats",
  "Zoey",
  "Jesse",
  "Luna",
  "Boaz",
  "Ava",
  "Ravi",
  "Iris",
  "Milan",
  "Nova",
  "Kai",
  "Lina",
  "Adam",
  "Maya",
  "Owen",
  "Elin",
  "Nina",
  "Hugo",
  "Rosa",
  "Milo",
  "Jade",
  "Tygo",
  "Evi",
  "Alex",
  "Sam",
  "Charlie",
  "Mika",
];
const BRAINROT_REACTIONS = [
  "{term}",
  "mood: {term}",
  "vibe: {term}",
  "{term} vibes",
  "{term} energy",
  "{term} core",
  "dit voelde heel {term}",
  "dit was gewoon {term}",
  "dit kreeg meteen {term} status",
  "100 procent {term}",
  "meer {term} graag",
  "{term}, geen discussie",
  "{term} maar dan met extra chaos",
  "deze chat is vandaag {term}",
  "ik noem dit gewoon {term}",
  "plot twist: {term}",
  "samengevat: {term}",
  "alles aan dit moment was {term}",
  "dit segment schreeuwde {term}",
  "{term} in hoofdletters",
];
const BRAINROT_RAW_DROPS = [
  "{term}",
  "{term}.",
  "{term}!",
  "{term}?",
  "{term} {term}",
];
const BRAINROT_PATH = path.join(process.cwd(), "brainrot.txt");
const INLINE_EMOJI_RATE = 0.18;
const LOOSE_EMOJI_RATE = 0.7;
let brainrotTerms = [];
let brainrotTermSet = new Set();
const generatedMessageCounts = new Map();
const generatedPrefixCounts = new Map();

function clampInt(value, min, max, fallback) {
  const n = Number.parseInt(String(value), 10);
  if (!Number.isFinite(n)) return fallback;
  if (n < min) return min;
  if (n > max) return max;
  return n;
}

function clampFloat(value, min, max, fallback) {
  const n = Number.parseFloat(String(value));
  if (!Number.isFinite(n)) return fallback;
  if (n < min) return min;
  if (n > max) return max;
  return n;
}

function parseBoolean(value, fallback) {
  if (value === undefined || value === null || value === "") return fallback;
  const normalized = String(value).trim().toLowerCase();
  if (["1", "true", "yes", "y", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "n", "off"].includes(normalized)) return false;
  return fallback;
}

function parseBrainrotLines(raw) {
  const terms = [];
  const lines = String(raw || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#") && !line.startsWith("//"));

  for (const line of lines) {
    const parts = line.split(/[;,|]/g);
    for (const part of parts) {
      const clean = String(part || "")
        .trim()
        .replace(/\s+/g, " ")
        .slice(0, 48);
      if (clean) terms.push(clean);
    }
  }
  return Array.from(new Set(terms));
}

function loadBrainrotWords() {
  try {
    const raw = fs.readFileSync(BRAINROT_PATH, "utf8");
    brainrotTerms = parseBrainrotLines(raw);
    brainrotTermSet = new Set(brainrotTerms.map((term) => normalizeMessageKey(term)).filter(Boolean));
  } catch {
    brainrotTerms = [];
    brainrotTermSet = new Set();
  }
}

function parseArgs(argv) {
  const options = { ...DEFAULTS };
  for (let i = 0; i < argv.length; i += 1) {
    let arg = argv[i];
    if (!arg.startsWith("--")) continue;
    if (arg === "--help" || arg === "-h") {
      options.help = true;
      continue;
    }

    let key = arg.slice(2);
    let value = null;
    if (key.includes("=")) {
      const parts = key.split("=");
      key = parts[0];
      value = parts.slice(1).join("=");
    } else if (argv[i + 1] && !argv[i + 1].startsWith("--")) {
      value = argv[i + 1];
      i += 1;
    }

    if (key === "no-auto-vote") {
      options.autoVote = false;
      continue;
    }
    if (key === "auto-vote") {
      options.autoVote = parseBoolean(value, true);
      continue;
    }

    switch (key) {
      case "url":
        if (value) options.url = String(value);
        break;
      case "clients":
        options.clients = clampInt(value, 1, 200, options.clients);
        break;
      case "duration":
      case "duration-sec":
        options.durationSec = clampInt(value, 0, 24 * 60 * 60, options.durationSec);
        break;
      case "spawn-ms":
        options.spawnMs = clampInt(value, 0, 5000, options.spawnMs);
        break;
      case "stats-ms":
        options.statsMs = clampInt(value, 500, 60000, options.statsMs);
        break;
      case "msg-rate":
        options.msgRate = clampFloat(value, 0, 0.1, options.msgRate);
        break;
      case "reaction-rate":
        options.reactionRate = clampFloat(value, 0, 4, options.reactionRate);
        break;
      case "crowd-mode":
        options.crowdMode = normalizeCrowdMode(value, options.crowdMode);
        break;
      case "intensity":
        options.intensity = clampFloat(value, 0, 1, options.intensity);
        options.msgRate = clampFloat(0.006 + options.intensity * 0.055, 0, 0.1, options.msgRate);
        break;
      case "realism":
        options.realism = clampFloat(value, 0, 1, options.realism);
        break;
      case "chaos":
        options.chaos = clampFloat(value, 0, 1, options.chaos);
        break;
      case "warmth":
        options.warmth = clampFloat(value, 0, 1, options.warmth);
        break;
      case "skepticism":
        options.skepticism = clampFloat(value, 0, 1, options.skepticism);
        break;
      case "callback-rate":
        options.callbackRate = clampFloat(value, 0, 1, options.callbackRate);
        break;
      case "emoji-inline-rate":
        options.emojiInlineRate = clampFloat(value, 0, 1, options.emojiInlineRate);
        break;
      case "emoji-loose-rate":
        options.emojiLooseRate = clampFloat(value, 0, 1, options.emojiLooseRate);
        break;
      case "bot-label-mode":
        options.botLabelMode = normalizeBotLabelMode(value, options.botLabelMode);
        break;
      case "min-gap-ms":
        options.minGapMs = clampInt(value, 200, 20000, options.minGapMs);
        break;
      case "poll-vote-chance":
        options.pollVoteChance = clampFloat(value, 0, 1, options.pollVoteChance);
        break;
      case "vote-delay-min-ms":
        options.voteDelayMinMs = clampInt(value, 0, 60000, options.voteDelayMinMs);
        break;
      case "vote-delay-max-ms":
        options.voteDelayMaxMs = clampInt(value, 0, 60000, options.voteDelayMaxMs);
        break;
      case "name-prefix":
        if (value) options.namePrefix = String(value).slice(0, 24);
        break;
      default:
        break;
    }
  }
  if (options.voteDelayMaxMs < options.voteDelayMinMs) {
    const temp = options.voteDelayMinMs;
    options.voteDelayMinMs = options.voteDelayMaxMs;
    options.voteDelayMaxMs = temp;
  }
  return options;
}

function showHelp() {
  console.log(`Usage: node scripts/simulate-chatters.js [options]

Options:
  --url <ws-url>              Default: ws://127.0.0.1:3010
  --clients <n>               Number of simulated users, max 200 (default: 50)
  --duration <sec>            Test duration in seconds, 0 = infinite (default: 180)
  --spawn-ms <ms>             Delay between client starts (default: 80)
  --stats-ms <ms>             Stats print interval (default: 5000)
  --msg-rate <float>          Messages/sec per connected client, 0..0.1 (default: 0.03)
  --reaction-rate <float>     Reactions/sec driver, 0..4 (default: 0.35)
  --crowd-mode <mode>         normal, soft, nervous, chaotic, critical, hyped, quiet
  --intensity <0-1>           Director intensity; also derives msg-rate
  --realism <0-1>             More typing delay, silence and abandoned messages
  --chaos <0-1>               More misreads, emoji waves and abrupt turns
  --warmth <0-1>              More agreement and supportive comments
  --skepticism <0-1>          More doubt, questions and awkwardness
  --callback-rate <0-1>       How often the crowd reuses recent comments
  --emoji-inline-rate <0-1>   Emoji inside comments
  --emoji-loose-rate <0-1>    Emoji-only waves
  --bot-label-mode <mode>     hidden or shown (default: hidden)
  --min-gap-ms <ms>           Min gap between messages per client (default: 2300)
  --poll-vote-chance <0-1>    Chance a client votes per poll (default: 0.9)
  --auto-vote <true|false>    Auto vote on polls (default: true)
  --no-auto-vote              Shortcut for --auto-vote false
  --vote-delay-min-ms <ms>    Min vote delay after poll start (default: 400)
  --vote-delay-max-ms <ms>    Max vote delay after poll start (default: 3200)
  --name-prefix <text>        Legacy option (names are random first names)
  --help                      Show this help
`);
}

function toWsUrl(baseUrl, clientId) {
  const parsed = new URL(baseUrl);
  if (parsed.protocol === "http:") parsed.protocol = "ws:";
  if (parsed.protocol === "https:") parsed.protocol = "wss:";
  parsed.searchParams.set(
    "sid",
    `${Date.now()}-${clientId}-${Math.random().toString(36).slice(2, 9)}`
  );
  return parsed.toString();
}

function randomInt(min, max) {
  if (max <= min) return min;
  return min + Math.floor(Math.random() * (max - min + 1));
}

function sample(list, fallback = "") {
  if (!Array.isArray(list) || list.length < 1) return fallback;
  return list[randomInt(0, list.length - 1)] || fallback;
}

function tokenize(input) {
  const normalized = String(input || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!normalized) return [];
  return normalized.split(" ").filter(Boolean);
}

function normalizeMessageKey(input) {
  return tokenize(input).join(" ");
}

function tokenOverlap(a, b) {
  const aTokens = tokenize(a);
  const bTokens = tokenize(b);
  if (!aTokens.length || !bTokens.length) return 0;
  const aSet = new Set(aTokens);
  const bSet = new Set(bTokens);
  let overlap = 0;
  for (const token of aSet) {
    if (bSet.has(token)) overlap += 1;
  }
  return overlap / Math.max(1, Math.max(aSet.size, bSet.size));
}

function prefixKeyFromNormalized(normalized) {
  const tokens = tokenize(normalized);
  if (!tokens.length) return "";
  return tokens.slice(0, 3).join(" ");
}

function fillTemplate(template, values) {
  return String(template || "").replace(/\{([a-zA-Z0-9_]+)\}/g, (_, key) => String(values[key] || ""));
}

function randomFirstName() {
  return FIRST_NAMES[randomInt(0, FIRST_NAMES.length - 1)] || "Alex";
}

function formatBotName(firstName, botLabelMode = "hidden") {
  const clean = String(firstName || "Alex")
    .replace(/[^a-zA-Z'-]/g, "")
    .slice(0, 18) || "Alex";
  if (normalizeBotLabelMode(botLabelMode, "hidden") === "hidden") return clean.slice(0, 24);
  return `${clean} (bot)`.slice(0, 24);
}

function addEmojiFlavor(text, inlineRate = INLINE_EMOJI_RATE) {
  const base = String(text || "").trim();
  if (!base) return "";
  const chance = clampFloat(inlineRate, 0, 1, INLINE_EMOJI_RATE);
  if (Math.random() > chance) return base;

  const style = Math.random();
  const emoji = sample(SAMPLE_EMOJIS, "💀");

  if (style < 0.16) return `${emoji} ${base}`.trim();
  if (style < 0.9) return `${base} ${emoji}`.trim();
  if (style < 0.98) return injectEmojiInside(base, emoji);
  return base;
}

function randomEmojiBurst(minCount = 1, maxCount = 4) {
  const min = clampInt(minCount, 1, 8, 1);
  const max = clampInt(maxCount, min, 8, Math.max(min, 4));
  const count = randomInt(min, max);
  const compact = Math.random() < 0.5;
  const out = [];
  if (Math.random() < 0.58) {
    const repeated = sample(SAMPLE_EMOJIS, "💀");
    for (let i = 0; i < count; i += 1) out.push(repeated);
    return (compact ? out.join("") : out.join(" ")).trim();
  }
  let comboUsed = false;
  for (let i = 0; i < count; i += 1) {
    const useCombo = !comboUsed && Math.random() < 0.24;
    if (useCombo) {
      out.push(sample(SAMPLE_EMOJI_COMBOS, "👁️👄👁️"));
      comboUsed = true;
    } else {
      out.push(sample(SAMPLE_EMOJIS, "💀"));
    }
  }
  return (compact ? out.join("") : out.join(" ")).trim();
}

function injectEmojiInside(text, emojiChunk) {
  const base = String(text || "").trim();
  const chunk = String(emojiChunk || "").trim();
  if (!base) return chunk;
  if (!chunk) return base;
  const tokens = base.split(/\s+/).filter(Boolean);
  if (tokens.length < 2) return `${chunk} ${base}`.trim();
  const index = randomInt(1, tokens.length - 1);
  tokens.splice(index, 0, chunk);
  return tokens.join(" ").trim();
}

function buildEmojiOnlyCandidate() {
  const mode = Math.random();
  if (mode < 0.24) {
    return sample(SAMPLE_EMOJI_COMBOS, "🗿🍷");
  }
  if (mode < 0.94) {
    const emoji = sample(SAMPLE_EMOJIS, "💀");
    const count = randomInt(2, 5);
    return Array.from({ length: count }, () => emoji).join("").trim();
  }
  return randomEmojiBurst(2, 4);
}

function randomBrainrotMessage() {
  if (!brainrotTerms.length) return "";
  const term = sample(brainrotTerms, "");
  if (!term) return "";
  if (Math.random() < 0.32) {
    return sample(BRAINROT_RAW_DROPS, "{term}").replace(/\{term\}/gi, term).trim();
  }
  const template = sample(BRAINROT_REACTIONS, "{term}");
  let line = template.replace(/\{term\}/gi, term).trim();
  if (Math.random() < 0.22) line += " " + sample(SAMPLE_SHORT_REACTIONS, "");
  return line.trim();
}

function buildTemplateMessage() {
  let hit = sample(SAMPLE_SHORT_REACTIONS, "wow");
  if (brainrotTerms.length && Math.random() < 0.24) {
    const brainrot = randomBrainrotMessage();
    if (brainrot) hit = brainrot;
  }
  const line = fillTemplate(sample(SAMPLE_TEMPLATES, "{hit}"), {
    prefix: sample(SAMPLE_PREFIXES, ""),
    hit,
    hit2: Math.random() < 0.34 ? sample(SAMPLE_SHORT_REACTIONS, "") : "",
    after: sample(SAMPLE_AFTERTHOUGHTS, ""),
  })
    .replace(/\s+([,.!?;:])/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
  if (!line) return "";
  if (Math.random() < 0.16) {
    return `${line} ${sample(SAMPLE_AFTERTHOUGHTS, "")}`.trim();
  }
  return line;
}

function isEmojiOnlyText(input) {
  const text = String(input || "").trim();
  if (!text) return false;
  const tokens = text.split(/\s+/).filter(Boolean);
  if (!tokens.length) return false;
  return tokens.every((token) => /^[\p{Extended_Pictographic}\uFE0F\u200D]+$/u.test(token));
}

function scoreMessageCandidate(text, client) {
  const normalized = normalizeMessageKey(text);
  if (!normalized) return -999;
  const tokens = tokenize(normalized);
  let score = Math.random() * 0.35;
  const len = text.length;
  score += 2.2 - Math.abs(len - 24) / 16;
  if (len > 90) score -= 1.1;

  const phraseUses = generatedMessageCounts.get(normalized) || 0;
  if (phraseUses > 0) score -= Math.min(5.5, phraseUses * 1.6);

  const prefix = prefixKeyFromNormalized(normalized);
  const prefixUses = prefix ? generatedPrefixCounts.get(prefix) || 0 : 0;
  if (prefixUses > 0) score -= Math.min(2.2, prefixUses * 0.3);

  if (client && client.lastMessageKey) {
    score -= tokenOverlap(normalized, client.lastMessageKey) * 3.1;
    const prevTokens = tokenize(client.lastMessageKey);
    if (tokens[0] && prevTokens[0] && tokens[0] === prevTokens[0]) score -= 0.24;
  }

  if (tokens.length) {
    const uniqueRatio = new Set(tokens).size / tokens.length;
    score += uniqueRatio * 0.42;
    if (uniqueRatio < 0.56) score -= 0.48;
  }
  if (/[!?]/.test(text)) score += 0.09;
  if (isEmojiOnlyText(text)) score += 0.9 + LOOSE_EMOJI_RATE * 4.2;
  if (brainrotTermSet.has(normalized)) {
    score += 0.7;
  } else if (brainrotTermSet.size) {
    for (const term of brainrotTermSet) {
      if (term.length >= 3 && normalized.includes(term)) {
        score += 0.18;
        break;
      }
    }
  }

  return score;
}

function rememberGeneratedMessage(client, text) {
  const normalized = normalizeMessageKey(text);
  if (!normalized) return;
  generatedMessageCounts.set(normalized, (generatedMessageCounts.get(normalized) || 0) + 1);
  const prefix = prefixKeyFromNormalized(normalized);
  if (prefix) {
    generatedPrefixCounts.set(prefix, (generatedPrefixCounts.get(prefix) || 0) + 1);
  }
  if (generatedMessageCounts.size > 260) {
    for (const [key, value] of generatedMessageCounts.entries()) {
      if (value <= 1) generatedMessageCounts.delete(key);
      else generatedMessageCounts.set(key, value - 1);
      if (generatedMessageCounts.size <= 200) break;
    }
  }
  if (generatedPrefixCounts.size > 180) {
    for (const [key, value] of generatedPrefixCounts.entries()) {
      if (value <= 1) generatedPrefixCounts.delete(key);
      else generatedPrefixCounts.set(key, value - 1);
      if (generatedPrefixCounts.size <= 140) break;
    }
  }
  if (client) client.lastMessageKey = normalized;
}

function buildIntentMessage(client, action) {
  const intent = String(action && action.intent || "");
  const reference = action && action.reference ? action.reference : null;
  const snippet = reference && reference.text
    ? String(reference.text).replace(/["'`]/g, "").replace(/\s+/g, " ").trim().slice(0, 24)
    : "";
  const motif = String(action && action.motif || "").trim();
  if (intent === "emoji_wave") return buildEmojiOnlyCandidate();
  if (intent === "callback" && snippet) return sample([
    `ja "${snippet}" dus`,
    `"${snippet}" blijft hangen`,
    `de chat zei net "${snippet}" en nu snap ik niks meer`,
  ], `ja "${snippet}" dus`);
  if (intent === "agree") return sample(["ja dit voel ik ook", "precies dit", "same eigenlijk", "ik ga hierin mee"], "precies dit");
  if (intent === "doubt") return sample(["ik vertrouw deze wending niet", "wacht dit voelt verdacht", "ik weet niet of ik mee ben"], "ik vertrouw dit niet");
  if (intent === "ask") return motif ? `wacht waarom ${motif}` : sample(["wacht wat gebeurt hier", "mis ik context", "kan iemand dit uitleggen"], "wacht wat");
  if (intent === "misread") return snippet ? `ik las "${snippet}" veel te dramatisch` : "ik dacht even dat dit expres misging";
  if (intent === "hype") return sample(["nee dit werkt echt", "ok nu ben ik wakker", "dit gaat ineens hard"], "dit werkt echt");
  if (intent === "awkward") return sample(["dit werd ineens ongemakkelijk", "ik voel collectief ongemak", "de chat knippert even"], "dit werd ongemakkelijk");
  if (intent === "poll_pressure") return sample(["ik neem deze poll veel te serieus", "stemmen voelt nu als karaktertest"], "ik neem deze poll te serieus");
  if (intent === "room_observation") return sample(["de chat ademt nu even tegelijk", "iedereen is ineens voorzichtig", "we wachten collectief op iets"], "de chat ademt even");
  return "";
}

function randomMessage(client, action = null) {
  const looseEmojiRate = clampFloat(client && client.options && client.options.emojiLooseRate, 0, 1, LOOSE_EMOJI_RATE);
  const inlineEmojiRate = clampFloat(client && client.options && client.options.emojiInlineRate, 0, 1, INLINE_EMOJI_RATE);
  const forcedEmojiChance = clampFloat(0.01 + Math.pow(looseEmojiRate, 1.8) * 0.45, 0, 0.9, 0.12);
  const directedIntent = String(action && action.intent || "");
  if ((!directedIntent || directedIntent === "emoji_wave") && Math.random() < forcedEmojiChance) {
    const forcedEmoji = String(buildEmojiOnlyCandidate() || "").replace(/\s+/g, " ").trim().slice(0, 140);
    if (forcedEmoji) {
      rememberGeneratedMessage(client, forcedEmoji);
      return forcedEmoji;
    }
  }
  const candidates = new Set();
  const loops = 7 + randomInt(0, 3);
  const directedCandidates = new Set();
  if (directedIntent) {
    const intentLine = buildIntentMessage(client, action);
    if (intentLine) {
      candidates.add(intentLine);
      directedCandidates.add(intentLine);
    }
  }
  for (let i = 0; i < loops; i += 1) {
    const candidate = buildTemplateMessage();
    if (candidate) candidates.add(candidate);
  }
  if (brainrotTerms.length) {
    const brainrot = randomBrainrotMessage();
    if (brainrot) candidates.add(brainrot);
    const rawTerm = sample(brainrotTerms, "");
    if (rawTerm) candidates.add(rawTerm);
  }
  if (Math.random() < 0.2 + looseEmojiRate * 0.85) candidates.add(buildEmojiOnlyCandidate());
  if (Math.random() < looseEmojiRate * 0.7) candidates.add(buildEmojiOnlyCandidate());
  if (Math.random() < looseEmojiRate * 0.52) candidates.add(sample(SAMPLE_EMOJI_COMBOS, "🗿🍷"));
  candidates.add(sample(SAMPLE_SHORT_REACTIONS, "wow"));

  let best = "";
  let bestScore = -Infinity;
  for (const raw of candidates) {
    const safe = String(raw || "").replace(/\s+/g, " ").trim().slice(0, 140);
    if (!safe) continue;
    let score = scoreMessageCandidate(safe, client);
    if (directedCandidates.has(raw)) score += 2.4;
    if (score > bestScore) {
      bestScore = score;
      best = safe;
    }
  }
  if (!best) best = sample(SAMPLE_SHORT_REACTIONS, "wow");

  let finalText = best;
  if (!isEmojiOnlyText(best)) {
    const emojiStyled = addEmojiFlavor(best, inlineEmojiRate).slice(0, 140);
    finalText = emojiStyled || best;
  }
  rememberGeneratedMessage(client, finalText);
  return finalText;
}

class SimClient {
  constructor(id, options, stats) {
    this.id = id;
    this.options = options;
    this.stats = stats;
    this.crowdEngine = options.crowdEngine;
    this.profile = this.crowdEngine ? this.crowdEngine.createBotTraits() : {};
    this.firstName = randomFirstName();
    this.name = formatBotName(this.firstName, options.botLabelMode);
    this.clientTag = `sim${String(id).padStart(3, "0")}${Math.random().toString(36).slice(2, 6)}`;
    this.ws = null;
    this.connected = false;
    this.stopped = false;
    this.reconnectTimer = null;
    this.sendTimer = null;
    this.typingTimer = null;
    this.voteTimer = null;
    this.lastSentAt = 0;
    this.lastReactionAt = 0;
    this.nextMessageGapMs = 0;
    this.messageSeq = 0;
    this.lastMessageKey = "";
    this.activePoll = null;
    this.votedPollIds = new Set();
  }

  connect() {
    if (this.stopped) return;
    const wsUrl = toWsUrl(this.options.url, this.id);
    const ws = new WebSocket(wsUrl);
    this.ws = ws;

    ws.on("open", () => {
      if (this.ws !== ws || this.stopped) return;
      this.connected = true;
      this.stats.opened += 1;
      this.stats.connectedNow += 1;
      this.stats.maxConnected = Math.max(this.stats.maxConnected, this.stats.connectedNow);
      this.sendJson({ type: "register", clientTag: this.clientTag, name: this.name });
      this.startSendLoop();
    });

    ws.on("message", (raw) => {
      if (this.ws !== ws || this.stopped) return;
      this.handleMessage(raw);
    });

    ws.on("error", () => {
      this.stats.errors += 1;
    });

    ws.on("close", () => {
      if (this.ws !== ws) return;
      if (this.connected) {
        this.stats.connectedNow -= 1;
      }
      this.connected = false;
      this.stats.closed += 1;
      this.stopLoops();
      this.ws = null;
      if (!this.stopped) {
        this.stats.reconnects += 1;
        const delayMs = randomInt(400, 1300);
        this.reconnectTimer = setTimeout(() => this.connect(), delayMs);
      }
    });
  }

  stop() {
    this.stopped = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    this.stopLoops();
    if (this.ws) {
      try {
        this.ws.close(1000, "done");
      } catch {}
      this.ws = null;
    }
  }

  stopLoops() {
    if (this.sendTimer) clearTimeout(this.sendTimer);
    if (this.typingTimer) clearTimeout(this.typingTimer);
    if (this.voteTimer) clearTimeout(this.voteTimer);
    this.sendTimer = null;
    this.typingTimer = null;
    this.voteTimer = null;
  }

  computeNextMessageGapMs() {
    const base = clampInt(this.options.minGapMs, 200, 20000, 2300);
    const gapBias = clampFloat(this.profile && this.profile.roleGapBias, 0.35, 2.8, 1);
    const scaled = Math.round(base * gapBias * (0.58 + Math.random() * 0.95));
    const jitter = randomInt(-180, 420);
    return clampInt(scaled + jitter, 320, 24000, base);
  }

  messageChanceForTick(tickMs = 1000) {
    const ratePerSecond = clampFloat(this.options.msgRate, 0, 0.1, 0.03);
    const seconds = clampFloat(tickMs / 1000, 0.05, 3, 1);
    const chance = 1 - Math.pow(1 - ratePerSecond, seconds);
    return clampFloat(chance, 0, 0.95, ratePerSecond);
  }

  scheduleNextSendTick(minDelayMs = 220, maxDelayMs = 1250) {
    if (this.stopped) return;
    const minDelay = clampInt(minDelayMs, 60, 5000, 220);
    const maxDelay = clampInt(maxDelayMs, minDelay, 5000, Math.max(minDelay, 1250));
    const delay = randomInt(minDelay, maxDelay);
    this.sendTimer = setTimeout(() => {
      this.sendTimer = null;
      this.processSendTick(delay);
    }, delay);
  }

  processSendTick(tickMs = 1000) {
    if (this.stopped) return;
    if (!this.connected || !this.ws || this.ws.readyState !== WebSocket.OPEN) {
      this.scheduleNextSendTick(280, 860);
      return;
    }

    this.maybeSendReaction(tickMs);
    if (this.typingTimer) {
      this.scheduleNextSendTick(180, 520);
      return;
    }

    const now = Date.now();
    const gap = Math.max(180, this.nextMessageGapMs || this.computeNextMessageGapMs());
    const sinceLast = now - this.lastSentAt;
    const canSend = sinceLast >= gap;

    if (canSend) {
      const action = this.crowdEngine
        ? this.crowdEngine.planComment(this.id, this.profile, {
            baseChance: this.messageChanceForTick(tickMs),
            estimatedChars: this.lastMessageKey ? this.lastMessageKey.length : 28,
          })
        : null;
      if (action) this.queuePlannedComment(action);
    }

    const remaining = Math.max(0, (this.nextMessageGapMs || gap) - (Date.now() - this.lastSentAt));
    if (remaining > 0 && remaining < 420) {
      this.scheduleNextSendTick(Math.max(90, remaining), Math.max(180, remaining + 240));
      return;
    }
    this.scheduleNextSendTick(220, 1250);
  }

  queuePlannedComment(action) {
    this.lastSentAt = Date.now();
    this.nextMessageGapMs = this.computeNextMessageGapMs();
    if (action && action.abandon) {
      this.stats.abandonedMessages += 1;
      return;
    }
    const delay = clampInt(action && action.typingDelayMs, 0, 6000, 0);
    if (delay <= 160) {
      this.sendPlannedComment(action);
      return;
    }
    this.typingTimer = setTimeout(() => {
      this.typingTimer = null;
      this.sendPlannedComment(action);
    }, delay);
  }

  sendPlannedComment(action) {
    if (this.stopped) return;
    if (!this.connected || !this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    this.messageSeq += 1;
    const text = randomMessage(this, action);
    if (this.sendJson({ type: "comment", name: this.name, text, clientTag: this.clientTag })) {
      this.lastSentAt = Date.now();
      this.nextMessageGapMs = this.computeNextMessageGapMs();
      this.stats.sentComments += 1;
      if (this.crowdEngine) this.crowdEngine.observeStimulus("bot_comment", { name: this.name, text, isBot: true });
    }
  }

  maybeSendReaction(tickMs = 1000) {
    if (!this.crowdEngine) return;
    const now = Date.now();
    if (now - this.lastReactionAt < 140) return;
    const reactionDrive = clampFloat(this.profile && this.profile.reactionMultiplier, 0.2, 4, 1);
    const baseRate = clampFloat(this.options.reactionRate * reactionDrive, 0, 6, this.options.reactionRate);
    const plan = this.crowdEngine.planReaction({ ...this.profile, reactionMultiplier: 1 }, tickMs, { baseRate });
    if (!plan || !plan.reaction) return;
    if (!this.sendJson({ type: "reaction", reaction: plan.reaction, clientTag: this.clientTag })) return;
    this.lastReactionAt = now;
    this.stats.sentReactions += 1;
    this.crowdEngine.observeStimulus("reaction", { reaction: plan.reaction, isBot: true });
  }

  startSendLoop() {
    if (this.sendTimer) return;
    this.nextMessageGapMs = this.computeNextMessageGapMs();
    if (!this.lastSentAt) {
      this.lastSentAt = Date.now() - randomInt(0, this.nextMessageGapMs);
    }
    this.scheduleNextSendTick(120, 980);
  }

  handleMessage(raw) {
    let msg = null;
    try {
      msg = JSON.parse(String(raw));
    } catch {
      return;
    }
    if (!msg || typeof msg !== "object") return;

    if (msg.type === "comment") {
      this.stats.recvComments += 1;
      if (this.crowdEngine) {
        this.crowdEngine.observeStimulus("human_comment", {
          name: msg.name || "iemand",
          text: msg.text || "",
        });
      }
      return;
    }

    if (msg.type === "poll_started") {
      this.activePoll = msg.poll || null;
      if (this.crowdEngine) this.crowdEngine.observeStimulus("poll_started", { poll: this.activePoll });
      this.maybeScheduleVote();
      return;
    }

    if (msg.type === "poll_closed") {
      this.activePoll = null;
      if (this.voteTimer) clearTimeout(this.voteTimer);
      this.voteTimer = null;
      return;
    }

    if (msg.type === "poll_vote_ok") {
      this.stats.voteAcks += 1;
      const pollId = Number(msg.pollId);
      if (Number.isInteger(pollId)) this.votedPollIds.add(pollId);
      return;
    }

    if (msg.type === "error") {
      this.stats.serverErrors += 1;
      if (String(msg.message || "").toLowerCase().includes("slow down")) {
        this.stats.rateLimited += 1;
      }
      const code = String(msg.code || "");
      if (code === "user_blocked") this.stats.blockedErrors += 1;
      if (code === "user_muted") this.stats.mutedErrors += 1;
    }
  }

  maybeScheduleVote() {
    if (!this.options.autoVote) return;
    if (!this.activePoll) return;
    if (!this.connected || !this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    const pollId = Number(this.activePoll.id);
    if (!Number.isInteger(pollId)) return;
    if (this.votedPollIds.has(pollId)) return;
    if (Math.random() > this.options.pollVoteChance) return;
    if (!Array.isArray(this.activePoll.options) || this.activePoll.options.length < 2) return;

    if (this.voteTimer) clearTimeout(this.voteTimer);
    const delayMs = randomInt(this.options.voteDelayMinMs, this.options.voteDelayMaxMs);
    this.voteTimer = setTimeout(() => {
      this.voteTimer = null;
      if (!this.activePoll) return;
      if (!this.connected || !this.ws || this.ws.readyState !== WebSocket.OPEN) return;
      if (Date.now() - this.lastSentAt < this.options.minGapMs) return;
      const optionIndex = randomInt(0, this.activePoll.options.length - 1);
      const sent = this.sendJson({
        type: "poll_vote",
        pollId,
        optionIndex,
        clientTag: this.clientTag,
      });
      if (!sent) return;
      this.lastSentAt = Date.now();
      this.stats.sentVotes += 1;
      this.votedPollIds.add(pollId);
    }, delayMs);
  }

  sendJson(payload) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return false;
    try {
      this.ws.send(JSON.stringify(payload));
      return true;
    } catch {
      return false;
    }
  }
}

function formatElapsed(ms) {
  const totalSec = Math.max(0, Math.floor(ms / 1000));
  const mm = String(Math.floor(totalSec / 60)).padStart(2, "0");
  const ss = String(totalSec % 60).padStart(2, "0");
  return `${mm}:${ss}`;
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    showHelp();
    process.exit(0);
  }
  loadBrainrotWords();
  options.crowdEngine = new CrowdEngine({ config: options });

  console.log(
    `Starting simulation: clients=${options.clients}, duration=${options.durationSec}s, mode=${options.crowdMode}, labels=${options.botLabelMode}, url=${options.url}`
  );
  if (brainrotTerms.length) {
    console.log(`Brainrot terms loaded: ${brainrotTerms.length}`);
  }

  const stats = {
    startedAt: Date.now(),
    opened: 0,
    closed: 0,
    reconnects: 0,
    errors: 0,
    connectedNow: 0,
    maxConnected: 0,
    sentComments: 0,
    sentReactions: 0,
    recvComments: 0,
    sentVotes: 0,
    voteAcks: 0,
    abandonedMessages: 0,
    serverErrors: 0,
    rateLimited: 0,
    blockedErrors: 0,
    mutedErrors: 0,
  };

  let shuttingDown = false;
  const clients = [];
  for (let i = 0; i < options.clients; i += 1) {
    clients.push(new SimClient(i + 1, options, stats));
  }

  function printStats() {
    const elapsedMs = Date.now() - stats.startedAt;
    const elapsedSec = Math.max(1, elapsedMs / 1000);
    const msgPerSec = (stats.sentComments / elapsedSec).toFixed(2);
    const line =
      `[${formatElapsed(elapsedMs)}] connected=${stats.connectedNow}/${options.clients}` +
      ` max=${stats.maxConnected} opened=${stats.opened} closed=${stats.closed}` +
      ` sentMsg=${stats.sentComments} (${msgPerSec}/s)` +
      ` react=${stats.sentReactions} abandoned=${stats.abandonedMessages}` +
      ` sentVotes=${stats.sentVotes} ackVotes=${stats.voteAcks}` +
      ` wsErr=${stats.errors} srvErr=${stats.serverErrors} rateLimited=${stats.rateLimited}`;
    console.log(line);
  }

  function shutdown(reason) {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`Stopping simulation (${reason})...`);
    if (statsTimer) clearInterval(statsTimer);
    if (durationTimer) clearTimeout(durationTimer);
    for (const client of clients) client.stop();
    setTimeout(() => {
      printStats();
      process.exit(0);
    }, 700);
  }

  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));

  for (let i = 0; i < clients.length; i += 1) {
    const delay = options.spawnMs * i;
    setTimeout(() => clients[i].connect(), delay);
  }

  const statsTimer = setInterval(printStats, options.statsMs);
  const durationTimer =
    options.durationSec > 0
      ? setTimeout(() => shutdown("duration reached"), options.durationSec * 1000)
      : null;
}

main();
