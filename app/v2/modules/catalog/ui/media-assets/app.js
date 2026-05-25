"use strict";

const CANVAS = {
  panels: 3,
  panelWidth: 2160,
  panelHeight: 3840,
  canvasWidth: 6480,
  canvasHeight: 3840,
  aspectRatio: "27:16",
};

const UPLOADS = {
  background: {
    type: "background",
    role: "background",
    label: "Achtergrond",
    accept: ".jpg,.jpeg,.png,.webp,.mp4,.mov,.m4v,.webm,image/*,video/*",
    tags: "background",
  },
  soundscape: {
    type: "soundscape",
    role: "soundscape",
    label: "Audio",
    accept: ".mp3,.wav,.aif,.aiff,.m4a,.aac,.flac,audio/*",
    tags: "audio,soundscape",
  },
  fx: {
    type: "fx",
    role: "",
    label: "FX",
    accept: ".mp4,.mov,.m4v,.webm,.jpg,.jpeg,.png,.webp,video/*,image/*",
    tags: "fx",
  },
  fxVideo: {
    type: "fx",
    role: "fxVideo",
    label: "FX video",
    accept: ".mp4,.mov,.m4v,.webm,video/*",
    tags: "fx,video",
  },
  fxImage: {
    type: "fx",
    role: "fxImage",
    label: "PNG-laag",
    accept: ".png,.jpg,.jpeg,.webp,image/*",
    tags: "fx,image",
  },
};

const CARD_UPLOAD_ORDER = ["background", "soundscape", "fx"];
const EDITOR_UPLOAD_ORDER = ["background", "soundscape", "fxVideo", "fxImage"];

