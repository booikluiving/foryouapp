"use strict";

const EventEmitter = require("node:events");
const fs = require("node:fs/promises");
const path = require("node:path");

const { buildPromptInput } = require("../prompt-builder/prompt-builder");
const { createScriptOutput } = require("../script-output/script-service");
const {
  appendPromptInput,
  appendScriptOutput,
  assertPathUnderV2,
  readLatestScriptOutput,
  readPromptInput,
  scriptAgentDbDir,
} = require("../script-output/state-store");

const OPERATOR_SETTINGS_SCHEMA_VERSION = "script-agent.operator-settings.v0";
const OPERATOR_DRAFT_SCHEMA_VERSION = "script-agent.operator-draft.v0";
const OPERATOR_STAGE_SCHEMA_VERSION = "script-agent.operator-stage.v0";
const DEFAULT_DEEPSEEK_MODEL = "deepseek-chat";
const MAX_STAGE_MESSAGES = 20;
const DEEPSEEK_PRICING = {
  "deepseek-chat": { input: 0.27, cachedInput: 0.07, output: 1.10 },
  "deepseek-reasoner": { input: 0.55, cachedInput: 0.14, output: 2.19 },
};

const DEFAULT_SYSTEM_PROMPT = `
Je bent de schrijver voor de live theaterinstallatie "For You".
Werk snel en direct met de operator.

Schrijf alleen scene-tekst wanneer de operator daarom vraagt of wanneer er een voorbereide scene-prompt wordt gestuurd.
Gebruik de opgegeven situatie, personages en omgeving als harde context.
Begin een scene met "# Titel" en schrijf dialoog als "Personage: zin.".
Geen uitleg vooraf, geen nabrander.
`.trim();

const DEFAULT_PROMPT_TEMPLATE = `
Schrijf een speelbare scene voor de volgende klaargezette situatie.

Situatie: {situationTitle}
Omgeving: {environmentName}
Personages:
{characters}

Performer-slots:
{performerSlots}

Situatieprompt:
{runtimePrompt}

Regie:
- Houd het bruikbaar voor live spel.
- Gebruik alleen genoemde personages tenzij de operator anders vraagt.
- Eindig op een duidelijke wending of speelbare impuls.
`.trim();

function nowIso() {
  return new Date().toISOString();
}

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function normalizeText(value, max = 12000) {
  return String(value == null ? "" : value)
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .trim()
    .slice(0, max);
}

function normalizeSessionId(value) {
  return normalizeText(value || "show_default", 120).replace(/[^\w.-]+/g, "_") || "show_default";
}

function operatorSettingsFilePath() {
  return assertPathUnderV2(path.join(scriptAgentDbDir(), "operator-settings.json"));
}

function operatorSecretsFilePath() {
  return assertPathUnderV2(path.join(scriptAgentDbDir(), "operator-secrets.json"));
}

async function readJsonObject(filePath, fallback = {}) {
  try {
    const text = await fs.readFile(filePath, "utf8");
    const parsed = JSON.parse(text);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : fallback;
  } catch (err) {
    if (err && err.code === "ENOENT") return fallback;
    throw err;
  }
}

async function writeJsonObject(filePath, value, mode = 0o600) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, { encoding: "utf8", mode });
  try {
    await fs.chmod(filePath, mode);
  } catch {}
}

function defaultOperatorSettings() {
  return {
    schemaVersion: OPERATOR_SETTINGS_SCHEMA_VERSION,
    provider: "deepseek",
    model: DEFAULT_DEEPSEEK_MODEL,
    maxTokens: 4096,
    temperature: 0.8,
    systemPrompt: DEFAULT_SYSTEM_PROMPT,
    promptTemplate: DEFAULT_PROMPT_TEMPLATE,
    stageStyle: {
      font: "jetbrains",
      cursor: "underscore",
      fontSize: 30,
    },
    updatedAt: nowIso(),
  };
}

