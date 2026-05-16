"use strict";

const fs = require("fs");

const DEFAULT_PROVIDER = "anthropic";
const DEFAULT_ANTHROPIC_MODEL = "claude-sonnet-4-6";
const DEFAULT_OPENAI_MODEL = "gpt-5.4-mini";
const DEFAULT_DEEPSEEK_MODEL = "deepseek-v4-flash";
const MAX_HISTORY = 10;
const MAX_LIVECHAT = 50;
const MAX_CHAT_MESSAGES_FOR_PROVIDER = 50;
const TOKEN_WARNING_THRESHOLD = 500_000;

const ANTHROPIC_MODELS = Object.freeze([
  "claude-sonnet-4-6",
  "claude-opus-4-7",
  "claude-opus-4-6",
  "claude-haiku-4-5",
]);

const OPENAI_MODELS = Object.freeze([
  "gpt-5.4-mini",
  "gpt-5.5",
  "gpt-5.4",
  "gpt-5.4-nano",
  "gpt-5-mini",
]);

const DEEPSEEK_MODELS = Object.freeze([
  "deepseek-v4-flash",
  "deepseek-v4-pro",
]);

const ANTHROPIC_PRICING = Object.freeze({
  "claude-sonnet-4-6": { input: 3.00, output: 15.00 },
  "claude-opus-4-7": { input: 5.00, output: 25.00 },
  "claude-opus-4-6": { input: 5.00, output: 25.00 },
  "claude-haiku-4-5": { input: 1.00, output: 5.00 },
});

const OPENAI_PRICING = Object.freeze({
  "gpt-5.5": { input: 5.00, cachedInput: 0.50, output: 30.00 },
  "gpt-5.4": { input: 2.50, cachedInput: 0.25, output: 15.00 },
  "gpt-5.4-mini": { input: 0.75, cachedInput: 0.075, output: 4.50 },
  "gpt-5.4-nano": { input: 0.20, cachedInput: 0.02, output: 1.25 },
  "gpt-5-mini": { input: 0.25, cachedInput: 0.025, output: 2.00 },
});

const DEEPSEEK_PRICING = Object.freeze({
  "deepseek-v4-flash": { input: 0.14, cachedInput: 0.0028, output: 0.28 },
  "deepseek-v4-pro": { input: 0.435, cachedInput: 0.003625, output: 0.87 },
});

const CHAT_INSTRUCTIONS = `
## SCHRIJFINSTRUCTIES - CHAT MODUS

Je bent de schrijver voor de live theaterinstallatie "For You".
Je werkt samen met de operator in een doorlopend gesprek tijdens de show.

WANNEER JE EEN SCENE SCHRIJFT:
- Begin direct met "# Titel" op een aparte regel
- Lege regel daarna
- Dialoog in format "Personage: zin." per regel, een personage per regel
- Geen intro, preamble of uitleg vooraf
- Houd je aan de woordlimiet als die gegeven wordt
- Gebruik personages, omgevingen en situaties exact zoals beschreven in de database
- Eindig op een wending, cliffhanger of pakkend moment
- De humor is absurdistisch, ongecensureerd en grensverleggend

WANNEER DE OPERATOR FEEDBACK GEEFT:
- Reageer met maximaal 1 zin wat je gaat aanpassen
- Schrijf direct daarna de nieuwe scene volgens hetzelfde format

WANNEER DE OPERATOR EEN VRAAG STELT:
- Antwoord beknopt in normale tekst
- Schrijf alleen een scene als de operator daar expliciet om vraagt

LET OP: dit is een live show. Snel en direct, geen vulwoorden.
`.trim();

function nowIso() {
  return new Date().toISOString();
}

function normalizeText(value, max = 2000) {
  return String(value === undefined || value === null ? "" : value)
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .trim()
    .slice(0, max);
}

function normalizeSessionId(value) {
  return normalizeText(value || "show_default", 120).replace(/[^\w.-]+/g, "_") || "show_default";
}

function clampInt(value, min, max, fallback) {
  const n = Number.parseInt(String(value), 10);
  if (!Number.isFinite(n)) return fallback;
  if (n < min) return min;
  if (n > max) return max;
  return n;
}

function numericId(value) {
  const n = Number.parseInt(String(value), 10);
  return Number.isInteger(n) && n > 0 ? n : 0;
}

