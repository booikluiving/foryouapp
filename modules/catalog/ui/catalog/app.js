"use strict";

const state = {
  catalog: null,
  validation: null,
  meting: null,
  levelsDraft: {},
  editing: {
    performer: null,
    character: null,
    environment: null,
    situation: null,
  },
};
const NEW_ITEM_ID = "__new__";

// Extra shot en extra geluid per omgeving (twee knoppen op de Stream Deck).
const EXTRA_SHOT_SOURCES = [
  ["", "Nog niets"],
  ["achtergrond", "Achtergrond van deze omgeving"],
  ["bestand", "Eigen beeld of video"],
  ["camera", "Camera"],
];
const EXTRA_SOUND_SOURCES = [
  ["", "Nog niets"],
  ["bestand", "Eigen geluid"],
];
const EXTRA_ROLES = { shot: "extraShot", geluid: "extraGeluid" };
const DECK_COLORS = { shot: "#2563ff", geluid: "#ff2fa0" };

const $ = (id) => document.getElementById(id);

function esc(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;",
  })[char]);
}

async function requestJson(path, options = {}) {
  const response = await fetch(path, options);
  const body = await response.json();
  if (!response.ok) {
    const err = new Error(body.message || body.error || `Request failed: ${response.status}`);
    err.body = body;
    throw err;
  }
  return body;
}

function jsonOptions(method, body) {
  return {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  };
}

function active(items) {
  return (items || []).filter((item) => item.active !== false && !item.archivedAt);
}

function byId(items, id) {
  return (items || []).find((item) => item.id === id) || null;
}

function issueHtml(issue) {
  const severity = issue.severity || "error";
  return `<div class="issue ${esc(severity)}">${esc(issue.message || issue.code || issue)}</div>`;
}

function formIssueHtml(error) {
  const issues = error && error.body && Array.isArray(error.body.issues) ? error.body.issues : [];
  if (!issues.length) return `<div class="issue error">${esc(error.message || error)}</div>`;
  return issues.map(issueHtml).join("");
}

function selectedChecks(containerId) {
  const container = $(containerId);
  if (!container) return [];
  return Array.from(container.querySelectorAll("input[type='checkbox']:checked")).map((input) => input.value);
}

function performerSlotLabel(slot) {
  const number = Number(slot || 0);
  return number > 0 ? `Performer ${number}` : "Geen vast slot";
}

function performerLabel(id) {
  const performer = byId(state.catalog ? state.catalog.performers : [], id);
  if (!performer) return id || "Alle";
  return performer.name || performer.id;
}

function characterLabel(id) {
  const character = byId(state.catalog ? state.catalog.characters : [], id);
  return character ? character.name || character.id : id;
}

function environmentLabel(id) {
  const environment = byId(state.catalog ? state.catalog.environments : [], id);
  return environment ? environment.name || environment.id : id || "Geen omgeving";
}

function describePerformerIds(ids) {
  return ids && ids.length ? ids.map(performerLabel).join(", ") : "Alle";
}

function isEditing(kind, id) {
  return state.editing[kind] === id;
}

function optionHtml(value, label, selectedValue) {
  const selected = String(value || "") === String(selectedValue || "") ? " selected" : "";
  return `<option value="${esc(value)}"${selected}>${esc(label)}</option>`;
}

function presentAssets(environmentId) {
  return (state.catalog.mediaAssets || []).filter((asset) => (
    asset.environmentId === environmentId
    && asset.status === "present"
  ));
}

function assetBadges(environmentId) {
  const byType = new Set(presentAssets(environmentId).map((asset) => asset.type));
  const items = [
    ["background", "BG", "fy-badge-bad"],
    ["soundscape", "Audio", "fy-badge-bad"],
    ["fx", "FX", ""],
  ];
  return items.map(([type, label, missingClass]) => {
    const present = byType.has(type) || (type === "soundscape" && byType.has("audio"));
    const className = present ? "fy-badge-good" : missingClass;
    return `<span class="fy-badge ${esc(className)}">${esc(label)} ${present ? "OK" : "mist"}</span>`;
  }).join("");
}

function situationIssues(item) {
  if (!state.validation || !Array.isArray(state.validation.issues)) return [];
  return state.validation.issues.filter((issue) => issue.entityType === "situation" && issue.entityId === item.id);
}

function renderTopMeta() {
  const counts = state.catalog.counts || {};
  $("topMeta").textContent = [
    `${counts.activeCharacters || 0}/${counts.characters || 0} personages`,
    `${counts.activeEnvironments || 0}/${counts.environments || 0} omgevingen`,
    `${counts.activeSituations || 0}/${counts.situations || 0} situaties`,
    `${counts.presentMediaAssets || 0} media-assets`,
    `bijgewerkt ${new Date(state.catalog.generatedAt).toLocaleString("nl-NL")}`,
  ].join(" · ");
}

function renderPerformerControls() {
  const performers = active(state.catalog.performers);
  $("performerSlotOverview").innerHTML = [1, 2, 3].map((slot) => {
    const performer = performers.find((item) => Number(item.performerSlot || 0) === slot);
    return `
      <div class="fy-slot-cell slotCell">
        <strong>Performer ${slot}</strong>
        <span>${esc(performer ? performer.name : "vrij")}</span>
        ${performer ? `<button class="fy-button performerEditButton" type="button" data-edit-performer="${esc(performer.id)}">Pas aan</button>` : ""}
      </div>
    `;
  }).join("");

  const unassigned = performers.filter((performer) => Number(performer.performerSlot || 0) < 1);
  $("performersList").innerHTML = unassigned.map((performer) => `
    <div class="fy-list-item">
      <div class="itemTop">
        <div class="nameLine">
          <strong>${esc(performer.name || "Naamloos")}</strong>
          <span class="fy-small">Geen vast slot</span>
        </div>
        <button class="fy-button performerEditButton" type="button" data-edit-performer="${esc(performer.id)}">Pas aan</button>
      </div>
    </div>
  `).join("");
}

function characterPerformersHtml(selectedIds = []) {
  const selected = new Set(selectedIds || []);
  const performers = active(state.catalog.performers);
  return performers.map((performer) => `
    <label class="check">
      <input type="checkbox" value="${esc(performer.id)}"${selected.has(performer.id) ? " checked" : ""}>
      <span>${esc(performerLabel(performer.id))}</span>
    </label>
  `).join("") || `<div class="fy-small">Geen performers beschikbaar.</div>`;
}

