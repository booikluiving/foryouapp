"use strict";

const $ = (id) => document.getElementById(id);
const state = { stand: null, catalogus: null, proeven: { modellen: [], situaties: [], scenes: [] }, bezig: false, vuil: false };

// What the browser remembers per person: the model, thinking and length last chosen.
function onthoud(key, value) {
  try {
    if (value == null) return localStorage.getItem(`schrijver-${key}`) || "";
    localStorage.setItem(`schrijver-${key}`, value);
  } catch (_err) {
    // Without storage the choice simply starts empty.
  }
  return value;
}

// The model for this scene: empty is the model of the show.
function gekozenModel() {
  const keuze = $("modelkeuze").value;
  return keuze === "ander" ? $("modelnaam").value.trim() : keuze;
}

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
  const model = gekozenModel();
  const sleutels = s.sleutels || {};
  const kan = model ? (model.includes("/") ? sleutels.openrouter : sleutels.deepseek) : s.sleutel;
  $("schrijf").disabled = state.bezig || !kan;
  $("verstuur").disabled = state.bezig || !kan;
  $("ander-model").hidden = $("modelkeuze").value !== "ander";
  $("nadenken").disabled = !model;
  if (kan) $("model").textContent = model ? model : `${s.model.model} · zelfde instellingen als de show`;
  else $("model").textContent = model && model.includes("/") ? "Er is hier nog geen sleutel voor OpenRouter ingesteld." : "Er is hier nog geen sleutel voor het taalmodel ingesteld.";
}

function vulPrompts() {
  $("systeem").value = state.stand.proef.systemPrompt;
  $("sjabloon").value = state.stand.proef.promptTemplate;
  state.vuil = false;
}

// The line under a scene: what it is, and the button that keeps it for the team.
function metaRegel(info, vraag, tekst, model = "") {
  const knop = el("button", { type: "button" }, "Bewaar");
  knop.addEventListener("click", async () => {
    knop.disabled = true;
    try {
      toonBewaard((await api("/bewaard", { method: "POST", body: { tekst, vraag, model } })).bewaard);
      knop.textContent = "Bewaard";
    } catch (err) {
      knop.disabled = false;
      meld(err.message, "fout");
    }
  });
  return el("p", { class: "meta" }, info, knop);
}

function toonGesprek(messages) {
  const regels = [];
  messages.forEach((message, index) => {
    const antwoord = message.role === "assistant";
    regels.push(el("p", { class: antwoord ? "antwoord" : "vraag" }, message.content));
    if (antwoord && message.content) regels.push(metaRegel(`${message.content.length} tekens`, index ? messages[index - 1].content : "", message.content));
  });
  $("gesprek").replaceChildren(...regels);
  $("gesprek").scrollTop = $("gesprek").scrollHeight;
}

function toonBewaard(list) {
  $("bewaard-leeg").hidden = list.length > 0;
  $("bewaard").replaceChildren(...list.map((item) => {
    const weg = el("button", { type: "button", class: "licht" }, "Haal weg");
    weg.addEventListener("click", async () => {
      if (!confirm(`"${item.titel}" weghalen uit de bewaarde scènes?`)) return;
      try {
        toonBewaard((await api(`/bewaard/${encodeURIComponent(item.id)}`, { method: "DELETE" })).bewaard);
      } catch (err) {
        meld(err.message, "fout");
      }
    });
    const gebruik = el("button", { type: "button", class: "licht" }, "Zet deze prompt in de test");
    gebruik.addEventListener("click", () => {
      if (!confirm("De testprompt vervangen door de prompt waarmee deze scène is geschreven?")) return;
      werk(async () => {
        state.stand = await api("/proef", { method: "PUT", body: { systemPrompt: item.systemPrompt, promptTemplate: item.promptTemplate } });
        vulPrompts();
      });
    });
    return el("li", {}, el("details", {},
      el("summary", {}, item.titel, el("span", { class: "zacht" }, `${naam(item.by)} · ${when(item.at)}`)),
      el("pre", {}, item.tekst),
      el("details", {}, el("summary", {}, "Waarmee geschreven"),
        el("pre", {}, `${item.model || ""}\n\nHOOFDPROMPT\n${item.systemPrompt}\n\nOPDRACHT PER SCÈNE\n${item.promptTemplate}${item.vraag ? `\n\nVERSTUURD\n${item.vraag}` : ""}`)),
      el("div", { class: "knoppen" }, gebruik, weg)));
  }));
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
  const response = await fetch("/api/schrijver/chat", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ message, model: gekozenModel(), nadenken: $("nadenken").value }) });
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
      const regels = event.text.split("\n").filter((line) => /^[^:\n]{1,40}:\s/.test(line)).length;
      const kosten = event.kosten ? ` · ${(event.kosten * 100).toFixed(2).replace(".", ",")} cent` : "";
      const duur = event.seconden ? ` · ${String(event.seconden).replace(".", ",")} s` : "";
      log.append(metaRegel(`${regels} regels · ${event.text.length} tekens · ${event.model}${event.fallback ? " (terugval)" : ""}${duur}${kosten} · ${event.tokensIn} in, ${event.tokensUit} uit`, message, event.text, event.model));
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

