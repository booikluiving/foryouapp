"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const sharp = require("sharp");

const { IdeeFout, createIdeeen } = require("../server/ideeen");

const naam = (email) => ({ "anna@proef.nl": "Anna", "bob@proef.nl": "Bob" })[email] || email.split("@")[0];

async function refused(promise, status, error) {
  await assert.rejects(async () => promise(), (err) => err instanceof IdeeFout && err.status === status && err.error === error);
}

async function main() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ideeen-"));
  const ideeen = createIdeeen({ dir });
  let checks = 0;
  const check = (fn) => { fn(); checks += 1; };
  try {
    // An idea, with the link made whole; the list says whose it is.
    const idee = await ideeen.add("anna@proef.nl", { soort: "situatie", tekst: "  Een lift die blijft hangen\r\ntussen twee verdiepingen  ", link: "example.org/lift" });
    check(() => assert.equal(idee.tekst, "Een lift die blijft hangen\ntussen twee verdiepingen"));
    check(() => assert.equal(idee.link, "https://example.org/lift"));
    check(() => assert.equal(idee.status, "nieuw"));
    const [mine] = ideeen.view("anna@proef.nl", naam);
    check(() => assert.equal(mine.naam, "Anna"));
    check(() => assert.equal(mine.eigen, true));
    check(() => assert.equal(ideeen.view("bob@proef.nl", naam)[0].eigen, false));

    // What is not taken: no text, an unknown kind, a link that is not a web address.
    await refused(() => ideeen.add("anna@proef.nl", { soort: "situatie", tekst: "   " }), 400, "leeg");
    await refused(() => ideeen.add("anna@proef.nl", { soort: "liedje", tekst: "x" }), 400, "soort");
    await refused(() => ideeen.add("anna@proef.nl", { soort: "pad", tekst: "x", link: "javascript:alert(1)" }), 400, "link");
    await refused(() => ideeen.add("anna@proef.nl", { soort: "pad", tekst: "x".repeat(2001) }), 400, "te_lang");
    await refused(() => ideeen.add("anna@proef.nl", { soort: "pad", tekst: "x", namens: "x".repeat(121) }), 400, "te_lang");
    checks += 5;

    // An idea of someone else, dropped by Anna: shown under that name, still Anna's to change.
    const namens = await ideeen.add("anna@proef.nl", { soort: "pad", tekst: "Van achter naar voren", namens: "  Brent   (in de groepsapp) " });
    check(() => assert.equal(namens.namens, "Brent (in de groepsapp)"));
    const shown = ideeen.view("bob@proef.nl", naam).find((item) => item.id === namens.id);
    check(() => assert.deepEqual([shown.namens, shown.naam, shown.eigen], ["Brent (in de groepsapp)", "Anna", false]));
    await refused(() => ideeen.update(namens.id, "bob@proef.nl", { namens: "Bob" }), 403, "niet_jouw_idee");
    checks += 1;
    const cleared = await ideeen.update(namens.id, "anna@proef.nl", { namens: "" });
    check(() => assert.equal(cleared.namens, ""));
    check(() => assert.equal(idee.namens, "", "een eigen idee heeft geen namens"));
    await ideeen.remove(namens.id, "anna@proef.nl");

    // Only your own idea can be changed or removed; anyone can set the status and react.
    await refused(() => ideeen.update(idee.id, "bob@proef.nl", { tekst: "anders" }), 403, "niet_jouw_idee");
    await refused(() => ideeen.remove(idee.id, "bob@proef.nl"), 403, "niet_jouw_idee");
    checks += 2;
    const changed = await ideeen.update(idee.id, "anna@proef.nl", { soort: "omgeving", tekst: "Een lift" });
    check(() => assert.equal(changed.soort, "omgeving"));
    check(() => assert.ok(changed.gewijzigdAt));
    await ideeen.setStatus(idee.id, "bob@proef.nl", "besproken");
    check(() => assert.equal(ideeen.view("anna@proef.nl", naam)[0].statusNaam, "Bob"));
    await refused(() => ideeen.setStatus(idee.id, "bob@proef.nl", "klaar"), 400, "status");
    checks += 1;
    const reactie = await ideeen.addReactie(idee.id, "bob@proef.nl", "Ja! Met muziek erbij.");
    await refused(() => ideeen.removeReactie(idee.id, reactie.id, "anna@proef.nl"), 403, "niet_jouw_reactie");
    checks += 1;
    check(() => assert.deepEqual(ideeen.view("anna@proef.nl", naam)[0].reacties.map((item) => [item.naam, item.eigen]), [["Bob", false]]));
    await ideeen.removeReactie(idee.id, reactie.id, "bob@proef.nl");
    check(() => assert.equal(ideeen.view("anna@proef.nl", naam)[0].reacties.length, 0));

    // Twenty at once: none lost, and the file stays whole.
    await Promise.all(Array.from({ length: 20 }, (_, i) => ideeen.add(i % 2 ? "anna@proef.nl" : "bob@proef.nl", { soort: "anders", tekst: `idee ${i}` })));
    check(() => assert.equal(ideeen.view("anna@proef.nl", naam).length, 21));
    check(() => assert.equal(JSON.parse(fs.readFileSync(path.join(dir, "ideeen.json"), "utf8")).ideeen.length, 22, "het weggehaalde idee blijft in het bestand"));
    check(() => assert.deepEqual(fs.readdirSync(dir).filter((name) => name.startsWith("ideeen.json.")), [], "geen halve bestanden"));

    // A photo from a phone: stored small and large, without the camera's data; another replaces it.
    const photo = await sharp({ create: { width: 3000, height: 2000, channels: 3, background: { r: 200, g: 40, b: 40 } } })
      .jpeg().withExif({ IFD0: { Copyright: "geheim", Artist: "telefoon" } }).toBuffer();
    check(() => assert.ok(photo.includes(Buffer.from("geheim")), "de proef-foto heeft camera-gegevens"));
    await refused(() => ideeen.setFoto(idee.id, "bob@proef.nl", photo), 403, "niet_jouw_idee");
    checks += 1;
    const withPhoto = await ideeen.setFoto(idee.id, "anna@proef.nl", photo);
    const groot = ideeen.fotoPath(withPhoto.foto.groot);
    const klein = ideeen.fotoPath(withPhoto.foto.klein);
    const widths = [(await sharp(groot).metadata()).width, (await sharp(klein).metadata()).width];
    check(() => assert.deepEqual(widths, [1600, 800]));
    const meta = await sharp(groot).metadata();
    check(() => assert.equal(meta.format, "webp"));
    check(() => assert.equal(meta.exif, undefined));
    check(() => assert.ok(!fs.readFileSync(groot).includes(Buffer.from("geheim"))));
    check(() => assert.equal(ideeen.view("bob@proef.nl", naam).find((item) => item.id === idee.id).foto.klein, `/ideeen/foto/${withPhoto.foto.klein}`));
    const other = await sharp({ create: { width: 800, height: 600, channels: 3, background: { r: 0, g: 0, b: 200 } } }).png().toBuffer();
    const replaced = await ideeen.setFoto(idee.id, "anna@proef.nl", other);
    check(() => assert.equal(ideeen.fotoPath(withPhoto.foto.groot), null, "de oude foto is weg"));
    const replacedWidth = (await sharp(ideeen.fotoPath(replaced.foto.groot)).metadata()).width;
    check(() => assert.equal(replacedWidth, 800, "niet groter gemaakt"));
    await refused(() => ideeen.setFoto(idee.id, "anna@proef.nl", Buffer.from("geen foto")), 400, "foto");
    checks += 1;
    check(() => assert.equal(ideeen.fotoPath("../ideeen.json"), null));
    await ideeen.removeFoto(idee.id, "anna@proef.nl");
    check(() => assert.equal(ideeen.fotoPath(replaced.foto.groot), null));

    // Removing takes it off the page, but the file keeps it.
    await ideeen.remove(idee.id, "anna@proef.nl");
    check(() => assert.equal(ideeen.view("anna@proef.nl", naam).some((item) => item.id === idee.id), false));
    check(() => assert.ok(JSON.parse(fs.readFileSync(path.join(dir, "ideeen.json"), "utf8")).ideeen.find((item) => item.id === idee.id).weg));
    await refused(() => ideeen.setStatus(idee.id, "bob@proef.nl", "nieuw"), 404, "onbekend");
    checks += 1;
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
  console.log(`ideeen: ${checks} controles OK`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
