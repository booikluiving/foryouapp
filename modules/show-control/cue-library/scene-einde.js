"use strict";

// Einde van een scène: alles wat de knoppen van die scène of omgeving hebben gestart, gaat uit.
// Dit is de ene plek daarvoor. Komt er een nieuw soort knop bij (een laag, een geluid), dan hoort
// het uitzetten hier in de lijst.
//
// Wanneer: bij het stoppen van de scène en bij RESET RUN (runtime-adapter), en als vangnet wanneer
// de scène buiten show-control om is geëindigd (sceneEindeTick, vanuit de klok van de server).
// Het starten van de volgende scène ruimt niets op: wat er tussen twee scènes is aangezet, hoort
// bij de scène die komt.
//
// TouchDesigner krijgt alleen opdrachten die het al kent (de "uit" van elk effect).

const {
  SHOW_CONTROL_CUE_SCHEMA_VERSION,
  createShowControlId,
} = require("../../../shared/contracts/show-control-v0");
const { resetHoldState } = require("./environment-extras");
const { resetFasesState } = require("./environment-fases");
const { resetOmvallenState } = require("./environment-omvallen");
const { resetHaperenState } = require("./environment-haperen");
const { beeldUitPayload } = require("./environment-beeld");
const { bordAction, resetBordState } = require("./environment-bord");

// Zo lang wacht het klaarzetten van de volgende scène na het opruimen. De fase zet in
// TouchDesigner het sfeergeluid van de omgeving terug, een fractie later; het klaarzetten zet
// daarna het sfeergeluid van de volgende omgeving. Andersom zou het oude geluid blijven staan.
const WACHT_VOOR_KLAARZETTEN_MS = 250;

let laatsteEindeOp = 0;

function tdUit(command, payload) {
  return { targetId: "touchdesigner", command, ackMode: "fire-and-forget", timeoutMs: 900, payload };
}

// De acties die alles van de scène uitzetten, in volgorde: eerst het geluid, dan het beeld.
function sceneEindeActions(input = {}) {
  const generatedBy = String(input.generatedBy || "scene-einde");
  const common = { cueIntent: "scene_einde", generatedBy, source: "scene-einde" };
  // Wat show-control zelf onthoudt (welke fase, welke stap, shot aan, haperen aan) begint opnieuw.
  resetHoldState();
  resetFasesState();
  resetOmvallenState();
  resetHaperenState();
  resetBordState();
  laatsteEindeOp = Number(input.now ?? Date.now());
  return [
    // Alle sporen: het extra geluid (ook in een lus), de geluiden van stappen en fases, de intro,
    // en het sfeergeluid van een fase dat over de omgeving heen klinkt.
    { targetId: "mac-audio", command: "audio.extra.stop", ackMode: "fire-and-forget", timeoutMs: 900, payload: { ...common } },
    // Stappen (omvallen, clips): terug naar de gewone voorgrond.
    tdUit("td.effect.omvallen", { ...common, filePath: "", uit: true, druk: 0, duur: 0 }),
    // Fase: terug naar de gewone achtergrond en het sfeergeluid van de omgeving.
    tdUit("td.effect.fase", { ...common, filePath: "", uit: true, schok: false, schokNa: 0, sfeerPath: "" }),
    // Haperen: uit voor elke speler.
    ...[1, 2, 3].map((camera) => tdUit("td.effect.haper", { ...common, camera, sterkte: 0 })),
    // Extra shot en gezamenlijk shot: weg.
    tdUit("td.extra.shot", { ...common, filePath: "", duur: 0, uit: true }),
    tdUit("td.samen.shot", { ...common, uit: true }),
    // Eén beeld met de spelers erin: weg, terug naar de gewone camera's.
    tdUit("td.samen.beeld", beeldUitPayload(common)),
    // Bord (blind ranking): weer uit.
    bordAction("begin", { ...common }),
  ];
}

// Welke scène speelt er: leeg als er geen speelt.
function sceneSleutel(runtimeState) {
  const state = runtimeState && typeof runtimeState === "object" ? runtimeState : {};
  const active = state.activeSituation;
  if (!active) return "";
  const scene = active.situationRunId || active.runId || active.startedAt || active.situationId
    || (active.resolved && active.resolved.situationId) || "scene";
  return `${state.showRunId || ""}|${scene}`;
}

// Vangnet: de klok van de server geeft hier om de paar seconden de stand van de runtime door.
// Speelde er een scène en is die weg (of is het een andere) zonder dat er net is opgeruimd, dan
// komt er een cue terug die alsnog alles uitzet. Anders null.
const gezien = { sleutel: "" };
const NET_OPGERUIMD_MS = 10000;

function sceneEindeTick(runtimeState, options = {}) {
  const now = Number(options.now ?? Date.now());
  const sleutel = sceneSleutel(runtimeState);
  const vorige = gezien.sleutel;
  gezien.sleutel = sleutel;
  if (!vorige || vorige === sleutel) return null;
  if (now - laatsteEindeOp < NET_OPGERUIMD_MS) return null;
  const createdAtDate = options.createdAtDate || new Date(now);
  const cueId = createShowControlId("show-cue", createdAtDate);
  const actions = sceneEindeActions({ generatedBy: "scene-einde-vangnet", now }).map((action, index) => {
    const nummer = String(index + 1).padStart(2, "0");
    const payloadId = `${cueId}:payload:${nummer}`;
    return {
      actionId: `${cueId}:action:${nummer}`,
      ...action,
      delayMs: 0,
      parallelGroup: null,
      required: false,
      payloadId,
      transport: action.targetId === "touchdesigner"
        ? { type: "osc-control-intent", address: "/td/cue", args: [cueId, action.command, payloadId] }
        : { type: "http-or-internal" },
      simulate: null,
      status: { stage: "queued", state: "queued", message: null, updatedAt: null },
    };
  });
  return {
    schemaVersion: SHOW_CONTROL_CUE_SCHEMA_VERSION,
    cueId,
    cueType: "pulse",
    cueIntent: "scene-einde",
    name: "Scène voorbij: alles van de scène uit",
    createdAt: createdAtDate.toISOString(),
    source: { type: "show-control-v0", readOnly: false },
    runtimeRef: runtimeState ? { showRunId: runtimeState.showRunId || null, runtimeUpdatedAt: runtimeState.updatedAt || null } : null,
    status: { stage: "queued", state: "queued", warnings: [], sentOrder: [], updatedAt: createdAtDate.toISOString() },
    actions,
  };
}

function resetSceneEindeState() {
  gezien.sleutel = "";
  laatsteEindeOp = 0;
}

module.exports = {
  WACHT_VOOR_KLAARZETTEN_MS,
  resetSceneEindeState,
  sceneEindeActions,
  sceneEindeTick,
  sceneSleutel,
};
