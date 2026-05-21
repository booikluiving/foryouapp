const { createRequire } = require("module");

const rawArgs = process.argv.slice(2);
const args = new Set(rawArgs.filter((arg) => String(arg || "").startsWith("--")));
const controlId = String(rawArgs.find((arg) => !String(arg || "").startsWith("--")) || process.env.FORYOU_START_SCENE_CONTROL_ID || "").trim();
const dryRun = args.has("--dry-run") || process.env.FORYOU_START_SCENE_DRY_RUN === "1";
const startOnly = args.has("--start-only") || process.env.FORYOU_START_SCENE_START_ONLY === "1";
const stopOnly = args.has("--stop-only") || process.env.FORYOU_START_SCENE_STOP_ONLY === "1";
const noCompanion = args.has("--no-companion") || process.env.FORYOU_START_SCENE_NO_COMPANION === "1";

const TRPC_URL = process.env.COMPANION_TRPC_URL || "ws://127.0.0.1:8008/trpc";
const BASE_URL = process.env.FORYOU_BASE_URL || "http://127.0.0.1:3310";
const OSC_HOST = process.env.FORYOU_TD_OSC_HOST || "127.0.0.1";
const OSC_PORT = Number(process.env.FORYOU_TD_OSC_PORT || 8008);
const OSC_PULSE_MS = Number(process.env.FORYOU_TD_OSC_PULSE_MS || 220);
const OSC_SETTLE_MS = Number(process.env.FORYOU_TD_OSC_SETTLE_MS || 80);
const RESTORE_AFTER_MS = Number(process.env.FORYOU_START_SCENE_RESTORE_MS || 1800);
const STOP_SCENE_DELAY_MS = Math.max(0, Number(process.env.FORYOU_STOP_SCENE_DELAY_MS || 500));
const ACTION_BUSY_PATH = "/Users/for_you/Library/Caches/ForYouApp/streamdeck-action-feedback.json";

const fs = require("fs");
const path = require("path");

const WHITE = 16777215;
const BLACK = 0;
const GREEN = 51200;
const RED = 13107200;
const ORANGE = 16753920;
const TEAL = 33792;
const DIM_COLOR = 8421504;
const DIM_BG = 0;
const PULSE_BG_ON = 16777215;
const PULSE_COLOR_ON = 0;
const PULSE_MS = 120;

if (startOnly && stopOnly) {
  console.error("Use only one of --start-only or --stop-only");
  process.exit(64);
}

if (!controlId && !dryRun && !noCompanion) {
  console.error("Usage: node foryou-start-scene-toggle.js <controlId> [--dry-run] [--start-only|--stop-only] [--no-companion]");
  process.exit(64);
}

