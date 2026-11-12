"use strict";

// Personages uit de catalogus die meepraten in de chat. De tekst komt van het taalmodel
// van de script-agent (zelfde sleutel, zelfde model), met de beschrijving van het personage als instructie.

const fs = require("node:fs/promises");
const path = require("node:path");
const { scriptAgentDbDir } = require("../../script-agent/script-output/state-store");

const DEEPSEEK_URL = "https://api.deepseek.com/chat/completions";
const STANDAARD_MODEL = "deepseek-v4-pro";
const MAX_TEKENS = 140;
const MAX_SCRIPT = 3500;

function catalogBaseUrl() {
  return String(process.env.AUDIENCE_CATALOG_URL || "http://127.0.0.1:3021").replace(/\/+$/, "");
}

function scriptAgentBaseUrl() {
  return String(process.env.AUDIENCE_SCRIPT_AGENT_URL || "http://127.0.0.1:3027").replace(/\/+$/, "");
}

async function leesJson(bestand) {
  try {
    const parsed = JSON.parse(await fs.readFile(bestand, "utf8"));
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

async function metTimeout(ms, werk) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    return await werk(controller.signal);
  } finally {
    clearTimeout(timer);
  }
}

// Alle actieve personages: [{ id, naam, beschrijving }].
async function haalPersonages({ fetchImpl = fetch } = {}) {
  const catalog = await metTimeout(4000, async (signal) => {
    const response = await fetchImpl(`${catalogBaseUrl()}/v0/catalog/read-model`, { signal });
    if (!response.ok) throw new Error(`catalogus gaf ${response.status}`);
    return response.json();
  });
  return (catalog.characters || [])
    .filter((item) => item && item.active && !item.archivedAt && String(item.name || "").trim())
    .map((item) => ({
      id: String(item.id),
      naam: String(item.name).trim(),
      beschrijving: String(item.promptText || item.description || "").trim().slice(0, 1200),
    }));
}

// Het script dat voor deze scène gegenereerd is: dat is wat het publiek echt hoorde. "" als het er niet is.
async function haalScript(scene, { fetchImpl = fetch } = {}) {
  if (!scene || !scene.showRunId || !scene.situationId) return "";
  const data = await metTimeout(4000, async (signal) => {
    const url = `${scriptAgentBaseUrl()}/v0/script-agent/scripts?showRunId=${encodeURIComponent(scene.showRunId)}`;
    const response = await fetchImpl(url, { signal });
    if (!response.ok) throw new Error(`script-agent gaf ${response.status}`);
    return response.json();
  });
  const passend = (data.scripts || []).filter((item) => item && item.situationId === scene.situationId);
  const laatste = passend[passend.length - 1];
  return laatste ? String(laatste.scriptText || "").trim().slice(0, MAX_SCRIPT) : "";
}

function kies(lijst, rng) {
  return lijst[Math.min(lijst.length - 1, Math.floor(rng() * lijst.length))];
}

// Per bericht wordt hier gedobbeld waar het over gaat, hoe lang het is en hoeveel karakter erin zit.
// Dat geeft meer afwisseling dan het model zelf laten kiezen.
function kiesOpdracht(personage, { scene, chat, rng }) {
  const anderen = chat.slice(-6).filter((item) => item.naam && item.naam !== personage.naam);
  const worp = rng();
  let waarover;
  if (scene && worp < 0.45) {
    waarover = kies([
      "Reageer op één concreet moment of detail uit het filmpje. Vat het niet samen.",
      "Reageer op één zin die iemand in het filmpje zei. Je mag hem half aanhalen.",
      "Reageer op de wending of op hoe het afliep: zag je het aankomen, vond je het terecht?",
      "Kies partij voor of tegen iemand uit het filmpje.",
    ], rng);
  } else if (anderen.length && worp < 0.8) {
    const doel = kies(anderen, rng);
    waarover = `Reageer op wat ${doel.naam} net schreef ("${doel.tekst.slice(0, 120)}"). Geef antwoord, wees het oneens, of maak er een grap over. Je mag de naam noemen, hoeft niet.`;
  } else {
    waarover = "Zeg iets wat los staat van het filmpje: wat je nu doet, denkt of wilt, of iets over de zaal of de avond.";
  }
  const lengte = kies([
    "Hooguit 4 woorden.",
    "Hooguit 4 woorden.",
    "Hooguit 9 woorden.",
    "Hooguit 9 woorden.",
    "Hooguit 9 woorden.",
    "Hooguit 15 woorden.",
  ], rng);
  const karakter = rng() < 0.25
    ? "Dit keer mag je karakter er dik bovenop liggen: iets wat alleen jij zou zeggen."
    : "Dit keer ben je gewoon een kijker. Je karakter zit alleen in je toon en woordkeus, niet in waar je het over hebt.";
  return [waarover, lengte, karakter].join(" ");
}

