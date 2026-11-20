"use strict";

// De foto's bij de personagevraag gaan niet in het stembericht (dat werd ± 200 kB per telefoon en met
// 60 telefoons verbraken ze allemaal), maar als adres dat de telefoon zelf ophaalt.
// Draai: node modules/audience/tests/stemronde-fotos-test.js (schrijft alleen in een tijdelijke map).
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

process.env.AUDIENCE_PERSONAGEFOTO_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "stemfoto-"));
process.env.AUDIENCE_PERSONAGEARCHIEF_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "stemarchief-"));
global.fetch = async () => ({ ok: true, json: async () => ({}) });
const { createBeoordeling, beoordelingFotoRoute } = require("../server/beoordeling");

const instellingen = new Map();
const service = {
  store: { getSetting: (k, f) => (instellingen.has(k) ? instellingen.get(k) : f), setSetting: (k, v) => instellingen.set(k, v) },
  emit: () => {},
  getActiveSession: () => ({ id: 1 }),
  onlineMensen: () => 60,
};
const b = createBeoordeling(service);
service.beoordeling = b;
const jpeg = (teken) => Buffer.concat([Buffer.from([0xff, 0xd8]), Buffer.alloc(50 * 1024, teken)]);
const slot = (performerId, characterId, characterName) => ({ performerId, characterId, characterName });
b.onthoudScene({
  showRunId: "run:a",
  showRunSnapshot: { catalog: { performers: [{ id: "p1", performerSlot: 1 }, { id: "p2", performerSlot: 2 }, { id: "p3", performerSlot: 3 }] } },
  situationRuns: [{ situationRunId: "sr:1", resolved: { situationId: "situation:1", title: "Een", performerSlots: [slot("p1", "character:1", "A"), slot("p2", "character:2", "B"), slot("p3", "character:3", "C")] } }],
});
[1, 2, 3].forEach((plek) => assert.equal(b.zetFoto({ plek, jpeg: jpeg(plek) }).ok, true));

const ronde = b.start();
assert.ok(ronde, "de stemronde gaat open");
const bericht = JSON.stringify({ type: "beoordeling", beoordeling: ronde });
assert.ok(bericht.length < 5000, `stembericht klein (nu ${bericht.length} tekens)`);
assert.ok(!bericht.includes("base64"), "geen ingebakken foto's");
const keuzes = ronde.vragen.find((vraag) => vraag.id === "personage").keuzes;
assert.equal(keuzes[0].foto, "/audience/public/beoordeling/foto/sr%3A1/character%3A1");

// Het adres geeft de foto, ook via de route; zonder pas niet.
const vraag = (id, characterId) => {
  const uit = { status: 200, headers: {}, body: null };
  const res = {
    status(code) { uit.status = code; return res; },
    set(h) { Object.assign(uit.headers, h); return res; },
    type() { return res; },
    send(body) { uit.body = body; return res; },
  };
  return { req: { params: { id, characterId } }, res, uit };
};
let r = vraag("sr:1", "character:2");
beoordelingFotoRoute(service)(r.req, r.res);
assert.equal(r.uit.status, 200);
assert.deepEqual(r.uit.body, jpeg(2));
r = vraag("sr:1", "character:9");
beoordelingFotoRoute(service)(r.req, r.res);
assert.equal(r.uit.status, 404);
r = vraag("sr:1", "character:2");
beoordelingFotoRoute(service, () => false)(r.req, r.res);
assert.equal(r.uit.status, 403);
b.sluit("klok");
process.stdout.write("stemronde-fotos-test: ok\n");
process.exit(0);
