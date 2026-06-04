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
  const params = new URLSearchParams(window.location.search);
  const isTouchDesignerRender = params.has("td") || document.body.classList.contains("stage-td-render-mode");
  const stageSlotIndex = normalizeStageSlot(
    params.get("slot") || params.get("performerSlot") || params.get("stage") || stageSlotFromPath()
  );
  const isPerformerStage = stageSlotIndex >= 1 && stageSlotIndex <= 3;

  let teleprompt = null;
  let preparedScene = null;
  let showState = null;
  let currentVersion = -1;
  let currentCueVersion = -1;
  let currentIndex = 0;
  let endSceneInFlight = false;

  function normalizeStageSlot(value) {
    const numeric = Number.parseInt(String(value || ""), 10);
    if (!Number.isFinite(numeric) || numeric < 1 || numeric > 3) return 0;
    return numeric;
  }

  function stageSlotFromPath() {
    const match = window.location.pathname.match(/\/stage\/([1-3])\/?$/);
    return match ? match[1] : "";
  }

  if (isPerformerStage) {
    document.body.classList.add("performer-stage-body");
    root.classList.add("is-performer-stage");
    root.dataset.stageSlot = String(stageSlotIndex);
  }

  function updateStageScale() {
    if (isTouchDesignerRender) {
      root.style.setProperty("--stage-scale", "1");
      return;
    }
    const viewport = window.visualViewport;
    const width = viewport && viewport.width ? viewport.width : window.innerWidth;
    const height = viewport && viewport.height ? viewport.height : window.innerHeight;
    if (width <= 1 || height <= 1) {
      root.style.setProperty("--stage-scale", "1");
      return;
    }
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

  function sourceSceneId() {
    return Number(teleprompt && teleprompt.source && teleprompt.source.sceneId || 0);
  }

  function preparedSceneId() {
    return Number(preparedScene && preparedScene.sceneId || 0);
  }

  function telepromptMatchesPreparedScene() {
    const preparedId = preparedSceneId();
    const sourceId = sourceSceneId();
    return !preparedId || !sourceId || preparedId === sourceId;
  }

  function canUseTelepromptLines() {
    if (!teleprompt || !Array.isArray(teleprompt.lines) || !teleprompt.lines.length) return false;
    if (preparedScene && preparedScene.status === "playing") return telepromptMatchesPreparedScene();
    return true;
  }

  function activeTitle() {
    if (preparedScene && preparedScene.status === "playing" && preparedScene.title) {
      const parsedTitle = String(teleprompt && teleprompt.title || "").trim();
      if (!parsedTitle || parsedTitle === "Teleprompt" || !telepromptMatchesPreparedScene()) return preparedScene.title;
    }
    if (preparedScene && preparedScene.status === "playing" && !telepromptMatchesPreparedScene()) {
      return preparedScene.title || "Teleprompt";
    }
    return (teleprompt && teleprompt.title) || (preparedScene && preparedScene.title) || "Teleprompt";
  }

  function showIsInactive() {
    return !!(showState && showState.active === false);
  }

  function stageTitleText(text) {
    const title = String(text || "");
    return isPerformerStage ? `P${stageSlotIndex} · ${title}` : title;
  }

  function setSceneTitle(text) {
    sceneTitle.textContent = stageTitleText(text);
  }

  function preparedCharacters() {
    return Array.isArray(preparedScene && preparedScene.characters) ? preparedScene.characters : [];
  }

  function preparedCharacterForStageSlot() {
    if (!isPerformerStage) return null;
    return preparedCharacters().find((character) => Number(character && character.slot || 0) === stageSlotIndex) || null;
  }

  function performerLabel(character) {
    const explicit = String(character && character.performerName || "").trim();
    return explicit || `Performer ${stageSlotIndex}`;
  }

  function deckLength() {
    const lines = canUseTelepromptLines() ? teleprompt.lines : [];
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

  function environmentImageAlt(environment) {
    const name = String(environment && environment.name || "").trim();
    return name ? `Omgeving ${name}` : "Omgeving";
  }

  function appendPrepEnvironment() {
    const environment = preparedScene && preparedScene.environment ? preparedScene.environment : null;
    if (!environment || (!environment.name && !environment.imageUrl)) return;

    const wrapper = document.createElement("section");
    wrapper.className = "stage-prep-environment";

    if (environment.imageUrl) {
      const image = document.createElement("img");
      image.className = "stage-prep-environment-image";
      image.src = environment.imageUrl;
      image.alt = environmentImageAlt(environment);
      image.loading = "eager";
      wrapper.appendChild(image);
    }

    const text = document.createElement("div");
    text.className = "stage-prep-environment-text";
    const name = document.createElement("p");
    name.className = "stage-prep-environment-name";
    name.textContent = environment.name || "Onbekende omgeving";
    text.appendChild(name);
    wrapper.appendChild(text);
    card.appendChild(wrapper);
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
    clearNoShowState();
    root.classList.add("is-title-card");
    root.classList.remove("is-prep-card", "is-ready");
    root.classList.remove("is-end-card");
    card.className = "stage-card title-card";
    clearCard();
    appendTextElement("h1", "stage-title", "Wacht op teleprompt");
    setSceneTitle("Teleprompt");
    progress.textContent = "0 / 0";
  }

  function renderNoShow() {
    root.classList.add("is-no-show", "is-title-card");
    root.classList.remove("is-prep-card", "is-ready", "is-end-card");
    card.className = "stage-card title-card no-show-card";
    card.style.removeProperty("--speaker-color");
    clearCard();
    appendTextElement("p", "stage-no-show-kicker", "GEEN ACTIEVE SHOW");
    appendTextElement("h1", "stage-no-show-title", "Wacht op start show");
    setSceneTitle("Geen actieve show");
    progress.textContent = "UIT";
  }

  function clearNoShowState() {
    root.classList.remove("is-no-show");
  }

  function renderTitleCard() {
    clearNoShowState();
    root.classList.add("is-title-card");
    root.classList.remove("is-prep-card", "is-ready");
    root.classList.remove("is-end-card");
    card.className = "stage-card title-card";
    card.style.removeProperty("--speaker-color");
    clearCard();
    const title = activeTitle();
    appendTextElement("h1", "stage-title", title);
    setSceneTitle(title);
    progress.textContent = `${currentIndex + 1} / ${deckLength()}`;
  }

  function appendStageSlotFocus() {
    if (!isPerformerStage) return;
    const character = preparedCharacterForStageSlot();
    const focus = document.createElement("section");
    focus.className = "stage-prep-focus";
    if (!character) focus.classList.add("is-empty");

    const kicker = document.createElement("p");
    kicker.className = "stage-prep-focus-kicker";
    kicker.textContent = character ? performerLabel(character) : `Performer ${stageSlotIndex}`;
    focus.appendChild(kicker);

    const title = document.createElement("h2");
    title.className = "stage-prep-focus-character";
    title.textContent = character && character.name ? character.name : "Geen rol in deze scene";
    focus.appendChild(title);

    card.appendChild(focus);
  }

  function renderPrepCard() {
    clearNoShowState();
    const characters = preparedCharacters();
    root.classList.remove("is-title-card", "is-end-card");
    root.classList.add("is-prep-card");
    root.classList.toggle("is-ready", !!(preparedScene && preparedScene.ready));
    card.className = "stage-card prep-card";
    card.style.removeProperty("--speaker-color");
    clearCard();
    appendTextElement("p", "stage-prep-kicker", preparedScene && preparedScene.ready ? "READY" : "VOLGENDE SCENE");
    appendTextElement("h1", "stage-prep-title", (preparedScene && preparedScene.title) || "Volgende scene");
    appendStageSlotFocus();
    appendPrepEnvironment();
    const list = document.createElement("ul");
    list.className = "stage-prep-characters";
    characters.slice(0, 3).forEach((character) => {
      const item = document.createElement("li");
      const slot = Number(character && character.slot || 0) || list.children.length + 1;
      const name = character && character.name ? character.name : "Personage";
      if (isPerformerStage && slot === stageSlotIndex) item.classList.add("is-stage-slot");
      const number = document.createElement("span");
      number.className = "stage-prep-character-slot";
      number.textContent = String(slot);
      const label = document.createElement("span");
      label.className = "stage-prep-character-label";
      const nameText = document.createElement("span");
      nameText.className = "stage-prep-character-name";
      nameText.textContent = name;
      label.appendChild(nameText);
      if (character && character.performerName) {
        const performer = document.createElement("span");
        performer.className = "stage-prep-character-performer";
        performer.textContent = character.performerName;
        label.appendChild(performer);
      }
      item.appendChild(number);
      item.appendChild(label);
      list.appendChild(item);
    });
    if (!list.children.length) {
      const item = document.createElement("li");
      item.textContent = "Geen personages";
      list.appendChild(item);
    }
    card.appendChild(list);
    setSceneTitle((preparedScene && preparedScene.title) || "Volgende scene");
    progress.textContent = preparedScene && preparedScene.ready ? "READY" : "PREP";
  }

  function renderEndCard() {
    clearNoShowState();
    root.classList.remove("is-title-card");
    root.classList.remove("is-prep-card", "is-ready");
    root.classList.add("is-end-card");
    card.className = "stage-card title-card end-card";
    card.style.removeProperty("--speaker-color");
    clearCard();
    appendTextElement("h1", "stage-title stage-end-title", "Einde");
  }

  function renderDialogue(line) {
    clearNoShowState();
    const character = characterFor(line);
    root.classList.remove("is-title-card", "is-end-card", "is-prep-card", "is-ready");
    card.className = "stage-card dialogue-card";
    card.style.setProperty("--speaker-color", character && character.color ? character.color : "#4cc9f0");
    clearCard();
    appendTextElement("p", "stage-speaker", line.speakerLabel || "Personage");
    appendFormattedTextElement("p", "stage-dialogue", line.text || "");
    appendNextPreview();
  }

  function renderDirection(line) {
    clearNoShowState();
    root.classList.remove("is-title-card", "is-end-card", "is-prep-card", "is-ready");
    card.className = "stage-card direction-card";
    card.style.removeProperty("--speaker-color");
    clearCard();
    appendTextElement("p", "stage-kicker stage-kicker-muted", "");
    appendFormattedTextElement("p", "stage-direction", line.text || "");
    appendNextPreview();
  }

  function render() {
    if (showIsInactive()) {
      renderNoShow();
      return;
    }
    if (preparedScene && preparedScene.status === "prepared") {
      renderPrepCard();
      return;
    }
    if (!canUseTelepromptLines()) {
      if (preparedScene && preparedScene.status === "playing") renderTitleCard();
      else renderEmpty();
      return;
    }
    currentIndex = clampIndex(currentIndex);
    setSceneTitle(activeTitle());
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
    showState = payload && payload.show ? payload.show : null;
    preparedScene = payload && payload.preparedScene ? payload.preparedScene : null;
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
      const response = await fetch("/v0/script-agent/teleprompter-parser/cue", {
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

  async function triggerEndSceneFromEndCard() {
    if (endSceneInFlight) return;
    endSceneInFlight = true;
    progress.textContent = "STOP";
    try {
      const response = await fetch("/v0/script-agent/teleprompter-parser/end-scene", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      });
      const payload = await response.json();
      if (response.ok && payload && payload.ok) {
        applyCurrentPayload(payload);
      } else {
        progress.textContent = "ERROR";
      }
    } catch {
      progress.textContent = "ERROR";
    } finally {
      endSceneInFlight = false;
    }
  }

  function move(delta, options = {}) {
    if (showIsInactive()) return;
    if (preparedScene && preparedScene.status === "prepared") return;
    if (preparedScene && preparedScene.status === "playing" && !canUseTelepromptLines()) return;
    if (delta > 0 && canUseTelepromptLines() && currentIndex === deckLength() - 1) {
      triggerEndSceneFromEndCard();
      return;
    }
    currentIndex = clampIndex(currentIndex + delta);
    render();
    if (!options.silent) publishCue();
  }

  async function pollCurrent() {
    try {
      const response = await fetch("/v0/script-agent/teleprompter-parser/current", { cache: "no-store" });
      const payload = await response.json();
      if (response.ok && payload.ok) applyCurrentPayload(payload);
    } catch {}
  }

  function connectEvents() {
    if (!window.EventSource) return;
    const events = new EventSource("/v0/script-agent/teleprompter-parser/events");
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
    if (event.key === "ArrowRight" || event.key === "PageDown" || event.key === " ") {
      event.preventDefault();
      move(1);
    } else if (event.key === "ArrowLeft" || event.key === "PageUp") {
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

  if (isTouchDesignerRender) document.body.classList.add("stage-td-render-mode");
  updateStageScale();
  root.focus();
  connectEvents();
  pollCurrent();
  window.setInterval(pollCurrent, 750);
})();
