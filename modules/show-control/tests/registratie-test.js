"use strict";

// Registratie: namen, vanzelf stoppen als de run weg is, en het gesprek met TouchDesigner.
// Raakt TouchDesigner niet: de opdrachtenmap is een tijdelijke map met een namaak-TouchDesigner.

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {
  naamVoor,
  registratieBijStartShow,
  registratieStatus,
  registratieTick,
  startRegistratie,
  stopRegistratie,
} = require("../registratie/registratie");

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "registratie-test-"));
const opdrachtenDir = path.join(tmp, "td");
for (const d of ["in", "uit", "gedaan"]) fs.mkdirSync(path.join(opdrachtenDir, d), { recursive: true });
const options = { opdrachtenDir, doelDir: path.join(tmp, "testruns"), standPad: path.join(tmp, "registratie.json"), wachtMs: 2000 };

// Namaak-TouchDesigner: leest de opdracht en antwoordt zoals stuur.stand() dat doet.
const td = { opname: false, pad: "", aanwezig: true, gezien: [] };
const klok = setInterval(() => {
  for (const naam of fs.readdirSync(path.join(opdrachtenDir, "in"))) {
    const bron = path.join(opdrachtenDir, "in", naam);
    const regel = fs.readFileSync(bron, "utf8").trim();
    fs.rmSync(bron);
    td.gezien.push(regel);
    let tekst = "fout\nAttributeError: 'NoneType' object has no attribute 'op'";
    if (td.aanwezig) {
      const start = regel.match(/\.start\((".*")\)$/);
      if (start) { td.opname = true; td.pad = JSON.parse(start[1]); }
      if (/\.stop\(\)$/.test(regel)) td.opname = false;
      tekst = `ok\nREGISTRATIE ${JSON.stringify({ opname: td.opname, pad: td.pad, bytes: 0, fps: 50 })}`;
    }
    fs.writeFileSync(path.join(opdrachtenDir, "uit", naam.replace(/\.py$/, ".txt")), tekst);
  }
}, 50);

const run = { showRunId: "show-run-a", status: "running", createdAt: new Date(2026, 10, 17, 10, 50).toISOString() };

(async () => {
  assert.deepEqual(naamVoor(run), { map: "2026-11-17-run-1050", showRunId: "show-run-a" });
  assert.equal(naamVoor(null, new Date(2026, 10, 17, 9, 5)).map, "2026-11-17-los-0905");

  // Vanzelf starten staat uit: er gebeurt niets.
  assert.equal(await registratieBijStartShow(run, { ...options, registratie: "uit" }), null);
  assert.equal(td.gezien.length, 0);

  // START SHOW: opname in de map van de run.
  const eerste = await registratieBijStartShow(run, options);
  assert.equal(eerste.ok, true);
  assert.equal(eerste.pad, path.join(options.doelDir, "2026-11-17-run-1050", "2026-11-17-run-1050-registratie.mov"));
  assert.equal(td.opname, true);

  // Nog een keer starten verandert niets.
  const dubbel = await startRegistratie(run, options);
  assert.equal(dubbel.alBezig, true);

  // De run loopt nog: de klok laat de opname staan.
  assert.equal(await registratieTick(run, options), null);
  assert.equal(td.opname, true);

  // RESET RUN (andere run): de opname stopt.
  const gestopt = await registratieTick({ showRunId: "show-run-b", status: "running" }, options);
  assert.equal(gestopt.ok, true);
  assert.equal(td.opname, false);
  assert.equal((await registratieStatus(options)).opname, false);

  // Tweede opname in dezelfde run krijgt een volgnummer als het eerste bestand er staat.
  fs.writeFileSync(eerste.pad, "x");
  const tweede = await startRegistratie(run, options);
  assert.match(tweede.pad, /-registratie-2\.mov$/);
  assert.equal((await stopRegistratie(options)).ok, true);

  // Met de hand buiten een run: stopt niet vanzelf.
  const los = await startRegistratie(null, options);
  assert.equal(los.showRunId, null);
  assert.equal(await registratieTick({ showRunId: "show-run-c", status: "running" }, options), null);
  await stopRegistratie(options);

  // TouchDesigner heeft de patch niet: nette melding, geen opname onthouden.
  td.aanwezig = false;
  const zonder = await startRegistratie(run, options);
  assert.equal(zonder.ok, false);
  assert.match(zonder.fout, /patch/);
  assert.equal(fs.existsSync(options.standPad), false);

  clearInterval(klok);
  fs.rmSync(tmp, { recursive: true, force: true });
  console.log("registratie-test ok");
})().catch((err) => {
  clearInterval(klok);
  console.error(err);
  process.exit(1);
});
