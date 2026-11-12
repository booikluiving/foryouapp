"use strict";

const {
  CROWD_CUES,
  CROWD_MODE_PRESETS,
  CrowdEngine,
  normalizeBotLabelMode,
  normalizeCrowdCue,
  normalizeCrowdMode,
} = require("../crowd-system");
const { haalPersonages, maakPersonageStem } = require("./personage-stem");

// Hoeveel personages tegelijk op het taalmodel mogen wachten.
const PERSONAGES_TEGELIJK = 2;

const DEFAULTS = Object.freeze({
  clients: 20,
  durationSec: 0,
  msgRate: 0.025,
  reactionRate: 0.25,
  likeRate: 0.05,
  minGapMs: 2300,
  spawnMs: 80,
  autoVote: true,
  pollVoteChance: 0.9,
  voteDelayMinMs: 400,
  voteDelayMaxMs: 3200,
  namePrefix: "SimUser",
  topic: "",
  positive: 0.45,
  negative: 0.7,
  callbackRate: 0.34,
  crowdMode: "normal",
  intensity: 0.56,
  realism: 0.82,
  chaos: 0.34,
  warmth: 0.48,
  skepticism: 0.54,
  botLabelMode: "hidden",
  personages: false,
});

const FIRST_NAMES = Object.freeze([
  "Alex", "Sam", "Jamie", "Robin", "Noor", "Milan", "Bo", "Charlie",
  "Ravi", "Lou", "Nour", "Mika", "Isa", "Jules", "Saar", "Kai",
]);

const INTENT_LINES = Object.freeze({
  agree: ["ja precies", "dit werkt wel", "ik ben mee", "meer hiervan"],
  doubt: ["hmm weet niet", "ik twijfel", "dit voelt scheef", "waar gaat dit heen"],
  ask: ["wat gebeurt er nu", "mag ik dit snappen", "is dit expres", "wie kiest dit"],
  misread: ["ik las dit compleet verkeerd", "wacht wat", "mijn brein deed net iets anders"],
  hype: ["wow", "kom op", "dit is sterk", "jaaaaa"],
  awkward: ["dit werd ongemakkelijk", "ik voel spanning", "de zaal werd net stil"],
  callback: ["eens met de vorige", "die opmerking blijft hangen", "daar zit iets in"],
  emoji_wave: ["❤️", "👎", "wow", "!!!"],
  room_observation: ["iedereen kijkt anders nu", "de kamer wacht", "we houden even adem in"],
});

