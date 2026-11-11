#!/usr/bin/env node
"use strict";

// Maakt de clips voor het effect "omvallen" van één omgeving: per druk op de knop een korte
// film met transparantie (ProRes 4444), plus omvallen.json met wat show control nodig heeft.
// Leest de compositie alleen-lezen uit de catalogus. Schrijft alleen in de uitmap.
//
//   node modules/catalog/tools/omvallen-clips.js --omgeving environment:26
//   node modules/catalog/tools/omvallen-clips.js --omgeving environment:26 --uit /tmp/proef --db ... --media ...
//
// Standaard uitmap: <media>/environments/environment_<nr>/omvallen/

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const { DatabaseSync } = require("node:sqlite");

const DEFAULT_DB = path.resolve(__dirname, "../db/catalog.sqlite");
const DEFAULT_MEDIA = path.resolve(__dirname, "../media");
const KLAP = { loskom: 1.25, val: 1.55, zak: 1.2 };

function arg(name, fallback = "") {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
}

function omvallenDir(mediaRoot, environmentId) {
  return path.join(mediaRoot, "environments", environmentId.replace(":", "_"), "omvallen");
}

function leesCompositie(dbPath, environmentId) {
  const db = new DatabaseSync(dbPath, { readOnly: true });
  try {
    const row = db.prepare("SELECT record_json FROM environment_compositions WHERE environment_id = ?").get(environmentId);
    const assets = db.prepare("SELECT record_json FROM media_assets WHERE environment_id = ?").all(environmentId)
      .map((item) => JSON.parse(item.record_json));
    return { composition: row ? JSON.parse(row.record_json) : null, assets };
  } finally {
    db.close();
  }
}

// Zelfde indeling als de editor: lagen met val.stap > 0, de stappen oplopend.
function bouwPlan(composition, assets, mediaRoot) {
  const byId = new Map(assets.map((asset) => [asset.id, asset]));
  const lagen = (composition.imageLayers || [])
    .filter((layer) => layer.visible !== false && byId.has(layer.assetId))
    .sort((a, b) => Number(a.zIndex || 0) - Number(b.zIndex || 0));
  const stappen = [...new Set(lagen.filter((layer) => layer.val && layer.val.stap > 0).map((layer) => Number(layer.val.stap)))].sort((a, b) => a - b);
  if (!stappen.length) throw new Error("geen lagen met 'Valt bij stap' in deze omgeving");
  const spec = {
    breedte: 2160,
    hoogte: 1280,
    canvasBreedte: 6480,
    fps: 25,
    stappen: stappen.length,
    lagen: lagen.map((layer) => ({
      bestand: path.join(mediaRoot, byId.get(layer.assetId).relativePath),
      x: layer.x, y: layer.y, breedte: layer.width, hoogte: layer.height,
      rotatie: Number(layer.rotationDeg || 0), opacity: Number(layer.opacity ?? 1),
      stap: layer.val && layer.val.stap > 0 ? stappen.indexOf(Number(layer.val.stap)) : -1,
      links: !!(layer.val && layer.val.richting === "links"),
    })),
  };
  const namen = (index) => lagen.filter((layer) => layer.val && stappen.indexOf(Number(layer.val.stap)) === index).map((layer) => String(layer.name || layer.assetId).replace(/\.(png|jpe?g|webp)$/i, "").replace(/[-_]+/g, " "));
  const geluiden = Array.isArray(composition.valGeluiden) ? composition.valGeluiden : [];
  const drukken = [{ naam: "komt los", klap: KLAP.loskom }]
    .concat(stappen.map((_stap, index) => ({ naam: `${namen(index).join(" + ")} valt`, klap: KLAP.val })))
    .concat([{ naam: "stapel zakt weg", klap: KLAP.zak }])
    .map((druk, index) => {
      const geluid = byId.get(geluiden[index] || "");
      return { ...druk, druk: index + 1, geluidAssetId: geluid ? geluid.id : "", geluid: geluid ? geluid.relativePath : "" };
    });
  return { spec, drukken };
}

function main() {
  const environmentId = arg("omgeving");
  if (!environmentId) throw new Error("gebruik: --omgeving environment:<nr> [--uit map] [--db pad] [--media map]");
  const dbPath = path.resolve(arg("db", process.env.CATALOG_DB_PATH || DEFAULT_DB));
  const mediaRoot = path.resolve(arg("media", process.env.CATALOG_MEDIA_ROOT || DEFAULT_MEDIA));
  const outDir = path.resolve(arg("uit", omvallenDir(mediaRoot, environmentId)));
  const { composition, assets } = leesCompositie(dbPath, environmentId);
  if (!composition) throw new Error(`geen compositie voor ${environmentId}`);
  const { spec, drukken } = bouwPlan(composition, assets, mediaRoot);
  for (const laag of spec.lagen) {
    if (!fs.existsSync(laag.bestand)) throw new Error(`bestand ontbreekt: ${laag.bestand}`);
  }

  const work = fs.mkdtempSync(path.join(os.tmpdir(), "omvallen-"));
  const specPath = path.join(work, "spec.json");
  fs.writeFileSync(specPath, JSON.stringify(spec));
  const bin = path.join(work, "render");
  execFileSync("swiftc", ["-O", path.join(__dirname, "omvallen", "render.swift"), "-o", bin], { stdio: ["ignore", "ignore", "inherit"] });
  fs.mkdirSync(outDir, { recursive: true });
  const frames = path.join(work, "beelden");
  fs.mkdirSync(frames);

  // De beginstand op volle maat (6480 breed): dat is ook de stilstaande voorgrond voor TD.
  const volPath = path.join(work, "spec-vol.json");
  fs.writeFileSync(volPath, JSON.stringify({ ...spec, breedte: 6480, hoogte: 3840 }));
  execFileSync(bin, [volPath, frames, "0"], { stdio: "inherit" });
  fs.copyFileSync(path.join(frames, "druk0_0000.png"), path.join(outDir, "begin.png"));
  for (const druk of drukken) {
    execFileSync(bin, [specPath, frames, String(druk.druk)], { stdio: "inherit" });
    druk.clip = `stap-${druk.druk}.mov`;
    druk.duur = fs.readdirSync(frames).filter((name) => name.startsWith(`druk${druk.druk}_`)).length / spec.fps;
    execFileSync("ffmpeg", ["-v", "error", "-y", "-framerate", String(spec.fps), "-i", path.join(frames, `druk${druk.druk}_%04d.png`),
      "-c:v", "prores_ks", "-profile:v", "4444", "-pix_fmt", "yuva444p10le", "-vendor", "apl0", path.join(outDir, druk.clip)], { stdio: "inherit" });
  }
  const manifest = {
    schemaVersion: "omvallen.v0",
    environmentId,
    compositionUpdatedAt: composition.updatedAt || null,
    gemaaktOp: new Date().toISOString(),
    begin: "begin.png",
    drukken,
  };
  fs.writeFileSync(path.join(outDir, "omvallen.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  fs.rmSync(work, { recursive: true, force: true });
  console.log(`klaar: ${drukken.length} clips in ${outDir}`);
}

if (require.main === module) {
  try {
    main();
  } catch (err) {
    console.error(err.message || err);
    process.exit(1);
  }
}

module.exports = { bouwPlan, omvallenDir };
