"use strict";

const { parseTeleprompt } = require("../domain/parse-teleprompt");

const DEFAULT_CAPTION_STYLE = Object.freeze({
  fontSizeScale: 1,
  verticalPosition: 66,
  widthPercent: 86,
  outlineScale: 1,
});

const DEFAULT_AUTO_CAMERA_SWITCH = Object.freeze({
  enabled: false,
  reactionShotsEnabled: false,
  lastCameraSlot: 0,
  lastSpeakerLabel: "",
  lastCueIndex: -1,
  lastCueVersion: 0,
  lastReason: "",
});

function clampNumber(value, min, max, fallback) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.max(min, Math.min(max, numeric));
}

function sanitizeCaptionStyle(input = {}, base = DEFAULT_CAPTION_STYLE) {
  const source = input && typeof input === "object" && !Array.isArray(input) ? input : {};
  return {
    fontSizeScale: clampNumber(source.fontSizeScale, 0.45, 1.25, base.fontSizeScale),
    verticalPosition: clampNumber(source.verticalPosition, 50, 84, base.verticalPosition),
    widthPercent: clampNumber(source.widthPercent, 56, 96, base.widthPercent),
    outlineScale: clampNumber(source.outlineScale, 0.45, 1.25, base.outlineScale),
  };
}

function cleanPreparedText(value, maxLength = 160) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength);
}

function normalizeSpeakerText(value) {
  return String(value || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[_-]+/g, " ")
    .replace(/[^a-z0-9]+/gi, " ")
    .trim()
    .toLowerCase();
}

function preparedCharacterName(item) {
  if (!item || typeof item !== "object") return "";
  return cleanPreparedText(item.name || item.label || item.title || item.naam || "", 80);
}

function sanitizePreparedCharacterSlot(item, fallbackSlot) {
  const numeric = Number.parseInt(String(item && item.slot || fallbackSlot || 0), 10);
  if (!Number.isFinite(numeric)) return 0;
  return Math.max(0, Math.min(3, numeric));
}

function sanitizePreparedEnvironment(input = {}, base = null) {
  const source = input && typeof input === "object" && !Array.isArray(input) ? input : {};
  const fallback = base && typeof base === "object" ? base : {};
  const name = cleanPreparedText(source.name || source.title || fallback.name || "", 100);
  const description = cleanPreparedText(source.description || fallback.description || "", 220);
  const imageUrl = cleanPreparedText(source.imageUrl || source.image || fallback.imageUrl || "", 500);
  const id = Math.max(0, Number.parseInt(String(source.id || fallback.id || 0), 10) || 0);
  if (!name && !description && !imageUrl && !id) return null;
  return { id, name, description, imageUrl };
}

function sanitizePreparedScene(input = {}, base = null) {
  const source = input && typeof input === "object" && !Array.isArray(input) ? input : {};
  const selectedSlots = Array.isArray(source.characterSlots)
    ? source.characterSlots.filter((slot) => String(slot && slot.mode || "") === "selected" && Number(slot && slot.id || 0) > 0)
    : [];
  const sourceCharacters = selectedSlots.length ? selectedSlots : Array.isArray(source.characters) ? source.characters : [];
  const seen = new Set();
  const characters = [];
  for (const item of sourceCharacters) {
    const name = preparedCharacterName(item);
    if (!name) continue;
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    characters.push({
      id: Number(item && item.id || 0),
      name,
      slot: sanitizePreparedCharacterSlot(item, characters.length + 1),
    });
    if (characters.length >= 3) break;
  }

  const sceneId = Math.max(0, Number.parseInt(String(source.sceneId || source.id || (source.scene && source.scene.id) || 0), 10) || 0);
  const title = cleanPreparedText(source.title || (source.scene && source.scene.title) || (base && base.title) || "Volgende scene", 180);
  const status = String(source.status || (base && base.status) || "prepared") === "playing" ? "playing" : "prepared";
  const ready = status === "playing" ? !!(source.ready || (base && base.ready)) : !!source.ready;
  const environment = sanitizePreparedEnvironment(source.environment || source.omgeving || {}, base && base.environment);

  return {
    sceneId,
    title,
    characters,
    environment,
    ready,
    status,
    updatedAt: new Date().toISOString(),
  };
}

function preparedCharacterForSpeakerLabel(scene, speakerLabel) {
  const speakerKey = normalizeSpeakerText(speakerLabel);
  if (!speakerKey) return null;
  const characters = Array.isArray(scene && scene.characters) ? scene.characters : [];
  const exact = characters.find((character) => normalizeSpeakerText(character && character.name) === speakerKey);
  if (exact) return exact;
  const relaxedMatches = characters.filter((character) => {
    const characterKey = normalizeSpeakerText(character && character.name);
    if (!characterKey) return false;
    return characterKey.startsWith(`${speakerKey} `) || speakerKey.startsWith(`${characterKey} `);
  });
  return relaxedMatches.length === 1 ? relaxedMatches[0] : null;
}

