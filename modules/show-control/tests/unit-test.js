"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");

const { listCommands, resolveCommand } = require("../command-registry/command-registry");
const { executeCue } = require("../cue-engine/cue-engine");
const { compactCueForStorage } = require("../cue-engine/compact-results");
const { summarizeCue } = require("../cue-engine/cue-summary");
const {
  payloadIndexFilePath,
  readIndexedPayload,
  rebuildPayloadIndex,
  saveCue,
} = require("../cue-engine/state-store");
const {
  buildPrepareCue,
  buildCompoundCue,
  buildEnvironmentMediaRefreshCue,
  buildPhaseCue,
  buildSceneToChatCue,
  buildStartRunCue,
  buildStartSituationCue,
  buildStopSituationCue,
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
const {
  DEFAULT_STOP_PRESET_ID,
  channelsForPreset,
} = require("../../../shared/lighting/environment-lighting-v0");

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
    "teleprompter.cue",
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
          {
            id: "media-asset:environment:assets:soundscape:room",
            environmentId: "environment:assets",
            type: "soundscape",
            role: "soundscape",
            status: "present",
            filename: "room.mp3",
            filePath: "/tmp/foryou-room.mp3",
            url: "/v0/catalog/media-assets/file/media-asset%3Aenvironment%3Aassets%3Asoundscape%3Aroom",
          },
          {
            id: "media-asset:environment:assets:fxVideo:glitch",
            environmentId: "environment:assets",
            type: "fx",
            role: "fxVideo",
            status: "present",
            filename: "glitch.mp4",
            filePath: "/tmp/foryou-glitch.mp4",
            url: "/v0/catalog/media-assets/file/media-asset%3Aenvironment%3Aassets%3AfxVideo%3Aglitch",
          },
          {
            id: "media-asset:environment:assets:fxImage:overlay",
            environmentId: "environment:assets",
            type: "fx",
            role: "fxImage",
            status: "present",
            filename: "overlay.png",
            filePath: "/tmp/foryou-overlay.png",
            url: "/v0/catalog/media-assets/file/media-asset%3Aenvironment%3Aassets%3AfxImage%3Aoverlay",
          },
          {
            id: "media-asset:environment:assets:fxImage:output",
            environmentId: "environment:assets",
            type: "fx",
            role: "fxImage",
            status: "present",
            filename: "foryou-output.png",
            filePath: "/tmp/foryou-output.png",
            tags: ["fx", "image", "rendered-output", "td-output"],
            url: "/v0/catalog/media-assets/file/media-asset%3Aenvironment%3Aassets%3AfxImage%3Aoutput",
          },
        ],
        environmentCompositions: [{
          environmentId: "environment:assets",
          fxVideoLayer: { assetId: "media-asset:environment:assets:fxVideo:glitch", zIndex: 10 },
          imageLayers: [{ assetId: "media-asset:environment:assets:fxImage:overlay", zIndex: 20 }],
          lighting: {
            mode: "preset",
            presetId: "festival-color",
          },
        }],
      },
    },
  };
  const enrichedPayload = resolvedPayloadFromRuntimeState(assetRuntimeState);
  assert.equal(enrichedPayload.environmentId, "environment:assets");
  assert.equal(enrichedPayload.assetId, "media-asset:environment:assets:background:hero");
  assert.equal(enrichedPayload.backgroundAsset.filePath, "/tmp/foryou-hero.jpg");
  assert.equal(enrichedPayload.soundscapeAsset.filePath, "/tmp/foryou-room.mp3");
  assert.equal(enrichedPayload.soundscapeFilePath, "/tmp/foryou-room.mp3");
  assert.equal(enrichedPayload.fxAssets.length, 1);
  assert.deepEqual(enrichedPayload.fxFilePaths, ["/tmp/foryou-output.png"]);
  assert.equal(enrichedPayload.assetFilePaths.background, "/tmp/foryou-hero.jpg");
  assert.equal(enrichedPayload.assetFilePaths.soundscape, "/tmp/foryou-room.mp3");
  assert.equal(enrichedPayload.hasFxOverlay, true);
  assert.equal(enrichedPayload.fxOverlayFilePath, "/tmp/foryou-output.png");
  assert.equal(enrichedPayload.environmentLighting.presetId, "festival-color");
  assert.equal(enrichedPayload.environmentLighting.fixtures.lamp1.saturation, 170);
  const liveCatalog = {
    mediaAssets: [
      {
        id: "media-asset:environment:assets:background:hero",
        environmentId: "environment:assets",
        type: "background",
        role: "background",
        status: "replaced",
        filename: "hero.mp4",
        filePath: "/tmp/foryou-old-hero.mp4",
      },
      {
        id: "media-asset:environment:assets:background:festival-jpg",
        environmentId: "environment:assets",
        type: "background",
        role: "background",
        status: "present",
        filename: "festival.jpg",
        filePath: "/tmp/foryou-festival.jpg",
        url: "/v0/catalog/media-assets/file/media-asset%3Aenvironment%3Aassets%3Abackground%3Afestival-jpg",
      },
      {
        id: "media-asset:environment:assets:soundscape:room",
        environmentId: "environment:assets",
        type: "soundscape",
        role: "soundscape",
        status: "present",
        filename: "room.mp3",
        filePath: "/tmp/foryou-room.mp3",
      },
      {
        id: "media-asset:environment:assets:fxImage:output-live",
        environmentId: "environment:assets",
        type: "fx",
        role: "fxImage",
        status: "present",
        filename: "foryou-live-output.png",
        filePath: "/tmp/foryou-live-output.png",
        tags: ["rendered-output", "td-output"],
      },
    ],
    environmentCompositions: [{
      environmentId: "environment:assets",
      backgroundLayer: { assetId: "media-asset:environment:assets:background:festival-jpg", zIndex: 1 },
      imageLayers: [{ assetId: "media-asset:environment:assets:fxImage:output-live", zIndex: 20 }],
      lighting: {
        mode: "custom",
        presetId: "studio-neutral",
        fixtures: {
          lamp1: { hue: 12, saturation: 0, intensity: 111 },
          lamp2: { hue: 22, saturation: 10, intensity: 122 },
          lamp3: { hue: 32, saturation: 20, intensity: 133 },
        },
      },
    }],
  };
  const livePayload = resolvedPayloadFromRuntimeState(assetRuntimeState, "resolvedPreparedNext", "", { liveCatalog });
  assert.equal(livePayload.mediaAssetResolution.live, true);
  assert.equal(livePayload.mediaAssetResolution.source, "option");
  assert.equal(livePayload.backgroundAsset.assetId, "media-asset:environment:assets:background:festival-jpg");
  assert.equal(livePayload.backgroundAsset.filePath, "/tmp/foryou-festival.jpg");
  assert.equal(livePayload.filePath, "/tmp/foryou-festival.jpg");
  assert.deepEqual(livePayload.fxFilePaths, ["/tmp/foryou-live-output.png"]);
  assert.equal(livePayload.environmentLighting.mode, "custom");
  assert.equal(livePayload.environmentLighting.fixtures.lamp2.intensity, 122);
  const preparedRefreshCue = buildEnvironmentMediaRefreshCue(assetRuntimeState, {
    environmentId: "environment:assets",
    liveCatalog,
    assetId: "media-asset:environment:assets:background:festival-jpg",
    reason: "media_composition_save",
    source: "unit",
    createdAtDate: new Date("2026-05-25T10:00:02.000Z"),
  });
  assert.equal(preparedRefreshCue.actions.length, 1);
  assert.equal(preparedRefreshCue.actions[0].command, "td.environment.prepare");
  assert.equal(preparedRefreshCue.actions[0].payload.cueIntent, "live_media_refresh_prepared");
  assert.equal(preparedRefreshCue.actions[0].payload.backgroundAsset.filePath, "/tmp/foryou-festival.jpg");
  assert.equal(preparedRefreshCue.actions[0].payload.mediaRefresh.assetId, "media-asset:environment:assets:background:festival-jpg");
  const activeRefreshCue = buildEnvironmentMediaRefreshCue({
    ...assetRuntimeState,
    activeSituation: {
      situationRunId: "situation-run:assets",
      resolved: assetRuntimeState.resolvedPreparedNext,
    },
  }, {
    environmentId: "environment:assets",
    liveCatalog,
    createdAtDate: new Date("2026-05-25T10:00:03.000Z"),
  });
  assert.equal(activeRefreshCue.actions.length, 1);
  assert.equal(activeRefreshCue.actions[0].command, "td.environment.go");
  assert.equal(activeRefreshCue.actions[0].payload.cueIntent, "live_media_refresh_active");
  assert.equal(activeRefreshCue.actions[0].payload.backgroundAsset.filePath, "/tmp/foryou-festival.jpg");
  const skippedRefreshCue = buildEnvironmentMediaRefreshCue(assetRuntimeState, {
    environmentId: "environment:missing",
    liveCatalog,
  });
  assert.equal(skippedRefreshCue.actions.length, 0);
  const noFxPayload = resolvedPayloadFromRuntimeState({
    showRunId: "show-run-no-fx",
    resolvedPreparedNext: {
      situationId: "situation:no-fx",
      title: "No FX fixture",
      environment: { id: "environment:no-fx", legacyId: 12, name: "Ziekenhuis" },
    },
    showRunSnapshot: {
      catalog: {
        mediaAssets: [
          {
            id: "media-asset:environment:no-fx:background:hero",
            environmentId: "environment:no-fx",
            type: "background",
            role: "background",
            status: "present",
            filePath: "/tmp/no-fx-background.jpg",
          },
          {
            id: "media-asset:environment:no-fx:soundscape:room",
            environmentId: "environment:no-fx",
            type: "soundscape",
            role: "soundscape",
            status: "present",
            filePath: "/tmp/no-fx-room.mp3",
          },
        ],
        environmentCompositions: [],
      },
    },
  });
  assert.equal(noFxPayload.hasFxOverlay, false);
  assert.equal(noFxPayload.fxOverlayAsset, null);
  assert.equal(noFxPayload.fxOverlayFilePath, "");
  assert.deepEqual(noFxPayload.fxAssets, []);
  assert.deepEqual(noFxPayload.fxFilePaths, []);
  assert.deepEqual(noFxPayload.assetFilePaths.fx, []);
  const castPayload = resolvedPayloadFromRuntimeState({
    showRunId: "show-run-cast",
    resolvedPreparedNext: {
      situationId: "situation:cast",
      title: "Cast fixture",
      characters: [
        { id: "character:flex", legacyId: 10, name: "Zwangere vrouw", performerIds: [] },
        { id: "character:bobby", legacyId: 11, name: "Bobby", performerIds: ["performer:1"] },
        { id: "character:adolf", legacyId: 12, name: "Adolf", performerIds: ["performer:2"] },
      ],
    },
    showRunSnapshot: {
      catalog: {
        performers: [
          { id: "performer:1", name: "Performer 1", performerSlot: 1, active: true, archivedAt: null },
          { id: "performer:2", name: "Performer 2", performerSlot: 2, active: true, archivedAt: null },
          { id: "performer:3", name: "Performer 3", performerSlot: 3, active: true, archivedAt: null },
        ],
      },
    },
  });
  assert.deepEqual(
    castPayload.performerSlots.map((slot) => [slot.slotIndex, slot.performerId, slot.characterId]),
    [
      [1, "performer:1", "character:bobby"],
      [1, null, "character:flex"],
      [2, "performer:2", "character:adolf"],
    ],
    "Show Control fallback should reflect catalog performer choices without redistributing roles"
  );
  const castWarningPayload = resolvedPayloadFromRuntimeState({
    showRunId: "show-run-cast-warning",
    resolvedPreparedNext: {
      situationId: "situation:cast-warning",
      title: "Cast warning fixture",
      characters: [
        { id: "character:conflict-a", name: "Conflict A", performerIds: ["performer:1"] },
        { id: "character:conflict-b", name: "Conflict B", performerIds: ["performer:1"] },
      ],
    },
    showRunSnapshot: {
      catalog: {
        performers: [
          { id: "performer:1", name: "Performer 1", performerSlot: 1, active: true, archivedAt: null },
        ],
      },
    },
  });
  assert.deepEqual(
    castWarningPayload.performerSlots.map((slot) => [slot.slotIndex, slot.performerId, slot.characterId]),
    [
      [1, "performer:1", "character:conflict-a"],
      [1, "performer:1", "character:conflict-b"],
    ],
    "Show Control should keep catalog performer choices when roles share one performer"
  );
  assert(castWarningPayload.castWarnings.some((issue) => issue.code === "situation_cast_performer_conflict"));
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

  const runtimeStatusCue = buildCompoundCue({
    name: "Compact runtime adapter result",
    actions: [{ command: "runtime.status", ackMode: "fire-and-forget" }],
  });
  await executeCue(runtimeStatusCue, {
    adapters: {
      runtime: async () => ({
        stage: "applied",
        state: "ok",
        data: {
          route: "GET /v0/runtime/runs/current",
          runtimeState: oversizedRuntimeState,
        },
      }),
    },
  });
  const runtimeStatusAction = runtimeStatusCue.actions[0];
  assert(runtimeStatusAction.adapterResult.runtimeStateRef, "runtime adapter result should keep a compact reference");
  assert(!runtimeStatusAction.adapterResult.runtimeState, "runtime adapter result should not store full runtimeState");
  assert.equal(runtimeStatusAction.adapterResult.runtimeStateRef.showRunId, "show-run-assets");
  assert.equal(runtimeStatusAction.adapterResult.runtimeStateRef.resolvedPreparedNext.situationId, "situation:assets");
  assert(Buffer.byteLength(JSON.stringify(runtimeStatusAction.adapterResult)) < 10000, "stored runtime adapter result should stay compact");

  const compactedCue = compactCueForStorage({
    cueId: "cue-compact-unit",
    actions: [{
      actionId: "cue-compact-unit:action:01",
      adapterResult: {
        route: "POST /v0/runtime/runs/start",
        runtimeState: oversizedRuntimeState,
      },
    }],
  });
  assert(compactedCue.actions[0].adapterResult.runtimeStateRef, "storage compaction should keep runtimeStateRef");
  assert(!compactedCue.actions[0].adapterResult.runtimeState, "storage compaction should remove full runtimeState");
  const summarizedCue = summarizeCue({
    cueId: "cue-summary-unit",
    name: "Summary fixture",
    status: { state: "ok", warnings: [] },
    actions: [{
      command: "script-agent.operator.sceneToChat",
      targetId: "script-agent",
      payload: {
        runtimeOutput: compactRuntimeOutput,
        extraText: "x".repeat(50000),
      },
    }],
    executionLog: Array.from({ length: 40 }, (_, index) => ({ type: "row", index })),
  }, { actionLimit: 4, logLimit: 5 });
  assert.equal(summarizedCue.actionCount, 1);
  assert.equal(summarizedCue.actions[0].payload, undefined, "cue summary should not expose full action payload");
  assert.equal(summarizedCue.actions[0].payloadSummary.runtimeOutput.situationId, "situation:assets");
  assert.equal(summarizedCue.executionLog.length, 5, "cue summary should keep only recent log rows");
  assert(Buffer.byteLength(JSON.stringify(summarizedCue)) < 12000, "cue summary should stay compact");

  const previousDbDir = process.env.V2_SHOW_CONTROL_DB_DIR;
  const tempDbDir = path.join(__dirname, "..", `.tmp-unit-db-${process.pid}`);
  process.env.V2_SHOW_CONTROL_DB_DIR = tempDbDir;
  try {
    const indexedCue = buildCompoundCue({
      name: "Payload index fixture",
      actions: [{ command: "td.camera.set", payload: { camera: "2", cameraId: "camera:2", marker: "indexed-payload" } }],
    });
    await executeCue(indexedCue, { adapters: makeAdapters([]) });
    await saveCue(indexedCue);
    const indexedPayload = await readIndexedPayload(indexedCue.actions[0].payloadId);
    assert.equal(indexedPayload.marker, "indexed-payload", "saveCue should update payload-index lookup");
    const rebuilt = await rebuildPayloadIndex();
    assert(rebuilt.entries[indexedCue.actions[0].payloadId].payloadFile, "payload-index rebuild should store payload file refs");
    const rebuiltPayload = await readIndexedPayload(indexedCue.actions[0].payloadId);
    assert.equal(rebuiltPayload.marker, "indexed-payload", "payload-index rebuild should preserve payload lookup");
    const indexText = await fs.readFile(payloadIndexFilePath(), "utf8");
    assert(!indexText.includes("indexed-payload"), "payload-index file should not inline payload data");
  } finally {
    if (previousDbDir == null) delete process.env.V2_SHOW_CONTROL_DB_DIR;
    else process.env.V2_SHOW_CONTROL_DB_DIR = previousDbDir;
    await fs.rm(tempDbDir, { recursive: true, force: true });
  }

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
  const teleprompterCue = requestForTeleprompterAction({ command: "teleprompter.cue", payload: { direction: "prev", source: "unit" } });
  assert.equal(teleprompterCue.path, "/v0/script-agent/teleprompter-parser/cue/advance");
  assert.deepEqual(teleprompterCue.body, { direction: "prev", source: "unit" });
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
  assert.equal(autoGoStartSituationCue.actions[0].payload.autoGoLighting, true, "startSituation should auto-generate DMX lighting by default");
  const autoGoPhaseAction = autoGoStartSituationCue.actions.find((action) => action.command === "td.phase.set");
  assert(autoGoPhaseAction, "startSituation should set TD phase");
  assert.equal(autoGoPhaseAction.payload.phase, 2, "startSituation should set TD phase 2");
  const explicitGoStartSituationCue = buildStartSituationCue({
    showRunId: "show-run-unit",
    actions: [
      { command: "td.environment.go", ackMode: "fire-and-forget", payload: { environmentId: "env" } },
    ],
  });
  assert.equal(explicitGoStartSituationCue.actions[0].payload.autoGoEnvironment, false, "explicit TD GO should disable generated TD GO");
  assert.equal(explicitGoStartSituationCue.actions[1].command, "td.phase.set", "phase action should not disable explicit TD GO detection");
  const explicitDmxStartSituationCue = buildStartSituationCue({
    showRunId: "show-run-unit",
    actions: [
      { command: "dmx.look", ackMode: "fire-and-forget", payload: { label: "manual", channels: { 1: 80 } } },
    ],
  });
  assert.equal(explicitDmxStartSituationCue.actions[0].payload.autoGoLighting, false, "explicit DMX should disable generated DMX lighting");

  const inloopPhaseCue = buildPhaseCue({ phase: 0, phaseName: "inloop" });
  assert.equal(inloopPhaseCue.actions.length, 1);
  assert.equal(inloopPhaseCue.actions[0].command, "td.phase.set");
  assert.equal(inloopPhaseCue.actions[0].payload.phase, 0);

  const stopSituationCue = buildStopSituationCue({ showRunId: "show-run-unit" });
  assert(stopSituationCue.actions.some((action) => action.command === "runtime.stopSituation"));
  const stopPhaseAction = stopSituationCue.actions.find((action) => action.command === "td.phase.set");
  assert(stopPhaseAction, "stopSituation should set TD phase");
  assert.equal(stopPhaseAction.payload.phase, 1, "stopSituation should set TD phase 1");
  const stopDmxAction = stopSituationCue.actions.find((action) => action.command === "dmx.look");
  assert(stopDmxAction, "stopSituation should set neutral DMX look");
  assert.deepEqual(stopDmxAction.payload.channels, channelsForPreset(DEFAULT_STOP_PRESET_ID));
  assert.equal(stopDmxAction.payload.clearFirst, false);
  assert.equal(stopDmxAction.payload.continuous, true);

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
  for (const command of ["runtime.startSituation", "td.phase.set", "td.environment.go", "sq5.input.mute", "camera.zoom", "streamdeck.status"]) {
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
