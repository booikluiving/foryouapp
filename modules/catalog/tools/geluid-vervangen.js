#!/usr/bin/env node
"use strict";

// Vervangt geluidsbestanden in de catalogus door een nieuwe versie (bijvoorbeeld
// gelijkgetrokken), zoals een upload in de catalogus dat doet: nieuw bestand met een
// eigen naam, het oude als back-up (status "replaced") en alle verwijzingen naar het
// oude bestand (sfeergeluid van de omgeving, extra geluid, sfeergeluid van een fase)
// naar het nieuwe. Er gaat niets naar TouchDesigner: de nieuwe bestanden spelen vanaf
// de volgende keer dat een omgeving klaargezet wordt.
//
//   node modules/catalog/tools/geluid-vervangen.js lijst.json [--droog]
//
// lijst.json: [{ "assetId": "media-asset:...", "bestand": "/pad/naar/nieuw.mp3" }, ...]
// Uitvoer: per regel oud -> nieuw, en de koppeling als JSON op stdout (laatste regel).

const fs = require("node:fs");
const fsp = require("node:fs/promises");
const path = require("node:path");

const {
  catalogMediaRoot,
  readCatalogStore,
  saveMediaAssetFile,
  writeCatalogStore,
} = require("../write-model/catalog-store");
const { buildCatalogReadModel } = require("../read-model/build-read-model");

function backupStamp() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

function safeSegment(value) {
  return String(value || "").replace(/[^a-zA-Z0-9_-]+/g, "_").replace(/^_+|_+$/g, "") || "unknown";
}

// Zet het oude bestand opzij zoals de catalogus dat bij een vervanging doet.
function markReplaced(record, mediaRoot, stamp) {
  if (record.status === "replaced") return null;
  const source = path.join(mediaRoot, record.relativePath);
  const backupDir = path.join(mediaRoot, "_asset-backups", stamp, safeSegment(record.environmentId), record.type);
  fs.mkdirSync(backupDir, { recursive: true });
  const target = path.join(backupDir, path.basename(source));
  if (fs.existsSync(source)) fs.renameSync(source, target);
  record.status = "replaced";
  record.replacedAt = new Date().toISOString();
  record.backupFilePath = target;
  record.backupRelativePath = path.relative(mediaRoot, target);
  return record.backupRelativePath;
}

// Vervangt "oudId" door "nieuwId" overal waar het als waarde voorkomt (niet in de
// media-assets zelf).
function replaceReferences(store, mapping) {
  const counts = {};
  for (const key of Object.keys(store)) {
    if (key === "mediaAssets" || !Array.isArray(store[key])) continue;
    store[key] = store[key].map((record) => {
      let text = JSON.stringify(record);
      let changed = false;
      for (const [oldId, newId] of Object.entries(mapping)) {
        const needle = JSON.stringify(oldId);
        if (text.includes(needle)) {
          text = text.split(needle).join(JSON.stringify(newId));
          counts[oldId] = (counts[oldId] || 0) + 1;
          changed = true;
        }
      }
      return changed ? JSON.parse(text) : record;
    });
  }
  return counts;
}

async function main() {
  const args = process.argv.slice(2);
  const droog = args.includes("--droog");
  const listPath = args.find((arg) => !arg.startsWith("--"));
  if (!listPath) throw new Error("gebruik: geluid-vervangen.js lijst.json [--droog]");
  const lijst = JSON.parse(fs.readFileSync(listPath, "utf8"));
  const options = {};
  const mediaRoot = catalogMediaRoot(options);
  const before = await readCatalogStore(options);
  const byId = new Map(before.mediaAssets.map((record) => [record.id, record]));

  for (const item of lijst) {
    const record = byId.get(item.assetId);
    if (!record) throw new Error(`niet in de catalogus: ${item.assetId}`);
    if (record.status === "replaced" || record.status === "deleted") throw new Error(`al vervangen of weg: ${item.assetId}`);
    if (!fs.existsSync(item.bestand)) throw new Error(`bestand ontbreekt: ${item.bestand}`);
  }
  if (droog) {
    console.log(`droog: ${lijst.length} bestanden zouden vervangen worden`);
    return;
  }

  const stamp = backupStamp();
  const staging = path.join(mediaRoot, "_staging", stamp);
  await fsp.mkdir(staging, { recursive: true });
  const mapping = {};
  const verslag = [];
  for (const item of lijst) {
    const readModel = await buildCatalogReadModel(options);
    const record = byId.get(item.assetId);
    const tempPath = path.join(staging, path.basename(item.bestand));
    await fsp.copyFile(item.bestand, tempPath);
    const size = (await fsp.stat(tempPath)).size;
    const asset = await saveMediaAssetFile({
      tempPath,
      environmentId: record.environmentId,
      type: record.type,
      role: record.role,
      originalFilename: record.originalFilename || record.filename,
      mimeType: record.mimeType,
      sizeBytes: size,
      tags: record.tags,
    }, readModel, options);
    mapping[record.id] = asset.id;
    verslag.push({ oud: record.id, oudBestand: record.filename, nieuw: asset.id, nieuwBestand: asset.filename });
    console.log(`${record.environmentName}: ${record.filename} -> ${asset.filename}`);
  }

  // Oude bestanden opzij (een sfeergeluid doet de catalogus al zelf) en verwijzingen bijwerken.
  const store = await readCatalogStore(options);
  for (const record of store.mediaAssets) {
    if (mapping[record.id]) markReplaced(record, mediaRoot, stamp);
  }
  const counts = replaceReferences(store, mapping);
  await writeCatalogStore(store, options);
  await fsp.rm(staging, { recursive: true, force: true });
  for (const entry of verslag) entry.verwijzingen = counts[entry.oud] || 0;
  console.log(JSON.stringify(verslag));
}

main().catch((err) => {
  console.error(err && err.stack ? err.stack : err);
  process.exitCode = 1;
});
