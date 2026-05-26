"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const http = require("node:http");
const path = require("node:path");

const V2_ROOT = path.resolve(__dirname, "../..");
const { createOscServer, sendOsc } = require("../../modules/show-control/target-adapters/osc-lite");

const PORTS = Object.freeze({
  showControl: 19425,
  tdOsc: 19100,
  tdAck: 19101,
});

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchJson(baseUrl, pathname, options = {}) {
  const response = await fetch(`${baseUrl}${pathname}`, {
    method: options.method || "GET",
    headers: options.body ? { "content-type": "application/json" } : undefined,
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  const text = await response.text();
  const body = text ? JSON.parse(text) : {};
  if (!response.ok) throw new Error(`${pathname} returned ${response.status}: ${JSON.stringify(body)}`);
  return body;
}

function listenExpress(app, port) {
  return new Promise((resolve) => {
    const server = app.listen(port, "127.0.0.1", () => resolve(server));
  });
}

function closeServer(server) {
  return new Promise((resolve) => server.close(resolve));
}

function startFakeTouchDesigner({ oscPort, ackPort, showControlBaseUrl, calls }) {
  const server = createOscServer({
    host: "127.0.0.1",
    port: oscPort,
    onMessage: (message) => {
      if (message.error) {
        calls.push({ error: message.error.message || String(message.error), at: Date.now() });
        return;
      }
      const args = Array.isArray(message.args) ? message.args : [];
      const cueId = String(args[0] || "");
      const command = String(args[1] || "");
      const payloadId = String(args[2] || "");
      const call = { address: message.address, cueId, command, payloadId, at: Date.now() };
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
          const stage = command.endsWith(".prepare") ? "loaded" : "applied";
          sendOsc({
            host: "127.0.0.1",
            port: ackPort,
            address: "/td/ack",
            args: [cueId, command, stage, "ok", `td_qhub_test_${stage}`],
          }).catch((err) => {
            call.ackError = err.message || String(err);
          });
        });
    },
  });
  return {
    close() {
      server.close();
    },
  };
}

async function runCue(baseUrl, command, payload, ackMode = "acknowledged-async") {
  const result = await fetchJson(baseUrl, "/v0/show-control/cues", {
    method: "POST",
    body: {
      name: `TD Q-hub protocol ${command}`,
      actions: [
        {
          command,
          ackMode,
          timeoutMs: 900,
          payload,
        },
      ],
    },
  });
  assert.equal(result.ok, true);
  assert.equal(result.cue.status.state, "ok", `${command} cue should finish ok`);
  assert(result.cue.acks.some((ack) => ack.command === command), `${command} should store a TD ack`);
  return result.cue;
}

async function runProtocol(baseUrl) {
  const commands = [
    ["td.status.heartbeat", { source: "td-qhub-test", heartbeatAt: new Date().toISOString() }, "acknowledged-async"],
    ["td.environment.prepare", { environmentId: "environment:td-qhub-test", cueIntent: "prepare_environment", generatedBy: "runtime.startRun" }, "required-ready"],
    ["td.environment.go", { environmentId: "environment:td-qhub-test", cueIntent: "go_environment" }, "acknowledged-async"],
    ["td.environment.prepare", { environmentId: "environment:td-qhub-test-next", cueIntent: "prepare_next_environment", generatedBy: "runtime.stopSituation" }, "required-ready"],
    ["td.phase.set", { phase: "cams" }, "acknowledged-async"],
    ["td.camera.set", { camera: "1", cameraId: "camera:1" }, "acknowledged-async"],
    ["td.camera.set", { camera: "2", cameraId: "camera:2" }, "acknowledged-async"],
    ["td.camera.set", { camera: "3", cameraId: "camera:3" }, "acknowledged-async"],
    ["td.asset.prepare", {
      assetId: "media-asset:td-qhub-demo",
      environmentId: "environment:td-qhub-test",
      type: "background",
      role: "background",
      filePath: "/tmp/foryou-td-qhub-demo-background.jpg",
      url: "http://127.0.0.1:3021/v0/catalog/media-assets/file/media-asset%3Atd-qhub-demo",
    }, "required-ready"],
  ];
  const cues = [];
  for (const [command, payload, ackMode] of commands) {
    cues.push(await runCue(baseUrl, command, payload, ackMode));
  }
  return cues;
}

async function runSelfContained() {
  const dbDir = path.join(V2_ROOT, ".tmp", `td-qhub-protocol-${Date.now()}`);
  process.env.V2_SHOW_CONTROL_DB_DIR = dbDir;
  const calls = [];
  let showServer = null;
  let tdAckServer = null;
  let fakeTd = null;
  try {
    const { createShowControlApp } = require("../../modules/show-control/server/app");
    const { startTdAckServer } = require("../../modules/show-control/server/td-ack-server");
    const showBase = `http://127.0.0.1:${PORTS.showControl}`;
    fakeTd = startFakeTouchDesigner({
      oscPort: PORTS.tdOsc,
      ackPort: PORTS.tdAck,
      showControlBaseUrl: showBase,
      calls,
    });
    tdAckServer = startTdAckServer({ tdAckPort: PORTS.tdAck });
    showServer = await listenExpress(createShowControlApp({
      adapterOptions: {
        tdOscPort: PORTS.tdOsc,
        tdAckPort: PORTS.tdAck,
      },
    }), PORTS.showControl);
    await sleep(25);
    const cues = await runProtocol(showBase);
    for (const command of ["td.status.heartbeat", "td.environment.prepare", "td.environment.go", "td.phase.set", "td.asset.prepare"]) {
      assert(calls.some((call) => call.command === command && call.payloadFetched), `${command} should reach fake TD and fetch payload`);
    }
    for (const camera of ["1", "2", "3"]) {
      assert(calls.some((call) => call.command === "td.camera.set" && call.payload && call.payload.camera === camera), `camera ${camera} should reach fake TD`);
    }
    process.stdout.write(JSON.stringify({
      ok: true,
      mode: "self-contained-fake-td",
      ports: PORTS,
      cueCount: cues.length,
      tdCalls: calls.map((call) => ({ command: call.command, payloadId: call.payloadId, payloadFetched: !!call.payloadFetched })),
    }, null, 2));
    process.stdout.write("\n");
  } finally {
    if (showServer) await closeServer(showServer);
    if (tdAckServer) tdAckServer.close();
    if (fakeTd) fakeTd.close();
    await fs.rm(dbDir, { recursive: true, force: true });
  }
}

async function runLive() {
  const baseUrl = process.env.SHOW_CONTROL_URL || "http://127.0.0.1:3025";
  const cues = await runProtocol(baseUrl);
  process.stdout.write(JSON.stringify({
    ok: true,
    mode: "live-touchdesigner",
    showControlUrl: baseUrl,
    cueCount: cues.length,
    cueIds: cues.map((cue) => cue.cueId),
  }, null, 2));
  process.stdout.write("\n");
}

async function main() {
  if (process.argv.includes("--live")) {
    await runLive();
  } else {
    await runSelfContained();
  }
}

main().catch((err) => {
  process.stderr.write(`${err.stack || err.message}\n`);
  process.exit(1);
});