const state = {
  data: null,
  focusedEnvironmentId: new URLSearchParams(window.location.search).get("environmentId") || "",
  editingEnvironmentId: "",
  savedComposition: null,
  draftComposition: null,
  selectedLayerId: "",
  pointer: null,
  dragLayerId: "",
  editorStatus: "",
  saveStatus: "saved",
  guidesVisible: true,
  peopleVisible: false,
  videoPosters: {},
  videoPosterStatus: {},
  videoPosterQueue: [],
  videoPosterActive: false,
  videoPosterObserver: null,
};

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

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function slugify(value, fallback = "asset") {
  return String(value || "")
    .normalize("NFKD")
    .replace(/[^\w\s-]/g, "")
    .trim()
    .toLowerCase()
    .replace(/[\s_]+/g, "-")
    .replace(/-+/g, "-")
    .slice(0, 48) || fallback;
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

function active(items) {
  return (items || []).filter((item) => item.active !== false && !item.archivedAt);
}

function presentAssetsFor(environmentId) {
  return (state.data.mediaAssets || []).filter((asset) => (
    asset.environmentId === environmentId
    && asset.status === "present"
  ));
}

function assetUrl(asset) {
  if (!asset) return "";
  return asset.url || `/v0/catalog/media-assets/file/${encodeURIComponent(asset.id)}`;
}

function previewKind(asset) {
  const mime = String(asset && asset.mimeType || "").toLowerCase();
  const ext = String(asset && (
    asset.extension
    || asset.ext
    || (asset.primaryFile && asset.primaryFile.ext)
    || asset.filename
    || (asset.primaryFile && asset.primaryFile.filename)
    || ""
  ) || "").toLowerCase();
  if (mime.startsWith("image/") || /(^|\.)(jpg|jpeg|png|webp)$/.test(ext)) return "image";
  if (mime.startsWith("audio/") || /(^|\.)(mp3|wav|aif|aiff|m4a|aac|flac)$/.test(ext)) return "audio";
  if (mime.startsWith("video/") || /(^|\.)(mp4|mov|m4v|webm)$/.test(ext)) return "video";
  return "file";
}

function roleForAsset(asset) {
  if (!asset) return "";
  if (asset.role) return asset.role;
  if (asset.type === "background" || asset.type === "soundscape") return asset.type;
  if (asset.type === "fx") return previewKind(asset) === "video" ? "fxVideo" : "fxImage";
  return "";
}

function isRenderedOutputAsset(asset) {
  return Array.isArray(asset && asset.tags) && asset.tags.includes("rendered-output");
}

function assetFilename(asset) {
  if (!asset) return "";
  if (asset.filename) return asset.filename;
  if (asset.primaryFile && asset.primaryFile.filename) return asset.primaryFile.filename;
  if (Array.isArray(asset.files) && asset.files[0]) return asset.files[0].filename;
  return asset.id || "";
}

function assetsByRole(environmentId, role) {
  return presentAssetsFor(environmentId).filter((asset) => roleForAsset(asset) === role);
}

function assetById(assetId) {
  return (state.data.mediaAssets || []).find((asset) => asset.id === assetId) || null;
}

function assetLabel(asset) {
  return asset && (asset.originalFilename || asset.filename || asset.id) || "asset";
}

function singletonAsset(environmentId, role) {
  return assetsByRole(environmentId, role)[0] || null;
}

function compositionFor(environmentId) {
  return (state.data.environmentCompositions || []).find((item) => item.environmentId === environmentId) || null;
}

function layerId(role, assetId, index = 0) {
  return `layer:${role}:${slugify(assetId, "asset")}:${index + 1}`;
}

function scaledImageSize(intrinsicSize, fallback) {
  const width = Number(intrinsicSize && intrinsicSize.width || 0);
  const height = Number(intrinsicSize && intrinsicSize.height || 0);
  if (!width || !height) return fallback;
  const maxWidth = Math.round(CANVAS.canvasWidth / 3);
  const maxHeight = Math.round(CANVAS.canvasHeight / 2);
  const scale = Math.min(1, maxWidth / width, maxHeight / height);
  return {
    width: Math.max(20, Math.round(width * scale)),
    height: Math.max(20, Math.round(height * scale)),
  };
}

function intrinsicSizeForAsset(asset, options = {}) {
  if (options.intrinsicSize) return options.intrinsicSize;
  const metadata = asset && asset.metadata && typeof asset.metadata === "object" ? asset.metadata : {};
  return metadata.dimensions || {
    width: metadata.width,
    height: metadata.height,
  };
}

function defaultLayer(asset, role, index = 0, options = {}) {
  const wide = role === "background" || role === "fxVideo";
  const fallbackSize = {
    width: wide ? CANVAS.canvasWidth : Math.round(CANVAS.canvasWidth / 3),
    height: wide ? CANVAS.canvasHeight : Math.round(CANVAS.canvasHeight / 3),
  };
  const size = role === "fxImage"
    ? scaledImageSize(intrinsicSizeForAsset(asset, options), fallbackSize)
    : fallbackSize;
  return {
    id: layerId(role, asset.id, index),
    assetId: asset.id,
    role,
    name: asset.originalFilename || asset.filename || role,
    visible: true,
    locked: false,
    x: 0,
    y: 0,
    width: size.width,
    height: size.height,
    rotationDeg: 0,
    opacity: 1,
    zIndex: role === "background" ? 0 : role === "fxVideo" ? 10 : 20 + index,
  };
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function defaultComposition(environmentId) {
  const background = singletonAsset(environmentId, "background");
  const fxVideo = singletonAsset(environmentId, "fxVideo");
  const imageAssets = assetsByRole(environmentId, "fxImage").filter((asset) => !isRenderedOutputAsset(asset));
  return {
    schemaVersion: "catalog.environment-composition.v0",
    environmentId,
    canvas: { ...CANVAS },
    guidesVisible: true,
    backgroundLayer: background ? defaultLayer(background, "background") : null,
    fxVideoLayer: fxVideo ? defaultLayer(fxVideo, "fxVideo") : null,
    imageLayers: imageAssets.map((asset, index) => defaultLayer(asset, "fxImage", index)),
  };
}

function normalizedComposition(environmentId) {
  const saved = compositionFor(environmentId);
  if (!saved) return defaultComposition(environmentId);
  const fallback = defaultComposition(environmentId);
  const editableImageLayers = Array.isArray(saved.imageLayers)
    ? saved.imageLayers.filter((layer) => !isRenderedOutputAsset(assetById(layer.assetId)))
    : [];
  return {
    ...fallback,
    ...saved,
    canvas: { ...CANVAS },
    guidesVisible: saved.guidesVisible !== false,
    imageLayers: editableImageLayers,
  };
}

function allLayers(composition = state.draftComposition) {
  if (!composition) return [];
  return [
    composition.backgroundLayer,
    composition.fxVideoLayer,
    ...(composition.imageLayers || []),
  ].filter(Boolean).sort((a, b) => Number(a.zIndex || 0) - Number(b.zIndex || 0));
}

function findLayer(layerIdValue) {
  return allLayers().find((layer) => layer.id === layerIdValue) || null;
}

function compositionAssetIds(composition = state.draftComposition) {
  return new Set(allLayers(composition).map((layer) => layer.assetId).filter(Boolean));
}

function unassignedImageAssets(environmentId) {
  const assigned = compositionAssetIds();
  return assetsByRole(environmentId, "fxImage")
    .filter((asset) => !assigned.has(asset.id))
    .sort((a, b) => {
      const aOutput = isRenderedOutputAsset(a) ? 1 : 0;
      const bOutput = isRenderedOutputAsset(b) ? 1 : 0;
      if (aOutput !== bOutput) return aOutput - bOutput;
      return String(assetLabel(a)).localeCompare(String(assetLabel(b)), "nl");
    });
}

function updateLayer(layerIdValue, patch) {
  const composition = state.draftComposition;
  if (!composition) return;
  function apply(layer) {
    return layer && layer.id === layerIdValue ? { ...layer, ...patch } : layer;
  }
  composition.backgroundLayer = apply(composition.backgroundLayer);
  composition.fxVideoLayer = apply(composition.fxVideoLayer);
  composition.imageLayers = (composition.imageLayers || []).map(apply);
}

function layerSelector(layerIdValue) {
  if (window.CSS && typeof window.CSS.escape === "function") {
    return `[data-layer-id="${window.CSS.escape(layerIdValue)}"]`;
  }
  return `[data-layer-id="${String(layerIdValue).replace(/["\\]/g, "\\$&")}"]`;
}

function applyLayerDomUpdate(layerIdValue) {
  const layer = findLayer(layerIdValue);
  const node = document.querySelector(layerSelector(layerIdValue));
  if (!layer || !node) return;
  node.setAttribute("style", layerStyle(layer));
  node.classList.toggle("is-selected", layer.id === state.selectedLayerId);
  node.classList.toggle("is-locked", layer.locked === true);
}

function syncSelectedLayerInputs() {
  const layer = findLayer(state.selectedLayerId);
  if (!layer) return;
  for (const input of document.querySelectorAll("[data-layer-field]")) {
    const field = input.getAttribute("data-layer-field");
    if (input.type === "checkbox") {
      input.checked = field === "visible" ? layer.visible !== false : layer[field] === true;
    } else if (field in layer) {
      input.value = typeof layer[field] === "number" ? String(Math.round(layer[field] * 100) / 100) : String(layer[field] || "");
    }
  }
}

function selectLayerInDom(layerIdValue) {
  for (const node of document.querySelectorAll(".compositionLayer.is-selected")) {
    node.classList.remove("is-selected");
  }
  const node = document.querySelector(layerSelector(layerIdValue));
  if (node) node.classList.add("is-selected");
}

function deleteLayer(layerIdValue) {
  const composition = state.draftComposition;
  if (!composition) return;
  if (composition.backgroundLayer && composition.backgroundLayer.id === layerIdValue) composition.backgroundLayer = null;
  if (composition.fxVideoLayer && composition.fxVideoLayer.id === layerIdValue) composition.fxVideoLayer = null;
  composition.imageLayers = (composition.imageLayers || []).filter((layer) => layer.id !== layerIdValue);
  state.selectedLayerId = allLayers()[allLayers().length - 1]?.id || "";
}

function removeAssetFromDraft(assetId) {
  const composition = state.draftComposition;
  if (!composition) return;
  if (composition.backgroundLayer && composition.backgroundLayer.assetId === assetId) composition.backgroundLayer = null;
  if (composition.fxVideoLayer && composition.fxVideoLayer.assetId === assetId) composition.fxVideoLayer = null;
  composition.imageLayers = (composition.imageLayers || []).filter((layer) => layer.assetId !== assetId);
  if (!findLayer(state.selectedLayerId)) state.selectedLayerId = allLayers()[allLayers().length - 1]?.id || "";
}

function layerPercent(value, total) {
  return `${(Number(value || 0) / total) * 100}%`;
}

function layerStyle(layer) {
  return [
    `left:${layerPercent(layer.x, CANVAS.canvasWidth)}`,
    `top:${layerPercent(layer.y, CANVAS.canvasHeight)}`,
    `width:${layerPercent(layer.width, CANVAS.canvasWidth)}`,
    `height:${layerPercent(layer.height, CANVAS.canvasHeight)}`,
    `opacity:${Number(layer.opacity ?? 1)}`,
    `z-index:${Number(layer.zIndex || 0)}`,
    `transform:rotate(${Number(layer.rotationDeg || 0)}deg)`,
  ].join(";");
}

function videoPosterKey(asset) {
  return asset && asset.id ? asset.id : "";
}

function mediaElement(asset, options = {}) {
  if (!asset) return "";
  const url = esc(assetUrl(asset));
  if (previewKind(asset) === "video") {
    if (options.playVideo) return `<video src="${url}" autoplay muted loop playsinline></video>`;
    const poster = state.videoPosters[videoPosterKey(asset)];
    if (poster) return `<img class="videoPosterImage" src="${esc(poster)}" alt="">`;
    return `<div class="videoPoster" data-video-poster data-asset-id="${esc(videoPosterKey(asset))}" data-src="${url}"></div>`;
  }
  if (previewKind(asset) === "image") return `<img src="${url}" alt="">`;
  return `<div class="fy-preview-empty">Geen preview</div>`;
}

function renderGuides(enabled = true) {
  if (!enabled) return "";
  return `
    <div class="compositionGuides" aria-hidden="true">
      <div><span>1</span></div>
      <div><span>2</span></div>
      <div><span>3</span></div>
    </div>
  `;
}

function renderPeopleOverlay(enabled = false) {
  if (!enabled) return "";
  return `
    <div class="compositionPeople" aria-hidden="true">
      ${[1, 2, 3].map(() => `
        <div class="personPanel">
          <img class="ghostStandIn" src="/catalog/media-assets/ghost-standin.png" alt="">
        </div>
      `).join("")}
    </div>
  `;
}

function renderLayer(layer, selected = false, interactive = false, options = {}) {
  const asset = assetById(layer.assetId);
  if (!asset || layer.visible === false) return "";
  const classes = [
    "compositionLayer",
    `role-${esc(layer.role)}`,
    selected ? "is-selected" : "",
    layer.locked ? "is-locked" : "",
  ].filter(Boolean).join(" ");
  return `
    <div class="${classes}" style="${esc(layerStyle(layer))}" data-layer-id="${esc(layer.id)}">
      ${mediaElement(asset, options)}
      ${interactive && selected ? `
        <span class="layerHandle resizeHandle" data-handle="resize" aria-hidden="true"></span>
        <span class="layerHandle rotateHandle" data-handle="rotate" aria-hidden="true"></span>
      ` : ""}
    </div>
  `;
}

function renderCompositionPreview(environmentId, interactive = false) {
  const composition = interactive && state.draftComposition
    ? state.draftComposition
    : normalizedComposition(environmentId);
  const layers = allLayers(composition);
  const hasBackground = layers.some((layer) => layer.role === "background" && layer.visible !== false && assetById(layer.assetId));
  const showGuides = interactive ? composition.guidesVisible !== false : true;
  const showPeople = interactive && state.peopleVisible;
  return `
    <div class="compositionCanvas ${interactive ? "is-interactive" : ""}" tabindex="${interactive ? "0" : "-1"}" data-composition-canvas data-canvas-drop>
      ${!hasBackground ? `<div class="fy-preview-empty">Geen achtergrond</div>` : ""}
      ${layers.map((layer) => renderLayer(layer, interactive && layer.id === state.selectedLayerId, interactive)).join("")}
      ${renderPeopleOverlay(showPeople)}
      ${renderGuides(showGuides)}
    </div>
  `;
}

function updateVideoPosterNodes(assetId, poster) {
  for (const node of document.querySelectorAll("[data-video-poster]")) {
    if (node.getAttribute("data-asset-id") !== assetId) continue;
    node.classList.add("is-ready");
    node.style.backgroundImage = `url("${poster}")`;
  }
}

function captureVideoPoster(src) {
  return new Promise((resolve, reject) => {
    const video = document.createElement("video");
    const timer = window.setTimeout(() => {
      if (done) return;
      done = true;
      video.removeAttribute("src");
      video.load();
      reject(new Error("videostill_timeout"));
    }, 8000);
    let done = false;

    function finishWithFrame() {
      if (done) return;
      const width = video.videoWidth || 1280;
      const height = video.videoHeight || 720;
      if (!width || !height) return;
      done = true;
      window.clearTimeout(timer);
      const maxWidth = 720;
      const scale = Math.min(1, maxWidth / width);
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(width * scale));
      canvas.height = Math.max(1, Math.round(height * scale));
      const context = canvas.getContext("2d");
      context.drawImage(video, 0, 0, canvas.width, canvas.height);
      video.removeAttribute("src");
      video.load();
      resolve(canvas.toDataURL("image/jpeg", 0.72));
    }

    video.muted = true;
    video.playsInline = true;
    video.preload = "metadata";
    video.addEventListener("error", () => {
      if (done) return;
      done = true;
      window.clearTimeout(timer);
      reject(new Error("videostill_error"));
    }, { once: true });
    video.addEventListener("loadedmetadata", () => {
      const seekTo = Number.isFinite(video.duration) && video.duration > 1 ? Math.min(0.25, video.duration * 0.02) : 0;
      try {
        video.currentTime = seekTo;
      } catch (_err) {
        finishWithFrame();
      }
    }, { once: true });
    video.addEventListener("seeked", finishWithFrame, { once: true });
    video.addEventListener("loadeddata", () => {
      window.setTimeout(finishWithFrame, 120);
    }, { once: true });
    video.src = src;
  });
}

function queueVideoPoster(assetId, src) {
  if (!assetId || state.videoPosters[assetId] || state.videoPosterStatus[assetId]) return;
  state.videoPosterStatus[assetId] = "queued";
  state.videoPosterQueue.push({ assetId, src });
  processVideoPosterQueue();
}

function processVideoPosterQueue() {
  if (state.videoPosterActive) return;
  const item = state.videoPosterQueue.shift();
  if (!item) return;
  state.videoPosterActive = true;
  state.videoPosterStatus[item.assetId] = "loading";
  captureVideoPoster(item.src)
    .then((poster) => {
      state.videoPosters[item.assetId] = poster;
      state.videoPosterStatus[item.assetId] = "ready";
      updateVideoPosterNodes(item.assetId, poster);
    })
    .catch(() => {
      state.videoPosterStatus[item.assetId] = "failed";
    })
    .finally(() => {
      state.videoPosterActive = false;
      processVideoPosterQueue();
    });
}

function scheduleVideoPosters() {
  const nodes = [...document.querySelectorAll("[data-video-poster]")];
  if (!nodes.length) return;
  if (!("IntersectionObserver" in window)) {
    nodes.forEach((node) => queueVideoPoster(node.getAttribute("data-asset-id"), node.getAttribute("data-src")));
    return;
  }
  if (!state.videoPosterObserver) {
    state.videoPosterObserver = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        const node = entry.target;
        state.videoPosterObserver.unobserve(node);
        queueVideoPoster(node.getAttribute("data-asset-id"), node.getAttribute("data-src"));
      });
    }, { rootMargin: "240px" });
  }
  nodes.forEach((node) => {
    const assetId = node.getAttribute("data-asset-id");
    if (state.videoPosters[assetId]) updateVideoPosterNodes(assetId, state.videoPosters[assetId]);
    else if (!state.videoPosterStatus[assetId]) state.videoPosterObserver.observe(node);
  });
}

