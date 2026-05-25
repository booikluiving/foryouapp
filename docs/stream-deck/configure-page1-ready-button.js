const { execFileSync } = require("child_process");

const DB_PATH = "/Users/for_you/Library/Application Support/companion/v4.3/db.sqlite";
const TRPC_URL = "ws://127.0.0.1:8008/trpc";
const COMPANION_NODE = "/Applications/Companion.app/Contents/Resources/node-runtimes/node22/bin/node";
const READY_SCRIPT = "/Users/for_you/ForYou/companion-scripts/foryou-ready-toggle.js";
const LOCATION = { pageNumber: 1, row: 0, column: 4 };

const WHITE = 16777215;
const READY_BG = 13056;

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

function isReadyControl(control) {
  const text = String(control && control.style && control.style.text || "");
  return text === "Ready?" || text === "READY";
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
      ws.send(JSON.stringify({ id: requestId, jsonrpc: "2.0", method: "mutation", params: { path, input } }));
    });
  }
  return { ready, call, close: () => ws.close() };
}

function option(value) {
  return { isExpression: false, value };
}

async function addExecAction(client, controlId, command, timeout = 12000) {
  const entityLocation = { stepId: "0", setId: "down" };
  const entityId = await client.call("controls.entities.add", {
    controlId,
    entityLocation,
    ownerId: null,
    connectionId: "internal",
    entityType: "action",
    entityDefinition: "exec",
  });
  for (const [key, value] of [["path", command], ["cwd", ""], ["timeout", timeout], ["targetVariable", ""]]) {
    await client.call("controls.entities.setOption", { controlId, entityLocation, entityId, key, value: option(value) });
  }
}

async function main() {
  const existingControlId = controlIdAt(LOCATION);
  if (!existingControlId) throw new Error(`Missing Ready control at ${JSON.stringify(LOCATION)}`);
  const existingControl = readControl(existingControlId);
  if (!isReadyControl(existingControl)) {
    throw new Error(`Refusing to replace unexpected control at ${JSON.stringify(LOCATION)}: ${existingControlId}`);
  }

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
      styleFields: { text: "Ready?", size: "18", color: WHITE, bgcolor: READY_BG },
    });
    await addExecAction(client, controlId, `${COMPANION_NODE} ${READY_SCRIPT} ${controlId}`);
    console.log(JSON.stringify({ ok: true, location: LOCATION, previousControlId: existingControlId, controlId }, null, 2));
  } finally {
    client.close();
  }
}

main().catch((error) => {
  console.error(error.stack || error.message || error);
  process.exit(1);
});
