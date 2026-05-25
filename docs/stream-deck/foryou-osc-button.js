const { createRequire } = require("module");

const controlId = String(process.argv[2] || "").trim();
const actionName = String(process.argv[3] || "").trim().toLowerCase();

const TRPC_URL = process.env.COMPANION_TRPC_URL || "ws://127.0.0.1:8008/trpc";
const APP_STATE_URL = process.env.FORYOU_APP_STATE_URL || "http://127.0.0.1:3310/admin/algorithm/state";
const OSC_HOST = process.env.FORYOU_OSC_HOST || "127.0.0.1";
const OSC_PORT = Number(process.env.FORYOU_OSC_PORT || 1234);
const OSC_FEEDBACK_ADDRESS = process.env.FORYOU_OSC_FEEDBACK_ADDRESS || "/foryou/control/feedback";
const OSC_FEEDBACK_TIMEOUT_MS = Number(process.env.FORYOU_OSC_FEEDBACK_TIMEOUT_MS || 2500);
const RESTORE_AFTER_MS = Number(process.env.FORYOU_OSC_BUTTON_RESTORE_MS || 3500);

const WHITE = 16777215;
const BLACK = 0;
const START_BG = 22456;
const STOP_BG = 13107200;
const WAIT_BG = 16753920;
const OK_BG = 51200;
const ERROR_BG = 13107200;
const NO_FEEDBACK_BG = 16753920;

const actions = {
  start: {
    address: "/foryou/show/start",
    defaultText: "START\nSHOW",
    waitText: "START\nWACHT",
    defaultBg: START_BG,
  },
  stop: {
    address: "/foryou/show/stop",
    defaultText: "STOP\nSHOW",
    waitText: "STOP\nWACHT",
    defaultBg: STOP_BG,
  },
};

if (!controlId || !actions[actionName]) {
  console.error("Usage: node foryou-osc-button.js <controlId> <start|stop>");
  process.exit(64);
}

const action = actions[actionName];

function requireOsc() {
  const candidates = [
    process.env.FORYOU_APP_PACKAGE_JSON,
    "/Users/for_you/ForYou/main/app/package.json",
    "/Users/for_you/ForYou/App/app/package.json",
  ].filter(Boolean);

  for (const candidate of candidates) {
    try {
      return createRequire(candidate)("osc");
    } catch {}
  }

  return require("osc");
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
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

  return {
    ready,
    call,
    close: () => ws.close(),
  };
}

async function setButtonStyle(client, text, bgcolor, color = WHITE) {
  await client.call("controls.setStyleFields", {
    controlId,
    styleFields: { text, color, bgcolor },
  });
}

function argValue(arg) {
  if (arg && typeof arg === "object" && Object.prototype.hasOwnProperty.call(arg, "value")) return arg.value;
  return arg;
}

function parseFeedbackMessage(message) {
  const args = Array.isArray(message && message.args) ? message.args.map(argValue) : [];
  return {
    status: String(args[0] || "ok").toLowerCase() === "error" ? "error" : "ok",
    commandAddress: String(args[1] || ""),
    message: String(args[2] || ""),
    dataJson: String(args[3] || "{}"),
    timestamp: String(args[4] || ""),
  };
}

