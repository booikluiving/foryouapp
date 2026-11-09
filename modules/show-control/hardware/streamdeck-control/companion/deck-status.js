"use strict";

// Statusdienst voor het deck. Kijkt elke seconde naar de show-stack en zet per knop
// twee Companion-variabelen (fy_<key>_t = tekst, fy_<key>_s = staat). Alleen wat
// verandert wordt geschreven, dus Companion tekent alleen knoppen die echt veranderen.
//
//   node deck-status.js          blijft draaien (LaunchAgent nl.foryou.deck-status)
//   node deck-status.js --eenmaal   één ronde, schrijft niets, toont de staat

const { execFile } = require("node:child_process");
const path = require("node:path");
const {
  CONFIG,
  allButtons,
  fetchJson,
  heldUntil,
  loadDeck,
  log,
  setVar,
  teleprompterReadyGate,
  varStaat,
  varTekst,
} = require("./lib");

const TICK_MS = 1000;
const RESYNC_MS = 5 * 60 * 1000;
const TD_VERSION_MS = 30 * 1000;
const RECENT_WARNING_MS = 5 * 60 * 1000;

const CORE = {
  d_gateway: 3020, d_catalog: 3021, d_paths: 3022, d_algorithm: 3023,
  d_runtime: 3024, d_showcontrol: 3025, d_audience: 3026, d_scriptagent: 3027,
};
const HARDWARE = {
  d_sq5: "http://127.0.0.1:3225/api/status",
  d_camera: "http://127.0.0.1:3226/api/state",
  d_streamdeck: "http://127.0.0.1:3227/api/state",
  d_perfectcue: "http://127.0.0.1:3228/api/state",
  d_dmx: "http://127.0.0.1:3229/api/state",
};

function exec(file, argv, timeoutMs) {
  return new Promise((resolve) => {
    execFile(file, argv, { timeout: timeoutMs, encoding: "utf8" }, (error, stdout) => resolve({ ok: !error, stdout: String(stdout || "") }));
  });
}

async function udpPorts(ports) {
  const argv = ["-nP", ...ports.map((p) => `-iUDP:${p}`)];
  const { stdout } = await exec("lsof", argv, 800);
  const open = {};
  for (const p of ports) open[p] = new RegExp(`:${p}\\b`).test(stdout);
  return open;
}

let tdVersion = { at: 0, label: "TD" };
async function tdLabel() {
  if (Date.now() - tdVersion.at < TD_VERSION_MS) return tdVersion.label;
  const launcher = path.join(CONFIG.mainDir, "scripts", "open-current-showcontrol-td.command");
  const { ok, stdout } = await exec(launcher, ["status"], 3000);
  const version = ok && (stdout.match(/^version\|(.+)$/m) || [])[1];
  tdVersion = { at: Date.now(), label: version ? `TD\nv${version.trim()}` : "TD\n?" };
  return tdVersion.label;
}

async function gather() {
  const coreEntries = await Promise.all(Object.entries(CORE).map(async ([key, port]) => [key, (await fetchJson(`http://127.0.0.1:${port}/health`, { timeoutMs: 800 })).ok]));
  const hwEntries = await Promise.all(Object.entries(HARDWARE).map(async ([key, url]) => [key, await fetchJson(url, { timeoutMs: 800 })]));
  const [showStatus, runtime, sq5, teleprompter, ports, tdText] = await Promise.all([
    fetchJson(`${CONFIG.showControlUrl}/v0/show-control/status`, { timeoutMs: 1000 }),
    fetchJson(`${CONFIG.runtimeUrl}/v0/runtime/runs/current`, { timeoutMs: 1000 }),
    fetchJson(`${CONFIG.sq5Url}/api/streamdeck/state`, { timeoutMs: 1000 }),
    fetchJson(`${CONFIG.scriptAgentUrl}/v0/script-agent/teleprompter-parser/current`, { timeoutMs: 1000 }),
    udpPorts([9100, 9101]),
    tdLabel(),
  ]);
  return { core: Object.fromEntries(coreEntries), hw: Object.fromEntries(hwEntries), showStatus, runtime, sq5, teleprompter, ports, tdText };
}

