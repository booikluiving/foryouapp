"use strict";

// AUTOCAM en CAM 1/2/3 op het deck: pauze na een handmatige camera (amber, PAUZE + seconden) en de
// camera die live staat (wit). Alleen de berekening van deck-status, zonder Companion of diensten.
//   node test/autocam-knop-test.js
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { compute } = require("../deck-status");
const { standVan } = require("../lib");

const deck = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "deck.json"), "utf8"));
const ok = (body) => ({ ok: true, status: 200, body });
function stand(autoCameraSwitch) {
  return {
    core: { d_gateway: true, d_catalog: true, d_paths: true, d_algorithm: true, d_runtime: true, d_showcontrol: true, d_audience: true, d_scriptagent: true },
    hw: new Proxy({}, { get: () => ok({}) }),
    showStatus: ok({ warnings: [] }),
    runtime: ok({ showRunId: "run-1", status: "running", activeSituation: { situationId: "situation:1" } }),
    sq5: ok({}),
    teleprompter: ok({ autoCameraSwitch }),
    stem: ok({}),
    sim: ok({}),
    ports: { 9100: true, 9101: true, 8008: true },
    tdText: "",
    regie: ok({ stand: "show", eigenaar: null }),
  };
}
const knop = (out, key) => ({ tekst: out[key].t, stand: standVan(out[key].s) });

let out = compute(deck, stand({ enabled: true, pauze: false, liveCamera: 3, liveBron: "autocam" }));
assert.deepEqual(knop(out, "autocam"), { tekst: "AUTOCAM\nAAN", stand: "aan" });
assert.equal(knop(out, "cam3").stand, "aan", "live camera is wit");
assert.equal(knop(out, "cam1").stand, "kan");
assert.equal(knop(out, "cam2").stand, "kan");
console.log("ok: autocam aan, camera 3 live");

out = compute(deck, stand({ enabled: true, pauze: true, pauzeSeconden: 25, liveCamera: 1, liveBron: "handmatig" }));
assert.deepEqual(knop(out, "autocam"), { tekst: "AUTOCAM\nPAUZE 25", stand: "loopt" }, "pauze: amber met seconden");
assert.ok(out.autocam.t.split("\n").every((regel) => regel.length <= 8), "label hooguit 8 tekens per regel");
assert.equal(knop(out, "cam1").stand, "aan", "met de hand gekozen camera is wit");
assert.equal(knop(out, "cam3").stand, "kan");
console.log("ok: pauze, camera 1 live");

out = compute(deck, stand({ enabled: false, pauze: false, liveCamera: 2 }));
assert.deepEqual(knop(out, "autocam"), { tekst: "AUTOCAM\nUIT", stand: "kan" });
assert.equal(knop(out, "cam2").stand, "aan");
console.log("ok: autocam uit, camera 2 live");

out = compute(deck, stand({ enabled: true, pauze: false, liveCamera: 0 }));
assert.ok(["cam1", "cam2", "cam3"].every((k) => knop(out, k).stand === "kan"), "geen live camera bekend: alle drie grijs");
console.log("autocam-knop-test: alles ok");
