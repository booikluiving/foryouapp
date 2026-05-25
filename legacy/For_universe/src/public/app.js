(function () {
  "use strict";

  const Data = window.ForUniverseData;
  const Sky = window.ForUniverseSky;
  const RUNTIME_OVERLAY_ENABLED = true;

  const state = {
    graph: null,
    runtime: null,
    model: null,
    renderer: null,
    runtimeTimer: null,
    runtimeSignature: "",
    view: "network",
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

  async function fetchJson(endpoint) {
    const res = await fetch(endpoint, { headers: { Accept: "application/json" } });
    if (!res.ok) throw new Error(`${endpoint} failed with HTTP ${res.status}`);
    const payload = await res.json();
    if (!payload.ok) throw new Error(payload.error || `${endpoint} failed`);
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

  function updateTopStats(model) {
    $("sourceStatus").textContent = "ok";
    $("pathCount").textContent = String(model.summary.pathCount || model.paths.length);
    $("sceneCount").textContent = String(model.summary.sceneCount || model.sceneById.size);
    $("looseCount").textContent = String(model.summary.looseSceneCount || model.looseScenes.length);
  }

  function renderModel() {
    state.model = Data.buildSkyModel(state.graph, state.runtime);
    updateTopStats(state.model);
    if (RUNTIME_OVERLAY_ENABLED) updateRuntimePanel(state.runtime);
    state.renderer.setModel(state.model);
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

  async function loadApp() {
    buildRenderer();
    setView(new URLSearchParams(window.location.search).get("view"));
    const graphPayload = await fetchJson("/api/universe/graph");
    state.graph = graphPayload.graph;
    state.runtime = null;
    if (RUNTIME_OVERLAY_ENABLED) {
      const runtimePayload = await fetchJson("/api/universe/runtime");
      state.runtime = runtimePayload.runtime;
      state.runtimeSignature = runtimeSignature(state.runtime);
    }
    renderModel();
    if (RUNTIME_OVERLAY_ENABLED) startRuntimePolling();
  }

  async function refreshRuntime() {
    const runtimePayload = await fetchJson("/api/universe/runtime");
    const nextSignature = runtimeSignature(runtimePayload.runtime);
    if (nextSignature === state.runtimeSignature) return;
    state.runtime = runtimePayload.runtime;
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

    setViewButtons(state.view);
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