function renderAudio(environmentId) {
  const audio = singletonAsset(environmentId, "soundscape");
  if (!audio) return `<div class="fy-small">Geen audio-preview</div>`;
  return `<audio controls src="${esc(assetUrl(audio))}"></audio>`;
}

function playbackRow(label, asset) {
  if (!asset) return "";
  const url = esc(assetUrl(asset));
  const filename = esc(assetFilename(asset));
  const control = previewKind(asset) === "audio"
    ? `<audio controls preload="metadata" src="${url}"></audio>`
    : `<video controls preload="metadata" src="${url}"></video>`;
  return `
    <div class="mediaPlaybackRow">
      <div class="mediaPlaybackLabel">
        <strong>${esc(label)}</strong>
        <span>${filename}</span>
      </div>
      ${control}
    </div>
  `;
}

function renderEditorPlayback(environmentId) {
  const audio = singletonAsset(environmentId, "soundscape");
  const background = singletonAsset(environmentId, "background");
  const fxVideo = singletonAsset(environmentId, "fxVideo");
  const rows = [
    audio ? playbackRow("Audio", audio) : "",
    background && previewKind(background) === "video" ? playbackRow("Achtergrond video", background) : "",
    fxVideo ? playbackRow("FX video", fxVideo) : "",
  ].filter(Boolean);
  if (!rows.length) return "";
  return `<div class="editorPlayback">${rows.join("")}</div>`;
}

