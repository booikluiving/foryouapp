"use strict";

// Geluid: volume van het sfeergeluid en het extra geluid per omgeving, om in de zaal af te
// stellen. Van de omgeving die nu in de show staat is de schuif van het sfeergeluid meteen
// te horen (Show Control -> TouchDesigner) en speelt Speel het extra geluid in de zaal.
// Loslaten = bewaren in de catalogus (net als in de catalogus zelf).

const NIEUW_SINDS = "2026-11-11T14:00:00Z";
const state = {
  catalog: null,
  liveId: "",
  liveNaam: "",
  liveBericht: "",
  zenden: false,
  wachtend: null,
  bewaarTimers: {},
  herteken: false,
};

const $ = (id) => document.getElementById(id);
const esc = (value) => String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

async function requestJson(path, options = {}) {
  const response = await fetch(path, { cache: "no-store", ...options });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const err = new Error(body.message || body.error || `fout ${response.status}`);
    err.body = body;
    throw err;
  }
  return body;
}

function jsonOptions(method, body) {
  return { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) };
}

function aanwezig(asset) {
  return asset && asset.status !== "replaced" && asset.status !== "deleted" && !asset.archivedAt;
}

function extrasVan(item) {
  const bron = item && item.extras && typeof item.extras === "object" ? item.extras : {};
  return {
    shot: { ...(bron.shot || {}) },
    geluid: { volume: 1, ...(bron.geluid || {}) },
    sfeer: { volume: 1, ...(bron.sfeer || {}) },
  };
}

function sfeerAsset(envId) {
  const assets = (state.catalog.mediaAssets || []).filter((a) => aanwezig(a) && a.environmentId === envId && (a.role === "soundscape" || a.type === "soundscape"));
  const comp = (state.catalog.environmentCompositions || []).find((c) => c.environmentId === envId);
  const gekozen = comp && comp.soundscapeLayer && comp.soundscapeLayer.assetId;
  return (gekozen && assets.find((a) => a.id === gekozen)) || assets[0] || null;
}

function geluidAsset(item) {
  const geluid = extrasVan(item).geluid;
  if (geluid.bron !== "bestand" || !geluid.bestand) return null;
  return (state.catalog.mediaAssets || []).find((a) => aanwezig(a) && a.id === geluid.bestand) || null;
}

function isNieuw(asset) {
  return Boolean(asset && String(asset.createdAt || "") > NIEUW_SINDS);
}

function omgevingen() {
  return (state.catalog.environments || [])
    .filter((item) => item.active !== false && !item.archivedAt)
    .map((item) => ({ item, sfeer: sfeerAsset(item.id), geluid: geluidAsset(item) }))
    .filter((row) => row.sfeer || row.geluid)
    .sort((a, b) => String(a.item.name || "").localeCompare(String(b.item.name || ""), "nl"));
}

function rijHtml(row, kind, live) {
  const asset = row[kind];
  if (!asset) return "";
  const extras = extrasVan(row.item);
  const pct = Math.round(Number(extras[kind].volume ?? 1) * 100);
  const naam = kind === "sfeer" ? "Sfeer" : (extras.geluid.label || "Extra geluid");
  const knop = kind === "geluid"
    ? `<button class="fy-button" type="button" data-speel="${esc(row.item.id)}" ${live ? "" : "disabled title=\"Alleen voor de omgeving die nu in de show staat\""}>Speel / stop</button>`
    : `<span></span>`;
  return `
    <div class="geluid-rij">
      <label>${esc(naam)} ${isNieuw(asset) ? `<span class="geluid-tag">nieuw</span>` : ""}<small>${esc(asset.originalFilename || asset.filename)}</small></label>
      <input type="range" min="0" max="100" step="1" value="${pct}" data-env="${esc(row.item.id)}" data-kind="${kind}">
      <span class="geluid-pct" data-pct="${esc(row.item.id)}:${kind}">${pct}%</span>
      ${knop}
    </div>`;
}

function omgevingHtml(row, live) {
  return `
    <div class="geluid-omg ${live ? "is-live" : ""}" data-omg="${esc(row.item.id)}">
      <div class="geluid-naam">${esc(row.item.name || row.item.id)} ${live ? "<small>nu in de show</small>" : ""}</div>
      ${rijHtml(row, "sfeer", live)}
      ${rijHtml(row, "geluid", live)}
      <div class="geluid-status" data-status="${esc(row.item.id)}"></div>
    </div>`;
}

function teken() {
  if (document.activeElement && document.activeElement.type === "range") {
    state.herteken = true;
    return;
  }
  state.herteken = false;
  const rows = omgevingen();
  const live = rows.find((row) => row.item.id === state.liveId) || null;
  $("nu").textContent = state.liveBericht
    || (state.liveId ? `In de show: ${state.liveNaam || state.liveId}${live ? "" : " (geen geluid in de catalogus)"}` : "Er staat geen omgeving in de show.");
  $("liveBlok").innerHTML = live ? omgevingHtml(live, true) : "";
  const rest = rows.filter((row) => row !== live);
  const nieuw = rest.filter((row) => isNieuw(row.sfeer) || isNieuw(row.geluid));
  $("nieuwLijst").innerHTML = nieuw.map((row) => omgevingHtml(row, false)).join("") || `<div class="geluid-status">-</div>`;
  $("restLijst").innerHTML = rest.filter((row) => !nieuw.includes(row)).map((row) => omgevingHtml(row, false)).join("");
}

