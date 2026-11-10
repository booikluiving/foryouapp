"use strict";

const fs = require("node:fs/promises");
const path = require("node:path");

const APP_ROOT = path.resolve(__dirname, "../../..");
const DEFAULT_SCRIPT_AGENT_DB_DIR = path.join(APP_ROOT, "modules", "script-agent", "db");

function scriptAgentDbDir() {
  return path.resolve(process.env.SCRIPT_AGENT_DB_DIR || DEFAULT_SCRIPT_AGENT_DB_DIR);
}

function assertPathUnderApp(targetPath) {
  const resolved = path.resolve(targetPath);
  const relative = path.relative(APP_ROOT, resolved);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`script_agent_path_outside_app:${resolved}`);
  }
  return resolved;
}

function promptInputsFilePath() {
  return assertPathUnderApp(path.join(scriptAgentDbDir(), "prompt-inputs.json"));
}

function scriptsFilePath() {
  return assertPathUnderApp(path.join(scriptAgentDbDir(), "scripts.json"));
}

async function readJsonArray(filePath) {
  try {
    const text = await fs.readFile(filePath, "utf8");
    const parsed = JSON.parse(text);
    return Array.isArray(parsed) ? parsed : [];
  } catch (err) {
    if (err && err.code === "ENOENT") return [];
    throw err;
  }
}

async function writeJsonArray(filePath, items) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(items, null, 2)}\n`, "utf8");
}

async function appendPromptInput(promptInput) {
  const filePath = promptInputsFilePath();
  const promptInputs = await readJsonArray(filePath);
  promptInputs.push(promptInput);
  await writeJsonArray(filePath, promptInputs);
  return promptInput;
}

async function readPromptInputs(filter = {}) {
  const promptInputs = await readJsonArray(promptInputsFilePath());
  return promptInputs.filter((item) => {
    if (filter.showRunId && item.showRunId !== filter.showRunId) return false;
    if (filter.promptInputId && item.promptInputId !== filter.promptInputId) return false;
    return true;
  });
}

async function readPromptInput(promptInputId) {
  const promptInputs = await readPromptInputs({ promptInputId });
  if (!promptInputs.length) throw new Error(`script_agent_prompt_input_not_found:${promptInputId}`);
  return promptInputs[promptInputs.length - 1];
}

async function appendScriptOutput(scriptOutput) {
  const filePath = scriptsFilePath();
  const scripts = await readJsonArray(filePath);
  scripts.push(scriptOutput);
  await writeJsonArray(filePath, scripts);
  return scriptOutput;
}

async function readScriptOutputs(filter = {}) {
  const scripts = await readJsonArray(scriptsFilePath());
  return scripts.filter((item) => {
    if (filter.showRunId && item.showRunId !== filter.showRunId) return false;
    if (filter.promptInputId && item.promptInputId !== filter.promptInputId) return false;
    if (filter.scriptId && item.scriptId !== filter.scriptId) return false;
    return true;
  });
}

async function readScriptOutput(scriptId) {
  const scripts = await readScriptOutputs({ scriptId });
  if (!scripts.length) throw new Error(`script_agent_script_output_not_found:${scriptId}`);
  return scripts[scripts.length - 1];
}

async function readLatestScriptOutput(filter = {}) {
  const scripts = await readScriptOutputs(filter);
  if (!scripts.length) throw new Error("script_agent_script_output_not_found");
  return scripts.sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt))).at(-1);
}

module.exports = {
  APP_ROOT,
  appendPromptInput,
  appendScriptOutput,
  assertPathUnderApp,
  promptInputsFilePath,
  readLatestScriptOutput,
  readPromptInput,
  readPromptInputs,
  readScriptOutput,
  readScriptOutputs,
  scriptAgentDbDir,
  scriptsFilePath,
};
