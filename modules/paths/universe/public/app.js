(function () {
  "use strict";

  const Data = window.ForUniverseData;
  const Sky = window.ForUniverseSky;
  const RUNTIME_OVERLAY_ENABLED = false;

  const state = {
    graph: null,
    runtime: null,
    model: null,
    renderer: null,
    runtimeTimer: null,
    runtimeSignature: "",
    view: "network",
    testMode: false,
    testPlayedSceneIds: [],
    testEvaluation: null,
    testBusy: false,
    testError: "",
    testRequestId: 0,
  };

  const $ = (id) => document.getElementById(id);

  function escapeText(value) {
    return String(value ?? "").replace(/[&<>"']/g, (ch) => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      "\"": "&quot;",
      "'": "&#39;",
    }[ch]));
  }

  async function fetchJson(endpoint, options = {}) {
    const res = await fetch(endpoint, {
      ...options,
      headers: { Accept: "application/json", ...(options.headers || {}) },
    });
    if (!res.ok) throw new Error(`${endpoint} failed with HTTP ${res.status}`);
    const payload = await res.json();
    if (payload.ok === false) throw new Error(payload.error || `${endpoint} failed`);
    return payload;
  }

  function buildRenderer() {
    state.renderer = Sky.createSkyRenderer({
      sky: $("sky"),
      stage: $("stage"),
      tooltip: $("hoverPanel"),
      infoPanel: $("infoPanel"),
      elements: {
        thumbStrip: $("bbThumbs"),
        ipClose: $("ipClose"),
        ipEyebrow: $("ipEyebrow"),
        ipTitle: $("ipTitle"),
        ipMeta: $("ipMeta"),
        ipStars: $("ipStars"),
        ipFocus: $("ipFocus"),
        ipReset: $("ipReset"),
        debugPanel: $("debugPanel"),
        debugCanvasCenter: $("debugCanvasCenter"),
        debugOrbitCenter: $("debugOrbitCenter"),
        debugStartCenter: $("debugStartCenter"),
        debugWorldCenter: $("debugWorldCenter"),
        debugRadius: $("debugRadius"),
        debugVisualCenter: $("debugVisualCenter"),
        debugSectorBalance: $("debugSectorBalance"),
        debugBreakdown: $("debugBreakdown"),
        debugCamera: $("debugCamera"),
        motionAmount: $("motionAmount"),
        motionAmountValue: $("motionAmountValue"),
        motionSpeed: $("motionSpeed"),
        motionSpeedValue: $("motionSpeedValue"),
        motionDepth: $("motionDepth"),
        motionDepthValue: $("motionDepthValue"),
        motionScale: $("motionScale"),
        motionScaleValue: $("motionScaleValue"),
        motionSpin: $("motionSpin"),
        motionSpinValue: $("motionSpinValue"),
      },
      onSceneClick: ({ sceneId }) => {
        if (!state.testMode) return false;
        playTestScene(sceneId);
        return true;
      },
    });
  }

  function nextSceneText(runtime) {
    const prepared = runtime && Array.isArray(runtime.preparedNextScenes) ? runtime.preparedNextScenes : [];
    const graphNext = runtime && Array.isArray(runtime.graphNextScenes) ? runtime.graphNextScenes : [];
    const scenes = prepared.length ? prepared : graphNext;
    if (!scenes.length) return "geen next";
    return scenes.slice(0, 3).map((scene) => scene.title).join(" -> ");
  }

  function updateRuntimePanel(runtime) {
    $("runtimeSession").textContent = runtime && runtime.session
      ? runtime.session.name || `Sessie ${runtime.session.id}`
      : "geen sessie";
    $("runtimeCurrent").textContent = runtime && runtime.currentScene
      ? runtime.currentScene.title
      : "geen actieve scene";
    $("runtimePath").textContent = runtime && runtime.activePathCandidates && runtime.activePathCandidates.length
      ? runtime.activePathCandidates.map((pathItem) => `${pathItem.name} (${pathItem.confidence})`).join(", ")
      : "geen padcontext";
    $("runtimeNext").textContent = nextSceneText(runtime);
  }

  function runtimeSignature(runtime) {
    if (!runtime) return "";
    return JSON.stringify({
      sessionId: runtime.session && runtime.session.id,
      sessionActive: runtime.session && runtime.session.isActive,
      algorithmRunStarted: runtime.session && runtime.session.algorithmRunStarted,
      hasActiveRun: runtime.summary && runtime.summary.hasActiveRun,
      currentSceneId: runtime.currentScene && runtime.currentScene.sceneId,
      playedSceneIds: runtime.playedSceneIds || [],
      preparedSceneIds: (runtime.preparedNextScenes || []).map((scene) => scene.sceneId),
      availableSceneIds: (runtime.availableScenes || []).map((scene) => scene.sceneId),
    });
  }

  function sceneTitle(sceneId) {
    const scene = state.model && state.model.sceneById
      ? state.model.sceneById.get(Number(sceneId || 0))
      : null;
    return scene && scene.title ? scene.title : `Scene ${Number(sceneId || 0)}`;
  }

  function legacySituationId(value) {
    const match = String(value || "").match(/^(?:situation:)?(\d+)$/);
    return match ? Number(match[1]) : 0;
  }

  function testItems() {
    return state.testEvaluation && Array.isArray(state.testEvaluation.items)
      ? state.testEvaluation.items
      : [];
  }

  function testItemFor(sceneId) {
    const safeSceneId = Number(sceneId || 0);
    return testItems().find((item) => Number(item.legacySituationId || legacySituationId(item.situationId)) === safeSceneId) || null;
  }

  function testScenePayload(sceneId) {
    return {
      sceneId: Number(sceneId || 0),
      title: sceneTitle(sceneId),
    };
  }

  function buildTestRuntime() {
    const items = testItems();
    const available = items.filter((item) => item.status === "available").map((item) => item.legacySituationId || legacySituationId(item.situationId)).filter(Boolean);
    const blocked = items.filter((item) => item.status === "blocked").map((item) => item.legacySituationId || legacySituationId(item.situationId)).filter(Boolean);
    const locked = items.filter((item) => item.status === "locked").map((item) => item.legacySituationId || legacySituationId(item.situationId)).filter(Boolean);
    return {
      testMode: true,
      session: {
        id: "universe-testpad",
        name: "Testpad",
        isActive: true,
        algorithmRunStarted: true,
      },
      summary: {
        hasActiveRun: true,
      },
      currentScene: null,
      playedSceneIds: state.testPlayedSceneIds.slice(),
      preparedNextScenes: [],
      graphNextScenes: [],
      availableScenes: available.map(testScenePayload),
      blockedSceneIds: blocked,
      lockedSceneIds: locked,
      activePathCandidates: [],
    };
  }

  function currentRuntime() {
    return state.testMode ? buildTestRuntime() : state.runtime;
  }

  function testCounts() {
    return testItems().reduce((acc, item) => {
      const key = String(item.status || "locked");
      acc[key] = Number(acc[key] || 0) + 1;
      return acc;
    }, {});
  }

  function availableTestItems() {
    return testItems()
      .filter((item) => item.status === "available")
      .sort((a, b) => {
        const aId = Number(a.legacySituationId || legacySituationId(a.situationId));
        const bId = Number(b.legacySituationId || legacySituationId(b.situationId));
        return aId - bId;
      });
  }

  function renderTestPanel() {
    const button = $("testModeBtn");
    const panel = $("testPanel");
    if (!button || !panel) return;
    button.classList.toggle("on", state.testMode);
    button.setAttribute("aria-pressed", String(state.testMode));
    button.textContent = state.testMode ? "Stop test" : "Test pad";
    panel.hidden = !state.testMode;
    if (!state.testMode) return;

    const counts = testCounts();
    $("testStats").textContent = state.testBusy
      ? "laden..."
      : `${counts.played || state.testPlayedSceneIds.length || 0} gespeeld · ${counts.available || 0} vrij · ${counts.locked || 0} wacht · ${counts.blocked || 0} geblokkeerd`;
    $("testUndoBtn").disabled = !state.testPlayedSceneIds.length || state.testBusy;
    $("testResetBtn").disabled = !state.testPlayedSceneIds.length || state.testBusy;
    $("testNextBtn").disabled = !availableTestItems().length || state.testBusy;

    const available = availableTestItems();
    $("testAvailable").innerHTML = state.testError
      ? `<span class="testMuted">${escapeText(state.testError)}</span>`
      : available.length
        ? available.slice(0, 8).map((item) => {
          const sceneId = Number(item.legacySituationId || legacySituationId(item.situationId));
          return `<button type="button" data-test-play="${sceneId}">${escapeText(sceneTitle(sceneId))}</button>`;
        }).join("")
        : '<span class="testMuted">Geen vrije sterren</span>';
    $("testAvailable").querySelectorAll("[data-test-play]").forEach((btn) => {
      btn.addEventListener("click", () => playTestScene(btn.dataset.testPlay));
    });
    $("testTimeline").innerHTML = state.testPlayedSceneIds.length
      ? state.testPlayedSceneIds.map((sceneId, index) => `<span><b>${index + 1}</b>${escapeText(sceneTitle(sceneId))}</span>`).join("")
      : '<span class="testMuted">Nog niets gespeeld</span>';
  }

  function updateTopStats(model) {
    $("sourceStatus").textContent = "ok";
    $("pathCount").textContent = String(model.summary.pathCount || model.paths.length);
    $("sceneCount").textContent = String(model.summary.sceneCount || model.sceneById.size);
    $("looseCount").textContent = String(model.summary.looseSceneCount || model.looseScenes.length);
  }

  function renderModel() {
    state.model = Data.buildSkyModel(state.graph, currentRuntime());
    updateTopStats(state.model);
    if (RUNTIME_OVERLAY_ENABLED) updateRuntimePanel(currentRuntime());
    if (state.renderer) state.renderer.setModel(state.model);
    renderTestPanel();
  }

  function setViewButtons(view) {
    document.querySelectorAll("[data-view]").forEach((button) => {
      const active = button.getAttribute("data-view") === view;
      button.setAttribute("aria-pressed", String(active));
      button.classList.toggle("on", active);
    });
  }

  function setView(view) {
    const requested = view || state.view;
    state.view = requested === "bigbang" ? "bigbang" : "network";
    if (state.renderer) state.view = state.renderer.setView(state.view);
    setViewButtons(state.view);
  }

  async function refreshTestEvaluation() {
    if (!state.testMode) return;
    const requestId = state.testRequestId + 1;
    state.testRequestId = requestId;
    state.testBusy = true;
    state.testError = "";
    renderTestPanel();
    try {
      const payload = await fetchJson("/v0/paths/evaluate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ playedSceneIds: state.testPlayedSceneIds }),
      });
      if (requestId !== state.testRequestId) return;
      state.testEvaluation = payload;
    } catch (err) {
      if (requestId !== state.testRequestId) return;
      state.testError = err && err.message ? err.message : "Testpad fout";
    } finally {
      if (requestId === state.testRequestId) {
        state.testBusy = false;
        renderModel();
      }
    }
  }

  function setTestMode(enabled) {
    state.testMode = !!enabled;
    state.testPlayedSceneIds = [];
    state.testEvaluation = null;
    state.testError = "";
    state.testRequestId += 1;
    renderModel();
    if (state.testMode) refreshTestEvaluation();
  }

  function resetTest() {
    if (!state.testMode) return;
    state.testPlayedSceneIds = [];
    state.testEvaluation = null;
    refreshTestEvaluation();
  }

  function undoTestStep() {
    if (!state.testMode || !state.testPlayedSceneIds.length) return;
    state.testPlayedSceneIds.pop();
    refreshTestEvaluation();
  }

  function playTestScene(sceneId) {
    const id = Number(sceneId || 0);
    if (!state.testMode || !id || state.testBusy) return;
    const item = testItemFor(id);
    if (!item || item.status !== "available") {
      renderTestPanel();
      return;
    }
    state.testPlayedSceneIds.push(id);
    refreshTestEvaluation();
  }

  function playNextTestScene() {
    const item = availableTestItems()[0];
    if (!item) return;
    playTestScene(item.legacySituationId || legacySituationId(item.situationId));
  }

  async function loadApp() {
    buildRenderer();
    setView(new URLSearchParams(window.location.search).get("view"));
    const universePayload = await fetchJson("/v0/paths/universe-state");
    state.graph = universePayload.graph;
    state.runtime = universePayload.runtime || null;
    state.runtimeSignature = runtimeSignature(state.runtime);
    renderModel();
    if (RUNTIME_OVERLAY_ENABLED) startRuntimePolling();
  }

  async function refreshRuntime() {
    const universePayload = await fetchJson("/v0/paths/universe-state");
    const nextSignature = runtimeSignature(universePayload.runtime);
    if (nextSignature === state.runtimeSignature) return;
    state.runtime = universePayload.runtime || null;
    state.runtimeSignature = nextSignature;
    renderModel();
  }

  function startRuntimePolling() {
    if (state.runtimeTimer) window.clearInterval(state.runtimeTimer);
    state.runtimeTimer = window.setInterval(() => {
      refreshRuntime().catch(() => {
        $("sourceStatus").textContent = "runtime fout";
      });
    }, 3500);
  }

  function wireControls() {
    document.querySelectorAll("[data-view]").forEach((button) => {
      button.addEventListener("click", () => setView(button.getAttribute("data-view")));
    });

    document.querySelectorAll("[data-tweak]").forEach((button) => {
      button.addEventListener("click", () => {
        const pressed = button.getAttribute("aria-pressed") !== "true";
        button.setAttribute("aria-pressed", String(pressed));
        button.classList.toggle("on", pressed);
        if (state.renderer) state.renderer.setTweak(button.dataset.tweak, pressed);
      });
    });

    $("testModeBtn").addEventListener("click", () => setTestMode(!state.testMode));
    $("testNextBtn").addEventListener("click", playNextTestScene);
    $("testUndoBtn").addEventListener("click", undoTestStep);
    $("testResetBtn").addEventListener("click", resetTest);

    setViewButtons(state.view);
    renderTestPanel();
  }

  wireControls();
  loadApp().catch((err) => {
    $("sourceStatus").textContent = "fout";
    $("sky").innerHTML = `
      <foreignObject x="420" y="330" width="760" height="190">
        <div class="empty-state">${escapeText(err.message)}</div>
      </foreignObject>
    `;
  });
})();
