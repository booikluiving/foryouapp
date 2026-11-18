"use strict";

// Het taalmodel kort een personagenaam van meer woorden soms in ("Myrthe" voor "Myrthe van Damme",
// "Monster" voor "Monster onder het bed"). Op de schermen staat altijd de volledige naam uit de
// personagelijst van de scène. Alleen als precies één personage past; anders blijft de naam zoals geschreven.

function speakerKey(value) {
  return String(value || "")
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/gi, " ")
    .trim()
    .toLowerCase();
}

function fitsName(labelKey, nameKey) {
  const labelWords = labelKey.split(" ");
  const nameWords = nameKey.split(" ");
  // Een deel van de naam: "Marit" bij "Escape room Marit", "Demoon" bij "De demoon".
  if (labelWords.every((word) => nameWords.includes(word))) return true;
  // De naam met iets erbij: "Marit fluisterend".
  if (nameWords.every((word) => labelWords.includes(word))) return true;
  // Aan elkaar of juist los geschreven: "Treinconducteur", "Bobbie" bij "BobbieDeCrackhond".
  const label = labelWords.join("");
  const name = nameWords.join("");
  return label.length >= 3 && name.startsWith(label);
}

function resolveSpeakerName(label, names) {
  const labelKey = speakerKey(label);
  if (!labelKey) return "";
  const known = (Array.isArray(names) ? names : [])
    .map((name) => String(name || "").trim())
    .filter(Boolean);
  const exact = known.find((name) => speakerKey(name) === labelKey);
  if (exact) return exact;
  const fits = known.filter((name) => fitsName(labelKey, speakerKey(name)));
  return fits.length === 1 ? fits[0] : "";
}

module.exports = {
  resolveSpeakerName,
  speakerKey,
};
