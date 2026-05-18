(function () {
  "use strict";

  const Data = window.ForUniverseData;
  const SVGNS = "http://www.w3.org/2000/svg";
  const W = 1600;
  const H = 900;
  const SKY_CX = W / 2;
  const SKY_CY = H / 2;
  const FOCUS_W = 1180;
  const FOCUS_H = 360;
  const FOCUS_CX = W / 2;
  const FOCUS_CY = 410;
  const START_RING_RADIUS = 58;
  const START_NODE_MIN_RADIUS = 42;
  const START_NODE_MAX_RADIUS = 82;
  const CORE_RADIUS = START_RING_RADIUS + 18;
  const MAX_PATH_RADIUS = 365;
  const NO_ENTRY_MIN_RADIUS = 218;
  const NO_ENTRY_MAX_RADIUS = MAX_PATH_RADIUS - 34;
  const SPRING_PATH_MAX_RADIUS = 286;
  const SPRING_PATH_MIN_RADIUS = 86;
  const SPRING_EDGE_LENGTH = 58;
  const SPRING_LOOP_LENGTH = 46;
  const SPRING_NODE_SEPARATION = 22;
  const SPRING_PREVIEW_ITERATIONS = 24;
  const SPRING_FINAL_ITERATIONS = 96;
  const MOTION_DEFAULT_AMOUNT = 0;
  const MOTION_DEFAULT_SPEED = 1.35;
  const MOTION_DEFAULT_DEPTH = 0.62;
  const MOTION_DEFAULT_SCALE = 0.032;
  const MOTION_DEFAULT_SPIN = 1.5;
  const LATERAL_SCALE = 0.62;
  const VISUAL_SECTOR_COUNT = 16;
  const PATH_HOVER_STROKE = 24;
  const PATH_HOVER_AREA_PAD = 18;
  const PATH_HOVER_AREA_MAX_W = 330;
  const PATH_HOVER_AREA_MAX_H = 250;
  const ORBIT_DURATION_MS = 260000;
  const FOCUS_ANIMATION_MS = 1850;
  const FOCUS_SWITCH_FADE_MS = 220;
  const FOCUS_RETURN_FADE_MS = 280;
  const LOOSE_FOCUS_SCALE = 9;
  const IDLE_ORBIT_ENABLED = true;
  const ENTRY_CLUSTER_ANGLE = 0.11;
  const LOOSE_RING_MIN_RADIUS = 235;
  const LOOSE_RING_MAX_RADIUS = 315;
  const NETWORK_MAX_RADIUS_X = 590;
  const NETWORK_EDGE_LENGTH = 76;
  const NETWORK_ITERATIONS = 230;
  const NETWORK_NODE_SEPARATION = 24;
  const NETWORK_ROOT_RADIUS = 52;
  const NETWORK_DEPTH_GAP = 112;
  const NETWORK_RING_Y_SCALE = 0.64;
  const NETWORK_ORIENTATION_OFFSET = Math.PI / 2;
  const NETWORK_GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));

  function el(tag, attrs = {}) {
    const node = document.createElementNS(SVGNS, tag);
    Object.entries(attrs).forEach(([key, value]) => {
      if (value === undefined || value === null) return;
      node.setAttribute(key, String(value));
    });
    return node;
  }

  function htmlEl(tag, attrs = {}) {
    const node = document.createElement(tag);
    Object.entries(attrs).forEach(([key, value]) => {
      if (key === "class") node.className = value;
      else if (key === "html") node.innerHTML = value;
      else if (value !== undefined && value !== null) node.setAttribute(key, String(value));
    });
    return node;
  }

  function escapeText(value) {
    return String(value ?? "").replace(/[&<>"']/g, (ch) => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      "\"": "&quot;",
      "'": "&#39;",
    }[ch]));
  }

  function loopPath(a, b) {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const dist = Math.hypot(dx, dy) || 1;
    const nx = -dy / dist;
    const ny = dx / dist;
    const arc = Math.max(40, dist * 0.45);
    const c1 = { x: a.x + dx * 0.25 + nx * arc, y: a.y + dy * 0.25 + ny * arc };
    const c2 = { x: a.x + dx * 0.75 + nx * arc, y: a.y + dy * 0.75 + ny * arc };
    return `M ${a.x} ${a.y} C ${c1.x} ${c1.y}, ${c2.x} ${c2.y}, ${b.x} ${b.y}`;
  }

  function networkPolarForPoint(point) {
    const dx = (point.x - SKY_CX) / NETWORK_RING_Y_SCALE;
    const dy = point.y - SKY_CY;
    return {
      angle: Math.atan2(-dx, dy),
      radius: Math.hypot(dx, dy),
    };
  }

  function shortestAngleDiff(from, to) {
    return Math.atan2(Math.sin(to - from), Math.cos(to - from));
  }

  function networkRingPoint(angle, radius) {
    return {
      x: SKY_CX - Math.sin(angle) * radius * NETWORK_RING_Y_SCALE,
      y: SKY_CY + Math.cos(angle) * radius,
    };
  }

  function networkEdgePath(a, b, edge) {
    if (edge && edge.isLoop) return loopPath(a, b);
    const pa = networkPolarForPoint(a);
    const pb = networkPolarForPoint(b);
    const diff = shortestAngleDiff(pa.angle, pb.angle);
    const sameRay = Math.abs(diff) < 0.13;
    const minRadius = Math.min(pa.radius, pb.radius);
    const maxRadius = Math.max(pa.radius, pb.radius);
    const sharedWeight = Math.min(Number(edge && (edge.pathCount || edge.count) || 1), 5);
    const side = stableUnit(`network-edge-side:${edge && edge.edgeId}`) > 0.5 ? 1 : -1;
    const curveLift = sameRay
      ? 30 + sharedWeight * 3
      : 42 + Math.abs(diff) * 28 + sharedWeight * 3;
    const sideLift = (18 + stableUnit(`network-edge-lift:${edge && edge.edgeId}`) * 26) * side;
    const c1Radius = Math.max(minRadius + curveLift, pa.radius + (pb.radius - pa.radius) * 0.28 + curveLift * 0.58);
    const c2Radius = Math.max(minRadius + curveLift, pa.radius + (pb.radius - pa.radius) * 0.72 + curveLift * 0.42);
    const c1Angle = pa.angle + diff * 0.32 + sideLift / Math.max(c1Radius, 1);
    const c2Angle = pa.angle + diff * 0.68 + sideLift / Math.max(c2Radius, 1);
    const c1 = networkRingPoint(c1Angle, Math.min(c1Radius, NETWORK_MAX_RADIUS_X - 14));
    const c2 = networkRingPoint(c2Angle, Math.min(c2Radius, NETWORK_MAX_RADIUS_X - 14));
    return `M ${a.x} ${a.y} C ${c1.x} ${c1.y}, ${c2.x} ${c2.y}, ${b.x} ${b.y}`;
  }

  function cross(o, a, b) {
    return (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  }

  function convexHull(points) {
    const sorted = points
      .slice()
      .sort((a, b) => (a.x === b.x ? a.y - b.y : a.x - b.x));
    const unique = sorted.filter((point, index) => {
      const prev = sorted[index - 1];
      return !prev || prev.x !== point.x || prev.y !== point.y;
    });
    if (unique.length < 3) return [];

    const lower = [];
    for (const point of unique) {
      while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], point) <= 0) {
        lower.pop();
      }
      lower.push(point);
    }

    const upper = [];
    for (let i = unique.length - 1; i >= 0; i -= 1) {
      const point = unique[i];
      while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], point) <= 0) {
        upper.pop();
      }
      upper.push(point);
    }

    lower.pop();
    upper.pop();
    return lower.concat(upper);
  }

  function matrix(a = 1, b = 0, c = 0, d = 1, e = 0, f = 0) {
    return { a, b, c, d, e, f };
  }

  function isIdentityMatrix(value) {
    return value.a === 1 && value.b === 0 && value.c === 0 && value.d === 1 && value.e === 0 && value.f === 0;
  }

  function multiplyMatrix(left, right) {
    return matrix(
      left.a * right.a + left.c * right.b,
      left.b * right.a + left.d * right.b,
      left.a * right.c + left.c * right.d,
      left.b * right.c + left.d * right.d,
      left.a * right.e + left.c * right.f + left.e,
      left.b * right.e + left.d * right.f + left.f,
    );
  }

  function invertMatrix(source) {
    const det = source.a * source.d - source.b * source.c;
    if (!det) return matrix();
    return matrix(
      source.d / det,
      -source.b / det,
      -source.c / det,
      source.a / det,
      (source.c * source.f - source.d * source.e) / det,
      (source.b * source.e - source.a * source.f) / det,
    );
  }

  function rotationAround(cx, cy, angle) {
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    return matrix(
      cos,
      sin,
      -sin,
      cos,
      cx - cos * cx + sin * cy,
      cy - sin * cx - cos * cy,
    );
  }

  function interpolateMatrix(from, to, t) {
    return matrix(
      from.a + (to.a - from.a) * t,
      from.b + (to.b - from.b) * t,
      from.c + (to.c - from.c) * t,
      from.d + (to.d - from.d) * t,
      from.e + (to.e - from.e) * t,
      from.f + (to.f - from.f) * t,
    );
  }

  function matrixToSvgTransform(value) {
    return `matrix(${value.a} ${value.b} ${value.c} ${value.d} ${value.e} ${value.f})`;
  }

  function transformPoint(transform, point) {
    return {
      x: transform.a * point.x + transform.c * point.y + transform.e,
      y: transform.b * point.x + transform.d * point.y + transform.f,
    };
  }

  function bboxForPoints(points, minSize = 60) {
    const xs = points.map((point) => point.x);
    const ys = points.map((point) => point.y);
    const minX = xs.length ? Math.min(...xs) : SKY_CX;
    const maxX = xs.length ? Math.max(...xs) : SKY_CX;
    const minY = ys.length ? Math.min(...ys) : SKY_CY;
    const maxY = ys.length ? Math.max(...ys) : SKY_CY;
    return {
      cx: (minX + maxX) / 2,
      cy: (minY + maxY) / 2,
      w: Math.max(maxX - minX, minSize),
      h: Math.max(maxY - minY, minSize),
    };
  }

  function clamp(value, min, max) {
    return Math.min(Math.max(value, min), max);
  }

  function stableHash(value) {
    const text = String(value ?? "");
    let hash = 2166136261;
    for (let i = 0; i < text.length; i += 1) {
      hash ^= text.charCodeAt(i);
      hash = Math.imul(hash, 16777619);
    }
    return hash >>> 0;
  }

  function stableUnit(value) {
    return stableHash(value) / 4294967295;
  }

  function angleDistance(a, b) {
    const diff = Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b)));
    return Number.isFinite(diff) ? diff : Math.PI;
  }

  function angleForPoint(point) {
    return Math.atan2(point.y - SKY_CY, point.x - SKY_CX);
  }

  function sectorIndexForPoint(point, count = VISUAL_SECTOR_COUNT) {
    const angle = angleForPoint(point);
    const normalized = (angle + Math.PI * 2.5) % (Math.PI * 2);
    return Math.floor((normalized / (Math.PI * 2)) * count) % count;
  }

  function easeInOutSine(t) {
    return -(Math.cos(Math.PI * t) - 1) / 2;
  }

  function createSkyRenderer(options) {
    const sky = options.sky;
    const stage = options.stage;
    const tooltip = options.tooltip;
    const infoPanel = options.infoPanel;
    const elements = options.elements || {};

    const state = {
      model: null,
      view: "network",
      mode: "idle",
      selectedPathId: "",
      selectedSceneId: 0,
      hoveredPathId: "",
      focusedLooseSceneId: 0,
      isTransitioning: false,
      focusAnimationFrame: 0,
      orbitAnimationFrame: 0,
      pendingModel: null,
      orbitStartedAt: Date.now(),
      frozenOrbitMatrix: null,
      frozenOrbitElapsed: 0,
      frozenPathMatrices: null,
      currentCameraMatrix: matrix(),
      tweaks: { labels: false, lines: true, loose: true, debug: false },
      motion: {
        amount: MOTION_DEFAULT_AMOUNT,
        speed: MOTION_DEFAULT_SPEED,
        depth: MOTION_DEFAULT_DEPTH,
        scale: MOTION_DEFAULT_SCALE,
        spin: MOTION_DEFAULT_SPIN,
      },
      bb: {
        cameraLayer: null,
        orbitLayer: null,
        groups: new Map(),
        looseGroups: new Map(),
        loosePos: new Map(),
        radialPos: new Map(),
        radialBbox: new Map(),
        pathMotionProfiles: new Map(),
        networkNodeGroups: new Map(),
        networkEdgeGroups: new Map(),
        networkPos: new Map(),
        networkBasePos: new Map(),
        networkClusterSizes: new Map(),
        networkBbox: null,
        labelsLayer: null,
        titleLayer: null,
        debugLayer: null,
      },
    };

    function pathById(pathId) {
      return state.model && state.model.paths.find((pathItem) => pathItem.id === String(pathId));
    }

    function sceneTitle(sceneId) {
      const scene = state.model && state.model.sceneById.get(Number(sceneId));
      return scene ? scene.title : `Scene ${sceneId}`;
    }

    function statusForScene(sceneId) {
      return Data.statusForScene(sceneId, state.model && state.model.runtime);
    }

    function isReleaseLimited() {
      return !!(state.model && state.model.runtime && state.model.runtime.isReleaseLimited);
    }

    function isSceneReleased(sceneId) {
      if (!isReleaseLimited()) return true;
      return state.model.runtime.releasedSceneIds.has(Number(sceneId));
    }

    function edgeIsReleased(edge) {
      return isSceneReleased(edge.fromSceneId) && isSceneReleased(edge.toSceneId);
    }

    function pathHasReleasedScene(pathItem) {
      if (!isReleaseLimited()) return true;
      return (pathItem.nodeIds || []).some((sceneId) => isSceneReleased(sceneId));
    }

    function stopSpin() {
      if (state.orbitAnimationFrame) window.cancelAnimationFrame(state.orbitAnimationFrame);
      state.orbitAnimationFrame = 0;
      if (state.bb.orbitLayer) state.bb.orbitLayer.classList.remove("orbiting");
    }

    function clearPathMotionStyles(group) {
      group.style.removeProperty("--path-opacity");
      group.style.removeProperty("--path-brightness");
    }

    function setIdlePathTransforms() {
      state.bb.groups.forEach((group) => {
        group.removeAttribute("transform");
        clearPathMotionStyles(group);
      });
    }

    function pathMotionProfile(pathId) {
      const key = String(pathId);
      if (state.bb.pathMotionProfiles.has(key)) return state.bb.pathMotionProfiles.get(key);
      const direction = stableUnit(`motion:${key}:direction`) > 0.5 ? 1 : -1;
      const profile = {
        direction,
        period: 180 + stableUnit(`motion:${key}:period`) * 340,
        phase: stableUnit(`motion:${key}:phase`) * Math.PI * 2,
        phase2: stableUnit(`motion:${key}:phase2`) * Math.PI * 2,
        phase3: stableUnit(`motion:${key}:phase3`) * Math.PI * 2,
        xFactor: 0.62 + stableUnit(`motion:${key}:x`) * 0.76,
        yFactor: 0.52 + stableUnit(`motion:${key}:y`) * 0.68,
        depthFactor: 0.55 + stableUnit(`motion:${key}:depth`) * 0.9,
        orbitDirection: stableUnit(`motion:${key}:orbit-direction`) > 0.5 ? 1 : -1,
        orbitPeriod: 180 + stableUnit(`motion:${key}:orbit-period`) * 340,
        orbitPhase: stableUnit(`motion:${key}:orbit-phase`) * Math.PI * 2,
      };
      state.bb.pathMotionProfiles.set(key, profile);
      return profile;
    }

    function pathMotionState(pathId, now = Date.now()) {
      const amount = state.motion.amount;
      if (!state.motion.speed || (!amount && !state.motion.spin)) {
        return { transform: matrix(), opacity: 1, brightness: 1 };
      }
      const profile = pathMotionProfile(pathId);
      const elapsed = ((now - state.orbitStartedAt) / 1000) * state.motion.speed;
      const angle = profile.phase + profile.direction * elapsed * (Math.PI * 2 / profile.period);
      const wobbleX = Math.cos(angle * 0.43 + profile.phase2) * amount * 0.24;
      const wobbleY = Math.sin(angle * 0.37 + profile.phase3) * amount * 0.24;
      const tx = Math.cos(angle) * amount * profile.xFactor + wobbleX;
      const ty = Math.sin(angle) * amount * profile.yFactor + wobbleY;
      const z = Math.sin(angle + profile.phase2);
      const depth = state.motion.depth * profile.depthFactor;
      const scale = 1 + z * state.motion.scale * depth;
      const orbitAngle = state.motion.spin
        ? profile.orbitPhase + profile.orbitDirection * elapsed * (Math.PI * 2 / profile.orbitPeriod) * state.motion.spin
        : 0;
      const localAngle = z * 0.035 * state.motion.depth;
      const cos = Math.cos(localAngle);
      const sin = Math.sin(localAngle);
      const bbox = state.bb.radialBbox.get(String(pathId));
      const cx = bbox ? bbox.cx : SKY_CX;
      const cy = bbox ? bbox.cy : SKY_CY;
      const localMatrix = matrix(
        scale * cos,
        scale * sin,
        -scale * sin,
        scale * cos,
        cx - scale * cos * cx + scale * sin * cy + tx,
        cy - scale * sin * cx - scale * cos * cy + ty,
      );
      const orbitMatrix = orbitAngle ? rotationAround(SKY_CX, SKY_CY, orbitAngle) : matrix();
      return {
        transform: multiplyMatrix(orbitMatrix, localMatrix),
        opacity: clamp(0.62 + (z + 1) * 0.18 * state.motion.depth, 0.52, 1),
        brightness: clamp(0.86 + (z + 1) * 0.12 * state.motion.depth, 0.82, 1.12),
      };
    }

    function currentPathMotionMatrix(pathId) {
      const key = String(pathId);
      if (state.frozenPathMatrices && state.frozenPathMatrices.has(key)) {
        return state.frozenPathMatrices.get(key);
      }
      if (state.mode === "idle" && state.motion.speed && (state.motion.amount || state.motion.spin)) {
        return pathMotionState(key).transform;
      }
      return matrix();
    }

    function applyPathGroupMotion(group, pathId, now = Date.now()) {
      const motion = pathMotionState(pathId, now);
      if (isIdentityMatrix(motion.transform)) group.removeAttribute("transform");
      else group.setAttribute("transform", matrixToSvgTransform(motion.transform));
      group.style.setProperty("--path-opacity", String(Math.round(motion.opacity * 1000) / 1000));
      group.style.setProperty("--path-brightness", String(Math.round(motion.brightness * 1000) / 1000));
    }

    function applyPathGroupMatrix(group, transform) {
      if (isIdentityMatrix(transform)) group.removeAttribute("transform");
      else group.setAttribute("transform", matrixToSvgTransform(transform));
    }

    function applyNetworkMotion(now = Date.now()) {
      if (!state.bb.orbitLayer) return;
      state.bb.orbitLayer.removeAttribute("transform");
      const elapsed = ((now - state.orbitStartedAt) / 1000) * Math.max(state.motion.speed || 1, 0.18);
      const offsets = new Map();

      function nodeOffset(node) {
        const sceneId = Number(node && node.sceneId || 0);
        if (!sceneId) return { x: 0, y: 0 };
        if (offsets.has(sceneId)) return offsets.get(sceneId);
        const depth = Number(node.networkDepth || 0);
        if (depth === 0) {
          const fixedOffset = { x: 0, y: 0 };
          const group = state.bb.networkNodeGroups.get(sceneId);
          if (group) group.__lastNetworkOffset = fixedOffset;
          offsets.set(sceneId, fixedOffset);
          return fixedOffset;
        }
        const degree = Number(node.degree || 0);
        const rootSceneId = Number(node.networkRootSceneId || sceneId);
        const clusterSize = Number(state.bb.networkClusterSizes.get(rootSceneId) || 1);
        const clusterFactor = clamp(1.34 - Math.min(clusterSize, 18) * 0.032, 0.68, 1.18);
        const degreeFactor = clamp(1.16 - Math.min(degree, 14) * 0.025, 0.72, 1.12);
        const depthFactor = clamp(0.72 + depth * 0.2, 0.72, 1.62);
        const baseAmount = 14.5 + (state.motion.amount || 0) * 0.12;
        const minAmplitude = depth === 0 ? 7.5 : 11 + depth * 2.2;
        const amplitude = clamp(baseAmount * clusterFactor * degreeFactor * depthFactor, minAmplitude, 31);
        const rootPhase = stableUnit(`network-breathe-root:${rootSceneId}`) * Math.PI * 2;
        const localPhase = stableUnit(`network-breathe-node:${sceneId}`) * Math.PI * 2;
        const rootDrift = clamp(clusterFactor * 8.5, 5.5, 10.5);
        const group = state.bb.networkNodeGroups.get(sceneId);
        const tendrilPhase = stableUnit(`network-tendril:${sceneId}`) * Math.PI * 2;
        const slowPeriod = 11 + stableUnit(`network-breathe-slow:${sceneId}`) * 16;
        const fastPeriod = 4.8 + stableUnit(`network-breathe-fast:${sceneId}`) * 7;
        const liveOffset = {
          x: Math.cos(elapsed / 15 + rootPhase) * rootDrift
            + Math.cos(elapsed / (7.5 + stableUnit(`network-breathe-x:${sceneId}`) * 7) + localPhase) * amplitude
            + Math.sin(elapsed / slowPeriod + tendrilPhase) * amplitude * 0.68
            + Math.cos(elapsed / fastPeriod + localPhase * 0.7) * amplitude * 0.3,
          y: Math.sin(elapsed / 17 + rootPhase) * rootDrift * 0.74
            + Math.sin(elapsed / (8.5 + stableUnit(`network-breathe-y:${sceneId}`) * 8) + localPhase) * amplitude * 0.72
            + Math.cos(elapsed / (slowPeriod * 1.18) + tendrilPhase) * amplitude * 0.58
            + Math.sin(elapsed / (fastPeriod * 1.24) + localPhase) * amplitude * 0.28,
        };
        let offset = liveOffset;
        if (group && group.__networkHeld && group.__networkHoldOffset) {
          offset = group.__networkHoldOffset;
        } else if (group && group.__networkReleaseOffset && group.__networkReleaseStartedAt) {
          const releaseProgress = clamp((now - Number(group.__networkReleaseStartedAt || 0)) / 650, 0, 1);
          if (releaseProgress >= 1) {
            group.__networkReleaseOffset = null;
            group.__networkReleaseStartedAt = 0;
          } else {
            const eased = easeInOutSine(releaseProgress);
            offset = {
              x: group.__networkReleaseOffset.x + (liveOffset.x - group.__networkReleaseOffset.x) * eased,
              y: group.__networkReleaseOffset.y + (liveOffset.y - group.__networkReleaseOffset.y) * eased,
            };
          }
        }
        if (group) group.__lastNetworkOffset = { x: offset.x, y: offset.y };
        offsets.set(sceneId, offset);
        return offset;
      }

      state.bb.networkNodeGroups.forEach((group) => {
        const offset = nodeOffset(group.__node);
        if (!offset.x && !offset.y) group.removeAttribute("transform");
        else group.setAttribute("transform", `translate(${offset.x} ${offset.y})`);
      });

      state.bb.networkEdgeGroups.forEach((group) => {
        const edge = group.__edge;
        const line = group.__edgeNode;
        const hit = group.__hitNode;
        if (!edge || !line) return;
        const baseA = state.bb.networkBasePos.get(edge.fromSceneId);
        const baseB = state.bb.networkBasePos.get(edge.toSceneId);
        const nodeA = state.model && state.model.networkMap && state.model.networkMap.nodeBySceneId
          ? state.model.networkMap.nodeBySceneId.get(edge.fromSceneId)
          : null;
        const nodeB = state.model && state.model.networkMap && state.model.networkMap.nodeBySceneId
          ? state.model.networkMap.nodeBySceneId.get(edge.toSceneId)
          : null;
        if (!baseA || !baseB) return;
        const offsetA = nodeOffset(nodeA);
        const offsetB = nodeOffset(nodeB);
        const a = { x: baseA.x + offsetA.x, y: baseA.y + offsetA.y };
        const b = { x: baseB.x + offsetB.x, y: baseB.y + offsetB.y };
        if (String(line.tagName || "").toLowerCase() === "path") {
          const d = networkEdgePath(a, b, edge);
          line.setAttribute("d", d);
          if (hit) hit.setAttribute("d", d);
        } else {
          line.setAttribute("x1", a.x);
          line.setAttribute("y1", a.y);
          line.setAttribute("x2", b.x);
          line.setAttribute("y2", b.y);
          if (hit) {
            hit.setAttribute("x1", a.x);
            hit.setAttribute("y1", a.y);
            hit.setAttribute("x2", b.x);
            hit.setAttribute("y2", b.y);
          }
        }
      });
    }

    function startSpin() {
      state.frozenPathMatrices = null;
      if (state.bb.orbitLayer) {
        if (state.view === "network") {
          state.bb.orbitLayer.classList.remove("orbiting");
          state.bb.orbitLayer.removeAttribute("transform");
          if (state.orbitAnimationFrame) window.cancelAnimationFrame(state.orbitAnimationFrame);
          const tick = () => {
            if (!state.bb.orbitLayer || state.view !== "network") {
              state.orbitAnimationFrame = 0;
              return;
            }
            applyNetworkMotion(Date.now());
            updateDebugOverlay();
            state.orbitAnimationFrame = window.requestAnimationFrame(tick);
          };
          tick();
          return;
        }
        if (!IDLE_ORBIT_ENABLED) {
          state.bb.orbitLayer.classList.remove("orbiting");
          state.bb.orbitLayer.removeAttribute("transform");
          setIdlePathTransforms();
          return;
        }
        state.bb.orbitLayer.classList.add("orbiting");
        state.bb.orbitLayer.removeAttribute("transform");
        const tick = () => {
          if (!state.bb.orbitLayer || state.frozenOrbitMatrix) {
            state.orbitAnimationFrame = 0;
            return;
          }
          const now = Date.now();
          if (state.view === "network") applyNetworkMotion(now);
          else {
            state.bb.groups.forEach((group, pathId) => {
              applyPathGroupMotion(group, pathId, now);
            });
          }
          updateDebugOverlay();
          state.orbitAnimationFrame = window.requestAnimationFrame(tick);
        };
        if (state.orbitAnimationFrame) window.cancelAnimationFrame(state.orbitAnimationFrame);
        tick();
      }
    }

    function setCameraTransform(value) {
      state.currentCameraMatrix = value;
      if (!state.bb.cameraLayer) return;
      if (isIdentityMatrix(value)) state.bb.cameraLayer.removeAttribute("transform");
      else state.bb.cameraLayer.setAttribute("transform", matrixToSvgTransform(value));
      updateDebugOverlay();
    }

    function cancelFocusAnimation() {
      if (!state.focusAnimationFrame) return;
      window.cancelAnimationFrame(state.focusAnimationFrame);
      window.clearTimeout(state.focusAnimationFrame);
      state.focusAnimationFrame = 0;
    }

    function clearFloatingLayers() {
      if (state.bb.labelsLayer) {
        state.bb.labelsLayer.innerHTML = "";
        state.bb.labelsLayer.classList.remove("show");
      }
      if (state.bb.titleLayer) {
        state.bb.titleLayer.innerHTML = "";
        state.bb.titleLayer.classList.remove("show");
      }
      if (elements.thumbStrip) {
        elements.thumbStrip.innerHTML = "";
        elements.thumbStrip.classList.remove("show");
      }
    }

    function hideTooltip() {
      tooltip.classList.remove("show");
    }

    function hideFocusHoverLabel() {
      if (!state.bb.labelsLayer) return;
      state.bb.labelsLayer.innerHTML = "";
      state.bb.labelsLayer.classList.remove("show");
    }

    function averagePoint(points) {
      if (!points.length) return null;
      return {
        x: points.reduce((sum, point) => sum + point.x, 0) / points.length,
        y: points.reduce((sum, point) => sum + point.y, 0) / points.length,
      };
    }

    function weightedAveragePoint(samples) {
      const totalWeight = samples.reduce((sum, sample) => sum + sample.weight, 0);
      if (!totalWeight) return null;
      return {
        x: samples.reduce((sum, sample) => sum + sample.x * sample.weight, 0) / totalWeight,
        y: samples.reduce((sum, sample) => sum + sample.y * sample.weight, 0) / totalWeight,
        weight: totalWeight,
      };
    }

    function loadsForSamples(samples, count = VISUAL_SECTOR_COUNT) {
      const loads = Array.from({ length: count }, () => 0);
      samples.forEach((sample) => {
        loads[sectorIndexForPoint(sample, count)] += sample.weight;
      });
      return loads;
    }

    function quadrantLoadsForSamples(samples) {
      const loads = [0, 0, 0, 0];
      samples.forEach((sample) => {
        const dx = sample.x - SKY_CX;
        const dy = sample.y - SKY_CY;
        const index = dx >= 0 && dy < 0 ? 0 : dx < 0 && dy < 0 ? 1 : dx < 0 && dy >= 0 ? 2 : 3;
        loads[index] += sample.weight;
      });
      return loads;
    }

    function loadStats(loads) {
      if (!loads.length) return { avg: 0, max: 0, min: 0, spread: 0, std: 0 };
      const avg = loads.reduce((sum, value) => sum + value, 0) / loads.length;
      const max = Math.max(...loads);
      const min = Math.min(...loads);
      const variance = loads.reduce((sum, value) => sum + Math.pow(value - avg, 2), 0) / loads.length;
      return {
        avg,
        max,
        min,
        spread: max - min,
        std: Math.sqrt(variance),
      };
    }

    function formatNumber(value) {
      return Number.isFinite(value) ? String(Math.round(value * 10) / 10) : "-";
    }

    function formatPoint(point) {
      if (!point) return "-";
      return `x ${formatNumber(point.x)} / y ${formatNumber(point.y)}`;
    }

    function formatOffset(point) {
      if (!point) return "-";
      return `dx ${formatNumber(point.x - SKY_CX)} / dy ${formatNumber(point.y - SKY_CY)}`;
    }

    function setDebugText(key, value) {
      const target = elements[key];
      if (target) target.textContent = value;
    }

    function updateMotionReadouts() {
      if (elements.motionAmountValue) elements.motionAmountValue.textContent = `${Math.round(state.motion.amount)}px`;
      if (elements.motionSpeedValue) elements.motionSpeedValue.textContent = `${Math.round(state.motion.speed * 100)}%`;
      if (elements.motionDepthValue) elements.motionDepthValue.textContent = `${Math.round(state.motion.depth * 100)}%`;
      if (elements.motionScaleValue) elements.motionScaleValue.textContent = `${Math.round(state.motion.scale * 1000) / 10}%`;
      if (elements.motionSpinValue) elements.motionSpinValue.textContent = `${Math.round(state.motion.spin * 100)}%`;
    }

    function syncMotionFromControls() {
      if (elements.motionAmount) state.motion.amount = Number(elements.motionAmount.value || MOTION_DEFAULT_AMOUNT);
      if (elements.motionSpeed) state.motion.speed = Number(elements.motionSpeed.value || 100) / 100;
      if (elements.motionDepth) state.motion.depth = Number(elements.motionDepth.value || 0) / 100;
      if (elements.motionScale) state.motion.scale = Number(elements.motionScale.value || 0) / 100;
      if (elements.motionSpin) state.motion.spin = Number(elements.motionSpin.value || 0) / 100;
      updateMotionReadouts();
      if (state.mode !== "idle") return;
      state.frozenPathMatrices = null;
      const now = Date.now();
      state.bb.groups.forEach((group, pathId) => {
        applyPathGroupMotion(group, pathId, now);
      });
      updateDebugOverlay();
    }

    function wireMotionControls() {
      [
        elements.motionAmount,
        elements.motionSpeed,
        elements.motionDepth,
        elements.motionScale,
        elements.motionSpin,
      ].filter(Boolean).forEach((input) => {
        input.addEventListener("input", syncMotionFromControls);
      });
      updateMotionReadouts();
    }

    function pathNodeWeight(pathItem, sceneId, hasEntry) {
      let weight = hasEntry ? 1 : 0.72;
      if ((pathItem.entrySceneIds || []).includes(sceneId)) weight += 2.4;
      if ((pathItem.endSceneIds || []).includes(sceneId)) weight += 0.55;
      if ((pathItem.isolatedSceneIds || []).includes(sceneId)) weight += 0.38;
      if (state.model && state.model.crossingSceneIds.has(sceneId)) weight += 0.46;
      return weight;
    }

    function crossingLevel(sceneId) {
      if (!state.model || !state.model.crossingSceneIds.has(sceneId)) return 0;
      const level = state.model.crossingLevelBySceneId && state.model.crossingLevelBySceneId.get(Number(sceneId));
      return Math.round(clamp(Number(level) || 1, 1, 3));
    }

    function visualSamplesForPath(pathItem, posByScene, hasEntry = pathHasEntry(pathItem)) {
      const samples = [];
      pathItem.nodeIds.forEach((sceneId) => {
        const point = posByScene.get(sceneId);
        if (!point) return;
        const isEntry = hasEntry && (pathItem.entrySceneIds || []).includes(sceneId);
        samples.push({
          x: point.x,
          y: point.y,
          weight: pathNodeWeight(pathItem, sceneId, hasEntry),
          kind: isEntry ? "entry" : (hasEntry ? "path" : "no-entry"),
        });
      });

      (pathItem.edges || []).forEach((edge) => {
        const from = posByScene.get(edge.fromSceneId);
        const to = posByScene.get(edge.toSceneId);
        if (!from || !to) return;
        const length = Math.hypot(to.x - from.x, to.y - from.y);
        samples.push({
          x: (from.x + to.x) / 2,
          y: (from.y + to.y) / 2,
          weight: 0.2 + Math.min(length, 260) / 260 * 0.24,
          kind: "edge",
        });
      });
      return samples;
    }

    function transformSamples(samples, transform) {
      return samples.map((sample) => ({
        ...sample,
        ...transformPoint(transform, sample),
      }));
    }

    function formatLoadStats(stats) {
      return `max ${formatNumber(stats.max)} / avg ${formatNumber(stats.avg)} / spread ${formatNumber(stats.spread)}`;
    }

    function computeDebugMetrics() {
      const rawPathPoints = [];
      const rawEntryPoints = [];
      const rawVisualSamples = [];
      const rawEntrySamples = [];
      const rawNoEntrySamples = [];
      const orbitMatrix = state.frozenOrbitMatrix || currentOrbitMatrix();
      const cameraMatrix = state.currentCameraMatrix || matrix();
      const visibleBaseMatrix = multiplyMatrix(cameraMatrix, orbitMatrix);
      const visiblePathPoints = [];
      const visibleEntryPoints = [];
      const visibleVisualSamples = [];
      const visibleEntrySamples = [];
      const visibleNoEntrySamples = [];
      const looseSamples = [];

      state.model.paths.forEach((pathItem) => {
        const positions = state.bb.radialPos.get(String(pathItem.id));
        if (!positions) return;
        const visibleMatrix = multiplyMatrix(visibleBaseMatrix, currentPathMotionMatrix(pathItem.id));
        const hasEntry = pathHasEntry(pathItem);
        const samples = visualSamplesForPath(pathItem, positions, hasEntry);
        rawVisualSamples.push(...samples);
        samples.forEach((sample) => {
          if (sample.kind === "entry") rawEntrySamples.push(sample);
          if (sample.kind === "no-entry") rawNoEntrySamples.push(sample);
        });
        const transformedSamples = transformSamples(samples, visibleMatrix);
        visibleVisualSamples.push(...transformedSamples);
        transformedSamples.forEach((sample) => {
          if (sample.kind === "entry") visibleEntrySamples.push(sample);
          if (sample.kind === "no-entry") visibleNoEntrySamples.push(sample);
        });
        positions.forEach((point) => {
          rawPathPoints.push(point);
          visiblePathPoints.push(transformPoint(visibleMatrix, point));
        });
        (pathItem.entrySceneIds || []).forEach((sceneId) => {
          const point = positions.get(sceneId);
          if (point) {
            rawEntryPoints.push(point);
            visibleEntryPoints.push(transformPoint(visibleMatrix, point));
          }
        });
      });

      if (state.model && state.model.looseSceneIds) {
        state.model.looseSceneIds.forEach((sceneId) => {
          const point = state.bb.loosePos.get(Number(sceneId));
          if (!point) return;
          looseSamples.push({
            x: point.x,
            y: point.y,
            weight: 0.85,
            kind: "loose",
          });
        });
      }

      const visibleLooseSamples = transformSamples(looseSamples, cameraMatrix);
      const rawWorldBbox = bboxForPoints(rawPathPoints, 1);
      const visibleWorldBbox = bboxForPoints(visiblePathPoints, 1);
      const rawEntryCenter = averagePoint(rawEntryPoints);
      const rawVisualCenter = weightedAveragePoint(rawVisualSamples);
      const visibleEntryCenter = averagePoint(visibleEntryPoints);
      const visibleVisualCenter = weightedAveragePoint(visibleVisualSamples);
      const visibleNoEntryCenter = weightedAveragePoint(visibleNoEntrySamples);
      const visibleLooseCenter = weightedAveragePoint(visibleLooseSamples);
      const sectorStats = loadStats(loadsForSamples(visibleVisualSamples));
      const quadrantStats = loadStats(quadrantLoadsForSamples(visibleVisualSamples));
      const visibleMaxRadius = visiblePathPoints.reduce((maxRadius, point) => (
        Math.max(maxRadius, Math.hypot(point.x - SKY_CX, point.y - SKY_CY))
      ), 0);
      return {
        canvasCenter: { x: SKY_CX, y: SKY_CY },
        orbitCenter: transformPoint(cameraMatrix, { x: SKY_CX, y: SKY_CY }),
        rawEntryPoints,
        rawEntryCenter,
        rawVisualCenter,
        rawWorldBbox,
        rawWorldCenter: { x: rawWorldBbox.cx, y: rawWorldBbox.cy },
        visibleEntryPoints,
        visibleEntryCenter,
        visibleVisualCenter,
        visibleNoEntryCenter,
        visibleLooseCenter,
        sectorStats,
        quadrantStats,
        visibleWorldBbox,
        visibleWorldCenter: { x: visibleWorldBbox.cx, y: visibleWorldBbox.cy },
        visibleMaxRadius,
        visualBreakdown: {
          entry: visibleEntrySamples.length,
          path: visibleVisualSamples.filter((sample) => sample.kind === "path").length,
          noEntry: visibleNoEntrySamples.length,
          loose: visibleLooseSamples.length,
        },
      };
    }

    function updateDebugPanel(metrics) {
      if (!elements.debugPanel) return;
      elements.debugPanel.hidden = !state.tweaks.debug;
      if (!state.tweaks.debug || !metrics) return;
      setDebugText("debugCanvasCenter", formatPoint(metrics.canvasCenter));
      setDebugText("debugOrbitCenter", `${formatPoint(metrics.orbitCenter)} (${formatOffset(metrics.orbitCenter)})`);
      setDebugText("debugStartCenter", `${formatPoint(metrics.visibleEntryCenter)} (${formatOffset(metrics.visibleEntryCenter)})`);
      setDebugText(
        "debugWorldCenter",
        `${formatPoint(metrics.visibleWorldCenter)} (${formatOffset(metrics.visibleWorldCenter)}) / ${formatNumber(metrics.visibleWorldBbox.w)}x${formatNumber(metrics.visibleWorldBbox.h)}`,
      );
      setDebugText(
        "debugRadius",
        `max ${formatNumber(metrics.visibleMaxRadius)} / cap ${MAX_PATH_RADIUS} / over ${formatNumber(metrics.visibleMaxRadius - MAX_PATH_RADIUS)}`,
      );
      setDebugText(
        "debugVisualCenter",
        `${formatPoint(metrics.visibleVisualCenter)} (${formatOffset(metrics.visibleVisualCenter)})`,
      );
      setDebugText("debugSectorBalance", formatLoadStats(metrics.sectorStats));
      setDebugText(
        "debugBreakdown",
        `entry ${metrics.visualBreakdown.entry} / path ${metrics.visualBreakdown.path} / no-entry ${metrics.visualBreakdown.noEntry} / los ${metrics.visualBreakdown.loose}`,
      );
      setDebugText(
        "debugCamera",
        `scale ${formatNumber(state.currentCameraMatrix.a)} / tx ${formatNumber(state.currentCameraMatrix.e)} / ty ${formatNumber(state.currentCameraMatrix.f)}`,
      );
    }

    function updateDebugOverlay() {
      if (!state.bb.debugLayer) {
        updateDebugPanel(null);
        return;
      }
      const metrics = computeDebugMetrics();
      updateDebugPanel(metrics);
      if (!state.tweaks.debug) return;
      state.bb.debugLayer.innerHTML = "";

      const bbox = metrics.rawWorldBbox;
      state.bb.debugLayer.appendChild(el("rect", {
        x: bbox.cx - bbox.w / 2,
        y: bbox.cy - bbox.h / 2,
        width: bbox.w,
        height: bbox.h,
        class: "debug-world-bbox",
      }));
      metrics.rawEntryPoints.forEach((point) => {
        state.bb.debugLayer.appendChild(el("circle", {
          cx: point.x,
          cy: point.y,
          r: 4.5,
          class: "debug-entry-anchor",
        }));
      });
      state.bb.debugLayer.appendChild(el("circle", {
        cx: metrics.rawWorldCenter.x,
        cy: metrics.rawWorldCenter.y,
        r: 7,
        class: "debug-world-center",
      }));
      if (metrics.rawEntryCenter) {
        state.bb.debugLayer.appendChild(el("circle", {
          cx: metrics.rawEntryCenter.x,
          cy: metrics.rawEntryCenter.y,
          r: 8,
          class: "debug-entry-center",
        }));
      }
      if (metrics.rawVisualCenter) {
        state.bb.debugLayer.appendChild(el("circle", {
          cx: metrics.rawVisualCenter.x,
          cy: metrics.rawVisualCenter.y,
          r: 7,
          class: "debug-visual-center",
        }));
      }
    }

    function drawDebugOverlay(root, orbitLayer) {
      const metrics = computeDebugMetrics();
      updateDebugPanel(metrics);
      if (!state.tweaks.debug) return;
      const screenLayer = el("g", { class: "debug-layer debug-screen-layer" });
      screenLayer.appendChild(el("line", { x1: SKY_CX, y1: 0, x2: SKY_CX, y2: H, class: "debug-axis" }));
      screenLayer.appendChild(el("line", { x1: 0, y1: SKY_CY, x2: W, y2: SKY_CY, class: "debug-axis" }));
      screenLayer.appendChild(el("circle", { cx: SKY_CX, cy: SKY_CY, r: CORE_RADIUS, class: "debug-core-ring" }));
      screenLayer.appendChild(el("circle", { cx: SKY_CX, cy: SKY_CY, r: START_RING_RADIUS, class: "debug-ring" }));
      screenLayer.appendChild(el("circle", { cx: SKY_CX, cy: SKY_CY, r: MAX_PATH_RADIUS, class: "debug-max-ring" }));
      screenLayer.appendChild(el("line", { x1: SKY_CX - 22, y1: SKY_CY, x2: SKY_CX + 22, y2: SKY_CY, class: "debug-cross" }));
      screenLayer.appendChild(el("line", { x1: SKY_CX, y1: SKY_CY - 22, x2: SKY_CX, y2: SKY_CY + 22, class: "debug-cross" }));
      const label = el("text", { x: SKY_CX + 16, y: SKY_CY - 16, class: "debug-label" });
      label.textContent = "canvas/orbit midden";
      screenLayer.appendChild(label);
      root.appendChild(screenLayer);
      state.bb.debugLayer = el("g", { class: "debug-layer debug-world-layer" });
      orbitLayer.appendChild(state.bb.debugLayer);
      updateDebugOverlay();
    }

    function showPathTip(pathItem, event) {
      if (!pathItem) return;
      const active = state.model.runtime.activePathIds.has(pathItem.id);
      tooltip.innerHTML = `
        <div class="hoverHeader">
          <p>Pad</p>
          ${active ? "<strong>actief</strong>" : ""}
        </div>
        <dl class="hoverFacts">
          <div>
            <dt>Naam</dt>
            <dd>${escapeText(pathItem.name)}</dd>
          </div>
          <div>
            <dt>Omvang</dt>
            <dd>${pathItem.nodeIds.length} nodes · ${pathItem.edges.length} verbindingen</dd>
          </div>
        </dl>
      `;
      tooltip.classList.add("show");
    }

    function applyPathHover(pathItem, event) {
      if (!pathItem || state.mode === "focus") return;
      showPathTip(pathItem, event);
      if (state.mode !== "idle") return;
      const nextPathId = String(pathItem.id);
      state.hoveredPathId = nextPathId;
      state.bb.groups.forEach((group, groupPathId) => {
        const isHovered = groupPathId === nextPathId;
        group.classList.toggle("hovered", isHovered);
        group.classList.toggle("hover-dimmed", !isHovered);
      });
    }

    function clearPathHover(pathId = "") {
      if (pathId && state.hoveredPathId && state.hoveredPathId !== String(pathId)) return;
      state.hoveredPathId = "";
      state.bb.groups.forEach((group) => {
        group.classList.remove("hovered", "hover-dimmed");
      });
      hideTooltip();
    }

    function pathHasEntry(pathItem) {
      return Array.isArray(pathItem.entrySceneIds) && pathItem.entrySceneIds.length > 0;
    }

    function pathAnchor(pathItem, hasEntry = pathHasEntry(pathItem)) {
      const entrySceneId = hasEntry
        ? pathItem.entrySceneIds[0]
        : pathItem.nodeIds[0];
      const anchorIndex = Math.max(0, pathItem.nodeIds.indexOf(entrySceneId));
      return {
        entrySceneId,
        anchorIndex,
        anchorShape: pathItem.shape[anchorIndex] || pathItem.shape[0] || [0, 0],
      };
    }

    function pathShapeDeltaAt(pathItem, shapeIndex, anchorShape) {
      const [, y] = pathItem.shape[shapeIndex] || anchorShape;
      return {
        lateral: (y - anchorShape[1]) * LATERAL_SCALE,
      };
    }

    function pathDepthInfo(pathItem, hasEntry = pathHasEntry(pathItem)) {
      const { anchorIndex } = pathAnchor(pathItem, hasEntry);
      const nodeIds = pathItem.nodeIds || [];
      const nodeSet = new Set(nodeIds);
      const roots = (hasEntry ? pathItem.entrySceneIds || [] : [nodeIds[0]])
        .filter((sceneId) => nodeSet.has(sceneId));
      const safeRoots = roots.length ? roots : [nodeIds[anchorIndex]].filter(Boolean);
      const adjacency = new Map();
      nodeIds.forEach((sceneId) => adjacency.set(sceneId, []));
      (pathItem.edges || []).forEach((edge) => {
        if (!adjacency.has(edge.fromSceneId) || !adjacency.has(edge.toSceneId)) return;
        adjacency.get(edge.fromSceneId).push(edge.toSceneId);
        adjacency.get(edge.toSceneId).push(edge.fromSceneId);
      });

      const depthByScene = new Map();
      const queue = [];
      safeRoots.forEach((sceneId) => {
        depthByScene.set(sceneId, 0);
        queue.push(sceneId);
      });
      for (let i = 0; i < queue.length; i += 1) {
        const sceneId = queue[i];
        const nextDepth = (depthByScene.get(sceneId) || 0) + 1;
        (adjacency.get(sceneId) || []).forEach((nextSceneId) => {
          if (depthByScene.has(nextSceneId)) return;
          depthByScene.set(nextSceneId, nextDepth);
          queue.push(nextSceneId);
        });
      }

      nodeIds.forEach((sceneId, index) => {
        if (!depthByScene.has(sceneId)) {
          depthByScene.set(sceneId, Math.abs(index - anchorIndex));
        }
      });
      const depths = Array.from(depthByScene.values());
      return {
        depthByScene,
        maxDepth: Math.max(...depths, 1),
      };
    }

    function startNodeRadius(pathItem, sceneId) {
      const unit = stableUnit(`start-radius:${pathItem.id}:${sceneId}`);
      return START_NODE_MIN_RADIUS + unit * (START_NODE_MAX_RADIUS - START_NODE_MIN_RADIUS);
    }

    function looseScenePosition(sceneId, index, total) {
      const count = Math.max(Number(total) || 1, 7);
      const slotAngle = (index / count) * Math.PI * 2 - Math.PI / 2;
      const angleStep = Math.PI * 2 / count;
      const angleJitter = (stableUnit(`loose-angle:${sceneId}`) - 0.5) * angleStep * 0.38;
      const radius = LOOSE_RING_MIN_RADIUS
        + stableUnit(`loose-radius:${sceneId}`) * (LOOSE_RING_MAX_RADIUS - LOOSE_RING_MIN_RADIUS);
      const angle = slotAngle + angleJitter;
      return {
        x: SKY_CX + Math.cos(angle) * radius,
        y: SKY_CY + Math.sin(angle) * radius,
      };
    }

    function pathReach(pathItem) {
      const { maxDepth } = pathDepthInfo(pathItem);
      return maxDepth * 34;
    }

    function pathVisualWeight(pathItem) {
      const hasEntry = pathHasEntry(pathItem);
      const entryWeight = (pathItem.entrySceneIds || []).length * 2.4;
      const nodeWeight = pathItem.nodeIds.length * (hasEntry ? 1 : 0.62);
      return nodeWeight + pathItem.edges.length * 0.7 + entryWeight + pathReach(pathItem) / 90;
    }

    function nearestAnglePenalty(angles, angle, minDistance) {
      if (!angles.length) return 0;
      const nearest = angles.reduce((min, usedAngle) => Math.min(min, angleDistance(usedAngle, angle)), Math.PI);
      if (nearest >= minDistance) return 0;
      return Math.pow((minDistance - nearest) / minDistance, 2) * 240;
    }

    function candidateAngles(count, slotCount, phaseSeed) {
      const phase = stableUnit(phaseSeed) * (Math.PI * 2 / slotCount);
      return Array.from({ length: slotCount }, (_value, index) => (
        (index / slotCount) * Math.PI * 2 - Math.PI / 2 + phase
      ));
    }

    function densityScore(samples, entrySamples, typeAngles, angle, hasEntry, typeCount, slotIndex) {
      const visualCenter = weightedAveragePoint(samples);
      const entryCenter = weightedAveragePoint(entrySamples);
      const sectorStats = loadStats(loadsForSamples(samples));
      const quadrantStats = loadStats(quadrantLoadsForSamples(samples));
      const visualOffset = visualCenter ? Math.hypot(visualCenter.x - SKY_CX, visualCenter.y - SKY_CY) : 0;
      const entryOffset = entryCenter ? Math.hypot(entryCenter.x - SKY_CX, entryCenter.y - SKY_CY) : 0;
      const minDistance = hasEntry
        ? (Math.PI * 2 / Math.max(typeCount, 1)) * 0.68
        : (Math.PI * 2 / Math.max(typeCount, 1)) * 0.48;
      return visualOffset * 16
        + entryOffset * 23
        + sectorStats.std * 20
        + sectorStats.spread * 5
        + quadrantStats.std * 12
        + nearestAnglePenalty(typeAngles, angle, minDistance)
        + slotIndex * 0.00001;
    }

    function densityBalancedPlacementMap(paths) {
      const entryCount = paths.filter(pathHasEntry).length;
      const noEntryCount = paths.length - entryCount;
      const entrySlotCount = Math.max(entryCount * 2, VISUAL_SECTOR_COUNT * 2, 1);
      const noEntrySlotCount = Math.max(noEntryCount * 3, VISUAL_SECTOR_COUNT * 2, 1);
      const placements = new Map();
      const placedSamples = [];
      const placedEntrySamples = [];
      const usedEntryAngles = [];
      const usedNoEntryAngles = [];

      paths
        .slice()
        .sort((a, b) => {
          const weightDiff = pathVisualWeight(b) - pathVisualWeight(a);
          if (weightDiff) return weightDiff;
          return String(a.id).localeCompare(String(b.id), "nl", { numeric: true });
        })
        .forEach((pathItem) => {
          const hasEntry = pathHasEntry(pathItem);
          const typeCount = hasEntry ? entryCount : noEntryCount;
          const slotCount = hasEntry ? entrySlotCount : noEntrySlotCount;
          const typeAngles = hasEntry ? usedEntryAngles : usedNoEntryAngles;
          const angles = candidateAngles(typeCount, slotCount, `${hasEntry ? "entry" : "no-entry"}:${pathItem.id}`);
          let best = null;
          angles.forEach((angle, slotIndex) => {
            const { map } = springConstellationPositionsFor(pathItem, angle, { hasEntry, preview: true });
            const candidateSamples = visualSamplesForPath(pathItem, map, hasEntry);
            const candidateEntrySamples = candidateSamples.filter((sample) => sample.kind === "entry");
            const score = densityScore(
              placedSamples.concat(candidateSamples),
              placedEntrySamples.concat(candidateEntrySamples),
              typeAngles,
              angle,
              hasEntry,
              typeCount,
              slotIndex,
            );
            if (!best || score < best.score) {
              best = { angle, score, samples: candidateSamples, entrySamples: candidateEntrySamples };
            }
          });
          if (!best) return;
          placedSamples.push(...best.samples);
          placedEntrySamples.push(...best.entrySamples);
          typeAngles.push(best.angle);
          placements.set(pathItem.id, {
            angle: best.angle,
            hasEntry: pathHasEntry(pathItem),
          });
        });
      return placements;
    }

    function springTargetRadius(depth, hasEntry, maxDepth, pathItem) {
      if (!hasEntry) {
        const jitter = (stableUnit(`no-entry:${pathItem.id}:spring-radius`) - 0.5) * 28;
        return clamp(NO_ENTRY_MIN_RADIUS + jitter + depth * 22, NO_ENTRY_MIN_RADIUS - 30, NO_ENTRY_MAX_RADIUS);
      }
      if (depth <= 0) return START_RING_RADIUS;
      const depthCurve = Math.log2(depth + 1) * 34 + depth * 8;
      const longPathAllowance = clamp(maxDepth / 8, 0, 1) * 12;
      return clamp(82 + depthCurve + longPathAllowance, SPRING_PATH_MIN_RADIUS, SPRING_PATH_MAX_RADIUS - 18);
    }

    function edgeSpringLength(edge) {
      if (edge.type === "loop") return SPRING_LOOP_LENGTH;
      if (edge.type === "optional") return SPRING_EDGE_LENGTH + 10;
      return SPRING_EDGE_LENGTH;
    }

    function springEdgesForPath(pathItem, nodeSet) {
      return (pathItem.edges || [])
        .filter((edge) => nodeSet.has(edge.fromSceneId) && nodeSet.has(edge.toSceneId))
        .filter((edge) => edge.fromSceneId !== edge.toSceneId);
    }

    function fixedEntryTargets(pathItem, angle, hasEntry) {
      const fixed = new Map();
      if (!hasEntry) return fixed;
      const entryIds = pathItem.entrySceneIds || [];
      entryIds.forEach((sceneId, entryIndex) => {
        const entryAngle = angle + (entryIndex - (entryIds.length - 1) / 2) * ENTRY_CLUSTER_ANGLE;
        const radius = startNodeRadius(pathItem, sceneId);
        fixed.set(sceneId, {
          x: SKY_CX + Math.cos(entryAngle) * radius,
          y: SKY_CY + Math.sin(entryAngle) * radius,
        });
      });
      return fixed;
    }

    function initialSpringLayout(pathItem, angle, hasEntry, depthInfo) {
      const { anchorShape } = pathAnchor(pathItem, hasEntry);
      const fixed = fixedEntryTargets(pathItem, angle, hasEntry);
      const ux = Math.cos(angle);
      const uy = Math.sin(angle);
      const px = -uy;
      const py = ux;
      const lateralValues = pathItem.nodeIds.map((_sceneId, shapeIndex) => (
        pathShapeDeltaAt(pathItem, shapeIndex, anchorShape).lateral
      ));
      const maxLateral = Math.max(...lateralValues.map((value) => Math.abs(value)), 1);
      const map = new Map();
      const targets = new Map();

      pathItem.nodeIds.forEach((sceneId, shapeIndex) => {
        const fixedPoint = fixed.get(sceneId);
        if (fixedPoint) {
          map.set(sceneId, { ...fixedPoint });
          targets.set(sceneId, { ...fixedPoint });
          return;
        }

        const depth = depthInfo.depthByScene.get(sceneId) ?? shapeIndex;
        const radius = springTargetRadius(depth, hasEntry, depthInfo.maxDepth, pathItem);
        const lateral = (pathShapeDeltaAt(pathItem, shapeIndex, anchorShape).lateral / maxLateral)
          * (hasEntry ? 42 : 34);
        const localJitter = (stableUnit(`spring:${pathItem.id}:${sceneId}:jitter`) - 0.5) * 16;
        const target = {
          x: SKY_CX + ux * radius + px * (lateral + localJitter),
          y: SKY_CY + uy * radius + py * (lateral + localJitter),
        };
        map.set(sceneId, { ...target });
        targets.set(sceneId, target);
      });

      return { map, targets, fixed };
    }

    function applyRadiusBounds(point, hasEntry, isFixed) {
      if (isFixed) return;
      const dx = point.x - SKY_CX;
      const dy = point.y - SKY_CY;
      const radius = Math.hypot(dx, dy) || 1;
      const minRadius = hasEntry ? SPRING_PATH_MIN_RADIUS : NO_ENTRY_MIN_RADIUS - 34;
      const maxRadius = hasEntry ? SPRING_PATH_MAX_RADIUS : NO_ENTRY_MAX_RADIUS;
      const bounded = clamp(radius, minRadius, maxRadius);
      if (bounded === radius) return;
      point.x = SKY_CX + (dx / radius) * bounded;
      point.y = SKY_CY + (dy / radius) * bounded;
    }

    function relaxSpringLayout(pathItem, layout, hasEntry, opts = {}) {
      const nodeIds = pathItem.nodeIds.filter((sceneId) => layout.map.has(sceneId));
      const nodeSet = new Set(nodeIds);
      const edges = springEdgesForPath(pathItem, nodeSet);
      const iterations = opts.preview ? SPRING_PREVIEW_ITERATIONS : SPRING_FINAL_ITERATIONS;
      const edgeStrength = opts.preview ? 0.2 : 0.16;
      const targetStrength = opts.preview ? 0.07 : 0.035;
      const repulsionStrength = opts.preview ? 0.12 : 0.1;

      for (let iteration = 0; iteration < iterations; iteration += 1) {
        edges.forEach((edge) => {
          const from = layout.map.get(edge.fromSceneId);
          const to = layout.map.get(edge.toSceneId);
          if (!from || !to) return;
          const dx = to.x - from.x;
          const dy = to.y - from.y;
          const distance = Math.hypot(dx, dy) || 1;
          const delta = (distance - edgeSpringLength(edge)) * edgeStrength;
          const moveX = (dx / distance) * delta;
          const moveY = (dy / distance) * delta;
          const fromFixed = layout.fixed.has(edge.fromSceneId);
          const toFixed = layout.fixed.has(edge.toSceneId);
          if (!fromFixed && !toFixed) {
            from.x += moveX * 0.5;
            from.y += moveY * 0.5;
            to.x -= moveX * 0.5;
            to.y -= moveY * 0.5;
          } else if (fromFixed && !toFixed) {
            to.x -= moveX;
            to.y -= moveY;
          } else if (!fromFixed && toFixed) {
            from.x += moveX;
            from.y += moveY;
          }
        });

        for (let i = 0; i < nodeIds.length; i += 1) {
          for (let j = i + 1; j < nodeIds.length; j += 1) {
            const aId = nodeIds[i];
            const bId = nodeIds[j];
            const a = layout.map.get(aId);
            const b = layout.map.get(bId);
            if (!a || !b) continue;
            const dx = b.x - a.x;
            const dy = b.y - a.y;
            const distance = Math.hypot(dx, dy) || 1;
            if (distance >= SPRING_NODE_SEPARATION) continue;
            const push = (SPRING_NODE_SEPARATION - distance) * repulsionStrength;
            const pushX = (dx / distance) * push;
            const pushY = (dy / distance) * push;
            const aFixed = layout.fixed.has(aId);
            const bFixed = layout.fixed.has(bId);
            if (!aFixed) {
              a.x -= pushX;
              a.y -= pushY;
            }
            if (!bFixed) {
              b.x += pushX;
              b.y += pushY;
            }
          }
        }

        nodeIds.forEach((sceneId) => {
          if (layout.fixed.has(sceneId)) return;
          const point = layout.map.get(sceneId);
          const target = layout.targets.get(sceneId);
          if (!point || !target) return;
          point.x += (target.x - point.x) * targetStrength;
          point.y += (target.y - point.y) * targetStrength;
          applyRadiusBounds(point, hasEntry, false);
        });
      }

      layout.fixed.forEach((point, sceneId) => {
        layout.map.set(sceneId, { ...point });
      });
      return layout.map;
    }

    function springConstellationPositionsFor(pathItem, angle, opts = {}) {
      const hasEntry = opts.hasEntry !== false && pathHasEntry(pathItem);
      const depthInfo = pathDepthInfo(pathItem, hasEntry);
      const layout = initialSpringLayout(pathItem, angle, hasEntry, depthInfo);
      const map = relaxSpringLayout(pathItem, layout, hasEntry, opts);

      const positions = Array.from(map.values());
      const xs = positions.map((point) => point.x);
      const ys = positions.map((point) => point.y);
      const minX = xs.length ? Math.min(...xs) : SKY_CX;
      const maxX = xs.length ? Math.max(...xs) : SKY_CX;
      const minY = ys.length ? Math.min(...ys) : SKY_CY;
      const maxY = ys.length ? Math.max(...ys) : SKY_CY;
      return {
        map,
        bbox: {
          cx: (minX + maxX) / 2,
          cy: (minY + maxY) / 2,
          w: Math.max(maxX - minX, 60),
          h: Math.max(maxY - minY, 60),
        },
      };
    }

    function cameraMatrixForBbox(bbox) {
      const scale = Math.min(FOCUS_W / bbox.w, FOCUS_H / bbox.h, 7);
      const tx = FOCUS_CX - scale * bbox.cx;
      const ty = FOCUS_CY - scale * bbox.cy;
      return matrix(scale, 0, 0, scale, tx, ty);
    }

    function cameraMatrixForPath(pathId, orbitMatrix = state.frozenOrbitMatrix || currentOrbitMatrix()) {
      const positions = state.bb.radialPos.get(String(pathId));
      if (!positions) return matrix();
      const pathMatrix = currentPathMotionMatrix(pathId);
      const visibleMatrix = multiplyMatrix(orbitMatrix, pathMatrix);
      const points = Array.from(positions.values()).map((point) => transformPoint(visibleMatrix, point));
      return cameraMatrixForBbox(bboxForPoints(points));
    }

    function cameraMatrixForLooseScene(sceneId) {
      const pos = state.bb.loosePos.get(Number(sceneId));
      if (!pos) return matrix();
      return matrix(
        LOOSE_FOCUS_SCALE,
        0,
        0,
        LOOSE_FOCUS_SCALE,
        FOCUS_CX - LOOSE_FOCUS_SCALE * pos.x,
        FOCUS_CY - LOOSE_FOCUS_SCALE * pos.y,
      );
    }

    function currentOrbitMatrix() {
      return matrix();
    }

    function freezeOrbitAtCurrentAngle() {
      if (!state.bb.orbitLayer) return state.frozenOrbitMatrix || matrix();
      if (state.frozenOrbitMatrix) {
        state.bb.orbitLayer.classList.remove("orbiting");
        state.bb.orbitLayer.setAttribute("transform", matrixToSvgTransform(state.frozenOrbitMatrix));
        return state.frozenOrbitMatrix;
      }
      const elapsed = (Date.now() - state.orbitStartedAt) % ORBIT_DURATION_MS;
      const orbitMatrix = currentOrbitMatrix();
      state.frozenOrbitMatrix = orbitMatrix;
      state.frozenOrbitElapsed = elapsed;
      state.frozenPathMatrices = new Map();
      const now = Date.now();
      state.bb.groups.forEach((group, pathId) => {
        const motion = pathMotionState(pathId, now);
        state.frozenPathMatrices.set(String(pathId), motion.transform);
        applyPathGroupMatrix(group, motion.transform);
        group.style.setProperty("--path-opacity", String(Math.round(motion.opacity * 1000) / 1000));
        group.style.setProperty("--path-brightness", String(Math.round(motion.brightness * 1000) / 1000));
      });
      stopSpin();
      if (isIdentityMatrix(orbitMatrix)) state.bb.orbitLayer.removeAttribute("transform");
      else state.bb.orbitLayer.setAttribute("transform", matrixToSvgTransform(orbitMatrix));
      return orbitMatrix;
    }

    function edgeNode(pathItem, sceneId) {
      if (!pathItem || !pathItem.nodeBySceneId) return null;
      return pathItem.nodeBySceneId.get(Number(sceneId)) || null;
    }

    function edgeIsTerminalLine(edge, pathItem) {
      const fromNode = edgeNode(pathItem, edge.fromSceneId);
      const toNode = edgeNode(pathItem, edge.toSceneId);
      const isLoop = edge.type === "loop" || Number(edge.fromSceneId) === Number(edge.toSceneId);
      const toContinues = Number(toNode && toNode.outgoingCount || 0) > 0;
      const fromBranches = Number(fromNode && fromNode.outgoingCount || 0) > 1;
      const toMerges = Number(toNode && toNode.incomingCount || 0) > 1;
      return !isLoop && !toContinues && !fromBranches && !toMerges;
    }

    function edgeClass(edge, pathItem) {
      const runtime = state.model.runtime;
      const fromStatus = statusForScene(edge.fromSceneId);
      const toStatus = statusForScene(edge.toSceneId);
      const classes = ["conn", "path-line", edge.type || "required"];
      classes.push(edgeIsTerminalLine(edge, pathItem) ? "terminal-line" : "constellation-line");
      classes.push(edgeIsReleased(edge) ? "released-edge" : "unreleased-edge");
      if (runtime.activePathIds.has(pathItem.id)) classes.push("runtime-active");
      if (fromStatus === "played" && toStatus === "played") classes.push("played");
      if (fromStatus === "current" || toStatus === "current") classes.push("current-edge");
      return classes.join(" ");
    }

    function networkNodeRadius(node) {
      const degreeBoost = Math.min(Number(node.degree || 0), 12) * 0.26;
      const crossingBoost = node.isCrossingNode ? Math.min(Number(node.membershipCount || 0), 5) * 0.34 : 0;
      const entryBoost = Number(node.networkDepth || 0) === 0 ? 0.95 : 0;
      return clamp(2.6 + degreeBoost + crossingBoost + entryBoost, 2.8, 7.8);
    }

    function networkNodePathSet(node) {
      return new Set((Array.isArray(node.pathIds) ? node.pathIds : [])
        .map((pathId) => Number(pathId || 0))
        .filter(Boolean));
    }

    function sharedSetCount(a, b) {
      let count = 0;
      a.forEach((value) => {
        if (b.has(value)) count += 1;
      });
      return count;
    }

    function parseNetworkDirection(value) {
      const match = String(value || "").match(/^(\d+)->(\d+)$/);
      if (!match) return null;
      return {
        fromSceneId: Number(match[1] || 0),
        toSceneId: Number(match[2] || 0),
      };
    }

    function sortedNetworkRoots(nodes) {
      const roots = nodes.filter((node) => Number(node.inDegree || 0) === 0 && Number(node.outDegree || 0) > 0);
      const fallbackRoots = nodes.filter((node) => node.isEntryNode && Number(node.degree || 0) > 0);
      const safeRoots = roots.length ? roots : (fallbackRoots.length ? fallbackRoots : nodes
        .slice()
        .sort((a, b) => Number(b.degree || 0) - Number(a.degree || 0))
        .slice(0, Math.min(nodes.length, 8)));
      return safeRoots.slice().sort((a, b) => {
        if (Number(a.sortOrder || 0) !== Number(b.sortOrder || 0)) return Number(a.sortOrder || 0) - Number(b.sortOrder || 0);
        return Number(a.sceneId || 0) - Number(b.sceneId || 0);
      });
    }

    function buildNetworkAdjacency(nodes, edges) {
      const directed = new Map(nodes.map((node) => [Number(node.sceneId || 0), []]));
      const undirected = new Map(nodes.map((node) => [Number(node.sceneId || 0), []]));
      const nodeIds = new Set(nodes.map((node) => Number(node.sceneId || 0)).filter(Boolean));
      edges.forEach((edge) => {
        if (!edge || edge.isLoop) return;
        const fromSceneId = Number(edge.fromSceneId || 0);
        const toSceneId = Number(edge.toSceneId || 0);
        if (!nodeIds.has(fromSceneId) || !nodeIds.has(toSceneId)) return;
        if (!undirected.has(fromSceneId)) undirected.set(fromSceneId, []);
        if (!undirected.has(toSceneId)) undirected.set(toSceneId, []);
        undirected.get(fromSceneId).push({ sceneId: toSceneId, edge });
        undirected.get(toSceneId).push({ sceneId: fromSceneId, edge });
        const directions = Array.isArray(edge.directions) && edge.directions.length
          ? edge.directions
          : [`${fromSceneId}->${toSceneId}`];
        directions.forEach((directionValue) => {
          const direction = parseNetworkDirection(directionValue);
          if (!direction || !nodeIds.has(direction.fromSceneId) || !nodeIds.has(direction.toSceneId)) return;
          if (!directed.has(direction.fromSceneId)) directed.set(direction.fromSceneId, []);
          directed.get(direction.fromSceneId).push({ sceneId: direction.toSceneId, edge });
        });
      });
      return { directed, undirected };
    }

    function networkDepthInfo(nodes, edges) {
      const roots = sortedNetworkRoots(nodes);
      const nodeBySceneId = new Map(nodes.map((node) => [Number(node.sceneId || 0), node]));
      const { directed, undirected } = buildNetworkAdjacency(nodes, edges);
      const depthBySceneId = new Map();
      const rootBySceneId = new Map();
      const scoreBySceneId = new Map();
      const rootMetaBySceneId = new Map();
      const queue = [];

      roots.forEach((root, index) => {
        const rootSceneId = Number(root.sceneId || 0);
        const angle = (index / Math.max(roots.length, 1)) * Math.PI * 2 - Math.PI / 2 + NETWORK_ORIENTATION_OFFSET;
        rootMetaBySceneId.set(rootSceneId, {
          index,
          sceneId: rootSceneId,
          angle,
          node: root,
          pathSet: networkNodePathSet(root),
        });
        depthBySceneId.set(rootSceneId, 0);
        rootBySceneId.set(rootSceneId, rootSceneId);
        scoreBySceneId.set(rootSceneId, 999);
        queue.push(rootSceneId);
      });

      function candidateScore(rootSceneId, nextNode, edge) {
        const rootMeta = rootMetaBySceneId.get(rootSceneId);
        if (!rootMeta || !nextNode) return 0;
        const nodePathSet = networkNodePathSet(nextNode);
        const edgePathSet = new Set((Array.isArray(edge && edge.pathIds) ? edge.pathIds : [])
          .map((pathId) => Number(pathId || 0))
          .filter(Boolean));
        return sharedSetCount(rootMeta.pathSet, nodePathSet) * 3
          + sharedSetCount(rootMeta.pathSet, edgePathSet) * 2
          + (nextNode.isCrossingNode ? 0.5 : 0);
      }

      function visit(adjacency, seedQueue) {
        for (let cursor = 0; cursor < seedQueue.length; cursor += 1) {
          const sceneId = seedQueue[cursor];
          const currentDepth = depthBySceneId.get(sceneId) || 0;
          const rootSceneId = rootBySceneId.get(sceneId) || sceneId;
          for (const link of adjacency.get(sceneId) || []) {
            const nextSceneId = Number(link.sceneId || 0);
            const nextNode = nodeBySceneId.get(nextSceneId);
            if (!nextNode) continue;
            const nextDepth = currentDepth + 1;
            const nextScore = candidateScore(rootSceneId, nextNode, link.edge);
            const knownDepth = depthBySceneId.has(nextSceneId) ? depthBySceneId.get(nextSceneId) : Infinity;
            const knownScore = scoreBySceneId.get(nextSceneId) || -Infinity;
            if (nextDepth < knownDepth || (nextDepth === knownDepth && nextScore > knownScore)) {
              depthBySceneId.set(nextSceneId, nextDepth);
              rootBySceneId.set(nextSceneId, rootSceneId);
              scoreBySceneId.set(nextSceneId, nextScore);
              seedQueue.push(nextSceneId);
            }
          }
        }
      }

      visit(directed, queue.slice());
      visit(undirected, Array.from(depthBySceneId.keys()));

      const maxConnectedDepth = Array.from(depthBySceneId.values()).reduce((max, depth) => Math.max(max, depth), 0);
      nodes.forEach((node) => {
        const sceneId = Number(node.sceneId || 0);
        if (depthBySceneId.has(sceneId)) return;
        const fallbackRoot = roots.length
          ? roots[Math.floor(stableUnit(`network-fallback-root:${sceneId}`) * roots.length) % roots.length]
          : node;
        const rootSceneId = Number(fallbackRoot && fallbackRoot.sceneId || sceneId);
        depthBySceneId.set(sceneId, maxConnectedDepth + 1);
        rootBySceneId.set(sceneId, rootSceneId);
        scoreBySceneId.set(sceneId, 0);
      });

      const parentBySceneId = new Map();
      const parentScoreBySceneId = new Map();
      roots.forEach((root) => {
        const rootSceneId = Number(root.sceneId || 0);
        parentBySceneId.set(rootSceneId, rootSceneId);
        parentScoreBySceneId.set(rootSceneId, Infinity);
      });

      function edgePathSet(edge) {
        return new Set((Array.isArray(edge && edge.pathIds) ? edge.pathIds : [])
          .map((pathId) => Number(pathId || 0))
          .filter(Boolean));
      }

      function considerParent(fromSceneId, toSceneId, edge, directedWeight = 0) {
        const fromNode = nodeBySceneId.get(Number(fromSceneId || 0));
        const toNode = nodeBySceneId.get(Number(toSceneId || 0));
        if (!fromNode || !toNode) return;
        const fromDepth = depthBySceneId.get(fromNode.sceneId);
        const toDepth = depthBySceneId.get(toNode.sceneId);
        if (!Number.isFinite(fromDepth) || !Number.isFinite(toDepth) || toDepth !== fromDepth + 1) return;
        const toRoot = rootBySceneId.get(toNode.sceneId) || toNode.sceneId;
        const fromRoot = rootBySceneId.get(fromNode.sceneId) || fromNode.sceneId;
        if (toRoot !== fromRoot) return;
        const nodePathSet = networkNodePathSet(toNode);
        const parentPathSet = networkNodePathSet(fromNode);
        const score = directedWeight
          + sharedSetCount(parentPathSet, nodePathSet) * 5
          + sharedSetCount(edgePathSet(edge), nodePathSet) * 3
          + Math.min(Number(edge && (edge.pathCount || edge.count) || 1), 5)
          + Math.min(Number(fromNode.degree || 0), 12) * 0.12;
        const knownScore = parentScoreBySceneId.get(toNode.sceneId) || -Infinity;
        if (score > knownScore) {
          parentBySceneId.set(toNode.sceneId, fromNode.sceneId);
          parentScoreBySceneId.set(toNode.sceneId, score);
        }
      }

      edges.forEach((edge) => {
        const fromSceneId = Number(edge.fromSceneId || 0);
        const toSceneId = Number(edge.toSceneId || 0);
        const directions = Array.isArray(edge.directions) && edge.directions.length
          ? edge.directions
          : [`${fromSceneId}->${toSceneId}`];
        directions.forEach((directionValue) => {
          const direction = parseNetworkDirection(directionValue);
          if (!direction) return;
          considerParent(direction.fromSceneId, direction.toSceneId, edge, 6);
        });
        considerParent(fromSceneId, toSceneId, edge, 1);
        considerParent(toSceneId, fromSceneId, edge, 1);
      });

      nodes.forEach((node) => {
        const sceneId = Number(node.sceneId || 0);
        if (!sceneId || parentBySceneId.has(sceneId)) return;
        parentBySceneId.set(sceneId, rootBySceneId.get(sceneId) || sceneId);
      });

      const groupMetaBySceneId = new Map();
      const angleBySceneId = new Map();
      roots.forEach((root) => {
        const rootSceneId = Number(root.sceneId || 0);
        const rootMeta = rootMetaBySceneId.get(rootSceneId);
        if (rootMeta) angleBySceneId.set(rootSceneId, rootMeta.angle);
      });

      for (let depth = 1; depth <= Array.from(depthBySceneId.values()).reduce((max, value) => Math.max(max, value), 0); depth += 1) {
        const grouped = new Map();
        nodes.forEach((node) => {
          const sceneId = Number(node.sceneId || 0);
          if ((depthBySceneId.get(sceneId) || 0) !== depth) return;
          const rootSceneId = rootBySceneId.get(sceneId) || sceneId;
          const parentSceneId = parentBySceneId.get(sceneId) || rootSceneId;
          const key = `${rootSceneId}:${depth}:${parentSceneId}`;
          if (!grouped.has(key)) grouped.set(key, []);
          grouped.get(key).push(node);
        });
        grouped.forEach((items, key) => {
          const [, depthText, parentText] = key.split(":");
          const groupDepth = Number(depthText || depth);
          const parentSceneId = Number(parentText || 0);
          const parentNode = nodeBySceneId.get(parentSceneId);
          const rootSceneId = rootBySceneId.get(Number(items[0] && items[0].sceneId || 0)) || Number(items[0] && items[0].sceneId || 0);
          const rootMeta = rootMetaBySceneId.get(rootSceneId);
          const parentAngle = angleBySceneId.get(parentSceneId) ?? (rootMeta ? rootMeta.angle : -Math.PI / 2);
          items.sort((a, b) => {
            const aShared = parentNode ? sharedSetCount(networkNodePathSet(parentNode), networkNodePathSet(a)) : 0;
            const bShared = parentNode ? sharedSetCount(networkNodePathSet(parentNode), networkNodePathSet(b)) : 0;
            if (bShared !== aShared) return bShared - aShared;
            if (Number(b.degree || 0) !== Number(a.degree || 0)) return Number(b.degree || 0) - Number(a.degree || 0);
            if (Number(b.membershipCount || 0) !== Number(a.membershipCount || 0)) return Number(b.membershipCount || 0) - Number(a.membershipCount || 0);
            if (Number(a.sortOrder || 0) !== Number(b.sortOrder || 0)) return Number(a.sortOrder || 0) - Number(b.sortOrder || 0);
            return Number(a.sceneId || 0) - Number(b.sceneId || 0);
          });
          const cloudRadius = clamp(18 + Math.sqrt(items.length) * 10 + groupDepth * 4, 26, groupDepth === 1 ? 48 : 78);
          const baseRadius = Math.min(NETWORK_ROOT_RADIUS + groupDepth * NETWORK_DEPTH_GAP, NETWORK_MAX_RADIUS_X - 42);
          items.forEach((node, index) => {
            const sceneId = Number(node.sceneId || 0);
            const localAngle = index * NETWORK_GOLDEN_ANGLE + stableUnit(`network-cloud-angle:${sceneId}`) * 0.42;
            const localRadius = items.length <= 1
              ? 0
              : cloudRadius * Math.sqrt((index + 0.5) / items.length);
            const tangentOffset = Math.cos(localAngle) * localRadius * 1.45;
            const radialOffset = Math.sin(localAngle) * localRadius * 1.05;
            const approximateAngle = parentAngle + tangentOffset / Math.max(baseRadius, 1);
            groupMetaBySceneId.set(sceneId, {
              index,
              count: items.length,
              parentSceneId,
              centerAngle: parentAngle,
              radialOffset,
              tangentOffset,
              band: Math.max(28, cloudRadius * 1.25),
            });
            angleBySceneId.set(sceneId, approximateAngle);
          });
        });
      }

      return {
        roots,
        depthBySceneId,
        rootBySceneId,
        rootMetaBySceneId,
        parentBySceneId,
        groupMetaBySceneId,
        maxDepth: Array.from(depthBySceneId.values()).reduce((max, depth) => Math.max(max, depth), 0),
      };
    }

    function networkTargetForNode(node, depthInfo) {
      const sceneId = Number(node.sceneId || 0);
      const depth = depthInfo.depthBySceneId.get(sceneId) || 0;
      const rootSceneId = depthInfo.rootBySceneId.get(sceneId) || sceneId;
      const rootMeta = depthInfo.rootMetaBySceneId.get(rootSceneId);
      const rootIndex = rootMeta ? rootMeta.index : 0;
      const rootAngle = rootMeta ? rootMeta.angle : stableUnit(`network-root-angle:${sceneId}`) * Math.PI * 2 - Math.PI / 2;
      node.networkDepth = depth;
      node.networkRootSceneId = rootSceneId;

      if (depth === 0) {
        const angle = rootMeta
          ? rootMeta.angle
          : (rootIndex / Math.max(depthInfo.roots.length, 1)) * Math.PI * 2 - Math.PI / 2 + NETWORK_ORIENTATION_OFFSET;
        const radius = NETWORK_ROOT_RADIUS;
        const point = networkRingPoint(angle, radius);
        node.isNetworkRoot = true;
        return {
          x: point.x,
          y: point.y,
          radius,
          angle,
          strength: 0.58,
        };
      }

      node.isNetworkRoot = false;
      const groupMeta = depthInfo.groupMetaBySceneId.get(sceneId) || {
        centerAngle: rootAngle,
        radialOffset: 0,
        tangentOffset: 0,
        band: 18,
      };
      const baseRadius = Math.min(NETWORK_ROOT_RADIUS + depth * NETWORK_DEPTH_GAP, NETWORK_MAX_RADIUS_X - 42);
      const radius = baseRadius + Number(groupMeta.radialOffset || 0);
      const centerAngle = Number.isFinite(groupMeta.centerAngle) ? groupMeta.centerAngle : rootAngle;
      const basePoint = networkRingPoint(centerAngle, radius);
      const tangentOffset = Number(groupMeta.tangentOffset || 0);
      const point = {
        x: basePoint.x - Math.cos(centerAngle) * NETWORK_RING_Y_SCALE * tangentOffset,
        y: basePoint.y - Math.sin(centerAngle) * tangentOffset,
      };
      const polar = networkPolarForPoint(point);
      return {
        x: point.x,
        y: point.y,
        radius: polar.radius,
        baseRadius,
        angle: polar.angle,
        band: Number(groupMeta.band || 18),
        strength: 0.24,
      };
    }

    function networkLayout(networkMap) {
      const nodes = (networkMap && Array.isArray(networkMap.nodes) ? networkMap.nodes : []).slice();
      const edges = (networkMap && Array.isArray(networkMap.edges) ? networkMap.edges : [])
        .filter((edge) => edge && !edge.isLoop);
      const depthInfo = networkDepthInfo(nodes, edges);
      const sim = new Map();

      nodes.forEach((node) => {
        const target = networkTargetForNode(node, depthInfo);
        const angleJitter = Number(node.networkDepth || 0) === 0
          ? 0
          : (stableUnit(`network-jitter-angle:${node.sceneId}`) - 0.5) * 0.035;
        const start = networkRingPoint(target.angle + angleJitter, target.radius);
        sim.set(node.sceneId, {
          node,
          target,
          x: start.x,
          y: start.y,
        });
      });

      for (let iteration = 0; iteration < NETWORK_ITERATIONS; iteration += 1) {
        for (let i = 0; i < nodes.length; i += 1) {
          const a = sim.get(nodes[i].sceneId);
          if (!a) continue;
          for (let j = i + 1; j < nodes.length; j += 1) {
            const b = sim.get(nodes[j].sceneId);
            if (!b) continue;
            const dx = b.x - a.x;
            const dy = b.y - a.y;
            const distance = Math.hypot(dx, dy) || 1;
            const sameRoot = Number(a.node.networkRootSceneId || 0) === Number(b.node.networkRootSceneId || 0);
            const sameDepth = Number(a.node.networkDepth || 0) === Number(b.node.networkDepth || 0);
            const minDistance = NETWORK_NODE_SEPARATION
              + networkNodeRadius(a.node)
              + networkNodeRadius(b.node)
              + (sameRoot ? 7 : 13)
              + (sameDepth ? 9 : 0);
            const force = Math.min((minDistance * minDistance) / (distance * distance), 3.4) * (sameRoot ? 0.42 : 0.55);
            const pushX = (dx / distance) * force;
            const pushY = (dy / distance) * force;
            a.x -= pushX;
            a.y -= pushY;
            b.x += pushX;
            b.y += pushY;
          }
        }

        edges.forEach((edge) => {
          const a = sim.get(edge.fromSceneId);
          const b = sim.get(edge.toSceneId);
          if (!a || !b) return;
          const dx = b.x - a.x;
          const dy = b.y - a.y;
          const distance = Math.hypot(dx, dy) || 1;
          const pathWeight = Math.min(Number(edge.pathCount || edge.count || 1), 4);
          const sameRoot = Number(a.node.networkRootSceneId || 0) === Number(b.node.networkRootSceneId || 0);
          const depthDiff = Math.abs(Number(a.node.networkDepth || 0) - Number(b.node.networkDepth || 0));
          const desired = sameRoot
            ? NETWORK_EDGE_LENGTH + depthDiff * 22 + Math.max(0, 4 - pathWeight) * 7
            : NETWORK_EDGE_LENGTH + 118 + depthDiff * 18;
          const delta = (distance - desired) * (sameRoot ? 0.009 : 0.004) * (1 + pathWeight * 0.1);
          const moveX = (dx / distance) * delta;
          const moveY = (dy / distance) * delta;
          a.x += moveX * 0.5;
          a.y += moveY * 0.5;
          b.x -= moveX * 0.5;
          b.y -= moveY * 0.5;
        });

        sim.forEach((item) => {
          if (Number(item.node.networkDepth || 0) === 0) {
            item.x = item.target.x;
            item.y = item.target.y;
            return;
          }
          item.x += (item.target.x - item.x) * item.target.strength;
          item.y += (item.target.y - item.y) * item.target.strength;
          const polar = networkPolarForPoint(item);
          const baseRadius = Number(item.target.baseRadius || item.target.radius || polar.radius);
          const band = Number(item.target.band || 18);
          const clampedRadius = clamp(polar.radius, baseRadius - band, baseRadius + band);
          if (Math.abs(clampedRadius - polar.radius) > 0.01) {
            const projected = networkRingPoint(polar.angle, clampedRadius);
            item.x = projected.x;
            item.y = projected.y;
          }
        });
      }

      const pos = new Map();
      sim.forEach((item, sceneId) => {
        pos.set(sceneId, { x: item.x, y: item.y });
      });
      return {
        pos,
        bbox: bboxForPoints(Array.from(pos.values()), 80),
      };
    }

    function networkEdgeClass(edge) {
      const fromStatus = statusForScene(edge.fromSceneId);
      const toStatus = statusForScene(edge.toSceneId);
      const classes = ["network-edge", edge.isMultiPath ? "multi-path" : "", edgeIsReleased(edge) ? "released-edge" : "unreleased-edge"];
      if (fromStatus === "current" || toStatus === "current") classes.push("current-edge");
      if (fromStatus || toStatus) classes.push("runtime-edge");
      return classes.filter(Boolean).join(" ");
    }

    function showNetworkNodeTip(node, event) {
      if (!node) return;
      const status = statusForScene(node.sceneId);
      const paths = (node.pathNames || []).slice(0, 5).join(", ");
      tooltip.innerHTML = `
        <div class="hoverHeader">
          <p>Scene</p>
          ${status ? `<strong>${escapeText(Data.labelForStatus(status))}</strong>` : ""}
        </div>
        <dl class="hoverFacts">
          <div>
            <dt>Naam</dt>
            <dd>${escapeText(node.title)}</dd>
          </div>
          <div>
            <dt>Netwerk</dt>
            <dd>${Number(node.degree || 0)} verbindingen · ${Number(node.membershipCount || 0)} paden</dd>
          </div>
          ${paths ? `<div><dt>Paden</dt><dd>${escapeText(paths)}${(node.pathNames || []).length > 5 ? " ..." : ""}</dd></div>` : ""}
        </dl>
      `;
      tooltip.classList.add("show");
    }

    function showNetworkEdgeTip(edge, event) {
      if (!edge) return;
      const paths = (edge.pathNames || []).slice(0, 6).join(", ");
      tooltip.innerHTML = `
        <div class="hoverHeader">
          <p>Verbinding</p>
          ${edge.isMultiPath ? "<strong>gedeeld</strong>" : ""}
        </div>
        <dl class="hoverFacts">
          <div>
            <dt>Scenes</dt>
            <dd>${escapeText(edge.fromTitle)} -> ${escapeText(edge.toTitle)}</dd>
          </div>
          <div>
            <dt>Paden</dt>
            <dd>${escapeText(paths || "geen padnaam")}${(edge.pathNames || []).length > 6 ? " ..." : ""}</dd>
          </div>
        </dl>
      `;
      tooltip.classList.add("show");
    }

    function applyNetworkNodeHover(node, event) {
      if (!node) return;
      showNetworkNodeTip(node, event);
      const sceneId = Number(node.sceneId || 0);
      const linked = new Set([sceneId]);
      (state.model.networkMap.edges || []).forEach((edge) => {
        if (edge.fromSceneId === sceneId) linked.add(edge.toSceneId);
        if (edge.toSceneId === sceneId) linked.add(edge.fromSceneId);
      });
      state.bb.networkNodeGroups.forEach((group, groupSceneId) => {
        const isLinked = linked.has(Number(groupSceneId));
        const isHovered = Number(groupSceneId) === sceneId;
        if (isHovered && !group.__networkHeld) {
          const lastOffset = group.__lastNetworkOffset || { x: 0, y: 0 };
          group.__networkHeld = true;
          group.__networkHoldOffset = { x: lastOffset.x, y: lastOffset.y };
          group.__networkReleaseOffset = null;
          group.__networkReleaseStartedAt = 0;
        }
        if (!isHovered && group.__networkHeld) {
          group.__networkHeld = false;
          group.__networkReleaseOffset = group.__networkHoldOffset || group.__lastNetworkOffset || { x: 0, y: 0 };
          group.__networkReleaseStartedAt = Date.now();
          group.__networkHoldOffset = null;
        }
        group.classList.toggle("hovered", isHovered);
        group.classList.toggle("network-dimmed", !isLinked);
      });
      state.bb.networkEdgeGroups.forEach((group, key) => {
        const edge = group.__edge;
        const isLinked = !!edge && (edge.fromSceneId === sceneId || edge.toSceneId === sceneId);
        group.classList.toggle("hovered", isLinked);
        group.classList.toggle("network-dimmed", !isLinked);
      });
    }

    function clearNetworkHover() {
      state.bb.networkNodeGroups.forEach((group) => {
        if (group.__networkHeld) {
          group.__networkHeld = false;
          group.__networkReleaseOffset = group.__networkHoldOffset || group.__lastNetworkOffset || { x: 0, y: 0 };
          group.__networkReleaseStartedAt = Date.now();
          group.__networkHoldOffset = null;
        }
        group.classList.remove("hovered", "network-dimmed");
      });
      state.bb.networkEdgeGroups.forEach((group) => group.classList.remove("hovered", "network-dimmed"));
      hideTooltip();
    }

    function bindNetworkNodeEvents(target, visibleStar, node) {
      target.addEventListener("mouseenter", (event) => {
        visibleStar.classList.add("hovered");
        applyNetworkNodeHover(node, event);
      });
      target.addEventListener("mousemove", (event) => applyNetworkNodeHover(node, event));
      target.addEventListener("mouseleave", () => {
        visibleStar.classList.remove("hovered");
        clearNetworkHover();
      });
    }

    function bindNetworkEdgeEvents(target, edge) {
      target.addEventListener("mouseenter", (event) => {
        showNetworkEdgeTip(edge, event);
        state.bb.networkEdgeGroups.forEach((group) => {
          group.classList.toggle("hovered", group.__edge === edge);
          group.classList.toggle("network-dimmed", group.__edge !== edge);
        });
        state.bb.networkNodeGroups.forEach((group, sceneId) => {
          const linked = Number(sceneId) === edge.fromSceneId || Number(sceneId) === edge.toSceneId;
          group.classList.toggle("network-dimmed", !linked);
        });
      });
      target.addEventListener("mousemove", (event) => showNetworkEdgeTip(edge, event));
      target.addEventListener("mouseleave", clearNetworkHover);
    }

    function hoverAreaPath(posByScene) {
      const points = Array.from(posByScene.values());
      if (points.length < 3) return "";
      const xs = points.map((point) => point.x);
      const ys = points.map((point) => point.y);
      const width = Math.max(...xs) - Math.min(...xs);
      const height = Math.max(...ys) - Math.min(...ys);
      if (width > PATH_HOVER_AREA_MAX_W || height > PATH_HOVER_AREA_MAX_H) return "";

      const hull = convexHull(points);
      if (hull.length < 3) return "";
      const cx = hull.reduce((sum, point) => sum + point.x, 0) / hull.length;
      const cy = hull.reduce((sum, point) => sum + point.y, 0) / hull.length;
      const expanded = hull.map((point) => {
        const dx = point.x - cx;
        const dy = point.y - cy;
        const len = Math.hypot(dx, dy) || 1;
        return {
          x: point.x + (dx / len) * PATH_HOVER_AREA_PAD,
          y: point.y + (dy / len) * PATH_HOVER_AREA_PAD,
        };
      });
      return `M ${expanded.map((point) => `${point.x} ${point.y}`).join(" L ")} Z`;
    }

    function drawPathHoverSurface(root, pathItem, posByScene) {
      if (!state.tweaks.lines) return;
      if (!pathHasReleasedScene(pathItem)) return;
      const limited = isReleaseLimited();
      const hoverG = el("g", { class: "path-hover-surface", "data-path": pathItem.id });
      const area = limited ? "" : hoverAreaPath(posByScene);
      if (area) {
        hoverG.appendChild(el("path", {
          d: area,
          class: "path-hover-area",
          "data-path": pathItem.id,
        }));
      }
      for (const edge of pathItem.edges) {
        if (limited && !edgeIsReleased(edge)) continue;
        const a = posByScene.get(edge.fromSceneId);
        const b = posByScene.get(edge.toSceneId);
        if (!a || !b) continue;
        const common = {
          class: "path-hover-edge",
          "data-path": pathItem.id,
          "data-edge": edge.edgeId,
          "stroke-width": PATH_HOVER_STROKE,
        };
        if (edge.type === "loop") {
          hoverG.appendChild(el("path", { ...common, d: loopPath(a, b), fill: "none" }));
        } else {
          hoverG.appendChild(el("line", { ...common, x1: a.x, y1: a.y, x2: b.x, y2: b.y }));
        }
      }
      if (hoverG.childNodes.length) root.appendChild(hoverG);
    }

    function drawConstellation(root, pathItem, posByScene, opts = {}) {
      const entry = new Set(pathItem.entrySceneIds || []);
      const endSet = new Set(pathItem.endSceneIds || []);
      const isolated = new Set(pathItem.isolatedSceneIds || []);
      const runtime = state.model.runtime;

      if (!opts.thumb) drawPathHoverSurface(root, pathItem, posByScene);

      if (state.tweaks.lines) {
        const linesG = el("g", { class: "line-layer" });
        for (const edge of pathItem.edges) {
          const a = posByScene.get(edge.fromSceneId);
          const b = posByScene.get(edge.toSceneId);
          if (!a || !b) continue;
          const common = {
            class: edgeClass(edge, pathItem) + (opts.thumb ? " thumb" : ""),
            "data-path": pathItem.id,
            "data-edge": edge.edgeId,
            stroke: opts.tinted ? pathItem.color : null,
          };
          if (edge.type === "loop") {
            linesG.appendChild(el("path", { ...common, d: loopPath(a, b), fill: "none" }));
          } else {
            linesG.appendChild(el("line", { ...common, x1: a.x, y1: a.y, x2: b.x, y2: b.y }));
          }
        }
        root.appendChild(linesG);
      }

      pathItem.nodeIds.forEach((sceneId, index) => {
        const pos = posByScene.get(sceneId);
        if (!pos) return;
        const crossLevel = crossingLevel(sceneId);
        const isCross = crossLevel > 0;
        const isEntry = entry.has(sceneId);
        const isEnd = endSet.has(sceneId);
        const isIsolated = isolated.has(sceneId);
        const isReleased = isSceneReleased(sceneId);
        const status = Data.statusForScene(sceneId, runtime);
        const selected = state.selectedSceneId === sceneId && state.selectedPathId === pathItem.id;
        const baseR = opts.thumb ? 1.6 : (isEntry || isEnd ? 4.2 : 3.1);

        if (isEntry && !opts.thumb) {
          root.appendChild(el("circle", {
            cx: pos.x,
            cy: pos.y,
            r: baseR + 4,
            class: `entry-ring${isReleased ? "" : " unreleased"}`,
          }));
        }
        if (isEnd && !opts.thumb) {
          const size = baseR + 3.5;
          root.appendChild(el("rect", {
            x: pos.x - size,
            y: pos.y - size,
            width: size * 2,
            height: size * 2,
            class: `end-square${isReleased ? "" : " unreleased"}`,
          }));
        }
        if (isIsolated && !opts.thumb) {
          root.appendChild(el("circle", {
            cx: pos.x,
            cy: pos.y,
            r: baseR + 5,
            class: `isolated-ring${isReleased ? "" : " unreleased"}`,
          }));
        }

        const star = el("circle", {
          cx: pos.x,
          cy: pos.y,
          r: baseR,
          class: [
            "star",
            isCross ? `cross cross-${crossLevel}` : "",
            isEntry ? "entry" : "",
            isEnd ? "end" : "",
            isIsolated ? "isolated" : "",
            isReleased ? "released" : "unreleased",
            status,
            selected ? "selected" : "",
            runtime.activePathIds.has(pathItem.id) ? "runtime-active" : "",
            opts.thumb ? "thumb" : "",
          ].filter(Boolean).join(" "),
          "data-path": pathItem.id,
          "data-star": index,
          "data-scene": sceneId,
        });
        const hit = el("circle", {
          cx: pos.x,
          cy: pos.y,
          r: opts.thumb ? 5 : 15,
          class: `star-hit${isReleased ? "" : " unreleased"}`,
          "data-path": pathItem.id,
          "data-star": index,
          "data-scene": sceneId,
        });
        bindStarEvents(star, star, pathItem, sceneId);
        bindStarEvents(hit, star, pathItem, sceneId);
        root.appendChild(star);
        root.appendChild(hit);

        if (opts.labelScenes) {
          const label = el("text", {
            x: pos.x,
            y: pos.y - baseR - 10,
            "text-anchor": "middle",
            class: "scene-label",
          });
          label.textContent = sceneTitle(sceneId);
          root.appendChild(label);
        }
      });

      if (!opts.thumb && (state.tweaks.labels || opts.alwaysLabel)) {
        const positions = Array.from(posByScene.values());
        if (positions.length) {
          const xs = positions.map((point) => point.x);
          const ys = positions.map((point) => point.y);
          const label = el("text", {
            x: (Math.min(...xs) + Math.max(...xs)) / 2,
            y: Math.max(...ys) + 24,
            "text-anchor": "middle",
            class: "path-label",
          });
          label.textContent = pathItem.name;
          root.appendChild(label);
        }
      }
    }

    function drawLooseScenes(root) {
      if (!state.tweaks.loose) return;
      state.model.looseSceneIds.forEach((sceneId, index) => {
        const pos = looseScenePosition(sceneId, index, state.model.looseSceneIds.length);
        const status = statusForScene(sceneId);
        const isReleased = isSceneReleased(sceneId);
        const group = el("g", { class: "loose-wrap", "data-scene": sceneId });
        state.bb.loosePos.set(sceneId, pos);
        state.bb.looseGroups.set(sceneId, group);
        group.appendChild(el("circle", {
          cx: pos.x,
          cy: pos.y,
          r: 8,
          class: `loose-halo${isReleased ? "" : " unreleased"}`,
        }));
        const dot = el("circle", {
          cx: pos.x,
          cy: pos.y,
          r: 2.3,
          class: ["star", "loose", isReleased ? "released" : "unreleased", status].filter(Boolean).join(" "),
          "data-scene": sceneId,
        });
        const hit = el("circle", {
          cx: pos.x,
          cy: pos.y,
          r: 15,
          class: `star-hit${isReleased ? "" : " unreleased"}`,
          "data-scene": sceneId,
        });
        dot.addEventListener("mouseenter", onStarHover);
        dot.addEventListener("mousemove", onStarMove);
        dot.addEventListener("mouseleave", onStarOut);
        dot.addEventListener("click", (event) => {
          event.stopPropagation();
          focusLooseScene(sceneId, { animate: state.mode === "idle" });
        });
        hit.addEventListener("mouseenter", (event) => {
          dot.classList.add("hovered");
          showSceneTip(hit, event);
        });
        hit.addEventListener("mousemove", onStarMove);
        hit.addEventListener("mouseleave", () => {
          dot.classList.remove("hovered");
          hideTooltip();
        });
        hit.addEventListener("click", (event) => {
          event.stopPropagation();
          focusLooseScene(sceneId, { animate: state.mode === "idle" });
        });
        group.appendChild(dot);
        group.appendChild(hit);
        root.appendChild(group);
      });
    }

    function showSceneTip(starEl, event) {
      const sceneId = Number(starEl.getAttribute("data-scene") || 0);
      const pathId = starEl.getAttribute("data-path") || "";
      if (!sceneId) return;
      const pathItem = pathId ? pathById(pathId) : null;
      const status = statusForScene(sceneId);
      const badge = pathItem
        ? badgeForScene(pathItem, sceneId, status)
        : `<span class="tt-badge loose">losse scene</span>`;
      tooltip.innerHTML = `
        <div class="hoverHeader">
          <p>${escapeText(pathItem ? "Scene" : "Losse scene")}</p>
          ${badge || ""}
        </div>
        <dl class="hoverFacts">
          <div>
            <dt>Naam</dt>
            <dd>${escapeText(sceneTitle(sceneId))}</dd>
          </div>
          <div>
            <dt>Pad</dt>
            <dd>${escapeText(pathItem ? pathItem.name : "in geen pad")}</dd>
          </div>
        </dl>
      `;
      tooltip.classList.add("show");
    }

    function badgeForScene(pathItem, sceneId, status) {
      if (status) return `<span class="tt-badge ${status}">${escapeText(Data.labelForStatus(status))}</span>`;
      if (state.model.crossingSceneIds.has(sceneId)) return `<span class="tt-badge cross">kruising</span>`;
      if ((pathItem.entrySceneIds || []).includes(sceneId)) return `<span class="tt-badge">entry</span>`;
      if ((pathItem.endSceneIds || []).includes(sceneId)) return `<span class="tt-badge end">eindnode</span>`;
      if ((pathItem.isolatedSceneIds || []).includes(sceneId)) return `<span class="tt-badge loose">los in pad</span>`;
      return "";
    }

    function onStarHover(event) {
      event.currentTarget.classList.add("hovered");
      showSceneTip(event.currentTarget, event);
    }

    function onStarMove(event) {
      event.stopPropagation();
    }

    function onStarOut(event) {
      event.currentTarget.classList.remove("hovered");
      hideTooltip();
    }

    function bindStarEvents(target, visibleStar, pathItem, sceneId) {
      target.addEventListener("mouseenter", (event) => {
        visibleStar.classList.add("hovered");
        if (state.mode === "focus" && state.selectedPathId === String(pathItem.id)) {
          showFocusHoverLabel(pathItem.id, sceneId);
        } else {
          applyPathHover(pathItem, event);
        }
      });
      target.addEventListener("mousemove", (event) => {
        if (state.mode === "focus" && state.selectedPathId === String(pathItem.id)) {
          onStarMove(event);
          return;
        }
        applyPathHover(pathItem, event);
      });
      target.addEventListener("mouseleave", () => {
        visibleStar.classList.remove("hovered");
        if (state.mode === "focus") hideFocusHoverLabel();
        else clearPathHover(pathItem.id);
      });
      target.addEventListener("click", (event) => {
        event.stopPropagation();
        if (state.mode === "focus" && state.selectedPathId === String(pathItem.id)) {
          state.selectedSceneId = Number(sceneId || 0);
          syncSelectedSceneClass();
          showPathPanel(pathItem.id);
          return;
        }
        focusPath(pathItem.id, sceneId, { animate: state.mode === "idle" });
      });
      target.addEventListener("dblclick", (event) => {
        event.preventDefault();
        event.stopPropagation();
        focusPath(pathItem.id, sceneId, { animate: state.mode === "idle" });
      });
    }

    function showFocusHoverLabel(pathId, sceneId) {
      if (!state.bb.labelsLayer) return;
      state.bb.labelsLayer.innerHTML = "";
      const pathItem = pathById(pathId);
      const positions = state.bb.radialPos.get(String(pathId));
      if (!pathItem || !positions) return;
      const pos = positions.get(Number(sceneId));
      if (!pos) return;
      const orbitMatrix = state.frozenOrbitMatrix || matrix();
      const pathMatrix = currentPathMotionMatrix(pathId);
      const screenMatrix = multiplyMatrix(multiplyMatrix(state.currentCameraMatrix, orbitMatrix), pathMatrix);
      const screenPos = transformPoint(screenMatrix, pos);
      const label = el("text", {
        x: screenPos.x,
        y: screenPos.y - 22,
        "text-anchor": "middle",
        class: "scene-label focus-label",
      });
      label.textContent = sceneTitle(sceneId);
      state.bb.labelsLayer.appendChild(label);
      state.bb.labelsLayer.classList.add("show");
    }

    function showFocusTitle(pathId) {
      if (!state.bb.titleLayer) return;
      const pathItem = pathById(pathId);
      if (!pathItem) return;
      state.bb.titleLayer.innerHTML = "";
      const wrapper = el("foreignObject", { x: 0, y: 88, width: W, height: 72 });
      wrapper.appendChild(htmlEl("div", {
        html: `<div class="bb-title"><span class="dot" style="background:${escapeText(pathItem.color)}"></span>${escapeText(pathItem.name)}<span class="meta">${pathItem.nodeIds.length} nodes</span></div>`,
      }));
      state.bb.titleLayer.appendChild(wrapper);
      state.bb.titleLayer.classList.add("show");
    }

    function thumbCoord(value) {
      return Number.isFinite(value) ? Math.round(value * 100) / 100 : 0;
    }

    function thumbPositionMap(pathItem, width, height, pad) {
      const sourcePositions = state.bb.radialPos.get(String(pathItem.id));
      const motionMatrix = currentPathMotionMatrix(pathItem.id);
      const rawPositions = new Map();

      if (sourcePositions && sourcePositions.size) {
        pathItem.nodeIds.forEach((sceneId) => {
          const pos = sourcePositions.get(sceneId);
          if (pos) rawPositions.set(sceneId, transformPoint(motionMatrix, pos));
        });
      } else if (Array.isArray(pathItem.shape)) {
        pathItem.shape.forEach(([x, y], index) => {
          rawPositions.set(pathItem.nodeIds[index], { x: Number(x) || 0, y: Number(y) || 0 });
        });
      }

      const positions = Array.from(rawPositions.values());
      if (!positions.length) return rawPositions;

      const xs = positions.map((point) => point.x);
      const ys = positions.map((point) => point.y);
      const minX = Math.min(...xs);
      const maxX = Math.max(...xs);
      const minY = Math.min(...ys);
      const maxY = Math.max(...ys);
      const sw = Math.max(maxX - minX, 24);
      const sh = Math.max(maxY - minY, 18);
      const scale = Math.min((width - pad * 2) / sw, (height - pad * 2) / sh, 1.15);
      const cx = (minX + maxX) / 2;
      const cy = (minY + maxY) / 2;
      const thumbPositions = new Map();

      rawPositions.forEach((pos, sceneId) => {
        thumbPositions.set(sceneId, {
          x: width / 2 + (pos.x - cx) * scale,
          y: height / 2 + (pos.y - cy) * scale,
        });
      });

      return thumbPositions;
    }

    function renderThumbSvg(pathItem) {
      const width = 110;
      const height = 50;
      const pad = 7;
      const posByScene = thumbPositionMap(pathItem, width, height, pad);

      let lines = "";
      for (const edge of pathItem.edges) {
        const a = posByScene.get(edge.fromSceneId);
        const b = posByScene.get(edge.toSceneId);
        if (!a || !b) continue;
        const isTerminal = edgeIsTerminalLine(edge, pathItem);
        const strokeWidth = edge.type === "loop" ? 1.25 : (isTerminal ? 0.8 : 1.1);
        const dash = isTerminal ? ` stroke-dasharray="1 3"` : "";
        if (edge.type === "loop") {
          lines += `<path d="${loopPath(a, b)}" fill="none" stroke="rgba(255,255,255,0.58)" stroke-width="${strokeWidth}" stroke-linecap="round" stroke-linejoin="round"${dash}/>`;
        } else {
          lines += `<line x1="${thumbCoord(a.x)}" y1="${thumbCoord(a.y)}" x2="${thumbCoord(b.x)}" y2="${thumbCoord(b.y)}" stroke="rgba(255,255,255,0.58)" stroke-width="${strokeWidth}" stroke-linecap="round"${dash}/>`;
        }
      }
      let dots = "";
      posByScene.forEach((pos) => {
        dots += `<circle cx="${thumbCoord(pos.x)}" cy="${thumbCoord(pos.y)}" r="1.35" fill="rgba(255,255,255,0.88)"/>`;
      });
      return `<svg viewBox="0 0 ${width} ${height}" aria-hidden="true">${lines}${dots}</svg>`;
    }

    function showThumbStrip(activeId) {
      if (!elements.thumbStrip) return;
      elements.thumbStrip.innerHTML = "";
      const row = htmlEl("div", { class: "bb-thumbs-row" });
      state.model.paths.forEach((pathItem) => {
        const tile = htmlEl("button", {
          class: `bb-thumb${pathItem.id === activeId ? " active" : ""}`,
          type: "button",
          "data-path": pathItem.id,
        });
        const svgWrap = htmlEl("div", { class: "bb-thumb-svg", html: renderThumbSvg(pathItem) });
        const name = htmlEl("div", { class: "bb-thumb-name" });
        name.textContent = pathItem.name;
        tile.appendChild(svgWrap);
        tile.appendChild(name);
        tile.addEventListener("click", () => {
          if (state.isTransitioning) return;
          if (state.mode === "focus") switchFocusPath(pathItem.id, 0);
          else focusPath(pathItem.id, 0, { animate: true });
        });
        row.appendChild(tile);
      });
      elements.thumbStrip.appendChild(row);
      elements.thumbStrip.classList.add("show");
    }

    function syncThumbStripActive(activeId) {
      if (!elements.thumbStrip) return;
      elements.thumbStrip.querySelectorAll(".bb-thumb").forEach((tile) => {
        tile.classList.toggle("active", tile.getAttribute("data-path") === String(activeId));
      });
    }

    function finishTransition(finalize) {
      state.isTransitioning = false;
      state.focusAnimationFrame = 0;
      finalize();
      if (state.pendingModel) {
        const nextModel = state.pendingModel;
        state.pendingModel = null;
        state.model = nextModel;
        render();
      }
    }

    function animateCameraTo(targetMatrix, finalize) {
      const from = state.currentCameraMatrix;
      const start = performance.now();
      const step = () => {
        const now = performance.now();
        const raw = Math.min((now - start) / FOCUS_ANIMATION_MS, 1);
        const eased = easeInOutSine(raw);
        setCameraTransform(interpolateMatrix(from, targetMatrix, eased));
        if (raw < 1) {
          state.focusAnimationFrame = window.setTimeout(step, 16);
          return;
        }
        finishTransition(finalize);
      };
      state.focusAnimationFrame = window.setTimeout(step, 16);
    }

    function prepareFocusTransition() {
      cancelFocusAnimation();
      state.isTransitioning = true;
      clearFloatingLayers();
      hideTooltip();
      if (infoPanel) infoPanel.classList.remove("show");
      return freezeOrbitAtCurrentAngle();
    }

    function hideLooseGroups(exceptSceneId = 0) {
      state.bb.looseGroups.forEach((group, sceneId) => {
        const isFocused = Number(sceneId) === Number(exceptSceneId);
        group.classList.toggle("focused", isFocused);
        group.classList.toggle("focus-hidden", !isFocused);
        group.classList.remove("dimmed");
        if (!isFocused) group.removeAttribute("transform");
      });
    }

    function animateFocusPath(pathId, sceneId = 0) {
      const group = state.bb.groups.get(String(pathId));
      if (!group) {
        applyFocus(pathId);
        return;
      }
      const orbitMatrix = prepareFocusTransition();
      const target = cameraMatrixForPath(pathId, orbitMatrix);
      state.mode = "transition";
      state.selectedPathId = String(pathId);
      state.selectedSceneId = Number(sceneId || 0);
      state.focusedLooseSceneId = 0;
      state.bb.groups.forEach((pathGroup, groupPathId) => {
        const isFocused = groupPathId === String(pathId);
        pathGroup.classList.remove("selected", "focused", "hidden", "dimmed", "hovered", "hover-dimmed");
        pathGroup.classList.toggle("focus-transitioning", isFocused);
        pathGroup.classList.toggle("focus-hidden", !isFocused);
        if (isFocused) applyPathGroupMatrix(pathGroup, currentPathMotionMatrix(groupPathId));
        else pathGroup.removeAttribute("transform");
      });
      hideLooseGroups(0);
      animateCameraTo(target, () => {
        state.mode = "focus";
        applyFocus(pathId);
      });
    }

    function animateFocusLooseScene(sceneId) {
      const group = state.bb.looseGroups.get(Number(sceneId));
      if (!group) {
        applyLooseFocus(sceneId);
        return;
      }
      const orbitMatrix = prepareFocusTransition();
      const target = cameraMatrixForLooseScene(sceneId, orbitMatrix);
      state.mode = "transition";
      state.selectedPathId = "";
      state.selectedSceneId = Number(sceneId || 0);
      state.focusedLooseSceneId = Number(sceneId || 0);
      state.bb.groups.forEach((pathGroup) => {
        pathGroup.classList.remove("selected", "focused", "hidden", "dimmed", "hovered", "hover-dimmed");
        pathGroup.classList.add("focus-hidden");
        pathGroup.removeAttribute("transform");
      });
      hideLooseGroups(sceneId);
      group.removeAttribute("transform");
      animateCameraTo(target, () => {
        state.mode = "focus";
        applyLooseFocus(sceneId);
      });
    }

    function revealFocusedPath(pathId) {
      const orbitMatrix = freezeOrbitAtCurrentAngle();
      setCameraTransform(cameraMatrixForPath(pathId, orbitMatrix));
      state.bb.groups.forEach((group, groupPathId) => {
        group.classList.remove("selected", "hovered", "hover-dimmed", "focus-transitioning", "focus-hidden");
        if (groupPathId === String(pathId)) {
          group.classList.add("focused");
          group.classList.remove("dimmed", "hidden");
          applyPathGroupMatrix(group, currentPathMotionMatrix(groupPathId));
        } else {
          group.classList.remove("focused", "dimmed", "hidden");
          group.classList.add("focus-hidden");
          group.removeAttribute("transform");
        }
      });
      hideLooseGroups(0);
      syncSelectedSceneClass();
      showPathPanel(pathId);
    }

    function switchFocusPath(pathId, sceneId = 0) {
      const nextPathId = String(pathId);
      if (!pathById(nextPathId)) return;
      if (nextPathId === state.selectedPathId) {
        state.selectedSceneId = Number(sceneId || 0);
        syncSelectedSceneClass();
        syncThumbStripActive(nextPathId);
        showPathPanel(nextPathId);
        return;
      }

      cancelFocusAnimation();
      state.isTransitioning = true;
      hideFocusHoverLabel();
      hideTooltip();
      if (infoPanel) infoPanel.classList.remove("show");
      state.bb.groups.forEach((group) => {
        group.classList.remove("selected", "focused", "hovered", "hover-dimmed", "dimmed", "hidden", "focus-transitioning");
        group.classList.add("focus-hidden");
      });
      state.bb.looseGroups.forEach((group) => {
        group.classList.remove("focused", "dimmed");
        group.classList.add("focus-hidden");
        group.removeAttribute("transform");
      });
      syncThumbStripActive(nextPathId);
      state.focusAnimationFrame = window.setTimeout(() => {
        finishTransition(() => {
          state.mode = "focus";
          state.selectedPathId = nextPathId;
          state.selectedSceneId = Number(sceneId || 0);
          state.focusedLooseSceneId = 0;
          revealFocusedPath(nextPathId);
        });
      }, FOCUS_SWITCH_FADE_MS);
    }

    function animateBackToIdle() {
      if (!state.bb.cameraLayer || state.mode === "idle") {
        applyIdle();
        return;
      }
      cancelFocusAnimation();
      state.isTransitioning = true;
      clearFloatingLayers();
      hideTooltip();
      if (infoPanel) infoPanel.classList.remove("show");
      state.bb.groups.forEach((group) => {
        group.classList.remove("dimmed", "selected", "focused", "hidden", "hovered", "hover-dimmed", "focus-transitioning", "idle-revealing");
        group.classList.add("focus-hidden");
      });
      state.bb.looseGroups.forEach((group) => {
        group.classList.remove("focused", "dimmed", "idle-revealing");
        group.classList.add("focus-hidden");
      });
      state.focusAnimationFrame = window.setTimeout(() => {
        finishTransition(() => applyIdle({ reveal: true }));
      }, FOCUS_RETURN_FADE_MS);
    }

    function applyIdle(opts = {}) {
      if (opts.animate) {
        animateBackToIdle();
        return;
      }
      cancelFocusAnimation();
      stopSpin();
      state.mode = "idle";
      state.selectedPathId = "";
      state.selectedSceneId = 0;
      state.hoveredPathId = "";
      state.focusedLooseSceneId = 0;
      state.isTransitioning = false;
      state.focusAnimationFrame = 0;
      if (state.orbitAnimationFrame) window.cancelAnimationFrame(state.orbitAnimationFrame);
      state.orbitAnimationFrame = 0;
      state.pendingModel = null;
      state.currentCameraMatrix = matrix();
      clearFloatingLayers();
      hideTooltip();
      if (infoPanel) infoPanel.classList.remove("show");
      if (state.bb.cameraLayer) state.bb.cameraLayer.removeAttribute("transform");
      const revealHidden = Boolean(opts.reveal);
      const keepVisiblePathId = opts.keepVisiblePathId ? String(opts.keepVisiblePathId) : "";
      const keepVisibleLooseSceneId = Number(opts.keepVisibleLooseSceneId || 0);
      state.bb.groups.forEach((group, groupPathId) => {
        const staysVisible = revealHidden && keepVisiblePathId && groupPathId === keepVisiblePathId;
        group.classList.remove("dimmed", "selected", "focused", "hidden", "hovered", "hover-dimmed", "focus-transitioning", "idle-revealing");
        group.classList.toggle("idle-revealing", revealHidden && !staysVisible);
        group.classList.toggle("focus-hidden", revealHidden && !staysVisible);
      });
      state.bb.looseGroups.forEach((group, sceneId) => {
        const staysVisible = revealHidden && keepVisibleLooseSceneId && Number(sceneId) === keepVisibleLooseSceneId;
        group.classList.remove("focused", "dimmed", "idle-revealing");
        group.classList.toggle("idle-revealing", revealHidden && !staysVisible);
        group.classList.toggle("focus-hidden", revealHidden && !staysVisible);
        group.removeAttribute("transform");
      });
      setIdlePathTransforms();
      if (state.frozenOrbitMatrix) {
        state.frozenOrbitMatrix = null;
        state.frozenOrbitElapsed = 0;
      }
      state.frozenPathMatrices = null;
      startSpin();
      if (revealHidden) {
        window.requestAnimationFrame(() => {
          window.requestAnimationFrame(() => {
            state.bb.groups.forEach((group) => group.classList.remove("focus-hidden"));
            state.bb.looseGroups.forEach((group) => group.classList.remove("focus-hidden"));
            window.setTimeout(() => {
              state.bb.groups.forEach((group) => group.classList.remove("idle-revealing"));
              state.bb.looseGroups.forEach((group) => group.classList.remove("idle-revealing"));
            }, 700);
          });
        });
      }
    }

    function applySelected(pathId) {
      stopSpin();
      state.hoveredPathId = "";
      state.focusedLooseSceneId = 0;
      clearFloatingLayers();
      hideTooltip();
      state.bb.groups.forEach((group, groupPathId) => {
        group.classList.remove("focused", "hidden", "hovered", "hover-dimmed", "focus-transitioning", "focus-hidden");
        group.classList.toggle("selected", groupPathId === String(pathId));
        group.classList.toggle("dimmed", groupPathId !== String(pathId));
        group.removeAttribute("transform");
      });
      hideLooseGroups(0);
      syncSelectedSceneClass();
      showPathPanel(pathId);
    }

    function applyFocus(pathId) {
      stopSpin();
      state.hoveredPathId = "";
      state.focusedLooseSceneId = 0;
      clearFloatingLayers();
      hideTooltip();
      revealFocusedPath(pathId);
      showThumbStrip(String(pathId));
    }

    function applyLooseFocus(sceneId) {
      stopSpin();
      state.hoveredPathId = "";
      state.selectedPathId = "";
      state.selectedSceneId = Number(sceneId || 0);
      state.focusedLooseSceneId = Number(sceneId || 0);
      clearFloatingLayers();
      hideTooltip();
      const orbitMatrix = freezeOrbitAtCurrentAngle();
      setCameraTransform(cameraMatrixForLooseScene(sceneId, orbitMatrix));
      state.bb.groups.forEach((group) => {
        group.classList.remove("selected", "focused", "hovered", "hover-dimmed", "dimmed", "hidden", "focus-transitioning");
        group.classList.add("focus-hidden");
        group.removeAttribute("transform");
      });
      state.bb.looseGroups.forEach((group, looseSceneId) => {
        const isFocused = Number(looseSceneId) === Number(sceneId);
        group.classList.toggle("focused", isFocused);
        group.classList.toggle("focus-hidden", !isFocused);
        group.removeAttribute("transform");
      });
      showLoosePanel(sceneId);
    }

    function syncSelectedSceneClass() {
      sky.querySelectorAll(".star.selected").forEach((node) => node.classList.remove("selected"));
      if (!state.selectedPathId || !state.selectedSceneId) return;
      sky.querySelectorAll(`.star[data-path="${CSS.escape(state.selectedPathId)}"][data-scene="${state.selectedSceneId}"]`)
        .forEach((node) => node.classList.add("selected"));
    }

    function selectPath(pathId, sceneId = 0) {
      const pathItem = pathById(pathId);
      if (!pathItem) return;
      state.mode = "selected";
      state.selectedPathId = String(pathId);
      state.selectedSceneId = Number(sceneId || 0);
      state.focusedLooseSceneId = 0;
      applySelected(pathId);
    }

    function focusPath(pathId, sceneId = state.selectedSceneId, opts = {}) {
      const pathItem = pathById(pathId);
      if (!pathItem) return;
      if (opts.animate) {
        animateFocusPath(pathId, sceneId);
        return;
      }
      state.mode = "focus";
      state.selectedPathId = String(pathId);
      state.selectedSceneId = Number(sceneId || 0);
      state.focusedLooseSceneId = 0;
      applyFocus(pathId);
    }

    function focusLooseScene(sceneId, opts = {}) {
      const safeSceneId = Number(sceneId || 0);
      if (!safeSceneId) return;
      if (opts.animate) {
        animateFocusLooseScene(safeSceneId);
        return;
      }
      state.mode = "focus";
      state.selectedPathId = "";
      state.selectedSceneId = safeSceneId;
      state.focusedLooseSceneId = safeSceneId;
      applyLooseFocus(safeSceneId);
    }

    function selectLooseScene(sceneId) {
      stopSpin();
      state.mode = "selected";
      state.selectedPathId = "";
      state.selectedSceneId = Number(sceneId || 0);
      state.hoveredPathId = "";
      state.focusedLooseSceneId = 0;
      clearFloatingLayers();
      hideTooltip();
      state.bb.groups.forEach((group) => {
        group.classList.add("dimmed");
        group.classList.remove("selected", "focused", "hidden", "hovered", "hover-dimmed");
      });
      setIdlePathTransforms();
      showLoosePanel(sceneId);
    }

    function showPathPanel(pathId) {
      const pathItem = pathById(pathId);
      if (!pathItem || !infoPanel) return;
      const selectedScene = state.selectedSceneId ? sceneTitle(state.selectedSceneId) : "";
      elements.ipEyebrow.textContent = state.mode === "focus" ? "focus" : "pad";
      elements.ipTitle.innerHTML = `<span class="ip-color" style="background:${escapeText(pathItem.color)}"></span>${escapeText(pathItem.name)}`;
      elements.ipMeta.innerHTML = `
        <div class="ip-meta-line">${pathItem.nodeIds.length} nodes · ${pathItem.edges.length} edges</div>
        ${selectedScene ? `<div class="ip-selected">${escapeText(selectedScene)}</div>` : ""}
      `;
      elements.ipStars.innerHTML = pathItem.nodeIds.map((sceneId) => {
        const tags = [];
        const status = statusForScene(sceneId);
        if ((pathItem.entrySceneIds || []).includes(sceneId)) tags.push(`<span class="ic-tag tag-entry">entry</span>`);
        if ((pathItem.endSceneIds || []).includes(sceneId)) tags.push(`<span class="ic-tag tag-end">eind</span>`);
        if (state.model.crossingSceneIds.has(sceneId)) tags.push(`<span class="ic-tag tag-cross">kruising</span>`);
        if ((pathItem.isolatedSceneIds || []).includes(sceneId)) tags.push(`<span class="ic-tag tag-iso">los</span>`);
        if (status) tags.push(`<span class="ic-tag tag-${status}">${escapeText(Data.labelForStatus(status))}</span>`);
        return `<li class="${sceneId === state.selectedSceneId ? "selected" : ""}">${escapeText(sceneTitle(sceneId))}${tags.join("")}</li>`;
      }).join("");
      elements.ipFocus.hidden = state.mode === "focus";
      elements.ipFocus.onclick = () => focusPath(pathItem.id, 0, { animate: true });
      elements.ipReset.onclick = () => applyIdle({ animate: true });
      infoPanel.classList.add("show");
    }

    function showLoosePanel(sceneId) {
      if (!infoPanel) return;
      const status = statusForScene(sceneId);
      elements.ipEyebrow.textContent = "losse scene";
      elements.ipTitle.textContent = sceneTitle(sceneId);
      elements.ipMeta.innerHTML = status
        ? `<div class="ip-selected">${escapeText(Data.labelForStatus(status))}</div>`
        : `<div class="ip-meta-line">scene zonder pad</div>`;
      elements.ipStars.innerHTML = "";
      elements.ipFocus.hidden = true;
      elements.ipReset.onclick = () => applyIdle({ animate: true });
      infoPanel.classList.add("show");
    }

    function bindPathGroupEvents(group, pathItem) {
      group.addEventListener("mouseenter", (event) => {
        applyPathHover(pathItem, event);
      });
      group.addEventListener("mousemove", (event) => {
        applyPathHover(pathItem, event);
      });
      group.addEventListener("mouseleave", () => {
        clearPathHover(pathItem.id);
      });
    }

    function renderNetworkMap(root) {
      state.bb.cameraLayer = null;
      state.bb.orbitLayer = null;
      state.bb.groups = new Map();
      state.bb.looseGroups = new Map();
      state.bb.loosePos = new Map();
      state.bb.radialPos = new Map();
      state.bb.radialBbox = new Map();
      state.bb.networkNodeGroups = new Map();
      state.bb.networkEdgeGroups = new Map();
      state.bb.networkPos = new Map();
      state.bb.networkBasePos = new Map();
      state.bb.networkClusterSizes = new Map();
      state.bb.networkBbox = null;
      state.bb.debugLayer = null;

      const cameraLayer = el("g", { class: "bb-camera-layer network-camera-layer" });
      state.bb.cameraLayer = cameraLayer;
      root.appendChild(cameraLayer);
      setCameraTransform(matrix());

      const orbitLayer = el("g", { class: "bb-orbit-layer network-orbit-layer" });
      state.bb.orbitLayer = orbitLayer;
      cameraLayer.appendChild(orbitLayer);

      const networkMap = state.model.networkMap || { nodes: [], edges: [] };
      const layout = networkLayout(networkMap);
      state.bb.networkPos = layout.pos;
      state.bb.networkBasePos = new Map(layout.pos);
      state.bb.networkBbox = layout.bbox;
      (networkMap.nodes || []).forEach((node) => {
        const rootSceneId = Number(node.networkRootSceneId || node.sceneId || 0);
        if (!rootSceneId) return;
        state.bb.networkClusterSizes.set(rootSceneId, (state.bb.networkClusterSizes.get(rootSceneId) || 0) + 1);
      });

      const edgeLayer = el("g", { class: "network-edge-layer" });
      const hitLayer = el("g", { class: "network-hit-layer" });
      const nodeLayer = el("g", { class: "network-node-layer" });
      const labelLayer = el("g", { class: `network-label-layer${state.tweaks.labels ? " show" : ""}` });
      orbitLayer.appendChild(edgeLayer);
      orbitLayer.appendChild(hitLayer);
      orbitLayer.appendChild(nodeLayer);
      orbitLayer.appendChild(labelLayer);

      if (state.tweaks.lines) {
        for (const edge of networkMap.edges || []) {
          const a = layout.pos.get(edge.fromSceneId);
          const b = layout.pos.get(edge.toSceneId);
          if (!a || !b) continue;
          const width = Math.min(0.85 + Math.max(Number(edge.pathCount || edge.count || 1), 1) * 0.34, 3.2);
          const edgeAttrs = {
            class: networkEdgeClass(edge),
            "data-network-edge": edge.edgeId,
            "stroke-width": width,
          };
          const hitAttrs = {
            class: "network-edge-hit",
            "data-network-edge": edge.edgeId,
            "stroke-width": Math.max(18, width + 14),
          };
          const edgeNode = el("path", { ...edgeAttrs, d: networkEdgePath(a, b, edge), fill: "none" });
          const hitNode = el("path", { ...hitAttrs, d: networkEdgePath(a, b, edge), fill: "none" });
          const group = el("g", { class: "network-edge-wrap" });
          group.__edge = edge;
          group.__edgeNode = edgeNode;
          group.__hitNode = hitNode;
          group.appendChild(edgeNode);
          edgeLayer.appendChild(group);
          bindNetworkEdgeEvents(hitNode, edge);
          hitLayer.appendChild(hitNode);
          state.bb.networkEdgeGroups.set(String(edge.edgeId), group);
        }
      }

      for (const node of networkMap.nodes || []) {
        const pos = layout.pos.get(node.sceneId);
        if (!pos) continue;
        const isReleased = isSceneReleased(node.sceneId);
        const status = statusForScene(node.sceneId);
        const crossLevel = Math.round(clamp(Number(node.crossingLevel || 0), 0, 3));
        const radius = networkNodeRadius(node);
        const group = el("g", {
          class: [
            "network-node-wrap",
            node.isNetworkRoot ? "entry-node" : "",
            node.isCrossingNode ? "crossing-node" : "",
            Number(node.degree || 0) === 0 ? "loose-node" : "",
          ].filter(Boolean).join(" "),
          "data-scene": node.sceneId,
        });
        group.__node = node;
        const star = el("circle", {
          cx: pos.x,
          cy: pos.y,
          r: radius,
          class: [
            "star",
            "network-star",
            node.isNetworkRoot ? "entry" : "",
            node.isCrossingNode ? `cross cross-${crossLevel || 1}` : "",
            node.isEndNode ? "end" : "",
            Number(node.degree || 0) === 0 ? "loose" : "",
            isReleased ? "released" : "unreleased",
            status,
          ].filter(Boolean).join(" "),
          "data-scene": node.sceneId,
        });
        const hit = el("circle", {
          cx: pos.x,
          cy: pos.y,
          r: Math.max(15, radius + 9),
          class: `star-hit network-star-hit${isReleased ? "" : " unreleased"}`,
          "data-scene": node.sceneId,
        });
        bindNetworkNodeEvents(star, star, node);
        bindNetworkNodeEvents(hit, star, node);
        group.appendChild(star);
        group.appendChild(hit);
        nodeLayer.appendChild(group);
        state.bb.networkNodeGroups.set(node.sceneId, group);

        if (state.tweaks.labels) {
          const label = el("text", {
            x: pos.x,
            y: pos.y - radius - 9,
            "text-anchor": "middle",
            class: `scene-label network-label${status ? " runtime-label" : ""}`,
          });
          label.textContent = node.title;
          group.appendChild(label);
        }
      }

      state.bb.labelsLayer = el("g", { class: "bb-labels" });
      root.appendChild(state.bb.labelsLayer);
      state.bb.titleLayer = el("g", { class: "bb-title-layer" });
      root.appendChild(state.bb.titleLayer);
      drawDebugOverlay(root, orbitLayer);
    }

    function renderBigBang(root) {
      state.bb.cameraLayer = null;
      state.bb.orbitLayer = null;
      state.bb.groups = new Map();
      state.bb.looseGroups = new Map();
      state.bb.loosePos = new Map();
      state.bb.radialPos = new Map();
      state.bb.radialBbox = new Map();
      state.bb.debugLayer = null;

      const cameraLayer = el("g", { class: "bb-camera-layer" });
      state.bb.cameraLayer = cameraLayer;
      root.appendChild(cameraLayer);
      setCameraTransform(state.currentCameraMatrix || matrix());

      const orbitLayer = el("g", { class: "bb-orbit-layer" });
      state.bb.orbitLayer = orbitLayer;
      cameraLayer.appendChild(orbitLayer);

      const indexByPathId = densityBalancedPlacementMap(state.model.paths);

      state.model.paths.forEach((pathItem) => {
        const placement = indexByPathId.get(pathItem.id) || {
          angle: -Math.PI / 2,
          hasEntry: pathHasEntry(pathItem),
        };
        const { map, bbox } = springConstellationPositionsFor(pathItem, placement.angle, {
          hasEntry: placement.hasEntry,
        });
        state.bb.radialPos.set(pathItem.id, map);
        state.bb.radialBbox.set(pathItem.id, bbox);
        const group = el("g", { class: "bb-path", "data-path-id": pathItem.id });
        group.addEventListener("dblclick", (event) => {
          event.preventDefault();
          focusPath(pathItem.id, 0, { animate: state.mode === "idle" });
        });
        group.addEventListener("click", (event) => {
          if (event.target && event.target.classList && event.target.classList.contains("star")) return;
          focusPath(pathItem.id, 0, { animate: state.mode === "idle" });
        });
        bindPathGroupEvents(group, pathItem);
        orbitLayer.appendChild(group);
        drawConstellation(group, pathItem, map);
        state.bb.groups.set(pathItem.id, group);
      });

      const looseLayer = el("g", { class: "bb-loose" });
      cameraLayer.appendChild(looseLayer);
      drawLooseScenes(looseLayer);

      state.bb.labelsLayer = el("g", { class: "bb-labels" });
      root.appendChild(state.bb.labelsLayer);
      state.bb.titleLayer = el("g", { class: "bb-title-layer" });
      root.appendChild(state.bb.titleLayer);
      drawDebugOverlay(root, orbitLayer);
    }

    function renderEmpty(message) {
      stopSpin();
      updateDebugPanel(null);
      sky.innerHTML = "";
      const root = el("g");
      sky.appendChild(root);
      const wrapper = el("foreignObject", { x: 420, y: 330, width: 760, height: 190 });
      wrapper.appendChild(htmlEl("div", { class: "empty-state", html: escapeText(message) }));
      root.appendChild(wrapper);
    }

    function render() {
      stopSpin();
      if (!state.model || !state.model.paths.length) {
        renderEmpty("Geen paden gevonden in de read-only SQLite bron.");
        return;
      }

      sky.innerHTML = "";
      const root = el("g", { class: "sky-root" });
      sky.appendChild(root);
      if (state.view === "network") renderNetworkMap(root);
      else renderBigBang(root);

      if (state.view === "network") applyIdle();
      else if (state.mode === "focus" && state.selectedPathId) applyFocus(state.selectedPathId);
      else if (state.mode === "focus" && state.focusedLooseSceneId) applyLooseFocus(state.focusedLooseSceneId);
      else if (state.mode === "selected" && state.selectedPathId) applySelected(state.selectedPathId);
      else if (state.mode === "selected" && state.selectedSceneId) selectLooseScene(state.selectedSceneId);
      else applyIdle();
    }

    function setView(viewName) {
      const nextView = viewName === "network" ? "network" : "bigbang";
      if (state.view === nextView) {
        if (nextView === "bigbang") applyIdle({ animate: state.mode !== "idle" });
        return state.view;
      }
      cancelFocusAnimation();
      stopSpin();
      state.view = nextView;
      state.mode = "idle";
      state.selectedPathId = "";
      state.selectedSceneId = 0;
      state.hoveredPathId = "";
      state.focusedLooseSceneId = 0;
      state.isTransitioning = false;
      state.pendingModel = null;
      state.frozenOrbitMatrix = null;
      state.frozenPathMatrices = null;
      state.currentCameraMatrix = matrix();
      clearFloatingLayers();
      hideTooltip();
      if (infoPanel) infoPanel.classList.remove("show");
      if (state.model) render();
      return state.view;
    }

    function setModel(model) {
      if (state.isTransitioning) {
        state.pendingModel = model;
        return;
      }
      state.model = model;
      if (state.selectedPathId && !pathById(state.selectedPathId)) {
        state.mode = "idle";
        state.selectedPathId = "";
        state.selectedSceneId = 0;
        state.focusedLooseSceneId = 0;
      }
      if (state.focusedLooseSceneId && !state.model.looseSceneIds.includes(state.focusedLooseSceneId)) {
        state.mode = "idle";
        state.selectedSceneId = 0;
        state.focusedLooseSceneId = 0;
      }
      render();
    }

    function setTweak(key, value) {
      if (!Object.prototype.hasOwnProperty.call(state.tweaks, key)) return;
      state.tweaks[key] = !!value;
      render();
    }

    if (elements.ipClose) elements.ipClose.addEventListener("click", () => applyIdle({ animate: true }));
    if (sky) sky.addEventListener("click", (event) => {
      if (event.target === sky) applyIdle({ animate: true });
    });
    window.addEventListener("keydown", (event) => {
      if (event.key === "Escape") applyIdle({ animate: true });
    });
    wireMotionControls();

    return {
      setModel,
      setTweak,
      setView,
      reset: () => {
        if (state.view !== "network") setView("network");
        else applyIdle({ animate: true });
      },
      focusPath,
      focusLooseScene,
      selectPath,
    };
  }

  window.ForUniverseSky = {
    createSkyRenderer,
  };
})();