function bouwBerichten(personage, { scene = null, chat = [], onderwerp = "", eerder = [], rng = Math.random } = {}) {
  const film = typeof scene === "string" ? { titel: scene } : (scene || null);
  const heeftFilm = Boolean(film && film.titel);
  const speeldeMee = heeftFilm && (film.personages || []).includes(personage.naam);
  const systeem = [
    `Je bent ${personage.naam}. Je zit in de zaal bij For_You en typt op je telefoon mee in de live chat. Op het grote scherm is net een filmpje vertoond; iedereen in de chat heeft hetzelfde gezien.`,
    personage.beschrijving ? `Wie je bent:\n${personage.beschrijving}` : "",
    [
      "Zo schrijf je:",
      "- Als een echt mens in een groepschat: kort, slordig, spreektaal. Kleine letters mag, punt aan het eind hoeft niet, af en toe één emoji.",
      "- Zeg nooit wie of wat je bent. Dus niet \"als arts zeg ik\" of \"ik als hond\". De anderen kennen je al; laat het merken aan hoe je praat.",
      "- Heb een mening. Liever flauw, bot, verward of jaloers dan beleefd en enthousiast.",
      "- Geen uitroepen als \"wat een scène\", \"geweldig\" of \"prachtig\", geen hashtags, geen vraag aan iedereen, geen uitleg van je eigen grap.",
      "- Verzin niets over het filmpje wat er niet in zat.",
      "- Grof taalgebruik alleen als het bij jou hoort. Nooit discriminerende scheldwoorden over afkomst, geloof, geaardheid of handicap.",
    ].join("\n"),
    "Geef alleen het bericht: één regel, geen naam ervoor, geen aanhalingstekens.",
  ].filter(Boolean).join("\n\n");
  const regels = chat.slice(-12).map((item) => `${item.naam}: ${item.tekst}`);
  const filmTekst = heeftFilm
    ? [
      `Het filmpje van zojuist: "${film.titel}"${film.omgeving ? ` (${film.omgeving})` : ""}.`,
      film.script
        ? `Dit is wat er gezegd werd:\n${film.script}`
        : (film.verloop ? `Wat er gebeurde: ${film.verloop}` : ""),
      (film.personages || []).length ? `Wie erin zaten: ${film.personages.join(", ")}.` : "",
      speeldeMee ? "Jij zat er zelf in. Je kijkt nu terug op je eigen optreden." : "",
    ].filter(Boolean).join("\n")
    : "Er is nog geen filmpje vertoond; iedereen wacht tot het begint.";
  const gebruiker = [
    filmTekst,
    onderwerp ? `Waar de avond over gaat: ${onderwerp}` : "",
    regels.length ? `Chat tot nu toe:\n${regels.join("\n")}` : "De chat is nog leeg.",
    eerder.length ? `Dit schreef je zelf al, herhaal het niet en begin anders:\n${eerder.map((regel) => `- ${regel}`).join("\n")}` : "",
    `Opdracht voor dit bericht: ${kiesOpdracht(personage, { scene: heeftFilm ? film : null, chat, rng })}`,
    `Jouw bericht als ${personage.naam}:`,
  ].filter(Boolean).join("\n\n");
  return [
    { role: "system", content: systeem },
    { role: "user", content: gebruiker },
  ];
}