function requireOsc() {
  const candidates = [
    process.env.FORYOU_APP_PACKAGE_JSON,
    "/Users/for_you/ForYou/main/app/package.json",
    "/Users/for_you/ForYou/App/app/package.json",
  ].filter(Boolean);

  for (const candidate of candidates) {
    try {
      return createRequire(candidate)("osc");
    } catch {}
  }

  return require("osc");
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function markActionFeedbackBusy(ms) {
  try {
    fs.mkdirSync(path.dirname(ACTION_BUSY_PATH), { recursive: true });
    fs.writeFileSync(ACTION_BUSY_PATH, JSON.stringify({ until: Date.now() + Math.max(0, Number(ms || 0)) }));
  } catch (error) {
    console.error(error.stack || error.message || error);
  }
}

function clearActionFeedbackBusy() {
  try {
    fs.mkdirSync(path.dirname(ACTION_BUSY_PATH), { recursive: true });
    fs.writeFileSync(ACTION_BUSY_PATH, JSON.stringify({ until: 0 }));
  } catch (error) {
    console.error(error.stack || error.message || error);
  }
}

function unwrapResult(result) {
  if (result?.type === "data") {
    if (result.data && Object.prototype.hasOwnProperty.call(result.data, "json")) return result.data.json;
    return result.data;
  }
  return result;
}

function makeTrpcClient() {
  const ws = new WebSocket(TRPC_URL);
  let id = 1;
  const pending = new Map();

  const ready = new Promise((resolve, reject) => {
    ws.onopen = resolve;
    ws.onerror = (event) => reject(new Error(event.message || "WebSocket error"));
  });

  ws.onmessage = (event) => {
    const message = JSON.parse(event.data);
    if (!message.id) return;
    const request = pending.get(message.id);
    if (!request) return;
    pending.delete(message.id);
    if (message.error) request.reject(new Error(JSON.stringify(message.error)));
    else request.resolve(unwrapResult(message.result));
  };

  function call(path, input) {
    return new Promise((resolve, reject) => {
      const requestId = id++;
      pending.set(requestId, { resolve, reject });
      ws.send(JSON.stringify({
        id: requestId,
        jsonrpc: "2.0",
        method: "mutation",
        params: { path, input },
      }));
    });
  }

  return { ready, call, close: () => ws.close() };
}

async function setButtonStyle(client, style) {
  if (!client || !controlId || !style) return;
  await client.call("controls.setStyleFields", { controlId, styleFields: style });
}

async function pulseClickedButton(client) {
  await setButtonStyle(client, { color: PULSE_COLOR_ON, bgcolor: PULSE_BG_ON });
  await sleep(PULSE_MS);
}

async function getState() {
  const response = await fetch(`${BASE_URL}/admin/algorithm/state`);
  const body = await readJson(response);
  if (!response.ok || !body || !body.ok) {
    throw new Error(body && (body.message || body.error) ? (body.message || body.error) : `state_failed_${response.status}`);
  }
  return body;
}

async function post(route, body = {}) {
  if (dryRun) return { ok: true, dryRun: true, route, body, state: null };
  const response = await fetch(`${BASE_URL}${route}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = await readJson(response);
  if (!response.ok || !json || !json.ok) {
    const message = json && (json.message || json.error) ? (json.message || json.error) : `request_failed_${response.status}`;
    throw new Error(message);
  }
  return json;
}

async function readJson(response) {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

function latestRunId(state) {
  const runs = Array.isArray(state && state.runs) ? state.runs : [];
  const latest = runs.slice().sort((a, b) => {
    const byOrder = Number(b && b.runOrder || 0) - Number(a && a.runOrder || 0);
    if (byOrder) return byOrder;
    return Number(b && b.id || 0) - Number(a && a.id || 0);
  })[0] || null;
  return Number(latest && latest.id || 0);
}

function algorithmRunStarted(state) {
  return !!(state && state.algorithmRun && state.algorithmRun.started);
}

function nextSceneId(state) {
  return Number(state && state.currentOrder && state.currentOrder.next && state.currentOrder.next.sceneId || 0);
}

function expectedState(state) {
  const runs = Array.isArray(state && state.runs) ? state.runs : [];
  const expected = {
    activeRunId: Number(state && state.activeRun && state.activeRun.id || 0),
    runCount: runs.length,
    latestRunId: latestRunId(state),
    runStarted: algorithmRunStarted(state),
  };
  if (expected.runStarted) expected.nextSceneId = nextSceneId(state);
  return expected;
}

function startSceneStyle(state) {
  if (!state) return { text: "SCENE\nERROR", size: "16", color: WHITE, bgcolor: RED };
  if (state.activeRun) return { text: "STOP\nSCENE", size: "17", color: BLACK, bgcolor: ORANGE };
  if (!nextSceneId(state)) return { text: "GEEN\nNEXT", size: "16", color: DIM_COLOR, bgcolor: DIM_BG };
  return { text: "START\nSCENE", size: "17", color: WHITE, bgcolor: TEAL };
}

async function sendOscPulse(address) {
  if (dryRun) return { ok: true, dryRun: true, address, values: [1, 0], host: OSC_HOST, port: OSC_PORT };

  const osc = requireOsc();
  const udpPort = new osc.UDPPort({
    localAddress: "127.0.0.1",
    localPort: 0,
    metadata: false,
  });

  await new Promise((resolve, reject) => {
    udpPort.on("ready", resolve);
    udpPort.on("error", reject);
    udpPort.open();
  });

  try {
    udpPort.send({ address, args: [1] }, OSC_HOST, OSC_PORT);
    await sleep(OSC_PULSE_MS);
    udpPort.send({ address, args: [0] }, OSC_HOST, OSC_PORT);
    await sleep(OSC_SETTLE_MS);
    return { ok: true, address, values: [1, 0], host: OSC_HOST, port: OSC_PORT };
  } finally {
    try {
      udpPort.close();
    } catch {}
  }
}

async function startScene(state) {
  const sceneId = nextSceneId(state);
  if (!sceneId) {
    return {
      status: "blocked",
      text: "GEEN\nNEXT",
      style: startSceneStyle(state),
      log: "no_up_next",
      state,
    };
  }

  const startResult = await post("/admin/algorithm/runs/start", {
    sceneId,
    selectionSource: "up_next",
    expectedState: expectedState(state),
  });
  const oscResult = await sendOscPulse("/osc/osc6");
  const revealResult = await post("/admin/teleprompter-parser/reveal", {});
  return {
    status: "ok",
    text: "SCENE\nSTART",
    style: { text: "SCENE\nSTART", size: "16", color: WHITE, bgcolor: GREEN },
    restoreStyle: startSceneStyle(startResult.state || { ...state, activeRun: startResult.run || true }),
    log: "scene_started",
    mics: startResult.sq5SceneMics || null,
    osc: oscResult,
    reveal: revealResult.preparedScene || null,
    state: startResult.state || null,
  };
}

async function stopScene(state) {
  if (!state.activeRun) {
    return {
      status: "blocked",
      text: "START\nSCENE",
      style: startSceneStyle(state),
      log: "no_active_run",
      state,
    };
  }

  if (!dryRun && STOP_SCENE_DELAY_MS > 0) await sleep(STOP_SCENE_DELAY_MS);

  const stopResult = await post("/admin/algorithm/runs/end", {
    reason: "stream_deck_start_scene_toggle",
    expectedState: expectedState(state),
  });
  const oscResult = await sendOscPulse("/osc/osc3");
  return {
    status: "ok",
    text: "SCENE\nSTOP",
    style: { text: "SCENE\nSTOP", size: "16", color: BLACK, bgcolor: ORANGE },
    restoreStyle: startSceneStyle(stopResult.state || { ...state, activeRun: null }),
    log: "scene_stopped",
    delayMs: STOP_SCENE_DELAY_MS,
    mics: stopResult.sq5SceneMics || null,
    osc: oscResult,
    state: stopResult.state || null,
  };
}

async function runToggle() {
  const state = await getState();
  if (startOnly) {
    if (state.activeRun) {
      return {
        status: "blocked",
        text: "STOP\nSCENE",
        style: startSceneStyle(state),
        log: "already_active_run",
        state,
      };
    }
    return startScene(state);
  }
  if (stopOnly) {
    return stopScene(state);
  }
  return state.activeRun ? stopScene(state) : startScene(state);
}

async function main() {
  const client = dryRun || noCompanion ? null : makeTrpcClient();
  if (client) await client.ready;
  if (!dryRun) markActionFeedbackBusy(RESTORE_AFTER_MS + 1500);

  try {
    if (client) {
      await pulseClickedButton(client);
      await setButtonStyle(client, { text: "SCENE\nWACHT", size: "16", color: BLACK, bgcolor: ORANGE });
    }

    const result = await runToggle();
    if (client) await setButtonStyle(client, result.style || { text: result.text, size: "16", color: WHITE, bgcolor: GREEN });
    console.log(JSON.stringify({ ok: result.status !== "error", dryRun, ...result }));

    if (client && RESTORE_AFTER_MS > 0) {
      await sleep(RESTORE_AFTER_MS);
      const restoreStyle = result.restoreStyle || startSceneStyle(result.state || await getState());
      await setButtonStyle(client, restoreStyle);
    }
  } finally {
    if (!dryRun) clearActionFeedbackBusy();
    if (client) client.close();
  }
}

main().catch(async (error) => {
  const message = error && error.message ? error.message : String(error || "unknown");
  try {
    if (!dryRun && controlId) {
      markActionFeedbackBusy(RESTORE_AFTER_MS + 1500);
      const client = makeTrpcClient();
      await client.ready;
      await setButtonStyle(client, { text: "SCENE\nERROR", size: "16", color: WHITE, bgcolor: RED });
      if (RESTORE_AFTER_MS > 0) {
        await sleep(RESTORE_AFTER_MS);
        await setButtonStyle(client, startSceneStyle(await getState().catch(() => null)));
      }
      client.close();
      clearActionFeedbackBusy();
    }
  } catch {}
  console.error(message);
  process.exit(1);
});
