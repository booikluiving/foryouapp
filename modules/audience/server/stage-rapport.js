"use strict";

// Het rapportvenster op het zaalscherm: wat er na één scène te zien is. De cijfers komen uit het
// publieksrapport van het algoritme; welke scène hierna komt, komt van de runtime.

function round(value, digits = 1) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 0;
  const factor = 10 ** digits;
  return Math.round(number * factor) / factor;
}

function bouwStageRapport(report, view, situationRunId) {
  const scenes = report && Array.isArray(report.scenes) ? report.scenes : [];
  const scene = situationRunId
    ? scenes.find((item) => item.situationRunId === situationRunId)
    : scenes[scenes.length - 1];
  // Het algoritme heeft deze scène nog niet verwerkt: het scherm vraagt het straks opnieuw.
  if (!scene) return { ok: true, klaar: false };
  const weights = report.weights || {};
  const calculation = scene.calculation || {};
  const sound = scene.roomSound && Array.isArray(scene.roomSound.samples) && scene.roomSound.samples.length ? scene.roomSound : null;
  const labelsNu = new Set(scene.labels || []);

  // Tijdens de startscènes kiest het publiek: dan staat er geen volgende scène in het rapport.
  const startfase = !!(view && view.startPhase && view.startPhase.active);
  const prepared = view && view.preparedNext;
  let hierna = null;
  if (!startfase && prepared && prepared.situationId) {
    const verwacht = report.forecast && report.forecast.bySituation ? report.forecast.bySituation[prepared.situationId] : null;
    hierna = { titel: prepared.title || prepared.situationId, score: verwacht == null ? null : round(verwacht) };
  }

  return {
    ok: true,
    klaar: true,
    scene: {
      nr: scene.nr,
      situationRunId: scene.situationRunId,
      titel: scene.title,
      seconden: scene.durationSeconds,
      kijkers: scene.viewers,
      hartjes: scene.hearts,
      verveeld: scene.bored,
      berichten: scene.messages,
      score: round(scene.score),
      geluid: sound ? {
        rustDb: round(sound.averageDb),
        piekDb: round(sound.peakDb),
        liftDb: round(sound.liftDb),
        golf: sound.samples.slice(0, 120),
      } : null,
    },
    som: {
      ruw: round(calculation.raw),
      geluid: round(calculation.roomSound),
      duur: round(calculation.durationFactor, 2),
      publiek: round(calculation.audienceFactor, 2),
      wHart: Number(weights.heart ?? 1),
      wVerveeld: Number(weights.bored ?? -1),
      wBericht: Number(weights.message ?? 0.05),
      wGeluid: Number(weights.roomSound ?? 0),
    },
    labels: (report.labels || []).map((label) => ({
      naam: String(label.name || "").toLowerCase(),
      score: round(label.averageScore),
      nu: labelsNu.has(label.name),
    })),
    hierna,
  };
}

module.exports = { bouwStageRapport };