function characterFormHtml(item = null) {
  return `
    <div id="characterForm" class="fy-stack inlineForm" data-inline-form="character">
      <label class="fy-label">Naam<input id="characterName" class="fy-input" maxlength="120" value="${esc(item ? item.name || "" : "")}"></label>
      <div class="fy-stack">
        <span class="fy-field-label">Wordt gespeeld door</span>
        <div id="characterPerformers" class="checkGrid">${characterPerformersHtml(item ? item.performerIds || [] : [])}</div>
        <div class="fy-small">Geen selectie betekent: Alle.</div>
      </div>
      <label class="fy-label">Omschrijving<textarea id="characterDescription" class="fy-textarea">${esc(item ? item.description || "" : "")}</textarea></label>
      <div class="fy-actions">
        <button id="saveCharacterBtn" class="fy-button fy-button-primary" type="button">Opslaan</button>
        <button id="cancelCharacterBtn" class="fy-button" type="button">Annuleer</button>
      </div>
      <div id="characterIssues" class="issues"></div>
    </div>
  `;
}

function emptyExtras() {
  return {
    shot: { label: "", omschrijving: "", bron: "", bestand: "", camera: 1, duur: 4 },
    geluid: { label: "", omschrijving: "", bron: "", bestand: "", volume: 1 },
    sfeer: { volume: 1 },
  };
}

function cloneExtras(extras) {
  const base = emptyExtras();
  const source = extras && typeof extras === "object" ? extras : {};
  return {
    shot: { ...base.shot, ...(source.shot || {}) },
    geluid: { ...base.geluid, ...(source.geluid || {}) },
    sfeer: { ...base.sfeer, ...(source.sfeer || {}) },
  };
}

function extrasFor(item) {
  const id = item ? item.id : NEW_ITEM_ID;
  if (state.extrasDraft && state.extrasDraft.id === id) return state.extrasDraft.extras;
  return cloneExtras(item ? item.extras : null);
}

function extraAssets(environmentId, kind) {
  if (!environmentId) return [];
  return presentAssets(environmentId).filter((asset) => asset.role === EXTRA_ROLES[kind]);
}

function assetFileUrl(asset) {
  return asset ? `/v0/catalog/media-assets/file/${encodeURIComponent(asset.id)}` : "";
}

function deckKeyHtml(kind, extra) {
  // Zoals het deck: breekt op een spatie en na een "-".
  const lines = String(extra.label || "").toUpperCase().replace(/-/g, "-\n").split(/\n|\s+/).filter(Boolean).slice(0, 3);
  const empty = !extra.label;
  return `
    <div class="deckKey ${empty ? "is-empty" : ""}" style="--deck-color:${DECK_COLORS[kind]}">
      <span>${lines.length ? lines.map(esc).join("<br>") : kind === "shot" ? "SHOT" : "GELUID"}</span>
      ${empty || !extra.bron ? `<small>LEEG</small>` : ""}
    </div>
  `;
}

function shotPreviewHtml(environmentId, shot) {
  if (shot.bron === "camera") return `<div class="fy-small">Knop schakelt naar camera ${esc(shot.camera || 1)}.</div>`;
  let asset = null;
  if (shot.bron === "achtergrond") {
    asset = presentAssets(environmentId).find((item) => item.type === "background") || null;
    if (!asset) return `<div class="fy-small">Deze omgeving heeft nog geen achtergrond.</div>`;
  }
  if (shot.bron === "bestand") asset = extraAssets(environmentId, "shot").find((item) => item.id === shot.bestand) || null;
  if (!asset) return "";
  const url = assetFileUrl(asset);
  const isVideo = /^video\//.test(asset.mimeType || "") || /\.(mp4|mov|m4v|webm)$/i.test(asset.filename || "");
  return isVideo
    ? `<video class="extraPreview" src="${esc(url)}" muted controls preload="metadata"></video>`
    : `<img class="extraPreview" src="${esc(url)}" alt="">`;
}

function soundPreviewHtml(environmentId, geluid) {
  if (geluid.bron !== "bestand") return "";
  const asset = extraAssets(environmentId, "geluid").find((item) => item.id === geluid.bestand) || null;
  if (!asset) return "";
  return `<label class="fy-label">Luister (in deze browser)<audio class="extraPreview" src="${esc(assetFileUrl(asset))}" controls preload="none" data-level-audio="geluid"></audio></label>`;
}

// Geluidsniveaus: meting (geluidsniveaus-meting.json, per bestandsnaam) en volume.
// sfeer = soundscape van de omgeving (TD, extras.sfeer.volume),
// geluid = extra geluid (afplay, extras.geluid.volume). Beide 0-100%.
function soundscapeAssetFor(environmentId) {
  if (!environmentId || !state.catalog) return null;
  const assets = presentAssets(environmentId).filter((asset) => asset.type === "soundscape" || asset.role === "soundscape");
  const composition = (state.catalog.environmentCompositions || []).find((item) => item.environmentId === environmentId);
  const chosen = composition && composition.soundscapeLayer && composition.soundscapeLayer.assetId;
  return (chosen && assets.find((asset) => asset.id === chosen)) || assets[0] || null;
}

function extraSoundAssetFor(environmentId, geluid) {
  if (!geluid || geluid.bron !== "bestand") return null;
  return extraAssets(environmentId, "geluid").find((item) => item.id === geluid.bestand) || null;
}

function levelAssetFor(environmentId, kind, extras) {
  return kind === "sfeer" ? soundscapeAssetFor(environmentId) : extraSoundAssetFor(environmentId, extras.geluid);
}

function metingFor(asset) {
  if (!asset || !state.meting || !state.meting.bestanden) return null;
  return state.meting.bestanden[asset.filename] || null;
}

function fmtDb(value, sign = false) {
  if (!Number.isFinite(value)) return "-";
  const text = Math.abs(value).toFixed(1).replace(".", ",");
  if (value < 0 && text !== "0,0") return `\u2212${text}`;
  return sign && text !== "0,0" ? `+${text}` : text;
}

function volumeDb(volume) {
  const v = Number(volume);
  return v > 0 ? 20 * Math.log10(v) : -Infinity;
}

// Hoe het klinkt met dit volume, ten opzichte van de rest (mediaan van de meting).
function levelJudgement(kind, meting, volume) {
  if (!meting || !state.meting) return null;
  const config = state.meting[kind === "sfeer" ? "sfeer" : "extra"];
  const base = kind === "sfeer" ? meting.lufs : meting.luidst;
  const level = base + volumeDb(volume);
  const diff = level - config.referentie;
  const verdict = !Number.isFinite(diff) ? "uit" : diff > config.grens.teHard ? "te hard" : diff < config.grens.teZacht ? "te zacht" : "ok";
  return { level, diff, verdict, peak: meting.truePeak + volumeDb(volume) };
}

