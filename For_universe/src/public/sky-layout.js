(function () {
  "use strict";

  const SHAPES = {
    zigzag: [[0, 0], [42, -26], [80, 2], [122, -22], [160, 8]],
    arc: [[0, 4], [34, -18], [72, -28], [114, -20], [152, 2]],
    fork: [[0, 0], [36, -12], [74, -22], [68, -50], [112, -18], [150, -2]],
    Y: [[0, 0], [36, -18], [72, -4], [44, -40], [44, -72]],
    curveDown: [[0, -8], [28, 12], [64, 24], [100, 16], [136, -8]],
    longZig: [[0, 0], [24, -12], [48, 4], [72, -16], [96, 4], [122, -10], [150, 6]],
    spiral: [[0, 0], [28, -18], [60, -22], [80, -6], [64, 16], [34, 18]],
    triangle: [[0, 0], [60, -12], [34, -38], [68, -48]],
    diag: [[0, 4], [26, -14], [52, -30], [80, -50], [110, -66]],
    Sshape: [[0, 4], [34, -12], [12, -32], [44, -50], [20, -70]],
    box: [[0, 0], [42, 2], [44, -30], [2, -32], [22, -16], [64, -16]],
    bolt: [[0, 0], [24, -16], [50, -26], [36, -46], [64, -58]],
    chevron: [[0, 4], [34, -22], [68, 4], [34, 28]],
    hook: [[0, 0], [30, -12], [64, -12], [88, 2], [80, 28], [48, 30]],
    hookL: [[0, 0], [30, -12], [64, -12], [88, 2], [80, 28]],
  };

  const SHAPE_KEYS = Object.keys(SHAPES);

  const DEFAULT_COLORS = [
    "#f4b6c2",
    "#b4cde8",
    "#e8d4a0",
    "#c8b4e8",
    "#b4e8c8",
    "#e8c4a8",
    "#a8d4e8",
    "#e8b4d8",
    "#d8b4e8",
    "#b4e8d8",
  ];

  function stableHash(value) {
    const text = String(value ?? "");
    let hash = 2166136261;
    for (let i = 0; i < text.length; i += 1) {
      hash ^= text.charCodeAt(i);
      hash = Math.imul(hash, 16777619);
    }
    return hash >>> 0;
  }

  function distance(a, b) {
    return Math.hypot((b[0] || 0) - (a[0] || 0), (b[1] || 0) - (a[1] || 0));
  }

  function interpolate(a, b, t) {
    return [
      (a[0] || 0) + ((b[0] || 0) - (a[0] || 0)) * t,
      (a[1] || 0) + ((b[1] || 0) - (a[1] || 0)) * t,
    ];
  }

  function resampleShape(points, count) {
    if (!count) return [];
    if (count === 1) return [[0, 0]];
    const safePoints = Array.isArray(points) && points.length > 1 ? points : [[0, 0], [120, 0]];
    const segments = [];
    let total = 0;

    for (let i = 1; i < safePoints.length; i += 1) {
      const from = safePoints[i - 1];
      const to = safePoints[i];
      const length = Math.max(distance(from, to), 1);
      segments.push({ from, to, start: total, end: total + length, length });
      total += length;
    }

    if (!segments.length || !total) {
      return Array.from({ length: count }, (_, index) => [index * 28, 0]);
    }

    return Array.from({ length: count }, (_, index) => {
      const target = (index / Math.max(count - 1, 1)) * total;
      const segment = segments.find((item) => target <= item.end) || segments[segments.length - 1];
      const local = (target - segment.start) / segment.length;
      return interpolate(segment.from, segment.to, Math.min(Math.max(local, 0), 1));
    });
  }

  function bboxForShape(shape) {
    if (!shape.length) {
      return { minX: 0, minY: 0, maxX: 0, maxY: 0, w: 1, h: 1, cx: 0, cy: 0 };
    }
    const xs = shape.map((point) => point[0] || 0);
    const ys = shape.map((point) => point[1] || 0);
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const minY = Math.min(...ys);
    const maxY = Math.max(...ys);
    return {
      minX,
      minY,
      maxX,
      maxY,
      w: Math.max(maxX - minX, 1),
      h: Math.max(maxY - minY, 1),
      cx: (minX + maxX) / 2,
      cy: (minY + maxY) / 2,
    };
  }

  function shapeKeyForPath(pathItem, index) {
    const seed = stableHash(`${pathItem.pathId || pathItem.id || index}:${index}`);
    return SHAPE_KEYS[(seed + index) % SHAPE_KEYS.length];
  }

  function colorForPath(pathItem, index) {
    const cleanColor = String(pathItem.color || "").trim();
    if (cleanColor) return cleanColor;
    return DEFAULT_COLORS[index % DEFAULT_COLORS.length];
  }

  function applyLayout(paths) {
    return (Array.isArray(paths) ? paths : []).map((pathItem, index) => {
      const shapeKey = pathItem.shapeKey || shapeKeyForPath(pathItem, index);
      const template = SHAPES[shapeKey] || SHAPES.zigzag;
      const shape = resampleShape(template, Array.isArray(pathItem.nodeIds) ? pathItem.nodeIds.length : 0);
      return {
        ...pathItem,
        color: colorForPath(pathItem, index),
        shapeKey,
        shape,
        bbox: bboxForShape(shape),
      };
    });
  }

  window.ForUniverseLayout = {
    SHAPES,
    SHAPE_KEYS,
    DEFAULT_COLORS,
    applyLayout,
    bboxForShape,
    resampleShape,
    shapeKeyForPath,
  };
})();