// ---- The model for a scene, and what has been tried before ----
const OORDELEN = [["kandidaat", "Kandidaten"], ["show", "In de show"], ["afgeschreven", "Afgeschreven"], ["schrijft om", "Schrijft de situatie om"], ["weigert", "Weigert"], ["werkt niet", "Werkt niet"]];

function vulModellen() {
  const show = state.stand.model.model;
  const gezien = new Set([show]);
  const uniek = state.proeven.modellen.filter((item) => item.id && !gezien.has(item.id) && gezien.add(item.id));
  const optie = (item) => el("option", { value: item.id }, item.naam);
  const kandidaten = uniek.filter((item) => item.oordeel === "kandidaat");
  const rest = uniek.filter((item) => item.oordeel !== "kandidaat" && item.oordeel !== "werkt niet");
  $("modelkeuze").replaceChildren(
    el("option", { value: "" }, `Model van de show (${show})`),
    kandidaten.length ? el("optgroup", { label: "Kandidaten" }, kandidaten.map(optie)) : null,
    rest.length ? el("optgroup", { label: "Eerder getest" }, rest.map(optie)) : null,
    el("option", { value: "ander" }, "Ander model…"));
  const vorige = onthoud("model");
  if ([...$("modelkeuze").options].some((item) => item.value === vorige)) $("modelkeuze").value = vorige;
  $("modelnaam").value = onthoud("modelnaam");
  $("nadenken").value = onthoud("nadenken") === "kort" ? "kort" : "uit";
  $("lengte").value = onthoud("lengte");
}

function kiesModel(item) {
  const bekend = [...$("modelkeuze").options].some((optie) => optie.value === item.id);
  $("modelkeuze").value = item.id === state.stand.model.model ? "" : bekend ? item.id : "ander";
  if ($("modelkeuze").value === "ander") $("modelnaam").value = onthoud("modelnaam", item.id);
  $("nadenken").value = onthoud("nadenken", item.nadenken === "kort" ? "kort" : "uit");
  onthoud("model", $("modelkeuze").value);
  toonStand();
  $("modelkeuze").scrollIntoView({ block: "center" });
}

function toonProefScenes() {
  const naam = $("proef-model").value;
  const sid = $("proef-situatie").value;
  const titel = new Map(state.proeven.situaties.map((item) => [item.id, item.titel]));
  const lijst = state.proeven.scenes.filter((item) => item.model === naam && (!sid || item.sid === sid));
  $("proef-scenes").replaceChildren(...lijst.map((item) => el("article", {},
    el("h3", {}, titel.get(item.sid) || item.sid),
    el("p", { class: "zacht klein", style: "margin: 2px 0 0" }, [item.dag, item.proef, item.regels ? `${item.regels} regels` : null, item.sec ? `${String(item.sec).replace(".", ",")} s` : null, item.cent != null ? `${String(item.cent).replace(".", ",")} cent` : null].filter(Boolean).join(" · ")),
    el("pre", {}, item.tekst))));
  for (const rij of $("modellen").querySelectorAll("tr[data-naam]")) rij.classList.toggle("gekozen", rij.dataset.naam === naam);
}

