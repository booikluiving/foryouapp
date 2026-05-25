const { execFileSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const controlId = String(process.argv[2] || "").trim();
const actionName = String(process.argv[3] || "").trim().toLowerCase();

const DB_PATH = "/Users/for_you/Library/Application Support/companion/v4.3/db.sqlite";
const TRPC_URL = process.env.COMPANION_TRPC_URL || "ws://127.0.0.1:8008/trpc";
const BASE_URL = process.env.FORYOU_BASE_URL || "http://127.0.0.1:3310";
const RESTORE_AFTER_MS = Number(process.env.FORYOU_WEB_BUTTON_RESTORE_MS || 3500);
const ACTION_BUSY_PATH = "/Users/for_you/Library/Caches/ForYouApp/streamdeck-action-feedback.json";

const WHITE = 16777215;
const BLACK = 0;
const BLUE = 22456;
const GREEN = 51200;
const RED = 13107200;
const ORANGE = 16753920;
const TEAL = 33792;
const DIM_COLOR = 8421504;
const DIM_BG = 0;
const PULSE_BG_ON = 16777215;
const PULSE_COLOR_ON = 0;
const PULSE_MS = 120;

const dynamicActionButtons = [
  { key: "show", row: 2, column: 0, styleForState: showButtonStyle },
  { key: "scene", row: 2, column: 2, styleForState: sceneButtonStyle },
];

const actions = {
  "show-toggle": {
    defaultText: "START\nSHOW",
    waitText: "SHOW\nWACHT",
    defaultBg: BLUE,
    size: "21",
    dynamic: true,
    run: showToggle,
  },
  "scene-toggle": {
    defaultText: "VOLG.\nSITUATIE",
    waitText: "SIT.\nWACHT",
    defaultBg: TEAL,
    size: "15",
    dynamic: true,
    run: sceneToggle,
  },
  "start-show": {
    defaultText: "START\nSHOW",
    waitText: "START\nWACHT",
    defaultBg: BLUE,
    size: "21",
    run: startShow,
  },
  "stop-show": {
    defaultText: "STOP\nSHOW",
    waitText: "STOP\nWACHT",
    defaultBg: RED,
    size: "21",
    run: stopShow,
  },
  "next-scene": {
    defaultText: "VOLG.\nSITUATIE",
    waitText: "VOLGENDE\nWACHT",
    defaultBg: TEAL,
    size: "17",
    run: nextScene,
  },
  "stop-scene": {
    defaultText: "STOP\nSITUATIE",
    waitText: "STOP\nWACHT",
    defaultBg: ORANGE,
    defaultColor: BLACK,
    size: "17",
    run: stopScene,
  },
};

if (!controlId || !actions[actionName]) {
  console.error("Usage: node foryou-web-button.js <controlId> <show-toggle|scene-toggle|start-show|stop-show|next-scene|stop-scene>");
  process.exit(64);
}

const action = actions[actionName];

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function sqlite(sql) {
  return execFileSync("sqlite3", [DB_PATH, sql], { encoding: "utf8" }).trim();
}

function readPage(pageNumber) {
  const value = sqlite(`SELECT value FROM pages WHERE id=${pageNumber};`);
  return value ? JSON.parse(value) : null;
}

function controlIdAt(page, row, column) {
  return page?.controls?.[String(row)]?.[String(column)] || null;
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
      ws.send(
        JSON.stringify({
          id: requestId,
          jsonrpc: "2.0",
          method: "mutation",
          params: { path, input },
        })
      );
    });
  }

  return {
    ready,
    call,
    close: () => ws.close(),
  };
}

async function setStyleForControl(client, targetControlId, style) {
  if (!targetControlId || !style) return;
  await client.call("controls.setStyleFields", {
    controlId: targetControlId,
    styleFields: style,
  });
}

async function setButtonStyle(client, text, bgcolor, color = WHITE, size = action.size || "18") {
  await setStyleForControl(client, controlId, { text, size, color, bgcolor });
}

async function pulseClickedButton(client) {
  await client.call("controls.setStyleFields", {
    controlId,
    styleFields: {
      color: PULSE_COLOR_ON,
      bgcolor: PULSE_BG_ON,
    },
  });
  await sleep(PULSE_MS);
}

async function getState() {
  const response = await fetch(`${BASE_URL}/admin/algorithm/state`);
  const body = await readJson(response);
  if (!response.ok || !body || !body.ok) throw new Error(body && body.error ? body.error : `state_failed_${response.status}`);
  return body;
}

