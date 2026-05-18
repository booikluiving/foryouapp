#!/usr/bin/env node

const net = require("net");
const { protocol, state } = require("./server");

const host = String(process.env.SQ5_HOST || process.argv[2] || state.mixerHost || "192.168.1.129").trim();
const cliPort = Number(process.argv[3]);
const hasCliPort = Number.isFinite(cliPort) && cliPort > 0;
const port = Number(process.env.SQ5_MIXER_PORT || (hasCliPort ? cliPort : "") || state.mixerPort || 51325);
const requestedTokens = process.argv.slice(hasCliPort ? 4 : 3);
const timeoutMs = Number(process.env.SQ5_TCP_TIMEOUT_MS || 1800);
const responseWindowMs = Number(process.env.SQ5_MIDI_RESPONSE_WINDOW_MS || 90);

function connect() {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection({ host, port });
    const timer = setTimeout(() => {
      socket.destroy();
      reject(new Error(`TCP timeout naar ${host}:${port}`));
    }, timeoutMs);

    socket.setNoDelay(true);
    socket.setKeepAlive(true, 1000);
    socket.on("connect", () => {
      clearTimeout(timer);
      resolve(socket);
    });
    socket.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
  });
}

function request(socket, bytes) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let settled = false;
    let quietTimer = null;
    const timeoutTimer = setTimeout(() => finish(new Error(`TCP timeout tijdens request naar ${host}:${port}`)), timeoutMs);

    const cleanup = () => {
      clearTimeout(quietTimer);
      clearTimeout(timeoutTimer);
      socket.off("data", onData);
      socket.off("error", onError);
      socket.off("close", onClose);
    };

    const finish = (error) => {
      if (settled) return;
      settled = true;
      cleanup();
      if (error) {
        reject(error);
        return;
      }
      resolve(Buffer.concat(chunks).toString("hex").toUpperCase().replace(/(..)/g, "$1 ").trim());
    };

    const armQuietTimer = () => {
      clearTimeout(quietTimer);
      quietTimer = setTimeout(() => finish(), responseWindowMs);
    };

    function onData(chunk) {
      chunks.push(chunk);
      armQuietTimer();
    }

    function onError(error) {
      if (chunks.length) finish();
      else finish(error);
    }

    function onClose() {
      if (chunks.length) finish();
      else finish(new Error("TCP verbinding gesloten"));
    }

    socket.on("data", onData);
    socket.on("error", onError);
    socket.on("close", onClose);
    socket.write(Buffer.from(bytes), (error) => {
      if (error) finish(error);
      else armQuietTimer();
    });
  });
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function range(prefix, count) {
  return Array.from({ length: count }, (_, index) => `${prefix}${index + 1}`);
}

async function readOutput(socket, token) {
  const target = protocol.outputTargetFromToken(token);
  const muteBytes = protocol.outputGetBytes(target, "mute");
  const muteHex = await request(socket, muteBytes);
  await wait(20);
  const mute = protocol.decodeResponseValue(muteHex, { action: "get", parameter: "mute" });

  let level = null;
  let levelHex = "";
  if (target.level) {
    const levelBytes = protocol.outputGetBytes(target, "level");
    levelHex = await request(socket, levelBytes);
    await wait(20);
    level = protocol.decodeResponseValue(levelHex, { action: "get", parameter: "level" });
  }

  return {
    token,
    label: target.label,
    type: target.type,
    mute: mute ? mute.value : null,
    levelDb: level ? Number(level.value.toFixed(1)) : null,
    muteHex,
    levelHex,
  };
}

async function main() {
  if (!host) throw new Error("Geen SQ5_HOST opgegeven");
  const defaultTokens = [
    "main",
    "mics",
    "muziek",
    ...range("group", 12),
    ...range("aux", 12),
    ...range("mtx", 3),
    ...range("dca", 8),
    ...range("fxsend", 4),
    ...range("fxreturn", 8),
  ];
  const tokens = requestedTokens.length ? requestedTokens : defaultTokens;

  const rows = [];
  for (const token of tokens) {
    const socket = await connect();
    try {
      rows.push(await readOutput(socket, token));
    } catch (error) {
      rows.push({
        token,
        label: token,
        type: "unknown",
        mute: null,
        levelDb: null,
        error: error.message || String(error),
      });
    } finally {
      socket.destroy();
    }
    await wait(60);
  }

  const printable = rows.map((row) => ({
    token: row.token,
    label: row.label,
    type: row.type,
    mute: row.mute,
    levelDb: row.levelDb,
    error: row.error || "",
  }));
  console.table(printable);
  console.log("\nActieve/niet -inf kandidaten:");
  console.table(printable.filter((row) => row.mute || (typeof row.levelDb === "number" && row.levelDb > -89)));
}

main().catch((error) => {
  console.error(error.message || String(error));
  process.exit(1);
});
