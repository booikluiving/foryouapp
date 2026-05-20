(function () {
  "use strict";

  const root = document.getElementById("stageRoot");
  const card = document.getElementById("stageCard");
  const sceneTitle = document.getElementById("stageSceneTitle");
  const progress = document.getElementById("stageProgress");
  const prevButton = document.getElementById("prevButton");
  const nextButton = document.getElementById("nextButton");

  let teleprompt = null;
  let currentVersion = -1;
  let currentIndex = 0;

  function characterFor(line) {
    const characters = teleprompt && Array.isArray(teleprompt.characters) ? teleprompt.characters : [];
    return characters.find((entry) => entry.id === line.speakerId) || null;
  }

  function deckLength() {
    const lines = teleprompt && Array.isArray(teleprompt.lines) ? teleprompt.lines : [];
    return lines.length + 1;
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

  function nextLineForCurrentCard() {
    if (!teleprompt || !Array.isArray(teleprompt.lines) || currentIndex <= 0) return null;
    return teleprompt.lines[currentIndex] || null;
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
    } else {
      const label = document.createElement("p");
      label.className = "stage-next-speaker direction";
      label.textContent = "Regie";
      preview.appendChild(label);
    }

    const text = document.createElement("p");
    text.className = "stage-next-text";
    text.textContent = nextLine.text || "";
    preview.appendChild(text);
    card.appendChild(preview);
  }

  function renderEmpty() {
    card.className = "stage-card title-card";
    clearCard();
    appendTextElement("p", "stage-kicker", "Teleprompt");
    appendTextElement("h1", "stage-title", "Wacht op teleprompt");
    appendTextElement("p", "stage-subtitle", "Open de tekstparser of wacht op operator-output.");
    sceneTitle.textContent = "Teleprompt";
    progress.textContent = "0 / 0";
  }

  function renderTitleCard() {
    card.className = "stage-card title-card";
    clearCard();
    appendTextElement("p", "stage-kicker", "Teleprompt");
    appendTextElement("h1", "stage-title", teleprompt.title || "Teleprompt");
    appendTextElement("p", "stage-subtitle", `${(teleprompt.lines || []).length} kaarten`);
  }

  function renderDialogue(line) {
    const character = characterFor(line);
    card.className = "stage-card dialogue-card";
    card.style.setProperty("--speaker-color", character && character.color ? character.color : "#4cc9f0");
    clearCard();
    appendTextElement("p", "stage-speaker", line.speakerLabel || "Personage");
    appendTextElement("p", "stage-dialogue", line.text || "");
    appendNextPreview();
  }

  function renderDirection(line) {
    card.className = "stage-card direction-card";
    card.style.removeProperty("--speaker-color");
    clearCard();
    appendTextElement("p", "stage-kicker", "Regie");
    appendTextElement("p", "stage-direction", line.text || "");
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

    const line = teleprompt.lines[currentIndex - 1];
    if (line && line.type === "dialogue") {
      renderDialogue(line);
    } else {
      renderDirection(line || {});
    }
  }

  function setTeleprompt(nextTeleprompt) {
    const nextVersion = Number(nextTeleprompt && nextTeleprompt.version || 0);
    if (nextVersion !== currentVersion) {
      currentVersion = nextVersion;
      currentIndex = 0;
    }
    teleprompt = nextTeleprompt;
    render();
  }

  function move(delta) {
    currentIndex = clampIndex(currentIndex + delta);
    render();
  }

  async function pollCurrent() {
    try {
      const response = await fetch("/api/teleprompter-parser/current", { cache: "no-store" });
      const payload = await response.json();
      if (response.ok && payload.ok) setTeleprompt(payload.teleprompt);
    } catch {}
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
    }
  });

  root.focus();
  pollCurrent();
  window.setInterval(pollCurrent, 750);
})();
