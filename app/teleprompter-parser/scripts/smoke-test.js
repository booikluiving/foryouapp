"use strict";

const assert = require("assert");
const { parseTeleprompt } = require("../src/domain/parse-teleprompt");
const { createTelepromptStore } = require("../src/runtime/teleprompt-store");
const {
  buildAutoCameraReactionShotPlan,
  firstDialogueCue,
  resolveAutoCameraSwitch,
  shouldEndSceneFromCueAdvance,
} = require("../src/integration/express-router");

function parse(rawText, title = "") {
  return parseTeleprompt({ title, rawText, source: "test" });
}

{
  const result = parse("Emma: Hallo daar. Hoe gaat het?\nLotte: Goed!");
  assert.strictEqual(result.title, "Teleprompt");
  assert.strictEqual(result.characters.length, 2);
  assert.strictEqual(result.lines.length, 3);
  assert.strictEqual(result.lines[0].speakerLabel, "Emma");
  assert.strictEqual(result.lines[1].text, "Hoe gaat het?");
}

{
  const result = parse("# volwassen niet zo happymeal\nEmma: Mijn moeder zegt dat Mac Donalds niet gezond is, maar ik vind de nuggetjes zooo lekker!");
  assert.strictEqual(result.title, "volwassen niet zo happymeal");
  assert.strictEqual(result.lines.length, 1);
  assert.strictEqual(result.lines[0].type, "dialogue");
}

{
  const result = parse("Mark moet kinderziekenhuis opblazen na verlies monopoly\nMark: Oké, oké.\nSam: Mark, je staat rood.");
  assert.strictEqual(result.title, "Mark moet kinderziekenhuis opblazen na verlies monopoly");
  assert.strictEqual(result.lines.length, 2);
  assert.strictEqual(result.lines[0].type, "dialogue");
}

{
  const result = parse("*Emma kijkt naar Lotte.*\nRegie: Ze wachten even.\nLosse regel");
  assert.strictEqual(result.lines.length, 3);
  assert.deepStrictEqual(result.lines.map((line) => line.type), ["stage_direction", "stage_direction", "stage_direction"]);
  assert.strictEqual(result.lines[0].text, "Emma kijkt naar Lotte.");
}

{
  const result = parse("A: een.\nB: twee.\nC: drie.");
  assert.strictEqual(result.characters.length, 3);
  assert.strictEqual(result.characters[2].id, "character_3");
}

{
  const store = createTelepromptStore();
  store.ingest({
    rawText: "Emma: Eerste zin.\n*Ze zwaait.*\nLotte: Tweede zin.",
    source: "test",
  });
  assert.strictEqual(store.getCue().index, 0);
  assert.strictEqual(store.getCue().deckLength, 5);
  assert.strictEqual(store.setCueIndex(99).cue.index, 4);
  assert.strictEqual(store.setCueIndex(-10).cue.index, 0);
  assert.strictEqual(store.getCaptionStyle().fontSizeScale, 1);
  assert.strictEqual(store.setCaptionStyle({ fontSizeScale: 0.7, verticalPosition: 72 }).captionStyle.fontSizeScale, 0.7);
  assert.strictEqual(store.getCaptionStyle().verticalPosition, 72);
  assert.strictEqual(store.setCaptionStyle({ fontSizeScale: 99, widthPercent: 2 }).captionStyle.fontSizeScale, 1.25);
  assert.strictEqual(store.getCaptionStyle().widthPercent, 56);
  store.ingest({
    rawText: "Solo: Nieuwe zin.",
    source: "test",
  });
  assert.strictEqual(store.getCue().index, 0);
  assert.strictEqual(store.getCue().deckLength, 3);
}

{
  const store = createTelepromptStore({
    captionStyle: {
      fontSizeScale: 0.85,
      verticalPosition: 71,
      widthPercent: 78,
      outlineScale: 1.15,
    },
  });
  assert.strictEqual(store.getCaptionStyle().fontSizeScale, 0.85);
  assert.strictEqual(store.getCaptionStyle().verticalPosition, 71);
  assert.strictEqual(store.getCaptionStyle().widthPercent, 78);
  assert.strictEqual(store.getCaptionStyle().outlineScale, 1.15);
}

