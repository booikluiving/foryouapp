"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const { createTelepromptStore } = require("../runtime/teleprompt-store");
const { createVertaler } = require("./vertaling");
const { isBlindRanking, plaatjeSlug } = require("../../../../../shared/blind-ranking/blind-ranking");
const { isTrendOmgeving } = require("../../../../../shared/trend/trend");
const { cameraVoor } = require("../../../../../shared/casting/camera-per-personage");

const DEFAULT_CAPTION_STYLE_PATH = path.join(__dirname, "..", "..", "..", "db", "teleprompter-caption-style.json");

const DEFAULT_AUTO_CAMERA_PATH = path.join(__dirname, "..", "..", "..", "db", "teleprompter-autocam.json");
const DEFAULT_ENGELS_PATH = path.join(__dirname, "..", "..", "..", "db", "teleprompter-engels.json");
const AUTO_CAMERA_IDS = Object.freeze({
  1: "camera:1",
  2: "camera:2",
  3: "camera:3",
});
const REACTION_SHOT_DELAY_MIN_MS = 5000;
const REACTION_SHOT_DELAY_MAX_MS = 7000;
const REACTION_SHOT_RETURN_MIN_MS = 1000;
const REACTION_SHOT_RETURN_MAX_MS = 2000;

function normalizeAutoCameraText(value) {
  return String(value || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[_-]+/g, " ")
    .replace(/[^a-z0-9]+/gi, " ")
    .trim()
    .toLowerCase();
}

function telepromptMatchesPreparedScene(teleprompt, preparedScene) {
  const sourceId = Number(teleprompt && teleprompt.source && teleprompt.source.sceneId || 0);
  const preparedId = Number(preparedScene && preparedScene.sceneId || 0);
  return !sourceId || !preparedId || sourceId === preparedId;
}

function lineForCue(teleprompt, cue) {
  const lines = teleprompt && Array.isArray(teleprompt.lines) ? teleprompt.lines : [];
  const cueIndex = Number(cue && cue.index || 0);
  const deckLength = lines.length ? lines.length + 2 : 0;
  if (!deckLength || cueIndex <= 0 || cueIndex >= deckLength - 1) return null;
  return lines[cueIndex - 1] || null;
}

function firstDialogueCue(teleprompt, baseCue = {}) {
  const lines = teleprompt && Array.isArray(teleprompt.lines) ? teleprompt.lines : [];
  const lineIndex = lines.findIndex((line) => line && line.type === "dialogue");
  if (lineIndex < 0) return null;
  return {
    ...baseCue,
    index: lineIndex + 1,
    deckLength: lines.length ? lines.length + 2 : Number(baseCue && baseCue.deckLength || 0),
  };
}

function shouldEndSceneFromCueAdvance({ cue, requestedIndex, preparedScene }) {
  const currentIndex = Number(cue && cue.index || 0);
  const deckLength = Number(cue && cue.deckLength || 0);
  // Een trendscène heeft geen kaart "Einde": de druk na de laatste emoji eindigt de scène.
  const trend = isTrendOmgeving(preparedScene && preparedScene.environment);
  const atEndCard = deckLength > 0 && currentIndex >= deckLength - (trend ? 2 : 1);
  const wantsPastEnd = Number.isFinite(requestedIndex) && requestedIndex > currentIndex;
  const preparedStatus = preparedScene ? String(preparedScene.status || "") : "";
  return atEndCard && wantsPastEnd && (!preparedStatus || preparedStatus === "playing");
}

function cueDeltaFromDirection(input) {
  const value = String(input || "next").trim().toLowerCase();
  if (["prev", "previous", "back", "left", "up", "pageup", "page_up", "arrowleft"].includes(value)) return -1;
  return 1;
}

function preparedCharacterForSpeaker(preparedScene, speakerLabel) {
  const speakerKey = normalizeAutoCameraText(speakerLabel);
  if (!speakerKey) return null;
  const characters = Array.isArray(preparedScene && preparedScene.characters) ? preparedScene.characters : [];
  const exact = characters.find((character) => normalizeAutoCameraText(character && character.name) === speakerKey);
  if (exact) return exact;
  const relaxedMatches = characters.filter((character) => {
    const characterKey = normalizeAutoCameraText(character && character.name);
    if (!characterKey) return false;
    return characterKey.startsWith(`${speakerKey} `) || speakerKey.startsWith(`${characterKey} `);
  });
  return relaxedMatches.length === 1 ? relaxedMatches[0] : null;
}

function preparedCharacterForLine(preparedScene, line) {
  const characters = Array.isArray(preparedScene && preparedScene.characters) ? preparedScene.characters : [];
  const lineSlot = Number(line && line.speakerSlot || 0);
  if (lineSlot >= 1 && lineSlot <= 3) {
    const bySlot = characters.find((character) => Number(character && character.slot || 0) === lineSlot);
    if (bySlot) return bySlot;
  }
  const lineCharacterId = Number(line && line.speakerCharacterId || 0);
  if (lineCharacterId > 0) {
    const byId = characters.find((character) => Number(character && character.id || 0) === lineCharacterId);
    if (byId) return byId;
  }
  return preparedCharacterForSpeaker(preparedScene, line && line.speakerLabel);
}

// De camera die een personage in beeld brengt. Meestal die van zijn plek; staan twee spelers samen op
// één camera (monster onder het bed, de twee zonnebloemen), dan zegt shared/casting welke.
function cameraForCharacter(scene, character) {
  const slot = Number(character && character.slot || 0);
  if (slot < 1 || slot > 3) return 0;
  const environment = scene && scene.environment;
  const camera = cameraVoor({
    omgeving: environment && typeof environment === "object" ? environment.id : environment,
    situatie: scene && (scene.sceneId || scene.id),
    personage: character && (character.characterId || character.legacyCharacterId || character.id),
    plek: slot,
  });
  return camera >= 1 && camera <= 3 ? camera : slot;
}

function mappedAutoCameraCharacters(scene) {
  const characters = Array.isArray(scene && scene.characters) ? scene.characters : [];
  const seenSlots = new Set();
  return characters
    .map((character) => ({
      ...character,
      slot: Number(character && character.slot || 0),
      camera: cameraForCharacter(scene, character),
      name: String(character && character.name || ""),
    }))
    .filter((character) => {
      if (character.slot < 1 || character.slot > 3 || !normalizeAutoCameraText(character.name)) return false;
      if (seenSlots.has(character.slot)) return false;
      seenSlots.add(character.slot);
      return true;
    })
    .sort((a, b) => a.slot - b.slot);
}

function randomBetweenMs(min, max, random = Math.random) {
  const span = Math.max(0, Number(max || 0) - Number(min || 0));
  const value = Number(typeof random === "function" ? random() : Math.random());
  const safeValue = Number.isFinite(value) ? Math.max(0, Math.min(0.999999, value)) : 0;
  return Math.round(Number(min || 0) + span * safeValue);
}

