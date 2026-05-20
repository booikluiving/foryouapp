(function () {
  "use strict";

  const titleInput = document.getElementById("titleInput");
  const rawInput = document.getElementById("rawInput");
  const parseButton = document.getElementById("parseButton");
  const sampleButton = document.getElementById("sampleButton");
  const clearButton = document.getElementById("clearButton");
  const statusLine = document.getElementById("statusLine");
  const previewTitle = document.getElementById("previewTitle");
  const versionBadge = document.getElementById("versionBadge");
  const characterList = document.getElementById("characterList");
  const linePreview = document.getElementById("linePreview");

  const sampleText = [
    "# De Lift",
    "Megan: We hebben nog precies tien seconden. Daarna gaat dit heel raar worden.",
    "[De lift blijft hangen. Het licht flikkert.]",
    "Brent: Raar is een groot woord. Ik zou zeggen: technisch uitdagend.",
    "Booi: Niemand drukt nu op alle knoppen.",
  ].join("\n");

  let currentPreviewVersion = -1;
  let currentPreviewSourceKind = "";
  let userHasManualDraft = false;
  let pollInFlight = false;

  function setStatus(message, isError) {
    statusLine.textContent = message || "";
    statusLine.classList.toggle("error", !!isError);
  }

  function clearElement(node) {
    while (node.firstChild) node.removeChild(node.firstChild);
  }

  function renderTeleprompt(teleprompt, options = {}) {
    const data = teleprompt || {};
    const version = Number(data.version || 0);
    const sourceKind = data.source && data.source.kind ? String(data.source.kind) : "";
    currentPreviewVersion = version;
    currentPreviewSourceKind = sourceKind;
    previewTitle.textContent = data.title || "Teleprompt";
    versionBadge.textContent = `v${version}`;
    clearElement(characterList);
    clearElement(linePreview);

    if (options.announce && version > 0) {
      const label = sourceKind === "operator_chat" ? "operator-output" : sourceKind || "parser";
      setStatus(`Live preview bijgewerkt vanaf ${label}: v${version}`, false);
    }

    for (const character of data.characters || []) {
      const chip = document.createElement("span");
      chip.className = "character-chip";
      chip.style.setProperty("--character-color", character.color || "#ffffff");
      chip.textContent = character.label || character.id || "Personage";
      characterList.appendChild(chip);
    }

    if (!data.lines || !data.lines.length) {
      const empty = document.createElement("p");
      empty.className = "empty-preview";
      empty.textContent = "Nog geen regels.";
      linePreview.appendChild(empty);
      return;
    }

    for (const line of data.lines) {
      const item = document.createElement("article");
      item.className = `preview-line ${line.type === "dialogue" ? "dialogue" : "direction"}`;
      if (line.type === "dialogue") {
        const character = (data.characters || []).find((entry) => entry.id === line.speakerId);
        item.style.setProperty("--character-color", character && character.color ? character.color : "#ffffff");
        const speaker = document.createElement("strong");
        speaker.textContent = line.speakerLabel || "Personage";
        const text = document.createElement("p");
        text.textContent = line.text || "";
        item.appendChild(speaker);
        item.appendChild(text);
      } else {
        const label = document.createElement("strong");
        label.textContent = "Regie";
        const text = document.createElement("p");
        text.textContent = line.text || "";
        item.appendChild(label);
        item.appendChild(text);
      }
      linePreview.appendChild(item);
    }
  }

  async function loadCurrent() {
    const response = await fetch("/api/teleprompter-parser/current", { cache: "no-store" });
    const payload = await response.json();
    if (!response.ok || !payload.ok) throw new Error(payload.error || "current_failed");
    renderTeleprompt(payload.teleprompt);
  }

  async function pollCurrent() {
    if (pollInFlight) return;
    pollInFlight = true;
    try {
      const response = await fetch("/api/teleprompter-parser/current", { cache: "no-store" });
      const payload = await response.json();
      if (!response.ok || !payload.ok) throw new Error(payload.error || "current_failed");
      const next = payload.teleprompt || {};
      const nextVersion = Number(next.version || 0);
      const nextSourceKind = next.source && next.source.kind ? String(next.source.kind) : "";
      if (nextVersion !== currentPreviewVersion || nextSourceKind !== currentPreviewSourceKind) {
        renderTeleprompt(next, { announce: true });
      }
    } catch (err) {
      if (!userHasManualDraft) {
        setStatus(err && err.message ? err.message : "Live preview kon niet verversen.", true);
      }
    } finally {
      pollInFlight = false;
    }
  }

  async function parseNow() {
    const rawText = rawInput.value.trim();
    if (!rawText) {
      setStatus("Ruwe tekst ontbreekt.", true);
      rawInput.focus();
      return;
    }
    parseButton.disabled = true;
    setStatus("Parser draait...", false);
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
      renderTeleprompt(payload.teleprompt);
      userHasManualDraft = false;
      setStatus(`Gepubliceerd naar stage: v${payload.teleprompt.version}`, false);
    } catch (err) {
      setStatus(err && err.message ? err.message : "Parse mislukt.", true);
    } finally {
      parseButton.disabled = false;
    }
  }

  parseButton.addEventListener("click", parseNow);
  sampleButton.addEventListener("click", () => {
    titleInput.value = "";
    rawInput.value = sampleText;
    userHasManualDraft = true;
    setStatus("", false);
    rawInput.focus();
  });
  clearButton.addEventListener("click", () => {
    titleInput.value = "";
    rawInput.value = "";
    userHasManualDraft = false;
    setStatus("", false);
    rawInput.focus();
  });

  titleInput.addEventListener("input", () => {
    userHasManualDraft = !!(titleInput.value.trim() || rawInput.value.trim());
  });
  rawInput.addEventListener("input", () => {
    userHasManualDraft = !!(titleInput.value.trim() || rawInput.value.trim());
  });
  rawInput.addEventListener("keydown", (event) => {
    if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
      event.preventDefault();
      parseNow();
    }
  });

  loadCurrent().catch((err) => {
    setStatus(err && err.message ? err.message : "Kon huidige teleprompt niet laden.", true);
  });
  window.setInterval(pollCurrent, 1000);
})();