function sendOscAndWaitForFeedback() {
  return new Promise((resolve) => {
    const osc = requireOsc();
    const udpPort = new osc.UDPPort({
      localAddress: "127.0.0.1",
      localPort: 0,
      metadata: true,
    });

    let done = false;
    let sent = false;
    const finish = (result) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      try {
        udpPort.close();
      } catch {}
      resolve(result);
    };

    const timer = setTimeout(() => {
      finish({
        source: "timeout",
        status: sent ? "ok" : "error",
        message: sent ? "Geen OSC feedback ontvangen" : "OSC niet verzonden",
      });
    }, OSC_FEEDBACK_TIMEOUT_MS);

    udpPort.on("ready", () => {
      try {
        udpPort.send({ address: action.address, args: [] }, OSC_HOST, OSC_PORT);
        sent = true;
      } catch (error) {
        finish({
          source: "send_error",
          status: "error",
          message: error && error.message ? error.message : "OSC send failed",
        });
      }
    });

    udpPort.on("message", (message) => {
      if (String(message && message.address || "") !== OSC_FEEDBACK_ADDRESS) return;
      const feedback = parseFeedbackMessage(message);
      if (feedback.commandAddress && feedback.commandAddress !== action.address) return;
      finish({
        source: "osc_feedback",
        status: feedback.status,
        message: feedback.message || feedback.status,
        dataJson: feedback.dataJson,
        timestamp: feedback.timestamp,
      });
    });

    udpPort.on("error", (error) => {
      finish({
        source: "osc_error",
        status: "error",
        message: error && error.message ? error.message : "OSC error",
      });
    });

    udpPort.open();
  });
}

async function readAppState() {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 1200);
  try {
    const response = await fetch(APP_STATE_URL, { signal: controller.signal });
    if (!response.ok) return null;
    const state = await response.json();
    return state && state.ok ? state : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function stateFallbackResult(beforeState, afterState) {
  if (!afterState) return null;
  const beforeActive = !!(beforeState && beforeState.session && beforeState.session.isActive);
  const afterActive = !!(afterState.session && afterState.session.isActive);
  const runStarted = !!(afterState.algorithmRun && afterState.algorithmRun.started);
  if (actionName === "start" && afterActive && runStarted) {
    return { source: "state_check", status: "ok", message: "Show gestart met nieuwe sessie" };
  }
  if (actionName === "stop" && !afterActive) {
    return {
      source: "state_check",
      status: "ok",
      message: beforeActive ? "Show gestopt" : "Show stond al stil",
    };
  }
  return null;
}

function buttonTextFor(result) {
  const message = String(result && result.message || "").toLowerCase();
  const prefix = actionName === "start" ? "START" : "STOP";

  if (String(result && result.status || "") === "error") return `${prefix}\nERROR`;
  if (result && result.source === "timeout") return `${prefix}\nGEEN FB`;

  if (actionName === "start") {
    if (message.includes("nieuwe sessie")) return "START\nNIEUWE SESSIE";
    if (message.includes("gestart")) return "START\nGESTART";
    return "START\nOK";
  }

  if (message.includes("al stil")) return "STOP\nAL STIL";
  if (message.includes("gestopt")) return "STOP\nGESTOPT";
  return "STOP\nOK";
}

function buttonBgFor(result) {
  if (String(result && result.status || "") === "error") return ERROR_BG;
  if (result && result.source === "timeout") return NO_FEEDBACK_BG;
  return OK_BG;
}

async function main() {
  const client = makeTrpcClient();
  await client.ready;

  try {
    await setButtonStyle(client, action.waitText, WAIT_BG, BLACK);

    const beforeState = await readAppState();
    let result = await sendOscAndWaitForFeedback();
    if (result.source === "timeout") {
      const stateResult = stateFallbackResult(beforeState, await readAppState());
      if (stateResult) result = stateResult;
    }

    await setButtonStyle(client, buttonTextFor(result), buttonBgFor(result), WHITE);
    console.log(JSON.stringify({ ok: result.status !== "error", action: actionName, ...result }));

    if (RESTORE_AFTER_MS > 0) {
      await sleep(RESTORE_AFTER_MS);
      await setButtonStyle(client, action.defaultText, action.defaultBg, WHITE);
    }
  } finally {
    client.close();
  }
}

main().catch(async (error) => {
  const message = error && error.message ? error.message : String(error || "unknown");
  try {
    const client = makeTrpcClient();
    await client.ready;
    await setButtonStyle(client, `${actionName.toUpperCase()}\nERROR`, ERROR_BG, WHITE);
    client.close();
  } catch {}
  console.error(message);
  process.exit(1);
});
