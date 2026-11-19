"use strict";

// Engelse ondertitel: zodra een script binnenkomt, vertaalt één snelle vraag aan DeepSeek (V4 Flash,
// zonder nadenken) alle regels tegelijk. Bij het klikken is de vertaling er dan al; er wacht niets op.
// Is hij er nog niet of mislukt hij, dan staat alleen het Nederlands in beeld.

const fs = require("fs");

const MODEL = "deepseek-v4-flash";
const SYSTEM = [
  "Translate each Dutch subtitle line of a live comedy theatre scene into natural, short, spoken English.",
  "Keep names unchanged. Keep stage directions between *asterisks* in asterisks, translated.",
  "Do not add or drop lines. Reply with JSON only: {\"t\":[...]} with exactly one English string per input line, same order.",
].join(" ");

function createVertaler(options = {}) {
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  const secretsPath = options.secretsPath || "";
  const onKlaar = typeof options.onKlaar === "function" ? options.onKlaar : () => {};
  const log = typeof options.log === "function" ? options.log : () => {};
  const cache = new Map(); // Nederlandse tekst → Engels
  const bezig = new Set();

  function apiKey() {
    if (options.apiKey) return options.apiKey;
    try {
      const secrets = JSON.parse(fs.readFileSync(secretsPath, "utf8"));
      return String(secrets.DEEPSEEK_API_KEY || process.env.DEEPSEEK_API_KEY || "").trim();
    } catch (_error) {
      return String(process.env.DEEPSEEK_API_KEY || "").trim();
    }
  }

  function teksten(teleprompt) {
    const lines = teleprompt && Array.isArray(teleprompt.lines) ? teleprompt.lines : [];
    return [...new Set(lines.map((line) => String(line && line.text || "").trim()).filter(Boolean))];
  }

  async function vraag(regels) {
    const response = await fetchImpl("https://api.deepseek.com/chat/completions", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${apiKey()}` },
      body: JSON.stringify({
        model: MODEL,
        messages: [{ role: "system", content: SYSTEM }, { role: "user", content: JSON.stringify(regels) }],
        thinking: { type: "disabled" },
        response_format: { type: "json_object" },
        temperature: 0.2,
        max_tokens: 4000,
      }),
      signal: AbortSignal.timeout(20000),
    });
    if (!response.ok) throw new Error(`deepseek ${response.status}`);
    const data = await response.json();
    const inhoud = data && data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
    const lijst = JSON.parse(String(inhoud || "{}")).t;
    if (!Array.isArray(lijst) || lijst.length !== regels.length) throw new Error("vertaling_telt_niet");
    return lijst.map((tekst) => String(tekst || "").trim());
  }

  async function vertaal(teleprompt) {
    const open = teksten(teleprompt).filter((tekst) => !cache.has(tekst) && !bezig.has(tekst));
    if (!open.length) return;
    if (!apiKey()) return;
    open.forEach((tekst) => bezig.add(tekst));
    const startedAt = Date.now();
    try {
      // Eén poging opnieuw als het aantal regels niet klopt of het netwerk hapert.
      let lijst;
      try {
        lijst = await vraag(open);
      } catch (_error) {
        lijst = await vraag(open);
      }
      open.forEach((tekst, index) => { if (lijst[index]) cache.set(tekst, lijst[index]); });
      if (cache.size > 3000) cache.delete(cache.keys().next().value);
      log({ ok: true, regels: open.length, ms: Date.now() - startedAt });
      onKlaar();
    } catch (error) {
      log({ ok: false, regels: open.length, ms: Date.now() - startedAt, fout: String(error && error.message || error) });
    } finally {
      open.forEach((tekst) => bezig.delete(tekst));
    }
  }

  // Voor het scherm: per Nederlandse regel van het huidige script de Engelse, als die er al is.
  function voor(teleprompt) {
    const uit = {};
    for (const tekst of teksten(teleprompt)) {
      if (cache.has(tekst)) uit[tekst] = cache.get(tekst);
    }
    return uit;
  }

  return { vertaal, voor };
}

module.exports = { createVertaler };
