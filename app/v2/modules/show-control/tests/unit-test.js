"use strict";

const assert = require("node:assert/strict");

const { validateCueShape } = require("../../../shared/contracts/show-control-v0");
const { executeCue } = require("../cue-engine/cue-engine");
const {
  buildCompoundCue,
  buildGoCue,
  buildPrepareCue,
} = require("../cue-library/runtime-cues");

const runtimeState = {
  schemaVersion: "runtime.state.v0",
  showRunId: "show-run-20260524-190000000Z",
  status: "running",
  updatedAt: "2026-05-24T19:00:00.000Z",
  resolvedPreparedNext: {
    situationId: "situation:1",
    legacySituationId: 1,
    title: "Prepared Scene",
    characterIds: ["character:1"],
    characters: [{ id: "character:1", legacyId: 1, name: "Ada", performerIds: ["performer:1"] }],
    environment: { id: "environment:1", legacyId: 1, name: "Studio" },
    labelIds: ["label:1"],
  },
  activeSituation: {
    situationRunId: "show-run-20260524-190000000Z:situation-run:0001",
    situationId: "situation:1",
    title: "Prepared Scene",
    status: "active",
    resolved: {
      situationId: "situation:1",
      legacySituationId: 1,
      title: "Prepared Scene",
      characterIds: ["character:1"],
      characters: [{ id: "character:1", legacyId: 1, name: "Ada", performerIds: ["performer:1"] }],
      environment: { id: "environment:1", legacyId: 1, name: "Studio" },
      labelIds: ["label:1"],
    },
  },
  preparedNext: { situationId: "situation:1" },
  eligiblePool: [{ situationId: "situation:1" }],
  pathEvaluation: { pathAvailable: ["situation:1"], pathLocked: [] },
};

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function assertNoRuntimeOrderChoice(value) {
  const text = JSON.stringify(value);
  for (const key of ["preparedNext", "eligiblePool", "pathAvailable", "pathLocked", "scores", "scoreFeed"]) {
    assert(!text.includes(`"${key}"`), `${key} should not be emitted by Show Control`);
  }
  assert(!text.includes('"chosenByShowControl"'));
}

async function main() {
  const before = cloneJson(runtimeState);
  const prepareCue = buildPrepareCue(runtimeState, { createdAtDate: new Date("2026-05-24T19:00:01.000Z") });
  assert.equal(validateCueShape(prepareCue).length, 0);
  assert(prepareCue.actions.every((action) => action.actionId.startsWith(`${prepareCue.cueId}:action:`)));
  assert.equal(prepareCue.runtimeRef.source, "runtime.resolvedPreparedNext");
  await executeCue(prepareCue);
  assert.equal(prepareCue.status.state, "ok");
  assert.equal(prepareCue.actions[0].status.stage, "loaded");
  assertNoRuntimeOrderChoice(prepareCue);

  const warningCue = buildPrepareCue(runtimeState, {
    createdAtDate: new Date("2026-05-24T19:00:02.000Z"),
    simulateTargetTimeout: true,
  });
  await executeCue(warningCue);
  assert.equal(warningCue.status.state, "warning");
  assert.equal(warningCue.status.warnings[0].stage, "timedOut");

  const goCue = buildGoCue(runtimeState, { createdAtDate: new Date("2026-05-24T19:00:03.000Z") });
  const goStartedAt = Date.now();
  await executeCue(goCue, { nonBlocking: true });
  assert(Date.now() - goStartedAt < 50, "GO cue should not block on acknowledgements");
  assert.equal(goCue.status.nonBlocking, true);
  assert.equal(goCue.status.stage, "sent");
  assertNoRuntimeOrderChoice(goCue);

  const compoundCue = buildCompoundCue({
    name: "Ordered fixture",
    createdAtDate: new Date("2026-05-24T19:00:04.000Z"),
    actions: [
      { targetId: "touchdesigner", command: "td.phase.set", ackMode: "acknowledged", delayMs: 1 },
      { targetId: "sq5", command: "sq5.scene.set", ackMode: "acknowledged", delayMs: 1 },
      { targetId: "dmx", command: "dmx.look.set", ackMode: "fire-and-forget", delayMs: 1 },
    ],
  });
  await executeCue(compoundCue);
  assert.deepEqual(compoundCue.status.sentOrder, compoundCue.actions.map((action) => action.actionId));

  assert.deepEqual(runtimeState, before, "Show Control must not mutate Runtime state");

  process.stdout.write(JSON.stringify({
    ok: true,
    showRunId: runtimeState.showRunId,
    prepareCueId: prepareCue.cueId,
    goCueId: goCue.cueId,
    compoundOrder: compoundCue.status.sentOrder,
    assertions: [
      "prepare cue sends payload and receives ack",
      "timeout creates warning without crashing",
      "GO cue is non-blocking",
      "compound cue fires in configured order",
      "Show Control does not choose or mutate situation state",
    ],
  }, null, 2));
  process.stdout.write("\n");
}

main().catch((err) => {
  process.stderr.write(`${err.stack || err.message}\n`);
  process.exit(1);
});
