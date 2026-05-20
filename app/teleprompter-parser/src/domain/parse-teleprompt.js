"use strict";

const CHARACTER_COLORS = ["#4cc9f0", "#f72585", "#ffd166", "#80ed99", "#bdb2ff", "#ff9f1c"];
const STAGE_PREFIX_RE = /^(regie|actie|stage|scene|scène|richting|aanwijzing)\s*:\s*/i;
const DIALOGUE_RE = /^([^:\n]{1,64})\s*:\s*(.+)$/;

function cleanText(value) {
  return String(value || "")
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t]+$/gm, "")
    .trim();
}

function stripOuterMarks(value) {
  return String(value || "")
    .trim()
    .replace(/^\*+|\*+$/g, "")
    .replace(/^\[|\]$/g, "")
    .replace(/^\(|\)$/g, "")
    .trim();
}

function normalizeSpeaker(value) {
  return String(value || "")
    .replace(/^[-*•\s]+/, "")
    .trim();
}

function titleFromHeading(rawText) {
  const heading = String(rawText || "")
    .split("\n")
    .map((line) => line.trim())
    .find((line) => /^#{1,3}\s+\S/.test(line));
  return heading ? heading.replace(/^#{1,3}\s+/, "").trim() : "";
}

function removeTitleHeading(rawText, title) {
  if (!title) return rawText;
  const lines = String(rawText || "").split("\n");
  const titleLower = title.toLowerCase();
  return lines
    .filter((line, index) => {
      if (index > 4) return true;
      const cleaned = line.trim().replace(/^#{1,3}\s+/, "").trim().toLowerCase();
      return cleaned !== titleLower;
    })
    .join("\n");
}

function splitDialogueText(text) {
  const clean = String(text || "").trim();
  if (!clean) return [];
  return clean
    .replace(/\s+/g, " ")
    .split(/(?<=[.!?])\s+(?=[A-ZÀ-Ý0-9"'“‘])/)
    .map((part) => part.trim())
    .filter(Boolean);
}

function isBracketedStageDirection(line) {
  const trimmed = String(line || "").trim();
  return (
    (trimmed.startsWith("[") && trimmed.endsWith("]")) ||
    (trimmed.startsWith("(") && trimmed.endsWith(")")) ||
    (trimmed.startsWith("*") && trimmed.endsWith("*") && trimmed.length > 2)
  );
}

function getCharacter(charactersByLabel, characters, label) {
  const normalized = normalizeSpeaker(label);
  const key = normalized.toLowerCase();
  if (charactersByLabel.has(key)) return charactersByLabel.get(key);
  const character = {
    id: `character_${characters.length + 1}`,
    label: normalized,
    color: CHARACTER_COLORS[characters.length % CHARACTER_COLORS.length],
  };
  characters.push(character);
  charactersByLabel.set(key, character);
  return character;
}

function parseTeleprompt(input = {}) {
  const sourceKind = String(input.source || "manual");
  const rawText = cleanText(input.rawText || input.text || "");
  const explicitTitle = cleanText(input.title || "");
  const inferredTitle = explicitTitle || titleFromHeading(rawText) || "Teleprompt";
  const sourceText = removeTitleHeading(rawText, inferredTitle);
  const characters = [];
  const charactersByLabel = new Map();
  const lines = [];

  sourceText
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .forEach((line) => {
      const withoutBullet = line.replace(/^[-•]\s+/, "").trim();
      const dialogue = withoutBullet.match(DIALOGUE_RE);
      if (dialogue && !STAGE_PREFIX_RE.test(withoutBullet)) {
        const character = getCharacter(charactersByLabel, characters, dialogue[1]);
        splitDialogueText(dialogue[2]).forEach((text) => {
          lines.push({
            id: `line_${lines.length + 1}`,
            type: "dialogue",
            speakerId: character.id,
            speakerLabel: character.label,
            text,
          });
        });
        return;
      }

      const stageText = STAGE_PREFIX_RE.test(withoutBullet)
        ? withoutBullet.replace(STAGE_PREFIX_RE, "")
        : isBracketedStageDirection(withoutBullet)
          ? stripOuterMarks(withoutBullet)
          : withoutBullet;
      if (stageText) {
        lines.push({
          id: `line_${lines.length + 1}`,
          type: "stage_direction",
          text: stageText,
        });
      }
    });

  return {
    title: inferredTitle,
    characters,
    lines,
    source: {
      kind: sourceKind,
      parser: "rule-based-v1",
      generatedAt: new Date().toISOString(),
    },
  };
}

module.exports = {
  parseTeleprompt,
};
