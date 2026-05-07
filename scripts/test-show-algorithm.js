#!/usr/bin/env node
"use strict";

const assert = require("assert");
const {
  buildAlgorithmOrder,
  buildSceneWarnings,
  calculateRunScore,
  composeScenePrompt,
  normalizeScene,
  pickRecommendation,
  validateSceneLinks,
} = require("../lib/show-algorithm");

function testScoreFormula() {
  assert.strictEqual(
    calculateRunScore({ heartCount: 10, boredCount: 2, commentCount: 4 }),
    8
  );
}

function testCalibrationFixedOrder() {
  const scenes = [
    { id: 1, title: "Een", sortOrder: 1, isActive: true },
    { id: 2, title: "Twee", sortOrder: 2, isActive: true },
  ];
  const result = pickRecommendation({
    scenes,
    runs: [{ id: 1, sceneId: 1, runOrder: 1, endedAt: "2026-01-01T00:00:00.000Z", heartCount: 1 }],
    settings: { calibrationCount: 5 },
  });
  assert.strictEqual(result.calibration.active, true);
  assert.strictEqual(result.scene.id, 2);
}

function testRecommendationSkipsLastScene() {
  const scenes = [
    { id: 1, title: "Peter solo", sortOrder: 1, characterIds: [1], situationIds: [1], isActive: true },
    { id: 2, title: "Peter terug", sortOrder: 2, characterIds: [1], situationIds: [1], isActive: true },
  ];
  const runs = [
    { id: 1, sceneId: 1, runOrder: 1, endedAt: "2026-01-01T00:00:00.000Z", heartCount: 12, boredCount: 0, score: 12 },
    { id: 2, sceneId: 2, runOrder: 2, endedAt: "2026-01-01T00:01:00.000Z", heartCount: 2, boredCount: 0, score: 2 },
  ];
  const result = pickRecommendation({ scenes, runs, settings: { calibrationCount: 1 } });
  assert.strictEqual(result.calibration.active, false);
  assert.notStrictEqual(result.scene.id, 2);
}

function testCurrentOrderKeepsCalibrationFixed() {
  const scenes = Array.from({ length: 6 }, (_, index) => ({
    id: index + 1,
    title: `Situatie ${index + 1}`,
    sortOrder: index + 1,
    isActive: true,
  }));
  const order = buildAlgorithmOrder({
    scenes,
    runs: [{ id: 1, sceneId: 1, runOrder: 1, endedAt: "2026-01-01T00:00:00.000Z", score: 1 }],
    settings: { calibrationCount: 5 },
  });
  assert.deepStrictEqual(order.calibrationScenes.map((entry) => entry.sceneId), [1, 2, 3, 4, 5]);
  assert.strictEqual(order.calibration.active, true);
  assert.strictEqual(order.next.sceneId, 2);
  assert.deepStrictEqual(order.upcoming.map((entry) => entry.sceneId), [6]);
}

function testCurrentOrderRowsStartAtFirstAfterReset() {
  const scenes = [
    { id: 1, title: "Een", sortOrder: 1, isActive: true },
    { id: 2, title: "Twee", sortOrder: 2, isActive: true },
    { id: 3, title: "Drie", sortOrder: 3, isActive: true },
  ];
  const order = buildAlgorithmOrder({ scenes, runs: [], settings: { calibrationCount: 2 } });
  assert.deepStrictEqual(order.rows.map((entry) => entry.sceneId), [1, 2, 3]);
  assert.strictEqual(order.next.sceneId, 1);
  assert.strictEqual(order.rows[0].next, true);
  assert.strictEqual(order.rows[0].active, false);
  assert.strictEqual(order.rows.filter((entry) => entry.next).length, 1);
}

function testCurrentOrderRowsMarkActiveWithoutNext() {
  const scenes = [
    { id: 1, title: "Een", sortOrder: 1, isActive: true },
    { id: 2, title: "Twee", sortOrder: 2, isActive: true },
  ];
  const runs = [{ id: 1, sceneId: 1, runOrder: 1, startedAt: "2026-01-01T00:00:00.000Z" }];
  const order = buildAlgorithmOrder({ scenes, runs, settings: { calibrationCount: 2 } });
  assert.strictEqual(order.next, null);
  assert.strictEqual(order.rows[0].active, true);
  assert.strictEqual(order.rows[0].next, false);
  assert.strictEqual(order.rows.filter((entry) => entry.active).length, 1);
  assert.strictEqual(order.rows.filter((entry) => entry.next).length, 0);
}

