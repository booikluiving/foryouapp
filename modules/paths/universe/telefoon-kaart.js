"use strict";

// Kaart van het universum voor de publiekstelefoon: posities (zelfde indeling als het zaalscherm),
// lijnen, paden, en per scène titel, personages per plek en omgeving. Zonder run-stand: welke
// scènes open zijn en wat het publiek ervan mag zien, bepaalt de publieksdienst.
// De indeling kost ruim een seconde rekenen; dat gebeurt in een eigen thread en alleen als de
// paden of scènes veranderd zijn, zodat de padendienst (en het zaalscherm) er niet op wacht.

const crypto = require("node:crypto");
const path = require("node:path");
const { Worker } = require("node:worker_threads");
const { buildPathsUniverseState } = require("./build-universe-state");
const { buildPathsEditorState } = require("../read-model/build-editor-state");

const SCHEMA = "for-you.telefoon-kaart.v0";

const cache = { handtekening: "", kaart: null, bezig: null };

function rekenIndeling(graph) {
  return new Promise((resolve) => {
    let klaar = false;
    const worker = new Worker(path.join(__dirname, "telefoon-indeling-worker.js"), { workerData: { graph } });
    const stop = setTimeout(() => {
      if (klaar) return;
      klaar = true;
      worker.terminate().catch(() => {});
      resolve(null);
    }, 20000);
    worker.once("message", (uitkomst) => {
      if (klaar) return;
      klaar = true;
      clearTimeout(stop);
      worker.terminate().catch(() => {});
      resolve(uitkomst);
    });
    worker.once("error", () => {
      if (klaar) return;
      klaar = true;
      clearTimeout(stop);
      resolve(null);
    });
  });
}

function naamVan(lijst) {
  return new Map((Array.isArray(lijst) ? lijst : []).map((item) => [Number(item.id), String(item.name || "").replace(/_/g, " ").trim()]));
}

function bouwKaartInhoud(graph, catalog, posities, bochten = {}) {
  const personages = naamVan(catalog.characters);
  const omgevingen = naamVan(catalog.environments);
  const sceneInfo = new Map((catalog.scenes || []).map((scene) => [Number(scene.id), scene]));
  const nodes = (graph.networkMap && graph.networkMap.nodes) || [];
  // Posities rond (0,0) en afgerond: kleiner bestand, telefoon hoeft niet te schalen.
  const punten = nodes.map((node) => posities[Number(node.sceneId)]).filter(Boolean);
  const midX = punten.length ? (Math.min(...punten.map((p) => p[0])) + Math.max(...punten.map((p) => p[0]))) / 2 : 0;
  const midY = punten.length ? (Math.min(...punten.map((p) => p[1])) + Math.max(...punten.map((p) => p[1]))) / 2 : 0;
  const scenes = nodes.map((node) => {
    const id = Number(node.sceneId);
    const info = sceneInfo.get(id) || {};
    const punt = posities[id] || [midX, midY];
    const plekken = Array.isArray(info.characterSlots) ? info.characterSlots.slice(0, Math.max(1, Number(info.characterCount || 0))) : [];
    return {
      id,
      x: Math.round(punt[0] - midX),
      y: Math.round(punt[1] - midY),
      t: String(info.title || node.title || "").trim(),
      w: plekken.map((karakter) => (Number(karakter) ? personages.get(Number(karakter)) || null : null)),
      o: omgevingen.get(Number(info.environmentId)) || null,
    };
  });
  const lijnen = ((graph.networkMap && graph.networkMap.edges) || [])
    .filter((edge) => edge && !edge.isLoop)
    .map((edge) => {
      const a = Number(edge.fromSceneId), b = Number(edge.toSceneId);
      // [van, naar] of met bocht [van, naar, c1x, c1y, c2x, c2y], in dezelfde ruimte als de sterren.
      const bocht = bochten[`${a}-${b}`];
      if (!bocht) return [a, b];
      return [a, b, Math.round(bocht[0] - midX), Math.round(bocht[1] - midY), Math.round(bocht[2] - midX), Math.round(bocht[3] - midY)];
    });
  const paden = (graph.paths || [])
    .filter((pad) => pad && pad.isActive && !pad.archivedAt)
    .map((pad) => ({
      id: Number(pad.pathId),
      n: String(pad.name || ""),
      c: String(pad.color || ""),
      s: (pad.nodes || []).map((node) => Number(node.sceneId)),
      e: (pad.edges || []).filter((edge) => edge && edge.valid !== false).map((edge) => [Number(edge.fromSceneId), Number(edge.toSceneId)]),
    }));
  return { scenes, lijnen, paden };
}

async function buildTelefoonKaart(options = {}) {
  const [universe, editorState] = await Promise.all([
    buildPathsUniverseState({ ...options, runtimeOverlay: false }),
    buildPathsEditorState(options),
  ]);
  const graph = universe.graph;
  const catalog = (editorState && editorState.catalog) || {};
  const handtekening = crypto.createHash("sha1")
    .update(JSON.stringify(["bochten-1", graph.networkMap, graph.paths.map((pad) => [pad.pathId, pad.name, pad.color, pad.isActive, pad.nodes.map((n) => n.sceneId), pad.edges.map((e) => [e.fromSceneId, e.toSceneId])]),
      (catalog.scenes || []).map((s) => [s.id, s.title, s.characterSlots, s.characterCount, s.environmentId]),
      (catalog.characters || []).map((c) => [c.id, c.name]), (catalog.environments || []).map((e) => [e.id, e.name])]))
    .digest("hex").slice(0, 12);
  if (cache.kaart && cache.handtekening === handtekening) return cache.kaart;
  if (cache.bezig && cache.bezig.handtekening === handtekening) return cache.bezig.belofte;
  const belofte = (async () => {
    const uitkomst = await rekenIndeling(graph);
    const posities = (uitkomst && uitkomst.posities) || {};
    const kaart = {
      ok: true,
      schema: SCHEMA,
      versie: handtekening,
      indeling: (uitkomst && uitkomst.bron) || "geen",
      ...bouwKaartInhoud(graph, catalog, posities, (uitkomst && uitkomst.bochten) || {}),
    };
    // Zonder indeling geen cache: de volgende vraag probeert het opnieuw.
    if (uitkomst) {
      cache.kaart = kaart;
      cache.handtekening = handtekening;
    }
    return kaart;
  })();
  cache.bezig = { handtekening, belofte };
  try {
    return await belofte;
  } finally {
    if (cache.bezig && cache.bezig.belofte === belofte) cache.bezig = null;
  }
}

module.exports = { buildTelefoonKaart, bouwKaartInhoud, SCHEMA };
