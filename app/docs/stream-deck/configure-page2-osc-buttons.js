const { execFileSync } = require("child_process");

const DB_PATH = "/Users/for_you/Library/Application Support/companion/v4.3/db.sqlite";
const TRPC_URL = "ws://127.0.0.1:8008/trpc";
const COMPANION_NODE = "/Applications/Companion.app/Contents/Resources/node-runtimes/node22/bin/node";
const OSC_BUTTON_SCRIPT = "/Users/for_you/ForYou/companion-scripts/foryou-osc-button.js";

const WHITE = 16777215;
const START_BG = 22456;
const STOP_BG = 13107200;

const buttons = [
  { row: 2, column: 0, action: "start", title: "START\nSHOW", bgcolor: START_BG },
  { row: 2, column: 1, action: "stop", title: "STOP\nSHOW", bgcolor: STOP_BG },
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

async function createButton(client, button) {
  const location = { pageNumber: 2, row: button.row, column: button.column };
  await client.call("controls.resetControl", { location });
  await client.call("controls.resetControl", { location, newType: "button" });
  await new Promise((resolve) => setTimeout(resolve, 50));

  const page = readPage(2);
  const controlId = controlIdAt(page, button.row, button.column);
  if (!controlId) throw new Error(`Missing control id at row ${button.row}, column ${button.column}`);

  await client.call("controls.setStyleFields", {
    controlId,
    styleFields: {
      text: button.title,
      color: WHITE,
      bgcolor: button.bgcolor,
    },
  });

  await addExecAction(client, controlId, `${COMPANION_NODE} ${OSC_BUTTON_SCRIPT} ${controlId} ${button.action}`);

  return {
    controlId,
    row: button.row,
    column: button.column,
    action: button.action,
    title: button.title.replace("\n", " "),
  };
}

async function main() {
  if (!readPage(2)) throw new Error("Companion page 2 is missing; refusing to create pages from this script.");

  const client = makeTrpcClient();
  await client.ready;

  try {
    const configured = [];
    for (const button of buttons) {
      configured.push(await createButton(client, button));
    }

    console.log(JSON.stringify({ ok: true, configured }, null, 2));
  } finally {
    client.close();
  }
}

main().catch((error) => {
  console.error(error.stack || error.message || error);
  process.exit(1);
});
