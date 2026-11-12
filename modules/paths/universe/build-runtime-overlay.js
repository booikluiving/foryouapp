"use strict";

// Stand van de lopende voorstelling voor het universum: wat is vrij, wat is gespeeld, wat
// speelt nu. Tijdens de stemming op de startscène komen de stemmen per scène erbij.

function baseUrl(envName, fallback) {
  return String(process.env[envName] || fallback).replace(/\/+$/, "");
}

async function fetchJson(url, timeoutMs = 1200) {
  const controller = new AbortController();
  const timeout = setTimeout(() => {
    try { controller.abort(); } catch {}
  }, timeoutMs);
  try {
    const response = await fetch(url, { signal: controller.signal, headers: { Accept: "application/json" } });
    if (!response.ok) return null;
    return await response.json();
  } catch (_err) {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

function sceneIdVan(item) {
  if (!item) return 0;
  const direct = Number(item.legacySituationId);
  if (Number.isInteger(direct) && direct > 0) return direct;
  const match = /(\d+)$/.exec(String(item.situationId || item.id || ""));
  return match ? Number(match[1]) : 0;
}

function buildRuntimeOverlay(view, stemming) {
  if (!view || !view.pathEvaluation || !Array.isArray(view.pathEvaluation.items)) return null;
  const items = view.pathEvaluation.items;
  const metStatus = (status) => items.filter((item) => item && item.status === status).map(sceneIdVan).filter(Boolean);
  const played = new Set(metStatus("played"));
  for (const item of view.playedSituations || []) {
    const id = sceneIdVan(item);
    if (id) played.add(id);
  }
  const currentId = sceneIdVan(view.activeSituation);
  const prepared = view.preparedNext || null;
  const preparedId = sceneIdVan(prepared);
  // Vóór de eerste scène staat de automatische keuze van de runtime niet uitgelicht: alle
  // startscènes zijn dan gelijk. Pas een gekozen scène (de winnaar) licht op als volgende.
  const begin = !currentId && played.size === 0;
  const toonPrepared = preparedId && (!begin || prepared.reason === "operator_chosen");

  let stem = null;
  if (stemming && Array.isArray(stemming.keuzes) && stemming.keuzes.length
    && (!stemming.showRunId || !view.showRunId || stemming.showRunId === view.showRunId)
    && begin && (stemming.actief || stemming.uitslag)) {
    const stemmen = stemming.keuzes.map((keuze) => ({ sceneId: sceneIdVan(keuze), votes: Number(keuze.votes || 0) })).filter((keuze) => keuze.sceneId);
    const hoogste = Math.max(0, ...stemmen.map((keuze) => keuze.votes));
    stem = {
      actief: !!stemming.actief,
      totalVotes: Number(stemming.totalVotes || 0),
      stemmen,
      koplopers: hoogste > 0 ? stemmen.filter((keuze) => keuze.votes === hoogste).map((keuze) => keuze.sceneId) : [],
      winnaar: stemming.uitslag ? sceneIdVan(stemming.uitslag) : 0,
    };
  }

  return {
    session: { id: view.showRunId || "voorbeeld", isActive: true, algorithmRunStarted: true },
    summary: { hasActiveRun: true },
    currentScene: currentId ? { sceneId: currentId } : null,
    playedSceneIds: [...played],
    preparedNextScenes: toonPrepared ? [{ sceneId: preparedId }] : [],
    availableScenes: metStatus("available").filter((id) => !played.has(id)).map((sceneId) => ({ sceneId })),
    blockedSceneIds: metStatus("blocked"),
    lockedSceneIds: metStatus("locked"),
    stem,
  };
}

async function fetchRuntimeOverlay() {
  const [view, stemming] = await Promise.all([
    fetchJson(`${baseUrl("PATHS_RUNTIME_URL", "http://127.0.0.1:3024")}/v0/runtime/runs/current/view`),
    fetchJson(`${baseUrl("PATHS_AUDIENCE_URL", "http://127.0.0.1:3026")}/audience/stage/start-stemming`),
  ]);
  return buildRuntimeOverlay(view, stemming && stemming.ok ? stemming : null);
}

module.exports = { buildRuntimeOverlay, fetchRuntimeOverlay };
