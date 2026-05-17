const { execFileSync } = require("child_process");

const DB_PATH = "/Users/for_you/Library/Application Support/companion/v4.3/db.sqlite";
const TRPC_URL = "ws://127.0.0.1:8008/trpc";

const OSC_SOURCE = { pageNumber: 1, row: 3, column: 7 };
const OSC_TARGET = { pageNumber: 2, row: 3, column: 0 };
const PAGE1_SWITCHER = { pageNumber: 1, row: 3, column: 7 };
const PAGE2_SWITCHER = { pageNumber: 2, row: 3, column: 7 };

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

async function createPageSwitcher(client, location) {
  await client.call("controls.resetControl", { location });
  await client.call("controls.resetControl", { location, newType: "pagedown" });
  return controlIdAt(location);
}

async function main() {
  const oscControlId = controlIdAt(OSC_SOURCE);
  if (!oscControlId) throw new Error("Missing OSC control at page 1 bottom-right");

  const existingTarget = controlIdAt(OSC_TARGET);
  if (existingTarget && existingTarget !== oscControlId) {
    throw new Error(`Refusing to overwrite page 2 bottom-left control ${existingTarget}`);
  }

  const client = makeTrpcClient();
  await client.ready;

  try {
    if (!existingTarget) {
      const moved = await client.call("controls.moveControl", {
        fromLocation: OSC_SOURCE,
        toLocation: OSC_TARGET,
      });
      if (!moved) throw new Error("Companion refused to move OSC control");
    }

    const page1SwitcherId = await createPageSwitcher(client, PAGE1_SWITCHER);
    const page2SwitcherId = await createPageSwitcher(client, PAGE2_SWITCHER);

    console.log(
      JSON.stringify(
        {
          ok: true,
          movedOscControlId: oscControlId,
          movedTo: OSC_TARGET,
          page1SwitcherId,
          page2SwitcherId,
        },
        null,
        2
      )
    );
  } finally {
    client.close();
  }
}

main().catch((error) => {
  console.error(error.stack || error.message || error);
  process.exit(1);
});
