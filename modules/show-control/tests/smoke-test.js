"use strict";

const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const crypto = require("node:crypto");
const fs = require("node:fs/promises");
const http = require("node:http");
const net = require("node:net");
const path = require("node:path");
const { createOscServer, sendOsc } = require("../target-adapters/osc-lite");

const TEST_DIR = __dirname;
const APP_ROOT = path.resolve(TEST_DIR, "../../..");
const V2_ROOT = path.resolve(TEST_DIR, "../../..");
const PORTS = {
  runtime: 19324,
  showControl: 19325,
  sq5: 19305,
  camera: 19310,
  dmx: 19329,
  cameraHardware: 19311,
  cameraOsc: 19312,
  streamdeck: 19327,
  perfectCue: 19328,
  scriptAgent: 19337,
  tdOsc: 19300,
  tdAck: 19301,
};
const PROTECTED_FILES = [
  path.join(APP_ROOT, "legacy", "server.js"),
  path.join(APP_ROOT, "legacy", "public", "algoritme.html"),
  path.join(APP_ROOT, "legacy", "sq5-control", "server.js"),
  path.join(APP_ROOT, "legacy", "camera-control", "server.js"),
  path.join(APP_ROOT, "legacy", "data", "live.sqlite"),
  path.join(APP_ROOT, "legacy", "data", "live.sqlite-wal"),
  path.join(APP_ROOT, "legacy", "data", "live.sqlite-shm"),
];

async function sha256(filePath) {
  const data = await fs.readFile(filePath);
  return crypto.createHash("sha256").update(data).digest("hex");
}

async function protectedHashes() {
  const entries = [];
  for (const filePath of PROTECTED_FILES) entries.push([filePath, await sha256(filePath)]);
  return Object.fromEntries(entries);
}

function assertHashesEqual(before, after) {
  for (const filePath of PROTECTED_FILES) {
    assert.equal(after[filePath], before[filePath], `${filePath} changed`);
  }
}

async function assertPortFree(port) {
  await new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.once("listening", () => server.close(resolve));
    server.listen(port, "127.0.0.1");
  });
}

async function readJson(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString("utf8").trim();
  return raw ? JSON.parse(raw) : {};
}

function sendJson(res, status, body) {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-cache" });
  res.end(JSON.stringify(body));
}

function startHttpServer(port, handler) {
  const server = http.createServer((req, res) => {
    handler(req, res).catch((err) => sendJson(res, 500, { ok: false, error: err.message || String(err) }));
  });
  return new Promise((resolve) => {
    server.listen(port, "127.0.0.1", () => resolve(server));
  });
}

async function fetchJson(baseUrl, pathname, options = {}) {
  const response = await fetch(`${baseUrl}${pathname}`, options);
  const text = await response.text();
  let body = {};
  try {
    body = text ? JSON.parse(text) : {};
  } catch (_err) {
    body = { raw: text };
  }
  if (!response.ok) throw new Error(`${pathname} returned ${response.status}: ${JSON.stringify(body)}`);
  return body;
}

function startFakeRuntime(port, calls) {
  let state = {
    schemaVersion: "runtime.state.v0",
    showRunId: null,
    status: "idle",
    updatedAt: new Date().toISOString(),
    preparedNext: null,
    resolvedPreparedNext: null,
    activeSituation: null,
    runLog: [],
  };

  function setPreparedNext(reason = "fake_runtime") {
    state.preparedNext = {
      situationId: "situation:fake-next",
      legacySituationId: 42,
      title: "Fake prepared next",
      chosenAt: new Date().toISOString(),
      reason,
    };
    state.resolvedPreparedNext = {
      situationId: "situation:fake-next",
      legacySituationId: 42,
      title: "Fake prepared next",
      environment: { id: "environment:fake", legacyId: 7, name: "Fake Studio" },
      characterIds: ["character:fake"],
      characters: [{ id: "character:fake", legacyId: 5, name: "Fake Performer", performerIds: ["performer:fake"] }],
      labelIds: ["label:fake"],
      assets: {
        background: { assetId: "asset:bg", file: "/tmp/fake-background.jpg" },
      },
    };
  }

  return startHttpServer(port, async (req, res) => {
    const url = new URL(req.url, `http://${req.headers.host}`);
    calls.push({ service: "runtime", method: req.method, path: url.pathname, at: Date.now() });
    if (req.method === "POST" && url.pathname === "/v0/runtime/runs/start") {
      state = {
        ...state,
        showRunId: "show-run-fake-001",
        status: "running",
        updatedAt: new Date().toISOString(),
        runLog: [{ type: "run_started", at: new Date().toISOString() }],
      };
      setPreparedNext("run_started");
      sendJson(res, 201, state);
      return;
    }
    if (req.method === "GET" && url.pathname === "/v0/runtime/runs/current") {
      sendJson(res, 200, state);
      return;
    }
    const startMatch = url.pathname.match(/^\/v0\/runtime\/runs\/([^/]+)\/start-situation$/);
    if (req.method === "POST" && startMatch) {
      state.activeSituation = {
        situationRunId: `${startMatch[1]}:situation-run:0001`,
        situationId: state.preparedNext.situationId,
        title: state.preparedNext.title,
        status: "active",
        resolved: state.resolvedPreparedNext,
      };
      state.updatedAt = new Date().toISOString();
      state.runLog.push({ type: "situation_started", at: state.updatedAt, situationId: state.activeSituation.situationId });
      sendJson(res, 200, state);
      return;
    }
    const stopMatch = url.pathname.match(/^\/v0\/runtime\/runs\/([^/]+)\/stop-situation$/);
    if (req.method === "POST" && stopMatch) {
      state.activeSituation = null;
      state.updatedAt = new Date().toISOString();
      state.runLog.push({ type: "situation_stopped", at: state.updatedAt });
      sendJson(res, 200, state);
      return;
    }
    const resetMatch = url.pathname.match(/^\/v0\/runtime\/runs\/([^/]+)\/reset$/);
    if (req.method === "POST" && resetMatch) {
      state = {
        showRunId: null,
        status: "idle",
        preparedNext: null,
        resolvedPreparedNext: null,
        activeSituation: null,
        runLog: [{ type: "run_reset", at: new Date().toISOString(), showRunId: resetMatch[1] }],
      };
      sendJson(res, 200, state);
      return;
    }
    sendJson(res, 404, { ok: false, error: "not_found" });
  });
}

