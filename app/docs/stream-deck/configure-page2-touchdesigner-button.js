const { execFileSync } = require("child_process");

const DB_PATH = "/Users/for_you/Library/Application Support/companion/v4.3/db.sqlite";
const TRPC_URL = "ws://127.0.0.1:8008/trpc";
const TOUCHDESIGNER_SCRIPT = "/Users/for_you/ForYou/companion-scripts/open-current-touchdesigner.sh";

const LOCATION = { pageNumber: 2, row: 0, column: 2 };
const WHITE = 16777215;
const GREEN = 51200;
const RED = 13107200;
const TEAL = 33792;

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

function touchDesignerStatus() {
  try {
    const output = execFileSync(TOUCHDESIGNER_SCRIPT, ["status"], {
      encoding: "utf8",
      timeout: 2000,
    }).trim();
    return output === "aan" ? "aan" : "uit";
  } catch {
    return "error";
  }
}

function touchDesignerStyle(status) {
  if (status === "aan") return { text: "TD\nAAN", size: "22", color: WHITE, bgcolor: GREEN };
  if (status === "error") return { text: "TD\nERROR", size: "18", color: WHITE, bgcolor: RED };
  return { text: "OPEN\nTD", size: "22", color: WHITE, bgcolor: TEAL };
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
  if (!readPage(2)) throw new Error("Companion page 2 is missing; refusing to create pages from this script.");

  const client = makeTrpcClient();
  await client.ready;

  try {
    await client.call("controls.resetControl", { location: LOCATION });
    await client.call("controls.resetControl", { location: LOCATION, newType: "button" });
    await new Promise((resolve) => setTimeout(resolve, 50));

    const page = readPage(2);
    const controlId = controlIdAt(page, LOCATION.row, LOCATION.column);
    if (!controlId) throw new Error(`Missing control id at row ${LOCATION.row}, column ${LOCATION.column}`);

    await client.call("controls.setStyleFields", {
      controlId,
      styleFields: touchDesignerStyle(touchDesignerStatus()),
    });

    await addExecAction(client, controlId, TOUCHDESIGNER_SCRIPT);

    console.log(JSON.stringify({ ok: true, controlId, location: LOCATION }, null, 2));
  } finally {
    client.close();
  }
}

main().catch((error) => {
  console.error(error.stack || error.message || error);
  process.exit(1);
});
