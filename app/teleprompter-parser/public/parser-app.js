(function () {
  "use strict";

  const titleInput = document.getElementById("titleInput");
  const rawTextInput = document.getElementById("rawTextInput");
  const parseButton = document.getElementById("parseButton");
  const statusText = document.getElementById("statusText");
  const previewTitle = document.getElementById("previewTitle");
  const previewMeta = document.getElementById("previewMeta");
  const linePreview = document.getElementById("linePreview");
  const captionSizeInput = document.getElementById("captionSizeInput");
  const captionPositionInput = document.getElementById("captionPositionInput");
  const captionWidthInput = document.getElementById("captionWidthInput");
  const captionOutlineInput = document.getElementById("captionOutlineInput");
  const captionSizeValue = document.getElementById("captionSizeValue");
  const captionPositionValue = document.getElementById("captionPositionValue");
  const captionWidthValue = document.getElementById("captionWidthValue");
  const captionOutlineValue = document.getElementById("captionOutlineValue");
  const captionStyleReset = document.getElementById("captionStyleReset");
  const captionStyleStatus = document.getElementById("captionStyleStatus");

  const DEFAULT_CAPTION_STYLE = Object.freeze({
    fontSizeScale: 1,
    verticalPosition: 66,
    widthPercent: 86,
    outlineScale: 1,
  });

  let currentVersion = 0;
  let currentCaptionStyleVersion = -1;
  let captionStyleSaveTimer = null;
  let savingCaptionStyle = false;
  let userEdited = false;

  function clampNumber(value, min, max, fallback) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return fallback;
    return Math.max(min, Math.min(max, numeric));
  }

  function normalizeCaptionStyle(style = {}, fallback = DEFAULT_CAPTION_STYLE) {
    return {
      fontSizeScale: clampNumber(style.fontSizeScale, 0.45, 1.25, fallback.fontSizeScale),
      verticalPosition: clampNumber(style.verticalPosition, 50, 84, fallback.verticalPosition),
      widthPercent: clampNumber(style.widthPercent, 56, 96, fallback.widthPercent),
      outlineScale: clampNumber(style.outlineScale, 0.45, 1.25, fallback.outlineScale),
      version: Number.isFinite(Number(style.version)) ? Number(style.version) : currentCaptionStyleVersion,
    };
  }

  function renderCaptionStyleValues(style) {
    const safe = normalizeCaptionStyle(style);
    captionSizeValue.textContent = `${Math.round(safe.fontSizeScale * 100)}%`;
    captionPositionValue.textContent = `${Math.round(safe.verticalPosition)}%`;
    captionWidthValue.textContent = `${Math.round(safe.widthPercent)}%`;
    captionOutlineValue.textContent = `${Math.round(safe.outlineScale * 100)}%`;
  }

  function applyCaptionStyleControls(style) {
    const safe = normalizeCaptionStyle(style);
    captionSizeInput.value = String(Math.round(safe.fontSizeScale * 100));
    captionPositionInput.value = String(Math.round(safe.verticalPosition));
    captionWidthInput.value = String(Math.round(safe.widthPercent));
    captionOutlineInput.value = String(Math.round(safe.outlineScale * 100));
    renderCaptionStyleValues(safe);
    if (Number.isFinite(Number(safe.version))) currentCaptionStyleVersion = Number(safe.version);
  }

  function readCaptionStyleControls() {
    return normalizeCaptionStyle({
      fontSizeScale: Number(captionSizeInput.value) / 100,
      verticalPosition: Number(captionPositionInput.value),
      widthPercent: Number(captionWidthInput.value),
      outlineScale: Number(captionOutlineInput.value) / 100,
    });
  }

  async function saveCaptionStyle(style = readCaptionStyleControls()) {
    savingCaptionStyle = true;
    captionStyleStatus.textContent = "Captionstijl opslaan...";
    try {
      const response = await fetch("/admin/teleprompter-parser/caption-style", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ captionStyle: style }),
      });
      const payload = await response.json();
      if (!response.ok || !payload.ok) throw new Error(payload.error || "caption_style_failed");
      applyCaptionStyleControls(payload.captionStyle || style);
      captionStyleStatus.textContent = "Captionstijl opgeslagen.";
    } catch (err) {
      captionStyleStatus.textContent = `Captionstijl mislukt: ${err && err.message ? err.message : "onbekend"}`;
    } finally {
      savingCaptionStyle = false;
    }
  }

  function queueCaptionStyleSave() {
    const style = readCaptionStyleControls();
    renderCaptionStyleValues(style);
    captionStyleStatus.textContent = "Captionstijl klaar om op te slaan...";
    window.clearTimeout(captionStyleSaveTimer);
    captionStyleSaveTimer = window.setTimeout(() => {
      saveCaptionStyle(style);
    }, 180);
  }

  function appendFormattedText(target, input) {
    const text = String(input || "");
    const pattern = /\*([^*\n]+)\*/g;
    let cursor = 0;
    let match;
    while ((match = pattern.exec(text))) {
      if (match.index > cursor) target.appendChild(document.createTextNode(text.slice(cursor, match.index)));
      const direction = document.createElement("span");
      direction.className = "inline-direction";
      direction.textContent = match[1].trim();
      target.appendChild(direction);
      cursor = match.index + match[0].length;
    }
    if (cursor < text.length) target.appendChild(document.createTextNode(text.slice(cursor)));
  }

  function renderPreview(teleprompt) {
    if (!teleprompt) {
      previewTitle.textContent = "Teleprompt";
      previewMeta.textContent = "Geen regels.";
      linePreview.innerHTML = '<p class="empty-preview">Nog geen teleprompt.</p>';
      return;
    }

    previewTitle.textContent = teleprompt.title || "Teleprompt";
    previewMeta.textContent = `${(teleprompt.lines || []).length} regels, ${(teleprompt.characters || []).length} personages`;
    linePreview.replaceChildren();
    (teleprompt.lines || []).forEach((line) => {
      const entry = document.createElement("article");
      entry.className = `preview-line ${line.type === "dialogue" ? "dialogue" : "direction"}`;
      const label = document.createElement("strong");
      label.textContent = line.type === "dialogue" ? line.speakerLabel || "Personage" : "";
      if (line.type === "dialogue") entry.appendChild(label);
      const text = document.createElement("p");
      appendFormattedText(text, line.text || "");
      entry.appendChild(text);
      linePreview.appendChild(entry);
    });
  }

  async function parseManual() {
    const rawText = rawTextInput.value;
    if (!rawText.trim()) {
      statusText.textContent = "Geen tekst om te parsen.";
      return;
    }
    parseButton.disabled = true;
    statusText.textContent = "Parser draait...";
    try {
      const response = await fetch("/admin/teleprompter-parser/parse", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: titleInput.value,
          rawText,
          source: "manual",
        }),
      });
      const payload = await response.json();
      if (!response.ok || !payload.ok) throw new Error(payload.error || "parse_failed");
      currentVersion = payload.teleprompt.version || currentVersion;
      userEdited = false;
      renderPreview(payload.teleprompt);
      statusText.textContent = `Geparsed: versie ${currentVersion}.`;
    } catch (err) {
      statusText.textContent = `Parse mislukt: ${err && err.message ? err.message : "onbekend"}`;
    } finally {
      parseButton.disabled = false;
    }
  }

  async function pollCurrent() {
    try {
      const response = await fetch("/api/teleprompter-parser/current", { cache: "no-store" });
      const payload = await response.json();
      if (!response.ok || !payload.ok) return;
      if (payload.captionStyle && !savingCaptionStyle) {
        const styleVersion = Number(payload.captionStyle.version || 0);
        if (styleVersion !== currentCaptionStyleVersion) {
          applyCaptionStyleControls(payload.captionStyle);
        }
      }
      if (!payload.teleprompt) return;
      const nextVersion = Number(payload.teleprompt.version || 0);
      if (nextVersion === currentVersion) return;
      currentVersion = nextVersion;
      renderPreview(payload.teleprompt);
      statusText.textContent = `Live: versie ${currentVersion}.`;
      if (!userEdited) {
        titleInput.value = payload.teleprompt.title || "";
        rawTextInput.value = "";
      }
    } catch {}
  }

  parseButton.addEventListener("click", parseManual);
  titleInput.addEventListener("input", () => {
    userEdited = true;
  });
  rawTextInput.addEventListener("input", () => {
    userEdited = true;
  });
  [captionSizeInput, captionPositionInput, captionWidthInput, captionOutlineInput].forEach((input) => {
    input.addEventListener("input", queueCaptionStyleSave);
  });
  captionStyleReset.addEventListener("click", () => {
    applyCaptionStyleControls({ ...DEFAULT_CAPTION_STYLE, version: currentCaptionStyleVersion });
    saveCaptionStyle(DEFAULT_CAPTION_STYLE);
  });

  applyCaptionStyleControls(DEFAULT_CAPTION_STYLE);
  pollCurrent();
  window.setInterval(pollCurrent, 1000);
})();
