"use strict";

// Bewaker: controleert om de paar seconden of TouchDesigner en de teleprompter dezelfde stand hebben
// als de runtime, en herstelt het als dat niet zo is. Wat hij vindt en doet, staat op de regiepagina.
//
// Fase in TouchDesigner (0 inloop, 1 loading, 2 scène):
//   - speelt er een scène, dan 2;
//   - speelt er niets: de fase die show control het laatst tussen de scènes zette (inloop of loading);
//     was dat 2 (scène net voorbij) of onbekend: loading als er al gespeeld is, anders inloop;
//   - geen lopende run: inloop.
//   Een fase telt pas als TouchDesigner hem bevestigd heeft. Zonder bevestiging stuurt de bewaker hem
//   opnieuw (elke OPNIEUW_MS, zolang TouchDesigner niet antwoordt).
// Herstart van TouchDesigner: de TD-waakhond schrijft welke show-TD er draait (pid). Is dat een andere
//   dan eerst, dan zet de bewaker de fase en de omgeving (spelende of klaargezette scène) opnieuw.
// Teleprompter: staat er tussen de scènes een andere scène klaar dan in de runtime (bijvoorbeeld na een
//   herstart van de script-agent), dan zet de bewaker die van de runtime opnieuw klaar. Pas bij twee
//   keer achter elkaar, zodat een wissel die net bezig is niet wordt ingehaald.

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const OPNIEUW_MS = 10000;
const MAX_MELDINGEN = 12;

function nummer(waarde) {
  return Number((String(waarde || "").match(/(\d+)$/) || [])[1] || 0);
}

function standaardTdPad() {
  return process.env.FORYOU_TD_SHOW_STAND || path.join(os.homedir(), "Library", "Application Support", "ForYouApp", "td-show.json");
}

