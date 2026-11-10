"use strict";

// Scheldwoordenfilter.
// Woordenlijst: modules/audience/moderation/bad-words.txt (een woord per regel, # = commentaar).
// De lijst wordt opnieuw ingelezen zodra het bestand verandert.

const fs = require("node:fs");
const path = require("node:path");

const DEFAULT_WORDS_PATH = path.resolve(__dirname, "../moderation/bad-words.txt");

function normalizeModerationText(input, { decodeLeet = false } = {}) {
  let text = String(input || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "");
  if (decodeLeet) {
    text = text
      .replace(/0/g, "o")
      .replace(/1/g, "i")
      .replace(/2/g, "z")
      .replace(/3/g, "e")
      .replace(/4/g, "a")
      .replace(/5/g, "s")
      .replace(/6/g, "g")
      .replace(/7/g, "t")
      .replace(/8/g, "b")
      .replace(/9/g, "g")
      .replace(/@/g, "a")
      .replace(/\$/g, "s")
      .replace(/[!|]/g, "i");
  }
  return text.replace(/[^a-z0-9]+/g, " ").trim().replace(/\s+/g, " ");
}

function normalizeModerationToken(input) {
  return normalizeModerationText(input).replace(/\s+/g, "");
}

function uniqueNonEmpty(values) {
  return Array.from(new Set(values.filter(Boolean)));
}

function splitTokens(text) {
  return String(text || "").split(" ").filter(Boolean);
}

function mergeSingleLetterRuns(tokens, minRunLength = 3) {
  const out = [];
  let run = [];
  function flushRun() {
    if (!run.length) return;
    if (run.length >= minRunLength) out.push(run.join(""));
    else out.push(...run);
    run = [];
  }
  for (const token of tokens) {
    if (token.length === 1) {
      run.push(token);
      continue;
    }
    flushRun();
    out.push(token);
  }
  flushRun();
  return out;
}

function parseWordLines(raw) {
  return uniqueNonEmpty(
    String(raw || "")
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith("#") && !line.startsWith("//"))
      .map((line) => normalizeModerationToken(line))
  );
}

function detectMatch(words, input, { allowSubword = false } = {}) {
  const textPlain = normalizeModerationText(input);
  if (!textPlain || !words.length) return null;
  const textLeet = normalizeModerationText(input, { decodeLeet: true });
  const plainTokens = splitTokens(textPlain);
  const leetTokens = splitTokens(textLeet);
  const mergedPlainTokens = mergeSingleLetterRuns(plainTokens);
  const mergedLeetTokens = mergeSingleLetterRuns(leetTokens);
  const tokenSet = new Set([...plainTokens, ...leetTokens, ...mergedPlainTokens, ...mergedLeetTokens]);
  const compactForms = uniqueNonEmpty([
    plainTokens.join(""),
    leetTokens.join(""),
    mergedPlainTokens.join(""),
    mergedLeetTokens.join(""),
  ]);
  for (const blocked of words) {
    if (tokenSet.has(blocked)) return { type: "word", match: blocked };
    if (allowSubword && blocked.length >= 4) {
      for (const compact of compactForms) {
        if (compact.includes(blocked)) return { type: "subword", match: blocked };
      }
    }
  }
  return null;
}

function createWordFilter({ wordsPath = process.env.AUDIENCE_BAD_WORDS_PATH || DEFAULT_WORDS_PATH, watch = true } = {}) {
  let words = [];
  function load() {
    try {
      words = parseWordLines(fs.readFileSync(wordsPath, "utf8"));
    } catch {
      words = [];
    }
  }
  load();
  if (watch) {
    try {
      fs.watchFile(wordsPath, { interval: 1500 }, (curr, prev) => {
        if (curr.mtimeMs !== prev.mtimeMs) load();
      }).unref();
    } catch {}
  }
  return {
    path: wordsPath,
    count: () => words.length,
    match: (input, options) => detectMatch(words, input, options),
  };
}

module.exports = {
  createWordFilter,
  detectMatch,
  parseWordLines,
};
