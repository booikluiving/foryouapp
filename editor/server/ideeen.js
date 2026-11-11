"use strict";

// The team's ideas for the show (situations, characters, places, paths), on their own page in the
// Voorstelling. Kept apart from the show content: an idea never becomes a version and never travels
// to the show Mac. One JSON file, written whole (temporary file + rename) one change at a time.
// Photos are stored re-encoded, which also drops camera data such as where they were taken.

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const SOORTEN = ["situatie", "personage", "omgeving", "pad", "anders"];
const STATUSSEN = ["nieuw", "besproken", "in-catalogus", "niet-nu"];
const MAX_TEKST = 2000;
const MAX_REACTIE = 1000;
const MAX_LINK = 500;
const MAX_NAMENS = 120;
// A large one to open, a small one for the list (the image catalog was slow with originals); the
// small one is sharp at 320 px wide on a retina screen.
const FOTO_MATEN = { groot: 1600, klein: 800 };
const FOTO_NAAM = /^idee-[0-9a-f]{10}-[0-9a-f]{8}-(groot|klein)\.webp$/;

class IdeeFout extends Error {
  constructor(status, error, message) {
    super(message);
    this.status = status;
    this.error = error;
  }
}

function cleanText(value, max, what) {
  const text = String(value == null ? "" : value).replace(/\r\n?/g, "\n").trim();
  if (!text) throw new IdeeFout(400, "leeg", `${what} is leeg.`);
  if (text.length > max) throw new IdeeFout(400, "te_lang", `${what} is langer dan ${max} tekens.`);
  return text;
}

function cleanLink(value) {
  const text = String(value == null ? "" : value).trim();
  if (!text) return "";
  let url = null;
  try {
    url = new URL(/^[a-z][a-z0-9+.-]*:/i.test(text) ? text : `https://${text}`);
  } catch (_err) {
    url = null;
  }
  if (!url || !/^https?:$/.test(url.protocol) || url.href.length > MAX_LINK) {
    throw new IdeeFout(400, "link", "Die link kan ik niet gebruiken (alleen een webadres, http of https).");
  }
  return url.href;
}

// Whose idea it is when someone else drops it ("Brent (in de groepsapp)"); empty for your own.
function cleanNamens(value) {
  const text = String(value == null ? "" : value).replace(/\s+/g, " ").trim();
  if (text.length > MAX_NAMENS) throw new IdeeFout(400, "te_lang", `"Namens" is langer dan ${MAX_NAMENS} tekens.`);
  return text;
}

function cleanSoort(value) {
  if (!SOORTEN.includes(value)) throw new IdeeFout(400, "soort", `Kies een soort: ${SOORTEN.join(", ")}.`);
  return value;
}

