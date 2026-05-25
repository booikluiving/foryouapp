(function initPadenLayoutRelaxer(root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
  } else {
    root.PadenLayoutRelaxer = factory();
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function createPadenLayoutRelaxer() {
  "use strict";

  function numberValue(value, fallback = 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  }

  function point(value = {}) {
    return {
      x: numberValue(value.x),
      y: numberValue(value.y),
    };
  }

  function rectForPosition(position, options) {
    const padding = numberValue(options.padding, 0);
    const width = numberValue(options.nodeWidth, 170);
    const height = numberValue(options.nodeHeight, 46);
    return {
      left: position.x - padding,
      top: position.y - padding,
      right: position.x + width + padding,
      bottom: position.y + height + padding,
    };
  }

  function rectsOverlap(a, b) {
    return !!(a && b && a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top);
  }

  function collides(position, occupied, options) {
    const rect = rectForPosition(position, options);
    return occupied.some((other) => rectsOverlap(rect, other));
  }

  function pathIdsForNode(node) {
    return (Array.isArray(node && node.pathIds) ? node.pathIds : [])
      .map((id) => String(id || ""))
      .filter(Boolean);
  }

  function priorityForNode(node, activePathId) {
    const pathIds = pathIdsForNode(node);
    if (activePathId && pathIds.includes(String(activePathId))) return 0;
    if (pathIds.length > 1 || node && node.isShared) return 1;
    return 2;
  }

  function horizontalCandidateOffsets(options) {
    const stepX = numberValue(options.nodeWidth, 170) + numberValue(options.padding, 14) * 2 + numberValue(options.visualGap, 4);
    const maxRing = numberValue(options.maxRing, 10);
    const offsets = [{ x: 0, y: 0, score: 0 }];

    for (let ring = 1; ring <= maxRing; ring += 1) {
      const right = ring * stepX;
      const left = -ring * stepX;
      offsets.push({ x: right, y: 0, score: right });
      offsets.push({ x: left, y: 0, score: right + 4 });
    }

    return offsets.sort((a, b) => a.score - b.score || a.x - b.x);
  }

  function compactCandidatePositions(basePosition, rowOccupied, options) {
    const width = numberValue(options.nodeWidth, 170);
    const padding = numberValue(options.padding, 14);
    const gap = numberValue(options.visualGap, 4);
    const y = Math.round(basePosition.y);
    const candidates = [];
    rowOccupied.forEach((rect) => {
      candidates.push({
        x: Math.round(rect.right + padding + gap),
        y,
      });
      candidates.push({
        x: Math.round(rect.left - width - padding - gap),
        y,
      });
    });
    return candidates.sort((a, b) => (
      Math.abs(a.x - basePosition.x) - Math.abs(b.x - basePosition.x)
      || b.x - a.x
    ));
  }

  function findOpenPosition(basePosition, occupied, options, rowOccupied = []) {
    const baseCollides = collides(basePosition, occupied, options);
    if (!baseCollides) return basePosition;

    const compactCandidates = compactCandidatePositions(basePosition, rowOccupied, options);
    for (const candidate of compactCandidates) {
      if (!collides(candidate, occupied, options)) return candidate;
    }

    const offsets = horizontalCandidateOffsets(options);
    for (const offset of offsets) {
      const candidate = {
        x: Math.round(basePosition.x + offset.x),
        y: Math.round(basePosition.y + offset.y),
      };
      if (!collides(candidate, occupied, options)) return candidate;
    }
    const last = offsets[offsets.length - 1] || { x: 0, y: 0 };
    return {
      x: Math.round(basePosition.x + last.x),
      y: Math.round(basePosition.y + last.y),
    };
  }

  function rowForEntry(rows, entry, tolerance) {
    let nearest = null;
    let nearestDistance = Infinity;
    for (const row of rows) {
      const distance = Math.abs(row.y - entry.basePosition.y);
      if (distance <= tolerance && distance < nearestDistance) {
        nearest = row;
        nearestDistance = distance;
      }
    }
    if (nearest) return nearest;
    const row = { y: entry.basePosition.y, entries: [] };
    rows.push(row);
    return row;
  }

  function rowEntrySort(a, b) {
    return (
      a.basePosition.x - b.basePosition.x
      || a.priority - b.priority
      || Number(a.node.sceneId || 0) - Number(b.node.sceneId || 0)
      || a.index - b.index
    );
  }

  function compactRowTargets(entries, rowY, options) {
    const sorted = entries.slice().sort(rowEntrySort);
    const targets = new Map();
    if (!sorted.length) return targets;

    const spacing = (
      numberValue(options.nodeWidth, 170)
      + numberValue(options.padding, 14) * 2
      + numberValue(options.visualGap, 4)
    );
    const centerX = sorted.reduce((sum, entry) => sum + entry.basePosition.x, 0) / sorted.length;
    let anchorIndex = 0;
    sorted.forEach((entry, index) => {
      const anchor = sorted[anchorIndex];
      const entryIsBetter = (
        entry.priority < anchor.priority
        || (
          entry.priority === anchor.priority
          && Math.abs(entry.basePosition.x - centerX) < Math.abs(anchor.basePosition.x - centerX)
        )
      );
      if (entryIsBetter) anchorIndex = index;
    });

    targets.set(sorted[anchorIndex], {
      x: sorted[anchorIndex].basePosition.x,
      y: rowY,
    });

    for (let index = anchorIndex + 1; index < sorted.length; index += 1) {
      const previous = targets.get(sorted[index - 1]);
      targets.set(sorted[index], {
        x: Math.min(sorted[index].basePosition.x, previous.x + spacing),
        y: rowY,
      });
    }

    for (let index = anchorIndex - 1; index >= 0; index -= 1) {
      const next = targets.get(sorted[index + 1]);
      targets.set(sorted[index], {
        x: Math.max(sorted[index].basePosition.x, next.x - spacing),
        y: rowY,
      });
    }

    return targets;
  }

  function clonePathPositions(pathPositions) {
    const output = new Map();
    if (!(pathPositions instanceof Map)) return output;
    pathPositions.forEach((positions, key) => {
      const cloned = {};
      Object.entries(positions || {}).forEach(([sceneId, position]) => {
        cloned[sceneId] = point(position);
      });
      output.set(String(key), cloned);
    });
    return output;
  }

  function neutralResult(nodes, pathPositions) {
    const positions = {};
    const relaxOffsets = new Map();
    const nextNodes = (Array.isArray(nodes) ? nodes : []).map((node) => {
      const basePosition = point(node && node.position);
      positions[Number(node.sceneId || 0)] = basePosition;
      relaxOffsets.set(Number(node.sceneId || 0), { x: 0, y: 0 });
      return {
        ...node,
        basePosition,
        position: basePosition,
        relaxOffset: { x: 0, y: 0 },
        collisionRelaxed: false,
      };
    });
    return {
      enabled: false,
      nodes: nextNodes,
      pathPositions: clonePathPositions(pathPositions),
      positions,
      relaxOffsets,
    };
  }

  function relaxLayout(options = {}) {
    const nodes = Array.isArray(options.nodes) ? options.nodes : [];
    const visiblePathCount = numberValue(options.visiblePathCount, 1);
    const enabled = options.enabled !== false && visiblePathCount > 1 && nodes.length > 1;
    if (!enabled) return neutralResult(nodes, options.pathPositions);

    const activePathId = String(options.activePathId || "");
    const relaxOptions = {
      nodeWidth: numberValue(options.nodeWidth, 170),
      nodeHeight: numberValue(options.nodeHeight, 46),
      padding: numberValue(options.padding, 14),
      visualGap: numberValue(options.visualGap, 4),
      maxRing: numberValue(options.maxRing, 10),
    };
    const displayBySceneId = new Map();
    const occupied = [];

    const entries = nodes
      .map((node, index) => ({
        node,
        index,
        basePosition: point(node && node.position),
        priority: priorityForNode(node, activePathId),
      }))
      .sort((a, b) => (
        a.priority - b.priority
        || a.basePosition.y - b.basePosition.y
        || a.basePosition.x - b.basePosition.x
        || Number(a.node.sceneId || 0) - Number(b.node.sceneId || 0)
        || a.index - b.index
      ));
    const rowTolerance = numberValue(options.rowTolerance, Math.max(18, relaxOptions.nodeHeight * 0.72));
    const rows = [];
    entries.forEach((entry) => {
      const row = rowForEntry(rows, entry, rowTolerance);
      row.entries.push(entry);
    });
    rows
      .sort((a, b) => a.y - b.y)
      .forEach((row) => {
        const rowOccupied = [];
        const rowTargets = compactRowTargets(row.entries, row.y, relaxOptions);
        row.entries
          .sort((a, b) => (
            a.priority - b.priority
            || a.basePosition.x - b.basePosition.x
            || Number(a.node.sceneId || 0) - Number(b.node.sceneId || 0)
            || a.index - b.index
          ))
          .forEach((entry) => {
            const sceneId = Number(entry.node.sceneId || 0);
            const rowPosition = rowTargets.get(entry) || {
              x: entry.basePosition.x,
              y: row.y,
            };
            const position = findOpenPosition(rowPosition, occupied, relaxOptions, rowOccupied);
            const relaxOffset = {
              x: Math.round(position.x - entry.basePosition.x),
              y: Math.round(position.y - entry.basePosition.y),
            };
            displayBySceneId.set(sceneId, {
              basePosition: entry.basePosition,
              position,
              relaxOffset,
              collisionRelaxed: !!(relaxOffset.x || relaxOffset.y),
            });
            const rect = rectForPosition(position, relaxOptions);
            occupied.push(rect);
            rowOccupied.push(rect);
          });
      });

    const positions = {};
    const relaxOffsets = new Map();
    const nextNodes = nodes.map((node) => {
      const sceneId = Number(node.sceneId || 0);
      const display = displayBySceneId.get(sceneId) || {
        basePosition: point(node && node.position),
        position: point(node && node.position),
        relaxOffset: { x: 0, y: 0 },
        collisionRelaxed: false,
      };
      positions[sceneId] = display.position;
      relaxOffsets.set(sceneId, display.relaxOffset);
      return {
        ...node,
        basePosition: display.basePosition,
        position: display.position,
        relaxOffset: display.relaxOffset,
        collisionRelaxed: display.collisionRelaxed,
      };
    });

    const nextPathPositions = clonePathPositions(options.pathPositions);
    nextPathPositions.forEach((pathPositionMap) => {
      Object.keys(pathPositionMap).forEach((sceneId) => {
        const display = displayBySceneId.get(Number(sceneId));
        if (!display) return;
        pathPositionMap[sceneId] = display.position;
      });
    });

    return {
      enabled: true,
      nodes: nextNodes,
      pathPositions: nextPathPositions,
      positions,
      relaxOffsets,
    };
  }

  return {
    relaxLayout,
    rectForPosition,
    rectsOverlap,
  };
});
