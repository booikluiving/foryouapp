"use strict";

const DEFAULT_ALGORITHM_GLOBAL_PROMPT = [
  "Je bent een schrijver van ongecensureerde, humoristische sketches in dialoogvorm.",
  "Maak de scene 5 minuten lang.",
  "",
  "Je antwoord bevat uitsluitend het script, altijd volgens onderstaand format.",
  "Je mag nooit uitleg of context geven.",
  "Begin altijd met een pakkende titel (vetgedrukt), gevolgd door de dialoog tussen de opgegeven personages.",
  "",
  "Format (strikt volgen):",
  "Titel",
  "Personage: zin.",
  "Etc.",
].join("\n");

const DEFAULT_ALGORITHM_PROMPT_TEMPLATE = [
  "{globalPrompt}",
  "",
  "{characters}",
  "",
  "De personages bevinden zich in de volgende situatie: {situations}",
  "{scenePrompt}",
  "Locatie: {environmentName}",
  "Personages: {characterNames}",
  "Titel: {title}",
  "De locatie is: {environmentDescription}",
  "{audienceContext}",
].join("\n");

const DEFAULT_ALGORITHM_SETTINGS = Object.freeze({
  calibrationCount: 5,
  globalPrompt: DEFAULT_ALGORITHM_GLOBAL_PROMPT,
  promptTemplate: DEFAULT_ALGORITHM_PROMPT_TEMPLATE,
  heartWeight: 1,
  boredWeight: -1.5,
  commentWeight: 0.25,
  timeNormalizedBlend: 0,
  characterCooldownWindow: 3,
  diversityWeight: 1,
  explorationWeight: 0.5,
  retryWeight: 0.35,
  sceneRepeatPenalty: 1,
});
const ALGORITHM_ACTOR_SLOT_COUNT = 3;
const ALGORITHM_RANDOM_SLOT_VALUE = -1;

function clampInt(value, min, max, fallback) {
  const n = Number.parseInt(String(value), 10);
  if (!Number.isFinite(n)) return fallback;
  if (n < min) return min;
  if (n > max) return max;
  return n;
}

function clampFloat(value, min, max, fallback) {
  const n = Number.parseFloat(String(value));
  if (!Number.isFinite(n)) return fallback;
  if (n < min) return min;
  if (n > max) return max;
  return n;
}

