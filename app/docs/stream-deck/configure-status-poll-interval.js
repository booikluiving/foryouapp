const { execFileSync } = require("child_process");

const DB_PATH = "/Users/for_you/Library/Application Support/companion/v4.3/db.sqlite";
const TRPC_URL = "ws://127.0.0.1:8008/trpc";
const STATUS_TRIGGER_NAME = "For You server status poll";
const intervalSeconds = Math.max(1, Number.parseInt(String(process.argv[2] || "1"), 10) || 1);

function sqlite(sql) {
  return execFileSync("sqlite3", [DB_PATH, sql], { encoding: "utf8" }).trim();
}

function readControl(controlId) {
  const escaped = controlId.replaceAll("'", "''");
  const value = sqlite(`SELECT value FROM controls WHERE id='${escaped}';`);
  return value ? JSON.parse(value) : null;
}

function findStatusTriggerId() {
  const escapedName = STATUS_TRIGGER_NAME.replaceAll("'", "''");
  const rows = sqlite(
    `SELECT id FROM controls WHERE json_extract(value,'$.type')='trigger' AND json_extract(value,'$.options.name')='${escapedName}' LIMIT 1;`
  );
  return rows.split(/\n+/).filter(Boolean)[0] || "";
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

async function main() {
  const triggerId = findStatusTriggerId();
  if (!triggerId) throw new Error(`Missing trigger: ${STATUS_TRIGGER_NAME}`);
  const trigger = readControl(triggerId);
  const intervalEvent = Array.isArray(trigger && trigger.events)
    ? trigger.events.find((event) => event.type === "interval")
    : null;
  if (!intervalEvent) throw new Error("Missing interval event on status trigger");

  const client = makeTrpcClient();
  await client.ready;
  try {
    await client.call("controls.events.setOption", {
      controlId: triggerId,
      eventId: intervalEvent.id,
      key: "seconds",
      value: intervalSeconds,
    });
    console.log(JSON.stringify({ ok: true, triggerId, intervalSeconds }, null, 2));
  } finally {
    client.close();
  }
}

main().catch((error) => {
  console.error(error.stack || error.message || error);
  process.exit(1);
});
