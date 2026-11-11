"use strict";

// Wat een knop doet. Companion roept aan: node deck-actie.js <key>
// Het script start zichzelf los (detached) en keert meteen terug, zodat Companion
// nooit op een trage cue wacht. Uitkomst staat in ~/Library/Logs/ForYou/deck.log.

const { execFile, spawn } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const {
  CONFIG,
  DIR,
  allButtons,
  clearHold,
  fetchJson,
  hold,
  loadDeck,
  log,
  maatVan,
  setVar,
  teleprompterReadyGate,
  varMaat,
  varStaat,
  varTekst,
} = require("./lib");

const FLASH_MS = 1600;

const post = (pathName, body, timeoutMs = 5000) => ({ path: pathName, body, timeoutMs });
const cueActions = (name, actions, timeoutMs = 5000) => post("/v0/show-control/cues", { name, actions }, timeoutMs);

async function runtimeState() {
  const result = await fetchJson(`${CONFIG.runtimeUrl}/v0/runtime/runs/current`, { timeoutMs: 1200 });
  return result.ok && result.body ? result.body : null;
}

const skip = (tekst) => ({ skip: true, tekst });

function sq5Toggle(label, kind, target) {
  return async () => {
    const state = await fetchJson(`${CONFIG.sq5Url}/api/streamdeck/state`, { timeoutMs: 1200 });
    const current = state.ok && state.body ? state.body[target] : null;
    if (typeof current !== "boolean") return skip(`${label}\nSTATE?`);
    const muted = !current;
    const command = kind === "input" ? "sq5.input.mute" : "sq5.output.mute";
    const payload = kind === "input" ? { channel: target, muted } : { output: target, muted };
    return {
      bezig: `${label}\n${muted ? "MUTE" : "UNMUTE"}`,
      klaar: `${label}\n${muted ? "MUTED" : "ON"}`,
      request: cueActions(`Stream Deck ${label} ${muted ? "mute" : "unmute"}`, [
        { command, ackMode: "acknowledged-async", payload },
        { command: "streamdeck.status", ackMode: "fire-and-forget", payload: { button: target, label, state: "sync" } },
      ]),
    };
  };
}

function tdCamera(camera) {
  return async () => ({
    request: cueActions(`Stream Deck CAM ${camera} TD camera trigger`, [{
      command: "td.camera.set",
      ackMode: "acknowledged-async",
      timeoutMs: 1200,
      payload: { camera, cameraId: `camera:${camera}`, source: "streamdeck", cueIntent: "camera_trigger" },
    }]),
  });
}

function phase(label, phaseNumber, phaseName) {
  return async () => ({ request: post("/v0/show-control/cues/phase", { name: `Stream Deck ${label} phase`, phase: phaseNumber, phaseName }, 2500) });
}

// PerfectCue-afhandeling zelf zit in show-control (teleprompter.cue); hier alleen de knop.
function teleprompter(label, direction, key) {
  return async () => ({
    request: cueActions(`Stream Deck Perfect Cue ${label.toLowerCase()}`, [{
      command: "teleprompter.cue",
      ackMode: "acknowledged-async",
      timeoutMs: 2500,
      payload: { direction, key, source: "streamdeck-perfect-cue" },
    }]),
  });
}

// START RUN opent ook de publiekssessie (QR/join-link), tenzij er al een open is.
async function startAudienceSession() {
  const state = await fetchJson(`${CONFIG.audienceUrl}/audience/admin/state`, { timeoutMs: 1500 });
  if (state.ok && state.body && state.body.sessionJoin && state.body.sessionJoin.joinUrl) return { sessie: "al_open" };
  const result = await fetchJson(`${CONFIG.audienceUrl}/audience/admin/sessions/start`, { method: "POST", body: { name: "For_You" }, timeoutMs: 3000 });
  return { sessie: result.ok ? "gestart" : `fout_${result.status}`, ok: result.ok };
}

