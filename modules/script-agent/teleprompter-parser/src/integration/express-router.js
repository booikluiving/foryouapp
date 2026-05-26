"use strict";

const fs = require("fs");
const path = require("path");
const { createTelepromptStore } = require("../runtime/teleprompt-store");

const DEFAULT_CAPTION_STYLE_PATH = path.join(__dirname, "..", "..", "..", "db", "teleprompter-caption-style.json");

const AUTO_CAMERA_ADDRESSES = Object.freeze({
  1: "/osc/osc25",
  2: "/osc/osc26",
  3: "/osc/osc27",
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
  const atEndCard = deckLength > 0 && currentIndex >= deckLength - 1;
  const wantsPastEnd = Number.isFinite(requestedIndex) && requestedIndex > currentIndex;
  const preparedStatus = preparedScene ? String(preparedScene.status || "") : "";
  return atEndCard && wantsPastEnd && (!preparedStatus || preparedStatus === "playing");
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

function mappedAutoCameraCharacters(scene) {
  const characters = Array.isArray(scene && scene.characters) ? scene.characters : [];
  const seenSlots = new Set();
  return characters
    .map((character) => ({
      ...character,
      slot: Number(character && character.slot || 0),
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
  const speakerSlot = Number(speakerCharacter && speakerCharacter.slot || 0);
  const candidates = mappedAutoCameraCharacters(cameraScene).filter((character) => character.slot !== speakerSlot);
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
  const speakerSlot = Number(speakerCharacter && speakerCharacter.slot || 0);
  if (speakerSlot < 1 || speakerSlot > 3) {
    return {
      action: "skipped",
      reason: "speaker_unmapped",
      speakerLabel: String(line.speakerLabel || ""),
    };
  }

  const reactionCharacter = reactionCharacterForSpeaker(cameraScene, speakerCharacter, random);
  const reactionSlot = Number(reactionCharacter && reactionCharacter.slot || 0);
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
    address: AUTO_CAMERA_ADDRESSES[reactionSlot],
    cameraLabel: String(reactionCharacter.name || ""),
    speakerLabel: String(line.speakerLabel || ""),
    speakingSlot: speakerSlot,
    returnSlot: speakerSlot,
    returnAddress: AUTO_CAMERA_ADDRESSES[speakerSlot],
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
  const slot = Number(character && character.slot || 0);
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
    address: AUTO_CAMERA_ADDRESSES[slot],
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
  const onAutoCameraSwitch = typeof options.onAutoCameraSwitch === "function" ? options.onAutoCameraSwitch : null;
  const getAutoCameraScene = typeof options.getAutoCameraScene === "function" ? options.getAutoCameraScene : null;
  const normalizePrepareInput = typeof options.normalizePrepareInput === "function" ? options.normalizePrepareInput : (input) => input;
  const captionStylePath = String(options.captionStylePath || process.env.FORYOU_TELEPROMPTER_CAPTION_STYLE_PATH || DEFAULT_CAPTION_STYLE_PATH);
  const store = createTelepromptStore({ captionStyle: readCaptionStyleFile(captionStylePath) });
  const publicDir = path.join(__dirname, "..", "..", "public");
  const publicPrefix = String(options.publicPrefix || "/teleprompter-parser").replace(/\/+$/, "");
  const apiPrefix = String(options.apiPrefix || "/api/teleprompter-parser").replace(/\/+$/, "");
  const adminPrefix = String(options.adminPrefix || "/admin/teleprompter-parser").replace(/\/+$/, "");
  const eventClients = new Set();

  function currentPayload(reason = "current") {
    const show = getShowState();
    return {
      ok: true,
      reason,
      show,
      teleprompt: store.getCurrent(),
      cue: store.getCue(),
      captionStyle: store.getCaptionStyle(),
      autoCameraSwitch: store.getAutoCameraSwitch(),
      preparedScene: store.getPreparedScene(),
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

  function emitAutoCameraDecision(decision, source = "cue") {
    const emitResult = onAutoCameraSwitch
      ? onAutoCameraSwitch({ ...decision, source })
      : { sent: false, reason: "auto_camera_handler_missing" };
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
      autoCameraSwitch: store.getAutoCameraSwitch(),
    });
    if (plan.action !== "schedule") return plan;

    reactionTimers.reactionTimer = unrefTimer(setTimeout(() => {
      reactionTimers.reactionTimer = null;
      if (token !== reactionTimers.token || !reactionPlanStillCurrent(plan)) return;
      const reactionResult = emitAutoCameraDecision({
        action: "switch",
        reason: "reaction_shot",
        slot: plan.slot,
        address: plan.address,
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
          address: plan.returnAddress,
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
      autoCameraSwitch: store.getAutoCameraSwitch(),
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

  app.get(`${publicPrefix}/live-captions`, (_req, res) => {
    res.sendFile(path.join(publicDir, "live-captions.html"));
  });

  app.use(publicPrefix, express.static(publicDir));

  app.get(`${apiPrefix}/health`, (_req, res) => {
    res.json({
      ok: true,
      currentVersion: store.getCurrent() ? store.getCurrent().version : 0,
      show: getShowState(),
      cue: store.getCue(),
      captionStyle: store.getCaptionStyle(),
      autoCameraSwitch: store.getAutoCameraSwitch(),
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
        autoCameraSwitch: store.getAutoCameraSwitch(),
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
      autoCameraSwitch: store.getAutoCameraSwitch(),
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
      autoCameraSwitch: store.getAutoCameraSwitch(),
      cue: store.getCue(),
      teleprompt: store.getCurrent(),
      preparedScene: store.getPreparedScene(),
    });
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
    let autoCameraReactionPlan = null;
    if (!result.autoCameraSwitch.enabled || !result.autoCameraSwitch.reactionShotsEnabled) {
      clearAutoCameraReactionTimers();
    } else {
      autoCameraReactionPlan = scheduleAutoCameraReactionShot(getShowState(), store.getCue(), "auto_camera_toggle");
    }
    if (result.changed) broadcast("auto_camera");
    res.json({
      ok: true,
      autoCameraSwitch: result.autoCameraSwitch,
      autoCameraReactionPlan,
      cue: store.getCue(),
      teleprompt: store.getCurrent(),
      captionStyle: store.getCaptionStyle(),
      preparedScene: store.getPreparedScene(),
    });
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
    res.json({
      ok: true,
      teleprompt,
      cue: store.getCue(),
      autoCameraSwitch: store.getAutoCameraSwitch(),
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
      autoCameraSwitch: store.getAutoCameraSwitch(),
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
      autoCameraSwitch: store.getAutoCameraSwitch(),
    });
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
      autoCameraSwitch: store.getAutoCameraSwitch(),
    });
  });

  function ingest(input = {}) {
    clearAutoCameraReactionTimers();
    const teleprompt = store.ingest(input);
    broadcast("ingest");
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
