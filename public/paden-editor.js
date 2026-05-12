(() => {
  "use strict";

  const Graph = window.PadenGraph;
  const TOKEN_KEY = "algorithm_admin_token_v1";
  const LAYOUT_KEY = "paden_editor_layouts_v1";
  const PREF_KEY = "paden_editor_prefs_v1";
  const NODE_W = Graph.DEFAULT_NODE_W;
  const NODE_H = Graph.DEFAULT_NODE_H;
  const COLORS = [
    "#14b8a6", "#f97316", "#8b5cf6", "#3b82f6", "#ec4899", "#84cc16",
    "#f59e0b", "#06b6d4", "#ef4444", "#10b981", "#a855f7", "#0ea5e9",
  ];
  const DEFAULT_COLOR = COLORS[0];
  const ARROW_LEN = 18;
  const ARROW_HALF = 10;
  const ZOOM_MIN = 0.55;
  const ZOOM_MAX = 2;
  const ZOOM_STEP = 0.1;
  const MAX_SELECTED_PATHS = 3;

  let token = "";
  let state = { scenes: [], paths: [] };
  let sceneById = new Map();
  let activePathId = "";
  let selectedPathIds = new Set();
  let selectedNodeId = 0;
  let selectedNodeIds = new Set();
  let selectedEdgeKey = "";
  let dirtyPathIds = new Set();
  let saving = false;
  let searchQ = "";
  let jumpQ = "";
  let layouts = {};
  let showNeighbors = true;
  let canvasZoom = 1;
  let dragEdge = null;
  let marquee = null;
  let pinchGesture = null;
  let modalMode = "edit";

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
    } catch {
      selectedPathIds = new Set();
      canvasZoom = 1;
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
      }));
    } catch {}
  }

  function clearNodeSelection() {
    selectedNodeIds.clear();
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
      selectedNodeId = selectedNodeIds.size ? Array.from(selectedNodeIds).at(-1) : 0;
      return;
    }
    selectedNodeIds.add(id);
    selectedNodeId = id;
  }

  function setNodeSelection(sceneIds = []) {
    const ids = Graph.normalizeIdList(sceneIds);
    selectedNodeIds = new Set(ids);
    selectedNodeId = ids.length ? ids[ids.length - 1] : 0;
    selectedEdgeKey = "";
  }

  function isNodeSelected(sceneId) {
    return selectedNodeIds.has(Number(sceneId || 0));
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
    const dirtyCount = dirtyPathIds.size;
    el.querySelector(".txt").textContent =
      kind === "saving" ? "Opslaan..." :
      kind === "dirty" ? `${dirtyCount || 1} niet opgeslagen` :
      "Opgeslagen";
  }

  function markDirty(pathOrKey = activePath()) {
    const key = typeof pathOrKey === "string" ? pathOrKey : pathKey(pathOrKey);
    if (key) dirtyPathIds.add(key);
    setSaveState(dirtyPathIds.size ? "dirty" : "saved");
    if ($("chipbar")) renderChips();
  }

  function markClean(pathOrKey) {
    const key = typeof pathOrKey === "string" ? pathOrKey : pathKey(pathOrKey);
    if (key) dirtyPathIds.delete(key);
    setSaveState(dirtyPathIds.size ? "dirty" : "saved");
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

  function normalizeEditorState(data) {
    const src = data && typeof data === "object" ? data : {};
    const catalog = src.catalog && typeof src.catalog === "object" ? src.catalog : src;
    return {
      scenes: Array.isArray(catalog.scenes) ? catalog.scenes : [],
      paths: Array.isArray(catalog.paths) ? catalog.paths : [],
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
    const target = activePath();
    const paths = activePaths().filter((path) => selectedPathIds.has(pathKey(path)));
    if (!target) return paths;
    return [
      target,
      ...paths.filter((path) => pathKey(path) !== activeKey()),
    ];
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
  }

  function ensureSelection() {
    const paths = activePaths();
    if (!paths.length) {
      activePathId = "";
      selectedPathIds.clear();
      return;
    }
    const validKeys = paths.map(pathKey).filter(Boolean);
    const validSet = new Set(validKeys);
    selectedPathIds = new Set(Array.from(selectedPathIds).filter((key) => validSet.has(key)));
    if (!activePath()) activePathId = selectedPathIds.size ? Array.from(selectedPathIds)[0] : validKeys[0];
    selectedPathIds.add(activeKey());
    const ordered = validKeys.filter((key) => selectedPathIds.has(key));
    const keep = [activeKey(), ...ordered.filter((key) => key !== activeKey())].filter(Boolean).slice(0, MAX_SELECTED_PATHS);
    selectedPathIds = new Set(keep);
    savePrefs();
  }

  async function loadState({ show = false } = {}) {
    try {
      const data = await api("/admin/algorithm/state");
      state = normalizeEditorState(data);
      rebuildIndexes();
      ensureSelection();
      dirtyPathIds.clear();
      setSaveState("saved");
      showApp();
      renderAll();
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
        x: Math.max(20, Number(manual[sceneId].x || 0)),
        y: Math.max(20, Number(manual[sceneId].y || 0)),
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
        x: Math.max(0, Number(layout.positions[sceneId].x || 0)),
        y: Math.max(0, Number(layout.positions[sceneId].y || 0)),
      };
    });
    return { manual, positions: layout.positions || {} };
  }

  function viewportNodePosition() {
    const outer = $("canvasOuter");
    return {
      x: Math.max(20, (outer.scrollLeft + outer.clientWidth / 2) / canvasZoom - NODE_W / 2),
      y: Math.max(20, (outer.scrollTop + outer.clientHeight / 2) / canvasZoom - NODE_H / 2),
    };
  }

  function openNodePosition(seed, occupied = []) {
    const gapY = NODE_H + 36;
    const gapX = NODE_W + 34;
    const origin = {
      x: Math.max(20, Number(seed && seed.x || 20)),
      y: Math.max(20, Number(seed && seed.y || 20)),
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

  function addedScenePosition(existingIds = [], currentPositions = {}) {
    const occupied = existingIds
      .map((id) => currentPositions[id])
      .filter(Boolean);
    const refId = selectedNodeId && existingIds.includes(Number(selectedNodeId))
      ? Number(selectedNodeId)
      : existingIds[existingIds.length - 1];
    const ref = refId ? currentPositions[refId] : null;
    const seed = ref
      ? { x: Number(ref.x || 20), y: Number(ref.y || 20) + NODE_H + 86 }
      : viewportNodePosition();
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
    const pathTransforms = new Map();
    let nextX = 380;

    paths.forEach((path, index) => {
      const key = pathKey(path);
      const pathLayout = getLayout(path);
      const sceneIds = Graph.getPathSceneIds(path);
      const sourcePositions = pathLayout.positions || {};
      const anchorId = index > 0
        ? sceneIds.find((sceneId) => composed.has(Number(sceneId)) && sourcePositions[sceneId])
        : 0;
      let dx = 0;
      let dy = 0;

      if (anchorId) {
        const anchor = composed.get(Number(anchorId));
        dx = Number(anchor.position.x || 0) - Number(sourcePositions[anchorId].x || 0);
        dy = Number(anchor.position.y || 0) - Number(sourcePositions[anchorId].y || 0);
      } else if (index > 0) {
        const values = Object.values(sourcePositions);
        const minX = values.length ? Math.min(...values.map((pos) => pos.x)) : 0;
        const minY = values.length ? Math.min(...values.map((pos) => pos.y)) : 0;
        dx = nextX - minX;
        dy = 72 + index * 36 - minY;
      }

      const positions = {};
      pathTransforms.set(key, { dx, dy });
      sceneIds.forEach((sceneId) => {
        const id = Number(sceneId);
        const existing = composed.get(id);
        if (existing) {
          positions[id] = existing.position;
          existing.pathIds.add(key);
          existing.paths.push(path);
          existing.colors.push(colorValue(path.color));
          return;
        }
        const source = sourcePositions[id];
        if (!source) return;
        const position = {
          x: Math.max(20, Number(source.x || 0) + dx),
          y: Math.max(20, Number(source.y || 0) + dy),
        };
        positions[id] = position;
        composed.set(id, {
          sceneId: id,
          pathIds: new Set([key]),
          paths: [path],
          colors: [colorValue(path.color)],
          position,
        });
      });

      const renderedPositions = Object.values(positions);
      if (renderedPositions.length) {
        nextX = Math.max(nextX, ...renderedPositions.map((pos) => pos.x + NODE_W + 130));
      }
      pathPositions.set(key, positions);
      pathEdges.set(key, Graph.getRenderableEdges(path, { fallback: true }));
      pathEndpoints.set(key, Graph.pathEndpoints(path, { fallback: true, connectedOnly: true }));
    });

    const nodes = Array.from(composed.values()).map((node) => ({
      ...node,
      pathIds: Array.from(node.pathIds),
      isShared: node.pathIds.size > 1,
    }));
    const allPositions = nodes.map((node) => node.position).filter(Boolean);
    const layout = viewportSizedLayout({
      positions: Object.fromEntries(nodes.map((node) => [node.sceneId, node.position])),
      width: allPositions.length ? Math.max(820, ...allPositions.map((pos) => pos.x + NODE_W + 90)) : 820,
      height: allPositions.length ? Math.max(760, ...allPositions.map((pos) => pos.y + NODE_H + 120)) : 760,
    });

    return { paths, nodes, pathPositions, pathEdges, pathEndpoints, pathTransforms, layout };
  }

  function renderAll() {
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
    const chips = paths.map((path) => {
      const key = pathKey(path);
      const isSelected = selectedPathIds.has(key);
      const isTarget = key === activeKey();
      const isDirty = dirtyPathIds.has(key);
      return `<span class="chip ${isSelected ? "selected" : ""} ${isTarget ? "target" : ""} ${isDirty ? "dirty" : ""}">
        <label class="pathToggle" title="${isSelected ? "Verberg pad" : "Toon pad"}">
          <input type="checkbox" data-path-check="${esc(key)}" ${isSelected ? "checked" : ""} />
          <span></span>
        </label>
        <button type="button" data-path-target="${esc(key)}" title="${esc(path.name || "")}">
          <span class="dot" style="background:${colorValue(path.color)}"></span>
          <span class="txt">${esc(path.name || "Naamloos pad")}</span>
        </button>
      </span>`;
    }).join("");

    bar.innerHTML = `
      <span class="barLabel">Paden</span>
      ${chips || '<span class="chip">Nog geen paden</span>'}
      <span class="barHint">${selectedCount}/${MAX_SELECTED_PATHS} geselecteerd</span>
      <span style="flex:1"></span>
      <label class="switch">
        <input id="showNeighborsToggle" type="checkbox" ${showNeighbors ? "checked" : ""} />
        <span class="track"></span>
        Toon buren <span style="color:var(--muted);font-weight:550">(1 verder)</span>
      </label>
    `;

    bar.querySelectorAll("[data-path-check]").forEach((input) => {
      input.addEventListener("change", () => setPathSelected(input.dataset.pathCheck, input.checked));
    });
    bar.querySelectorAll("[data-path-target]").forEach((button) => {
      button.addEventListener("click", () => activatePath(button.dataset.pathTarget));
    });
    $("showNeighborsToggle").addEventListener("change", (event) => {
      showNeighbors = !!event.target.checked;
      savePrefs();
      renderCanvas();
    });
  }

  function activatePath(nextId) {
    const key = String(nextId || "");
    if (!key || key === activeKey()) return true;
    if (!pathById(key)) return false;
    activePathId = key;
    clearSelection();
    selectedPathIds.add(key);
    ensureSelection();
    renderAll();
    return true;
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
      if (selectedPathIds.size <= 1) {
        toast("Minstens één pad blijft geselecteerd.", true);
        renderChips();
        return;
      }
      selectedPathIds.delete(key);
      if (key === activeKey()) activePathId = Array.from(selectedPathIds)[0] || "";
      clearSelection();
      ensureSelection();
      renderAll();
      return;
    }
    if (isSelected) {
      renderChips();
      return;
    }
    if (selectedPathIds.size >= MAX_SELECTED_PATHS) {
      toast(`Je kunt maximaal ${MAX_SELECTED_PATHS} paden tegelijk selecteren.`, true);
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
    const membership = Graph.analyzePathMembership(activePaths());
    const scenes = (state.scenes || [])
      .filter((scene) => scene && scene.isActive !== false && !scene.archivedAt)
      .filter((scene) => !q || String(scene.title || "").toLowerCase().includes(q))
      .sort((a, b) => String(a.title || "").localeCompare(String(b.title || "")));

    $("sceneCount").textContent = scenes.length ? `· ${scenes.length}` : "0";
    list.innerHTML = scenes.map((scene) => {
      const id = Number(scene.id || 0);
      const dots = (membership.get(id) || []).slice(0, 3).map((item) => (
        `<span title="${esc(item.name)}" style="background:${colorValue(item.color)}"></span>`
      )).join("");
      return `<div class="sceneRow ${activeSet.has(id) ? "inActive" : ""}" draggable="true" data-scene-id="${id}" title="${esc(scene.title || "")}">
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
    const targetPath = activePath();
    const model = buildUnifiedCanvasModel();
    const inner = $("canvasInner");
    const empty = $("emptyState");
    inner.querySelectorAll(".pathNode,.ghostNode,.edgeDelete").forEach((node) => node.remove());

    if (!targetPath || !model.paths.length) {
      empty.style.display = "flex";
      inner.classList.remove("hasNodes");
      const blankLayout = viewportSizedLayout({ width: 820, height: 760 });
      inner.style.width = `${blankLayout.width}px`;
      inner.style.height = `${blankLayout.height}px`;
      applyCanvasZoom(blankLayout);
      $("edgesLayer").innerHTML = "";
      renderMiniMap(null, null, []);
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
    const ghosts = showNeighbors ? Graph.selectGhostNeighbors(
      { id: "__selected__", sceneIds: model.nodes.map((node) => node.sceneId), edges: [], isActive: true },
      activePaths(),
      { activeSceneIds: model.nodes.map((node) => node.sceneId), excludePathIds: selectedPathIds }
    ) : [];
    renderEdges(svg, model, ghosts);

    model.nodes.forEach((nodeModel) => {
      inner.appendChild(createNode(nodeModel, membership.get(Number(nodeModel.sceneId)) || [], model));
    });

    ghosts.forEach((ghost, index) => {
      const fromPos = layout.positions[ghost.fromSceneId];
      if (!fromPos) return;
      const ghostPos = ghostPosition(fromPos, ghost, index);
      inner.appendChild(createGhostNode(ghost, ghostPos));
    });

    if (selectedEdgeKey) renderEdgeDelete(model);
    renderMiniMap(model, ghosts);
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
    const tip = { x: x2, y: y2 };
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
      hitPath: `M ${num(x1)} ${num(y1)} C ${num(c1.x)} ${num(c1.y)}, ${num(c2.x)} ${num(c2.y)}, ${num(tip.x)} ${num(tip.y)}`,
      arrowPoints: `${num(tip.x)},${num(tip.y)} ${num(left.x)},${num(left.y)} ${num(right.x)},${num(right.y)}`,
    };
  }

  function renderEdges(svg, model, ghosts) {
    const body = [];

    (model.paths || []).forEach((path) => {
      const key = pathKey(path);
      const color = colorValue(path.color);
      const positions = model.pathPositions.get(key) || {};
      const edges = model.pathEdges.get(key) || [];
      edges.forEach((edge) => {
        const from = positions[edge.fromSceneId] || model.layout.positions[edge.fromSceneId];
        const to = positions[edge.toSceneId] || model.layout.positions[edge.toSceneId];
        if (!from || !to) return;
        const selectionKey = pathEdgeSelectionKey(path, edge);
        const selected = selectionKey === selectedEdgeKey;
        const geometry = edgeGeometry(from, to);
        body.push(`<path d="${geometry.linePath}" fill="none" stroke="${color}" stroke-width="${selected ? 4 : 2.8}" opacity="${key === activeKey() ? "1" : "0.82"}" />`);
        body.push(`<polygon points="${geometry.arrowPoints}" fill="${color}" opacity="${key === activeKey() ? "1" : "0.82"}" />`);
        body.push(`<path class="edgeHit" d="${geometry.hitPath}" fill="none" stroke="transparent" data-edge-key="${esc(selectionKey)}" />`);
      });
    });

    ghosts.forEach((ghost, index) => {
      const from = model.layout.positions[ghost.fromSceneId];
      if (!from) return;
      const to = ghostPosition(from, ghost, index);
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

  function stripeBackground(members, fallbackColor) {
    const colors = (members || []).map((item) => (
      typeof item === "string" ? colorValue(item, fallbackColor) : colorValue(item.color, fallbackColor)
    )).slice(0, 4);
    if (!colors.length) return fallbackColor;
    if (colors.length === 1) return colors[0];
    const step = 100 / colors.length;
    return `linear-gradient(${colors.map((color, index) => `${color} ${index * step}% ${(index + 1) * step}%`).join(", ")})`;
  }

  function createNode(nodeModel, members, model) {
    const sceneId = Number(nodeModel.sceneId || 0);
    const pos = nodeModel.position;
    const scene = sceneById.get(Number(sceneId));
    const node = document.createElement("div");
    const nodePaths = nodeModel.paths || [];
    const connected = nodePaths.some((path) => connectedSceneIdSet(path).has(Number(sceneId)));
    const inTarget = nodeModel.pathIds.includes(activeKey());
    const isDraft = !connected;
    node.className = `pathNode${isDraft ? " draftNode" : ""}${nodeModel.isShared ? " sharedNode" : ""}${inTarget ? " targetMember" : ""}${isNodeSelected(sceneId) ? " selected" : ""}`;
    node.dataset.sceneId = String(sceneId);
    node.dataset.pathIds = nodeModel.pathIds.join(",");
    node.style.left = `${pos.x}px`;
    node.style.top = `${pos.y}px`;

    const firstPath = nodePaths[0] || activePath();
    const firstEndpoints = firstPath ? model.pathEndpoints.get(pathKey(firstPath)) || { starts: [], ends: [] } : { starts: [], ends: [] };
    const isStart = firstEndpoints.starts.includes(Number(sceneId));
    const isEnd = firstEndpoints.ends.includes(Number(sceneId));
    const sub = isDraft ? ""
      : nodeModel.isShared ? `kruispunt · ${nodeModel.pathIds.length} paden`
        : [isStart ? "start" : "", isEnd ? "einde" : ""].filter(Boolean).join(" · ");

    node.innerHTML = `
      <span class="stripe" style="background:${isDraft ? "#c8c1b8" : stripeBackground(nodeModel.colors, colorValue(firstPath && firstPath.color))}"></span>
      <div class="title">${esc(scene && scene.title || `Situatie #${sceneId}`)}</div>
      ${sub ? `<div class="sub">${esc(sub)}</div>` : ""}
      <button class="port out" type="button" data-port="out" title="Pijl vanaf hier"></button>
      <button class="nodeHandle remove" type="button" title="Verwijder uit pad">×</button>
    `;

    wireNode(node, Number(sceneId));
    return node;
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
      if (event.target.closest("button")) return;
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
      const renderedIds = new Set(model.nodes.map((item) => Number(item.sceneId)));
      const selectedIds = Array.from(selectedNodeIds).filter((id) => renderedIds.has(Number(id)));
      if (!selectedIds.length) selectedIds.push(sceneId);
      const currentById = new Map(selectedIds.map((id) => [
        Number(id),
        model.layout.positions[Number(id)] || { x: 0, y: 0 },
      ]));
      const startX = event.clientX;
      const startY = event.clientY;
      let didMove = false;
      const move = (moveEvent) => {
        const pointerDistance = Math.hypot(moveEvent.clientX - startX, moveEvent.clientY - startY);
        if (pointerDistance < 4 && !didMove) return;
        didMove = true;
        const dx = (moveEvent.clientX - startX) / canvasZoom;
        const dy = (moveEvent.clientY - startY) / canvasZoom;
        currentById.forEach((current, id) => {
          const nextPosition = {
            x: Math.max(0, current.x + dx),
            y: Math.max(0, current.y + dy),
          };
          pathsContainingScene(id, model.paths).forEach((path) => {
            const transform = model.pathTransforms.get(pathKey(path)) || { dx: 0, dy: 0 };
            const manual = ensureManualLayout(pathKey(path));
            manual[id] = {
              x: Math.max(0, nextPosition.x - Number(transform.dx || 0)),
              y: Math.max(0, nextPosition.y - Number(transform.dy || 0)),
            };
          });
        });
        saveLayouts();
        renderCanvas();
      };
      if (selectionChanged) renderCanvas();
      const up = () => {
        document.removeEventListener("mousemove", move);
        document.removeEventListener("mouseup", up);
      };
      document.addEventListener("mousemove", move);
      document.addEventListener("mouseup", up);
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

  function edgePathIdForSource(pathIds = []) {
    const selectedIds = pathIds.filter((key) => selectedPathIds.has(key));
    if (selectedIds.length === 1) return selectedIds[0];
    return activeKey();
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
    if (code.startsWith("path_edge_multiple_incoming:")) {
      return "Deze node zit al in het pad. Je kunt niet terugprikken in een eerdere of middelste node.";
    }
    if (code.startsWith("path_cycle:")) {
      return "Deze verbinding zou een loop maken. Paden kunnen alleen vooruit lopen.";
    }
    if (code.startsWith("path_single_start_required:")) {
      return "Er is al een start in dit pad. Verbind nieuwe nodes vanuit het bestaande pad.";
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
    const edge = { fromSceneId, toSceneId: targetSceneId };
    const candidatePath = {
      ...path,
      sceneIds: nextSceneIds,
      edges: path.edges || [],
      edgeMode: "manual",
    };
    const issue = Graph.edgeCandidateIssue(candidatePath, edge.fromSceneId, edge.toSceneId, { fallback: true });
    if (issue) {
      toast(edgeIssueMessage(issue), true);
      return;
    }
    const { manual } = freezeCurrentLayout(path);
    path.sceneIds = nextSceneIds;
    if (!hasFrom && dragEdge.fromPosition) manual[fromSceneId] = dragEdge.fromPosition;
    if (!hasTo && options.toPosition) manual[targetSceneId] = options.toPosition;
    if ((!hasFrom && dragEdge.fromPosition) || (!hasTo && options.toPosition)) saveLayouts();
    path.edges = [...(path.edges || []), edge];
    path.edgeMode = "manual";
    clearNodeSelection();
    selectedEdgeKey = pathEdgeSelectionKey(path, edge);
    markDirty(path);
  }

  function renderEdgeDelete(model) {
    const parsed = parsePathEdgeSelectionKey(selectedEdgeKey);
    const path = pathById(parsed.pathId);
    const positions = model.pathPositions.get(parsed.pathId) || {};
    const edge = (model.pathEdges.get(parsed.pathId) || []).find((item) => Graph.edgeKey(item) === parsed.edgeKey);
    if (!edge) return;
    const from = positions[edge.fromSceneId] || model.layout.positions[edge.fromSceneId];
    const to = positions[edge.toSceneId] || model.layout.positions[edge.toSceneId];
    if (!from || !to) return;
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "edgeDelete";
    btn.title = "Verwijder pijl";
    btn.textContent = "×";
    btn.style.left = `${(from.x + to.x + NODE_W) / 2}px`;
    btn.style.top = `${(from.y + to.y + NODE_H) / 2}px`;
    btn.style.background = colorValue(path && path.color, "#b91c1c");
    btn.addEventListener("click", (event) => {
      event.stopPropagation();
      removeEdge(selectedEdgeKey);
    });
    $("canvasInner").appendChild(btn);
  }

  function addSceneToPath(sceneId, x, y) {
    const path = activePath();
    if (!path || !sceneId) return;
    path.sceneIds = Graph.normalizeIdList(path.sceneIds || []);
    const safeSceneId = Number(sceneId);
    const alreadyInPath = path.sceneIds.includes(safeSceneId);
    const existingIds = path.sceneIds.slice();
    const { manual, positions } = freezeCurrentLayout(path);
    if (!alreadyInPath) {
      path.sceneIds.push(safeSceneId);
      path.edges = Graph.normalizeEdges(path.edges || [], path.sceneIds);
      markDirty();
    }
    if (typeof x === "number" && typeof y === "number") {
      manual[safeSceneId] = {
        x: Math.max(0, x - NODE_W / 2),
        y: Math.max(0, y - NODE_H / 2),
      };
      saveLayouts();
    } else if (!alreadyInPath && !manual[safeSceneId]) {
      manual[safeSceneId] = addedScenePosition(existingIds, positions);
      saveLayouts();
    }
    setSingleNodeSelection(safeSceneId);
    renderAll();
    if (typeof x !== "number" || typeof y !== "number") scrollNodeIntoView(safeSceneId);
  }

  function removeScenesFromPath(sceneIds = []) {
    const path = activePath();
    if (!path) return;
    const targetSceneSet = new Set(Graph.getPathSceneIds(path));
    const ids = new Set(Graph.normalizeIdList(sceneIds).filter((id) => targetSceneSet.has(Number(id))));
    if (!ids.size) return;
    path.sceneIds = (path.sceneIds || []).filter((id) => !ids.has(Number(id)));
    path.edges = (path.edges || []).filter((edge) => !ids.has(Number(edge.fromSceneId)) && !ids.has(Number(edge.toSceneId)));
    const manual = ensureManualLayout(pathKey(path));
    ids.forEach((id) => {
      delete manual[id];
      selectedNodeIds.delete(Number(id));
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

  function renderMiniMap(model, ghosts = []) {
    const svg = $("miniSvg");
    if (!model || !model.paths || !model.paths.length) {
      svg.innerHTML = "";
      $("miniFoot").innerHTML = "0 situaties<br/>0 splits";
      return;
    }
    const visible = model.paths;
    const laneCount = Math.max(visible.length, 1);
    const laneStep = 48 / Math.max(laneCount - 1, 1);
    let html = "";

    visible.forEach((pathItem, index) => {
      const pathLayout = { positions: model.pathPositions.get(pathKey(pathItem)) || {} };
      const ids = Graph.getPathSceneIds(pathItem);
      const maxY = Math.max(...Object.values(pathLayout.positions || {}).map((pos) => pos.y), 1);
      const x = laneCount === 1 ? 33 : 10 + index * laneStep;
      const color = colorValue(pathItem.color);
      const dash = pathKey(pathItem) === activeKey() ? "" : ' stroke-dasharray="4 4" opacity="0.78"';
      const points = ids.map((sceneId) => {
        const pos = pathLayout.positions[sceneId];
        if (!pos) return null;
        return { x, y: 24 + (pos.y / Math.max(maxY, 1)) * 704 };
      }).filter(Boolean);
      for (let i = 0; i < points.length - 1; i += 1) {
        html += `<line x1="${points[i].x}" y1="${points[i].y}" x2="${points[i + 1].x}" y2="${points[i + 1].y}" stroke="${color}" stroke-width="2.1"${dash}/>`;
      }
      points.forEach((point) => {
        html += `<circle cx="${point.x}" cy="${point.y}" r="${pathKey(pathItem) === activeKey() ? 2.7 : 2.1}" fill="${color}"/>`;
      });
    });

    const path = activePath();
    const splitCount = Graph.getRenderableEdges(path, { fallback: true }).reduce((map, edge) => {
      map.set(edge.fromSceneId, (map.get(edge.fromSceneId) || 0) + 1);
      return map;
    }, new Map());
    const splits = Array.from(splitCount.values()).filter((count) => count > 1).length;
    svg.innerHTML = html;
    $("miniTitle").textContent = visible.length > 1 ? `Map · ${visible.length}` : "Map";
    $("miniFoot").innerHTML = `${Graph.getPathSceneIds(path).length} situaties<br/>${splits} splits · ${ghosts.length} buren`;
    updateMiniViewport();
  }

  function updateMiniViewport() {
    const outer = $("canvasOuter");
    const sizer = $("canvasSizer");
    const vp = $("miniViewport");
    const height = Math.max(1, sizer.scrollHeight);
    vp.style.top = `${Math.max(0, Math.min(100, outer.scrollTop / height * 100))}%`;
    vp.style.height = `${Math.max(8, Math.min(100, outer.clientHeight / height * 100))}%`;
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
    const body = {
      name: path.name || "Naamloos pad",
      description: path.description || "",
      color: path.color || DEFAULT_COLOR,
      edgeMode: "manual",
      sceneIds,
      edges,
      isActive: path.isActive !== false,
    };
    if (!isDraftPath(path)) body.id = path.id;
    return { body, sceneIds, edges };
  }

  function validatePathForSave(path) {
    const { sceneIds, edges } = pathSaveBody(path);
    if (!sceneIds.length) return "Kies minstens een situatie voor dit pad.";
    const starts = startIdsFor(sceneIds, edges);
    if (edges.length && starts.length !== 1) return "Het verbonden pad mag precies één start hebben.";
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
    const payloads = dirtyKeys
      .map((key) => pathById(key))
      .filter(Boolean)
      .map((path) => ({ path, previousKey: pathKey(path), ...pathSaveBody(path) }));
    dirtyPathIds = new Set(dirtyKeys.filter((key) => pathById(key)));
    if (!payloads.length) {
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
      if (lastServerState) state = normalizeEditorState(lastServerState);
      rebuildIndexes();
      ensureSelection();
      savedKeys.forEach((key) => dirtyPathIds.delete(key));
      setSaveState(dirtyPathIds.size ? "dirty" : "saved");
      renderAll();
      toast(payloads.length === 1 ? "Pad opgeslagen" : `${payloads.length} paden opgeslagen`);
    } catch (err) {
      savedKeys.forEach((key) => dirtyPathIds.delete(key));
      rebuildIndexes();
      ensureSelection();
      setSaveState(dirtyPathIds.size ? "dirty" : "saved");
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
    $("pathModalTitle").textContent = modalMode === "new" ? "Nieuw pad" : "Pad info";
    $("pathName").value = path ? path.name || "" : "";
    $("pathDescription").value = path ? path.description || "" : "";
    renderColorGrid(path ? path.color || DEFAULT_COLOR : nextColor());
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

  function nextColor() {
    const used = new Set(activePaths().map((path) => colorValue(path.color).toLowerCase()));
    return COLORS.find((color) => !used.has(color.toLowerCase())) || DEFAULT_COLOR;
  }

  function renderColorGrid(selected) {
    const row = $("pathColors");
    row.innerHTML = COLORS.map((color) => (
      `<span class="colorBtn ${color.toLowerCase() === colorValue(selected).toLowerCase() ? "selected" : ""}" data-color="${color}" style="background:${color}"></span>`
    )).join("");
    row.dataset.value = colorValue(selected);
    row.querySelectorAll(".colorBtn").forEach((button) => {
      button.addEventListener("click", () => renderColorGrid(button.dataset.color));
    });
  }

  function savePathInfo() {
    const name = $("pathName").value.trim();
    if (!name) {
      toast("Geef het pad een naam.", true);
      return;
    }
    if (modalMode === "new") {
      const draft = {
        id: `draft-${Date.now()}`,
        name,
        description: $("pathDescription").value,
        color: $("pathColors").dataset.value || nextColor(),
        edgeMode: "manual",
        sceneIds: [],
        edges: [],
        isActive: true,
      };
      state.paths = [draft, ...(state.paths || [])];
      activePathId = pathKey(draft);
      clearSelection();
      markDirty();
    } else {
      const path = activePath();
      if (!path) return;
      path.name = name;
      path.description = $("pathDescription").value;
      path.color = $("pathColors").dataset.value || path.color || DEFAULT_COLOR;
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
      setSaveState(dirtyPathIds.size ? "dirty" : "saved");
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
      setSaveState(dirtyPathIds.size ? "dirty" : "saved");
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
    $("canvasOuter").scrollTo({ top: 0, left: 0, behavior: "smooth" });
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
    $("newPathBtn").addEventListener("click", () => openPathModal("new"));
    $("pathInfoBtn").addEventListener("click", () => openPathModal("edit"));
    $("saveBtn").addEventListener("click", saveDirtyPaths);
    $("refreshBtn").addEventListener("click", () => loadState({ show: true }));
    $("autoLayoutBtn").addEventListener("click", autoLayout);
    $("fitBtn").addEventListener("click", fitCanvas);
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
      if (event.target && event.target.closest && event.target.closest(".pathNode,.edgeDelete,.edgeHit,button,input,textarea,select,a")) return;
      startMarqueeSelect(event);
    });

    const allowDrop = (event) => {
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
      if (!dirtyPathIds.size) return;
      event.preventDefault();
      event.returnValue = "";
    });
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
