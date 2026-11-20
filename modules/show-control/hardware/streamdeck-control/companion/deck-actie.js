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
  leesScenePlekken,
  sceneKnoppen,
  clearHold,
  fetchJson,
  hold,
  loadDeck,
  log,
  maatVan,
  setVar,
  showVolgorde,
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

// De volgorde van een scène, op het moment van de druk (zie showVolgorde in lib.js).
async function volgordeNu() {
  const [rt, tp, stem] = await Promise.all([
    runtimeState(),
    fetchJson(`${CONFIG.scriptAgentUrl}/v0/script-agent/teleprompter-parser/current`, { timeoutMs: 1200 }),
    fetchJson(`${CONFIG.audienceUrl}/audience/stage/start-stemming`, { timeoutMs: 1200 }),
  ]);
  return { rt, volgorde: showVolgorde(rt, tp.ok ? tp.body : null, stem.ok ? stem.body : null) };
}

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

// Handmatige camera: eerst melden bij de autocam (die pauzeert dan 30 s en weet welke camera live staat),
// dan de camera zelf via show control. Is de teleprompter onbereikbaar, dan gaat de camera toch.
function tdCamera(camera) {
  return async () => {
    if (!CONFIG.droog) {
      await fetchJson(`${CONFIG.scriptAgentUrl}/v0/script-agent/teleprompter-parser/auto-camera/handmatig`, { method: "POST", body: { camera: Number(camera) }, timeoutMs: 800 }).catch(() => null);
    }
    return tdCameraCue(camera);
  };
}

function tdCameraCue(camera) {
  return ({
    request: cueActions(`Stream Deck CAM ${camera} TD camera trigger`, [{
      command: "td.camera.set",
      ackMode: "acknowledged-async",
      timeoutMs: 1200,
      payload: { camera, cameraId: `camera:${camera}`, source: "streamdeck", cueIntent: "camera_trigger" },
    }]),
  });
}

