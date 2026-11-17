"use strict";

// Registratie: namen, niets vanzelf behalve stoppen bij een volle schijf, en het gesprek met TouchDesigner.
// Raakt TouchDesigner niet: de opdrachtenmap is een tijdelijke map met een namaak-TouchDesigner.

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {
  naamVoor,
  registratieStatus,
  registratieTick,
  startRegistratie,
  stopRegistratie,
} = require("../registratie/registratie");

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "registratie-test-"));
const opdrachtenDir = path.join(tmp, "td");
for (const d of ["in", "uit", "gedaan"]) fs.mkdirSync(path.join(opdrachtenDir, d), { recursive: true });
const options = { opdrachtenDir, doelDir: path.join(tmp, "shows"), standPad: path.join(tmp, "registratie.json"), wachtMs: 2000 };

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
  const nu = new Date(2026, 10, 17, 14, 32);
  assert.deepEqual(naamVoor(run, nu), { naam: "2026-11-17-1432-run-1050", showRunId: "show-run-a" });
  assert.equal(naamVoor(null, nu).naam, "2026-11-17-1432-los");

  // Starten: één bestand in de map van de gedocumenteerde shows.
  const eerste = await startRegistratie(run, { ...options, nu });
  assert.equal(eerste.ok, true);
  assert.equal(eerste.pad, path.join(options.doelDir, "2026-11-17-1432-run-1050.mov"));
  assert.equal(td.opname, true);

  // Nog een keer starten verandert niets.
  assert.equal((await startRegistratie(run, options)).alBezig, true);

  // De klok laat de opname staan, ook als de run voorbij is; alleen een volle schijf stopt hem.
  assert.equal(await registratieTick({ ...options, vrijGb: 50 }), null);
  assert.equal(td.opname, true);
  const vol = await registratieTick({ ...options, vrijGb: 1 });
  assert.equal(vol.ok, true);
  assert.equal(td.opname, false);
  assert.equal((await registratieStatus(options)).opname, false);

  // Zelfde minuut nog een keer: volgnummer.
  fs.writeFileSync(eerste.pad, "x");
  const tweede = await startRegistratie(run, { ...options, nu });
  assert.match(tweede.pad, /-run-1050-2\.mov$/);
  assert.equal((await stopRegistratie(options)).ok, true);

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
