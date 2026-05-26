"use strict";

const ACTIVE_CUES = Object.freeze([
  {
    id: "streamdeck-run-toggle",
    label: "START RUN / RESET RUN",
    page: "SHOW CONTROL",
    row: 0,
    column: 0,
    source: "Stream Deck",
    summary: "Start een run als Runtime idle is; reset de actieve run als er al een run bestaat.",
    states: [
      {
        label: "START RUN",
        when: "Geen actieve Runtime-run",
        commands: ["runtime.startRun", "teleprompter.prepare", "script-agent.operator.prepareDraft", "td.environment.prepare"],
        effect: "Start een nieuwe run en zet direct de eerste volgende situatie klaar in teleprompter, Operator en TouchDesigner.",
      },
      {
        label: "RESET RUN",
        when: "Runtime heeft een actieve run",
        commands: ["runtime.resetRun"],
        effect: "Zet de actieve run terug naar idle.",
      },
    ],
  },
  {
    id: "streamdeck-situation-toggle",
    label: "START SIT / STOP SIT",
    page: "SHOW CONTROL",
    row: 0,
    column: 1,
    source: "Stream Deck",
    summary: "Start de voorbereide situatie, of stopt de actieve situatie en bereidt de volgende voor.",
    states: [
      {
        label: "DISABLED",
        when: "Geen actieve Runtime-run",
        commands: [],
        effect: "Knop is gedimd en maakt geen cue aan.",
      },
      {
        label: "START SIT",
        when: "Er is een run en er is geen actieve situatie",
        commands: ["runtime.startSituation", "td.environment.go", "teleprompter.reveal"],
        effect: "Start de voorbereide Runtime-situatie, stuurt automatisch TD GO en revealt de voorbereide teleprompter-scene.",
      },
      {
        label: "STOP SIT",
        when: "Er is een actieve situatie",
        commands: ["runtime.stopSituation", "teleprompter.prepare", "script-agent.operator.prepareDraft", "td.environment.prepare"],
        effect: "Stopt de actieve situatie en zet direct de volgende situatie klaar in teleprompter, Operator en TouchDesigner.",
      },
    ],
  },
  {
    id: "streamdeck-scene-chat",
    label: "SCENE NAAR CHAT",
    page: "SHOW CONTROL",
    row: 0,
    column: 2,
    source: "Stream Deck",
    summary: "Stuurt de voorbereide Runtime-scene via de Show Control queue naar de Script Agent Operator chat.",
    states: [
      {
        label: "SCENE CHAT",
        when: "Er is een actieve Runtime-run met resolvedPreparedNext",
        commands: ["script-agent.operator.sceneToChat"],
        effect: "Bouwt een operatorprompt uit de prepared scene en start DeepSeek chat in Script Agent; teleprompter prepare blijft buiten deze knop.",
      },
    ],
  },
  {
    id: "streamdeck-teleprompter-ready",
    label: "TELEPROMPTER READY",
    page: "SHOW CONTROL",
    row: 0,
    column: 3,
    source: "Stream Deck",
    summary: "Zet de voorbereide teleprompter-scene op ready.",
    states: [
      {
        label: "READY",
        when: "Er is een voorbereide teleprompter-scene",
        commands: ["teleprompter.ready"],
        effect: "Stuurt ready=true naar de teleprompter-parser zodat de prepared kaart als klaar gemarkeerd wordt.",
      },
    ],
  },
  {
    id: "streamdeck-brent",
    label: "BRENT",
    page: "SHOW CONTROL",
    row: 2,
    column: 0,
    source: "Stream Deck",
    summary: "Schakelt Brent's SQ5 input mute-status.",
    states: [
      {
        label: "TOGGLE",
        when: "SQ5 sidecar is bereikbaar",
        commands: ["sq5.input.mute", "streamdeck.status"],
        effect: "Toggle voor Brent input mute en sync van Stream Deck feedback.",
      },
    ],
  },
  {
    id: "streamdeck-megan",
    label: "MEGAN",
    page: "SHOW CONTROL",
    row: 2,
    column: 1,
    source: "Stream Deck",
    summary: "Schakelt Megan's SQ5 input mute-status.",
    states: [
      {
        label: "TOGGLE",
        when: "SQ5 sidecar is bereikbaar",
        commands: ["sq5.input.mute", "streamdeck.status"],
        effect: "Toggle voor Megan input mute en sync van Stream Deck feedback.",
      },
    ],
  },
  {
    id: "streamdeck-booi",
    label: "BOOI",
    page: "SHOW CONTROL",
    row: 2,
    column: 2,
    source: "Stream Deck",
    summary: "Schakelt Booi's SQ5 input mute-status.",
    states: [
      {
        label: "TOGGLE",
        when: "SQ5 sidecar is bereikbaar",
        commands: ["sq5.input.mute", "streamdeck.status"],
        effect: "Toggle voor Booi input mute en sync van Stream Deck feedback.",
      },
    ],
  },
  {
    id: "streamdeck-mics",
    label: "MICS",
    page: "SHOW CONTROL",
    row: 2,
    column: 3,
    source: "Stream Deck",
    summary: "Schakelt de SQ5 mics output mute-status.",
    states: [
      {
        label: "TOGGLE",
        when: "SQ5 sidecar is bereikbaar",
        commands: ["sq5.output.mute", "streamdeck.status"],
        effect: "Toggle voor mics output mute en sync van Stream Deck feedback.",
      },
    ],
  },
  {
    id: "streamdeck-main",
    label: "MAIN",
    page: "SHOW CONTROL",
    row: 2,
    column: 4,
    source: "Stream Deck",
    summary: "Schakelt de SQ5 main output mute-status.",
    states: [
      {
        label: "TOGGLE",
        when: "SQ5 sidecar is bereikbaar",
        commands: ["sq5.output.mute", "streamdeck.status"],
        effect: "Toggle voor main output mute en sync van Stream Deck feedback.",
      },
    ],
  },
  {
    id: "td-camera-1",
    label: "CAM 1",
    page: "SHOW CONTROL",
    row: 3,
    column: 0,
    source: "Stream Deck",
    summary: "Stream Deck cue voor TouchDesigner camera 1 via de Show Control Q-hub.",
    states: [
      {
        label: "TRIGGER",
        when: "TouchDesigner Q-hub luistert op UDP 9100",
        commands: ["td.camera.set"],
        effect: "Stuurt camera 1 naar TouchDesigner en verwacht een lichte ack terug.",
      },
    ],
  },
  {
    id: "td-camera-2",
    label: "CAM 2",
    page: "SHOW CONTROL",
    row: 3,
    column: 1,
    source: "Stream Deck",
    summary: "Stream Deck cue voor TouchDesigner camera 2 via de Show Control Q-hub.",
    states: [
      {
        label: "TRIGGER",
        when: "TouchDesigner Q-hub luistert op UDP 9100",
        commands: ["td.camera.set"],
        effect: "Stuurt camera 2 naar TouchDesigner en verwacht een lichte ack terug.",
      },
    ],
  },
  {
    id: "td-camera-3",
    label: "CAM 3",
    page: "SHOW CONTROL",
    row: 3,
    column: 2,
    source: "Stream Deck",
    summary: "Stream Deck cue voor TouchDesigner camera 3 via de Show Control Q-hub.",
    states: [
      {
        label: "TRIGGER",
        when: "TouchDesigner Q-hub luistert op UDP 9100",
        commands: ["td.camera.set"],
        effect: "Stuurt camera 3 naar TouchDesigner en verwacht een lichte ack terug.",
      },
    ],
  },
]);

function listActiveStreamDeckCues() {
  return ACTIVE_CUES.map((cue) => ({
    ...cue,
    states: cue.states.map((state) => ({ ...state, commands: [...state.commands] })),
  }));
}

module.exports = {
  listActiveStreamDeckCues,
};