function reactionCharacterForSpeaker(cameraScene, speakerCharacter, random = Math.random) {
  const speakerCamera = cameraForCharacter(cameraScene, speakerCharacter);
  // Een reactieshot laat een andere camera zien; wie op dezelfde camera staat telt niet.
  const seenCameras = new Set();
  const candidates = mappedAutoCameraCharacters(cameraScene).filter((character) => {
    if (character.camera === speakerCamera || seenCameras.has(character.camera)) return false;
    seenCameras.add(character.camera);
    return true;
  });
  if (!candidates.length) return null;
  const value = Number(typeof random === "function" ? random() : Math.random());
  const safeValue = Number.isFinite(value) ? Math.max(0, Math.min(0.999999, value)) : 0;
  const reactionIndex = Math.max(0, Math.min(candidates.length - 1, Math.floor(safeValue * candidates.length)));
  return candidates[reactionIndex] || null;
}

function hasUsableAutoCameraCharacters(scene) {
  return mappedAutoCameraCharacters(scene).length > 0;
}

function autoCameraSceneForResolution(preparedScene, fallbackScene) {
  if (hasUsableAutoCameraCharacters(preparedScene)) return preparedScene;
  if (!hasUsableAutoCameraCharacters(fallbackScene)) return preparedScene;
  return {
    sceneId: Number(fallbackScene && (fallbackScene.sceneId || fallbackScene.id) || 0),
    title: String(fallbackScene && fallbackScene.title || ""),
    status: String(fallbackScene && fallbackScene.status || "playing") || "playing",
    environment: fallbackScene && fallbackScene.environment || null,
    characters: Array.isArray(fallbackScene && fallbackScene.characters) ? fallbackScene.characters : [],
  };
}

function readCaptionStyleFile(filePath) {
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));
    return parsed && typeof parsed === "object" ? parsed.captionStyle || parsed : null;
  } catch {
    return null;
  }
}

// Autocam aan/uit (en reactieshots) blijft bewaard: een herstart van de dienst zet hem niet meer uit.
function readAutoCameraFile(filePath) {
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));
    if (!parsed || typeof parsed !== "object") return null;
    return { enabled: parsed.enabled === true, reactionShotsEnabled: parsed.reactionShotsEnabled === true };
  } catch {
    return null;
  }
}

function writeAutoCameraFile(filePath, autoCameraSwitch) {
  const stand = autoCameraSwitch && typeof autoCameraSwitch === "object" ? autoCameraSwitch : {};
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify({
    enabled: stand.enabled === true,
    reactionShotsEnabled: stand.reactionShotsEnabled === true,
    updatedAt: new Date().toISOString(),
  }, null, 2));
}

function writeCaptionStyleFile(filePath, captionStyle) {
  const safeStyle = captionStyle && typeof captionStyle === "object" ? captionStyle : {};
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify({
    captionStyle: {
      fontSizeScale: Number(safeStyle.fontSizeScale || 1),
      verticalPosition: Number(safeStyle.verticalPosition || 66),
      widthPercent: Number(safeStyle.widthPercent || 86),
      outlineScale: Number(safeStyle.outlineScale || 1),
    },
    updatedAt: new Date().toISOString(),
  }, null, 2));
}

function buildAutoCameraReactionShotPlan({ show, teleprompt, cue, preparedScene, fallbackScene, autoCameraSwitch, random = Math.random }) {
  if (!autoCameraSwitch || !autoCameraSwitch.enabled) return { action: "skipped", reason: "disabled" };
  if (!autoCameraSwitch.reactionShotsEnabled) return { action: "skipped", reason: "reaction_disabled" };
  if (!show || show.active === false) return { action: "skipped", reason: "show_inactive" };
  const cameraScene = autoCameraSceneForResolution(preparedScene, fallbackScene);
  if (!cameraScene || String(cameraScene.status || "") !== "playing") return { action: "skipped", reason: "not_playing" };
  if (!telepromptMatchesPreparedScene(teleprompt, cameraScene)) return { action: "skipped", reason: "scene_mismatch" };

  const line = lineForCue(teleprompt, cue);
  if (!line || line.type !== "dialogue") return { action: "skipped", reason: "not_dialogue" };

  const speakerCharacter = preparedCharacterForLine(cameraScene, line);
  const speakerSlot = cameraForCharacter(cameraScene, speakerCharacter);
  if (speakerSlot < 1 || speakerSlot > 3) {
    return {
      action: "skipped",
      reason: "speaker_unmapped",
      speakerLabel: String(line.speakerLabel || ""),
    };
  }

  const reactionCharacter = reactionCharacterForSpeaker(cameraScene, speakerCharacter, random);
  const reactionSlot = Number(reactionCharacter && reactionCharacter.camera || 0);
  if (reactionSlot < 1 || reactionSlot > 3) {
    return {
      action: "skipped",
      reason: "no_reaction_candidate",
      speakerLabel: String(line.speakerLabel || ""),
      speakingSlot: speakerSlot,
    };
  }

  return {
    action: "schedule",
    reason: "reaction_timer",
    slot: reactionSlot,
    cameraId: AUTO_CAMERA_IDS[reactionSlot],
    cameraLabel: String(reactionCharacter.name || ""),
    speakerLabel: String(line.speakerLabel || ""),
    speakingSlot: speakerSlot,
    returnSlot: speakerSlot,
    returnCameraId: AUTO_CAMERA_IDS[speakerSlot],
    returnCameraLabel: String(speakerCharacter.name || line.speakerLabel || ""),
    cueIndex: Number(cue && cue.index || 0),
    cueVersion: Number(cue && cue.version || 0),
    sceneId: Number(cameraScene && (cameraScene.sceneId || cameraScene.id) || 0),
    delayMs: randomBetweenMs(REACTION_SHOT_DELAY_MIN_MS, REACTION_SHOT_DELAY_MAX_MS, random),
    returnDelayMs: randomBetweenMs(REACTION_SHOT_RETURN_MIN_MS, REACTION_SHOT_RETURN_MAX_MS, random),
  };
}

