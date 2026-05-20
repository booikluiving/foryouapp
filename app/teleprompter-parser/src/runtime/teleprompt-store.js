"use strict";

const { parseTeleprompt } = require("../domain/parse-teleprompt");

const DEFAULT_CAPTION_STYLE = Object.freeze({
  fontSizeScale: 1,
  verticalPosition: 66,
  widthPercent: 86,
  outlineScale: 1,
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

function createTelepromptStore() {
  let current = null;
  let version = 0;
  let cueIndex = 0;
  let cueVersion = 0;
  let cueUpdatedAt = new Date().toISOString();
  let captionStyle = { ...DEFAULT_CAPTION_STYLE };
  let captionStyleVersion = 0;
  let captionStyleUpdatedAt = cueUpdatedAt;

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

  function getCue() {
    cueIndex = clampCueIndex(cueIndex);
    return {
      index: cueIndex,
      deckLength: deckLength(),
      version: cueVersion,
      updatedAt: cueUpdatedAt,
    };
  }

  function setCueIndex(index) {
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

  function ingest(input = {}) {
    const parsed = parseTeleprompt(input);
    version += 1;
    current = {
      ...parsed,
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

  return {
    ingest,
    getCurrent,
    getCue,
    setCueIndex,
    getCaptionStyle,
    setCaptionStyle,
  };
}

module.exports = {
  DEFAULT_CAPTION_STYLE,
  createTelepromptStore,
  sanitizeCaptionStyle,
};
