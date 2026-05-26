"use strict";

const path = require("node:path");

const {
  SCRIPT_AGENT_CAPTIONS_SCHEMA_VERSION,
  SCRIPT_AGENT_PROMPT_INPUT_SCHEMA_VERSION,
  SCRIPT_AGENT_SCRIPT_OUTPUT_SCHEMA_VERSION,
  SCRIPT_AGENT_TELEPROMPTER_SCHEMA_VERSION,
} = require("../../../shared/contracts/script-agent-v0");
const { fetchCatalogSnapshot } = require("../client/catalog-client");
const { fetchCurrentRuntimeState } = require("../client/runtime-client");
const { createOperatorService } = require("../operator/operator-service");
const { buildPromptInput } = require("../prompt-builder/prompt-builder");
const { createScriptOutput } = require("../script-output/script-service");
const {
  appendPromptInput,
  appendScriptOutput,
  readLatestScriptOutput,
  readPromptInput,
  readPromptInputs,
  readScriptOutput,
  readScriptOutputs,
} = require("../script-output/state-store");
const { createTeleprompterParserBridge } = require("../teleprompter-parser/src/integration/script-agent-bridge");
const { loadExpress } = require("./express-loader");

const express = loadExpress();
const OPERATOR_UI_DIR = path.resolve(__dirname, "../operator-ui");

