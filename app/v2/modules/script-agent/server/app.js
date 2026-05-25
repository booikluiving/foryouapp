"use strict";

const {
  SCRIPT_AGENT_CAPTIONS_SCHEMA_VERSION,
  SCRIPT_AGENT_PROMPT_INPUT_SCHEMA_VERSION,
  SCRIPT_AGENT_SCRIPT_OUTPUT_SCHEMA_VERSION,
  SCRIPT_AGENT_TELEPROMPTER_SCHEMA_VERSION,
} = require("../../../shared/contracts/script-agent-v0");
const { fetchCurrentRuntimeState } = require("../client/runtime-client");
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
const { loadExpress } = require("./express-loader");

const express = loadExpress();

function asyncRoute(handler) {
  return (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
}

function httpError(statusCode, message) {
  const err = new Error(message);
  err.statusCode = statusCode;
  return err;
}

function scriptAgentClients() {
  return {
    fetchCurrentRuntimeState,
  };
}

function createScriptAgentApp(options = {}) {
  const app = express();
  const startedAt = new Date();
  const clients = options.clients || scriptAgentClients();
  app.use(express.json({ limit: "512kb" }));

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

  app.post("/v0/script-agent/prompt-inputs", asyncRoute(async (req, res) => {
    const runtimeResult = req.body && req.body.runtimeState
      ? { ok: true, state: req.body.runtimeState }
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
