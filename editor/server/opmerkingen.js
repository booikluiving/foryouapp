"use strict";

// What the team still wants changed in an environment of the image catalog: short notes per
// environment, on the website only. Kept apart from the show content, like the ideas: a note never
// becomes a version and never travels to the show Mac. One JSON file, written whole (temporary
// file + rename) one change at a time.

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const MAX_TEKST = 2000;
const OMGEVING = /^[A-Za-z0-9:._-]{1,80}$/;

class OpmerkingFout extends Error {
  constructor(status, error, message) {
    super(message);
    this.status = status;
    this.error = error;
  }
}

function cleanText(value) {
  const text = String(value == null ? "" : value).replace(/\r\n?/g, "\n").trim();
  if (!text) throw new OpmerkingFout(400, "leeg", "De opmerking is leeg.");
  if (text.length > MAX_TEKST) throw new OpmerkingFout(400, "te_lang", `De opmerking is langer dan ${MAX_TEKST} tekens.`);
  return text;
}

function cleanOmgeving(value) {
  const id = String(value == null ? "" : value);
  if (!OMGEVING.test(id)) throw new OpmerkingFout(400, "omgeving", "Bij welke omgeving hoort deze opmerking?");
  return id;
}

function createOpmerkingen({ dir }) {
  const file = path.join(dir, "opmerkingen.json");
  let tail = Promise.resolve();

  function read() {
    try {
      return JSON.parse(fs.readFileSync(file, "utf8"));
    } catch (err) {
      if (err.code === "ENOENT") return { opmerkingen: [] };
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
    const opmerking = data.opmerkingen.find((item) => item.id === id && !item.weg);
    if (!opmerking) throw new OpmerkingFout(404, "onbekend", "Deze opmerking bestaat niet (meer).");
    return opmerking;
  }

  function own(opmerking, door) {
    if (opmerking.door !== door) throw new OpmerkingFout(403, "niet_jouw_opmerking", "Alleen wie de opmerking schreef, kan hem aanpassen of weghalen.");
    return opmerking;
  }

  const shown = (opmerking, me, naam) => ({
    id: opmerking.id,
    omgeving: opmerking.omgeving,
    tekst: opmerking.tekst,
    naam: naam(opmerking.door),
    eigen: opmerking.door === me,
    at: opmerking.at,
    klaar: Boolean(opmerking.klaar),
    klaarNaam: opmerking.klaar ? naam(opmerking.klaar.door) : "",
    klaarAt: opmerking.klaar ? opmerking.klaar.at : null,
  });

  return {
    // What the page shows: every note that is there, oldest first (the order they were given in).
    view(me, naam) {
      return read().opmerkingen.filter((item) => !item.weg).sort((a, b) => a.at.localeCompare(b.at)).map((item) => shown(item, me, naam));
    },

    add(door, input) {
      const opmerking = {
        id: `opm-${crypto.randomBytes(5).toString("hex")}`,
        omgeving: cleanOmgeving(input.omgeving),
        tekst: cleanText(input.tekst),
        door,
        at: new Date().toISOString(),
        klaar: null,
      };
      return change((data) => {
        data.opmerkingen.push(opmerking);
        return opmerking;
      });
    },

    update(id, door, input) {
      return change((data) => {
        const opmerking = own(find(data, id), door);
        opmerking.tekst = cleanText(input.tekst);
        opmerking.gewijzigdAt = new Date().toISOString();
        return opmerking;
      });
    },

    // Taken off the page, but kept in the file: a wrong tap loses nothing.
    remove(id, door) {
      return change((data) => {
        const opmerking = own(find(data, id), door);
        opmerking.weg = { door, at: new Date().toISOString() };
        return { id };
      });
    },

    // Anyone can tick a note off once it has been done, and bring it back.
    setKlaar(id, door, klaar) {
      return change((data) => {
        const opmerking = find(data, id);
        opmerking.klaar = klaar ? { door, at: new Date().toISOString() } : null;
        return opmerking;
      });
    },
  };
}

module.exports = { OpmerkingFout, createOpmerkingen };
