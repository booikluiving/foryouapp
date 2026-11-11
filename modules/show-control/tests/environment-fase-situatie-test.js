"use strict";

// Een fase die bij een situatie hoort: speelt die situatie, dan gaan het beeld en de voorgrond
// van die fase naar TouchDesigner. Leest niets van schijf en vuurt niets af.

const assert = require("node:assert/strict");
const { resolvedEnvironmentAssets } = require("../cue-library/environment-assets");
const { environmentFasesStatus } = require("../cue-library/environment-fases");

const ENV = "environment:14";
function asset(id, type, role, tags = []) {
  return { id, environmentId: ENV, type, role, status: "present", filename: `${id}.png`, relativePath: `environments/environment_14/${type}/${id}.png`, tags };
}
const mediaAssets = [
  asset("bg", "background", "background"),
  asset("fase-dam", "extra", "extraShot", ["fase"]),
  asset("output", "fx", "fxImage", ["rendered-output", "td-output"]),
  asset("output-dam", "fx", "fxImage", ["fase-output", "fase-output-2"]),
];
const composition = {
  environmentId: ENV,
  backgroundLayer: { assetId: "bg" },
  imageLayers: [],
  fases: [
    { naam: "Pisa", assetId: "", situationId: "situation:19" },
    { naam: "Anoniem slachtoffer", assetId: "fase-dam", overlayAssetId: "output-dam", situationId: "situation:49" },
  ],
};
function runtimeState(situationId, fases = composition.fases) {
  return {
    showRunId: "proef",
    showRunSnapshot: { catalog: { mediaAssets, environmentCompositions: [{ ...composition, fases }], lightingPresets: [] } },
    activeSituation: { runId: "proef", resolved: { situationId, environmentId: ENV } },
  };
}
function resolve(situationId, fases) {
  const state = runtimeState(situationId, fases);
  return resolvedEnvironmentAssets(state, state.activeSituation.resolved, { disableLiveCatalog: true });
}

// Situatie met een eigen fase: fasebeeld als achtergrond, de voorgrond van die fase als overlay.
const dam = resolve("situation:49");
assert.equal(dam.background.assetId, "fase-dam");
assert.equal(dam.background.role, "background");
assert.deepEqual(dam.fx.map((item) => item.assetId), ["output-dam"]);

// Fase zonder eigen beeld: de gewone achtergrond en de gewone output.
const pisa = resolve("situation:19");
assert.equal(pisa.background.assetId, "bg");
assert.deepEqual(pisa.fx.map((item) => item.assetId), ["output"]);

// Situatie zonder fase: alles zoals het was.
const anders = resolve("situation:73");
assert.equal(anders.background.assetId, "bg");
assert.deepEqual(anders.fx.map((item) => item.assetId), ["output"]);

// Fases die bij een situatie horen zijn geen stappen van de knop "volgende".
const catalog = { environmentCompositions: [composition], environments: [{ id: ENV }], mediaAssets };
assert.equal(environmentFasesStatus(runtimeState("situation:49"), { catalog }).reden, "geen_fases");
const stappen = [{ naam: "Rijden", assetId: "" }, { naam: "Aanrijding", assetId: "fase-dam" }];
const metStappen = environmentFasesStatus(runtimeState("situation:1", stappen), {
  catalog: { ...catalog, environmentCompositions: [{ ...composition, fases: stappen }] },
  fileExists: () => true,
});
assert.equal(metStappen.klaar, true);
assert.equal(metStappen.fases.length, 2);

console.log("environment-fase-situatie-test ok");