function resolveAutoCameraSwitch({ show, teleprompt, cue, preparedScene, fallbackScene, autoCameraSwitch, force = false, switchReason = "dialogue_speaker" }) {
  if (!autoCameraSwitch || !autoCameraSwitch.enabled) return { action: "skipped", reason: "disabled" };
  if (!show || show.active === false) return { action: "skipped", reason: "show_inactive" };
  const cameraScene = autoCameraSceneForResolution(preparedScene, fallbackScene);
  if (!cameraScene || String(cameraScene.status || "") !== "playing") return { action: "skipped", reason: "not_playing" };
  if (!telepromptMatchesPreparedScene(teleprompt, cameraScene)) return { action: "skipped", reason: "scene_mismatch" };

  const line = lineForCue(teleprompt, cue);
  if (!line || line.type !== "dialogue") return { action: "skipped", reason: "not_dialogue" };

  const character = preparedCharacterForLine(cameraScene, line);
  const slot = cameraForCharacter(cameraScene, character);
  if (slot < 1 || slot > 3) {
    return {
      action: "skipped",
      reason: "speaker_unmapped",
      speakerLabel: String(line.speakerLabel || ""),
    };
  }

  const cueIndex = Number(cue && cue.index || 0);
  const cueVersion = Number(cue && cue.version || 0);
  if (!force && Number(autoCameraSwitch.lastCameraSlot || 0) === slot) {
    return {
      action: "skipped",
      reason: "same_camera",
      slot,
      speakerLabel: String(line.speakerLabel || ""),
      cueIndex,
      cueVersion,
    };
  }

  return {
    action: "switch",
    reason: String(switchReason || "dialogue_speaker"),
    slot,
    cameraId: AUTO_CAMERA_IDS[slot],
    speakerLabel: String(line.speakerLabel || ""),
    cameraLabel: String(line.speakerLabel || ""),
    cueIndex,
    cueVersion,
  };
}

