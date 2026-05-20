(function () {
  "use strict";

  const titleInput = document.getElementById("titleInput");
  const rawTextInput = document.getElementById("rawTextInput");
  const parseButton = document.getElementById("parseButton");
  const statusText = document.getElementById("statusText");
  const previewTitle = document.getElementById("previewTitle");
  const previewMeta = document.getElementById("previewMeta");
  const linePreview = document.getElementById("linePreview");

  let currentVersion = 0;
  let userEdited = false;

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
      if (!response.ok || !payload.ok || !payload.teleprompt) return;
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

  pollCurrent();
  window.setInterval(pollCurrent, 1000);
})();
