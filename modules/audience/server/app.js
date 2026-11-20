"use strict";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const {
  AUDIENCE_ALGORITHM_INPUT_SCHEMA_VERSION,
  AUDIENCE_SESSION_SCHEMA_VERSION,
  AUDIENCE_SIGNAL_SCHEMA_VERSION,
  createAudienceSessionId,
} = require("../../../shared/contracts/audience-v0");
const { bouwStageRapport } = require("./stage-rapport");
const {
  algorithmBaseUrl,
  fetchCurrentRuntimeState,
  fetchRuntimeView,
  prepareChosenSituation,
  restoreRuntimeAlgorithmContext,
  sceneVanzelfNaarChat,
  sendAudienceSignalsToAlgorithm,
  sendScoreFeedToRuntime,
} = require("../client/runtime-client");
const { fetchTelefoonKaart } = require("../client/paths-client");
const { stuurKaart } = require("./universum");
const {
  appendAudienceSession,
  appendAudienceSignal,
  readAudienceSessions,
  readAudienceSignals,
} = require("../signal-normalizer/signal-store");
const {
  buildAlgorithmInput,
  createAudienceSignal,
} = require("../signal-normalizer/signal-normalizer");
const { AudienceService, isLoopbackIp, getNameColorHex, sanitizeName, sanitizeText } = require("./audience-service");
const { loadExpress } = require("./express-loader");

const express = loadExpress();
const { createWaarschuwing } = require("./waarschuwing");
const { createSpelersReady } = require("./spelers-ready");
const { serveerTabs } = require("./telefoon-tabs");
const { personagefotoRoute } = require("./personages");
const { omgevingsbeeldRoute } = require("./omgevingsbeeld");
const { KIJK_PATH, isKijkvenster } = require("./kijkvenster");
const PUBLIC_DIR = path.resolve(__dirname, "../public");

