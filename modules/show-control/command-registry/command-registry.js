"use strict";

const DEFAULT_TIMEOUT_MS = 1500;

function command({
  name,
  title,
  targetId,
  adapter,
  ackMode = "acknowledged-async",
  timeoutMs = DEFAULT_TIMEOUT_MS,
  transport = "http",
  description = "",
  aliases = [],
  request = null,
}) {
  return {
    name,
    title: title || name,
    targetId,
    adapter,
    ackMode,
    timeoutMs,
    transport,
    description,
    aliases,
    request,
  };
}

const DEFINITIONS = Object.freeze([
  command({
    name: "runtime.startRun",
    title: "Runtime start run",
    targetId: "runtime",
    adapter: "runtime",
    request: { method: "POST", path: "/v0/runtime/runs/start" },
    description: "Starts a V2 Runtime run. May generate a prepareFromRuntimeState action when autoPrepareNext is true.",
  }),
  command({
    name: "runtime.resetRun",
    title: "Runtime reset run",
    targetId: "runtime",
    adapter: "runtime",
    request: { method: "POST", path: "/v0/runtime/runs/:showRunId/reset" },
    description: "Resets Runtime's active show run back to idle.",
    aliases: ["runtime.stopRun", "runtime.reset"],
  }),
  command({
    name: "runtime.prepareNext",
    title: "Runtime prepare next",
    targetId: "runtime",
    adapter: "runtime",
    request: { method: "GET", path: "/v0/runtime/runs/current" },
    description: "Reads Runtime's resolvedPreparedNext and lets Show Control prepare it without choosing a situation.",
    aliases: ["runtime.prepareFromRuntimeState"],
  }),
  command({
    name: "runtime.startSituation",
    title: "Runtime start situation",
    targetId: "runtime",
    adapter: "runtime",
    request: { method: "POST", path: "/v0/runtime/runs/:showRunId/start-situation" },
    description: "Starts Runtime's prepared situation. Runtime remains owner of activeSituation state.",
  }),
  command({
    name: "runtime.stopSituation",
    title: "Runtime stop situation",
    targetId: "runtime",
    adapter: "runtime",
    request: { method: "POST", path: "/v0/runtime/runs/:showRunId/stop-situation" },
    description: "Stops Runtime's active situation.",
  }),
  command({
    name: "runtime.status",
    title: "Runtime status",
    targetId: "runtime",
    adapter: "runtime",
    ackMode: "fire-and-forget",
    request: { method: "GET", path: "/v0/runtime/runs/current" },
  }),

  command({
    name: "td.environment.prepare",
    title: "TD environment prepare",
    targetId: "touchdesigner",
    adapter: "touchdesigner",
    ackMode: "required-ready",
    timeoutMs: 2200,
    transport: "osc-control-port",
    description: "Sends /td/cue cueId td.environment.prepare payloadId to the single TD OSC control port.",
    aliases: ["touchdesigner.prepare", "touchdesigner.environment.prepare"],
  }),
  command({
    name: "td.environment.go",
    title: "TD environment go",
    targetId: "touchdesigner",
    adapter: "touchdesigner",
    ackMode: "fire-and-forget",
    timeoutMs: 900,
    transport: "osc-control-port",
    aliases: ["touchdesigner.go", "touchdesigner.environment.go"],
  }),
  command({
    name: "td.status.heartbeat",
    title: "TD status heartbeat",
    targetId: "touchdesigner",
    adapter: "touchdesigner",
    ackMode: "acknowledged-async",
    transport: "osc-control-port",
    aliases: ["touchdesigner.status"],
  }),
  command({
    name: "td.caption.update",
    title: "TD caption update",
    targetId: "touchdesigner",
    adapter: "touchdesigner",
    transport: "osc-control-port",
    aliases: ["touchdesigner.caption"],
  }),
  command({
    name: "td.caption.clear",
    title: "TD caption clear",
    targetId: "touchdesigner",
    adapter: "touchdesigner",
    ackMode: "fire-and-forget",
    transport: "osc-control-port",
  }),
  command({
    name: "td.camera.set",
    title: "TD camera switch",
    targetId: "touchdesigner",
    adapter: "touchdesigner",
    transport: "osc-control-port",
    aliases: ["touchdesigner.cameraSwitch", "td.camera.switch"],
  }),
  command({
    name: "td.phase.set",
    title: "TD phase set",
    targetId: "touchdesigner",
    adapter: "touchdesigner",
    transport: "osc-control-port",
  }),
  command({
    name: "td.asset.prepare",
    title: "TD asset prepare",
    targetId: "touchdesigner",
    adapter: "touchdesigner",
    ackMode: "required-ready",
    timeoutMs: 2200,
    transport: "osc-control-port",
  }),
  command({
    name: "td.audio.prepare",
    title: "TD audio prepare",
    targetId: "touchdesigner",
    adapter: "touchdesigner",
    ackMode: "required-ready",
    timeoutMs: 2200,
    transport: "osc-control-port",
  }),
  command({
    name: "td.audio.go",
    title: "TD audio go",
    targetId: "touchdesigner",
    adapter: "touchdesigner",
    ackMode: "fire-and-forget",
    transport: "osc-control-port",
  }),
  command({
    name: "td.fx.trigger",
    title: "TD FX trigger",
    targetId: "touchdesigner",
    adapter: "touchdesigner",
    ackMode: "fire-and-forget",
    transport: "osc-control-port",
  }),
  command({
    name: "td.webstage.prepare",
    title: "TD webstage prepare",
    targetId: "touchdesigner",
    adapter: "touchdesigner",
    ackMode: "required-ready",
    timeoutMs: 2200,
    transport: "osc-control-port",
  }),
  command({
    name: "td.webstage.show",
    title: "TD webstage show",
    targetId: "touchdesigner",
    adapter: "touchdesigner",
    transport: "osc-control-port",
  }),
  command({
    name: "td.webstage.hide",
    title: "TD webstage hide",
    targetId: "touchdesigner",
    adapter: "touchdesigner",
    transport: "osc-control-port",
  }),
  command({
    name: "td.reset",
    title: "TD reset",
    targetId: "touchdesigner",
    adapter: "touchdesigner",
    transport: "osc-control-port",
  }),
  command({
    name: "td.blackout",
    title: "TD blackout",
    targetId: "touchdesigner",
    adapter: "touchdesigner",
    transport: "osc-control-port",
  }),

  command({
    name: "sq5.input.mute",
    title: "SQ5 input mute",
    targetId: "sq5",
    adapter: "sq5",
    request: { method: "POST", path: "/api/input/:channel/mute" },
    aliases: ["sq5.mic.mute"],
  }),
  command({
    name: "sq5.input.level",
    title: "SQ5 input level",
    targetId: "sq5",
    adapter: "sq5",
    request: { method: "POST", path: "/api/input/:channel/level" },
  }),
  command({
    name: "sq5.input.level01",
    title: "SQ5 input level 0..1",
    targetId: "sq5",
    adapter: "sq5",
    request: { method: "POST", path: "/api/input/:channel/level01" },
  }),
  command({
    name: "sq5.input.pan",
    title: "SQ5 input pan",
    targetId: "sq5",
    adapter: "sq5",
    request: { method: "POST", path: "/api/input/:channel/pan" },
  }),
  command({
    name: "sq5.input.assign",
    title: "SQ5 input assign",
    targetId: "sq5",
    adapter: "sq5",
    request: { method: "POST", path: "/api/input/:channel/assign" },
  }),
  command({
    name: "sq5.input.get",
    title: "SQ5 input get",
    targetId: "sq5",
    adapter: "sq5",
    request: { method: "POST", path: "/api/input/:channel/get" },
  }),
  command({
    name: "sq5.input.nudge",
    title: "SQ5 input nudge",
    targetId: "sq5",
    adapter: "sq5",
    request: { method: "POST", path: "/api/input/:channel/nudge" },
  }),
  command({
    name: "sq5.output.mute",
    title: "SQ5 output mute",
    targetId: "sq5",
    adapter: "sq5",
    request: { method: "POST", path: "/api/output/:output/mute" },
    aliases: ["sq5.mics.mute"],
  }),
  command({
    name: "sq5.output.level",
    title: "SQ5 output level",
    targetId: "sq5",
    adapter: "sq5",
    request: { method: "POST", path: "/api/output/:output/level" },
  }),
  command({
    name: "sq5.output.get",
    title: "SQ5 output get",
    targetId: "sq5",
    adapter: "sq5",
    request: { method: "POST", path: "/api/output/:output/get" },
  }),
  command({
    name: "sq5.scene.recall",
    title: "SQ5 scene recall",
    targetId: "sq5",
    adapter: "sq5",
    request: { method: "POST", path: "/api/scene" },
  }),
  command({
    name: "sq5.softkey",
    title: "SQ5 softkey",
    targetId: "sq5",
    adapter: "sq5",
    request: { method: "POST", path: "/api/softkey" },
  }),
  command({
    name: "sq5.status",
    title: "SQ5 status",
    targetId: "sq5",
    adapter: "sq5",
    ackMode: "fire-and-forget",
    request: { method: "GET", path: "/api/status" },
  }),

  command({
    name: "dmx.look",
    title: "DMX look",
    targetId: "dmx",
    adapter: "dmx",
    timeoutMs: 1800,
    transport: "v2-http-sidecar",
    request: { method: "POST", path: "/api/look" },
    description: "Stuurt een Art-Net DMX look via de DMX hardware sidecar.",
    aliases: ["lights.look", "lighting.look"],
  }),
  command({
    name: "dmx.preset",
    title: "DMX preset",
    targetId: "dmx",
    adapter: "dmx",
    timeoutMs: 1800,
    transport: "v2-http-sidecar",
    request: { method: "POST", path: "/api/preset" },
    description: "Stuurt een voorbereide lichtpreset zoals auto, bioscoop, podcast of nacht.",
    aliases: ["lights.preset", "lighting.preset"],
  }),
  command({
    name: "dmx.blackout",
    title: "DMX blackout",
    targetId: "dmx",
    adapter: "dmx",
    timeoutMs: 1800,
    transport: "v2-http-sidecar",
    request: { method: "POST", path: "/api/blackout" },
    aliases: ["lights.blackout", "lighting.blackout"],
  }),
  command({
    name: "dmx.stop",
    title: "DMX stop live",
    targetId: "dmx",
    adapter: "dmx",
    ackMode: "fire-and-forget",
    transport: "v2-http-sidecar",
    request: { method: "POST", path: "/api/stop" },
  }),
  command({
    name: "dmx.status",
    title: "DMX status",
    targetId: "dmx",
    adapter: "dmx",
    ackMode: "fire-and-forget",
    transport: "v2-http-sidecar",
    request: { method: "GET", path: "/api/state" },
  }),

  command({
    name: "camera.focus",
    title: "Camera focus",
    targetId: "camera",
    adapter: "camera",
    request: { method: "POST", path: "/api/camera/:camera/focus" },
  }),
  command({
    name: "camera.iris",
    title: "Camera iris",
    targetId: "camera",
    adapter: "camera",
    request: { method: "POST", path: "/api/camera/:camera/iris" },
  }),
  command({
    name: "camera.zoom",
    title: "Camera zoom",
    targetId: "camera",
    adapter: "camera",
    request: { method: "POST", path: "/api/camera/:camera/zoom" },
  }),
  command({
    name: "camera.control",
    title: "Camera generic control",
    targetId: "camera",
    adapter: "camera",
    request: { method: "POST", path: "/api/camera/:camera/control" },
  }),
  command({
    name: "camera.contrast",
    title: "Camera contrast",
    targetId: "camera",
    adapter: "camera",
    request: { method: "POST", path: "/api/camera/:camera/contrast" },
  }),
  command({
    name: "camera.color",
    title: "Camera color",
    targetId: "camera",
    adapter: "camera",
    request: { method: "POST", path: "/api/camera/:camera/color/:control" },
  }),
  command({
    name: "camera.tally",
    title: "Camera tally",
    targetId: "camera",
    adapter: "camera",
    request: { method: "POST", path: "/api/tally" },
  }),
  command({
    name: "camera.status",
    title: "Camera status",
    targetId: "camera",
    adapter: "camera",
    ackMode: "fire-and-forget",
    request: { method: "GET", path: "/api/state" },
  }),

  command({
    name: "streamdeck.button",
    title: "Stream Deck button",
    targetId: "streamdeck",
    adapter: "streamdeck",
    ackMode: "fire-and-forget",
    transport: "v2-http-sidecar",
  }),
  command({
    name: "streamdeck.status",
    title: "Stream Deck status",
    targetId: "streamdeck",
    adapter: "streamdeck",
    ackMode: "fire-and-forget",
    transport: "v2-http-sidecar",
  }),
  command({
    name: "perfectCue.trigger",
    title: "Perfect Cue trigger",
    targetId: "perfectcue",
    adapter: "perfectcue",
    ackMode: "fire-and-forget",
    transport: "v2-http-sidecar",
  }),
  command({
    name: "keyboard.trigger",
    title: "Keyboard trigger",
    targetId: "keyboard",
    adapter: "keyboard",
    ackMode: "fire-and-forget",
    transport: "v2-http-sidecar",
  }),
  command({
    name: "teleprompter.prepare",
    title: "Teleprompter prepare",
    targetId: "teleprompter",
    adapter: "teleprompter",
    transport: "v2-http-script-agent",
    request: { method: "POST", path: "/v0/script-agent/teleprompter-parser/prepare" },
  }),
  command({
    name: "teleprompter.ready",
    title: "Teleprompter ready",
    targetId: "teleprompter",
    adapter: "teleprompter",
    transport: "v2-http-script-agent",
    request: { method: "POST", path: "/v0/script-agent/teleprompter-parser/ready" },
  }),
  command({
    name: "teleprompter.reveal",
    title: "Teleprompter reveal",
    targetId: "teleprompter",
    adapter: "teleprompter",
    transport: "v2-http-script-agent",
    request: { method: "POST", path: "/v0/script-agent/teleprompter-parser/reveal" },
  }),
  command({
    name: "script-agent.operator.prepareDraft",
    title: "Script Agent prepare operator draft",
    targetId: "script-agent",
    adapter: "scriptagent",
    ackMode: "fire-and-forget",
    timeoutMs: 1500,
    transport: "v2-http-script-agent",
    request: { method: "POST", path: "/v0/script-agent/operator/draft/from-runtime" },
    description: "Zet Runtime prepared next klaar in de Script Agent Operator zonder chat te starten.",
    aliases: ["operator.prepareDraft", "scriptAgent.prepareDraft", "script-agent.prepareDraft"],
  }),
  command({
    name: "script-agent.operator.sceneToChat",
    title: "Script Agent scene to chat",
    targetId: "script-agent",
    adapter: "scriptagent",
    ackMode: "acknowledged-async",
    timeoutMs: 90000,
    transport: "v2-http-script-agent",
    request: { method: "POST", path: "/v0/script-agent/operator/scene-to-chat" },
    description: "Stuurt de huidige Runtime prepared scene naar de Script Agent Operator chat zonder teleprompter prepare te doen.",
    aliases: ["operator.sceneToChat", "scriptAgent.sceneToChat", "script-agent.sceneToChat"],
  }),
  command({
    name: "debug.noop",
    title: "Debug no-op",
    targetId: "debug",
    adapter: "debug",
    ackMode: "fire-and-forget",
    transport: "mock-contract",
  }),
]);

