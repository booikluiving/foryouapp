const { execFileSync } = require("child_process");

const DB_PATH = "/Users/for_you/Library/Application Support/companion/v4.3/db.sqlite";
const TRPC_URL = "ws://127.0.0.1:8008/trpc";
const COMPANION_NODE = "/Applications/Companion.app/Contents/Resources/node-runtimes/node22/bin/node";
const SQ5_STATUS_SCRIPT = "/Users/for_you/ForYou/companion-scripts/sq5-streamdeck-status-to-companion.js";
const SQ5_BASE_URL = "http://127.0.0.1:3105";
const STATUS_TRIGGER_NAME = "For You server status poll";

const WHITE = 16777215;
const DARK_GRAY = 4210752;

const sourceLocations = [
  { pageNumber: 1, row: 2, column: 3 },
  { pageNumber: 1, row: 2, column: 4 },
  { pageNumber: 1, row: 2, column: 5 },
  { pageNumber: 1, row: 2, column: 6 },
  { pageNumber: 1, row: 2, column: 7 },
];

const sq5Buttons = [
  { label: "BRENT MIC", target: "brent", row: 2, column: 3 },
  { label: "MEGAN MIC", target: "megan", row: 2, column: 4 },
  { label: "BOOI MIC", target: "booi", row: 2, column: 5 },
  { label: "ALL MICS", target: "allmics", row: 2, column: 6 },
  { label: "MAIN MUTE", target: "main", row: 2, column: 7 },
];

const misplacedSq5Locations = [
  { pageNumber: 1, row: 3, column: 3 },
  { pageNumber: 1, row: 3, column: 4 },
  { pageNumber: 1, row: 3, column: 5 },
  { pageNumber: 1, row: 3, column: 6 },
  { pageNumber: 1, row: 3, column: 7 },
];

const misplacedOscReturnLocations = [
  { from: { pageNumber: 2, row: 0, column: 3 }, to: { pageNumber: 1, row: 3, column: 3 } },
  { from: { pageNumber: 2, row: 0, column: 4 }, to: { pageNumber: 1, row: 3, column: 4 } },
  { from: { pageNumber: 2, row: 0, column: 5 }, to: { pageNumber: 1, row: 3, column: 5 } },
  { from: { pageNumber: 2, row: 0, column: 6 }, to: { pageNumber: 1, row: 3, column: 6 } },
];

function sqlite(sql) {
  return execFileSync("sqlite3", [DB_PATH, sql], { encoding: "utf8" }).trim();
}

