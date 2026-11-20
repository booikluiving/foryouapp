"use strict";

// Zaaloordeel van de operator of de spelers: telt mee in de score van een scène (gewicht zaal, standaard 1),
// ook als er niemand stemt; komt het tijdens de scène binnen, dan wacht het op de observatie.
// Draai: node modules/algorithm/tests/zaal-oordeel-test.js (eigen tijdelijke map, geen showdata).
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

// Binnen de app (dat eist het algoritme), in de tijdelijke map; wordt achteraf opgeruimd.
const MAP = path.join(__dirname, "..", "db", ".tmp", `zaal-oordeel-${Date.now()}`);
fs.mkdirSync(MAP, { recursive: true });
process.env.ALGORITHM_DB_DIR = MAP;
process.on("exit", () => { try { fs.rmSync(MAP, { recursive: true, force: true }); } catch (_err) {} });
const { scoreOnderdelen, defaultAlgorithmConfig, normalizeAlgorithmConfig } = require("../scoring/score-engine");
const service = require("../scoring/algorithm-service");

// Alleen de zaal: +1 × gewicht 1.
let delen = scoreOnderdelen({ zaalOordeel: { waarde: 1 } }, defaultAlgorithmConfig());
assert.equal(delen.zaalOordeel, 1);
assert.equal(delen.punten.zaal, 1);
assert.equal(delen.totaal, 1);
// Met het publiek: oordeel 0,5 × 3 + zaal −0,5 × 1 = 1.
delen = scoreOnderdelen({ zaalOordeel: { waarde: -0.5 }, oordeel: { gemiddelde: 0.5, stemmen: 10 } }, defaultAlgorithmConfig());
assert.equal(delen.totaal, 1);
// Geen zaaloordeel: niets.
assert.equal(scoreOnderdelen({}, defaultAlgorithmConfig()).punten.zaal, 0);
// Gewicht instelbaar, standaard 1 ook voor een bewaarde instelling zonder zaal.
assert.equal(normalizeAlgorithmConfig({ weights: { oordeel: 3 } }).weights.zaal, 1);
assert.equal(scoreOnderdelen({ zaalOordeel: { waarde: 1 } }, normalizeAlgorithmConfig({ weights: { zaal: 0.5 } })).totaal, 0.5);

(async () => {
  const catalog = { situations: [{ id: "situation:1", legacyId: 1, title: "Een", active: true, labelIds: [], characterIds: [] }], labels: [], characters: [] };
  await service.createScoringContext({ showRunId: "show-run-20261120-120000000Z", catalog, config: defaultAlgorithmConfig() });
  // Tijdens de scène: wacht.
  let uit = await service.observeZaalOordeel({ showRunId: "show-run-20261120-120000000Z", situationRunId: "sr-1", waarde: 1, bron: "deck" });
  assert.equal(uit.ok, true);
  assert.equal(uit.wacht, true);
  // De scène stopt: de observatie neemt het zaaloordeel mee.
  const obs = await service.observeSituation({
    type: "situationObserved", showRunId: "show-run-20261120-120000000Z", situationRunId: "sr-1", situationId: "situation:1",
    startedAt: new Date(Date.now() - 60000).toISOString(), endedAt: new Date().toISOString(), durationSeconds: 60,
  });
  assert.equal(obs.observation.zaalOordeel.waarde, 1);
  assert.equal(obs.observation.observedScore, 1);
  // Daarna nog bijstellen (applausmeter): het laatste telt.
  uit = await service.observeZaalOordeel({ showRunId: "show-run-20261120-120000000Z", situationRunId: "sr-1", waarde: 0.5, bron: "telefoon" });
  assert.equal(uit.wacht, false);
  assert.equal(uit.observedScore, 0.5);
  // Zonder scène of waarde: geweigerd.
  assert.equal((await service.observeZaalOordeel({ showRunId: "show-run-20261120-120000000Z", waarde: 1 })).ok, false);
  process.stdout.write("zaal-oordeel-test: ok\n");
})().catch((err) => { console.error(err); process.exit(1); });