function normalizeOperatorSettings(input = {}, base = defaultOperatorSettings()) {
  const source = input && typeof input === "object" ? input : {};
  const model = normalizeText(source.model || base.model || DEFAULT_DEEPSEEK_MODEL, 120) || DEFAULT_DEEPSEEK_MODEL;
  return {
    schemaVersion: OPERATOR_SETTINGS_SCHEMA_VERSION,
    provider: "deepseek",
    model,
    maxTokens: Math.max(256, Math.min(16000, Number(source.maxTokens || base.maxTokens || 4096) || 4096)),
    temperature: Math.max(0, Math.min(2, Number(source.temperature ?? base.temperature ?? 0.8) || 0.8)),
    systemPrompt: normalizeText(source.systemPrompt || base.systemPrompt || DEFAULT_SYSTEM_PROMPT, 12000),
    promptTemplate: normalizeText(source.promptTemplate || base.promptTemplate || DEFAULT_PROMPT_TEMPLATE, 12000),
    stageStyle: normalizeStageStyle(source.stageStyle || base.stageStyle || {}),
    updatedAt: source.updatedAt || base.updatedAt || nowIso(),
  };
}

function normalizeStageStyle(input = {}) {
  const source = input && typeof input === "object" ? input : {};
  const font = String(source.font || "jetbrains").trim().toLowerCase();
  const cursor = String(source.cursor || "underscore").trim().toLowerCase();
  return {
    font: ["jetbrains", "ibm", "system", "courier"].includes(font) ? font : "jetbrains",
    cursor: ["underscore", "bar", "block"].includes(cursor) ? cursor : "underscore",
    fontSize: Math.max(24, Math.min(42, Number(source.fontSize || 30) || 30)),
  };
}

function interpolate(template, values = {}) {
  return String(template || "").replace(/\{(\w+)\}/g, (_match, key) => (
    Object.prototype.hasOwnProperty.call(values, key) ? String(values[key] || "") : ""
  )).replace(/\n{3,}/g, "\n\n").trim();
}

function buildOperatorPrompt(promptInput, settings = defaultOperatorSettings()) {
  if (!promptInput || typeof promptInput !== "object") throw new Error("script_agent_missing_prompt_input");
  const characters = (promptInput.characters || [])
    .map((item) => `- ${item.name}`)
    .join("\n") || "- geen personages";
  const performerSlots = (promptInput.performerSlots || [])
    .map((slot) => {
      const performer = slot.performerName || `slot ${slot.slotIndex}`;
      return `- Performer ${slot.slotIndex} (${performer}) speelt ${slot.characterName}`;
    })
    .join("\n") || "- geen performer-slots";
  return interpolate(settings.promptTemplate, {
    situationTitle: promptInput.situation && promptInput.situation.title || "",
    situationId: promptInput.situation && promptInput.situation.situationId || "",
    environmentName: promptInput.environment && promptInput.environment.name || "geen omgeving",
    characters,
    performerSlots,
    runtimePrompt: promptInput.promptText || "",
    showRunId: promptInput.showRunId || "",
  });
}

function providerUsageEmpty() {
  return {
    deepseek: {
      tokens_totaal: 0,
      kosten_totaal: 0,
    },
  };
}

function calculateDeepSeekCost(model, usage = {}) {
  const price = DEEPSEEK_PRICING[model] || DEEPSEEK_PRICING[DEFAULT_DEEPSEEK_MODEL];
  const prompt = Number(usage.prompt_tokens || usage.input_tokens || 0) || 0;
  const completion = Number(usage.completion_tokens || usage.output_tokens || 0) || 0;
  const cacheHit = Number(usage.prompt_cache_hit_tokens || 0) || 0;
  const cacheMiss = Number(usage.prompt_cache_miss_tokens || Math.max(0, prompt - cacheHit)) || 0;
  const cost = (cacheMiss * price.input) + (cacheHit * price.cachedInput) + (completion * price.output);
  return {
    input: prompt,
    output: completion,
    cached: cacheHit,
    cost: Number((cost / 1_000_000).toFixed(6)),
  };
}

function parseSseEvent(raw) {
  const data = [];
  for (const line of String(raw || "").split(/\r?\n/)) {
    if (!line || line.startsWith(":")) continue;
    if (line.startsWith("data:")) data.push(line.slice(5).trimStart());
  }
  return data.join("\n");
}

