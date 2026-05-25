const controlId = String(process.argv[2] || "").trim();
const dryRun = process.argv.includes("--dry-run") || process.env.FORYOU_READY_DRY_RUN === "1";

const TRPC_URL = process.env.COMPANION_TRPC_URL || "ws://127.0.0.1:8008/trpc";
const BASE_URL = process.env.FORYOU_BASE_URL || "http://127.0.0.1:3310";
const RESTORE_AFTER_MS = Number(process.env.FORYOU_READY_RESTORE_MS || 900);

const WHITE = 16777215;
const BLACK = 0;
const GREEN = 51200;
const RED = 13107200;
const READY_BG = 13056;
const ORANGE = 16753920;

if (!controlId && !dryRun) {
  console.error("Usage: node foryou-ready-toggle.js <controlId> [--dry-run]");
  process.exit(64);
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
      ws.send(JSON.stringify({ id: requestId, jsonrpc: "2.0", method: "mutation", params: { path, input } }));
    });
  }
  return { ready, call, close: () => ws.close() };
}

async function setButtonStyle(client, style) {
  if (!client || !controlId || !style) return;
  await client.call("controls.setStyleFields", { controlId, styleFields: style });
}

function readyStyle(preparedScene) {
  if (preparedScene && preparedScene.ready) return { text: "READY", size: "21", color: WHITE, bgcolor: GREEN };
  return { text: "Ready?", size: "18", color: WHITE, bgcolor: READY_BG };
}

async function postReady() {
  if (dryRun) return { ok: true, dryRun: true, preparedScene: { ready: true } };
  const response = await fetch(`${BASE_URL}/admin/teleprompter-parser/ready`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ready: true }),
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok || !payload || !payload.ok) {
    throw new Error(payload && (payload.error || payload.message) || `ready_failed_${response.status}`);
  }
  return payload;
}

async function main() {
  const client = dryRun ? null : makeTrpcClient();
  if (client) await client.ready;
  try {
    if (client) await setButtonStyle(client, { text: "READY\nWACHT", size: "16", color: BLACK, bgcolor: ORANGE });
    const result = await postReady();
    if (client) {
      await setButtonStyle(client, { text: "READY", size: "21", color: WHITE, bgcolor: GREEN });
      if (RESTORE_AFTER_MS > 0) {
        await sleep(RESTORE_AFTER_MS);
        await setButtonStyle(client, readyStyle(result.preparedScene));
      }
    }
    console.log(JSON.stringify({ ok: true, dryRun, preparedScene: result.preparedScene || null }));
  } finally {
    if (client) client.close();
  }
}

main().catch(async (error) => {
  const message = error && error.message ? error.message : String(error || "unknown");
  try {
    if (!dryRun && controlId) {
      const client = makeTrpcClient();
      await client.ready;
      await setButtonStyle(client, { text: "READY\nERROR", size: "15", color: WHITE, bgcolor: RED });
      client.close();
    }
  } catch {}
  console.error(message);
  process.exit(1);
});
