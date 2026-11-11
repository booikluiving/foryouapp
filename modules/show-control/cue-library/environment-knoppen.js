"use strict";

// Omgevingsknoppen: wat het Stream Deck toont op het blok dat per omgeving verandert.
// Eén lijst, gemaakt uit wat er bij de omgeving in de beeldcatalogus staat. Elke soort heeft
// één knop "volgende": de tekst is wat er bij de volgende druk gebeurt.
// - fases: de volgende fase (Aanrijding, dan Myrthe stapt uit, ...);
// - effect omvallen: de volgende kast;
// - begin: zet alles van deze omgeving terug naar het begin.
// Een omgeving zonder iets geeft een lege lijst.

const { buildEnvironmentFaseCue, environmentFasesStatus } = require("./environment-fases");
const { buildEnvironmentOmvallenCue, environmentOmvallenStatus } = require("./environment-omvallen");

const MAX_KNOPPEN = 3;

function kort(tekst, max = 22) {
  const value = String(tekst || "").trim();
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}

function environmentKnoppenStatus(runtimeState, options = {}) {
  const fases = environmentFasesStatus(runtimeState, options.environmentFases || {});
  const omvallen = environmentOmvallenStatus(runtimeState, options.environmentOmvallen || {});
  const knoppen = [];
  let verzet = false;
  if (fases.klaar && fases.fases.length > 1) {
    const laatste = fases.actief >= fases.fases.length - 1;
    const volgende = fases.fases[(fases.actief + 1) % fases.fases.length];
    knoppen.push({
      soort: "fase",
      actie: "volgende",
      label: laatste ? "OPNIEUW" : kort(volgende.naam).toUpperCase(),
      nu: kort(fases.fases[fases.actief].naam),
      teller: `${fases.actief + 1}/${fases.fases.length}`,
      staat: laatste || volgende.klaar ? "klaar" : "uit",
    });
    verzet = verzet || fases.actief > 0;
  }
  if (omvallen.klaar) {
    const klaar = !omvallen.herhaal && omvallen.pos >= omvallen.totaal;
    knoppen.push({
      soort: "omvallen",
      actie: "volgende",
      label: klaar ? "OPNIEUW" : kort(omvallen.volgende).toUpperCase(),
      nu: "",
      teller: omvallen.herhaal ? "" : `${omvallen.pos}/${omvallen.totaal}`,
      staat: "klaar",
    });
    verzet = verzet || omvallen.pos > 0;
  }
  if (knoppen.length) knoppen.push({ soort: "begin", actie: "begin", label: "BEGIN", nu: "", teller: "", staat: verzet ? "klaar" : "uit" });
  return {
    ok: true,
    environmentId: fases.environmentId || omvallen.environmentId || "",
    knoppen: knoppen.slice(0, MAX_KNOPPEN).map((knop, plek) => ({ plek, ...knop })),
    meer: Math.max(0, knoppen.length - MAX_KNOPPEN),
    heeftFases: fases.klaar && fases.fases.length > 1,
    heeftOmvallen: omvallen.klaar,
  };
}

// Druk op omgevingsknop `plek`: bouwt de cue die erbij hoort.
function buildEnvironmentKnopCue(runtimeState, input = {}, options = {}) {
  const status = environmentKnoppenStatus(runtimeState, options);
  const knop = status.knoppen[Number(input.plek)];
  if (!knop || knop.staat === "uit") {
    const err = new Error("geen_knop");
    err.statusCode = 409;
    err.code = "geen_knop";
    err.knoppen = status;
    throw err;
  }
  const faseOptions = options.environmentFases || {};
  const omvallenOptions = options.environmentOmvallen || {};
  if (knop.soort === "fase") return buildEnvironmentFaseCue(runtimeState, { actie: "volgende", source: input.source }, faseOptions);
  if (knop.soort === "omvallen") return buildEnvironmentOmvallenCue(runtimeState, { actie: "volgende", source: input.source }, omvallenOptions);
  // begin: alles van deze omgeving terug, in één cue.
  const cues = [];
  if (status.heeftFases) cues.push(buildEnvironmentFaseCue(runtimeState, { index: 0, source: input.source }, faseOptions));
  if (status.heeftOmvallen) cues.push(buildEnvironmentOmvallenCue(runtimeState, { actie: "begin", source: input.source }, omvallenOptions));
  const cue = cues[0];
  for (const extra of cues.slice(1)) {
    for (const action of extra.actions) {
      const nummer = String(cue.actions.length + 1).padStart(2, "0");
      const payloadId = `${cue.cueId}:payload:${nummer}`;
      cue.actions.push({
        ...action,
        actionId: `${cue.cueId}:action:${nummer}`,
        payloadId,
        transport: action.transport && Array.isArray(action.transport.args)
          ? { ...action.transport, args: [cue.cueId, action.command, payloadId] }
          : action.transport,
      });
    }
  }
  cue.name = "Omgeving: begin";
  return cue;
}

module.exports = {
  MAX_KNOPPEN,
  buildEnvironmentKnopCue,
  environmentKnoppenStatus,
};