function mountTeleprompterParser(app, options = {}) {
  const express = options.express;
  const requireAdmin = typeof options.requireAdmin === "function" ? options.requireAdmin : (_req, _res, next) => next();
  const getShowState = typeof options.getShowState === "function"
    ? options.getShowState
    : () => ({ active: true, sessionId: 0, name: "", endedAt: null });
  const endSceneFromStage = typeof options.endSceneFromStage === "function" ? options.endSceneFromStage : null;
  const startSceneFromStage = typeof options.startSceneFromStage === "function" ? options.startSceneFromStage : null;
  const onAutoCameraSwitch = typeof options.onAutoCameraSwitch === "function" ? options.onAutoCameraSwitch : null;
  const getAutoCameraScene = typeof options.getAutoCameraScene === "function" ? options.getAutoCameraScene : null;
  const normalizePrepareInput = typeof options.normalizePrepareInput === "function" ? options.normalizePrepareInput : (input) => input;
  const captionStylePath = String(options.captionStylePath || process.env.FORYOU_TELEPROMPTER_CAPTION_STYLE_PATH || DEFAULT_CAPTION_STYLE_PATH);
  const store = createTelepromptStore({ captionStyle: readCaptionStyleFile(captionStylePath) });
  // Engels onder het Nederlands: elk binnenkomend script wordt meteen in één keer vertaald.
  const VERTAAL_LOG = path.join(os.homedir(), "Library", "Logs", "ForYou", "ondertitel-vertaling.log");
  const vertaler = options.vertaler || createVertaler({
    secretsPath: options.secretsPath || path.resolve(__dirname, "../../../db/operator-secrets.json"),
    onKlaar: () => broadcast("vertaling"),
    log: (regel) => fs.appendFile(options.vertaalLogPath || VERTAAL_LOG, `${JSON.stringify({ at: new Date().toISOString(), ...regel })}\n`, () => {}),
  });
  // Schakelaar (deckknop ENGELS): staat hij uit, dan komt er geen Engels in beeld. Vertalen gaat door,
  // zodat aanzetten midden in een scène meteen werkt. De stand blijft bewaard na een herstart.
  const engelsPath = String(options.engelsPath || DEFAULT_ENGELS_PATH);
  let engelsAan = true;
  try { engelsAan = JSON.parse(fs.readFileSync(engelsPath, "utf8")).aan !== false; } catch (_error) { engelsAan = true; }
  const autoCameraPath = String(options.autoCameraPath || process.env.FORYOU_TELEPROMPTER_AUTO_CAMERA_PATH || DEFAULT_AUTO_CAMERA_PATH);
  const bewaardeAutocam = readAutoCameraFile(autoCameraPath);
  if (bewaardeAutocam) store.setAutoCameraSwitch(bewaardeAutocam);
  // Handmatig overnemen: een druk op CAM 1/2/3 zet de autocam even op pauze (elke druk opnieuw). Daarna,
  // of als AUTOCAM tijdens de pauze wordt ingedrukt, neemt de autocam meteen weer over. Hier staat ook
  // welke camera live staat (van de autocam of van de hand), voor de knoppen op de deck.
  const AUTOCAM_PAUZE_MS = Number(options.autoCameraPauzeMs) > 0 ? Number(options.autoCameraPauzeMs) : 30000;
  let autocamPauzeTot = 0;
  let autocamPauzeTimer = null;
  let liveCamera = { camera: 0, bron: "", at: "" };
  const publicDir = path.join(__dirname, "..", "..", "public");
  const publicPrefix = String(options.publicPrefix || "/teleprompter-parser").replace(/\/+$/, "");
  const apiPrefix = String(options.apiPrefix || "/api/teleprompter-parser").replace(/\/+$/, "");
  const adminPrefix = String(options.adminPrefix || "/admin/teleprompter-parser").replace(/\/+$/, "");
  const eventClients = new Set();

  // Versie van de ondertitelpagina: de jongste wijzigingsdatum van haar drie bestanden. Staat in het adres
  // van de css en js (dus geen oude versie uit de cache) en in elke payload: ziet de pagina een andere
  // versie dan die van haarzelf, dan herlaadt ze zichzelf buiten een scène.
  const ONDERTITEL_BESTANDEN = ["live-captions.html", "live-captions-app.js", "styles.css"];
  let ondertitelVersie = "";
  let ondertitelVersieAt = 0;
  function ondertitelPaginaVersie() {
    const nu = Date.now();
    if (ondertitelVersie && nu - ondertitelVersieAt < 2000) return ondertitelVersie;
    ondertitelVersieAt = nu;
    let jongste = 0;
    ONDERTITEL_BESTANDEN.forEach((naam) => {
      try {
        jongste = Math.max(jongste, fs.statSync(path.join(publicDir, naam)).mtimeMs);
      } catch {}
    });
    ondertitelVersie = jongste ? String(Math.round(jongste)) : "0";
    return ondertitelVersie;
  }

  // Vertraging van de ondertitel: klik (klikker-sidecar) → tekstparser → in beeld op de ondertitelpagina.
  // Per cue-versie één regel in ~/Library/Logs/ForYou/ondertitel-vertraging.log (JSON per regel).
  const VERTRAGING_LOG = options.vertragingLogPath || path.join(os.homedir(), "Library", "Logs", "ForYou", "ondertitel-vertraging.log");
  const cueMetingen = new Map();
  const vertragingen = [];
  function meetCue(cue, klikAt) {
    const klik = Number(klikAt);
    cueMetingen.set(Number(cue.version), {
      index: Number(cue.index || 0),
      klikAt: Number.isFinite(klik) && klik > 0 ? klik : null,
      parserAt: Date.now(),
    });
    while (cueMetingen.size > 50) cueMetingen.delete(cueMetingen.keys().next().value);
  }
  function cueGetoond(version, getoondAt) {
    const meting = cueMetingen.get(Number(version));
    const getoond = Number(getoondAt);
    if (!meting || !Number.isFinite(getoond)) return null;
    cueMetingen.delete(Number(version));
    const regel = {
      at: new Date().toISOString(),
      cue: meting.index,
      klikNaarParserMs: meting.klikAt ? meting.parserAt - meting.klikAt : null,
      parserNaarBeeldMs: Math.round(getoond - meting.parserAt),
      totaalMs: meting.klikAt ? Math.round(getoond - meting.klikAt) : null,
    };
    vertragingen.push(regel);
    if (vertragingen.length > 200) vertragingen.shift();
    fs.mkdir(path.dirname(VERTRAGING_LOG), { recursive: true }, () => {
      fs.appendFile(VERTRAGING_LOG, `${JSON.stringify(regel)}\n`, () => {});
    });
    return regel;
  }

  function currentPayload(reason = "current") {
    const show = getShowState();
    return {
      ok: true,
      reason,
      show,
      teleprompt: store.getCurrent(),
      cue: store.getCue(),
      captionStyle: store.getCaptionStyle(),
      autoCameraSwitch: autocamStand(),
      preparedScene: store.getPreparedScene(),
      hierna: store.getHierna(),
      bord: store.getBord(),
      ondertitelVersie: ondertitelPaginaVersie(),
      engelsAan,
      engels: engelsAan ? vertaler.voor(store.getCurrent()) : {},
    };
  }

  function sendEvent(res, payload) {
    res.write(`data: ${JSON.stringify(payload)}\n\n`);
  }

  function broadcast(reason) {
    if (!eventClients.size) return;
    const payload = currentPayload(reason);
    for (const res of eventClients) {
      sendEvent(res, payload);
    }
  }

  const reactionTimers = {
    token: 0,
    reactionTimer: null,
    returnTimer: null,
  };

  function clearAutoCameraReactionTimers() {
    reactionTimers.token += 1;
    if (reactionTimers.reactionTimer) clearTimeout(reactionTimers.reactionTimer);
    if (reactionTimers.returnTimer) clearTimeout(reactionTimers.returnTimer);
    reactionTimers.reactionTimer = null;
    reactionTimers.returnTimer = null;
    return reactionTimers.token;
  }

  function unrefTimer(timer) {
    if (timer && typeof timer.unref === "function") timer.unref();
    return timer;
  }

  function autocamGepauzeerd() {
    return autocamPauzeTot > Date.now();
  }

  // De stand van de autocam zoals de pagina's en de deck hem zien, met pauze en live camera.
  function autocamStand() {
    const stand = store.getAutoCameraSwitch();
    const rest = stand.enabled && autocamGepauzeerd() ? Math.ceil((autocamPauzeTot - Date.now()) / 1000) : 0;
    return {
      ...stand,
      pauze: rest > 0,
      pauzeSeconden: rest,
      pauzeTot: rest > 0 ? new Date(autocamPauzeTot).toISOString() : null,
      liveCamera: liveCamera.camera,
      liveBron: liveCamera.bron,
    };
  }

  function autocamPauzeStart() {
    clearAutoCameraReactionTimers();
    autocamPauzeTot = Date.now() + AUTOCAM_PAUZE_MS;
    // De autocam weet niet welke camera de hand koos: na de pauze wisselt hij altijd naar wie spreekt.
    store.recordAutoCameraSwitch({ lastCameraSlot: 0, lastReason: "handmatig" });
    if (autocamPauzeTimer) clearTimeout(autocamPauzeTimer);
    autocamPauzeTimer = unrefTimer(setTimeout(() => {
      autocamPauzeTimer = null;
      autocamPauzeOpheffen(true);
      broadcast("auto_camera");
    }, AUTOCAM_PAUZE_MS + 50));
  }

  // Pauze weg. Met overnemen: de camera gaat meteen naar wie nu spreekt (als er een scène speelt).
  function autocamPauzeOpheffen(overnemen) {
    if (autocamPauzeTimer) clearTimeout(autocamPauzeTimer);
    autocamPauzeTimer = null;
    const wasPauze = autocamPauzeTot > 0;
    autocamPauzeTot = 0;
    if (!overnemen || !wasPauze || !store.getAutoCameraSwitch().enabled) return null;
    return maybeAutoCameraSwitch(getShowState(), store.getCue(), "pauze_voorbij", { force: true, switchReason: "pauze_voorbij" });
  }

  function emitAutoCameraDecision(decision, source = "cue") {
    if (autocamGepauzeerd()) return { ...decision, action: "skipped", reason: "pauze" };
    const emitResult = onAutoCameraSwitch
      ? onAutoCameraSwitch({ ...decision, source })
      : { sent: false, reason: "auto_camera_handler_missing" };
    if (!emitResult || emitResult.sent !== false) liveCamera = { camera: Number(decision.slot) || 0, bron: "autocam", at: new Date().toISOString() };
    store.recordAutoCameraSwitch({
      lastCameraSlot: decision.slot,
      lastSpeakerLabel: decision.cameraLabel || decision.speakerLabel,
      lastCueIndex: decision.cueIndex,
      lastCueVersion: decision.cueVersion,
      lastReason: emitResult && emitResult.sent === false ? String(emitResult.reason || "send_failed") : "sent",
    });
    return {
      ...decision,
      emitResult,
    };
  }

  function reactionPlanStillCurrent(plan) {
    if (!plan || plan.action !== "schedule") return false;
    const autoCameraSwitch = store.getAutoCameraSwitch();
    if (!autoCameraSwitch.enabled || !autoCameraSwitch.reactionShotsEnabled) return false;
    const show = getShowState();
    if (!show || show.active === false) return false;
    const cue = store.getCue();
    if (Number(cue.index || 0) !== Number(plan.cueIndex || 0)) return false;
    if (Number(cue.version || 0) !== Number(plan.cueVersion || 0)) return false;
    const line = lineForCue(store.getCurrent(), cue);
    if (!line || line.type !== "dialogue") return false;
    return normalizeAutoCameraText(line.speakerLabel) === normalizeAutoCameraText(plan.speakerLabel);
  }

  function scheduleAutoCameraReactionShot(show, cue, source = "cue") {
    const token = clearAutoCameraReactionTimers();
    const plan = buildAutoCameraReactionShotPlan({
      show,
      teleprompt: store.getCurrent(),
      cue,
      preparedScene: store.getPreparedScene(),
      fallbackScene: getAutoCameraScene ? getAutoCameraScene() : null,
      autoCameraSwitch: autocamStand(),
    });
    if (plan.action !== "schedule") return plan;

    reactionTimers.reactionTimer = unrefTimer(setTimeout(() => {
      reactionTimers.reactionTimer = null;
      if (token !== reactionTimers.token || !reactionPlanStillCurrent(plan)) return;
      const reactionResult = emitAutoCameraDecision({
        action: "switch",
        reason: "reaction_shot",
        slot: plan.slot,
        cameraId: plan.cameraId,
        speakerLabel: plan.speakerLabel,
        cameraLabel: plan.cameraLabel,
        speakingSlot: plan.speakingSlot,
        cueIndex: plan.cueIndex,
        cueVersion: plan.cueVersion,
        delayMs: plan.delayMs,
      }, `${source}_reaction`);
      broadcast("auto_camera_reaction");

      reactionTimers.returnTimer = unrefTimer(setTimeout(() => {
        reactionTimers.returnTimer = null;
        if (token !== reactionTimers.token || !reactionPlanStillCurrent(plan)) return;
        emitAutoCameraDecision({
          action: "switch",
          reason: "reaction_return",
          slot: plan.returnSlot,
          cameraId: plan.returnCameraId,
          speakerLabel: plan.speakerLabel,
          cameraLabel: plan.returnCameraLabel,
          reactionSlot: plan.slot,
          cueIndex: plan.cueIndex,
          cueVersion: plan.cueVersion,
          returnDelayMs: plan.returnDelayMs,
        }, `${source}_reaction_return`);
        broadcast("auto_camera_reaction_return");
      }, plan.returnDelayMs));

      return reactionResult;
    }, plan.delayMs));

    return plan;
  }

  function maybeAutoCameraSwitch(show, cue, source = "cue", options = {}) {
    const decision = resolveAutoCameraSwitch({
      show,
      teleprompt: store.getCurrent(),
      cue,
      preparedScene: store.getPreparedScene(),
      fallbackScene: getAutoCameraScene ? getAutoCameraScene() : null,
      autoCameraSwitch: autocamStand(),
      force: !!(options && options.force),
      switchReason: options && options.switchReason,
    });

    if (decision.action !== "switch") {
      if (decision.reason === "speaker_unmapped") {
        store.recordAutoCameraSwitch({
          lastReason: decision.reason,
          lastCueIndex: decision.cueIndex ?? Number(cue && cue.index || -1),
          lastCueVersion: decision.cueVersion ?? Number(cue && cue.version || 0),
        });
      }
      return decision;
    }

    return emitAutoCameraDecision(decision, source);
  }

  function preloadAutoCameraForFirstDialogue(show, baseCue, source = "reveal_first_dialogue") {
    const cue = firstDialogueCue(store.getCurrent(), baseCue);
    if (!cue) return { action: "skipped", reason: "no_dialogue" };
    return maybeAutoCameraSwitch(show, cue, source, {
      force: true,
      switchReason: "first_dialogue_preload",
    });
  }

  app.get(publicPrefix, requireAdmin, (_req, res) => {
    res.sendFile(path.join(publicDir, "parser.html"));
  });

  app.get(`${publicPrefix}/stage`, (_req, res) => {
    res.sendFile(path.join(publicDir, "stage.html"));
  });

  app.get(`${publicPrefix}/stage/:slotIndex`, (req, res, next) => {
    if (!["1", "2", "3"].includes(String(req.params.slotIndex || ""))) {
      next();
      return;
    }
    res.sendFile(path.join(publicDir, "stage.html"));
  });

  app.get(`${publicPrefix}/live-captions`, (_req, res) => {
    const versie = ondertitelPaginaVersie();
    fs.readFile(path.join(publicDir, "live-captions.html"), "utf8", (err, html) => {
      if (err) {
        res.status(500).send("live-captions.html ontbreekt");
        return;
      }
      res.set("Cache-Control", "no-cache");
      res.type("html").send(html.replace(/(styles\.css|live-captions-app\.js)\?v=[^"]*/g, `$1?v=${versie}`));
    });
  });

  app.post(`${apiPrefix}/ondertitel-getoond`, (req, res) => {
    const body = req.body && typeof req.body === "object" ? req.body : {};
    res.json({ ok: true, meting: cueGetoond(body.version, body.getoondAt) });
  });

  app.get(`${apiPrefix}/ondertitel-vertraging`, (_req, res) => {
    res.json({ ok: true, log: VERTRAGING_LOG, metingen: vertragingen.slice(-50) });
  });

  // Plaatjes voor het bord (blind ranking). Een plaatje is een PNG-laag die in de beeldcatalogus bij een
  // omgeving is geüpload, met als bestandsnaam de naam van het plaatje in kleine letters (eva-braun.jpg).
  // Daarnaast kan het los in ~/ForYou/bord-plaatjes staan. Zonder bestand toont het bord alleen de naam.
  // Eerst: het plaatje dat in de situatie (schakelaar Blind ranking, vijf plaatjes) bij deze naam is
  // geüpload; de situatie die nu klaarstaat of speelt gaat voor.
  function situatiePlaatje(naam, mediaRoot) {
    let db = null;
    try {
      const { DatabaseSync } = require("node:sqlite");
      const dbPath = String(process.env.CATALOG_DB_PATH || path.join(mediaRoot, "..", "db", "catalog.sqlite"));
      if (!fs.existsSync(dbPath)) return null;
      db = new DatabaseSync(dbPath, { readOnly: true });
      const prepared = store.getPreparedScene ? store.getPreparedScene() : null;
      const huidige = prepared && prepared.sceneId ? Number(prepared.sceneId) : 0;
      const kandidaten = [];
      for (const row of db.prepare("SELECT record_json FROM situations").all()) {
        let situatie = null;
        try { situatie = JSON.parse(row.record_json); } catch (_err) { continue; }
        if (!isBlindRanking(situatie)) continue;
        const plaatje = (situatie.blindRanking.plaatjes || []).find((item) => item && item.assetId && plaatjeSlug(item.naam) === naam);
        if (!plaatje) continue;
        const nummer = Number(situatie.legacyId || String(situatie.id || "").split(":").pop());
        kandidaten.push({ assetId: plaatje.assetId, voorrang: nummer === huidige ? 0 : 1, tijd: String(situatie.updatedAt || "") });
      }
      kandidaten.sort((a, b) => a.voorrang - b.voorrang || b.tijd.localeCompare(a.tijd));
      for (const kandidaat of kandidaten) {
        const asset = db.prepare("SELECT record_json FROM media_assets WHERE id = ? LIMIT 1").get(kandidaat.assetId);
        const record = asset ? JSON.parse(asset.record_json) : null;
        const pad = record && record.relativePath ? path.join(mediaRoot, record.relativePath) : "";
        if (pad && fs.existsSync(pad)) return pad;
      }
    } catch (_err) {
      return null;
    } finally {
      if (db) {
        try { db.close(); } catch (_err) {}
      }
    }
    return null;
  }

  function bordPlaatje(naam) {
    const extensies = [".jpg", ".jpeg", ".png", ".webp"];
    const mediaRoot = String(process.env.CATALOG_MEDIA_ROOT || path.join(__dirname, "..", "..", "..", "..", "catalog", "media"));
    const uitSituatie = situatiePlaatje(naam, mediaRoot);
    if (uitSituatie) return uitSituatie;
    const omgevingen = path.join(mediaRoot, "environments");
    const patroon = new RegExp(`^${naam}-[0-9a-f]{8,}\\.(jpe?g|png|webp)$`);
    let beste = null;
    try {
      for (const omgeving of fs.readdirSync(omgevingen)) {
        const map = path.join(omgevingen, omgeving, "fx");
        if (!fs.existsSync(map)) continue;
        for (const bestand of fs.readdirSync(map)) {
          if (!patroon.test(bestand)) continue;
          const pad = path.join(map, bestand);
          const tijd = fs.statSync(pad).mtimeMs;
          if (!beste || tijd > beste.tijd) beste = { pad, tijd };
        }
      }
    } catch (_err) {}
    if (beste) return beste.pad;
    const losseMap = String(process.env.FORYOU_BORD_PLAATJES_DIR || path.join(os.homedir(), "ForYou", "bord-plaatjes"));
    return extensies.map((ext) => path.join(losseMap, `${naam}${ext}`)).find((kandidaat) => fs.existsSync(kandidaat)) || null;
  }

  app.get(`${publicPrefix}/bord-plaatje/:naam`, (req, res) => {
    const naam = String(req.params.naam || "").toLowerCase().replace(/[^a-z0-9-]/g, "");
    const bestand = naam ? bordPlaatje(naam) : null;
    if (!bestand) {
      res.status(404).end();
      return;
    }
    res.setHeader("Cache-Control", "no-store");
    res.sendFile(bestand);
  });

  app.use(publicPrefix, express.static(publicDir));

  app.get(`${apiPrefix}/health`, (_req, res) => {
    res.json({
      ok: true,
      currentVersion: store.getCurrent() ? store.getCurrent().version : 0,
      show: getShowState(),
      cue: store.getCue(),
      captionStyle: store.getCaptionStyle(),
      autoCameraSwitch: autocamStand(),
      preparedScene: store.getPreparedScene(),
    });
  });

  app.get(`${apiPrefix}/current`, (_req, res) => {
    res.json(currentPayload());
  });

  app.get(`${apiPrefix}/events`, (req, res) => {
    res.status(200);
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");
    res.setHeader("Connection", "keep-alive");
    res.flushHeaders && res.flushHeaders();
    eventClients.add(res);
    sendEvent(res, currentPayload("hello"));
    req.on("close", () => {
      eventClients.delete(res);
    });
  });

  app.post(`${apiPrefix}/cue/advance`, async (req, res) => {
    const show = getShowState();
    if (show && show.active === false) {
      clearAutoCameraReactionTimers();
      res.json({
        ...currentPayload("cue_locked"),
        cueLocked: true,
        cueAction: { action: "locked", reason: "show_inactive" },
      });
      return;
    }

    const body = req.body && typeof req.body === "object" ? req.body : {};
    const delta = cueDeltaFromDirection(body.direction || body.key || body.code || body.button);
    const cue = store.getCue();
    const preparedScene = store.getPreparedScene();
    const preparedStatus = preparedScene ? String(preparedScene.status || "") : "";

    if (preparedStatus === "prepared") {
      const canStartPrepared = delta > 0
        && preparedScene.ready
        && startSceneFromStage
        && show
        && show.active !== false
        && !show.activeSituationId;
      if (!canStartPrepared) {
        clearAutoCameraReactionTimers();
        // Tussen de scènes is de klikker de READY-knop van de speler die hem heeft (terug = toch niet).
        if (delta !== 0 && body.source !== "spelers_ready" && show && show.active !== false && !show.activeSituationId) {
          const publiek = String(process.env.SCRIPT_AGENT_AUDIENCE_URL || "http://127.0.0.1:3026").replace(/\/+$/, "");
          fetch(`${publiek}/audience/ready/klikker`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ready: delta > 0 }), signal: AbortSignal.timeout(3000) }).catch(() => {});
        }
        res.json({
          ...currentPayload("cue_locked"),
          cueLocked: true,
          cueAction: {
            action: "locked",
            reason: preparedScene && preparedScene.ready ? "prepared_ready_waiting_for_start" : "prepared_not_ready",
            direction: delta > 0 ? "next" : "prev",
          },
        });
        return;
      }

      try {
        const startScene = await Promise.resolve(startSceneFromStage({
          reason: "teleprompter_cue_ready_start",
          source: body.source || "teleprompter_cue_advance",
        }));
        res.json({
          ...currentPayload("start_scene"),
          startScene,
          cueAction: { action: "start_scene", direction: "next" },
        });
      } catch (err) {
        res.status(409).json({
          ok: false,
          error: err && err.message ? String(err.message) : "start_scene_failed",
          show: getShowState(),
          cue: store.getCue(),
          preparedScene: store.getPreparedScene(),
        });
      }
      return;
    }

    const requestedIndex = Number(cue && cue.index || 0) + delta;
    if (endSceneFromStage && shouldEndSceneFromCueAdvance({ cue, requestedIndex, preparedScene })) {
      clearAutoCameraReactionTimers();
      try {
        const endScene = await Promise.resolve(endSceneFromStage({ reason: "teleprompter_cue_end_card" }));
        res.json({
          ...currentPayload("end_scene"),
          cueLocked: true,
          endScene,
          cueAction: { action: "end_scene", direction: "next" },
        });
      } catch (err) {
        res.status(409).json({
          ok: false,
          error: err && err.message ? String(err.message) : "end_scene_failed",
          show: getShowState(),
          cue: store.getCue(),
          preparedScene: store.getPreparedScene(),
        });
      }
      return;
    }

    const result = store.setCueIndex(requestedIndex);
    if (result.changed) meetCue(result.cue, body.klikAt);
    const autoCameraSwitchResult = result.changed ? maybeAutoCameraSwitch(show, result.cue, "cue") : null;
    const autoCameraReactionPlan = result.changed ? scheduleAutoCameraReactionShot(show, result.cue, "cue") : null;
    if (result.changed) broadcast("cue");
    res.json({
      ok: true,
      cue: result.cue,
      cueLocked: !!result.locked,
      cueAction: {
        action: "cue",
        direction: delta > 0 ? "next" : "prev",
        requestedIndex,
      },
      autoCameraSwitchResult,
      autoCameraReactionPlan,
      show,
      teleprompt: store.getCurrent(),
      captionStyle: store.getCaptionStyle(),
      autoCameraSwitch: autocamStand(),
      preparedScene: store.getPreparedScene(),
    });
  });

  app.post(`${apiPrefix}/cue`, async (req, res) => {
    const show = getShowState();
    if (show && show.active === false) {
      clearAutoCameraReactionTimers();
      res.json({
        ok: true,
        cue: store.getCue(),
        cueLocked: true,
        show,
        teleprompt: store.getCurrent(),
        captionStyle: store.getCaptionStyle(),
        autoCameraSwitch: autocamStand(),
        preparedScene: store.getPreparedScene(),
      });
      return;
    }
    const body = req.body && typeof req.body === "object" ? req.body : {};
    const cue = store.getCue();
    const preparedScene = store.getPreparedScene();
    const requestedIndex = Number.parseInt(String(body.index), 10);
    if (endSceneFromStage && shouldEndSceneFromCueAdvance({ cue, requestedIndex, preparedScene })) {
      clearAutoCameraReactionTimers();
      try {
        const endScene = await Promise.resolve(endSceneFromStage({ reason: "teleprompter_cue_end_card" }));
        res.json({
          ...currentPayload("end_scene"),
          cueLocked: true,
          endScene,
        });
      } catch (err) {
        res.status(409).json({
          ok: false,
          error: err && err.message ? String(err.message) : "end_scene_failed",
          show: getShowState(),
          cue: store.getCue(),
          preparedScene: store.getPreparedScene(),
        });
      }
      return;
    }
    const result = store.setCueIndex(body.index);
    const autoCameraSwitchResult = result.changed ? maybeAutoCameraSwitch(show, result.cue, "cue") : null;
    const autoCameraReactionPlan = result.changed ? scheduleAutoCameraReactionShot(show, result.cue, "cue") : null;
    if (result.changed) broadcast("cue");
    res.json({
      ok: true,
      cue: result.cue,
      cueLocked: !!result.locked,
      autoCameraSwitchResult,
      autoCameraReactionPlan,
      show,
      teleprompt: store.getCurrent(),
      captionStyle: store.getCaptionStyle(),
      autoCameraSwitch: autocamStand(),
      preparedScene: store.getPreparedScene(),
    });
  });

  app.post(`${apiPrefix}/end-scene`, async (_req, res) => {
    clearAutoCameraReactionTimers();
    if (!endSceneFromStage) {
      res.status(501).json({ ok: false, error: "end_scene_unavailable" });
      return;
    }
    const show = getShowState();
    if (show && show.active === false) {
      res.status(409).json({ ok: false, error: "show_inactive", show });
      return;
    }
    try {
      const endScene = await Promise.resolve(endSceneFromStage({ reason: "teleprompter_end_card" }));
      res.json({
        ...currentPayload("end_scene"),
        endScene,
      });
    } catch (err) {
      res.status(409).json({
        ok: false,
        error: err && err.message ? String(err.message) : "end_scene_failed",
        show: getShowState(),
        cue: store.getCue(),
        preparedScene: store.getPreparedScene(),
      });
    }
  });

  app.post(`${adminPrefix}/caption-style`, requireAdmin, (req, res) => {
    const body = req.body && typeof req.body === "object" ? req.body : {};
    const styleInput = body.captionStyle && typeof body.captionStyle === "object" ? body.captionStyle : body;
    const result = store.setCaptionStyle(styleInput);
    try {
      writeCaptionStyleFile(captionStylePath, result.captionStyle);
    } catch (err) {
      res.status(500).json({
        ok: false,
        error: "caption_style_persist_failed",
        message: err && err.message ? String(err.message) : "unknown",
        captionStyle: result.captionStyle,
      });
      return;
    }
    if (result.changed) broadcast("caption_style");
    res.json({
      ok: true,
      captionStyle: result.captionStyle,
      captionStylePersisted: true,
      autoCameraSwitch: autocamStand(),
      cue: store.getCue(),
      teleprompt: store.getCurrent(),
      preparedScene: store.getPreparedScene(),
    });
  });

  app.post(`${adminPrefix}/engels`, requireAdmin, (req, res) => {
    const body = req.body && typeof req.body === "object" ? req.body : {};
    const aan = body.aan === undefined ? !engelsAan : body.aan === true;
    if (aan !== engelsAan) {
      engelsAan = aan;
      try {
        fs.mkdirSync(path.dirname(engelsPath), { recursive: true });
        fs.writeFileSync(engelsPath, JSON.stringify({ aan, updatedAt: new Date().toISOString() }, null, 2));
      } catch (err) {
        console.warn(`Engels: stand niet bewaard: ${err && err.message ? err.message : err}`);
      }
      broadcast("engels");
    }
    res.json({ ok: true, engelsAan });
  });

  app.post(`${adminPrefix}/auto-camera`, requireAdmin, (req, res) => {
    const body = req.body && typeof req.body === "object" ? req.body : {};
    const switchInput = body.autoCameraSwitch && typeof body.autoCameraSwitch === "object" ? body.autoCameraSwitch : body;
    const result = store.setAutoCameraSwitch({
      enabled: Object.prototype.hasOwnProperty.call(switchInput, "enabled") ? switchInput.enabled : switchInput,
      reactionShotsEnabled: Object.prototype.hasOwnProperty.call(switchInput, "reactionShotsEnabled")
        ? switchInput.reactionShotsEnabled
        : Object.prototype.hasOwnProperty.call(switchInput, "reactionEnabled")
          ? switchInput.reactionEnabled
          : store.getAutoCameraSwitch().reactionShotsEnabled,
    });
    if (result.changed) {
      try {
        writeAutoCameraFile(autoCameraPath, result.autoCameraSwitch);
      } catch (err) {
        console.warn(`Autocam: stand niet bewaard: ${err && err.message ? err.message : err}`);
      }
    }
    if (!result.autoCameraSwitch.enabled) autocamPauzeOpheffen(false);
    let autoCameraReactionPlan = null;
    if (!result.autoCameraSwitch.enabled || !result.autoCameraSwitch.reactionShotsEnabled) {
      clearAutoCameraReactionTimers();
    } else {
      autoCameraReactionPlan = scheduleAutoCameraReactionShot(getShowState(), store.getCue(), "auto_camera_toggle");
    }
    if (result.changed) broadcast("auto_camera");
    res.json({
      ok: true,
      autoCameraSwitch: autocamStand(),
      autoCameraReactionPlan,
      cue: store.getCue(),
      teleprompt: store.getCurrent(),
      captionStyle: store.getCaptionStyle(),
      preparedScene: store.getPreparedScene(),
    });
  });

  // Een druk op CAM 1/2/3: deze camera staat nu live. Staat de autocam aan, dan pauzeert hij.
  app.post(`${adminPrefix}/auto-camera/handmatig`, requireAdmin, (req, res) => {
    const camera = Number.parseInt(String(req.body && req.body.camera), 10);
    if (!(camera >= 1 && camera <= 3)) {
      res.status(400).json({ ok: false, error: "camera_1_2_3" });
      return;
    }
    liveCamera = { camera, bron: "handmatig", at: new Date().toISOString() };
    if (store.getAutoCameraSwitch().enabled) autocamPauzeStart();
    broadcast("auto_camera");
    res.json({ ok: true, autoCameraSwitch: autocamStand() });
  });

  // AUTOCAM tijdens de pauze: de autocam neemt meteen weer over.
  app.post(`${adminPrefix}/auto-camera/pauze-weg`, requireAdmin, (_req, res) => {
    const overgenomen = autocamPauzeOpheffen(true);
    broadcast("auto_camera");
    res.json({ ok: true, overgenomen, autoCameraSwitch: autocamStand() });
  });

  app.post(`${adminPrefix}/parse`, requireAdmin, (req, res) => {
    clearAutoCameraReactionTimers();
    const body = req.body && typeof req.body === "object" ? req.body : {};
    const rawText = String(body.rawText || body.text || "");
    if (!rawText.trim()) {
      res.status(400).json({ ok: false, error: "raw_text_required" });
      return;
    }
    const teleprompt = store.ingest({
      title: body.title || "",
      rawText,
      source: body.source || "manual",
      sceneId: body.sceneId || body.scene_id || 0,
    });
    broadcast("parse");
    vertaler.vertaal(teleprompt);
    res.json({
      ok: true,
      teleprompt,
      cue: store.getCue(),
      autoCameraSwitch: autocamStand(),
      preparedScene: store.getPreparedScene(),
    });
  });

  app.post(`${adminPrefix}/prepare`, requireAdmin, (req, res) => {
    clearAutoCameraReactionTimers();
    const body = req.body && typeof req.body === "object" ? req.body : {};
    const result = store.prepareScene(normalizePrepareInput(body));
    broadcast("prepare");
    res.json({
      ok: true,
      preparedScene: result.preparedScene,
      teleprompt: store.getCurrent(),
      cue: store.getCue(),
      captionStyle: store.getCaptionStyle(),
      autoCameraSwitch: autocamStand(),
    });
  });

  app.post(`${adminPrefix}/ready`, requireAdmin, (req, res) => {
    clearAutoCameraReactionTimers();
    const body = req.body && typeof req.body === "object" ? req.body : {};
    const result = store.setPreparedReady(Object.prototype.hasOwnProperty.call(body, "ready") ? body.ready : true);
    broadcast("ready");
    res.json({
      ok: true,
      preparedScene: result.preparedScene,
      teleprompt: store.getCurrent(),
      cue: store.getCue(),
      captionStyle: store.getCaptionStyle(),
      autoCameraSwitch: autocamStand(),
    });
  });

  // De scène hierna (gekozen bij de start van de huidige). Zonder scène ({}) of null: niets hierna.
  app.post(`${adminPrefix}/hierna`, requireAdmin, (req, res) => {
    const body = req.body && typeof req.body === "object" ? req.body : {};
    const leeg = body.leeg === true || !(body.situation || body.performerSlots || body.characterSlots || body.characters || body.sceneId);
    const result = store.setHierna(leeg ? null : normalizePrepareInput(body));
    broadcast("hierna");
    res.json({ ok: true, hierna: result.hierna });
  });

  // Het universum op het zaalscherm heeft de volgende scène gekozen ({ wacht: false }): de teleprompter
  // toont hem nu. { wacht: true } zet het wachten met de hand aan.
  app.post(`${adminPrefix}/keuze`, requireAdmin, (req, res) => {
    const body = req.body && typeof req.body === "object" ? req.body : {};
    const result = store.setKeuzeWacht(body.wacht === true);
    broadcast("keuze");
    res.json({ ok: true, preparedScene: result.preparedScene });
  });

  // Bord (blind ranking): de knop van de operator. { actie: "aan" } zet het bord in beeld (daarna
  // volgt het vanzelf het script), { actie: "begin" } haalt het weer weg.
  app.post(`${adminPrefix}/bord`, requireAdmin, (req, res) => {
    const body = req.body && typeof req.body === "object" ? req.body : {};
    const result = store.setBord(String(body.actie || "aan") === "begin" ? "begin" : "aan");
    if (result.changed) broadcast("bord");
    res.json({ ok: true, bord: result.bord, changed: result.changed });
  });

  app.post(`${adminPrefix}/reveal`, requireAdmin, (_req, res) => {
    clearAutoCameraReactionTimers();
    const result = store.revealPreparedScene();
    const show = getShowState();
    const autoCameraSwitchResult = preloadAutoCameraForFirstDialogue(show, result.cue);
    broadcast("reveal");
    res.json({
      ok: true,
      preparedScene: result.preparedScene,
      cue: result.cue,
      autoCameraSwitchResult,
      teleprompt: store.getCurrent(),
      captionStyle: store.getCaptionStyle(),
      autoCameraSwitch: autocamStand(),
    });
  });

  function ingest(input = {}) {
    clearAutoCameraReactionTimers();
    const teleprompt = store.ingest(input);
    broadcast("ingest");
    vertaler.vertaal(teleprompt);
    return teleprompt;
  }

  function prepare(input = {}) {
    clearAutoCameraReactionTimers();
    const result = store.prepareScene(normalizePrepareInput(input));
    broadcast("prepare");
    return result.preparedScene;
  }

  function ready(value = true) {
    clearAutoCameraReactionTimers();
    const result = store.setPreparedReady(value);
    broadcast("ready");
    return result.preparedScene;
  }

  function reveal() {
    clearAutoCameraReactionTimers();
    const result = store.revealPreparedScene();
    const show = getShowState();
    const autoCameraSwitchResult = preloadAutoCameraForFirstDialogue(show, result.cue);
    broadcast("reveal");
    return {
      ...result,
      autoCameraSwitchResult,
    };
  }

  function refresh(reason = "refresh") {
    broadcast(reason);
    return currentPayload(reason);
  }

  function getCurrent() {
    return store.getCurrent();
  }

  return {
    ingest,
    prepare,
    ready,
    reveal,
    refresh,
    getCurrent,
    getCue: () => store.getCue(),
    getCaptionStyle: () => store.getCaptionStyle(),
    getAutoCameraSwitch: () => store.getAutoCameraSwitch(),
    getPreparedScene: () => store.getPreparedScene(),
  };
}

module.exports = {
  mountTeleprompterParser,
  resolveAutoCameraSwitch,
  buildAutoCameraReactionShotPlan,
  firstDialogueCue,
  shouldEndSceneFromCueAdvance,
};
