const { execFileSync } = require("child_process");

const DB_PATH = "/Users/for_you/Library/Application Support/companion/v4.3/db.sqlite";
const TRPC_URL = "ws://127.0.0.1:8008/trpc";
const COMPANION_NODE = "/Applications/Companion.app/Contents/Resources/node-runtimes/node22/bin/node";
const WEB_BUTTON_SCRIPT = "/Users/for_you/ForYou/companion-scripts/foryou-web-button.js";
const BASE_URL = "http://127.0.0.1:3310";

const WHITE = 16777215;
const BLACK = 0;
const BLUE = 22456;
const RED = 13107200;
const ORANGE = 16753920;
const TEAL = 33792;
const DIM_COLOR = 8421504;
const DIM_BG = 0;

const buttons = [
  { key: "show", row: 2, column: 0, action: "show-toggle", fallbackTitle: "START\nSHOW", size: "21", color: WHITE, bgcolor: BLUE },
  { key: "scene", row: 2, column: 2, action: "scene-toggle", fallbackTitle: "VOLG.\nSITUATIE", size: "15", color: WHITE, bgcolor: TEAL },
];

const clearLocations = [
  { pageNumber: 2, row: 2, column: 1 },
  { pageNumber: 2, row: 2, column: 3 },
];

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

function showIsActive(state) {
  return !!(state && state.session && state.session.isActive);
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

function nextSceneId(state) {
  return Number(state && state.currentOrder && state.currentOrder.next && state.currentOrder.next.sceneId || 0);
}

async function readAppState() {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 1200);
  try {
    const response = await fetch(`${BASE_URL}/admin/algorithm/state`, { signal: controller.signal });
    const body = await response.json().catch(() => null);
    if (!response.ok || !body || !body.ok) return null;
    return body;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function initialStyle(button, state) {
  if (state && button.key === "show") return showButtonStyle(state);
  if (state && button.key === "scene") return sceneButtonStyle(state);
  return {
    text: button.fallbackTitle,
    size: button.size,
    color: button.color,
    bgcolor: button.bgcolor,
  };
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

  return { ready, call, close: () => ws.close() };
}

function option(value) {
  return { isExpression: false, value };
}

async function addExecAction(client, controlId, command, timeout = 15000) {
  const entityLocation = { stepId: "0", setId: "down" };
  const entityId = await client.call("controls.entities.add", {
    controlId,
    entityLocation,
    ownerId: null,
    connectionId: "internal",
    entityType: "action",
    entityDefinition: "exec",
  });

  for (const [key, value] of [
    ["path", command],
    ["cwd", ""],
    ["timeout", timeout],
    ["targetVariable", ""],
  ]) {
    await client.call("controls.entities.setOption", {
      controlId,
      entityLocation,
      entityId,
      key,
      value: option(value),
    });
  }
}

async function createButton(client, button, state) {
  const location = { pageNumber: 2, row: button.row, column: button.column };
  await client.call("controls.resetControl", { location });
  await client.call("controls.resetControl", { location, newType: "button" });
  await new Promise((resolve) => setTimeout(resolve, 50));

  const page = readPage(2);
  const controlId = controlIdAt(page, button.row, button.column);
  if (!controlId) throw new Error(`Missing control id at row ${button.row}, column ${button.column}`);

  await client.call("controls.setStyleFields", {
    controlId,
    styleFields: initialStyle(button, state),
  });

  await addExecAction(client, controlId, `${COMPANION_NODE} ${WEB_BUTTON_SCRIPT} ${controlId} ${button.action}`);

  return {
    controlId,
    row: button.row,
    column: button.column,
    action: button.action,
  };
}

async function main() {
  if (!readPage(2)) throw new Error("Companion page 2 is missing; refusing to create pages from this script.");

  const state = await readAppState();
  const client = makeTrpcClient();
  await client.ready;

  try {
    const configured = [];
    for (const button of buttons) {
      configured.push(await createButton(client, button, state));
    }

    for (const location of clearLocations) {
      await client.call("controls.resetControl", { location });
    }

    console.log(JSON.stringify({ ok: true, configured, cleared: clearLocations }, null, 2));
  } finally {
    client.close();
  }
}

main().catch((error) => {
  console.error(error.stack || error.message || error);
  process.exit(1);
});
