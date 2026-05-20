"use strict";

const { parseTeleprompt } = require("../domain/parse-teleprompt");

function createTelepromptStore() {
  let current = null;
  let version = 0;
  let cueIndex = 0;
  let cueVersion = 0;
  let cueUpdatedAt = new Date().toISOString();

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
  };
}

module.exports = {
  createTelepromptStore,
};
