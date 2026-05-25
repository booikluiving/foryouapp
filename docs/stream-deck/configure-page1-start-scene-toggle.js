const { execFileSync } = require("child_process");

const DB_PATH = "/Users/for_you/Library/Application Support/companion/v4.3/db.sqlite";
const TRPC_URL = "ws://127.0.0.1:8008/trpc";
const COMPANION_NODE = "/Applications/Companion.app/Contents/Resources/node-runtimes/node22/bin/node";
const START_SCENE_SCRIPT = "/Users/for_you/ForYou/companion-scripts/foryou-start-scene-toggle.js";
const BASE_URL = "http://127.0.0.1:3310";
const LOCATION = { pageNumber: 1, row: 0, column: 5 };

const WHITE = 16777215;
const BLACK = 0;
const TEAL = 33792;
const ORANGE = 16753920;
const RED = 13107200;
const DIM_COLOR = 8421504;
const DIM_BG = 0;

function sqlite(sql) {
  return execFileSync("sqlite3", [DB_PATH, sql], { encoding: "utf8" }).trim();
}

function readPage(pageNumber) {
  const value = sqlite(`SELECT value FROM pages WHERE id=${pageNumber};`);
  return value ? JSON.parse(value) : null;
}

function readControl(controlId) {
  const escaped = controlId.replaceAll("'", "''");
  const value = sqlite(`SELECT value FROM controls WHERE id='${escaped}';`);
  return value ? JSON.parse(value) : null;
}

function controlIdAt(location) {
  const page = readPage(location.pageNumber);
  return page?.controls?.[String(location.row)]?.[String(location.column)] || null;
}

function stepActions(control) {
  const result = [];
  for (const step of Object.values(control?.steps || {})) {
    for (const set of Object.values(step?.action_sets || {})) {
      if (Array.isArray(set)) result.push(...set);
    }
  }
  return result;
}

function actionPath(action) {
  return String(action?.options?.path?.value || "");
}

function isStartSceneControl(control) {
  const text = String(control?.style?.text || "");
  return text === "Start Scene" || text === "START\nSCENE" || stepActions(control).some((action) => actionPath(action) === "/osc/osc6");
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

function nextSceneId(state) {
  return Number(state && state.currentOrder && state.currentOrder.next && state.currentOrder.next.sceneId || 0);
}

function initialStyle(state) {
  if (!state) return { text: "START\nSCENE", size: "17", color: WHITE, bgcolor: TEAL };
  if (state.activeRun) return { text: "STOP\nSCENE", size: "17", color: BLACK, bgcolor: ORANGE };
  if (!nextSceneId(state)) return { text: "GEEN\nNEXT", size: "16", color: DIM_COLOR, bgcolor: DIM_BG };
  return { text: "START\nSCENE", size: "17", color: WHITE, bgcolor: TEAL };
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

function option(value) {
  return { isExpression: false, value };
}

async function addExecAction(client, controlId, command, timeout = 20000) {
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

async function main() {
  const existingControlId = controlIdAt(LOCATION);
  if (!existingControlId) throw new Error(`Missing Start Scene control at ${JSON.stringify(LOCATION)}`);
  const existingControl = readControl(existingControlId);
  if (!isStartSceneControl(existingControl)) {
    throw new Error(`Refusing to replace unexpected control at ${JSON.stringify(LOCATION)}: ${existingControlId}`);
  }

  const state = await readAppState();
  const client = makeTrpcClient();
  await client.ready;
  try {
    await client.call("controls.resetControl", { location: LOCATION });
    await client.call("controls.resetControl", { location: LOCATION, newType: "button" });
    await new Promise((resolve) => setTimeout(resolve, 50));

    const controlId = controlIdAt(LOCATION);
    if (!controlId) throw new Error(`Missing control id after reset at ${JSON.stringify(LOCATION)}`);

    await client.call("controls.setStyleFields", {
      controlId,
      styleFields: initialStyle(state),
    });
    await addExecAction(client, controlId, `${COMPANION_NODE} ${START_SCENE_SCRIPT} ${controlId}`);

    console.log(JSON.stringify({ ok: true, location: LOCATION, previousControlId: existingControlId, controlId }, null, 2));
  } finally {
    client.close();
  }
}

main().catch((error) => {
  console.error(error.stack || error.message || error);
  process.exit(1);
});
