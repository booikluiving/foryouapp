"use strict";

const CHARACTER_COLORS = ["#4cc9f0", "#f72585", "#ffd166", "#80ed99", "#bdb2ff", "#ff9f1c"];
const STAGE_PREFIX_RE = /^(regie|actie|stage|scene|scène|richting|aanwijzing)\s*:\s*/i;
const DIALOGUE_RE = /^([^:\n]{1,64})\s*:\s*(.+)$/;
const { leesBordregel, maakBord } = require("./bord");
const { resolveSpeakerName } = require("../../../text-parser/speaker-names");

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

function titleFromFirstLine(rawText) {
  const firstLine = String(rawText || "")
    .split("\n")
    .map((line) => line.trim())
    .find(Boolean);
  if (!firstLine || /^#{1,3}\s+\S/.test(firstLine)) return "";
  const withoutBullet = firstLine.replace(/^[-•]\s+/, "").trim();
  if (!withoutBullet || STAGE_PREFIX_RE.test(withoutBullet) || DIALOGUE_RE.test(withoutBullet)) return "";
  return stripOuterMarks(withoutBullet);
}

const HEADING_RE = /^#{1,6}\s*\S/;
const TITLE_PREFIX_RE = /^(titel|title)\s*:/i;

// Het script begint met dialoog: de titel staat al op het zaalscherm terwijl het script geschreven
// wordt. Schrijft het taalmodel toch een titel, dan vervalt die hier en wordt hij geen regel of cue:
// elke kopregel (#), een regel "Titel: …", een regel die gelijk is aan de titel, en een losse eerste
// regel die geen dialoog, regie of bordregel is.
function removeTitleLines(rawText, title) {
  const titleLower = stripOuterMarks(String(title || "")).toLowerCase();
  let seenContent = false;
  return String(rawText || "")
    .split("\n")
    .filter((line) => {
      const trimmed = line.trim();
      if (!trimmed) return true;
      const first = !seenContent;
      const bare = stripOuterMarks(trimmed.replace(/^#{1,6}\s*/, "").replace(/^[-•]\s+/, ""));
      if (HEADING_RE.test(trimmed) || TITLE_PREFIX_RE.test(bare)) return false;
      if (first && titleLower && bare.toLowerCase() === titleLower) return false;
      seenContent = true;
      if (!first) return true;
      const withoutBullet = trimmed.replace(/^[-•]\s+/, "").trim();
      if (/^\*\*.+\*\*$/.test(withoutBullet)) return false;
      const keep =
        DIALOGUE_RE.test(withoutBullet) ||
        STAGE_PREFIX_RE.test(withoutBullet) ||
        isBracketedStageDirection(withoutBullet) ||
        !!leesBordregel(withoutBullet);
      return keep;
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

// Met de personagelijst van de scène erbij krijgt een ingekorte naam de volledige naam.
function getCharacter(charactersByLabel, characters, label, characterNames) {
  const written = normalizeSpeaker(label);
  const normalized = resolveSpeakerName(written, characterNames) || written;
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
  const inferredTitle = explicitTitle || titleFromHeading(rawText) || titleFromFirstLine(rawText) || "Teleprompt";
  const sourceText = removeTitleLines(rawText, inferredTitle);
  const characters = [];
  const charactersByLabel = new Map();
  const characterNames = Array.isArray(input.characterNames) ? input.characterNames : [];
  const lines = [];
  const bord = maakBord();
  let wachtend = [];
  const beginBord = [];
  // Bordstappen hangen aan de eerstvolgende regel die de speler doorklikt.
  const pushLine = (line) => {
    if (wachtend.length) {
      line.bord = wachtend;
      wachtend = [];
    }
    lines.push(line);
  };

  sourceText
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .forEach((line) => {
      const withoutBullet = line.replace(/^[-•]\s+/, "").trim();
      const bordregel = leesBordregel(withoutBullet);
      if (bordregel) {
        const stappen = bord.verwerk(bordregel);
        // Een nieuw plaatje staat één klik eerder stil: op de regel vóór de bordregel. Zo staat het al
        // vast als de speler erover begint. Plekken gaan af met de regel erna.
        const vorige = lines[lines.length - 1];
        if (bordregel.soort === "plaatje" && vorige) {
          vorige.bord = [...(vorige.bord || []), ...wachtend, ...stappen];
          wachtend = [];
        } else if (bordregel.soort === "plaatje" && !vorige) {
          // Plaatje vóór de eerste regel: staat al stil op de titelkaart.
          beginBord.push(...wachtend, ...stappen);
          wachtend = [];
        } else {
          wachtend.push(...stappen);
        }
        return;
      }
      const dialogue = withoutBullet.match(DIALOGUE_RE);
      if (dialogue && !STAGE_PREFIX_RE.test(withoutBullet)) {
        const character = getCharacter(charactersByLabel, characters, dialogue[1], characterNames);
        splitDialogueText(dialogue[2]).forEach((text) => {
          pushLine({
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
        pushLine({
          id: `line_${lines.length + 1}`,
          type: "stage_direction",
          text: stageText,
        });
      }
    });

  // Wat aan het eind nog openstaat, gaat mee met de laatste regel.
  wachtend.push(...bord.sluit());
  if (wachtend.length && lines.length) {
    const laatste = lines[lines.length - 1];
    laatste.bord = [...(laatste.bord || []), ...wachtend];
  }
  const bordNamen = bord.namen();

  return {
    title: inferredTitle,
    characters,
    lines,
    ...(bordNamen.length ? { bord: { namen: bordNamen, ...(beginBord.length ? { begin: beginBord } : {}) } } : {}),
    source: {
      kind: sourceKind,
      parser: "rule-based",
      generatedAt: new Date().toISOString(),
    },
  };
}

module.exports = {
  parseTeleprompt,
};