async function readSseStream(body, onData) {
  if (!body) throw new Error("deepseek_stream_body_missing");
  const decoder = new TextDecoder();
  let buffer = "";
  const push = async (chunk) => {
    buffer += decoder.decode(chunk, { stream: true }).replace(/\r\n/g, "\n").replace(/\r/g, "\n");
    let index = buffer.indexOf("\n\n");
    while (index >= 0) {
      const raw = buffer.slice(0, index);
      buffer = buffer.slice(index + 2);
      const data = parseSseEvent(raw);
      if (data && data !== "[DONE]") {
        let parsed = null;
        try {
          parsed = JSON.parse(data);
        } catch {
          parsed = { raw: data };
        }
        await onData(parsed);
      }
      index = buffer.indexOf("\n\n");
    }
  };
  if (typeof body.getReader === "function") {
    const reader = body.getReader();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      await push(value);
    }
  } else {
    for await (const chunk of body) await push(chunk);
  }
}

async function responseError(response, fallback) {
  const raw = await response.text().catch(() => "");
  let parsed = null;
  try {
    parsed = raw ? JSON.parse(raw) : null;
  } catch {}
  const message = parsed && parsed.error && parsed.error.message
    ? parsed.error.message
    : raw || `${fallback}_${response.status}`;
  return new Error(normalizeText(message, 300).replace(/sk-[A-Za-z0-9_-]+/g, "sk-..."));
}