function levelInfoHtml(kind, meting, volume, compact = false) {
  if (!state.meting) return "";
  if (!meting) return `<span class="fy-small">${compact ? "niet gemeten" : "Dit bestand is nog niet gemeten."}</span>`;
  const judgement = levelJudgement(kind, meting, volume);
  if (compact) {
    const clip = Number.isFinite(judgement.peak) && judgement.peak >= -1 ? " \u00b7 clipt" : "";
    const title = `${fmtDb(judgement.level)} LUFS ${kind === "sfeer" ? "gemiddeld" : "luidste moment"}; ${(meting.opmerkingen || []).join("; ")}`;
    return `<span title="${esc(title)}"><span class="levelVerdict is-${esc(judgement.verdict.replace(" ", "-"))}">${esc(judgement.verdict)}</span> ${fmtDb(judgement.diff, true)}${clip}</span>`;
  }
  const maat = kind === "sfeer" ? "gemiddeld" : "luidste moment";
  const pct = Math.round(Number(volume) * 100);
  const parts = [
    `<span class="levelVerdict is-${esc(judgement.verdict.replace(" ", "-"))}">${esc(judgement.verdict)}</span>`,
    `met ${pct}%: ${fmtDb(judgement.level)} LUFS ${maat}, ${fmtDb(judgement.diff, true)} t.o.v. de rest`,
  ];
  if (Number.isFinite(judgement.peak) && judgement.peak >= -1) parts.push(`piek ${fmtDb(judgement.peak, true)} dBTP: clipt`);
  return parts.join(" \u00b7 ");
}

function levelProposalHtml(kind, meting) {
  if (!meting) return "";
  const notes = (meting.opmerkingen || []).map((note) => `<li>${esc(note)}</li>`).join("");
  const harder = meting.voorstelDb > 0
    ? ` Harder dan 100% kan niet: dit bestand zou ${fmtDb(meting.voorstelDb, true)} dB moeten.`
    : "";
  return `
    <div class="fy-small levelProposal">
      Gemeten ${esc(state.meting.gemeten || "")}: ${fmtDb(kind === "sfeer" ? meting.lufs : meting.luidst)} LUFS, piek ${fmtDb(meting.truePeak, true)} dBTP.
      Voorstel ${esc(meting.voorstelVolume)}%.${esc(harder)}
      <button class="fy-button levelTake" type="button" data-level-take="${esc(kind)}" data-level-value="${esc(meting.voorstelVolume)}">Neem ${esc(meting.voorstelVolume)}% over</button>
      ${notes ? `<ul class="levelNotes">${notes}</ul>` : ""}
    </div>
  `;
}

function sfeerLevelHtml(item, extras) {
  const environmentId = item ? item.id : "";
  const asset = soundscapeAssetFor(environmentId);
  if (!asset) return `<fieldset class="extraField"><legend>Sfeergeluid</legend><div class="fy-small">Deze omgeving heeft nog geen sfeergeluid.</div></fieldset>`;
  const meting = metingFor(asset);
  const volume = extras.sfeer.volume;
  const start = meting && meting.luidstOp ? Math.max(0, meting.luidstOp - 3) : 0;
  return `
    <fieldset class="extraField">
      <legend>Sfeergeluid</legend>
      <div class="fy-small">${esc(asset.originalFilename || asset.filename || asset.id)}</div>
      <label class="fy-label">Volume (%)
        <input class="fy-input" type="number" min="0" max="100" step="1" data-extra="sfeer" data-field="volume" value="${esc(Math.round(Number(volume ?? 1) * 100))}">
      </label>
      <div class="levelInfo" data-level-info="sfeer">${levelInfoHtml("sfeer", meting, volume)}</div>
      ${levelProposalHtml("sfeer", meting)}
      <label class="fy-label">Luister (in deze browser)<audio class="extraPreview" src="${esc(assetFileUrl(asset))}" controls preload="none" data-level-audio="sfeer"></audio></label>
      ${meting && start ? `<button class="fy-button" type="button" data-level-seek="${esc(start)}">Luister vanaf het luidste moment</button>` : ""}
    </fieldset>
  `;
}

function extraLevelHtml(item, extras) {
  const meting = metingFor(extraSoundAssetFor(item ? item.id : "", extras.geluid));
  return `
    <div class="levelInfo" data-level-info="geluid">${levelInfoHtml("geluid", meting, extras.geluid.volume)}</div>
    ${levelProposalHtml("geluid", meting)}
  `;
}

// Na tekenen of na een wijziging: meting en luistervolume bijwerken.
function syncLevelUi() {
  const form = document.querySelector("[data-extras-form]");
  if (!form || !state.editing.environment) return;
  const extras = readExtrasForm();
  ["sfeer", "geluid"].forEach((kind) => {
    const volume = Math.min(1, Math.max(0, Number(extras[kind].volume)));
    const info = form.querySelector(`[data-level-info="${kind}"]`);
    if (info) info.innerHTML = levelInfoHtml(kind, metingFor(levelAssetFor(state.editing.environment, kind, extras)), volume);
    form.querySelectorAll(`[data-level-audio="${kind}"]`).forEach((audio) => { audio.volume = volume; });
  });
}

function fileOptionsHtml(environmentId, kind, selected) {
  const assets = extraAssets(environmentId, kind);
  return optionHtml("", assets.length ? "Kies een bestand" : "Nog geen bestand", selected)
    + assets.map((asset) => optionHtml(asset.id, asset.originalFilename || asset.filename || asset.id, selected)).join("");
}

function uploadHtml(item, kind) {
  if (!item) return `<div class="fy-small">Sla de omgeving eerst op om een bestand toe te voegen.</div>`;
  const accept = kind === "shot" ? "image/*,video/*" : "audio/*";
  return `
    <label class="fy-label">Bestand toevoegen
      <input class="fy-input" type="file" accept="${accept}" data-extra-upload="${kind}">
    </label>
    <div class="fy-small" data-extra-upload-status="${kind}"></div>
  `;
}