{
  const store = createTelepromptStore();
  store.prepareScene({
    sceneId: 3,
    title: "Camera test",
    environment: {
      id: 7,
      name: "Supermarkt",
      description: "Is een supermarkt.",
      imageUrl: "/api/teleprompter-parser/environment-assets/file/Supermarkt.jpg",
    },
    characterSlots: [
      { slot: 1, mode: "selected", id: 18, name: "Mark" },
      { slot: 2, mode: "selected", id: 49, name: "Sam" },
      { slot: 3, mode: "selected", id: 22, name: "Anne-Fleur" },
    ],
  });
  assert.deepStrictEqual(
    store.getPreparedScene().characters.map((character) => [character.name, character.slot]),
    [["Mark", 1], ["Sam", 2], ["Anne-Fleur", 3]]
  );
  assert.deepStrictEqual(store.getPreparedScene().environment, {
    id: 7,
    name: "Supermarkt",
    description: "Is een supermarkt.",
    imageUrl: "/api/teleprompter-parser/environment-assets/file/Supermarkt.jpg",
  });

  store.ingest({
    sceneId: 3,
    rawText: "Mark: Eerste zin.\nSam: Tweede zin.\nRegie: Stilte.\nAnne Fleur: Derde zin.",
    source: "test",
  });
  store.revealPreparedScene();
  assert.strictEqual(store.getPreparedScene().environment.name, "Supermarkt");
  store.setAutoCameraSwitch({ enabled: true });
  const preloadCue = firstDialogueCue(store.getCurrent(), store.getCue());
  assert.strictEqual(preloadCue.index, 1);

  store.setCueIndex(1);
  let decision = resolveAutoCameraSwitch({
    show: { active: true },
    teleprompt: store.getCurrent(),
    cue: store.getCue(),
    preparedScene: store.getPreparedScene(),
    autoCameraSwitch: store.getAutoCameraSwitch(),
  });
  assert.strictEqual(decision.action, "switch");
  assert.strictEqual(decision.slot, 1);
  assert.strictEqual(decision.address, "/osc/osc25");

  store.recordAutoCameraSwitch({
    lastCameraSlot: decision.slot,
    lastSpeakerLabel: decision.speakerLabel,
    lastCueIndex: decision.cueIndex,
    lastCueVersion: decision.cueVersion,
    lastReason: "sent",
  });
  store.setCueIndex(1);
  decision = resolveAutoCameraSwitch({
    show: { active: true },
    teleprompt: store.getCurrent(),
    cue: store.getCue(),
    preparedScene: store.getPreparedScene(),
    autoCameraSwitch: store.getAutoCameraSwitch(),
  });
  assert.strictEqual(decision.action, "skipped");
  assert.strictEqual(decision.reason, "same_camera");

  decision = resolveAutoCameraSwitch({
    show: { active: true },
    teleprompt: store.getCurrent(),
    cue: store.getCue(),
    preparedScene: store.getPreparedScene(),
    autoCameraSwitch: store.getAutoCameraSwitch(),
    force: true,
    switchReason: "first_dialogue_preload",
  });
  assert.strictEqual(decision.action, "switch");
  assert.strictEqual(decision.reason, "first_dialogue_preload");
  assert.strictEqual(decision.slot, 1);

  store.setCueIndex(2);
  decision = resolveAutoCameraSwitch({
    show: { active: true },
    teleprompt: store.getCurrent(),
    cue: store.getCue(),
    preparedScene: store.getPreparedScene(),
    autoCameraSwitch: store.getAutoCameraSwitch(),
  });
  assert.strictEqual(decision.action, "switch");
  assert.strictEqual(decision.slot, 2);
  assert.strictEqual(decision.address, "/osc/osc26");

  store.setCueIndex(3);
  decision = resolveAutoCameraSwitch({
    show: { active: true },
    teleprompt: store.getCurrent(),
    cue: store.getCue(),
    preparedScene: store.getPreparedScene(),
    autoCameraSwitch: store.getAutoCameraSwitch(),
  });
  assert.strictEqual(decision.action, "skipped");
  assert.strictEqual(decision.reason, "not_dialogue");

  store.setAutoCameraSwitch({ enabled: false });
  store.setCueIndex(4);
  decision = resolveAutoCameraSwitch({
    show: { active: true },
    teleprompt: store.getCurrent(),
    cue: store.getCue(),
    preparedScene: store.getPreparedScene(),
    autoCameraSwitch: store.getAutoCameraSwitch(),
  });
  assert.strictEqual(decision.action, "skipped");
  assert.strictEqual(decision.reason, "disabled");
}

