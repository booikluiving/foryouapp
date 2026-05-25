"use strict";

(() => {
  const state = {
    health: null,
    config: null,
    contexts: [],
    selectedShowRunId: "",
    selectedContext: null,
    simulation: null,
  };

  const controls = [
    { id: "heart", label: "Heart weight", group: "weights", key: "heart", min: -10, max: 10, step: 0.1 },
    { id: "bored", label: "Bored weight", group: "weights", key: "bored", min: -10, max: 10, step: 0.1 },
    { id: "message", label: "Chat/message weight", group: "weights", key: "message", min: -10, max: 10, step: 0.05 },
    { id: "timeCorrection", label: "Time correction", group: "normalization", key: "timeCorrection", min: 0, max: 1, step: 0.05 },
    { id: "audienceSize", label: "Audience size normalization", group: "normalization", key: "audienceSize", min: 0, max: 1, step: 0.05 },
    { id: "labelAffinity", label: "Label affinity", group: "weights", key: "labelAffinity", min: -10, max: 10, step: 0.05 },
    { id: "characterAffinity", label: "Character affinity", group: "weights", key: "characterAffinity", min: -10, max: 10, step: 0.05 },
    { id: "diversity", label: "Diversity weight", group: "weights", key: "diversity", min: 0, max: 50, step: 0.25 },
    { id: "exploration", label: "Exploration weight", group: "weights", key: "exploration", min: 0, max: 50, step: 0.25 },
    { id: "retry", label: "Retry weight", group: "weights", key: "retry", min: 0, max: 50, step: 0.25 },
    { id: "sceneRepeatPenalty", label: "Scene repeat penalty", group: "weights", key: "sceneRepeatPenalty", min: 0, max: 50, step: 0.25 },
    { id: "neutralPredictedScore", label: "Neutral predicted score", group: "root", key: "neutralPredictedScore", min: -100, max: 100, step: 0.1 },
  ];

  function $(id) {
    return document.getElementById(id);
  }

  function fmt(value, digits = 2) {
    const number = Number(value);
    if (!Number.isFinite(number)) return "0.00";
    return number.toFixed(digits);
  }

  function text(value) {
    return value == null || value === "" ? "-" : String(value);
  }

  function scoreTitle(situation) {
    return situation && (situation.title || situation.name || situation.id) || "-";
  }

  function activeSituations() {
    const catalog = state.selectedContext && state.selectedContext.catalog;
    return ((catalog && catalog.situations) || []).filter((item) => item && item.active !== false && !item.archivedAt);
  }

  function situationMap() {
    return new Map(activeSituations().map((item) => [item.id, item]));
  }

  async function fetchJson(pathname, options = {}) {
    const response = await fetch(pathname, {
      ...options,
      headers: {
        "content-type": "application/json",
        ...(options.headers || {}),
      },
    });
    const body = await response.json();
    if (!response.ok) throw new Error(body && body.message ? body.message : `${pathname} ${response.status}`);
    return body;
  }

  function controlValue(config, control) {
    if (!config) return 0;
    if (control.group === "weights") return Number((config.weights || {})[control.key] || 0);
    if (control.group === "normalization") return Number((config.normalization || {})[control.key] || 0);
    return Number(config[control.key] || 0);
  }

  function renderConfigControls() {
    const grid = $("configGrid");
    grid.innerHTML = controls.map((control) => {
      const value = controlValue(state.config, control);
      return `
        <div class="config-control">
          <div class="config-control-row">
            <label for="config-${control.id}">${control.label}</label>
            <output id="config-${control.id}-value">${fmt(value)}</output>
          </div>
          <input id="config-${control.id}" type="range" min="${control.min}" max="${control.max}" step="${control.step}" value="${value}">
        </div>
      `;
    }).join("");
    for (const control of controls) {
      const input = $(`config-${control.id}`);
      const output = $(`config-${control.id}-value`);
      input.addEventListener("input", () => {
        output.textContent = fmt(input.value);
      });
    }
  }

  function readConfigPayload() {
    const payload = { weights: {}, normalization: {} };
    for (const control of controls) {
      const value = Number($(`config-${control.id}`).value);
      if (control.group === "weights") payload.weights[control.key] = value;
      else if (control.group === "normalization") payload.normalization[control.key] = value;
      else payload[control.key] = value;
    }
    return payload;
  }

  function renderHeader() {
    $("topMeta").textContent = state.health
      ? `v${state.health.version.replace(/^v/, "")} · ${state.health.port}`
      : "Offline";
    $("healthBadge").textContent = state.health && state.health.ok ? "Healthy" : "Offline";
    $("healthBadge").className = `fy-badge ${state.health && state.health.ok ? "fy-badge-good" : "fy-badge-bad"}`;
  }

  function renderContexts() {
    $("contextCount").textContent = String(state.contexts.length);
    const list = $("contextsList");
    if (!state.contexts.length) {
      list.innerHTML = `<div class="empty-state">Geen scoring contexts.</div>`;
      return;
    }
    list.innerHTML = state.contexts.map((context) => `
      <button class="fy-list-item context-item ${context.showRunId === state.selectedShowRunId ? "is-selected" : ""}" type="button" data-show-run-id="${context.showRunId}">
        <div class="context-row-top">
          <strong>${context.showRunId}</strong>
          <span class="fy-badge">${context.scoreCount || 0} scores</span>
        </div>
        <div class="fy-small">${context.observationCount || 0} observations · ${text(context.updatedAt)}</div>
      </button>
    `).join("");
    for (const button of list.querySelectorAll("[data-show-run-id]")) {
      button.addEventListener("click", () => selectContext(button.dataset.showRunId));
    }
  }

  function renderObservations() {
    const observations = state.selectedContext && Array.isArray(state.selectedContext.observations)
      ? state.selectedContext.observations
      : [];
    $("observationCount").textContent = String(observations.length);
    const map = situationMap();
    const list = $("observationsList");
    if (!observations.length) {
      list.innerHTML = `<div class="empty-state">Geen observations.</div>`;
      return;
    }
    list.innerHTML = observations.slice().reverse().map((observation) => {
      const situation = map.get(observation.situationId);
      return `
        <div class="fy-list-item">
          <div class="observation-row-top">
            <strong>${text(observation.situationRunId)}</strong>
            <span class="fy-badge">${fmt(observation.observedScore)}</span>
          </div>
          <div class="fy-small">${scoreTitle(situation)} · ${text(observation.observedAt)}</div>
        </div>
      `;
    }).join("");
  }

  function scoreFeed() {
    return state.selectedContext && state.selectedContext.scoreFeed ? state.selectedContext.scoreFeed : null;
  }

  function renderTopList(elementId, items = [], nameKey = "name") {
    const element = $(elementId);
    if (!items.length) {
      element.innerHTML = `<div class="empty-state">Geen data.</div>`;
      return;
    }
    element.innerHTML = items.map((item) => `
      <div class="fy-list-item compact-item">
        <span>${text(item[nameKey] || item.title || item.id)}</span>
        <span class="score-value">${fmt(item.score)}</span>
      </div>
    `).join("");
  }

  function renderTopDebug() {
    const feed = scoreFeed();
    const summary = feed && feed.debugSummary ? feed.debugSummary : {};
    const scores = feed && Array.isArray(feed.scores) ? feed.scores : [];
    $("scoreCount").textContent = `${scores.length} scores`;
    renderTopList("topCharacters", summary.topCharacters || []);
    renderTopList("topLabels", summary.topLabels || []);
    renderTopList("topSituations", summary.topSituations || [], "title");
  }

  function renderScores() {
    const feed = scoreFeed();
    const scores = feed && Array.isArray(feed.scores) ? feed.scores : [];
    const map = situationMap();
    $("scoreFeedMeta").textContent = feed ? text(feed.updatedAfterSituationRunId || "Neutral") : "Geen context";
    const table = $("scoresTable");
    if (!scores.length) {
      table.innerHTML = `<div class="empty-state">Geen scorefeed.</div>`;
      return;
    }
    table.innerHTML = scores.slice().sort((a, b) => Number(b.predictedScore || 0) - Number(a.predictedScore || 0)).map((score) => {
      const situation = map.get(score.situationId);
      const components = score.components || {};
      const chips = (score.reasons || []).map((reason) => `<span class="reason-chip">${reason}</span>`).join("");
      return `
        <div class="score-row">
          <div>
            <div class="score-row-top">
              <strong class="score-title">${scoreTitle(situation)}</strong>
              <span class="fy-badge">${text(score.situationId)}</span>
            </div>
            <div class="score-reasons">${chips}</div>
          </div>
          <div>
            <div class="fy-small">Observed</div>
            <div class="score-value">${score.observedScore == null ? "-" : fmt(score.observedScore)}</div>
            <div class="fy-small">Confidence ${fmt(score.confidence, 2)}</div>
          </div>
          <div class="score-components">
            <span class="reason-chip">pred ${fmt(score.predictedScore)}</span>
            <span class="reason-chip">aff ${fmt(components.affinity || 0)}</span>
            <span class="reason-chip">div ${fmt(components.diversityPenalty || 0)}</span>
            <span class="reason-chip">expl ${fmt(components.explorationBonus || 0)}</span>
            <span class="reason-chip">retry ${fmt(components.retryBonus || 0)}</span>
          </div>
        </div>
      `;
    }).join("");
  }

  function renderSimulationOptions() {
    const select = $("simulationSituation");
    const situations = activeSituations();
    select.innerHTML = situations.map((situation) => (
      `<option value="${situation.id}">${scoreTitle(situation)}</option>`
    )).join("");
    $("runSimulationBtn").disabled = !state.selectedContext || !situations.length;
  }

  function renderSimulationResult() {
    const result = state.simulation;
    const box = $("simulationResult");
    if (!result) {
      $("simulationBadge").textContent = "Niet berekend";
      box.innerHTML = "";
      return;
    }
    $("simulationBadge").textContent = "Berekend";
    const selectedId = $("simulationSituation").value;
    const currentScore = scoreFeed() && Array.isArray(scoreFeed().scores)
      ? scoreFeed().scores.find((score) => score.situationId === selectedId)
      : null;
    const simulatedScore = result.scoreFeed.scores.find((score) => score.situationId === selectedId);
    const currentPredicted = currentScore ? Number(currentScore.predictedScore || 0) : 0;
    const simulatedPredicted = simulatedScore ? Number(simulatedScore.predictedScore || 0) : 0;
    box.innerHTML = `
      <div class="metric-grid">
        <div class="simulation-metric"><span>Observed</span><strong>${fmt(result.observation.observedScore)}</strong></div>
        <div class="simulation-metric"><span>Predicted</span><strong>${fmt(simulatedPredicted)}</strong></div>
        <div class="simulation-metric"><span>Delta</span><strong>${fmt(simulatedPredicted - currentPredicted)}</strong></div>
      </div>
    `;
  }

  function renderAll() {
    renderHeader();
    renderContexts();
    renderObservations();
    renderTopDebug();
    renderScores();
    renderSimulationOptions();
    renderSimulationResult();
  }

  async function loadConfig() {
    state.config = await fetchJson("/v0/algorithm/config");
    renderConfigControls();
  }

  async function loadHealth() {
    state.health = await fetchJson("/health");
  }

  async function loadContexts() {
    const result = await fetchJson("/v0/algorithm/scoring-contexts");
    state.contexts = Array.isArray(result.contexts) ? result.contexts : [];
    if (!state.selectedShowRunId && state.contexts[0]) state.selectedShowRunId = state.contexts[0].showRunId;
    if (state.selectedShowRunId) await loadSelectedContext();
  }

  async function loadSelectedContext() {
    if (!state.selectedShowRunId) {
      state.selectedContext = null;
      return;
    }
    state.selectedContext = await fetchJson(`/v0/algorithm/scoring-contexts/${encodeURIComponent(state.selectedShowRunId)}`);
  }

  async function selectContext(showRunId) {
    state.selectedShowRunId = showRunId;
    state.simulation = null;
    await loadSelectedContext();
    renderAll();
  }

  async function refresh() {
    try {
      await loadHealth();
      await loadConfig();
      await loadContexts();
      $("configMsg").textContent = "";
    } catch (err) {
      $("configMsg").textContent = err.message;
    }
    renderAll();
  }

  async function saveConfig() {
    try {
      state.config = await fetchJson("/v0/algorithm/config", {
        method: "PATCH",
        body: JSON.stringify(readConfigPayload()),
      });
      $("configMsg").textContent = "Opgeslagen.";
      await loadSelectedContext();
      renderAll();
    } catch (err) {
      $("configMsg").textContent = err.message;
    }
  }

  async function runSimulation() {
    if (!state.selectedContext) return;
    const messages = $("simulationMessages").value.split(/\n+/).map((line) => line.trim()).filter(Boolean);
    try {
      state.simulation = await fetchJson("/v0/algorithm/simulate", {
        method: "POST",
        body: JSON.stringify({
          showRunId: state.selectedContext.showRunId,
          situationId: $("simulationSituation").value,
          durationSeconds: Number($("simulationDuration").value || 0),
          audience: {
            activeClients: Number($("simulationAudience").value || 1),
          },
          chatAppSignals: {
            heartCount: Number($("simulationHearts").value || 0),
            boredCount: Number($("simulationBored").value || 0),
            rawMessages: messages,
          },
        }),
      });
    } catch (err) {
      state.simulation = null;
      $("simulationResult").innerHTML = `<div class="empty-state">${err.message}</div>`;
    }
    renderSimulationResult();
  }

  $("refreshBtn").addEventListener("click", refresh);
  $("reloadConfigBtn").addEventListener("click", refresh);
  $("saveConfigBtn").addEventListener("click", saveConfig);
  $("runSimulationBtn").addEventListener("click", runSimulation);

  refresh();
})();
