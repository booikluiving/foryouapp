"use strict";

// Snapshot per personage: aanleveren per plek (zoals show/spelersfoto dat doet) en ophalen per personage.
// Schrijft alleen in een tijdelijke map.

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const map = fs.mkdtempSync(path.join(os.tmpdir(), "personagefoto-"));
process.env.AUDIENCE_PERSONAGEFOTO_DIR = map;
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

// Niemand in beeld: wel de foto bij de vraag op de telefoon, geen snapshot van het personage.
const leeg = b.zetFoto({ plek: 3, jpeg: jpeg(3), punten: "0.00" });
assert.equal(leeg.ok, true);
assert.equal(leeg.personage, null);
assert.equal(b.personagefoto("run:a", "character:28"), null);

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

fs.rmSync(map, { recursive: true, force: true });
console.log("personagefoto-test: alles ok");
