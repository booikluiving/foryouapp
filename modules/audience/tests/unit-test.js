"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");

const {
  validateAudienceAlgorithmInputShape,
  validateAudienceSignalShape,
} = require("../../../shared/contracts/audience-v0");
const { AudienceStore } = require("../db/audience-store");
const { AudienceService } = require("../server/audience-service");
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

  const tempDir = await fs.mkdtemp(path.join(__dirname, ".tmp-audience-unit-"));
  const store = new AudienceStore({ dbPath: path.join(tempDir, "audience.sqlite") });
  const liveAlgorithmInputs = [];
  const runtimeScorePosts = [];
  try {
    const service = new AudienceService({
      store,
      liveScoreDispatchDelayMs: 0,
      clients: {
        fetchCurrentRuntimeState: async () => activeRuntime,
        sendAudienceSignalsToAlgorithm: async (input) => {
          liveAlgorithmInputs.push(input);
          return {
            ok: true,
            scorePhase: "live",
            scoreFeed: {
              type: "situationScoresUpdated",
              schemaVersion: "algorithm.score-feed.v0",
              showRunId: input.showRunId,
              scorePhase: "live",
              updatedAfterSituationRunId: input.situationRunId,
              scores: [{ situationId: input.situationId, predictedScore: input.chatAppSignals.heartCount, reasons: ["live_audience_signals"] }],
            },
          };
        },
        sendScoreFeedToRuntime: async (payload) => {
          runtimeScorePosts.push(payload);
          return { ok: true, preparedNextUnchanged: true, eligiblePoolResorted: true };
        },
      },
    });
    const liveSignal = await service.recordSignal({
      type: "heart",
      meta: { clientKey: "unit|client", clientTag: "client", isBot: false, simulated: false },
      reaction: "heart",
    });
    await service.liveScoreDispatchChain;
    assert.equal(liveSignal.link.status, "linked");
    assert.equal(liveAlgorithmInputs.length, 1, "accepted linked signals should trigger Algorithm live input");
    assert.equal(liveAlgorithmInputs[0].chatAppSignals.heartCount, 1);
    assert.equal(liveAlgorithmInputs[0].audienceAggregateVersion, 1);
    assert.equal(runtimeScorePosts.length, 1, "Audience should forward Algorithm scoreFeed to Runtime");
    assert.equal(runtimeScorePosts[0].scoreFeed.scorePhase, "live");
    assert.equal(service.liveScoreStatus.ok, true);

    const recoveryStore = new AudienceStore({ dbPath: path.join(tempDir, "audience-recovery.sqlite") });
    const recoveryAlgorithmInputs = [];
    const recoveryRuntimeScorePosts = [];
    const recoveryRestoreCalls = [];
    try {
      const recoveryService = new AudienceService({
        store: recoveryStore,
        liveScoreDispatchDelayMs: 0,
        clients: {
          fetchCurrentRuntimeState: async () => activeRuntime,
          restoreRuntimeAlgorithmContext: async (payload) => {
            recoveryRestoreCalls.push(payload);
            return { ok: true, restored: true, preparedNextUnchanged: true };
          },
          sendAudienceSignalsToAlgorithm: async (input) => {
            recoveryAlgorithmInputs.push(input);
            if (recoveryAlgorithmInputs.length === 1) {
              throw new Error("http://algorithm returned 404: {\"error\":\"algorithm_missing_scoring_context\"}");
            }
            return {
              ok: true,
              scorePhase: "live",
              scoreFeed: {
                type: "situationScoresUpdated",
                schemaVersion: "algorithm.score-feed.v0",
                showRunId: input.showRunId,
                scorePhase: "live",
                updatedAfterSituationRunId: input.situationRunId,
                scores: [{ situationId: input.situationId, predictedScore: 9, reasons: ["live_audience_signals"] }],
              },
            };
          },
          sendScoreFeedToRuntime: async (payload) => {
            recoveryRuntimeScorePosts.push(payload);
            return { ok: true, preparedNextUnchanged: true, eligiblePoolResorted: true };
          },
        },
      });
      await recoveryService.recordSignal({
        type: "heart",
        meta: { clientKey: "unit|recovery-client", clientTag: "client", isBot: false, simulated: false },
        reaction: "heart",
      });
      await recoveryService.liveScoreDispatchChain;
      assert.equal(recoveryAlgorithmInputs.length, 2, "Audience should retry Algorithm once after missing context");
      assert.equal(recoveryRestoreCalls.length, 1, "Audience should ask Runtime to restore Algorithm context");
      assert.equal(recoveryRestoreCalls[0].showRunId, showRunId);
      assert.equal(recoveryRuntimeScorePosts.length, 1, "recovered live scoreFeed should still reach Runtime");
      assert.equal(recoveryService.liveScoreStatus.ok, true);
      assert.equal(recoveryService.liveScoreStatus.recoveredMissingAlgorithmContext, true);
      assert.equal(recoveryService.liveScoreStatus.recoveryCount, 1);
    } finally {
      recoveryStore.close();
    }
  } finally {
    store.close();
    await fs.rm(tempDir, { recursive: true, force: true });
  }

  process.stdout.write(JSON.stringify({
    ok: true,
    showRunId,
    situationRunId,
    assertions: [
      "heart during active situation links to Runtime situationRunId",
      "signals outside active situation are logged as unlinked",
      "raw chat is exported in Algorithm-compatible chatAppSignals",
      "Audience rejects or omits order/runtime ownership fields",
      "accepted linked signals dispatch live Algorithm scores to Runtime",
      "missing Algorithm context is restored through Runtime and retried once",
    ],
  }, null, 2));
  process.stdout.write("\n");
}

main().catch((err) => {
  process.stderr.write(`${err.stack || err.message}\n`);
  process.exit(1);
});
