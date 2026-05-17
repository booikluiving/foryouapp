(function () {
  "use strict";

  const Data = window.ForUniverseData;
  const Sky = window.ForUniverseSky;

  const state = {
    graph: null,
    runtime: null,
    runtimeEnabled: true,
    runtimeSignature: "",
    model: null,
    renderer: null,
    runtimeTimer: null,
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

  function buildRenderer() {
    state.renderer = Sky.createSkyRenderer({
      sky: $("sky"),
      stage: $("stage"),
      tooltip: $("hoverPanel"),
      infoPanel: null,
      elements: {
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

  function renderModel() {
    const runtime = state.runtimeEnabled ? state.runtime : null;
    state.model = Data.buildSkyModel(state.graph, runtime);
    state.renderer.setModel(state.model);
  }

  function setViewButtons(view) {
    document.querySelectorAll("[data-stage-view]").forEach((button) => {
      const active = button.getAttribute("data-stage-view") === view;
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

  function setRuntimeEnabled(enabled) {
    state.runtimeEnabled = !!enabled;
    const button = $("stageRuntime");
    if (button) {
      button.setAttribute("aria-pressed", String(state.runtimeEnabled));
      button.classList.toggle("on", state.runtimeEnabled);
    }
    renderModel();
  }

  async function refreshRuntime() {
    const runtimePayload = await fetchJson("/api/universe/runtime").catch(() => null);
    if (!runtimePayload) return;
    const nextSignature = runtimeSignature(runtimePayload.runtime);
    if (nextSignature === state.runtimeSignature) return;
    state.runtime = runtimePayload.runtime;
    state.runtimeSignature = nextSignature;
    renderModel();
  }

  function startRuntimePolling() {
    if (state.runtimeTimer) window.clearInterval(state.runtimeTimer);
    state.runtimeTimer = window.setInterval(() => {
      refreshRuntime().catch(() => {});
    }, 3500);
  }

  function setMenuOpen(open) {
    const menu = $("stageMenu");
    const toggle = $("stageMenuToggle");
    if (!menu || !toggle) return;
    document.body.classList.toggle("stage-controls-open", open);
    menu.hidden = !open;
    toggle.setAttribute("aria-expanded", String(open));
  }

  function wireStageControls() {
    const toggle = $("stageMenuToggle");
    if (toggle) toggle.addEventListener("click", () => setMenuOpen(!document.body.classList.contains("stage-controls-open")));

    document.querySelectorAll("[data-stage-action]").forEach((button) => {
      button.addEventListener("click", () => {
        const action = button.getAttribute("data-stage-action");
        if (action === "close") setMenuOpen(false);
      });
    });

    document.querySelectorAll("[data-stage-view]").forEach((button) => {
      button.addEventListener("click", () => setView(button.getAttribute("data-stage-view")));
    });

    document.querySelectorAll("[data-stage-tweak]").forEach((button) => {
      button.addEventListener("click", () => {
        const pressed = button.getAttribute("aria-pressed") !== "true";
        button.setAttribute("aria-pressed", String(pressed));
        button.classList.toggle("on", pressed);
        if (state.renderer) state.renderer.setTweak(button.dataset.stageTweak, pressed);
      });
    });

    const runtimeButton = $("stageRuntime");
    if (runtimeButton) runtimeButton.addEventListener("click", () => setRuntimeEnabled(!state.runtimeEnabled));

    window.addEventListener("keydown", (event) => {
      if (event.key.toLowerCase() !== "m") return;
      if (event.target && ["INPUT", "TEXTAREA", "SELECT"].includes(event.target.tagName)) return;
      setMenuOpen(!document.body.classList.contains("stage-controls-open"));
    });

    const params = new URLSearchParams(window.location.search);
    setView(params.get("view"));
    if (params.get("controls") === "1") setMenuOpen(true);
  }

  async function loadStage() {
    buildRenderer();
    wireStageControls();
    const graphPayload = await fetchJson("/api/universe/graph");
    state.graph = graphPayload.graph;
    const runtimePayload = await fetchJson("/api/universe/runtime").catch(() => null);
    state.runtime = runtimePayload ? runtimePayload.runtime : null;
    state.runtimeSignature = runtimeSignature(state.runtime);
    renderModel();
    startRuntimePolling();
  }

  loadStage().catch((err) => {
    $("sky").innerHTML = `
      <foreignObject x="420" y="330" width="760" height="190">
        <div class="empty-state">${escapeText(err.message)}</div>
      </foreignObject>
    `;
  });
})();
