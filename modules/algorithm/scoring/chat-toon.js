"use strict";

// Chatberichten van het publiek beoordelen: is een bericht positief (1), neutraal (0) of negatief (-1)
// over de scène, en welke personages worden genoemd (voor of tegen). Een snel taalmodel doet dat
// (dezelfde sleutel als de script-agent); lukt dat niet, dan een korte woordenlijst en de namen.

const fs = require("node:fs/promises");
const path = require("node:path");

const DEEPSEEK_URL = "https://api.deepseek.com/chat/completions";
const MODEL = "deepseek-flash";
const MAX_PER_KEER = 40;

const POSITIEF = [
  "haha", "hihi", "lol", "lmao", "geweldig", "top", "leuk", "grappig", "goed", "mooi", "nice", "vet",
  "briljant", "love", "meer", "weer", "again", "bravo", "prachtig", "hilarisch", "slay", "genius",
  "geniaal", "heerlijk", "fantastisch", "gaaf", "lekker", "yes", "jaa", "wauw", "wow",
];
const NEGATIEF = [
  "saai", "boring", "boeit", "slecht", "stom", "niks", "meh", "bah", "lame", "waardeloos", "irritant",
  "cringe", "suf", "zwak", "kut", "nope", "volgende", "skip", "doei", "weg",
];
const EMOJI_POSITIEF = ["😂", "🤣", "❤", "🔥", "👏", "😍", "🥰", "💯", "😆", "😁"];
const EMOJI_NEGATIEF = ["😴", "🥱", "👎", "🤮", "💤", "😒", "🙄", "😑"];

function woorden(tekst) {
  return String(tekst || "").toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").split(/[^a-z0-9]+/).filter(Boolean);
}

// Toon van een bericht volgens de woordenlijst: 1, 0 of -1.
function toonVanTekst(tekst) {
  const lijst = woorden(tekst);
  const ruw = String(tekst || "");
  let som = 0;
  for (const woord of lijst) {
    if (POSITIEF.some((p) => woord === p || (p.length >= 4 && woord.startsWith(p)))) som += 1;
    if (NEGATIEF.some((n) => woord === n || (n.length >= 4 && woord.startsWith(n)))) som -= 1;
  }
  if (/\b(niet|geen|nie)\b/.test(ruw.toLowerCase()) && som > 0) som = -som;
  for (const e of EMOJI_POSITIEF) if (ruw.includes(e)) som += 1;
  for (const e of EMOJI_NEGATIEF) if (ruw.includes(e)) som -= 1;
  return som > 0 ? 1 : som < 0 ? -1 : 0;
}

// Welke personages in de tekst genoemd worden: de hele naam, of een deel van de naam van minstens
// drie letters dat niet algemeen is ("de", "van", "buurvrouw" tellen niet los).
const ALGEMEEN = new Set(["de", "het", "een", "van", "der", "den", "ten", "ter", "buurvrouw", "buurman", "meneer", "mevrouw", "juf", "meester", "tante", "oom", "opa", "oma", "dokter", "agent"]);
function namenInTekst(tekst, personages = []) {
  const lijst = woorden(tekst);
  const zin = ` ${lijst.join(" ")} `;
  const gevonden = [];
  for (const personage of personages) {
    const naamWoorden = woorden(personage.naam);
    if (!naamWoorden.length) continue;
    const heel = ` ${naamWoorden.join(" ")} `;
    const deel = naamWoorden.filter((w) => w.length >= 3 && !ALGEMEEN.has(w));
    if (zin.includes(heel) || deel.some((w) => lijst.includes(w))) gevonden.push(personage.id);
  }
  return gevonden;
}

// Beoordeling van één bericht met alleen de woordenlijst.
function beoordeelMetWoorden(tekst, personages = []) {
  const toon = toonVanTekst(tekst);
  return {
    toon,
    personages: toon === 0 ? [] : namenInTekst(tekst, personages).map((id) => ({ id, toon })),
    bron: "woorden",
  };
}