function extrasFormHtml(item) {
  const environmentId = item ? item.id : "";
  const extras = extrasFor(item);
  const shot = extras.shot;
  const geluid = extras.geluid;
  const cameraOptions = [1, 2, 3].map((n) => optionHtml(String(n), `Camera ${n}`, String(shot.camera || 1))).join("");
  return `
    <div class="extrasBlock" data-extras-form>
      <div class="extrasHead">
        <strong>Stream Deck</strong>
        <div class="deckPreview">${deckKeyHtml("shot", shot)}${deckKeyHtml("geluid", geluid)}</div>
      </div>
      <fieldset class="extraField">
        <legend>Extra shot</legend>
        <label class="fy-label">Knoplabel<input class="fy-input" maxlength="24" placeholder="Shot kruip-ruimte" data-extra="shot" data-field="label" value="${esc(shot.label)}"></label>
        <label class="fy-label">Wat zie je<textarea class="fy-textarea extraText" data-extra="shot" data-field="omschrijving">${esc(shot.omschrijving)}</textarea></label>
        <label class="fy-label">Bron<select class="fy-select" data-extra="shot" data-field="bron">
          ${EXTRA_SHOT_SOURCES.map(([value, label]) => optionHtml(value, label, shot.bron)).join("")}
        </select></label>
        ${shot.bron === "bestand" ? `
          <label class="fy-label">Bestand<select class="fy-select" data-extra="shot" data-field="bestand">${fileOptionsHtml(environmentId, "shot", shot.bestand)}</select></label>
          ${uploadHtml(item, "shot")}
        ` : ""}
        ${shot.bron === "camera" ? `<label class="fy-label">Camera<select class="fy-select" data-extra="shot" data-field="camera">${cameraOptions}</select></label>` : ""}
        ${shot.bron === "achtergrond" || shot.bron === "bestand" ? `
          <label class="fy-label">Hoe lang in beeld (seconden, 0 = tot je opnieuw drukt)
            <input class="fy-input" type="number" min="0" max="120" step="1" data-extra="shot" data-field="duur" value="${esc(shot.duur)}">
          </label>
        ` : ""}
        ${shotPreviewHtml(environmentId, shot)}
      </fieldset>
      <fieldset class="extraField">
        <legend>Extra geluid</legend>
        <label class="fy-label">Knoplabel<input class="fy-input" maxlength="24" placeholder="Fiets-bel" data-extra="geluid" data-field="label" value="${esc(geluid.label)}"></label>
        <label class="fy-label">Wat hoor je<textarea class="fy-textarea extraText" data-extra="geluid" data-field="omschrijving">${esc(geluid.omschrijving)}</textarea></label>
        <label class="fy-label">Bron<select class="fy-select" data-extra="geluid" data-field="bron">
          ${EXTRA_SOUND_SOURCES.map(([value, label]) => optionHtml(value, label, geluid.bron)).join("")}
        </select></label>
        ${geluid.bron === "bestand" ? `
          <label class="fy-label">Bestand<select class="fy-select" data-extra="geluid" data-field="bestand">${fileOptionsHtml(environmentId, "geluid", geluid.bestand)}</select></label>
          ${uploadHtml(item, "geluid")}
          <label class="fy-label">Volume (%)
            <input class="fy-input" type="number" min="0" max="100" step="5" data-extra="geluid" data-field="volume" value="${esc(Math.round(Number(geluid.volume ?? 1) * 100))}">
          </label>
          ${extraLevelHtml(item, extras)}
        ` : ""}
        ${soundPreviewHtml(environmentId, geluid)}
      </fieldset>
      <div class="extrasHead"><strong>Geluidsniveau</strong></div>
      ${sfeerLevelHtml(item, extras)}
    </div>
  `;
}

function readExtrasForm() {
  const id = state.editing.environment;
  const extras = cloneExtras(state.extrasDraft && state.extrasDraft.id === id ? state.extrasDraft.extras : null);
  document.querySelectorAll("[data-extras-form] [data-extra][data-field]").forEach((field) => {
    const kind = field.getAttribute("data-extra");
    const name = field.getAttribute("data-field");
    let value = field.value;
    if (name === "camera" || name === "duur") value = Number(value || 0);
    if (name === "volume") value = Math.min(100, Math.max(0, Number(value || 0))) / 100;
    if (!extras[kind]) extras[kind] = {};
    extras[kind][name] = value;
  });
  return extras;
}

function rememberExtrasDraft() {
  if (!state.editing.environment || !document.querySelector("[data-extras-form]")) return;
  state.extrasDraft = { id: state.editing.environment, extras: readExtrasForm() };
}

async function uploadExtraFile(input) {
  const kind = input.getAttribute("data-extra-upload");
  const file = input.files && input.files[0];
  const environmentId = state.editing.environment;
  if (!file || !environmentId || environmentId === NEW_ITEM_ID) return;
  const status = document.querySelector(`[data-extra-upload-status="${kind}"]`);
  rememberExtrasDraft();
  if (status) status.textContent = "Uploaden...";
  const form = new FormData();
  form.set("environmentId", environmentId);
  form.set("type", "extra");
  form.set("role", EXTRA_ROLES[kind]);
  form.set("tags", `extra,${kind}`);
  form.set("asset", file, file.name);
  try {
    const result = await requestJson("/v0/catalog/media-assets/upload", { method: "POST", body: form });
    state.extrasDraft.extras[kind].bron = "bestand";
    state.extrasDraft.extras[kind].bestand = result.asset.id;
    const name = $("environmentName") ? $("environmentName").value : "";
    const description = $("environmentDescription") ? $("environmentDescription").value : "";
    await loadAll();
    if ($("environmentName")) $("environmentName").value = name;
    if ($("environmentDescription")) $("environmentDescription").value = description;
  } catch (err) {
    if (status) status.innerHTML = formIssueHtml(err) || esc(err.message || "Upload mislukt.");
  }
}

function environmentFormHtml(item = null) {
  return `
    <div id="environmentForm" class="fy-stack inlineForm" data-inline-form="environment">
      <label class="fy-label">Naam<input id="environmentName" class="fy-input" maxlength="140" value="${esc(item ? item.name || "" : "")}"></label>
      <label class="fy-label">Omschrijving<textarea id="environmentDescription" class="fy-textarea">${esc(item ? item.description || "" : "")}</textarea></label>
      ${extrasFormHtml(item)}
      <div class="fy-actions">
        <button id="saveEnvironmentBtn" class="fy-button fy-button-primary" type="button">Opslaan</button>
        <button id="cancelEnvironmentBtn" class="fy-button" type="button">Annuleer</button>
      </div>
      <div id="environmentIssues" class="issues"></div>
    </div>
  `;
}

function situationCharacterSlotsHtml(selectedIds = []) {
  const characters = active(state.catalog.characters);
  const options = (selectedValue) => (
    optionHtml("", "Geen personage", selectedValue)
    + characters.map((character) => optionHtml(character.id, character.name || character.id, selectedValue)).join("")
  );
  return [0, 1, 2].map((index) => `
    <label class="fy-label">Personage ${index + 1}
      <select class="fy-select" data-situation-character-slot="${index}">${options(selectedIds[index] || "")}</select>
    </label>
  `).join("");
}