{
  const store = createTelepromptStore();
  store.ingest({
    rawText: "Peter: Ik serveer.\nAdolf: Jij staat buitenspel.",
    source: "test",
    sceneId: 0,
  });
  store.revealPreparedScene();
  store.setAutoCameraSwitch({ enabled: true });
  store.setCueIndex(1);
  const decision = resolveAutoCameraSwitch({
    show: { active: true },
    teleprompt: store.getCurrent(),
    cue: store.getCue(),
    preparedScene: { status: "playing", sceneId: 0, characters: [] },
    fallbackScene: {
      status: "playing",
      sceneId: 39,
      title: "Peter en Adolf spelen tennis",
      characters: [
        { id: 2, name: "Peter", slot: 1 },
        { id: 8, name: "Adolf", slot: 3 },
      ],
    },
    autoCameraSwitch: store.getAutoCameraSwitch(),
  });
  assert.strictEqual(decision.action, "switch");
  assert.strictEqual(decision.slot, 1);
  assert.strictEqual(decision.address, "/osc/osc25");
}

{
  const store = createTelepromptStore();
  store.prepareScene({
    sceneId: 3,
    title: "Reactietest",
    characterSlots: [
      { id: 18, name: "Mark", slot: 1, mode: "selected" },
      { id: 49, name: "Sam", slot: 2, mode: "selected" },
      { id: 22, name: "Anne-Fleur", slot: 3, mode: "selected" },
    ],
  });
  store.ingest({
    sceneId: 3,
    rawText: "Mark: Een.\nMark: Twee.\nMark: Drie.\nMark: Vier.",
    source: "test",
  });
  store.revealPreparedScene();
  store.setAutoCameraSwitch({ enabled: true, reactionShotsEnabled: true });

  store.setCueIndex(1);
  let decision = resolveAutoCameraSwitch({
    show: { active: true },
    teleprompt: store.getCurrent(),
    cue: store.getCue(),
    preparedScene: store.getPreparedScene(),
    autoCameraSwitch: store.getAutoCameraSwitch(),
  });
  assert.strictEqual(decision.action, "switch");
  assert.strictEqual(decision.slot, 1);
  store.recordAutoCameraSwitch({
    lastCameraSlot: decision.slot,
    lastSpeakerLabel: decision.cameraLabel || decision.speakerLabel,
    lastCueIndex: decision.cueIndex,
    lastCueVersion: decision.cueVersion,
    lastReason: "sent",
  });

  decision = resolveAutoCameraSwitch({
    show: { active: true },
    teleprompt: store.getCurrent(),
    cue: store.getCue(),
    preparedScene: store.getPreparedScene(),
    autoCameraSwitch: store.getAutoCameraSwitch(),
  });
  assert.strictEqual(decision.action, "skipped");
  assert.strictEqual(decision.reason, "same_camera");

  const randomValues = [0, 0.5, 0.25];
  const plan = buildAutoCameraReactionShotPlan({
    show: { active: true },
    teleprompt: store.getCurrent(),
    cue: store.getCue(),
    preparedScene: store.getPreparedScene(),
    autoCameraSwitch: store.getAutoCameraSwitch(),
    random: () => randomValues.shift() ?? 0,
  });
  assert.strictEqual(plan.action, "schedule");
  assert.strictEqual(plan.reason, "reaction_timer");
  assert.strictEqual(plan.slot, 2);
  assert.strictEqual(plan.cameraLabel, "Sam");
  assert.strictEqual(plan.speakingSlot, 1);
  assert.strictEqual(plan.returnSlot, 1);
  assert.strictEqual(plan.delayMs, 6000);
  assert.strictEqual(plan.returnDelayMs, 1250);

  store.setAutoCameraSwitch({ enabled: true, reactionShotsEnabled: false });
  const disabledPlan = buildAutoCameraReactionShotPlan({
    show: { active: true },
    teleprompt: store.getCurrent(),
    cue: store.getCue(),
    preparedScene: store.getPreparedScene(),
    autoCameraSwitch: store.getAutoCameraSwitch(),
  });
  assert.strictEqual(disabledPlan.action, "skipped");
  assert.strictEqual(disabledPlan.reason, "reaction_disabled");
}

