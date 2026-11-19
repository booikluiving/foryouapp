"use strict";

// Snapshot per personage: aanleveren per plek (zoals show/spelersfoto dat doet) en ophalen per personage.
// Schrijft alleen in een tijdelijke map.

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const map = fs.mkdtempSync(path.join(os.tmpdir(), "personagefoto-"));
process.env.AUDIENCE_PERSONAGEFOTO_DIR = map;
const archief = fs.mkdtempSync(path.join(os.tmpdir(), "personagearchief-"));
process.env.AUDIENCE_PERSONAGEARCHIEF_DIR = archief;
const { createBeoordeling } = require("../server/beoordeling");

const instellingen = new Map();
const service = { store: { getSetting: (k, f) => (instellingen.has(k) ? instellingen.get(k) : f), setSetting: (k, v) => instellingen.set(k, v) }, emit: () => {}, getActiveSession: () => null };
const jpeg = (teken) => Buffer.concat([Buffer.from([0xff, 0xd8]), Buffer.alloc(400, teken)]);
const state = (showRunId, situationRunId, slots) => ({
  showRunId,
  showRunSnapshot: { catalog: { performers: [{ id: "p1", performerSlot: 1 }, { id: "p2", performerSlot: 2 }, { id: "p3", performerSlot: 3 }] } },
  situationRuns: [{ situationRunId, resolved: { situationId: "situation:1", title: "Een", performerSlots: slots } }],
});
const slot = (performerId, characterId, naam) => ({ performerId, characterId, characterName: naam });

const b = createBeoordeling(service);
assert.equal(b.zetFoto({ plek: 1, jpeg: jpeg(1) }).ok, false, "zonder scène geen foto");

b.onthoudScene(state("run:a", "sr:1", [slot("p1", "character:15", "Bobbie"), slot("p3", "character:28", "Marit")]));
const eerste = b.zetFoto({ plek: 1, jpeg: jpeg(1), punten: "2.5" });
assert.equal(eerste.ok, true);
assert.equal(eerste.personage, "character:15", "de foto van plek 1 hoort bij het personage op plek 1");
assert.deepEqual(b.personagefoto("run:a", "character:15").jpeg, jpeg(1));
assert.equal(b.zetFoto({ plek: 2, jpeg: jpeg(2) }).personage, null, "op plek 2 speelt niemand");
assert.equal(b.personagefoto("run:a", "character:28"), null, "zonder snapshot niets");

// Niemand in beeld: telt alleen zolang het personage nog geen snapshot heeft.
assert.equal(b.zetFoto({ plek: 3, jpeg: jpeg(3), punten: "0.00" }).personage, "character:28", "nog niets: dan de omgeving");
assert.deepEqual(b.personagefoto("run:a", "character:28").jpeg, jpeg(3));
assert.equal(b.zetFoto({ plek: 1, jpeg: jpeg(9), punten: "0.00" }).personage, null, "een leeg beeld vervangt geen snapshot");
assert.deepEqual(b.personagefoto("run:a", "character:15").jpeg, jpeg(1));

// Een latere scène met hetzelfde personage op een andere plek: de nieuwste wint.
b.onthoudScene(state("run:a", "sr:2", [slot("p2", "character:15", "Bobbie")]));
b.zetFoto({ plek: 2, jpeg: jpeg(4), punten: 1.4 });
assert.deepEqual(b.personagefoto("run:a", "character:15").jpeg, jpeg(4));

// Na een herstart van de dienst staat het beeld er nog (van schijf).
const opnieuw = createBeoordeling(service);
assert.deepEqual(opnieuw.personagefoto("run:a", "character:15").jpeg, jpeg(4), "na een herstart nog steeds");
assert.equal(opnieuw.personagefoto("run:b", "character:15"), null, "een andere run heeft zijn eigen beelden");

// Een nieuwe run: de beelden van de vorige gaan weg bij de eerste snapshot.
b.reset();
b.onthoudScene(state("run:b", "sr:3", [slot("p1", "character:28", "Marit")]));
b.zetFoto({ plek: 1, jpeg: jpeg(5), punten: 3 });
assert.deepEqual(b.personagefoto("run:b", "character:28").jpeg, jpeg(5));
assert.deepEqual(fs.readdirSync(map), ["run_b"], "alleen de map van de lopende run blijft");
assert.equal(createBeoordeling(service).personagefoto("run:a", "character:15"), null);

// Archief over runs heen: alleen snapshots met iemand in beeld, max vier per personage, vast- blijft.
const inArchief = (id) => fs.readdirSync(path.join(archief, id)).sort();
assert.deepEqual(inArchief("character_28").length, 1, "Marit: alleen de foto met iemand in beeld (run b), niet het lege beeld");
assert.equal(inArchief("character_15").length, 2, "Bobbie: twee verschillende snapshots");
assert.equal(b.personagekaart("run:b", "character:28").bron, "run", "zonder keuze eerst de snapshot van deze run");
assert.equal(b.personagekaart("run:b", "character:15").bron, "archief", "geen snapshot in deze run: nieuwste uit het archief");
assert.deepEqual(b.personagekaart("run:b", "character:15").jpeg, jpeg(4));
assert.equal(b.personagekaart("run:b", "character:99"), null);
for (const teken of [11, 12, 13, 14, 15]) {
  b.onthoudScene(state("run:b", `sr:${teken}`, [slot("p1", "character:15", "Bobbie")]));
  b.zetFoto({ plek: 1, jpeg: jpeg(teken), punten: 2 });
}
assert.equal(inArchief("character_15").length, 4, "max vier");
const gekozen = inArchief("character_15")[0];
fs.renameSync(path.join(archief, "character_15", gekozen), path.join(archief, "character_15", `vast-${gekozen}`));
b.onthoudScene(state("run:b", "sr:20", [slot("p1", "character:15", "Bobbie")]));
b.zetFoto({ plek: 1, jpeg: jpeg(20), punten: 2 });
assert.ok(inArchief("character_15").includes(`vast-${gekozen}`), "de gekozen foto gaat nooit weg");
assert.equal(inArchief("character_15").length, 4);
assert.equal(b.personagekaart("run:b", "character:15").bron, "gekozen", "gekozen wint van de snapshot van deze run");

fs.rmSync(map, { recursive: true, force: true });
fs.rmSync(archief, { recursive: true, force: true });
console.log("personagefoto-test: alles ok");
