"use strict";

const PARSER_ID = "rule-based-v1";
const DEFAULT_TITLE = "Teleprompt";
const CHARACTER_COLORS = Object.freeze([
  "#4cc9f0",
  "#f72585",
  "#ffd166",
  "#80ed99",
  "#c77dff",
  "#ff8c42",
]);

const STAGE_DIRECTION_LABELS = new Set([
  "actie",
  "camera",
  "geluid",
  "licht",
  "muziek",
  "regie",
  "regieaanwijzing",
  "sfx",
  "stage",
  "toneel",
]);

function normalizeLineBreaks(input) {
  return String(input || "").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
}

function normalizeInlineText(input) {
  return String(input || "")
    .replace(/\t+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeTitle(input) {
  const title = normalizeInlineText(input).replace(/^#+\s*/, "").replace(/\s*#+$/, "").trim();
  return title || "";
}

function markdownHeadingTitle(line) {
  const match = String(line || "").match(/^\s*#{1,6}\s+(.+?)\s*#*\s*$/);
  return match ? normalizeTitle(match[1]) : "";
}

function findMarkdownTitle(lines) {
  for (let index = 0; index < lines.length; index += 1) {
    const title = markdownHeadingTitle(lines[index]);
    if (title) return { title, index };
  }
  return { title: "", index: -1 };
}

function cleanSpeakerLabel(input) {
  return normalizeInlineText(input).replace(/^[*_`]+/, "").replace(/[*_`]+$/, "").trim();
}

function characterKey(label) {
  return cleanSpeakerLabel(label).toLocaleLowerCase("nl-NL");
}

function isStageDirectionLabel(label) {
  return STAGE_DIRECTION_LABELS.has(normalizeInlineText(label).toLocaleLowerCase("nl-NL"));
}

function unwrapStageDirection(input) {
  const text = normalizeInlineText(input);
  const pairs = [
    ["[", "]"],
    ["(", ")"],
    ["{", "}"],
  ];
  for (const [open, close] of pairs) {
    if (text.startsWith(open) && text.endsWith(close) && text.length > 1) {
      return normalizeInlineText(text.slice(1, -1));
    }
  }
  if (text.startsWith("*") && text.endsWith("*") && text.length > 1) {
    return normalizeInlineText(text.slice(1, -1));
  }
  return text;
}

function parseStageDirection(rawLine) {
  const text = normalizeInlineText(rawLine);
  if (!text) return "";
  const labelMatch = text.match(/^([^:\n]{1,40}):\s*(.*?)\s*$/);
  if (labelMatch && isStageDirectionLabel(labelMatch[1])) {
    return unwrapStageDirection(labelMatch[2] || "");
  }
  const unwrapped = unwrapStageDirection(text);
  if (unwrapped !== text) return unwrapped;
  return "";
}

function parseDialogue(rawLine) {
  const text = normalizeInlineText(rawLine);
  const match = text.match(/^([^:\n]{1,80}):\s*(.*?)\s*$/);
  if (!match) return null;
  const speakerLabel = cleanSpeakerLabel(match[1]);
  const dialogue = normalizeInlineText(match[2]);
  if (!speakerLabel || isStageDirectionLabel(speakerLabel)) return null;
  if (!dialogue) return null;
  return { speakerLabel, dialogue };
}

function splitDialogueSentences(text) {
  const value = normalizeInlineText(text);
  if (!value) return [];
  const parts = value
    .split(/(?<=[.!?])\s+(?=[^\s])/)
    .map((part) => normalizeInlineText(part))
    .filter(Boolean);
  return parts.length ? parts : [value];
}

function createCharacterResolver() {
  const characters = [];
  const byKey = new Map();

  function resolve(label) {
    const cleanLabel = cleanSpeakerLabel(label);
    const key = characterKey(cleanLabel);
    if (byKey.has(key)) return byKey.get(key);
    const character = {
      id: `character_${characters.length + 1}`,
      label: cleanLabel,
      color: CHARACTER_COLORS[characters.length % CHARACTER_COLORS.length],
    };
    characters.push(character);
    byKey.set(key, character);
    return character;
  }

  return {
    resolve,
    characters,
  };
}

function parseTelepromptText(input = {}) {
  const rawText = normalizeLineBreaks(input.rawText || input.text || "");
  const rawLines = rawText.split("\n");
  const explicitTitle = normalizeTitle(input.title);
  const heading = findMarkdownTitle(rawLines);
  const title = explicitTitle || heading.title || DEFAULT_TITLE;
  const sourceKind = normalizeInlineText(input.source || input.kind || "manual") || "manual";
  const generatedAt = input.generatedAt || new Date().toISOString();
  const resolver = createCharacterResolver();
  const lines = [];

  for (let index = 0; index < rawLines.length; index += 1) {
    const rawLine = rawLines[index];
    const trimmed = normalizeInlineText(rawLine);
    if (!trimmed) continue;
    if (index === heading.index && (!explicitTitle || normalizeTitle(heading.title) === normalizeTitle(title))) {
      continue;
    }

    const headingTitle = markdownHeadingTitle(rawLine);
    if (headingTitle) {
      lines.push({
        id: `line_${lines.length + 1}`,
        type: "stage_direction",
        text: headingTitle,
      });
      continue;
    }

    const direction = parseStageDirection(rawLine);
    if (direction) {
      lines.push({
        id: `line_${lines.length + 1}`,
        type: "stage_direction",
        text: direction,
      });
      continue;
    }

    const dialogue = parseDialogue(rawLine);
    if (dialogue) {
      const character = resolver.resolve(dialogue.speakerLabel);
      for (const sentence of splitDialogueSentences(dialogue.dialogue)) {
        lines.push({
          id: `line_${lines.length + 1}`,
          type: "dialogue",
          speakerId: character.id,
          speakerLabel: character.label,
          text: sentence,
        });
      }
      continue;
    }

    lines.push({
      id: `line_${lines.length + 1}`,
      type: "stage_direction",
      text: unwrapStageDirection(rawLine),
    });
  }

  return {
    title,
    characters: resolver.characters.map((character) => ({ ...character })),
    lines,
    source: {
      kind: sourceKind,
      parser: PARSER_ID,
      generatedAt,
    },
  };
}

module.exports = {
  CHARACTER_COLORS,
  DEFAULT_TITLE,
  PARSER_ID,
  parseTelepromptText,
};

