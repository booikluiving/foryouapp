"use strict";

const $ = (id) => document.getElementById(id);
const state = { stand: null, catalogus: null, bezig: false, vuil: false };

function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (key === "class") node.className = value;
    else if (value !== false && value != null) node.setAttribute(key, value === true ? "" : value);
  }
  for (const child of children.flat()) {
    if (child != null && child !== false) node.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return node;
}

function when(iso) {
  if (!iso) return "";
  return new Date(iso).toLocaleString("nl-NL", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Europe/Amsterdam" });
}

async function api(path, options = {}) {
  const response = await fetch(`/api/schrijver${path}`, {
    ...options,
    headers: { "content-type": "application/json" },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.message || body.error || `HTTP ${response.status}`);
  return body;
}

function meld(text, kind = "") {
  $("melding").textContent = text;
  $("melding").className = `klein ${kind}`;
}

function naam(email) {
  return String(email || "").split("@")[0];
}

function toonStand() {
  const s = state.stand;
  if (!s) return;
  $("wie").textContent = s.me ? `Ingelogd als ${s.me}` : "";
  const regels = [];
  if (!s.show) regels.push(el("span", { class: "zacht" }, "De show-Mac heeft zijn prompt nog niet gemeld."));
  else if (s.gelijkAanShow && !state.vuil) regels.push(el("span", { class: "goed" }, "Gelijk aan de show."));
  else regels.push(el("span", {}, "Anders dan de show. De show verandert pas als je doorvoert."));
  const v = s.vrijgegeven;
  if (v && !v.inDeShow) regels.push(el("span", { class: "zacht" }, ` Doorgevoerd door ${naam(v.by)} (${when(v.at)}); wacht op de show-Mac.`));
  else if (v) regels.push(el("span", { class: "zacht" }, ` Laatst doorgevoerd door ${naam(v.by)}, ${when(v.at)}.`));
  $("stand").replaceChildren(...regels);
  $("doorvoeren").disabled = state.bezig || (s.gelijkAanShow && !state.vuil);
  $("van-show").disabled = state.bezig || !s.show || (s.gelijkAanShow && !state.vuil);
  $("schrijf").disabled = state.bezig || !s.sleutel;
  $("verstuur").disabled = state.bezig || !s.sleutel;
  $("model").textContent = s.sleutel ? `${s.model.model} · zelfde instellingen als de show` : "Er is hier nog geen sleutel voor het taalmodel ingesteld.";
}

function vulPrompts() {
  $("systeem").value = state.stand.proef.systemPrompt;
  $("sjabloon").value = state.stand.proef.promptTemplate;
  state.vuil = false;
}

function toonGesprek(messages) {
  $("gesprek").replaceChildren(...messages.map((message) => el("p", { class: message.role === "assistant" ? "antwoord" : "vraag" }, message.content)));
  $("gesprek").scrollTop = $("gesprek").scrollHeight;
}

function vulPersonages() {
  const situatie = state.catalogus.situaties.find((item) => item.id === $("situatie").value);
  const gekozen = new Set(situatie ? situatie.characterIds : []);
  $("personages").replaceChildren(...state.catalogus.personages.map((item) => el("label", {},
    el("input", { type: "checkbox", value: item.id, checked: gekozen.has(item.id) }),
    el("span", {}, item.naam))));
  if (situatie) $("omgeving").value = situatie.environmentId || "";
}

function vulCatalogus() {
  const c = state.catalogus;
  $("situatie").replaceChildren(...c.situaties.map((item) => el("option", { value: item.id }, item.naam)));
  $("omgeving").replaceChildren(el("option", { value: "" }, "geen"), ...c.omgevingen.map((item) => el("option", { value: item.id }, item.naam)));
  vulPersonages();
}

// The test prompt is saved before anything is written or put through, so what you see is what is used.
async function bewaar() {
  if (!state.vuil) return;
  const body = { systemPrompt: $("systeem").value, promptTemplate: $("sjabloon").value };
  state.stand = await api("/proef", { method: "PUT", body });
  state.vuil = body.systemPrompt !== $("systeem").value || body.promptTemplate !== $("sjabloon").value;
}

async function werk(work) {
  if (state.bezig) return;
  state.bezig = true;
  meld("");
  toonStand();
  try {
    await work();
  } catch (err) {
    meld(err.message, "fout");
  }
  state.bezig = false;
  toonStand();
}

async function stuur(message) {
  const log = $("gesprek");
  const antwoord = el("p", { class: "antwoord bezig" });
  log.append(el("p", { class: "vraag" }, message), antwoord);
  log.scrollTop = log.scrollHeight;
  const response = await fetch("/api/schrijver/chat", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ message }) });
  if (!response.ok || !response.body) throw new Error((await response.json().catch(() => ({}))).message || `HTTP ${response.status}`);
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  const handle = (event) => {
    const volgt = log.scrollHeight - log.scrollTop - log.clientHeight < 60;
    if (event.type === "delta") antwoord.append(event.text);
    else if (event.type === "opnieuw") antwoord.textContent = "";
    else if (event.type === "done") {
      antwoord.textContent = event.text;
      log.append(el("p", { class: "meta" }, `${event.text.length} tekens · ${event.model}${event.fallback ? " (terugval)" : ""} · ${event.tokensIn} in, ${event.tokensUit} uit`));
    } else if (event.type === "error") {
      log.append(el("p", { class: "mis" }, event.error));
    }
    if (volgt) log.scrollTop = log.scrollHeight;
  };
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let index;
    while ((index = buffer.indexOf("\n\n")) >= 0) {
      const line = buffer.slice(0, index).replace(/^data: ?/, "");
      buffer = buffer.slice(index + 2);
      if (line) handle(JSON.parse(line));
    }
  }
  antwoord.classList.remove("bezig");
}