function createBewaker(options = {}) {
  const nu = options.now || (() => Date.now());
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  const scriptAgentUrl = String(options.scriptAgentUrl || process.env.SHOW_CONTROL_SCRIPT_AGENT_URL || "http://127.0.0.1:3027").replace(/\/+$/, "");
  const tdPad = options.tdPad || standaardTdPad();
  const cues = options.cues;
  const opnieuwMs = Number(options.opnieuwMs || OPNIEUW_MS);

  const stand = {
    fase: null,              // fase die TouchDesigner het laatst bevestigde
    faseOnbevestigd: null,   // gestuurd, nog geen bevestiging
    laatstGestuurd: 0,
    tdPid: undefined,        // undefined = nog niet gelezen
    td: { reageert: null, sinds: null },
    faseVerschil: 0,
    teleprompterVerschil: 0,
    meldingen: [],
  };

  function meld(tekst, herstel = "") {
    const vorige = stand.meldingen[0];
    if (vorige && vorige.tekst === tekst && nu() - Date.parse(vorige.at) < 120000) {
      vorige.keer += 1;
      vorige.herstel = herstel || vorige.herstel;
      return;
    }
    stand.meldingen.unshift({ at: new Date(nu()).toISOString(), tekst, herstel, keer: 1 });
    stand.meldingen = stand.meldingen.slice(0, MAX_MELDINGEN);
  }

  function zetTd(reageert) {
    if (stand.td.reageert !== reageert) stand.td.sinds = new Date(nu()).toISOString();
    stand.td.reageert = reageert;
  }

  // Elke opgeslagen cue van show control die de fase zet, telt (deck INLOOP/LOADING, start, stop,
  // reset, regie). Alleen met bevestiging van TouchDesigner.
  function zagCue(cue) {
    for (const action of (cue && cue.actions) || []) {
      if (action.command !== "td.phase.set") continue;
      const fase = Number(action.payload && action.payload.phase);
      if (!Number.isInteger(fase)) continue;
      const state = action.status && action.status.state;
      if (state === "ok") {
        stand.fase = fase;
        stand.faseOnbevestigd = null;
        zetTd(true);
      } else if (state === "warning" || state === "failed") {
        stand.fase = null;
        stand.faseOnbevestigd = fase;
        zetTd(false);
      }
    }
  }

  function gewensteFase(state) {
    if (!state || !state.showRunId || state.status !== "running") return 0;
    if (state.activeSituation) return 2;
    const laatste = stand.fase !== null ? stand.fase : stand.faseOnbevestigd;
    if (laatste === 0 || laatste === 1) return laatste;
    return (state.playedSituations || []).length ? 1 : 0;
  }

  function leesTdPid() {
    try {
      const data = JSON.parse(fs.readFileSync(tdPad, "utf8"));
      return data && data.pid ? Number(data.pid) : null;
    } catch (_err) {
      return null;
    }
  }

  async function teleprompterNu() {
    try {
      const antwoord = await fetchImpl(`${scriptAgentUrl}/v0/script-agent/teleprompter-parser/current`, { signal: AbortSignal.timeout(1500) });
      if (!antwoord.ok) return null;
      return await antwoord.json();
    } catch (_err) {
      return null;
    }
  }

  async function stuurFase(fase, reden) {
    stand.laatstGestuurd = nu();
    const cue = cues.buildPhaseCue({ name: `Bewaker: ${reden}`, phase: fase, phaseName: ["inloop", "loading", "situation"][fase] || `phase-${fase}` });
    await cues.executeCue(cue, {});
    const actie = (cue.actions || [])[0] || {};
    const ok = actie.status && actie.status.state === "ok";
    // Alleen bewaren als het lukte: een TouchDesigner die niet antwoordt, vult anders de cuelijst.
    if (ok) await cues.saveCue(cue);
    else zagCue(cue);
    return ok;
  }

  async function zetOmgevingOpnieuw(state) {
    if (state.activeSituation && state.activeSituation.resolved) {
      const go = cues.buildGoCue(state);
      await cues.executeCue(go, { runtimeState: state, nonBlocking: true });
      await cues.saveCue(go);
      return "spelende scène";
    }
    if (state.resolvedPreparedNext && state.status === "running") {
      const klaar = cues.buildPrepareCue(state);
      await cues.executeCue(klaar, { runtimeState: state });
      await cues.saveCue(klaar);
      return "klaargezette scène";
    }
    return "";
  }

  // Eén ronde. state = de runtime van nu. Draait binnen het slot van de regie.
  async function ronde(state) {
    if (!state) return status();
    const gewenst = gewensteFase(state);

    // Herstart van TouchDesigner (andere pid van de show-TD).
    const pid = leesTdPid();
    const vorigePid = stand.tdPid;
    stand.tdPid = pid;
    if (vorigePid !== undefined && pid && pid !== vorigePid) {
      const ok = await stuurFase(gewenst, `TouchDesigner herstart, fase ${gewenst}`);
      let omgeving = "";
      try {
        omgeving = await zetOmgevingOpnieuw(state);
      } catch (_err) {
        omgeving = "omgeving mislukt";
      }
      meld("TouchDesigner is herstart", `${ok ? `fase ${gewenst} gezet` : "fase gestuurd, geen antwoord"}${omgeving ? `, ${omgeving} opnieuw` : ""}`);
      return status();
    }
    if (vorigePid !== undefined && !pid && vorigePid) meld("Er draait geen show-TD", "wacht op de TD-waakhond");

    // Fase wijkt af, of is nog niet bevestigd. Pas ingrijpen als het twee rondes achter elkaar zo is:
    // een gewone wissel (RESET RUN en daarna INLOOP van de deck) is dan al rond.
    if (stand.fase !== gewenst) stand.faseVerschil += 1;
    else stand.faseVerschil = 0;
    if (stand.fase !== gewenst && stand.faseVerschil >= 2) {
      const onbevestigd = stand.faseOnbevestigd === gewenst;
      if (!onbevestigd || nu() - stand.laatstGestuurd >= opnieuwMs) {
        stand.faseVerschil = 0;
        const was = stand.fase;
        const ok = await stuurFase(gewenst, `fase ${gewenst} herstellen`);
        if (was !== null || onbevestigd) {
          meld(
            onbevestigd ? `TouchDesigner bevestigde fase ${gewenst} niet` : `TouchDesigner stond op fase ${was}, hoort ${gewenst}`,
            ok ? "fase opnieuw gezet" : "opnieuw gestuurd, geen antwoord"
          );
        }
      }
    }

    // Teleprompter tussen de scènes: dezelfde klaargezette scène als de runtime?
    if (!state.activeSituation && state.status === "running" && state.resolvedPreparedNext) {
      const tele = await teleprompterNu();
      const klaar = tele && tele.preparedScene ? nummer(tele.preparedScene.sceneId) : 0;
      const hoort = nummer(state.resolvedPreparedNext.legacySituationId || state.resolvedPreparedNext.situationId);
      if (tele && hoort && klaar !== hoort) {
        stand.teleprompterVerschil += 1;
        if (stand.teleprompterVerschil >= 2) {
          stand.teleprompterVerschil = 0;
          const cue = cues.buildPrepareCue(state);
          await cues.executeCue(cue, { runtimeState: state });
          await cues.saveCue(cue);
          meld(`Teleprompter had ${klaar ? `scène ${klaar}` : "geen scène"} klaar, de runtime ${hoort}`, "opnieuw klaargezet");
        }
      } else {
        stand.teleprompterVerschil = 0;
      }
    } else {
      stand.teleprompterVerschil = 0;
    }
    return status();
  }

  function status() {
    return {
      td: { ...stand.td, pid: stand.tdPid || null },
      fase: stand.fase,
      meldingen: stand.meldingen.slice(),
    };
  }

  return { gewensteFase, ronde, status, zagCue };
}

module.exports = { OPNIEUW_MS, createBewaker };