async function leesJson(bestand) {
  try {
    const parsed = JSON.parse(await fs.readFile(bestand, "utf8"));
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

async function leesSleutel(env = process.env) {
  if (env.ALGORITHM_CHAT_MODEL === "uit") return "";
  let map = "";
  try {
    map = require("../../script-agent/script-output/state-store").scriptAgentDbDir();
  } catch {
    map = "";
  }
  const geheimen = map ? await leesJson(path.join(map, "operator-secrets.json")) : {};
  return String(geheimen.DEEPSEEK_API_KEY || env.DEEPSEEK_API_KEY || env.FORYOU_DEEPSEEK_API_KEY || "").trim();
}

function systeemTekst() {
  return [
    "Je beoordeelt chatberichten van publiek tijdens een live theaterscène.",
    "Geef per bericht de toon: 1 = positief over de scène (lachen, enthousiast, wil meer), 0 = neutraal (vraag, groet, onduidelijk), -1 = negatief (saai, slecht, wil iets anders).",
    "Geef ook welke personages uit de lijst genoemd worden, alleen als duidelijk is of het publiek dat personage terug wil of leuk vindt (1) of juist niet (-1). Alleen genoemd zonder mening: niet opnemen.",
    "Antwoord alleen met JSON: {\"berichten\":[{\"nr\":1,\"toon\":1,\"personages\":[{\"id\":\"...\",\"toon\":1}]}]}",
  ].join("\n");
}

// Berichten [{ id, tekst }] beoordelen met het taalmodel. Geeft { [id]: { toon, personages, bron } }.
// Gooit een fout als het niet lukt; de aanroeper valt dan terug op de woordenlijst.
async function beoordeelMetModel(berichten = [], personages = [], { fetchImpl = fetch, env = process.env, timeoutMs = 6000 } = {}) {
  const lijst = berichten.slice(0, MAX_PER_KEER);
  if (!lijst.length) return {};
  const sleutel = await leesSleutel(env);
  if (!sleutel) throw new Error("geen_sleutel");
  const bekend = new Set(personages.map((p) => p.id));
  const gebruiker = [
    `Personages: ${personages.map((p) => `${p.id} = ${p.naam}`).join("; ") || "geen"}`,
    "",
    "Berichten:",
    ...lijst.map((bericht, i) => `${i + 1}. ${String(bericht.tekst || "").replace(/\s+/g, " ").slice(0, 200)}`),
  ].join("\n");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let data;
  try {
    const response = await fetchImpl(DEEPSEEK_URL, {
      method: "POST",
      signal: controller.signal,
      headers: { "content-type": "application/json", authorization: `Bearer ${sleutel}` },
      body: JSON.stringify({
        model: MODEL,
        thinking: { type: "disabled" },
        max_tokens: 60 + lijst.length * 30,
        temperature: 0,
        response_format: { type: "json_object" },
        messages: [{ role: "system", content: systeemTekst() }, { role: "user", content: gebruiker }],
      }),
    });
    if (!response.ok) throw new Error(`model gaf ${response.status}`);
    data = await response.json();
  } finally {
    clearTimeout(timer);
  }
  const inhoud = data && data.choices && data.choices[0] && data.choices[0].message ? data.choices[0].message.content : "";
  const antwoord = JSON.parse(String(inhoud || "{}"));
  const uit = {};
  for (const item of Array.isArray(antwoord.berichten) ? antwoord.berichten : []) {
    const bericht = lijst[Number(item && item.nr) - 1];
    if (!bericht) continue;
    const toon = Math.sign(Number(item.toon) || 0);
    uit[bericht.id] = {
      toon,
      personages: (Array.isArray(item.personages) ? item.personages : [])
        .filter((p) => p && bekend.has(String(p.id)) && Math.sign(Number(p.toon) || 0) !== 0)
        .map((p) => ({ id: String(p.id), toon: Math.sign(Number(p.toon)) })),
      bron: "model",
    };
  }
  return uit;
}

module.exports = {
  beoordeelMetModel,
  beoordeelMetWoorden,
  namenInTekst,
  toonVanTekst,
};
