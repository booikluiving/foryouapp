"use strict";

// Dezelfde indeling van het universum als op het zaalscherm, maar dan op de server uitgerekend,
// zodat een telefoon alleen vaste posities krijgt en zelf niets hoeft te rekenen.
// De rekencode staat in de browserbestanden van het zaalscherm (sky-data-adapter.js en
// sky-renderer.js). Die worden hier gelezen, niet aangepast: de functies van networkLayout worden
// eruit geknipt en in een afgesloten vm gedraaid. Lukt dat niet (bestand veranderd), dan valt de
// indeling terug op een eenvoudige ringindeling. Nooit een fout naar de telefoon.

const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const PUBLIC = path.join(__dirname, "public");

const MODULE_FUNCTIES = [
  "networkPolarForPoint", "shortestAngleDiff", "networkRingPoint", "bboxForPoints", "clamp", "stableHash", "stableUnit",
  "networkEdgeCurve",
];
const RENDERER_FUNCTIES = [
  "networkNodeRadius", "networkNodePathSet", "sharedSetCount", "parseNetworkDirection", "sortedNetworkRoots",
  "buildNetworkAdjacency", "networkDepthInfo", "networkTargetForNode", "networkLayout",
];

// Knipt `function naam(...) { ... }` uit de bron door accolades te tellen (strings en commentaar
// tellen mee als ze accolades bevatten; in deze functies komt dat niet voor, en anders faalt de
// controle hieronder en geldt de terugvaltindeling).
function knip(bron, naam) {
  const begin = bron.search(new RegExp(`\\bfunction ${naam}\\(`));
  if (begin < 0) throw new Error(`functie_ontbreekt:${naam}`);
  const open = bron.indexOf("{", bron.indexOf(")", begin));
  let diepte = 0;
  for (let i = open; i < bron.length; i += 1) {
    if (bron[i] === "{") diepte += 1;
    else if (bron[i] === "}") {
      diepte -= 1;
      if (diepte === 0) return bron.slice(begin, i + 1);
    }
  }
  throw new Error(`functie_niet_af:${naam}`);
}

function constanten(bron) {
  return bron.split("\n")
    .filter((regel) => /^ {2}const (NETWORK_[A-Z_]+|W|H|SKY_CX|SKY_CY) = /.test(regel))
    .join("\n");
}

let rekenaar = null;

function laadRekenaar() {
  if (rekenaar) return rekenaar;
  const renderer = fs.readFileSync(path.join(PUBLIC, "sky-renderer.js"), "utf8");
  const adapter = fs.readFileSync(path.join(PUBLIC, "sky-data-adapter.js"), "utf8");
  const layout = fs.readFileSync(path.join(PUBLIC, "sky-layout.js"), "utf8");
  const code = [
    "\"use strict\";",
    constanten(renderer),
    ...MODULE_FUNCTIES.map((naam) => knip(renderer, naam)),
    ...RENDERER_FUNCTIES.map((naam) => knip(renderer, naam)),
    "globalThis.__layout = networkLayout;",
    "globalThis.__bocht = networkEdgeCurve;",
  ].join("\n\n");
  const context = vm.createContext({ window: {}, Math, Map, Set, Number, String, Array, Object, Boolean, Infinity, JSON });
  vm.runInContext(layout, context, { timeout: 2000 });
  context.window.ForUniverseLayout = context.window.ForUniverseLayout || {};
  vm.runInContext(adapter, context, { timeout: 2000 });
  vm.runInContext(code, context, { timeout: 2000 });
  rekenaar = { buildSkyModel: context.window.ForUniverseData.buildSkyModel, layout: context.__layout, bocht: context.__bocht, context };
  return rekenaar;
}

function ringIndeling(graph) {
  const nodes = (graph.networkMap && graph.networkMap.nodes) || [];
  const pos = new Map();
  nodes.forEach((node, index) => {
    const hoek = (index / Math.max(1, nodes.length)) * Math.PI * 2;
    pos.set(Number(node.sceneId), { x: 400 * Math.cos(hoek), y: 260 * Math.sin(hoek) });
  });
  return { pos, bron: "ring" };
}

// graph = universe-state.graph → Map sceneId → {x, y}, rond (0,0).
function telefoonIndeling(graph) {
  try {
    const { buildSkyModel, layout, bocht } = laadRekenaar();
    const model = buildSkyModel(graph, null);
    const uitkomst = layout(model.networkMap || { nodes: [], edges: [] });
    const pos = new Map();
    for (const [sceneId, punt] of uitkomst.pos) {
      if (!Number.isFinite(punt.x) || !Number.isFinite(punt.y)) throw new Error("ongeldig_punt");
      pos.set(Number(sceneId), punt);
    }
    if (!pos.size) throw new Error("lege_indeling");
    // De banen zoals het zaalscherm ze tekent: per lijn twee steunpunten van een bocht.
    const bochten = new Map();
    for (const edge of (model.networkMap && model.networkMap.edges) || []) {
      if (!edge || edge.isLoop) continue;
      const a = pos.get(Number(edge.fromSceneId));
      const b = pos.get(Number(edge.toSceneId));
      if (!a || !b) continue;
      try {
        const { c1, c2 } = bocht(a, b, edge);
        if ([c1.x, c1.y, c2.x, c2.y].every(Number.isFinite)) bochten.set(`${Number(edge.fromSceneId)}-${Number(edge.toSceneId)}`, [c1.x, c1.y, c2.x, c2.y]);
      } catch (_err) {
        // Zonder bocht: rechte lijn.
      }
    }
    return { pos, bochten, bron: "zaalscherm" };
  } catch (err) {
    rekenaar = null;
    const terug = ringIndeling(graph);
    terug.fout = String(err && err.message || err);
    return terug;
  }
}

module.exports = { telefoonIndeling, knip };