function testCurrentOrderRowsAdvanceAfterStop() {
  const scenes = [
    { id: 1, title: "Een", sortOrder: 1, isActive: true },
    { id: 2, title: "Twee", sortOrder: 2, isActive: true },
    { id: 3, title: "Drie", sortOrder: 3, isActive: true },
  ];
  const runs = [{ id: 1, sceneId: 1, runOrder: 1, endedAt: "2026-01-01T00:00:00.000Z", score: 1 }];
  const order = buildAlgorithmOrder({ scenes, runs, settings: { calibrationCount: 2 } });
  assert.strictEqual(order.rows[0].played, true);
  assert.strictEqual(order.rows[1].next, true);
  assert.strictEqual(order.next.sceneId, 2);
}

function testCurrentOrderRowsKeepActiveAfterCalibration() {
  const scenes = [
    { id: 1, title: "Calibratie", sortOrder: 1, characterIds: [1], isActive: true },
    { id: 2, title: "Actief later", sortOrder: 2, characterIds: [1], isActive: true },
    { id: 3, title: "Nog later", sortOrder: 3, characterIds: [2], isActive: true },
  ];
  const runs = [
    { id: 1, sceneId: 1, runOrder: 1, endedAt: "2026-01-01T00:00:00.000Z", score: 10 },
    { id: 2, sceneId: 2, runOrder: 2, startedAt: "2026-01-01T00:01:00.000Z" },
  ];
  const order = buildAlgorithmOrder({ scenes, runs, settings: { calibrationCount: 1 } });
  const activeRow = order.rows.find((entry) => entry.sceneId === 2);
  assert(activeRow);
  assert.strictEqual(activeRow.active, true);
  assert.strictEqual(order.next, null);
  assert.strictEqual(order.rows.filter((entry) => entry.next).length, 0);
}

function testRecommendationMatchesCurrentOrderNext() {
  const scenes = [
    { id: 1, title: "Calibratie", sortOrder: 1, characterIds: [1], isActive: true },
    { id: 2, title: "Peter later", sortOrder: 2, characterIds: [1], isActive: true },
    { id: 3, title: "Penelope later", sortOrder: 3, characterIds: [2], isActive: true },
  ];
  const runs = [{ id: 1, sceneId: 1, runOrder: 1, endedAt: "2026-01-01T00:00:00.000Z", score: 12 }];
  const settings = { calibrationCount: 1 };
  const order = buildAlgorithmOrder({ scenes, runs, settings });
  const recommendation = pickRecommendation({ scenes, runs, settings, order });
  assert.strictEqual(recommendation.scene.id, order.next.sceneId);
  assert.strictEqual(
    buildAlgorithmOrder({ scenes, runs, settings }).next.sceneId,
    order.next.sceneId
  );
}

function testCurrentOrderRanksAfterCalibration() {
  const scenes = [
    { id: 1, title: "Peter calibratie", sortOrder: 1, characterIds: [1], isActive: true },
    { id: 2, title: "Peter later", sortOrder: 2, characterIds: [1], isActive: true },
    { id: 3, title: "Penelope later", sortOrder: 3, characterIds: [2], isActive: true },
  ];
  const order = buildAlgorithmOrder({
    scenes,
    runs: [{ id: 1, sceneId: 1, runOrder: 1, endedAt: "2026-01-01T00:00:00.000Z", score: 12 }],
    settings: { calibrationCount: 1 },
  });
  assert.strictEqual(order.calibration.active, false);
  assert.strictEqual(order.upcoming[0].sceneId, 2);
  assert.strictEqual(order.next.sceneId, 2);
}