const CUES = {
  "toggle-run": async () => {
    const rt = await runtimeState();
    if (!rt) return skip("RUN\n--");
    if (rt.showRunId && rt.status !== "idle") {
      return {
        bezig: "RESET\n...",
        klaar: "RESET\nOK",
        request: cueActions("Stream Deck reset run", [{ command: "runtime.resetRun", ackMode: "acknowledged-async", payload: { showRunId: rt.showRunId }, timeoutMs: 5000 }]),
      };
    }
    return {
      bezig: "RUN\n...",
      klaar: "RUN\nOK",
      request: post("/v0/show-control/cues/start-run", { name: "Stream Deck start run", autoPrepareNext: true }),
      daarna: startAudienceSession,
    };
  },
  "toggle-situation": async () => {
    const rt = await runtimeState();
    if (!rt) return skip("SCENE\n--");
    if (!rt.showRunId || rt.status === "idle") return skip("NO\nRUN");
    if (rt.activeSituation) {
      return { bezig: "STOP\n...", klaar: "STOP\nOK", request: post("/v0/show-control/cues/stop-situation", { name: "Stream Deck stop situation", showRunId: rt.showRunId }) };
    }
    return {
      bezig: "START\n...",
      klaar: "START\nOK",
      request: post("/v0/show-control/cues/start-situation", { name: "Stream Deck start situation", showRunId: rt.showRunId, runtimeState: rt }),
    };
  },
  "scene-chat": async () => ({ request: post("/v0/show-control/cues/scene-to-chat", { name: "Stream Deck scene naar chat" }, 90000) }),
  "teleprompter-ready": async () => {
    const [rt, tp] = await Promise.all([
      runtimeState(),
      fetchJson(`${CONFIG.scriptAgentUrl}/v0/script-agent/teleprompter-parser/current`, { timeoutMs: 1200 }),
    ]);
    if (!rt || !tp.ok) return skip("READY\n--");
    if (!teleprompterReadyGate(rt, tp.body).allowed) return skip("READY\n--");
    return {
      request: cueActions("Stream Deck teleprompter ready", [{ command: "teleprompter.ready", ackMode: "acknowledged-async", timeoutMs: 1500, payload: { ready: true, source: "streamdeck" } }]),
    };
  },
  "phase-inloop": phase("INLOOP", 0, "inloop"),
  "phase-loading": phase("LOADING", 1, "loading"),
  "teleprompter-prev": teleprompter("PREV", "prev", "PageUp"),
  "teleprompter-next": teleprompter("NEXT", "next", "PageDown"),
  "td-camera-1": tdCamera("1"),
  "td-camera-2": tdCamera("2"),
  "td-camera-3": tdCamera("3"),
  "sq5-brent": sq5Toggle("BRENT", "input", "brent"),
  "sq5-megan": sq5Toggle("MEGAN", "input", "megan"),
  "sq5-booi": sq5Toggle("BOOI", "input", "booi"),
  "sq5-mics": sq5Toggle("MICS", "output", "mics"),
  "sq5-muziek": sq5Toggle("MUZIEK", "output", "muziek"),
  "sq5-main": sq5Toggle("MAIN", "output", "main"),
};

async function flash(key, tekst, staat, ms = FLASH_MS) {
  hold(key, ms + 500);
  await Promise.all([setVar(varTekst(key), tekst), setVar(varStaat(key), staat)]);
}

function firstLine(label) {
  return String(label).split("\n")[0];
}

function run(file, argv, timeoutMs) {
  return new Promise((resolve) => {
    execFile(file, argv, { timeout: timeoutMs, encoding: "utf8" }, (error, stdout, stderr) => {
      resolve({ ok: !error, stdout: String(stdout || "").trim(), stderr: String(stderr || "").trim(), error: error ? String(error.message || error) : "" });
    });
  });
}

async function doCue(knop) {
  const label = firstLine(knop.label);
  const resolved = await CUES[knop.actie.cue]();
  if (resolved.skip) {
    await flash(knop.key, resolved.tekst, "uit");
    return { ok: true, overgeslagen: resolved.tekst };
  }
  await flash(knop.key, resolved.bezig || `${label}\n...`, "bezig", (resolved.request.timeoutMs || 5000) + 1000);
  const { request } = resolved;
  if (CONFIG.droog) {
    await new Promise((resolve) => setTimeout(resolve, 300));
    await flash(knop.key, resolved.klaar || `${label}\nOK`, "gelukt");
    return { ok: true, droog: true, post: `${CONFIG.showControlUrl}${request.path}`, body: request.body };
  }
  const result = await fetchJson(`${CONFIG.showControlUrl}${request.path}`, { method: "POST", body: request.body, timeoutMs: request.timeoutMs });
  const cueState = result.body && result.body.cue && result.body.cue.status && result.body.cue.status.state;
  const ok = result.ok && result.body && result.body.ok !== false && cueState !== "warning" && cueState !== "failed";
  let daarna;
  if (ok && resolved.daarna) daarna = await resolved.daarna();
  await flash(knop.key, ok ? resolved.klaar || `${label}\nOK` : `${label}\nFAIL`, ok ? "gelukt" : "mislukt");
  return { ok, status: result.status, cueState, cueId: result.body && result.body.cue && result.body.cue.cueId, daarna, fout: ok ? undefined : result.body };
}