const first = (label) => String(label).split("\n")[0];

function compute(deck, g) {
  const out = {};
  const showOk = g.core.d_showcontrol;
  const runtimeOk = g.core.d_runtime;
  const rt = g.runtime.ok ? g.runtime.body || {} : {};
  const activeRun = !!(rt.showRunId && rt.status !== "idle");
  const activeSit = !!rt.activeSituation;
  const prepared = !!rt.resolvedPreparedNext;
  const tdOsc = g.ports[9100];
  const tdAck = g.ports[9101];
  const showRuns = showOk && runtimeOk;
  const warnings = g.showStatus.ok && Array.isArray(g.showStatus.body.warnings)
    ? g.showStatus.body.warnings.filter((w) => {
      const at = Date.parse(w.at || "");
      return Number.isFinite(at) && Date.now() - at >= 0 && Date.now() - at <= RECENT_WARNING_MS;
    })
    : [];
  const sq5 = g.sq5.ok ? g.sq5.body || {} : {};
  const portOk = {};
  for (const [key, port] of Object.entries(CORE)) portOk[port] = g.core[key];
  for (const [key, url] of Object.entries(HARDWARE)) portOk[Number(new URL(url).port)] = g.hw[key].ok;

  const problems = [];
  for (const page of deck.paginas) {
    for (const knop of page.knoppen) {
      if (knop.actie && knop.actie.pagina && !knop.status) continue;
      const label = knop.label;
      const k = knop.key;
      const cue = knop.actie && knop.actie.cue;
      let t = label;
      let s = "uit";

      if (cue === "toggle-run") { t = activeRun ? "RESET\nRUN" : "START\nRUN"; s = showRuns ? (activeRun ? "actief" : "klaar") : "uit"; }
      else if (cue === "toggle-situation") { t = activeSit ? "STOP\nSIT" : "START\nSIT"; s = showRuns && activeRun ? (activeSit ? "actief" : "klaar") : "uit"; }
      else if (cue === "scene-chat") { s = showRuns && prepared ? "klaar" : "uit"; }
      else if (cue === "teleprompter-ready") { s = showRuns && g.teleprompter.ok && teleprompterReadyGate(rt, g.teleprompter.body).allowed ? "klaar" : "uit"; }
      else if (cue && cue.startsWith("phase-")) { s = showOk && tdOsc ? "klaar" : "uit"; }
      else if (cue && cue.startsWith("teleprompter-")) { s = showOk ? "klaar" : "uit"; }
      else if (cue && cue.startsWith("td-camera-")) { s = showOk && tdOsc && tdAck ? "camera" : "uit"; }
      else if (cue && cue.startsWith("sq5-")) {
        const target = cue.slice(4);
        const muted = sq5[target];
        if (sq5[`${target}Mixed`]) { t = `${first(label)}\nMIX`; s = "warn"; }
        else if (muted === true) { t = `${first(label)}\nMUTED`; s = "mute"; }
        else if (muted === false) { t = `${first(label)}\nON`; s = "aan"; }
        else { t = `${first(label)}\n--`; s = "uit"; }
      }
      else if (knop.actie && knop.actie.link) {
        const ok = !!portOk[Number(new URL(knop.actie.link).port)];
        t = ok ? label : `${first(label)}\nDOWN`;
        s = ok ? (k === "l_show" && warnings.length ? "warn" : "ok") : "fout";
      }
      else if (knop.actie && knop.actie.stack === "toggle") {
        const n = Object.values(g.core).filter(Boolean).length;
        const all = n === Object.keys(CORE).length;
        t = all ? "STACK\nAAN" : n ? "STACK\nDEELS" : "STACK\nUIT";
        s = all ? "ok" : n ? "warn" : "fout";
      }
      else if (knop.actie && knop.actie.stack === "restart") { s = showOk || runtimeOk ? "warn" : "uit"; }
      else if (knop.actie && knop.actie.td) { t = g.tdText; s = tdOsc ? "ok" : "klaar"; }
      else if (k === "tdosc" || k === "tdack") {
        const ok = k === "tdosc" ? tdOsc : tdAck;
        t = `${label}\n${ok ? "OK" : "DOWN"}`;
        s = ok ? "ok" : "fout";
        if (!ok) problems.push(label);
      }
      else if (k in CORE) {
        const ok = g.core[k];
        t = ok ? label : `${label}\nDOWN`;
        s = ok ? "ok" : "fout";
        if (!ok) problems.push(label);
      }
      else if (k in HARDWARE) {
        const r = g.hw[k];
        s = r.ok ? "ok" : "fout";
        t = r.ok ? label : `${label}\nDOWN`;
        if (r.ok && k === "d_camera" && r.body && r.body.cameras) {
          const cams = Object.values(r.body.cameras);
          const online = cams.filter((c) => c.online).length;
          t = `${label}\n${online}/${cams.length}`;
          if (online < cams.length) { s = "warn"; problems.push(`CAM ${online}/${cams.length}`); }
        }
        if (!r.ok) problems.push(label);
      }
      out[k] = { t, s };
    }
  }
  if (out.overzicht) {
    if (problems.length) out.overzicht = { t: `${problems.length} FOUT\n${problems[0]}`, s: "fout" };
    else if (warnings.length) out.overzicht = { t: `${warnings.length} WARN\nSHOW`, s: "warn" };
    else out.overzicht = { t: "STATUS\nOK", s: "ok" };
  }
  return out;
}