function fileText(environmentId, key) {
  if (key === "fxImage") {
    const count = assetsByRole(environmentId, "fxImage").length;
    return count ? `${count} bestand(en)` : "Geen bestand";
  }
  if (key === "fx") {
    const count = assetsByRole(environmentId, "fxImage").length + assetsByRole(environmentId, "fxVideo").length;
    return count ? `${count} bestand(en)` : "Geen bestand";
  }
  const asset = singletonAsset(environmentId, key);
  return asset ? assetFilename(asset) : "Geen bestand";
}

function dropZoneHtml(environment, key) {
  const config = UPLOADS[key];
  const inputId = `asset-${environment.id.replace(/[^a-zA-Z0-9_-]+/g, "_")}-${key}`;
  const hasFile = fileText(environment.id, key) !== "Geen bestand";
  const missingRequired = !hasFile && (key === "background" || key === "soundscape");
  return `
    <div class="fy-drop-zone ${missingRequired ? "is-required-missing" : ""}" data-environment-id="${esc(environment.id)}" data-upload-key="${esc(key)}">
      <div>
        <strong>${esc(config.label)}</strong>
        <div class="fileName">${esc(fileText(environment.id, key))}</div>
      </div>
      <label class="fy-button fy-button-primary fileButton" for="${esc(inputId)}">Upload</label>
      <input id="${esc(inputId)}" type="file" accept="${esc(config.accept)}">
      <div class="uploadStatus fy-small"></div>
    </div>
  `;
}

function renderSummary() {
  $("summary").innerHTML = "";
}

function renderCard(environment) {
  return `
    <article class="fy-card envCard ${environment.id === state.focusedEnvironmentId ? "focused" : ""}" data-open-environment="${esc(environment.id)}">
      <div class="envHeader">
        <div class="envTitle">
          <h2>${esc(environment.name || environment.id)}</h2>
          <button class="fy-button editCompositionButton" type="button" data-open-environment="${esc(environment.id)}">Bewerk</button>
        </div>
      </div>
      <div class="fy-preview compositionPreview">${renderCompositionPreview(environment.id, false)}</div>
      <div class="envBody">
        ${renderAudio(environment.id)}
        <div class="fy-drop-grid">
          ${CARD_UPLOAD_ORDER.map((key) => dropZoneHtml(environment, key)).join("")}
        </div>
      </div>
    </article>
  `;
}

function layerLabel(layer) {
  const asset = assetById(layer.assetId);
  const role = {
    background: "Achtergrond",
    fxVideo: "FX video",
    fxImage: "PNG",
  }[layer.role] || layer.role;
  return `${role}: ${layer.name || (asset && (asset.originalFilename || asset.filename)) || "laag"}`;
}

function renderLayerList() {
  const layers = orderedLayerList();
  if (!layers.length) return `<div class="fy-small">Nog geen lagen.</div>`;
  return layers.map((layer) => `
    <button
      class="layerListItem ${layer.id === state.selectedLayerId ? "is-selected" : ""} ${layer.role === "background" ? "is-locked" : ""} ${layer.visible === false ? "is-hidden" : ""}"
      type="button"
      data-select-layer="${esc(layer.id)}"
      data-layer-row="${esc(layer.id)}"
      draggable="${layer.role === "background" ? "false" : "true"}"
      aria-label="${esc(layerLabel(layer))}${layer.visible === false ? " verborgen" : ""}${layer.role === "background" ? " vast" : ""}"
    >
      <span class="layerListText">
        <span class="layerTitle">${esc(layerLabel(layer))}</span>
      </span>
      ${layer.role === "background" ? `<img class="layerLockIcon" src="./lock.svg" alt="" aria-label="Achtergrond vast">` : `<span class="layerDragHandle" aria-label="Sleep laag"></span>`}
    </button>
  `).join("");
}

function renderInactiveAssetList(environmentId) {
  const assets = unassignedImageAssets(environmentId);
  if (!assets.length) return `<div class="fy-small">Geen losse PNG-assets.</div>`;
  return assets.map((asset) => {
    const output = isRenderedOutputAsset(asset);
    return `
      <div class="inactiveAssetItem ${output ? "is-output" : ""}">
        <span class="inactiveAssetTitle" title="${esc(assetLabel(asset))}">${esc(assetLabel(asset))}</span>
        <span class="inactiveAssetActions">
          ${output ? `<span class="fy-small">output</span>` : `<button class="fy-button" type="button" data-asset-action="restore" data-asset-id="${esc(asset.id)}">Zet terug</button>`}
          ${output ? "" : `<button class="fy-button" type="button" data-asset-action="delete" data-asset-id="${esc(asset.id)}">Verwijder definitief</button>`}
        </span>
      </div>
    `;
  }).join("");
}