// Extra shot of extra geluid van de omgeving die nu speelt (of klaarstaat).
async function doExtra(knop) {
  const soort = knop.actie.extra;
  const label = firstLine(knop.label);
  const toon = async (tekst, staat, ms) => {
    await setVar(varMaat(knop.key), maatVan(tekst));
    await flash(knop.key, tekst, staat, ms);
  };
  const body = { soort, source: "streamdeck" };
  if (CONFIG.droog) {
    await toon(`${label}\nOK`, "gelukt");
    return { ok: true, droog: true, post: `${CONFIG.showControlUrl}/v0/show-control/cues/environment-extra`, body };
  }
  await toon(`${label}\n...`, "bezig", 6000);
  const result = await fetchJson(`${CONFIG.showControlUrl}/v0/show-control/cues/environment-extra`, { method: "POST", body, timeoutMs: 5000 });
  if (result.status === 409) {
    await toon(`${label}\nLEEG`, "uit");
    return { ok: true, leeg: result.body && result.body.error };
  }
  const cueState = result.body && result.body.cue && result.body.cue.status && result.body.cue.status.state;
  const ok = result.ok && result.body && result.body.ok !== false && cueState !== "warning" && cueState !== "failed";
  await toon(`${label}\n${ok ? "OK" : "FAIL"}`, ok ? "gelukt" : "mislukt");
  return { ok, status: result.status, cueState, cueId: result.body && result.body.cue && result.body.cue.cueId, fout: ok ? undefined : result.body };
}

// Eenmalige autofocus van één camera, rechtstreeks via de camera-interface (:3226).
async function doAutofocus(knop) {
  const label = firstLine(knop.label);
  const url = `${CONFIG.cameraUrl}/api/camera/${encodeURIComponent(knop.actie.autofocus)}/autofocus`;
  if (CONFIG.droog) {
    await flash(knop.key, `${label}\nOK`, "gelukt");
    return { ok: true, droog: true, post: url };
  }
  await flash(knop.key, `${label}\n...`, "bezig", 6000);
  const result = await fetchJson(url, { method: "POST", body: {}, timeoutMs: 5000 });
  const ok = result.ok && result.body && result.body.ok !== false;
  await flash(knop.key, `${label}\n${ok ? "OK" : "FAIL"}`, ok ? "gelukt" : "mislukt");
  return { ok, status: result.status, fout: ok ? undefined : result.body };
}

async function doLink(knop) {
  if (CONFIG.droog) return { ok: true, droog: true, link: knop.actie.link };
  const result = await run(path.join(DIR, "browser-tabs.sh"), ["open-or-focus", knop.actie.link], 15000);
  if (!result.ok) await flash(knop.key, `${firstLine(knop.label)}\nFAIL`, "mislukt");
  return result;
}

// STACK en RESTART delen één slot: twee setups tegelijk laten diensten half geladen achter.
function takeStackLock() {
  const lock = path.join(CONFIG.holdDir, "stack.lock");
  fs.mkdirSync(CONFIG.holdDir, { recursive: true });
  try {
    fs.writeFileSync(lock, String(process.pid), { flag: "wx" });
    return () => { try { fs.unlinkSync(lock); } catch (_err) {} };
  } catch (_err) {
    const pid = Number(fs.readFileSync(lock, "utf8")) || 0;
    let alive = false;
    try { process.kill(pid, 0); alive = pid > 0; } catch (_e) {}
    if (alive) return null;
    fs.writeFileSync(lock, String(process.pid));
    return () => { try { fs.unlinkSync(lock); } catch (_e) {} };
  }
}

async function doStack(knop) {
  const label = firstLine(knop.label);
  const release = takeStackLock();
  if (!release) {
    await flash(knop.key, `${label}\nBEZIG`, "bezig");
    return { ok: true, overgeslagen: "stack_al_bezig" };
  }
  try {
    await flash(knop.key, `${label}\n...`, "bezig", 250000);
    const result = CONFIG.droog ? { ok: true, droog: true } : await run(path.join(DIR, "stack.sh"), [knop.actie.stack], 240000);
    await flash(knop.key, `${label}\n${result.ok ? "OK" : "FAIL"}`, result.ok ? "gelukt" : "mislukt");
    return result;
  } finally {
    release();
  }
}

// Directe OSC naar TD (V1-route, UDP 8008): /adres 1 bij indrukken, 0 erna, zoals de oude Companion-knop.
function oscInt(address, value) {
  const pad = (b) => Buffer.concat([b, Buffer.alloc(4 - (b.length % 4))]);
  const n = Buffer.alloc(4);
  n.writeInt32BE(value);
  return Buffer.concat([pad(Buffer.from(address)), pad(Buffer.from(",i")), n]);
}

