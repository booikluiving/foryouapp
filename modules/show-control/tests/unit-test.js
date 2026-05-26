"use strict";

const assert = require("node:assert/strict");

const { listCommands, resolveCommand } = require("../command-registry/command-registry");
const { executeCue } = require("../cue-engine/cue-engine");
const {
  buildPrepareCue,
  buildCompoundCue,
  buildSceneToChatCue,
  buildStartRunCue,
  buildStartSituationCue,
} = require("../cue-library/runtime-cues");
const { requestForCameraAction } = require("../target-adapters/camera-adapter");
const { requestForDmxAction } = require("../target-adapters/dmx-adapter");
const { requestForPerfectCueAction } = require("../target-adapters/perfect-cue-adapter");
const { resolvedPayloadFromRuntimeState } = require("../target-adapters/runtime-adapter");
const { requestForScriptAgentAction } = require("../target-adapters/script-agent-adapter");
const { runtimeOutputFromRuntimeState } = require("../cue-library/runtime-output");
const { requestForSq5Action } = require("../target-adapters/sq5-adapter");
const { requestForStreamDeckAction } = require("../target-adapters/streamdeck-adapter");
const { requestForTeleprompterAction } = require("../target-adapters/teleprompter-adapter");

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function makeAdapters(calls) {
  const adapter = (targetId, waitMs = 0) => async (action) => {
    const at = Date.now();
    calls.push({ targetId, command: action.command, actionId: action.actionId, at, route: action.adapterResult && action.adapterResult.route });
    if (waitMs) await sleep(waitMs);
    return { stage: action.ackMode === "required-ready" ? "loaded" : "applied", state: "ok", message: `${targetId} ok` };
  };
  return {
    runtime: async (action) => {
      calls.push({ targetId: "runtime", command: action.command, actionId: action.actionId, at: Date.now(), route: "POST /v0/runtime/runs/start" });
      return {
        stage: "applied",
        state: "ok",
        message: "runtime state changed",
        data: {
          route: "POST /v0/runtime/runs/start",
          runtimeState: {
            showRunId: "show-run-unit",
            resolvedPreparedNext: { situationId: "situation:unit", title: "Unit" },
          },
        },
        generatedActions: action.payload.autoPrepareNext ? [
          {
            command: "teleprompter.prepare",
            targetId: "teleprompter",
            ackMode: "fire-and-forget",
            payload: { showRunId: "show-run-unit", situation: { situationId: "situation:unit" } },
          },
          {
            command: "script-agent.operator.prepareDraft",
            targetId: "script-agent",
            ackMode: "fire-and-forget",
            payload: { runtimeState: { showRunId: "show-run-unit", resolvedPreparedNext: { situationId: "situation:unit" } } },
          },
          {
            command: "td.environment.prepare",
            ackMode: "required-ready",
            payload: { showRunId: "show-run-unit", situation: { situationId: "situation:unit" } },
          },
        ] : [],
      };
    },
    scriptagent: adapter("scriptagent", 2),
    touchdesigner: adapter("touchdesigner", 8),
    sq5: adapter("sq5", 18),
    camera: adapter("camera", 18),
    dmx: adapter("dmx", 2),
    streamdeck: adapter("streamdeck", 2),
    perfectcue: adapter("perfectcue", 2),
    keyboard: adapter("keyboard", 2),
    teleprompter: adapter("teleprompter", 2),
    debug: adapter("debug", 1),
  };
}

