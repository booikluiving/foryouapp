"use strict";

// Registratie: namen, niets vanzelf behalve stoppen bij een volle schijf, en het gesprek met TouchDesigner.
// Raakt TouchDesigner niet: de opdrachtenmap is een tijdelijke map met een namaak-TouchDesigner.

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const {
  gelijkzetten,
  naamVoor,
  registratieStatus,
  registratieTick,
  startRegistratie,
  stopRegistratie,
} = require("../registratie/registratie");

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "registratie-test-"));
const opdrachtenDir = path.join(tmp, "td");
for (const d of ["in", "uit", "gedaan"]) fs.mkdirSync(path.join(opdrachtenDir, d), { recursive: true });
const options = { opdrachtenDir, doelDir: path.join(tmp, "shows"), standPad: path.join(tmp, "registratie.json"), wachtMs: 2000, nazorg: false };

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

  // Zit de schijf er niet in (hier: een gewone map, geen eigen apparaat), dan gaat de opname naar de Mac, met een melding.
  const thuis = process.env.HOME;
  process.env.HOME = tmp;
  const zonderSchijf = await startRegistratie(run, { ...options, doelDir: undefined, schijf: path.join(tmp, "geen-schijf"), nu });
  process.env.HOME = thuis;
  assert.equal(zonderSchijf.ok, true);
  assert.match(zonderSchijf.melding, /zit er niet in/);
  assert.ok(zonderSchijf.pad.startsWith(path.join(tmp, "ForYou", "gedocumenteerde-shows")), zonderSchijf.pad);
  assert.equal((await stopRegistratie(options)).ok, true);

  // TouchDesigner heeft de patch niet: nette melding, geen opname onthouden.
  td.aanwezig = false;
  const zonder = await startRegistratie(run, options);
  assert.equal(zonder.ok, false);
  assert.match(zonder.fout, /patch/);
  assert.equal(fs.existsSync(options.standPad), false);

  // Na de stop: nameten, en de vaste verschuiving rechtzetten in het bestand zelf.
  const ffmpeg = ["/opt/homebrew/bin/ffmpeg", "/usr/local/bin/ffmpeg"].find((p) => fs.existsSync(p));
  if (ffmpeg) {
    const proef = path.join(tmp, "proef.mov");
    const maak = () => execFileSync(ffmpeg, ["-v", "error", "-y", "-f", "lavfi", "-i", "testsrc=size=108x192:rate=50", "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=44100",
      "-t", "3", "-c:v", "mpeg4", "-c:a", "pcm_s16le", proef]);
    maak();
    const start = new Date(2026, 10, 19, 12, 0, 0);
    const tijden = { gestartOp: start.toISOString(), gestoptOp: new Date(start.getTime() + 3000).toISOString() };
    const zonder0 = await gelijkzetten(proef, tijden, { geluidMs: 0 });
    assert.equal(zonder0.ok && zonder0.gelijk, true);
    assert.equal(zonder0.verschovenMs, 0);
    const later = await gelijkzetten(proef, tijden, { geluidMs: 80 });
    assert.equal(later.verschovenMs, 80);
    const na = await gelijkzetten(proef, tijden, { geluidMs: 0 });
    assert.ok(Math.abs((na.controle.geluidStartS - na.controle.beeldStartS) - 0.08) < 0.005, JSON.stringify(na.controle));
    assert.deepEqual(fs.readdirSync(tmp).filter((n) => n.includes("gelijk")), []);
    maak();
    await gelijkzetten(proef, tijden, { geluidMs: -60 });
    const eerder = await gelijkzetten(proef, tijden, { geluidMs: 0 });
    assert.ok(Math.abs((eerder.controle.beeldStartS - eerder.controle.geluidStartS) - 0.06) < 0.005, JSON.stringify(eerder.controle));
    // Wegdrijven is geen vaste verschuiving: gemeld, niet blind rechtgezet.
    const scheef = await gelijkzetten(proef, { ...tijden, gestoptOp: new Date(start.getTime() + 9000).toISOString() }, { geluidMs: 0 });
    assert.equal(scheef.gelijk, false);
  }

  clearInterval(klok);
  fs.rmSync(tmp, { recursive: true, force: true });
  console.log("registratie-test ok");
})().catch((err) => {
  clearInterval(klok);
  console.error(err);
  process.exit(1);
});
