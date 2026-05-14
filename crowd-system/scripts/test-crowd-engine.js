#!/usr/bin/env node
"use strict";

const assert = require("node:assert/strict");
const {
  CrowdEngine,
  createSeededRng,
} = require("../index");

function transcriptFor(seed) {
  const engine = new CrowdEngine({
    rng: createSeededRng(seed),
    config: {
      crowdMode: "chaotic",
      intensity: 0.82,
      realism: 0.78,
      chaos: 0.74,
      warmth: 0.52,
      skepticism: 0.46,
      callbackRate: 0.86,
      emojiLooseRate: 0.62,
      reactionRate: 0.4,
    },
  });
  const profiles = Array.from({ length: 12 }, () => engine.createBotTraits());
  const startedAt = 1_700_000_000_000;
  engine.observeStimulus("human_comment", {
    name: "Mila",
    text: "wacht waarom voelt dit ineens als een geheime test haha",
  }, startedAt);

  const actions = [];
  for (let step = 1; step <= 42; step += 1) {
    const now = startedAt + step * 850;
    for (let botId = 1; botId <= profiles.length; botId += 1) {
      const action = engine.planComment(botId, profiles[botId - 1], {
        now,
        baseChance: 0.08,
        estimatedChars: 34,
      });
      if (!action) continue;
      actions.push([
        botId,
        action.intent,
        action.abandon ? "abandon" : "send",
        action.reference && action.reference.name ? action.reference.name : "",
        action.motif || "",
      ].join(":"));
      if (!action.abandon) {
        engine.observeStimulus("bot_comment", {
          name: `Bot${botId}`,
          text: `${action.intent} ${action.motif || "moment"}`,
          isBot: true,
        }, now + Number(action.typingDelayMs || 0));
      }
    }
  }
  const snapshot = engine.getSnapshot();
  return { seed, steps: actions.length, actions, mood: snapshot.mood, topMotifs: snapshot.topMotifs };
}

const t1 = transcriptFor("mila-2025");
const t2 = transcriptFor("mila-2025");
const t3 = transcriptFor("brent-2025");

assert.strictEqual(t1.steps, t2.steps, "same seed → same step count");
assert.deepStrictEqual(t1.actions, t2.actions, "same seed → identical transcript");
assert.notDeepStrictEqual(t1.actions, t3.actions, "different seed → different transcript");
assert.ok(t1.actions.length > 0, "chaotic mode produces actions");
assert.ok(t1.mood.attention > 0, "mood.attention is set");
assert.ok(t1.topMotifs.length >= 0, "topMotifs is an array");

console.log("✅ All crowd-engine tests passed");
console.log(`   Seed "${t1.seed}": ${t1.steps} actions, mood attention=${t1.mood.attention.toFixed(3)}`);