function toonProeven() {
  const p = state.proeven;
  const heeft = p.modellen.length > 0;
  $("proeven-leeg").hidden = heeft;
  $("modellen").hidden = !heeft;
  $("proef-keuze").hidden = !heeft;
  if (!heeft) return;
  const rijen = [el("tr", {}, ["Model", "Notitie", "Tijd", "Kosten", "Scènes", ""].map((kop) => el("th", {}, kop)))];
  for (const [oordeel, kop] of OORDELEN) {
    const groep = p.modellen.filter((item) => item.oordeel === oordeel);
    if (!groep.length) continue;
    rijen.push(el("tr", { class: "groep" }, el("td", { colspan: 6 }, kop)));
    for (const item of groep) {
      const lees = el("button", { type: "button" }, "Lees");
      lees.addEventListener("click", () => {
        $("proef-model").value = item.naam;
        toonProefScenes();
        $("proef-keuze").scrollIntoView({ block: "start" });
      });
      const kies = item.id && oordeel !== "werkt niet" ? el("button", { type: "button" }, "Kies") : null;
      if (kies) kies.addEventListener("click", () => kiesModel(item));
      rijen.push(el("tr", { "data-naam": item.naam },
        el("td", {}, item.naam),
        el("td", { class: "zacht" }, item.notitie || ""),
        el("td", { class: "getal" }, item.sec ? `${String(item.sec).replace(".", ",")} s` : ""),
        el("td", { class: "getal" }, item.cent != null ? `${String(item.cent).replace(".", ",")} cent` : ""),
        el("td", { class: "getal" }, String(item.scenes)),
        el("td", { style: "white-space: nowrap" }, lees, kies ? " " : null, kies)));
    }
  }
  $("modellen").replaceChildren(...rijen);
  $("proef-model").replaceChildren(...p.modellen.map((item) => el("option", { value: item.naam }, item.naam)));
  $("proef-situatie").replaceChildren(el("option", { value: "" }, "alle"), ...p.situaties.map((item) => el("option", { value: item.id }, item.titel)));
  toonProefScenes();
}

$("modelkeuze").addEventListener("change", () => { onthoud("model", $("modelkeuze").value); toonStand(); });
$("modelnaam").addEventListener("input", () => { onthoud("modelnaam", $("modelnaam").value.trim()); toonStand(); });
$("nadenken").addEventListener("change", () => onthoud("nadenken", $("nadenken").value));
$("lengte").addEventListener("input", () => onthoud("lengte", $("lengte").value));
$("proef-model").addEventListener("change", toonProefScenes);
$("proef-situatie").addEventListener("change", toonProefScenes);

$("schrijf").addEventListener("click", () => werk(async () => {
  await bewaar();
  const characterIds = [...$("personages").querySelectorAll("input:checked")].map((input) => input.value);
  const klaar = await api("/klaarzetten", { method: "POST", body: { situationId: $("situatie").value, environmentId: $("omgeving").value, characterIds } });
  const regels = Math.round(Number($("lengte").value));
  await stuur(regels > 0 ? `${klaar.tekst}\n- Deze scène is ongeveer ${regels} regels.` : klaar.tekst);
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
    let kept;
    [state.stand, state.catalogus, kept, state.proeven] = await Promise.all([api(""), api("/catalogus"), api("/bewaard"), api("/proeven").catch(() => state.proeven)]);
    toonBewaard(kept.bewaard);
    vulModellen();
    toonProeven();
    vulPrompts();
    vulCatalogus();
    toonGesprek(state.stand.gesprek);
    toonStand();
    setInterval(ververs, 10000);
  } catch (err) {
    meld(err.message, "fout");
  }
})();