async function doOsc(knop) {
  const { adres, poort = 8008, host = "127.0.0.1" } = knop.actie.osc;
  if (CONFIG.droog) {
    await flash(knop.key, `${firstLine(knop.label)}\nOK`, "gelukt");
    return { ok: true, droog: true, osc: `${host}:${poort}${adres}` };
  }
  const dgram = require("node:dgram");
  const socket = dgram.createSocket("udp4");
  const send = (value) => new Promise((resolve, reject) => socket.send(oscInt(adres, value), poort, host, (err) => (err ? reject(err) : resolve())));
  try {
    await send(1);
    await new Promise((resolve) => setTimeout(resolve, 120));
    await send(0);
    await flash(knop.key, `${firstLine(knop.label)}\nOK`, "gelukt");
    return { ok: true, osc: `${host}:${poort}${adres}` };
  } catch (err) {
    await flash(knop.key, `${firstLine(knop.label)}\nFAIL`, "mislukt");
    return { ok: false, fout: String(err.message || err) };
  } finally {
    socket.close();
  }
}

async function doTd(knop) {
  await flash(knop.key, "TD\n...", "bezig", 20000);
  // Draait TD al, dan alleen naar voren halen: een tweede open vervangt het lopende project.
  const running = await run("/usr/bin/pgrep", ["-x", "TouchDesigner"], 2000);
  if (running.ok) {
    const front = CONFIG.droog ? { ok: true } : await run("/usr/bin/open", ["-a", "TouchDesigner"], 5000);
    await flash(knop.key, front.ok ? "TD\nAL OPEN" : "TD\nFAIL", front.ok ? "gelukt" : "mislukt", 2500);
    return { ok: front.ok, td: "al_open_naar_voren" };
  }
  const launcher = path.join(CONFIG.mainDir, "scripts", "open-current-showcontrol-td.command");
  const result = CONFIG.droog ? { ok: true, droog: true } : await run(launcher, [knop.actie.td], 15000);
  await flash(knop.key, result.ok ? "TD\nOPEN" : "TD\nFAIL", result.ok ? "gelukt" : "mislukt", 2500);
  return result;
}

// Omgevingsknop: de volgende fase, de volgende kast of terug naar het begin, afhankelijk van
// de omgeving die nu speelt. Show control bepaalt wat de knop doet.
async function doOmgeving(knop) {
  const toon = async (tekst, staat, ms) => {
    await setVar(varMaat(knop.key), maatVan(tekst));
    await flash(knop.key, tekst, staat, ms);
  };
  const body = { plek: knop.actie.omgeving, source: "streamdeck" };
  const url = `${CONFIG.showControlUrl}/v0/show-control/cues/environment-knop`;
  if (CONFIG.droog) {
    await toon("OK", "gelukt");
    return { ok: true, droog: true, post: url, body };
  }
  const result = await fetchJson(url, { method: "POST", body, timeoutMs: 5000 });
  if (result.status === 409) return { ok: true, leeg: result.body && result.body.error };
  const ok = result.ok && result.body && result.body.ok !== false;
  if (!ok) await toon("FAIL", "mislukt");
  return { ok, status: result.status, cueId: result.body && result.body.cueId, naam: result.body && result.body.name, fout: ok ? undefined : result.body };
}

async function perform(key) {
  const knop = allButtons(loadDeck()).find((k) => k.key === key);
  if (!knop || !knop.actie) throw new Error(`geen knop met actie: ${key}`);
  const actie = knop.actie;
  try {
    if (actie.cue) return await doCue(knop);
    if (actie.link) return await doLink(knop);
    if (actie.stack) return await doStack(knop);
    if (actie.td) return await doTd(knop);
    if (actie.osc) return await doOsc(knop);
    if (actie.extra) return await doExtra(knop);
    if (Number.isInteger(actie.omgeving)) return await doOmgeving(knop);
    if (actie.autofocus) return await doAutofocus(knop);
    throw new Error(`actie onbekend voor ${key}`);
  } finally {
    // na de flits geeft deck-status.js de knop weer zijn echte staat
    setTimeout(() => clearHold(key), FLASH_MS).unref();
    await new Promise((resolve) => setTimeout(resolve, FLASH_MS + 50));
  }
}

async function main() {
  const argv = process.argv.slice(2);
  const nu = argv[0] === "--nu";
  const key = nu ? argv[1] : argv[0];
  if (!key) {
    console.error("gebruik: deck-actie.js <key>");
    process.exit(64);
  }
  if (!nu) {
    const child = spawn(process.execPath, [__filename, "--nu", key], { detached: true, stdio: "ignore", env: process.env });
    child.unref();
    return;
  }
  const started = Date.now();
  try {
    const result = await perform(key);
    log({ key, ms: Date.now() - started, ...result });
  } catch (err) {
    log({ key, ok: false, fout: String(err && err.message || err) });
    process.exitCode = 1;
  }
}

if (require.main === module) main();

module.exports = { CUES };