function enrichTelepromptLinesWithPreparedSlots(parsed, scene) {
  if (!parsed || !Array.isArray(parsed.lines) || !scene) return parsed;
  return {
    ...parsed,
    lines: parsed.lines.map((line) => {
      if (!line || line.type !== "dialogue") return line;
      const character = preparedCharacterForSpeakerLabel(scene, line.speakerLabel);
      const slot = Number(character && character.slot || 0);
      if (slot < 1 || slot > 3) return line;
      return {
        ...line,
        speakerSlot: slot,
        speakerCharacterId: Number(character && character.id || 0),
        speakerResolvedName: String(character && character.name || ""),
      };
    }),
  };
}

function sanitizeAutoCameraSwitch(input = {}, base = DEFAULT_AUTO_CAMERA_SWITCH) {
  const source = input && typeof input === "object" && !Array.isArray(input) ? input : {};
  const enabled = Object.prototype.hasOwnProperty.call(source, "enabled") ? !!source.enabled : !!base.enabled;
  const reactionShotsEnabled = Object.prototype.hasOwnProperty.call(source, "reactionShotsEnabled")
    ? !!source.reactionShotsEnabled
    : !!base.reactionShotsEnabled;
  return {
    enabled,
    reactionShotsEnabled,
    lastCameraSlot: Math.max(0, Math.min(3, Number.parseInt(String(source.lastCameraSlot ?? base.lastCameraSlot ?? 0), 10) || 0)),
    lastSpeakerLabel: cleanPreparedText(source.lastSpeakerLabel ?? base.lastSpeakerLabel ?? "", 80),
    lastCueIndex: Number.parseInt(String(source.lastCueIndex ?? base.lastCueIndex ?? -1), 10) || 0,
    lastCueVersion: Number.parseInt(String(source.lastCueVersion ?? base.lastCueVersion ?? 0), 10) || 0,
    lastReason: cleanPreparedText(source.lastReason ?? base.lastReason ?? "", 120),
  };
}