function asyncRoute(handler) {
  return (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
}

function httpError(statusCode, message) {
  const err = new Error(message);
  err.statusCode = statusCode;
  return err;
}

function sanitizeError(err, fallback = "script_agent_operator_error") {
  return err && err.message
    ? String(err.message).replace(/sk-[A-Za-z0-9_-]+/g, "sk-...")
    : fallback;
}

function booleanQuery(value, fallback = false) {
  if (value == null) return fallback;
  return ["1", "true", "yes", "on"].includes(String(value).toLowerCase());
}

function scriptAgentClients() {
  return {
    fetchCatalogSnapshot,
    fetchCurrentRuntimeState,
  };
}

function startOperatorDraftSync(operatorService, options = {}) {
  const intervalMs = Math.max(1000, Number(options.intervalMs || 2500) || 2500);
  let inflight = false;
  let stopped = false;

  async function tick() {
    if (stopped || inflight) return;
    inflight = true;
    try {
      await operatorService.currentDraft({ refreshRuntime: true });
    } catch {
      // Runtime can be offline during local development; explicit UI refresh will surface the error.
    } finally {
      inflight = false;
    }
  }

  const timer = setInterval(tick, intervalMs);
  if (typeof timer.unref === "function") timer.unref();
  const initialTimer = setTimeout(tick, 250);
  if (typeof initialTimer.unref === "function") initialTimer.unref();

  return () => {
    stopped = true;
    clearInterval(timer);
    clearTimeout(initialTimer);
  };
}

function createScriptAgentApp(options = {}) {
  const app = express();
  const startedAt = new Date();
  const clients = options.clients || scriptAgentClients();
  const teleprompterParser = options.teleprompterParser || createTeleprompterParserBridge({
    clients,
    env: options.env || process.env,
  });
  const operatorService = options.operatorService || createOperatorService({
    clients,
    env: options.env || process.env,
    fetchImpl: options.fetchImpl,
    onScriptOutput: (payload) => teleprompterParser.ingestScriptOutput({
      ...payload,
      source: "operator_chat",
    }),
  });
  app.locals.operatorService = operatorService;
  app.locals.teleprompterParser = teleprompterParser;
  app.locals.stopOperatorDraftSync = null;
  if (options.operatorAutoDraftSync !== false) {
    app.locals.stopOperatorDraftSync = startOperatorDraftSync(operatorService, {
      intervalMs: options.operatorDraftSyncIntervalMs,
    });
  }
  app.use(express.json({ limit: "512kb" }));
  app.use("/script-agent/operator/assets", express.static(OPERATOR_UI_DIR));
  teleprompterParser.mount(app, express);

  app.get("/health", (_req, res) => {
    const port = Number(process.env.SCRIPT_AGENT_PORT || process.env.PORT || options.port || 3027);
    res.json({
      ok: true,
      service: "script-agent",
      version: "v0",
      promptInputSchemaVersion: SCRIPT_AGENT_PROMPT_INPUT_SCHEMA_VERSION,
      scriptOutputSchemaVersion: SCRIPT_AGENT_SCRIPT_OUTPUT_SCHEMA_VERSION,
      teleprompterSchemaVersion: SCRIPT_AGENT_TELEPROMPTER_SCHEMA_VERSION,
      captionsSchemaVersion: SCRIPT_AGENT_CAPTIONS_SCHEMA_VERSION,
      port,
      startedAt: startedAt.toISOString(),
      uptimeSeconds: Math.round(process.uptime()),
    });
  });

  app.get("/script-agent/operator", (_req, res) => {
    res.sendFile(path.join(OPERATOR_UI_DIR, "index.html"));
  });

  app.get("/script-agent/operator/stage", (_req, res) => {
    res.sendFile(path.join(OPERATOR_UI_DIR, "stage.html"));
  });

  app.get("/v0/script-agent/operator/status", asyncRoute(async (_req, res) => {
    res.json(await operatorService.status());
  }));

  app.get("/v0/script-agent/operator/settings", asyncRoute(async (_req, res) => {
    res.json({ ok: true, settings: await operatorService.readSettings() });
  }));

  app.patch("/v0/script-agent/operator/settings", asyncRoute(async (req, res) => {
    res.json({ ok: true, settings: await operatorService.saveSettings(req.body || {}) });
  }));

  app.get("/v0/script-agent/operator/secrets/status", asyncRoute(async (_req, res) => {
    res.json(await operatorService.secretsStatus());
  }));

  app.get("/v0/script-agent/operator/secrets", asyncRoute(async (_req, res) => {
    res.json(await operatorService.secretsStatus());
  }));

  app.post("/v0/script-agent/operator/secrets", asyncRoute(async (req, res) => {
    res.json(await operatorService.saveSecrets(req.body || {}));
  }));

  app.get("/v0/script-agent/operator/draft", asyncRoute(async (req, res) => {
    const draft = await operatorService.currentDraft({
      refreshRuntime: booleanQuery(req.query.refreshRuntime, true),
    });
    res.json({ ok: true, draft });
  }));

  app.post("/v0/script-agent/operator/draft/from-runtime", asyncRoute(async (req, res) => {
    const runtimeInput = req.body ? req.body.runtimeState || req.body.runtimeOutput || null : null;
    const draft = await operatorService.createDraftFromRuntime(runtimeInput, {
      force: !!(req.body && req.body.force),
      sourceId: req.body && req.body.sourceId,
      previewStage: !!(req.body && (req.body.previewStage === true || req.body.stagePreview === true)),
    });
    res.status(201).json({ ok: true, draft });
  }));

  app.post("/v0/script-agent/operator/draft/manual", asyncRoute(async (req, res) => {
    const result = await operatorService.createManualDraft(req.body || {});
    res.status(201).json({ ok: true, ...result, stage: operatorService.snapshotStage() });
  }));

  app.patch("/v0/script-agent/operator/draft", asyncRoute(async (req, res) => {
    const draft = operatorService.updateStageDraft(req.body ? req.body.text : "", {
      sourceId: req.body && req.body.sourceId,
      revision: req.body && req.body.revision,
    });
    res.json({ ok: true, draft, stage: operatorService.snapshotStage() });
  }));

  app.get("/v0/script-agent/operator/catalog/index", asyncRoute(async (_req, res) => {
    res.json(await operatorService.catalogIndex());
  }));

  app.get("/v0/script-agent/operator/stage-style", asyncRoute(async (_req, res) => {
    res.json({ ok: true, style: await operatorService.readStageStyle() });
  }));

  app.patch("/v0/script-agent/operator/stage-style", asyncRoute(async (req, res) => {
    res.json({ ok: true, style: await operatorService.saveStageStyle(req.body ? req.body.style || req.body : {}) });
  }));

  app.get("/v0/script-agent/operator/session/:sessionId", (req, res) => {
    res.json(operatorService.sessionInfo(req.params.sessionId));
  });

  app.post("/v0/script-agent/operator/session/:sessionId/undo", (req, res, next) => {
    try {
      res.json(operatorService.undo(req.params.sessionId));
    } catch (err) {
      next(err);
    }
  });

  app.delete("/v0/script-agent/operator/session/:sessionId", (req, res) => {
    res.json(operatorService.clearSession(req.params.sessionId));
  });

  app.post("/v0/script-agent/operator/chat/stream", (req, res) => {
    let closed = false;
    res.writeHead(200, {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
      "x-accel-buffering": "no",
    });
    if (typeof res.flushHeaders === "function") res.flushHeaders();
    res.on("close", () => {
      closed = true;
    });
    const emit = (event) => {
      if (closed) return;
      res.write(`data: ${JSON.stringify(event)}\n\n`);
    };
    operatorService.streamChat(req.body || {}, emit)
      .catch((err) => {
        emit({ type: "error", error: sanitizeError(err) });
      })
      .finally(() => {
        if (!closed) res.end();
      });
  });

  app.post("/v0/script-agent/operator/scene-to-chat", asyncRoute(async (req, res) => {
    const events = [];
    const result = await operatorService.sceneToChat(req.body || {}, (event) => {
      if (event && event.type !== "delta") events.push(event);
    });
    res.status(201).json({ ok: true, ...result, events });
  }));

  app.post("/v0/script-agent/prompt-inputs", asyncRoute(async (req, res) => {
    const runtimeInput = req.body ? req.body.runtimeState || req.body.runtimeOutput || null : null;
    const runtimeResult = runtimeInput
      ? { ok: true, state: runtimeInput }
      : await clients.fetchCurrentRuntimeState();
    if (!runtimeResult.ok) throw httpError(502, `script_agent_runtime_unavailable:${runtimeResult.error || "unknown"}`);
    const promptInput = buildPromptInput(runtimeResult.state);
    await appendPromptInput(promptInput);
    res.status(201).json({ ok: true, promptInput });
  }));

  app.get("/v0/script-agent/prompt-inputs", asyncRoute(async (req, res) => {
    const promptInputs = await readPromptInputs({
      showRunId: req.query.showRunId ? String(req.query.showRunId) : null,
    });
    res.json({ ok: true, count: promptInputs.length, promptInputs });
  }));

  app.get("/v0/script-agent/prompt-inputs/:promptInputId", asyncRoute(async (req, res) => {
    res.json(await readPromptInput(req.params.promptInputId));
  }));

  app.post("/v0/script-agent/scripts", asyncRoute(async (req, res) => {
    const promptInputId = req.body && req.body.promptInputId ? String(req.body.promptInputId) : null;
    if (!promptInputId) throw httpError(400, "script_agent_missing_prompt_input_id");
    const promptInput = await readPromptInput(promptInputId);
    const scriptOutput = createScriptOutput({
      promptInput,
      scriptText: req.body ? req.body.scriptText : "",
    });
    await appendScriptOutput(scriptOutput);
    await teleprompterParser.ingestScriptOutput({ promptInput, scriptOutput, source: "script-agent" });
    res.status(201).json({ ok: true, scriptOutput });
  }));

  app.get("/v0/script-agent/scripts", asyncRoute(async (req, res) => {
    const scripts = await readScriptOutputs({
      showRunId: req.query.showRunId ? String(req.query.showRunId) : null,
      promptInputId: req.query.promptInputId ? String(req.query.promptInputId) : null,
    });
    res.json({ ok: true, count: scripts.length, scripts });
  }));

  app.get("/v0/script-agent/scripts/:scriptId", asyncRoute(async (req, res) => {
    res.json(await readScriptOutput(req.params.scriptId));
  }));

  app.get("/v0/script-agent/teleprompter/current", asyncRoute(async (req, res) => {
    const scriptOutput = await readLatestScriptOutput({
      showRunId: req.query.showRunId ? String(req.query.showRunId) : null,
      promptInputId: req.query.promptInputId ? String(req.query.promptInputId) : null,
    });
    res.json(scriptOutput.teleprompter);
  }));

  app.get("/v0/script-agent/captions/current", asyncRoute(async (req, res) => {
    const scriptOutput = await readLatestScriptOutput({
      showRunId: req.query.showRunId ? String(req.query.showRunId) : null,
      promptInputId: req.query.promptInputId ? String(req.query.promptInputId) : null,
    });
    res.json(scriptOutput.captions);
  }));

  app.use((req, res) => {
    res.status(404).json({ ok: false, error: "not_found", path: req.path });
  });

  app.use((err, _req, res, _next) => {
    const status = err && err.statusCode ? err.statusCode : 500;
    res.status(status).json({
      ok: false,
      error: status >= 500 ? "script_agent_service_error" : "script_agent_bad_request",
      message: err && err.message ? String(err.message) : "unknown_error",
    });
  });

  return app;
}

module.exports = {
  createScriptAgentApp,
  scriptAgentClients,
};