// Eén regel, zonder naam ervoor of aanhalingstekens eromheen.
function maakSchoon(tekst, naam = "") {
  let regel = String(tekst || "").split(/\r?\n/).map((deel) => deel.trim()).find(Boolean) || "";
  if (naam && regel.toLowerCase().startsWith(`${naam.toLowerCase()}:`)) regel = regel.slice(naam.length + 1).trim();
  regel = regel.replace(/^["'“”‘’«»]+|["'“”‘’«»]+$/g, "").trim();
  // Alleen de eigen naam is geen bericht.
  if (naam && regel.toLowerCase().replace(/[^\p{L}\p{N}]/gu, "") === naam.toLowerCase().replace(/[^\p{L}\p{N}]/gu, "")) return "";
  return regel.slice(0, MAX_TEKENS);
}

function maakPersonageStem({ fetchImpl = fetch, env = process.env } = {}) {
  let toegang = null;
  let toegangTot = 0;

  async function leesToegang() {
    if (toegang && Date.now() < toegangTot) return toegang;
    const map = scriptAgentDbDir();
    const geheimen = await leesJson(path.join(map, "operator-secrets.json"));
    const instellingen = await leesJson(path.join(map, "operator-settings.json"));
    const model = String(instellingen.model || "");
    toegang = {
      sleutel: String(geheimen.DEEPSEEK_API_KEY || env.DEEPSEEK_API_KEY || env.FORYOU_DEEPSEEK_API_KEY || "").trim(),
      model: model.startsWith("deepseek") ? model : STANDAARD_MODEL,
    };
    toegangTot = Date.now() + 30000;
    return toegang;
  }

  // Het script per scène onthouden; ontbreekt het, dan na een tijdje opnieuw kijken.
  let script = { sleutel: "", tekst: "", tot: 0 };
  async function metScript(scene) {
    if (!scene || typeof scene !== "object" || !scene.situationId) return scene;
    const sleutel = `${scene.showRunId}|${scene.situationId}`;
    if (script.sleutel !== sleutel || (!script.tekst && Date.now() > script.tot)) {
      script = { sleutel, tekst: "", tot: Date.now() + 20000 };
      try {
        script.tekst = await haalScript(scene, { fetchImpl });
      } catch {
        // Zonder script valt het personage terug op de beschrijving van de scène.
      }
    }
    return script.tekst ? { ...scene, script: script.tekst } : scene;
  }

  // Geeft de tekst, of "" als het model niets bruikbaars gaf. Gooit bij een fout.
  async function schrijf(personage, context = {}) {
    const { sleutel, model } = await leesToegang();
    if (!sleutel) throw new Error("geen_sleutel");
    context = { ...context, scene: await metScript(context.scene) };
    const data = await metTimeout(12000, async (signal) => {
      const response = await fetchImpl(DEEPSEEK_URL, {
        method: "POST",
        signal,
        headers: { "content-type": "application/json", authorization: `Bearer ${sleutel}` },
        body: JSON.stringify({
          model,
          messages: bouwBerichten(personage, context),
          max_tokens: 60,
          temperature: 1.2,
          thinking: { type: "disabled" },
        }),
      });
      if (!response.ok) throw new Error(`model gaf ${response.status}`);
      return response.json();
    });
    const keuze = data && Array.isArray(data.choices) ? data.choices[0] : null;
    return maakSchoon(keuze && keuze.message ? keuze.message.content : "", personage.naam);
  }

  return { schrijf };
}

module.exports = {
  bouwBerichten,
  haalPersonages,
  haalScript,
  maakPersonageStem,
  maakSchoon,
};
