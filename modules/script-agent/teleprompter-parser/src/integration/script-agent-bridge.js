"use strict";

const path = require("node:path");

const { DEFAULT_CATALOG_BASE_URL } = require("../../../client/catalog-client");
const { DEFAULT_RUNTIME_BASE_URL } = require("../../../client/runtime-client");
const { scriptAgentDbDir } = require("../../../script-output/state-store");
const { mountTeleprompterParser } = require("./express-router");
const { sendTouchDesignerCameraPulse } = require("./touchdesigner-osc");

const DEFAULT_SHOW_CONTROL_BASE_URL = "http://127.0.0.1:3025";

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function normalizeBaseUrl(value, fallback) {
  return String(value || fallback).replace(/\/+$/, "");
}

function catalogBaseUrl(env = process.env) {
  return normalizeBaseUrl(env.V2_SCRIPT_AGENT_CATALOG_URL, DEFAULT_CATALOG_BASE_URL);
}

function showControlBaseUrl(env = process.env) {
  return normalizeBaseUrl(
    env.V2_SCRIPT_AGENT_SHOW_CONTROL_URL || env.V2_SHOW_CONTROL_URL,
    DEFAULT_SHOW_CONTROL_BASE_URL
  );
}

function runtimeBaseUrl(env = process.env) {
  return normalizeBaseUrl(env.V2_SCRIPT_AGENT_RUNTIME_URL, DEFAULT_RUNTIME_BASE_URL);
}

function joinUrl(baseUrl, pathname) {
  return `${String(baseUrl || "").replace(/\/+$/, "")}${pathname.startsWith("/") ? pathname : `/${pathname}`}`;
}

async function postJson(url, body = {}, timeoutMs = 2200) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    const text = await response.text();
    let parsed = {};
    try {
      parsed = text ? JSON.parse(text) : {};
    } catch {
      parsed = { raw: text };
    }
    if (!response.ok) {
      const detail = parsed && (parsed.message || parsed.error) ? parsed.message || parsed.error : JSON.stringify(parsed);
      throw new Error(`${url} returned ${response.status}: ${detail}`);
    }
    return parsed;
  } finally {
    clearTimeout(timer);
  }
}

function numericLegacyId(...values) {
  for (const value of values) {
    if (value == null || value === "") continue;
    const direct = Number.parseInt(String(value), 10);
    if (Number.isFinite(direct) && direct > 0 && String(value).match(/^\d+$/)) return direct;
    const match = String(value).match(/(?:^|:)(\d+)$/);
    if (match) {
      const numeric = Number.parseInt(match[1], 10);
      if (Number.isFinite(numeric) && numeric > 0) return numeric;
    }
  }
  return 0;
}

function sameSituation(a, b) {
  const left = String(a || "").trim();
  const right = String(b || "").trim();
  if (left && right && left === right) return true;
  const leftLegacy = numericLegacyId(left);
  const rightLegacy = numericLegacyId(right);
  return !!(leftLegacy && rightLegacy && leftLegacy === rightLegacy);
}