function situationFormHtml(item = null) {
  const selectedIds = item ? item.characterIds || [] : [];
  const environments = active(state.catalog.environments);
  const environmentOptions = optionHtml("", "Kies omgeving", item ? item.environmentId || "" : "")
    + environments.map((environment) => (
      optionHtml(environment.id, environment.name || environment.id, item ? item.environmentId || "" : "")
    )).join("");
  return `
    <div id="situationForm" class="fy-stack inlineForm" data-inline-form="situation">
      <label class="fy-label">Naam<input id="situationTitle" class="fy-input" maxlength="180" value="${esc(item ? item.title || "" : "")}"></label>
      <div id="situationCharacterSlots" class="fy-stack">${situationCharacterSlotsHtml(selectedIds)}</div>
      <div id="sceneCharacterSlotsHint" class="fy-small"></div>
      <label class="fy-label">Omgeving<select id="situationEnvironment" class="fy-select">${environmentOptions}</select></label>
      <label class="fy-label">Omschrijving<textarea id="situationDescription" class="fy-textarea">${esc(item ? item.description || "" : "")}</textarea></label>
      <div class="fy-actions">
        <button id="saveSituationBtn" class="fy-button fy-button-primary" type="button">Opslaan</button>
        <button id="cancelSituationBtn" class="fy-button" type="button">Annuleer</button>
      </div>
      <div id="situationIssues" class="issues"></div>
    </div>
  `;
}

function renderCharacters() {
  const items = active(state.catalog.characters);
  const rows = items.map((item) => {
    const open = isEditing("character", item.id);
    return `
      <div class="fy-list-item catalog-row ${open ? "is-expanded" : ""}">
        <button class="catalogRowHeader" type="button" data-toggle-character="${esc(item.id)}">
          <div class="itemTop">
            <div class="nameLine">
              <strong>${esc(item.name || "Naamloos")}</strong>
              <span class="fy-small">${esc(describePerformerIds(item.performerIds || []))}</span>
            </div>
            <span class="fy-badge">actief</span>
          </div>
        </button>
        ${open ? characterFormHtml(item) : ""}
      </div>
    `;
  });
  if (state.editing.character === NEW_ITEM_ID) {
    rows.unshift(`
      <div class="fy-list-item catalog-row is-expanded is-new">
        <button class="catalogRowHeader" type="button" data-toggle-character="${NEW_ITEM_ID}">
          <div class="itemTop">
            <div class="nameLine">
              <strong>Nieuw personage</strong>
              <span class="fy-small">Nog niet opgeslagen</span>
            </div>
            <span class="fy-badge">nieuw</span>
          </div>
        </button>
        ${characterFormHtml(null)}
      </div>
    `);
  }
  $("charactersList").innerHTML = rows.join("") || `<div class="fy-small">Geen personages.</div>`;
}

function renderEnvironments() {
  const items = active(state.catalog.environments);
  const rows = items.map((item) => {
    const open = isEditing("environment", item.id);
    return `
      <div class="fy-list-item catalog-row ${open ? "is-expanded" : ""}">
        <button class="catalogRowHeader" type="button" data-toggle-environment="${esc(item.id)}">
          <div class="itemTop">
            <div class="nameLine">
              <strong>${esc(item.name || "Naamloos")}</strong>
            </div>
            <span class="fy-badge">actief</span>
          </div>
        </button>
        <div class="assetBadges">${assetBadges(item.id)}</div>
        <a class="rowLink" href="/catalog/media-assets/?environmentId=${encodeURIComponent(item.id)}">Assets beheren</a>
        ${open ? environmentFormHtml(item) : ""}
      </div>
    `;
  });
  if (state.editing.environment === NEW_ITEM_ID) {
    rows.unshift(`
      <div class="fy-list-item catalog-row is-expanded is-new">
        <button class="catalogRowHeader" type="button" data-toggle-environment="${NEW_ITEM_ID}">
          <div class="itemTop">
            <div class="nameLine">
              <strong>Nieuwe omgeving</strong>
              <span class="fy-small">Nog niet opgeslagen</span>
            </div>
            <span class="fy-badge">nieuw</span>
          </div>
        </button>
        ${environmentFormHtml(null)}
      </div>
    `);
  }
  $("environmentsList").innerHTML = rows.join("") || `<div class="fy-small">Geen omgevingen.</div>`;
}

// Overzicht: alle omgevingen naast elkaar, volumes invullen en in één keer bewaren.
function levelValue(item, kind) {
  const draft = state.levelsDraft[item.id];
  if (draft && Number.isFinite(draft[kind])) return draft[kind];
  return Number(cloneExtras(item.extras)[kind].volume ?? 1);
}

function levelCellHtml(item, kind) {
  const extras = cloneExtras(item.extras);
  const asset = levelAssetFor(item.id, kind, extras);
  if (!asset) return `<td class="fy-small">-</td><td></td><td></td>`;
  const meting = metingFor(asset);
  const volume = levelValue(item, kind);
  const dirty = state.levelsDraft[item.id] && Number.isFinite(state.levelsDraft[item.id][kind]);
  const proposal = meting && Math.round(volume * 100) !== meting.voorstelVolume ? `<button class="fy-button levelTake" type="button" data-levels-take="${esc(item.id)}" data-level-kind="${kind}" data-level-value="${esc(meting.voorstelVolume)}">voorstel ${esc(meting.voorstelVolume)}%</button>` : "";
  return `
    <td><input class="fy-input levelInput ${dirty ? "is-dirty" : ""}" type="number" min="0" max="100" step="1" data-levels-env="${esc(item.id)}" data-level-kind="${kind}" value="${esc(Math.round(volume * 100))}"></td>
    <td><button class="fy-button levelPlay" type="button" data-levels-play="${esc(item.id)}" data-level-kind="${kind}" title="Luister (in deze browser)">\u25b6</button></td>
    <td class="levelInfoCell" data-levels-info="${esc(item.id)}:${kind}">${levelInfoHtml(kind, meting, volume, true)} ${proposal}</td>
  `;
}

function renderLevels() {
  const target = $("levelsList");
  if (!target) return;
  const items = active(state.catalog.environments);
  const dirtyCount = Object.keys(state.levelsDraft).length;
  $("levelsStatus").textContent = dirtyCount ? `${dirtyCount} omgeving(en) gewijzigd, nog niet bewaard.` : "";
  target.innerHTML = `
    <table class="levelsTable">
      <thead><tr>
        <th>Omgeving</th>
        <th colspan="3">Sfeergeluid</th>
        <th>Extra geluid</th>
        <th colspan="3"></th>
      </tr></thead>
      <tbody>${items.map((item) => {
        const label = cloneExtras(item.extras).geluid.label;
        return `<tr>
          <td><strong>${esc(item.name || item.id)}</strong></td>
          ${levelCellHtml(item, "sfeer")}
          <td class="fy-small">${esc(label || "")}</td>
          ${levelCellHtml(item, "geluid")}
        </tr>`;
      }).join("")}</tbody>
    </table>
  `;
}

