const { execFileSync } = require("child_process");

const DB_PATH = "/Users/for_you/Library/Application Support/companion/v4.3/db.sqlite";
const TRPC_URL = "ws://127.0.0.1:8008/trpc";
const COMPANION_NODE = "/Applications/Companion.app/Contents/Resources/node-runtimes/node22/bin/node";
const BUTTON_SCRIPT = "/Users/for_you/ForYou/companion-scripts/foryou-operator-scene-to-chat-button.js";

const PREFERRED_LOCATION = { pageNumber: 2, row: 1, column: 6 };
const WHITE = 16777215;
const BLUE = 22456;

function sqlite(sql) {
  return execFileSync("sqlite3", [DB_PATH, sql], { encoding: "utf8" }).trim();
}

function readPage(pageNumber) {
  const value = sqlite(`SELECT value FROM pages WHERE id=${pageNumber};`);
  return value ? JSON.parse(value) : null;
}

function controlIdAt(location) {
  const page = readPage(location.pageNumber);
  return page?.controls?.[String(location.row)]?.[String(location.column)] || null;
}

function firstFreePage2Location() {
  const page = readPage(2);
  if (!page) throw new Error("Companion page 2 is missing");
  const preferred = controlIdAt(PREFERRED_LOCATION);
  if (!preferred) return PREFERRED_LOCATION;

  for (let row = 0; row <= 3; row++) {
    for (let column = 0; column <= 7; column++) {
      if (!page.controls?.[String(row)]?.[String(column)]) return { pageNumber: 2, row, column };
    }
  }
  throw new Error("No free position on page 2");
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

async function addExecAction(client, controlId, command, timeout = 10000) {
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
  if (!readPage(2)) throw new Error("Companion page 2 is missing");
  const location = firstFreePage2Location();

  const client = makeTrpcClient();
  await client.ready;

  try {
    await client.call("controls.resetControl", { location });
    await client.call("controls.resetControl", { location, newType: "button" });
    await new Promise((resolve) => setTimeout(resolve, 50));

    const controlId = controlIdAt(location);
    if (!controlId) throw new Error(`Missing control id at page ${location.pageNumber} row ${location.row} column ${location.column}`);

    await client.call("controls.setStyleFields", {
      controlId,
      styleFields: { text: "SCENE\nCHAT", size: "14", color: WHITE, bgcolor: BLUE },
    });

    await addExecAction(client, controlId, `${COMPANION_NODE} ${BUTTON_SCRIPT} ${controlId}`);

    console.log(JSON.stringify({ ok: true, controlId, location }, null, 2));
  } finally {
    client.close();
  }
}

main().catch((error) => {
  console.error(error.stack || error.message || error);
  process.exit(1);
});