function renderInactiveAssetPanel(environmentId) {
  const count = unassignedImageAssets(environmentId).length;
  return `
    <details class="layerPanel inactiveAssetsPanel">
      <summary>
        <span>Niet in compositie</span>
        <span class="fy-small">${count}</span>
      </summary>
      <div class="inactiveAssetList">${renderInactiveAssetList(environmentId)}</div>
    </details>
  `;
}

function saveStatusText() {
  if (state.saveStatus === "dirty") return "Bewerkt";
  if (state.saveStatus === "saving") return "Opslaan...";
  if (state.saveStatus === "error") return "Niet opgeslagen";
  return "Opgeslagen";
}

function saveStateHtml() {
  return `<span class="saveState ${esc(state.saveStatus)}" aria-live="polite"><span class="dot"></span><span class="txt">${esc(saveStatusText())}</span></span>`;
}

function markCompositionDirty() {
  if (!state.editingEnvironmentId || !state.draftComposition || state.saveStatus === "saving") return;
  state.saveStatus = "dirty";
}

function numberInput(label, field, value, step = "1") {
  return `
    <label>
      <span>${esc(label)}</span>
      <input type="number" step="${esc(step)}" value="${esc(value)}" data-layer-field="${esc(field)}">
    </label>
  `;
}

function renderLayerControls() {
  const layer = findLayer(state.selectedLayerId);
  if (!layer) return `<div class="fy-small">Selecteer een laag om te bewerken.</div>`;
  return `
    <div class="layerControls">
      <div class="layerControlsHeader">
        <strong title="${esc(layerLabel(layer))}">${esc(layerLabel(layer))}</strong>
        ${layer.role === "background" ? "" : `<button class="fy-button" type="button" data-layer-action="remove">Uit compositie</button>`}
      </div>
      <label>
        <span>Naam</span>
        <input type="text" value="${esc(layer.name || "")}" data-layer-field="name">
      </label>
      <div class="controlChecks">
        <label class="check"><input type="checkbox" ${layer.locked ? "checked" : ""} data-layer-field="locked"> Vastzetten</label>
      </div>
      <div class="transformGrid">
        ${numberInput("X", "x", Math.round(layer.x))}
        ${numberInput("Y", "y", Math.round(layer.y))}
        ${numberInput("Breedte", "width", Math.round(layer.width))}
        ${numberInput("Hoogte", "height", Math.round(layer.height))}
        ${numberInput("Rotatie", "rotationDeg", Number(layer.rotationDeg || 0).toFixed(1), "0.1")}
        ${numberInput("Opacity", "opacity", Number(layer.opacity ?? 1).toFixed(2), "0.01")}
      </div>
    </div>
  `;
}

function renderEditor(environment) {
  const composition = state.draftComposition || defaultComposition(environment.id);
  const status = state.editorStatus ? `<div class="fy-small editorStatus">${esc(state.editorStatus)}</div>` : "";
  return `
    <article class="fy-card envCard compositionEditor" data-editor-environment="${esc(environment.id)}">
      <div class="editorHeader">
        <div>
          <h2>${esc(environment.name || environment.id)}</h2>
          <div class="fy-small">Canvas ${CANVAS.canvasWidth} x ${CANVAS.canvasHeight} · ratio ${CANVAS.aspectRatio}</div>
        </div>
        <div class="fy-actions fy-actions-end">
          <label class="check guideToggle"><input type="checkbox" ${composition.guidesVisible !== false ? "checked" : ""} data-toggle-guides> Kaders 1 / 2 / 3</label>
          <label class="check guideToggle"><input type="checkbox" ${state.peopleVisible ? "checked" : ""} data-toggle-people> Personen</label>
          ${saveStateHtml()}
          <button class="fy-button fy-button-primary" type="button" data-save-composition>Opslaan</button>
          <button class="fy-button" type="button" data-cancel-composition>Annuleer</button>
          <button class="fy-button" type="button" data-close-editor>Terug</button>
        </div>
      </div>
      ${status}
      <div class="compositionLayout">
        <section class="compositionStage">
          ${renderCompositionPreview(environment.id, true)}
          ${renderEditorPlayback(environment.id)}
          <div class="fy-drop-grid editorUploadStrip">
            ${EDITOR_UPLOAD_ORDER.map((key) => dropZoneHtml(environment, key)).join("")}
          </div>
        </section>
        <aside class="compositionSide">
          <section class="layerPanel">
            <h3>Positie</h3>
            ${renderLayerControls()}
          </section>
          <section class="layerPanel">
            <h3>Lagen</h3>
            <div class="layerList">${renderLayerList()}</div>
          </section>
          ${renderInactiveAssetPanel(environment.id)}
        </aside>
      </div>
    </article>
  `;
}

function renderCards() {
  const environments = active(state.data.environments);
  renderSummary(environments);
  if (state.editingEnvironmentId) {
    const environment = environments.find((item) => item.id === state.editingEnvironmentId);
    $("environmentCards").classList.add("is-editing");
    $("environmentCards").innerHTML = environment ? renderEditor(environment) : `<div class="fy-small">Omgeving niet gevonden.</div>`;
    scheduleVideoPosters();
    return;
  }
  $("environmentCards").classList.remove("is-editing");
  $("environmentCards").innerHTML = environments.map(renderCard).join("") || `<div class="fy-small">Geen omgevingen.</div>`;
  scheduleVideoPosters();
}

async function loadAll(options = {}) {
  state.data = await requestJson("/v0/catalog/media-assets");
  const environments = active(state.data.environments);
  $("statusLine").textContent = `Bijgewerkt ${new Date(state.data.generatedAt).toLocaleString("nl-NL")}`;
  if (options.render !== false) renderCards();
}

function uploadIssuesHtml(error) {
  const issues = error && error.body && Array.isArray(error.body.issues) ? error.body.issues : [];
  if (!issues.length) return esc(error.message || error);
  return issues.map((item) => item.message || item.code).join(" ");
}

function addUploadedAssetToDraft(asset, options = {}) {
  if (!state.draftComposition || asset.environmentId !== state.editingEnvironmentId) return;
  const role = roleForAsset(asset);
  const layer = defaultLayer(asset, role, state.draftComposition.imageLayers.length);
  if (role === "fxImage" && options.spawnPoint) {
    layer.x = Math.round(clamp(options.spawnPoint.x - layer.width / 2, -layer.width, CANVAS.canvasWidth));
    layer.y = Math.round(clamp(options.spawnPoint.y - layer.height / 2, -layer.height, CANVAS.canvasHeight));
  }
  if (role === "background") {
    state.draftComposition.backgroundLayer = layer;
    state.selectedLayerId = layer.id;
  } else if (role === "fxVideo") {
    state.draftComposition.fxVideoLayer = layer;
    state.selectedLayerId = layer.id;
  } else if (role === "fxImage") {
    state.draftComposition.imageLayers.push(layer);
    state.selectedLayerId = layer.id;
  }
  markCompositionDirty();
}

