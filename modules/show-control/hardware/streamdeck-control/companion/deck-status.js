"use strict";

const fs = require("node:fs");

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
  maatVan,
  pasLabel,
  sceneKnoppen,
  schrijfScenePlekken,
  setVar,
  standVan,
  showVolgorde,
  varMaat,
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
  const [showStatus, runtime, sq5, teleprompter, stem, sim, ports, tdText] = await Promise.all([
    fetchJson(`${CONFIG.showControlUrl}/v0/show-control/status`, { timeoutMs: 1000 }),
    fetchJson(`${CONFIG.runtimeUrl}/v0/runtime/runs/current`, { timeoutMs: 1000 }),
    fetchJson(`${CONFIG.sq5Url}/api/streamdeck/state`, { timeoutMs: 1000 }),
    fetchJson(`${CONFIG.scriptAgentUrl}/v0/script-agent/teleprompter-parser/current`, { timeoutMs: 1000 }),
    fetchJson(`${CONFIG.audienceUrl}/audience/stage/start-stemming`, { timeoutMs: 1000 }),
    fetchJson(`${CONFIG.audienceUrl}/audience/stage/simulatie`, { timeoutMs: 1000 }),
    udpPorts([9100, 9101, 8008]),
    tdLabel(),
  ]);
  return { core: Object.fromEntries(coreEntries), hw: Object.fromEntries(hwEntries), showStatus, runtime, sq5, teleprompter, stem, sim, ports, tdText };
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
  // De volgorde van een scène: wat nu niet mag is donker (zie showVolgorde in lib.js).
  const volgorde = showVolgorde(g.runtime.ok ? rt : null, g.teleprompter.ok ? g.teleprompter.body : null, g.stem && g.stem.ok ? g.stem.body : null);
  const warnings = g.showStatus.ok && Array.isArray(g.showStatus.body.warnings)
    ? g.showStatus.body.warnings.filter((w) => {
      const at = Date.parse(w.at || "");
      return Number.isFinite(at) && Date.now() - at >= 0 && Date.now() - at <= RECENT_WARNING_MS;
    })
    : [];
  const sq5 = g.sq5.ok ? g.sq5.body || {} : {};
  const extras = g.showStatus.ok ? g.showStatus.body.environmentExtras || null : null;
  // Omgevingsknoppen: wat er bij de omgeving van nu hoort (volgende fase, volgende kast, begin).
  const omgKnoppen = g.showStatus.ok && g.showStatus.body.environmentKnoppen
    ? g.showStatus.body.environmentKnoppen.knoppen || []
    : [];
  const portOk = {};
  for (const [key, port] of Object.entries(CORE)) portOk[port] = g.core[key];
  for (const [key, url] of Object.entries(HARDWARE)) portOk[Number(new URL(url).port)] = g.hw[key].ok;

  const problems = [];
  const scene = sceneKnoppen(deck);
  for (const page of [...deck.paginas, { id: "scene", knoppen: scene }]) {
    for (const knop of page.knoppen) {
      if (knop.soort === "nav" || (knop.actie && knop.actie.scenePlek)) continue;
      const label = knop.label;
      const k = knop.key;
      const cue = knop.actie && knop.actie.cue;
      let t = label;
      let s = "uit";

      if (cue === "toggle-run") {
        // START RUN (inloop) → CONTENT WARNING (als er een tekst is) → START SHOW (de eerste scène wordt gekozen) → RESET RUN.
        const wachtOpShow = activeRun && !activeSit && !(rt.playedSituations || []).length && !!(g.stem && g.stem.ok && g.stem.body && g.stem.body.showGestart === false);
        t = !activeRun ? "START\nRUN" : wachtOpShow ? (g.stem.body.waarschuwingNodig ? "CONTENT\nWARNING" : "START\nSHOW") : "RESET\nRUN";
        s = showRuns && volgorde.run.mag ? "klaar" : "uit";
      }
      else if (cue === "toggle-situation") { t = activeSit ? "STOP\nSCENE" : "START\nSCENE"; s = showRuns && activeRun && volgorde.sit.mag ? (activeSit ? "actief" : "klaar") : "uit"; }
      else if (cue === "scene-chat") { s = showRuns && volgorde.chat.mag ? "klaar" : "uit"; }
      else if (cue === "overslaan") { s = showRuns && volgorde.overslaan.mag ? "klaar" : "uit"; }
      else if (cue === "teleprompter-ready") {
        // Is READY gegeven, dan blijft de knop aan tot de scène start.
        if (showRuns && volgorde.ready && !activeSit) { t = "READY\nOK"; s = "aan"; }
        else s = showRuns && g.teleprompter.ok && volgorde.ready_knop.mag ? "klaar" : "uit";
      }
      else if (cue && cue.startsWith("phase-")) { s = showOk && tdOsc && volgorde.fase.mag ? "klaar" : "uit"; }
      else if (cue && cue.startsWith("teleprompter-")) { s = showOk ? "klaar" : "uit"; }
      else if (cue && cue.startsWith("td-camera-")) { s = showOk && tdOsc && tdAck ? "camera" : "uit"; }
      else if (cue && cue.startsWith("sq5-")) {
        const target = cue.slice(4);
        const muted = sq5[target];
        if (sq5[`${target}Mixed`]) { t = `${first(label)}\nMIX`; s = "warn"; }
        else if (muted === true) { t = `${first(label)}\nMUTED`; s = "mute"; }
        else if (muted === false) { t = `${first(label)}\nON`; s = "klaar"; }
        else { t = `${first(label)}\n?`; s = "onbekend"; }
      }
      else if (knop.actie && knop.actie.extra) {
        // tekst uit de catalogus (per omgeving); "Shot " mag weg als dat groter uitvalt
        const extra = extras && extras[knop.actie.extra];
        const regels = extra && extra.label ? pasLabel(extra.label, knop.actie.extra === "shot" ? "shot" : "") : [];
        if (!extras) { t = ""; s = "leeg"; }
        else if (extra && extra.klaar) { t = (regels.length ? regels : [first(label)]).join("\n"); s = extra.aan ? "actief" : "klaar"; }
        else {
          const naam = extra && extra.label ? pasLabel(String(extra.label).replace(/^shot\s+/i, ""))[0] : "";
          t = ""; s = "leeg"; void naam;
        }
      }
      else if (knop.actie && knop.actie.personage) {
        // nummer van een personage in de scène (Marit): leeg en donker als er geen is,
        // donker met de naam zolang de scène nog niet speelt, live zolang het nummer speelt
        const pk = g.showStatus.ok ? g.showStatus.body.personageKnop || null : null;
        if (!pk || !pk.label) { t = ""; s = "leeg"; }
        else { t = pasLabel(pk.label).join("\n"); s = pk.staat || "uit"; }
      }
      else if (knop.actie && Number.isInteger(knop.actie.omgeving)) {
        // leeg en donker als deze omgeving hier niets heeft
        const omg = omgKnoppen[knop.actie.omgeving];
        if (!omg) { t = ""; s = "leeg"; }
        else {
          t = pasLabel(omg.label).concat(omg.teller ? [omg.teller] : []).join("\n");
          s = omg.staat || "klaar";
        }
      }
      else if (knop.actie && knop.actie.link) {
        const ok = !!portOk[Number(new URL(knop.actie.link).port)];
        t = ok ? label : `${first(label)}\nDOWN`;
        s = ok ? "ok" : "fout";
      }
      else if (knop.actie && knop.actie.stack === "toggle") {
        const n = Object.values(g.core).filter(Boolean).length;
        const all = n === Object.keys(CORE).length;
        t = all ? "STACK\nAAN" : n ? "STACK\nDEELS" : "STACK\nUIT";
        s = all ? "ok" : n ? "warn" : "fout";
      }
      else if (knop.actie && knop.actie.stack === "restart") { s = "klaar"; }
      else if (knop.actie && knop.actie.osc) { s = g.ports[knop.actie.osc.poort || 8008] ? "klaar" : "uit"; }
      else if (knop.actie && knop.actie.autofocus) { s = portOk[3226] ? "klaar" : "uit"; }
      else if (knop.actie && knop.actie.stem) {
        if (portOk[3026] && volgorde.stemLoopt) { t = `${first(label)}\nLOOPT`; s = "actief"; }
        else s = portOk[3026] && volgorde.stem.mag ? "klaar" : "uit";
      }
      else if (knop.actie && knop.actie.autocam) {
        const stand = g.teleprompter.ok && g.teleprompter.body ? g.teleprompter.body.autoCameraSwitch : null;
        if (!stand) { t = `${first(label)}\n?`; s = "onbekend"; }
        else { t = `${first(label)}\n${stand.enabled ? "AAN" : "UIT"}`; s = stand.enabled ? "aan" : "klaar"; }
      }
      else if (knop.actie && knop.actie.simulatie) {
        const stand = g.sim && g.sim.ok && g.sim.body ? g.sim.body : null;
        const aan = stand && (knop.actie.simulatie === "personages" ? stand.personages : stand.bots > 0);
        if (!stand) { t = `${first(label)}\n?`; s = "onbekend"; }
        else { t = `${label}\n${aan ? "AAN" : "UIT"}`; s = aan ? "aan" : "klaar"; }
      }
      else if (knop.actie && knop.actie.opname) {
        const loopt = fs.existsSync(CONFIG.opnamePath);
        t = loopt ? `${first(label)}\nLOOPT` : label;
        s = !portOk[3025] ? "uit" : loopt ? "actief" : "klaar";
      }
      else if (knop.actie && knop.actie.showmuziek) {
        const uit = fs.existsSync(CONFIG.showMuziekUitPath);
        if (!g.ports[8008]) { t = `${first(label)}\n?`; s = "onbekend"; }
        else { t = uit ? `${first(label)}\nMUTED` : label; s = uit ? "mute" : "klaar"; }
      }
      else if (knop.actie && knop.actie.td) { t = g.tdText; s = tdOsc ? "ok" : "klaar"; }
      else if (k === "tdosc" || k === "tdack") {
        const ok = k === "tdosc" ? tdOsc : tdAck;
        t = `${label}\n${ok ? "OK" : "DOWN"}`;
        s = ok ? "ok" : "fout";
        if (!ok) problems.push(label);
      }
      else if (k in CORE) {
        const ok = g.core[k];
        t = `${label}\n${ok ? "OK" : "DOWN"}`;
        s = ok ? "ok" : "fout";
        if (!ok) problems.push(label);
      }
      else if (k in HARDWARE) {
        const r = g.hw[k];
        s = r.ok ? "ok" : "fout";
        t = `${label}\n${r.ok ? "OK" : "DOWN"}`;
        if (r.ok && k === "d_camera" && r.body && r.body.cameras) {
          const cams = Object.values(r.body.cameras);
          const online = cams.filter((c) => c.online).length;
          t = `${label}\n${online}/${cams.length}`;
          if (online < cams.length) { s = "warn"; problems.push(`CAM ${online}/${cams.length}`); }
        }
        if (!r.ok) problems.push(label);
      }
      out[k] = knop.actie && (knop.actie.extra || knop.actie.personage || Number.isInteger(knop.actie.omgeving)) ? { t, s, m: maatVan(t || "-") } : { t, s };
    }
  }

  // Volgende stap: van de knoppen van het verloop die nu mogen krijgt de laatste in de volgorde
  // groen (STEM → SCENE CHAT → READY → START SCENE; zonder run START RUN). Hooguit één per pagina.
  const volgendeReeks = activeRun ? ["stem", "scenechat", "ready", "sit"] : ["run"];
  const kandidaten = volgendeReeks.filter((k) => out[k] && out[k].s === "klaar");
  if (kandidaten.length) out[kandidaten[kandidaten.length - 1]].s = "volgende";

  // Knoppen van deze scène van links aangeschoven op sc1..sc6; wat er niet is blijft leeg.
  const plekken = deck.paginas.flatMap((p) => p.knoppen).filter((k) => k.actie && k.actie.scenePlek)
    .sort((a, b) => a.actie.scenePlek - b.actie.scenePlek);
  const aanwezig = scene.filter((k) => out[k.key] && out[k.key].s !== "leeg" && out[k.key].t);
  const kaart = {};
  plekken.forEach((plek, i) => {
    const bron = aanwezig[i];
    if (bron) { out[plek.key] = { ...out[bron.key], m: out[bron.key].m || maatVan(out[bron.key].t) }; kaart[plek.key] = bron.key; }
    else out[plek.key] = { t: "", s: "leeg", m: maatVan("-") };
  });
  for (const k of scene) delete out[k.key];
  Object.defineProperty(out, "plekken", { value: kaart, enumerable: false });

  // Alleen standen die bij de soort horen (ontwerp in deck.json); anders "kan" en melden.
  const soortVan = Object.fromEntries(deck.paginas.flatMap((p) => p.knoppen).map((k) => [k.key, k.soort]));
  for (const [k, v] of Object.entries(out)) {
    const soort = deck.ontwerp.soorten[soortVan[k]];
    if (soort && !soort.standen.includes(standVan(v.s)) && !(v.s === "leeg" && k.startsWith("sc"))) {
      log({ dienst: "deck-status", knop: k, staat: v.s, fout: `stand ${standVan(v.s)} hoort niet bij soort ${soortVan[k]}` });
      v.s = "klaar";
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
  let laatsteKaart = "";
  let lastResync = Date.now();
  let companionUp = false;
  log({ dienst: "deck-status", start: true, companion: CONFIG.companionUrl, knoppen: allButtons(deck).length });

  for (;;) {
    const started = Date.now();
    try {
      const want = compute(deck, await gather());
      const kaart = JSON.stringify(want.plekken || {});
      if (kaart !== laatsteKaart) { schrijfScenePlekken(want.plekken || {}); laatsteKaart = kaart; }
      if (Date.now() - lastResync > RESYNC_MS) { written.clear(); lastResync = Date.now(); }
      let failed = 0;
      for (const [key, { t, s, m }] of Object.entries(want)) {
        if (heldUntil(key) > Date.now()) { held.add(key); continue; }
        if (held.delete(key)) { written.delete(varTekst(key)); written.delete(varStaat(key)); written.delete(varMaat(key)); }
        const vars = [[varTekst(key), t], [varStaat(key), s]];
        if (m) vars.unshift([varMaat(key), m]);
        for (const [name, value] of vars) {
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
  for (const [key, { t, s }] of Object.entries(want)) console.log(`${key.padEnd(22)} ${s.padEnd(9)} ${standVan(s).padEnd(9)} ${t.replace(/\n/g, " | ")}`);
  console.log("scène:", JSON.stringify(want.plekken));
}

if (require.main === module) {
  if (process.argv.includes("--eenmaal")) once();
  else loop();
}

module.exports = { compute };