function setLevelDraft(environmentId, kind, percent) {
  const value = Math.min(100, Math.max(0, Number(percent) || 0)) / 100;
  const item = byId(state.catalog.environments, environmentId);
  if (!item) return;
  const saved = Number(cloneExtras(item.extras)[kind].volume ?? 1);
  const draft = { ...(state.levelsDraft[environmentId] || {}) };
  if (Math.abs(saved - value) < 0.001) delete draft[kind];
  else draft[kind] = value;
  if (Object.keys(draft).length) state.levelsDraft[environmentId] = draft;
  else delete state.levelsDraft[environmentId];
  const info = document.querySelector(`[data-levels-info="${CSS.escape(environmentId)}:${kind}"]`);
  if (info) {
    const extras = cloneExtras(item.extras);
    const meting = metingFor(levelAssetFor(environmentId, kind, extras));
    const button = meting && Math.round(value * 100) !== meting.voorstelVolume
      ? `<button class="fy-button levelTake" type="button" data-levels-take="${esc(environmentId)}" data-level-kind="${kind}" data-level-value="${esc(meting.voorstelVolume)}">voorstel ${esc(meting.voorstelVolume)}%</button>`
      : "";
    info.innerHTML = `${levelInfoHtml(kind, meting, value, true)} ${button}`;
  }
  const input = document.querySelector(`[data-levels-env="${CSS.escape(environmentId)}"][data-level-kind="${kind}"]`);
  if (input) {
    input.classList.toggle("is-dirty", Number.isFinite(draft[kind]));
    if (Number(input.value) !== Math.round(value * 100)) input.value = String(Math.round(value * 100));
  }
  if (state.levelPlaying && state.levelPlaying.id === environmentId && state.levelPlaying.kind === kind) levelAudio().volume = value;
  const dirtyCount = Object.keys(state.levelsDraft).length;
  $("levelsStatus").textContent = dirtyCount ? `${dirtyCount} omgeving(en) gewijzigd, nog niet bewaard.` : "";
}

function levelAudio() {
  if (!state.levelAudioEl) {
    state.levelAudioEl = new Audio();
    state.levelAudioEl.addEventListener("ended", () => { state.levelPlaying = null; markLevelPlaying(); });
  }
  return state.levelAudioEl;
}

function markLevelPlaying() {
  document.querySelectorAll("[data-levels-play]").forEach((button) => {
    const on = state.levelPlaying && state.levelPlaying.id === button.getAttribute("data-levels-play") && state.levelPlaying.kind === button.getAttribute("data-level-kind");
    button.textContent = on ? "\u25a0" : "\u25b6";
    button.classList.toggle("is-playing", !!on);
  });
}

function playLevel(environmentId, kind) {
  const audio = levelAudio();
  if (state.levelPlaying && state.levelPlaying.id === environmentId && state.levelPlaying.kind === kind) {
    audio.pause();
    state.levelPlaying = null;
    markLevelPlaying();
    return;
  }
  const item = byId(state.catalog.environments, environmentId);
  const asset = item ? levelAssetFor(environmentId, kind, cloneExtras(item.extras)) : null;
  if (!asset) return;
  audio.pause();
  audio.src = assetFileUrl(asset);
  audio.volume = Math.min(1, Math.max(0, levelValue(item, kind)));
  audio.currentTime = 0;
  state.levelPlaying = { id: environmentId, kind };
  audio.play().catch(() => { state.levelPlaying = null; markLevelPlaying(); });
  markLevelPlaying();
}

function fillLevelProposals() {
  active(state.catalog.environments).forEach((item) => {
    ["sfeer", "geluid"].forEach((kind) => {
      const meting = metingFor(levelAssetFor(item.id, kind, cloneExtras(item.extras)));
      if (meting) setLevelDraft(item.id, kind, meting.voorstelVolume);
    });
  });
}

async function saveLevels() {
  const ids = Object.keys(state.levelsDraft);
  if (!ids.length) return;
  const status = $("levelsStatus");
  const skipped = [];
  let saved = 0;
  for (const id of ids) {
    if (state.editing.environment === id) {
      skipped.push(id);
      continue;
    }
    const item = byId(state.catalog.environments, id);
    if (!item) continue;
    const extras = cloneExtras(item.extras);
    const draft = state.levelsDraft[id];
    if (Number.isFinite(draft.sfeer)) extras.sfeer.volume = draft.sfeer;
    if (Number.isFinite(draft.geluid)) extras.geluid.volume = draft.geluid;
    status.textContent = `Bewaren: ${item.name || id}...`;
    try {
      await requestJson(`/v0/catalog/environments/${encodeURIComponent(id)}`, jsonOptions("PATCH", {
        name: item.name || "",
        description: item.description || "",
        extras,
      }));
      delete state.levelsDraft[id];
      saved += 1;
    } catch (err) {
      status.textContent = `${item.name || id}: ${err.message || "bewaren mislukt"}`;
      await loadAll();
      return;
    }
  }
  await loadAll();
  status.textContent = `${saved} bewaard.${skipped.length ? ` ${skipped.length} niet: die omgeving staat open om te bewerken.` : ""}`;
}

function renderSituations() {
  const items = active(state.catalog.situations);
  const rows = items.map((item) => {
    const open = isEditing("situation", item.id);
    const issues = situationIssues(item);
    return `
      <div class="fy-list-item catalog-row ${open ? "is-expanded" : ""}">
        <button class="catalogRowHeader" type="button" data-toggle-situation="${esc(item.id)}">
          <div class="itemTop">
            <div class="nameLine">
              <strong>${esc(item.title || "Naamloos")}</strong>
              <span class="fy-small">${esc(environmentLabel(item.environmentId))}</span>
            </div>
            <span class="fy-badge">actief</span>
          </div>
        </button>
        <div class="fy-small">${esc((item.characterIds || []).map(characterLabel).join(", ") || "Geen personages")}</div>
        ${issues.length ? `<div class="issues">${issues.map(issueHtml).join("")}</div>` : ""}
        ${open ? situationFormHtml(item) : ""}
      </div>
    `;
  });
  if (state.editing.situation === NEW_ITEM_ID) {
    rows.unshift(`
      <div class="fy-list-item catalog-row is-expanded is-new">
        <button class="catalogRowHeader" type="button" data-toggle-situation="${NEW_ITEM_ID}">
          <div class="itemTop">
            <div class="nameLine">
              <strong>Nieuwe situatie</strong>
              <span class="fy-small">Nog niet opgeslagen</span>
            </div>
            <span class="fy-badge">nieuw</span>
          </div>
        </button>
        ${situationFormHtml(null)}
      </div>
    `);
  }
  $("situationsList").innerHTML = rows.join("") || `<div class="fy-small">Geen situaties.</div>`;
}

function selectedSituationCharacters() {
  const container = $("situationCharacterSlots");
  if (!container) return [];
  const selected = [];
  for (const select of container.querySelectorAll("select")) {
    if (select.value) selected.push(select.value);
  }
  return selected;
}