const COMMAND_BY_NAME = new Map();
const ALIAS_BY_NAME = new Map();

for (const definition of DEFINITIONS) {
  COMMAND_BY_NAME.set(definition.name, definition);
  for (const alias of definition.aliases || []) {
    ALIAS_BY_NAME.set(alias, definition.name);
  }
}

function normalizeAckMode(value, fallback = "acknowledged-async") {
  const raw = String(value || fallback).trim().toLowerCase();
  if (raw === "acknowledged") return "acknowledged-async";
  if (raw === "non-blocking" || raw === "nonblocking") return "fire-and-forget";
  if (raw === "async") return "acknowledged-async";
  if (raw === "fire-and-forget" || raw === "acknowledged-async" || raw === "required-ready") return raw;
  throw new Error(`show_control_unknown_ack_mode:${value}`);
}

function resolveCommand(name) {
  const requestedName = String(name || "").trim();
  const canonicalName = ALIAS_BY_NAME.get(requestedName) || requestedName;
  const definition = COMMAND_BY_NAME.get(canonicalName);
  if (!definition) {
    throw new Error(`show_control_unknown_command:${requestedName || "missing"}`);
  }
  return {
    ...definition,
    requestedName,
    canonicalName,
    ackMode: normalizeAckMode(definition.ackMode),
  };
}

function listCommands() {
  return DEFINITIONS.map((definition) => ({
    name: definition.name,
    title: definition.title,
    targetId: definition.targetId,
    adapter: definition.adapter,
    ackMode: normalizeAckMode(definition.ackMode),
    timeoutMs: definition.timeoutMs,
    transport: definition.transport,
    request: definition.request,
    aliases: definition.aliases || [],
    description: definition.description || "",
  }));
}

module.exports = {
  DEFAULT_TIMEOUT_MS,
  listCommands,
  normalizeAckMode,
  resolveCommand,
};