async function uploadFile(dropZone, file, extra = {}) {
  if (!file) return null;
  const status = dropZone ? dropZone.querySelector(".uploadStatus") : null;
  if (status) status.textContent = "Uploaden...";
  const key = extra.key || (dropZone && dropZone.getAttribute("data-upload-key")) || "fx";
  const config = UPLOADS[key] || UPLOADS.fx;
  const environmentId = extra.environmentId || (dropZone && dropZone.getAttribute("data-environment-id")) || state.editingEnvironmentId;
  const intrinsicSize = extra.intrinsicSize || await imageDimensionsFromFile(file);
  const form = new FormData();
  form.set("environmentId", environmentId);
  form.set("type", config.type);
  if (config.role) form.set("role", config.role);
  form.set("tags", extra.tags || config.tags);
  if (extra.replaceTags) form.set("replaceTags", extra.replaceTags);
  form.set("asset", file, file.name);
  try {
    const result = await requestJson("/v0/catalog/media-assets/upload", { method: "POST", body: form });
    if (status) status.textContent = "Opgeslagen.";
    await loadAll({ render: false });
    if (extra.addToDraft !== false) addUploadedAssetToDraft(result.asset, { ...extra, intrinsicSize });
    if (extra.render !== false) renderCards();
    return result.asset;
  } catch (err) {
    if (status) status.textContent = uploadIssuesHtml(err);
    throw err;
  }
}

function startEditing(environmentId) {
  state.editingEnvironmentId = environmentId;
  state.savedComposition = clone(normalizedComposition(environmentId));
  state.draftComposition = clone(state.savedComposition);
  state.guidesVisible = true;
  state.peopleVisible = false;
  state.draftComposition.guidesVisible = true;
  const layers = allLayers(state.draftComposition);
  state.selectedLayerId = layers[layers.length - 1]?.id || "";
  state.editorStatus = "";
  state.saveStatus = "saved";
  renderCards();
}

function closeEditor() {
  state.editingEnvironmentId = "";
  state.savedComposition = null;
  state.draftComposition = null;
  state.selectedLayerId = "";
  state.editorStatus = "";
  state.saveStatus = "saved";
  renderCards();
}

async function saveComposition() {
  if (!state.editingEnvironmentId || !state.draftComposition) return;
  const compositionPayload = {
    ...state.draftComposition,
    guidesVisible: true,
  };
  state.saveStatus = "saving";
  renderCards();
  try {
    const result = await requestJson(`/v0/catalog/media-compositions/${encodeURIComponent(state.editingEnvironmentId)}`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(compositionPayload),
    });
    const outputAsset = await createOutputPng({
      composition: compositionPayload,
      environmentId: state.editingEnvironmentId,
      render: false,
      showEmptyStatus: false,
    });
    await loadAll({ render: false });
    state.savedComposition = clone(result.composition);
    state.draftComposition = clone(result.composition);
    state.editorStatus = "";
    state.saveStatus = "saved";
    renderCards();
  } catch (err) {
    state.editorStatus = uploadIssuesHtml(err);
    state.saveStatus = "error";
    renderCards();
    throw err;
  }
}

function cancelComposition() {
  state.draftComposition = clone(state.savedComposition || defaultComposition(state.editingEnvironmentId));
  state.editorStatus = "";
  state.saveStatus = "saved";
  renderCards();
}

function setLayerField(target) {
  const layer = findLayer(state.selectedLayerId);
  if (!layer) return;
  const field = target.getAttribute("data-layer-field");
  let value;
  if (target.type === "checkbox") value = target.checked;
  else if (["x", "y", "width", "height", "rotationDeg", "opacity"].includes(field)) value = Number(target.value);
  else value = target.value;
  updateLayer(layer.id, { [field]: value });
  markCompositionDirty();
  renderCards();
}

function restoreAssetAsLayer(assetId) {
  const asset = assetById(assetId);
  if (!asset || !state.draftComposition || isRenderedOutputAsset(asset)) return;
  const existing = allLayers().find((layer) => layer.assetId === asset.id);
  if (existing) {
    state.selectedLayerId = existing.id;
    renderCards();
    return;
  }
  const layer = {
    ...defaultLayer(asset, "fxImage", state.draftComposition.imageLayers.length),
    zIndex: Math.max(20, ...allLayers().map((item) => Number(item.zIndex || 0))) + 10,
  };
  state.draftComposition.imageLayers.push(layer);
  state.selectedLayerId = layer.id;
  markCompositionDirty();
  renderCards();
}

async function deleteMediaAssetFromEditor(assetId, options = {}) {
  if (!assetId) return;
  await requestJson(`/v0/catalog/media-assets/${encodeURIComponent(assetId)}`, { method: "DELETE" });
  removeAssetFromDraft(assetId);
  await loadAll({ render: false });
  if (options.markDirty) markCompositionDirty();
  renderCards();
}

async function layerAction(action) {
  const layer = findLayer(state.selectedLayerId);
  if (!layer) return;
  if (action === "remove") {
    deleteLayer(layer.id);
  } else if (action === "forward") {
    updateLayer(layer.id, { zIndex: Number(layer.zIndex || 0) + 1 });
  } else if (action === "backward") {
    updateLayer(layer.id, { zIndex: Math.max(0, Number(layer.zIndex || 0) - 1) });
  }
  markCompositionDirty();
  renderCards();
}

function orderedLayerList() {
  return allLayers(state.draftComposition).slice().sort((a, b) => {
    if (a.role === "background" && b.role !== "background") return 1;
    if (b.role === "background" && a.role !== "background") return -1;
    return Number(b.zIndex || 0) - Number(a.zIndex || 0);
  });
}

function applyLayerOrder(topToBottom) {
  const movable = topToBottom.filter((layer) => layer.role !== "background");
  for (const [index, layer] of movable.entries()) {
    updateLayer(layer.id, { zIndex: 10 + (movable.length - index) * 10 });
  }
  const background = topToBottom.find((layer) => layer.role === "background");
  if (background) updateLayer(background.id, { zIndex: 0, locked: true });
}

function reorderLayer(draggedId, targetId) {
  const dragged = findLayer(draggedId);
  if (!dragged || dragged.role === "background" || draggedId === targetId) return;
  const layers = orderedLayerList();
  const withoutDragged = layers.filter((layer) => layer.id !== draggedId);
  const targetIndex = Math.max(0, withoutDragged.findIndex((layer) => layer.id === targetId));
  withoutDragged.splice(targetIndex, 0, dragged);
  applyLayerOrder(withoutDragged);
  state.selectedLayerId = draggedId;
  state.dragLayerId = "";
  markCompositionDirty();
  renderCards();
}