function activePerformersForCast() {
  return active(state.catalog.performers)
    .sort((a, b) => {
      const slot = Number(a.performerSlot || 0) - Number(b.performerSlot || 0);
      return slot || String(a.name || "").localeCompare(String(b.name || ""), "nl-NL");
    });
}

function performerChoices(character) {
  const performers = activePerformersForCast();
  const explicit = character && Array.isArray(character.performerIds) ? character.performerIds : [];
  if (!explicit.length) return performers.map((item) => item.id);
  const performerIds = new Set(performers.map((item) => item.id));
  return explicit.filter((id) => performerIds.has(id));
}

function canAssignCast(characters) {
  const performers = activePerformersForCast();
  const choices = characters
    .map((character, index) => ({ index, choices: performerChoices(character) }))
    .sort((a, b) => a.choices.length - b.choices.length || a.index - b.index);
  if (choices.some((item) => item.choices.length === 0)) return false;

  function search(index, usedPerformers) {
    if (index >= choices.length) return true;
    for (const performerId of choices[index].choices) {
      if (usedPerformers.has(performerId)) continue;
      usedPerformers.add(performerId);
      if (search(index + 1, usedPerformers)) return true;
      usedPerformers.delete(performerId);
    }
    return false;
  }

  return performers.length >= characters.length && search(0, new Set());
}

function renderCastPreview() {
  if (!$("sceneCharacterSlotsHint") || !$("situationIssues")) return;
  const ids = selectedSituationCharacters();
  const characters = ids.map((id) => byId(state.catalog.characters, id)).filter(Boolean);

  const issues = [];
  if (new Set(ids).size !== ids.length) issues.push({ message: "Kies elk personage maximaal een keer." });
  if (ids.length > 0 && !canAssignCast(characters)) {
    issues.push({ message: "Deze combinatie kan dezelfde performer nodig hebben en speelt dan met waarschuwing." });
  }
  $("sceneCharacterSlotsHint").textContent = ids.length ? `${ids.length} van 3 personages gekozen` : "Kies 1 tot 3 personages.";
  $("situationIssues").innerHTML = issues.map(issueHtml).join("");
}

function renderValidation() {
  const validation = state.validation || { counts: {}, issues: [] };
  const counts = validation.counts || {};
  const issues = Array.isArray(validation.issues) ? validation.issues : [];
  const visibleIssues = issues.filter((issue) => issue.severity !== "info" && issue.code !== "media_asset_missing_files");
  const hiddenCount = issues.length - visibleIssues.length;
  $("validationSummary").textContent = [
    `${counts.errors || 0} errors`,
    `${counts.warnings || 0} warnings`,
    hiddenCount > 0 ? `${hiddenCount} zachte media-meldingen verborgen` : "geen zachte media-meldingen",
  ].join(" · ");
  $("validationIssues").innerHTML = visibleIssues.slice(0, 20).map(issueHtml).join("")
    || `<div class="fy-small">Geen zichtbare issues.</div>`;
}

function renderAll() {
  if (!state.catalog) return;
  renderTopMeta();
  renderPerformerControls();
  renderCharacters();
  renderEnvironments();
  renderLevels();
  renderSituations();
  renderCastPreview();
  renderValidation();
  syncLevelUi();
}

async function loadAll() {
  const [catalog, validation] = await Promise.all([
    requestJson("/v0/catalog/read-model"),
    requestJson("/v0/catalog/validation"),
  ]);
  state.catalog = catalog;
  state.validation = validation;
  if (!state.meting) {
    try {
      state.meting = await requestJson("/catalog/geluidsniveaus-meting.json");
    } catch (_err) {
      state.meting = null;
    }
  }
  renderAll();
}

function showForm(kind, item = null) {
  if (kind === "performer") {
    state.editing[kind] = item ? item.id : null;
    $(`${kind}Form`).classList.remove("fy-hidden");
    $("performerName").value = item ? item.name || "" : "";
    $("performerSlot").value = item ? String(item.performerSlot || 0) : "0";
    $("performerIssues").innerHTML = "";
    return;
  }

  state.editing[kind] = item ? item.id : NEW_ITEM_ID;
  if (kind === "environment") state.extrasDraft = null;
  renderAll();
  const firstField = {
    character: "characterName",
    environment: "environmentName",
    situation: "situationTitle",
  }[kind];
  if (firstField && $(firstField)) $(firstField).focus();
}

function hideForm(kind) {
  if (kind === "performer" && $(`${kind}Form`)) {
    $(`${kind}Form`).classList.add("fy-hidden");
  }
  if (kind === "environment") state.extrasDraft = null;
  state.editing[kind] = null;
  if (kind !== "performer") renderAll();
}

function toggleForm(kind, item = null) {
  const id = item ? item.id : NEW_ITEM_ID;
  if (state.editing[kind] === id) hideForm(kind);
  else showForm(kind, item);
}

async function savePerformer() {
  const id = state.editing.performer;
  const body = {
    name: $("performerName").value,
    performerSlot: Number($("performerSlot").value || 0),
  };
  try {
    if (id) await requestJson(`/v0/catalog/performers/${encodeURIComponent(id)}`, jsonOptions("PATCH", body));
    else await requestJson("/v0/catalog/performers", jsonOptions("POST", body));
    hideForm("performer");
    await loadAll();
  } catch (err) {
    $("performerIssues").innerHTML = formIssueHtml(err);
  }
}

async function saveCharacter() {
  const id = state.editing.character === NEW_ITEM_ID ? "" : state.editing.character;
  const body = {
    name: $("characterName").value,
    description: $("characterDescription").value,
    performerIds: selectedChecks("characterPerformers"),
  };
  try {
    if (id) await requestJson(`/v0/catalog/characters/${encodeURIComponent(id)}`, jsonOptions("PATCH", body));
    else await requestJson("/v0/catalog/characters", jsonOptions("POST", body));
    hideForm("character");
    await loadAll();
  } catch (err) {
    $("characterIssues").innerHTML = formIssueHtml(err);
  }
}

async function saveEnvironment() {
  const id = state.editing.environment === NEW_ITEM_ID ? "" : state.editing.environment;
  const body = {
    name: $("environmentName").value,
    description: $("environmentDescription").value,
    extras: readExtrasForm(),
  };
  try {
    if (id) await requestJson(`/v0/catalog/environments/${encodeURIComponent(id)}`, jsonOptions("PATCH", body));
    else await requestJson("/v0/catalog/environments", jsonOptions("POST", body));
    hideForm("environment");
    await loadAll();
  } catch (err) {
    $("environmentIssues").innerHTML = formIssueHtml(err);
  }
}