// Typing saves by itself a moment later, without holding up the buttons.
let straks = null;
function getypt() {
  state.vuil = true;
  toonStand();
  clearTimeout(straks);
  straks = setTimeout(() => {
    if (state.bezig) return;
    bewaar().then(toonStand).catch((err) => meld(err.message, "fout"));
  }, 1500);
}
$("systeem").addEventListener("input", getypt);
$("sjabloon").addEventListener("input", getypt);
$("situatie").addEventListener("change", vulPersonages);

$("schrijf").addEventListener("click", () => werk(async () => {
  await bewaar();
  const characterIds = [...$("personages").querySelectorAll("input:checked")].map((input) => input.value);
  const klaar = await api("/klaarzetten", { method: "POST", body: { situationId: $("situatie").value, environmentId: $("omgeving").value, characterIds } });
  await stuur(klaar.tekst);
}));

$("verstuur").addEventListener("click", () => werk(async () => {
  const message = $("invoer").value.trim();
  if (!message) return;
  await bewaar();
  $("invoer").value = "";
  await stuur(message);
}));

$("wis").addEventListener("click", () => werk(async () => {
  await api("/gesprek", { method: "DELETE" });
  toonGesprek([]);
}));

$("doorvoeren").addEventListener("click", () => {
  if (!confirm("Deze hoofdprompt en opdracht per scène naar de show sturen? De show gebruikt ze vanaf de volgende scène.")) return;
  werk(async () => {
    await bewaar();
    state.stand = await api("/doorvoeren", { method: "POST" });
    meld("Doorgevoerd. De show-Mac haalt het binnen een halve minuut op.", "goed");
  });
});

$("van-show").addEventListener("click", () => {
  if (!confirm("De testprompt vervangen door de prompt die nu in de show staat?")) return;
  werk(async () => {
    state.stand = await api("/van-show", { method: "POST" });
    vulPrompts();
  });
});

async function ververs() {
  if (state.bezig || state.vuil) return;
  try {
    const stand = await api("");
    const anders = !state.stand || stand.proef.systemPrompt !== state.stand.proef.systemPrompt || stand.proef.promptTemplate !== state.stand.proef.promptTemplate;
    state.stand = stand;
    if (anders && document.activeElement !== $("systeem") && document.activeElement !== $("sjabloon")) vulPrompts();
    toonStand();
  } catch (_err) {
    // The next round tries again.
  }
}

(async () => {
  try {
    [state.stand, state.catalogus] = await Promise.all([api(""), api("/catalogus")]);
    vulPrompts();
    vulCatalogus();
    toonGesprek(state.stand.gesprek);
    toonStand();
    setInterval(ververs, 10000);
  } catch (err) {
    meld(err.message, "fout");
  }
})();
