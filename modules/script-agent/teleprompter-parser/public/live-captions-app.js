(function () {
  "use strict";

  const root = document.getElementById("captionRoot");
  const card = document.getElementById("captionCard");
  const debug = document.getElementById("captionDebug");
  const CAPTION_WIDTH = 1080;
  const CAPTION_HEIGHT = 1920;
  const params = new URLSearchParams(window.location.search);
  const debugEnabled = params.get("debug") === "1";
  const browserPreviewEnabled = params.get("preview") === "1";

  const DEFAULT_CAPTION_STYLE = Object.freeze({
    fontSizeScale: 1,
    verticalPosition: 66,
    widthPercent: 86,
    outlineScale: 1,
  });
  const OUTLINE_EM_AT_100 = 0.057; // gemeten op CapCut-standaardtekst: rand ≈ 0,057 × lettergrootte

  let teleprompt = null;
  let preparedScene = null;
  // Engelse vertaling per Nederlandse regel (komt van de tekstparser zodra het script vertaald is).
  let engels = {};
  let showState = null;
  let cue = { index: 0, version: -1, deckLength: 0 };
  let captionStyle = { ...DEFAULT_CAPTION_STYLE };
  let endSceneInFlight = false;

  function clampNumber(value, min, max, fallback) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return fallback;
    return Math.max(min, Math.min(max, numeric));
  }

  function normalizeCaptionStyle(style = {}) {
    return {
      fontSizeScale: clampNumber(style.fontSizeScale, 0.45, 1.25, DEFAULT_CAPTION_STYLE.fontSizeScale),
      verticalPosition: clampNumber(style.verticalPosition, 50, 84, DEFAULT_CAPTION_STYLE.verticalPosition),
      widthPercent: clampNumber(style.widthPercent, 56, 96, DEFAULT_CAPTION_STYLE.widthPercent),
      outlineScale: clampNumber(style.outlineScale, 0.45, 1.25, DEFAULT_CAPTION_STYLE.outlineScale),
    };
  }

  function applyCaptionStyle(style = {}, { volgGezichten = true } = {}) {
    captionStyle = normalizeCaptionStyle(style);
    plek.volg = volgGezichten;
    root.style.setProperty("--caption-size-scale", captionStyle.fontSizeScale.toFixed(3));
    root.style.setProperty("--caption-width", `${captionStyle.widthPercent.toFixed(1)}%`);
    root.style.setProperty("--caption-outline", buildOutline(OUTLINE_EM_AT_100 * captionStyle.outlineScale));
    zetPlek();
  }

  // Ondertitel uit de gezichten: TouchDesigner (FY Gezichten) stuurt een paar keer per seconde de kaders
  // van de gezichten op het hoofdscherm (0..1, linksboven). De pagina onthoudt die van de laatste minuut
  // (alle camerabeelden door elkaar) en rekent per hoogte uit hoe vaak de ondertitel daar over iemands
  // ogen had gestaan (bovenste helft van het gezicht; over een kin mag, over ogen niet). Zo vindt hij één plek die voor alle drie de camera's vrij is en blijft daar staan: bij
  // een camerawissel verschuift hij niet. Alleen bij een nieuwe regel kijkt hij opnieuw, en hij verhuist
  // alleen als de plek duidelijk vrijer is. Liever laag dan hoog; boven 40 % alleen als het echt moet.
  // Nagebootst op de opname van 20 nov (23 scènes): 17 verplaatsingen in plaats van ± 350, nooit midden
  // in een zin, en minder vaak over ogen dan eerst (2,4 % van de tijd tegen 2,7 %).
  const RAND = 3; // % vrij aan de boven- en onderkant van het beeld
  const OOG_DEEL = 0.55; // bovenste deel van het gezichtskader: daar zitten de ogen
  const OOG_MARGE = 0.01;
  const ZONDER_KADERS_MS = 1000;
  const VENSTER_MS = 60000; // hoe ver hij terugkijkt
  const STROOK = 0.2; // hoogte waarmee hij een plek kiest (vast, zodat een langere zin hem niet laat verhuizen)
  const MARGE = 0.08; // zoveel vrijer moet een nieuwe plek zijn
  const AL_VRIJ = 0.03; // staat hij hooguit zo vaak op een gezicht, dan blijft hij altijd staan
  const plek = { volg: true, top: null, kaders: [], kadersAt: 0, regel: null, geschiedenis: [] };

  // Alle hoogtes (per 1 %) waar de strook helemaal in beeld past.
  function plekken() {
    const half = STROOK * 50;
    const lijst = [];
    for (let top = Math.ceil(RAND + half); top <= Math.floor(100 - RAND - half); top += 1) lijst.push(top);
    return lijst;
  }

  function kadersVers(nu) {
    return plek.kaders.length > 0 && nu - plek.kadersAt < ZONDER_KADERS_MS;
  }

  function onthoud(nu) {
    if (captionsAreLive()) plek.geschiedenis.push({ t: nu, kaders: plek.kaders });
    while (plek.geschiedenis.length && plek.geschiedenis[0].t < nu - VENSTER_MS) plek.geschiedenis.shift();
  }

  // Valt de strook op hoogte top over iemands ogen?
  function overOgen(top, kaders) {
    const b = captionStyle.widthPercent / 100;
    const x0 = 0.5 - b / 2, x1 = 0.5 + b / 2, y0 = top / 100 - STROOK / 2, y1 = top / 100 + STROOK / 2;
    return kaders.some((k) => Math.min(x1, k.x + k.b) > Math.max(x0, k.x)
      && Math.min(y1, k.y + k.h * OOG_DEEL + OOG_MARGE) > Math.max(y0, k.y - OOG_MARGE));
  }

  // Deel van de laatste minuut dat de ondertitel op hoogte top over iemands ogen had gestaan.
  function kostOp(top) {
    const lijst = plek.geschiedenis;
    if (!lijst.length) return 0;
    let n = 0;
    lijst.forEach((m) => { if (overOgen(top, m.kaders)) n += 1; });
    return n / lijst.length;
  }

  // Voorkeur: de gewone plek; lager kost weinig, hoger iets meer, boven 40 % veel.
  function voorkeur(top) {
    const gewoon = captionStyle.verticalPosition;
    if (top >= gewoon) return (top - gewoon) * 0.001;
    return (gewoon - top) * 0.002 + (top < 40 ? 0.3 : 0);
  }

  function springNaar(top) {
    if (top === plek.top) return;
    plek.top = top;
    root.style.setProperty("--caption-top", `${top.toFixed(1)}%`);
    root.dataset.plek = String(top);
  }

  // nieuweRegel: er staat net een andere zin; alleen dan mag hij verhuizen.
  function zetPlek(nieuweRegel = false) {
    const gewoon = captionStyle.verticalPosition;
    if (plek.top === null || plek.gewoon !== gewoon || !plek.volg) {
      plek.gewoon = gewoon;
      springNaar(gewoon);
      return;
    }
    if (!nieuweRegel || card.hidden || !plek.geschiedenis.length) return;
    const nu = kostOp(plek.top);
    if (nu <= AL_VRIJ) return;
    let beste = plek.top, besteScore = Infinity;
    plekken().forEach((top) => {
      const score = kostOp(top) + voorkeur(top);
      if (score < besteScore) { beste = top; besteScore = score; }
    });
    if (besteScore < nu + voorkeur(plek.top) - MARGE) springNaar(beste);
  }

  function tekenKaders() {
    if (!debugEnabled) return;
    let laag = document.getElementById("captionKaders");
    if (!laag) {
      laag = document.createElement("div");
      laag.id = "captionKaders";
      laag.style.cssText = "position:absolute;inset:0;pointer-events:none;";
      root.appendChild(laag);
    }
    laag.textContent = "";
    if (!kadersVers(Date.now())) return;
    plek.kaders.forEach((k) => {
      const vak = document.createElement("div");
      vak.style.cssText = `position:absolute;left:${k.x * 100}%;top:${k.y * 100}%;width:${k.b * 100}%;height:${k.h * 100}%;border:3px solid #ffd400;box-sizing:border-box;`;
      laag.appendChild(vak);
    });
  }

  function ontvangKaders(lijst) {
    plek.kaders = (Array.isArray(lijst) ? lijst : [])
      .map((k) => ({ x: Number(k.x), y: Number(k.y), b: Number(k.b), h: Number(k.h) }))
      .filter((k) => [k.x, k.y, k.b, k.h].every(Number.isFinite) && k.b > 0 && k.h > 0)
      .slice(0, 8);
    plek.kadersAt = Date.now();
    onthoud(plek.kadersAt);
    tekenKaders();
  }

  window.addEventListener("message", (event) => {
    const data = event.data;
    if (!data || data.type !== "fy-gezichten") return;
    ontvangKaders(data.kaders);
  });
  window.setInterval(() => { tekenKaders(); }, 250);

  // Ronde zwarte rand buiten de letter (zoals CapCut): ringen van schaduwkopieën in em,
  // zodat de rand meeschaalt met de lettergrootte en niet afhangt van paint-order in TD's browser.
  function buildOutline(widthEm) {
    const shadows = [];
    [[1, 32], [0.5, 16]].forEach(([fraction, steps]) => {
      const radius = widthEm * fraction;
      for (let step = 0; step < steps; step += 1) {
        const angle = (step / steps) * Math.PI * 2;
        shadows.push(`${(Math.cos(angle) * radius).toFixed(4)}em ${(Math.sin(angle) * radius).toFixed(4)}em 0 #000`);
      }
    });
    return shadows.join(", ");
  }

  function updateCaptionScale() {
    if (debugEnabled || browserPreviewEnabled) {
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

  function captionsAreLive() {
    return !!(
      showState &&
      showState.active === true &&
      preparedScene &&
      preparedScene.status === "playing"
    );
  }

  function clampIndex(index) {
    return Math.max(0, Math.min(Number.parseInt(index, 10) || 0, Math.max(deckLength() - 1, 0)));
  }

  function clearCard() {
    while (card.firstChild) card.removeChild(card.firstChild);
  }

  // Een aanwijzing (*gromt zacht*) staat in de ondertitel zelf, tussen sterretjes en cursief, op de plek
  // waar hij in de zin staat: "*gromt zacht* Ik meen het." De gesproken tekst blijft recht.
  function addDirection(target, text) {
    const direction = document.createElement("span");
    direction.className = "caption-inline-direction";
    direction.textContent = `*${text}*`;
    target.appendChild(direction);
  }

  function appendFormattedText(target, input) {
    const text = String(input || "").replace(/\s+/g, " ").trim();
    const pattern = /\*([^*\n]+)\*/g;
    let cursor = 0;
    let match;
    while ((match = pattern.exec(text))) {
      if (match.index > cursor) target.appendChild(document.createTextNode(text.slice(cursor, match.index)));
      const inner = match[1].trim();
      if (inner) addDirection(target, inner);
      cursor = match.index + match[0].length;
    }
    if (cursor < text.length) target.appendChild(document.createTextNode(text.slice(cursor)));
  }

  // De titel in beeld is de titel van de situatie, niet een kopregel uit het script.
  function situationTitle() {
    const prepared = String(preparedScene && preparedScene.title || "").trim();
    if (prepared && prepared !== "Volgende scene") return prepared;
    const parsed = String(teleprompt && teleprompt.title || "").trim();
    return parsed && parsed !== "Teleprompt" ? parsed : "";
  }

  // Een trendscène (omgeving Trend) heeft geen tekst in beeld: de emoji-laag zegt wat er gebeurt.
  // Alleen het lege einde blijft; de regels staan nog wel op de teleprompter.
  const ZONDER_TEKST_OMGEVING_RE = /^\s*trend\s*$/i;

  function sceneZonderTekst() {
    const omgeving = preparedScene && preparedScene.environment;
    return ZONDER_TEKST_OMGEVING_RE.test(String(omgeving && omgeving.name || ""));
  }

  function vorigeSpreker(lines, lineIndex) {
    for (let i = lineIndex - 1; i >= 0; i -= 1) {
      const line = lines[i];
      if (line && line.type === "dialogue" && line.text) return String(line.speakerLabel || "").trim();
    }
    return "";
  }

  function captionForIndex(index) {
    const lines = teleprompt && Array.isArray(teleprompt.lines) ? teleprompt.lines : [];
    // De scène begint met de eerste regel; de titel stond al op het zaalscherm tijdens het schrijven.
    if (index <= 0) return null;
    if (!lines.length) return null;
    // Na de laatste regel blijft het beeld leeg: ruimte voor de laatste reacties van de spelers.
    if (index >= lines.length + 1) return null;
    if (sceneZonderTekst()) return null;
    const line = lines[index - 1];
    if (!line || !line.text) return null;
    // Een kopregel (#) die nog in het script staat, toont ook de titel van de situatie.
    const titel = line.type !== "dialogue" && /^\s*#+\s*(.+)$/.exec(line.text);
    if (titel) return { type: "title", text: situationTitle() || titel[1].trim() };
    // Dialoog op het hoofdscherm altijd met de naam: "Naam:" en de zin op de regel eronder.
    // De naam staat er alleen als er iemand anders begint te praten dan bij de vorige dialoogregel:
    // elke zin is een eigen klik, dus anders staat dezelfde naam er een paar keer achter elkaar.
    if (line.type === "dialogue") {
      const speaker = String(line.speakerLabel || "").trim();
      const vorige = vorigeSpreker(lines, index - 1);
      return { type: "dialogue", speaker: speaker && speaker !== vorige ? speaker : "", text: line.text, en: engels[String(line.text).trim()] || "" };
    }
    // Een regel die alleen een aanwijzing is: tussen sterretjes en cursief op de plek van de ondertitel.
    const aanwijzing = String(line.text).replace(/^\*+|\*+$/g, "").trim();
    const en = String(engels[String(line.text).trim()] || "").replace(/^\*+|\*+$/g, "").trim();
    return aanwijzing ? { type: "direction", text: aanwijzing, en } : null;
  }

  function atEndCard() {
    return captionsAreLive() && deckLength() > 0 && clampIndex(cue.index) >= deckLength() - 1;
  }

  function isOverflowing(element) {
    return element.scrollHeight > element.clientHeight + 1 || element.scrollWidth > element.clientWidth + 1;
  }

  function fitCaption() {
    if (card.classList.contains("end")) return;
    card.style.removeProperty("font-size");
    const baseFontSize = Number.parseFloat(window.getComputedStyle(card).fontSize);
    if (!Number.isFinite(baseFontSize) || !isOverflowing(card)) return;
    const minFontSize = 58 * captionStyle.fontSizeScale;
    for (let size = baseFontSize - 4; size >= minFontSize; size -= 4) {
      card.style.fontSize = `${size}px`;
      if (!isOverflowing(card)) return;
    }
    card.style.fontSize = `${Math.max(26, Math.round(minFontSize))}px`;
  }

  // De Engelse zin staat onder de Nederlandse, in een eigen kleur, voor publiek dat geen Nederlands spreekt.
  function engelsRegel() {
    const regel = document.createElement("span");
    regel.className = "caption-engels";
    card.appendChild(regel);
    return regel;
  }

  function render() {
    const activeCaption = captionsAreLive() ? captionForIndex(clampIndex(cue.index)) : null;
    clearCard();
    root.dataset.cueIndex = String(cue.index || 0);
    root.dataset.captionText = activeCaption ? activeCaption.text : "";
    root.dataset.live = captionsAreLive() ? "1" : "0";
    if (debugEnabled && debug) {
      const title = teleprompt && teleprompt.title ? teleprompt.title : "geen scene";
      debug.hidden = false;
      const status = captionsAreLive() ? "live" : "verborgen";
      debug.textContent = `Live captions ${status} | cue ${cue.index || 0}/${Math.max(deckLength() - 1, 0)} | ${title}`;
    }
    if (!activeCaption || !activeCaption.text) {
      card.hidden = true;
      card.className = "caption-card";
      return;
    }
    card.hidden = false;
    card.className = `caption-card ${activeCaption.type}`;
    if (activeCaption.type === "title") {
      const blok = document.createElement("span");
      blok.className = "caption-title-text";
      blok.textContent = activeCaption.text;
      card.appendChild(blok);
    } else if (activeCaption.type === "direction") {
      addDirection(card, activeCaption.text);
      if (activeCaption.en) addDirection(engelsRegel(), activeCaption.en);
    } else {
      if (activeCaption.type === "dialogue" && activeCaption.speaker) {
        const naam = document.createElement("span");
        naam.className = "caption-speaker";
        // De naam staat op een eigen regel, de zin eronder: zo lees je de naam niet steeds mee.
        naam.style.display = "block";
        naam.textContent = `${activeCaption.speaker}:`;
        card.appendChild(naam);
      }
      appendFormattedText(card, activeCaption.text);
      if (activeCaption.en) appendFormattedText(engelsRegel(), activeCaption.en);
    }
    fitCaption();
    const regel = `${activeCaption.type}|${activeCaption.speaker || ""}|${activeCaption.text}`;
    zetPlek(regel !== plek.regel);
    plek.regel = regel;
    meldGetoond();
  }

  // Vertragingsmeting: zodra een nieuwe cue echt in beeld staat (na twee frames), meldt de pagina dat
  // aan de tekstparser. Die zet klik → tekstparser → beeld in het logboek.
  let gemeldeVersie = -1;
  function meldGetoond() {
    const versie = Number(cue && cue.version);
    if (!captionsAreLive() || !Number.isFinite(versie) || versie === gemeldeVersie) return;
    gemeldeVersie = versie;
    window.requestAnimationFrame(() => window.requestAnimationFrame(() => {
      fetch("/v0/script-agent/teleprompter-parser/ondertitel-getoond", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ version: versie, getoondAt: Date.now() }),
      }).catch(() => {});
    }));
  }

  function applyCurrentPayload(payload) {
    if (!payload || !payload.ok) return;
    showState = payload.show || null;
    preparedScene = payload.preparedScene || null;
    teleprompt = payload.teleprompt || null;
    engels = payload.engels && typeof payload.engels === "object" ? payload.engels : {};
    cue = payload.cue || { index: 0, version: -1, deckLength: 0 };
    // Met een bord (blind ranking) staat het plaatje midden in beeld: de ondertitel gaat eronder.
    const stijl = payload.captionStyle || DEFAULT_CAPTION_STYLE;
    // Met een bord volgt de ondertitel de gezichten niet: hij blijft onder het plaatje.
    applyCaptionStyle(teleprompt && teleprompt.bord ? { ...stijl, verticalPosition: 84 } : stijl, { volgGezichten: !(teleprompt && teleprompt.bord) });
    render();
    herlaadBijNieuweVersie(payload.ondertitelVersie);
  }

  // Is de pagina op de show-Mac aangepast, dan herlaadt ze zichzelf, maar nooit midden in een scène.
  const eigenVersie = (() => {
    const script = document.querySelector('script[src*="live-captions-app.js"]');
    const match = script && /[?&]v=([^&]+)/.exec(script.getAttribute("src") || "");
    return match ? match[1] : "";
  })();
  let herlaadGepland = false;
  function herlaadBijNieuweVersie(versie) {
    if (herlaadGepland || !versie || !eigenVersie || versie === eigenVersie || captionsAreLive()) return;
    herlaadGepland = true;
    window.setTimeout(() => window.location.reload(), 1000);
  }

  async function triggerEndSceneFromEndCard() {
    if (!atEndCard() || endSceneInFlight) return;
    endSceneInFlight = true;
    try {
      const response = await fetch("/v0/script-agent/teleprompter-parser/end-scene", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      });
      const payload = await response.json();
      if (response.ok && payload && payload.ok) applyCurrentPayload(payload);
    } catch {
    } finally {
      endSceneInFlight = false;
    }
  }

  function handleAdvanceKey(event) {
    if (event.key !== "PageDown" && event.key !== "ArrowRight" && event.key !== " ") return;
    if (!atEndCard()) return;
    event.preventDefault();
    triggerEndSceneFromEndCard();
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
        applyCurrentPayload(JSON.parse(event.data));
      } catch {}
    };
  }

  window.addEventListener("resize", updateCaptionScale);
  window.addEventListener("keydown", handleAdvanceKey);
  if (window.visualViewport) window.visualViewport.addEventListener("resize", updateCaptionScale);

  if (debugEnabled) document.body.classList.add("caption-debug-mode");
  else if (browserPreviewEnabled) document.body.classList.add("caption-browser-preview-mode");
  applyCaptionStyle(DEFAULT_CAPTION_STYLE);
  updateCaptionScale();
  connectEvents();
  pollCurrent();
  window.setInterval(pollCurrent, 500);
})();
