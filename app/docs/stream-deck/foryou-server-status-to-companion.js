const { execFileSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const controlId = process.argv[2];
const args = new Set(process.argv.slice(3));

const DB_PATH = "/Users/for_you/Library/Application Support/companion/v4.3/db.sqlite";
const CACHE_PATH = "/Users/for_you/Library/Caches/ForYouApp/streamdeck-server-status.json";
const ACTION_BUSY_PATH = "/Users/for_you/Library/Caches/ForYouApp/streamdeck-action-feedback.json";
const TRPC_URL = "ws://127.0.0.1:8008/trpc";
const HEALTH_URL = "http://127.0.0.1:3310/health";
const STATE_URL = "http://127.0.0.1:3310/admin/algorithm/state";
const WHITE = 16777215;
const GREEN = 51200;
const RED = 13107200;
const BLUE = 22456;
const TEAL = 33792;
const ORANGE = 16753920;
const BLACK = 0;
const DIM_COLOR = 8421504;
const DIM_BG = 0;
const PULSE_BG_ON = 16777215;
const PULSE_COLOR_ON = 0;
const PULSE_BG_OFF = 4210752;
const PULSE_COLOR_OFF = 16777215;
const LABEL_SIZE = "18";
const PULSE_MS = 130;

const pageLinkButtons = [
  { row: 1, column: 0, on: { color: WHITE, bgcolor: BLUE } },
  { row: 1, column: 1, on: { color: WHITE, bgcolor: BLUE } },
  { row: 1, column: 2, on: { color: WHITE, bgcolor: BLUE } },
  { row: 1, column: 3, on: { color: WHITE, bgcolor: BLUE } },
  { row: 1, column: 4, on: { color: WHITE, bgcolor: BLUE } },
  { row: 1, column: 5, on: { color: WHITE, bgcolor: BLUE } },
];

const dynamicActionButtons = [
  { row: 2, column: 0, styleForState: showButtonStyle },
  { row: 2, column: 2, styleForState: sceneButtonStyle },
];

const serverDependentLocations = [
  ...pageLinkButtons,
  ...dynamicActionButtons,
];

if (!controlId) {
  console.error("Usage: node foryou-server-status-to-companion.js <controlId>");
  process.exit(64);
}

async function serverIsOn() {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 1000);
  try {
    const response = await fetch(HEALTH_URL, { signal: controller.signal });
    return response.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

async function readAppState() {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 1000);
  try {
    const response = await fetch(STATE_URL, { signal: controller.signal });
    const body = await response.json().catch(() => null);
    if (!response.ok || !body || !body.ok) return null;
    return body;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
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

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function readCache() {
  try {
    const parsed = JSON.parse(fs.readFileSync(CACHE_PATH, "utf8"));
    if (parsed && typeof parsed === "object") {
      return {
        status: String(parsed.status || ""),
        actionKey: String(parsed.actionKey || ""),
      };
    }
  } catch {}
  return { status: "", actionKey: "" };
}

function writeCache(status, actionKey) {
  try {
    fs.mkdirSync(path.dirname(CACHE_PATH), { recursive: true });
    fs.writeFileSync(CACHE_PATH, JSON.stringify({ status, actionKey, updatedAt: new Date().toISOString() }));
  } catch (error) {
    console.error(error.stack || error.message || error);
  }
}

function actionFeedbackBusy() {
  try {
    const parsed = JSON.parse(fs.readFileSync(ACTION_BUSY_PATH, "utf8"));
    return Number(parsed && parsed.until || 0) > Date.now();
  } catch {
    return false;
  }
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
    else request.resolve(message.result);
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

function showIsActive(state) {
  return !!(state && state.session && state.session.isActive);
}

function nextSceneId(state) {
  return Number(state && state.currentOrder && state.currentOrder.next && state.currentOrder.next.sceneId || 0);
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

function actionStateKey(state) {
  if (!state) return "";
  return [
    showIsActive(state) ? "show:on" : "show:off",
    state.activeRun ? "scene:on" : "scene:off",
    state.algorithmRun && state.algorithmRun.started ? "run:on" : "run:off",
    `next:${nextSceneId(state)}`,
  ].join("|");
}

async function setStyle(client, targetControlId, styleFields) {
  if (!targetControlId || !styleFields) return;
  await client.call("controls.setStyleFields", {
    controlId: targetControlId,
    styleFields,
  });
}

async function updatePageLinks(client, isOn) {
  const page = readPage(2);
  if (!page) return;
  const off = { color: DIM_COLOR, bgcolor: DIM_BG };
  for (const button of pageLinkButtons) {
    const id = controlIdAt(page, button.row, button.column);
    await setStyle(client, id, isOn ? button.on : off);
  }
}

async function updateDynamicActionButtons(client, isOn, state) {
  const page = readPage(2);
  if (!page) return;
  const off = { color: DIM_COLOR, bgcolor: DIM_BG };
  for (const button of dynamicActionButtons) {
    const id = controlIdAt(page, button.row, button.column);
    await setStyle(client, id, isOn ? button.styleForState(state) : off);
  }
}

async function pulseServerDependentButtons(client, isOn) {
  const page = readPage(2);
  if (!page) return;
  const pulse = isOn
    ? { color: PULSE_COLOR_ON, bgcolor: PULSE_BG_ON }
    : { color: PULSE_COLOR_OFF, bgcolor: PULSE_BG_OFF };
  for (const button of serverDependentLocations) {
    const id = controlIdAt(page, button.row, button.column);
    await setStyle(client, id, pulse);
  }
  await sleep(PULSE_MS);
}

async function main() {
  const isOn = await serverIsOn();
  const status = isOn ? "aan" : "uit";
  const cache = readCache();
  const force = args.has("--force");
  const statusChanged = cache.status !== status;
  const pulse = args.has("--pulse") || (cache.status && statusChanged);
  const busy = actionFeedbackBusy();
  const state = isOn && !busy ? await readAppState() : null;
  const actionKey = state ? actionStateKey(state) : cache.actionKey;
  const actionChanged = !!state && cache.actionKey !== actionKey;

  const client = makeTrpcClient();
  await client.ready;
  try {
    await client.call("controls.setStyleFields", {
      controlId,
      styleFields: {
        text: isOn ? "SERVER\nAAN" : "SERVER\nUIT",
        size: LABEL_SIZE,
        color: WHITE,
        bgcolor: isOn ? GREEN : RED,
      },
    });

    if (force || pulse || statusChanged) {
      if (pulse) await pulseServerDependentButtons(client, isOn);
      await updatePageLinks(client, isOn);
      await updateDynamicActionButtons(client, isOn, state);
    } else if (actionChanged) {
      await updateDynamicActionButtons(client, isOn, state);
    }

    writeCache(status, actionKey);
  } finally {
    client.close();
  }

  console.log(status);
}

main().catch((error) => {
  console.error(error.stack || error.message || error);
  process.exit(1);
});
