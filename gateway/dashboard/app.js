"use strict";

const state = {
  showRunId: null,
  lastPrepareCueId: null,
  lastGoCueId: null,
};

const els = {
  generatedAt: document.getElementById("generatedAt"),
  overallStatus: document.getElementById("overallStatus"),
  serviceGrid: document.getElementById("serviceGrid"),
  runtimeFacts: document.getElementById("runtimeFacts"),
  cueFacts: document.getElementById("cueFacts"),
  eventLog: document.getElementById("eventLog"),
  refreshStatus: document.getElementById("refreshStatus"),
  startRun: document.getElementById("startRun"),
  prepareCue: document.getElementById("prepareCue"),
  startSituation: document.getElementById("startSituation"),
  goCue: document.getElementById("goCue"),
  stopSituation: document.getElementById("stopSituation"),
};

function addLog(message) {
  const item = document.createElement("li");
  item.textContent = `${new Date().toLocaleTimeString()} ${message}`;
  els.eventLog.prepend(item);
  while (els.eventLog.children.length > 8) els.eventLog.lastElementChild.remove();
}

function setPill(el, ok) {
  el.classList.remove("ok", "bad", "warn", "muted");
  el.classList.add(ok ? "ok" : "bad");
  el.textContent = ok ? "ok" : "offline";
}

function serviceCard(service) {
  const article = document.createElement("article");
  article.className = "service";
  const pill = service.ok ? '<span class="pill ok">ok</span>' : '<span class="pill bad">offline</span>';
  article.innerHTML = `
    <div class="section-title"><strong>${service.label}</strong>${pill}</div>
    <small>${service.baseUrl}</small>
    <small>${service.service || service.key}${service.port ? `:${service.port}` : ""}</small>
  `;
  return article;
}

function renderFacts(target, facts) {
  target.replaceChildren();
  for (const [key, value] of facts) {
    const dt = document.createElement("dt");
    const dd = document.createElement("dd");
    dt.textContent = key;
    dd.textContent = value == null || value === "" ? "-" : String(value);
    target.append(dt, dd);
  }
}

async function requestJson(path, options) {
  const response = await fetch(path, options);
  const body = await response.json();
  if (!response.ok) throw new Error(body.message || `${path} returned ${response.status}`);
  return body;
}

async function refreshStatus() {
  const status = await requestJson("/v0/gateway/status");
  els.generatedAt.textContent = new Date(status.generatedAt).toLocaleString();
  setPill(els.overallStatus, status.ok);
  els.serviceGrid.replaceChildren(...status.services.map(serviceCard));
  return status;
}

async function startRun() {
  const run = await requestJson("/v0/gateway/runtime/runs/start", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
  state.showRunId = run.showRunId;
  renderFacts(els.runtimeFacts, [
    ["showRunId", run.showRunId],
    ["prepared", run.preparedNext ? run.preparedNext.situationId : null],
    ["active", run.activeSituation ? run.activeSituation.situationId : null],
  ]);
  addLog(`runtime start ${run.showRunId}`);
}

async function prepareCue() {
  const result = await requestJson("/v0/gateway/show-control/cues/prepare", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
  state.lastPrepareCueId = result.cue.cueId;
  renderFacts(els.cueFacts, [
    ["prepare", result.cue.cueId],
    ["status", result.cue.status.state],
    ["warnings", result.cue.status.warnings.length],
  ]);
  addLog(`prepare ${result.cue.status.state}`);
}

async function startSituation() {
  if (!state.showRunId) throw new Error("no showRunId");
  const run = await requestJson(`/v0/gateway/runtime/runs/${encodeURIComponent(state.showRunId)}/start-situation`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
  renderFacts(els.runtimeFacts, [
    ["showRunId", run.showRunId],
    ["prepared", run.preparedNext ? run.preparedNext.situationId : null],
    ["active", run.activeSituation ? run.activeSituation.situationId : null],
  ]);
  addLog(`active ${run.activeSituation ? run.activeSituation.situationId : "-"}`);
}

async function goCue() {
  const result = await requestJson("/v0/gateway/show-control/cues/go", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
  state.lastGoCueId = result.cue.cueId;
  renderFacts(els.cueFacts, [
    ["go", result.cue.cueId],
    ["status", result.cue.status.state],
    ["nonBlocking", result.cue.status.nonBlocking],
  ]);
  addLog(`go ${result.cue.status.state}`);
}

async function stopSituation() {
  if (!state.showRunId) throw new Error("no showRunId");
  const run = await requestJson(`/v0/gateway/runtime/runs/${encodeURIComponent(state.showRunId)}/stop-situation`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
  renderFacts(els.runtimeFacts, [
    ["showRunId", run.showRunId],
    ["prepared", run.preparedNext ? run.preparedNext.situationId : null],
    ["active", run.activeSituation ? run.activeSituation.situationId : null],
    ["played", run.playedSituations.length],
  ]);
  addLog("runtime stop situation");
}

function bind(button, handler) {
  button.addEventListener("click", async () => {
    button.disabled = true;
    try {
      await handler();
      await refreshStatus();
    } catch (err) {
      addLog(err.message || "request failed");
    } finally {
      button.disabled = false;
    }
  });
}

bind(els.refreshStatus, refreshStatus);
bind(els.startRun, startRun);
bind(els.prepareCue, prepareCue);
bind(els.startSituation, startSituation);
bind(els.goCue, goCue);
bind(els.stopSituation, stopSituation);
refreshStatus().catch((err) => addLog(err.message || "status failed"));
