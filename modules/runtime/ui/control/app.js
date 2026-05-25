"use strict";

const $ = (id) => document.getElementById(id);

let state = null;
let actionPending = false;
let refreshTimer = null;
let lastScrollTargetKey = "";
const ORDER_SETTINGS_STORAGE_KEY = "runtime.orderSettings.v0";

function esc(value) {
  return String(value == null ? "" : value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function setMessage(text, isError = false) {
  const el = $("message");
  el.textContent = text || "";
  el.classList.toggle("error", !!isError);
}

function displayError(err, fallback) {
  const message = err && err.message ? String(err.message) : "";
  if (
    message.includes("runtime_state_json_parse_failed")
    || message.includes("Unterminated string in JSON")
    || message.includes("Unexpected end of JSON input")
  ) {
    return "Runtime-state werd precies tijdens een live update gelezen. Probeer opnieuw; de opslag is nu beschermd tegen halve JSON reads.";
  }
  return message || fallback;
}

function normalizeOrderSettings(input = {}) {
  return {
    randomizeEqualScores: !!(input && input.randomizeEqualScores),
  };
}

function localOrderSettings() {
  try {
    return normalizeOrderSettings(JSON.parse(window.localStorage.getItem(ORDER_SETTINGS_STORAGE_KEY) || "{}"));
  } catch (_err) {
    return normalizeOrderSettings();
  }
}

function saveLocalOrderSettings(settings) {
  window.localStorage.setItem(ORDER_SETTINGS_STORAGE_KEY, JSON.stringify(normalizeOrderSettings(settings)));
}

function currentOrderSettings() {
  if (state && state.showRunId && state.orderSettings) return normalizeOrderSettings(state.orderSettings);
  return localOrderSettings();
}

function orderSettingsFromUi() {
  const toggle = $("randomizeEqualScoresToggle");
  return normalizeOrderSettings({
    randomizeEqualScores: !!(toggle && toggle.checked),
  });
}

async function api(pathname, options = {}) {
  const response = await fetch(pathname, options);
  const text = await response.text();
  let body = {};
  try {
    body = text ? JSON.parse(text) : {};
  } catch (_err) {
    body = { message: text };
  }
  if (!response.ok) {
    throw new Error(body.message || body.error || `${pathname} returned ${response.status}`);
  }
  return body;
}

async function post(pathname, body = {}) {
  return api(pathname, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function formatTime(value) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return new Intl.DateTimeFormat("nl-NL", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(date);
}

function formatScore(value) {
  if (value == null || !Number.isFinite(Number(value))) return "";
  const number = Number(value);
  return Number.isInteger(number) ? String(number) : number.toFixed(2);
}

function catalog() {
  if (state && state.showRunSnapshot && state.showRunSnapshot.catalog) return state.showRunSnapshot.catalog;
  if (state && state.catalogPreview) return state.catalogPreview;
  return { situations: [], characters: [], environments: [] };
}

function activeSituations() {
  return (catalog().situations || [])
    .filter((item) => item.active !== false && !item.archivedAt);
}

function byId(items = []) {
  return new Map(items.map((item) => [item.id, item]));
}

function pathStatusMap() {
  return new Map(((state && state.pathEvaluation && state.pathEvaluation.items) || [])
    .map((item) => [item.situationId, item]));
}

function scoreMap() {
  return new Map(((state && state.lastScoreFeed && state.lastScoreFeed.scores) || [])
    .map((item) => [item.situationId, item]));
}

function playedIndexMap() {
  return new Map(((state && state.playedSituations) || [])
    .map((item, index) => [item.situationId, index]));
}

function situationTitle(situationId) {
  const situation = byId(catalog().situations || []).get(situationId);
  return situation ? situation.title || situation.name || situation.id : situationId || "-";
}

function pathBadge(status) {
  if (!status) return '<span class="fy-badge fy-badge-bad">invalid</span>';
  if (status.status === "available") return '<span class="fy-badge fy-badge-good">available</span>';
  if (status.status === "played") return '<span class="fy-badge">played</span>';
  if (status.status === "blocked") return '<span class="fy-badge fy-badge-bad">blocked</span>';
  if (status.pathLocked || status.status === "locked") return '<span class="fy-badge fy-badge-warning">locked</span>';
  return `<span class="fy-badge">${esc(status.status || "path")}</span>`;
}

function rowClasses({ situation, pathStatus, isActive, isNext, isPlayed }) {
  const classes = ["fy-list-item", "runtime-row"];
  if (isActive) classes.push("active");
  if (isNext) classes.push("next");
  if (isPlayed) classes.push("played");
  if (!pathStatus) classes.push("invalid");
  if (pathStatus && (pathStatus.pathLocked || pathStatus.status === "locked" || pathStatus.status === "blocked")) {
    classes.push("locked");
  }
  if (!situation.active || situation.archivedAt) classes.push("inactive");
  return classes.join(" ");
}

function scoreValueFor(situationId, scores, eligibleById) {
  const score = scores.get(situationId) || null;
  if (score && Number.isFinite(Number(score.predictedScore))) return Number(score.predictedScore);
  const eligible = eligibleById.get(situationId) || null;
  if (eligible && Number.isFinite(Number(eligible.scoreValue))) return Number(eligible.scoreValue);
  if (eligible && eligible.score && Number.isFinite(Number(eligible.score.predictedScore))) {
    return Number(eligible.score.predictedScore);
  }
  return 0;
}

function compareLiveScore(a, b) {
  if (a.scoreValue !== b.scoreValue) return b.scoreValue - a.scoreValue;
  const sortA = Number(a.situation.sortOrder || a.situation.legacyId || 0);
  const sortB = Number(b.situation.sortOrder || b.situation.legacyId || 0);
  if (sortA !== sortB) return sortA - sortB;
  return Number(a.situation.legacyId || 0) - Number(b.situation.legacyId || 0);
}

function makeRuntimeRow({ situation, pathStatus, score, scoreValue, isActive = false, isNext = false, isPlayed = false, sequence = 0 }) {
  return {
    situation,
    pathStatus,
    score,
    scoreValue,
    isActive,
    isNext,
    isPlayed,
    sequence,
  };
}

function runtimeRows() {
  const paths = pathStatusMap();
  const scores = scoreMap();
  const played = playedIndexMap();
  const playedCount = (state && state.playedSituations || []).length;
  const eligibleById = new Map(((state && state.eligiblePool) || [])
    .map((item) => [item.situationId, item]));
  const situationById = byId(activeSituations());
  const activeId = state && state.activeSituation ? state.activeSituation.situationId : "";
  const nextId = state && state.preparedNext ? state.preparedNext.situationId : "";
  const used = new Set();
  const rows = [];
  const push = (situation, flags = {}) => {
    if (!situation || used.has(situation.id)) return;
    used.add(situation.id);
    rows.push(makeRuntimeRow({
      situation,
      pathStatus: paths.get(situation.id) || null,
      score: scores.get(situation.id) || null,
      scoreValue: scoreValueFor(situation.id, scores, eligibleById),
      ...flags,
    }));
  };

  ((state && state.playedSituations) || []).forEach((item, index) => {
    push(situationById.get(item.situationId), {
      isPlayed: true,
      sequence: index + 1,
    });
  });

  if (activeId) {
    push(situationById.get(activeId), {
      isActive: true,
      sequence: playedCount + 1,
    });
  } else if (nextId) {
    push(situationById.get(nextId), {
      isNext: true,
      sequence: playedCount + 1,
    });
  }

  if (activeId && nextId) {
    push(situationById.get(nextId), {
      isNext: true,
      sequence: playedCount + 2,
    });
  }

  const remaining = activeSituations()
    .filter((situation) => !used.has(situation.id))
    .map((situation) => makeRuntimeRow({
      situation,
      pathStatus: paths.get(situation.id) || null,
      score: scores.get(situation.id) || null,
      scoreValue: scoreValueFor(situation.id, scores, eligibleById),
      isPlayed: played.has(situation.id),
    }));
  const remainingById = new Map(remaining.map((row) => [row.situation.id, row]));
  const availableFromRuntime = ((state && state.eligiblePool) || [])
    .map((item) => remainingById.get(item.situationId))
    .filter(Boolean);
  const runtimeAvailableIds = new Set(availableFromRuntime.map((row) => row.situation.id));
  const availableFallback = remaining
    .filter((row) => !runtimeAvailableIds.has(row.situation.id))
    .filter((row) => row.pathStatus && row.pathStatus.status === "available")
    .sort(compareLiveScore);
  const locked = remaining
    .filter((row) => !runtimeAvailableIds.has(row.situation.id))
    .filter((row) => !(row.pathStatus && row.pathStatus.status === "available"))
    .sort(compareLiveScore);
  return rows.concat(availableFromRuntime, availableFallback, locked)
    .map((row, index) => ({ ...row, sequence: row.sequence || index + 1 }));
}

function renderQueueStatus() {
  const active = state && state.activeSituation ? state.activeSituation : null;
  const next = state && state.preparedNext ? state.preparedNext : null;
  const runStarted = !!(state && state.showRunId);
  const activeText = !runStarted
    ? ""
    : active
      ? active.title || situationTitle(active.situationId)
      : "Geen actieve situatie";
  const nextText = !runStarted
    ? ""
    : next
      ? next.title || situationTitle(next.situationId)
      : "Geen volgende situatie";
  $("queueStatus").innerHTML = `
    <div class="queue-line">
      <span class="queue-label">Nu</span>
      <span class="queue-title ${active ? "" : "muted"}">${esc(activeText)}</span>
      ${active ? '<span class="fy-badge fy-badge-good">active</span>' : ""}
    </div>
    <div class="queue-line">
      <span class="queue-label">Volgende</span>
      <span class="queue-title ${next ? "" : "muted"}">${esc(nextText)}</span>
    </div>
  `;
}

function renderOrderList() {
  const rows = runtimeRows();
  $("orderBadge").textContent = `${rows.length} situatie${rows.length === 1 ? "" : "s"}`;
  if (!rows.length) {
    $("runtimeOrderList").innerHTML = '<div class="fy-small">Geen actieve situaties.</div>';
    return;
  }
  const characterMap = byId(catalog().characters || []);
  const environmentMap = byId(catalog().environments || []);
  $("runtimeOrderList").innerHTML = rows.map((row) => {
    const situation = row.situation;
    const characters = (situation.characterIds || [])
      .map((id) => characterMap.get(id))
      .filter(Boolean)
      .map((item) => item.name || item.id);
    const environment = situation.environmentId ? environmentMap.get(situation.environmentId) : null;
    const hasScore = !!(row.score && Number.isFinite(Number(row.score.predictedScore)));
    const scoreText = hasScore ? formatScore(row.score.predictedScore) : "0.0";
    const scorePhase = state && state.lastScoreFeed && state.lastScoreFeed.scorePhase === "live" ? "live " : "";
    const scoreBadge = `<span class="fy-badge score-badge${hasScore ? "" : " score-badge-empty"}"${hasScore ? "" : ' aria-hidden="true"'}>${esc(scorePhase)}points ${esc(scoreText)}</span>`;
    const stateBadges = [
      row.isActive ? '<span class="fy-badge fy-badge-good">active</span>' : "",
      row.isNext ? '<span class="fy-badge fy-badge-warning">prepared</span>' : "",
      row.isPlayed ? '<span class="fy-badge">played</span>' : "",
    ].filter(Boolean);
    const pathStatusHtml = row.isPlayed && row.pathStatus && row.pathStatus.status === "played"
      ? ""
      : pathBadge(row.pathStatus);
    const statusBadges = stateBadges.concat(pathStatusHtml ? [pathStatusHtml] : []).join("");
    const pathNames = row.pathStatus && Array.isArray(row.pathStatus.pathStatuses)
      ? row.pathStatus.pathStatuses.map((item) => item.pathName).filter(Boolean)
      : [];
    const metaPills = []
      .concat(characters.map((name) => `<span class="row-chip">${esc(name)}</span>`))
      .concat(environment ? [`<span class="row-chip">${esc(environment.name || environment.id)}</span>`] : [])
      .concat(pathNames.slice(0, 2).map((name) => `<span class="row-chip">pad: ${esc(name)}</span>`));
    return `
      <div class="${rowClasses(row)}" data-situation-id="${esc(situation.id)}">
        <span class="order-number">${row.sequence}</span>
        <div class="row-body">
          <div class="row-title-line">
            <span class="row-title">${esc(situation.title || situation.name || situation.id)}</span>
          </div>
          ${metaPills.length ? `<div class="row-meta-pills">${metaPills.join("")}</div>` : ""}
        </div>
        <div class="row-status-slot">
          <div class="row-score-line">${scoreBadge}</div>
          <div class="row-badge-line">${statusBadges}</div>
        </div>
      </div>
    `;
  }).join("");
  scrollOrderSelection(rows);
}

function scrollOrderSelection(rows) {
  const target = rows.find((row) => row.isActive) || rows.find((row) => row.isNext) || null;
  if (!target) {
    lastScrollTargetKey = "";
    return;
  }
  const situationId = target.situation && target.situation.id ? target.situation.id : "";
  const key = `${state && state.showRunId || "idle"}:${target.isActive ? "active" : "next"}:${situationId}:${(state && state.playedSituations || []).length}`;
  if (!situationId || key === lastScrollTargetKey) return;
  lastScrollTargetKey = key;
  window.requestAnimationFrame(() => {
    const list = $("runtimeOrderList");
    const el = list ? list.querySelector(`[data-situation-id="${CSS.escape(situationId)}"]`) : null;
    if (!el) return;
    const behavior = window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth";
    const listRect = list.getBoundingClientRect();
    const rowRect = el.getBoundingClientRect();
    const targetTop = Math.max(0, rowRect.top - listRect.top + list.scrollTop);
    list.scrollTo({ top: targetTop, behavior });
    if (behavior === "smooth") {
      window.setTimeout(() => {
        const currentList = $("runtimeOrderList");
        const currentEl = currentList ? currentList.querySelector(`[data-situation-id="${CSS.escape(situationId)}"]`) : null;
        if (!currentList || !currentEl) return;
        const currentTargetTop = Math.max(
          0,
          currentEl.getBoundingClientRect().top - currentList.getBoundingClientRect().top + currentList.scrollTop
        );
        if (Math.abs(currentList.scrollTop - currentTargetTop) > 3) {
          currentList.scrollTo({ top: currentTargetTop, behavior: "auto" });
        }
      }, 360);
    }
  });
}

function renderFacts() {
  const scores = state && state.lastScoreFeed ? state.lastScoreFeed.scores || [] : [];
  const finalization = state && state.finalizationStatus ? state.finalizationStatus : null;
  const rankSummary = state && state.lastRankChangeSummary ? state.lastRankChangeSummary : null;
  const scoreFeedParts = state && state.lastScoreFeed
    ? [
      state.lastScoreFeed.scorePhase || null,
      state.lastScoreFeed.source || null,
      `${scores.length} scores`,
    ].filter(Boolean).join(", ")
    : "-";
  const facts = [
    ["Status", state && state.status ? state.status : "idle"],
    ["Show run", state && state.showRunId ? state.showRunId : "-"],
    ["Aangemaakt", state && state.createdAt ? formatTime(state.createdAt) : "-"],
    ["Bijgewerkt", state && state.updatedAt ? formatTime(state.updatedAt) : "-"],
    ["Catalog snapshot", state && state.showRunSnapshot ? state.showRunSnapshot.catalog.schemaVersion || "-" : "-"],
    ["Paths snapshot", state && state.showRunSnapshot ? state.showRunSnapshot.paths.schemaVersion || "-" : "-"],
    ["Idle preview", state && !state.showRunSnapshot && state.catalogPreview ? "live catalog/paden" : "-"],
    ["Score feed", scoreFeedParts],
    ["Ranking", state && state.rankingRevision != null ? `rev ${state.rankingRevision}` : "-"],
    ["Laatste beweging", rankSummary ? `${rankSummary.changeReason || rankSummary.reason}${rankSummary.orderChanged ? " gewijzigd" : " stabiel"}` : "-"],
    ["Finalisatie", finalization && finalization.status ? finalization.status : "-"],
    ["Gelijke score", currentOrderSettings().randomizeEqualScores ? "random" : "sortOrder"],
  ];
  $("runFacts").innerHTML = facts.map(([key, value]) => `<dt>${esc(key)}</dt><dd>${esc(value)}</dd>`).join("");
}

function renderLog() {
  const log = ((state && state.runLog) || []).slice(-8).reverse();
  if (!log.length) {
    $("runLog").innerHTML = '<div class="fy-small">Geen runlog.</div>';
    return;
  }
  $("runLog").innerHTML = log.map((item) => `
    <div class="log-item">
      <strong>${esc(item.type || "event")}</strong>
      <span>${esc(formatTime(item.at))}${item.situationId ? ` - ${esc(item.situationId)}` : ""}</span>
    </div>
  `).join("");
}

function renderActions() {
  const hasRun = !!(state && state.showRunId);
  const hasActive = !!(state && state.activeSituation);
  const hasPrepared = !!(state && state.resolvedPreparedNext);
  const hasPrevious = !!(state && Array.isArray(state.playedSituations) && state.playedSituations.length);
  const runToggle = $("runToggleBtn");
  const situationToggle = $("situationToggleBtn");
  runToggle.disabled = actionPending;
  runToggle.textContent = hasRun ? "Reset run" : "Start run";
  runToggle.className = hasRun ? "fy-button fy-button-danger" : "fy-button fy-button-primary";
  situationToggle.disabled = actionPending || !hasRun || (!hasActive && !hasPrepared);
  situationToggle.textContent = hasActive ? "Stop situatie" : "Start situatie";
  situationToggle.className = hasActive ? "fy-button fy-button-danger" : "fy-button fy-button-primary";
  $("previousSituationBtn").disabled = actionPending || !hasRun || hasActive || !hasPrevious;
}

function renderOrderSettings() {
  const toggle = $("randomizeEqualScoresToggle");
  if (!toggle) return;
  toggle.checked = !!currentOrderSettings().randomizeEqualScores;
  toggle.disabled = actionPending;
}

function render() {
  const status = state && state.status ? state.status : "idle";
  const hasRun = !!(state && state.showRunId);
  $("topMeta").textContent = hasRun ? state.showRunId : "Geen actieve run";
  $("runStatusBadge").textContent = status;
  $("runStatusBadge").className = `fy-badge ${status === "running" ? "fy-badge-good" : ""}`;
  $("playedCount").textContent = String((state && state.playedSituations || []).length);
  $("eligibleCount").textContent = String((state && state.eligiblePool || []).length);
  $("scoreCount").textContent = String((state && state.lastScoreFeed && state.lastScoreFeed.scores || []).length);
  renderQueueStatus();
  renderOrderList();
  renderFacts();
  renderLog();
  renderOrderSettings();
  renderActions();
}

async function refreshState(options = {}) {
  try {
    state = await api("/v0/runtime/runs/current/view");
    render();
    setMessage(options.message || "");
  } catch (err) {
    setMessage(displayError(err, "Runtime status ophalen mislukt."), true);
  }
}

async function withAction(fn) {
  if (actionPending) return;
  actionPending = true;
  renderActions();
  try {
    state = await fn();
    render();
  } catch (err) {
    setMessage(displayError(err, "Actie mislukt."), true);
  } finally {
    actionPending = false;
    renderActions();
  }
}

function bindActions() {
  $("runToggleBtn").addEventListener("click", () => {
    if (!(state && state.showRunId)) {
      withAction(async () => {
        const orderSettings = orderSettingsFromUi();
        saveLocalOrderSettings(orderSettings);
        const next = await post("/v0/runtime/runs/start", { orderSettings });
        setMessage("");
        return next;
      });
      return;
    }
    if (!window.confirm("Reset deze runtime run? Alle gespeelde situaties en de huidige selectie worden gewist.")) return;
    withAction(async () => {
      const next = await post(`/v0/runtime/runs/${encodeURIComponent(state.showRunId)}/reset`);
      setMessage("");
      return next;
    });
  });
  $("situationToggleBtn").addEventListener("click", () => withAction(async () => {
    if (state && state.activeSituation) {
      const next = await post(`/v0/runtime/runs/${encodeURIComponent(state.showRunId)}/stop-situation`);
      setMessage("");
      return next;
    }
    const next = await post(`/v0/runtime/runs/${encodeURIComponent(state.showRunId)}/start-situation`);
    setMessage("");
    return next;
  }));
  $("previousSituationBtn").addEventListener("click", () => withAction(async () => {
    const next = await post(`/v0/runtime/runs/${encodeURIComponent(state.showRunId)}/previous-situation`, { reason: "manual" });
    setMessage("");
    return next;
  }));
  $("randomizeEqualScoresToggle").addEventListener("change", () => withAction(async () => {
    const orderSettings = orderSettingsFromUi();
    saveLocalOrderSettings(orderSettings);
    if (!(state && state.showRunId)) {
      setMessage("");
      return state;
    }
    const next = await api(`/v0/runtime/runs/${encodeURIComponent(state.showRunId)}/order-settings`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(orderSettings),
    });
    setMessage("");
    return next;
  }));
}

document.addEventListener("DOMContentLoaded", () => {
  bindActions();
  refreshState();
  refreshTimer = window.setInterval(() => refreshState(), 1000);
  window.addEventListener("beforeunload", () => {
    if (refreshTimer) window.clearInterval(refreshTimer);
  });
});
