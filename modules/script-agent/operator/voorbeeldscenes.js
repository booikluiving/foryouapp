"use strict";

// Voorbeeldscènes: per situatie het best gelukte script, gekozen door de schrijvers. Bij een nieuwe
// run krijgt de chatgeschiedenis ze vooraf mee (kalibreren), en een scène met een voorbeeld krijgt
// dat voorbeeld in de opdracht. Eén voorbeeld per situatie; het nieuwste telt. Een lege tekst is
// "weggehaald" en blijft staan, zodat een oudere kopie het niet terugzet.

const fs = require("node:fs/promises");
const path = require("node:path");

const MAX_TEKST = 12000;

function clean(value, max = MAX_TEKST) {
  return String(value == null ? "" : value).replace(/\r\n?/g, "\n").trim().slice(0, max);
}

function normalizeVoorbeeld(input = {}) {
  const situationId = clean(input.situationId, 80);
  if (!/^situation:[A-Za-z0-9_-]+$/.test(situationId)) return null;
  const at = Number.isFinite(Date.parse(input.at)) ? new Date(input.at).toISOString() : new Date().toISOString();
  return {
    situationId,
    titel: clean(input.titel, 160),
    vraag: clean(input.vraag),
    tekst: clean(input.tekst),
    by: clean(input.by, 160),
    at,
  };
}

function createVoorbeeldStore({ filePath }) {
  async function lees() {
    try {
      const parsed = JSON.parse(await fs.readFile(filePath, "utf8"));
      const list = Array.isArray(parsed && parsed.voorbeelden) ? parsed.voorbeelden : [];
      return list.map(normalizeVoorbeeld).filter(Boolean);
    } catch (err) {
      if (err && err.code === "ENOENT") return [];
      throw err;
    }
  }

  async function schrijf(list) {
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    const temp = `${filePath}.${process.pid}.${Date.now()}.tmp`;
    await fs.writeFile(temp, `${JSON.stringify({ voorbeelden: list }, null, 2)}\n`, "utf8");
    await fs.rename(temp, filePath);
  }

  // Alle situaties met een voorbeeld (weggehaalde niet).
  async function actief() {
    return (await lees()).filter((item) => item.tekst);
  }

  async function voor(situationId) {
    return (await actief()).find((item) => item.situationId === situationId) || null;
  }

  // Zet voorbeelden erin; per situatie wint de nieuwste. Geeft terug hoeveel er veranderd zijn.
  async function zet(items) {
    const list = await lees();
    const bySituation = new Map(list.map((item) => [item.situationId, item]));
    let veranderd = 0;
    for (const raw of Array.isArray(items) ? items : [items]) {
      const item = normalizeVoorbeeld(raw);
      if (!item) continue;
      const nu = bySituation.get(item.situationId);
      if (nu && Date.parse(nu.at) >= Date.parse(item.at)) continue;
      bySituation.set(item.situationId, item);
      veranderd += 1;
    }
    if (veranderd) await schrijf([...bySituation.values()].sort((a, b) => a.situationId.localeCompare(b.situationId, "nl", { numeric: true })));
    return { veranderd, voorbeelden: await actief() };
  }

  return { actief, lees, voor, zet };
}

// De geschiedenis waarmee een nieuwe run begint: per voorbeeld de opdracht en het script.
function kalibratieBerichten(voorbeelden) {
  const berichten = [];
  for (const item of voorbeelden) {
    if (!item.tekst) continue;
    berichten.push({ role: "user", content: item.vraag || `Schrijf de scène "${item.titel || item.situationId}".`, kalibratie: item.situationId });
    berichten.push({ role: "assistant", content: item.tekst, kalibratie: item.situationId });
  }
  return berichten;
}

// Onder de opdracht van een scène die een voorbeeld heeft.
function voorbeeldOpdracht(item) {
  return [
    "",
    "Van deze scène bestaat een voorbeeld dat goed werkte. Houd dezelfde opbouw en dezelfde punchline. Je mag het herschrijven: namen, zinnen en wat er in de chat gebeurt mogen anders.",
    "--- VOORBEELD ---",
    item.tekst,
    "--- EINDE VOORBEELD ---",
  ].join("\n");
}

module.exports = { createVoorbeeldStore, kalibratieBerichten, normalizeVoorbeeld, voorbeeldOpdracht };