function canvasPoint(event, rect) {
  return {
    x: ((event.clientX - rect.left) / rect.width) * CANVAS.canvasWidth,
    y: ((event.clientY - rect.top) / rect.height) * CANVAS.canvasHeight,
  };
}

function fileLooksLikeImage(file) {
  const type = String(file && file.type || "").toLowerCase();
  const name = String(file && file.name || "").toLowerCase();
  return type.startsWith("image/") || /\.(png|jpg|jpeg|webp)$/.test(name);
}

function imageDimensionsFromFile(file) {
  if (!fileLooksLikeImage(file)) return Promise.resolve(null);
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      URL.revokeObjectURL(url);
      resolve({ width: image.naturalWidth || image.width, height: image.naturalHeight || image.height });
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      resolve(null);
    };
    image.src = url;
  });
}

function canvasDropPoint(event, canvas) {
  return canvasPoint(event, canvas.getBoundingClientRect());
}

async function dropFileOnCanvas(canvas, file, event) {
  if (!file) return;
  if (!fileLooksLikeImage(file)) {
    state.editorStatus = "Sleep hier een PNG of andere afbeelding voor een voorgrondlaag.";
    renderCards();
    return;
  }
  const point = canvasDropPoint(event, canvas);
  const intrinsicSize = await imageDimensionsFromFile(file);
  await uploadFile(null, file, {
    key: "fxImage",
    environmentId: state.editingEnvironmentId,
    spawnPoint: point,
    intrinsicSize,
  });
}

function beginPointer(event) {
  const layerNode = event.target.closest(".compositionLayer");
  if (!layerNode || !state.draftComposition) return;
  const layer = findLayer(layerNode.getAttribute("data-layer-id"));
  if (!layer || layer.locked) return;
  event.preventDefault();
  state.selectedLayerId = layer.id;
  selectLayerInDom(layer.id);
  syncSelectedLayerInputs();
  if (layerNode.setPointerCapture && event.pointerId != null) {
    try { layerNode.setPointerCapture(event.pointerId); } catch (_err) {}
  }
  const canvas = event.target.closest("[data-composition-canvas]");
  const rect = canvas.getBoundingClientRect();
  const point = canvasPoint(event, rect);
  state.pointer = {
    mode: event.target.getAttribute("data-handle") || "move",
    layerId: layer.id,
    startPoint: point,
    startLayer: { ...layer },
    rect,
    didChange: false,
  };
}

function movePointer(event) {
  if (!state.pointer) return;
  event.preventDefault();
  const pointer = state.pointer;
  const point = canvasPoint(event, pointer.rect);
  const dx = point.x - pointer.startPoint.x;
  const dy = point.y - pointer.startPoint.y;
  const layer = pointer.startLayer;
  if (pointer.mode === "resize") {
    const freeResize = event.shiftKey;
    const candidateWidth = Math.max(20, layer.width + dx);
    const candidateHeight = Math.max(20, layer.height + dy);
    if (freeResize || !layer.width || !layer.height) {
      updateLayer(pointer.layerId, {
        width: candidateWidth,
        height: candidateHeight,
      });
    } else {
      const widthRatioDelta = Math.abs(dx / layer.width);
      const heightRatioDelta = Math.abs(dy / layer.height);
      if (widthRatioDelta >= heightRatioDelta) {
        updateLayer(pointer.layerId, {
          width: candidateWidth,
          height: Math.max(20, candidateWidth * (layer.height / layer.width)),
        });
      } else {
        updateLayer(pointer.layerId, {
          width: Math.max(20, candidateHeight * (layer.width / layer.height)),
          height: candidateHeight,
        });
      }
    }
  } else if (pointer.mode === "rotate") {
    const center = { x: layer.x + layer.width / 2, y: layer.y + layer.height / 2 };
    const angle = Math.atan2(point.y - center.y, point.x - center.x) * 180 / Math.PI + 90;
    updateLayer(pointer.layerId, { rotationDeg: Math.round(angle * 10) / 10 });
  } else {
    updateLayer(pointer.layerId, {
      x: Math.round(layer.x + dx),
      y: Math.round(layer.y + dy),
    });
  }
  pointer.didChange = true;
  applyLayerDomUpdate(pointer.layerId);
  syncSelectedLayerInputs();
}

function endPointer() {
  if (state.pointer && state.pointer.didChange) markCompositionDirty();
  if (state.pointer) renderCards();
  state.pointer = null;
}

function nudgeSelected(event) {
  if (!state.draftComposition || !["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(event.key)) return;
  const layer = findLayer(state.selectedLayerId);
  if (!layer || layer.locked) return;
  event.preventDefault();
  const amount = event.shiftKey ? 10 : 1;
  const patch = {};
  if (event.key === "ArrowUp") patch.y = layer.y - amount;
  if (event.key === "ArrowDown") patch.y = layer.y + amount;
  if (event.key === "ArrowLeft") patch.x = layer.x - amount;
  if (event.key === "ArrowRight") patch.x = layer.x + amount;
  updateLayer(layer.id, patch);
  markCompositionDirty();
  renderCards();
}

function loadImage(asset) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error(`Kon ${assetFilename(asset)} niet laden.`));
    image.src = assetUrl(asset);
  });
}

async function canvasToBlob(canvas) {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error("Kon geen PNG maken."));
    }, "image/png");
  });
}

async function createOutputPng(options = {}) {
  const environmentId = options.environmentId || state.editingEnvironmentId;
  const environment = active(state.data.environments).find((item) => item.id === environmentId);
  const composition = options.composition || state.draftComposition;
  if (!environment || !composition) return;
  const layers = (composition.imageLayers || [])
    .filter((layer) => layer.visible !== false && assetById(layer.assetId) && previewKind(assetById(layer.assetId)) === "image")
    .sort((a, b) => Number(a.zIndex || 0) - Number(b.zIndex || 0));
  if (!layers.length) {
    if (options.showEmptyStatus !== false) {
      state.editorStatus = "Geen zichtbare PNG-lagen voor output-PNG.";
      if (options.render !== false) renderCards();
    }
    return;
  }
  const canvas = document.createElement("canvas");
  canvas.width = CANVAS.canvasWidth;
  canvas.height = CANVAS.canvasHeight;
  const ctx = canvas.getContext("2d");
  for (const layer of layers) {
    const asset = assetById(layer.assetId);
    const image = await loadImage(asset);
    ctx.save();
    ctx.globalAlpha = Number(layer.opacity ?? 1);
    ctx.translate(layer.x + layer.width / 2, layer.y + layer.height / 2);
    ctx.rotate(Number(layer.rotationDeg || 0) * Math.PI / 180);
    ctx.drawImage(image, -layer.width / 2, -layer.height / 2, layer.width, layer.height);
    ctx.restore();
  }
  const blob = await canvasToBlob(canvas);
  const file = new File([blob], `${slugify(environment.name, "omgeving")}-output.png`, { type: "image/png" });
  const asset = await uploadFile(null, file, {
    key: "fxImage",
    environmentId: environment.id,
    addToDraft: false,
    tags: "fx,image,rendered-output,td-output",
    replaceTags: "rendered-output,td-output",
    render: false,
  });
  if (options.render !== false) {
    state.editorStatus = "Output-PNG bijgewerkt. Originele PNG-lagen blijven bewerkbaar.";
    renderCards();
  }
  return asset;
}