function relativeCatalogUrlToAbsolute(url, env = process.env) {
  const value = String(url || "").trim();
  if (!value) return "";
  if (/^https?:\/\//i.test(value) || value.startsWith("data:")) return value;
  if (value.startsWith("/v0/catalog/")) return `${catalogBaseUrl(env)}${value}`;
  return value;
}

function imageUrlFromPayload(payload = {}, env = process.env) {
  const source = payload && typeof payload === "object" ? payload : {};
  const environment = source.environment && typeof source.environment === "object" ? source.environment : {};
  const assets = source.assets && typeof source.assets === "object" ? source.assets : {};
  const candidates = [
    environment.imageUrl,
    environment.image,
    environment.url,
    source.imageUrl,
    source.backgroundAsset && source.backgroundAsset.url,
    assets.background && assets.background.url,
  ];
  return relativeCatalogUrlToAbsolute(candidates.find((item) => String(item || "").trim()) || "", env);
}

function normalizeEnvironment(payload = {}, env = process.env) {
  const environment = payload && payload.environment && typeof payload.environment === "object" ? payload.environment : payload;
  if (!environment || typeof environment !== "object") return null;
  const id = numericLegacyId(environment.legacyId, environment.legacyEnvironmentId, environment.id, environment.environmentId);
  const name = String(environment.name || environment.title || "").trim();
  const description = String(environment.description || "").trim();
  const imageUrl = imageUrlFromPayload({ ...payload, environment }, env);
  if (!id && !name && !description && !imageUrl) return null;
  return { id, name, description, imageUrl };
}

function characterName(character = {}) {
  return String(character.name || character.characterName || character.label || character.title || "").trim();
}

function preparedCharactersFromPromptInput(promptInput = {}) {
  const characterById = new Map((promptInput.characters || []).map((character) => [String(character.characterId || ""), character]));
  const characters = [];
  const seen = new Set();
  for (const slot of promptInput.performerSlots || []) {
    const slotIndex = Number(slot.slotIndex || 0);
    if (slotIndex < 1 || slotIndex > 3) continue;
    const sourceCharacter = characterById.get(String(slot.characterId || "")) || {};
    const name = characterName({ ...sourceCharacter, characterName: slot.characterName });
    if (!name || seen.has(`${slotIndex}:${name.toLowerCase()}`)) continue;
    seen.add(`${slotIndex}:${name.toLowerCase()}`);
    characters.push({
      id: numericLegacyId(sourceCharacter.legacyCharacterId, slot.legacyCharacterId, slot.characterId, sourceCharacter.characterId),
      characterId: String(slot.characterId || sourceCharacter.characterId || "").trim(),
      legacyCharacterId: numericLegacyId(sourceCharacter.legacyCharacterId, slot.legacyCharacterId, slot.characterId, sourceCharacter.characterId) || null,
      name,
      slot: slotIndex,
      performerId: String(slot.performerId || "").trim(),
      performerName: String(slot.performerName || "").trim(),
    });
  }
  if (characters.length) return characters;
  return (promptInput.characters || []).slice(0, 3).map((character, index) => ({
    id: numericLegacyId(character.legacyCharacterId, character.characterId),
    name: characterName(character),
    slot: index + 1,
  })).filter((character) => character.name);
}

function preparedCharactersFromPayload(payload = {}) {
  const slotSources = Array.isArray(payload.performerSlots) && payload.performerSlots.length
    ? payload.performerSlots
    : Array.isArray(payload.characterSlots) && payload.characterSlots.length
      ? payload.characterSlots
      : [];
  if (slotSources.length) {
    return slotSources.slice(0, 3).map((slot, index) => ({
      id: numericLegacyId(slot.legacyCharacterId, slot.characterId, slot.id),
      characterId: String(slot.characterId || slot.catalogCharacterId || "").trim(),
      legacyCharacterId: numericLegacyId(slot.legacyCharacterId, slot.characterId, slot.id) || null,
      name: characterName(slot),
      slot: Number(slot.slotIndex || slot.slot || index + 1),
      performerId: String(slot.performerId || "").trim(),
      performerName: String(slot.performerName || "").trim(),
    })).filter((character) => character.name);
  }
  return (payload.characters || []).slice(0, 3).map((character, index) => ({
    id: numericLegacyId(character.legacyCharacterId, character.characterId, character.id),
    characterId: String(character.characterId || character.id || "").trim(),
    legacyCharacterId: numericLegacyId(character.legacyCharacterId, character.characterId, character.id) || null,
    name: characterName(character),
    slot: Number(character.slot || index + 1),
    performerId: String(character.performerId || "").trim(),
    performerName: String(character.performerName || "").trim(),
  })).filter((character) => character.name);
}

function preparedSceneFromPromptInput(promptInput = {}, env = process.env) {
  const situation = promptInput.situation || {};
  const environment = normalizeEnvironment({ environment: promptInput.environment || {} }, env);
  return {
    sceneId: numericLegacyId(situation.legacySituationId, situation.situationId, promptInput.situationId),
    title: String(situation.title || "Volgende scene").trim() || "Volgende scene",
    environment,
    characters: preparedCharactersFromPromptInput(promptInput),
  };
}

function preparedSceneMatches(current = {}, next = {}) {
  if (!current || !next) return false;
  const currentId = numericLegacyId(current.sceneId, current.id);
  const nextId = numericLegacyId(next.sceneId, next.id);
  if (currentId && nextId) return currentId === nextId;
  const currentTitle = String(current.title || "").trim().toLowerCase();
  const nextTitle = String(next.title || "").trim().toLowerCase();
  return !!(currentTitle && nextTitle && currentTitle === nextTitle);
}

function preparedSceneFromPayload(payload = {}, env = process.env) {
  const situation = payload.situation && typeof payload.situation === "object" ? payload.situation : {};
  return {
    sceneId: numericLegacyId(payload.sceneId, situation.legacySituationId, situation.situationId, payload.situationId),
    title: String(payload.title || situation.title || "Volgende scene").trim() || "Volgende scene",
    environment: normalizeEnvironment(payload, env),
    characters: preparedCharactersFromPayload(payload),
  };
}

function activeSituationId(runtimeState = {}) {
  const active = runtimeState.activeSituation || {};
  return active.situationId || (active.resolved && active.resolved.situationId) || "";
}

function preparedSituationId(runtimeState = {}) {
  const prepared = runtimeState.resolvedPreparedNext || runtimeState.preparedNext || {};
  return prepared.situationId || "";
}

function outputShouldReveal(promptInput, runtimeState, runtimeAvailable) {
  if (!runtimeAvailable) return true;
  if (!runtimeState || runtimeState.status !== "running") return false;
  const situationId = promptInput && promptInput.situation ? promptInput.situation.situationId : "";
  return sameSituation(situationId, activeSituationId(runtimeState));
}

function showStateFromRuntime(runtimeState, runtimeAvailable) {
  if (!runtimeAvailable || !runtimeState) {
    return {
      active: true,
      sessionActive: true,
      runStarted: true,
      sessionId: 0,
      showRunId: null,
      name: "Script Agent",
      endedAt: null,
      fallback: "runtime_unavailable",
    };
  }
  const active = runtimeState.status === "running";
  return {
    active,
    sessionActive: active,
    runStarted: active,
    sessionId: numericLegacyId(runtimeState.showRunId),
    showRunId: runtimeState.showRunId || null,
    name: runtimeState.showRunId || "",
    endedAt: active ? null : runtimeState.updatedAt || null,
    runtimeStatus: runtimeState.status || "unknown",
    activeSituationId: activeSituationId(runtimeState) || null,
    preparedSituationId: preparedSituationId(runtimeState) || null,
  };
}

function createTeleprompterParserBridge(options = {}) {
  const clients = options.clients || {};
  const env = options.env || process.env;
  let runtimeState = null;
  let runtimeAvailable = false;
  let parser = null;

  async function refreshRuntimeState() {
    if (typeof clients.fetchCurrentRuntimeState !== "function") {
      runtimeAvailable = false;
      runtimeState = null;
      return null;
    }
    try {
      const result = await clients.fetchCurrentRuntimeState();
      if (result && result.ok) {
        runtimeAvailable = true;
        runtimeState = result.state;
        return runtimeState;
      }
    } catch {}
    runtimeAvailable = false;
    runtimeState = null;
    return null;
  }

  function normalizePrepareInput(input = {}) {
    const payload = input && typeof input === "object" ? input : {};
    if (payload.situation || payload.performerSlots || payload.characterSlots || payload.backgroundAsset || payload.assets) {
      return preparedSceneFromPayload(payload, env);
    }
    return payload;
  }

  function mount(app, express) {
    parser = mountTeleprompterParser(app, {
      express,
      publicPrefix: "/script-agent/teleprompter-parser",
      apiPrefix: "/v0/script-agent/teleprompter-parser",
      adminPrefix: "/v0/script-agent/teleprompter-parser",
      captionStylePath: path.join(scriptAgentDbDir(), "teleprompter-caption-style.json"),
      getShowState: () => showStateFromRuntime(runtimeState, runtimeAvailable),
      getAutoCameraScene: () => parser && parser.getPreparedScene ? parser.getPreparedScene() : null,
      normalizePrepareInput,
      onAutoCameraSwitch: (event = {}) => sendTouchDesignerCameraPulse(event.slot, {
        env,
        source: event.source || "teleprompter_auto_camera",
      }),
      endSceneFromStage,
      startSceneFromStage,
    });
    refreshRuntimeState().catch(() => {});
    return parser;
  }

  async function ingestScriptOutput({ promptInput, scriptOutput, source = "script-agent" } = {}) {
    if (!parser || !promptInput || !scriptOutput) return null;
    await refreshRuntimeState();
    const preparedScene = preparedSceneFromPromptInput(promptInput, env);
    const currentPreparedScene = parser.getPreparedScene ? parser.getPreparedScene() : null;
    if (!preparedSceneMatches(currentPreparedScene, preparedScene)) {
      parser.prepare(preparedScene);
    }
    const teleprompt = parser.ingest({
      title: promptInput.situation && promptInput.situation.title || "",
      rawText: scriptOutput.scriptText || "",
      source,
      sceneId: preparedScene.sceneId,
    });
    if (outputShouldReveal(promptInput, runtimeState, runtimeAvailable)) {
      parser.reveal();
    }
    return teleprompt;
  }

  async function endSceneFromStage() {
    await refreshRuntimeState();
    const showRunId = runtimeState && runtimeState.showRunId ? runtimeState.showRunId : null;
    if (!showRunId) throw new Error("script_agent_teleprompter_no_show_run");
    try {
      const cue = await postJson(joinUrl(showControlBaseUrl(env), "/v0/show-control/cues/stop-situation"), {
        name: "Teleprompter end scene",
        showRunId,
        runtimeState,
      }, 5000);
      await refreshRuntimeState();
      return { mode: "show-control", cue };
    } catch (err) {
      const result = await postJson(joinUrl(runtimeBaseUrl(env), `/v0/runtime/runs/${encodeURIComponent(showRunId)}/stop-situation`), {
        autoPrepareNext: true,
      }, 4000);
      await refreshRuntimeState();
      return {
        mode: "runtime-fallback",
        runtime: result,
        warning: err && err.message ? String(err.message) : "show_control_unavailable",
      };
    }
  }

  async function startSceneFromStage() {
    await refreshRuntimeState();
    const showRunId = runtimeState && runtimeState.showRunId ? runtimeState.showRunId : null;
    if (!showRunId) throw new Error("script_agent_teleprompter_no_show_run");
    if (activeSituationId(runtimeState)) {
      return {
        mode: "skipped",
        reason: "runtime_active_situation_exists",
        activeSituationId: activeSituationId(runtimeState),
      };
    }
    try {
      const cue = await postJson(joinUrl(showControlBaseUrl(env), "/v0/show-control/cues/start-situation"), {
        name: "Teleprompter ready start scene",
        showRunId,
        runtimeState,
      }, 5000);
      await refreshRuntimeState();
      return { mode: "show-control", cue };
    } catch (err) {
      const result = await postJson(joinUrl(runtimeBaseUrl(env), `/v0/runtime/runs/${encodeURIComponent(showRunId)}/start-situation`), {
        autoGoEnvironment: true,
        autoRevealTeleprompter: true,
      }, 4000);
      if (parser && typeof parser.reveal === "function") parser.reveal();
      await refreshRuntimeState();
      return {
        mode: "runtime-fallback",
        runtime: result,
        warning: err && err.message ? String(err.message) : "show_control_unavailable",
      };
    }
  }

  return {
    currentRuntimeState: () => (runtimeState ? cloneJson(runtimeState) : null),
    endSceneFromStage,
    ingestScriptOutput,
    mount,
    normalizePrepareInput,
    preparedSceneFromPayload: (payload) => preparedSceneFromPayload(payload, env),
    preparedSceneFromPromptInput: (promptInput) => preparedSceneFromPromptInput(promptInput, env),
    refreshRuntimeState,
    showState: () => showStateFromRuntime(runtimeState, runtimeAvailable),
    startSceneFromStage,
  };
}

module.exports = {
  DEFAULT_SHOW_CONTROL_BASE_URL,
  createTeleprompterParserBridge,
  numericLegacyId,
  preparedSceneFromPayload,
  preparedSceneFromPromptInput,
  relativeCatalogUrlToAbsolute,
  sameSituation,
};