function testCurrentOrderHidesPlayedUntilCycleComplete() {
  const scenes = [
    { id: 1, title: "Een", sortOrder: 1, isActive: true },
    { id: 2, title: "Twee", sortOrder: 2, isActive: true },
    { id: 3, title: "Drie", sortOrder: 3, isActive: true },
  ];
  const order = buildAlgorithmOrder({
    scenes,
    runs: [{ id: 1, sceneId: 1, runOrder: 1, endedAt: "2026-01-01T00:00:00.000Z", score: 1 }],
    settings: { calibrationCount: 1 },
  });
  assert.deepStrictEqual(order.upcoming.map((entry) => entry.sceneId).sort(), [2, 3]);
  assert(order.hiddenPlayed.some((entry) => entry.sceneId === 1));
}

function testCurrentOrderSkipsLastWhenEverythingPlayed() {
  const scenes = [
    { id: 1, title: "Een", sortOrder: 1, isActive: true },
    { id: 2, title: "Twee", sortOrder: 2, isActive: true },
    { id: 3, title: "Drie", sortOrder: 3, isActive: true },
  ];
  const order = buildAlgorithmOrder({
    scenes,
    runs: [
      { id: 1, sceneId: 1, runOrder: 1, endedAt: "2026-01-01T00:00:00.000Z", score: 1 },
      { id: 2, sceneId: 2, runOrder: 2, endedAt: "2026-01-01T00:01:00.000Z", score: 1 },
      { id: 3, sceneId: 3, runOrder: 3, endedAt: "2026-01-01T00:02:00.000Z", score: 1 },
    ],
    settings: { calibrationCount: 1 },
  });
  assert.strictEqual(order.cycleComplete, true);
  assert(order.upcoming.length > 0);
  assert.notStrictEqual(order.upcoming[0].sceneId, 3);
  assert.deepStrictEqual(order.hiddenPlayed, []);
}

function testCurrentOrderKeepsInvalidOutOfUpcoming() {
  const catalog = {
    characters: [
      { id: 1, name: "Peter", isActive: true },
      { id: 2, name: "Penelope", isActive: false },
    ],
    situations: [],
    environments: [{ id: 1, name: "Kamer", isActive: true }],
  };
  const scenes = [
    { id: 1, title: "Ok", sortOrder: 1, characterIds: [1], environmentId: 1, isActive: true },
    { id: 2, title: "Invalid", sortOrder: 2, characterIds: [2], environmentId: 1, isActive: true },
  ];
  const order = buildAlgorithmOrder({ scenes, runs: [], settings: { calibrationCount: 0 }, catalog });
  assert(order.invalid.some((entry) => entry.sceneId === 2));
  assert(!order.upcoming.some((entry) => entry.sceneId === 2));
}

function testContextSceneDefaultOff() {
  assert.strictEqual(normalizeScene({ id: 1, title: "Los" }).contextSceneId, 0);
}

function testContextSceneValidation() {
  const catalog = {
    characters: [],
    situations: [],
    environments: [],
    scenes: [
      { id: 1, title: "Context", isActive: true },
      { id: 2, title: "Vervolg", contextSceneId: 1, isActive: true },
      { id: 3, title: "Non-actief", isActive: false },
    ],
  };
  assert.strictEqual(
    validateSceneLinks({ id: 2, title: "Vervolg", contextSceneId: 1, isActive: true }, catalog).ok,
    true
  );
  const self = validateSceneLinks({ id: 2, title: "Zelf", contextSceneId: 2, isActive: true }, catalog);
  assert.strictEqual(self.ok, false);
  assert(self.issues.includes("context_scene_self"));
  const inactive = validateSceneLinks({ id: 2, title: "Mist", contextSceneId: 3, isActive: true }, catalog);
  assert.strictEqual(inactive.ok, false);
  assert(inactive.issues.includes("context_scene_inactive:3"));
  const cycle = validateSceneLinks(
    { id: 1, title: "A", contextSceneId: 2, isActive: true },
    {
      ...catalog,
      scenes: [
        { id: 1, title: "A", contextSceneId: 2, isActive: true },
        { id: 2, title: "B", contextSceneId: 1, isActive: true },
      ],
    }
  );
  assert.strictEqual(cycle.ok, false);
  assert(cycle.issues.includes("context_scene_cycle:1"));
}

