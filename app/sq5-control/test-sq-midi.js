const assert = require("node:assert/strict");
const { protocol } = require("./server");

function hex(bytes) {
  return protocol.bytesToHex(bytes);
}

assert.equal(hex(protocol.sceneRecallBytes(7, 1)), "B0 00 00 C0 06");
assert.equal(hex(protocol.sceneRecallBytes(156, 3)), "B2 00 01 C2 1B");

assert.equal(hex(protocol.softKeyBytes(1, "press", 1)), "90 30 7F");
assert.equal(hex(protocol.softKeyBytes(7, "release", 5)), "84 36 00");

assert.equal(hex(protocol.inputMuteBytes(1, true, 1)), "B0 63 00 B0 62 00 B0 06 00 B0 26 01");
assert.equal(hex(protocol.inputMuteBytes(1, "toggle", 1)), "B0 63 00 B0 62 00 B0 60 00");

assert.equal(hex(protocol.inputLevelBytes(1, 0, "lr", 1, "linear")), "B0 63 40 B0 62 00 B0 06 76 B0 26 5C");
assert.equal(hex(protocol.inputLevelBytes(1, -20, "lr", 1, "linear")), "B0 63 40 B0 62 00 B0 06 63 B0 26 49");
assert.equal(hex(protocol.inputLevelBytes(40, -20, "aux5", 1, "linear")), "B0 63 44 B0 62 1C B0 06 63 B0 26 49");
assert.equal(hex(protocol.inputLevelBytes(40, -20, "aux5", 1, "audio")), "B0 63 44 B0 62 1C B0 06 2E B0 26 40");

assert.equal(hex(protocol.inputPanBytes(1, -100, "lr", 1)), "B0 63 50 B0 62 00 B0 06 00 B0 26 00");
assert.equal(hex(protocol.inputPanBytes(1, 0, "lr", 1)), "B0 63 50 B0 62 00 B0 06 3F B0 26 7F");
assert.equal(hex(protocol.inputPanBytes(24, 20, "lr", 1)), "B0 63 50 B0 62 17 B0 06 4C B0 26 65");
assert.equal(hex(protocol.inputPanBytes(24, -50, "aux5", 4)), "B3 63 52 B3 62 5C B3 06 1F B3 26 7F");

assert.equal(hex(protocol.inputAssignBytes(1, true, "lr", 1)), "B0 63 60 B0 62 00 B0 06 00 B0 26 01");
assert.equal(hex(protocol.inputAssignBytes(1, false, "lr", 1)), "B0 63 60 B0 62 00 B0 06 00 B0 26 00");

assert.equal(hex(protocol.inputGetBytes(1, "level", "lr", 1)), "B0 63 40 B0 62 00 B0 60 7F");
assert.equal(hex(protocol.inputRelativeBytes(1, "level", "inc", "lr", 1)), "B0 63 40 B0 62 00 B0 60 00");
assert.equal(hex(protocol.inputRelativeBytes(1, "pan", "left", "lr", 1)), "B0 63 50 B0 62 00 B0 61 00");

assert.equal(hex(protocol.outputMuteBytes(protocol.outputTargetFromToken("muziek"), true, 1)), "B0 63 00 B0 62 31 B0 06 00 B0 26 01");
assert.equal(hex(protocol.outputGetBytes(protocol.outputTargetFromToken("main"), "level", 1)), "B0 63 4F B0 62 00 B0 60 7F");
assert.equal(hex(protocol.outputGetBytes(protocol.outputTargetFromToken("sub"), "level", 1)), "B0 63 4F B0 62 11 B0 60 7F");
assert.equal(hex(protocol.outputGetBytes(protocol.outputTargetFromToken("aux12"), "mute", 1)), "B0 63 00 B0 62 50 B0 60 7F");
assert.equal(hex(protocol.outputGetBytes(protocol.outputTargetFromToken("mtx3"), "level", 1)), "B0 63 4F B0 62 13 B0 60 7F");
assert.equal(hex(protocol.outputGetBytes(protocol.outputTargetFromToken("dca8"), "level", 1)), "B0 63 4F B0 62 27 B0 60 7F");
assert.deepEqual(protocol.channelsFromToken("macstudio").map((channel) => channel.input), [5, 6]);
assert.deepEqual(protocol.channelsFromToken("minijack").map((channel) => channel.input), [7, 8]);
assert.equal(protocol.streamdeckTargetFromToken("all-mics").key, "allMics");
assert.equal(protocol.streamdeckTargetFromToken("main").kind, "output");

assert.equal(protocol.decodeResponse("B0 63 00 B0 62 00 B0 06 00 B0 26 01", { action: "get", parameter: "mute" }), "mute: on");
assert.equal(protocol.decodeResponse("B0 63 40 B0 62 00 B0 06 76 B0 26 10", { action: "get", parameter: "level" }), "level: -0.6 dB");
assert.deepEqual(protocol.decodeResponseValue("B0 63 00 B0 62 00 B0 06 00 B0 26 01", { action: "get", parameter: "mute" }), {
  parameter: "mute",
  value: true,
  display: "mute: on",
});

console.log("SQ MIDI protocol fixtures ok");