function phase(label, phaseNumber, phaseName) {
  return async () => {
    const { volgorde } = await volgordeNu();
    if (!volgorde.fase.mag) return skip(volgorde.fase.waarom);
    return { request: post("/v0/show-control/cues/phase", { name: `Stream Deck ${label} phase`, phase: phaseNumber, phaseName }, 2500) };
  };
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

// RESET RUN zet het beeld terug naar de inloop en wist het script dat nog op het
// tussenscherm stond.
async function naReset(showRunId) {
  const fase = await fetchJson(`${CONFIG.showControlUrl}/v0/show-control/cues/phase`, {
    method: "POST",
    body: { name: "Stream Deck reset: terug naar inloop", phase: 0, phaseName: "inloop" },
    timeoutMs: 2500,
  });
  const status = await fetchJson(`${CONFIG.scriptAgentUrl}/v0/script-agent/operator/status`, { timeoutMs: 1500 });
  const sessies = new Set([showRunId, status.ok && status.body && status.body.stage ? status.body.stage.sessionId : null].filter(Boolean));
  const gewist = [];
  for (const sessie of sessies) {
    const weg = await fetchJson(`${CONFIG.scriptAgentUrl}/v0/script-agent/operator/session/${encodeURIComponent(sessie)}`, { method: "DELETE", timeoutMs: 2500 });
    gewist.push(weg.ok);
  }
  return { inloop: fase.ok, scriptGewist: gewist.length > 0 && gewist.every(Boolean) };
}

const CUES = {
  "toggle-run": async () => {
    const { rt, volgorde } = await volgordeNu();
    if (!rt) return skip("RUN\n--");
    if (!volgorde.run.mag) return skip(volgorde.run.waarom);
    // De run loopt en het inloopscherm staat nog: de knop is eerst CONTENT WARNING (als het team
    // een tekst heeft ingevuld en die in deze run nog niet in beeld is geweest), daarna START SHOW.
    if (rt.showRunId && rt.status !== "idle" && !rt.activeSituation && !(rt.playedSituations || []).length) {
      const stem = await fetchJson(`${CONFIG.audienceUrl}/audience/stage/start-stemming`, { timeoutMs: 1500 });
      if (stem.ok && stem.body && stem.body.showGestart === false) {
        if (stem.body.waarschuwingNodig) {
          return { bezig: "WARNING\n...", klaar: "WARNING\nOK", request: post("/v0/show-control/cues/content-warning", {}, 4000) };
        }
        return { bezig: "SHOW\n...", klaar: "SHOW\nOK", request: post("/v0/show-control/cues/start-show", {}, 4000) };
      }
    }
    if (rt.showRunId && rt.status !== "idle") {
      return {
        bezig: "RESET\n...",
        klaar: "RESET\nOK",
        request: cueActions("Stream Deck reset run", [{ command: "runtime.resetRun", ackMode: "acknowledged-async", payload: { showRunId: rt.showRunId }, timeoutMs: 5000 }]),
        daarna: () => naReset(rt.showRunId),
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
    const { rt, volgorde } = await volgordeNu();
    if (!rt) return skip("SCENE\n--");
    if (!rt.showRunId || rt.status === "idle") return skip("NO\nRUN");
    if (!volgorde.sit.mag) return skip(volgorde.sit.waarom);
    if (rt.activeSituation) {
      return { bezig: "STOP\n...", klaar: "STOP\nOK", request: post("/v0/show-control/cues/stop-situation", { name: "Stream Deck stop situation", showRunId: rt.showRunId }) };
    }
    return {
      bezig: "START\n...",
      klaar: "START\nOK",
      request: post("/v0/show-control/cues/start-situation", { name: "Stream Deck start situation", showRunId: rt.showRunId, runtimeState: rt }),
    };
  },
  "scene-chat": async () => {
    const { rt, volgorde } = await volgordeNu();
    if (!rt) return skip("CHAT\n--");
    if (!volgorde.chat.mag) return skip(volgorde.chat.waarom);
    // Wordt er al een tekst geschreven, dan niet nog een keer.
    const status = await fetchJson(`${CONFIG.scriptAgentUrl}/v0/script-agent/operator/status`, { timeoutMs: 1500 });
    if (status.ok && status.body && status.body.stage && status.body.stage.streaming) return skip("CHAT\nBEZIG");
    return { request: post("/v0/show-control/cues/scene-to-chat", { name: "Stream Deck scene naar chat" }, 90000) };
  },
  "overslaan": async () => {
    const { rt, volgorde } = await volgordeNu();
    if (!rt) return skip("SKIP\n--");
    if (!volgorde.overslaan.mag) return skip(volgorde.overslaan.waarom);
    return { bezig: "SKIP\n...", klaar: "SKIP\nOK", request: post("/v0/show-control/cues/overslaan", {}, 10000) };
  },
  "teleprompter-ready": async () => {
    const { rt, volgorde } = await volgordeNu();
    if (!rt) return skip("READY\n--");
    if (!volgorde.ready_knop.mag) return skip(volgorde.ready_knop.waarom);
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

// Eenmalige autofocus via de camera-interface (:3226): één camera, of "alle" tegelijk.
async function doAutofocus(knop) {
  const label = firstLine(knop.label);
  const cams = knop.actie.autofocus === "alle" ? ["cam1", "cam2", "cam3"] : [knop.actie.autofocus];
  const urls = cams.map((cam) => `${CONFIG.cameraUrl}/api/camera/${encodeURIComponent(cam)}/autofocus`);
  if (CONFIG.droog) {
    await flash(knop.key, `${label}\nOK`, "gelukt");
    return { ok: true, droog: true, post: urls };
  }
  await flash(knop.key, `${label}\n...`, "bezig", 6000);
  const results = await Promise.all(urls.map((url) => fetchJson(url, { method: "POST", body: {}, timeoutMs: 5000 })));
  const mis = cams.filter((cam, i) => !(results[i].ok && results[i].body && results[i].body.ok !== false));
  const ok = mis.length === 0;
  // bij een fout: welke camera's niet reageerden, bv. "FAIL 2"
  const tekst = ok ? "OK" : `FAIL ${mis.map((cam) => cam.replace("cam", "")).join(" ")}`;
  await flash(knop.key, `${label}\n${tekst}`, ok ? "gelukt" : "mislukt");
  return { ok, mislukt: ok ? undefined : mis, fout: ok ? undefined : results.map((r) => r.body) };
}

// Zaaloordeel over de scène die speelt of net gespeeld is: LACH 1× +½, 2× +1; SAAI 1× -½, 2× -1;
// nog een keer drukken zet het terug op 0.
const zaalTekst = (w) => (w >= 1 ? "+1" : w > 0 ? "+½" : w <= -1 ? "-1" : w < 0 ? "-½" : "0");
async function doZaal(knop) {
  const label = firstLine(knop.label);
  const stap = knop.actie.zaal === "saai" ? "saai" : "lach";
  if (CONFIG.droog) {
    await flash(knop.key, `${label}\n${stap === "saai" ? "-½" : "+½"}`, "gelukt");
    return { ok: true, droog: true, post: `${CONFIG.showControlUrl}/v0/show-control/zaal` };
  }
  const result = await fetchJson(`${CONFIG.showControlUrl}/v0/show-control/zaal`, { method: "POST", body: { stap, bron: "deck" }, timeoutMs: 5000 });
  const body = result.body || {};
  if (!result.ok) {
    const geen = body.error === "geen_scene";
    await flash(knop.key, `${label}\n${geen ? "--" : "FAIL"}`, geen ? "uit" : "mislukt");
    return { ok: geen, fout: body };
  }
  const waarde = body.oordeel ? Number(body.oordeel.waarde) : 0;
  // De emoji van de knop stijgt ook op het scherm op, zoals een emoji van een telefoon (niet bij terug naar 0).
  if (waarde !== 0) {
    await fetchJson(`${CONFIG.audienceUrl}/audience/admin/stage/emoji`, { method: "POST", body: { emoji: label }, timeoutMs: 1500 }).catch(() => {});
  }
  await flash(knop.key, `${label}\n${zaalTekst(waarde)}`, waarde !== 0 ? "gelukt" : "klaar");
  return { ok: true, waarde, scene: body.scene && body.scene.situationRunId };
}

// Stemmen op de startscène: opent de stemming bij het publiek. Loopt er al een, dan sluit
// de knop hem nu (de winnaar wordt dan meteen klaargezet).
async function doStem(knop) {
  const label = firstLine(knop.label);
  // Stemmen kan alleen in de startfase, tussen twee scènes, en niet als er al een winnaar klaarstaat.
  const { rt, volgorde } = await volgordeNu();
  if (rt && !volgorde.stem.mag) {
    await flash(knop.key, volgorde.stem.waarom, "uit");
    return { ok: true, overgeslagen: volgorde.stem.waarom };
  }
  if (CONFIG.droog) {
    await flash(knop.key, `${label}\nOPEN`, "gelukt");
    return { ok: true, droog: true, post: `${CONFIG.audienceUrl}/audience/admin/start-stemming/start` };
  }
  await flash(knop.key, `${label}\n...`, "bezig", 6000);
  const stand = await fetchJson(`${CONFIG.audienceUrl}/audience/stage/start-stemming`, { timeoutMs: 1500 });
  if (stand.ok && stand.body && stand.body.actief) {
    const dicht = await fetchJson(`${CONFIG.audienceUrl}/audience/admin/polls/close`, { method: "POST", body: {}, timeoutMs: 5000 });
    const ok = dicht.ok && dicht.body && dicht.body.ok !== false;
    await flash(knop.key, `${label}\n${ok ? "DICHT" : "FAIL"}`, ok ? "gelukt" : "mislukt");
    return { ok, gesloten: true, fout: ok ? undefined : dicht.body };
  }
  const result = await fetchJson(`${CONFIG.audienceUrl}/audience/admin/start-stemming/start`, { method: "POST", body: {}, timeoutMs: 5000 });
  const ok = result.ok && result.body && result.body.ok !== false;
  const waarom = { geen_run: "NO RUN", scene_loopt: "SCENE", te_weinig_scenes: "LEEG", session_inactive: "NO QR" };
  const fout = result.body && result.body.error;
  await flash(knop.key, `${label}\n${ok ? "OPEN" : waarom[fout] || "FAIL"}`, ok ? "gelukt" : waarom[fout] ? "uit" : "mislukt");
  return { ok: ok || !!waarom[fout], status: result.status, fout: ok ? undefined : result.body };
}

// Automatische camerawissel van de teleprompter (camera volgt wie er spreekt): aan of uit.
async function doAutocam(knop) {
  const label = firstLine(knop.label);
  const basis = `${CONFIG.scriptAgentUrl}/v0/script-agent/teleprompter-parser`;
  const nu = await fetchJson(`${basis}/current`, { timeoutMs: 1200 });
  const stand = nu.ok && nu.body && nu.body.autoCameraSwitch;
  if (!stand) {
    await flash(knop.key, `${label}\n--`, "uit");
    return { ok: true, overgeslagen: "stand_onbekend" };
  }
  // Op pauze (iemand nam met CAM 1/2/3 over): één druk en de autocam neemt meteen weer over.
  if (stand.enabled && stand.pauze) {
    if (CONFIG.droog) {
      await flash(knop.key, `${label}\nAAN`, "gelukt");
      return { ok: true, droog: true, post: `${basis}/auto-camera/pauze-weg` };
    }
    const weg = await fetchJson(`${basis}/auto-camera/pauze-weg`, { method: "POST", body: {}, timeoutMs: 2500 });
    const ok = weg.ok && weg.body && weg.body.ok !== false;
    await flash(knop.key, ok ? `${label}\nAAN` : `${label}\nFAIL`, ok ? "gelukt" : "mislukt");
    return { ok, pauzeWeg: true, status: weg.status };
  }
  const enabled = !stand.enabled;
  const tekst = `${label}\n${enabled ? "AAN" : "UIT"}`;
  if (CONFIG.droog) {
    await flash(knop.key, tekst, "gelukt");
    return { ok: true, droog: true, post: `${basis}/auto-camera`, body: { enabled } };
  }
  const result = await fetchJson(`${basis}/auto-camera`, { method: "POST", body: { enabled }, timeoutMs: 2500 });
  const ok = result.ok && result.body && result.body.ok !== false;
  await flash(knop.key, ok ? tekst : `${label}\nFAIL`, ok ? "gelukt" : "mislukt");
  return { ok, enabled: ok ? enabled : undefined, status: result.status, fout: ok ? undefined : result.body };
}

// Engelse ondertitel onder het Nederlands: aan of uit (de stand blijft bewaard in de tekstparser).
async function doEngels(knop) {
  const label = firstLine(knop.label);
  const url = `${CONFIG.scriptAgentUrl}/v0/script-agent/teleprompter-parser/engels`;
  const nu = await fetchJson(`${CONFIG.scriptAgentUrl}/v0/script-agent/teleprompter-parser/current`, { timeoutMs: 1200 });
  const stand = nu.ok && nu.body ? nu.body.engelsAan : undefined;
  if (typeof stand !== "boolean") {
    await flash(knop.key, `${label}\n--`, "uit");
    return { ok: true, overgeslagen: "stand_onbekend" };
  }
  const aan = !stand;
  const tekst = `${label}\n${aan ? "AAN" : "UIT"}`;
  if (CONFIG.droog) {
    await flash(knop.key, tekst, "gelukt");
    return { ok: true, droog: true, post: url, body: { aan } };
  }
  const result = await fetchJson(url, { method: "POST", body: { aan }, timeoutMs: 2500 });
  const ok = result.ok && result.body && result.body.ok !== false;
  await flash(knop.key, ok ? tekst : `${label}\nFAIL`, ok ? "gelukt" : "mislukt");
  return { ok, aan: ok ? aan : undefined, status: result.status, fout: ok ? undefined : result.body };
}

// Bot-simulatie in de publiekschat: de gewone bots en de For_You-personages los van elkaar aan of uit.
async function doSimulatie(knop) {
  const label = knop.label;
  const wat = knop.actie.simulatie === "personages" ? "personages" : "bots";
  const url = `${CONFIG.audienceUrl}/audience/admin/simulation/schakel`;
  if (CONFIG.droog) {
    await flash(knop.key, `${label}\nOK`, "gelukt");
    return { ok: true, droog: true, post: url, body: { wat } };
  }
  const result = await fetchJson(url, { method: "POST", body: { wat }, timeoutMs: 5000 });
  const ok = result.ok && result.body && result.body.ok !== false;
  const aan = ok && (wat === "personages" ? result.body.personages : result.body.bots > 0);
  const fout = result.body && result.body.error === "session_inactive" ? "NO QR" : "FAIL";
  await flash(knop.key, `${label}\n${ok ? (aan ? "AAN" : "UIT") : fout}`, ok ? "gelukt" : "mislukt");
  return { ok, simulatie: wat, aan: ok ? Boolean(aan) : undefined, status: result.status, fout: ok ? undefined : result.body };
}

// OPNAME: het hoofdscherm en het geluid opnemen op de schijf Expansion (gedocumenteerde-shows).
// Eén druk start, de volgende stopt. Show control doet het werk (TouchDesigner neemt op).
async function doOpname(knop) {
  const label = firstLine(knop.label);
  const loopt = fs.existsSync(CONFIG.opnamePath);
  const wat = loopt ? "stop" : "start";
  const url = `${CONFIG.showControlUrl}/v0/show-control/registratie/${wat}`;
  if (CONFIG.droog) {
    await flash(knop.key, `${label}\n${loopt ? "STOP" : "LOOPT"}`, "gelukt");
    return { ok: true, droog: true, post: url };
  }
  const result = await fetchJson(url, { method: "POST", body: {}, timeoutMs: 8000 });
  const ok = result.ok && result.body && result.body.ok === true;
  await flash(knop.key, ok ? `${label}\n${loopt ? "GESTOPT" : "LOOPT"}` : `${label}\nFAIL`, ok ? "gelukt" : "mislukt");
  return { ok, opname: ok ? !loopt : loopt, pad: result.body && result.body.pad, fout: ok ? undefined : result.body };
}

// ZAAL MIC: de microfoon van de operator klinkt over de speakers zolang de knop aan staat.
// De helper van de microfoon (hardware/mic-dictation, :3231) geeft het geluid door aan de uitgang
// van de Mac naar de tafel en sluit hem vanzelf na `max` seconden. "wissel": druk = open, druk = dicht.
// "houden": open zolang de knop ingedrukt is.
async function doZaalMic(knop, fase) {
  const houden = knop.actie.zaalmic === "houden";
  const base = `${CONFIG.micKnopUrl}/api`;
  if (CONFIG.droog) {
    if (fase !== "los") await flash(knop.key, "MIC\nOPEN", "actief");
    return { ok: true, droog: true, zaalmic: fase === "los" ? "uit" : "aan" };
  }
  let aan = fase !== "los";
  if (!houden) {
    if (fase === "los") return { ok: true, los: "niets" };
    const nu = await fetchJson(`${base}/state`, { timeoutMs: 800 });
    aan = !(nu.ok && nu.body && nu.body.zaal && nu.body.zaal.open);
  }
  const max = Number(knop.actie.max) > 0 ? `?max=${Number(knop.actie.max)}` : "";
  const result = await fetchJson(`${base}/zaal/${aan ? `aan${max}` : "uit"}`, { method: "POST", timeoutMs: 2000 });
  if (result.ok) {
    await flash(knop.key, aan ? "MIC\nOPEN" : "ZAAL\nMIC", aan ? "actief" : "klaar", aan ? FLASH_MS : 300);
    return { ok: true, zaalmic: aan ? "aan" : "uit" };
  }
  const waarom = String((result.body && result.body.fout) || "");
  const tekst = /dicteren/.test(waarom) ? "MIC\nBEZET" : /aangesloten/.test(waarom) ? "MIC\nLOS" : "MIC\nFAIL";
  await flash(knop.key, tekst, "mislukt");
  return { ok: false, zaalmic: "niet open", status: result.status, fout: waarom || result.body };
}

// Alleen de muziek van de show (inloop, loading, sfeergeluid uit TouchDesigner) aan of uit.
// Ander geluid van de Mac blijft klinken; de SQ-5 blijft ongemoeid. TD luistert op UDP 8008
// naar /osc/showmuziek_uit (1 = uit, 0 = aan), zie show/td-qhub-test/apply_show_muziek_patch.py.
async function doShowMuziek(knop) {
  const label = firstLine(knop.label);
  const uit = !fs.existsSync(CONFIG.showMuziekUitPath);
  const tekst = `${label}\n${uit ? "MUTED" : "ON"}`;
  if (CONFIG.droog) {
    await flash(knop.key, tekst, "gelukt");
    return { ok: true, droog: true, osc: "127.0.0.1:8008/osc/showmuziek_uit", waarde: uit ? 1 : 0 };
  }
  const dgram = require("node:dgram");
  const socket = dgram.createSocket("udp4");
  const send = () => new Promise((resolve, reject) => socket.send(oscInt("/osc/showmuziek_uit", uit ? 1 : 0), 8008, "127.0.0.1", (err) => (err ? reject(err) : resolve())));
  try {
    await send();
    await new Promise((resolve) => setTimeout(resolve, 80));
    await send();
    if (uit) {
      fs.mkdirSync(path.dirname(CONFIG.showMuziekUitPath), { recursive: true });
      fs.writeFileSync(CONFIG.showMuziekUitPath, new Date().toISOString());
    } else fs.rmSync(CONFIG.showMuziekUitPath, { force: true });
    await flash(knop.key, tekst, "gelukt");
    return { ok: true, showmuziek: uit ? "uit" : "aan" };
  } catch (err) {
    await flash(knop.key, `${label}\nFAIL`, "mislukt");
    return { ok: false, fout: String(err.message || err) };
  } finally {
    socket.close();
  }
}

// TEST en RANDOM: de regie van show control overnemen of vrijgeven, als "operator" (dezelfde naam als
// de regie op de operatorpagina). Vanuit SHOW twee keer drukken binnen 3 s, zodat een voorstelling
// niet per ongeluk een testrun wordt. Staat de knop al aan, dan geeft één druk de regie vrij.
const REGIE_WIE = "operator";
const REGIE_BEVESTIG_MS = 3000;
const REGIE_BEVESTIG_PAD = process.env.FY_DECK_REGIE_BEVESTIG
  || path.join(process.env.HOME || "", "Library", "Application Support", "ForYouApp", "deck-regie-bevestig.json");

async function doRegie(knop) {
  const wil = knop.actie.regie === "random" ? "random" : "test";
  const label = firstLine(knop.label);
  const basis = `${CONFIG.showControlUrl}/v0/show-control/regie`;
  const stand = await fetchJson(basis, { timeoutMs: 2000 });
  if (!stand.ok || !stand.body) {
    await flash(knop.key, `${label}
?`, "mislukt");
    return { ok: false, fout: "regie niet bereikbaar" };
  }
  const o = stand.body;
  const eigen = o.eigenaar && !o.verlopen ? o.eigenaar.wie : null;
  if (eigen && eigen !== REGIE_WIE) {
    await flash(knop.key, `${label}
BEZET`, "uit");
    return { ok: true, bezet: eigen };
  }
  let wat;
  if (o.stand === wil && eigen === REGIE_WIE) wat = "vrijgeven";
  else if (o.stand === "show") {
    let bevestig = null;
    try { bevestig = JSON.parse(fs.readFileSync(REGIE_BEVESTIG_PAD, "utf8")); } catch (_err) { bevestig = null; }
    if (!bevestig || bevestig.stand !== wil || Date.now() > Number(bevestig.tot || 0)) {
      fs.mkdirSync(path.dirname(REGIE_BEVESTIG_PAD), { recursive: true });
      fs.writeFileSync(REGIE_BEVESTIG_PAD, JSON.stringify({ stand: wil, tot: Date.now() + REGIE_BEVESTIG_MS }));
      await flash(knop.key, `${label}
NOG 1X`, "volgende", REGIE_BEVESTIG_MS);
      return { ok: true, bevestigen: wil };
    }
    fs.rmSync(REGIE_BEVESTIG_PAD, { force: true });
    wat = "overnemen";
  } else wat = "overnemen";
  if (CONFIG.droog) {
    await flash(knop.key, `${label}
${wat === "vrijgeven" ? "VRIJ" : "AAN"}`, "gelukt");
    return { ok: true, droog: true, wat, stand: wil };
  }
  await flash(knop.key, `${label}
...`, "bezig", 40000);
  const pad = wat === "vrijgeven" ? "/vrijgeven" : "/overnemen";
  const result = await fetchJson(`${basis}${pad}`, { method: "POST", body: wat === "vrijgeven" ? { wie: REGIE_WIE } : { stand: wil, wie: REGIE_WIE }, timeoutMs: 40000 });
  const ok = result.ok && result.body && result.body.ok !== false;
  await flash(knop.key, ok ? `${label}
${wat === "vrijgeven" ? "VRIJ" : "AAN"}` : `${label}
FAIL`, ok ? "gelukt" : "mislukt");
  return { ok, wat, stand: wil, fout: ok ? undefined : result.body };
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
  const body = { plek: knop.actie.omgeving, source: "streamdeck", fase: "druk" };
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

// Nummer van een personage in de scène die speelt (Marit): aan/uit. Show control bepaalt of er
// een nummer is; zonder personage met een nummer doet de knop niets.
async function doPersonage(knop) {
  const toon = async (tekst, staat, ms) => {
    await setVar(varMaat(knop.key), maatVan(tekst));
    await flash(knop.key, tekst, staat, ms);
  };
  const body = { source: "streamdeck" };
  const url = `${CONFIG.showControlUrl}/v0/show-control/cues/personage-knop`;
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

// Loslaten van een omgevingsknop. Alleen een knop die show control als "houden" meldt
// (aan zolang hij ingedrukt is, zoals haperen) krijgt een tweede bericht; de rest doet niets.
async function doOmgevingLos(knop) {
  const base = `${CONFIG.showControlUrl}/v0/show-control`;
  const plek = knop.actie.omgeving;
  if (CONFIG.droog) return { ok: true, droog: true, los: plek };
  const nu = await fetchJson(`${base}/environment-knoppen/current`, { timeoutMs: 2000 });
  const lijst = nu.ok && nu.body ? nu.body.knoppen || (nu.body.environmentKnoppen && nu.body.environmentKnoppen.knoppen) || [] : [];
  if (!lijst[plek] || !lijst[plek].houden) return { ok: true, los: "niets" };
  const result = await fetchJson(`${base}/cues/environment-knop`, { method: "POST", body: { plek, source: "streamdeck", fase: "los" }, timeoutMs: 5000 });
  const ok = result.status === 409 || (result.ok && result.body && result.body.ok !== false);
  return { ok, los: plek, status: result.status, cueId: result.body && result.body.cueId, fout: ok ? undefined : result.body };
}

async function perform(key, fase) {
  const deck = loadDeck();
  let knop = allButtons(deck).find((k) => k.key === key);
  // scèneplek (sc1..sc6): deck-status heeft er een scèneknop op gezet; doe wat die knop doet,
  // maar laat de flits op deze plek zien
  if (knop && knop.actie && knop.actie.scenePlek) {
    const bron = leesScenePlekken()[key];
    const echt = bron && sceneKnoppen(deck).find((k) => k.key === bron);
    if (!echt) return { ok: true, leeg: "geen scèneknop op deze plek" };
    knop = { ...echt, key };
  }
  if (!knop || !knop.actie) throw new Error(`geen knop met actie: ${key}`);
  const actie = knop.actie;
  if (fase === "los") {
    if (actie.zaalmic) return await doZaalMic(knop, "los");
    return Number.isInteger(actie.omgeving) ? await doOmgevingLos(knop) : { ok: true, los: "niets" };
  }
  try {
    if (actie.cue) return await doCue(knop);
    if (actie.link) return await doLink(knop);
    if (actie.stack) return await doStack(knop);
    if (actie.td) return await doTd(knop);
    if (actie.osc) return await doOsc(knop);
    if (actie.extra) return await doExtra(knop);
    if (Number.isInteger(actie.omgeving)) return await doOmgeving(knop);
    if (actie.personage) return await doPersonage(knop);
    if (actie.autofocus) return await doAutofocus(knop);
    if (actie.stem) return await doStem(knop);
    if (actie.zaal) return await doZaal(knop);
    if (actie.autocam) return await doAutocam(knop);
    if (actie.showmuziek) return await doShowMuziek(knop);
    if (actie.opname) return await doOpname(knop);
    if (actie.zaalmic) return await doZaalMic(knop, "");
    if (actie.simulatie) return await doSimulatie(knop);
    if (actie.engels) return await doEngels(knop);
    if (actie.regie) return await doRegie(knop);
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
  const fase = (nu ? argv[2] : argv[1]) === "los" ? "los" : "";
  if (!key) {
    console.error("gebruik: deck-actie.js <key>");
    process.exit(64);
  }
  if (!nu) {
    const child = spawn(process.execPath, [__filename, "--nu", key, fase], { detached: true, stdio: "ignore", env: process.env });
    child.unref();
    return;
  }
  const started = Date.now();
  try {
    const result = await perform(key, fase);
    log({ key, ...(fase ? { fase } : {}), ms: Date.now() - started, ...result });
  } catch (err) {
    log({ key, ok: false, fout: String(err && err.message || err) });
    process.exitCode = 1;
  }
}

if (require.main === module) main();

module.exports = { CUES };