function testContextSceneIsQueuedBeforeDependent() {
  const scenes = [
    { id: 1, title: "Context eerst", sortOrder: 1, characterIds: [2], isActive: true },
    { id: 2, title: "Vervolg", sortOrder: 2, characterIds: [1], contextSceneId: 1, isActive: true },
    { id: 3, title: "Smaaktest", sortOrder: 3, characterIds: [1], isActive: true },
  ];
  const runs = [{ id: 1, sceneId: 3, runOrder: 1, endedAt: "2026-01-01T00:00:00.000Z", score: 12 }];
  const catalog = { scenes, characters: [{ id: 1, name: "Peter", isActive: true }, { id: 2, name: "Penelope", isActive: true }] };
  const order = buildAlgorithmOrder({ scenes, runs, settings: { calibrationCount: 1 }, catalog });
  assert.strictEqual(order.next.sceneId, 1);
  assert.deepStrictEqual(
    order.calibrationScenes.concat(order.upcoming).slice(0, 2).map((entry) => entry.sceneId),
    [1, 2]
  );
  assert(order.blockedContext.some((entry) => entry.sceneId === 2));
  assert.deepStrictEqual(order.blockedContext.find((entry) => entry.sceneId === 2).issues, []);
}

function testContextSceneUnlocksAfterRun() {
  const scenes = [
    { id: 1, title: "Context eerst", sortOrder: 1, characterIds: [2], isActive: true },
    { id: 2, title: "Vervolg", sortOrder: 2, characterIds: [1], contextSceneId: 1, isActive: true },
    { id: 3, title: "Smaaktest", sortOrder: 3, characterIds: [1], isActive: true },
  ];
  const runs = [
    { id: 1, sceneId: 3, runOrder: 1, endedAt: "2026-01-01T00:00:00.000Z", score: 12 },
    { id: 2, sceneId: 1, runOrder: 2, endedAt: "2026-01-01T00:01:00.000Z", score: 0 },
  ];
  const catalog = { scenes, characters: [{ id: 1, name: "Peter", isActive: true }, { id: 2, name: "Penelope", isActive: true }] };
  const order = buildAlgorithmOrder({ scenes, runs, settings: { calibrationCount: 1 }, catalog });
  assert.strictEqual(order.next.sceneId, 2);
  assert(!order.blockedContext.some((entry) => entry.sceneId === 2));
}

function testContextSceneResetsWithRuns() {
  const scenes = [
    { id: 1, title: "Context eerst", sortOrder: 1, isActive: true },
    { id: 2, title: "Vervolg", sortOrder: 2, contextSceneId: 1, isActive: true },
  ];
  const order = buildAlgorithmOrder({ scenes, runs: [], settings: { calibrationCount: 0 }, catalog: { scenes } });
  assert.strictEqual(order.next.sceneId, 1);
  assert(order.blockedContext.some((entry) => entry.sceneId === 2));
}

function testContextSceneDoesNotMoveToBottomWhenAlreadyAfterContext() {
  const scenes = [
    { id: 1, title: "Context eerst", sortOrder: 1, isActive: true },
    { id: 2, title: "Vervolg", sortOrder: 2, contextSceneId: 1, isActive: true },
    { id: 3, title: "Andere situatie", sortOrder: 3, isActive: true },
  ];
  const order = buildAlgorithmOrder({ scenes, runs: [], settings: { calibrationCount: 0 }, catalog: { scenes } });
  assert.deepStrictEqual(order.upcoming.map((entry) => entry.sceneId), [1, 2, 3]);
  assert.strictEqual(order.upcoming[1].blocked, true);
  assert.deepStrictEqual(order.upcoming[1].issues, []);
}

