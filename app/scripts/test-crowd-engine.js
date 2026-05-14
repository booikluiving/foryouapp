#!/usr/bin/env node
"use strict";

const assert = require("node:assert/strict");
const {
  CrowdEngine,
  createSeededRng,
} = require("../../crowd-system");

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
  return {
    actions,
    snapshot: engine.getSnapshot(),
  };
}

const first = transcriptFor("crowd-v2");
const second = transcriptFor("crowd-v2");
const other = transcriptFor("crowd-v2-other");

assert.deepEqual(second.actions, first.actions, "same seed should produce the same action sequence");
assert.notDeepEqual(other.actions, first.actions, "different seed should produce a different action sequence");
assert.ok(first.actions.length >= 6, "crowd should produce a visible transcript shape");
assert.ok(first.actions.some((line) => line.includes(":callback:") || line.includes(":ask:")), "human stimulus should affect intents");
assert.ok(first.snapshot.memoryCount > 0, "engine should remember observed comments");
assert.ok(first.snapshot.topMotifs.length > 0, "engine should extract reusable motifs");

console.log("PASS crowd engine deterministic simulation");