function asyncRoute(handler) {
  return (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
}

function badRequest(message) {
  const err = new Error(message);
  err.statusCode = 400;
  return err;
}

function audienceClients() {
  return {
    fetchCurrentRuntimeState,
    fetchRuntimeView,
    fetchTelefoonKaart,
    prepareChosenSituation,
    restoreRuntimeAlgorithmContext,
    sendAudienceSignalsToAlgorithm,
    sendScoreFeedToRuntime,
  };
}

function sendJoinError(res, title, message, status = 400) {
  res.status(status).type("html").send(
    `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${title}</title></head><body style="font-family:system-ui,-apple-system,sans-serif;padding:20px;"><h1>${title}</h1><p>${message}</p><p><a href="/">Ga naar de live chat</a></p></body></html>`
  );
}

function createAudienceApp(options = {}) {
  const app = express();
  const service = options.service || new AudienceService({
    ...options,
    clients: options.clients || audienceClients(),
  });
  app.locals.audienceService = service;
  // De content warning bij START SHOW (waarschuwing.js); de telefoons krijgen de stand bij het verbinden.
  const waarschuwing = createWaarschuwing(service);
  const spelersReady = createSpelersReady({ service, fetchRuntimeView });
  service.waarschuwing = waarschuwing;
  app.use(express.json({ limit: "512kb" }));
  app.use("/audience/vendor", express.static(path.join(PUBLIC_DIR, "vendor"), { fallthrough: false }));
  app.use("/audience/public/tabs", serveerTabs(express, PUBLIC_DIR));

  app.get("/health", (_req, res) => {
    res.json(service.health());
  });

  app.get(["/", "/app", "/audience/public"], (_req, res) => {
    res.sendFile(path.join(PUBLIC_DIR, "index.html"));
  });

  // Kijkvenster voor de operator: dezelfde telefoonpagina, maar een verbinding vanaf dit adres
  // telt niet als publiek en kan niets insturen (zie realtime.js).
  // De telefoonpagina vraagt eerst een naam; het kijkvenster kan niets aantikken en slaat die stap over.
  // De naam hieronder wordt nooit verstuurd (een kijkvenster kan niets insturen).
  // De telefoonpagina blijft na een nieuwe sessie wachten op een nieuwe QR. Een kijkvenster heeft geen
  // QR: deze pagina houdt de telefoonpagina in een eigen venster en laadt hem opnieuw zodra de sessie
  // wisselt of de dienst herstart is. Zo loopt het kijkvenster de hele dag mee.
  app.get(`${KIJK_PATH}/stand`, (_req, res) => {
    const sessie = service.getActiveSession();
    res.set("Cache-Control", "no-store");
    res.json({ ok: true, sessie: sessie ? Number(sessie.id) : 0, dienst: service.serverInstanceId });
  });
  app.get(`${KIJK_PATH}/start`, (_req, res) => {
    res.type("html").send(
      `<!doctype html><meta charset="utf-8"><title>For_You</title>
<style>html,body{margin:0;height:100%;background:#000;overflow:hidden}iframe{display:block;width:100%;height:100%;border:0}</style>
<body><iframe id="telefoon" title="Telefoon van het publiek"></iframe><script>
try { if (!localStorage.getItem("live_name")) localStorage.setItem("live_name", "Kijkvenster"); } catch (e) {}
var telefoon = document.getElementById("telefoon");
var stand = null;
function laad() { telefoon.src = ${JSON.stringify(KIJK_PATH)}; }
function kijk() {
  fetch(${JSON.stringify(`${KIJK_PATH}/stand`)}, { cache: "no-store" })
    .then(function (r) { return r.json(); })
    .then(function (s) {
      var nu = s.sessie + "|" + s.dienst;
      if (stand !== null && nu !== stand) laad();
      stand = nu;
    })
    .catch(function () {});
}
laad();
kijk();
setInterval(kijk, 2000);
</script></body>`
    );
  });

  app.get(KIJK_PATH, (_req, res) => {
    res.sendFile(path.join(PUBLIC_DIR, "index.html"));
  });

  app.get(["/admin", "/audience/admin"], (_req, res) => {
    res.sendFile(path.join(PUBLIC_DIR, "admin.html"));
  });

  // TIJDELIJK: TouchDesigner (webrender_wifi en webrender_sessie) vraagt de podiumpagina's
  // nog op het oude adres op. Stuur die door tot show/td-qhub-test/apply_publiek_adres_patch.py
  // in TouchDesigner is gedraaid; daarna kan dit blok weg.
  app.get(/^\/v2\/audience\/stage(\/.*)?$/, (req, res) => {
    res.redirect(307, req.originalUrl.replace(/^\/v2\/audience/, "/audience"));
  });

  app.get("/audience/stage", (_req, res) => {
    res.sendFile(path.join(PUBLIC_DIR, "stage.html"));
  });

  // Podiumlagen voor TouchDesigner (1080x1920, transparant): alleen emoji, of alleen de getypte reacties.
  app.get("/audience/stage/emoji", (_req, res) => {
    res.sendFile(path.join(PUBLIC_DIR, "stage-emoji.html"));
  });

  app.get("/audience/stage/chat", (_req, res) => {
    res.sendFile(path.join(PUBLIC_DIR, "stage-chat.html"));
  });

  // Tussenscherm: titel, het script dat gegenereerd wordt, tellingen en reacties van de vorige scène.
  // Ready per speler: de knop op de telefoon van de speler (alleen op het netwerk van de show).
  app.get("/audience/ready", (_req, res) => {
    res.sendFile(path.join(PUBLIC_DIR, "ready.html"));
  });
  // Instelstand (inloop, show control): de teleprompters tonen de eigen camera; een hand omhoog zet
  // dan de key aan of uit in plaats van READY.
  const showControlBasis = String(process.env.AUDIENCE_SHOW_CONTROL_URL || "http://127.0.0.1:3025").replace(/\/+$/, "");
  const instelCache = { om: 0, waarde: null };
  async function instelNu() {
    if (Date.now() - instelCache.om < 1000) return instelCache.waarde;
    instelCache.om = Date.now();
    try {
      const antwoord = await fetch(`${showControlBasis}/v0/show-control/instel`, { signal: AbortSignal.timeout(800) });
      instelCache.waarde = antwoord.ok ? await antwoord.json() : null;
    } catch (_err) {
      instelCache.waarde = null;
    }
    return instelCache.waarde;
  }
  app.get("/audience/ready/stand", asyncRoute(async (_req, res) => {
    res.set("Cache-Control", "no-store");
    // De teleprompters (andere poort) lezen mee voor hun groene kader.
    res.set("Access-Control-Allow-Origin", "*");
    const inst = await instelNu();
    res.json({ ok: true, ...(await spelersReady.haal()), instel: !!(inst && inst.aan), instelKeys: inst ? inst.keys : null });
  }));
  app.post("/audience/ready/speler", asyncRoute(async (req, res) => {
    const body = req.body || {};
    if (body.bron === "hand") {
      const inst = await instelNu();
      if (inst && inst.aan) {
        instelCache.om = 0;
        const antwoord = await fetch(`${showControlBasis}/v0/show-control/instel/key`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ plek: body.plek, key: "wissel", bron: "hand" }),
          signal: AbortSignal.timeout(3000),
        }).catch(() => null);
        const uit = antwoord ? await antwoord.json().catch(() => ({})) : { ok: false, error: "show_control_onbereikbaar" };
        res.status(antwoord && antwoord.ok ? 200 : 502).json({ ...uit, instel: true });
        return;
      }
    }
    res.json(await spelersReady.zet(body.plek, body.ready !== false));
  }));
  // De klikker (via de teleprompter) tussen de scènes: de speler met de klikker is ready.
  app.post("/audience/ready/klikker", asyncRoute(async (req, res) => {
    res.json(await spelersReady.zet(spelersReady.KLIKKER_PLEK, !(req.body && req.body.ready === false)));
  }));
  app.get("/audience/stage/tussen", (_req, res) => {
    res.sendFile(path.join(PUBLIC_DIR, "stage-tussen.html"));
  });

  // Publiekscamera: tellingen en uitsneden van lachende gezichten, alleen van deze Mac zelf.
  app.post("/audience/camera", (req, res) => {
    if (!isLoopbackIp(req.socket && req.socket.remoteAddress)) { res.status(403).json({ ok: false }); return; }
    const result = service.zetCamera(req.body || {});
    res.status(result.ok ? 200 : 400).json(result);
  });

  // Live beeld van de publiekscamera (klein, buiten scènes), alleen van deze Mac zelf. Alleen het nieuwste
  // beeld staat in het geheugen; er wordt niets bewaard.
  app.post("/audience/camera/beeld", express.raw({ type: "image/jpeg", limit: "1mb" }), (req, res) => {
    if (!isLoopbackIp(req.socket && req.socket.remoteAddress)) { res.status(403).end(); return; }
    const jpeg = Buffer.isBuffer(req.body) ? req.body : null;
    if (!jpeg || jpeg.length < 4 || jpeg[0] !== 0xff || jpeg[1] !== 0xd8) { res.status(400).end(); return; }
    service.zetCameraBeeld(jpeg);
    res.status(204).end();
  });

  // Het live beeld als doorlopende stroom (MJPEG) voor het zaalscherm.
  app.get("/audience/stage/camera", (req, res) => {
    res.writeHead(200, {
      "Content-Type": "multipart/x-mixed-replace; boundary=beeld",
      "Cache-Control": "no-store",
      Connection: "close",
    });
    const stuur = (jpeg) => {
      // Een trage kijker slaat beelden over in plaats van geheugen op te stapelen.
      if (res.writableLength > 2 * 1024 * 1024) return;
      res.write(`--beeld\r\nContent-Type: image/jpeg\r\nContent-Length: ${jpeg.length}\r\n\r\n`);
      res.write(jpeg);
      res.write("\r\n");
    };
    const laatste = service.cameraBeeld();
    if (laatste) stuur(laatste);
    service.on("camera-beeld", stuur);
    req.on("close", () => service.off("camera-beeld", stuur));
  });

  // Uitsnede van een gezicht uit de scène, voor het rapport op het zaalscherm.
  app.get("/audience/stage/persoon/:persoon/:groep", (req, res) => {
    const jpeg = service.cameraFoto(req.query.situationRunId, req.params.persoon, req.params.groep);
    if (!jpeg) { res.status(404).end(); return; }
    res.set("Cache-Control", "no-store").type("jpeg").send(jpeg);
  });

  // Rapportvenster na een scène: reacties, de som, de stand per label en de scène die hierna komt.
  // Het zaalscherm meldt dat het venster met de tekst in beeld komt: de scène die klaarstaat gaat
  // dan vanzelf naar de chat van de script-agent (show control doet dat één keer per scène).
  app.post("/audience/stage/tekst-in-beeld", asyncRoute(async (req, res) => {
    let uitkomst = null;
    // Tijdens het stemmen na een scène: alleen schrijven als de volgende scène al vastligt. In de
    // startfase kiest het publiek nog, dan wacht de tekst tot de stemming op de startscène voorbij is.
    if (req.query.tijdensStemmen === "1") {
      const result = await fetchRuntimeView().catch(() => null);
      const state = result && result.ok ? result.state : null;
      if (!state || state.status !== "running" || state.activeSituation) { res.json({ ok: true, gestuurd: false, reden: "geen_run" }); return; }
      if (state.startPhase && state.startPhase.active && !(state.preparedNext && state.preparedNext.reason === "operator_chosen")) {
        res.json({ ok: true, gestuurd: false, reden: "startfase" });
        return;
      }
    }
    try {
      uitkomst = await sceneVanzelfNaarChat();
    } catch (err) {
      uitkomst = { ok: false, fout: err && err.message ? String(err.message).slice(0, 200) : "onbekend" };
    }
    res.json(uitkomst || { ok: false });
  }));

  app.get("/audience/stage/rapport", asyncRoute(async (req, res) => {
    res.set("Cache-Control", "no-store");
    const result = await fetchRuntimeView();
    const view = result && result.ok ? result.state : null;
    if (!view || !view.showRunId) { res.json({ ok: true, klaar: false, reden: "geen_run" }); return; }
    let report = null;
    try {
      const response = await fetch(`${algorithmBaseUrl()}/v0/algorithm/scoring-contexts/${encodeURIComponent(view.showRunId)}/report`, { signal: AbortSignal.timeout(2500) });
      if (response.ok) report = await response.json();
    } catch (_err) {
      report = null;
    }
    if (!report) { res.json({ ok: true, klaar: false, reden: "algoritme_niet_bereikbaar" }); return; }
    const rapport = bouwStageRapport(report, view, req.query.situationRunId ? String(req.query.situationRunId) : null);
    // De gezichten komen rechtstreeks van de publiekscamera (alleen in het geheugen van deze dienst).
    if (rapport.klaar && rapport.scene && rapport.scene.camera) rapport.scene.camera.groepen = service.cameraGroepen(rapport.scene.situationRunId);
    res.json(rapport);
  }));

  // Up next: de scène die klaarstaat, welk personage elke speler speelt (per plek in de ring), hoe
  // sterk het algoritme nu naar elk label trekt, de topfavoriet als die in de scène zit, en of de
  // operator READY heeft gedrukt.
  let upNextReady = { situationId: "", ready: false, at: 0 };
  app.post("/audience/admin/ready", asyncRoute(async (req, res) => {
    const ready = !(req.body && req.body.ready === false);
    // READY hoort bij de scène die nu klaarstaat; bij de volgende scène is het weer uit.
    let situationId = String((req.body && req.body.situationId) || "");
    if (!situationId) {
      const result = await fetchRuntimeView().catch(() => null);
      const klaar = result && result.ok && result.state ? result.state.resolvedPreparedNext || result.state.preparedNext : null;
      situationId = klaar && klaar.situationId ? String(klaar.situationId) : "";
    }
    upNextReady = { situationId, ready, at: Date.now() };
    service.emit("broadcast", { type: "up_next_ready", ready, situationId });
    res.json({ ok: true, ...upNextReady });
  }));
  // Het zaalscherm laat de klok zien: die begint dan bij de volle duur (scherm en telefoons).
  app.post("/audience/stage/stemklok-start", (_req, res) => {
    const beoordeling = service.beoordeling.klokOpnieuw();
    res.json({ ok: true, opnieuw: !!beoordeling });
  });
  // De kiezer op het zaalscherm is geland: nu ziet ook de teleprompter de volgende scène.
  app.post("/audience/stage/keuze-getoond", asyncRoute(async (_req, res) => {
    // De telefoons tonen de gekozen scène nu ook.
    service.universumStap("keuze");
    const basis = String(process.env.AUDIENCE_SCRIPT_AGENT_URL || "http://127.0.0.1:3027").replace(/\/+$/, "");
    try {
      const antwoord = await fetch(`${basis}/v0/script-agent/teleprompter-parser/keuze`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ wacht: false }), signal: AbortSignal.timeout(2000) });
      res.json({ ok: antwoord.ok });
    } catch (err) {
      res.json({ ok: false, fout: err && err.message ? String(err.message).slice(0, 200) : "onbekend" });
    }
  }));
  app.get("/audience/stage/up-next", asyncRoute(async (_req, res) => {
    res.set("Cache-Control", "no-store");
    const result = await fetchRuntimeView().catch(() => null);
    const view = result && result.ok ? result.state : null;
    const klaar = view && view.resolvedPreparedNext;
    if (!view || !view.showRunId || !klaar) { res.json({ ok: true, klaar: false }); return; }
    const catalog = (view.showRunSnapshot && view.showRunSnapshot.catalog) || {};
    const plekVan = new Map((catalog.performers || []).map((speler) => [speler.id, Number(speler.performerSlot) || 0]));
    const plekken = (klaar.performerSlots || [])
      .filter((slot) => slot && slot.characterId)
      .map((slot) => ({ plek: plekVan.get(slot.performerId) || Number(slot.slotIndex) || 0, personage: String(slot.characterName || "").trim(), characterId: String(slot.characterId) }))
      .filter((rij) => rij.plek >= 1 && rij.plek <= 3);
    let report = null;
    try {
      const response = await fetch(`${algorithmBaseUrl()}/v0/algorithm/scoring-contexts/${encodeURIComponent(view.showRunId)}/report`, { signal: AbortSignal.timeout(2500) });
      if (response.ok) report = await response.json();
    } catch (_err) {
      report = null;
    }
    const labels = report && Array.isArray(report.labelTrek) ? report.labelTrek.map((rij) => ({ id: rij.id, naam: rij.name, procent: rij.procent })) : [];
    // De labels van de scène die komt, met hoe sterk het algoritme er nu naar trekt.
    const sceneLabels = (klaar.labelIds || []).map((id) => labels.find((rij) => rij.id === id)).filter(Boolean);
    const top = report && Array.isArray(report.favorieten) ? report.favorieten[0] : null;
    const favoriet = top && plekken.some((rij) => rij.characterId === top.characterId) ? top.name : null;
    const ready = upNextReady.ready && upNextReady.situationId === klaar.situationId;
    // Toppersonages volgens de personagevraag (voor de tussenkaart met het rapport).
    const toppersonages = report && Array.isArray(report.favorieten) ? report.favorieten.slice(0, 3).map((rij) => rij.name) : [];
    // De lange lijst voor de tussenkaart: personages op gemiddelde score van hun scènes, met hoe vaak ze
    // speelden, de hartjes en hoe vaak ze bij de personagevraag gekozen werden.
    const gekozen = new Map((report && Array.isArray(report.favorieten) ? report.favorieten : []).map((rij) => [rij.characterId, rij.aandeel]));
    const fotoVan = (characterId) => {
      const foto = characterId ? service.beoordeling.personagefoto(view.showRunId, characterId) : null;
      return foto ? `/audience/stage/personagefoto/${encodeURIComponent(characterId)}?run=${encodeURIComponent(view.showRunId)}&v=${foto.at}` : null;
    };
    const personages = (report && Array.isArray(report.characters) ? report.characters : []).slice(0, 10).map((rij) => ({
      id: rij.id || null,
      // Snapshot van de speler als dit personage (uit de scène), als die er is.
      foto: fotoVan(rij.id),
      naam: rij.name,
      score: rij.averageScore,
      scenes: rij.scenes,
      hartjes: rij.hearts,
      gekozen: gekozen.has(rij.id) ? Math.round(gekozen.get(rij.id) * 100) : null,
    }));
    // Kaartjes in het universum: de personages van deze scène in kleur, en tot vijf personages uit andere
    // vrije scènes in grijs (bij hun ster). Alleen personages met een foto. Grijs: tot twaalf kandidaten,
    // het universum tekent de eerste vijf waarvan de ster in beeld staat.
    const kaartFoto = (characterId) => {
      const foto = characterId ? service.beoordeling.personagekaart(view.showRunId, characterId) : null;
      return foto ? `/audience/stage/personagekaart/${encodeURIComponent(characterId)}?run=${encodeURIComponent(view.showRunId)}&v=${foto.at}` : null;
    };
    const nummer = (id) => Number(/(\d+)$/.exec(String(id || ""))?.[1]) || 0;
    const kleurIds = new Set(plekken.map((rij) => rij.characterId));
    const kleur = plekken.slice().sort((a, b) => a.plek - b.plek).map((rij) => ({ id: rij.characterId, naam: rij.personage, foto: kaartFoto(rij.characterId) })).filter((rij) => rij.foto);
    const situaties = new Map((catalog.situations || []).map((situatie) => [situatie.id, situatie]));
    const grijs = [];
    const gezien = new Set(kleurIds);
    for (const item of Array.isArray(view.eligiblePool) ? view.eligiblePool : []) {
      if (grijs.length >= 12) break;
      if (!item || item.situationId === klaar.situationId) continue;
      const situatie = situaties.get(item.situationId);
      for (const characterId of (situatie && situatie.characterIds) || []) {
        if (grijs.length >= 12 || gezien.has(characterId)) continue;
        const foto = kaartFoto(characterId);
        if (!foto) continue;
        gezien.add(characterId);
        grijs.push({ id: characterId, sceneId: nummer(item.legacySituationId || item.situationId), foto });
        break; // één personage per ster
      }
    }
    const kaartjes = { sceneId: nummer(klaar.legacySituationId || klaar.situationId), kleur, grijs };
    res.json({ ok: true, klaar: true, situationId: klaar.situationId, titel: klaar.title || "", prompt: klaar.promptText || "", plekken, labels, sceneLabels, favoriet, toppersonages, personages, kaartjes, ready, spelersReady: spelersReady.publiek(), speelt: !!view.activeSituation });
  }));

  // De vragen na de scène: de stand (wat er openstaat, de tellingen, de laatste uitslag).
  app.get("/audience/stage/beoordeling", (_req, res) => {
    res.set("Cache-Control", "no-store");
    res.json(service.beoordeling.stand());
  });
  // De operator sluit het stemmen eerder (de spelers zijn klaar): de klok hoeft niet uit te lopen.
  app.post("/audience/admin/beoordeling/sluit", (_req, res) => {
    const uitslag = service.beoordeling.sluit("operator");
    res.json({ ok: true, gesloten: !!uitslag });
  });
  app.post("/audience/admin/beoordeling/instellingen", (req, res) => {
    res.json({ ok: true, instellingen: service.beoordeling.zetInstellingen(req.body || {}) });
  });
  // De twee schakelaars van de regiepagina (show control): aftellen voor de scène, stemronde erna.
  const schakelaars = () => ({ ok: true, aftellen: spelersReady.aftellen(), stemronde: service.beoordeling.stand().instellingen.aan !== false });
  app.get("/audience/admin/schakelaars", (_req, res) => {
    res.set("Cache-Control", "no-store");
    res.json(schakelaars());
  });
  app.post("/audience/admin/schakelaars", (req, res) => {
    const body = req.body || {};
    if (typeof body.aftellen === "boolean") spelersReady.zetAftellen(body.aftellen);
    if (typeof body.stemronde === "boolean") service.beoordeling.zetInstellingen({ aan: body.stemronde });
    res.json(schakelaars());
  });
  // Een foto van een speler uit de scène die speelt of net gespeeld is: JPEG, ?plek=1..3 (de plek van de
  // speler in de ring), eventueel ?situationRunId=. Blijft alleen in het geheugen.
  app.post("/audience/beoordeling/foto", express.raw({ type: "image/jpeg", limit: "200kb" }), (req, res) => {
    const result = service.beoordeling.zetFoto({ situationRunId: req.query.situationRunId, plek: req.query.plek, jpeg: req.body, punten: req.query.punten });
    res.status(result.ok ? 200 : 400).json(result);
  });
  // De snapshot van een personage in deze run: de speler als dat personage, uit de laatste scène waarin
  // het speelde. Zonder snapshot 204.
  // Personagestab op de telefoon in de zaal (LAN): dezelfde verkleinde foto als op de publieke poort.
  app.get("/audience/public/personagefoto/:characterId", personagefotoRoute(service));
  app.get("/audience/public/omgevingsbeeld/:nr", omgevingsbeeldRoute(service));

  app.get("/audience/stage/personagefoto/:characterId", (req, res) => {
    const foto = service.beoordeling.personagefoto(String(req.query.run || ""), req.params.characterId);
    if (!foto) { res.set("Cache-Control", "no-store"); return res.status(204).end(); }
    res.set("Cache-Control", req.query.v ? "public, max-age=3600" : "no-store");
    res.type("image/jpeg").send(foto.jpeg);
  });

  // De foto voor een kaartje in het universum (gekozen uit het archief, of de snapshot). Het universum
  // draait op een andere poort en tekent de foto op een canvas: daarom mag elke herkomst hem lezen.
  app.get("/audience/stage/personagekaart/:characterId", (req, res) => {
    res.set("Access-Control-Allow-Origin", "*");
    const foto = service.beoordeling.personagekaart(String(req.query.run || ""), req.params.characterId);
    if (!foto) { res.set("Cache-Control", "no-store"); return res.status(204).end(); }
    res.set("Cache-Control", req.query.v ? "public, max-age=3600" : "no-store");
    res.type("image/jpeg").send(foto.jpeg);
  });

  // Hoeveel deelnemers er in deze sessie meedoen (telefoons met een naam, geen bots).
  app.get("/audience/stage/deelnemers", (_req, res) => {
    res.set("Cache-Control", "no-store");
    res.json({ ok: true, deelnemers: service.aantalDeelnemers() });
  });

  // De ranking van de chat: wie het meest schreef.
  app.get("/audience/stage/ranking", (_req, res) => {
    res.set("Cache-Control", "no-store");
    res.json({ ok: true, ranking: service.getRanking() });
  });
  // De spelers die zich klaarmaken: het laatste beeld per plek (1..3), aangeleverd door wie de camera's heeft.
  app.post("/audience/stage/spelerbeeld", express.raw({ type: "image/jpeg", limit: "300kb" }), (req, res) => {
    const result = service.zetSpelerbeeld(req.query.plek, req.body);
    res.status(result.ok ? 200 : 400).json(result);
  });
  // De drie spelers als doorlopende beeldstroom: TouchDesigner bewaart buiten de scène een strook met
  // de drie camera's naast elkaar (strook_0..2.jpg om de beurt, zo'n 17 per seconde). Is er geen verse
  // strook, dan komt er niets (204) en valt het zaalscherm terug op de losse beelden per speler.
  app.get("/audience/stage/spelers-stroom", (req, res) => {
    const map = process.env.AUDIENCE_SPELERBEELD_DIR || path.join(os.homedir(), "ForYou", "spelerbeeld");
    // Het op één na nieuwste bestand is zeker af; het nieuwste wordt misschien nog geschreven.
    const kies = () => {
      const lijst = [];
      for (const n of [0, 1, 2]) {
        try { const bestand = path.join(map, `strook_${n}.jpg`); lijst.push({ bestand, at: fs.statSync(bestand).mtimeMs }); } catch (_err) {}
      }
      lijst.sort((a, b) => b.at - a.at);
      return lijst.length >= 2 ? lijst[1] : null;
    };
    const eerste = kies();
    if (!eerste || Date.now() - eerste.at > 3000) { res.status(204).end(); return; }
    res.writeHead(200, { "Content-Type": "multipart/x-mixed-replace; boundary=beeld", "Cache-Control": "no-store", Connection: "close" });
    let laatst = 0;
    const tik = () => {
      const nu = kies();
      // Komt er een tijd niets meer (TouchDesigner gestopt), dan eindigt de stroom.
      if (!nu || Date.now() - nu.at > 120000) { clearInterval(timer); res.end(); return; }
      if (nu.at === laatst || res.writableLength > 1024 * 1024) return;
      let jpeg = null;
      try { jpeg = fs.readFileSync(nu.bestand); } catch (_err) { return; }
      if (jpeg.length < 100) return;
      laatst = nu.at;
      res.write(`--beeld\r\nContent-Type: image/jpeg\r\nContent-Length: ${jpeg.length}\r\n\r\n`);
      res.write(jpeg);
      res.write("\r\n");
    };
    const timer = setInterval(tik, 25);
    tik();
    req.on("close", () => clearInterval(timer));
  });
  app.get("/audience/stage/spelerbeeld/:plek", (req, res) => {
    const jpeg = service.getSpelerbeeld(req.params.plek);
    res.set("Cache-Control", "no-store");
    if (!jpeg) return res.status(204).end();
    res.type("image/jpeg").send(jpeg);
  });

  // Live stroom voor de podiumlagen (Server-Sent Events): fase, emoji, reacties, instellingen.
  const STROOM_TYPES = new Set(["stage_herlaad", "comment", "comment_likes", "reaction_update", "stage_reaction", "fase", "reacties", "stage_settings", "session_reset", "session_closed", "chat_reset", "start_stemming", "poll_update", "poll_closed", "start_stemming_uitslag", "ranking", "beoordeling", "beoordeling_dicht", "beoordeling_stem", "waarschuwing", "spelers_ready", "speler_ready", "show_gestart"]);
  // Stand van de stemming op de startscène, voor het zaalscherm en het universum.
  app.get("/audience/stage/start-stemming", (_req, res) => {
    const stemming = service.getStartStemming();
    const poll = service.getActivePollSnapshot();
    const actief = !!(stemming && poll && poll.start);
    const counts = actief ? poll.counts : stemming && stemming.uitslag ? stemming.uitslag.counts : [];
    res.set("Cache-Control", "no-store");
    res.json({
      ok: true,
      actief,
      showRunId: stemming ? stemming.showRunId : null,
      endsAt: actief ? poll.endsAt : null,
      totalVotes: actief ? poll.totalVotes : stemming && stemming.uitslag ? stemming.uitslag.totalVotes : 0,
      keuzes: stemming ? (stemming.keuzes || []).map((keuze, index) => ({ ...keuze, votes: Number(counts[index] || 0) })) : [],
      uitslag: stemming ? stemming.uitslag || null : null,
      startscene: stemming ? stemming.startscene || null : null,
      // Is START SHOW al gegeven voor de run die loopt?
      showGestart: service.isShowGestart(),
      // De stap vóór START SHOW: moet de content warning nog in beeld komen, en staat hij er nu?
      waarschuwingNodig: waarschuwing.nodig(),
      waarschuwingStaat: !!waarschuwing.publiek(),
    });
  });
  app.post("/audience/admin/show/start", asyncRoute(async (_req, res) => {
    // Net gestarte run (regie: test of random): eerst de run volgen, anders is hij hier nog onbekend.
    if (!service.isShowGestart()) await service.pollFase().catch(() => {});
    const result = service.startShow();
    // De show begint: de content warning (de stap ervoor) gaat van het scherm.
    if (result.ok) waarschuwing.weg();
    res.status(result.ok ? 200 : 409).json(result);
  }));

  // De content warning: de stand, de instellingen uit Admin, en met de hand tonen of weghalen.
  app.get("/audience/stage/waarschuwing", (_req, res) => {
    res.set("Cache-Control", "no-store");
    res.json(waarschuwing.stand());
  });
  app.get("/audience/stage/waarschuwing.js", (_req, res) => {
    res.set("Cache-Control", "no-store");
    res.sendFile(path.join(PUBLIC_DIR, "stage-waarschuwing.js"));
  });
  app.post("/audience/admin/waarschuwing/instellingen", (req, res) => {
    res.json({ ok: true, instellingen: waarschuwing.zetInstellingen(req.body || {}) });
  });
  app.post("/audience/admin/waarschuwing/toon", (_req, res) => {
    const getoond = waarschuwing.toon();
    res.status(getoond ? 200 : 409).json(getoond ? { ok: true, waarschuwing: getoond } : { ok: false, error: "geen_tekst" });
  });
  app.post("/audience/admin/waarschuwing/weg", (_req, res) => {
    res.json({ ok: true, weg: waarschuwing.weg() });
  });

  app.get("/audience/stage/stroom", (req, res) => {
    res.set({
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-store",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });
    res.flushHeaders();
    const stuur = (msg) => {
      try { res.write(`data: ${JSON.stringify(msg)}\n\n`); } catch {}
    };
    let berichten = [];
    try {
      const history = service.publicHistory(60);
      berichten = (history.messages || []).filter((m) => !m.system);
    } catch {}
    stuur({
      type: "begin",
      fase: service.getFase(),
      reacties: service.getReacties(),
      ronde: service.getRonde(),
      startStemming: (() => {
        const poll = service.getActivePollSnapshot();
        return poll && poll.start ? poll : null;
      })(),
      settings: service.getStageControl(req).settings,
      berichten,
      ranking: service.getRanking(),
      beoordeling: service.beoordeling.publiek(),
      waarschuwing: waarschuwing.publiek(),
      // Inloop: zolang START SHOW niet gegeven is, toont het zaalscherm nog geen scène.
      showGestart: service.isShowGestart(),
    });
    const doorsturen = (msg) => {
      if (!msg || !STROOM_TYPES.has(msg.type)) return;
      if (msg.type === "comment" && msg.system) return;
      stuur(msg);
    };
    service.on("broadcast", doorsturen);
    const hartslag = setInterval(() => {
      try { res.write(": hartslag\n\n"); } catch {}
    }, 15000);
    req.on("close", () => {
      clearInterval(hartslag);
      service.off("broadcast", doorsturen);
    });
  });

  app.get("/audience/stage/session-qr", (_req, res) => {
    res.sendFile(path.join(PUBLIC_DIR, "stage-qr.html"));
  });

  app.get("/audience/stage/wifi-qr", (_req, res) => {
    res.sendFile(path.join(PUBLIC_DIR, "stage-wifi-qr.html"));
  });

  app.get("/audience/stage/wifi-qr/state", (_req, res) => {
    res.set("Cache-Control", "no-store");
    res.json({ ok: true, wifiQr: service.getWifiQr() });
  });

  app.get("/join", (req, res) => {
    const token = String(req.query && req.query.token || "");
    if (!token) {
      service.clearAccessCookie(res, req);
      sendJoinError(res, "Join-link ongeldig", "Deze link bevat geen geldige token.", 400);
      return;
    }
    const joined = service.registerJoinFromToken(token, req);
    if (!joined.ok) {
      service.clearAccessCookie(res, req);
      const inactive = joined.error === "session_inactive";
      sendJoinError(
        res,
        inactive ? "Sessie is beeindigd" : "Join-link verlopen",
        inactive
          ? "Deze sessie is gesloten. Vraag de moderator om een nieuwe QR-code."
          : "Deze sessie-link is niet meer geldig. Vraag een nieuwe QR-code aan de moderator.",
        joined.status || 410
      );
      return;
    }
    service.setAccessCookie(res, req, joined.grant);
    res.redirect(302, "/");
  });

  app.get("/audience/status", asyncRoute(async (req, res) => {
    res.json(await service.adminState(req));
  }));

  // Universum op de telefoon (universum.js): eigen pagina en de kaart zonder namen.
  app.get("/audience/universum", (_req, res) => {
    res.sendFile(path.join(PUBLIC_DIR, "universum.html"));
  });

  app.get("/audience/universum/tab.js", (_req, res) => {
    res.set("Cache-Control", "no-store");
    res.type("application/javascript").sendFile(path.join(PUBLIC_DIR, "tabs", "universum.js"));
  });

  app.get("/audience/universum/kaart", (req, res) => {
    const ip = req.socket && req.socket.remoteAddress;
    const access = isKijkvenster(req) && service.getActiveSession()
      ? { ok: true }
      : service.ensureSessionAccessForRequest(req, ip);
    if (!access.ok) {
      res.status(access.reason === "session_inactive" ? 410 : 403).json({ ok: false, error: access.reason });
      return;
    }
    stuurKaart(service.universum, req, res);
  });

  app.get("/audience/public/history", (req, res) => {
    const ip = req.socket && req.socket.remoteAddress;
    const access = isKijkvenster(req) && service.getActiveSession()
      ? { ok: true }
      : service.ensureSessionAccessForRequest(req, ip);
    if (!access.ok) {
      res.status(access.reason === "session_inactive" ? 410 : 403).json({
        ok: false,
        error: access.reason,
        messages: [],
      });
      return;
    }
    res.json(service.publicHistory(req.query.limit));
  });

  app.post("/audience/public/debug", (_req, res) => {
    res.status(204).end();
  });

  app.get("/audience/public/debug-log", (_req, res) => {
    res.json({ ok: true, lines: [] });
  });

  app.get("/audience/admin/state", asyncRoute(async (req, res) => {
    res.json(await service.adminState(req));
  }));

  app.post("/audience/admin/settings/message-slowdown", (req, res) => {
    const settings = service.updateMessageSlowdown(req.body && req.body.ms);
    res.json({
      ok: true,
      messageSlowdownMs: settings.messageSlowdownMs,
      messageSlowdownMinMs: 500,
      messageSlowdownMaxMs: 8000,
    });
  });

  app.post("/audience/admin/settings/engagement-comment-points", (req, res) => {
    const settings = service.updateEngagementCommentPoints(req.body && req.body.points);
    res.json({
      ok: true,
      commentPoints: settings.engagementCommentPoints,
      commentPointsMin: 2,
      commentPointsMax: 150,
      emojiPoints: 1,
      commentMinChars: 4,
      duplicateWindowMs: 30000,
    });
  });

  app.post("/audience/admin/stage/settings", (req, res) => {
    res.json({ ok: true, stage: service.updateStageSettings(req.body || {}, req) });
  });

  // Chat leegmaken op de telefoons en het zaalscherm (gebeurt vanzelf bij RESET RUN).
  app.post("/audience/admin/chat/wis", (_req, res) => {
    res.json(service.wisChat("admin"));
  });

  // De operator praat mee in de chat (invoerveld op de operatorpagina). Het bericht komt op de telefoons
  // en het zaalscherm, maar telt nergens mee: geen signaal naar het algoritme, geen plek in de tellingen.
  app.post("/audience/admin/chat/zeg", (req, res) => {
    const session = service.activeSessionRequired();
    const ruweNaam = String(req.body && req.body.name || "").trim();
    const text = sanitizeText(req.body && req.body.text);
    if (!ruweNaam) {
      res.status(400).json({ ok: false, error: "naam_ontbreekt", message: "Vul eerst een naam in." });
      return;
    }
    if (!text) {
      res.status(400).json({ ok: false, error: "tekst_ontbreekt", message: "Geen tekst." });
      return;
    }
    if (service.fase && service.fase.fase === "scene") {
      res.status(409).json({ ok: false, error: "scene_typen_dicht", message: "Typen kan weer na de scène." });
      return;
    }
    const name = sanitizeName(ruweNaam);
    const payload = {
      type: "comment",
      time: new Date().toISOString(),
      name,
      text,
      nameColor: getNameColorHex(name),
      isBot: true,
      simulated: false,
      // De operator krijgt een mod-zwaardje voor zijn naam (telefoon en zaalscherm).
      mod: true,
    };
    payload.id = service.store.insertChatMessage({
      sessionId: session.id,
      name,
      text,
      status: "accepted",
      detail: "operator",
      isBot: true,
    });
    payload.likes = 0;
    service.emit("broadcast", payload);
    service.emit("admin-state-changed");
    res.json({ ok: true, payload });
  });

  // Podiumpagina's (emoji, chat, tussen) laten herladen, bv. na een update; TD hoeft niets te doen.
  app.post("/audience/admin/stage/herlaad", (_req, res) => {
    service.emit("broadcast", { type: "stage_herlaad" });
    res.json({ ok: true });
  });

  // Noodknop: tabs naast de chat op de publiekstelefoon aan of uit, zonder herladen.
  app.post("/audience/admin/tabs", (req, res) => {
    res.json({ ok: true, tabs: service.saveTelefoonTabs(req.body || {}) });
  });

  app.post("/audience/admin/reacties", (req, res) => {
    const body = req.body || {};
    const reacties = service.saveReacties(body.reacties, body.vraag);
    res.json({ ok: true, reacties, naSceneVraag: service.getNaSceneVraag() });
  });

  app.post("/audience/admin/wifi-qr", (req, res) => {
    res.json({ ok: true, wifiQr: service.updateWifiQrSettings(req.body || {}) });
  });

  // Een emoji van de operator (deckknoppen 😂 en 😴): stijgt op het scherm op zoals een emoji van een
  // telefoon, maar telt niet mee bij het publiek.
  app.post("/audience/admin/stage/emoji", (req, res) => {
    const emoji = String(req.body && req.body.emoji || "").trim().slice(0, 8);
    if (!emoji) {
      res.status(400).json({ ok: false, error: "emoji_ontbreekt" });
      return;
    }
    const burst = Math.max(1, Math.min(5, Math.round(Number(req.body && req.body.burst) || 1)));
    service.emit("broadcast", { type: "stage_reaction", reaction: "emoji", emoji, burst, counts: { ...service.reactionCounts } });
    res.json({ ok: true, emoji, burst });
  });

  app.post("/audience/admin/stage/test-emoji", (_req, res) => {
    service.emit("broadcast", {
      type: "stage_reaction",
      reaction: "heart",
      emoji: service.getReacties()[0].emoji,
      burst: 2,
      counts: { ...service.reactionCounts },
    });
    res.json({ ok: true, reaction: "heart", burst: 2 });
  });

  app.post("/audience/admin/sessions/start", (req, res) => {
    const tokenTtlMinutes = req.body && req.body.tokenTtlMinutes;
    const result = service.startSession(req, {
      name: req.body && req.body.name,
      tokenTtlMinutes,
      createdBy: "admin",
    });
    res.status(201).json({ ok: true, session: result.session, join: result.join });
  });

  app.post("/audience/admin/sessions/stop", (_req, res) => {
    const session = service.stopSession();
    res.json({ ok: true, session });
  });

  app.post("/audience/admin/sessions/join-token", (req, res) => {
    const join = service.issueJoinToken(req, {
      ttlMinutes: req.body && req.body.ttlMinutes,
      createdBy: "admin",
    });
    res.status(201).json({ ok: true, join });
  });

  app.post("/audience/admin/users/:action", (req, res) => {
    const action = String(req.params.action || "");
    if (!["mute", "unmute", "block", "unblock", "kick"].includes(action)) {
      res.status(404).json({ ok: false, error: "not_found" });
      return;
    }
    const result = service.setModeration(action, {
      clientKey: req.body && req.body.clientKey,
      ip: req.body && req.body.ip,
      targetKind: req.body && req.body.targetKind,
    }, req.body || {});
    res.json(result);
  });

  app.get("/audience/admin/user-history", (req, res) => {
    const session = service.getActiveSession();
    if (!session) {
      res.status(409).json({ ok: false, error: "session_inactive" });
      return;
    }
    const clientKey = String(req.query.clientKey || "");
    const ip = String(req.query.ip || "");
    const limit = Math.max(10, Math.min(200, Number(req.query.limit || 80)));
    let messages = [];
    if (clientKey) {
      messages = service.store.recentChatMessagesByClientKey({ sessionId: session.id, clientKey, limit });
    } else if (ip) {
      messages = service.store.recentChatMessagesByIp({ sessionId: session.id, ip, limit });
    } else {
      messages = service.store.recentChatMessages({ sessionId: session.id, limit });
    }
    res.json({ ok: true, sessionId: session.id, targetIp: ip || null, targetClientKey: clientKey || null, messages });
  });

  app.post("/audience/admin/polls/start", (req, res) => {
    const poll = service.startPoll(req.body || {});
    res.status(201).json({ ok: true, poll });
  });

  // Stemmen op de startscène: opent de stemming met alle scènes die nu vrij zijn.
  // Het zaalscherm meldt dat het klaar is voor een stemming (inloop, of het rapport is voorbij).
  // In de startfase gaat de stemming dan vanzelf open: één keer per startscène. De operator kan
  // hem eerder sluiten met STEM; anders sluit de timer hem.
  let stemVanzelf = "";
  app.post("/audience/stage/stemmen-mag", asyncRoute(async (_req, res) => {
    const result = await fetchRuntimeView();
    const state = result && result.ok ? result.state : null;
    const nee = (reden) => res.json({ ok: true, geopend: false, reden });
    if (!state || !state.showRunId || state.status !== "running") return nee("geen_run");
    if (state.activeSituation) return nee("scene_loopt");
    if (!(state.playedSituations || []).length && !service.isShowGestart()) return nee("show_niet_gestart");
    if (!state.startPhase || !state.startPhase.active) return nee("geen_startfase");
    if (state.preparedNext && state.preparedNext.reason === "operator_chosen") return nee("al_gekozen");
    if (service.getActivePollSnapshot()) return nee("poll_loopt");
    // Eerst de vragen over de scène van net, dan pas de stemming op de volgende.
    if (service.beoordeling.publiek()) return nee("beoordeling_loopt");
    const sleutel = `${state.showRunId}|${(state.playedSituations || []).length}`;
    if (sleutel === stemVanzelf) return nee("al_geopend");
    stemVanzelf = sleutel;
    try {
      await service.startStartStemming({});
      return res.json({ ok: true, geopend: true });
    } catch (err) {
      return nee(err && err.message ? String(err.message) : "fout");
    }
  }));

  app.post("/audience/admin/start-stemming/start", async (req, res) => {
    try {
      const poll = await service.startStartStemming(req.body || {});
      res.status(201).json({ ok: true, poll });
    } catch (err) {
      res.status(err && err.statusCode ? err.statusCode : 500).json({ ok: false, error: err && err.message ? err.message : "fout" });
    }
  });

  app.post("/audience/admin/start-stemming/instellingen", (req, res) => {
    res.json({ ok: true, instellingen: service.setStartStemmingInstellingen(req.body || {}) });
  });

  app.post("/audience/admin/polls/close", (_req, res) => {
    const pollId = service.closePoll("admin_close");
    if (!pollId) {
      res.status(400).json({ ok: false, error: "no_active_poll" });
      return;
    }
    res.json({ ok: true, pollId });
  });

  app.post("/audience/admin/simulation/start", (req, res) => {
    service.activeSessionRequired();
    res.json({ ok: true, simulation: service.simulation.start(req.body || {}) });
  });

  app.post("/audience/admin/simulation/update", (req, res) => {
    res.json({ ok: true, simulation: service.simulation.update(req.body || {}) });
  });

  app.post("/audience/admin/simulation/defaults", (req, res) => {
    const defaults = service.simulation.saveDefaults(req.body || {});
    res.json({ ok: true, defaults, simulation: service.simulation.getState() });
  });

  app.post("/audience/admin/simulation/cue", (req, res) => {
    const accepted = service.simulation.issueCue(req.body && req.body.cue);
    if (!accepted) {
      res.status(400).json({ ok: false, error: "invalid_crowd_cue" });
      return;
    }
    res.json({ ok: true, accepted, simulation: service.simulation.getState() });
  });

  // Stream Deck: bots en personages los van elkaar aan of uit.
  app.get("/audience/stage/simulatie", (_req, res) => {
    res.json({ ok: true, ...service.simulation.stand() });
  });

  app.post("/audience/admin/simulation/schakel", (req, res) => {
    if (!service.simulation.running) service.activeSessionRequired();
    const wat = req.body && req.body.wat === "personages" ? "personages" : "bots";
    res.json({ ok: true, ...service.simulation.schakel(wat) });
  });

  // Stream Deck: bots en personages los van elkaar aan of uit.
  app.get("/audience/stage/simulatie", (_req, res) => {
    res.json({ ok: true, ...service.simulation.stand() });
  });

  app.post("/audience/admin/simulation/schakel", (req, res) => {
    if (!service.simulation.running) service.activeSessionRequired();
    const wat = req.body && req.body.wat === "personages" ? "personages" : "bots";
    res.json({ ok: true, ...service.simulation.schakel(wat) });
  });

  app.post("/audience/admin/simulation/stop", (req, res) => {
    const reason = String(req.body && req.body.reason || "admin_stop").slice(0, 120);
    res.json({ ok: true, simulation: service.simulation.stop(reason) });
  });

  app.get("/audience/algorithm-input", asyncRoute(async (req, res) => {
    res.json(await service.algorithmInput({
      showRunId: req.query.showRunId,
      situationRunId: req.query.situationRunId,
      sessionId: req.query.sessionId,
    }));
  }));

  app.post("/audience/signals", asyncRoute(async (req, res) => {
    const session = service.getActiveSession();
    const meta = {
      sessionId: session ? session.id : 0,
      sessionPublicId: session ? session.publicId : "",
      clientId: req.body && req.body.clientId || "api",
      clientTag: req.body && req.body.clientTag || "api",
      clientKey: req.body && req.body.clientKey || "api|api",
      name: req.body && req.body.name || "API",
      ip: req.socket && req.socket.remoteAddress || "api",
      isBot: !!(req.body && req.body.isBot),
      simulated: !!(req.body && req.body.simulated),
    };
    const type = String(req.body && req.body.type || "").trim().toLowerCase();
    const signalType = type === "reaction" ? String(req.body.reaction || "").trim().toLowerCase() : type;
    const signal = await service.recordSignal({
      type: signalType,
      meta,
      text: req.body && (req.body.text || req.body.message) || null,
      reaction: req.body && req.body.reaction || null,
    });
    res.status(201).json({ ok: true, signal });
  }));

  app.get("/audience/signals", (req, res) => {
    const signals = service.store.readSignals({
      showRunId: req.query.showRunId ? String(req.query.showRunId) : null,
      situationRunId: req.query.situationRunId ? String(req.query.situationRunId) : null,
      linkStatus: req.query.linkStatus ? String(req.query.linkStatus) : null,
      sessionId: req.query.sessionId ? Number(req.query.sessionId) : null,
    });
    res.json({ ok: true, count: signals.length, signals });
  });

  app.post("/v0/audience/sessions", asyncRoute(async (req, res) => {
    const now = new Date();
    const session = {
      schemaVersion: AUDIENCE_SESSION_SCHEMA_VERSION,
      sessionId: req.body && req.body.sessionId ? String(req.body.sessionId).trim() : createAudienceSessionId(now),
      createdAt: now.toISOString(),
      source: {
        type: "audience-v0-session",
        readOnly: false,
      },
    };
    await appendAudienceSession(session);
    res.status(201).json({ ok: true, session });
  }));

  app.get("/v0/audience/sessions", asyncRoute(async (_req, res) => {
    const sessions = await readAudienceSessions();
    res.json({ ok: true, sessions });
  }));

  app.post("/v0/audience/signals", asyncRoute(async (req, res) => {
    const runtimeResult = await service.clients.fetchCurrentRuntimeState();
    const signal = createAudienceSignal(req.body || {}, runtimeResult);
    await appendAudienceSignal(signal);
    res.status(201).json({ ok: true, signal });
  }));

  app.get("/v0/audience/signals", asyncRoute(async (req, res) => {
    const signals = await readAudienceSignals({
      showRunId: req.query.showRunId ? String(req.query.showRunId) : null,
      situationRunId: req.query.situationRunId ? String(req.query.situationRunId) : null,
      linkStatus: req.query.linkStatus ? String(req.query.linkStatus) : null,
    });
    res.json({ ok: true, count: signals.length, signals });
  }));

  app.get("/v0/audience/algorithm-input", asyncRoute(async (req, res) => {
    const showRunId = req.query.showRunId ? String(req.query.showRunId) : null;
    const situationRunId = req.query.situationRunId ? String(req.query.situationRunId) : null;
    if (!showRunId) throw badRequest("audience_missing_show_run_id");
    if (!situationRunId) throw badRequest("audience_missing_situation_run_id");
    const signals = await readAudienceSignals({ showRunId, situationRunId, linkStatus: "linked" });
    res.json(buildAlgorithmInput({ showRunId, situationRunId, signals }));
  }));

  app.use((req, res) => {
    res.status(404).json({ ok: false, error: "not_found", path: req.path });
  });

  app.use((err, _req, res, _next) => {
    const status = err && err.statusCode ? err.statusCode : 500;
    res.status(status).json({
      ok: false,
      error: status >= 500 ? "audience_service_error" : "audience_bad_request",
      message: err && err.message ? String(err.message) : "unknown_error",
    });
  });

  return app;
}

module.exports = {
  AUDIENCE_ALGORITHM_INPUT_SCHEMA_VERSION,
  AUDIENCE_SIGNAL_SCHEMA_VERSION,
  audienceClients,
  createAudienceApp,
};