{
  const store = createTelepromptStore();
  store.prepareScene({
    sceneId: 5,
    title: "Exacte AutoCam volgorde",
    characterSlots: [
      { id: 50, name: "Pascal", slot: 1, mode: "selected" },
      { id: 40, name: "Myrthe van Damme", slot: 2, mode: "selected" },
      { id: 47, name: "Alex", slot: 3, mode: "selected" },
    ],
  });
  store.ingest({
    sceneId: 5,
    rawText: [
      "Pascal: Een.",
      "Pascal: Twee.",
      "Pascal: Drie.",
      "Myrthe: Vier.",
      "Myrthe: Vijf.",
      "Pascal: Zes.",
    ].join("\n"),
    source: "test",
  });
  assert.deepStrictEqual(
    store.getCurrent().lines
      .filter((line) => line.type === "dialogue")
      .map((line) => line.speakerSlot),
    [1, 1, 1, 2, 2, 1]
  );
  assert.deepStrictEqual(
    store.getCurrent().lines
      .filter((line) => line.type === "dialogue")
      .map((line) => line.speakerResolvedName),
    ["Pascal", "Pascal", "Pascal", "Myrthe van Damme", "Myrthe van Damme", "Pascal"]
  );
  store.revealPreparedScene();
  store.setAutoCameraSwitch({ enabled: true, reactionShotsEnabled: false });

  const expected = [
    ["switch", 1],
    ["skipped", "same_camera"],
    ["skipped", "same_camera"],
    ["switch", 2],
    ["skipped", "same_camera"],
    ["switch", 1],
  ];
  expected.forEach(([expectedAction, expectedValue], index) => {
    store.setCueIndex(index + 1);
    const decision = resolveAutoCameraSwitch({
      show: { active: true },
      teleprompt: store.getCurrent(),
      cue: store.getCue(),
      preparedScene: store.getPreparedScene(),
      autoCameraSwitch: store.getAutoCameraSwitch(),
    });
    assert.strictEqual(decision.action, expectedAction);
    if (expectedAction === "switch") {
      assert.strictEqual(decision.slot, expectedValue);
      store.recordAutoCameraSwitch({
        lastCameraSlot: decision.slot,
        lastSpeakerLabel: decision.cameraLabel || decision.speakerLabel,
        lastCueIndex: decision.cueIndex,
        lastCueVersion: decision.cueVersion,
        lastReason: "sent",
      });
    } else {
      assert.strictEqual(decision.reason, expectedValue);
    }
  });
}

{
  const teleprompt = parse("*Ze staan klaar.*\nSam: Eerste tekst.\nMark: Tweede tekst.");
  const cue = firstDialogueCue(teleprompt, { index: 0, deckLength: 0, version: 7 });
  assert.strictEqual(cue.index, 2);
  assert.strictEqual(cue.deckLength, 5);
  assert.strictEqual(cue.version, 7);
}

{
  assert.strictEqual(shouldEndSceneFromCueAdvance({
    cue: { index: 4, deckLength: 5 },
    requestedIndex: 5,
    preparedScene: { status: "playing" },
  }), true);
  assert.strictEqual(shouldEndSceneFromCueAdvance({
    cue: { index: 4, deckLength: 5 },
    requestedIndex: 5,
    preparedScene: null,
  }), true);
  assert.strictEqual(shouldEndSceneFromCueAdvance({
    cue: { index: 4, deckLength: 5 },
    requestedIndex: 4,
    preparedScene: { status: "playing" },
  }), false);
  assert.strictEqual(shouldEndSceneFromCueAdvance({
    cue: { index: 4, deckLength: 5 },
    requestedIndex: 5,
    preparedScene: { status: "prepared" },
  }), false);
}

console.log("teleprompter parser smoke tests passed");