function uniqueNumericIds(values = []) {
  const out = [];
  const seen = new Set();
  for (const value of Array.isArray(values) ? values : []) {
    const id = numericId(value);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

function activeItems(items = []) {
  return (Array.isArray(items) ? items : []).filter((item) => {
    if (!item || !numericId(item.id)) return false;
    if (item.archivedAt) return false;
    return item.isActive !== false;
  });
}

function safePublicError(err, fallback = "operator_ai_error") {
  return normalizeText(err && err.message ? err.message : fallback, 300)
    .replace(/sk-[A-Za-z0-9_-]+/g, "sk-...");
}

function anthropicApiKey(env) {
  return normalizeText(env.ANTHROPIC_API_KEY || env.CLAUDE_API_KEY || "", 1000);
}

function openAiApiKey(env) {
  return normalizeText(env.OPENAI_API_KEY || "", 1000);
}

function deepSeekApiKey(env) {
  return normalizeText(env.DEEPSEEK_API_KEY || env.FORYOU_DEEPSEEK_API_KEY || "", 1000);
}

function providerUsageEmpty() {
  return {
    anthropic: { tokens_totaal: 0, kosten_totaal: 0 },
    openai: { tokens_totaal: 0, kosten_totaal: 0 },
    deepseek: { tokens_totaal: 0, kosten_totaal: 0 },
  };
}

function ensureProviderUsage(session) {
  const usage = session.provider_usage || providerUsageEmpty();
  for (const provider of ["anthropic", "openai", "deepseek"]) {
    usage[provider] = usage[provider] || { tokens_totaal: 0, kosten_totaal: 0 };
    usage[provider].tokens_totaal = Number(usage[provider].tokens_totaal || 0);
    usage[provider].kosten_totaal = Number(usage[provider].kosten_totaal || 0);
  }
  session.provider_usage = usage;
  return usage;
}

function usageNumber(usage, key) {
  if (!usage || typeof usage !== "object") return 0;
  return Math.max(0, Number(usage[key] || 0) || 0);
}

function calculateAnthropicCost(model, usage) {
  const price = ANTHROPIC_PRICING[model] || ANTHROPIC_PRICING[DEFAULT_ANTHROPIC_MODEL];
  const input = usageNumber(usage, "input_tokens");
  const cacheCreate = usageNumber(usage, "cache_creation_input_tokens");
  const cacheRead = usageNumber(usage, "cache_read_input_tokens");
  const output = usageNumber(usage, "output_tokens");
  const cost = (input * price.input)
    + (cacheCreate * price.input * 2)
    + (cacheRead * price.input * 0.1)
    + (output * price.output);
  return Number((cost / 1_000_000).toFixed(6));
}

function calculateOpenAiCost(model, usage) {
  const price = OPENAI_PRICING[model] || OPENAI_PRICING[DEFAULT_OPENAI_MODEL];
  const input = usageNumber(usage, "input_tokens");
  const output = usageNumber(usage, "output_tokens");
  const details = usage && typeof usage === "object" ? usage.input_tokens_details || {} : {};
  const cached = usageNumber(details, "cached_tokens");
  const uncached = Math.max(0, input - cached);
  const cost = (uncached * price.input) + (cached * price.cachedInput) + (output * price.output);
  return {
    cost: Number((cost / 1_000_000).toFixed(6)),
    input,
    output,
    cached,
  };
}

function calculateDeepSeekCost(model, usage) {
  const price = DEEPSEEK_PRICING[model] || DEEPSEEK_PRICING[DEFAULT_DEEPSEEK_MODEL];
  const prompt = usageNumber(usage, "prompt_tokens") || usageNumber(usage, "input_tokens");
  const completion = usageNumber(usage, "completion_tokens") || usageNumber(usage, "output_tokens");
  const cacheHit = usageNumber(usage, "prompt_cache_hit_tokens");
  const cacheMiss = usageNumber(usage, "prompt_cache_miss_tokens");
  const uncached = cacheMiss || Math.max(0, prompt - cacheHit);
  const cost = (uncached * price.input) + (cacheHit * price.cachedInput) + (completion * price.output);
  return {
    cost: Number((cost / 1_000_000).toFixed(6)),
    input: prompt,
    output: completion,
    cached: cacheHit,
  };
}

function mergeUsage(target, source) {
  if (!source || typeof source !== "object") return target;
  for (const [key, value] of Object.entries(source)) {
    if (value && typeof value === "object" && !Array.isArray(value)) {
      target[key] = mergeUsage(target[key] && typeof target[key] === "object" ? target[key] : {}, value);
    } else if (Number.isFinite(Number(value))) {
      target[key] = Number(value);
    }
  }
  return target;
}

function parseSseEvent(raw) {
  const event = { event: "", data: "" };
  const data = [];
  for (const line of String(raw || "").split(/\r?\n/)) {
    if (!line || line.startsWith(":")) continue;
    if (line.startsWith("event:")) event.event = line.slice(6).trim();
    if (line.startsWith("data:")) data.push(line.slice(5).trimStart());
  }
  event.data = data.join("\n");
  return event;
}

async function readSseStream(body, onEvent) {
  if (!body) throw new Error("stream_body_missing");
  const decoder = new TextDecoder();
  let buffer = "";

  async function pushChunk(chunk) {
    buffer += decoder.decode(chunk, { stream: true });
    let index = buffer.indexOf("\n\n");
    while (index >= 0) {
      const rawEvent = buffer.slice(0, index);
      buffer = buffer.slice(index + 2);
      const event = parseSseEvent(rawEvent);
      if (event.data && event.data !== "[DONE]") {
        let parsed = null;
        try {
          parsed = JSON.parse(event.data);
        } catch {
          parsed = { raw: event.data };
        }
        onEvent(parsed, event);
      }
      index = buffer.indexOf("\n\n");
    }
  }

  if (typeof body.getReader === "function") {
    const reader = body.getReader();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      await pushChunk(value);
    }
  } else {
    for await (const chunk of body) {
      await pushChunk(chunk);
    }
  }

  if (buffer.trim()) {
    const event = parseSseEvent(buffer);
    if (event.data && event.data !== "[DONE]") {
      let parsed = null;
      try {
        parsed = JSON.parse(event.data);
      } catch {
        parsed = { raw: event.data };
      }
      onEvent(parsed, event);
    }
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
    : parsed && parsed.detail
      ? parsed.detail
      : raw || `${fallback}_${response.status}`;
  return new Error(safePublicError({ message }, `${fallback}_${response.status}`));
}

function normalizeProvider(value) {
  const raw = normalizeText(value || DEFAULT_PROVIDER, 40).toLowerCase();
  if (raw === "claude" || raw === "anthropic") return "anthropic";
  if (raw === "openai" || raw === "gpt") return "openai";
  if (raw === "deepseek" || raw === "deepseeker") return "deepseek";
  throw new Error("provider_not_supported");
}

function normalizeModel(provider, value) {
  const raw = normalizeText(value, 80);
  if (provider === "anthropic") {
    if (!raw) return DEFAULT_ANTHROPIC_MODEL;
    if (!ANTHROPIC_MODELS.includes(raw)) throw new Error("anthropic_model_not_supported");
    return raw;
  }
  if (provider === "openai") {
    if (!raw) return DEFAULT_OPENAI_MODEL;
    if (!OPENAI_MODELS.includes(raw) && !raw.startsWith("gpt-")) throw new Error("openai_model_not_supported");
    return raw;
  }
  if (provider === "deepseek") {
    if (!raw) return DEFAULT_DEEPSEEK_MODEL;
    if (!DEEPSEEK_MODELS.includes(raw)) throw new Error("deepseek_model_not_supported");
    return raw;
  }
  throw new Error("provider_not_supported");
}

function createOperatorAi(options = {}) {
  const env = options.env || process.env;
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  const logger = typeof options.logger === "function" ? options.logger : () => {};
  const sessions = new Map();
  const databaseCache = { filePath: "", mtimeMs: 0, content: "" };

  function log(event, meta = {}) {
    try {
      logger(event, meta);
    } catch {}
  }

  async function notifyOutput(payload = {}) {
    if (typeof options.onOutput !== "function") return null;
    try {
      return await options.onOutput(payload);
    } catch (err) {
      const error = safePublicError(err, "operator_output_failed");
      log("operator_output_failed", { message: error });
      return { ok: false, error };
    }
  }

  function getSession(sessieId) {
    const id = normalizeSessionId(sessieId);
    if (!sessions.has(id)) {
      sessions.set(id, {
        sessie_id: id,
        scenes: [],
        livechat: [],
        messages: [],
        tokens_totaal: 0,
        kosten_totaal: 0,
        provider_usage: providerUsageEmpty(),
        created_at: nowIso(),
      });
    }
    const session = sessions.get(id);
    ensureProviderUsage(session);
    return session;
  }

  function databasePaths() {
    const raw = typeof options.getDatabaseMarkdownPaths === "function"
      ? options.getDatabaseMarkdownPaths()
      : [];
    return (Array.isArray(raw) ? raw : [raw])
      .filter(Boolean)
      .map((item) => String(item));
  }

  function databaseStatus() {
    return databasePaths().map((filePath) => {
      try {
        const stat = fs.statSync(filePath);
        return {
          filePath,
          exists: true,
          bytes: Number(stat.size || 0),
          mtimeMs: Math.round(Number(stat.mtimeMs || 0)),
          updatedAt: new Date(stat.mtimeMs).toISOString(),
        };
      } catch {
        return { filePath, exists: false };
      }
    });
  }

  function readDatabaseMarkdown() {
    const paths = databasePaths();
    const filePath = paths.find((candidate) => {
      try {
        return fs.statSync(candidate).isFile();
      } catch {
        return false;
      }
    }) || paths[0] || "";
    if (!filePath) throw new Error("database_md_path_missing");
    let stat = null;
    try {
      stat = fs.statSync(filePath);
    } catch {
      throw new Error("database_md_missing");
    }
    const mtimeMs = Math.round(Number(stat.mtimeMs || 0));
    if (databaseCache.filePath !== filePath || databaseCache.mtimeMs !== mtimeMs || !databaseCache.content) {
      databaseCache.filePath = filePath;
      databaseCache.mtimeMs = mtimeMs;
      databaseCache.content = fs.readFileSync(filePath, "utf8");
      log("operator_database_loaded", { filePath, bytes: databaseCache.content.length });
    }
    return databaseCache.content;
  }

  function getOpenAiVectorStoreId(value = "") {
    const explicit = normalizeText(value, 160);
    if (/^vs_[A-Za-z0-9_-]+$/.test(explicit)) return explicit;
    const fromEnv = normalizeText(env.FORYOU_OPENAI_VECTOR_STORE_ID || env.OPENAI_VECTOR_STORE_ID || "", 160);
    if (/^vs_[A-Za-z0-9_-]+$/.test(fromEnv)) return fromEnv;
    if (typeof options.getOpenAiStatus === "function") {
      const status = options.getOpenAiStatus() || {};
      const fromStatus = normalizeText(status.vectorStoreId || "", 160);
      if (/^vs_[A-Za-z0-9_-]+$/.test(fromStatus)) return fromStatus;
    }
    return "";
  }

  function providerStatus() {
    const vectorStoreId = getOpenAiVectorStoreId();
    return {
      default_provider: DEFAULT_PROVIDER,
      providers: {
        anthropic: {
          ready: !!anthropicApiKey(env),
          models: ANTHROPIC_MODELS.slice(),
          default_model: DEFAULT_ANTHROPIC_MODEL,
        },
        openai: {
          ready: !!openAiApiKey(env) && !!vectorStoreId,
          api_ready: !!openAiApiKey(env),
          vector_store_configured: !!vectorStoreId,
          vectorStoreId,
          models: OPENAI_MODELS.slice(),
          default_model: DEFAULT_OPENAI_MODEL,
        },
        deepseek: {
          ready: !!deepSeekApiKey(env),
          models: DEEPSEEK_MODELS.slice(),
          default_model: DEFAULT_DEEPSEEK_MODEL,
        },
      },
    };
  }

  function assertProviderReady(provider, vectorStoreId = "") {
    if (typeof fetchImpl !== "function") throw new Error("fetch_unavailable");
    if (provider === "anthropic" && !anthropicApiKey(env)) {
      throw new Error("anthropic_api_key_missing");
    }
    if (provider === "openai") {
      if (!openAiApiKey(env)) throw new Error("openai_api_key_missing");
      if (!vectorStoreId) throw new Error("openai_vector_store_id_missing");
    }
    if (provider === "deepseek" && !deepSeekApiKey(env)) {
      throw new Error("deepseek_api_key_missing");
    }
  }

  function recordUsage(session, provider, tokens, cost) {
    session.tokens_totaal = Number(session.tokens_totaal || 0) + Math.max(0, Number(tokens || 0) || 0);
    session.kosten_totaal = Number((Number(session.kosten_totaal || 0) + Math.max(0, Number(cost || 0) || 0)).toFixed(6));
    const usage = ensureProviderUsage(session);
    const bucket = usage[provider] || { tokens_totaal: 0, kosten_totaal: 0 };
    bucket.tokens_totaal = Number(bucket.tokens_totaal || 0) + Math.max(0, Number(tokens || 0) || 0);
    bucket.kosten_totaal = Number((Number(bucket.kosten_totaal || 0) + Math.max(0, Number(cost || 0) || 0)).toFixed(6));
    usage[provider] = bucket;
  }

  function catalogIndex() {
    const catalog = typeof options.getCatalog === "function" ? options.getCatalog() : {};
    const settings = typeof options.getSettings === "function" ? options.getSettings() : {};
    const characters = activeItems(catalog.characters).map((item) => ({
      id: String(item.id),
      naam: normalizeText(item.name, 160),
      beschrijving: normalizeText(item.description, 600),
      dbId: Number(item.id),
    })).sort((a, b) => a.naam.localeCompare(b.naam, "nl-NL"));
    const environments = activeItems(catalog.environments).map((item) => ({
      id: String(item.id),
      naam: normalizeText(item.name, 160),
      beschrijving: normalizeText(item.description, 600),
      dbId: Number(item.id),
    })).sort((a, b) => a.naam.localeCompare(b.naam, "nl-NL"));
    const situationsById = new Map(activeItems(catalog.situations).map((item) => [Number(item.id), item]));
    const charactersById = new Map(characters.map((item) => [Number(item.dbId), item]));
    const environmentsById = new Map(environments.map((item) => [Number(item.dbId), item]));
    const scenes = activeItems(catalog.scenes).map((scene) => {
      const characterIds = uniqueNumericIds([]
        .concat(scene.characterIds || [])
        .concat(scene.characterSlots || []))
        .filter((id) => charactersById.has(id));
      const situationIds = uniqueNumericIds(scene.situationIds || []);
      const situationNames = situationIds
        .map((id) => situationsById.get(id))
        .filter(Boolean)
        .map((item) => normalizeText(item.name, 160));
      const situationDescriptions = situationIds
        .map((id) => situationsById.get(id))
        .filter(Boolean)
        .map((item) => normalizeText(item.description, 400))
        .filter(Boolean);
      const environment = scene.environmentId ? environmentsById.get(Number(scene.environmentId)) : null;
      const prompt = typeof options.buildScenePrompt === "function"
        ? normalizeText(options.buildScenePrompt(scene, catalog), 12000)
        : "";
      return {
        id: String(scene.id),
        sceneId: Number(scene.id),
        naam: normalizeText(scene.title, 200),
        beschrijving: normalizeText(scene.promptOverride || situationDescriptions.join(" "), 700),
        characterIds: characterIds.map(String),
        characterNames: characterIds.map((id) => charactersById.get(id).naam),
        environmentId: environment ? String(environment.id) : "",
        environmentName: environment ? environment.naam : "",
        promptOverride: normalizeText(scene.promptOverride || "", 1200),
        situationIds: situationIds.map(String),
        situationNames,
        prompt,
        dbId: Number(scene.id),
      };
    }).sort((a, b) => a.naam.localeCompare(b.naam, "nl-NL"));
    return {
      personages: characters,
      omgevingen: environments,
      situaties: scenes,
      promptSettings: {
        globalPrompt: normalizeText(settings.globalPrompt, 8000),
        promptTemplate: normalizeText(settings.promptTemplate, 8000),
      },
      generatedAt: nowIso(),
    };
  }

  function status() {
    let indexCounts = { personages: 0, omgevingen: 0, situaties: 0 };
    try {
      const index = catalogIndex();
      indexCounts = {
        personages: index.personages.length,
        omgevingen: index.omgevingen.length,
        situaties: index.situaties.length,
      };
    } catch (err) {
      log("operator_catalog_index_failed", { message: safePublicError(err) });
    }
    return {
      ok: true,
      activeSessions: sessions.size,
      indexCounts,
      databaseMd: databaseStatus(),
      osc: typeof options.getOscStatus === "function" ? options.getOscStatus() : null,
      ...providerStatus(),
    };
  }

  function chatHistory(sessieId) {
    const id = normalizeSessionId(sessieId);
    const session = sessions.get(id);
    if (!session) {
      return {
        sessie_id: id,
        messages: [],
        turn_count: 0,
        provider_usage: providerUsageEmpty(),
        tokens_totaal: 0,
        kosten_totaal: 0,
      };
    }
    return {
      sessie_id: id,
      messages: session.messages.slice(),
      turn_count: Math.floor(session.messages.length / 2),
      provider_usage: ensureProviderUsage(session),
      tokens_totaal: session.tokens_totaal,
      kosten_totaal: Number(Number(session.kosten_totaal || 0).toFixed(4)),
    };
  }

  function sessionInfo(sessieId) {
    const id = normalizeSessionId(sessieId);
    const session = sessions.get(id);
    if (!session) throw new Error("session_not_found");
    return {
      sessie_id: id,
      scene_count: session.scenes.length,
      scenes: session.scenes.slice(-MAX_HISTORY),
      livechat_count: session.livechat.length,
      turn_count: Math.floor(session.messages.length / 2),
      tokens_totaal: session.tokens_totaal,
      kosten_totaal: Number(Number(session.kosten_totaal || 0).toFixed(4)),
      provider_usage: ensureProviderUsage(session),
      waarschuwing: Number(session.tokens_totaal || 0) > TOKEN_WARNING_THRESHOLD,
      drempel: TOKEN_WARNING_THRESHOLD,
    };
  }

  function undo(sessieId) {
    const session = getSession(sessieId);
    if (session.messages.length < 2) throw new Error("no_turn_to_undo");
    session.messages = session.messages.slice(0, -2);
    return { ok: true, turn_count: Math.floor(session.messages.length / 2) };
  }

  function clearChat(sessieId) {
    const session = getSession(sessieId);
    session.messages = [];
    return { ok: true };
  }

  function resetSession(sessieId) {
    const id = normalizeSessionId(sessieId);
    const removed = sessions.get(id);
    sessions.delete(id);
    return {
      gereset: id,
      scenes_verwijderd: removed ? removed.scenes.length : 0,
    };
  }

  function anthropicSystemBlocks() {
    return [{
      type: "text",
      text: `${readDatabaseMarkdown()}\n\n${CHAT_INSTRUCTIONS}`,
      cache_control: { type: "ephemeral" },
    }];
  }

  function openAiInstructions() {
    return `${CHAT_INSTRUCTIONS}\n\nGebruik de gekoppelde file_search/vector store als catalogusbron. De volledige database wordt niet in deze prompt meegestuurd. Zoek relevante personages, omgevingen, situaties en stijlregels op wanneer de operator daarom vraagt of wanneer een scene cataloguscontext nodig heeft.`;
  }

  function compactCatalogInstructions() {
    const index = catalogIndex();
    const lines = [
      CHAT_INSTRUCTIONS,
      "",
      "## FOR YOU CATALOGUS - COMPACT",
      "Gebruik deze huidige app-catalogus als bron. Als de operator een specifieke situatie/personage/omgeving kiest, geef die keuze voorrang.",
    ];
    if (index.promptSettings.globalPrompt) {
      lines.push("", "### Globale prompt", normalizeText(index.promptSettings.globalPrompt, 3000));
    }
    if (index.promptSettings.promptTemplate) {
      lines.push("", "### Prompttemplate", normalizeText(index.promptSettings.promptTemplate, 3000));
    }
    lines.push("", "### Personages");
    for (const item of index.personages) {
      lines.push(`- ${item.naam}: ${normalizeText(item.beschrijving, 500)}`);
    }
    lines.push("", "### Omgevingen");
    for (const item of index.omgevingen) {
      lines.push(`- ${item.naam}: ${normalizeText(item.beschrijving, 500)}`);
    }
    lines.push("", "### Situaties");
    for (const item of index.situaties) {
      const parts = [
        `personages: ${item.characterNames.join(", ") || "n.v.t."}`,
        `omgeving: ${item.environmentName || "n.v.t."}`,
      ];
      if (item.situationNames.length) parts.push(`labels: ${item.situationNames.join(", ")}`);
      const description = normalizeText(item.promptOverride || item.beschrijving || item.prompt, 1200);
      lines.push(`- ${item.naam} (${parts.join("; ")}): ${description}`);
    }
    return lines.join("\n");
  }

  function historyForProvider(session) {
    return session.messages.slice(-MAX_CHAT_MESSAGES_FOR_PROVIDER).map((message) => ({
      role: message.role === "assistant" ? "assistant" : "user",
      content: normalizeText(message.content, 12000),
    }));
  }

  async function streamAnthropic({ session, sessieId, message, model, maxTokens, sceneId, emit }) {
    const messages = historyForProvider(session);
    messages.push({
      role: "user",
      content: [{
        type: "text",
        text: message,
        cache_control: { type: "ephemeral" },
      }],
    });
    const response = await fetchImpl("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "anthropic-version": "2023-06-01",
        "x-api-key": anthropicApiKey(env),
      },
      body: JSON.stringify({
        model,
        max_tokens: maxTokens,
        stream: true,
        system: anthropicSystemBlocks(),
        messages,
      }),
    });
    if (!response.ok) throw await responseError(response, "anthropic_api_error");

    let fullText = "";
    const usage = {};
    await readSseStream(response.body, (data) => {
      if (data.type === "error") {
        const message = data.error && data.error.message ? data.error.message : "anthropic_stream_error";
        throw new Error(safePublicError({ message }, "anthropic_stream_error"));
      }
      if (data.type === "message_start" && data.message && data.message.usage) mergeUsage(usage, data.message.usage);
      if (data.type === "content_block_start" && data.content_block && data.content_block.text) {
        const text = String(data.content_block.text || "");
        fullText += text;
        emit({ type: "delta", text });
      }
      if (data.type === "content_block_delta" && data.delta && data.delta.text) {
        const text = String(data.delta.text || "");
        fullText += text;
        emit({ type: "delta", text });
      }
      if (data.type === "message_delta" && data.usage) mergeUsage(usage, data.usage);
      if (data.type === "message_stop" && data.usage) mergeUsage(usage, data.usage);
    });

    const tokensIn = usageNumber(usage, "input_tokens")
      + usageNumber(usage, "cache_creation_input_tokens")
      + usageNumber(usage, "cache_read_input_tokens");
    const tokensOut = usageNumber(usage, "output_tokens");
    const cost = calculateAnthropicCost(model, usage);
    recordUsage(session, "anthropic", tokensIn + tokensOut, cost);
    session.messages.push({ role: "user", content: message });
    session.messages.push({ role: "assistant", content: fullText });
    const providerBucket = ensureProviderUsage(session).anthropic;
    log("operator_chat", { sceneId, sessieId, provider: "anthropic", model, tokensIn, tokensOut, cost });
    const done = {
      type: "done",
      scene_id: sceneId,
      provider: "anthropic",
      model,
      tokens_input: tokensIn,
      tokens_output: tokensOut,
      kosten_dollar: cost,
      cached: usageNumber(usage, "cache_read_input_tokens") > 0,
      sessie_tokens_totaal: session.tokens_totaal,
      sessie_kosten_totaal: Number(Number(session.kosten_totaal || 0).toFixed(4)),
      provider_tokens_totaal: providerBucket.tokens_totaal,
      provider_kosten_totaal: Number(Number(providerBucket.kosten_totaal || 0).toFixed(4)),
      provider_usage: ensureProviderUsage(session),
      turn_count: Math.floor(session.messages.length / 2),
    };
    const osc = await notifyOutput({
      text: fullText,
      scene_id: sceneId,
      sessie_id: sessieId,
      provider: "anthropic",
      model,
      source: "chat",
    });
    if (osc) done.osc = osc;
    return done;
  }

  async function streamOpenAi({ session, sessieId, message, model, maxTokens, sceneId, vectorStoreId, emit }) {
    const input = historyForProvider(session);
    input.push({ role: "user", content: message });
    const response = await fetchImpl("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${openAiApiKey(env)}`,
      },
      body: JSON.stringify({
        model,
        instructions: openAiInstructions(),
        input,
        max_output_tokens: maxTokens,
        stream: true,
        tools: [{
          type: "file_search",
          vector_store_ids: [vectorStoreId],
          max_num_results: 10,
        }],
      }),
    });
    if (!response.ok) throw await responseError(response, "openai_api_error");

    let fullText = "";
    const usage = {};
    await readSseStream(response.body, (data) => {
      if (data.type === "error") {
        const message = data.message || data.error && data.error.message || "openai_stream_error";
        throw new Error(safePublicError({ message }, "openai_stream_error"));
      }
      if (data.type === "response.output_text.delta" && data.delta) {
        const text = String(data.delta || "");
        fullText += text;
        emit({ type: "delta", text });
      }
      if (data.type === "response.completed" && data.response && data.response.usage) {
        mergeUsage(usage, data.response.usage);
      }
      if (data.type === "response.failed") {
        const err = data.response && data.response.error;
        throw new Error(safePublicError({ message: err && err.message ? err.message : "openai_response_failed" }));
      }
    });
    const priced = calculateOpenAiCost(model, usage);
    recordUsage(session, "openai", priced.input + priced.output, priced.cost);
    session.messages.push({ role: "user", content: message });
    session.messages.push({ role: "assistant", content: fullText });
    const providerBucket = ensureProviderUsage(session).openai;
    log("operator_chat", { sceneId, sessieId, provider: "openai", model, tokensIn: priced.input, tokensOut: priced.output, cost: priced.cost });
    const done = {
      type: "done",
      scene_id: sceneId,
      provider: "openai",
      model,
      tokens_input: priced.input,
      tokens_output: priced.output,
      kosten_dollar: priced.cost,
      cached: priced.cached > 0,
      cached_tokens: priced.cached,
      sessie_tokens_totaal: session.tokens_totaal,
      sessie_kosten_totaal: Number(Number(session.kosten_totaal || 0).toFixed(4)),
      provider_tokens_totaal: providerBucket.tokens_totaal,
      provider_kosten_totaal: Number(Number(providerBucket.kosten_totaal || 0).toFixed(4)),
      provider_usage: ensureProviderUsage(session),
      turn_count: Math.floor(session.messages.length / 2),
    };
    const osc = await notifyOutput({
      text: fullText,
      scene_id: sceneId,
      sessie_id: sessieId,
      provider: "openai",
      model,
      source: "chat",
    });
    if (osc) done.osc = osc;
    return done;
  }

  async function streamDeepSeek({ session, sessieId, message, model, maxTokens, sceneId, emit }) {
    const messages = [
      { role: "system", content: compactCatalogInstructions() },
      ...historyForProvider(session),
      { role: "user", content: message },
    ];
    const response = await fetchImpl("https://api.deepseek.com/chat/completions", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${deepSeekApiKey(env)}`,
      },
      body: JSON.stringify({
        model,
        messages,
        max_tokens: maxTokens,
        stream: true,
        stream_options: { include_usage: true },
        thinking: { type: "disabled" },
      }),
    });
    if (!response.ok) throw await responseError(response, "deepseek_api_error");

    let fullText = "";
    const usage = {};
    await readSseStream(response.body, (data) => {
      if (data.error) {
        const message = data.error && data.error.message ? data.error.message : "deepseek_stream_error";
        throw new Error(safePublicError({ message }, "deepseek_stream_error"));
      }
      if (data.usage) mergeUsage(usage, data.usage);
      const choices = Array.isArray(data.choices) ? data.choices : [];
      for (const choice of choices) {
        const delta = choice && choice.delta ? choice.delta : {};
        if (typeof delta.content === "string" && delta.content) {
          fullText += delta.content;
          emit({ type: "delta", text: delta.content });
        }
      }
    });
    const priced = calculateDeepSeekCost(model, usage);
    recordUsage(session, "deepseek", priced.input + priced.output, priced.cost);
    session.messages.push({ role: "user", content: message });
    session.messages.push({ role: "assistant", content: fullText });
    const providerBucket = ensureProviderUsage(session).deepseek;
    log("operator_chat", { sceneId, sessieId, provider: "deepseek", model, tokensIn: priced.input, tokensOut: priced.output, cost: priced.cost });
    const done = {
      type: "done",
      scene_id: sceneId,
      provider: "deepseek",
      model,
      tokens_input: priced.input,
      tokens_output: priced.output,
      kosten_dollar: priced.cost,
      cached: priced.cached > 0,
      cached_tokens: priced.cached,
      sessie_tokens_totaal: session.tokens_totaal,
      sessie_kosten_totaal: Number(Number(session.kosten_totaal || 0).toFixed(4)),
      provider_tokens_totaal: providerBucket.tokens_totaal,
      provider_kosten_totaal: Number(Number(providerBucket.kosten_totaal || 0).toFixed(4)),
      provider_usage: ensureProviderUsage(session),
      turn_count: Math.floor(session.messages.length / 2),
    };
    const osc = await notifyOutput({
      text: fullText,
      scene_id: sceneId,
      sessie_id: sessieId,
      provider: "deepseek",
      model,
      source: "chat",
    });
    if (osc) done.osc = osc;
    return done;
  }

  async function streamChat(body = {}, emit = () => {}) {
    const sessieId = normalizeSessionId(body.sessie_id || body.sessionId);
    const message = normalizeText(body.message, 12000);
    if (!message) throw new Error("message_required");
    const provider = normalizeProvider(body.provider);
    const model = normalizeModel(provider, body.model);
    const maxTokens = clampInt(body.max_tokens || body.maxTokens || 4096, 256, 16000, 4096);
    const vectorStoreId = getOpenAiVectorStoreId(body.vectorStoreId);
    assertProviderReady(provider, vectorStoreId);

    const session = getSession(sessieId);
    const sceneId = `sc_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
    emit({ type: "start", scene_id: sceneId, provider, model });
    let done = null;
    if (provider === "openai") {
      done = await streamOpenAi({ session, sessieId, message, model, maxTokens, sceneId, vectorStoreId, emit });
    } else if (provider === "deepseek") {
      done = await streamDeepSeek({ session, sessieId, message, model, maxTokens, sceneId, emit });
    } else {
      done = await streamAnthropic({ session, sessieId, message, model, maxTokens, sceneId, emit });
    }
    emit(done);
    return done;
  }

  return {
    status,
    catalogIndex,
    chatHistory,
    sessionInfo,
    undo,
    clearChat,
    resetSession,
    streamChat,
  };
}

module.exports = {
  createOperatorAi,
};
