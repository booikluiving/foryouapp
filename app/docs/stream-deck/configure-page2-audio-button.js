const { execFileSync } = require("child_process");

const DB_PATH = "/Users/for_you/Library/Application Support/companion/v4.3/db.sqlite";
const TRPC_URL = "ws://127.0.0.1:8008/trpc";
const AUDIO_TOGGLE_SCRIPT = "/Users/for_you/ForYou/companion-scripts/foryou-audio-toggle.sh";
const AUDIO_LOCATION = { pageNumber: 2, row: 3, column: 1 };
const ACTION_COMMAND = `${AUDIO_TOGGLE_SCRIPT} toggle`;
const WHITE = 16777215;
const BLACK = 0;
const GREEN = 51200;
const RED = 13107200;
const ORANGE = 16753920;
const DARK_GRAY = 4210752;

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

function isAudioControl(control) {
  return stepActions(control).some((action) => {
    const command = action?.options?.path?.value;
    return typeof command === "string" && command.includes("foryou-audio-toggle.sh");
  });
}

function readAudioStatus() {
  try {
    const output = execFileSync(AUDIO_TOGGLE_SCRIPT, ["status"], {
      encoding: "utf8",
      timeout: 2500,
    }).trim();
    if (output === "aan" || output === "uit" || output === "error") return output;
  } catch {}
  return "error";
}

function audioButtonStyle(status) {
  if (status === "aan") return { text: "AUDIO\nAAN", size: "19", color: WHITE, bgcolor: GREEN };
  if (status === "uit") return { text: "AUDIO\nUIT", size: "19", color: WHITE, bgcolor: RED };
  return { text: "AUDIO\nERROR", size: "15", color: BLACK, bgcolor: ORANGE };
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

  function call(requestPath, input) {
    return new Promise((resolve, reject) => {
      const requestId = id++;
      pending.set(requestId, { resolve, reject });
      ws.send(
        JSON.stringify({
          id: requestId,
          jsonrpc: "2.0",
          method: "mutation",
          params: { path: requestPath, input },
        })
      );
    });
  }

  return { ready, call, close: () => ws.close() };
}

function option(value) {
  return { isExpression: false, value };
}

async function setExecOptions(client, controlId, entityLocation, entityId, command, timeout = 15000) {
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

async function ensureExecAction(client, controlId, control) {
  const entityLocation = { stepId: "0", setId: "down" };
  const existing = stepActions(control).find((action) => {
    const command = action?.options?.path?.value;
    return typeof command === "string" && command.includes("foryou-audio-toggle.sh");
  });

  if (existing) {
    await setExecOptions(client, controlId, entityLocation, existing.id, ACTION_COMMAND);
    return existing.id;
  }

  const entityId = await client.call("controls.entities.add", {
    controlId,
    entityLocation,
    ownerId: null,
    connectionId: "internal",
    entityType: "action",
    entityDefinition: "exec",
  });
  await setExecOptions(client, controlId, entityLocation, entityId, ACTION_COMMAND);
  return entityId;
}

async function main() {
  if (!readPage(2)) throw new Error("Companion page 2 is missing");

  let controlId = controlIdAt(AUDIO_LOCATION);
  let control = controlId ? readControl(controlId) : null;

  if (controlId && !isAudioControl(control)) {
    throw new Error(
      `Refusing to overwrite page ${AUDIO_LOCATION.pageNumber} row ${AUDIO_LOCATION.row} column ${AUDIO_LOCATION.column}; existing control ${controlId} is not the audio button.`
    );
  }

  const client = makeTrpcClient();
  await client.ready;
  try {
    if (!controlId) {
      await client.call("controls.resetControl", { location: AUDIO_LOCATION, newType: "button" });
      await new Promise((resolve) => setTimeout(resolve, 50));
      controlId = controlIdAt(AUDIO_LOCATION);
      if (!controlId) throw new Error("Companion did not create the audio button control.");
      control = readControl(controlId);
    }

    await client.call("controls.setStyleFields", {
      controlId,
      styleFields: audioButtonStyle(readAudioStatus()),
    });
    await ensureExecAction(client, controlId, control);
  } finally {
    client.close();
  }

  console.log(JSON.stringify({ ok: true, controlId, location: AUDIO_LOCATION }, null, 2));
}

main().catch((error) => {
  console.error(error.stack || error.message || error);
  process.exit(1);
});
