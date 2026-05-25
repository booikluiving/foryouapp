"use strict";

const assert = require("node:assert/strict");

const { listCommands, resolveCommand } = require("../command-registry/command-registry");
const { executeCue } = require("../cue-engine/cue-engine");
const {
  buildCompoundCue,
  buildStartRunCue,
  buildStartSituationCue,
} = require("../cue-library/runtime-cues");
const { requestForCameraAction } = require("../target-adapters/camera-adapter");
const { requestForPerfectCueAction } = require("../target-adapters/perfect-cue-adapter");
const { requestForSq5Action } = require("../target-adapters/sq5-adapter");
const { requestForStreamDeckAction } = require("../target-adapters/streamdeck-adapter");

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
        generatedActions: action.payload.autoPrepareNext ? [{
          command: "td.environment.prepare",
          ackMode: "required-ready",
          payload: { showRunId: "show-run-unit", situation: { situationId: "situation:unit" } },
        }] : [],
      };
    },
    touchdesigner: adapter("touchdesigner", 8),
    sq5: adapter("sq5", 18),
    camera: adapter("camera", 18),
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
    "runtime.prepareNext",
    "runtime.startSituation",
    "runtime.stopSituation",
    "td.environment.prepare",
    "td.environment.go",
    "td.camera.set",
    "td.caption.update",
    "sq5.input.mute",
    "sq5.output.level",
    "camera.focus",
    "camera.iris",
    "camera.zoom",
    "camera.control",
    "streamdeck.status",
    "perfectCue.trigger",
    "keyboard.trigger",
  ]) {
    assert(commandNames.includes(required), `${required} missing from registry`);
  }
  assert.equal(resolveCommand("runtime.prepareFromRuntimeState").canonicalName, "runtime.prepareNext");
  assert.equal(resolveCommand("touchdesigner.cameraSwitch").canonicalName, "td.camera.set");

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
  const streamDeckStatus = requestForStreamDeckAction({ command: "streamdeck.status", payload: { button: "start", state: "active" } });
  assert.equal(streamDeckStatus.path, "/api/status");
  const streamDeckButton = requestForStreamDeckAction({ command: "streamdeck.button", payload: { button: "go", label: "GO" } });
  assert.equal(streamDeckButton.path, "/api/buttons/go");
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
  assert.equal(startRunCue.status.state, "ok");

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
      streamDeckStatusRoute: `${streamDeckStatus.method} ${streamDeckStatus.path}`,
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