function clampInt(value, min, max, fallback) {
  const n = Number.parseInt(String(value), 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

function clampFloat(value, min, max, fallback) {
  const n = Number.parseFloat(String(value));
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

function parseBooleanLike(value, fallback = false) {
  if (value === undefined || value === null || value === "") return fallback;
  const normalized = String(value).trim().toLowerCase();
  if (["1", "true", "yes", "y", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "n", "off"].includes(normalized)) return false;
  return fallback;
}

function normalizeConfig(raw = {}, base = DEFAULTS) {
  const voteDelayMinMs = clampInt(raw.voteDelayMinMs, 0, 60000, base.voteDelayMinMs);
  const voteDelayMaxMs = clampInt(raw.voteDelayMaxMs, 0, 60000, base.voteDelayMaxMs);
  const negative = clampFloat(raw.negative ?? raw.sarcasm ?? raw.absurdity, 0, 1, base.negative);
  const positive = clampFloat(raw.positive, 0, 1, base.positive);
  return {
    clients: clampInt(raw.clients, 0, 200, base.clients),
    durationSec: clampInt(raw.durationSec, 0, 24 * 60 * 60, base.durationSec),
    msgRate: clampFloat(raw.msgRate, 0, 0.1, base.msgRate),
    reactionRate: clampFloat(raw.reactionRate, 0, 4, base.reactionRate),
    likeRate: clampFloat(raw.likeRate, 0, 2, base.likeRate ?? DEFAULTS.likeRate),
    minGapMs: clampInt(raw.minGapMs, 200, 20000, base.minGapMs),
    spawnMs: clampInt(raw.spawnMs, 0, 5000, base.spawnMs),
    autoVote: parseBooleanLike(raw.autoVote, base.autoVote),
    pollVoteChance: clampFloat(raw.pollVoteChance, 0, 1, base.pollVoteChance),
    voteDelayMinMs: Math.min(voteDelayMinMs, voteDelayMaxMs),
    voteDelayMaxMs: Math.max(voteDelayMinMs, voteDelayMaxMs),
    namePrefix: String(raw.namePrefix || base.namePrefix || "SimUser").trim().replace(/\s+/g, "").slice(0, 16) || "SimUser",
    topic: String(raw.topic || "").trim().replace(/\s+/g, " ").slice(0, 120),
    positive,
    negative,
    callbackRate: clampFloat(raw.callbackRate, 0, 1, base.callbackRate),
    crowdMode: normalizeCrowdMode(raw.crowdMode, base.crowdMode || "normal"),
    intensity: clampFloat(raw.intensity, 0, 1, base.intensity),
    realism: clampFloat(raw.realism, 0, 1, base.realism),
    chaos: clampFloat(raw.chaos ?? raw.absurdity, 0, 1, base.chaos),
    warmth: clampFloat(raw.warmth ?? raw.positive, 0, 1, base.warmth),
    skepticism: clampFloat(raw.skepticism ?? raw.negative, 0, 1, base.skepticism),
    botLabelMode: normalizeBotLabelMode(raw.botLabelMode, base.botLabelMode || "hidden"),
    personages: parseBooleanLike(raw.personages, !!base.personages),
  };
}

function createStats() {
  return {
    startedAt: "",
    stoppedAt: "",
    stopReason: "",
    opened: 0,
    closed: 0,
    connectedNow: 0,
    maxConnected: 0,
    sentComments: 0,
    sentReactions: 0,
    sentVotes: 0,
    voteAcks: 0,
    abandonedMessages: 0,
    serverErrors: 0,
    blockedErrors: 0,
    mutedErrors: 0,
    personages: 0,
    personageComments: 0,
    personageFouten: 0,
    personageLaatsteFout: "",
  };
}

class ChatSimulator {
  constructor(service, options = {}) {
    this.service = service;
    this.haalPersonages = options.haalPersonages || haalPersonages;
    this.stem = options.personageStem || maakPersonageStem();
    this.personagesBezig = 0;
    this.personagesRonde = 0;
    this.laatsteScene = "";
    this.running = false;
    this.config = normalizeConfig();
    this.stats = createStats();
    this.engine = new CrowdEngine({ config: this.config });
    this.bots = [];
    this.tickTimer = null;
    this.stopTimer = null;
    this.defaults = { ...this.config };
  }

  randomInt(min, max) {
    if (max <= min) return min;
    return min + Math.floor(Math.random() * (max - min + 1));
  }

  sample(list, fallback = "") {
    if (!Array.isArray(list) || !list.length) return fallback;
    return list[this.randomInt(0, list.length - 1)] || fallback;
  }

  formatName(index) {
    const first = this.sample(FIRST_NAMES, "Alex");
    if (normalizeBotLabelMode(this.config.botLabelMode, "hidden") === "hidden") return first;
    return `${first} (bot)`.slice(0, 24);
  }

  createBot(index, personage = null) {
    const traits = this.engine.createBotTraits();
    const clientTag = `sim-${String(index).padStart(3, "0")}-${Math.random().toString(36).slice(2, 6)}`;
    return {
      id: index,
      clientId: 100000 + index,
      clientTag,
      clientKey: `127.0.0.1|${clientTag}`,
      name: personage ? personage.naam : this.formatName(index),
      personage,
      ip: "127.0.0.1",
      ua: "audience-internal-simulator",
      isBot: true,
      simulated: true,
      connectedAt: new Date().toISOString(),
      nextCommentAt: Date.now() + this.randomInt(200, Math.max(400, this.config.minGapMs)),
      nextReactionAt: Date.now() + this.randomInt(120, 1000),
      votedPollIds: new Set(),
      nextLikeAt: Date.now() + this.randomInt(1500, 6000),
      likedIds: new Set(),
      profile: {
        ...traits,
        typingCps: Array.isArray(traits.typingCps)
          ? this.randomInt(Number(traits.typingCps[0] || 7), Number(traits.typingCps[1] || 14))
          : 10,
      },
    };
  }

  makeMessage(action) {
    const intent = String(action && action.intent || "agree");
    const base = this.sample(INTENT_LINES[intent], this.sample(INTENT_LINES.agree, "ja"));
    const topic = String(this.config.topic || "").trim();
    if (topic && Math.random() < 0.32) return `${base} (${topic})`.slice(0, 140);
    return String(base).slice(0, 140);
  }

  start(rawConfig = {}) {
    this.stop("restart", { quiet: true });
    this.config = normalizeConfig(rawConfig, this.defaults);
    this.engine = new CrowdEngine({ config: this.config });
    this.running = true;
    this.stats = createStats();
    this.stats.startedAt = new Date().toISOString();
    this.bots = [];

    for (let i = 1; i <= this.config.clients; i += 1) {
      this.laatBinnen(this.createBot(i), this.config.spawnMs * (i - 1));
    }
    if (this.config.personages) this.startPersonages();

    if (this.config.durationSec > 0) {
      this.stopTimer = setTimeout(() => this.stop("duration_elapsed"), this.config.durationSec * 1000);
    }
    this.tickTimer = setInterval(() => this.tick(), 250);
    this.service.recordSimulationEvent("simulation_start", { config: this.config });
    return this.getState();
  }

  // Bot of personage komt de chat binnen, na een korte wachttijd zodat niet iedereen tegelijk joint.
  laatBinnen(bot, wachtMs = 0) {
    this.bots.push(bot);
    setTimeout(() => {
      if (!this.running || !this.bots.includes(bot)) return;
      this.service.registerSimulatedClient(bot);
      this.stats.opened += 1;
      this.stats.connectedNow += 1;
      this.stats.maxConnected = Math.max(this.stats.maxConnected, this.stats.connectedNow);
    }, Math.max(0, wachtMs));
  }

  // Alle actieve personages uit de catalogus komen erbij, naast de bots.
  startPersonages() {
    const ronde = ++this.personagesRonde;
    Promise.resolve().then(() => this.haalPersonages()).then((personages) => {
      if (!this.running || !this.config.personages || ronde !== this.personagesRonde) return;
      personages.forEach((personage, i) => {
        this.laatBinnen(this.createBot(1000 + i, personage), this.config.spawnMs * i);
      });
      this.stats.personages = personages.length;
    }).catch((err) => {
      this.stats.personageFouten += 1;
      this.stats.personageLaatsteFout = `personages ophalen: ${err && err.message ? err.message : "mislukt"}`;
    });
  }

  stopPersonages() {
    this.personagesRonde += 1;
    const weg = this.bots.filter((bot) => bot.personage);
    this.bots = this.bots.filter((bot) => !bot.personage);
    for (const bot of weg) this.service.disconnectSimulatedClient(bot);
    this.stats.closed += weg.length;
    this.stats.connectedNow = Math.max(0, this.stats.connectedNow - weg.length);
    this.stats.personages = 0;
  }

  // Het personage vraagt het taalmodel om één comment in zijn eigen karakter.
  schrijfAlsPersonage(bot) {
    if (bot.bezig || this.personagesBezig >= PERSONAGES_TEGELIJK) return;
    bot.bezig = true;
    this.personagesBezig += 1;
    const chat = typeof this.service.recenteChatVoorPersonages === "function"
      ? this.service.recenteChatVoorPersonages(12)
      : [];
    // De scène komt van de run zelf; de titel die de simulator zag is alleen de terugval.
    const scene = (typeof this.service.laatsteSceneVoorPersonages === "function" && this.service.laatsteSceneVoorPersonages())
      || (this.laatsteScene ? { titel: this.laatsteScene } : null);
    bot.eerder = bot.eerder || [];
    this.stem.schrijf(bot.personage, { scene, chat, onderwerp: this.config.topic, eerder: bot.eerder })
      .then((tekst) => {
        if (!tekst || !this.running || !this.bots.includes(bot)) return null;
        return this.service.acceptSimulatedComment(bot, tekst).then((result) => {
          if (result && result.error) return;
          bot.eerder = [...bot.eerder, tekst].slice(-4);
          this.stats.sentComments += 1;
          this.stats.personageComments += 1;
        });
      })
      .catch((err) => {
        this.stats.personageFouten += 1;
        this.stats.personageLaatsteFout = String(err && err.message ? err.message : "model_fout").slice(0, 120);
      })
      .finally(() => {
        bot.bezig = false;
        this.personagesBezig -= 1;
      });
  }

  update(rawConfig = {}) {
    const hadPersonages = this.config.personages;
    this.config = normalizeConfig(rawConfig, this.config);
    this.engine.updateConfig(this.config);
    for (const bot of this.bots) {
      if (!bot.personage) bot.name = this.formatName(bot.id);
      this.service.registerSimulatedClient(bot);
    }
    if (this.running && this.config.personages && !hadPersonages) this.startPersonages();
    if (this.running && !this.config.personages && hadPersonages) this.stopPersonages();
    this.service.recordSimulationEvent("simulation_update", { config: this.config });
    return this.getState();
  }

  saveDefaults(rawConfig = {}) {
    this.defaults = normalizeConfig(rawConfig, this.defaults);
    this.config = normalizeConfig(this.config, this.defaults);
    return { ...this.defaults };
  }

  issueCue(cue) {
    const normalized = normalizeCrowdCue(cue);
    if (!normalized) return false;
    const accepted = this.engine.applyCue(normalized);
    this.service.recordSimulationEvent("simulation_cue", { cue: normalized, accepted });
    return accepted;
  }

  stop(reason = "admin_stop", options = {}) {
    if (this.tickTimer) clearInterval(this.tickTimer);
    if (this.stopTimer) clearTimeout(this.stopTimer);
    this.tickTimer = null;
    this.stopTimer = null;
    const wasRunning = this.running;
    this.running = false;
    this.personagesRonde += 1;
    if (wasRunning) {
      for (const bot of this.bots) this.service.disconnectSimulatedClient(bot);
      this.stats.closed += this.stats.connectedNow;
      this.stats.connectedNow = 0;
      this.stats.stoppedAt = new Date().toISOString();
      this.stats.stopReason = String(reason || "admin_stop");
      if (!options.quiet) this.service.recordSimulationEvent("simulation_stop", { reason });
    }
    return this.getState();
  }

  tick() {
    if (!this.running) return;
    const now = Date.now();
    const poll = this.service.getActivePollSnapshot();
    const fase = this.service.fase || {};
    const inScene = fase.fase === "scene";
    if (inScene && fase.titel) this.laatsteScene = String(fase.titel);

    for (const bot of this.bots) {
      if (now >= bot.nextReactionAt && Math.random() < this.config.reactionRate / 4) {
        const plan = this.engine.planReaction(bot.profile, 250, { baseRate: this.config.reactionRate });
        const reaction = plan && plan.reaction ? String(plan.reaction) : (Math.random() < 0.72 ? "heart" : "bored");
        this.service.acceptSimulatedReaction(bot, reaction).catch(() => {
          this.stats.serverErrors += 1;
        });
        this.stats.sentReactions += 1;
        bot.nextReactionAt = now + this.randomInt(260, 1300);
      }

      // Hier en daar elkaars comments liken (alleen tussen de scènes, zoals op de telefoon).
      if (now >= bot.nextLikeAt && Math.random() < this.config.likeRate / 4) {
        const id = this.kiesCommentOmTeLiken(bot);
        if (id) {
          bot.likedIds.add(id);
          this.service.acceptSimulatedLike(bot, id).catch(() => {
            this.stats.serverErrors += 1;
          });
          this.stats.sentLikes = Number(this.stats.sentLikes || 0) + 1;
        }
        bot.nextLikeAt = now + this.randomInt(2500, 9000);
      }

      if (now >= bot.nextCommentAt) {
        const plan = this.engine.planComment(bot.id, bot.profile, {
          now,
          baseChance: this.config.msgRate,
          estimatedChars: 28,
        });
        if (plan && !plan.abandon && bot.personage) {
          // Tijdens een scène wordt er niet getypt; dan ook het model niet vragen.
          if (!inScene) this.schrijfAlsPersonage(bot);
        } else if (plan && !plan.abandon) {
          const text = this.makeMessage(plan);
          this.service.acceptSimulatedComment(bot, text).catch(() => {
            this.stats.serverErrors += 1;
          });
          this.stats.sentComments += 1;
        } else if (plan && plan.abandon) {
          this.stats.abandonedMessages += 1;
        }
        bot.nextCommentAt = now + this.randomInt(this.config.minGapMs, Math.max(this.config.minGapMs + 400, this.config.minGapMs * 3));
      }

      if (this.config.autoVote && poll && !bot.votedPollIds.has(poll.id) && Math.random() < this.config.pollVoteChance / 24) {
        const optionIndex = this.randomInt(0, Math.max(0, poll.options.length - 1));
        this.service.acceptSimulatedPollVote(bot, poll.id, optionIndex).then((ok) => {
          if (ok) {
            bot.votedPollIds.add(poll.id);
            this.stats.sentVotes += 1;
            this.stats.voteAcks += 1;
          }
        }).catch(() => {
          this.stats.serverErrors += 1;
        });
      }
    }
  }

  // Recente comments, waarbij comments met al wat likes vaker gekozen worden (zo ontstaat een topcomment).
  kiesCommentOmTeLiken(bot) {
    const kandidaten = typeof this.service.recenteCommentsVoorLikes === "function"
      ? this.service.recenteCommentsVoorLikes(25).filter((c) => c.clientKey !== bot.clientKey && !bot.likedIds.has(c.id))
      : [];
    if (!kandidaten.length) return 0;
    const gewichten = kandidaten.map((c, i) => (1 + Number(c.likes || 0) * 1.5) * (1 + i / kandidaten.length));
    let r = Math.random() * gewichten.reduce((a, b) => a + b, 0);
    for (let i = 0; i < kandidaten.length; i += 1) {
      r -= gewichten[i];
      if (r <= 0) return kandidaten[i].id;
    }
    return kandidaten[kandidaten.length - 1].id;
  }

  observeAcceptedComment(comment) {
    if (!this.running) return;
    this.engine.observeStimulus(comment && comment.isBot ? "bot_comment" : "human_comment", {
      name: comment && comment.name,
      text: comment && comment.text,
      isBot: !!(comment && comment.isBot),
    });
  }

  observeReaction(reaction, isBot = false) {
    if (!this.running) return;
    this.engine.observeStimulus("reaction", { reaction, isBot });
  }

  observePollStarted(poll) {
    if (!this.running) return;
    this.engine.observeStimulus("poll_started", { poll });
  }

  getState() {
    return {
      running: this.running,
      config: { ...this.config },
      stats: { ...this.stats },
      crowd: this.engine.getSnapshot(),
      bots: this.bots.length,
    };
  }
}

module.exports = {
  ChatSimulator,
  CROWD_CUES,
  CROWD_MODE_PRESETS,
  DEFAULTS,
  normalizeConfig,
};