function zetStatus(envId, tekst) {
  document.querySelectorAll(`[data-status="${CSS.escape(envId)}"]`).forEach((el) => { el.textContent = tekst; });
}

function itemVan(envId) {
  return (state.catalog.environments || []).find((item) => item.id === envId) || null;
}

function zetVolume(envId, kind, waarde) {
  const item = itemVan(envId);
  if (!item) return;
  const extras = extrasVan(item);
  extras[kind].volume = Math.max(0, Math.min(1, waarde));
  item.extras = extras;
  document.querySelectorAll(`[data-pct="${CSS.escape(`${envId}:${kind}`)}"]`).forEach((el) => { el.textContent = `${Math.round(waarde * 100)}%`; });
}

// Het laatste volume naar de zaal; nooit meer dan één verzoek tegelijk.
function stuurSfeer(envId) {
  const item = itemVan(envId);
  if (!item || envId !== state.liveId) return;
  state.wachtend = { environmentId: envId, volume: extrasVan(item).sfeer.volume };
  if (state.zenden) return;
  const volgende = state.wachtend;
  state.wachtend = null;
  state.zenden = true;
  requestJson("/v0/catalog/zaal/sfeer-volume", jsonOptions("POST", volgende))
    .catch((err) => {
      zetStatus(envId, err.body && err.body.error === "andere_omgeving" ? "In de show staat intussen een andere omgeving." : `Niet doorgegeven: ${err.message}`);
      peil();
    })
    .finally(() => {
      state.zenden = false;
      if (state.wachtend) stuurSfeer(state.wachtend.environmentId);
    });
}

function bewaarStraks(envId) {
  clearTimeout(state.bewaarTimers[envId]);
  zetStatus(envId, "Nog niet bewaard...");
  state.bewaarTimers[envId] = setTimeout(() => bewaar(envId), 700);
}

async function bewaar(envId) {
  delete state.bewaarTimers[envId];
  const item = itemVan(envId);
  if (!item) return;
  try {
    await requestJson(`/v0/catalog/environments/${encodeURIComponent(envId)}`, jsonOptions("PATCH", {
      name: item.name || "",
      description: item.description || "",
      extras: extrasVan(item),
    }));
    zetStatus(envId, "Bewaard.");
  } catch (err) {
    zetStatus(envId, `Niet bewaard: ${err.message}`);
  }
}

async function speel(envId) {
  const item = itemVan(envId);
  if (!item) return;
  zetStatus(envId, "Speelt in de zaal...");
  try {
    await requestJson("/v0/catalog/zaal/extra-geluid", jsonOptions("POST", { environmentId: envId, volume: extrasVan(item).geluid.volume }));
    zetStatus(envId, "");
  } catch (err) {
    zetStatus(envId, err.body && err.body.error === "andere_omgeving" ? "In de show staat intussen een andere omgeving." : `Niet gespeeld: ${err.message}`);
    peil();
  }
}

async function laad() {
  state.catalog = await requestJson("/v0/catalog/read-model");
  $("topMeta").textContent = "Loslaten = bewaren";
}

async function peil() {
  if (document.hidden) return;
  let id = "";
  let naam = "";
  let bericht = "";
  try {
    const data = await requestJson("/v0/catalog/zaal");
    id = String(data.environmentId || "");
    naam = String(data.environmentName || "");
  } catch (_err) {
    bericht = "Show Control is niet bereikbaar.";
  }
  if (id !== state.liveId || bericht !== state.liveBericht) {
    state.liveId = id;
    state.liveNaam = naam;
    state.liveBericht = bericht;
    if (Object.keys(state.bewaarTimers).length === 0) await laad().catch(() => {});
    teken();
  } else if (state.herteken) {
    teken();
  }
}

document.addEventListener("input", (event) => {
  const el = event.target;
  if (el.type !== "range" || !el.dataset.env) return;
  zetVolume(el.dataset.env, el.dataset.kind, Number(el.value) / 100);
  if (el.dataset.kind === "sfeer") stuurSfeer(el.dataset.env);
});

document.addEventListener("change", (event) => {
  const el = event.target;
  if (el.type !== "range" || !el.dataset.env) return;
  bewaarStraks(el.dataset.env);
  el.blur();
  if (state.herteken) setTimeout(teken, 50);
});

document.addEventListener("click", (event) => {
  const knop = event.target.closest("[data-speel]");
  if (knop) speel(knop.dataset.speel);
});

document.addEventListener("visibilitychange", peil);

(async () => {
  try {
    await laad();
  } catch (err) {
    $("topMeta").textContent = `Catalogus niet bereikbaar: ${err.message}`;
    return;
  }
  await peil();
  teken();
  setInterval(peil, 2000);
})();
