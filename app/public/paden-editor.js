(() => {
  "use strict";

  const Graph = window.PadenGraph;
  const TOKEN_KEY = "algorithm_admin_token_v1";
  const LAYOUT_KEY = "paden_editor_layouts_v1";
  const PREF_KEY = "paden_editor_prefs_v1";
  const NODE_W = Graph.DEFAULT_NODE_W;
  const NODE_H = Graph.DEFAULT_NODE_H;
  const PATH_COLOR_ROWS = [
    ["#111111", "#2f2f2f", "#545454", "#737373", "#969696", "#b7b7b7", "#d0d0d0", "#e0e0e0", "#ececec", "#f5f5f5"],
    ["#b80000", "#e53935", "#fb8c00", "#fdd835", "#43a047", "#00acc1", "#039be5", "#1e88e5", "#8e24aa", "#d81b60"],
    ["#f4cccc", "#fce5cd", "#fff2cc", "#d9ead3", "#d0e0e3", "#cfe2f3", "#c9daf8", "#d9d2e9", "#ead1dc", "#f8d3e0"],
    ["#ea9999", "#f9cb9c", "#ffe599", "#b6d7a8", "#a2c4c9", "#9fc5e8", "#6fa8dc", "#b4a7d6", "#d5a6bd", "#e89bbd"],
    ["#cc4125", "#e69138", "#f1c232", "#6aa84f", "#45818e", "#3d85c6", "#1155cc", "#674ea7", "#a64d79", "#c27ba0"],
    ["#a61c00", "#b45f06", "#bf9000", "#38761d", "#134f5c", "#0b5394", "#1c4587", "#351c75", "#741b47", "#4c1130"],
    ["#7f1d1d", "#7f2f00", "#7f6000", "#274e13", "#0c343d", "#073763", "#1f3a63", "#20124d", "#4a0f40", "#660033"],
    ["#ff6f61", "#f4b183", "#ffe066", "#76d64b", "#4dd0c8", "#5bc0eb", "#5e8ee7", "#7e57c2", "#ba68c8", "#f06292"],
  ];
  const COLORS = PATH_COLOR_ROWS.flat();
  const AUTO_COLOR_ORDER = PATH_COLOR_ROWS.slice(1).flat().concat(PATH_COLOR_ROWS[0]);
  const DEFAULT_COLOR = AUTO_COLOR_ORDER[0];
  const ARROW_LEN = 18;
  const ARROW_HALF = 10;
  const ARROW_GAP = 9;
  const ZOOM_MIN = 0.55;
  const ZOOM_MAX = 2;
  const ZOOM_STEP = 0.1;
  const WORLD_PAD_X = 2400;
  const WORLD_PAD_Y = 520;

  let token = "";
  let state = { scenes: [], paths: [], crossingThresholds: [], characters: [], situations: [], environments: [] };
  let sceneById = new Map();
  let characterById = new Map();
  let situationById = new Map();
  let environmentById = new Map();
  let activePathId = "";
  let selectedPathIds = new Set();
  let selectedNodeId = 0;
  let selectedNodeIds = new Set();
  let expandedNodeIds = new Set();
  let selectedEdgeKey = "";
  let dirtyPathIds = new Set();
  let dirtyCrossingThresholdSceneIds = new Set();
  let saving = false;
  let searchQ = "";
  let jumpQ = "";
  let layouts = {};
  let showNeighbors = true;
  let canvasZoom = 1;
  let scenePaneCollapsed = false;
  let inspectorCollapsed = false;
  let dragEdge = null;
  let marquee = null;
  let pinchGesture = null;
  let modalMode = "edit";
  let testMode = false;
  let testPlayedSceneIds = [];
  let testResultCache = null;
  let compositionTransformCache = {};
  let miniMapBounds = null;

  const $ = (id) => document.getElementById(id);
  const esc = (value) => String(value ?? "").replace(/[&<>"']/g, (ch) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "\"": "&quot;",
    "'": "&#39;",
  }[ch]));
  const pathKey = (path) => String(path && path.id || "");
  const activeKey = () => String(activePathId || "");
  const colorValue = (value, fallback = DEFAULT_COLOR) => {
    const clean = String(value || "").replace(/[^#(),.%a-zA-Z0-9 -]/g, "").trim();
    return clean || fallback;
  };
  const colorKey = (value) => colorValue(value).toLowerCase();
  const rawColorKey = (value) => colorValue(value, "").toLowerCase();
  const clampZoom = (value) => {
    const parsed = Number(value);
    const safe = Number.isFinite(parsed) ? parsed : 1;
    return Math.round(Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, safe)) * 100) / 100;
  };

  function loadLocal() {
    try { token = String(localStorage.getItem(TOKEN_KEY) || ""); } catch { token = ""; }
    try { layouts = JSON.parse(localStorage.getItem(LAYOUT_KEY) || "{}") || {}; } catch { layouts = {}; }
    try {
      const prefs = JSON.parse(localStorage.getItem(PREF_KEY) || "{}") || {};
      showNeighbors = prefs.showNeighbors !== false;
      selectedPathIds = new Set((prefs.selectedPathIds || prefs.visiblePathIds || []).map(String));
      activePathId = String(prefs.activePathId || "");
      canvasZoom = clampZoom(prefs.canvasZoom || 1);
      scenePaneCollapsed = !!prefs.scenePaneCollapsed;
      inspectorCollapsed = !!prefs.inspectorCollapsed;
    } catch {
      selectedPathIds = new Set();
      canvasZoom = 1;
      scenePaneCollapsed = false;
      inspectorCollapsed = false;
    }
  }

  function saveToken(nextToken) {
    token = String(nextToken || "");
    try {
      if (token) localStorage.setItem(TOKEN_KEY, token);
      else localStorage.removeItem(TOKEN_KEY);
    } catch {}
  }

  function saveLayouts() {
    try { localStorage.setItem(LAYOUT_KEY, JSON.stringify(layouts)); } catch {}
  }

  function savePrefs() {
    try {
      localStorage.setItem(PREF_KEY, JSON.stringify({
        activePathId: activeKey(),
        selectedPathIds: Array.from(selectedPathIds),
        showNeighbors,
        canvasZoom,
        scenePaneCollapsed,
        inspectorCollapsed,
      }));
    } catch {}
  }

  function applyPanelState() {
    const leftPane = $("leftPane");
    if (leftPane) leftPane.classList.toggle("collapsed", !!scenePaneCollapsed);
    const sceneCollapse = $("scenePaneCollapseBtn");
    if (sceneCollapse) {
      sceneCollapse.textContent = scenePaneCollapsed ? ">" : "<";
      sceneCollapse.title = scenePaneCollapsed ? "Situaties uitklappen" : "Situaties inklappen";
    }
    const inspector = $("inspectorPane");
    if (inspector) inspector.classList.toggle("collapsed", !!inspectorCollapsed);
    const inspectorToggle = $("inspectorToggleBtn");
    if (inspectorToggle) {
      inspectorToggle.textContent = inspectorCollapsed ? "+" : "-";
      inspectorToggle.title = inspectorCollapsed ? "Node info uitklappen" : "Node info inklappen";
    }
  }

  function setScenePaneCollapsed(nextCollapsed) {
    scenePaneCollapsed = !!nextCollapsed;
    applyPanelState();
    savePrefs();
    renderCanvas();
  }

  function setInspectorCollapsed(nextCollapsed) {
    inspectorCollapsed = !!nextCollapsed;
    applyPanelState();
    savePrefs();
  }

  function clearNodeSelection() {
    selectedNodeIds.clear();
    expandedNodeIds.clear();
    selectedNodeId = 0;
  }

  function clearSelection() {
    clearNodeSelection();
    selectedEdgeKey = "";
  }

  function setSingleNodeSelection(sceneId) {
    const id = Number(sceneId || 0);
    clearNodeSelection();
    if (id) selectedNodeIds.add(id);
    selectedNodeId = id;
    selectedEdgeKey = "";
  }

  function toggleNodeSelection(sceneId) {
    const id = Number(sceneId || 0);
    if (!id) return;
    selectedEdgeKey = "";
    if (selectedNodeIds.has(id)) {
      selectedNodeIds.delete(id);
      expandedNodeIds.delete(id);
      selectedNodeId = selectedNodeIds.size ? Array.from(selectedNodeIds).at(-1) : 0;
      return;
    }
    selectedNodeIds.add(id);
    selectedNodeId = id;
  }

  function setNodeSelection(sceneIds = []) {
    const ids = Graph.normalizeIdList(sceneIds);
    selectedNodeIds = new Set(ids);
    expandedNodeIds = new Set(Array.from(expandedNodeIds).filter((id) => selectedNodeIds.has(Number(id))));
    selectedNodeId = ids.length ? ids[ids.length - 1] : 0;
    selectedEdgeKey = "";
  }

  function isNodeSelected(sceneId) {
    return selectedNodeIds.has(Number(sceneId || 0));
  }

  function toggleNodeExpanded(sceneId) {
    const id = Number(sceneId || 0);
    if (!id) return;
    if (!isNodeSelected(id)) setSingleNodeSelection(id);
    if (expandedNodeIds.has(id)) expandedNodeIds.delete(id);
    else expandedNodeIds.add(id);
    renderCanvas();
  }

  async function api(path, options = {}) {
    const headers = { ...(options.headers || {}) };
    if (token) headers["x-admin-token"] = token;
    const opts = { ...options, headers };
    if (opts.body && typeof opts.body !== "string") {
      headers["Content-Type"] = "application/json";
      opts.body = JSON.stringify(opts.body);
    }
    const res = await fetch(path, opts);
    const text = await res.text().catch(() => "");
    let body = {};
    try { body = text ? JSON.parse(text) : {}; } catch { body = {}; }
    if (!res.ok) {
      const err = new Error(body && body.error ? body.error : `HTTP ${res.status}`);
      err.status = res.status;
      err.body = body;
      throw err;
    }
    return body;
  }

  function toast(message, isError = false) {
    const el = $("toast");
    el.textContent = message || "";
    el.classList.toggle("error", !!isError);
    el.classList.add("show");
    clearTimeout(toast.timer);
    toast.timer = setTimeout(() => el.classList.remove("show"), 2600);
  }

  function setSaveState(kind) {
    const el = $("saveState");
    el.classList.remove("saved", "dirty", "saving");
    el.classList.add(kind);
    const dirtyCount = dirtyPathIds.size + dirtyCrossingThresholdSceneIds.size;
    el.querySelector(".txt").textContent =
      kind === "saving" ? "Opslaan..." :
      kind === "dirty" ? `${dirtyCount || 1} niet opgeslagen` :
      "Opgeslagen";
  }

  function markDirty(pathOrKey = activePath()) {
    const key = typeof pathOrKey === "string" ? pathOrKey : pathKey(pathOrKey);
    if (key) dirtyPathIds.add(key);
    setSaveState(dirtyPathIds.size || dirtyCrossingThresholdSceneIds.size ? "dirty" : "saved");
    if ($("chipbar")) renderChips();
  }

  function markClean(pathOrKey) {
    const key = typeof pathOrKey === "string" ? pathOrKey : pathKey(pathOrKey);
    if (key) dirtyPathIds.delete(key);
    setSaveState(dirtyPathIds.size || dirtyCrossingThresholdSceneIds.size ? "dirty" : "saved");
    if ($("chipbar")) renderChips();
  }

  function showLogin(message = "") {
    $("app").style.display = "none";
    $("login").classList.add("open");
    $("loginMsg").textContent = message || "";
  }

  function showApp() {
    $("login").classList.remove("open");
    $("app").style.display = "flex";
  }

  function activePaths() {
    return (state.paths || []).filter((path) => path && path.isActive !== false && !path.archivedAt);
  }

  function activeScenes() {
    return (state.scenes || []).filter((scene) => scene && scene.isActive !== false && !scene.archivedAt);
  }

  function testPathNumericId(path, index = 0) {
    const numeric = Number.parseInt(String(path && path.id || ""), 10);
    return Number.isInteger(numeric) && numeric > 0 ? numeric : 100000 + index;
  }

  function testSimulationPaths() {
    return activePaths().map((path, index) => {
      const sceneIds = Graph.getPathSceneIds(path);
      const edges = edgesForSave(path);
      return {
        id: testPathNumericId(path, index),
        name: path.name || "Naamloos pad",
        color: path.color || DEFAULT_COLOR,
        edgeMode: "manual",
        sceneIds,
        edges,
        thresholds: Graph.normalizeThresholdsForEdges(path.thresholds || [], sceneIds, edges),
        endSceneIds: Graph.normalizeIdList(path.endSceneIds || []).filter((id) => sceneIds.includes(Number(id))),
        blockRules: Graph.normalizeBlockRules(path.blockRules || [], sceneIds),
        ignoreCrossingBlockSceneIds: Graph.normalizeIgnoreCrossingBlockSceneIds(path, sceneIds),
        isActive: path.isActive !== false,
        archivedAt: path.archivedAt || "",
      };
    });
  }

  function getTestResult() {
    if (!testMode) return null;
    if (testResultCache) return testResultCache;
    const simPaths = testSimulationPaths();
    const pathIdByKey = new Map(activePaths().map((path, index) => [pathKey(path), testPathNumericId(path, index)]));
    const statuses = Graph.buildPathSceneStatuses({
      paths: simPaths,
      scenes: activeScenes(),
      playedSceneIds: testPlayedSceneIds,
      crossingThresholds: state.crossingThresholds || [],
    });
    const playedSet = new Set(Graph.normalizeIdList(testPlayedSceneIds));
    testResultCache = { statuses, playedSet, pathIdByKey };
    return testResultCache;
  }

  function invalidateTestResult() {
    testResultCache = null;
  }

  function normalizeEditorState(data) {
    const src = data && typeof data === "object" ? data : {};
    const catalog = src.catalog && typeof src.catalog === "object" ? src.catalog : src;
    return {
      scenes: Array.isArray(catalog.scenes) ? catalog.scenes : [],
      paths: Array.isArray(catalog.paths) ? catalog.paths : [],
      characters: Array.isArray(catalog.characters) ? catalog.characters : [],
      situations: Array.isArray(catalog.situations) ? catalog.situations : [],
      environments: Array.isArray(catalog.environments) ? catalog.environments : [],
      crossingThresholds: Graph.normalizeCrossingThresholdsForPaths(catalog.crossingThresholds || [], catalog.paths || []),
    };
  }

  function activePath() {
    return activePaths().find((path) => pathKey(path) === activeKey()) || null;
  }

  function pathById(id) {
    const key = String(id || "");
    return (state.paths || []).find((path) => pathKey(path) === key) || null;
  }

  function selectedPaths() {
    return activePaths().filter((path) => selectedPathIds.has(pathKey(path)));
  }

  function selectedSceneIds() {
    const seen = new Set();
    selectedPaths().forEach((path) => {
      Graph.getPathSceneIds(path).forEach((sceneId) => seen.add(Number(sceneId)));
    });
    return Array.from(seen);
  }

  function pathsContainingScene(sceneId, paths = selectedPaths()) {
    const id = Number(sceneId || 0);
    if (!id) return [];
    return paths.filter((path) => Graph.getPathSceneIds(path).includes(id));
  }

  function isDraftPath(path) {
    return !!(path && String(path.id || "").startsWith("draft-"));
  }

  function rebuildIndexes() {
    sceneById = new Map((state.scenes || []).map((scene) => [Number(scene.id || 0), scene]));
    characterById = new Map((state.characters || []).map((character) => [Number(character.id || 0), character]));
    situationById = new Map((state.situations || []).map((situation) => [Number(situation.id || 0), situation]));
    environmentById = new Map((state.environments || []).map((environment) => [Number(environment.id || 0), environment]));
  }

  function ensureSelection() {
    const paths = activePaths();
    if (!paths.length) {
      activePathId = "";
      selectedPathIds.clear();
      savePrefs();
      return;
    }
    const validKeys = paths.map(pathKey).filter(Boolean);
    const validSet = new Set(validKeys);
    selectedPathIds = new Set(Array.from(selectedPathIds).filter((key) => validSet.has(key)));
    if (activePath() && !selectedPathIds.has(activeKey())) activePathId = "";
    if (!activePath() && selectedPathIds.size) activePathId = Array.from(selectedPathIds)[0];
    savePrefs();
  }

  async function loadState({ show = false } = {}) {
    try {
      const data = await api("/admin/algorithm/state");
      state = normalizeEditorState(data);
      rebuildIndexes();
      ensureSelection();
      dirtyPathIds.clear();
      dirtyCrossingThresholdSceneIds.clear();
      setSaveState("saved");
      showApp();
      renderAll();
      focusPathInView(activeKey(), { behavior: "auto" });
    } catch (err) {
      if (err.status === 401 || show) showLogin(err.status === 401 ? "" : "Kon de paden niet laden.");
      else toast(`Laden mislukt: ${err.message}`, true);
    }
  }

  async function tryDeviceLogin() {
    try {
      const body = await api("/admin/login/device", { method: "POST" });
      saveToken(body.token);
      await loadState({ show: true });
      return true;
    } catch {
      return false;
    }
  }

  async function login() {
    $("loginMsg").textContent = "";
    try {
      const body = await api("/admin/login", {
        method: "POST",
        body: {
          password: $("password").value,
          rememberDevice: $("rememberDevice").checked,
          deviceLabel: navigator.userAgent || "",
        },
      });
      saveToken(body.token);
      $("password").value = "";
      await loadState({ show: true });
    } catch (err) {
      $("loginMsg").textContent = err && err.message === "too_many_attempts"
        ? "Te veel pogingen. Probeer later opnieuw."
        : "Login mislukt.";
    }
  }

  function ensureManualLayout(pathId) {
    const key = String(pathId || "");
    if (!layouts[key]) layouts[key] = {};
    return layouts[key];
  }

  function getLayout(path) {
    const base = Graph.computePathLayout(path || {}, {
      nodeWidth: NODE_W,
      nodeHeight: NODE_H,
      centerX: 390,
      laneGap: 184,
      rowGap: 102,
    });
    const manual = ensureManualLayout(pathKey(path));
    Object.keys(manual).forEach((sceneId) => {
      const id = Number(sceneId);
      if (!Graph.getPathSceneIds(path).includes(id)) return;
      base.positions[id] = {
        x: Number(manual[sceneId].x || 0),
        y: Number(manual[sceneId].y || 0),
      };
    });
    const values = Object.values(base.positions);
    if (values.length) {
      base.width = Math.max(base.width, ...values.map((pos) => pos.x + NODE_W + 90), 820);
      base.height = Math.max(base.height, ...values.map((pos) => pos.y + NODE_H + 120), 760);
    }
    return base;
  }

  function freezeCurrentLayout(path) {
    const manual = ensureManualLayout(pathKey(path));
    const layout = getLayout(path);
    Graph.getPathSceneIds(path).forEach((sceneId) => {
      if (manual[sceneId] || !layout.positions[sceneId]) return;
      manual[sceneId] = {
        x: Number(layout.positions[sceneId].x || 0),
        y: Number(layout.positions[sceneId].y || 0),
      };
    });
    return { manual, positions: layout.positions || {} };
  }

  function viewportNodePosition() {
    const outer = $("canvasOuter");
    return {
      x: (outer.scrollLeft + outer.clientWidth / 2) / canvasZoom - NODE_W / 2,
      y: (outer.scrollTop + outer.clientHeight / 2) / canvasZoom - NODE_H / 2,
    };
  }

  function openNodePosition(seed, occupied = []) {
    const gapY = NODE_H + 36;
    const gapX = NODE_W + 34;
    const origin = {
      x: Number(seed && seed.x || 20),
      y: Number(seed && seed.y || 20),
    };
    const collides = (pos) => occupied.some((other) => (
      Math.abs(Number(other.x || 0) - pos.x) < NODE_W + 16
      && Math.abs(Number(other.y || 0) - pos.y) < NODE_H + 16
    ));
    let candidate = { ...origin };
    for (let attempt = 0; attempt < 24 && collides(candidate); attempt += 1) {
      candidate = {
        x: origin.x + Math.floor((attempt + 1) / 6) * gapX,
        y: origin.y + ((attempt + 1) % 6) * gapY,
      };
    }
    return candidate;
  }

  function transformForPath(model, pathOrKey) {
    const key = typeof pathOrKey === "string" ? pathOrKey : pathKey(pathOrKey);
    return model && model.pathTransforms && model.pathTransforms.get(key)
      ? model.pathTransforms.get(key)
      : { dx: 0, dy: 0 };
  }

  function canvasToPathLocalPosition(model, pathOrKey, position = {}) {
    const transform = transformForPath(model, pathOrKey);
    return {
      x: Number(position.x || 0) - Number(transform.dx || 0),
      y: Number(position.y || 0) - Number(transform.dy || 0),
    };
  }

  function addedScenePosition(existingIds = [], currentPositions = {}, fallbackSeed = null) {
    const occupied = existingIds
      .map((id) => currentPositions[id])
      .filter(Boolean);
    const refId = selectedNodeId && existingIds.includes(Number(selectedNodeId))
      ? Number(selectedNodeId)
      : existingIds[existingIds.length - 1];
    const ref = refId ? currentPositions[refId] : null;
    const seed = ref
      ? { x: Number(ref.x || 20), y: Number(ref.y || 20) + NODE_H + 86 }
      : (fallbackSeed || viewportNodePosition());
    return openNodePosition(seed, occupied);
  }

  function activeSceneIds() {
    return selectedSceneIds();
  }

  function pathEdgeSelectionKey(path, edge) {
    return `${pathKey(path)}|${Graph.edgeKey(edge)}`;
  }

  function parsePathEdgeSelectionKey(value) {
    const [pathId, edgeKey] = String(value || "").split("|");
    return { pathId: pathId || "", edgeKey: edgeKey || "" };
  }

  function buildUnifiedCanvasModel() {
    const paths = selectedPaths();
    const composed = new Map();
    const pathPositions = new Map();
    const pathEndpoints = new Map();
    const pathEdges = new Map();
    const worldTransforms = new Map();
    const renderTransforms = new Map();
    let nextX = 380;

    paths.forEach((path, index) => {
      const key = pathKey(path);
      const pathLayout = getLayout(path);
      const sceneIds = Graph.getPathSceneIds(path);
      const sourcePositions = pathLayout.positions || {};
      const anchorId = index > 0
        ? sceneIds.find((sceneId) => composed.has(Number(sceneId)) && sourcePositions[sceneId])
        : 0;
      const cachedTransform = compositionTransformCache[key] || null;
      let dx = Number(cachedTransform && cachedTransform.dx || 0);
      let dy = Number(cachedTransform && cachedTransform.dy || 0);

      if (cachedTransform) {
        // Stable world transform: selecting another target path should move the camera, not the field.
      } else if (anchorId) {
        const anchor = composed.get(Number(anchorId));
        dx = Number(anchor.worldPosition.x || 0) - Number(sourcePositions[anchorId].x || 0);
        dy = Number(anchor.worldPosition.y || 0) - Number(sourcePositions[anchorId].y || 0);
      } else if (index > 0) {
        const values = Object.values(sourcePositions);
        const minX = values.length ? Math.min(...values.map((pos) => pos.x)) : 0;
        const minY = values.length ? Math.min(...values.map((pos) => pos.y)) : 0;
        dx = nextX - minX;
        dy = 72 + index * 36 - minY;
      }

      const worldPositions = {};
      if (!cachedTransform) compositionTransformCache[key] = { dx, dy };
      worldTransforms.set(key, { dx, dy });
      sceneIds.forEach((sceneId) => {
        const id = Number(sceneId);
        const existing = composed.get(id);
        if (existing) {
          worldPositions[id] = existing.worldPosition;
          existing.pathIds.add(key);
          existing.paths.push(path);
          existing.colors.push(colorValue(path.color));
          return;
        }
        const source = sourcePositions[id];
        if (!source) return;
        const worldPosition = {
          x: Number(source.x || 0) + dx,
          y: Number(source.y || 0) + dy,
        };
        worldPositions[id] = worldPosition;
        composed.set(id, {
          sceneId: id,
          pathIds: new Set([key]),
          paths: [path],
          colors: [colorValue(path.color)],
          worldPosition,
        });
      });

      const pathWorldValues = Object.values(worldPositions);
      if (pathWorldValues.length) {
        nextX = Math.max(nextX, ...pathWorldValues.map((pos) => pos.x + NODE_W + 130));
      }
      pathPositions.set(key, worldPositions);
      pathEdges.set(key, Graph.getRenderableEdges(path, { fallback: true }));
      pathEndpoints.set(key, Graph.pathEndpoints(path, { fallback: true }));
    });

    const worldNodes = Array.from(composed.values());
    const worldPositions = worldNodes.map((node) => node.worldPosition).filter(Boolean);
    const minWorldX = worldPositions.length ? Math.min(...worldPositions.map((pos) => Number(pos.x || 0))) : 0;
    const minWorldY = worldPositions.length ? Math.min(...worldPositions.map((pos) => Number(pos.y || 0))) : 0;
    const offsetX = minWorldX + WORLD_PAD_X < 80 ? 80 - minWorldX : WORLD_PAD_X;
    const offsetY = minWorldY + WORLD_PAD_Y < 80 ? 80 - minWorldY : WORLD_PAD_Y;

    const nodes = worldNodes.map((node) => ({
      ...node,
      pathIds: Array.from(node.pathIds),
      isShared: node.pathIds.size > 1,
      position: {
        x: Number(node.worldPosition.x || 0) + offsetX,
        y: Number(node.worldPosition.y || 0) + offsetY,
      },
    }));

    const renderPathPositions = new Map();
    pathPositions.forEach((positions, key) => {
      const rendered = {};
      Object.entries(positions).forEach(([sceneId, pos]) => {
        rendered[sceneId] = {
          x: Number(pos.x || 0) + offsetX,
          y: Number(pos.y || 0) + offsetY,
        };
      });
      renderPathPositions.set(key, rendered);
    });
    worldTransforms.forEach((transform, key) => {
      renderTransforms.set(key, {
        dx: Number(transform.dx || 0) + offsetX,
        dy: Number(transform.dy || 0) + offsetY,
      });
    });

    const allPositions = nodes.map((node) => node.position).filter(Boolean);
    const layout = viewportSizedLayout({
      positions: Object.fromEntries(nodes.map((node) => [node.sceneId, node.position])),
      width: allPositions.length ? Math.max(820, ...allPositions.map((pos) => pos.x + NODE_W + WORLD_PAD_X)) : 820,
      height: allPositions.length ? Math.max(760, ...allPositions.map((pos) => pos.y + NODE_H + WORLD_PAD_Y)) : 760,
    });

    return {
      paths,
      nodes,
      pathPositions: renderPathPositions,
      pathEdges,
      pathEndpoints,
      pathTransforms: renderTransforms,
      worldOffset: { x: offsetX, y: offsetY },
      layout,
    };
  }

  function renderAll() {
    applyPanelState();
    renderTopMeta();
    renderChips();
    renderSceneList();
    renderCanvas();
  }

  function renderTopMeta() {
    const path = activePath();
    $("topMeta").textContent = path ? `${path.name || "Naamloos pad"} · graph-editor` : "Graph-editor";
  }

  function renderChips() {
    const bar = $("chipbar");
    const paths = activePaths();
    const selectedCount = paths.filter((path) => selectedPathIds.has(pathKey(path))).length;
    const allSelected = !!paths.length && selectedCount === paths.length;
    const noneSelected = selectedCount === 0;
    const chips = paths.map((path) => {
      const key = pathKey(path);
      const isSelected = selectedPathIds.has(key);
      const isTarget = key === activeKey();
      const isDirty = dirtyPathIds.has(key);
      return `<span class="chip ${isSelected ? "selected" : ""} ${isTarget ? "target" : ""} ${isDirty ? "dirty" : ""}">
        <button type="button" data-path-target="${esc(key)}" title="Klik om te bewerken, dubbelklik voor pad info">
          <span class="dot" style="background:${colorValue(path.color)}"></span>
          <span class="txt">${esc(path.name || "Naamloos pad")}</span>
          ${isTarget ? '<span class="targetBadge">doel</span>' : ""}
        </button>
        <button type="button" class="pathVisibilityToggle ${isSelected ? "isOn" : "isOff"}" data-path-check="${esc(key)}" data-selected="${isSelected ? "true" : "false"}" title="${isSelected ? "Verberg pad" : "Toon pad"}" aria-label="${isSelected ? "Verberg pad" : "Toon pad"}">
          <span class="visibilityIcon"></span>
        </button>
      </span>`;
    }).join("");

    bar.innerHTML = `
      <span class="barLabel">Paden</span>
      <button type="button" class="chipAction primary" data-new-path>+ Nieuw pad</button>
      <button type="button" class="chipAction" data-select-all-paths ${allSelected ? "disabled" : ""}>Alles aan</button>
      <button type="button" class="chipAction" data-deselect-all-paths ${noneSelected ? "disabled" : ""}>Alles uit</button>
      ${chips || '<span class="chip">Nog geen paden</span>'}
      <span class="barHint">${selectedCount}/${paths.length} zichtbaar</span>
      <span style="flex:1"></span>
      <label class="switch">
        <input id="showNeighborsToggle" type="checkbox" ${showNeighbors ? "checked" : ""} />
        <span class="track"></span>
        Toon buren <span style="color:var(--muted);font-weight:550">(1 verder)</span>
      </label>
    `;

    const newPathBtn = bar.querySelector("[data-new-path]");
    if (newPathBtn) newPathBtn.addEventListener("click", () => openPathModal("new"));
    const selectAllPathsBtn = bar.querySelector("[data-select-all-paths]");
    if (selectAllPathsBtn) selectAllPathsBtn.addEventListener("click", selectAllPaths);
    const deselectAllPathsBtn = bar.querySelector("[data-deselect-all-paths]");
    if (deselectAllPathsBtn) deselectAllPathsBtn.addEventListener("click", deselectAllPaths);
    bar.querySelectorAll("[data-path-check]").forEach((button) => {
      button.addEventListener("click", () => {
        setPathSelected(button.dataset.pathCheck, button.dataset.selected !== "true");
      });
    });
    bar.querySelectorAll("[data-path-target]").forEach((button) => {
      button.addEventListener("click", () => activatePath(button.dataset.pathTarget));
      button.addEventListener("dblclick", () => {
        if (activatePath(button.dataset.pathTarget)) openPathModal("edit");
      });
    });
    $("showNeighborsToggle").addEventListener("change", (event) => {
      showNeighbors = !!event.target.checked;
      savePrefs();
      renderCanvas();
    });
  }

  function activatePath(nextId) {
    const key = String(nextId || "");
    if (!key) return false;
    if (key === activeKey()) {
      focusPathInView(key);
      return true;
    }
    if (!pathById(key)) return false;
    activePathId = key;
    clearSelection();
    selectedPathIds.add(key);
    ensureSelection();
    renderAll();
    focusPathInView(key);
    return true;
  }

  function selectAllPaths() {
    const keys = activePaths().map(pathKey).filter(Boolean);
    if (!keys.length) return;
    selectedPathIds = new Set(keys);
    if (!activePath()) activePathId = keys[0];
    savePrefs();
    renderAll();
  }

  function deselectAllPaths() {
    if (!selectedPathIds.size) return;
    selectedPathIds.clear();
    activePathId = "";
    clearSelection();
    savePrefs();
    renderAll();
  }

  function setPathSelected(nextId, selected) {
    const key = String(nextId || "");
    if (!key) return;
    const isSelected = selectedPathIds.has(key);
    if (!selected) {
      if (!isSelected) {
        renderChips();
        return;
      }
      selectedPathIds.delete(key);
      const wasActive = key === activeKey();
      if (key === activeKey()) activePathId = Array.from(selectedPathIds)[0] || "";
      clearSelection();
      ensureSelection();
      renderAll();
      if (wasActive && activeKey()) focusPathInView(activeKey());
      return;
    }
    if (isSelected) {
      renderChips();
      return;
    }
    selectedPathIds.add(key);
    savePrefs();
    renderAll();
  }

  function renderSceneList() {
    const list = $("sceneList");
    const q = searchQ.toLowerCase();
    const activeSet = new Set(activeSceneIds());
    const targetSet = new Set(Graph.getPathSceneIds(activePath() || {}));
    const membership = Graph.analyzePathMembership(activePaths());
    const scenes = (state.scenes || [])
      .filter((scene) => scene && scene.isActive !== false && !scene.archivedAt)
      .filter((scene) => !q || String(scene.title || "").toLowerCase().includes(q))
      .sort((a, b) => String(a.title || "").localeCompare(String(b.title || "")));

    $("sceneCount").textContent = scenes.length ? `· ${scenes.length}` : "0";
    const railCount = $("sceneRailCount");
    if (railCount) railCount.textContent = String(scenes.length || 0);
    list.innerHTML = scenes.map((scene) => {
      const id = Number(scene.id || 0);
      const dots = (membership.get(id) || []).slice(0, 3).map((item) => (
        `<span title="${esc(item.name)}" style="background:${colorValue(item.color)}"></span>`
      )).join("");
      return `<div class="sceneRow ${activeSet.has(id) ? "inActive" : ""} ${targetSet.has(id) ? "inTargetPath" : ""}" draggable="true" data-scene-id="${id}" title="${esc(scene.title || "")}">
        <span class="grip"><i></i><i></i><i></i></span>
        <span class="name">${esc(scene.title || `Situatie #${id}`)}</span>
        <span class="scenePathDots">${dots}</span>
      </div>`;
    }).join("");

    list.querySelectorAll(".sceneRow").forEach((row) => {
      const sceneId = Number(row.dataset.sceneId || 0);
      row.addEventListener("dragstart", (event) => {
        event.dataTransfer.effectAllowed = "copy";
        event.dataTransfer.setData("application/x-scene-id", String(sceneId));
      });
      row.addEventListener("dblclick", () => addSceneToPath(sceneId));
      row.addEventListener("click", () => {
        if (!activeSet.has(sceneId)) return;
        setSingleNodeSelection(sceneId);
        renderCanvas();
        scrollNodeIntoView(sceneId);
      });
    });
  }

  function renderZoomControls() {
    const level = $("zoomResetBtn");
    if (!level) return;
    level.textContent = `${Math.round(canvasZoom * 100)}%`;
    $("zoomOutBtn").disabled = canvasZoom <= ZOOM_MIN + 0.001;
    $("zoomInBtn").disabled = canvasZoom >= ZOOM_MAX - 0.001;
  }

  function viewportSizedLayout(layout = {}) {
    const outer = $("canvasOuter");
    const viewportWidth = outer ? Math.ceil(outer.clientWidth / canvasZoom) : 0;
    const viewportHeight = outer ? Math.ceil(outer.clientHeight / canvasZoom) : 0;
    return {
      ...layout,
      width: Math.max(820, viewportWidth, Number(layout.width || 820)),
      height: Math.max(760, viewportHeight, Number(layout.height || 760)),
    };
  }

  function applyCanvasZoom(layout = {}) {
    const width = Math.max(820, Number(layout.width || 820));
    const height = Math.max(760, Number(layout.height || 760));
    const sizer = $("canvasSizer");
    const inner = $("canvasInner");
    sizer.style.width = `${Math.ceil(width * canvasZoom)}px`;
    sizer.style.height = `${Math.ceil(height * canvasZoom)}px`;
    inner.style.transform = `scale(${canvasZoom})`;
    renderZoomControls();
  }

  function setCanvasZoom(nextZoom, anchor = {}) {
    const outer = $("canvasOuter");
    const previousZoom = canvasZoom;
    const next = clampZoom(nextZoom);
    if (Math.abs(next - previousZoom) < 0.001) return;
    const focusX = typeof anchor.focusX === "number"
      ? anchor.focusX
      : (outer.scrollLeft + outer.clientWidth / 2) / previousZoom;
    const focusY = typeof anchor.focusY === "number"
      ? anchor.focusY
      : (outer.scrollTop + outer.clientHeight / 2) / previousZoom;
    const viewportX = typeof anchor.viewportX === "number" ? anchor.viewportX : outer.clientWidth / 2;
    const viewportY = typeof anchor.viewportY === "number" ? anchor.viewportY : outer.clientHeight / 2;
    canvasZoom = next;
    savePrefs();
    renderCanvas();
    outer.scrollLeft = Math.max(0, focusX * canvasZoom - viewportX);
    outer.scrollTop = Math.max(0, focusY * canvasZoom - viewportY);
    updateMiniViewport();
  }

  function canvasPoint(event) {
    const rect = $("canvasInner").getBoundingClientRect();
    return {
      x: (event.clientX - rect.left) / canvasZoom,
      y: (event.clientY - rect.top) / canvasZoom,
    };
  }

  function zoomAtClientPoint(nextZoom, clientX, clientY) {
    const outer = $("canvasOuter");
    const rect = outer.getBoundingClientRect();
    const viewportX = clientX - rect.left;
    const viewportY = clientY - rect.top;
    setCanvasZoom(nextZoom, {
      focusX: (outer.scrollLeft + viewportX) / canvasZoom,
      focusY: (outer.scrollTop + viewportY) / canvasZoom,
      viewportX,
      viewportY,
    });
  }

  function rectFromPoints(a, b) {
    const left = Math.min(a.x, b.x);
    const top = Math.min(a.y, b.y);
    return {
      left,
      top,
      right: Math.max(a.x, b.x),
      bottom: Math.max(a.y, b.y),
      width: Math.abs(a.x - b.x),
      height: Math.abs(a.y - b.y),
    };
  }

  function nodeIntersectsRect(pos, rect) {
    if (!pos) return false;
    const nodeLeft = Number(pos.x || 0);
    const nodeTop = Number(pos.y || 0);
    const nodeRight = nodeLeft + NODE_W;
    const nodeBottom = nodeTop + NODE_H;
    return nodeRight >= rect.left
      && nodeLeft <= rect.right
      && nodeBottom >= rect.top
      && nodeTop <= rect.bottom;
  }

  function ensureMarqueeBox() {
    let box = $("selectionMarquee");
    if (!box) {
      box = document.createElement("div");
      box.id = "selectionMarquee";
      box.className = "selectionMarquee";
      $("canvasInner").appendChild(box);
    }
    return box;
  }

  function updateMarqueeBox(rect) {
    const box = ensureMarqueeBox();
    box.style.left = `${rect.left}px`;
    box.style.top = `${rect.top}px`;
    box.style.width = `${rect.width}px`;
    box.style.height = `${rect.height}px`;
  }

  function removeMarqueeBox() {
    const box = $("selectionMarquee");
    if (box) box.remove();
  }

  function sceneIdsInRect(rect) {
    const model = buildUnifiedCanvasModel();
    return model.nodes
      .filter((node) => nodeIntersectsRect(node.position, rect))
      .map((node) => Number(node.sceneId));
  }

  function sceneTitle(sceneId) {
    const scene = sceneById.get(Number(sceneId || 0));
    return scene && scene.title ? scene.title : `Situatie #${Number(sceneId || 0)}`;
  }

  function testStatusFor(sceneId, testResult = getTestResult()) {
    return testResult && testResult.statuses ? testResult.statuses.get(Number(sceneId || 0)) || null : null;
  }

  function testStatusLabel(status) {
    const value = String(status && status.nodeStatus || "Locked");
    if (value === "Played") return "Gespeeld";
    if (value === "Available") return status && status.optional ? "Optioneel" : "Vrij";
    if (value === "Blocked") return "Geblokkeerd";
    return "Wacht";
  }

  function testStatusClass(status) {
    const value = String(status && status.nodeStatus || "Locked").toLowerCase();
    return value === "played" || value === "available" || value === "blocked" ? value : "locked";
  }

  function testReasonForStatus(status) {
    if (!status) return "Niet in een actief pad.";
    if (status.nodeStatus === "Played") return "Al gespeeld in deze test.";
    if (status.nodeStatus === "Available") {
      if (status.optional) return "Vrij als optionele tak.";
      if (status.isPathStart) return "Vrij als startnode.";
      return "Vrijgegeven door de gespeelde voorgangers.";
    }
    if (status.expiredOptional) return "Zijtak voorbij: de verplichte route is al verder gegaan.";
    if (status.pathClosed) return "Pad gesloten door een eindnode.";
    if (status.blockingRules && status.blockingRules.length) {
      const source = status.blockingRules[0].sourceSceneId;
      return `Geblokkeerd door ${sceneTitle(source)}.`;
    }
    const threshold = (status.blockingThresholds || []).find((group) => !group.satisfied) || null;
    const crossingThreshold = status.blockingCrossingThreshold && !status.blockingCrossingThreshold.satisfied
      ? status.blockingCrossingThreshold
      : null;
    if (crossingThreshold) {
      return `Kruising wacht op ${crossingThreshold.requiredCount} van ${crossingThreshold.incomingCount} inkomende routes; ${crossingThreshold.completedCount} gespeeld.`;
    }
    if (threshold) {
      return `Funnel wacht op ${threshold.requiredCount} van ${threshold.outgoingCount} inkomende routes; ${threshold.completedCount} gespeeld.`;
    }
    const missing = Graph.normalizeIdList(status.missingPredecessorIds || []);
    if (missing.length) return `Wacht op ${missing.map(sceneTitle).join(", ")}.`;
    if (status.isMerge) return "Wacht op inkomende routes.";
    return "Nog niet vrijgegeven in deze test.";
  }

  function setTestMode(enabled) {
    testMode = !!enabled;
    testPlayedSceneIds = [];
    invalidateTestResult();
    clearSelection();
    renderAll();
  }

  function resetTest() {
    testPlayedSceneIds = [];
    invalidateTestResult();
    renderCanvas();
  }

  function undoTestStep() {
    testPlayedSceneIds.pop();
    invalidateTestResult();
    renderCanvas();
  }

  function playTestScene(sceneId) {
    const id = Number(sceneId || 0);
    if (!testMode || !id) return;
    const status = testStatusFor(id);
    if (!status) {
      toast("Deze node zit niet in de testcontext.", true);
      return;
    }
    if (status.nodeStatus === "Played") {
      toast("Deze node is al gespeeld in deze test.", true);
      return;
    }
    if (status.nodeStatus !== "Available") {
      toast(testReasonForStatus(status), true);
      return;
    }
    testPlayedSceneIds.push(id);
    selectedNodeId = id;
    invalidateTestResult();
    renderCanvas();
  }

  function nextAvailableTestNode(model = buildUnifiedCanvasModel()) {
    const result = getTestResult();
    if (!result) return null;
    return (model.nodes || [])
      .map((node) => {
        const status = testStatusFor(node.sceneId, result);
        return { node, status };
      })
      .filter((item) => item.status && item.status.nodeStatus === "Available")
      .sort((a, b) => {
        const ay = Number(a.node.position && a.node.position.y || 0);
        const by = Number(b.node.position && b.node.position.y || 0);
        if (ay !== by) return ay - by;
        return Number(a.node.position && a.node.position.x || 0) - Number(b.node.position && b.node.position.x || 0);
      })[0] || null;
  }

  function playNextTestNode() {
    const next = nextAvailableTestNode();
    if (!next) {
      toast("Geen vrije node in de zichtbare paden.", true);
      return;
    }
    playTestScene(next.node.sceneId);
  }

  function renderTestPanel(model, testResult) {
    const panel = $("testPanel");
    const button = $("testModeBtn");
    if (!panel || !button) return;
    button.classList.toggle("primary", !testMode);
    button.classList.toggle("active", testMode);
    button.textContent = testMode ? "Stop test" : "Test pad";
    if (!testMode || !testResult) {
      panel.hidden = true;
      return;
    }
    panel.hidden = false;
    const visibleIds = (model.nodes || []).map((node) => Number(node.sceneId || 0));
    const visibleStatuses = visibleIds.map((id) => testStatusFor(id, testResult)).filter(Boolean);
    const counts = visibleStatuses.reduce((acc, status) => {
      acc[testStatusClass(status)] = Number(acc[testStatusClass(status)] || 0) + 1;
      return acc;
    }, {});
    $("testStats").textContent = `${counts.played || 0} gespeeld · ${counts.available || 0} vrij · ${counts.locked || 0} wacht · ${counts.blocked || 0} geblokkeerd`;
    $("testUndoBtn").disabled = !testPlayedSceneIds.length;
    $("testNextBtn").disabled = !nextAvailableTestNode(model);
    const available = visibleIds
      .map((id) => ({ id, status: testStatusFor(id, testResult), pos: model.layout.positions[id] || {} }))
      .filter((item) => item.status && item.status.nodeStatus === "Available")
      .sort((a, b) => (Number(a.pos.y || 0) - Number(b.pos.y || 0)) || (Number(a.pos.x || 0) - Number(b.pos.x || 0)));
    $("testAvailable").innerHTML = available.length
      ? available.slice(0, 8).map((item) => `<button type="button" data-test-play="${item.id}">${esc(sceneTitle(item.id))}</button>`).join("")
      : '<span class="testMuted">Geen vrije nodes</span>';
    $("testAvailable").querySelectorAll("[data-test-play]").forEach((btn) => {
      btn.addEventListener("click", () => playTestScene(btn.dataset.testPlay));
    });
    $("testTimeline").innerHTML = testPlayedSceneIds.length
      ? testPlayedSceneIds.map((id, index) => `<span><b>${index + 1}</b>${esc(sceneTitle(id))}</span>`).join("")
      : '<span class="testMuted">Nog niets gespeeld</span>';
  }

  function startMarqueeSelect(event) {
    if (event.button !== 0) return;
    const startPoint = canvasPoint(event);
    const startClient = { x: event.clientX, y: event.clientY };
    const additive = !!(event.shiftKey || event.metaKey || event.ctrlKey);
    const baseIds = additive ? Array.from(selectedNodeIds) : [];
    let didDrag = false;
    event.preventDefault();

    const move = (moveEvent) => {
      const distance = Math.hypot(moveEvent.clientX - startClient.x, moveEvent.clientY - startClient.y);
      if (distance < 4 && !didDrag) return;
      didDrag = true;
      const rect = rectFromPoints(startPoint, canvasPoint(moveEvent));
      const hits = sceneIdsInRect(rect);
      setNodeSelection([...baseIds, ...hits]);
      renderCanvas();
      updateMarqueeBox(rect);
    };

    const up = () => {
      document.removeEventListener("mousemove", move);
      document.removeEventListener("mouseup", up);
      removeMarqueeBox();
      if (!didDrag) {
        if (selectedNodeIds.size || selectedEdgeKey) {
          clearSelection();
          renderCanvas();
        }
        return;
      }
      renderCanvas();
    };

    document.addEventListener("mousemove", move);
    document.addEventListener("mouseup", up);
  }

  function renderCanvas() {
    invalidateTestResult();
    const targetPath = activePath();
    const model = buildUnifiedCanvasModel();
    const testResult = getTestResult();
    const inner = $("canvasInner");
    const empty = $("emptyState");
    const dropHint = $("dropHint");
    inner.classList.toggle("testMode", !!testMode);
    inner.querySelectorAll(".pathNode,.ghostNode").forEach((node) => node.remove());
    if (dropHint) {
      dropHint.textContent = testMode
        ? "Testmodus actief"
        : targetPath
          ? `Sleep situaties hierheen voor ${targetPath.name || "Naamloos pad"}`
          : "Sleep situaties hierheen";
    }

    if (!targetPath || !model.paths.length) {
      empty.style.display = "flex";
      inner.classList.remove("hasNodes");
      const blankLayout = viewportSizedLayout({ width: 820, height: 760 });
      inner.style.width = `${blankLayout.width}px`;
      inner.style.height = `${blankLayout.height}px`;
      applyCanvasZoom(blankLayout);
      $("edgesLayer").innerHTML = "";
      renderMiniMap(null, null, []);
      renderTestPanel(model, testResult);
      renderInspector(model, testResult);
      return;
    }

    empty.style.display = model.nodes.length ? "none" : "flex";
    inner.classList.toggle("hasNodes", model.nodes.length > 0);

    const layout = model.layout;
    inner.style.width = `${layout.width}px`;
    inner.style.height = `${layout.height}px`;
    applyCanvasZoom(layout);

    const svg = $("edgesLayer");
    svg.setAttribute("width", layout.width);
    svg.setAttribute("height", layout.height);
    svg.setAttribute("viewBox", `0 0 ${layout.width} ${layout.height}`);

    const membership = Graph.analyzePathMembership(activePaths());
    const ghosts = showNeighbors ? placeGhostNeighbors(Graph.selectGhostNeighbors(
      { id: "__selected__", sceneIds: model.nodes.map((node) => node.sceneId), edges: [], isActive: true },
      activePaths(),
      { activeSceneIds: model.nodes.map((node) => node.sceneId), excludePathIds: selectedPathIds }
    ), model) : [];
    renderEdges(svg, model, ghosts, testResult);

    model.nodes.forEach((nodeModel) => {
      inner.appendChild(createNode(nodeModel, membership.get(Number(nodeModel.sceneId)) || [], model, testResult));
    });

    ghosts.forEach((ghost) => {
      if (!ghost.position) return;
      inner.appendChild(createGhostNode(ghost, ghost.position));
    });

    renderMiniMap(model, ghosts);
    renderTestPanel(model, testResult);
    renderInspector(model, testResult);
  }

  function num(value) {
    return Math.round(Number(value || 0) * 10) / 10;
  }

  function edgeGeometry(posA, posB) {
    const x1 = posA.x + NODE_W / 2;
    const y1 = posA.y + NODE_H;
    const x2 = posB.x + NODE_W / 2;
    const y2 = posB.y;
    const mid = Math.max(28, Math.abs(y2 - y1) / 2);
    const c1 = { x: x1, y: y1 + mid };
    const c2 = { x: x2, y: y2 - mid };
    const target = { x: x2, y: y2 };
    const tip = { x: x2, y: y2 - ARROW_GAP };
    let dx = tip.x - c2.x;
    let dy = tip.y - c2.y;
    let len = Math.hypot(dx, dy);
    if (!len) {
      dx = x2 - x1;
      dy = y2 - y1;
      len = Math.hypot(dx, dy) || 1;
    }
    const ux = dx / len;
    const uy = dy / len;
    const base = {
      x: tip.x - ux * ARROW_LEN,
      y: tip.y - uy * ARROW_LEN,
    };
    const lineC2 = {
      x: c2.x - ux * ARROW_LEN,
      y: c2.y - uy * ARROW_LEN,
    };
    const perp = { x: -uy, y: ux };
    const left = {
      x: base.x + perp.x * ARROW_HALF,
      y: base.y + perp.y * ARROW_HALF,
    };
    const right = {
      x: base.x - perp.x * ARROW_HALF,
      y: base.y - perp.y * ARROW_HALF,
    };
    return {
      linePath: `M ${num(x1)} ${num(y1)} C ${num(c1.x)} ${num(c1.y)}, ${num(lineC2.x)} ${num(lineC2.y)}, ${num(base.x)} ${num(base.y)}`,
      hitPath: `M ${num(x1)} ${num(y1)} C ${num(c1.x)} ${num(c1.y)}, ${num(c2.x)} ${num(c2.y)}, ${num(target.x)} ${num(target.y)}`,
      arrowPoints: `${num(tip.x)},${num(tip.y)} ${num(left.x)},${num(left.y)} ${num(right.x)},${num(right.y)}`,
    };
  }

  function optionalEdgeGeometry(posA, posB) {
    const toRight = (posB.x + NODE_W / 2) >= (posA.x + NODE_W / 2);
    const x1 = toRight ? posA.x + NODE_W : posA.x;
    const y1 = posA.y + NODE_H / 2;
    const x2 = toRight ? posB.x : posB.x + NODE_W;
    const y2 = posB.y + NODE_H / 2;
    const ux = toRight ? 1 : -1;
    const target = { x: x2, y: y2 };
    const tip = { x: x2 - ux * ARROW_GAP, y: y2 };
    return {
      linePath: `M ${num(x1)} ${num(y1)} L ${num(tip.x)} ${num(tip.y)}`,
      hitPath: `M ${num(x1)} ${num(y1)} L ${num(target.x)} ${num(target.y)}`,
    };
  }

  function loopEdgeGeometry(posA, posB) {
    const centerA = posA.x + NODE_W / 2;
    const centerB = posB.x + NODE_W / 2;
    const side = centerA <= centerB ? -1 : 1;
    const x1 = side > 0 ? posA.x + NODE_W : posA.x;
    const y1 = posA.y + NODE_H / 2;
    const x2 = side > 0 ? posB.x + NODE_W : posB.x;
    const y2 = posB.y + NODE_H / 2;
    const offset = side * Math.max(90, Math.abs(y2 - y1) * 0.22 + Math.abs(x2 - x1) * 0.25);
    const c1 = { x: x1 + offset, y: y1 };
    const c2 = { x: x2 + offset, y: y2 };
    const target = { x: x2, y: y2 };
    const tip = { x: x2 + side * ARROW_GAP, y: y2 };
    let dx = tip.x - c2.x;
    let dy = tip.y - c2.y;
    let len = Math.hypot(dx, dy) || 1;
    const ux = dx / len;
    const uy = dy / len;
    const base = {
      x: tip.x - ux * ARROW_LEN,
      y: tip.y - uy * ARROW_LEN,
    };
    const lineC2 = {
      x: c2.x - ux * ARROW_LEN,
      y: c2.y - uy * ARROW_LEN,
    };
    const perp = { x: -uy, y: ux };
    const left = {
      x: base.x + perp.x * ARROW_HALF,
      y: base.y + perp.y * ARROW_HALF,
    };
    const right = {
      x: base.x - perp.x * ARROW_HALF,
      y: base.y - perp.y * ARROW_HALF,
    };
    return {
      linePath: `M ${num(x1)} ${num(y1)} C ${num(c1.x)} ${num(c1.y)}, ${num(lineC2.x)} ${num(lineC2.y)}, ${num(base.x)} ${num(base.y)}`,
      hitPath: `M ${num(x1)} ${num(y1)} C ${num(c1.x)} ${num(c1.y)}, ${num(c2.x)} ${num(c2.y)}, ${num(target.x)} ${num(target.y)}`,
      arrowPoints: `${num(tip.x)},${num(tip.y)} ${num(left.x)},${num(left.y)} ${num(right.x)},${num(right.y)}`,
    };
  }

  function thresholdRequiredForScene(path, sceneId, incomingCount, edges = null) {
    const sceneIds = Graph.getPathSceneIds(path);
    const renderedEdges = edges || Graph.getRenderableEdges(path, { fallback: true });
    const map = Graph.thresholdMapForPath({ ...path, edges: renderedEdges, edgeMode: "manual" }, { fallback: false });
    return Math.min(incomingCount, Math.max(1, Number(map.get(Number(sceneId)) || incomingCount)));
  }

  function crossingRoutesForScene(sceneId) {
    return Graph.crossingIncomingRoutesForPaths(activePaths(), Number(sceneId || 0));
  }

  function crossingThresholdRequiredForScene(sceneId, incomingCount, routes = null) {
    const map = Graph.crossingThresholdMapForPaths(state.crossingThresholds || [], activePaths());
    const id = Number(sceneId || 0);
    const globalRequired = Number(map.get(id) || 0);
    if (globalRequired) return Math.min(incomingCount, Math.max(1, globalRequired));

    const incomingRoutes = Array.isArray(routes) ? routes : crossingRoutesForScene(id);
    const routePathIds = Graph.normalizeIdList(incomingRoutes.map((route) => route.pathId));
    if (routePathIds.length === 1) {
      const sourcePath = pathById(routePathIds[0]);
      if (sourcePath) {
        return thresholdRequiredForScene(sourcePath, id, incomingCount, edgesForSave(sourcePath));
      }
    }

    return Math.min(incomingCount, Math.max(1, incomingCount));
  }

  function setCrossingThreshold(sceneId, requiredCount) {
    const id = Number(sceneId || 0);
    if (!id) return;
    const incomingRoutes = crossingRoutesForScene(id);
    const incomingCount = incomingRoutes.length;
    if (incomingCount <= 1) return;
    const routePathIds = Graph.normalizeIdList(incomingRoutes.map((route) => route.pathId));
    if (routePathIds.length === 1) {
      const sourcePath = pathById(routePathIds[0]);
      if (sourcePath) {
        setPathThreshold(sourcePath, id, requiredCount);
      }
      return;
    }
    const nextRequired = Math.min(incomingCount, Math.max(1, Number.parseInt(String(requiredCount || "1"), 10) || 1));
    const others = Graph.normalizeCrossingThresholds(state.crossingThresholds || [])
      .filter((threshold) => Number(threshold.sceneId || 0) !== id);
    state.crossingThresholds = Graph.normalizeCrossingThresholdsForPaths([
      ...others,
      { sceneId: id, requiredCount: nextRequired },
    ], activePaths());
    dirtyCrossingThresholdSceneIds.add(id);
    setSaveState("dirty");
    invalidateTestResult();
    renderCanvas();
  }

  function setPathThreshold(path, sceneId, requiredCount) {
    if (!path || !sceneId) return;
    const sceneIds = Graph.getPathSceneIds(path);
    const edges = edgesForSave(path);
    const incoming = Graph.incomingSourcesByTarget(sceneIds, edges);
    const incomingCount = incoming.get(Number(sceneId))
      ? incoming.get(Number(sceneId)).length
      : 0;
    const crossingIncomingCount = crossingRoutesForScene(sceneId).length;
    if (crossingIncomingCount > incomingCount && crossingIncomingCount > 1) {
      setCrossingThreshold(sceneId, requiredCount);
      return;
    }
    if (incomingCount <= 1) return;
    const nextRequired = Math.min(incomingCount, Math.max(1, Number.parseInt(String(requiredCount || "1"), 10) || 1));
    const others = (Array.isArray(path.thresholds) ? path.thresholds : [])
      .filter((threshold) => Number(threshold && threshold.sourceSceneId || 0) !== Number(sceneId));
    path.thresholds = Graph.normalizeThresholdsForEdges([
      ...others,
      { sourceSceneId: Number(sceneId), requiredCount: nextRequired },
    ], sceneIds, edges);
    markDirty(path);
    renderCanvas();
  }

  function funnelInfoForPath(path, sceneId, model = null) {
    const id = Number(sceneId || 0);
    if (!path || !id) return null;
    const sceneIds = Graph.getPathSceneIds(path);
    if (!sceneIds.includes(id)) return null;
    const key = pathKey(path);
    const edges = model && model.pathEdges && model.pathEdges.get(key)
      ? model.pathEdges.get(key)
      : edgesForSave(path);
    const sources = Graph.incomingSourcesByTarget(sceneIds, edges).get(id) || [];
    const crossingRoutes = crossingRoutesForScene(id);
    if (crossingRoutes.length > sources.length && crossingRoutes.length > 1) {
      return {
        sceneId: id,
        sourceIds: Graph.normalizeIdList(crossingRoutes.map((route) => route.fromSceneId)),
        count: crossingRoutes.length,
        required: crossingThresholdRequiredForScene(id, crossingRoutes.length, crossingRoutes),
        crossing: true,
      };
    }
    if (sources.length <= 1) return null;
    return {
      sceneId: id,
      sourceIds: sources,
      count: sources.length,
      required: thresholdRequiredForScene(path, id, sources.length, edges),
    };
  }

  function nodeMarkerItems(sceneId, nodeModel, members = [], model = null) {
    const id = Number(sceneId || 0);
    const path = activePath();
    const markers = [];
    const activeIds = path ? Graph.getPathSceneIds(path) : [];
    const inActivePath = !!(path && activeIds.includes(id));
    if (inActivePath) {
      const endpoints = model && model.pathEndpoints
        ? model.pathEndpoints.get(activeKey()) || { starts: [], ends: [] }
        : { starts: [], ends: [] };
      if ((endpoints.starts || []).includes(id) && !crossingRoutesForScene(id).length) {
        markers.push({ label: "Start", className: "start" });
      }
      if (isEndNodeForPath(path, id)) markers.push({ label: "Einde", className: "end" });
      if (blockRuleForSource(path, id)) markers.push({ label: "Blokkade", className: "block" });
      const funnel = funnelInfoForPath(path, id, model);
      if (funnel) markers.push({ label: `Funnel ${funnel.required}/${funnel.count}`, className: "funnel" });
    }
    const sharedCount = Math.max(
      nodeModel && Array.isArray(nodeModel.pathIds) ? nodeModel.pathIds.length : 0,
      Array.isArray(members) ? members.length : 0
    );
    if (sharedCount > 1) markers.push({ label: `Kruising · ${sharedCount} paden`, className: "crossing" });
    return markers;
  }

  function inspectorBadgesMarkup(markers = []) {
    return markers.length
      ? `<div class="inspectorBadges">${markers.map((item) => (
        `<span class="inspectorBadge ${esc(item.className || "")}">${esc(item.label)}</span>`
      )).join("")}</div>`
      : "";
  }

  function compactText(value) {
    return String(value || "").replace(/\s+/g, " ").trim();
  }

  function inspectorTextBlock(label, text) {
    const body = compactText(text);
    if (!body) return "";
    return `
      <div class="sceneInfoBlock">
        <strong>${esc(label)}</strong>
        <p>${esc(body)}</p>
      </div>
    `;
  }

  function sceneCharacterItems(scene = {}) {
    const slots = Array.isArray(scene.characterSlots) && scene.characterSlots.length
      ? scene.characterSlots
      : Graph.normalizeIdList(scene.characterIds || []);
    const items = [];
    slots.forEach((rawId, index) => {
      const id = Number(rawId || 0);
      if (!id) return;
      if (id === -1) {
        items.push({ name: `Rol ${index + 1}: Random`, description: "" });
        return;
      }
      const character = characterById.get(id);
      items.push({
        name: character && character.name ? character.name : `Personage #${id}`,
        description: "",
      });
    });
    if (items.length) return items;
    return Graph.normalizeIdList(scene.characterIds || []).map((id) => {
      const character = characterById.get(id);
      return {
        name: character && character.name ? character.name : `Personage #${id}`,
        description: "",
      };
    });
  }

  function sceneInfoList(label, items = [], options = {}) {
    const cleanItems = items
      .map((item) => ({
        name: compactText(item && item.name),
        description: compactText(item && item.description),
      }))
      .filter((item) => item.name || item.description);
    if (!cleanItems.length) return "";
    return `
      <div class="sceneInfoBlock">
        <strong>${esc(label)}</strong>
        <div class="sceneInfoList ${options.compact ? "compact" : ""}">
          ${cleanItems.map((item) => `
            <div class="sceneInfoItem">
              ${item.name ? `<b>${esc(item.name)}</b>` : ""}
              ${item.description ? `<span>${esc(item.description)}</span>` : ""}
            </div>
          `).join("")}
        </div>
      </div>
    `;
  }

  function sceneContentMarkup(scene = {}) {
    const situations = Graph.normalizeIdList(scene.situationIds || []).map((id) => {
      const situation = situationById.get(id);
      return {
        name: situation && situation.name ? situation.name : `Situatie #${id}`,
        description: situation && situation.description ? situation.description : "",
      };
    });
    const characters = sceneCharacterItems(scene);
    const environment = String(scene.environmentMode || "").toLowerCase() === "random"
      ? { name: "Random omgeving", description: "" }
      : environmentById.get(Number(scene.environmentId || 0));
    const blocks = [
      inspectorTextBlock("Scene", scene.promptOverride),
      sceneInfoList("Situatie", situations),
      sceneInfoList("Karakters", characters, { compact: true }),
      environment ? sceneInfoList("Omgeving", [{
        name: environment.name || "Omgeving",
        description: environment.description || "",
      }]) : "",
    ].filter(Boolean);
    return blocks.length
      ? `<div class="sceneInfo">${blocks.join("")}</div>`
      : `<div class="inspectorHint">Geen inhoud gekoppeld aan deze scene.</div>`;
  }

  function setInspectorHeader(kicker = "Node info", title = "Geen selectie") {
    const kickerEl = $("inspectorPanelKicker");
    const titleEl = $("inspectorPanelTitle");
    if (kickerEl) kickerEl.textContent = kicker;
    if (titleEl) titleEl.textContent = title;
  }

  function inspectorContentPane() {
    return $("inspectorContent") || $("inspectorPane");
  }

  function renderInspectorEmpty(message = "Selecteer een node of pijl om padregels te bewerken.") {
    setInspectorHeader("Node info", "Geen selectie");
    const pane = inspectorContentPane();
    if (!pane) return;
    pane.innerHTML = `<div class="inspectorEmpty"><span>${esc(message)}</span></div>`;
  }

  function renderEdgeInspector(model) {
    const pane = inspectorContentPane();
    const parsed = parsePathEdgeSelectionKey(selectedEdgeKey);
    const path = pathById(parsed.pathId);
    const edge = path && (model.pathEdges.get(parsed.pathId) || []).find((item) => Graph.edgeKey(item) === parsed.edgeKey);
    if (!pane || !path || !edge) {
      renderInspectorEmpty();
      return;
    }
    const optional = Graph.isOptionalEdge(edge);
    const loop = Graph.isLoopEdge(edge);
    const typeLabel = loop ? "Terugkoppeling" : optional ? "Zijtak" : "Verplicht";
    setInspectorHeader("Pijl", `${sceneTitle(edge.fromSceneId)} -> ${sceneTitle(edge.toSceneId)}`);
    pane.innerHTML = `
      <div class="inspectorBox">
        <div class="inspectorMeta">Geldt voor pad: ${esc(path.name || "Naamloos pad")}</div>
        <div class="inspectorSection">
          <h3>Type</h3>
          <div class="inspectorBadges">
            <span class="inspectorBadge">${typeLabel}</span>
          </div>
          <div class="inspectorActions">
            ${loop ? "" : `<button type="button" data-inspector-edge-toggle>${optional ? "Maak verplicht" : "Maak zijtak"}</button>`}
            ${loop ? "" : '<button type="button" data-inspector-edge-loop>Maak terugkoppeling</button>'}
            <button type="button" class="danger" data-inspector-edge-delete>Verwijder pijl</button>
          </div>
        </div>
      </div>
    `;
    const toggle = pane.querySelector("[data-inspector-edge-toggle]");
    const loopButton = pane.querySelector("[data-inspector-edge-loop]");
    const remove = pane.querySelector("[data-inspector-edge-delete]");
    if (toggle) toggle.addEventListener("click", () => toggleEdgeType(selectedEdgeKey));
    if (loopButton) loopButton.addEventListener("click", () => setEdgeType(selectedEdgeKey, "loop"));
    if (remove) remove.addEventListener("click", () => removeEdge(selectedEdgeKey));
  }

  function renderNodeInspector(model, testResult) {
    const pane = inspectorContentPane();
    const selectedIds = Array.from(selectedNodeIds).map(Number).filter(Boolean);
    if (!pane || !selectedIds.length) {
      renderInspectorEmpty();
      return;
    }
    if (selectedIds.length > 1) {
      setInspectorHeader("Selectie", `${selectedIds.length} nodes`);
      pane.innerHTML = `
        <div class="inspectorBox">
          <div class="inspectorMeta">Sleep om ze te verplaatsen of gebruik Delete om ze uit het actieve pad te halen.</div>
        </div>
      `;
      return;
    }
    const sceneId = selectedIds[0];
    const nodeModel = (model.nodes || []).find((item) => Number(item.sceneId || 0) === sceneId);
    const scene = sceneById.get(sceneId) || {};
    if (!nodeModel) {
      renderInspectorEmpty("Deze node is niet zichtbaar in de huidige selectie.");
      return;
    }
    const path = activePath();
    const activeIds = path ? Graph.getPathSceneIds(path) : [];
    const inActivePath = !!(path && activeIds.includes(sceneId));
    const members = Graph.analyzePathMembership(activePaths()).get(sceneId) || [];
    const markers = nodeMarkerItems(sceneId, nodeModel, members, model);
    const rule = inActivePath ? blockRuleForSource(path, sceneId) : null;
    const funnel = inActivePath ? funnelInfoForPath(path, sceneId, model) : null;
    const ignoresCrossingBlock = inActivePath && Graph.normalizeIgnoreCrossingBlockSceneIds(path, activeIds).includes(sceneId);
    const testStatus = testStatusFor(sceneId, testResult);
    const disabled = inActivePath ? "" : "disabled";
    setInspectorHeader("Node info", sceneTitle(sceneId));
    pane.innerHTML = `
      <div class="inspectorBox">
        <div class="inspectorMeta">${inActivePath ? `Geldt voor actief pad: ${esc(path.name || "Naamloos pad")}` : "Deze node zit niet in het actieve pad."}</div>
        ${inspectorBadgesMarkup(markers)}
        ${testStatus ? `
          <div class="inspectorSection">
            <h3>Teststatus</h3>
            <div class="inspectorBadges"><span class="inspectorBadge ${esc(testStatusClass(testStatus))}">${esc(testStatusLabel(testStatus))}</span></div>
            <div class="inspectorHint">${esc(testReasonForStatus(testStatus))}</div>
          </div>
        ` : ""}
        <div class="inspectorSection">
          <h3>Padregels</h3>
          <label class="inspectorToggle"><span>Eindnode</span><input type="checkbox" data-inspector-end ${inActivePath && isEndNodeForPath(path, sceneId) ? "checked" : ""} ${disabled} /></label>
          <label class="inspectorToggle"><span>Blokkade-node</span><input type="checkbox" data-inspector-block ${rule ? "checked" : ""} ${disabled} /></label>
          ${members.length > 1 ? `
            <label class="inspectorToggle"><span>Blokkades uit andere paden negeren</span><input type="checkbox" data-inspector-ignore-crossing-block ${ignoresCrossingBlock ? "checked" : ""} ${disabled} /></label>
            <div class="inspectorHint">Alleen bij kruisingen. Uit betekent dat blokkades uit andere paden deze node ook blokkeren.</div>
          ` : ""}
          ${funnel ? `
            <div class="inspectorStepper">
              <span>Funnel drempel</span>
              <div class="funnelStepperControl">
                <button type="button" data-inspector-funnel-step="-1" title="Drempel omlaag">-</button>
                <input type="number" min="1" max="${funnel.count}" value="${funnel.required}" inputmode="numeric" aria-label="Funnel drempel" data-inspector-funnel />
                <span class="stepperTotal">/ ${funnel.count}</span>
                <button type="button" data-inspector-funnel-step="1" title="Drempel omhoog">+</button>
              </div>
            </div>
          ` : ""}
        </div>
        <div class="inspectorSection">
          <h3>Inhoud</h3>
          ${sceneContentMarkup(scene)}
        </div>
      </div>
    `;
    const endInput = pane.querySelector("[data-inspector-end]");
    if (endInput) endInput.addEventListener("change", () => setEndNodeForActivePath(sceneId, endInput.checked));
    const blockInput = pane.querySelector("[data-inspector-block]");
    if (blockInput) {
      blockInput.addEventListener("change", () => {
        setBlockRuleForActivePath(sceneId, blockInput.checked);
      });
    }
    const ignoreCrossingBlockInput = pane.querySelector("[data-inspector-ignore-crossing-block]");
    if (ignoreCrossingBlockInput) {
      ignoreCrossingBlockInput.addEventListener("change", () => {
        setIgnoreCrossingBlockForActivePath(sceneId, ignoreCrossingBlockInput.checked);
      });
    }
    const funnelInput = pane.querySelector("[data-inspector-funnel]");
    if (funnelInput) {
      funnelInput.addEventListener("change", () => setPathThreshold(path, sceneId, funnelInput.value));
      funnelInput.addEventListener("keydown", (event) => {
        if (event.key !== "Enter") return;
        event.preventDefault();
        funnelInput.blur();
        setPathThreshold(path, sceneId, funnelInput.value);
      });
      pane.querySelectorAll("[data-inspector-funnel-step]").forEach((button) => {
        button.addEventListener("click", () => {
          const step = Number.parseInt(String(button.dataset.inspectorFunnelStep || "0"), 10) || 0;
          const min = Number.parseInt(String(funnelInput.min || "1"), 10) || 1;
          const max = Number.parseInt(String(funnelInput.max || funnel.count || "1"), 10) || 1;
          const current = Number.parseInt(String(funnelInput.value || min), 10) || min;
          const next = Math.min(max, Math.max(min, current + step));
          funnelInput.value = String(next);
          setPathThreshold(path, sceneId, next);
        });
      });
    }
  }

  function renderInspector(model, testResult) {
    if (selectedEdgeKey) {
      renderEdgeInspector(model);
      return;
    }
    renderNodeInspector(model, testResult);
  }

  function edgeTestState(path, edge, testResult) {
    if (!testResult) return "";
    const simPathId = testResult.pathIdByKey.get(pathKey(path));
    const toStatus = testStatusFor(edge.toSceneId, testResult);
    const fromPlayed = testResult.playedSet.has(Number(edge.fromSceneId || 0));
    const toPlayed = testResult.playedSet.has(Number(edge.toSceneId || 0));
    const detail = toStatus && simPathId
      ? (toStatus.pathDetails || []).find((item) => Number(item.pathId || 0) === Number(simPathId))
      : null;
    if (fromPlayed && toPlayed) return "played";
    if (detail && detail.blocked) return "blocked";
    if (toStatus && toStatus.nodeStatus === "Blocked") return "blocked";
    if (fromPlayed && toStatus && toStatus.nodeStatus === "Available") return "available";
    if (detail && detail.reached && !detail.ready) return "locked";
    if (toStatus && toStatus.nodeStatus === "Locked") return "locked";
    return "";
  }

  function renderEdges(svg, model, ghosts, testResult = null) {
    const body = [];

    (model.paths || []).forEach((path) => {
      const key = pathKey(path);
      const isActivePath = key === activeKey();
      const color = colorValue(path.color);
      const positions = model.pathPositions.get(key) || {};
      const edges = model.pathEdges.get(key) || [];
      const thresholdTargets = new Set(Graph.normalizeThresholdsForEdges(path.thresholds, Graph.getPathSceneIds(path), edges)
        .map((threshold) => threshold.sourceSceneId));
      edges.forEach((edge) => {
        const from = positions[edge.fromSceneId] || model.layout.positions[edge.fromSceneId];
        const to = positions[edge.toSceneId] || model.layout.positions[edge.toSceneId];
        if (!from || !to) return;
        const selectionKey = pathEdgeSelectionKey(path, edge);
        const selected = selectionKey === selectedEdgeKey;
        const sideEdge = Graph.isOptionalEdge(edge);
        const loopEdge = Graph.isLoopEdge(edge);
        const geometry = loopEdge ? loopEdgeGeometry(from, to) : sideEdge ? optionalEdgeGeometry(from, to) : edgeGeometry(from, to);
        const choiceGroup = thresholdTargets.has(Number(edge.toSceneId));
        const baseOpacity = isActivePath ? 1 : 0.5;
        const statusState = edgeTestState(path, edge, testResult);
        const opacity = testResult && !statusState ? 0.22
          : statusState === "locked" ? 0.34
            : statusState === "blocked" ? 0.52
              : loopEdge ? (isActivePath ? 0.66 : 0.38)
                : sideEdge ? (isActivePath ? 0.72 : 0.42)
                  : choiceGroup ? (isActivePath ? 0.64 : 0.4)
                    : baseOpacity;
        const strokeWidth = statusState === "played" ? 4
          : statusState === "available" ? 3.4
            : loopEdge ? (selected ? 3.2 : 2)
              : sideEdge ? (selected ? 3.2 : 2.1)
                : choiceGroup ? (selected ? 3.2 : 2)
                  : isActivePath ? (selected ? 4 : 2.8) : (selected ? 3.2 : 2.2);
        const stroke = statusState === "blocked" ? "#b91c1c" : statusState === "locked" ? "#9a9288" : color;
        const dash = !isActivePath
          ? (loopEdge ? ' stroke-dasharray="2 7"' : sideEdge ? ' stroke-dasharray="3 5"' : ' stroke-dasharray="8 7"')
          : (loopEdge ? ' stroke-dasharray="2 6"' : sideEdge ? ' stroke-dasharray="5 4"' : "");
        body.push(`<path d="${geometry.linePath}" fill="none" stroke="${stroke}" stroke-width="${strokeWidth}" opacity="${opacity}"${dash} />`);
        if (geometry.arrowPoints) {
          body.push(`<polygon points="${geometry.arrowPoints}" fill="${stroke}" opacity="${opacity}" />`);
        }
        if (!testResult) body.push(`<path class="edgeHit" d="${geometry.hitPath}" fill="none" stroke="transparent" data-edge-key="${esc(selectionKey)}" />`);
      });
    });

    ghosts.forEach((ghost, index) => {
      const from = model.layout.positions[ghost.fromSceneId];
      if (!from) return;
      const to = ghost.position || ghostPosition(from, ghost, index);
      const ghostColor = colorValue(ghost.color, "#f97316");
      const x1 = from.x + NODE_W;
      const y1 = from.y + NODE_H / 2;
      const x2 = to.x;
      const y2 = to.y + NODE_H / 2;
      const dx = Math.max(80, Math.abs(x2 - x1) / 2);
      body.push(`<path d="M ${x1} ${y1} C ${x1 + dx} ${y1}, ${x2 - dx} ${y2}, ${x2} ${y2}" fill="none" stroke="${ghostColor}" stroke-width="1.6" stroke-dasharray="6 5" opacity="0.58" />`);
    });

    if (dragEdge) {
      const dragPath = pathById(dragEdge.pathId) || activePath();
      const dragColor = colorValue(dragPath && dragPath.color);
      const from = model.layout.positions[dragEdge.fromSceneId] || dragEdge.fromPosition;
      if (from) {
        const x1 = from.x + NODE_W / 2;
        const y1 = from.y + NODE_H;
        const x2 = dragEdge.x;
        const y2 = dragEdge.y;
        const mid = Math.max(34, Math.abs(y2 - y1) / 2);
        body.push(`<path d="M ${x1} ${y1} C ${x1} ${y1 + mid}, ${x2} ${y2 - mid}, ${x2} ${y2}" fill="none" stroke="${dragColor}" stroke-width="2" stroke-dasharray="5 5" opacity="0.72" />`);
      }
    }

    svg.innerHTML = body.join("");
    svg.querySelectorAll(".edgeHit").forEach((edgeEl) => {
      edgeEl.addEventListener("click", (event) => {
        event.stopPropagation();
        selectedEdgeKey = String(edgeEl.dataset.edgeKey || "");
        clearNodeSelection();
        renderCanvas();
      });
    });
  }

  function uniquePathColors(members, fallbackColor) {
    const colors = [];
    (members || []).forEach((item) => {
      const color = (
        typeof item === "string" ? colorValue(item, fallbackColor) : colorValue(item.color, fallbackColor)
      );
      if (!color || colors.some((existing) => existing.toLowerCase() === color.toLowerCase())) return;
      colors.push(color);
    });
    return colors.slice(0, 6);
  }

  function stripeBackground(members, fallbackColor) {
    const colors = uniquePathColors(members, fallbackColor).slice(0, 4);
    if (!colors.length) return fallbackColor;
    if (colors.length === 1) return colors[0];
    const step = 100 / colors.length;
    return `linear-gradient(to bottom, ${colors.map((color, index) => `${color} ${index * step}% ${(index + 1) * step}%`).join(", ")})`;
  }

  function isEndNodeForPath(path, sceneId) {
    return Graph.effectiveEndSceneIds(path).includes(Number(sceneId || 0));
  }

  function blockRulesForSource(path, sceneId) {
    return Graph.normalizeBlockRules(path && path.blockRules || [], Graph.getPathSceneIds(path))
      .filter((rule) => Number(rule.sourceSceneId || 0) === Number(sceneId || 0));
  }

  function blockRuleForSource(path, sceneId) {
    return blockRulesForSource(path, sceneId)[0] || null;
  }

  function createNode(nodeModel, members, model, testResult = null) {
    const sceneId = Number(nodeModel.sceneId || 0);
    const pos = nodeModel.position;
    const scene = sceneById.get(Number(sceneId));
    const node = document.createElement("div");
    const testStatus = testStatusFor(sceneId, testResult);
    const testClass = testResult ? ` test-${testStatusClass(testStatus)}` : "";
    const nodePaths = nodeModel.paths || [];
    const connected = nodePaths.some((path) => connectedSceneIdSet(path).has(Number(sceneId)));
    const inTarget = nodeModel.pathIds.includes(activeKey());
    const isDraft = !connected;
    const selected = isNodeSelected(sceneId);
    const expanded = selected && expandedNodeIds.has(Number(sceneId));
    const fallbackColor = colorValue(nodePaths[0] && nodePaths[0].color || (activePath() && activePath().color));
    const membership = Array.isArray(members) && members.length ? members : nodeModel.colors;
    const sharedCount = Math.max(nodeModel.pathIds.length, Array.isArray(members) ? members.length : 0);
    const sharedNode = nodeModel.isShared || sharedCount > 1;
    node.className = `pathNode${isDraft ? " draftNode" : ""}${sharedNode ? " sharedNode multiColorNode" : ""}${inTarget ? " targetMember" : ""}${selected ? " selected" : ""}${expanded ? " expanded" : ""}${testClass}`;
    node.dataset.sceneId = String(sceneId);
    node.dataset.pathIds = nodeModel.pathIds.join(",");
    node.style.left = `${pos.x}px`;
    node.style.top = `${pos.y}px`;
    if (testStatus) node.title = testReasonForStatus(testStatus);

    const markers = nodeMarkerItems(sceneId, nodeModel, membership, model);
    const structureSub = isDraft ? "los" : markers.map((item) => item.label).join(" · ");
    const testSub = testStatus ? testStatusLabel(testStatus) : "";
    const sub = [structureSub, testSub].filter(Boolean).join(" · ");

    node.innerHTML = `
      <span class="stripe" style="background:${stripeBackground(membership, fallbackColor)}"></span>
      ${testStatus ? `<span class="statusPill ${testStatusClass(testStatus)}">${esc(testStatusLabel(testStatus))}</span>` : ""}
      <div class="title">${esc(scene && scene.title || `Situatie #${sceneId}`)}</div>
      <div class="nodeFullTitle">${esc(scene && scene.title || `Situatie #${sceneId}`)}</div>
      ${sub ? `<div class="sub">${esc(sub)}</div>` : ""}
      <button class="port out" type="button" data-port="out" title="Pijl vanaf hier"></button>
      <button class="nodeHandle remove" type="button" title="Verwijder uit pad">×</button>
    `;

    wireNode(node, Number(sceneId));
    return node;
  }

  function nodeRect(pos, padding = 0) {
    return {
      left: Number(pos.x || 0) - padding,
      top: Number(pos.y || 0) - padding,
      right: Number(pos.x || 0) + NODE_W + padding,
      bottom: Number(pos.y || 0) + NODE_H + padding,
    };
  }

  function rectsOverlap(a, b) {
    return !!(a && b && a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top);
  }

  function ghostPositionFromPath(ghost, model) {
    const path = pathById(ghost && ghost.pathId);
    if (!path || !model || !model.layout || !model.layout.positions) return null;
    const key = pathKey(path);
    const pathLayout = getLayout(path);
    const sourcePositions = pathLayout.positions || {};
    const source = sourcePositions[Number(ghost.sceneId || 0)];
    const anchorSource = sourcePositions[Number(ghost.fromSceneId || 0)];
    const anchorRendered = model.layout.positions[Number(ghost.fromSceneId || 0)];
    if (!source || !anchorSource || !anchorRendered) return null;

    const cached = compositionTransformCache[key];
    if (cached) {
      return {
        x: Number(source.x || 0) + Number(cached.dx || 0) + Number(model.worldOffset && model.worldOffset.x || 0),
        y: Number(source.y || 0) + Number(cached.dy || 0) + Number(model.worldOffset && model.worldOffset.y || 0),
      };
    }

    const renderDx = Number(anchorRendered.x || 0) - Number(anchorSource.x || 0);
    const renderDy = Number(anchorRendered.y || 0) - Number(anchorSource.y || 0);
    compositionTransformCache[key] = {
      dx: renderDx - Number(model.worldOffset && model.worldOffset.x || 0),
      dy: renderDy - Number(model.worldOffset && model.worldOffset.y || 0),
    };
    return {
      x: Number(source.x || 0) + renderDx,
      y: Number(source.y || 0) + renderDy,
    };
  }

  function resolveGhostCollision(basePos, ghost, fromPos, occupiedRects = []) {
    const collides = (pos) => occupiedRects.some((rect) => rectsOverlap(nodeRect(pos, 12), rect));
    if (!basePos || !collides(basePos)) return basePos;
    const preferredX = Number(basePos.x || 0) < Number(fromPos && fromPos.x || 0) ? -1 : 1;
    const preferredY = ghost && ghost.direction === "prev" ? -1 : 1;
    const stepX = NODE_W + 42;
    const stepY = NODE_H + 34;
    const offsets = [
      { x: preferredX * 48, y: 0 },
      { x: preferredX * stepX, y: 0 },
      { x: 0, y: preferredY * stepY },
      { x: preferredX * 64, y: preferredY * stepY },
      { x: -preferredX * 64, y: preferredY * stepY },
      { x: preferredX * stepX, y: preferredY * stepY },
      { x: -preferredX * stepX, y: preferredY * stepY },
      { x: 0, y: preferredY * stepY * 2 },
      { x: preferredX * stepX * 1.35, y: 0 },
      { x: -preferredX * stepX * 1.35, y: 0 },
    ];
    for (const offset of offsets) {
      const candidate = {
        x: Number(basePos.x || 0) + offset.x,
        y: Number(basePos.y || 0) + offset.y,
      };
      if (!collides(candidate)) return candidate;
    }
    return {
      x: Number(basePos.x || 0) + preferredX * stepX * 1.8,
      y: Number(basePos.y || 0) + preferredY * stepY * 1.8,
    };
  }

  function placeGhostNeighbors(ghosts = [], model = null) {
    if (!model || !model.layout || !model.layout.positions) return [];
    const occupiedRects = (model.nodes || [])
      .map((node) => node && node.position ? nodeRect(node.position, 12) : null)
      .filter(Boolean);
    return (Array.isArray(ghosts) ? ghosts : []).map((ghost, index) => {
      const fromPos = model.layout.positions[Number(ghost && ghost.fromSceneId || 0)];
      if (!fromPos) return null;
      const base = ghostPositionFromPath(ghost, model) || ghostPosition(fromPos, ghost, index);
      const position = resolveGhostCollision(base, ghost, fromPos, occupiedRects);
      if (!position) return null;
      occupiedRects.push(nodeRect(position, 12));
      return {
        ...ghost,
        position,
        basePosition: base,
      };
    }).filter(Boolean);
  }

  function ghostPosition(fromPos, ghost, index) {
    const lane = 250 + (index % 2) * 28;
    const yOffset = ghost.direction === "prev" ? -82 : 82;
    return {
      x: fromPos.x + lane,
      y: Math.max(26, fromPos.y + yOffset),
    };
  }

  function createGhostNode(ghost, pos) {
    const scene = sceneById.get(Number(ghost.sceneId));
    const node = document.createElement("div");
    node.className = "ghostNode";
    node.style.left = `${pos.x}px`;
    node.style.top = `${pos.y}px`;
    const color = colorValue(ghost.color, "#f97316");
    node.style.borderColor = color;
    node.innerHTML = `
      <span class="stripe" style="background:${color}"></span>
      <div class="title">${esc(scene && scene.title || `Situatie #${ghost.sceneId}`)}</div>
      <div class="sub">${ghost.direction === "prev" ? "←" : "→"} ${esc(ghost.pathName)}</div>
    `;
    return node;
  }

  function wireNode(node, sceneId) {
    node.addEventListener("mousedown", (event) => {
      if (event.target.closest("button,input,select,label")) return;
      if (testMode) {
        event.preventDefault();
        playTestScene(sceneId);
        return;
      }
      event.preventDefault();
      if (event.shiftKey || event.metaKey || event.ctrlKey) {
        toggleNodeSelection(sceneId);
        renderCanvas();
        return;
      }
      let selectionChanged = false;
      if (!isNodeSelected(sceneId)) {
        setSingleNodeSelection(sceneId);
        selectionChanged = true;
      } else {
        selectedNodeId = sceneId;
        if (selectedEdgeKey) {
          selectedEdgeKey = "";
          selectionChanged = true;
        }
      }
      const model = buildUnifiedCanvasModel();
      const nodeById = new Map(model.nodes.map((item) => [Number(item.sceneId), item]));
      const renderedIds = new Set(model.nodes.map((item) => Number(item.sceneId)));
      const selectedIds = Array.from(selectedNodeIds).filter((id) => renderedIds.has(Number(id)));
      if (!selectedIds.length) selectedIds.push(sceneId);
      const dragItems = selectedIds.map((id) => {
        const nodeModel = nodeById.get(Number(id));
        const dragPaths = editablePathsForNode(Number(id), nodeModel && nodeModel.pathIds);
        const current = model.layout.positions[Number(id)];
        return dragPaths.length && current ? { id: Number(id), paths: dragPaths, current } : null;
      }).filter(Boolean);
      const startX = event.clientX;
      const startY = event.clientY;
      let didMove = false;
      const move = (moveEvent) => {
        const pointerDistance = Math.hypot(moveEvent.clientX - startX, moveEvent.clientY - startY);
        if (pointerDistance < 4 && !didMove) return;
        didMove = true;
        const dx = (moveEvent.clientX - startX) / canvasZoom;
        const dy = (moveEvent.clientY - startY) / canvasZoom;
        dragItems.forEach((item) => {
          const nextPosition = {
            x: Number(item.current.x || 0) + dx,
            y: Number(item.current.y || 0) + dy,
          };
          item.paths.forEach((path) => {
            const manual = ensureManualLayout(pathKey(path));
            manual[item.id] = canvasToPathLocalPosition(model, path, nextPosition);
          });
        });
        if (dragItems.length) {
          saveLayouts();
          renderCanvas();
        }
      };
      if (selectionChanged) renderCanvas();
      const up = () => {
        document.removeEventListener("mousemove", move);
        document.removeEventListener("mouseup", up);
      };
      document.addEventListener("mousemove", move);
      document.addEventListener("mouseup", up);
    });
    node.addEventListener("dblclick", (event) => {
      if (event.target.closest("button")) return;
      event.preventDefault();
      event.stopPropagation();
      toggleNodeExpanded(sceneId);
    });

    node.querySelector(".remove").addEventListener("click", (event) => {
      event.stopPropagation();
      removeSceneFromPath(sceneId);
    });
    node.querySelector(".port.out").addEventListener("mousedown", (event) => {
      event.stopPropagation();
      startEdgeDrag(sceneId, event);
    });
  }

  function nodePositionFromElement(node) {
    return {
      x: Math.max(0, Number.parseFloat(String(node && node.style && node.style.left || "0")) || 0),
      y: Math.max(0, Number.parseFloat(String(node && node.style && node.style.top || "0")) || 0),
    };
  }

  function nodePathIdsFromElement(node) {
    return String(node && node.dataset && node.dataset.pathIds || "")
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);
  }

  function editablePathForNode(sceneId, nodePathIds = []) {
    const paths = editablePathsForNode(sceneId, nodePathIds);
    return paths[0] || null;
  }

  function editablePathsForNode(sceneId, nodePathIds = []) {
    const id = Number(sceneId || 0);
    const target = activePath();
    const ids = Array.isArray(nodePathIds) ? nodePathIds.map(String).filter(Boolean) : [];
    const paths = ids
      .map((pathId) => pathById(pathId))
      .filter((path) => path && Graph.getPathSceneIds(path).includes(id));
    if (paths.length) return paths;
    if (target && Graph.getPathSceneIds(target).includes(id)) return [target];
    return [];
  }

  function edgePathIdForSource(pathIds = []) {
    const ids = Array.isArray(pathIds) ? pathIds.map(String).filter(Boolean) : [];
    const active = activeKey();
    if (ids.length === 1) return ids[0];
    if (active && ids.includes(active)) return active;
    return "";
  }

  function startEdgeDrag(fromSceneId, event, options = {}) {
    const sourceNode = event.target && event.target.closest ? event.target.closest(".pathNode") : null;
    const fromPathIds = nodePathIdsFromElement(sourceNode);
    const pathId = options.pathId || edgePathIdForSource(fromPathIds);
    if (!pathId || !pathById(pathId)) {
      toast("Kies eerst een doelpad voor deze pijl.", true);
      return;
    }
    const point = canvasPoint(event);
    dragEdge = {
      fromSceneId,
      pathId,
      fromPathIds,
      fromPosition: sourceNode ? nodePositionFromElement(sourceNode) : null,
      x: point.x,
      y: point.y,
    };
    const move = (moveEvent) => {
      const nextPoint = canvasPoint(moveEvent);
      dragEdge.x = nextPoint.x;
      dragEdge.y = nextPoint.y;
      renderCanvas();
    };
    const up = (upEvent) => {
      document.removeEventListener("mousemove", move);
      document.removeEventListener("mouseup", up);
      const targetNode = upEvent.target && upEvent.target.closest ? upEvent.target.closest(".pathNode") : null;
      if (targetNode) {
        finishEdgeDrag(Number(targetNode.dataset.sceneId || 0), {
          toPathIds: nodePathIdsFromElement(targetNode),
          toPosition: nodePositionFromElement(targetNode),
        });
      }
      dragEdge = null;
      renderCanvas();
    };
    document.addEventListener("mousemove", move);
    document.addEventListener("mouseup", up);
  }

  function materializeLegacyEdges(path) {
    if (!path) return;
    if (Array.isArray(path.edges) && path.edges.length) return;
    if (String(path.edgeMode || "legacy") === "manual") {
      path.edges = Graph.normalizeEdges(path.edges || [], Graph.getPathSceneIds(path));
      return;
    }
    path.edges = Graph.fallbackEdgesFromSceneIds(path.sceneIds || []);
    path.edgeMode = "manual";
  }

  function edgeIssueMessage(issue) {
    const code = String(issue || "");
    if (code.startsWith("path_cycle:")) {
      return "Deze gewone pijl zou een loop maken. Gebruik een terugkoppeling voor terug-lijnen.";
    }
    if (code.startsWith("path_loop_start_target:")) {
      return "Een terugkoppeling naar een startnode kan niet.";
    }
    if (code.startsWith("path_loop_direction:")) {
      return "Een terugkoppeling moet terugwijzen naar iets dat al voor deze node ligt.";
    }
    if (code.startsWith("path_single_start_required:")) {
      return "Er is al een start in dit pad. Verbind nieuwe nodes vanuit het bestaande pad.";
    }
    if (code.startsWith("path_disconnected_components:")) {
      return "Dit zou een los paddeel maken. Meerdere starts mogen alleen als ze naar dezelfde kruising lopen.";
    }
    if (code.startsWith("path_edge_duplicate:")) return "Deze verbinding bestaat al.";
    if (code.startsWith("path_edge_self:")) return "Een node kan niet naar zichzelf wijzen.";
    return "Deze verbinding past niet in dit pad.";
  }

  function connectedSceneIdSet(path) {
    const sceneIds = Graph.getPathSceneIds(path);
    const edges = Graph.getRenderableEdges(path, { fallback: true });
    return new Set(Graph.connectedSceneIds(sceneIds, edges));
  }

  function finishEdgeDrag(toSceneId, options = {}) {
    const path = pathById(dragEdge && dragEdge.pathId) || activePath();
    if (!path || !dragEdge || !toSceneId || Number(dragEdge.fromSceneId) === Number(toSceneId)) return;
    const fromSceneId = Number(dragEdge.fromSceneId);
    const targetSceneId = Number(toSceneId);
    const sceneIds = Graph.getPathSceneIds(path);
    const hasFrom = sceneIds.includes(fromSceneId);
    const hasTo = sceneIds.includes(targetSceneId);
    materializeLegacyEdges(path);
    const nextSceneIds = Graph.normalizeIdList([...Graph.getPathSceneIds(path), fromSceneId, targetSceneId]);
    let edge = { fromSceneId, toSceneId: targetSceneId };
    const candidatePath = {
      ...path,
      sceneIds: nextSceneIds,
      edges: path.edges || [],
      edgeMode: "manual",
    };
    let issue = Graph.edgeCandidateIssue(candidatePath, edge.fromSceneId, edge.toSceneId, { fallback: true });
    if (String(issue || "").startsWith("path_cycle:")) {
      const loopIssue = Graph.edgeCandidateIssue(candidatePath, edge.fromSceneId, edge.toSceneId, { fallback: true, edgeType: "loop" });
      if (!loopIssue) {
        edge = { ...edge, edgeType: "loop" };
        issue = "";
      } else {
        issue = loopIssue;
      }
    }
    if (issue) {
      toast(edgeIssueMessage(issue), true);
      return;
    }
    const { manual } = freezeCurrentLayout(path);
    const model = buildUnifiedCanvasModel();
    path.sceneIds = nextSceneIds;
    if (!hasFrom && dragEdge.fromPosition) manual[fromSceneId] = canvasToPathLocalPosition(model, path, dragEdge.fromPosition);
    if (!hasTo && options.toPosition) manual[targetSceneId] = canvasToPathLocalPosition(model, path, options.toPosition);
    if ((!hasFrom && dragEdge.fromPosition) || (!hasTo && options.toPosition)) saveLayouts();
    path.edges = [...(path.edges || []), edge];
    path.edgeMode = "manual";
    clearNodeSelection();
    selectedEdgeKey = pathEdgeSelectionKey(path, edge);
    markDirty(path);
  }

  function addSceneToPath(sceneId, x, y) {
    const path = activePath();
    if (!path || !sceneId) return;
    path.sceneIds = Graph.normalizeIdList(path.sceneIds || []);
    const safeSceneId = Number(sceneId);
    const alreadyInPath = path.sceneIds.includes(safeSceneId);
    const existingIds = path.sceneIds.slice();
    const model = buildUnifiedCanvasModel();
    const { manual, positions } = freezeCurrentLayout(path);
    if (!alreadyInPath) {
      path.sceneIds.push(safeSceneId);
      path.edges = Graph.normalizeEdges(path.edges || [], path.sceneIds);
      markDirty();
    }
    if (typeof x === "number" && typeof y === "number") {
      manual[safeSceneId] = canvasToPathLocalPosition(model, path, {
        x: x - NODE_W / 2,
        y: y - NODE_H / 2,
      });
      saveLayouts();
    } else if (!alreadyInPath && !manual[safeSceneId]) {
      manual[safeSceneId] = addedScenePosition(
        existingIds,
        positions,
        canvasToPathLocalPosition(model, path, viewportNodePosition())
      );
      saveLayouts();
    }
    setSingleNodeSelection(safeSceneId);
    renderAll();
    if (typeof x !== "number" || typeof y !== "number") scrollNodeIntoView(safeSceneId);
  }

  function setEndNodeForActivePath(sceneId, enabled) {
    const path = activePath();
    const id = Number(sceneId || 0);
    if (!path || !id || !Graph.getPathSceneIds(path).includes(id)) return;
    const current = new Set(Graph.normalizeIdList(path.endSceneIds || []));
    if (enabled) current.add(id);
    else current.delete(id);
    path.endSceneIds = Graph.normalizeIdList(Array.from(current));
    markDirty(path);
    renderCanvas();
  }

  function setBlockRuleForActivePath(sourceSceneId, enabled) {
    const path = activePath();
    const sourceId = Number(sourceSceneId || 0);
    const sceneIds = Graph.getPathSceneIds(path);
    if (!path || !sourceId || !sceneIds.includes(sourceId)) return;
    const existing = Graph.normalizeBlockRules(path.blockRules || [], sceneIds)
      .filter((rule) => Number(rule.sourceSceneId) !== sourceId);
    path.blockRules = enabled
      ? Graph.normalizeBlockRules([...existing, { sourceSceneId: sourceId, includeCrossingPaths: true }], sceneIds)
      : existing;
    markDirty(path);
    renderCanvas();
  }

  function setIgnoreCrossingBlockForActivePath(sceneId, enabled) {
    const path = activePath();
    const id = Number(sceneId || 0);
    const sceneIds = Graph.getPathSceneIds(path);
    if (!path || !id || !sceneIds.includes(id)) return;
    const current = new Set(Graph.normalizeIgnoreCrossingBlockSceneIds(path, sceneIds));
    if (enabled) current.add(id);
    else current.delete(id);
    path.ignoreCrossingBlockSceneIds = Graph.normalizeIgnoreCrossingBlockSceneIds(Array.from(current), sceneIds);
    markDirty(path);
    renderCanvas();
  }

  function removeScenesFromPath(sceneIds = []) {
    const path = activePath();
    if (!path) return;
    const targetSceneSet = new Set(Graph.getPathSceneIds(path));
    const ids = new Set(Graph.normalizeIdList(sceneIds).filter((id) => targetSceneSet.has(Number(id))));
    if (!ids.size) return;
    path.sceneIds = (path.sceneIds || []).filter((id) => !ids.has(Number(id)));
    path.edges = (path.edges || []).filter((edge) => !ids.has(Number(edge.fromSceneId)) && !ids.has(Number(edge.toSceneId)));
    path.endSceneIds = Graph.normalizeIdList(path.endSceneIds || []).filter((id) => !ids.has(Number(id)));
    path.blockRules = Graph.normalizeBlockRules(path.blockRules || [], path.sceneIds)
      .filter((rule) => !ids.has(Number(rule.sourceSceneId)));
    path.ignoreCrossingBlockSceneIds = Graph.normalizeIgnoreCrossingBlockSceneIds(path, path.sceneIds)
      .filter((id) => !ids.has(Number(id)));
    const manual = ensureManualLayout(pathKey(path));
    ids.forEach((id) => {
      delete manual[id];
      selectedNodeIds.delete(Number(id));
      expandedNodeIds.delete(Number(id));
    });
    saveLayouts();
    if (ids.has(Number(selectedNodeId))) selectedNodeId = selectedNodeIds.size ? Array.from(selectedNodeIds).at(-1) : 0;
    markDirty();
    renderAll();
  }

  function removeSceneFromPath(sceneId) {
    removeScenesFromPath([sceneId]);
  }

  function removeEdge(key) {
    const parsed = parsePathEdgeSelectionKey(key);
    const path = pathById(parsed.pathId) || activePath();
    const edgeKey = parsed.edgeKey || key;
    if (!path || !edgeKey) return;
    materializeLegacyEdges(path);
    path.edges = (path.edges || []).filter((edge) => Graph.edgeKey(edge) !== edgeKey);
    selectedEdgeKey = "";
    markDirty(path);
    renderCanvas();
  }

  function edgeWithType(edge, edgeType = "") {
    const next = { fromSceneId: edge.fromSceneId, toSceneId: edge.toSceneId };
    const normalizedType = Graph.normalizeEdgeType(edgeType);
    if (normalizedType) next.edgeType = normalizedType;
    return next;
  }

  function setEdgeType(key, edgeType = "") {
    const parsed = parsePathEdgeSelectionKey(key);
    const path = pathById(parsed.pathId) || activePath();
    const edgeKey = parsed.edgeKey || key;
    if (!path || !edgeKey) return;
    materializeLegacyEdges(path);
    const current = (path.edges || []).find((edge) => Graph.edgeKey(edge) === edgeKey);
    if (!current) return;
    const normalizedType = Graph.normalizeEdgeType(edgeType);
    const issue = Graph.edgeCandidateIssue(path, current.fromSceneId, current.toSceneId, {
      fallback: false,
      edgeType: normalizedType,
      ignoreEdgeKey: edgeKey,
    });
    if (issue) {
      toast(edgeIssueMessage(issue), true);
      return;
    }
    path.edges = (path.edges || []).map((edge) => {
      if (Graph.edgeKey(edge) !== edgeKey) return edge;
      return edgeWithType(edge, normalizedType);
    });
    const sceneIds = Graph.getPathSceneIds(path);
    path.thresholds = Graph.normalizeThresholdsForEdges(path.thresholds || [], sceneIds, path.edges || []);
    markDirty(path);
    renderCanvas();
  }

  function toggleEdgeType(key) {
    const parsed = parsePathEdgeSelectionKey(key);
    const path = pathById(parsed.pathId) || activePath();
    const edgeKey = parsed.edgeKey || key;
    const current = path && (path.edges || []).find((edge) => Graph.edgeKey(edge) === edgeKey);
    if (!current || Graph.isLoopEdge(current)) return;
    setEdgeType(key, Graph.isOptionalEdge(current) ? "" : "optional");
  }

  function renderMiniMap(model, ghosts = []) {
    const svg = $("miniSvg");
    if (!model || !model.paths || !model.paths.length) {
      svg.innerHTML = "";
      $("miniFoot").innerHTML = "0 situaties<br/>0 funnels";
      miniMapBounds = null;
      updateMiniViewport();
      return;
    }
    const visible = model.paths;
    const laneCount = Math.max(visible.length, 1);
    const laneStep = 48 / Math.max(laneCount - 1, 1);
    const pathPointSets = visible.map((pathItem, index) => {
      const positions = model.pathPositions.get(pathKey(pathItem)) || {};
      const ids = Graph.getPathSceneIds(pathItem);
      const x = laneCount === 1 ? 33 : 10 + index * laneStep;
      return {
        pathItem,
        points: ids.map((sceneId) => {
          const pos = positions[sceneId];
          if (!pos) return null;
          return {
            sceneId,
            x,
            y: Number(pos.y || 0) + NODE_H / 2,
          };
        }).filter(Boolean),
      };
    });
    const allY = pathPointSets.flatMap((set) => set.points.map((point) => point.y));
    const minY = allY.length ? Math.min(...allY) : 0;
    const maxY = allY.length ? Math.max(...allY) : 1;
    const contentPad = 90;
    miniMapBounds = {
      top: minY - contentPad,
      bottom: maxY + contentPad,
    };
    const miniTop = 24;
    const miniHeight = 704;
    const miniSpan = Math.max(1, miniMapBounds.bottom - miniMapBounds.top);
    const miniY = (y) => miniTop + ((Number(y || 0) - miniMapBounds.top) / miniSpan) * miniHeight;
    let html = "";

    pathPointSets.forEach(({ pathItem, points }) => {
      const color = colorValue(pathItem.color);
      const dash = pathKey(pathItem) === activeKey() ? "" : ' stroke-dasharray="4 4" opacity="0.78"';
      const miniPoints = points.map((point) => ({ ...point, y: miniY(point.y) }));
      for (let i = 0; i < points.length - 1; i += 1) {
        html += `<line x1="${miniPoints[i].x}" y1="${miniPoints[i].y}" x2="${miniPoints[i + 1].x}" y2="${miniPoints[i + 1].y}" stroke="${color}" stroke-width="2.1"${dash}/>`;
      }
      miniPoints.forEach((point) => {
        html += `<circle cx="${point.x}" cy="${point.y}" r="${pathKey(pathItem) === activeKey() ? 2.7 : 2.1}" fill="${color}"/>`;
      });
    });

    const path = activePath();
    const funnelCount = Graph.getRenderableEdges(path, { fallback: true }).filter((edge) => !Graph.isOptionalEdge(edge)).reduce((map, edge) => {
      map.set(edge.toSceneId, (map.get(edge.toSceneId) || 0) + 1);
      return map;
    }, new Map());
    const funnels = Array.from(funnelCount.values()).filter((count) => count > 1).length;
    svg.innerHTML = html;
    $("miniTitle").textContent = visible.length > 1 ? `Map · ${visible.length}` : "Map";
    $("miniFoot").innerHTML = `${Graph.getPathSceneIds(path).length} situaties<br/>${funnels} funnels · ${ghosts.length} buren`;
    updateMiniViewport();
  }

  function updateMiniViewport() {
    const outer = $("canvasOuter");
    const vp = $("miniViewport");
    if (!outer || !vp || !miniMapBounds) {
      if (vp) {
        vp.style.top = "0%";
        vp.style.height = "100%";
      }
      return;
    }
    const logicalTop = outer.scrollTop / canvasZoom;
    const logicalBottom = (outer.scrollTop + outer.clientHeight) / canvasZoom;
    const span = Math.max(1, Number(miniMapBounds.bottom || 0) - Number(miniMapBounds.top || 0));
    const topPct = ((logicalTop - miniMapBounds.top) / span) * 100;
    const bottomPct = ((logicalBottom - miniMapBounds.top) / span) * 100;
    const clampedTop = Math.max(0, Math.min(100, topPct));
    const clampedBottom = Math.max(clampedTop, Math.min(100, bottomPct));
    vp.style.top = `${clampedTop}%`;
    vp.style.height = `${Math.max(8, clampedBottom - clampedTop)}%`;
  }

  function edgesForSave(path) {
    const sceneIds = Graph.getPathSceneIds(path);
    return Graph.normalizeEdges(
      String(path && path.edgeMode || "legacy") === "manual"
        ? path.edges || []
        : Graph.getRenderableEdges(path, { fallback: true }),
      sceneIds
    );
  }

  function startIdsFor(sceneIds = [], edges = []) {
    const normalizedEdges = Graph.normalizeEdges(edges, sceneIds);
    const connected = new Set(Graph.connectedSceneIds(sceneIds, normalizedEdges));
    const incoming = new Set(normalizedEdges.map((edge) => edge.toSceneId));
    return Graph.normalizeIdList(sceneIds).filter((sceneId) => connected.has(sceneId) && !incoming.has(sceneId));
  }

  function pathSaveBody(path) {
    const sceneIds = Graph.getPathSceneIds(path);
    const edges = edgesForSave(path);
    const thresholds = Graph.normalizeThresholdsForEdges(path.thresholds || [], sceneIds, edges);
    const endSceneIds = Graph.normalizeIdList(path.endSceneIds || []).filter((id) => sceneIds.includes(Number(id)));
    const blockRules = Graph.normalizeBlockRules(path.blockRules || [], sceneIds);
    const ignoreCrossingBlockSceneIds = Graph.normalizeIgnoreCrossingBlockSceneIds(path, sceneIds);
    const body = {
      name: path.name || "Naamloos pad",
      description: path.description || "",
      color: path.color || DEFAULT_COLOR,
      edgeMode: "manual",
      sceneIds,
      edges,
      thresholds,
      endSceneIds,
      blockRules,
      ignoreCrossingBlockSceneIds,
      isActive: path.isActive !== false,
    };
    if (!isDraftPath(path)) body.id = path.id;
    return { body, sceneIds, edges };
  }

  function validatePathForSave(path) {
    const { sceneIds, edges } = pathSaveBody(path);
    if (!sceneIds.length) return "Kies minstens een situatie voor dit pad.";
    const componentCount = Graph.connectedComponentCount(sceneIds, edges);
    if (edges.length && componentCount > 1) return "Losse paddelen zijn niet toegestaan. Meerdere starts mogen alleen als ze naar dezelfde kruising lopen.";
    return "";
  }

  function remapPathKey(previousKey, nextKey) {
    if (!previousKey || !nextKey || previousKey === nextKey) return;
    if (layouts[previousKey]) {
      layouts[nextKey] = { ...(layouts[nextKey] || {}), ...layouts[previousKey] };
      delete layouts[previousKey];
      saveLayouts();
    }
    selectedPathIds = new Set(Array.from(selectedPathIds).map((key) => key === previousKey ? nextKey : key));
    dirtyPathIds = new Set(Array.from(dirtyPathIds).map((key) => key === previousKey ? nextKey : key));
    if (activeKey() === previousKey) activePathId = nextKey;
  }

  function replaceLocalPath(previousKey, nextPath) {
    if (!nextPath) return;
    let replaced = false;
    state.paths = (state.paths || []).map((path) => {
      if (pathKey(path) !== previousKey) return path;
      replaced = true;
      return nextPath;
    });
    if (!replaced) state.paths = [nextPath, ...(state.paths || [])];
  }

  async function saveDirtyPaths() {
    if (saving) return;
    const dirtyKeys = Array.from(dirtyPathIds);
    const dirtyCrossingSceneIds = Array.from(dirtyCrossingThresholdSceneIds);
    const payloads = dirtyKeys
      .map((key) => pathById(key))
      .filter(Boolean)
      .map((path) => ({ path, previousKey: pathKey(path), ...pathSaveBody(path) }));
    dirtyPathIds = new Set(dirtyKeys.filter((key) => pathById(key)));
    if (!payloads.length && !dirtyCrossingSceneIds.length) {
      setSaveState("saved");
      return;
    }
    for (const payload of payloads) {
      const message = validatePathForSave(payload.path);
      if (message) {
        toast(`${payload.path.name || "Naamloos pad"}: ${message}`, true);
        setSaveState("dirty");
        return;
      }
    }

    saving = true;
    setSaveState("saving");
    const savedKeys = new Set();
    const savedCrossingSceneIds = new Set();
    let lastServerState = null;
    try {
      for (const payload of payloads) {
        const result = await api("/admin/algorithm/paths/upsert", { method: "POST", body: payload.body });
        const savedPath = result && result.path ? result.path : payload.path;
        const nextKey = pathKey(savedPath) || payload.previousKey;
        remapPathKey(payload.previousKey, nextKey);
        replaceLocalPath(payload.previousKey, savedPath);
        savedKeys.add(payload.previousKey);
        savedKeys.add(nextKey);
        if (result && result.state) lastServerState = result.state;
      }
      for (const sceneId of dirtyCrossingSceneIds) {
        const incomingCount = crossingRoutesForScene(sceneId).length;
        const result = await api("/admin/algorithm/crossing-thresholds/upsert", {
          method: "POST",
          body: {
            sceneId,
            requiredCount: crossingThresholdRequiredForScene(sceneId, incomingCount || 1),
          },
        });
        savedCrossingSceneIds.add(Number(sceneId));
        if (result && result.state) lastServerState = result.state;
      }
      if (lastServerState) state = normalizeEditorState(lastServerState);
      rebuildIndexes();
      ensureSelection();
      savedKeys.forEach((key) => dirtyPathIds.delete(key));
      savedCrossingSceneIds.forEach((sceneId) => dirtyCrossingThresholdSceneIds.delete(sceneId));
      setSaveState(dirtyPathIds.size || dirtyCrossingThresholdSceneIds.size ? "dirty" : "saved");
      renderAll();
      const savedCount = payloads.length + savedCrossingSceneIds.size;
      toast(savedCount === 1 ? "Opgeslagen" : `${savedCount} wijzigingen opgeslagen`);
    } catch (err) {
      savedKeys.forEach((key) => dirtyPathIds.delete(key));
      savedCrossingSceneIds.forEach((sceneId) => dirtyCrossingThresholdSceneIds.delete(sceneId));
      rebuildIndexes();
      ensureSelection();
      setSaveState(dirtyPathIds.size || dirtyCrossingThresholdSceneIds.size ? "dirty" : "saved");
      renderAll();
      const issues = err.body && Array.isArray(err.body.issues) ? ` (${err.body.issues.join(", ")})` : "";
      toast(`Opslaan mislukt: ${err.message}${issues}`, true);
    } finally {
      saving = false;
    }
  }

  function openPathModal(mode) {
    modalMode = mode || "edit";
    const path = modalMode === "new" ? null : activePath();
    const exceptKey = path ? pathKey(path) : "";
    $("pathModalTitle").textContent = modalMode === "new" ? "Nieuw pad" : "Pad info";
    $("pathName").value = path ? path.name || "" : "";
    $("pathDescription").value = path ? path.description || "" : "";
    renderColorGrid(path ? path.color || DEFAULT_COLOR : nextColor(exceptKey) || DEFAULT_COLOR, exceptKey);
    $("archivePathBtn").style.display = path && !isDraftPath(path) ? "" : "none";
    $("archivePathBtn").textContent = "Deactiveer pad";
    $("deletePathBtn").style.display = path ? "" : "none";
    $("deletePathBtn").textContent = path && isDraftPath(path) ? "Verwijder concept" : "Verwijder pad";
    $("pathModal").classList.add("open");
    setTimeout(() => $("pathName").focus(), 30);
  }

  function closePathModal() {
    $("pathModal").classList.remove("open");
  }

  function usedPathColors(exceptKey = "") {
    const skip = String(exceptKey || "");
    return new Set(activePaths()
      .filter((path) => pathKey(path) !== skip)
      .map((path) => colorKey(path.color)));
  }

  function nextColor(exceptKey = "") {
    const used = usedPathColors(exceptKey);
    return AUTO_COLOR_ORDER.find((color) => !used.has(color.toLowerCase())) || "";
  }

  function renderColorGrid(selected, exceptKey = "") {
    const row = $("pathColors");
    const used = usedPathColors(exceptKey);
    const paletteByKey = new Map(COLORS.map((color) => [rawColorKey(color), color]));
    const requestedKey = rawColorKey(selected || "");
    const selectedColor = paletteByKey.get(requestedKey) || nextColor(exceptKey) || DEFAULT_COLOR;
    const selectedKey = selectedColor ? colorKey(selectedColor) : "";
    row.innerHTML = PATH_COLOR_ROWS.map((colors) => (
      colors.map((color) => {
      const key = colorKey(color);
      const usedByOther = used.has(key);
      const selectedClass = key === selectedKey ? "selected" : "";
      const usedClass = usedByOther ? "used" : "";
      const label = usedByOther ? `${color} al in gebruik` : color;
      return `<button type="button" class="colorBtn ${selectedClass} ${usedClass}" data-color="${color}" style="background:${color}" ${usedByOther ? "disabled" : ""} title="${esc(label)}" aria-label="${esc(label)}" aria-pressed="${selectedClass ? "true" : "false"}"></button>`;
      }).join("")
    )).join("");
    row.dataset.value = selectedColor;
    row.querySelectorAll(".colorBtn").forEach((button) => {
      const isSelected = rawColorKey(button.dataset.color) === rawColorKey(selectedColor);
      button.classList.toggle("selected", isSelected);
      button.setAttribute("aria-pressed", isSelected ? "true" : "false");
    });
    row.onclick = (event) => {
      event.preventDefault();
      event.stopPropagation();
      const button = event.target && event.target.closest ? event.target.closest(".colorBtn") : null;
      if (!button || !row.contains(button) || button.disabled) return;
      const nextColorValue = String(button.dataset.color || "");
      if (!nextColorValue) return;
      row.dataset.value = nextColorValue;
      row.querySelectorAll(".colorBtn").forEach((item) => {
        const isSelected = item === button;
        item.classList.toggle("selected", isSelected);
        item.setAttribute("aria-pressed", isSelected ? "true" : "false");
      });
    };
  }

  function selectedModalColor(exceptKey = "") {
    const selectedColor = colorValue($("pathColors").dataset.value || "", "");
    const used = usedPathColors(exceptKey);
    const paletteKeys = new Set(COLORS.map((color) => rawColorKey(color)));
    if (selectedColor && paletteKeys.has(rawColorKey(selectedColor)) && !used.has(colorKey(selectedColor))) return selectedColor;
    return "";
  }

  function savePathInfo() {
    const name = $("pathName").value.trim();
    if (!name) {
      toast("Geef het pad een naam.", true);
      return;
    }
    if (modalMode === "new") {
      const color = selectedModalColor("");
      if (!color) {
        toast("Kies een vrije kleur.", true);
        return;
      }
      const draft = {
        id: `draft-${Date.now()}`,
        name,
        description: $("pathDescription").value,
        color,
        edgeMode: "manual",
        sceneIds: [],
        edges: [],
        endSceneIds: [],
        blockRules: [],
        ignoreCrossingBlockSceneIds: [],
        isActive: true,
      };
      state.paths = [draft, ...(state.paths || [])];
      activePathId = pathKey(draft);
      clearSelection();
      markDirty();
    } else {
      const path = activePath();
      if (!path) return;
      const color = selectedModalColor(pathKey(path));
      if (!color) {
        toast("Kies een vrije kleur.", true);
        return;
      }
      path.name = name;
      path.description = $("pathDescription").value;
      path.color = color;
      markDirty();
    }
    closePathModal();
    ensureSelection();
    renderAll();
  }

  function forgetPathLocally(path) {
    const key = pathKey(path);
    if (!key) return;
    state.paths = (state.paths || []).filter((item) => pathKey(item) !== key);
    selectedPathIds.delete(key);
    dirtyPathIds.delete(key);
    delete layouts[key];
    saveLayouts();
    if (activeKey() === key) activePathId = "";
    clearSelection();
  }

  async function archiveActivePath() {
    const path = activePath();
    if (!path) return;
    if (isDraftPath(path)) {
      forgetPathLocally(path);
      ensureSelection();
      closePathModal();
      renderAll();
      return;
    }
    const dirtyWarning = dirtyPathIds.has(pathKey(path)) ? "\n\nNiet-opgeslagen wijzigingen in dit pad worden niet bewaard." : "";
    if (!confirm(`Pad "${path.name || "Naamloos pad"}" deactiveren?${dirtyWarning}`)) return;
    try {
      const result = await api("/admin/algorithm/archive", {
        method: "POST",
        body: { kind: "path", id: path.id },
      });
      if (result && result.state) state = normalizeEditorState(result.state);
      selectedPathIds.delete(pathKey(path));
      dirtyPathIds.delete(pathKey(path));
      if (activeKey() === pathKey(path)) activePathId = "";
      rebuildIndexes();
      ensureSelection();
      setSaveState(dirtyPathIds.size || dirtyCrossingThresholdSceneIds.size ? "dirty" : "saved");
      closePathModal();
      renderAll();
      toast("Pad gedeactiveerd");
    } catch (err) {
      toast(`Deactiveren mislukt: ${err.message}`, true);
    }
  }

  async function deleteActivePath() {
    const path = activePath();
    if (!path) return;
    const key = pathKey(path);
    if (isDraftPath(path)) {
      if (!confirm(`Concept "${path.name || "Naamloos pad"}" verwijderen?`)) return;
      forgetPathLocally(path);
      ensureSelection();
      closePathModal();
      renderAll();
      toast("Concept verwijderd");
      return;
    }
    const dirtyWarning = dirtyPathIds.has(key) ? "\n\nNiet-opgeslagen wijzigingen in dit pad worden weggegooid." : "";
    if (!confirm(`Pad "${path.name || "Naamloos pad"}" permanent verwijderen? Dit kan niet ongedaan worden gemaakt.${dirtyWarning}`)) return;
    try {
      if (path.isActive !== false && !path.archivedAt) {
        await api("/admin/algorithm/archive", {
          method: "POST",
          body: { kind: "path", id: path.id },
        });
      }
      const result = await api("/admin/algorithm/delete", {
        method: "POST",
        body: { kind: "path", id: path.id },
      });
      if (result && result.state) state = normalizeEditorState(result.state);
      forgetPathLocally(path);
      rebuildIndexes();
      ensureSelection();
      setSaveState(dirtyPathIds.size || dirtyCrossingThresholdSceneIds.size ? "dirty" : "saved");
      closePathModal();
      renderAll();
      toast("Pad verwijderd");
    } catch (err) {
      toast(`Verwijderen mislukt: ${err.message}`, true);
    }
  }

  function autoLayout() {
    const path = activePath();
    if (!path) return;
    layouts[pathKey(path)] = {};
    saveLayouts();
    renderCanvas();
  }

  function fitCanvas() {
    focusPathInView(activeKey(), { behavior: "smooth" });
  }

  function focusPathInView(pathOrKey = activeKey(), options = {}) {
    const key = typeof pathOrKey === "string" ? pathOrKey : pathKey(pathOrKey);
    if (!key) return;
    const outer = $("canvasOuter");
    if (!outer) return;
    const model = buildUnifiedCanvasModel();
    const positions = model.pathPositions && model.pathPositions.get(key)
      ? Object.values(model.pathPositions.get(key)).filter(Boolean)
      : [];
    if (!positions.length) return;
    const minX = Math.min(...positions.map((pos) => Number(pos.x || 0)));
    const maxX = Math.max(...positions.map((pos) => Number(pos.x || 0) + NODE_W));
    const minY = Math.min(...positions.map((pos) => Number(pos.y || 0)));
    const maxY = Math.max(...positions.map((pos) => Number(pos.y || 0) + NODE_H));
    const centerX = (minX + maxX) / 2;
    const centerY = (minY + maxY) / 2;
    outer.scrollTo({
      left: Math.max(0, centerX * canvasZoom - outer.clientWidth / 2),
      top: Math.max(0, centerY * canvasZoom - outer.clientHeight / 2),
      behavior: options.behavior || "smooth",
    });
  }

  function scrollNodeIntoView(sceneId) {
    const model = buildUnifiedCanvasModel();
    const pos = model.layout && model.layout.positions ? model.layout.positions[Number(sceneId)] : null;
    if (!pos) return;
    $("canvasOuter").scrollTo({
      left: Math.max(0, (pos.x + NODE_W / 2) * canvasZoom - $("canvasOuter").clientWidth / 2),
      top: Math.max(0, (pos.y + NODE_H / 2) * canvasZoom - $("canvasOuter").clientHeight / 2),
      behavior: "smooth",
    });
  }

  function jumpToSearch() {
    const q = jumpQ.toLowerCase();
    if (!q) return;
    const ids = activeSceneIds();
    const scene = ids.map((id) => sceneById.get(id)).find((item) => String(item && item.title || "").toLowerCase().includes(q));
    if (!scene) return;
    setSingleNodeSelection(scene.id);
    renderCanvas();
    scrollNodeIntoView(selectedNodeId);
  }

  function wire() {
    $("loginForm").addEventListener("submit", (event) => {
      event.preventDefault();
      login();
    });
    $("sceneSearch").addEventListener("input", (event) => {
      searchQ = event.target.value;
      renderSceneList();
    });
    $("jumpSearch").addEventListener("input", (event) => {
      jumpQ = event.target.value;
      jumpToSearch();
    });
    $("saveBtn").addEventListener("click", saveDirtyPaths);
    $("refreshBtn").addEventListener("click", () => loadState({ show: true }));
    $("autoLayoutBtn").addEventListener("click", autoLayout);
    $("fitBtn").addEventListener("click", fitCanvas);
    $("testModeBtn").addEventListener("click", () => setTestMode(!testMode));
    $("testResetBtn").addEventListener("click", resetTest);
    $("testUndoBtn").addEventListener("click", undoTestStep);
    $("testNextBtn").addEventListener("click", playNextTestNode);
    $("scenePaneCollapseBtn").addEventListener("click", () => setScenePaneCollapsed(true));
    $("scenePaneExpandBtn").addEventListener("click", () => setScenePaneCollapsed(false));
    $("inspectorToggleBtn").addEventListener("click", () => setInspectorCollapsed(!inspectorCollapsed));
    $("zoomOutBtn").addEventListener("click", () => setCanvasZoom(canvasZoom - ZOOM_STEP));
    $("zoomInBtn").addEventListener("click", () => setCanvasZoom(canvasZoom + ZOOM_STEP));
    $("zoomResetBtn").addEventListener("click", () => setCanvasZoom(1));
    $("cancelPathBtn").addEventListener("click", closePathModal);
    $("savePathInfoBtn").addEventListener("click", savePathInfo);
    $("archivePathBtn").addEventListener("click", archiveActivePath);
    $("deletePathBtn").addEventListener("click", deleteActivePath);
    $("pathModal").addEventListener("click", (event) => {
      if (event.target.id === "pathModal") closePathModal();
    });
    $("canvasOuter").addEventListener("scroll", updateMiniViewport);
    window.addEventListener("resize", renderCanvas);
    $("canvasOuter").addEventListener("wheel", (event) => {
      if (!event.ctrlKey && !event.metaKey) return;
      event.preventDefault();
      const delta = event.deltaMode === 1 ? event.deltaY * 16 : event.deltaY;
      const factor = Math.exp(-delta * 0.01);
      zoomAtClientPoint(canvasZoom * factor, event.clientX, event.clientY);
    }, { passive: false });
    $("canvasOuter").addEventListener("gesturestart", (event) => {
      event.preventDefault();
      pinchGesture = { startZoom: canvasZoom };
    }, { passive: false });
    $("canvasOuter").addEventListener("gesturechange", (event) => {
      if (!pinchGesture) return;
      event.preventDefault();
      zoomAtClientPoint(pinchGesture.startZoom * Number(event.scale || 1), event.clientX, event.clientY);
    }, { passive: false });
    $("canvasOuter").addEventListener("gestureend", () => {
      pinchGesture = null;
    });
    $("canvasOuter").addEventListener("mousedown", (event) => {
      if (event.target && event.target.closest && event.target.closest(".pathNode,.edgeHit,button,input,textarea,select,a")) return;
      startMarqueeSelect(event);
    });

    const allowDrop = (event) => {
      if (testMode) return;
      if (!event.dataTransfer || !Array.from(event.dataTransfer.types || []).includes("application/x-scene-id")) return;
      event.preventDefault();
      $("canvasInner").classList.add("dropActive");
    };
    $("canvasOuter").addEventListener("dragover", allowDrop);
    $("canvasInner").addEventListener("dragover", allowDrop);
    $("canvasOuter").addEventListener("dragleave", (event) => {
      if (event.target === $("canvasOuter") || event.target === $("canvasInner")) $("canvasInner").classList.remove("dropActive");
    });
    $("canvasOuter").addEventListener("drop", (event) => {
      if (testMode) return;
      const sceneId = Number(event.dataTransfer.getData("application/x-scene-id") || 0);
      if (!sceneId) return;
      event.preventDefault();
      $("canvasInner").classList.remove("dropActive");
      const point = canvasPoint(event);
      addSceneToPath(sceneId, point.x, point.y);
    });

    document.addEventListener("keydown", (event) => {
      if (event.target && event.target.matches && event.target.matches("input, textarea")) return;
      if (event.key === "Delete" || event.key === "Backspace") {
        if (selectedNodeIds.size) {
          event.preventDefault();
          removeScenesFromPath(Array.from(selectedNodeIds));
        } else if (selectedEdgeKey) {
          event.preventDefault();
          removeEdge(selectedEdgeKey);
        }
      }
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s") {
        event.preventDefault();
        saveDirtyPaths();
      }
    });

    window.addEventListener("beforeunload", (event) => {
      if (!dirtyPathIds.size && !dirtyCrossingThresholdSceneIds.size) return;
      event.preventDefault();
      event.returnValue = "";
    });
    applyPanelState();
  }

  (async function init() {
    loadLocal();
    wire();
    if (token) {
      await loadState({ show: true });
      return;
    }
    if (!(await tryDeviceLogin())) showLogin();
  })();
})();
