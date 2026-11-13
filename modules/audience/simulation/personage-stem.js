"use strict";

// Personages uit de catalogus die meepraten in de chat. De tekst komt van het taalmodel
// van de script-agent (zelfde sleutel, zelfde model), met de beschrijving van het personage als instructie.

const fs = require("node:fs/promises");
const path = require("node:path");
const { scriptAgentDbDir } = require("../../script-agent/script-output/state-store");

const DEEPSEEK_URL = "https://api.deepseek.com/chat/completions";
const STANDAARD_MODEL = "deepseek-v4-pro";
const MAX_TEKENS = 140;

function catalogBaseUrl() {
  return String(process.env.AUDIENCE_CATALOG_URL || "http://127.0.0.1:3021").replace(/\/+$/, "");
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

function bouwBerichten(personage, { scene = "", chat = [], onderwerp = "" } = {}) {
  const systeem = [
    `Je bent ${personage.naam}, een personage uit de voorstelling For_You. Je zit tussen het publiek en typt mee in de live chat op je telefoon.`,
    personage.beschrijving ? `Wie je bent:\n${personage.beschrijving}` : "",
    "Schrijf precies één chatbericht van hooguit 12 woorden, in het Nederlands, zoals iemand snel op een telefoon typt.",
    "Blijf in je karakter en reageer op de scène of op wat er in de chat staat. Herhaal geen eerder bericht.",
    "Geef alleen het bericht: geen naam ervoor, geen aanhalingstekens, geen uitleg.",
    "Grof taalgebruik alleen als het bij jouw beschrijving hoort. Nooit discriminerende scheldwoorden over afkomst, geloof, geaardheid of handicap.",
  ].filter(Boolean).join("\n\n");
  const regels = chat.slice(-12).map((item) => `${item.naam}: ${item.tekst}`);
  const gebruiker = [
    scene ? `Laatste scène: ${scene}` : "",
    onderwerp ? `Onderwerp: ${onderwerp}` : "",
    regels.length ? `Chat tot nu toe:\n${regels.join("\n")}` : "De chat is nog leeg.",
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

  // Geeft de tekst, of "" als het model niets bruikbaars gaf. Gooit bij een fout.
  async function schrijf(personage, context = {}) {
    const { sleutel, model } = await leesToegang();
    if (!sleutel) throw new Error("geen_sleutel");
    const data = await metTimeout(12000, async (signal) => {
      const response = await fetchImpl(DEEPSEEK_URL, {
        method: "POST",
        signal,
        headers: { "content-type": "application/json", authorization: `Bearer ${sleutel}` },
        body: JSON.stringify({
          model,
          messages: bouwBerichten(personage, context),
          max_tokens: 60,
          temperature: 1,
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
  maakPersonageStem,
  maakSchoon,
};
