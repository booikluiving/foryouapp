"use strict";

const assert = require("node:assert/strict");

const {
  validateAudienceAlgorithmInputShape,
  validateAudienceSignalShape,
} = require("../../../shared/contracts/audience-v0");
const {
  assertNoOrderFields,
  buildAlgorithmInput,
  createAudienceSignal,
} = require("../signal-normalizer/signal-normalizer");

const showRunId = "show-run-20260524-170000000Z";
const situationRunId = `${showRunId}:situation-run:0001`;

const activeRuntime = {
  ok: true,
  state: {
    showRunId,
    activeSituation: {
      situationRunId,
      situationId: "situation:2",
      legacySituationId: 2,
      title: "Active fixture",
      startedAt: "2026-05-24T17:00:00.000Z",
      status: "active",
    },
  },
};

function assertNoForbiddenRuntimeKeys(value) {
  const text = JSON.stringify(value);
  for (const key of ["preparedNext", "eligiblePool", "pathAvailable", "order", "scoreFeed"]) {
    assert(!text.includes(`"${key}"`), `${key} should not be published by Audience`);
  }
}

async function main() {
  assert.throws(
    () => assertNoOrderFields({ preparedNext: { situationId: "situation:3" } }),
    /audience_forbidden_order_field:preparedNext/
  );

  const heart = createAudienceSignal(
    { type: "heart", sessionId: "session-a" },
    activeRuntime,
    new Date("2026-05-24T17:00:01.000Z")
  );
  assert.equal(validateAudienceSignalShape(heart).length, 0);
  assert.equal(heart.link.status, "linked");
  assert.equal(heart.link.showRunId, showRunId);
  assert.equal(heart.link.situationRunId, situationRunId);

  const chat = createAudienceSignal(
    { type: "chat", sessionId: "session-b", text: "meer hiervan" },
    activeRuntime,
    new Date("2026-05-24T17:00:02.000Z")
  );
  assert.equal(chat.text, "meer hiervan");

  const outsideActive = createAudienceSignal(
    { type: "bored", sessionId: "session-c" },
    { ok: true, state: { showRunId, activeSituation: null } },
    new Date("2026-05-24T17:00:03.000Z")
  );
  assert.equal(outsideActive.link.status, "unlinked");
  assert.equal(outsideActive.link.reason, "no_active_situation");

  const algorithmInput = buildAlgorithmInput({
    showRunId,
    situationRunId,
    signals: [heart, chat, outsideActive],
    createdAtDate: new Date("2026-05-24T17:00:04.000Z"),
  });
  assert.equal(validateAudienceAlgorithmInputShape(algorithmInput).length, 0);
  assert.equal(algorithmInput.chatAppSignals.heartCount, 1);
  assert.equal(algorithmInput.chatAppSignals.boredCount, 0);
  assert.deepEqual(algorithmInput.chatAppSignals.rawMessages, ["meer hiervan"]);
  assert.equal(algorithmInput.audience.activeClients, 2);
  assert.equal(algorithmInput.signalRefs.length, 2);
  assertNoForbiddenRuntimeKeys(heart);
  assertNoForbiddenRuntimeKeys(algorithmInput);

  process.stdout.write(JSON.stringify({
    ok: true,
    showRunId,
    situationRunId,
    assertions: [
      "heart during active situation links to Runtime situationRunId",
      "signals outside active situation are logged as unlinked",
      "raw chat is exported in Algorithm-compatible chatAppSignals",
      "Audience rejects or omits order/runtime ownership fields",
    ],
  }, null, 2));
  process.stdout.write("\n");
}

main().catch((err) => {
  process.stderr.write(`${err.stack || err.message}\n`);
  process.exit(1);
});
