"use strict";

// Extra shot/geluid per omgeving in de catalogus: opslaan, bewaren bij een
// gewone bewerking, uploaden als eigen type "extra". Eigen tijdelijke db/media.

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const {
  readCatalogStore,
  saveMediaAssetFile,
  upsertEnvironment,
  writeCatalogStore,
} = require("../write-model/catalog-store");
const { buildCatalogReadModel } = require("../read-model/build-read-model");
const { applyBeginwaarden } = require("../tools/environment-extras-beginwaarden");

const ROOT = path.resolve(__dirname, "..", `.tmp-extras-${process.pid}`);
const options = { dbPath: path.join(ROOT, "catalog.sqlite"), mediaRoot: path.join(ROOT, "media") };

async function main() {
  fs.mkdirSync(options.mediaRoot, { recursive: true });
  const store = await readCatalogStore(options);
  store.environments.push(
    { id: "environment:7", name: "Spelletjeskamer", description: "", active: true },
    { id: "environment:12", name: "Ziekenhuis", description: "", active: true }
  );
  await writeCatalogStore(store, options);

  let readModel = await buildCatalogReadModel(options);
  const env = readModel.environments.find((item) => item.id === "environment:7");
  assert.equal(env.extras.shot.label, "", "leeg begint leeg");

  // Opslaan met extras
  await upsertEnvironment({
    id: "environment:7",
    name: "Spelletjeskamer",
    extras: { shot: { label: "Shot spelbord", bron: "bestand", bestand: "x", duur: 6 }, geluid: { label: "Bom", bron: "bestand", volume: 2 } },
  }, readModel, options);
  readModel = await buildCatalogReadModel(options);
  let saved = readModel.environments.find((item) => item.id === "environment:7");
  assert.equal(saved.extras.shot.label, "Shot spelbord");
  assert.equal(saved.extras.shot.duur, 6);
  assert.equal(saved.extras.geluid.volume, 1, "volume begrensd");

  // Bewerking zonder extras (oude editor/oude client) wist ze niet
  await upsertEnvironment({ id: "environment:7", name: "Spelletjeskamer", description: "nieuw" }, readModel, options);
  readModel = await buildCatalogReadModel(options);
  saved = readModel.environments.find((item) => item.id === "environment:7");
  assert.equal(saved.description, "nieuw");
  assert.equal(saved.extras.geluid.label, "Bom");

  // Upload als extraGeluid: type "extra", map extra/, geen soundscape
  const tmpFile = path.join(ROOT, "bom.mp3");
  fs.writeFileSync(tmpFile, Buffer.from("ID3fake-audio"));
  const asset = await saveMediaAssetFile({
    tempPath: tmpFile,
    environmentId: "environment:7",
    type: "extra",
    role: "extraGeluid",
    originalFilename: "bom.mp3",
    mimeType: "audio/mpeg",
    sizeBytes: 13,
  }, readModel, options);
  assert.equal(asset.type, "extra");
  assert.equal(asset.role, "extraGeluid");
  assert.ok(asset.relativePath.includes(`${path.sep}extra${path.sep}`), asset.relativePath);

  // Een beeld mag niet als extraGeluid
  const png = path.join(ROOT, "x.png");
  fs.writeFileSync(png, Buffer.from("png"));
  await assert.rejects(() => saveMediaAssetFile({
    tempPath: png, environmentId: "environment:7", type: "extra", role: "extraGeluid", originalFilename: "x.png", mimeType: "image/png", sizeBytes: 3,
  }, readModel, options));

  // Beginwaarden: vullen alleen lege velden, overschrijven nooit
  const report = await applyBeginwaarden({
    ...options,
    schrijf: true,
    beginwaarden: {
      Spelletjeskamer: { shot: { label: "ANDERS" }, geluid: { label: "ANDERS" } },
      Ziekenhuis: { shot: { label: "Shot kamer", bron: "achtergrond", duur: 0 }, geluid: { label: "Piepjes", omschrijving: "Monitor" } },
      Onbekend: { shot: { label: "x" } },
    },
  });
  readModel = await buildCatalogReadModel(options);
  saved = readModel.environments.find((item) => item.id === "environment:7");
  assert.equal(saved.extras.shot.label, "Shot spelbord", "bestaande waarde blijft");
  const zh = readModel.environments.find((item) => item.id === "environment:12");
  assert.equal(zh.extras.shot.label, "Shot kamer");
  assert.equal(zh.extras.shot.bron, "achtergrond");
  assert.equal(zh.extras.shot.duur, 0);
  assert.equal(zh.extras.geluid.label, "Piepjes");
  assert.deepEqual(report.onbekend, ["Onbekend"]);
  assert.deepEqual(report.gevuld.sort(), ["Ziekenhuis:geluid", "Ziekenhuis:shot"]);
}

main()
  .then(() => {
    fs.rmSync(ROOT, { recursive: true, force: true });
    console.log("catalog environment-extras: ok");
  })
  .catch((err) => {
    fs.rmSync(ROOT, { recursive: true, force: true });
    console.error(err);
    process.exit(1);
  });