function testSceneLinkValidation() {
  const catalog = {
    characters: [
      { id: 1, name: "Peter", isActive: true },
      { id: 2, name: "Penelope", isActive: true },
    ],
    situations: [
      {
        id: 1,
        name: "Slaapkamer",
        requiredCharacterIds: [1],
        allowedCharacterIds: [1, 2],
        isActive: true,
      },
    ],
    environments: [{ id: 1, name: "Kamer", isActive: true }],
  };
  assert.strictEqual(
    validateSceneLinks(
      { id: 1, title: "Ok", characterIds: [1, 2], situationIds: [1], environmentId: 1 },
      catalog
    ).ok,
    true
  );
  const invalid = validateSceneLinks(
    { id: 2, title: "Mist", characterIds: [2], situationIds: [1], environmentId: 1 },
    catalog
  );
  assert.strictEqual(invalid.ok, false);
  assert(invalid.issues.includes("required_character_missing:1"));
  const duplicate = validateSceneLinks(
    { id: 3, title: "Dubbel", characterCount: 2, characterSlots: [1, 1], characterIds: [1], environmentId: 1 },
    catalog
  );
  assert.strictEqual(duplicate.ok, false);
  assert(duplicate.issues.includes("character_duplicate:1"));
  const multipleRandom = validateSceneLinks(
    { id: 4, title: "Randoms", characterCount: 3, characterSlots: [0, 0, 0], characterIds: [], environmentMode: "random" },
    catalog
  );
  assert.strictEqual(multipleRandom.ok, true);
  const inactiveLinks = validateSceneLinks(
    {
      id: 5,
      title: "Non-actief",
      characterCount: 1,
      characterSlots: [3],
      characterIds: [3],
      environmentId: 2,
      environmentMode: "selected",
    },
    {
      ...catalog,
      characters: catalog.characters.concat([{ id: 3, name: "Simone", isActive: false }]),
      environments: catalog.environments.concat([{ id: 2, name: "Gang", isActive: false }]),
    }
  );
  assert.strictEqual(inactiveLinks.ok, false);
  assert(inactiveLinks.issues.includes("character_inactive:3"));
  assert(inactiveLinks.issues.includes("environment_inactive:2"));
}

function testCastWarningsIgnoreFlexibleCharacters() {
  const warnings = buildSceneWarnings(
    { id: 1, title: "Flexibel", characterCount: 2, characterSlots: [1, 2], characterIds: [1, 2] },
    {
      characters: [
        { id: 1, name: "Anne-Fleur", performerId: 0, isActive: true },
        { id: 2, name: "Boer", performerId: 0, isActive: true },
      ],
      performers: [{ id: 1, name: "Megan", isActive: true }],
    }
  );
  assert.deepStrictEqual(warnings, []);
}

function testCastWarningsDetectSamePerformer() {
  const warnings = buildSceneWarnings(
    { id: 1, title: "Dubbel", characterCount: 2, characterSlots: [1, 2], characterIds: [1, 2] },
    {
      characters: [
        { id: 1, name: "Anne-Fleur", performerId: 1, isActive: true },
        { id: 2, name: "Lisa", performerId: 1, isActive: true },
      ],
      performers: [{ id: 1, name: "Megan", isActive: true }],
    }
  );
  assert.deepStrictEqual(warnings, ["performer_conflict:1:1,2"]);
}

function testCastWarningsAllowDifferentPerformers() {
  const warnings = buildSceneWarnings(
    { id: 1, title: "Geen dubbel", characterCount: 2, characterSlots: [1, 2], characterIds: [1, 2] },
    {
      characters: [
        { id: 1, name: "Anne-Fleur", performerId: 1, isActive: true },
        { id: 2, name: "Boer", performerId: 2, isActive: true },
      ],
      performers: [
        { id: 1, name: "Megan", isActive: true },
        { id: 2, name: "Booi", isActive: true },
      ],
    }
  );
  assert.deepStrictEqual(warnings, []);
}

function testCastWarningsIgnoreRandomSlots() {
  const warnings = buildSceneWarnings(
    { id: 1, title: "Random", characterCount: 3, characterSlots: [1, 0, 2], characterIds: [1, 2] },
    {
      characters: [
        { id: 1, name: "Anne-Fleur", performerId: 1, isActive: true },
        { id: 2, name: "Lisa", performerId: 1, isActive: true },
      ],
      performers: [{ id: 1, name: "Megan", isActive: true }],
    }
  );
  assert.deepStrictEqual(warnings, ["performer_conflict:1:1,2"]);

  const onlyRandom = buildSceneWarnings(
    { id: 2, title: "Random alleen", characterCount: 2, characterSlots: [1, 0], characterIds: [1] },
    {
      characters: [{ id: 1, name: "Anne-Fleur", performerId: 1, isActive: true }],
      performers: [{ id: 1, name: "Megan", isActive: true }],
    }
  );
  assert.deepStrictEqual(onlyRandom, []);
}

