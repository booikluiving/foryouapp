#!/usr/bin/env node
"use strict";

// Zet de beginwaarden voor extra shot en extra geluid per omgeving in de catalogus.
// Vult alleen wat leeg is: wat het team al invulde blijft altijd staan.
//
//   node modules/catalog/tools/environment-extras-beginwaarden.js            kijkt alleen (droog)
//   node modules/catalog/tools/environment-extras-beginwaarden.js --schrijf  schrijft, met back-up
//   --db <pad>  een andere catalog.sqlite (bijvoorbeeld de live catalogus)
//
// Schrijft alleen de rijen in de tabel environments (record_json), niets anders.

const fs = require("node:fs");
const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");

const { catalogDbPath } = require("../write-model/catalog-store");
const {
  isEmptyExtra,
  normalizeEnvironmentExtras,
} = require("../../../shared/environment-extras/environment-extras-v0");

const DEFAULT_FILE = path.join(__dirname, "environment-extras-beginwaarden.json");

function loadBeginwaarden(input) {
  const source = input || JSON.parse(fs.readFileSync(DEFAULT_FILE, "utf8"));
  if (Array.isArray(source.omgevingen)) return source.omgevingen;
  return Object.entries(source).map(([naam, value]) => ({ naam, ...value }));
}

const key = (value) => String(value || "").trim().toLowerCase();

function stamp() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

async function applyBeginwaarden(options = {}) {
  // --db: expliciet pad, bijvoorbeeld de live catalogus vanuit een worktree.
  const dbPath = options.db ? path.resolve(options.db) : catalogDbPath(options);
  const wanted = loadBeginwaarden(options.beginwaarden);
  const schrijf = options.schrijf === true;
  const report = { dbPath, gevuld: [], overgeslagen: [], onbekend: [], backup: null };

  const db = new DatabaseSync(dbPath);
  try {
    const rows = db.prepare("SELECT id, name, record_json FROM environments").all();
    const byId = new Map(rows.map((row) => [row.id, row]));
    const byName = new Map(rows.map((row) => [key(row.name), row]));
    const updates = [];
    for (const item of wanted) {
      const row = (item.id && byId.get(item.id)) || byName.get(key(item.naam));
      if (!row) {
        report.onbekend.push(item.naam || item.id);
        continue;
      }
      const record = JSON.parse(row.record_json);
      const current = normalizeEnvironmentExtras(record.extras);
      const proposal = normalizeEnvironmentExtras({ shot: item.shot, geluid: item.geluid });
      let changed = false;
      for (const kind of ["shot", "geluid"]) {
        if (isEmptyExtra(current[kind]) && !isEmptyExtra(proposal[kind])) {
          current[kind] = proposal[kind];
          report.gevuld.push(`${row.name}:${kind}`);
          changed = true;
        } else if (!isEmptyExtra(proposal[kind])) {
          report.overgeslagen.push(`${row.name}:${kind}`);
        }
      }
      if (changed) updates.push({ id: row.id, record: { ...record, extras: current, updatedAt: new Date().toISOString() } });
    }

    if (schrijf && updates.length) {
      const backup = path.join(path.dirname(dbPath), `catalog.voor-extras-${stamp()}.sqlite`);
      db.exec(`VACUUM INTO '${backup.replace(/'/g, "''")}'`);
      report.backup = backup;
      const update = db.prepare("UPDATE environments SET record_json = ? WHERE id = ?");
      db.exec("BEGIN IMMEDIATE");
      try {
        for (const item of updates) update.run(JSON.stringify(item.record), item.id);
        db.exec("COMMIT");
      } catch (err) {
        db.exec("ROLLBACK");
        throw err;
      }
    }
    report.geschreven = schrijf ? updates.length : 0;
  } finally {
    db.close();
  }
  return report;
}

module.exports = { applyBeginwaarden, loadBeginwaarden };

if (require.main === module) {
  const schrijf = process.argv.includes("--schrijf");
  const dbIndex = process.argv.indexOf("--db");
  const db = dbIndex > -1 ? process.argv[dbIndex + 1] : "";
  applyBeginwaarden({ schrijf, db })
    .then((report) => {
      console.log(JSON.stringify(report, null, 2));
      if (!schrijf) console.log("Droog: niets geschreven. Gebruik --schrijf om te schrijven.");
    })
    .catch((err) => {
      console.error(err && err.stack || err);
      process.exit(1);
    });
}