async function saveSituation() {
  const id = state.editing.situation === NEW_ITEM_ID ? "" : state.editing.situation;
  const body = {
    title: $("situationTitle").value,
    description: $("situationDescription").value,
    environmentId: $("situationEnvironment").value,
    characterIds: selectedSituationCharacters(),
  };
  try {
    if (id) await requestJson(`/v0/catalog/situations/${encodeURIComponent(id)}`, jsonOptions("PATCH", body));
    else await requestJson("/v0/catalog/situations", jsonOptions("POST", body));
    hideForm("situation");
    await loadAll();
  } catch (err) {
    $("situationIssues").innerHTML = formIssueHtml(err);
  }
}

async function createSnapshot() {
  const result = await requestJson("/v0/catalog/snapshots", { method: "POST" });
  $("snapshotFacts").innerHTML = Object.entries({
    snapshotId: result.snapshotId,
    createdAt: result.createdAt,
    filePath: result.filePath,
  }).map(([key, value]) => `<dt>${esc(key)}</dt><dd>${esc(value)}</dd>`).join("");
}

function bindEvents() {
  $("refreshBtn").addEventListener("click", loadAll);
  $("validateBtn").addEventListener("click", loadAll);
  $("snapshotBtn").addEventListener("click", createSnapshot);
  $("newPerformerBtn").addEventListener("click", () => showForm("performer"));
  $("newCharacterBtn").addEventListener("click", () => toggleForm("character"));
  $("newEnvironmentBtn").addEventListener("click", () => toggleForm("environment"));
  $("newSituationBtn").addEventListener("click", () => toggleForm("situation"));
  $("fillLevelsBtn").addEventListener("click", fillLevelProposals);
  $("saveLevelsBtn").addEventListener("click", saveLevels);
  $("resetLevelsBtn").addEventListener("click", () => { state.levelsDraft = {}; renderLevels(); });
  $("savePerformerBtn").addEventListener("click", savePerformer);
  $("cancelPerformerBtn").addEventListener("click", () => hideForm("performer"));
  document.addEventListener("click", (event) => {
    const target = event.target;
    if (target.closest("a")) return;
    if (target.closest("#saveCharacterBtn")) {
      saveCharacter();
      return;
    }
    if (target.closest("#saveEnvironmentBtn")) {
      saveEnvironment();
      return;
    }
    if (target.closest("#saveSituationBtn")) {
      saveSituation();
      return;
    }
    if (target.closest("#cancelCharacterBtn")) {
      hideForm("character");
      return;
    }
    if (target.closest("#cancelEnvironmentBtn")) {
      hideForm("environment");
      return;
    }
    const take = target.closest("[data-level-take]");
    if (take) {
      const field = document.querySelector(`[data-extras-form] [data-extra="${take.getAttribute("data-level-take")}"][data-field="volume"]`);
      if (field) field.value = take.getAttribute("data-level-value");
      rememberExtrasDraft();
      syncLevelUi();
      return;
    }
    const seek = target.closest("[data-level-seek]");
    if (seek) {
      const audio = document.querySelector('[data-extras-form] [data-level-audio="sfeer"]');
      if (audio) {
        audio.currentTime = Number(seek.getAttribute("data-level-seek")) || 0;
        audio.play().catch(() => {});
      }
      return;
    }
    const levelsTake = target.closest("[data-levels-take]");
    if (levelsTake) {
      setLevelDraft(levelsTake.getAttribute("data-levels-take"), levelsTake.getAttribute("data-level-kind"), levelsTake.getAttribute("data-level-value"));
      return;
    }
    const levelsPlay = target.closest("[data-levels-play]");
    if (levelsPlay) {
      playLevel(levelsPlay.getAttribute("data-levels-play"), levelsPlay.getAttribute("data-level-kind"));
      return;
    }
    if (target.closest("#cancelSituationBtn")) {
      hideForm("situation");
      return;
    }
    const characterToggle = target.closest("[data-toggle-character]");
    const environmentToggle = target.closest("[data-toggle-environment]");
    const situationToggle = target.closest("[data-toggle-situation]");
    if (characterToggle) {
      const id = characterToggle.getAttribute("data-toggle-character");
      toggleForm("character", id === NEW_ITEM_ID ? null : byId(state.catalog.characters, id));
      return;
    }
    if (environmentToggle) {
      const id = environmentToggle.getAttribute("data-toggle-environment");
      toggleForm("environment", id === NEW_ITEM_ID ? null : byId(state.catalog.environments, id));
      return;
    }
    if (situationToggle) {
      const id = situationToggle.getAttribute("data-toggle-situation");
      toggleForm("situation", id === NEW_ITEM_ID ? null : byId(state.catalog.situations, id));
      return;
    }
    const performerId = event.target.closest("[data-edit-performer]")?.getAttribute("data-edit-performer");
    if (performerId) showForm("performer", byId(state.catalog.performers, performerId));
  });
  document.addEventListener("change", (event) => {
    if (event.target.closest("#situationCharacterSlots")) renderCastPreview();
    const upload = event.target.closest("[data-extra-upload]");
    if (upload) {
      uploadExtraFile(upload);
      return;
    }
    const extraField = event.target.closest("[data-extras-form] [data-extra][data-field]");
    if (extraField && ["bron", "bestand", "camera"].includes(extraField.getAttribute("data-field"))) {
      // Bron/bestand bepaalt welke velden en welk voorbeeld er staan: opnieuw tekenen,
      // met naam en omschrijving zoals ze nu ingetypt zijn.
      const name = $("environmentName") ? $("environmentName").value : "";
      const description = $("environmentDescription") ? $("environmentDescription").value : "";
      rememberExtrasDraft();
      renderEnvironments();
      if ($("environmentName")) $("environmentName").value = name;
      if ($("environmentDescription")) $("environmentDescription").value = description;
      syncLevelUi();
    }
  });
  document.addEventListener("input", (event) => {
    const levelField = event.target.closest("[data-extras-form] [data-field=\"volume\"]");
    if (levelField) {
      rememberExtrasDraft();
      syncLevelUi();
      return;
    }
    const levelsField = event.target.closest("[data-levels-env]");
    if (levelsField) {
      if (levelsField.value !== "") setLevelDraft(levelsField.getAttribute("data-levels-env"), levelsField.getAttribute("data-level-kind"), levelsField.value);
      return;
    }
    const field = event.target.closest("[data-extras-form] [data-extra][data-field=\"label\"]");
    if (!field) return;
    rememberExtrasDraft();
    const preview = document.querySelector("[data-extras-form] .deckPreview");
    if (preview) preview.innerHTML = deckKeyHtml("shot", state.extrasDraft.extras.shot) + deckKeyHtml("geluid", state.extrasDraft.extras.geluid);
  });
}

bindEvents();
loadAll().catch((err) => {
  $("topMeta").textContent = err.message || String(err);
});
