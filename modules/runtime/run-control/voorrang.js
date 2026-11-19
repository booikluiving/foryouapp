"use strict";

// Voorrang voor een testrun: de scènes in db/voorrang.json zijn vrij als startscène, ook als ze in
// de paden nog op slot zitten. Zolang er daarvan nog een niet gespeeld is, wacht de rest.
// Het bestand wordt bij elke padenronde opnieuw gelezen: leegmaken of weghalen = weer gewoon de paden.

const fs = require("fs");
const path = require("path");

const VOORRANG_FILE = process.env.RUNTIME_VOORRANG_FILE
  || path.join(__dirname, "..", "db", "voorrang.json");

function leesVoorrang(file = VOORRANG_FILE) {
  try {
    const data = JSON.parse(fs.readFileSync(file, "utf8"));
    const lijst = Array.isArray(data) ? data : data && data.situationIds;
    return Array.isArray(lijst) ? lijst.map(String).filter((id) => /^situation:\d+$/.test(id)) : [];
  } catch (_err) {
    return [];
  }
}

function pasVoorrangToe(evaluation, playedSituationIds = [], voorrang = leesVoorrang()) {
  if (!evaluation || !Array.isArray(evaluation.items) || voorrang.length === 0) return evaluation;
  const gespeeld = new Set((playedSituationIds || []).map(String));
  const voorrangSet = new Set(voorrang);
  const open = voorrang.filter((id) => !gespeeld.has(id));
  const bekend = new Set(evaluation.items.map((item) => item.situationId));
  const items = evaluation.items.map((item) => {
    if (voorrangSet.has(item.situationId)) {
      if (item.status === "played" || gespeeld.has(item.situationId)) return { ...item, isPathStart: true };
      return {
        ...item,
        status: "available",
        pathAvailable: true,
        pathLocked: false,
        isPathStart: true,
        pathStatuses: [{ pathId: "voorrang", pathName: "Voorrang", status: "available", isPathStart: true }],
      };
    }
    if (open.length > 0 && item.status === "available") {
      return {
        ...item,
        status: "locked",
        pathAvailable: false,
        pathLocked: true,
        isPathStart: false,
        pathStatuses: (item.pathStatuses || []).map((status) => ({ ...status, status: "locked" })),
      };
    }
    return item;
  });
  // Een scène die in geen enkel pad staat komt niet uit de padenronde: zelf toevoegen.
  for (const id of voorrang) {
    if (bekend.has(id)) continue;
    const isGespeeld = gespeeld.has(id);
    items.push({
      situationId: id,
      legacySituationId: Number(id.split(":")[1]),
      status: isGespeeld ? "played" : "available",
      pathAvailable: !isGespeeld,
      pathLocked: false,
      isPathStart: true,
      pathStatuses: [{ pathId: "voorrang", pathName: "Voorrang", status: isGespeeld ? "played" : "available", isPathStart: true }],
    });
  }
  const counts = { ...(evaluation.counts || {}), situations: items.length };
  for (const status of ["available", "locked", "blocked", "played"]) {
    counts[status] = items.filter((item) => item.status === status).length;
  }
  return { ...evaluation, items, counts, voorrang: { situationIds: voorrang, open } };
}

module.exports = { leesVoorrang, pasVoorrangToe, VOORRANG_FILE };
