"use strict";

const MAX_PERFORMER_SLOT = 3;

function asArray(value) {
  return Array.isArray(value) ? value : value == null || value === "" ? [] : [value];
}

function normalizeId(value) {
  return String(value == null ? "" : value).trim();
}

function uniqueIds(values = []) {
  const seen = new Set();
  const output = [];
  for (const value of asArray(values)) {
    const id = normalizeId(value);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    output.push(id);
  }
  return output;
}

function normalizeSlotIndex(value) {
  const slotIndex = Number(value);
  return Number.isFinite(slotIndex) ? slotIndex : null;
}

function displayName(item = {}, fallback = "") {
  return normalizeId(item.name || item.title || item.characterName || item.performerName || item.id || fallback);
}

function activePerformers(performers = []) {
  const seenIds = new Set();
  const output = [];
  for (const item of Array.isArray(performers) ? performers : []) {
    const id = normalizeId(item && (item.id || item.performerId));
    if (!id) continue;
    if (item.active === false || item.archivedAt) continue;
    if (seenIds.has(id)) continue;
    seenIds.add(id);
    output.push({
      id,
      legacyId: item.legacyId || item.legacyPerformerId || null,
      name: displayName(item, id),
      slotIndex: normalizeSlotIndex(item.performerSlot ?? item.slotIndex),
    });
  }
  return output.sort((a, b) => {
    if (Number(a.slotIndex || 0) !== Number(b.slotIndex || 0)) {
      return Number(a.slotIndex || 0) - Number(b.slotIndex || 0);
    }
    return a.name.localeCompare(b.name, "nl-NL") || a.id.localeCompare(b.id, "nl-NL");
  });
}

function activeSlottedPerformers(performers = []) {
  return activePerformers(performers).filter((performer) => (
    Number.isInteger(Number(performer.slotIndex))
    && Number(performer.slotIndex) >= 1
    && Number(performer.slotIndex) <= MAX_PERFORMER_SLOT
  ));
}

function normalizeCharacter(character = {}, index = 0) {
  const id = normalizeId(character.id || character.characterId);
  return {
    id,
    legacyId: character.legacyId || character.legacyCharacterId || null,
    name: displayName(character, id),
    performerIds: uniqueIds(character.performerIds),
    index,
  };
}

function activePerformerChoicesForCharacter(character, performersById, fallbackPerformers) {
  if (!character.performerIds.length) return fallbackPerformers.map((performer) => performer.id);
  return character.performerIds.filter((performerId) => performersById.has(performerId));
}

function canAssignDistinctPerformers(characters, performers) {
  if (!characters.length) return true;
  if (performers.length < characters.length) return false;
  const performersById = new Map(performers.map((performer) => [performer.id, performer]));
  const choices = characters
    .map((character) => ({
      character,
      choices: activePerformerChoicesForCharacter(character, performersById, performers),
    }))
    .sort((a, b) => {
      if (a.choices.length !== b.choices.length) return a.choices.length - b.choices.length;
      return a.character.index - b.character.index;
    });
  if (choices.some((item) => item.choices.length === 0)) return false;

  function search(index, usedPerformers) {
    if (index >= choices.length) return true;
    for (const performerId of choices[index].choices) {
      if (usedPerformers.has(performerId)) continue;
      usedPerformers.add(performerId);
      if (search(index + 1, usedPerformers)) return true;
      usedPerformers.delete(performerId);
    }
    return false;
  }

  return search(0, new Set());
}

function performerSlotsForCharacters({ characters = [], performers = [] } = {}) {
  const normalizedCharacters = (Array.isArray(characters) ? characters : [])
    .map(normalizeCharacter)
    .filter((character) => character.id || character.name);
  const performersById = new Map((Array.isArray(performers) ? performers : [])
    .filter((performer) => performer && normalizeId(performer.id || performer.performerId))
    .map((performer) => [normalizeId(performer.id || performer.performerId), performer]));
  const seen = new Set();
  const slots = [];

  for (const character of normalizedCharacters) {
    const performerIds = character.performerIds.length ? character.performerIds : [null];
    for (const performerId of performerIds) {
      const performer = performerId ? performersById.get(performerId) : null;
      const slotIndex = performer && normalizeSlotIndex(performer.performerSlot ?? performer.slotIndex) != null
        ? normalizeSlotIndex(performer.performerSlot ?? performer.slotIndex)
        : slots.length + 1;
      const key = `${slotIndex}:${performerId || "unassigned"}:${character.id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      slots.push({
        slotIndex,
        performerId,
        performerName: performer ? displayName(performer, performerId) : null,
        characterId: character.id,
        legacyCharacterId: character.legacyId || null,
        characterName: character.name,
      });
    }
  }

  return slots.sort((a, b) => {
    if (Number(a.slotIndex || 0) !== Number(b.slotIndex || 0)) {
      return Number(a.slotIndex || 0) - Number(b.slotIndex || 0);
    }
    return String(a.characterName || "").localeCompare(String(b.characterName || ""), "nl-NL");
  });
}

function castWarningsForCharacters(characters = [], performers = []) {
  const normalizedCharacters = (Array.isArray(characters) ? characters : [])
    .map(normalizeCharacter)
    .filter((character) => character.id || character.name);
  const normalizedPerformers = activePerformers(performers);
  if (canAssignDistinctPerformers(normalizedCharacters, normalizedPerformers)) return [];
  return [{
    severity: "warning",
    code: "situation_cast_performer_conflict",
    message: "Selected characters may require the same performer; runtime can continue with a warning.",
    characterIds: normalizedCharacters.map((character) => character.id).filter(Boolean),
  }];
}

function assignPerformerSlots({ characters = [], performers = [] } = {}) {
  const performerSlots = performerSlotsForCharacters({ characters, performers });
  const issues = castWarningsForCharacters(characters, performers);
  return {
    ok: issues.length === 0,
    performerSlots,
    issues,
  };
}

function canAssignCast(characters = [], performers = []) {
  const normalizedCharacters = (Array.isArray(characters) ? characters : [])
    .map(normalizeCharacter)
    .filter((character) => character.id || character.name);
  return canAssignDistinctPerformers(normalizedCharacters, activePerformers(performers));
}

module.exports = {
  MAX_PERFORMER_SLOT,
  activePerformers,
  activeSlottedPerformers,
  assignPerformerSlots,
  canAssignCast,
  castWarningsForCharacters,
  performerSlotsForCharacters,
};
