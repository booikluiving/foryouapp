const { execFileSync } = require("child_process");

const DB_PATH = "/Users/for_you/Library/Application Support/companion/v4.3/db.sqlite";
const TRPC_URL = "ws://127.0.0.1:8008/trpc";
const HEALTH_URL = "http://127.0.0.1:3310/health";
const STATE_URL = "http://127.0.0.1:3310/admin/algorithm/state";

const WHITE = 16777215;
const BLACK = 0;
const GREEN = 51200;
const RED = 13107200;
const ORANGE = 16753920;
const BLUE = 22456;
const TEAL = 33792;
const DIM_COLOR = 8421504;
const DIM_BG = 0;

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

async function serverIsOn() {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 1000);
  try {
    const response = await fetch(HEALTH_URL, { signal: controller.signal });
    return response.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

async function readAppState() {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 1000);
  try {
    const response = await fetch(STATE_URL, { signal: controller.signal });
    const body = await response.json().catch(() => null);
    if (!response.ok || !body || !body.ok) return null;
    return body;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function showIsActive(state) {
  return !!(state && state.session && state.session.isActive);
}

function showButtonStyle(state, isOn) {
  if (!isOn) return { text: "START\nSHOW", size: "21", color: DIM_COLOR, bgcolor: DIM_BG };
  if (!state) return { text: "SHOW\nERROR", size: "18", color: WHITE, bgcolor: RED };
  return showIsActive(state)
    ? { text: "STOP\nSHOW", size: "21", color: WHITE, bgcolor: RED }
    : { text: "START\nSHOW", size: "21", color: WHITE, bgcolor: BLUE };
}

function sceneButtonStyle(state, isOn) {
  if (!isOn) return { text: "SITUATIE\nUIT", size: "13", color: DIM_COLOR, bgcolor: DIM_BG };
  if (!state) return { text: "SIT.\nERROR", size: "18", color: WHITE, bgcolor: RED };
  if (!showIsActive(state)) return { text: "SITUATIE\nUIT", size: "13", color: DIM_COLOR, bgcolor: DIM_BG };
  if (!state.activeRun && !nextSceneId(state)) return { text: "SITUATIE\nUIT", size: "13", color: DIM_COLOR, bgcolor: DIM_BG };
  return state && state.activeRun
    ? { text: "STOP\nSITUATIE", size: "15", color: BLACK, bgcolor: ORANGE }
    : { text: "VOLG.\nSITUATIE", size: "15", color: WHITE, bgcolor: TEAL };
}

function nextSceneId(state) {
  return Number(state && state.currentOrder && state.currentOrder.next && state.currentOrder.next.sceneId || 0);
}

async function styleButton(client, page, button) {
  const controlId = controlIdAt(page, button.row, button.column);
  if (!controlId) throw new Error(`Missing page 2 control at row ${button.row}, column ${button.column}`);
  await client.call("controls.setStyleFields", {
    controlId,
    styleFields: {
      text: button.text,
      size: button.size,
      color: button.color,
      bgcolor: button.bgcolor,
    },
  });
  return { ...button, controlId };
}

async function main() {
  const isOn = await serverIsOn();
  const state = isOn ? await readAppState() : null;
  const webOn = (color, bgcolor) => isOn ? { color, bgcolor } : { color: DIM_COLOR, bgcolor: DIM_BG };
  const showButton = showButtonStyle(state, isOn);
  const sceneButton = sceneButtonStyle(state, isOn);
  const buttons = [
    { row: 0, column: 0, text: isOn ? "SERVER\nAAN" : "SERVER\nUIT", size: "18", color: WHITE, bgcolor: isOn ? GREEN : RED },
    { row: 0, column: 1, text: "SERVER\nHERSTART", size: "16", color: BLACK, bgcolor: ORANGE },

    { row: 1, column: 0, text: "OPEN\nADMIN", size: "21", ...webOn(WHITE, BLUE) },
    { row: 1, column: 1, text: "ALGO\nRITME", size: "21", ...webOn(WHITE, BLUE) },
    { row: 1, column: 2, text: "UNIVERSE", size: "18", ...webOn(WHITE, BLUE) },
    { row: 1, column: 3, text: "PADEN", size: "22", ...webOn(WHITE, BLUE) },
    { row: 1, column: 4, text: "API\nPLAY", size: "22", ...webOn(WHITE, BLUE) },
    { row: 1, column: 5, text: "PUBLIEK\nCHAT", size: "20", ...webOn(WHITE, BLUE) },
    { row: 1, column: 6, text: "TEKST\nPARSER", size: "18", ...webOn(WHITE, BLUE) },
    { row: 1, column: 7, text: "TD\nPREVIEW", size: "18", ...webOn(WHITE, BLUE) },

    { row: 2, column: 0, ...showButton },
    { row: 2, column: 2, ...sceneButton },
  ];

  const page = readPage(2);
  if (!page) throw new Error("Companion page 2 is missing");

  const client = makeTrpcClient();
  await client.ready;

  try {
    const styled = [];
    for (const button of buttons) {
      styled.push(await styleButton(client, page, button));
    }
    console.log(JSON.stringify({ ok: true, styled }, null, 2));
  } finally {
    client.close();
  }
}

main().catch((error) => {
  console.error(error.stack || error.message || error);
  process.exit(1);
});