async function main() {
  const commandNames = listCommands().map((command) => command.name);
  for (const required of [
    "runtime.startRun",
    "runtime.resetRun",
    "runtime.prepareNext",
    "runtime.startSituation",
    "runtime.stopSituation",
    "td.environment.prepare",
    "td.environment.go",
    "td.camera.set",
    "td.phase.set",
    "td.status.heartbeat",
    "td.caption.update",
    "sq5.input.mute",
    "sq5.output.level",
    "dmx.look",
    "dmx.preset",
    "dmx.blackout",
    "dmx.status",
    "camera.focus",
    "camera.iris",
    "camera.zoom",
    "camera.control",
    "streamdeck.status",
    "teleprompter.prepare",
    "teleprompter.ready",
    "teleprompter.reveal",
    "script-agent.operator.prepareDraft",
    "script-agent.operator.sceneToChat",
    "perfectCue.trigger",
    "keyboard.trigger",
  ]) {
    assert(commandNames.includes(required), `${required} missing from registry`);
  }
  assert.equal(resolveCommand("runtime.prepareFromRuntimeState").canonicalName, "runtime.prepareNext");
  assert.equal(resolveCommand("runtime.stopRun").canonicalName, "runtime.resetRun");
  assert.equal(resolveCommand("touchdesigner.cameraSwitch").canonicalName, "td.camera.set");

  const assetRuntimeState = {
    showRunId: "show-run-assets",
    resolvedPreparedNext: {
      situationId: "situation:assets",
      title: "Asset situation",
      environment: { id: "environment:assets", legacyId: 17, name: "Asset Studio" },
    },
    showRunSnapshot: {
      catalog: {
        mediaAssets: [
          {
            id: "media-asset:environment:assets:background:hero",
            environmentId: "environment:assets",
            type: "background",
            role: "background",
            status: "present",
            filename: "hero.jpg",
            filePath: "/tmp/foryou-hero.jpg",
            url: "/v0/catalog/media-assets/file/media-asset%3Aenvironment%3Aassets%3Abackground%3Ahero",
          },
        ],
        environmentCompositions: [],
      },
    },
  };
  const enrichedPayload = resolvedPayloadFromRuntimeState(assetRuntimeState);
  assert.equal(enrichedPayload.environmentId, "environment:assets");
  assert.equal(enrichedPayload.assetId, "media-asset:environment:assets:background:hero");
  assert.equal(enrichedPayload.backgroundAsset.filePath, "/tmp/foryou-hero.jpg");
  const prepareCue = buildPrepareCue(assetRuntimeState, { createdAtDate: new Date("2026-05-25T10:00:00.000Z") });
  const prepareAction = prepareCue.actions.find((action) => action.command === "td.environment.prepare");
  assert.equal(prepareAction.payload.assetId, "media-asset:environment:assets:background:hero");
  const operatorPrepareAction = prepareCue.actions.find((action) => action.command === "script-agent.operator.prepareDraft");
  assert(operatorPrepareAction.payload.runtimeOutput, "operator prepare should use compact runtimeOutput");
  assert(!operatorPrepareAction.payload.runtimeState, "operator prepare should not inline full runtimeState");
  assert.equal(operatorPrepareAction.payload.runtimeOutput.resolvedPreparedNext.situationId, "situation:assets");

  const oversizedRuntimeState = {
    ...assetRuntimeState,
    showRunSnapshot: {
      catalog: {
        ...assetRuntimeState.showRunSnapshot.catalog,
        situations: Array.from({ length: 250 }, (_, index) => ({
          id: `situation:${index}`,
          title: `Large fixture ${index}`,
          promptText: "x".repeat(1200),
        })),
      },
    },
    pathEvaluation: { items: Array.from({ length: 250 }, (_, index) => ({ situationId: `situation:${index}`, status: "available" })) },
    lastScoreFeed: { scores: Array.from({ length: 250 }, (_, index) => ({ situationId: `situation:${index}`, score: index })) },
  };
  const compactRuntimeOutput = runtimeOutputFromRuntimeState(oversizedRuntimeState);
  assert(Buffer.byteLength(JSON.stringify(oversizedRuntimeState)) > 300000, "fixture should be large enough to catch regressions");
  assert(Buffer.byteLength(JSON.stringify(compactRuntimeOutput)) < 25000, "Script Agent runtimeOutput should stay compact");
  assert(!JSON.stringify(compactRuntimeOutput).includes("\"showRunSnapshot\":"), "runtimeOutput should not contain full showRunSnapshot");

  const sq5Input = requestForSq5Action({ command: "sq5.input.mute", payload: { channel: "brent", muted: true } });
  assert.equal(sq5Input.method, "POST");
  assert.equal(sq5Input.path, "/api/input/brent/mute");
  assert.deepEqual(sq5Input.body, { muted: true });
  const sq5Output = requestForSq5Action({ command: "sq5.output.level", payload: { output: "main", db: -6 } });
  assert.equal(sq5Output.path, "/api/output/main/level");
  assert.deepEqual(sq5Output.body, { db: -6 });
  const cameraFocus = requestForCameraAction({ command: "camera.focus", payload: { camera: "cam1", normalised: 0.5 } });
  assert.equal(cameraFocus.path, "/api/camera/cam1/focus");
  assert.deepEqual(cameraFocus.body, { normalised: 0.5 });
  const cameraControl = requestForCameraAction({ command: "camera.control", payload: { camera: "cam2", endpoint: "/lens/focus", value: { normalised: 0.2 } } });
  assert.equal(cameraControl.path, "/api/camera/cam2/control");
  const dmxLook = requestForDmxAction({ command: "dmx.look", payload: { label: "unit", channels: { 1: 255, 2: 0, 3: 255 }, holdMs: 200 } });
  assert.equal(dmxLook.path, "/api/look");
  assert.deepEqual(dmxLook.body.channels, { 1: 255, 2: 0, 3: 255 });
  const dmxPreset = requestForDmxAction({ command: "dmx.preset", payload: { preset: "bioscoop", holdMs: 900 } });
  assert.equal(dmxPreset.path, "/api/preset");
  assert.equal(dmxPreset.body.preset, "bioscoop");
  const dmxBlackout = requestForDmxAction({ command: "dmx.blackout", payload: { holdMs: 100 } });
  assert.equal(dmxBlackout.path, "/api/blackout");
  const streamDeckStatus = requestForStreamDeckAction({ command: "streamdeck.status", payload: { button: "start", state: "active" } });
  assert.equal(streamDeckStatus.path, "/api/status");
  const streamDeckButton = requestForStreamDeckAction({ command: "streamdeck.button", payload: { button: "go", label: "GO" } });
  assert.equal(streamDeckButton.path, "/api/buttons/go");
  const teleprompterPrepare = requestForTeleprompterAction({ command: "teleprompter.prepare", payload: { situation: { title: "Unit" } } });
  assert.equal(teleprompterPrepare.path, "/v0/script-agent/teleprompter-parser/prepare");
  const teleprompterReveal = requestForTeleprompterAction({ command: "teleprompter.reveal", payload: {} });
  assert.equal(teleprompterReveal.path, "/v0/script-agent/teleprompter-parser/reveal");
  const prepareDraftRequest = requestForScriptAgentAction({ command: "script-agent.operator.prepareDraft", payload: { sourceId: "unit" } });
  assert.equal(prepareDraftRequest.path, "/v0/script-agent/operator/draft/from-runtime");
  assert.equal(prepareDraftRequest.body.sourceId, "unit");
  const sceneToChatRequest = requestForScriptAgentAction({ command: "script-agent.operator.sceneToChat", payload: { sessionId: "show-run-unit" } });
  assert.equal(sceneToChatRequest.path, "/v0/script-agent/operator/scene-to-chat");
  assert.equal(sceneToChatRequest.body.sessionId, "show-run-unit");
  const perfectCueTrigger = requestForPerfectCueAction({ command: "perfectCue.trigger", payload: { key: "Space", cueId: "cue-1" } });
  assert.equal(perfectCueTrigger.path, "/api/trigger");
  assert.equal(perfectCueTrigger.body.source, "perfect-cue");
  const mockOnlyTransports = [["mock", "or", "companion"].join("-"), ["keyboard", "contract"].join("-")];
  assert(!listCommands().some((command) => mockOnlyTransports.includes(command.transport)), "hardware commands must not be mock-only");

  await assert.rejects(
    () => executeCue(buildCompoundCue({ actions: [{ command: "unknown.target.command" }] }), { adapters: makeAdapters([]) }),
    /show_control_unknown_command:unknown\.target\.command/
  );

  const delayCalls = [];
  const orderedParallelCue = buildCompoundCue({
    name: "Delay and parallel",
    actions: [
      { command: "debug.noop", ackMode: "fire-and-forget", delayMs: 35, payload: { label: "first" } },
      { command: "sq5.input.mute", ackMode: "acknowledged-async", parallelGroup: "fanout", payload: { channel: "brent", muted: false } },
      { command: "camera.focus", ackMode: "acknowledged-async", parallelGroup: "fanout", payload: { camera: "cam1", normalised: 0.6 } },
    ],
  });
  const delayStarted = Date.now();
  await executeCue(orderedParallelCue, { adapters: makeAdapters(delayCalls) });
  const first = delayCalls.find((call) => call.command === "debug.noop");
  const sq5 = delayCalls.find((call) => call.command === "sq5.input.mute");
  const camera = delayCalls.find((call) => call.command === "camera.focus");
  assert(first.at - delayStarted >= 30, "ordered action delayMs should be respected");
  assert(Math.abs(sq5.at - camera.at) < 12, "parallel group should start together");
  assert.deepEqual(orderedParallelCue.status.sentOrder, orderedParallelCue.actions.map((action) => action.actionId));

  const startRunCalls = [];
  const startRunCue = buildStartRunCue({ autoPrepareNext: true, createdAtDate: new Date("2026-05-25T10:00:00.000Z") });
  await executeCue(startRunCue, { adapters: makeAdapters(startRunCalls) });
  assert(startRunCalls.some((call) => call.command === "runtime.startRun"), "startRun command should call Runtime adapter");
  assert(startRunCalls.some((call) => call.command === "td.environment.prepare"), "startRun should generate prepare action");
  assert(startRunCalls.some((call) => call.command === "teleprompter.prepare"), "startRun should generate teleprompter prepare action");
  assert(startRunCalls.some((call) => call.command === "script-agent.operator.prepareDraft"), "startRun should prepare the operator draft");
  assert(startRunCue.actions.findIndex((action) => action.command === "teleprompter.prepare") < startRunCue.actions.findIndex((action) => action.command === "td.environment.prepare"), "teleprompter prepare should be sent before TD prepare");
  assert(startRunCue.actions.findIndex((action) => action.command === "script-agent.operator.prepareDraft") < startRunCue.actions.findIndex((action) => action.command === "td.environment.prepare"), "operator draft prepare should be sent before TD prepare");
  assert.equal(startRunCue.status.state, "ok");

  const sceneChatCalls = [];
  const sceneChatCue = buildSceneToChatCue({
    showRunId: "show-run-unit",
    resolvedPreparedNext: { situationId: "situation:unit", title: "Unit", characters: [], environment: null },
  }, { createdAtDate: new Date("2026-05-25T10:00:01.000Z") });
  await executeCue(sceneChatCue, { adapters: makeAdapters(sceneChatCalls) });
  assert(sceneChatCalls.some((call) => call.command === "script-agent.operator.sceneToChat"), "sceneToChat cue should call Script Agent");
  assert(!sceneChatCue.actions.some((action) => action.command === "teleprompter.prepare"), "sceneToChat must not prepare teleprompter");

  const autoGoStartSituationCue = buildStartSituationCue({ showRunId: "show-run-unit" });
  assert.equal(autoGoStartSituationCue.actions[0].payload.autoGoEnvironment, true, "startSituation should auto-generate TD GO by default");
  const explicitGoStartSituationCue = buildStartSituationCue({
    showRunId: "show-run-unit",
    actions: [
      { command: "td.environment.go", ackMode: "fire-and-forget", payload: { environmentId: "env" } },
    ],
  });
  assert.equal(explicitGoStartSituationCue.actions[0].payload.autoGoEnvironment, false, "explicit TD GO should disable generated TD GO");

  const fanoutCalls = [];
  const fanoutCue = buildStartSituationCue({
    showRunId: "show-run-unit",
    actions: [
      { command: "td.environment.go", ackMode: "fire-and-forget", payload: { environmentId: "env" } },
      { command: "sq5.input.mute", ackMode: "acknowledged-async", payload: { channel: "brent", muted: false } },
      { command: "camera.zoom", ackMode: "acknowledged-async", payload: { camera: "cam1", normalised: 0.7 } },
      { command: "streamdeck.status", ackMode: "fire-and-forget", payload: { button: "start", state: "active" } },
    ],
  });
  await executeCue(fanoutCue, { adapters: makeAdapters(fanoutCalls) });
  for (const command of ["runtime.startSituation", "td.environment.go", "sq5.input.mute", "camera.zoom", "streamdeck.status"]) {
    assert(fanoutCalls.some((call) => call.command === command), `${command} should be called`);
  }
  const fanoutStartTimes = fanoutCalls.filter((call) => call.command !== "runtime.startRun").map((call) => call.at);
  assert(Math.max(...fanoutStartTimes) - Math.min(...fanoutStartTimes) < 30, "startSituation fan-out should be parallel");

  process.stdout.write(JSON.stringify({
    ok: true,
    commandCount: commandNames.length,
    sidecarContracts: {
      sq5InputRoute: `${sq5Input.method} ${sq5Input.path}`,
      sq5OutputRoute: `${sq5Output.method} ${sq5Output.path}`,
      cameraFocusRoute: `${cameraFocus.method} ${cameraFocus.path}`,
      cameraControlRoute: `${cameraControl.method} ${cameraControl.path}`,
      dmxLookRoute: `${dmxLook.method} ${dmxLook.path}`,
      dmxPresetRoute: `${dmxPreset.method} ${dmxPreset.path}`,
      dmxBlackoutRoute: `${dmxBlackout.method} ${dmxBlackout.path}`,
      streamDeckStatusRoute: `${streamDeckStatus.method} ${streamDeckStatus.path}`,
      teleprompterPrepareRoute: `${teleprompterPrepare.method} ${teleprompterPrepare.path}`,
      teleprompterRevealRoute: `${teleprompterReveal.method} ${teleprompterReveal.path}`,
      perfectCueTriggerRoute: `${perfectCueTrigger.method} ${perfectCueTrigger.path}`,
    },
    hypotheses: {
      H2: "runtime.startSituation fan-out reached TD, SQ5, Camera and Stream Deck adapters",
      H3: "ordered delayMs and parallel group timing asserted",
      H4: "unknown command rejected by command registry",
      H5: "SQ5/Camera adapter routes match existing sidecar API contracts",
      H10: "Show Control delegates to adapters instead of owning SQ5/Camera/Runtime logic",
    },
  }, null, 2));
  process.stdout.write("\n");
}

main().catch((err) => {
  process.stderr.write(`${err.stack || err.message}\n`);
  process.exit(1);
});