async function loop() {
  const deck = loadDeck();
  const written = new Map(); // varnaam -> waarde zoals laatst naar Companion gestuurd
  const held = new Set();
  let lastResync = Date.now();
  let companionUp = false;
  log({ dienst: "deck-status", start: true, companion: CONFIG.companionUrl, knoppen: allButtons(deck).length });

  for (;;) {
    const started = Date.now();
    try {
      const want = compute(deck, await gather());
      if (Date.now() - lastResync > RESYNC_MS) { written.clear(); lastResync = Date.now(); }
      let failed = 0;
      for (const [key, { t, s }] of Object.entries(want)) {
        if (heldUntil(key) > Date.now()) { held.add(key); continue; }
        if (held.delete(key)) { written.delete(varTekst(key)); written.delete(varStaat(key)); }
        for (const [name, value] of [[varTekst(key), t], [varStaat(key), s]]) {
          if (written.get(name) === value) continue;
          if (await setVar(name, value)) written.set(name, value);
          else { failed += 1; break; }
        }
        if (failed) break;
      }
      if (failed) {
        if (companionUp) log({ dienst: "deck-status", companion: "onbereikbaar" });
        companionUp = false;
        written.clear(); // na herstart van Companion alles opnieuw sturen
      } else if (!companionUp) {
        companionUp = true;
        log({ dienst: "deck-status", companion: "bereikbaar" });
      }
    } catch (err) {
      log({ dienst: "deck-status", fout: String(err && err.stack || err) });
    }
    await new Promise((resolve) => setTimeout(resolve, Math.max(100, TICK_MS - (Date.now() - started))));
  }
}

async function once() {
  const deck = loadDeck();
  const want = compute(deck, await gather());
  for (const [key, { t, s }] of Object.entries(want)) console.log(`${key.padEnd(22)} ${s.padEnd(8)} ${t.replace(/\n/g, " | ")}`);
}

if (require.main === module) {
  if (process.argv.includes("--eenmaal")) once();
  else loop();
}

module.exports = { compute };
