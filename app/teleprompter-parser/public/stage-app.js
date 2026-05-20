(function () {
  "use strict";

  const root = document.getElementById("stageRoot");
  const card = document.getElementById("stageCard");
  const sceneTitle = document.getElementById("stageSceneTitle");
  const progress = document.getElementById("stageProgress");
  const prevButton = document.getElementById("prevButton");
  const nextButton = document.getElementById("nextButton");
  const STAGE_WIDTH = 1312;
  const STAGE_HEIGHT = 1080;

  let teleprompt = null;
  let currentVersion = -1;
  let currentCueVersion = -1;
  let currentIndex = 0;

  function updateStageScale() {
    const viewport = window.visualViewport;
    const width = viewport && viewport.width ? viewport.width : window.innerWidth;
    const height = viewport && viewport.height ? viewport.height : window.innerHeight;
    const scale = Math.max(0.1, Math.min(width / STAGE_WIDTH, height / STAGE_HEIGHT, 1));
    root.style.setProperty("--stage-scale", scale.toFixed(5));
  }

  function isOverflowing(element) {
    return element.scrollHeight > element.clientHeight + 1 || element.scrollWidth > element.clientWidth + 1;
  }

  function fitTextElement(selector, minFontSize) {
    const element = card.querySelector(selector);
    if (!element) return;
    element.style.removeProperty("font-size");
    const baseFontSize = Number.parseFloat(window.getComputedStyle(element).fontSize);
    if (!Number.isFinite(baseFontSize) || !isOverflowing(element)) return;
    for (let size = baseFontSize - 2; size >= minFontSize; size -= 2) {
      element.style.fontSize = `${size}px`;
      if (!isOverflowing(element)) return;
    }
    element.style.fontSize = `${minFontSize}px`;
  }

  function fitRenderedCard() {
    fitTextElement(".stage-dialogue", 52);
    fitTextElement(".stage-direction", 40);
  }

  function characterFor(line) {
    const characters = teleprompt && Array.isArray(teleprompt.characters) ? teleprompt.characters : [];
    return characters.find((entry) => entry.id === line.speakerId) || null;
  }

  function deckLength() {
    const lines = teleprompt && Array.isArray(teleprompt.lines) ? teleprompt.lines : [];
    return lines.length + 2;
  }

  function clampIndex(index) {
    return Math.max(0, Math.min(index, Math.max(deckLength() - 1, 0)));
  }

  function clearCard() {
    while (card.firstChild) card.removeChild(card.firstChild);
  }

  function appendTextElement(tagName, className, text) {
    const element = document.createElement(tagName);
    element.className = className;
    element.textContent = text || "";
    card.appendChild(element);
    return element;
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

  function appendFormattedTextElement(tagName, className, text) {
    const element = document.createElement(tagName);
    element.className = className;
    appendFormattedText(element, text);
    card.appendChild(element);
    return element;
  }

  function nextLineForCurrentCard() {
    if (!teleprompt || !Array.isArray(teleprompt.lines) || currentIndex <= 0) return null;
    return teleprompt.lines[currentIndex] || { type: "end", text: "Einde" };
  }

  function appendNextPreview() {
    const nextLine = nextLineForCurrentCard();
    const preview = document.createElement("section");
    preview.className = "stage-next-preview";
    if (!nextLine) {
      preview.hidden = true;
      card.appendChild(preview);
      return;
    }

    if (nextLine.type === "dialogue") {
      const character = characterFor(nextLine);
      const speaker = document.createElement("p");
      speaker.className = "stage-next-speaker";
      speaker.style.setProperty("--next-speaker-color", character && character.color ? character.color : "#ffffff");
      speaker.textContent = nextLine.speakerLabel || "Personage";
      preview.appendChild(speaker);
    }

    const text = document.createElement("p");
    if (nextLine.type === "dialogue") {
      text.className = "stage-next-text";
    } else if (nextLine.type === "end") {
      text.className = "stage-next-text end";
    } else {
      text.className = "stage-next-text direction";
    }
    appendFormattedText(text, nextLine.text || "");
    preview.appendChild(text);
    card.appendChild(preview);
  }

  function renderEmpty() {
    root.classList.add("is-title-card");
    root.classList.remove("is-end-card");
    card.className = "stage-card title-card";
    clearCard();
    appendTextElement("h1", "stage-title", "Wacht op teleprompt");
    sceneTitle.textContent = "Teleprompt";
    progress.textContent = "0 / 0";
  }

  function renderTitleCard() {
    root.classList.add("is-title-card");
    root.classList.remove("is-end-card");
    card.className = "stage-card title-card";
    card.style.removeProperty("--speaker-color");
    clearCard();
    appendTextElement("h1", "stage-title", teleprompt.title || "Teleprompt");
  }

  function renderEndCard() {
    root.classList.remove("is-title-card");
    root.classList.add("is-end-card");
    card.className = "stage-card title-card end-card";
    card.style.removeProperty("--speaker-color");
    clearCard();
    appendTextElement("h1", "stage-title stage-end-title", "Einde");
  }

  function renderDialogue(line) {
    const character = characterFor(line);
    root.classList.remove("is-title-card", "is-end-card");
    card.className = "stage-card dialogue-card";
    card.style.setProperty("--speaker-color", character && character.color ? character.color : "#4cc9f0");
    clearCard();
    appendTextElement("p", "stage-speaker", line.speakerLabel || "Personage");
    appendFormattedTextElement("p", "stage-dialogue", line.text || "");
    appendNextPreview();
  }

  function renderDirection(line) {
    root.classList.remove("is-title-card", "is-end-card");
    card.className = "stage-card direction-card";
    card.style.removeProperty("--speaker-color");
    clearCard();
    appendTextElement("p", "stage-kicker stage-kicker-muted", "");
    appendFormattedTextElement("p", "stage-direction", line.text || "");
    appendNextPreview();
  }

  function render() {
    if (!teleprompt || !teleprompt.lines || !teleprompt.lines.length) {
      renderEmpty();
      return;
    }
    currentIndex = clampIndex(currentIndex);
    sceneTitle.textContent = teleprompt.title || "Teleprompt";
    progress.textContent = `${currentIndex + 1} / ${deckLength()}`;

    if (currentIndex === 0) {
      renderTitleCard();
      return;
    }
    if (currentIndex === deckLength() - 1) {
      renderEndCard();
      return;
    }

    const line = teleprompt.lines[currentIndex - 1];
    if (line && line.type === "dialogue") renderDialogue(line);
    else renderDirection(line || {});
    fitRenderedCard();
  }

  function applyCurrentPayload(payload) {
    const nextTeleprompt = payload && payload.teleprompt;
    const nextCue = payload && payload.cue;
    const nextVersion = Number(nextTeleprompt && nextTeleprompt.version || 0);
    if (nextVersion !== currentVersion) {
      currentVersion = nextVersion;
      teleprompt = nextTeleprompt;
    } else {
      teleprompt = nextTeleprompt;
    }

    if (nextCue && typeof nextCue === "object") {
      const nextCueVersion = Number(nextCue.version || 0);
      currentCueVersion = nextCueVersion;
      currentIndex = clampIndex(nextCue.index);
    }
    render();
  }

  async function publishCue() {
    try {
      const response = await fetch("/api/teleprompter-parser/cue", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ index: currentIndex }),
      });
      const payload = await response.json();
      if (response.ok && payload.ok && payload.cue) {
        currentCueVersion = Number(payload.cue.version || currentCueVersion);
      }
    } catch {}
  }

  function move(delta, options = {}) {
    currentIndex = clampIndex(currentIndex + delta);
    render();
    if (!options.silent) publishCue();
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
        const payload = JSON.parse(event.data);
        if (payload && payload.ok) applyCurrentPayload(payload);
      } catch {}
    };
  }

  prevButton.addEventListener("click", (event) => {
    event.stopPropagation();
    move(-1);
  });
  nextButton.addEventListener("click", (event) => {
    event.stopPropagation();
    move(1);
  });
  root.addEventListener("click", () => move(1));
  window.addEventListener("keydown", (event) => {
    if (event.key === "ArrowRight" || event.key === " ") {
      event.preventDefault();
      move(1);
    } else if (event.key === "ArrowLeft") {
      event.preventDefault();
      move(-1);
    } else if (event.key === "Home") {
      event.preventDefault();
      currentIndex = 0;
      render();
      publishCue();
    }
  });
  window.addEventListener("resize", updateStageScale);
  if (window.visualViewport) window.visualViewport.addEventListener("resize", updateStageScale);

  updateStageScale();
  root.focus();
  connectEvents();
  pollCurrent();
  window.setInterval(pollCurrent, 750);
})();