function testCastWarningsDoNotBlockOrder() {
  const catalog = {
    performers: [{ id: 1, name: "Megan", isActive: true }],
    characters: [
      { id: 1, name: "Anne-Fleur", performerId: 1, isActive: true },
      { id: 2, name: "Lisa", performerId: 1, isActive: true },
    ],
    situations: [],
    environments: [],
  };
  const scenes = [
    { id: 1, title: "Dubbele rol", sortOrder: 1, characterCount: 2, characterSlots: [1, 2], characterIds: [1, 2], isActive: true },
  ];
  const order = buildAlgorithmOrder({ scenes, runs: [], settings: { calibrationCount: 0 }, catalog: { ...catalog, scenes } });
  assert.strictEqual(order.invalid.length, 0);
  assert.strictEqual(order.next.sceneId, 1);
  assert.deepStrictEqual(order.upcoming[0].warnings, ["performer_conflict:1:1,2"]);
}

function testPromptComposition() {
  const prompt = composeScenePrompt({
    scene: { id: 1, title: "De test", promptOverride: "Peter bekent iets." },
    characters: [{ id: 1, name: "Peter", description: "Peter is nerveus." }],
    situations: [{ id: 1, name: "Bekentenis", description: "Een bekentenis loopt mis." }],
    environment: { id: 1, name: "Keuken", description: "Een krappe keuken." },
    settings: { calibrationCount: 1 },
    audienceContext: "Publiekssmaak: Peter scoort hoog.",
  });
  assert(prompt.includes("Peter Peter is nerveus."));
  assert(prompt.includes("Een bekentenis loopt mis."));
  assert(prompt.includes("Locatie: Keuken"));
  assert(prompt.includes("Titel: De test"));
  assert(prompt.includes("Publiekssmaak: Peter scoort hoog."));
}

function testPromptCompositionWithRandomSlots() {
  const prompt = composeScenePrompt({
    scene: {
      id: 1,
      title: "Random bezoek",
      characterCount: 2,
      characterSlots: [1, 0],
      environmentMode: "random",
      promptOverride: "Iemand verschijnt onverwacht.",
    },
    characters: [{ id: 1, name: "Peter", description: "Peter is nerveus." }],
    settings: { calibrationCount: 1 },
  });
  assert(prompt.includes("Personage 1: Peter Peter is nerveus."));
  assert(prompt.includes("Personage 2: random personage."));
  assert(prompt.includes("Locatie: Random omgeving"));
}

function testPromptCompositionWithMultipleRandomSlots() {
  const prompt = composeScenePrompt({
    scene: {
      id: 1,
      title: "Random drietal",
      characterCount: 3,
      characterSlots: [0, 0, 0],
      environmentMode: "random",
    },
    settings: { calibrationCount: 1 },
  });
  assert(prompt.includes("Personage 1: random personage."));
  assert(prompt.includes("Personage 2: random personage."));
  assert(prompt.includes("Personage 3: random personage."));
}

testScoreFormula();
testCalibrationFixedOrder();
testRecommendationSkipsLastScene();
testCurrentOrderKeepsCalibrationFixed();
testCurrentOrderRowsStartAtFirstAfterReset();
testCurrentOrderRowsMarkActiveWithoutNext();
testCurrentOrderRowsAdvanceAfterStop();
testCurrentOrderRowsKeepActiveAfterCalibration();
testRecommendationMatchesCurrentOrderNext();
testCurrentOrderRanksAfterCalibration();
testCurrentOrderHidesPlayedUntilCycleComplete();
testCurrentOrderSkipsLastWhenEverythingPlayed();
testCurrentOrderKeepsInvalidOutOfUpcoming();
testContextSceneDefaultOff();
testContextSceneValidation();
testContextSceneIsQueuedBeforeDependent();
testContextSceneUnlocksAfterRun();
testContextSceneResetsWithRuns();
testContextSceneDoesNotMoveToBottomWhenAlreadyAfterContext();
testSceneLinkValidation();
testCastWarningsIgnoreFlexibleCharacters();
testCastWarningsDetectSamePerformer();
testCastWarningsAllowDifferentPerformers();
testCastWarningsIgnoreRandomSlots();
testCastWarningsDoNotBlockOrder();
testPromptComposition();
testPromptCompositionWithRandomSlots();
testPromptCompositionWithMultipleRandomSlots();

console.log("show-algorithm tests passed");
