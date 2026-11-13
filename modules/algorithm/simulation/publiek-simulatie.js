"use strict";

// Simulatie van een avond, los van de show: een eigen publieksdienst op proefpoorten met bots,
// een nagespeelde runtime die scène voor scène "speelt", en het algoritme dat erop rekent.
// De bots krijgen een smaak per label mee; het rapport moet die smaak uit hun reacties terugvinden.
//
//   node modules/algorithm/simulation/publiek-simulatie.js <uitvoer.json>
//
// Niets hiervan raakt de draaiende show: eigen poorten, eigen tijdelijke gegevensmappen.

const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");

const ROOT = path.resolve(__dirname, "../../..");
const SIM_DB = path.join(ROOT, "modules", "algorithm", "db", ".tmp", `sim-${Date.now()}`);
process.env.ALGORITHM_DB_DIR = SIM_DB;

const { createScoringContext, getScoringContext, observeSituation } = require("../scoring/algorithm-service");
const { buildAudienceReport } = require("../report/build-report");

const PORT = { runtime: 39424, show: 39425, lan: 39426, pub: 39430 };
const SECONDS = Number(process.env.SIM_SECONDS || 24);
const BOTS = Number(process.env.SIM_BOTS || 36);
const CATALOG_URL = process.env.SIM_CATALOG_URL || "http://127.0.0.1:3021/v0/catalog/read-model";
const WANTED = (process.env.SIM_SCENES || "39,3,59,14,2,30,47,74").split(",").map((n) => `situation:${n.trim()}`);

// De smaak van dit gesimuleerde publiek, per label: van −1 (haakt af) tot +1 (vindt het geweldig).
const SMAAK = { Satirisch: 0.9, Maatschappelijk: 0.6, Absurd: 0.3, Verwarring: 0, Herkenbaar: -0.3, Grof: -0.8 };

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const round = (value, digits = 1) => Math.round(value * 10 ** digits) / 10 ** digits;

function findCatalog(payload) {
  if (!payload || typeof payload !== "object") return null;
  if (Array.isArray(payload.situations) && Array.isArray(payload.labels)) return payload;
  for (const value of Object.values(payload)) {
    const nested = findCatalog(value);
    if (nested) return nested;
  }
  return null;
}

// Zaalgeluid dat volgt uit de reacties: rustig niveau met ruis, en uitschieters waar veel hartjes vallen.
function simuleerZaalgeluid(signals, startMs, seconds) {
  const stap = 250;
  const bins = Math.round((seconds * 1000) / stap);
  const hartjes = new Array(bins).fill(0);
  for (const signal of signals) {
    if (signal.type !== "heart") continue;
    const index = Math.floor((Date.parse(signal.receivedAt) - startMs) / stap);
    if (index >= 0 && index < bins) hartjes[index] += 1;
  }
  let zaad = signals.length * 7919 + 13;
  const ruis = () => { zaad = (zaad * 16807) % 2147483647; return zaad / 2147483647; };
  const samples = hartjes.map((_count, index) => {
    const venster = hartjes.slice(Math.max(0, index - 3), index + 1).reduce((sum, n) => sum + n, 0);
    return round(54 + ruis() * 5 + 24 * (1 - Math.exp(-venster / 5)));
  });
  const gesorteerd = samples.slice().sort((a, b) => a - b);
  const averageDb = gesorteerd[Math.floor(gesorteerd.length / 2)];
  const peakDb = gesorteerd[gesorteerd.length - 1];
  return { source: "simulatie", averageDb, peakDb, liftDb: round(peakDb - averageDb), samples };
}

