"use strict";

const fs = require("fs");
const path = require("path");
const { assignPerformerSlots, seededRandom } = require("../../../shared/casting/performer-slots");

// Situaties waar een vrij personage in het vak uit de catalogus blijft (het meubel staat daar).
// Wordt bij elk klaarzetten opnieuw gelezen.
const VASTE_PLEKKEN_FILE = process.env.RUNTIME_VASTE_PLEKKEN_FILE
  || path.join(__dirname, "..", "..", "..", "shared", "casting", "vaste-plekken.json");

function leesVastePlekken(file = VASTE_PLEKKEN_FILE) {
  try {
    const data = JSON.parse(fs.readFileSync(file, "utf8"));
    const lijst = Array.isArray(data) ? data : data && data.situationIds;
    return new Set(Array.isArray(lijst) ? lijst.map(String) : []);
  } catch (_err) {
    return new Set();
  }
}

function vastePlekVoor(situation, characterId, filled = []) {
  const ingevuld = filled.find((entry) => entry.character.id === characterId);
  if (ingevuld) return ingevuld.slotIndex;
  const slot = (situation.characterSlots || []).find((item) => item && item.characterId === characterId);
  const slotIndex = slot ? Number(slot.slotIndex) : NaN;
  return Number.isInteger(slotIndex) && slotIndex > 0 ? slotIndex : null;
}

function situationById(catalog, situationId) {
  return (catalog.situations || []).find((item) => item.id === situationId) || null;
}

function characterById(catalog, characterId) {
  return (catalog.characters || []).find((item) => item.id === characterId) || null;
}

function environmentById(catalog, environmentId) {
  return (catalog.environments || []).find((item) => item.id === environmentId) || null;
}

function activeEnvironments(catalog) {
  return (catalog.environments || []).filter((item) => item.active && !item.archivedAt);
}

// Invulscène: een plek "willekeurig personage" krijgt bij het klaarzetten een actief personage
// uit de catalogus, niet een dat al in de scène staat en liefst niet een uit de vorige scène.
// De zoveelste willekeurige plek (op volgorde) is {personageN} in de prompt.
function fillRandomSlots({ catalog, situation, seed, recentCharacterIds }) {
  const slots = (situation.characterSlots || [])
    .filter((slot) => slot && slot.mode === "random-character")
    .sort((a, b) => Number(a.slotIndex || 0) - Number(b.slotIndex || 0));
  if (!slots.length) return [];
  const taken = new Set(situation.characterIds || []);
  const recent = new Set(recentCharacterIds || []);
  const pool = (catalog.characters || [])
    .filter((item) => item && item.id && item.active !== false && !item.archivedAt && !taken.has(item.id))
    .sort((a, b) => String(a.id).localeCompare(String(b.id)));
  const random = seededRandom(`${seed}:invul`);
  const filled = [];
  for (const slot of slots) {
    const open = pool.filter((item) => !filled.some((entry) => entry.character.id === item.id));
    const fresh = open.filter((item) => !recent.has(item.id));
    const choices = fresh.length ? fresh : open;
    if (!choices.length) break;
    const character = choices[Math.floor(random() * choices.length)];
    filled.push({ placeholder: `personage${filled.length + 1}`, character, slotIndex: Number(slot.slotIndex) || null });
  }
  return filled;
}

function fillPlaceholders(text, filled) {
  return filled.reduce(
    (out, entry) => out.split(`{${entry.placeholder}}`).join(entry.character.name),
    String(text || "")
  );
}

function materializePreparedNext({ catalog, preparedNext, seed = "", environmentId = "", recentSlotIndexes = [], recentCharacterIds = [] }) {
  if (!preparedNext || !preparedNext.situationId) return null;
  const situation = situationById(catalog, preparedNext.situationId);
  if (!situation) throw new Error(`runtime_materialize_missing_situation:${preparedNext.situationId}`);
  const characters = (situation.characterIds || [])
    .map((id) => characterById(catalog, id))
    .filter(Boolean);
  const filled = fillRandomSlots({ catalog, situation, seed, recentCharacterIds });
  // Een ingevuld personage krijgt een vrije speler via de loting, niet zijn eigen vaste speler.
  for (const entry of filled) characters.push({ ...entry.character, performerIds: [] });
  let environment = situation.environmentId ? environmentById(catalog, situation.environmentId) : null;
  if (!environment && situation.environmentMode === "random") {
    environment = activeEnvironments(catalog)[0] || null;
  }
  // Scènes testen: de operator kiest zelf de omgeving bij deze situatie.
  const chosenEnvironment = environmentId ? environmentById(catalog, environmentId) : null;
  if (chosenEnvironment) environment = chosenEnvironment;
  const vastePlekken = leesVastePlekken().has(situation.id);
  const castAssignment = assignPerformerSlots({
    characters: vastePlekken
      ? characters.map((item) => ({ ...item, vastePlek: vastePlekVoor(situation, item.id, filled) }))
      : characters,
    performers: catalog.performers || [],
    // Vrije personages worden verloot over de spelers die nog niets hebben.
    seed,
    recentSlotIndexes,
  });
  return {
    situationId: situation.id,
    legacySituationId: situation.legacyId,
    title: situation.title,
    promptText: fillPlaceholders(situation.promptText, filled),
    characterIds: characters.map((item) => item.id),
    characters: characters.map((item) => ({
      id: item.id,
      legacyId: item.legacyId,
      name: item.name,
      performerIds: item.performerIds || [],
    })),
    performerSlots: castAssignment.performerSlots,
    ...(castAssignment.issues.length ? { castWarnings: castAssignment.issues } : {}),
    environmentId: environment ? environment.id : null,
    environment: environment ? {
      id: environment.id,
      legacyId: environment.legacyId,
      name: environment.name,
    } : null,
    labelIds: situation.labelIds || [],
    ...(filled.length ? {
      ingevuld: filled.map((entry) => ({ placeholder: entry.placeholder, characterId: entry.character.id, name: entry.character.name })),
    } : {}),
    seed,
    materializedAt: new Date().toISOString(),
  };
}

module.exports = {
  materializePreparedNext,
};