function createOperatorService(options = {}) {
  const emitter = new EventEmitter();
  const clients = options.clients || {};
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  const env = options.env || process.env;
  const sessions = new Map();
  let settingsCache = null;
  let draft = null;
  let stageState = {
    schemaVersion: OPERATOR_STAGE_SCHEMA_VERSION,
    sessionId: "show_default",
    provider: "deepseek",
    model: DEFAULT_DEEPSEEK_MODEL,
    draft: "",
    revision: 0,
    streaming: false,
    style: defaultOperatorSettings().stageStyle,
    active: null,
    messages: [],
    updatedAt: nowIso(),
  };

  function emitStage(reason = "state") {
    emitter.emit("stage", {
      type: "operator_stage_state",
      reason,
      stage: snapshotStage(),
    });
  }

  function getSession(sessionId) {
    const id = normalizeSessionId(sessionId);
    if (!sessions.has(id)) {
      sessions.set(id, {
        sessionId: id,
        messages: [],
        providerUsage: providerUsageEmpty(),
        tokensTotal: 0,
        costTotal: 0,
        createdAt: nowIso(),
      });
    }
    return sessions.get(id);
  }

  async function readSettings() {
    if (settingsCache) return settingsCache;
    const fileSettings = await readJsonObject(operatorSettingsFilePath(), {});
    settingsCache = normalizeOperatorSettings(fileSettings);
    stageState.style = normalizeStageStyle(settingsCache.stageStyle);
    stageState.model = settingsCache.model;
    return settingsCache;
  }

  async function saveSettings(patch = {}) {
    const current = await readSettings();
    settingsCache = normalizeOperatorSettings({ ...current, ...patch, updatedAt: nowIso() }, current);
    await writeJsonObject(operatorSettingsFilePath(), settingsCache, 0o644);
    stageState.style = normalizeStageStyle(settingsCache.stageStyle);
    stageState.model = settingsCache.model;
    stageState.updatedAt = nowIso();
    emitStage("settings_updated");
    return settingsCache;
  }

  async function readSecrets() {
    return readJsonObject(operatorSecretsFilePath(), {});
  }

  async function saveSecrets(patch = {}) {
    const current = await readSecrets();
    const next = { ...current };
    if (Object.prototype.hasOwnProperty.call(patch, "deepSeekApiKey")) {
      const apiKey = typeof patch.deepSeekApiKey === "string" ? patch.deepSeekApiKey.trim() : "";
      if (apiKey) {
        next.DEEPSEEK_API_KEY = apiKey;
      } else {
        delete next.DEEPSEEK_API_KEY;
      }
    }
    if (patch.clearDeepSeekApiKey === true) {
      delete next.DEEPSEEK_API_KEY;
    }
    next.updatedAt = nowIso();
    await writeJsonObject(operatorSecretsFilePath(), next, 0o600);
    return secretsStatusFrom(next);
  }

  function deepSeekApiKeyFrom(secrets = {}) {
    return normalizeText(
      secrets.DEEPSEEK_API_KEY || env.DEEPSEEK_API_KEY || env.FORYOU_DEEPSEEK_API_KEY || "",
      1000
    );
  }

  function secretsStatusFrom(secrets = {}) {
    const localConfigured = !!normalizeText(secrets.DEEPSEEK_API_KEY || "", 1000);
    const envConfigured = !!normalizeText(env.DEEPSEEK_API_KEY || env.FORYOU_DEEPSEEK_API_KEY || "", 1000);
    return {
      ok: true,
      provider: "deepseek",
      deepseek: {
        configured: localConfigured || envConfigured,
        source: localConfigured ? "local" : envConfigured ? "env" : null,
      },
      updatedAt: secrets.updatedAt || null,
    };
  }

  async function secretsStatus() {
    return secretsStatusFrom(await readSecrets());
  }

  function snapshotStage() {
    return cloneJson(stageState);
  }

  function updateStageDraft(text, options = {}) {
    stageState.draft = normalizeText(text, 12000);
    stageState.revision = Math.max(Number(stageState.revision || 0) + 1, Number(options.revision || 0) || 0);
    stageState.updatedAt = nowIso();
    if (draft) {
      draft.text = stageState.draft;
      draft.revision = stageState.revision;
      draft.updatedAt = stageState.updatedAt;
    }
    emitStage("draft_updated");
    return draft || {
      schemaVersion: OPERATOR_DRAFT_SCHEMA_VERSION,
      text: stageState.draft,
      revision: stageState.revision,
      updatedAt: stageState.updatedAt,
    };
  }

  async function createDraftFromRuntime(runtimeState = null, options = {}) {
    const settings = await readSettings();
    const runtimeResult = runtimeState
      ? { ok: true, state: runtimeState }
      : await clients.fetchCurrentRuntimeState();
    if (!runtimeResult || !runtimeResult.ok) {
      throw new Error(`script_agent_runtime_unavailable:${runtimeResult && runtimeResult.error || "unknown"}`);
    }
    const promptInput = buildPromptInput(runtimeResult.state);
    if (draft && draft.contentHash === promptInput.contentHash && !options.force) return draft;
    await appendPromptInput(promptInput);
    const text = buildOperatorPrompt(promptInput, settings);
    draft = {
      schemaVersion: OPERATOR_DRAFT_SCHEMA_VERSION,
      draftId: `${promptInput.promptInputId}:operator-draft`,
      promptInputId: promptInput.promptInputId,
      showRunId: promptInput.showRunId,
      situationId: promptInput.situation.situationId,
      situationTitle: promptInput.situation.title || "",
      contentHash: promptInput.contentHash,
      text,
      revision: Number(stageState.revision || 0) + 1,
      source: {
        type: "runtime-prepared-next",
        readOnly: true,
      },
      createdAt: nowIso(),
      updatedAt: nowIso(),
      promptInput,
    };
    stageState.sessionId = normalizeSessionId(promptInput.showRunId || stageState.sessionId);
    stageState.draft = text;
    stageState.revision = draft.revision;
    stageState.provider = "deepseek";
    stageState.model = settings.model;
    stageState.updatedAt = draft.updatedAt;
    emitStage("draft_from_runtime");
    return draft;
  }

  async function currentDraft(options = {}) {
    if (options.refreshRuntime || !draft) {
      try {
        await createDraftFromRuntime(null, { force: false });
      } catch (err) {
        if (!draft) throw err;
      }
    }
    return draft;
  }

  function sessionInfo(sessionId) {
    const session = getSession(sessionId);
    return {
      ok: true,
      sessionId: session.sessionId,
      messages: session.messages.slice(),
      turnCount: Math.floor(session.messages.length / 2),
      providerUsage: cloneJson(session.providerUsage),
      tokensTotal: session.tokensTotal,
      costTotal: Number(Number(session.costTotal || 0).toFixed(4)),
    };
  }

  function undo(sessionId) {
    const session = getSession(sessionId);
    if (session.messages.length < 2) throw new Error("script_agent_operator_no_turn_to_undo");
    session.messages = session.messages.slice(0, -2);
    stageState.messages = stageState.messages.slice(0, -2);
    stageState.updatedAt = nowIso();
    emitStage("undo");
    return sessionInfo(sessionId);
  }

  function clearSession(sessionId) {
    const session = getSession(sessionId);
    session.messages = [];
    stageState.messages = [];
    stageState.updatedAt = nowIso();
    emitStage("clear_session");
    return sessionInfo(sessionId);
  }

  function recordUsage(session, priced) {
    const tokens = Number(priced.input || 0) + Number(priced.output || 0);
    session.tokensTotal += tokens;
    session.costTotal = Number((session.costTotal + Number(priced.cost || 0)).toFixed(6));
    session.providerUsage.deepseek.tokens_totaal += tokens;
    session.providerUsage.deepseek.kosten_totaal = Number(
      (session.providerUsage.deepseek.kosten_totaal + Number(priced.cost || 0)).toFixed(6)
    );
  }

  async function streamChat(body = {}, emit = () => {}) {
    const settings = await readSettings();
    const secrets = await readSecrets();
    const apiKey = deepSeekApiKeyFrom(secrets);
    if (!apiKey) throw new Error("deepseek_api_key_missing");
    if (typeof fetchImpl !== "function") throw new Error("fetch_unavailable");
    const sessionId = normalizeSessionId(body.sessionId || body.sessie_id || stageState.sessionId);
    const session = getSession(sessionId);
    const activeDraft = body.promptInput
      ? {
        promptInput: body.promptInput,
        promptInputId: body.promptInput.promptInputId,
        text: normalizeText(body.message || buildOperatorPrompt(body.promptInput, settings), 12000),
      }
      : await currentDraft({ refreshRuntime: !draft });
    const promptInput = body.promptInput || (activeDraft && activeDraft.promptInput)
      || (activeDraft && activeDraft.promptInputId ? await readPromptInput(activeDraft.promptInputId) : null);
    const userText = normalizeText(body.message || activeDraft.text || stageState.draft, 12000);
    if (!userText) throw new Error("script_agent_operator_message_required");
    if (!promptInput) throw new Error("script_agent_operator_prompt_input_missing");

    const assistantId = `assistant_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
    const userMessage = {
      id: `user_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`,
      role: "user",
      content: userText,
      at: nowIso(),
    };
    const assistantMessage = {
      id: assistantId,
      role: "assistant",
      content: "",
      streaming: true,
      provider: "deepseek",
      model: settings.model,
      at: nowIso(),
    };
    stageState.sessionId = sessionId;
    stageState.streaming = true;
    stageState.active = {
      assistantId,
      promptInputId: promptInput.promptInputId,
      situationId: promptInput.situation.situationId,
      startedAt: assistantMessage.at,
      provider: "deepseek",
      model: settings.model,
    };
    stageState.draft = "";
    stageState.messages.push(userMessage, assistantMessage);
    stageState.messages = stageState.messages.slice(-MAX_STAGE_MESSAGES);
    stageState.updatedAt = nowIso();
    emitStage("chat_started");
    emit({ type: "start", assistantId, provider: "deepseek", model: settings.model });

    const messages = [
      { role: "system", content: settings.systemPrompt },
      ...session.messages.slice(-8).map((message) => ({
        role: message.role === "assistant" ? "assistant" : "user",
        content: normalizeText(message.content, 12000),
      })),
      { role: "user", content: userText },
    ];
    let fullText = "";
    let usage = {};
    try {
      const response = await fetchImpl("https://api.deepseek.com/chat/completions", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: settings.model,
          messages,
          max_tokens: settings.maxTokens,
          temperature: settings.temperature,
          stream: true,
          stream_options: { include_usage: true },
        }),
      });
      if (!response.ok) throw await responseError(response, "deepseek_api_error");

      await readSseStream(response.body, async (data) => {
        if (data.error) {
          const message = data.error && data.error.message ? data.error.message : "deepseek_stream_error";
          throw new Error(message);
        }
        if (data.usage) usage = { ...usage, ...data.usage };
        const choices = Array.isArray(data.choices) ? data.choices : [];
        for (const choice of choices) {
          const delta = choice && choice.delta ? choice.delta.content : "";
          if (!delta) continue;
          fullText += String(delta);
          assistantMessage.content = fullText;
          stageState.updatedAt = nowIso();
          emitter.emit("stage", {
            type: "operator_stage_delta",
            assistantId,
            text: String(delta),
            fullText,
            updatedAt: stageState.updatedAt,
          });
          emit({ type: "delta", assistantId, text: String(delta), fullText });
        }
      });
    } catch (err) {
      const message = err && err.message ? String(err.message) : "deepseek_stream_error";
      assistantMessage.streaming = false;
      assistantMessage.error = normalizeText(message, 300);
      stageState.streaming = false;
      stageState.active = null;
      stageState.updatedAt = nowIso();
      emitter.emit("stage", {
        type: "operator_stage_error",
        assistantId,
        error: assistantMessage.error,
        stage: snapshotStage(),
      });
      emit({ type: "error", assistantId, error: assistantMessage.error });
      throw err;
    }

    const priced = calculateDeepSeekCost(settings.model, usage);
    recordUsage(session, priced);
    session.messages.push({ role: "user", content: userText, at: userMessage.at });
    session.messages.push({ role: "assistant", content: fullText, at: nowIso() });
    assistantMessage.streaming = false;
    assistantMessage.meta = {
      provider: "deepseek",
      model: settings.model,
      tokens_input: priced.input,
      tokens_output: priced.output,
      cached_tokens: priced.cached,
      kosten_dollar: priced.cost,
      provider_usage: cloneJson(session.providerUsage),
      provider_tokens_totaal: session.providerUsage.deepseek.tokens_totaal,
      provider_kosten_totaal: session.providerUsage.deepseek.kosten_totaal,
      sessie_tokens_totaal: session.tokensTotal,
      sessie_kosten_totaal: Number(Number(session.costTotal || 0).toFixed(4)),
      turn_count: Math.floor(session.messages.length / 2),
    };
    const scriptOutput = createScriptOutput({ promptInput, scriptText: fullText });
    await appendScriptOutput(scriptOutput);
    stageState.streaming = false;
    stageState.active = null;
    stageState.updatedAt = nowIso();
    const done = {
      type: "done",
      assistantId,
      provider: "deepseek",
      model: settings.model,
      text: fullText,
      promptInputId: promptInput.promptInputId,
      scriptOutput,
      ...assistantMessage.meta,
    };
    emit(done);
    emitStage("chat_done");
    return done;
  }

  async function status() {
    const settings = await readSettings();
    let latestScriptOutput = null;
    try {
      latestScriptOutput = await readLatestScriptOutput({});
    } catch {}
    return {
      ok: true,
      provider: "deepseek",
      model: settings.model,
      activeSessions: sessions.size,
      draft: draft ? {
        promptInputId: draft.promptInputId,
        showRunId: draft.showRunId,
        situationId: draft.situationId,
        situationTitle: draft.situationTitle,
        revision: draft.revision,
        updatedAt: draft.updatedAt,
      } : null,
      stage: snapshotStage(),
      secrets: await secretsStatus(),
      latestScriptOutput: latestScriptOutput ? {
        scriptId: latestScriptOutput.scriptId,
        promptInputId: latestScriptOutput.promptInputId,
        situationId: latestScriptOutput.situationId,
        createdAt: latestScriptOutput.createdAt,
      } : null,
    };
  }

  return {
    buildOperatorPrompt,
    clearSession,
    createDraftFromRuntime,
    currentDraft,
    emitter,
    normalizeOperatorSettings,
    readSettings,
    saveSecrets,
    saveSettings,
    secretsStatus,
    sessionInfo,
    snapshotStage,
    status,
    streamChat,
    undo,
    updateStageDraft,
  };
}

module.exports = {
  DEFAULT_DEEPSEEK_MODEL,
  OPERATOR_DRAFT_SCHEMA_VERSION,
  OPERATOR_SETTINGS_SCHEMA_VERSION,
  OPERATOR_STAGE_SCHEMA_VERSION,
  buildOperatorPrompt,
  createOperatorService,
  defaultOperatorSettings,
  normalizeOperatorSettings,
};