async function main() {
  const out = process.argv[2];
  if (!out) throw new Error("geef een uitvoerbestand op");
  const catalog = findCatalog(await (await fetch(CATALOG_URL)).json());
  if (!catalog) throw new Error("catalogus niet gevonden");
  const labelNaam = new Map(catalog.labels.map((label) => [label.id, label.name || label.title]));
  const scenes = WANTED.map((id) => catalog.situations.find((item) => item.id === id)).filter(Boolean);
  if (scenes.length < 2) throw new Error("te weinig scènes gevonden in de catalogus");

  // Zelfde vorm als een echte run: show-run-JJJJMMDD-UUMMSSmmmZ.
  const showRunId = `show-run-${new Date().toISOString().replace(/[-:]/g, "").replace("T", "-").replace(".", "")}`;
  const view = { status: "running", showRunId, activeSituation: null, playedSituations: [], pathEvaluation: { items: [] } };
  const antwoord = (res, body) => { res.setHeader("content-type", "application/json"); res.end(JSON.stringify(body)); };
  const runtime = http.createServer((req, res) => { req.resume(); antwoord(res, view); });
  const show = http.createServer((req, res) => { req.resume(); antwoord(res, { ok: true }); });
  await new Promise((resolve) => runtime.listen(PORT.runtime, "127.0.0.1", resolve));
  await new Promise((resolve) => show.listen(PORT.show, "127.0.0.1", resolve));

  const dbDir = fs.mkdtempSync(path.join(os.tmpdir(), "fy-sim-publiek-"));
  const child = spawn(process.execPath, [path.join(ROOT, "modules/audience/server/server.js")], {
    cwd: ROOT,
    env: {
      ...process.env,
      AUDIENCE_PORT: String(PORT.lan),
      AUDIENCE_PUBLIC_PORT: String(PORT.pub),
      AUDIENCE_DB_DIR: dbDir,
      AUDIENCE_RUNTIME_URL: `http://127.0.0.1:${PORT.runtime}`,
      AUDIENCE_SHOW_CONTROL_URL: `http://127.0.0.1:${PORT.show}`,
      AUDIENCE_ALGORITHM_URL: "http://127.0.0.1:9",
    },
    stdio: "ignore",
  });
  const lan = (pad, body) => fetch(`http://127.0.0.1:${PORT.lan}${pad}`, body === undefined ? undefined : {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
  }).then((response) => response.json());

  try {
    for (let i = 0; i < 80; i++) {
      try { if ((await fetch(`http://127.0.0.1:${PORT.lan}/health`)).ok) break; } catch {}
      await sleep(150);
    }
    await lan("/audience/admin/sessions/start", { name: "simulatie" });
    await lan("/audience/admin/simulation/start", { clients: BOTS, reactionRate: 0.25, msgRate: 0.02, autoVote: false, personages: false });

    const liveConfig = await fetch("http://127.0.0.1:3023/v0/algorithm/config").then((r) => r.json()).catch(() => ({}));
    const weights = { ...((liveConfig.config || liveConfig).weights || {}), roomSound: Number(process.env.SIM_ROOM_SOUND_WEIGHT || 0.5) };
    await createScoringContext({ showRunId, catalog, config: { weights } });

    const verloop = [];
    for (const [index, scene] of scenes.entries()) {
      const labels = (scene.labelIds || []).map((id) => labelNaam.get(id)).filter(Boolean);
      const smaak = labels.length ? labels.reduce((sum, naam) => sum + (SMAAK[naam] || 0), 0) / labels.length : 0;
      await lan("/audience/admin/simulation/update", {
        warmth: Math.min(1, Math.max(0, 0.45 + 0.45 * smaak)),
        skepticism: Math.min(1, Math.max(0, 0.45 - 0.4 * smaak)),
        intensity: 0.4 + 0.35 * Math.abs(smaak),
        reactionRate: 0.16 + 0.2 * Math.max(0, smaak),
      });
      // Een duwtje in de stemming van de zaal: mee bij een scène die valt, ongemak bij een die niet valt.
      if (smaak >= 0.3) await lan("/audience/admin/simulation/cue", { cue: "follow_audience" });
      if (smaak <= -0.2) await lan("/audience/admin/simulation/cue", { cue: "make_awkward" });
      const situationRunId = `${showRunId}:situation-run:${String(index + 1).padStart(4, "0")}`;
      const startedAt = new Date();
      view.activeSituation = { situationId: scene.id, situationRunId, title: scene.title, startedAt: startedAt.toISOString() };
      process.stdout.write(`scène ${index + 1}/${scenes.length}: ${scene.title} [${labels.join(", ")}] smaak ${round(smaak)}\n`);
      await sleep(SECONDS * 1000);
      const endedAt = new Date();
      const query = `showRunId=${encodeURIComponent(showRunId)}&situationRunId=${encodeURIComponent(situationRunId)}`;
      const input = await lan(`/audience/algorithm-input?${query}`);
      const signals = (await lan(`/v0/audience/signals?${query}&linkStatus=linked`)).signals || [];
      view.activeSituation = null;
      const roomSound = simuleerZaalgeluid(signals, startedAt.getTime(), SECONDS);
      const result = await observeSituation({
        type: "situationObserved",
        showRunId,
        situationRunId,
        situationId: scene.id,
        startedAt: startedAt.toISOString(),
        endedAt: endedAt.toISOString(),
        durationSeconds: Math.round((endedAt - startedAt) / 1000),
        audience: input.audience,
        chatAppSignals: input.chatAppSignals,
        rawChat: input.rawChat || [],
        roomSound,
        finalizedFromAudienceAggregate: true,
      });
      const score = result.observation ? result.observation.observedScore : null;
      verloop.push({ scene: scene.title, labels, smaak: round(smaak), hartjes: input.chatAppSignals.heartCount, verveeld: input.chatAppSignals.boredCount, piekDb: roomSound.peakDb, score });
      process.stdout.write(`  ♥ ${input.chatAppSignals.heartCount}  verveeld ${input.chatAppSignals.boredCount}  kijkers ${input.audience.activeClients}  piek ${roomSound.peakDb} dB  score ${score}\n`);
      await sleep(2500);
    }

    const report = buildAudienceReport(await getScoringContext(showRunId));
    fs.writeFileSync(out, JSON.stringify({ simulatie: { bots: BOTS, secondenPerScene: SECONDS, smaak: SMAAK, verloop }, report }, null, 1));
    process.stdout.write(`klaar: ${out}\n`);
  } finally {
    try { await lan("/audience/admin/simulation/stop", { reason: "simulatie_klaar" }); } catch {}
    child.kill();
    runtime.close();
    show.close();
    fs.rmSync(dbDir, { recursive: true, force: true });
    fs.rmSync(SIM_DB, { recursive: true, force: true });
  }
}

main().catch((err) => {
  process.stderr.write(`simulatie mislukt: ${err && err.stack ? err.stack : err}\n`);
  process.exitCode = 1;
});
