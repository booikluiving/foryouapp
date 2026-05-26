"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs/promises");
const net = require("node:net");
const path = require("node:path");
const { spawn } = require("node:child_process");

const TEST_DIR = __dirname;
const APP_ROOT = path.resolve(TEST_DIR, "../../..");
const PORTS = {
  catalog: 4121,
  paths: 4122,
  runtime: 4124,
  scriptAgent: 4127,
};
const SCRIPT_AGENT_DB_DIR = path.join(TEST_DIR, ".tmp-smoke-db");
const PROTECTED_V1_FILES = [
  path.join(APP_ROOT, "legacy", "data", "live.sqlite"),
  path.join(APP_ROOT, "legacy", "data", "live.sqlite-wal"),
  path.join(APP_ROOT, "legacy", "data", "live.sqlite-shm"),
];

async function sha256(filePath) {
  const data = await fs.readFile(filePath);
  return crypto.createHash("sha256").update(data).digest("hex");
}

async function protectedHashes() {
  const entries = [];
  for (const filePath of PROTECTED_V1_FILES) {
    entries.push([filePath, await sha256(filePath)]);
  }
  return Object.fromEntries(entries);
}

function assertHashesEqual(before, after) {
  for (const filePath of PROTECTED_V1_FILES) {
    assert.equal(after[filePath], before[filePath], `${path.basename(filePath)} changed`);
  }
}

async function assertPortFree(port) {
  await new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.once("listening", () => server.close(resolve));
    server.listen(port, "127.0.0.1");
  });
}

async function fetchJson(baseUrl, pathname, options) {
  const response = await fetch(`${baseUrl}${pathname}`, options);
  const body = await response.json();
  if (!response.ok) throw new Error(`${pathname} returned ${response.status}: ${JSON.stringify(body)}`);
  return body;
}

async function fetchText(baseUrl, pathname) {
  const response = await fetch(`${baseUrl}${pathname}`);
  const body = await response.text();
  if (!response.ok) throw new Error(`${pathname} returned ${response.status}: ${body.slice(0, 200)}`);
  return body;
}

async function waitForHealth(child, baseUrl, serviceName, logs) {
  const deadline = Date.now() + 10000;
  while (Date.now() < deadline) {
    if (child.exitCode != null) throw new Error(`${serviceName} exited early (${child.exitCode}): ${logs.join("")}`);
    try {
      const health = await fetchJson(baseUrl, "/health");
      if (health.ok && health.service === serviceName) return health;
    } catch (_err) {
      await new Promise((resolve) => setTimeout(resolve, 150));
    }
  }
  throw new Error(`${serviceName} did not become healthy: ${logs.join("")}`);
}