function createIdeeen({ dir }) {
  const file = path.join(dir, "ideeen.json");
  const fotoDir = path.join(dir, "fotos");
  let tail = Promise.resolve();
  let sharp = null;

  function read() {
    try {
      return JSON.parse(fs.readFileSync(file, "utf8"));
    } catch (err) {
      if (err.code === "ENOENT") return { ideeen: [] };
      throw err;
    }
  }

  function write(data) {
    fs.mkdirSync(dir, { recursive: true });
    const temp = `${file}.${crypto.randomBytes(6).toString("hex")}`;
    fs.writeFileSync(temp, `${JSON.stringify(data, null, 2)}\n`);
    fs.renameSync(temp, file);
  }

  // One change at a time, each on the file as it is then; nothing is written when the change fails.
  function change(work) {
    const run = tail.then(async () => {
      const data = read();
      const result = await work(data);
      write(data);
      return result;
    });
    tail = run.catch(() => {});
    return run;
  }

  function find(data, id) {
    const idee = data.ideeen.find((item) => item.id === id && !item.weg);
    if (!idee) throw new IdeeFout(404, "onbekend", "Dit idee bestaat niet (meer).");
    return idee;
  }

  function own(idee, door) {
    if (idee.door !== door) throw new IdeeFout(403, "niet_jouw_idee", "Alleen wie het idee gaf, kan het aanpassen of weghalen.");
    return idee;
  }

  function dropFoto(foto) {
    for (const name of Object.values(foto || {})) {
      try {
        fs.unlinkSync(path.join(fotoDir, name));
      } catch (_err) {
        // Already gone.
      }
    }
  }

  return {
    // What the page shows: the ideas that are there, newest first, with first names and what is yours.
    view(me, naam) {
      return read().ideeen.filter((idee) => !idee.weg).sort((a, b) => b.at.localeCompare(a.at)).map((idee) => ({
        id: idee.id,
        soort: idee.soort,
        tekst: idee.tekst,
        link: idee.link || "",
        namens: idee.namens || "",
        foto: idee.foto ? { klein: `/ideeen/foto/${idee.foto.klein}`, groot: `/ideeen/foto/${idee.foto.groot}` } : null,
        naam: naam(idee.door),
        eigen: idee.door === me,
        at: idee.at,
        gewijzigdAt: idee.gewijzigdAt || null,
        status: idee.status,
        statusNaam: idee.statusDoor ? naam(idee.statusDoor) : "",
        statusAt: idee.statusAt || null,
        reacties: (idee.reacties || []).map((reactie) => ({ id: reactie.id, naam: naam(reactie.door), eigen: reactie.door === me, tekst: reactie.tekst, at: reactie.at })),
      }));
    },

    add(door, input) {
      const idee = {
        id: `idee-${crypto.randomBytes(5).toString("hex")}`,
        soort: cleanSoort(input.soort),
        tekst: cleanText(input.tekst, MAX_TEKST, "Het idee"),
        link: cleanLink(input.link),
        namens: cleanNamens(input.namens),
        foto: null,
        door,
        at: new Date().toISOString(),
        status: "nieuw",
        reacties: [],
      };
      return change((data) => {
        data.ideeen.push(idee);
        return idee;
      });
    },

    update(id, door, input) {
      return change((data) => {
        const idee = own(find(data, id), door);
        if (input.soort !== undefined) idee.soort = cleanSoort(input.soort);
        if (input.tekst !== undefined) idee.tekst = cleanText(input.tekst, MAX_TEKST, "Het idee");
        if (input.link !== undefined) idee.link = cleanLink(input.link);
        if (input.namens !== undefined) idee.namens = cleanNamens(input.namens);
        idee.gewijzigdAt = new Date().toISOString();
        return idee;
      });
    },

    // Taken off the page, but kept in the file: a wrong tap loses nothing.
    remove(id, door) {
      return change((data) => {
        const idee = own(find(data, id), door);
        idee.weg = { door, at: new Date().toISOString() };
        return { id };
      });
    },

    setStatus(id, door, status) {
      if (!STATUSSEN.includes(status)) throw new IdeeFout(400, "status", `Kies een status: ${STATUSSEN.join(", ")}.`);
      return change((data) => {
        const idee = find(data, id);
        Object.assign(idee, { status, statusDoor: door, statusAt: new Date().toISOString() });
        return idee;
      });
    },

    addReactie(id, door, tekst) {
      const reactie = { id: `reactie-${crypto.randomBytes(5).toString("hex")}`, door, tekst: cleanText(tekst, MAX_REACTIE, "De reactie"), at: new Date().toISOString() };
      return change((data) => {
        const idee = find(data, id);
        idee.reacties = [...(idee.reacties || []), reactie];
        return reactie;
      });
    },

    removeReactie(id, reactieId, door) {
      return change((data) => {
        const idee = find(data, id);
        const reactie = (idee.reacties || []).find((item) => item.id === reactieId);
        if (!reactie) throw new IdeeFout(404, "onbekend", "Deze reactie bestaat niet (meer).");
        if (reactie.door !== door) throw new IdeeFout(403, "niet_jouw_reactie", "Alleen wie reageerde, kan de reactie weghalen.");
        idee.reacties = idee.reacties.filter((item) => item !== reactie);
        return { id: reactieId };
      });
    },

    async setFoto(id, door, buffer) {
      own(find(read(), id), door);
      sharp = sharp || require("sharp");
      const made = {};
      try {
        for (const [maat, width] of Object.entries(FOTO_MATEN)) {
          // rotate() follows the camera's orientation; the camera data itself is left behind.
          made[maat] = await sharp(buffer, { animated: false }).rotate()
            .resize({ width, height: width, fit: "inside", withoutEnlargement: true })
            .webp({ quality: 82 })
            .toBuffer();
        }
      } catch (_err) {
        throw new IdeeFout(400, "foto", "Deze foto kan ik niet lezen. Probeer een JPG of PNG.");
      }
      const stamp = crypto.createHash("sha256").update(made.groot).digest("hex").slice(0, 8);
      const foto = {};
      fs.mkdirSync(fotoDir, { recursive: true });
      for (const [maat, picture] of Object.entries(made)) {
        foto[maat] = `${id}-${stamp}-${maat}.webp`;
        fs.writeFileSync(path.join(fotoDir, foto[maat]), picture);
      }
      return change((data) => {
        const idee = own(find(data, id), door);
        if (idee.foto && idee.foto.groot !== foto.groot) dropFoto(idee.foto);
        idee.foto = foto;
        return idee;
      });
    },

    removeFoto(id, door) {
      return change((data) => {
        const idee = own(find(data, id), door);
        dropFoto(idee.foto);
        idee.foto = null;
        return idee;
      });
    },

    // The file of a photo by its name (the name holds its content, so it never changes), or null.
    fotoPath(name) {
      if (!FOTO_NAAM.test(name)) return null;
      const full = path.join(fotoDir, name);
      return fs.existsSync(full) ? full : null;
    },
  };
}

module.exports = { IdeeFout, SOORTEN, STATUSSEN, createIdeeen };