function createTelepromptStore(options = {}) {
  const initialCaptionStyle = sanitizeCaptionStyle(options.captionStyle || options.initialCaptionStyle || DEFAULT_CAPTION_STYLE);
  let current = null;
  let version = 0;
  let cueIndex = 0;
  let cueVersion = 0;
  let cueUpdatedAt = new Date().toISOString();
  let captionStyle = { ...initialCaptionStyle };
  let captionStyleVersion = 0;
  let captionStyleUpdatedAt = cueUpdatedAt;
  let autoCameraSwitch = { ...DEFAULT_AUTO_CAMERA_SWITCH };
  let autoCameraSwitchVersion = 0;
  let autoCameraSwitchUpdatedAt = cueUpdatedAt;
  let preparedScene = null;
  let preparedSceneVersion = 0;

  function deckLength() {
    const lines = current && Array.isArray(current.lines) ? current.lines : [];
    return lines.length ? lines.length + 2 : 0;
  }

  function clampCueIndex(index) {
    const max = Math.max(deckLength() - 1, 0);
    const numeric = Number.parseInt(index, 10);
    if (!Number.isFinite(numeric)) return 0;
    return Math.max(0, Math.min(numeric, max));
  }

  function cueLocked() {
    return !!(preparedScene && preparedScene.status === "prepared");
  }

  function getCue() {
    cueIndex = clampCueIndex(cueIndex);
    return {
      index: cueIndex,
      deckLength: deckLength(),
      version: cueVersion,
      updatedAt: cueUpdatedAt,
      locked: cueLocked(),
    };
  }

  function setCueIndex(index) {
    if (cueLocked()) {
      return {
        cue: getCue(),
        changed: false,
        locked: true,
      };
    }
    const nextIndex = clampCueIndex(index);
    const changed = nextIndex !== cueIndex;
    cueIndex = nextIndex;
    if (changed) {
      cueVersion += 1;
      cueUpdatedAt = new Date().toISOString();
    }
    return {
      cue: getCue(),
      changed,
      locked: false,
    };
  }

  function resetCueIndex() {
    const changed = cueIndex !== 0;
    cueIndex = 0;
    cueVersion += 1;
    cueUpdatedAt = new Date().toISOString();
    return {
      cue: getCue(),
      changed,
    };
  }

  function getCaptionStyle() {
    return {
      ...captionStyle,
      version: captionStyleVersion,
      updatedAt: captionStyleUpdatedAt,
    };
  }

  function setCaptionStyle(input = {}) {
    const nextStyle = sanitizeCaptionStyle(input, captionStyle);
    const changed = Object.keys(DEFAULT_CAPTION_STYLE).some((key) => nextStyle[key] !== captionStyle[key]);
    if (changed) {
      captionStyle = nextStyle;
      captionStyleVersion += 1;
      captionStyleUpdatedAt = new Date().toISOString();
    }
    return {
      captionStyle: getCaptionStyle(),
      changed,
    };
  }

  function getAutoCameraSwitch() {
    return {
      ...autoCameraSwitch,
      version: autoCameraSwitchVersion,
      updatedAt: autoCameraSwitchUpdatedAt,
    };
  }

  function setAutoCameraSwitch(input = {}) {
    const next = sanitizeAutoCameraSwitch(input, autoCameraSwitch);
    if (!next.enabled) {
      next.lastCameraSlot = 0;
      next.lastSpeakerLabel = "";
      next.lastCueIndex = -1;
      next.lastCueVersion = 0;
      next.lastReason = "";
    }
    const changed = Object.keys(DEFAULT_AUTO_CAMERA_SWITCH).some((key) => next[key] !== autoCameraSwitch[key]);
    if (changed) {
      autoCameraSwitch = next;
      autoCameraSwitchVersion += 1;
      autoCameraSwitchUpdatedAt = new Date().toISOString();
    }
    return {
      autoCameraSwitch: getAutoCameraSwitch(),
      changed,
    };
  }

  function recordAutoCameraSwitch(input = {}) {
    const next = sanitizeAutoCameraSwitch({
      ...autoCameraSwitch,
      ...input,
      enabled: autoCameraSwitch.enabled,
    }, autoCameraSwitch);
    const changed = Object.keys(DEFAULT_AUTO_CAMERA_SWITCH).some((key) => next[key] !== autoCameraSwitch[key]);
    if (changed) {
      autoCameraSwitch = next;
      autoCameraSwitchVersion += 1;
      autoCameraSwitchUpdatedAt = new Date().toISOString();
    }
    return {
      autoCameraSwitch: getAutoCameraSwitch(),
      changed,
    };
  }

  function ingest(input = {}) {
    const parsed = enrichTelepromptLinesWithPreparedSlots(parseTeleprompt(input), preparedScene);
    const sceneId = Math.max(0, Number.parseInt(String(input.sceneId || input.scene_id || 0), 10) || 0);
    version += 1;
    current = {
      ...parsed,
      source: {
        ...parsed.source,
        sceneId,
      },
      version,
      updatedAt: parsed.source.generatedAt,
    };
    cueIndex = 0;
    cueVersion += 1;
    cueUpdatedAt = current.updatedAt;
    return current;
  }

  function getCurrent() {
    return current;
  }

  function getPreparedScene() {
    return preparedScene
      ? {
          ...preparedScene,
          characters: preparedScene.characters.map((character) => ({ ...character })),
          environment: preparedScene.environment ? { ...preparedScene.environment } : null,
          version: preparedSceneVersion,
        }
      : null;
  }

  function prepareScene(input = {}) {
    const nextPreparedScene = sanitizePreparedScene({ ...input, status: "prepared", ready: false });
    preparedScene = nextPreparedScene.sceneId || nextPreparedScene.title ? nextPreparedScene : null;
    preparedSceneVersion += 1;
    return {
      preparedScene: getPreparedScene(),
      changed: true,
    };
  }

  function setPreparedReady(ready = true) {
    if (!preparedScene) {
      preparedScene = sanitizePreparedScene({ title: "Volgende scene", ready: !!ready, status: "prepared" });
    } else {
      preparedScene = sanitizePreparedScene({ ...preparedScene, ready: !!ready, status: "prepared" }, preparedScene);
    }
    preparedSceneVersion += 1;
    return {
      preparedScene: getPreparedScene(),
      changed: true,
    };
  }

  function revealPreparedScene() {
    if (preparedScene) {
      preparedScene = sanitizePreparedScene({ ...preparedScene, status: "playing" }, preparedScene);
      preparedSceneVersion += 1;
    }
    const cueResult = resetCueIndex();
    return {
      preparedScene: getPreparedScene(),
      cue: cueResult.cue,
      changed: true,
    };
  }

  return {
    ingest,
    getCurrent,
    getCue,
    setCueIndex,
    resetCueIndex,
    getCaptionStyle,
    setCaptionStyle,
    getAutoCameraSwitch,
    setAutoCameraSwitch,
    recordAutoCameraSwitch,
    getPreparedScene,
    prepareScene,
    setPreparedReady,
    revealPreparedScene,
  };
}

module.exports = {
  DEFAULT_CAPTION_STYLE,
  DEFAULT_AUTO_CAMERA_SWITCH,
  createTelepromptStore,
  sanitizeCaptionStyle,
  sanitizeAutoCameraSwitch,
  enrichTelepromptLinesWithPreparedSlots,
};