function spawnService(name, script, env) {
  const logs = [];
  const child = spawn(process.execPath, [script], {
    cwd: APP_ROOT,
    env: { ...process.env, ...env },
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout.on("data", (chunk) => logs.push(String(chunk)));
  child.stderr.on("data", (chunk) => logs.push(String(chunk)));
  return { name, child, logs };
}

async function stopService(service) {
  if (!service || !service.child || service.child.exitCode != null) return;
  await new Promise((resolve) => {
    service.child.once("exit", resolve);
    service.child.kill("SIGTERM");
    setTimeout(() => {
      if (service.child.exitCode == null) service.child.kill("SIGKILL");
    }, 2000).unref();
  });
}

async function stopServices(services) {
  for (const service of services.reverse()) {
    await stopService(service);
  }
}

function assertNoRuntimeOrderFields(value) {
  const text = JSON.stringify(value);
  for (const key of ["preparedNext", "resolvedPreparedNext", "eligiblePool", "pathAvailable", "pathLocked", "order"]) {
    assert(!text.includes(`"${key}"`), `${key} should not be emitted by Script Agent`);
  }
}

function runtimeOrderSnapshot(runtimeState) {
  return {
    preparedNext: runtimeState.preparedNext,
    resolvedPreparedNext: runtimeState.resolvedPreparedNext,
    eligiblePool: runtimeState.eligiblePool,
    activeSituation: runtimeState.activeSituation,
    playedSituations: runtimeState.playedSituations,
    runLogLength: Array.isArray(runtimeState.runLog) ? runtimeState.runLog.length : null,
  };
}

async function main() {
  await fs.rm(SCRIPT_AGENT_DB_DIR, { recursive: true, force: true });
  for (const port of Object.values(PORTS)) await assertPortFree(port);
  const beforeHashes = await protectedHashes();
  const services = [];
  try {
    const catalogScript = path.join(APP_ROOT, "modules", "catalog", "server", "server.js");
    const pathsScript = path.join(APP_ROOT, "modules", "paths", "server", "server.js");
    const runtimeScript = path.join(APP_ROOT, "modules", "runtime", "server", "server.js");
    const scriptAgentScript = path.join(APP_ROOT, "modules", "script-agent", "server", "server.js");

    services.push(spawnService("catalog", catalogScript, {
      CATALOG_PORT: String(PORTS.catalog),
      V2_CATALOG_LEGACY_SQLITE_PATH: "/missing.sqlite",
    }));
    await waitForHealth(services[0].child, `http://127.0.0.1:${PORTS.catalog}`, "catalog", services[0].logs);

    services.push(spawnService("paths", pathsScript, {
      PATHS_PORT: String(PORTS.paths),
      V2_PATHS_CATALOG_URL: `http://127.0.0.1:${PORTS.catalog}`,
      V2_PATHS_LEGACY_SQLITE_PATH: "/missing.sqlite",
    }));
    await waitForHealth(services[1].child, `http://127.0.0.1:${PORTS.paths}`, "paths", services[1].logs);

    services.push(spawnService("runtime", runtimeScript, {
      RUNTIME_PORT: String(PORTS.runtime),
      V2_RUNTIME_CATALOG_URL: `http://127.0.0.1:${PORTS.catalog}`,
      V2_RUNTIME_PATHS_URL: `http://127.0.0.1:${PORTS.paths}`,
    }));
    await waitForHealth(services[2].child, `http://127.0.0.1:${PORTS.runtime}`, "runtime", services[2].logs);

    services.push(spawnService("script-agent", scriptAgentScript, {
      SCRIPT_AGENT_PORT: String(PORTS.scriptAgent),
      V2_SCRIPT_AGENT_RUNTIME_URL: `http://127.0.0.1:${PORTS.runtime}`,
      V2_SCRIPT_AGENT_DB_DIR: SCRIPT_AGENT_DB_DIR,
    }));
    await waitForHealth(services[3].child, `http://127.0.0.1:${PORTS.scriptAgent}`, "script-agent", services[3].logs);

    const runtimeBase = `http://127.0.0.1:${PORTS.runtime}`;
    const scriptAgentBase = `http://127.0.0.1:${PORTS.scriptAgent}`;
    const started = await fetchJson(runtimeBase, "/v0/runtime/runs/start", { method: "POST" });
    assert(started.resolvedPreparedNext && started.resolvedPreparedNext.situationId);

    const runtimeBefore = await fetchJson(runtimeBase, "/v0/runtime/runs/current");
    const orderBefore = runtimeOrderSnapshot(runtimeBefore);

    const operatorHtml = await fetchText(scriptAgentBase, "/script-agent/operator");
    assert(operatorHtml.includes("Script Agent Operator"));
    assert(operatorHtml.includes("DeepSeek"));
    const stageHtml = await fetchText(scriptAgentBase, "/script-agent/operator/stage");
    assert(stageHtml.includes("Operator Stage"));

    const promptResponse = await fetchJson(scriptAgentBase, "/v0/script-agent/prompt-inputs", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    });
    const promptInput = promptResponse.promptInput;
    assert.equal(promptInput.showRunId, started.showRunId);
    assert.equal(promptInput.situation.situationId, started.resolvedPreparedNext.situationId);
    assert(promptInput.contentHash);
    assert(promptInput.performerSlots.length > 0, "prompt input should expose performer slots");
    assertNoRuntimeOrderFields(promptInput);

    const operatorDraftResponse = await fetchJson(scriptAgentBase, "/v0/script-agent/operator/draft/from-runtime", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ force: true }),
    });
    assert.equal(operatorDraftResponse.draft.showRunId, started.showRunId);
    assert.equal(operatorDraftResponse.draft.situationId, started.resolvedPreparedNext.situationId);
    assert(operatorDraftResponse.draft.text.includes(operatorDraftResponse.draft.situationTitle));
    assertNoRuntimeOrderFields(operatorDraftResponse.draft);

    const secretResponse = await fetchJson(scriptAgentBase, "/v0/script-agent/operator/secrets", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ deepSeekApiKey: "sk-smoke-secret" }),
    });
    assert.equal(secretResponse.deepseek.configured, true);
    assert(!JSON.stringify(secretResponse).includes("sk-smoke-secret"));
    const operatorStatus = await fetchJson(scriptAgentBase, "/v0/script-agent/operator/status");
    assert.equal(operatorStatus.provider, "deepseek");
    assert(!JSON.stringify(operatorStatus).includes("sk-smoke-secret"));

    const slot = promptInput.performerSlots[0];
    const scriptResponse = await fetchJson(scriptAgentBase, "/v0/script-agent/scripts", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        promptInputId: promptInput.promptInputId,
        scriptText: `${slot.characterName}: ${promptInput.situation.title}`,
      }),
    });
    const scriptOutput = scriptResponse.scriptOutput;
    assert.equal(scriptOutput.parserOutput.verified, true);
    assertNoRuntimeOrderFields(scriptOutput);

    const teleprompter = await fetchJson(
      scriptAgentBase,
      `/v0/script-agent/teleprompter/current?showRunId=${encodeURIComponent(started.showRunId)}&promptInputId=${encodeURIComponent(promptInput.promptInputId)}`
    );
    assert.equal(teleprompter.performerSlots[0].characterName, slot.characterName);
    assert(teleprompter.performerSlots[0].lines.length > 0);

    const captions = await fetchJson(
      scriptAgentBase,
      `/v0/script-agent/captions/current?showRunId=${encodeURIComponent(started.showRunId)}&promptInputId=${encodeURIComponent(promptInput.promptInputId)}`
    );
    assert.equal(captions.segments[0].speaker, slot.characterName);

    const runtimeAfter = await fetchJson(runtimeBase, "/v0/runtime/runs/current");
    assert.deepEqual(runtimeOrderSnapshot(runtimeAfter), orderBefore, "Script Agent must not mutate Runtime order state");

    await stopServices(services);
    const afterHashes = await protectedHashes();
    assertHashesEqual(beforeHashes, afterHashes);
    await fs.rm(SCRIPT_AGENT_DB_DIR, { recursive: true, force: true });

    process.stdout.write(JSON.stringify({
      ok: true,
      ports: PORTS,
      showRunId: started.showRunId,
      promptInputId: promptInput.promptInputId,
      contentHash: promptInput.contentHash,
      situationId: promptInput.situation.situationId,
      teleprompterSlots: teleprompter.performerSlots.length,
      captionSegments: captions.segments.length,
      operatorUiAvailable: true,
      operatorDraftSituationId: operatorDraftResponse.draft.situationId,
      deepSeekSecretRedacted: true,
      runtimeOrderStateUnchanged: true,
      protectedV1HashesUnchanged: true,
    }, null, 2));
    process.stdout.write("\n");
  } catch (err) {
    await stopServices(services);
    const afterHashes = await protectedHashes();
    assertHashesEqual(beforeHashes, afterHashes);
    await fs.rm(SCRIPT_AGENT_DB_DIR, { recursive: true, force: true });
    err.message = `${err.message}\nService logs:\n${services.map((service) => `${service.name}:\n${service.logs.join("")}`).join("\n")}`;
    throw err;
  }
}

main().catch((err) => {
  process.stderr.write(`${err.stack || err.message}\n`);
  process.exit(1);
});