function bindEvents() {
  $("refreshBtn").addEventListener("click", () => loadAll());
  $("environmentCards").addEventListener("click", (event) => {
    const interactive = event.target.closest("button, a, input, label, audio, video, .fy-drop-zone, .layerListItem, .layerHandle");
    const openTarget = event.target.closest("[data-open-environment]");
    if (openTarget && !interactive) {
      startEditing(openTarget.getAttribute("data-open-environment"));
      return;
    }
    if (event.target.closest("[data-open-environment]") && event.target.closest(".editCompositionButton")) {
      startEditing(event.target.closest("[data-open-environment]").getAttribute("data-open-environment"));
      return;
    }
    if (event.target.closest("[data-close-editor]")) closeEditor();
    if (event.target.closest("[data-save-composition]")) saveComposition().catch((err) => {
      state.editorStatus = uploadIssuesHtml(err);
      renderCards();
    });
    if (event.target.closest("[data-cancel-composition]")) cancelComposition();
    const layerButton = event.target.closest("[data-select-layer]");
    if (layerButton) {
      state.selectedLayerId = layerButton.getAttribute("data-select-layer");
      renderCards();
    }
    const actionButton = event.target.closest("[data-layer-action]");
    if (actionButton) layerAction(actionButton.getAttribute("data-layer-action")).catch((err) => {
      state.editorStatus = err.message || String(err);
      renderCards();
    });
    const assetActionButton = event.target.closest("[data-asset-action]");
    if (assetActionButton) {
      const action = assetActionButton.getAttribute("data-asset-action");
      const assetId = assetActionButton.getAttribute("data-asset-id");
      if (action === "restore") restoreAssetAsLayer(assetId);
      if (action === "delete") deleteMediaAssetFromEditor(assetId).catch((err) => {
        state.editorStatus = err.message || String(err);
        renderCards();
      });
    }
  });
  $("environmentCards").addEventListener("dragstart", (event) => {
    const row = event.target.closest("[data-layer-row]");
    if (!row || row.getAttribute("draggable") !== "true") return;
    state.dragLayerId = row.getAttribute("data-layer-row");
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", state.dragLayerId);
    row.classList.add("is-dragging");
  });
  $("environmentCards").addEventListener("dragend", () => {
    state.dragLayerId = "";
    for (const row of document.querySelectorAll(".layerListItem.is-dragging, .layerListItem.is-drop-target")) {
      row.classList.remove("is-dragging", "is-drop-target");
    }
  });
  $("environmentCards").addEventListener("input", (event) => {
    if (event.target.matches("[data-layer-field]")) setLayerField(event.target);
    if (event.target.matches("[data-toggle-guides]")) {
      state.draftComposition.guidesVisible = event.target.checked;
      state.guidesVisible = event.target.checked;
      renderCards();
    }
    if (event.target.matches("[data-toggle-people]")) {
      state.peopleVisible = event.target.checked;
      renderCards();
    }
  });
  $("environmentCards").addEventListener("change", (event) => {
    if (event.target.matches("input[type='file']")) {
      const dropZone = event.target.closest(".fy-drop-zone");
      uploadFile(dropZone, event.target.files[0]).catch(() => {});
      event.target.value = "";
    }
  });
  $("environmentCards").addEventListener("dragover", (event) => {
    const layerRow = event.target.closest("[data-layer-row]");
    if (layerRow && state.dragLayerId) {
      event.preventDefault();
      event.dataTransfer.dropEffect = "move";
      for (const row of document.querySelectorAll(".layerListItem.is-drop-target")) {
        if (row !== layerRow) row.classList.remove("is-drop-target");
      }
      layerRow.classList.add("is-drop-target");
      return;
    }
    const dropZone = event.target.closest(".fy-drop-zone");
    const canvas = event.target.closest("[data-canvas-drop]");
    if (!dropZone && !canvas) return;
    event.preventDefault();
    if (dropZone) dropZone.classList.add("is-drag-over");
    if (canvas) canvas.classList.add("is-drag-over");
  });
  $("environmentCards").addEventListener("dragleave", (event) => {
    const dropZone = event.target.closest(".fy-drop-zone");
    if (dropZone) dropZone.classList.remove("is-drag-over");
    const canvas = event.target.closest("[data-canvas-drop]");
    if (canvas) canvas.classList.remove("is-drag-over");
    const layerRow = event.target.closest("[data-layer-row]");
    if (layerRow) layerRow.classList.remove("is-drop-target");
  });
  $("environmentCards").addEventListener("drop", (event) => {
    const layerRow = event.target.closest("[data-layer-row]");
    if (layerRow && state.dragLayerId) {
      event.preventDefault();
      reorderLayer(state.dragLayerId, layerRow.getAttribute("data-layer-row"));
      return;
    }
    const dropZone = event.target.closest(".fy-drop-zone");
    const canvas = event.target.closest("[data-canvas-drop]");
    if (!dropZone && !canvas) return;
    event.preventDefault();
    if (dropZone) {
      dropZone.classList.remove("is-drag-over");
      uploadFile(dropZone, event.dataTransfer.files[0]).catch(() => {});
      return;
    }
    canvas.classList.remove("is-drag-over");
    dropFileOnCanvas(canvas, event.dataTransfer.files[0], event).catch((err) => {
      state.editorStatus = err.message || String(err);
      renderCards();
    });
  });
  $("environmentCards").addEventListener("pointerdown", beginPointer);
  $("environmentCards").addEventListener("keydown", nudgeSelected);
  document.addEventListener("pointermove", movePointer);
  document.addEventListener("pointerup", endPointer);
}

bindEvents();
loadAll().catch((err) => {
  $("statusLine").textContent = err.message || String(err);
});
