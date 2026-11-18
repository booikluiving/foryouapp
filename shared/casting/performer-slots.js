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

// Loting met een vaste uitkomst per seed: dezelfde seed geeft dezelfde verdeling.
function seededRandom(seed) {
  let state = 0x811c9dc5;
  for (const char of String(seed)) {
    state ^= char.codePointAt(0);
    state = Math.imul(state, 0x01000193) >>> 0;
  }
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Hoeveel scènes geleden stond deze plek voor het laatst in beeld (0 = de vorige scène).
// recentSlotIndexes: per eerdere scène de bezette plekken, oudste eerst.
function scenesSinceOnStage(slotIndex, recentSlotIndexes) {
  for (let index = recentSlotIndexes.length - 1; index >= 0; index -= 1) {
    if (asArray(recentSlotIndexes[index]).map(Number).includes(slotIndex)) {
      return recentSlotIndexes.length - 1 - index;
    }
  }
  return Number.POSITIVE_INFINITY;
}

// Welke plekken krijgen een vrij personage (een personage zonder vaste speler)?
// Zonder seed: de laagste vrije plekken, op volgorde. Met seed: wie het langst niet in
// beeld was gaat voor, bij gelijke stand beslist het lot.
function slotsForFreeCharacters({ count, openSlots, seed, recentSlotIndexes }) {
  if (count <= 0) return [];
  let order = [...openSlots];
  if (seed != null && seed !== "" && order.length > count) {
    const random = seededRandom(seed);
    order = order
      .map((slotIndex) => ({
        slotIndex,
        waited: scenesSinceOnStage(slotIndex, recentSlotIndexes),
        lot: random(),
      }))
      .sort((a, b) => (a.waited === b.waited ? a.lot - b.lot : b.waited - a.waited))
      .map((item) => item.slotIndex);
  }
  return order.slice(0, count).sort((a, b) => a - b);
}

function performerSlotsForCharacters({ characters = [], performers = [], seed = null, recentSlotIndexes = [] } = {}) {
  const normalizedCharacters = (Array.isArray(characters) ? characters : [])
    .map(normalizeCharacter)
    .filter((character) => character.id || character.name);
  const performersById = new Map((Array.isArray(performers) ? performers : [])
    .filter((performer) => performer && normalizeId(performer.id || performer.performerId))
    .map((performer) => [normalizeId(performer.id || performer.performerId), performer]));
  const seen = new Set();
  const slots = [];
  const freeCharacters = [];

  function addSlot(slotIndex, performerId, performer, character) {
    const key = `${slotIndex}:${performerId || "unassigned"}:${character.id}`;
    if (seen.has(key)) return;
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

  // Eerst de vaste koppelingen: die bepalen welke plekken bezet zijn.
  for (const character of normalizedCharacters) {
    if (!character.performerIds.length) {
      freeCharacters.push(character);
      continue;
    }
    for (const performerId of character.performerIds) {
      const performer = performersById.get(performerId) || null;
      const slotIndex = performer && normalizeSlotIndex(performer.performerSlot ?? performer.slotIndex) != null
        ? normalizeSlotIndex(performer.performerSlot ?? performer.slotIndex)
        : normalizedCharacters.indexOf(character) + 1;
      addSlot(slotIndex, performerId, performer, character);
    }
  }

  // Dan de vrije personages: over de plekken die in deze scène nog niemand hebben.
  const takenSlots = new Set(slots.map((slot) => slot.slotIndex));
  const performerSlotIndexes = activeSlottedPerformers(performers).map((performer) => performer.slotIndex);
  const knownSlots = performerSlotIndexes.length
    ? performerSlotIndexes
    : Array.from({ length: MAX_PERFORMER_SLOT }, (_, index) => index + 1);
  const openSlots = [...new Set(knownSlots)].filter((slotIndex) => !takenSlots.has(slotIndex)).sort((a, b) => a - b);
  const chosenSlots = slotsForFreeCharacters({
    count: Math.min(freeCharacters.length, openSlots.length),
    openSlots,
    seed,
    recentSlotIndexes: Array.isArray(recentSlotIndexes) ? recentSlotIndexes : [],
  });
  freeCharacters.forEach((character, index) => {
    // Meer vrije personages dan vrije plekken: de rest sluit achteraan aan.
    const slotIndex = index < chosenSlots.length ? chosenSlots[index] : slots.length + 1;
    addSlot(slotIndex, null, null, character);
  });

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

function assignPerformerSlots({ characters = [], performers = [], seed = null, recentSlotIndexes = [] } = {}) {
  const performerSlots = performerSlotsForCharacters({ characters, performers, seed, recentSlotIndexes });
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
  seededRandom,
};