function sqliteRows(sql) {
  return sqlite(sql).split(/\n+/).filter(Boolean);
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

function readOscConnectionIds() {
  const ids = [];
  for (const row of sqliteRows("SELECT id || char(9) || value FROM instances;")) {
    const [id, value] = row.split("\t");
    try {
      const parsed = JSON.parse(value);
      if (parsed && parsed.moduleId === "generic-osc") ids.push(id);
    } catch {}
  }
  return new Set(ids);
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

function isOscControl(control, oscConnectionIds) {
  if (!control || control.type !== "button") return false;
  return stepActions(control).some((action) => {
    const path = action?.options?.path?.value;
    return oscConnectionIds.has(action?.connectionId) || (typeof path === "string" && path.startsWith("/osc/"));
  });
}

function isSq5HttpControl(control) {
  if (!control || control.type !== "button") return false;
  return stepActions(control).some((action) => {
    const path = action?.options?.path?.value;
    return typeof path === "string" && path.includes(`${SQ5_BASE_URL}/api/streamdeck/`);
  });
}

function firstFreePage2Locations(count) {
  const page = readPage(2);
  if (!page) throw new Error("Companion page 2 is missing");
  const result = [];
  for (let row = 0; row <= 3; row++) {
    for (let column = 0; column <= 7; column++) {
      if (!page.controls?.[String(row)]?.[String(column)]) {
        result.push({ pageNumber: 2, row, column });
        if (result.length === count) return result;
      }
    }
  }
  throw new Error(`Not enough free positions on page 2; need ${count}, found ${result.length}`);
}

async function readSq5State() {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 600);
  try {
    const response = await fetch(`${SQ5_BASE_URL}/api/streamdeck/state`, { signal: controller.signal });
    const body = await response.json().catch(() => null);
    if (!response.ok || !body || typeof body !== "object") return null;
    return body;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function initialStyle(button, state) {
  const fieldByTarget = {
    brent: "brent",
    megan: "megan",
    booi: "booi",
    allmics: "allMics",
    main: "main",
  };

  if (button.target === "allmics" && state?.allMicsMixed === true) {
    return { text: `${button.label}\nMIXED`, size: "11", color: 0, bgcolor: 16753920 };
  }

  const value = state ? state[fieldByTarget[button.target]] : null;
  if (value === true) return { text: `${button.label}\nMUTED`, size: "11", color: WHITE, bgcolor: 13107200 };
  if (value === false) return { text: `${button.label}\nON`, size: "11", color: WHITE, bgcolor: 20480 };
  return { text: `${button.label}\n--`, size: "11", color: WHITE, bgcolor: DARK_GRAY };
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

async function setExecOptions(client, controlId, entityLocation, entityId, command, timeout = 3000) {
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

async function addExecAction(client, controlId, command, timeout = 3000) {
  const entityLocation = { stepId: "0", setId: "down" };
  const entityId = await client.call("controls.entities.add", {
    controlId,
    entityLocation,
    ownerId: null,
    connectionId: "internal",
    entityType: "action",
    entityDefinition: "exec",
  });
  await setExecOptions(client, controlId, entityLocation, entityId, command, timeout);
}

async function createSq5Button(client, button, state) {
  const location = { pageNumber: 1, row: button.row, column: button.column };
  await client.call("controls.resetControl", { location });
  await client.call("controls.resetControl", { location, newType: "button" });
  await new Promise((resolve) => setTimeout(resolve, 50));

  const controlId = controlIdAt(location);
  if (!controlId) throw new Error(`Missing control id at page 1 row ${button.row} column ${button.column}`);

  await client.call("controls.setStyleFields", {
    controlId,
    styleFields: initialStyle(button, state),
  });

  await addExecAction(
    client,
    controlId,
    `/usr/bin/curl -fsS --max-time 2 -X POST ${SQ5_BASE_URL}/api/streamdeck/${button.target}/toggle`
  );

  return { controlId, ...location, target: button.target };
}

async function restoreMisplacedBottomRow(client, oscConnectionIds) {
  const restored = [];
  const bottomHasSq5 = misplacedSq5Locations.some((location) => {
    const controlId = controlIdAt(location);
    return controlId && isSq5HttpControl(readControl(controlId));
  });

  if (!bottomHasSq5) return restored;

  for (const pair of misplacedOscReturnLocations) {
    const sourceId = controlIdAt(pair.from);
    const sourceControl = sourceId ? readControl(sourceId) : null;
    const targetId = controlIdAt(pair.to);
    const targetControl = targetId ? readControl(targetId) : null;

    if (targetId && isSq5HttpControl(targetControl)) {
      await client.call("controls.resetControl", { location: pair.to });
    }

    if (sourceId && isOscControl(sourceControl, oscConnectionIds) && !controlIdAt(pair.to)) {
      const ok = await client.call("controls.moveControl", {
        fromLocation: pair.from,
        toLocation: pair.to,
      });
      if (!ok) throw new Error(`Companion refused to restore ${sourceId}`);
      restored.push({ controlId: sourceId, from: pair.from, to: pair.to });
    }
  }

  const switcherLocation = { pageNumber: 1, row: 3, column: 7 };
  const switcherId = controlIdAt(switcherLocation);
  const switcherControl = switcherId ? readControl(switcherId) : null;
  if (switcherId && isSq5HttpControl(switcherControl)) {
    await client.call("controls.resetControl", { location: switcherLocation });
  }
  if (readControl(controlIdAt(switcherLocation) || "")?.type !== "pagedown") {
    await client.call("controls.resetControl", { location: switcherLocation });
    await client.call("controls.resetControl", { location: switcherLocation, newType: "pagedown" });
  }

  return restored;
}

function findStatusTriggerId() {
  const escapedName = STATUS_TRIGGER_NAME.replaceAll("'", "''");
  return sqliteRows(
    `SELECT id FROM controls WHERE json_extract(value,'$.type')='trigger' AND json_extract(value,'$.options.name')='${escapedName}' LIMIT 1;`
  )[0] || "";
}

async function configureStatusPoll(client) {
  const triggerId = findStatusTriggerId();
  if (!triggerId) throw new Error(`Missing trigger: ${STATUS_TRIGGER_NAME}`);

  const trigger = readControl(triggerId);
  const command = `${COMPANION_NODE} ${SQ5_STATUS_SCRIPT}`;
  const entityLocation = "trigger_actions";
  const existing = Array.isArray(trigger?.actions)
    ? trigger.actions.find((action) => action?.options?.path?.value?.includes("sq5-streamdeck-status-to-companion.js"))
    : null;

  if (existing) {
    await setExecOptions(client, triggerId, entityLocation, existing.id, command, 1500);
  } else {
    const entityId = await client.call("controls.entities.add", {
      controlId: triggerId,
      entityLocation,
      ownerId: null,
      connectionId: "internal",
      entityType: "action",
      entityDefinition: "exec",
    });
    await setExecOptions(client, triggerId, entityLocation, entityId, command, 1500);
  }

  const intervalEvent = Array.isArray(trigger?.events)
    ? trigger.events.find((event) => event.type === "interval")
    : null;
  if (!intervalEvent) throw new Error(`Missing interval event on trigger ${STATUS_TRIGGER_NAME}`);

  await client.call("controls.events.setOption", {
    controlId: triggerId,
    eventId: intervalEvent.id,
    key: "seconds",
    value: 0.5,
  });

  return { triggerId, intervalSeconds: 0.5 };
}

async function main() {
  if (!readPage(1)) throw new Error("Companion page 1 is missing");
  if (!readPage(2)) throw new Error("Companion page 2 is missing");

  const oscConnectionIds = readOscConnectionIds();
  const oscMoves = [];
  for (const location of sourceLocations) {
    const controlId = controlIdAt(location);
    const control = controlId ? readControl(controlId) : null;
    if (controlId && isOscControl(control, oscConnectionIds)) {
      oscMoves.push({ fromLocation: location, controlId });
    }
  }

  const state = await readSq5State();

  const client = makeTrpcClient();
  await client.ready;
  try {
    const restored = await restoreMisplacedBottomRow(client, oscConnectionIds);
    const targetLocations = firstFreePage2Locations(oscMoves.length);
    const moved = [];
    for (let i = 0; i < oscMoves.length; i++) {
      const move = oscMoves[i];
      const toLocation = targetLocations[i];
      const ok = await client.call("controls.moveControl", {
        fromLocation: move.fromLocation,
        toLocation,
      });
      if (!ok) throw new Error(`Companion refused to move ${move.controlId}`);
      moved.push({ controlId: move.controlId, from: move.fromLocation, to: toLocation });
    }

    const configured = [];
    for (const button of sq5Buttons) {
      configured.push(await createSq5Button(client, button, state));
    }

    const poll = await configureStatusPoll(client);

    console.log(JSON.stringify({ ok: true, restored, moved, configured, poll }, null, 2));
  } finally {
    client.close();
  }
}

main().catch((error) => {
  console.error(error.stack || error.message || error);
  process.exit(1);
});