function startFakeScriptAgent(port, calls) {
  const state = {
    preparedScene: null,
    operatorDraft: null,
    ready: false,
    revealed: false,
  };
  return startHttpServer(port, async (req, res) => {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const body = req.method === "POST" ? await readJson(req) : {};
    calls.push({ service: "script-agent", method: req.method, path: url.pathname, body, at: Date.now() });
    if (req.method === "GET" && url.pathname === "/health") {
      sendJson(res, 200, { ok: true, service: "script-agent", version: "v0", port });
      return;
    }
    if (req.method === "POST" && url.pathname === "/v0/script-agent/teleprompter-parser/prepare") {
      state.preparedScene = body;
      state.ready = false;
      state.revealed = false;
      sendJson(res, 200, { ok: true, preparedScene: body, cue: { index: 0 } });
      return;
    }
    if (req.method === "POST" && url.pathname === "/v0/script-agent/operator/draft/from-runtime") {
      state.operatorDraft = body;
      const runtimeOutput = body.runtimeOutput || body.runtimeState || {};
      sendJson(res, 201, {
        ok: true,
        draft: {
          showRunId: runtimeOutput.showRunId || "show-run-fake-001",
          situationId: runtimeOutput.resolvedPreparedNext && runtimeOutput.resolvedPreparedNext.situationId || "situation:fake",
        },
      });
      return;
    }
    if (req.method === "POST" && url.pathname === "/v0/script-agent/teleprompter-parser/ready") {
      state.ready = body.ready !== false;
      sendJson(res, 200, { ok: true, preparedScene: state.preparedScene, ready: state.ready });
      return;
    }
    if (req.method === "POST" && url.pathname === "/v0/script-agent/teleprompter-parser/reveal") {
      state.revealed = true;
      sendJson(res, 200, { ok: true, preparedScene: state.preparedScene, revealed: true, cue: { index: 0 } });
      return;
    }
    if (req.method === "POST" && url.pathname === "/v0/script-agent/operator/scene-to-chat") {
      const runtimeOutput = body.runtimeOutput || body.runtimeState || {};
      sendJson(res, 201, {
        ok: true,
        sessionId: body.sessionId || body.showRunId || "show-run-fake-001",
        draft: {
          showRunId: runtimeOutput.showRunId || "show-run-fake-001",
          situationId: runtimeOutput.resolvedPreparedNext && runtimeOutput.resolvedPreparedNext.situationId || "situation:fake",
        },
        done: { type: "done", text: "Fake scene text" },
      });
      return;
    }
    sendJson(res, 404, { ok: false, error: "not_found" });
  });
}

function startFakeCameraHardware(port, calls) {
  return startHttpServer(port, async (req, res) => {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const body = req.method === "PUT" || req.method === "POST" ? await readJson(req) : {};
    calls.push({ service: "camera-hardware", method: req.method, path: url.pathname, body, at: Date.now() });
    if (url.pathname.startsWith("/control/api/v1/")) {
      sendJson(res, 200, {
        ok: true,
        method: req.method,
        path: url.pathname,
        body,
        value: body.normalised ?? body.value ?? 0.5,
      });
      return;
    }
    sendJson(res, 404, { ok: false, error: "not_found" });
  });
}