async function post(path, body = {}) {
  const response = await fetch(`${BASE_URL}${path}`, {
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

function showIsActive(state) {
  return !!(state && state.session && state.session.isActive);
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

function showButtonStyle(state) {
  if (!state) return { text: "SHOW\nERROR", size: "18", color: WHITE, bgcolor: RED };
  return showIsActive(state)
    ? { text: "STOP\nSHOW", size: "21", color: WHITE, bgcolor: RED }
    : { text: "START\nSHOW", size: "21", color: WHITE, bgcolor: BLUE };
}

function sceneButtonStyle(state) {
  if (!state) return { text: "SIT.\nERROR", size: "18", color: WHITE, bgcolor: RED };
  if (!showIsActive(state)) {
    return { text: "SITUATIE\nUIT", size: "13", color: DIM_COLOR, bgcolor: DIM_BG };
  }
  if (!state.activeRun && !nextSceneId(state)) {
    return { text: "SITUATIE\nUIT", size: "13", color: DIM_COLOR, bgcolor: DIM_BG };
  }
  return state && state.activeRun
    ? { text: "STOP\nSITUATIE", size: "15", color: BLACK, bgcolor: ORANGE }
    : { text: "VOLG.\nSITUATIE", size: "15", color: WHITE, bgcolor: TEAL };
}

async function updateDynamicActionButtons(client, state = null) {
  const nextState = state || await getState();
  const page = readPage(2);
  if (!page) return;

  for (const button of dynamicActionButtons) {
    const targetControlId = controlIdAt(page, button.row, button.column);
    await setStyleForControl(client, targetControlId, button.styleForState(nextState));
  }
}

async function startShow() {
  const result = await post("/admin/show/start", {});
  return {
    status: "ok",
    text: result.join && result.join.joinUrl ? "NIEUWE\nSESSIE" : "SHOW\nGESTART",
    bgcolor: GREEN,
    log: "show_started",
    state: result.state || null,
  };
}

async function stopShow() {
  const result = await post("/admin/show/stop", {});
  return {
    status: "ok",
    text: result.sessionEnded ? "SHOW\nGESTOPT" : "AL\nSTIL",
    bgcolor: GREEN,
    log: result.sessionEnded ? "show_stopped" : "show_already_stopped",
    state: result.state || null,
  };
}

async function showToggle() {
  const state = await getState();
  return showIsActive(state) ? stopShow() : startShow();
}

async function nextScene(initialState = null) {
  const state = initialState || await getState();
  if (state.activeRun) {
    return {
      status: "blocked",
      text: "STOP\nEERST",
      bgcolor: ORANGE,
      color: BLACK,
      log: "active_scene_running",
      state,
    };
  }

  if (!algorithmRunStarted(state)) {
    const result = await post("/admin/algorithm/runs/begin", { expectedState: expectedState(state) });
    return {
      status: "ok",
      text: "RUN\nSTART",
      bgcolor: GREEN,
      log: "run_started",
      state: result.state || null,
    };
  }

  const sceneId = nextSceneId(state);
  if (!sceneId) {
    return {
      status: "blocked",
      text: "GEEN\nVOLGENDE",
      bgcolor: ORANGE,
      color: BLACK,
      log: "no_next_scene",
      state,
    };
  }

  const result = await post("/admin/algorithm/runs/start", {
    sceneId,
    selectionSource: "up_next",
    expectedState: expectedState(state),
  });
  return {
    status: "ok",
    text: "SIT.\nSTART",
    bgcolor: GREEN,
    log: "scene_started",
    state: result.state || null,
  };
}

async function stopScene(initialState = null) {
  const state = initialState || await getState();
  if (!state.activeRun) {
    return {
      status: "blocked",
      text: "GEEN\nSIT.",
      bgcolor: ORANGE,
      color: BLACK,
      log: "no_active_scene",
      state,
    };
  }

  const result = await post("/admin/algorithm/runs/end", {
    reason: "stream_deck",
    expectedState: expectedState(state),
  });
  return {
    status: "ok",
    text: "SIT.\nGESTOPT",
    bgcolor: GREEN,
    log: "scene_stopped",
    state: result.state || null,
  };
}

async function sceneToggle() {
  const state = await getState();
  if (!showIsActive(state)) {
    return {
      status: "blocked",
      text: "SITUATIE\nUIT",
      bgcolor: ORANGE,
      color: BLACK,
      log: "show_inactive",
      state,
    };
  }
  return state.activeRun ? stopScene(state) : nextScene(state);
}

function errorText() {
  if (actionName === "scene-toggle") return "SIT.\nERROR";
  if (actionName === "show-toggle") return "SHOW\nERROR";
  if (actionName === "next-scene") return "VOLGENDE\nERROR";
  if (actionName === "stop-scene") return "STOP\nERROR";
  if (actionName === "start-show") return "START\nERROR";
  return "STOP\nERROR";
}

async function restoreAfterFeedback(client, result) {
  if (RESTORE_AFTER_MS > 0) await sleep(RESTORE_AFTER_MS);

  if (action.dynamic) {
    await updateDynamicActionButtons(client, result && result.state ? result.state : null);
    return;
  }

  if (RESTORE_AFTER_MS > 0) {
    await setButtonStyle(client, action.defaultText, action.defaultBg, action.defaultColor || WHITE);
  }
}

async function main() {
  if (action.dynamic) markActionFeedbackBusy(RESTORE_AFTER_MS + 1500);

  const client = makeTrpcClient();
  await client.ready;

  try {
    await pulseClickedButton(client);
    await setButtonStyle(client, action.waitText, ORANGE, BLACK);
    const result = await action.run();
    await setButtonStyle(client, result.text, result.bgcolor, result.color || WHITE);
    console.log(JSON.stringify({ ok: result.status !== "error", action: actionName, ...result }));
    await restoreAfterFeedback(client, result);
  } finally {
    if (action.dynamic) clearActionFeedbackBusy();
    client.close();
  }
}

main().catch(async (error) => {
  const message = error && error.message ? error.message : String(error || "unknown");
  try {
    const client = makeTrpcClient();
    await client.ready;
    if (action.dynamic) markActionFeedbackBusy(RESTORE_AFTER_MS + 1500);
    await setButtonStyle(client, errorText(), RED, WHITE);
    if (action.dynamic && RESTORE_AFTER_MS > 0) {
      await sleep(RESTORE_AFTER_MS);
      await updateDynamicActionButtons(client);
      clearActionFeedbackBusy();
    }
    client.close();
  } catch {}
  console.error(message);
  process.exit(1);
});
