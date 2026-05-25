const { execFileSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const DB_PATH = "/Users/for_you/Library/Application Support/companion/v4.3/db.sqlite";
const CACHE_PATH = "/Users/for_you/Library/Caches/ForYouApp/sq5-streamdeck-state.json";
const TRPC_URL = "ws://127.0.0.1:8008/trpc";
const STATE_URL = "http://127.0.0.1:3105/api/streamdeck/state";

const WHITE = 16777215;
const BLACK = 0;
const RED = 13107200;
const DARK_GREEN = 20480;
const DARK_GRAY = 4210752;
const AMBER = 16753920;

const args = new Set(process.argv.slice(2));

const buttons = [
  { label: "BRENT MIC", field: "brent", row: 2, column: 3 },
  { label: "MEGAN MIC", field: "megan", row: 2, column: 4 },
  { label: "BOOI MIC", field: "booi", row: 2, column: 5 },
  { label: "ALL MICS", field: "allMics", mixedField: "allMicsMixed", row: 2, column: 6 },
  { label: "MAIN MUTE", field: "main", row: 2, column: 7 },
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

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function readCache() {
  try {
    return JSON.parse(fs.readFileSync(CACHE_PATH, "utf8"));
  } catch {
    return null;
  }
}

function writeCache(key) {
  try {
    fs.mkdirSync(path.dirname(CACHE_PATH), { recursive: true });
    fs.writeFileSync(CACHE_PATH, JSON.stringify({ key, updatedAt: new Date().toISOString() }));
  } catch (error) {
    console.error(error.stack || error.message || error);
  }
}

async function readState() {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 600);
  try {
    const response = await fetch(STATE_URL, { signal: controller.signal });
    const body = await response.json().catch(() => null);
    if (!response.ok || !body || typeof body !== "object") return null;
    return body;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function stateKey(state) {
  if (!state) return "error";
  return JSON.stringify({
    brent: state.brent,
    megan: state.megan,
    booi: state.booi,
    allMics: state.allMics,
    allMicsMixed: state.allMicsMixed,
    main: state.main,
  });
}

function valueText(value) {
  if (value === true) return "MUTED";
  if (value === false) return "ON";
  return "--";
}

function styleForButton(button, state) {
  if (!state) {
    return {
      text: `${button.label}\nERROR`,
      size: "11",
      color: WHITE,
      bgcolor: RED,
    };
  }

  if (button.mixedField && state[button.mixedField] === true) {
    return {
      text: `${button.label}\nMIXED`,
      size: "11",
      color: BLACK,
      bgcolor: AMBER,
    };
  }

  const muted = state[button.field];
  if (muted === true) {
    return {
      text: `${button.label}\nMUTED`,
      size: "11",
      color: WHITE,
      bgcolor: RED,
    };
  }
  if (muted === false) {
    return {
      text: `${button.label}\nON`,
      size: "11",
      color: WHITE,
      bgcolor: DARK_GREEN,
    };
  }

  return {
    text: `${button.label}\n--`,
    size: "11",
    color: WHITE,
    bgcolor: DARK_GRAY,
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

async function setStyle(client, controlId, styleFields) {
  if (!controlId) return;
  await client.call("controls.setStyleFields", { controlId, styleFields });
}

async function updateOnce(force = false) {
  const state = await readState();
  const key = stateKey(state);
  const cache = readCache();
  if (!force && cache && cache.key === key) {
    console.log("unchanged");
    return;
  }

  const page = readPage(1);
  if (!page) throw new Error("Companion page 1 is missing");

  const client = makeTrpcClient();
  await client.ready;
  try {
    for (const button of buttons) {
      await setStyle(client, controlIdAt(page, button.row, button.column), styleForButton(button, state));
    }
  } finally {
    client.close();
  }

  writeCache(key);
  console.log(key);
}

async function main() {
  const force = args.has("--force");
  if (args.has("--twice")) {
    await updateOnce(force);
    await sleep(500);
    await updateOnce(true);
  } else {
    await updateOnce(force);
  }
}

main().catch((error) => {
  console.error(error.stack || error.message || error);
  process.exit(1);
});
