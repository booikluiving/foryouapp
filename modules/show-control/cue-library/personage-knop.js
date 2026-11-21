"use strict";

// Knop van een personage: een nummer dat bij het personage hoort, in elke scène waarin het
// meespeelt. De knop hangt aan het personage, niet aan een lijst scènes: een nieuwe scène met dat
// personage heeft hem vanzelf.
//
// Staat niet in de catalogus maar als bestand bij de media van het personage:
//   <media>/characters/character_<nr>/knop/knop.json
//   { "label": "MARIT", "geluid": "marit.wav", "volume": 1, "lus": false, "overgang": 5 }
// over: true = het nummer klinkt over het geluid van de scène heen; false = het andere geluid van de
// scène gaat weg zolang het nummer speelt. overgang (alleen bij over: false): in zoveel seconden
// zakt het andere geluid weg en komt het nummer op (0 = meteen).
// De knop is een wissel: een druk start het nummer vanaf het begin, de volgende druk zet het uit.
//
// Een druk start het nummer en zet het andere geluid van de scène uit: het sfeergeluid van de
// omgeving (ook dat van een fase), het extra geluid en de geluiden van fases en stappen. Nog een
// druk zet het nummer uit; het sfeergeluid komt dan terug, ook als het nummer afloopt.
// Het nummer loopt over het spoor van het extra geluid: stop en RESET RUN zetten het uit
// (scene-einde.js zet alle sporen uit).

const fs = require("node:fs");
const path = require("node:path");
const {
  SHOW_CONTROL_CUE_SCHEMA_VERSION,
  createShowControlId,
} = require("../../../shared/contracts/show-control-v0");
const { environmentExtrasStatus } = require("./environment-extras");

const DEFAULT_MEDIA_ROOT = path.resolve(__dirname, "../../catalog/media");

function mediaRoot(options = {}) {
  return String(options.catalogMediaRoot || process.env.CATALOG_MEDIA_ROOT || DEFAULT_MEDIA_ROOT);
}

function knopDir(characterId, options = {}) {
  const nummer = String(characterId || "").split(":").pop();
  return path.join(mediaRoot(options), "characters", `character_${nummer}`, "knop");
}

function readKnop(characterId, options = {}) {
  const dir = knopDir(characterId, options);
  let manifest = null;
  try {
    const read = typeof options.readFile === "function" ? options.readFile : (file) => fs.readFileSync(file, "utf8");
    manifest = JSON.parse(read(path.join(dir, "knop.json")));
  } catch (_err) {
    return null;
  }
  if (!manifest || typeof manifest !== "object" || !manifest.geluid) return null;
  const volume = Number(manifest.volume);
  const overgang = Number(manifest.overgang);
  return {
    label: String(manifest.label || "").slice(0, 24),
    filePath: path.join(dir, path.basename(String(manifest.geluid))),
    volume: Number.isFinite(volume) ? Math.min(1, Math.max(0, volume)) : 1,
    lus: manifest.lus === true,
    over: manifest.over === true,
    overgang: manifest.over === true ? 0 : (Number.isFinite(overgang) ? Math.min(15, Math.max(0, overgang)) : 5),
  };
}

function fileExists(filePath, options = {}) {
  if (typeof options.fileExists === "function") return options.fileExists(filePath);
  try {
    return fs.statSync(filePath).isFile();
  } catch (_err) {
    return false;
  }
}

function charactersOf(resolved) {
  if (!resolved || typeof resolved !== "object") return [];
  const characters = Array.isArray(resolved.characters) ? resolved.characters : [];
  const ids = Array.isArray(resolved.characterIds) ? resolved.characterIds : characters.map((character) => character && character.id);
  return ids.filter(Boolean).map((id) => {
    const character = characters.find((item) => item && item.id === id) || {};
    return { id: String(id), name: String(character.name || "") };
  });
}

// Speelt het nummer nu? De geluidsadapter weet het.
function speelt(filePath, options = {}) {
  if (typeof options.speelt === "function") return !!options.speelt(filePath);
  return require("../target-adapters/mac-audio-adapter").liedSpeelt(filePath);
}

