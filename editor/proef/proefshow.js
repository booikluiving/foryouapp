"use strict";

// De proefshow: de onderdelen van de show (runtime, show control, publiek, script-agent, algoritme)
// nog een keer, met eigen gegevens en zonder apparaten. Bedoeld om het zaalscherm en de telefoon
// van het publiek te zien en eraan te werken zonder de zaal. De proefshow leest de catalogus en de
// paden via een deur die alleen lezen toelaat, en elk onderdeel start achter slot.js: het kan
// alleen bij de andere proefonderdelen en bij de taalmodellen.

const fs = require("node:fs");
const http = require("node:http");
const net = require("node:net");
const path = require("node:path");
const { spawn } = require("node:child_process");
const { buildRuntimeOverlay } = require("../../modules/paths/universe/build-runtime-overlay");

const PUBLIC_DIR = path.join(__dirname, "public");
const ONDERDELEN = ["algorithm", "runtime", "script-agent", "show-control", "audience"];
const MODEL_HOSTS = "api.deepseek.com,api.anthropic.com";
const SOORT = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".svg": "image/svg+xml", ".png": "image/png" };

function createProefshow({ dataDir, catalogUrl, pathsUrl, basisPoort = 4120, adres = "", env = process.env, log = (regel) => process.stdout.write(`proefshow: ${regel}\n`) }) {
  const poort = {
    lezen: basisPoort,
    algorithm: basisPoort + 3,
    runtime: basisPoort + 4,
    "show-control": basisPoort + 5,
    audience: basisPoort + 6,
    "script-agent": basisPoort + 7,
  };
  const url = (naam) => `http://127.0.0.1:${poort[naam]}`;
  const kinderen = new Map();
  const laatste = new Map();
  let leesdeur = null;
  let gestopt = false;

  // ---- De deur naar catalogus en paden: alleen lezen ----
  const padenAdres = (pathname) => /^\/(v0\/paths|universe|editor)(\/|$)/.test(pathname);
  function leesdoel(pathname) {
    return new URL(padenAdres(pathname) ? pathsUrl : catalogUrl);
  }
  function magLezen(req) {
    if (req.method === "GET" || req.method === "HEAD") return true;
    return req.method === "POST" && req.url.split("?")[0] === "/v0/paths/evaluate";
  }

  function geefDoor(req, res, doel, { verberg = false } = {}) {
    const headers = { ...req.headers, host: `${doel.hostname}:${doel.port}` };
    delete headers["cf-access-jwt-assertion"];
    if (verberg) delete headers.cookie;
    const uit = http.request({ hostname: doel.hostname, port: doel.port, path: req.url, method: req.method, headers }, (antwoord) => {
      res.writeHead(antwoord.statusCode || 502, antwoord.headers);
      antwoord.pipe(res);
    });
    uit.on("error", () => {
      if (!res.headersSent) res.writeHead(502, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: false, error: "proef_onderdeel_antwoordt_niet" }));
    });
    res.on("close", () => uit.destroy());
    req.pipe(uit);
  }

  function startLeesdeur() {
    return new Promise((resolve, reject) => {
      leesdeur = http.createServer((req, res) => {
        if (!magLezen(req)) {
          log(`leesdeur weigert ${req.method} ${req.url}`);
          res.writeHead(405, { "content-type": "application/json" });
          res.end(JSON.stringify({ ok: false, error: "proef_leest_alleen" }));
          return;
        }
        geefDoor(req, res, leesdoel(req.url.split("?")[0]), { verberg: true });
      });
      leesdeur.on("error", reject);
      leesdeur.listen(poort.lezen, "127.0.0.1", resolve);
    });
  }

  // ---- De onderdelen ----
  function omgevingVoor(naam) {
    const map = path.join(dataDir, naam);
    fs.mkdirSync(map, { recursive: true });
    const doorgeven = {};
    for (const sleutel of ["PATH", "HOME", "TZ", "LANG", "NODE_ENV", "TMPDIR", "DEEPSEEK_API_KEY", "FORYOU_DEEPSEEK_API_KEY", "FORYOU_ANTHROPIC_API_KEY"]) {
      if (env[sleutel]) doorgeven[sleutel] = env[sleutel];
    }
    const lezen = url("lezen");
    return {
      ...doorgeven,
      PROEF_NAAM: naam,
      PROEF_POORTEN: Object.values(poort).join(","),
      PROEF_HOSTS: MODEL_HOSTS,
      CATALOG_URL: lezen,
      ALGORITHM_PORT: String(poort.algorithm),
      ALGORITHM_DB_DIR: path.join(dataDir, "algorithm"),
      RUNTIME_PORT: String(poort.runtime),
      RUNTIME_DB_DIR: path.join(dataDir, "runtime"),
      RUNTIME_PATHS_URL: lezen,
      RUNTIME_CATALOG_URL: lezen,
      RUNTIME_ALGORITHM_URL: url("algorithm"),
      RUNTIME_AUDIENCE_URL: url("audience"),
      AUDIENCE_PORT: String(poort.audience),
      AUDIENCE_DB_DIR: path.join(dataDir, "audience"),
      AUDIENCE_RUNTIME_URL: url("runtime"),
      AUDIENCE_SCRIPT_AGENT_URL: url("script-agent"),
      AUDIENCE_SHOW_CONTROL_URL: url("show-control"),
      AUDIENCE_ALGORITHM_URL: url("algorithm"),
      AUDIENCE_CATALOG_URL: lezen,
      AUDIENCE_PUBLIC_JOIN_URL: `${adres}/proefshow/telefoon`,
      SCRIPT_AGENT_PORT: String(poort["script-agent"]),
      SCRIPT_AGENT_DB_DIR: path.join(dataDir, "script-agent"),
      SCRIPT_AGENT_CATALOG_URL: lezen,
      SCRIPT_AGENT_RUNTIME_URL: url("runtime"),
      FORYOU_TELEPROMPTER_CAPTION_STYLE_PATH: path.join(dataDir, "script-agent", "teleprompter-caption-style.json"),
      SHOW_CONTROL_PORT: String(poort["show-control"]),
      SHOW_CONTROL_URL: url("show-control"),
      SHOW_CONTROL_DB_DIR: path.join(dataDir, "show-control"),
      SHOW_CONTROL_RUNTIME_URL: url("runtime"),
      SHOW_CONTROL_SCRIPT_AGENT_URL: url("script-agent"),
      SHOW_CONTROL_TELEPROMPTER_URL: url("script-agent"),
      SHOW_CONTROL_CATALOG_URL: lezen,
      SHOW_CONTROL_TD_ACK_DISABLED: "1",
      FORYOU_TD_OPDRACHTEN_IN: path.join(dataDir, "td-opdrachten"),
    };
  }

  function startOnderdeel(naam) {
    if (gestopt) return;
    const kind = spawn(process.execPath, ["--require", path.join(__dirname, "slot.js"), path.join(__dirname, "onderdeel.js"), naam], {
      cwd: path.resolve(__dirname, "../.."),
      env: omgevingVoor(naam),
      stdio: ["ignore", "pipe", "pipe"],
    });
    kinderen.set(naam, kind);
    const regel = (stroom) => stroom.on("data", (stuk) => {
      const tekst = String(stuk).trim().split("\n").slice(-3).join(" | ").slice(0, 400);
      if (!tekst) return;
      laatste.set(naam, tekst);
      if (stroom === kind.stderr) log(`${naam}: ${tekst}`);
    });
    regel(kind.stdout);
    regel(kind.stderr);
    kind.on("exit", (code) => {
      kinderen.delete(naam);
      if (gestopt) return;
      log(`${naam} is gestopt (${code}), start opnieuw`);
      setTimeout(() => startOnderdeel(naam), 3000).unref();
    });
  }

  // De instellingen van de schrijver (prompt en model) als begin, zodat de proef schrijft zoals de show.
  function zaaiScriptAgent(bron) {
    const doel = path.join(dataDir, "script-agent", "operator-settings.json");
    if (!bron || fs.existsSync(doel) || !fs.existsSync(bron)) return;
    fs.mkdirSync(path.dirname(doel), { recursive: true });
    fs.copyFileSync(bron, doel);
  }

  async function start({ instellingenVan = "" } = {}) {
    fs.mkdirSync(dataDir, { recursive: true });
    zaaiScriptAgent(instellingenVan);
    await startLeesdeur();
    for (const naam of ONDERDELEN) startOnderdeel(naam);
    log(`gestart op poorten ${poort.lezen}–${poort["script-agent"]}, gegevens in ${dataDir}`);
  }

  function stop() {
    gestopt = true;
    for (const kind of kinderen.values()) kind.kill();
    if (leesdeur) leesdeur.close();
  }

  // ---- Praten met de onderdelen ----
  async function vraag(naam, pad, { method = "GET", body, timeoutMs = 5000 } = {}) {
    try {
      const antwoord = await fetch(`${url(naam)}${pad}`, {
        method,
        headers: body === undefined ? {} : { "content-type": "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs),
      });
      const tekst = await antwoord.text();
      let inhoud = null;
      try { inhoud = tekst ? JSON.parse(tekst) : null; } catch (_err) { inhoud = { tekst: tekst.slice(0, 300) }; }
      return { ok: antwoord.ok, status: antwoord.status, body: inhoud };
    } catch (err) {
      return { ok: false, status: 0, body: { error: "geen_antwoord", message: String(err && err.message || err) } };
    }
  }

  async function runNu() {
    const antwoord = await vraag("runtime", "/v0/runtime/runs/current", { timeoutMs: 1500 });
    if (!antwoord.ok || !antwoord.body) return null;
    return antwoord.body.runtimeState || antwoord.body.state || antwoord.body;
  }

  const cue = (pad, body, timeoutMs) => vraag("show-control", pad, { method: "POST", body, timeoutMs });

  // Dezelfde opdrachten als de knoppen van de Stream Deck.
  const KNOPPEN = {
    async run() {
      const rt = await runNu();
      if (rt && rt.showRunId && rt.status !== "idle") {
        const reset = await cue("/v0/show-control/cues", { name: "Proef reset run", actions: [{ command: "runtime.resetRun", ackMode: "acknowledged-async", payload: { showRunId: rt.showRunId }, timeoutMs: 5000 }] });
        await cue("/v0/show-control/cues/phase", { name: "Proef reset: terug naar inloop", phase: 0, phaseName: "inloop" }, 2500);
        const status = await vraag("script-agent", "/v0/script-agent/operator/status", { timeoutMs: 1500 });
        const sessies = new Set([rt.showRunId, status.ok && status.body && status.body.stage ? status.body.stage.sessionId : null].filter(Boolean));
        for (const sessie of sessies) await vraag("script-agent", `/v0/script-agent/operator/session/${encodeURIComponent(sessie)}`, { method: "DELETE", timeoutMs: 2500 });
        return reset;
      }
      const gestart = await cue("/v0/show-control/cues/start-run", { name: "Proef start run", autoPrepareNext: true });
      const stand = await vraag("audience", "/audience/admin/state", { timeoutMs: 1500 });
      if (!(stand.ok && stand.body && stand.body.sessionJoin && stand.body.sessionJoin.joinUrl)) {
        await vraag("audience", "/audience/admin/sessions/start", { method: "POST", body: { name: "For_You" }, timeoutMs: 3000 });
      }
      return gestart;
    },
    async stem() {
      const stand = await vraag("audience", "/audience/stage/start-stemming", { timeoutMs: 1500 });
      if (stand.ok && stand.body && stand.body.actief) return vraag("audience", "/audience/admin/polls/close", { method: "POST", body: {} });
      return vraag("audience", "/audience/admin/start-stemming/start", { method: "POST", body: {} });
    },
    chat: () => cue("/v0/show-control/cues/scene-to-chat", { name: "Proef scene naar chat" }, 90000),
    ready: () => cue("/v0/show-control/cues", { name: "Proef teleprompter ready", actions: [{ command: "teleprompter.ready", ackMode: "acknowledged-async", timeoutMs: 1500, payload: { ready: true, source: "proef" } }] }),
    async scene() {
      const rt = await runNu();
      if (!rt || !rt.showRunId || rt.status === "idle") return { ok: false, status: 409, body: { error: "geen_run" } };
      if (rt.activeSituation) return cue("/v0/show-control/cues/stop-situation", { name: "Proef stop situation", showRunId: rt.showRunId });
      return cue("/v0/show-control/cues/start-situation", { name: "Proef start situation", showRunId: rt.showRunId, runtimeState: rt });
    },
    bots: () => vraag("audience", "/audience/admin/simulation/schakel", { method: "POST", body: { wat: "bots" } }),
    personages: () => vraag("audience", "/audience/admin/simulation/schakel", { method: "POST", body: { wat: "personages" } }),
  };

  async function stand() {
    const [rt, stemming, script, publiek] = await Promise.all([
      runNu(),
      vraag("audience", "/audience/stage/start-stemming", { timeoutMs: 1500 }),
      vraag("script-agent", "/v0/script-agent/operator/status", { timeoutMs: 1500 }),
      vraag("audience", "/audience/admin/state", { timeoutMs: 1500 }),
    ]);
    const loopt = Boolean(rt && rt.showRunId && rt.status !== "idle");
    const scene = Boolean(rt && rt.activeSituation);
    const sim = publiek.ok && publiek.body && publiek.body.simulation ? publiek.body.simulation : null;
    return {
      ok: true,
      onderdelen: Object.fromEntries(ONDERDELEN.map((naam) => [naam, kinderen.has(naam)])),
      // De fase die TouchDesigner in de zaal aan de pagina doorgeeft: 0 inloop, 1 loading, 2 scène.
      fase: scene ? 2 : loopt ? 1 : 0,
      run: loopt,
      scene,
      titel: scene && rt.activeSituation ? String(rt.activeSituation.title || rt.activeSituation.sceneTitle || "") : "",
      stemmen: Boolean(stemming.ok && stemming.body && stemming.body.actief),
      schrijft: Boolean(script.ok && script.body && script.body.stage && script.body.stage.streaming),
      sessie: Boolean(publiek.ok && publiek.body && publiek.body.sessionJoin && publiek.body.sessionJoin.joinUrl),
      bots: sim ? Number(sim.bots || sim.botCount || 0) : 0,
    };
  }

  async function universumStand() {
    const [basis, view, stemming] = await Promise.all([
      fetch(`${pathsUrl}/v0/paths/universe-state`, { signal: AbortSignal.timeout(8000) }).then((antwoord) => antwoord.json()),
      vraag("runtime", "/v0/runtime/runs/current/view", { timeoutMs: 3000 }),
      vraag("audience", "/audience/stage/start-stemming", { timeoutMs: 3000 }),
    ]);
    let runtime = null;
    try {
      if (view.ok && view.body) runtime = buildRuntimeOverlay(view.body, stemming.ok && stemming.body && stemming.body.ok ? stemming.body : null);
    } catch (_err) {
      runtime = null;
    }
    return { ...basis, runtime };
  }

  // De telefoon in de werkplaats: meedoen met de lopende sessie, net als na het scannen van de QR-code.
  async function telefoon(req, res) {
    let token = new URL(req.url, "http://x").searchParams.get("t") || "";
    if (!token) {
      const publiek = await vraag("audience", "/audience/admin/state", { timeoutMs: 2000 });
      token = publiek.ok && publiek.body && publiek.body.sessionJoin ? String(publiek.body.sessionJoin.token || "") : "";
    }
    if (!token) {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
      res.end("<!doctype html><meta charset=utf-8><body style=\"margin:0;background:#000;color:#777;font:16px system-ui;display:grid;place-items:center;height:100vh\">Start eerst een run.</body>");
      return;
    }
    const antwoord = await fetch(`${url("audience")}/join?token=${encodeURIComponent(token)}`, {
      redirect: "manual",
      headers: { cookie: req.headers.cookie || "", "user-agent": req.headers["user-agent"] || "", "x-forwarded-for": req.socket.remoteAddress || "" },
      signal: AbortSignal.timeout(5000),
    });
    const koekjes = antwoord.headers.getSetCookie ? antwoord.headers.getSetCookie() : [];
    if (antwoord.status !== 302) {
      res.writeHead(antwoord.status, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", ...(koekjes.length ? { "set-cookie": koekjes } : {}) });
      res.end(await antwoord.text());
      return;
    }
    res.writeHead(302, { location: "/audience/public", "cache-control": "no-store", ...(koekjes.length ? { "set-cookie": koekjes } : {}) });
    res.end();
  }

  // ---- De voorkant: wat de browser bij de proefshow mag opvragen ----
  const VOORVOEGSELS = [
    ["/audience", "audience"],
    ["/script-agent", "script-agent"],
    ["/v0/script-agent", "script-agent"],
    ["/v0/audience", "audience"],
  ];
  function onderdeelVoor(req) {
    const pathname = req.url.split("?")[0];
    for (const [voor, naam] of VOORVOEGSELS) {
      if (pathname === voor || pathname.startsWith(`${voor}/`)) return naam;
    }
    // De telefoonpagina vraagt /health op het hoofdadres.
    if (pathname === "/health" && /\/audience\//.test(String(req.headers.referer || ""))) return "audience";
    return null;
  }

  function json(res, status, body) {
    res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
    res.end(JSON.stringify(body));
  }

  function eigenBestand(res, naam) {
    const bestand = path.join(PUBLIC_DIR, path.basename(naam));
    if (!fs.existsSync(bestand)) return json(res, 404, { ok: false, error: "not_found" });
    res.writeHead(200, { "content-type": SOORT[path.extname(bestand)] || "application/octet-stream", "cache-control": "no-store" });
    res.end(fs.readFileSync(bestand));
    return undefined;
  }

  function leesBody(req) {
    return new Promise((resolve) => {
      let tekst = "";
      req.on("data", (stuk) => { if (tekst.length < 20000) tekst += stuk; });
      req.on("end", () => {
        try { resolve(tekst ? JSON.parse(tekst) : {}); } catch (_err) { resolve({}); }
      });
    });
  }

  async function eigen(req, res, pathname) {
    if (pathname === "/proefshow") {
      res.writeHead(302, { location: "/proefshow/" });
      res.end();
      return;
    }
    if (pathname === "/proefshow/" || pathname === "/proefshow/index.html") return eigenBestand(res, "index.html");
    if (pathname === "/proefshow/api/stand") return json(res, 200, await stand());
    if (pathname === "/proefshow/universe-state") return json(res, 200, await universumStand());
    if (pathname === "/proefshow/telefoon") return telefoon(req, res);
    if (pathname === "/proefshow/api/knop" && req.method === "POST") {
      const body = await leesBody(req);
      const knop = KNOPPEN[String(body.knop || "")];
      if (!knop) return json(res, 400, { ok: false, error: "onbekende_knop" });
      const antwoord = await knop();
      const ok = Boolean(antwoord && antwoord.ok && !(antwoord.body && antwoord.body.ok === false));
      return json(res, 200, { ok, status: antwoord.status, fout: ok ? undefined : antwoord.body });
    }
    return eigenBestand(res, pathname.slice("/proefshow/".length));
  }

  function middleware(req, res, next) {
    const pathname = req.url.split("?")[0];
    if (pathname === "/proefshow" || pathname.startsWith("/proefshow/")) {
      eigen(req, res, pathname).catch((err) => {
        log(`fout bij ${pathname}: ${err && err.message || err}`);
        if (!res.headersSent) json(res, 500, { ok: false, error: "proefshow_fout" });
      });
      return;
    }
    const naam = onderdeelVoor(req);
    if (!naam) {
      next();
      return;
    }
    geefDoor(req, res, new URL(url(naam)));
  }

  // WebSockets (chat op de telefoon, de tekst die geschreven wordt): rechtstreeks doorverbinden.
  function upgrade(req, socket, head) {
    const naam = onderdeelVoor(req);
    if (!naam) return false;
    const doel = net.connect(poort[naam], "127.0.0.1", () => {
      const koppen = Object.entries({ ...req.headers, host: `127.0.0.1:${poort[naam]}` })
        .filter(([sleutel]) => sleutel !== "cf-access-jwt-assertion")
        .map(([sleutel, waarde]) => `${sleutel}: ${Array.isArray(waarde) ? waarde.join(", ") : waarde}`);
      doel.write(`${req.method} ${req.url} HTTP/1.1\r\n${koppen.join("\r\n")}\r\n\r\n`);
      if (head && head.length) doel.write(head);
      doel.pipe(socket);
      socket.pipe(doel);
    });
    const sluit = () => { doel.destroy(); socket.destroy(); };
    doel.on("error", sluit);
    socket.on("error", sluit);
    doel.on("close", sluit);
    socket.on("close", sluit);
    return true;
  }

  return { start, stop, middleware, upgrade, poort, leesAdres: () => url("lezen") };
}

module.exports = { createProefshow };