function normalizeText(value, max = 2000) {
  return String(value || "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .trim()
    .slice(0, max);
}

function normalizeId(value) {
  const n = Number.parseInt(String(value), 10);
  return Number.isInteger(n) && n > 0 ? n : 0;
}

function normalizeIdList(value) {
  const raw = Array.isArray(value) ? value : [];
  const out = [];
  const seen = new Set();
  for (const item of raw) {
    const id = normalizeId(item);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

function normalizeCharacterSlots(value, fallback = []) {
  const raw = Array.isArray(value) && value.length ? value : fallback;
  const out = [];
  for (const item of raw) {
    const n = Number.parseInt(String(item), 10);
    if (n === ALGORITHM_RANDOM_SLOT_VALUE) out.push(ALGORITHM_RANDOM_SLOT_VALUE);
    else out.push(Number.isInteger(n) && n > 0 ? n : 0);
    if (out.length >= 10) break;
  }
  return out;
}

function actorCharacterSlots(slots = []) {
  const safeSlots = normalizeCharacterSlots(slots, []);
  return Array.from({ length: ALGORITHM_ACTOR_SLOT_COUNT }, (_, index) => safeSlots[index] || 0);
}

function normalizeBoolean(value, fallback = true) {
  if (value === undefined || value === null || value === "") return !!fallback;
  if (value === true || value === 1) return true;
  if (value === false || value === 0) return false;
  const key = String(value).trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(key)) return true;
  if (["0", "false", "no", "off"].includes(key)) return false;
  return !!fallback;
}

function normalizeAlgorithmSettings(input = {}) {
  const src = input && typeof input === "object" ? input : {};
  return {
    calibrationCount: clampInt(src.calibrationCount, 0, 50, DEFAULT_ALGORITHM_SETTINGS.calibrationCount),
    globalPrompt: normalizeText(src.globalPrompt, 8000) || DEFAULT_ALGORITHM_SETTINGS.globalPrompt,
    promptTemplate: normalizeText(src.promptTemplate, 8000) || DEFAULT_ALGORITHM_SETTINGS.promptTemplate,
    heartWeight: Number(clampFloat(src.heartWeight, -5, 5, DEFAULT_ALGORITHM_SETTINGS.heartWeight).toFixed(2)),
    boredWeight: Number(clampFloat(src.boredWeight, -5, 5, DEFAULT_ALGORITHM_SETTINGS.boredWeight).toFixed(2)),
    commentWeight: Number(clampFloat(src.commentWeight, -5, 5, DEFAULT_ALGORITHM_SETTINGS.commentWeight).toFixed(2)),
    timeNormalizedBlend: Number(clampFloat(src.timeNormalizedBlend, 0, 1, DEFAULT_ALGORITHM_SETTINGS.timeNormalizedBlend).toFixed(2)),
    characterCooldownWindow: clampInt(src.characterCooldownWindow, 0, 10, DEFAULT_ALGORITHM_SETTINGS.characterCooldownWindow),
    diversityWeight: Number(clampFloat(src.diversityWeight, 0, 50, DEFAULT_ALGORITHM_SETTINGS.diversityWeight).toFixed(2)),
    explorationWeight: Number(clampFloat(src.explorationWeight, 0, 20, DEFAULT_ALGORITHM_SETTINGS.explorationWeight).toFixed(2)),
    retryWeight: Number(clampFloat(src.retryWeight, 0, 10, DEFAULT_ALGORITHM_SETTINGS.retryWeight).toFixed(2)),
    sceneRepeatPenalty: Number(clampFloat(src.sceneRepeatPenalty, 0, 50, DEFAULT_ALGORITHM_SETTINGS.sceneRepeatPenalty).toFixed(2)),
  };
}

function normalizePreparedNext(input = {}) {
  const src = input && typeof input === "object" ? input : {};
  const sceneId = normalizeId(src.sceneId);
  return {
    sceneId,
    locked: !!sceneId && src.locked !== false,
    source: normalizeText(src.source, 80),
    lockedAt: normalizeText(src.lockedAt, 80),
    invalidReason: normalizeText(src.invalidReason, 160),
  };
}

function normalizeLockedQueueEntry(input = {}, fallbackPosition = 0) {
  const src = input && typeof input === "object" ? input : {};
  const sceneId = normalizeId(src.sceneId);
  const position = clampInt(src.position, 1, 100000, fallbackPosition);
  if (!sceneId || !position) return null;
  return {
    position,
    sceneId,
    source: normalizeText(src.source, 80),
    lockedAt: normalizeText(src.lockedAt, 80),
    randomSeed: normalizeText(src.randomSeed, 200),
  };
}

function normalizeLockedQueue(input = []) {
  const raw = Array.isArray(input)
    ? input
    : input && typeof input === "object" && Array.isArray(input.entries) ? input.entries : [];
  const byPosition = new Map();
  const seenSceneIds = new Set();
  raw.forEach((item, index) => {
    const entry = normalizeLockedQueueEntry(item, index + 1);
    if (!entry || seenSceneIds.has(entry.sceneId) || byPosition.has(entry.position)) return;
    seenSceneIds.add(entry.sceneId);
    byPosition.set(entry.position, entry);
  });
  return Array.from(byPosition.values()).sort((a, b) => a.position - b.position);
}

function normalizeCharacter(input = {}) {
  const src = input && typeof input === "object" ? input : {};
  return {
    id: normalizeId(src.id),
    name: normalizeText(src.name, 120),
    description: normalizeText(src.description, 1600),
    performerId: normalizeId(src.performerId),
    isActive: normalizeBoolean(src.isActive, true),
    archivedAt: normalizeText(src.archivedAt, 80),
  };
}

function normalizePerformer(input = {}) {
  const src = input && typeof input === "object" ? input : {};
  return {
    id: normalizeId(src.id),
    name: normalizeText(src.name, 120),
    sortOrder: clampInt(src.sortOrder, 0, 100000, 0),
    roleSlot: clampInt(src.roleSlot, 0, 3, 0),
    isActive: normalizeBoolean(src.isActive, true),
    archivedAt: normalizeText(src.archivedAt, 80),
  };
}

function normalizeLabel(input = {}) {
  const src = input && typeof input === "object" ? input : {};
  return {
    id: normalizeId(src.id),
    name: normalizeText(src.name, 120),
    sortOrder: clampInt(src.sortOrder, 0, 100000, 0),
    isActive: normalizeBoolean(src.isActive, true),
    archivedAt: normalizeText(src.archivedAt, 80),
  };
}

function normalizePathEdge(input = {}) {
  const src = input && typeof input === "object" ? input : {};
  const fromSceneId = normalizeId(src.fromSceneId || src.from || src.sourceSceneId || src.source);
  const toSceneId = normalizeId(src.toSceneId || src.to || src.targetSceneId || src.target);
  if (!fromSceneId || !toSceneId) return null;
  return {
    fromSceneId,
    toSceneId,
  };
}

function normalizePath(input = {}) {
  const src = input && typeof input === "object" ? input : {};
  const rawSceneIds = Array.isArray(src.sceneIds)
    ? src.sceneIds
    : Array.isArray(src.scenes)
      ? src.scenes.map((item) => item && typeof item === "object" ? item.id : item)
      : [];
  const edges = [];
  const seenEdges = new Set();
  for (const rawEdge of Array.isArray(src.edges) ? src.edges : []) {
    const edge = normalizePathEdge(rawEdge);
    if (!edge || edge.fromSceneId === edge.toSceneId) continue;
    const key = `${edge.fromSceneId}:${edge.toSceneId}`;
    if (seenEdges.has(key)) continue;
    seenEdges.add(key);
    edges.push(edge);
  }
  return {
    id: normalizeId(src.id),
    name: normalizeText(src.name, 140),
    description: normalizeText(src.description, 1800),
    sortOrder: clampInt(src.sortOrder, 0, 100000, 0),
    color: normalizeText(src.color, 40),
    sceneIds: normalizeIdList(rawSceneIds),
    edges,
    edgeMode: normalizeText(src.edgeMode, 20) === "manual" ? "manual" : "legacy",
    isActive: normalizeBoolean(src.isActive, true),
    archivedAt: normalizeText(src.archivedAt, 80),
  };
}

function activePaths(paths = []) {
  return (Array.isArray(paths) ? paths : [])
    .map(normalizePath)
    .filter((item) => item.id && item.isActive && !item.archivedAt);
}

function fallbackPathEdges(sceneIds = []) {
  const ids = normalizeIdList(sceneIds);
  const edges = [];
  for (let i = 0; i < ids.length - 1; i += 1) {
    edges.push({ fromSceneId: ids[i], toSceneId: ids[i + 1] });
  }
  return edges;
}

function effectivePathEdges(path = {}) {
  const safePath = normalizePath(path);
  if (safePath.edges.length || safePath.edgeMode === "manual") return safePath.edges;
  return fallbackPathEdges(safePath.sceneIds);
}

function activeCatalogCharacters(characters = []) {
  return (Array.isArray(characters) ? characters : [])
    .map(normalizeCharacter)
    .filter((item) => item.id && item.isActive && !item.archivedAt);
}

function activeCatalogPerformers(performers = []) {
  return (Array.isArray(performers) ? performers : [])
    .map(normalizePerformer)
    .filter((item) => item.id && item.isActive && !item.archivedAt);
}

function activeCatalogEnvironments(environments = []) {
  return (Array.isArray(environments) ? environments : [])
    .map(normalizeEnvironment)
    .filter((item) => item.id && item.isActive && !item.archivedAt);
}

function performerForActorSlot(slotNumber, performers = []) {
  const safeSlot = clampInt(slotNumber, 1, ALGORITHM_ACTOR_SLOT_COUNT, 0);
  if (!safeSlot) return null;
  return activeCatalogPerformers(performers)
    .find((item) => Number(item.roleSlot || 0) === safeSlot) || null;
}

function stableHash(input = "") {
  const text = String(input || "");
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function normalizeSceneCharacterSlotsForPerformerRoles(characterSlots = [], { characters = [], performers = [] } = {}) {
  const slots = normalizeCharacterSlots(characterSlots, []);
  if (!slots.length) return Array.from({ length: ALGORITHM_ACTOR_SLOT_COUNT }, () => 0);
  const characterById = new Map((Array.isArray(characters) ? characters : [])
    .map(normalizeCharacter)
    .filter((item) => item.id)
    .map((item) => [item.id, item]));
  const performerById = new Map((Array.isArray(performers) ? performers : [])
    .map(normalizePerformer)
    .filter((item) => item.id)
    .map((item) => [item.id, item]));
  const fixed = new Array(ALGORITHM_ACTOR_SLOT_COUNT).fill(0);
  const flexible = [];
  const overflow = [];
  let randomCount = slots.filter((id) => id === ALGORITHM_RANDOM_SLOT_VALUE).length;

  for (const id of slots) {
    if (id === ALGORITHM_RANDOM_SLOT_VALUE) continue;
    const character = id ? characterById.get(id) : null;
    const performer = character && character.performerId ? performerById.get(character.performerId) : null;
    const roleSlot = performer ? clampInt(performer.roleSlot, 0, 3, 0) : 0;
    if (id && roleSlot >= 1 && roleSlot <= 3) {
      if (fixed[roleSlot - 1] <= 0) {
        fixed[roleSlot - 1] = id;
      } else {
        overflow.push(id);
      }
      continue;
    }
    if (id > 0) flexible.push(id);
  }

  for (let index = 0; index < fixed.length && flexible.length; index += 1) {
    if (fixed[index] === 0) fixed[index] = flexible.shift();
  }
  for (let index = 0; index < fixed.length && randomCount > 0; index += 1) {
    if (fixed[index] === 0) {
      fixed[index] = ALGORITHM_RANDOM_SLOT_VALUE;
      randomCount -= 1;
    }
  }
  return fixed.concat(flexible, overflow).slice(0, 10);
}

function randomCharacterCandidatesForPerformerSlot(slotNumber, usedCharacterIds = new Set(), { characters = [], performers = [] } = {}) {
  const performer = performerForActorSlot(slotNumber, performers);
  const used = usedCharacterIds instanceof Set ? usedCharacterIds : new Set();
  const activeCharacters = activeCatalogCharacters(characters)
    .filter((item) => !used.has(Number(item.id || 0)))
    .filter((item) => {
      const performerId = Number(item.performerId || 0);
      if (!performerId) return true;
      return performer && Number(performer.id || 0) === performerId;
    });
  const performerSpecific = performer
    ? activeCharacters.filter((item) => Number(item.performerId || 0) === Number(performer.id || 0))
    : [];
  return performerSpecific.length ? performerSpecific : activeCharacters;
}

function pickRandomCharacterForPerformerSlot(slotNumber, usedCharacterIds = new Set(), catalog = {}, options = {}) {
  const candidates = randomCharacterCandidatesForPerformerSlot(slotNumber, usedCharacterIds, catalog);
  if (!candidates.length) return null;
  const seed = String(options.seed === undefined || options.seed === null ? "algorithm-random" : options.seed);
  const candidateKey = candidates.map((item) => item.id).join(",");
  const index = stableHash(`${seed}:slot:${slotNumber}:candidates:${candidateKey}`) % candidates.length;
  return candidates[index] || null;
}

function resolveRandomCharacterSlotsForPerformerRoles(characterSlots = [], catalog = {}, options = {}) {
  const normalizedSlots = normalizeSceneCharacterSlotsForPerformerRoles(characterSlots, catalog);
  const actorSlots = actorCharacterSlots(normalizedSlots);
  const usedCharacterIds = new Set(actorSlots.filter((id) => id > 0));
  const performers = activeCatalogPerformers(catalog.performers || []);
  const performerByRoleSlot = new Map(performers
    .filter((item) => item.roleSlot >= 1 && item.roleSlot <= ALGORITHM_ACTOR_SLOT_COUNT)
    .map((item) => [item.roleSlot, item]));
  const resolvedSlots = actorSlots.slice();
  const resolutions = [];
  const warnings = [];

  for (let index = 0; index < resolvedSlots.length; index += 1) {
    if (resolvedSlots[index] !== ALGORITHM_RANDOM_SLOT_VALUE) continue;
    const slotNumber = index + 1;
    const performer = performerByRoleSlot.get(slotNumber) || null;
    const character = pickRandomCharacterForPerformerSlot(slotNumber, usedCharacterIds, catalog, {
      seed: options.seed,
    });
    if (!character) {
      warnings.push(`random_character_unresolved:${slotNumber}:${performer ? performer.id : 0}`);
      resolutions.push({
        slot: slotNumber,
        performerId: performer ? performer.id : 0,
        performerName: performer ? performer.name : "",
        characterId: 0,
        characterName: "",
        unresolved: true,
      });
      continue;
    }
    resolvedSlots[index] = character.id;
    usedCharacterIds.add(character.id);
    resolutions.push({
      slot: slotNumber,
      performerId: performer ? performer.id : 0,
      performerName: performer ? performer.name : "",
      characterId: character.id,
      characterName: character.name,
      unresolved: false,
    });
  }

  return {
    characterSlots: resolvedSlots,
    characterIds: normalizeIdList(resolvedSlots.filter((id) => id > 0)),
    randomResolutions: resolutions,
    randomWarnings: warnings,
  };
}

function pickRandomEnvironment(catalog = {}, options = {}) {
  const candidates = activeCatalogEnvironments(catalog.environments || []);
  if (!candidates.length) return null;
  const seed = String(options.seed === undefined || options.seed === null ? "algorithm-random-environment" : options.seed);
  const candidateKey = candidates.map((item) => item.id).join(",");
  const index = stableHash(`${seed}:environment:candidates:${candidateKey}`) % candidates.length;
  return candidates[index] || null;
}

function resolveRandomEnvironmentForScene(scene = {}, catalog = {}, options = {}) {
  const safeScene = normalizeScene(scene);
  if (safeScene.environmentMode !== "random") {
    return { scene: safeScene, randomEnvironment: null, randomWarnings: [] };
  }
  const environment = pickRandomEnvironment(catalog, options);
  if (!environment) {
    return {
      scene: {
        ...safeScene,
        environmentMode: "selected",
        environmentId: 0,
      },
      randomEnvironment: null,
      randomWarnings: ["random_environment_unresolved"],
    };
  }
  return {
    scene: {
      ...safeScene,
      environmentMode: "selected",
      environmentId: environment.id,
    },
    randomEnvironment: {
      id: environment.id,
      name: environment.name,
      description: environment.description,
    },
    randomWarnings: [],
  };
}

function normalizeSceneForPerformerRoles(scene = {}, catalog = {}) {
  const safeScene = normalizeScene(scene);
  const characterSlots = normalizeSceneCharacterSlotsForPerformerRoles(safeScene.characterSlots, catalog);
  const playableSlots = actorCharacterSlots(characterSlots);
  return {
    ...safeScene,
    characterCount: Math.max(ALGORITHM_ACTOR_SLOT_COUNT, characterSlots.length || safeScene.characterCount || ALGORITHM_ACTOR_SLOT_COUNT),
    characterSlots,
    characterIds: normalizeIdList(playableSlots.filter((id) => id > 0)),
  };
}

function normalizeSituation(input = {}) {
  const src = input && typeof input === "object" ? input : {};
  return {
    id: normalizeId(src.id),
    name: normalizeText(src.name, 140),
    description: normalizeText(src.description, 1800),
    requiredCharacterIds: normalizeIdList(src.requiredCharacterIds),
    allowedCharacterIds: normalizeIdList(src.allowedCharacterIds),
    isActive: normalizeBoolean(src.isActive, true),
    archivedAt: normalizeText(src.archivedAt, 80),
  };
}

function normalizeEnvironment(input = {}) {
  const src = input && typeof input === "object" ? input : {};
  return {
    id: normalizeId(src.id),
    name: normalizeText(src.name, 140),
    description: normalizeText(src.description, 1800),
    isActive: normalizeBoolean(src.isActive, true),
    archivedAt: normalizeText(src.archivedAt, 80),
  };
}

function normalizeScene(input = {}) {
  const src = input && typeof input === "object" ? input : {};
  const characterIds = normalizeIdList(Array.isArray(src.characterIds) && src.characterIds.length ? src.characterIds : src.characterSlots);
  const hasCharacterSlotInput = Array.isArray(src.characterSlots) && src.characterSlots.length > 0;
  const hasCharacterCountInput = src.characterCount !== undefined && src.characterCount !== null && src.characterCount !== "";
  const characterSlots = hasCharacterSlotInput ? normalizeCharacterSlots(src.characterSlots, []) : normalizeCharacterSlots([], characterIds);
  const characterCount = clampInt(src.characterCount, ALGORITHM_ACTOR_SLOT_COUNT, 10, Math.max(ALGORITHM_ACTOR_SLOT_COUNT, characterSlots.length || characterIds.length || ALGORITHM_ACTOR_SLOT_COUNT));
  const shouldPadCharacterSlots = hasCharacterSlotInput || hasCharacterCountInput || characterIds.length > 0;
  const paddedCharacterSlots = shouldPadCharacterSlots
    ? Array.from({ length: characterCount }, (_, index) => characterSlots[index] || 0)
    : Array.from({ length: ALGORITHM_ACTOR_SLOT_COUNT }, () => 0);
  const environmentMode = String(src.environmentMode || "").trim().toLowerCase() === "random" ? "random" : "selected";
  return {
    id: normalizeId(src.id),
    title: normalizeText(src.title, 180),
    sortOrder: clampInt(src.sortOrder, 0, 100000, 0),
    characterCount,
    characterSlots: paddedCharacterSlots,
    characterIds,
    situationIds: normalizeIdList(src.situationIds),
    labelIds: normalizeIdList(src.labelIds),
    environmentId: normalizeId(src.environmentId),
    environmentMode,
    contextSceneId: normalizeId(src.contextSceneId),
    promptOverride: normalizeText(src.promptOverride, 4000),
    isActive: normalizeBoolean(src.isActive, true),
    archivedAt: normalizeText(src.archivedAt, 80),
  };
}

function normalizeRun(input = {}) {
  const src = input && typeof input === "object" ? input : {};
  return {
    id: normalizeId(src.id),
    sessionId: normalizeId(src.sessionId),
    sceneId: normalizeId(src.sceneId),
    runOrder: clampInt(src.runOrder, 0, 100000, 0),
    selectionSource: normalizeText(src.selectionSource, 80) || "manual",
    startedAt: normalizeText(src.startedAt, 80),
    endedAt: normalizeText(src.endedAt, 80),
    heartCount: Math.max(0, Number(src.heartCount || 0)),
    boredCount: Math.max(0, Number(src.boredCount || 0)),
    commentCount: Math.max(0, Number(src.commentCount || 0)),
    score: Number.isFinite(Number(src.score)) ? Number(src.score) : null,
    promptSnapshot: normalizeText(src.promptSnapshot, 12000),
    reason: normalizeText(src.reason, 1000),
  };
}

function parseTimeMs(value) {
  const ts = Date.parse(String(value || ""));
  return Number.isFinite(ts) ? ts : 0;
}

function calculateRunDurationSeconds(run = {}, options = {}) {
  const src = normalizeRun(run);
  const started = parseTimeMs(src.startedAt);
  if (!started) return 0;
  const ended = parseTimeMs(src.endedAt);
  const now = parseTimeMs(options.now) || Date.now();
  const end = ended || now;
  return Math.max(0, Math.round((end - started) / 1000));
}

function calculateRunScoreDetails(run = {}, settings = {}, options = {}) {
  const src = normalizeRun(run);
  const safeSettings = normalizeAlgorithmSettings(settings);
  const rawScore = (
    (src.heartCount * safeSettings.heartWeight)
    + (src.boredCount * safeSettings.boredWeight)
    + (src.commentCount * safeSettings.commentWeight)
  );
  const durationSeconds = calculateRunDurationSeconds(src, options);
  const perMinuteScore = durationSeconds > 0 ? (rawScore / Math.max(durationSeconds, 1)) * 60 : rawScore;
  const blend = safeSettings.timeNormalizedBlend;
  const score = (rawScore * (1 - blend)) + (perMinuteScore * blend);
  return {
    score: Number(score.toFixed(2)),
    rawScore: Number(rawScore.toFixed(2)),
    perMinuteScore: Number(perMinuteScore.toFixed(2)),
    durationSeconds,
    timeNormalizedBlend: blend,
  };
}

function calculateRunScore(run = {}, settings = {}, options = {}) {
  return calculateRunScoreDetails(run, settings, options).score;
}

function sortScenes(scenes = []) {
  return scenes
    .map(normalizeScene)
    .filter((scene) => scene.id > 0)
    .sort((a, b) => {
      const byOrder = Number(a.sortOrder || 0) - Number(b.sortOrder || 0);
      if (byOrder !== 0) return byOrder;
      return Number(a.id || 0) - Number(b.id || 0);
    });
}

function activeScenes(scenes = []) {
  return sortScenes(scenes).filter((scene) => scene.isActive && !scene.archivedAt);
}

function average(values) {
  const filtered = values.map(Number).filter((value) => Number.isFinite(value));
  if (!filtered.length) return 0;
  return filtered.reduce((sum, value) => sum + value, 0) / filtered.length;
}

function pushScore(map, id, score) {
  const safeId = normalizeId(id);
  const n = Number(score);
  if (!safeId || !Number.isFinite(n)) return;
  const prev = map.get(safeId) || { id: safeId, total: 0, count: 0, average: 0 };
  prev.total += n;
  prev.count += 1;
  prev.average = prev.total / prev.count;
  map.set(safeId, prev);
}

function computeEntityScores({ scenes = [], runs = [], settings = {} } = {}) {
  const safeSettings = normalizeAlgorithmSettings(settings);
  const sceneById = new Map(sortScenes(scenes).map((scene) => [scene.id, scene]));
  const characters = new Map();
  const situations = new Map();
  const labels = new Map();
  const environments = new Map();
  const sceneScores = new Map();

  for (const rawRun of Array.isArray(runs) ? runs : []) {
    const run = normalizeRun(rawRun);
    if (!run.endedAt) continue;
    const scene = sceneById.get(run.sceneId);
    if (!scene) continue;
    const score = calculateRunScore(run, safeSettings);
    pushScore(sceneScores, scene.id, score);
    for (const id of scene.characterIds) pushScore(characters, id, score);
    for (const id of scene.situationIds) pushScore(situations, id, score);
    for (const id of scene.labelIds) pushScore(labels, id, score);
    if (scene.environmentId) pushScore(environments, scene.environmentId, score);
  }

  const toSnapshot = (map) => Array.from(map.values())
    .map((item) => ({
      id: item.id,
      total: Number(item.total.toFixed(2)),
      count: item.count,
      average: Number(item.average.toFixed(2)),
    }))
    .sort((a, b) => {
      const byAverage = Number(b.average || 0) - Number(a.average || 0);
      if (byAverage !== 0) return byAverage;
      return Number(a.id || 0) - Number(b.id || 0);
    });

  return {
    characters: toSnapshot(characters),
    situations: toSnapshot(situations),
    labels: toSnapshot(labels),
    environments: toSnapshot(environments),
    scenes: toSnapshot(sceneScores),
  };
}

function scoreLookup(items = []) {
  return new Map(items.map((item) => [normalizeId(item.id), Number(item.average || 0)]));
}

function validateAlgorithmPath(path = {}, { scenes = [] } = {}) {
  const safePath = normalizePath(path);
  const activeSceneById = new Map((Array.isArray(scenes) ? scenes : [])
    .map(normalizeScene)
    .filter((scene) => scene.id && scene.isActive && !scene.archivedAt)
    .map((scene) => [scene.id, scene]));
  const sceneIdSet = new Set(safePath.sceneIds);
  const issues = [];
  if (!safePath.name) issues.push("name_required");
  if (!safePath.sceneIds.length) issues.push("path_scenes_required");
  for (const sceneId of safePath.sceneIds) {
    if (!activeSceneById.has(sceneId)) issues.push(`path_scene_inactive:${sceneId}`);
  }
  const pathEdges = effectivePathEdges(safePath);
  const incomingSceneIds = new Set();
  const connectedSceneIds = new Set();
  const incomingCounts = new Map();
  const edgeKeys = new Set();
  const outgoing = new Map();
  for (const edge of pathEdges) {
    const key = `${edge.fromSceneId}:${edge.toSceneId}`;
    if (edgeKeys.has(key)) {
      issues.push(`path_edge_duplicate:${key}`);
      continue;
    }
    edgeKeys.add(key);
    if (edge.fromSceneId === edge.toSceneId) issues.push(`path_edge_self:${edge.fromSceneId}`);
    if (!sceneIdSet.has(edge.fromSceneId)) issues.push(`path_edge_scene_missing:${edge.fromSceneId}`);
    if (!sceneIdSet.has(edge.toSceneId)) issues.push(`path_edge_scene_missing:${edge.toSceneId}`);
    if (!activeSceneById.has(edge.fromSceneId)) issues.push(`path_edge_scene_inactive:${edge.fromSceneId}`);
    if (!activeSceneById.has(edge.toSceneId)) issues.push(`path_edge_scene_inactive:${edge.toSceneId}`);
    if (!outgoing.has(edge.fromSceneId)) outgoing.set(edge.fromSceneId, []);
    outgoing.get(edge.fromSceneId).push(edge.toSceneId);
    if (sceneIdSet.has(edge.fromSceneId) && sceneIdSet.has(edge.toSceneId)) {
      connectedSceneIds.add(edge.fromSceneId);
      connectedSceneIds.add(edge.toSceneId);
      incomingSceneIds.add(edge.toSceneId);
      const incomingCount = (incomingCounts.get(edge.toSceneId) || 0) + 1;
      incomingCounts.set(edge.toSceneId, incomingCount);
      if (incomingCount > 1) issues.push(`path_edge_multiple_incoming:${edge.toSceneId}`);
    }
  }
  if (pathEdges.length) {
    const startIds = safePath.sceneIds.filter((sceneId) => connectedSceneIds.has(sceneId) && !incomingSceneIds.has(sceneId));
    if (startIds.length !== 1) issues.push(`path_single_start_required:${startIds.length}`);
  }

  const visiting = new Set();
  const visited = new Set();
  const visit = (sceneId) => {
    if (visiting.has(sceneId)) {
      issues.push(`path_cycle:${sceneId}`);
      return;
    }
    if (visited.has(sceneId)) return;
    visiting.add(sceneId);
    for (const nextId of outgoing.get(sceneId) || []) visit(nextId);
    visiting.delete(sceneId);
    visited.add(sceneId);
  };
  for (const sceneId of safePath.sceneIds) visit(sceneId);

  return {
    ok: issues.length === 0,
    issues,
    path: safePath,
  };
}

function buildPathSceneStatuses(paths = [], sceneById = new Map(), played = new Set()) {
  const active = activePaths(paths);
  const statusBySceneId = new Map();
  const ensureStatus = (sceneId) => {
    const safeId = normalizeId(sceneId);
    if (!safeId) return null;
    const existing = statusBySceneId.get(safeId);
    if (existing) return existing;
    const created = {
      sceneId: safeId,
      pathIds: [],
      pathNames: [],
      predecessorIds: [],
      successorIds: [],
      missingPredecessorIds: [],
      completedPredecessorIds: [],
      pathDetails: [],
      isPathStart: false,
      isPathEnd: false,
      isSplit: false,
      isMerge: false,
      ready: true,
    };
    statusBySceneId.set(safeId, created);
    return created;
  };

  for (const path of active) {
    const validation = validateAlgorithmPath(path, { scenes: Array.from(sceneById.values()) });
    if (!validation.ok) continue;
    const sceneIds = path.sceneIds.filter((sceneId) => sceneById.has(sceneId));
    const sceneIdSet = new Set(sceneIds);
    const incomingBySceneId = new Map(sceneIds.map((sceneId) => [sceneId, []]));
    const outgoingBySceneId = new Map(sceneIds.map((sceneId) => [sceneId, []]));
    for (const edge of effectivePathEdges(path)) {
      if (!sceneIdSet.has(edge.fromSceneId) || !sceneIdSet.has(edge.toSceneId)) continue;
      incomingBySceneId.get(edge.toSceneId).push(edge.fromSceneId);
      outgoingBySceneId.get(edge.fromSceneId).push(edge.toSceneId);
    }
    for (const sceneId of sceneIds) {
      const status = ensureStatus(sceneId);
      if (!status) continue;
      const incoming = Array.from(new Set(incomingBySceneId.get(sceneId) || []));
      const outgoing = Array.from(new Set(outgoingBySceneId.get(sceneId) || []));
      status.pathIds.push(path.id);
      status.pathNames.push(path.name || `Pad ${path.id}`);
      status.pathDetails.push({
        pathId: path.id,
        pathName: path.name || `Pad ${path.id}`,
        color: path.color || "",
        predecessorIds: incoming,
        successorIds: outgoing,
        isStart: incoming.length === 0,
        isEnd: outgoing.length === 0,
        isSplit: outgoing.length > 1,
        isMerge: incoming.length > 1,
      });
      for (const predecessorId of incoming) {
        if (!status.predecessorIds.includes(predecessorId)) status.predecessorIds.push(predecessorId);
      }
      for (const successorId of outgoing) {
        if (!status.successorIds.includes(successorId)) status.successorIds.push(successorId);
      }
    }
  }

  for (const status of statusBySceneId.values()) {
    status.completedPredecessorIds = status.predecessorIds.filter((sceneId) => played.has(sceneId));
    status.missingPredecessorIds = status.predecessorIds.filter((sceneId) => !played.has(sceneId));
    status.isPathStart = status.pathDetails.some((detail) => detail.isStart);
    status.isPathEnd = status.pathDetails.some((detail) => detail.isEnd);
    status.isSplit = status.successorIds.length > 1 || status.pathDetails.some((detail) => detail.isSplit);
    status.isMerge = status.predecessorIds.length > 1 || status.pathDetails.some((detail) => detail.isMerge);
    status.ready = status.missingPredecessorIds.length === 0;
  }

  return statusBySceneId;
}

function sceneConcreteCharacterIds(scene = {}) {
  const safeScene = normalizeScene(scene);
  return normalizeIdList([]
    .concat(safeScene.characterIds || [])
    .concat(Array.isArray(safeScene.characterSlots) ? safeScene.characterSlots.filter((id) => Number(id || 0) > 0) : []));
}

function buildRunCountStats({ scenes = [], runs = [] } = {}) {
  const sceneById = new Map(sortScenes(scenes).map((scene) => [scene.id, scene]));
  const sceneRunCounts = new Map();
  const characterRunCounts = new Map();
  for (const run of sortRunsByOrder(runs).filter((item) => item.endedAt)) {
    const scene = sceneById.get(run.sceneId);
    if (!scene) continue;
    sceneRunCounts.set(scene.id, Number(sceneRunCounts.get(scene.id) || 0) + 1);
    for (const characterId of sceneConcreteCharacterIds(scene)) {
      characterRunCounts.set(characterId, Number(characterRunCounts.get(characterId) || 0) + 1);
    }
  }
  return { sceneRunCounts, characterRunCounts };
}

function buildRecentCharacterWeights({ scenes = [], runs = [], settings = {} } = {}) {
  const safeSettings = normalizeAlgorithmSettings(settings);
  const windowSize = Math.max(0, Number(safeSettings.characterCooldownWindow || 0));
  const weights = new Map();
  if (!windowSize) return weights;
  const sceneById = new Map(sortScenes(scenes).map((scene) => [scene.id, scene]));
  const orderedRuns = sortRunsByOrder(runs);
  const activeRun = orderedRuns.filter((run) => !run.endedAt).pop() || null;
  const recentCompleted = orderedRuns
    .filter((run) => run.endedAt)
    .slice()
    .reverse()
    .slice(0, windowSize);
  const weightedRuns = [];
  if (activeRun) weightedRuns.push({ run: activeRun, weight: 1 });
  recentCompleted.forEach((run, index) => {
    weightedRuns.push({ run, weight: (windowSize - index) / windowSize });
  });
  for (const item of weightedRuns) {
    const scene = sceneById.get(item.run.sceneId);
    if (!scene) continue;
    for (const characterId of sceneConcreteCharacterIds(scene)) {
      const previous = Number(weights.get(characterId) || 0);
      weights.set(characterId, Math.max(previous, item.weight));
    }
  }
  return weights;
}

function formatAlgorithmReason({ played = false, recencyPenalty = 0, explorationBonus = 0, retryBonus = 0 } = {}) {
  if (recencyPenalty > 0) return "Past bij publieksvoorkeuren, maar recente personages worden bewust afgewisseld.";
  if (explorationBonus > 0.2) return played ? "Krijgt opnieuw ruimte om zich te bewijzen." : "Nog weinig getest en past bij publieksvoorkeuren.";
  if (retryBonus > 0) return "Eerder laag gescoord, maar krijgt een herkansing.";
  return played
    ? "Past bij publieksvoorkeuren uit eerdere situaties."
    : "Nog niet gespeeld en past bij publieksvoorkeuren.";
}

function pickNextInFixedOrder({ scenes = [], runs = [], excludeSceneId = 0 } = {}) {
  const available = activeScenes(scenes);
  if (!available.length) return null;
  const completed = (Array.isArray(runs) ? runs : []).map(normalizeRun).filter((run) => run.endedAt);
  const lastRun = completed.slice().sort((a, b) => {
    const byOrder = Number(a.runOrder || 0) - Number(b.runOrder || 0);
    if (byOrder !== 0) return byOrder;
    return Number(a.id || 0) - Number(b.id || 0);
  }).pop() || null;
  const played = new Set(completed.map((run) => run.sceneId).filter(Boolean));
  const unplayed = available.filter((scene) => !played.has(scene.id) && scene.id !== excludeSceneId);
  if (unplayed.length) return unplayed[0];
  if (!lastRun) return available.find((scene) => scene.id !== excludeSceneId) || available[0];
  const index = available.findIndex((scene) => scene.id === lastRun.sceneId);
  for (let offset = 1; offset <= available.length; offset += 1) {
    const candidate = available[(Math.max(0, index) + offset) % available.length];
    if (candidate && candidate.id !== excludeSceneId) return candidate;
  }
  return available[0];
}

function sortRunsByOrder(runs = []) {
  return (Array.isArray(runs) ? runs : [])
    .map(normalizeRun)
    .sort((a, b) => {
      const byOrder = Number(a.runOrder || 0) - Number(b.runOrder || 0);
      if (byOrder !== 0) return byOrder;
      return Number(a.id || 0) - Number(b.id || 0);
    });
}

function buildOrderEntry(scene, options = {}) {
  const safeScene = normalizeScene(scene || {});
  const rawBreakdown = options.scoreBreakdown && typeof options.scoreBreakdown === "object" ? options.scoreBreakdown : null;
  const rawFinalScore = rawBreakdown && Number.isFinite(Number(rawBreakdown.finalScore))
    ? Number(rawBreakdown.finalScore)
    : Number(options.score || 0);
  const rawPathStatus = options.pathStatus && typeof options.pathStatus === "object" ? options.pathStatus : null;
  const pathStatus = rawPathStatus ? {
    sceneId: normalizeId(rawPathStatus.sceneId || safeScene.id),
    pathIds: normalizeIdList(rawPathStatus.pathIds),
    pathNames: (Array.isArray(rawPathStatus.pathNames) ? rawPathStatus.pathNames : [])
      .map((item) => normalizeText(item, 140))
      .filter(Boolean),
    predecessorIds: normalizeIdList(rawPathStatus.predecessorIds),
    successorIds: normalizeIdList(rawPathStatus.successorIds),
    missingPredecessorIds: normalizeIdList(rawPathStatus.missingPredecessorIds),
    completedPredecessorIds: normalizeIdList(rawPathStatus.completedPredecessorIds),
    isPathStart: !!rawPathStatus.isPathStart,
    isPathEnd: !!rawPathStatus.isPathEnd,
    isSplit: !!rawPathStatus.isSplit,
    isMerge: !!rawPathStatus.isMerge,
    ready: rawPathStatus.ready !== false,
  } : null;
  return {
    scene: safeScene,
    sceneId: safeScene.id,
    title: safeScene.title,
    sortOrder: Number(safeScene.sortOrder || 0),
    rank: clampInt(options.rank, 0, 100000, 0),
    score: Number.isFinite(Number(options.score)) ? Number(Number(options.score).toFixed(2)) : 0,
    reason: normalizeText(options.reason, 1000),
    calibration: !!options.calibration,
    played: !!options.played,
    active: !!options.active,
    next: !!options.next,
    locked: !!options.locked,
    lockedNext: !!options.lockedNext,
    lockedFuture: !!options.lockedFuture,
    hidden: !!options.hidden,
    invalid: !!options.invalid,
    blocked: !!options.blocked,
    playedPosition: clampInt(options.playedPosition, 0, 100000, 0),
    queuePosition: clampInt(options.queuePosition, 0, 100000, 0),
    randomSeed: normalizeText(options.randomSeed, 200),
    lockSource: normalizeText(options.lockSource || options.source, 80),
    lockedAt: normalizeText(options.lockedAt, 80),
    contextSceneId: normalizeId(options.contextSceneId || safeScene.contextSceneId),
    pathStatus,
    issues: Array.isArray(options.issues) ? options.issues.map((issue) => String(issue || "")) : [],
    warnings: Array.isArray(options.warnings) ? options.warnings.map((warning) => String(warning || "")) : [],
    scoreBreakdown: rawBreakdown ? {
      baseScore: Number(Number(rawBreakdown.baseScore || 0).toFixed(2)),
      recencyPenalty: Number(Number(rawBreakdown.recencyPenalty || 0).toFixed(2)),
      explorationBonus: Number(Number(rawBreakdown.explorationBonus || 0).toFixed(2)),
      retryBonus: Number(Number(rawBreakdown.retryBonus || 0).toFixed(2)),
      sceneRepeatPenalty: Number(Number(rawBreakdown.sceneRepeatPenalty || 0).toFixed(2)),
      finalScore: Number(rawFinalScore.toFixed(2)),
    } : null,
  };
}

function rankAlgorithmScenes({ candidateScenes = [], playableScenes = [], runs = [], played = new Set(), settings = {} } = {}) {
  const safeSettings = normalizeAlgorithmSettings(settings);
  const orderedRuns = sortRunsByOrder(runs);
  const completed = orderedRuns.filter((run) => run.endedAt);
  const entityScores = computeEntityScores({ scenes: playableScenes, runs: completed, settings });
  const characterScores = scoreLookup(entityScores.characters);
  const situationScores = scoreLookup(entityScores.situations);
  const labelScores = scoreLookup(entityScores.labels);
  const environmentScores = scoreLookup(entityScores.environments);
  const sceneHistoryScores = scoreLookup(entityScores.scenes);
  const recentCharacterWeights = buildRecentCharacterWeights({ scenes: playableScenes, runs: orderedRuns, settings: safeSettings });
  const { sceneRunCounts, characterRunCounts } = buildRunCountStats({ scenes: playableScenes, runs: completed });

  const entries = (Array.isArray(candidateScenes) ? candidateScenes : []).map((scene) => {
    const characterIds = sceneConcreteCharacterIds(scene);
    const parts = [];
    for (const id of characterIds) parts.push(characterScores.get(id));
    for (const id of scene.situationIds) parts.push(situationScores.get(id));
    for (const id of scene.labelIds) parts.push(labelScores.get(id));
    if (scene.environmentId) parts.push(environmentScores.get(scene.environmentId));
    const entityAverage = average(parts);
    const history = sceneHistoryScores.get(scene.id);
    const baseScore = average([entityAverage, history]);
    const recencyOverlap = characterIds.reduce((sum, id) => sum + Number(recentCharacterWeights.get(id) || 0), 0);
    const recencyPenalty = recencyOverlap * safeSettings.diversityWeight;
    const sceneRunCount = Number(sceneRunCounts.get(scene.id) || 0);
    const sceneExploration = 1 / (1 + sceneRunCount);
    const characterExplorationValues = characterIds.map((id) => 1 / (1 + Number(characterRunCounts.get(id) || 0)));
    const explorationBase = characterExplorationValues.length
      ? average([sceneExploration, average(characterExplorationValues)])
      : sceneExploration;
    const explorationBonus = safeSettings.explorationWeight * explorationBase;
    const retryBonus = sceneRunCount > 0 && Number(history || 0) <= 0
      ? safeSettings.retryWeight / (1 + sceneRunCount)
      : 0;
    const repeatPenalty = played.has(scene.id) ? safeSettings.sceneRepeatPenalty : 0;
    const score = Number((baseScore - recencyPenalty - repeatPenalty + explorationBonus + retryBonus).toFixed(2));
    const scoreBreakdown = {
      baseScore,
      recencyPenalty,
      explorationBonus,
      retryBonus,
      sceneRepeatPenalty: repeatPenalty,
      finalScore: score,
    };
    const reason = formatAlgorithmReason({
      played: played.has(scene.id),
      recencyPenalty,
      explorationBonus,
      retryBonus,
    });
    return buildOrderEntry(scene, {
      score,
      scoreBreakdown,
      reason,
      played: played.has(scene.id),
    });
  }).sort((a, b) => {
    const byScore = Number(b.score || 0) - Number(a.score || 0);
    if (byScore !== 0) return byScore;
    return Number(a.sortOrder || 0) - Number(b.sortOrder || 0);
  });

  return { entries, entityScores };
}

function enforceContextOrder(entries = []) {
  const source = (Array.isArray(entries) ? entries : []).filter((entry) => entry && entry.sceneId);
  const entryById = new Map(source.map((entry) => [Number(entry.sceneId || 0), entry]));
  const pending = source.slice();
  const output = [];
  const outputIds = new Set();

  while (pending.length) {
    let moved = false;
    for (let index = 0; index < pending.length;) {
      const entry = pending[index];
      const contextSceneId = normalizeId(entry.contextSceneId || (entry.scene && entry.scene.contextSceneId));
      if (!contextSceneId || !entryById.has(contextSceneId) || outputIds.has(contextSceneId)) {
        output.push(entry);
        outputIds.add(Number(entry.sceneId || 0));
        pending.splice(index, 1);
        moved = true;
        continue;
      }
      index += 1;
    }
    if (!moved) {
      output.push(...pending);
      break;
    }
  }

  return output;
}

function buildAlgorithmOrder({ scenes = [], runs = [], settings = {}, catalog = null, preparedNext = null, lockedQueue = [] } = {}) {
  const safeSettings = normalizeAlgorithmSettings(settings);
  const requestedPreparedNext = normalizePreparedNext(preparedNext);
  const requestedLockedQueue = normalizeLockedQueue(lockedQueue);
  const available = activeScenes(scenes);
  const validationCatalog = catalog && typeof catalog === "object" ? catalog : null;
  let pathStatusBySceneId = new Map();
  const pathStatusForScene = (scene) => pathStatusBySceneId.get(normalizeId(scene && scene.id)) || null;
  const warningsForScene = (scene) => validationCatalog ? buildSceneWarnings(scene, validationCatalog) : [];
  const buildEntry = (scene, options = {}) => buildOrderEntry(scene, {
    warnings: warningsForScene(scene),
    pathStatus: pathStatusForScene(scene),
    ...options,
  });
  const initiallyPlayableScenes = [];
  const invalid = [];

  for (const scene of available) {
    const validation = validationCatalog ? validateSceneLinks(scene, validationCatalog) : { ok: true, issues: [] };
    if (validation.ok) {
      initiallyPlayableScenes.push(scene);
    } else {
      invalid.push(buildEntry(scene, {
        invalid: true,
        issues: validation.issues,
        reason: "Niet speelbaar door non-actieve of ontbrekende koppelingen.",
      }));
    }
  }

  const invalidSceneIds = new Set(invalid.map((entry) => entry.sceneId));
  const playableScenes = [];
  for (const scene of initiallyPlayableScenes) {
    if (scene.contextSceneId && invalidSceneIds.has(scene.contextSceneId)) {
      invalid.push(buildEntry(scene, {
        invalid: true,
        issues: [`context_scene_invalid:${scene.contextSceneId}`],
        reason: "Niet speelbaar omdat de contextsituatie zelf een waarschuwing heeft.",
      }));
    } else {
      playableScenes.push(scene);
    }
  }

  const normalizedRuns = sortRunsByOrder(runs);
  const completed = normalizedRuns.filter((run) => run.endedAt);
  const activeRun = normalizedRuns.filter((run) => !run.endedAt).pop() || null;
  const activeSceneId = activeRun ? activeRun.sceneId : 0;
  const lastRun = completed[completed.length - 1] || null;
  const lastSceneId = lastRun ? lastRun.sceneId : 0;
  const played = new Set(completed.map((run) => run.sceneId).filter(Boolean));
  const playableById = new Map(playableScenes.map((scene) => [scene.id, scene]));
  pathStatusBySceneId = buildPathSceneStatuses(
    validationCatalog && Array.isArray(validationCatalog.paths) ? validationCatalog.paths : [],
    playableById,
    played
  );
  const contextBlockForScene = (scene) => {
    const contextSceneId = normalizeId(scene && scene.contextSceneId);
    if (!contextSceneId || played.has(contextSceneId)) return null;
    const contextScene = playableById.get(contextSceneId) || null;
    return {
      contextSceneId,
      contextScene,
      reason: contextScene
        ? `Speel eerst: ${contextScene.title}.`
        : `Speel eerst contextsituatie #${contextSceneId}.`,
    };
  };
  const isContextReady = (scene) => !contextBlockForScene(scene);
  const pathBlockForScene = (scene) => {
    const status = pathStatusForScene(scene);
    if (!status || status.ready) return null;
    const missing = normalizeIdList(status.missingPredecessorIds);
    const missingTitles = missing
      .map((sceneId) => playableById.get(sceneId))
      .filter(Boolean)
      .map((item) => item.title)
      .filter(Boolean);
    return {
      pathStatus: status,
      missingPredecessorIds: missing,
      reason: status.isMerge
        ? `Wacht op alle voorgangers in dit pad: ${missingTitles.join(", ") || missing.map((id) => "#" + id).join(", ")}.`
        : `Wacht op voorganger in dit pad: ${missingTitles.join(", ") || missing.map((id) => "#" + id).join(", ")}.`,
    };
  };
  const isPathReady = (scene) => !pathBlockForScene(scene);
  const isSceneReady = (scene) => isContextReady(scene) && isPathReady(scene);
  const findFirstReadyContextScene = (scene) => {
    let current = scene;
    const seen = new Set();
    while (current && current.contextSceneId && !played.has(current.contextSceneId)) {
      const contextScene = playableById.get(current.contextSceneId) || null;
      if (!contextScene || seen.has(contextScene.id)) return null;
      seen.add(contextScene.id);
      if (contextScene.id === activeSceneId) return null;
      if (isContextReady(contextScene)) return contextScene;
      current = contextScene;
    }
    return null;
  };
  const findFirstReadyPathPredecessor = (scene) => {
    const block = pathBlockForScene(scene);
    if (!block) return null;
    for (const predecessorId of block.missingPredecessorIds || []) {
      const predecessor = playableById.get(predecessorId) || null;
      if (!predecessor || predecessor.id === activeSceneId) continue;
      if (isSceneReady(predecessor)) return predecessor;
    }
    return null;
  };
  const lockedQueueEntryBySceneId = new Map(requestedLockedQueue.map((entry) => [entry.sceneId, entry]));
  const lockedSceneIds = new Set(requestedLockedQueue.map((entry) => entry.sceneId));
  const isContextReadyForLockedEntry = (scene, queuePosition = 0) => {
    const contextSceneId = normalizeId(scene && scene.contextSceneId);
    if (!contextSceneId || played.has(contextSceneId) || contextSceneId === activeSceneId) return true;
    const contextLock = lockedQueueEntryBySceneId.get(contextSceneId) || null;
    return !!(contextLock && Number(contextLock.position || 0) < Number(queuePosition || 0));
  };
  const isPathReadyForLockedEntry = (scene) => isPathReady(scene);
  const calibrationTotal = Math.min(Math.max(0, safeSettings.calibrationCount), playableScenes.length);
  const calibrationScenes = calibrationTotal ? playableScenes.slice(0, calibrationTotal) : [];
  const calibrationIds = new Set(calibrationScenes.map((scene) => scene.id));
  const completedCalibrationIds = new Set(
    completed
      .map((run) => run.sceneId)
      .filter((sceneId) => calibrationIds.has(sceneId))
  );
  const calibration = {
    active: calibrationTotal > 0 && completedCalibrationIds.size < calibrationTotal,
    completed: Math.min(completedCalibrationIds.size, calibrationTotal),
    total: calibrationTotal,
    requestedTotal: safeSettings.calibrationCount,
  };

  const baseEntityScores = computeEntityScores({ scenes: playableScenes, runs: completed, settings: safeSettings });
  if (!playableScenes.length) {
    const rows = invalid.map((entry, index) => ({
      ...entry,
      rank: index + 1,
      played: played.has(entry.sceneId),
      active: activeSceneId === entry.sceneId,
      next: false,
      hidden: false,
    }));
    const active = rows.find((entry) => entry.active) || null;
    return {
      calibration,
      calibrationScenes: [],
      upcoming: [],
      hiddenPlayed: [],
      invalid,
      blockedContext: [],
      blockedPath: [],
      rows,
      queueRows: rows.map((entry, index) => ({ ...entry, queuePosition: index + 1 })),
      lockedQueue: requestedLockedQueue,
      active,
      next: null,
      lockedNextSceneId: 0,
      preparedNext: requestedPreparedNext.sceneId
        ? { ...requestedPreparedNext, locked: false, invalidReason: "no_playable_scenes" }
        : { sceneId: 0, locked: false, source: "", lockedAt: "", invalidReason: "" },
      entityScores: baseEntityScores,
      playableCount: 0,
      activeSceneId,
      lastSceneId,
      cycleComplete: false,
    };
  }

  const buildBlockedContextEntry = (scene, options = {}) => {
    const block = contextBlockForScene(scene);
    return buildEntry(scene, {
      blocked: true,
      played: played.has(scene.id),
      active: activeSceneId === scene.id,
      issues: [],
      reason: block ? block.reason : "Wacht op contextsituatie.",
      ...options,
    });
  };
  const buildBlockedPathEntry = (scene, options = {}) => {
    const block = pathBlockForScene(scene);
    return buildEntry(scene, {
      blocked: true,
      played: played.has(scene.id),
      active: activeSceneId === scene.id,
      issues: [],
      reason: block ? block.reason : "Wacht op voorgangers in pad.",
      ...options,
    });
  };

  const calibrationEntries = calibrationScenes.map((scene, index) => {
    const block = contextBlockForScene(scene);
    return buildEntry(scene, {
      calibration: true,
      played: played.has(scene.id),
      active: activeSceneId === scene.id,
      blocked: !!block,
      issues: [],
      reason: block
        ? block.reason
        : played.has(scene.id)
          ? "Calibratiesituatie gespeeld."
          : activeSceneId === scene.id ? "Calibratiesituatie is nu actief." : "Vaste calibratievolgorde.",
      rank: index + 1,
    });
  });

  let upcoming = [];
  let entityScores = baseEntityScores;
  let next = null;
  const blockedContext = playableScenes
    .filter((scene) => scene.id !== activeSceneId)
    .filter((scene) => !played.has(scene.id))
    .filter((scene) => !!contextBlockForScene(scene))
    .map((scene) => buildBlockedContextEntry(scene));
  const blockedPath = playableScenes
    .filter((scene) => scene.id !== activeSceneId)
    .filter((scene) => !played.has(scene.id))
    .filter((scene) => !!pathBlockForScene(scene))
    .map((scene) => buildBlockedPathEntry(scene));

  if (calibration.active) {
    const nextCalibrationScene = calibrationScenes.find((scene) => (
      !completedCalibrationIds.has(scene.id) && scene.id !== activeSceneId
    )) || null;
    if (nextCalibrationScene) {
      const contextScene = contextBlockForScene(nextCalibrationScene)
        ? findFirstReadyContextScene(nextCalibrationScene)
        : null;
      const pathScene = !contextScene && pathBlockForScene(nextCalibrationScene)
        ? findFirstReadyPathPredecessor(nextCalibrationScene)
        : null;
      next = contextScene ? buildEntry(contextScene, {
        score: 0,
        reason: `Context nodig voor ${nextCalibrationScene.title}.`,
        played: played.has(contextScene.id),
      }) : pathScene ? buildEntry(pathScene, {
        score: 0,
        reason: `Pad nodig voor ${nextCalibrationScene.title}.`,
        played: played.has(pathScene.id),
      }) : buildEntry(nextCalibrationScene, {
        score: 0,
        blocked: !!pathBlockForScene(nextCalibrationScene),
        reason: pathBlockForScene(nextCalibrationScene)
          ? pathBlockForScene(nextCalibrationScene).reason
          : `Calibratie ${calibration.completed}/${calibration.total}: vaste situatievolgorde.`,
        calibration: true,
        played: false,
      });
    }
    upcoming = playableScenes
      .filter((scene) => !calibrationIds.has(scene.id))
      .filter((scene) => scene.id !== activeSceneId)
      .filter((scene) => !played.has(scene.id))
      .map((scene) => {
        const block = contextBlockForScene(scene);
        const pathBlock = pathBlockForScene(scene);
        return block ? buildBlockedContextEntry(scene, { score: 0 })
          : pathBlock ? buildBlockedPathEntry(scene, { score: 0 })
          : buildEntry(scene, {
          score: 0,
          reason: "Na calibratie beschikbaar.",
          played: false,
        });
      });
    upcoming = enforceContextOrder(upcoming);
    if (next && next.sceneId && !calibrationIds.has(next.sceneId) && !upcoming.some((entry) => entry.sceneId === next.sceneId)) {
      upcoming.unshift(next);
    }
  } else {
    const pool = playableScenes.filter((scene) => scene.id !== lastSceneId && scene.id !== activeSceneId);
    const unplayed = pool.filter((scene) => !played.has(scene.id));
    const candidatesFrom = unplayed.length ? unplayed : pool;
    const ranked = rankAlgorithmScenes({
      candidateScenes: candidatesFrom,
      playableScenes,
      runs: normalizedRuns,
      played,
      settings: safeSettings,
    });
    const contextAwareEntries = ranked.entries.map((entry) => {
      const block = contextBlockForScene(entry.scene);
      const pathBlock = pathBlockForScene(entry.scene);
      return block ? buildBlockedContextEntry(entry.scene, {
        score: entry.score,
        scoreBreakdown: entry.scoreBreakdown,
        reason: block.reason,
      }) : pathBlock ? buildBlockedPathEntry(entry.scene, {
        score: entry.score,
        scoreBreakdown: entry.scoreBreakdown,
        reason: pathBlock.reason,
      }) : buildEntry(entry.scene, {
        score: entry.score,
        scoreBreakdown: entry.scoreBreakdown,
        reason: entry.reason,
        played: entry.played,
      });
    });
    const firstBlockedEntry = ranked.entries.find((entry) => !isContextReady(entry.scene)) || null;
    let contextEntry = null;
    if (firstBlockedEntry) {
      const contextScene = findFirstReadyContextScene(firstBlockedEntry.scene);
      if (contextScene) {
        contextEntry = buildEntry(contextScene, {
          score: firstBlockedEntry.score,
          scoreBreakdown: firstBlockedEntry.scoreBreakdown,
          reason: `Context nodig voor ${firstBlockedEntry.title}.`,
          played: played.has(contextScene.id),
        });
      }
    }
    upcoming = enforceContextOrder(contextAwareEntries);
    if (contextEntry && !upcoming.some((entry) => entry.sceneId === contextEntry.sceneId)) {
      upcoming.unshift(contextEntry);
    }
    entityScores = ranked.entityScores;
    next = contextEntry || upcoming.find((entry) => !entry.blocked) || null;
  }

  const rankedUpcoming = upcoming.slice();
  let lockedNextQueueEntry = null;
  for (const queueEntry of requestedLockedQueue) {
    if (played.has(queueEntry.sceneId) || queueEntry.sceneId === activeSceneId) continue;
    const queueScene = playableById.get(queueEntry.sceneId) || null;
    if (!queueScene || !isContextReadyForLockedEntry(queueScene, queueEntry.position) || !isPathReadyForLockedEntry(queueScene)) continue;
    lockedNextQueueEntry = queueEntry;
    break;
  }
  if (lockedNextQueueEntry) {
    const lockedScene = playableById.get(lockedNextQueueEntry.sceneId);
    const rankedLockedEntry = rankedUpcoming.find((entry) => Number(entry.sceneId || 0) === lockedNextQueueEntry.sceneId)
      || calibrationEntries.find((entry) => Number(entry.sceneId || 0) === lockedNextQueueEntry.sceneId)
      || buildEntry(lockedScene, {
        played: false,
        reason: "Vastgezette speelpositie.",
      });
    next = buildEntry(lockedScene, {
      ...rankedLockedEntry,
      next: true,
      locked: true,
      lockedNext: true,
      lockedFuture: false,
      played: false,
      blocked: false,
      queuePosition: lockedNextQueueEntry.position,
      randomSeed: lockedNextQueueEntry.randomSeed,
      lockSource: lockedNextQueueEntry.source,
      lockedAt: lockedNextQueueEntry.lockedAt,
      reason: rankedLockedEntry.reason || "Vastgezette speelpositie.",
    });
  }
  if (lockedSceneIds.size) {
    upcoming = upcoming.filter((entry) => !lockedSceneIds.has(Number(entry.sceneId || 0)));
  }

  let preparedNextState = requestedPreparedNext.sceneId
    ? { ...requestedPreparedNext, locked: false, invalidReason: "" }
    : { sceneId: 0, locked: false, source: "", lockedAt: "", invalidReason: "" };
  if (!lockedNextQueueEntry && requestedPreparedNext.sceneId) {
    const preparedScene = playableById.get(requestedPreparedNext.sceneId) || null;
    let invalidReason = "";
    if (!preparedScene) invalidReason = "scene_unavailable";
    else if (preparedScene.id === activeSceneId) invalidReason = "scene_active";
    else if (played.has(preparedScene.id)) invalidReason = "scene_already_played";
    else if (calibration.active && next && next.sceneId && preparedScene.id !== next.sceneId) invalidReason = "calibration_fixed_order";
    else if (!isContextReady(preparedScene)) invalidReason = "context_blocked";
    else if (!isPathReady(preparedScene)) invalidReason = "path_blocked";

    if (invalidReason) {
      preparedNextState = { ...preparedNextState, invalidReason };
    } else {
      const rankedPreparedEntry = upcoming.find((entry) => Number(entry.sceneId || 0) === preparedScene.id)
        || calibrationEntries.find((entry) => Number(entry.sceneId || 0) === preparedScene.id)
        || buildEntry(preparedScene, {
          played: false,
          reason: "Vastgezette Up Next.",
        });
      next = buildEntry(preparedScene, {
        ...rankedPreparedEntry,
        next: true,
        lockedNext: true,
        played: false,
        blocked: false,
        reason: rankedPreparedEntry.reason || "Vastgezette Up Next.",
      });
      preparedNextState = { ...requestedPreparedNext, locked: true, invalidReason: "" };
    }
  }
  if (lockedNextQueueEntry && next && Number(next.sceneId || 0) === lockedNextQueueEntry.sceneId) {
    preparedNextState = {
      sceneId: lockedNextQueueEntry.sceneId,
      locked: true,
      source: lockedNextQueueEntry.source,
      lockedAt: lockedNextQueueEntry.lockedAt,
      randomSeed: lockedNextQueueEntry.randomSeed,
      queuePosition: lockedNextQueueEntry.position,
      invalidReason: "",
    };
  }

  const upcomingIds = new Set(upcoming.map((entry) => entry.sceneId));
  const hasUnplayedOutsideActive = playableScenes.some((scene) => !played.has(scene.id) && scene.id !== activeSceneId);
  const cycleComplete = playableScenes.length > 0 && !hasUnplayedOutsideActive && !calibration.active;
  const hiddenPlayed = cycleComplete ? [] : playableScenes
    .filter((scene) => played.has(scene.id))
    .filter((scene) => scene.id !== activeSceneId)
    .filter((scene) => !upcomingIds.has(scene.id))
    .map((scene) => buildEntry(scene, {
      played: true,
      hidden: true,
      calibration: calibrationIds.has(scene.id),
      reason: "Gespeeld en tijdelijk verborgen uit de hoofdvolgorde.",
    }));
  const exposedNext = next;
  const exposedNextSceneId = Number(exposedNext && exposedNext.sceneId || 0);
  const entryById = new Map();
  const mergeEntry = (entry) => {
    const sceneId = Number(entry && entry.sceneId || 0);
    if (!sceneId) return;
    const prev = entryById.get(sceneId) || {};
    entryById.set(sceneId, {
      ...prev,
      ...entry,
      scene: entry.scene || prev.scene,
      issues: Array.isArray(entry.issues) && entry.issues.length ? entry.issues : prev.issues || [],
      warnings: Array.isArray(entry.warnings) && entry.warnings.length ? entry.warnings : prev.warnings || [],
    });
  };
  calibrationEntries.forEach(mergeEntry);
  upcoming.forEach((entry, index) => mergeEntry({ ...entry, rank: entry.rank || index + 1 }));
  if (next && next.sceneId) mergeEntry(next);
  hiddenPlayed.forEach(mergeEntry);
  blockedContext.forEach(mergeEntry);
  blockedPath.forEach(mergeEntry);
  invalid.forEach(mergeEntry);
  const sceneScoreFallback = scoreLookup(entityScores.scenes || baseEntityScores.scenes || []);
  const rows = available.map((scene, index) => {
    const existing = entryById.get(scene.id) || {};
    const block = !existing.invalid ? contextBlockForScene(scene) : null;
    const pathBlock = !existing.invalid ? pathBlockForScene(scene) : null;
    const hasExistingScore = Number.isFinite(Number(existing.score)) && (Number(existing.score) !== 0 || !!existing.scoreBreakdown);
    const score = hasExistingScore
      ? Number(existing.score)
      : Number(sceneScoreFallback.get(scene.id) || 0);
    const reason = existing.reason
      || (pathBlock ? pathBlock.reason : "")
      || (exposedNextSceneId === scene.id ? "Volgende situatie staat klaar." : "")
      || (activeSceneId === scene.id ? "Situatie is nu actief." : "")
      || (played.has(scene.id) ? "Situatie gespeeld." : "Beschikbaar in de huidige volgorde.");
    return buildEntry(scene, {
      ...existing,
      rank: existing.rank || index + 1,
      score,
      reason,
      calibration: calibrationIds.has(scene.id),
      played: played.has(scene.id),
      active: activeSceneId === scene.id,
      next: exposedNextSceneId === scene.id,
      lockedNext: !!existing.lockedNext && exposedNextSceneId === scene.id,
      hidden: false,
      blocked: !!existing.blocked || !!block || !!pathBlock,
      invalid: !!existing.invalid,
      issues: Array.isArray(existing.issues) ? existing.issues : [],
      warnings: Array.isArray(existing.warnings) ? existing.warnings : warningsForScene(scene),
    });
  });
  const active = rows.find((entry) => entry.active) || null;
  const exposedNextRow = exposedNextSceneId
    ? rows.find((entry) => Number(entry.sceneId || 0) === exposedNextSceneId) || null
    : null;
  const canonicalNext = exposedNextRow
    ? {
        ...exposedNextRow,
        reason: exposedNext && exposedNext.reason ? exposedNext.reason : exposedNextRow.reason,
        score: Number.isFinite(Number(exposedNext && exposedNext.score))
          ? Number(Number(exposedNext.score).toFixed(2))
          : exposedNextRow.score,
        next: true,
        locked: !!(exposedNext && exposedNext.locked),
        lockedNext: !!(preparedNextState && preparedNextState.locked),
        lockedFuture: false,
        queuePosition: Number(exposedNext && exposedNext.queuePosition || exposedNextRow.queuePosition || 0),
        randomSeed: String(exposedNext && exposedNext.randomSeed || exposedNextRow.randomSeed || ""),
        lockSource: String(exposedNext && exposedNext.lockSource || exposedNextRow.lockSource || ""),
        lockedAt: String(exposedNext && exposedNext.lockedAt || exposedNextRow.lockedAt || ""),
      }
    : null;
  const rowById = new Map(rows.map((entry) => [Number(entry.sceneId || 0), entry]));
  const queueRows = [];
  const queuedIds = new Set();
  const pushQueueRow = (entry, patch = {}) => {
    const sceneId = Number(entry && entry.sceneId || 0);
    if (!sceneId || queuedIds.has(sceneId)) return;
    queuedIds.add(sceneId);
    queueRows.push({ ...entry, ...patch });
  };
  const runBySceneId = new Map();
  for (const run of normalizedRuns) {
    if (run && run.sceneId) runBySceneId.set(Number(run.sceneId || 0), run);
  }
  if (requestedLockedQueue.length) {
    for (const queueEntry of requestedLockedQueue) {
      const row = rowById.get(queueEntry.sceneId);
      if (!row) continue;
      const run = runBySceneId.get(queueEntry.sceneId) || null;
      const isActive = queueEntry.sceneId === activeSceneId;
      const isPlayed = played.has(queueEntry.sceneId);
      const isNext = !!(canonicalNext && Number(canonicalNext.sceneId || 0) === queueEntry.sceneId && !isActive && !isPlayed);
      pushQueueRow(row, {
        active: isActive,
        played: isPlayed,
        next: isNext,
        locked: true,
        lockedNext: isNext,
        lockedFuture: !isActive && !isPlayed && !isNext,
        playedPosition: Number(run && run.runOrder || 0),
        queuePosition: queueEntry.position,
        randomSeed: queueEntry.randomSeed,
        lockSource: queueEntry.source,
        lockedAt: queueEntry.lockedAt,
      });
    }
    for (const run of normalizedRuns) {
      const sceneId = Number(run && run.sceneId || 0);
      const row = rowById.get(sceneId);
      if (!row) continue;
      if (run.endedAt || sceneId === activeSceneId) {
        pushQueueRow(row, {
          playedPosition: Number(run.runOrder || 0),
          active: sceneId === activeSceneId,
          played: played.has(sceneId),
        });
      }
    }
    if (canonicalNext) {
      pushQueueRow(canonicalNext, {
        locked: !!(preparedNextState && preparedNextState.locked),
        lockedNext: !!(preparedNextState && preparedNextState.locked),
        next: true,
      });
    }
    for (const entry of upcoming) {
      const row = rowById.get(Number(entry.sceneId || 0)) || entry;
      pushQueueRow(row);
    }
    for (const entry of blockedContext) {
      const row = rowById.get(Number(entry.sceneId || 0)) || entry;
      pushQueueRow(row);
    }
    for (const entry of blockedPath) {
      const row = rowById.get(Number(entry.sceneId || 0)) || entry;
      pushQueueRow(row);
    }
    for (const entry of invalid) {
      const row = rowById.get(Number(entry.sceneId || 0)) || entry;
      pushQueueRow(row);
    }
    for (const entry of rows) pushQueueRow(entry);
  } else if (calibration.active) {
    rows.forEach((entry) => pushQueueRow(entry));
  } else {
    for (const run of normalizedRuns) {
      const sceneId = Number(run && run.sceneId || 0);
      const row = rowById.get(sceneId);
      if (!row) continue;
      if (run.endedAt || sceneId === activeSceneId) {
        pushQueueRow(row, {
          playedPosition: Number(run.runOrder || 0),
          active: sceneId === activeSceneId,
        });
      }
    }
    if (canonicalNext) pushQueueRow(canonicalNext, { lockedNext: !!(preparedNextState && preparedNextState.locked), next: true });
    for (const entry of upcoming) {
      const row = rowById.get(Number(entry.sceneId || 0)) || entry;
      pushQueueRow(row);
    }
    for (const entry of blockedContext) {
      const row = rowById.get(Number(entry.sceneId || 0)) || entry;
      pushQueueRow(row);
    }
    for (const entry of blockedPath) {
      const row = rowById.get(Number(entry.sceneId || 0)) || entry;
      pushQueueRow(row);
    }
    for (const entry of invalid) {
      const row = rowById.get(Number(entry.sceneId || 0)) || entry;
      pushQueueRow(row);
    }
    for (const entry of rows) pushQueueRow(entry);
  }
  const numberedQueueRows = queueRows.map((entry, index) => ({
    ...entry,
    queuePosition: index + 1,
  }));

  return {
    calibration,
    calibrationScenes: calibrationEntries,
    upcoming,
    blockedContext,
    blockedPath,
    hiddenPlayed,
    invalid,
    rows,
    queueRows: numberedQueueRows,
    lockedQueue: requestedLockedQueue,
    active,
    next: canonicalNext,
    lockedNextSceneId: Number(canonicalNext && canonicalNext.sceneId || 0),
    preparedNext: preparedNextState,
    entityScores,
    playableCount: playableScenes.length,
    activeSceneId,
    lastSceneId,
    cycleComplete,
  };
}

function pickRecommendation({ scenes = [], runs = [], settings = {}, catalog = null, order = null } = {}) {
  const safeOrder = order || buildAlgorithmOrder({ scenes, runs, settings, catalog });
  const recommendationEntry = safeOrder.next || safeOrder.upcoming[0] || null;
  if (!recommendationEntry) {
    const reason = safeOrder.playableCount
      ? "Geen volgende situatie beschikbaar."
      : "Geen actieve situaties beschikbaar.";
    return {
      scene: null,
      score: 0,
      reason,
      calibration: safeOrder.calibration,
      entityScores: safeOrder.entityScores,
      candidates: [],
    };
  }

  return {
    scene: recommendationEntry.scene || null,
    score: Number(recommendationEntry.score || 0),
    reason: recommendationEntry.reason || "Volgende beschikbare situatie.",
    calibration: safeOrder.calibration,
    entityScores: safeOrder.entityScores,
    candidates: [recommendationEntry]
      .concat(safeOrder.upcoming.filter((entry) => entry.sceneId !== recommendationEntry.sceneId))
      .slice(0, 12)
      .map((candidate) => ({
      sceneId: candidate.sceneId,
      title: candidate.title,
      score: candidate.score,
      reason: candidate.reason,
    })),
  };
}

function validateSceneLinks(scene, { characters = [], situations = [], labels = [], environments = [], scenes = [] } = {}) {
  const safeScene = normalizeScene(scene);
  const activeCharacterIds = new Set((Array.isArray(characters) ? characters : [])
    .map(normalizeCharacter)
    .filter((item) => item.id && item.isActive && !item.archivedAt)
    .map((item) => item.id));
  const activeSituationById = new Map((Array.isArray(situations) ? situations : [])
    .map(normalizeSituation)
    .filter((item) => item.id && item.isActive && !item.archivedAt)
    .map((item) => [item.id, item]));
  const activeLabelIds = new Set((Array.isArray(labels) ? labels : [])
    .map(normalizeLabel)
    .filter((item) => item.id && item.isActive && !item.archivedAt)
    .map((item) => item.id));
  const activeEnvironmentIds = new Set((Array.isArray(environments) ? environments : [])
    .map(normalizeEnvironment)
    .filter((item) => item.id && item.isActive && !item.archivedAt)
    .map((item) => item.id));
  const sceneById = new Map((Array.isArray(scenes) ? scenes : [])
    .map(normalizeScene)
    .filter((item) => item.id)
    .map((item) => [item.id, item]));
  if (safeScene.id) sceneById.set(safeScene.id, safeScene);
  const issues = [];

  if (!safeScene.title) issues.push("title_required");
  for (const id of safeScene.characterIds) {
    if (!activeCharacterIds.has(id)) issues.push(`character_inactive:${id}`);
  }
  const seenSlotCharacterIds = new Set();
  for (const id of actorCharacterSlots(safeScene.characterSlots)) {
    if (id <= 0) continue;
    if (seenSlotCharacterIds.has(id)) issues.push(`character_duplicate:${id}`);
    seenSlotCharacterIds.add(id);
    if (!activeCharacterIds.has(id)) issues.push(`character_inactive:${id}`);
  }
  for (const id of safeScene.situationIds) {
    const situation = activeSituationById.get(id);
    if (!situation) {
      issues.push(`situation_inactive:${id}`);
      continue;
    }
    for (const requiredId of situation.requiredCharacterIds) {
      if (!safeScene.characterIds.includes(requiredId)) issues.push(`required_character_missing:${requiredId}`);
    }
    if (situation.allowedCharacterIds.length) {
      for (const characterId of safeScene.characterIds) {
        if (!situation.allowedCharacterIds.includes(characterId)) {
          issues.push(`character_not_allowed:${characterId}:situation:${situation.id}`);
        }
      }
    }
  }
  for (const id of safeScene.labelIds) {
    if (!activeLabelIds.has(id)) issues.push(`label_inactive:${id}`);
  }
  if (safeScene.environmentMode !== "random" && safeScene.environmentId && !activeEnvironmentIds.has(safeScene.environmentId)) {
    issues.push(`environment_inactive:${safeScene.environmentId}`);
  }
  if (safeScene.contextSceneId) {
    if (safeScene.contextSceneId === safeScene.id) {
      issues.push("context_scene_self");
    }
    const contextScene = sceneById.get(safeScene.contextSceneId) || null;
    if (!contextScene || !contextScene.isActive || contextScene.archivedAt) {
      issues.push(`context_scene_inactive:${safeScene.contextSceneId}`);
    }
    const seenContextIds = new Set([safeScene.id]);
    let cursor = contextScene;
    while (cursor && cursor.contextSceneId) {
      if (seenContextIds.has(cursor.contextSceneId)) {
        issues.push(`context_scene_cycle:${cursor.contextSceneId}`);
        break;
      }
      seenContextIds.add(cursor.contextSceneId);
      cursor = sceneById.get(cursor.contextSceneId) || null;
    }
  }
  return { ok: issues.length === 0, issues };
}

function buildSceneWarnings(scene, { characters = [], performers = [] } = {}) {
  const safeScene = normalizeScene(scene);
  const characterById = new Map((Array.isArray(characters) ? characters : [])
    .map(normalizeCharacter)
    .filter((item) => item.id)
    .map((item) => [item.id, item]));
  const performerRows = Array.isArray(performers) ? performers.map(normalizePerformer).filter((item) => item.id) : [];
  const performerById = new Map(performerRows.map((item) => [item.id, item]));
  const hasPerformerCatalog = performerRows.length > 0;
  const activePerformerIds = new Set(performerRows
    .filter((item) => item.id && item.isActive && !item.archivedAt)
    .map((item) => item.id));
  const slotCharactersByPerformerId = new Map();
  const warnings = [];

  for (const characterId of safeScene.characterSlots) {
    if (characterId <= 0) continue;
    const character = characterById.get(characterId);
    if (!character || !character.performerId) continue;
    const bucket = slotCharactersByPerformerId.get(character.performerId) || [];
    bucket.push(character.id);
    slotCharactersByPerformerId.set(character.performerId, bucket);
    if (hasPerformerCatalog && (!performerById.has(character.performerId) || !activePerformerIds.has(character.performerId))) {
      warnings.push(`performer_inactive:${character.performerId}:character:${character.id}`);
    }
  }

  for (const [performerId, characterIds] of slotCharactersByPerformerId.entries()) {
    const uniqueCharacterIds = Array.from(new Set(characterIds));
    if (uniqueCharacterIds.length > 1) {
      warnings.push(`performer_conflict:${performerId}:${uniqueCharacterIds.join(",")}`);
    }
  }
  const overflowCharacterIds = safeScene.characterSlots
    .slice(ALGORITHM_ACTOR_SLOT_COUNT)
    .filter((id) => id > 0);
  if (overflowCharacterIds.length) warnings.push(`too_many_roles:${overflowCharacterIds.join(",")}`);

  return warnings;
}

function fillTemplate(template, replacements) {
  return String(template || "").replace(/\{([A-Za-z0-9_]+)\}/g, (match, key) => {
    return Object.prototype.hasOwnProperty.call(replacements, key) ? String(replacements[key] || "") : match;
  });
}

function formatCharacters(characters = []) {
  return characters
    .map(normalizeCharacter)
    .filter((item) => item.id && item.name)
    .map((item) => `${item.name} ${item.description || ""}`.trim())
    .join("\n");
}

function performerNameForSlot(slotIndex, performers = []) {
  const slotNumber = Number(slotIndex || 0) + 1;
  const performer = (Array.isArray(performers) ? performers : [])
    .map(normalizePerformer)
    .find((item) => Number(item.roleSlot || 0) === slotNumber);
  return performer && performer.name ? performer.name : "";
}

function randomCharacterLabelForSlot(slotIndex, performers = []) {
  const performerName = performerNameForSlot(slotIndex, performers);
  return performerName ? `random personage voor ${performerName}` : "random personage";
}

function formatCharacterSlots(slots = [], characters = [], performers = []) {
  const characterById = new Map(characters.map((item) => {
    const safe = normalizeCharacter(item);
    return [safe.id, safe];
  }));
  const lines = actorCharacterSlots(slots).map((id, index) => {
    if (id === 0) return "";
    if (id === ALGORITHM_RANDOM_SLOT_VALUE) return "";
    const character = characterById.get(id);
    if (!character) return `Personage ${index + 1}: personage ${id}.`;
    return `Personage ${index + 1}: ${character.name} ${character.description || ""}`.trim();
  }).filter(Boolean);
  return lines.length ? lines.join("\n") : "Geen personages.";
}

function formatSituations(situations = []) {
  return situations
    .map(normalizeSituation)
    .filter((item) => item.id && item.name)
    .map((item) => item.description || item.name)
    .filter(Boolean)
    .join(" ");
}

function composeScenePrompt({ scene, characters = [], situations = [], environment = null, performers = [], settings = {}, audienceContext = "" } = {}) {
  const safeSettings = normalizeAlgorithmSettings(settings);
  const rawScene = scene && typeof scene === "object" ? scene : {};
  const hasExplicitCharacterSlots = Array.isArray(rawScene.characterSlots) && rawScene.characterSlots.length > 0;
  const safeScene = normalizeScene(rawScene);
  const safeEnvironment = environment ? normalizeEnvironment(environment) : null;
  const slotNames = hasExplicitCharacterSlots
    ? actorCharacterSlots(safeScene.characterSlots).map((id, index) => {
        if (id === 0) return "";
        if (id === ALGORITHM_RANDOM_SLOT_VALUE) return "";
        const character = characters.map(normalizeCharacter).find((item) => item.id === id);
        return character && character.name ? character.name : "";
      }).filter(Boolean)
    : [];
  const characterNames = slotNames.length
    ? slotNames.join(", ")
    : characters.map((item) => normalizeCharacter(item).name).filter(Boolean).join(", ");
  const environmentName = safeScene.environmentMode === "random"
    ? ""
    : safeEnvironment && safeEnvironment.name ? safeEnvironment.name : "";
  const environmentDescription = safeScene.environmentMode === "random"
    ? ""
    : safeEnvironment
    ? `${safeEnvironment.name || ""}, ${safeEnvironment.description || ""}`.replace(/,\s*$/, "")
    : "";
  const scenePrompt = safeScene.promptOverride ? safeScene.promptOverride : "";
  const situationText = formatSituations(situations) || safeScene.title;
  const prompt = fillTemplate(safeSettings.promptTemplate, {
    globalPrompt: safeSettings.globalPrompt,
    characters: hasExplicitCharacterSlots ? formatCharacterSlots(safeScene.characterSlots, characters, performers) : formatCharacters(characters),
    situations: situationText,
    scenePrompt,
    environmentName,
    characterNames,
    title: safeScene.title,
    environmentDescription,
    audienceContext: normalizeText(audienceContext, 1600),
  });
  return prompt
    .split("\n")
    .map((line) => line.trimEnd())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function buildAudienceContext({ recommendation = null, entityLabels = {} } = {}) {
  if (!recommendation || !recommendation.entityScores) return "";
  const labels = entityLabels && typeof entityLabels === "object" ? entityLabels : {};
  const characterLabels = labels.characters || {};
  const situationLabels = labels.situations || {};
  const labelLabels = labels.labels || {};
  const sceneLabels = labels.scenes || {};
  const topCharacters = (recommendation.entityScores.characters || [])
    .slice(0, 3)
    .map((item) => characterLabels[item.id] || `personage ${item.id}`)
    .join(", ");
  const situationScores = (recommendation.entityScores.situations || []).length
    ? recommendation.entityScores.situations
    : recommendation.entityScores.scenes || [];
  const topSituations = situationScores
    .slice(0, 3)
    .map((item) => situationLabels[item.id] || sceneLabels[item.id] || `situatie ${item.id}`)
    .join(", ");
  const topLabels = (recommendation.entityScores.labels || [])
    .slice(0, 3)
    .map((item) => labelLabels[item.id] || `label ${item.id}`)
    .join(", ");
  const parts = [];
  if (topCharacters) parts.push(`Publiekssmaak: personages die hoog scoren: ${topCharacters}.`);
  if (topSituations) parts.push(`Situaties die hoog scoren: ${topSituations}.`);
  if (topLabels) parts.push(`Labels die hoog scoren: ${topLabels}.`);
  return parts.join(" ");
}

module.exports = {
  DEFAULT_ALGORITHM_GLOBAL_PROMPT,
  DEFAULT_ALGORITHM_PROMPT_TEMPLATE,
  DEFAULT_ALGORITHM_SETTINGS,
  ALGORITHM_ACTOR_SLOT_COUNT,
  ALGORITHM_RANDOM_SLOT_VALUE,
  normalizeAlgorithmSettings,
  normalizeCharacter,
  normalizePerformer,
  normalizeLabel,
  normalizePath,
  normalizeSceneCharacterSlotsForPerformerRoles,
  resolveRandomCharacterSlotsForPerformerRoles,
  randomCharacterCandidatesForPerformerSlot,
  resolveRandomEnvironmentForScene,
  normalizeSceneForPerformerRoles,
  normalizeSituation,
  normalizeEnvironment,
  normalizeScene,
  normalizeRun,
  normalizeIdList,
  normalizeLockedQueue,
  calculateRunDurationSeconds,
  calculateRunScore,
  calculateRunScoreDetails,
  computeEntityScores,
  buildAlgorithmOrder,
  pickRecommendation,
  pickNextInFixedOrder,
  validateSceneLinks,
  validateAlgorithmPath,
  buildPathSceneStatuses,
  buildSceneWarnings,
  composeScenePrompt,
  buildAudienceContext,
};
