"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const http = require("node:http");
const path = require("node:path");

const TEST_DIR = __dirname;
const SHOW_CONTROL_ROOT = path.resolve(TEST_DIR, "..", "..");
const GUARDED_PATTERNS = [
  ["app", "sq5-control"].join("/"),
  ["app", "camera-control"].join("/"),
  ["app", "docs", "stream-deck"].join("/"),
  ["127.0.0.1", "3105"].join(":"),
  ["127.0.0.1", "3110"].join(":"),
  ["process.env", "SQ5_"].join("."),
  ["process.env", "CAMERA_CONTROL_"].join("."),
  [":", "3105"].join(""),
  [":", "3110"].join(""),
  ["mock", "or", "companion"].join("-"),
  ["keyboard", "contract"].join("-"),
  "require(" + "\"osc\"" + ")",
  "require(" + "'osc'" + ")",
];

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

async function startServer(server) {
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

async function walkFiles(root) {
  const entries = await fs.readdir(root, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    if (entry.name.startsWith(".tmp") || entry.name === "node_modules") continue;
    const fullPath = path.join(root, entry.name);
    if (entry.isDirectory()) {
      files.push(...await walkFiles(fullPath));
    } else if (/\.(js|json|md|html|css|txt)$/.test(entry.name)) {
      files.push(fullPath);
    }
  }
  return files;
}

async function assertNoLegacyRuntimeReferences() {
  const files = await walkFiles(SHOW_CONTROL_ROOT);
  const violations = [];
  for (const filePath of files) {
    const text = await fs.readFile(filePath, "utf8");
    for (const pattern of GUARDED_PATTERNS) {
      if (text.includes(pattern)) violations.push(`${path.relative(SHOW_CONTROL_ROOT, filePath)} -> ${pattern}`);
    }
  }
  assert.deepEqual(violations, [], "Show Control must not runtime-reference old hardware paths or mock-only transports");
  return { filesScanned: files.length, guardedPatterns: GUARDED_PATTERNS };
}

async function testStreamDeckSidecar() {
  const { createStreamDeckApp } = require("../streamdeck-control/server");
  const server = await startServer(createStreamDeckApp());
  try {
    await fetchJson(server.baseUrl, "/api/status", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ button: "start", state: "active", label: "Start" }),
    });
    await fetchJson(server.baseUrl, "/api/streamdeck/brent/toggle", { method: "POST" });
    const state = await fetchJson(server.baseUrl, "/api/state");
    assert.equal(state.buttons.start.state, "active");
    assert.equal(state.brent, true);
    return { buttons: Object.keys(state.buttons), brentMuted: state.brent };
  } finally {
    await server.close();
  }
}

async function testPerfectCueSidecar() {
  const received = [];
  const fakeShowControl = http.createServer(async (req, res) => {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const body = req.method === "POST" ? await readJson(req) : {};
    received.push({ method: req.method, path: url.pathname, body });
    sendJson(res, 201, { ok: true, cueId: "cue:from-perfect-cue", body });
  });
  const fake = await startServer(fakeShowControl);
  const { createPerfectCueApp } = require("../perfect-cue-control/server");
  const perfectCue = await startServer(createPerfectCueApp({ showControlUrl: fake.baseUrl, monitor: false }));
  try {
    const result = await fetchJson(perfectCue.baseUrl, "/api/key", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ key: "PageDown", source: "hardware-test" }),
    });
    assert.equal(result.trigger.command, "teleprompter.cue");
    assert.equal(result.trigger.direction, "next");
    assert(received.some((call) => call.path === "/v0/show-control/cues"));
    const cueCall = received.find((call) => call.path === "/v0/show-control/cues");
    assert.equal(cueCall.body.actions[0].command, "teleprompter.cue");
    assert.equal(cueCall.body.actions[0].payload.direction, "next");
    assert.equal(result.state.summary.lastPressDirection, "next");
    assert.equal(result.state.summary.lastPressOk, true);
    const trigger = await fetchJson(perfectCue.baseUrl, "/api/trigger", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ direction: "prev", source: "perfectcue-usb", deviceKey: "left_arrow" }),
    });
    assert.equal(trigger.trigger.direction, "prev");
    assert.equal(trigger.trigger.deviceKey, "left_arrow");
    const { applyRule, buildRule } = require("../perfect-cue-control/karabiner-install");
    const config = { profiles: [{ name: "p", selected: true, complex_modifications: { rules: [
      { description: "For You: PerfectCue Page Up/Down controls teleprompter only", manipulators: [] },
      { description: "andere regel", manipulators: [] },
    ] }, devices: [] }] };
    applyRule(config, buildRule("/tmp/perfectcue-test.log"));
    const rules = config.profiles[0].complex_modifications.rules;
    assert.equal(rules.length, 2);
    assert(rules[0].description.startsWith("For_You: PerfectCue"));
    assert(rules[0].manipulators.every((m) => m.conditions[0].identifiers[0].vendor_id === 1155 && m.conditions[0].identifiers[0].product_id === 42046));
    return { trigger: result.trigger, showControlRoutes: received.map((call) => `${call.method} ${call.path}`) };
  } finally {
    await perfectCue.close();
    await fake.close();
  }
}

function testSq5Protocol() {
  const { protocol } = require("../sq5-control/server");
  assert.equal(protocol.streamdeckTargetFromToken("all-mics").key, "allMics");
  const bytes = protocol.inputMuteBytes(1, true);
  assert(Array.isArray(bytes));
  assert(bytes.length > 0);
  return { allMicsTarget: "allMics", inputMuteBytes: bytes.length };
}

async function main() {
  const guards = await assertNoLegacyRuntimeReferences();
  const sq5 = testSq5Protocol();
  const streamdeck = await testStreamDeckSidecar();
  const perfectCue = await testPerfectCueSidecar();
  process.stdout.write(JSON.stringify({
    ok: true,
    guards,
    sidecars: {
      sq5,
      streamdeck,
      perfectCue,
    },
    proof: [
      "Show Control source contains no old hardware path defaults",
      "Stream Deck sidecar supports status polling and button trigger state",
      "Perfect Cue sidecar maps keyboard input to a Show Control cue create call",
      "SQ5 sidecar preserves the copied MIDI/Stream Deck protocol helpers",
    ],
  }, null, 2));
  process.stdout.write("\n");
}

main().catch((err) => {
  process.stderr.write(`${err.stack || err.message}\n`);
  process.exit(1);
});