async function waitForHttp(baseUrl, pathname, timeoutMs = 5000) {
  const startedAt = Date.now();
  let lastError = null;
  while (Date.now() - startedAt < timeoutMs) {
    try {
      return await fetchJson(baseUrl, pathname);
    } catch (err) {
      lastError = err;
      await new Promise((resolve) => setTimeout(resolve, 75));
    }
  }
  throw lastError || new Error(`Timed out waiting for ${baseUrl}${pathname}`);
}

async function waitForCondition(check, timeoutMs = 1500) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (check()) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  assert(check(), "condition did not become true before timeout");
}

function startCameraSidecarProcess() {
  const script = path.join(V2_ROOT, "modules", "show-control", "hardware", "camera-control", "server.js");
  const cameraHardwareHost = `127.0.0.1:${PORTS.cameraHardware}`;
  const child = spawn(process.execPath, [script], {
    env: {
      ...process.env,
      V2_SHOW_CONTROL_CAMERA_HOST: "127.0.0.1",
      V2_SHOW_CONTROL_CAMERA_PORT: String(PORTS.camera),
      V2_SHOW_CONTROL_CAMERA_OSC_LISTEN_ADDRESS: "127.0.0.1",
      V2_SHOW_CONTROL_CAMERA_OSC_PORT: String(PORTS.cameraOsc),
      V2_SHOW_CONTROL_CAMERA_CAM1_HOST: cameraHardwareHost,
      V2_SHOW_CONTROL_CAMERA_CAM2_HOST: cameraHardwareHost,
      V2_SHOW_CONTROL_CAMERA_CAM3_HOST: cameraHardwareHost,
      V2_SHOW_CONTROL_CAMERA_POLL_MS: "60000",
      V2_SHOW_CONTROL_CAMERA_WS_RECONNECT_BASE_MS: "60000",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.output = [];
  child.stdout.on("data", (chunk) => child.output.push(String(chunk)));
  child.stderr.on("data", (chunk) => child.output.push(String(chunk)));
  return child;
}

async function stopChild(child) {
  if (!child || child.exitCode !== null || child.signalCode) return;
  await new Promise((resolve) => {
    const timeout = setTimeout(() => {
      try { child.kill("SIGKILL"); } catch {}
      resolve();
    }, 1500);
    child.once("exit", () => {
      clearTimeout(timeout);
      resolve();
    });
    child.kill("SIGTERM");
  });
}

function startFakeTouchDesigner({ oscPort, ackPort, showControlBaseUrl, calls }) {
  return new Promise((resolve) => {
    const server = createOscServer({
      host: "127.0.0.1",
      port: oscPort,
      onMessage: (message) => {
        if (message.error) {
          calls.push({ service: "touchdesigner", error: message.error.message || String(message.error), at: Date.now() });
          return;
        }
        const args = Array.isArray(message.args) ? message.args : [];
        const cueId = String(args[0] || "");
        const command = String(args[1] || "");
        const payloadId = String(args[2] || "");
        const call = { service: "touchdesigner", address: message.address, cueId, command, payloadId, at: Date.now() };
        calls.push(call);
        const payloadPath = `/api/show-control/payloads/${encodeURIComponent(payloadId)}`;
        fetchJson(showControlBaseUrl, payloadPath)
          .then((payload) => {
            call.payloadFetched = true;
            call.payload = payload;
          })
          .catch((err) => {
            call.payloadFetched = false;
            call.payloadError = err.message;
          })
          .finally(() => {
            const stage = command.includes("prepare") ? "loaded" : "applied";
            sendOsc({
              host: "127.0.0.1",
              port: ackPort,
              address: "/td/ack",
              args: [cueId, command, stage, "ok", "fake_td_ack"],
            }).catch((err) => {
              call.ackError = err.message || String(err);
            });
          });
      },
    });
    setTimeout(() => resolve({
      close() {
        server.close();
      },
    }), 25);
  });
}

async function listenExpress(app, port) {
  return new Promise((resolve) => {
    const server = app.listen(port, "127.0.0.1", () => resolve(server));
  });
}

async function closeServer(server) {
  if (!server) return;
  await new Promise((resolve) => server.close(resolve));
}

async function main() {
  for (const port of Object.values(PORTS)) await assertPortFree(port);
  const beforeHashes = await protectedHashes();
  const dbDir = path.join(V2_ROOT, "modules", "show-control", `.tmp-smoke-db-${process.pid}`);
  process.env.V2_SHOW_CONTROL_DB_DIR = dbDir;
  process.env.V2_SHOW_CONTROL_ADAPTER_MODE = "test";
  process.env.V2_SHOW_CONTROL_RUNTIME_URL = `http://127.0.0.1:${PORTS.runtime}`;
  process.env.V2_SHOW_CONTROL_SQ5_URL = `http://127.0.0.1:${PORTS.sq5}`;
  process.env.V2_SHOW_CONTROL_CAMERA_URL = `http://127.0.0.1:${PORTS.camera}`;
  process.env.V2_SHOW_CONTROL_DMX_URL = `http://127.0.0.1:${PORTS.dmx}`;
  process.env.V2_SHOW_CONTROL_STREAMDECK_URL = `http://127.0.0.1:${PORTS.streamdeck}`;
  process.env.V2_SHOW_CONTROL_PERFECT_CUE_URL = `http://127.0.0.1:${PORTS.perfectCue}`;
  process.env.V2_SHOW_CONTROL_SCRIPT_AGENT_URL = `http://127.0.0.1:${PORTS.scriptAgent}`;
  process.env.V2_SHOW_CONTROL_TD_OSC_HOST = "127.0.0.1";
  process.env.V2_SHOW_CONTROL_TD_OSC_PORT = String(PORTS.tdOsc);
  process.env.V2_SHOW_CONTROL_TD_ACK_PORT = String(PORTS.tdAck);

  const calls = [];
  const servers = [];
  let cameraSidecar = null;
  let fakeTd = null;
  let showServer = null;
  let tdAckServer = null;

  try {
    const { createServer: createSq5Server } = require("../hardware/sq5-control/server");
    const { createDmxApp } = require("../hardware/dmx-control/server");
    const { createStreamDeckApp } = require("../hardware/streamdeck-control/server");
    const { createPerfectCueApp } = require("../hardware/perfect-cue-control/server");

    servers.push(await startFakeRuntime(PORTS.runtime, calls));
    servers.push(await startFakeScriptAgent(PORTS.scriptAgent, calls));
    servers.push(await listenExpress(createSq5Server(), PORTS.sq5));
    servers.push(await listenExpress(createDmxApp({ targetIp: "127.0.0.1", universe: 1 }), PORTS.dmx));
    servers.push(await startFakeCameraHardware(PORTS.cameraHardware, calls));
    cameraSidecar = startCameraSidecarProcess();
    await waitForHttp(`http://127.0.0.1:${PORTS.camera}`, "/api/state");
    servers.push(await listenExpress(createStreamDeckApp({ showControlUrl: `http://127.0.0.1:${PORTS.showControl}` }), PORTS.streamdeck));
    servers.push(await listenExpress(createPerfectCueApp({ showControlUrl: `http://127.0.0.1:${PORTS.showControl}` }), PORTS.perfectCue));
    fakeTd = await startFakeTouchDesigner({
      oscPort: PORTS.tdOsc,
      ackPort: PORTS.tdAck,
      showControlBaseUrl: `http://127.0.0.1:${PORTS.showControl}`,
      calls,
    });

    const { createShowControlApp } = require("../server/app");
    const { startTdAckServer } = require("../server/td-ack-server");
    const app = createShowControlApp({
      adapterOptions: {
        runtimeBaseUrl: `http://127.0.0.1:${PORTS.runtime}`,
        sq5BaseUrl: `http://127.0.0.1:${PORTS.sq5}`,
        cameraBaseUrl: `http://127.0.0.1:${PORTS.camera}`,
        dmxBaseUrl: `http://127.0.0.1:${PORTS.dmx}`,
        streamDeckBaseUrl: `http://127.0.0.1:${PORTS.streamdeck}`,
        perfectCueBaseUrl: `http://127.0.0.1:${PORTS.perfectCue}`,
        scriptAgentBaseUrl: `http://127.0.0.1:${PORTS.scriptAgent}`,
        tdOscHost: "127.0.0.1",
        tdOscPort: PORTS.tdOsc,
        tdAckPort: PORTS.tdAck,
      },
    });
    tdAckServer = startTdAckServer({ tdAckPort: PORTS.tdAck });
    showServer = await listenExpress(app, PORTS.showControl);
    const showBase = `http://127.0.0.1:${PORTS.showControl}`;

    const health = await fetchJson(showBase, "/health");
    assert.equal(health.service, "show-control");
    assert.equal(health.adapterMode, "test");
    const html = await (await fetch(`${showBase}/show-control/`)).text();
    assert(html.includes("Cue Builder"), "Show Control UI should expose Cue Builder tab");
    assert(html.includes("Actieve cue-definities"), "Show Control UI should expose active cue definitions");
    assert(html.includes("DMX / Art-Net"), "Show Control UI should expose DMX tab");
    const uiJs = await (await fetch(`${showBase}/show-control/app.js`)).text();
    assert(html.includes("Trigger Bindings"), "Show Control UI should expose trigger bindings");
    assert(uiJs.includes("/v0/show-control/cues"), "UI should create cues through Show Control API");
    assert(uiJs.includes("/v0/show-control/active-cues"), "UI should load active cue definitions");
    assert(uiJs.includes("/v0/show-control/status"), "UI should show status and warnings");
    assert(uiJs.includes("/v0/show-control/cues/dry-run"), "UI should support dry run without firing hardware");
    assert(uiJs.includes("/v0/show-control/trigger-bindings"), "UI should manage trigger bindings");

    const commandList = await fetchJson(showBase, "/v0/show-control/commands");
    assert(commandList.commands.some((command) => command.name === "runtime.resetRun"));
    assert(commandList.commands.some((command) => command.name === "runtime.stopSituation"));
    assert(commandList.commands.some((command) => command.name === "sq5.input.mute"));
    assert(commandList.commands.some((command) => command.name === "dmx.look"));
    assert(commandList.commands.some((command) => command.name === "dmx.preset"));
    assert(commandList.commands.some((command) => command.name === "dmx.blackout"));
    assert(commandList.commands.some((command) => command.name === "camera.focus"));
    assert(commandList.commands.some((command) => command.name === "td.camera.set"));

    const activeCueDefinitions = await fetchJson(showBase, "/v0/show-control/active-cues");
    assert.equal(activeCueDefinitions.count, 12);
    assert(activeCueDefinitions.cues.some((cue) => cue.id === "streamdeck-run-toggle"));
    assert(activeCueDefinitions.cues.some((cue) => cue.id === "streamdeck-situation-toggle"));
    assert(activeCueDefinitions.cues.some((cue) => cue.id === "streamdeck-teleprompter-ready"));
    assert(activeCueDefinitions.cues.some((cue) => cue.id === "td-camera-1"));
    assert(activeCueDefinitions.cues.some((cue) => cue.id === "td-camera-2"));
    assert(activeCueDefinitions.cues.some((cue) => cue.id === "td-camera-3"));
    assert(activeCueDefinitions.cues.every((cue) => (
      cue.states || []
    ).every((state) => state.commandsAvailable === true)), "all active cue commands should exist in the registry");

    const dryRun = await fetchJson(showBase, "/v0/show-control/cues/dry-run", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: "Dry camera cue",
        actions: [
          { command: "td.camera.set", ackMode: "fire-and-forget", payload: { camera: "2", cameraId: "camera:2" } },
        ],
      }),
    });
    assert.equal(dryRun.cue.status.stage, "dry-run");
    assert.equal(dryRun.cue.actions[0].command, "td.camera.set");

    const savedCameraCue = await fetchJson(showBase, "/v0/show-control/cues/save", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: "Stream Deck camera 2",
        actions: [
          { command: "td.camera.set", ackMode: "fire-and-forget", timeoutMs: 250, payload: { camera: "2", cameraId: "camera:2" } },
          { command: "streamdeck.status", ackMode: "fire-and-forget", timeoutMs: 300, payload: { button: "cam-2", state: "active", label: "CAM 2" } },
        ],
      }),
    });
    assert.equal(savedCameraCue.cue.status.state, "saved");
    const indexedPayload = await fetchJson(showBase, `/api/show-control/payloads/${encodeURIComponent(savedCameraCue.cue.actions[0].payloadId)}`);
    assert.equal(indexedPayload.camera, "2", "payload endpoint should find saved cue payload via persistent index");
    const cameraBinding = await fetchJson(showBase, "/v0/show-control/trigger-bindings", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        source: "streamdeck",
        triggerId: "cam-2",
        page: "camera",
        label: "CAM 2",
        cueId: savedCameraCue.cue.cueId,
      }),
    });
    assert.equal(cameraBinding.binding.triggerId, "cam-2");
    const streamDeckTrigger = await fetchJson(`http://127.0.0.1:${PORTS.streamdeck}`, "/api/trigger", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ button: "cam-2" }),
    });
    assert.equal(streamDeckTrigger.showControl.body.binding.triggerId, "cam-2");
    await waitForCondition(() => calls.some((call) => call.service === "touchdesigner" && call.command === "td.camera.set"));
    const streamDeckAfterTrigger = await fetchJson(`http://127.0.0.1:${PORTS.streamdeck}`, "/api/state");
    assert.equal(streamDeckAfterTrigger.buttons["cam-2"].state, "active");

    const startRun = await fetchJson(showBase, "/v0/show-control/cues/start-run", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ autoPrepareNext: true }),
    });
    assert.equal(startRun.cue.status.state, "ok");
    assert(startRun.cue.actions.some((action) => action.command === "runtime.startRun"));
    const startRunRuntimeAction = startRun.cue.actions.find((action) => action.command === "runtime.startRun");
    assert(startRunRuntimeAction.adapterResult.runtimeStateRef, "runtime.startRun adapterResult should keep compact runtimeStateRef");
    assert(!startRunRuntimeAction.adapterResult.runtimeState, "runtime.startRun adapterResult should not store full runtimeState");
    assert(startRun.cue.actions.some((action) => action.command === "td.environment.prepare" && action.generatedByActionId));
    assert(startRun.cue.actions.some((action) => action.command === "teleprompter.prepare" && action.generatedByActionId));
    assert(startRun.cue.actions.some((action) => action.command === "script-agent.operator.prepareDraft" && action.generatedByActionId));
    assert(startRun.cue.actions.findIndex((action) => action.command === "teleprompter.prepare") < startRun.cue.actions.findIndex((action) => action.command === "td.environment.prepare"));
    assert(startRun.cue.actions.findIndex((action) => action.command === "script-agent.operator.prepareDraft") < startRun.cue.actions.findIndex((action) => action.command === "td.environment.prepare"));
    assert(startRun.cue.acks.some((ack) => ack.command === "td.environment.prepare" && ack.stage === "loaded"));
    assert(calls.some((call) => call.service === "runtime" && call.path === "/v0/runtime/runs/start"));
    assert(calls.some((call) => call.service === "touchdesigner" && call.command === "td.environment.prepare" && call.payloadFetched));
    assert(calls.some((call) => call.service === "script-agent" && call.path === "/v0/script-agent/teleprompter-parser/prepare"));
    assert(calls.some((call) => call.service === "script-agent" && call.path === "/v0/script-agent/operator/draft/from-runtime"));
    const startRunOperatorCall = calls.find((call) => call.service === "script-agent" && call.path === "/v0/script-agent/operator/draft/from-runtime");
    assert(startRunOperatorCall.body.runtimeOutput, "operator prepare should receive compact runtimeOutput");
    assert(!startRunOperatorCall.body.runtimeState, "operator prepare should not receive full runtimeState");
    const startRunPrepareCall = calls.find((call) => call.service === "touchdesigner" && call.command === "td.environment.prepare" && call.payloadFetched);
    assert.equal(startRunPrepareCall.payload.assetId, "asset:bg");
    assert.equal(startRunPrepareCall.payload.filePath, "/tmp/fake-background.jpg");
    assert.equal(startRunPrepareCall.payload.backgroundAsset.assetId, "asset:bg");

    const autoStartSituation = await fetchJson(showBase, "/v0/show-control/cues/start-situation", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        showRunId: "show-run-fake-001",
        name: "Stream Deck auto TD GO start situation",
      }),
    });
    assert.equal(autoStartSituation.cue.status.state, "ok");
    assert(autoStartSituation.cue.actions.some((action) => action.command === "td.environment.go" && action.generatedByActionId));
    assert(autoStartSituation.cue.actions.some((action) => action.command === "teleprompter.reveal" && action.generatedByActionId));
    await waitForCondition(() => calls.some((call) => call.service === "touchdesigner" && call.command === "td.environment.go" && call.payloadFetched));
    assert(calls.some((call) => call.service === "script-agent" && call.path === "/v0/script-agent/teleprompter-parser/reveal"));

    const sceneToChat = await fetchJson(showBase, "/v0/show-control/cues/scene-to-chat", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Stream Deck scene naar chat" }),
    });
    assert.equal(sceneToChat.cue.status.state, "ok");
    assert(sceneToChat.cue.actions.some((action) => action.command === "script-agent.operator.sceneToChat"));
    assert(!sceneToChat.cue.actions.some((action) => action.command === "teleprompter.prepare"));
    assert(calls.some((call) => call.service === "script-agent" && call.path === "/v0/script-agent/operator/scene-to-chat"));
    const sceneToChatCall = calls.findLast
      ? calls.findLast((call) => call.service === "script-agent" && call.path === "/v0/script-agent/operator/scene-to-chat")
      : calls.slice().reverse().find((call) => call.service === "script-agent" && call.path === "/v0/script-agent/operator/scene-to-chat");
    assert(sceneToChatCall.body.runtimeOutput, "sceneToChat should receive compact runtimeOutput");
    assert(!sceneToChatCall.body.runtimeState, "sceneToChat should not receive full runtimeState");

    const startSituation = await fetchJson(showBase, "/v0/show-control/cues/start-situation", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        showRunId: "show-run-fake-001",
        actions: [
          { command: "td.environment.go", ackMode: "fire-and-forget", payload: { environmentId: "environment:fake" }, parallelGroup: "go" },
          { command: "sq5.input.mute", ackMode: "acknowledged-async", payload: { channel: "brent", muted: false }, parallelGroup: "go" },
          { command: "camera.focus", ackMode: "acknowledged-async", payload: { camera: "cam1", normalised: 0.5 }, parallelGroup: "go" },
          { command: "streamdeck.status", ackMode: "fire-and-forget", payload: { button: "start", state: "active" }, parallelGroup: "go" },
          { command: "perfectCue.trigger", ackMode: "fire-and-forget", payload: { key: "Space", source: "smoke-cue" }, parallelGroup: "go" },
        ],
      }),
    });
    assert.equal(startSituation.cue.status.state, "ok");
    assert(calls.some((call) => call.service === "runtime" && call.path === "/v0/runtime/runs/show-run-fake-001/start-situation"));
    assert(calls.some((call) => call.service === "touchdesigner" && call.command === "td.environment.go"));
    const sq5Status = await fetchJson(`http://127.0.0.1:${PORTS.sq5}`, "/api/status");
    assert(sq5Status.activity.some((entry) => entry.source === "http" && entry.channelKey === "brent" && entry.action === "mute"));
    assert(calls.some((call) => call.service === "camera-hardware" && call.method === "PUT" && call.path === "/control/api/v1/lens/focus"));
    const streamDeckState = await fetchJson(`http://127.0.0.1:${PORTS.streamdeck}`, "/api/state");
    assert.equal(streamDeckState.buttons.start.state, "active");
    const perfectCueState = await fetchJson(`http://127.0.0.1:${PORTS.perfectCue}`, "/api/state");
    assert(perfectCueState.triggers.some((trigger) => trigger.key === "Space" && trigger.source === "smoke-cue"));
    assert(startSituation.cue.actions.some((action) => action.command === "streamdeck.status" && action.adapterResult));
    assert(startSituation.cue.actions.some((action) => action.command === "perfectCue.trigger" && action.adapterResult));

    const stopSituation = await fetchJson(showBase, "/v0/show-control/cues", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: "Stream Deck stop situation",
        actions: [
          { command: "runtime.stopSituation", ackMode: "acknowledged-async", payload: { showRunId: "show-run-fake-001", autoPrepareNext: true } },
        ],
      }),
    });
    assert.equal(stopSituation.cue.status.state, "ok");
    const stopRuntimeAction = stopSituation.cue.actions.find((action) => action.command === "runtime.stopSituation");
    assert(stopRuntimeAction.adapterResult.runtimeStateRef, "runtime.stopSituation adapterResult should keep compact runtimeStateRef");
    assert(!stopRuntimeAction.adapterResult.runtimeState, "runtime.stopSituation adapterResult should not store full runtimeState");
    assert(calls.some((call) => call.service === "runtime" && call.path === "/v0/runtime/runs/show-run-fake-001/stop-situation"));
    assert(stopSituation.cue.actions.some((action) => action.command === "td.environment.prepare" && action.generatedByActionId));
    assert(stopSituation.cue.actions.some((action) => action.command === "teleprompter.prepare" && action.generatedByActionId));
    assert(stopSituation.cue.actions.some((action) => action.command === "script-agent.operator.prepareDraft" && action.generatedByActionId));
    assert(stopSituation.cue.actions.findIndex((action) => action.command === "teleprompter.prepare") < stopSituation.cue.actions.findIndex((action) => action.command === "td.environment.prepare"));
    assert(stopSituation.cue.actions.findIndex((action) => action.command === "script-agent.operator.prepareDraft") < stopSituation.cue.actions.findIndex((action) => action.command === "td.environment.prepare"));
    assert(stopSituation.cue.acks.some((ack) => ack.command === "td.environment.prepare" && ack.stage === "loaded"));
    assert(calls.some((call) => call.service === "script-agent" && call.path === "/v0/script-agent/teleprompter-parser/prepare"));
    assert(calls.some((call) => call.service === "script-agent" && call.path === "/v0/script-agent/operator/draft/from-runtime"));
    const stopOperatorCall = calls.findLast
      ? calls.findLast((call) => call.service === "script-agent" && call.path === "/v0/script-agent/operator/draft/from-runtime")
      : calls.slice().reverse().find((call) => call.service === "script-agent" && call.path === "/v0/script-agent/operator/draft/from-runtime");
    assert(stopOperatorCall.body.runtimeOutput, "stop prepare should receive compact runtimeOutput");
    assert(!stopOperatorCall.body.runtimeState, "stop prepare should not receive full runtimeState");

    const resetRun = await fetchJson(showBase, "/v0/show-control/cues", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: "Stream Deck reset run",
        actions: [
          { command: "runtime.resetRun", ackMode: "acknowledged-async", payload: { showRunId: "show-run-fake-001" } },
        ],
      }),
    });
    assert.equal(resetRun.cue.status.state, "ok");
    assert(calls.some((call) => call.service === "runtime" && call.path === "/v0/runtime/runs/show-run-fake-001/reset"));

    const bad = await fetch(`${showBase}/v0/show-control/cues`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Bad command", actions: [{ command: "nope.nope" }] }),
    });
    const badBody = await bad.json();
    assert.equal(bad.ok, false);
    assert(String(badBody.message).includes("show_control_unknown_command:nope.nope"));

    const warningCue = await fetchJson(showBase, "/v0/show-control/cues", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: "TD warning fixture",
        actions: [
          { command: "td.environment.prepare", ackMode: "required-ready", timeoutMs: 15, simulate: "timeout", payload: { environmentId: "missing" } },
        ],
      }),
    });
    assert.equal(warningCue.cue.status.state, "warning");
    assert(warningCue.cue.status.warnings.some((item) => item.stage === "timedOut"));

    const status = await fetchJson(showBase, "/v0/show-control/status");
    assert(status.warningCount >= 1);
    assert.equal(status.latestCue, null, "status should not include full latest cue by default");
    assert(status.latestCueSummary);
    assert(status.latestCueSummary.actionCount >= 1);
    assert.equal(status.hardware.sq5.ok, true);
    assert.equal(status.hardware.camera.ok, true);
    assert.equal(status.hardware.dmx.ok, true);
    assert.equal(status.hardware.streamdeck.ok, true);
    assert.equal(status.hardware.perfectCue.ok, true);
    const cues = await fetchJson(showBase, "/v0/show-control/cues");
    assert(cues.count >= 3);
    assert.equal(cues.detail, "summary");
    assert(cues.cues[0].actionCount >= 1);
    assert(!cues.cues[0].actions[0].payload, "cue list summaries should omit full action payload");
    const fullCues = await fetchJson(showBase, "/v0/show-control/cues?detail=full");
    assert.equal(fullCues.detail, "full");
    assert(fullCues.cues.some((cue) => (cue.actions || []).some((action) => action.payload)));
    const cueDetail = await fetchJson(showBase, `/v0/show-control/cues/${encodeURIComponent(fullCues.cues[0].cueId)}`);
    assert(Array.isArray(cueDetail.actions), "cue detail endpoint should keep full cue shape");

    await closeServer(showServer);
    if (tdAckServer) tdAckServer.close();
    if (fakeTd) fakeTd.close();
    await stopChild(cameraSidecar);
    for (const server of servers.reverse()) await closeServer(server);
    await fs.rm(dbDir, { recursive: true, force: true });

    const afterHashes = await protectedHashes();
    assertHashesEqual(beforeHashes, afterHashes);

    process.stdout.write(JSON.stringify({
      ok: true,
      ports: PORTS,
      fakeMode: "explicit-test-mode-with-v2-sidecars",
      runtimeRoutes: calls.filter((call) => call.service === "runtime").map((call) => `${call.method} ${call.path}`),
      sq5Routes: sq5Status.activity.map((entry) => `${entry.source || "unknown"} ${entry.channel || entry.action || ""} ${entry.action || ""}`.trim()),
      cameraHardwareRoutes: calls.filter((call) => call.service === "camera-hardware").map((call) => `${call.method} ${call.path}`),
      streamDeckButtons: Object.keys(streamDeckState.buttons),
      streamDeckBindings: [cameraBinding.binding.bindingId],
      activeCueDefinitions: activeCueDefinitions.count,
      perfectCueTriggers: perfectCueState.triggers.map((trigger) => `${trigger.source}:${trigger.key}`),
      hardwareStatus: status.hardware,
      tdCommands: calls.filter((call) => call.service === "touchdesigner").map((call) => ({
        command: call.command,
        payloadFetched: !!call.payloadFetched,
      })),
      cueExamples: {
        startRunCueId: startRun.cue.cueId,
        startSituationCueId: startSituation.cue.cueId,
        warningCueId: warningCue.cue.cueId,
      },
      hypotheses: {
        H1: "runtime.startRun changed fake Runtime state and generated td.environment.prepare for preparedNext",
        H2: "runtime.startSituation generated TD GO by default and can fan out to SQ5, Camera, Stream Deck status and Perfect Cue trigger",
        H4: "unknown commands fail through command registry",
        H5: "SQ5/Camera adapters called V2 sidecar HTTP contracts copied from the legacy API shape",
        H6: "TD fetched HTTP payloads and sent acks; timeout warning stored",
        H7: "UI assets expose cue create/run/status/warning surfaces",
        H7a: "UI exposes active Stream Deck cue definitions separately from historical cue records",
        H7b: "Stream Deck trigger binding fires a saved cue and reaches TD camera switch",
        H8: "V1 app files and legacy/data/live.sqlite* hashes unchanged",
        H9: "smoke ran in explicit test mode with V2 hardware sidecars and fake downstream hardware",
        H10: "Show Control delegated Runtime/SQ5/Camera/TD/Stream Deck/Perfect Cue work through adapters",
      },
      protectedV1HashesUnchanged: true,
    }, null, 2));
    process.stdout.write("\n");
  } catch (err) {
    if (showServer) await closeServer(showServer);
    if (tdAckServer) tdAckServer.close();
    if (fakeTd) fakeTd.close();
    await stopChild(cameraSidecar);
    for (const server of servers.reverse()) await closeServer(server);
    await fs.rm(dbDir, { recursive: true, force: true });
    const afterHashes = await protectedHashes();
    assertHashesEqual(beforeHashes, afterHashes);
    throw err;
  }
}

main().catch((err) => {
  process.stderr.write(`${err.stack || err.message}\n`);
  process.exit(1);
});
