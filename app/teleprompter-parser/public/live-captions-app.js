(function () {
  "use strict";

  const root = document.getElementById("captionRoot");
  const card = document.getElementById("captionCard");
  const debug = document.getElementById("captionDebug");
  const CAPTION_WIDTH = 1080;
  const CAPTION_HEIGHT = 1920;
  const params = new URLSearchParams(window.location.search);
  const debugEnabled = params.get("debug") === "1" || params.get("preview") === "1";
  const transparentRequested = params.get("transparent") === "1" || params.get("obs") === "1";
  const obsBrowser = /\bobs\b|obsbrowser|obs-browser/i.test(window.navigator.userAgent || "");
  const browserPreviewEnabled = !debugEnabled && !transparentRequested && !obsBrowser;

  let teleprompt = null;
  let cue = { index: 0, version: -1, deckLength: 0 };

  function updateCaptionScale() {
    if (debugEnabled) {
      root.style.setProperty("--caption-scale", "1");
      return;
    }
    const viewport = window.visualViewport;
    const width = viewport && viewport.width ? viewport.width : window.innerWidth;
    const height = viewport && viewport.height ? viewport.height : window.innerHeight;
    const scale = Math.max(0.1, Math.min(width / CAPTION_WIDTH, height / CAPTION_HEIGHT, 1));
    root.style.setProperty("--caption-scale", scale.toFixed(5));
  }

  function deckLength() {
    const lines = teleprompt && Array.isArray(teleprompt.lines) ? teleprompt.lines : [];
    return lines.length ? lines.length + 2 : 0;
  }

  function clampIndex(index) {
    return Math.max(0, Math.min(Number.parseInt(index, 10) || 0, Math.max(deckLength() - 1, 0)));
  }

  function clearCard() {
    while (card.firstChild) card.removeChild(card.firstChild);
  }

  function appendFormattedText(target, input) {
    const text = String(input || "");
    const pattern = /\*([^*\n]+)\*/g;
    let cursor = 0;
    let match;
    while ((match = pattern.exec(text))) {
      if (match.index > cursor) target.appendChild(document.createTextNode(text.slice(cursor, match.index)));
      const direction = document.createElement("span");
      direction.className = "caption-inline-direction";
      direction.textContent = match[1].trim();
      target.appendChild(direction);
      cursor = match.index + match[0].length;
    }
    if (cursor < text.length) target.appendChild(document.createTextNode(text.slice(cursor)));
  }

  function captionForIndex(index) {
    const lines = teleprompt && Array.isArray(teleprompt.lines) ? teleprompt.lines : [];
    if (!lines.length || index <= 0) return null;
    if (index >= lines.length + 1) return { type: "end", text: "Einde" };
    const line = lines[index - 1];
    if (!line || !line.text) return null;
    if (line.type === "dialogue") return { type: "dialogue", text: line.text };
    return { type: "direction", text: line.text };
  }

  function isOverflowing(element) {
    return element.scrollHeight > element.clientHeight + 1 || element.scrollWidth > element.clientWidth + 1;
  }

  function fitCaption() {
    if (card.classList.contains("end")) return;
    card.style.removeProperty("font-size");
    const baseFontSize = Number.parseFloat(window.getComputedStyle(card).fontSize);
    if (!Number.isFinite(baseFontSize) || !isOverflowing(card)) return;
    for (let size = baseFontSize - 4; size >= 58; size -= 4) {
      card.style.fontSize = `${size}px`;
      if (!isOverflowing(card)) return;
    }
    card.style.fontSize = "58px";
  }

  function render() {
    const activeCaption = captionForIndex(clampIndex(cue.index));
    clearCard();
    root.dataset.cueIndex = String(cue.index || 0);
    root.dataset.captionText = activeCaption ? activeCaption.text : "";
    if (debugEnabled && debug) {
      const title = teleprompt && teleprompt.title ? teleprompt.title : "geen scene";
      debug.hidden = false;
      debug.textContent = `Live captions | cue ${cue.index || 0}/${Math.max(deckLength() - 1, 0)} | ${title}`;
    }
    if (!activeCaption) {
      card.hidden = true;
      card.className = "caption-card";
      return;
    }
    card.hidden = false;
    card.className = `caption-card ${activeCaption.type}`;
    appendFormattedText(card, activeCaption.text);
    fitCaption();
  }

  function applyCurrentPayload(payload) {
    if (!payload || !payload.ok) return;
    teleprompt = payload.teleprompt || null;
    cue = payload.cue || { index: 0, version: -1, deckLength: 0 };
    render();
  }

  async function pollCurrent() {
    try {
      const response = await fetch("/api/teleprompter-parser/current", { cache: "no-store" });
      const payload = await response.json();
      if (response.ok && payload.ok) applyCurrentPayload(payload);
    } catch {}
  }

  function connectEvents() {
    if (!window.EventSource) return;
    const events = new EventSource("/api/teleprompter-parser/events");
    events.onmessage = (event) => {
      try {
        applyCurrentPayload(JSON.parse(event.data));
      } catch {}
    };
  }

  window.addEventListener("resize", updateCaptionScale);
  if (window.visualViewport) window.visualViewport.addEventListener("resize", updateCaptionScale);

  if (debugEnabled) document.body.classList.add("caption-debug-mode");
  else if (browserPreviewEnabled) document.body.classList.add("caption-browser-preview-mode");
  updateCaptionScale();
  connectEvents();
  pollCurrent();
  window.setInterval(pollCurrent, 500);
})();