// De knop van het eerste personage met een knop, in de scène die speelt; anders in de scène die
// klaarstaat (dan is de knop te zien maar nog donker).
function personageKnopStatus(runtimeState, options = {}) {
  const state = runtimeState && typeof runtimeState === "object" ? runtimeState : {};
  const actief = state.activeSituation && state.activeSituation.resolved;
  const leeg = { ok: true, characterId: "", characterName: "", label: "", klaar: false, staat: "uit", aan: false, reden: "geen_personage", filePath: "" };
  for (const [resolved, speeltNu] of [[actief, true], [actief ? null : state.resolvedPreparedNext, false]]) {
    for (const character of charactersOf(resolved)) {
      const knop = readKnop(character.id, options);
      if (!knop) continue;
      const basis = {
        ...leeg,
        characterId: character.id,
        characterName: character.name,
        label: knop.label || character.name.toUpperCase(),
        volume: knop.volume,
        lus: knop.lus,
        over: knop.over,
        overgang: knop.overgang,
      };
      if (!fileExists(knop.filePath, options)) return { ...basis, reden: "bestand_ontbreekt" };
      if (!speeltNu) return { ...basis, reden: "scene_speelt_niet", filePath: knop.filePath };
      const aan = speelt(knop.filePath, options);
      return { ...basis, klaar: true, staat: aan ? "actief" : "klaar", aan, reden: "", filePath: knop.filePath };
    }
  }
  return leeg;
}

// Kort voor deck-status: geen bestandspad.
function publicPersonageKnopStatus(status) {
  const { filePath, ...rest } = status || {};
  return rest;
}

function buildPersonageKnopCue(runtimeState, input = {}, options = {}) {
  const status = personageKnopStatus(runtimeState, options);
  if (!status.klaar) {
    const err = new Error(status.reden || "geen_personage");
    err.statusCode = 409;
    err.code = status.reden || "geen_personage";
    err.knop = publicPersonageKnopStatus(status);
    throw err;
  }
  // Het sfeergeluid komt na het nummer terug op het niveau van de omgeving.
  let sfeerTerug = 1;
  try {
    const volume = Number(environmentExtrasStatus(runtimeState, options.environmentExtras || {}).sfeerVolume);
    if (Number.isFinite(volume)) sfeerTerug = volume;
  } catch (_err) {}
  const createdAtDate = options.createdAtDate || new Date();
  const cueId = createShowControlId("show-cue", createdAtDate);
  const payloadId = `${cueId}:payload:01`;
  return {
    schemaVersion: SHOW_CONTROL_CUE_SCHEMA_VERSION,
    cueId,
    cueType: "pulse",
    cueIntent: "personage-knop",
    name: `Nummer van ${status.characterName || status.characterId}`,
    createdAt: createdAtDate.toISOString(),
    source: { type: "show-control-v0", readOnly: false },
    runtimeRef: runtimeState ? {
      source: "runtime.activeSituation",
      showRunId: runtimeState.showRunId || null,
      runtimeUpdatedAt: runtimeState.updatedAt || null,
    } : null,
    status: { stage: "queued", state: "queued", warnings: [], sentOrder: [], updatedAt: createdAtDate.toISOString() },
    actions: [{
      actionId: `${cueId}:action:01`,
      targetId: "mac-audio",
      command: "audio.extra.play",
      ackMode: "fire-and-forget",
      delayMs: 0,
      timeoutMs: 1500,
      parallelGroup: null,
      required: false,
      payloadId,
      payload: {
        characterId: status.characterId,
        characterName: status.characterName,
        label: status.label,
        source: String(input.source || "streamdeck"),
        cueIntent: "personage_knop",
        filePath: status.filePath,
        volume: status.volume,
        // Aan/uit, op het spoor van het extra geluid: een extra geluid dat speelt maakt plaats.
        wissel: true,
        ...(status.lus ? { lus: true } : {}),
        // Het andere geluid van de scène gaat weg: de geluiden van fases en stappen stoppen,
        // het sfeergeluid in TouchDesigner gaat naar nul zolang het nummer speelt.
        // Zonder overgang is het een harde cut: meteen aan en meteen uit, geen fade.
        ...(status.overgang ? {} : { hard: true }),
        // Met "over" in knop.json blijft alles staan en klinkt het nummer eroverheen.
        ...(status.over ? {} : { stopAnder: true, dempSfeer: { terug: sfeerTerug } }),
        // Het andere geluid zakt in deze tijd weg en het nummer komt in dezelfde tijd op.
        ...(status.overgang ? { overgang: status.overgang } : {}),
      },
      transport: { type: "http-or-internal" },
      simulate: null,
      status: { stage: "queued", state: "queued", message: null, updatedAt: null },
    }],
  };
}

module.exports = {
  buildPersonageKnopCue,
  personageKnopStatus,
  publicPersonageKnopStatus,
};
