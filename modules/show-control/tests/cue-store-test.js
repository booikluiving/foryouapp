"use strict";

// Opslag van cues: geheugen eerst, samengevoegd wegschrijven, snoeien naar het cue-archief.
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");

const tempDbDir = path.join(__dirname, "..", `.tmp-cue-store-${process.pid}`);
process.env.SHOW_CONTROL_DB_DIR = tempDbDir;
process.env.SHOW_CONTROL_MAX_CUES = "5";
process.env.SHOW_CONTROL_CUE_FLUSH_MS = "30";

const {
  archiveCue,
  cuesFilePath,
  flushCueStore,
  payloadIndexFilePath,
  readCue,
  readCueSummary,
  readCues,
  readIndexedPayload,
  saveCue,
} = require("../cue-engine/state-store");

function fakeCue(n) {
  return {
    cueId: `cue-${String(n).padStart(3, "0")}`,
    name: `Test ${n}`,
    status: { stage: "ready", state: "ok", warnings: n === 9 ? ["let op"] : [] },
    actions: [{ actionId: `a-${n}`, payloadId: `cue-${n}:payload:01`, payload: { camera: String((n % 3) + 1), n } }],
  };
}

async function main() {
  try {
    for (let n = 1; n <= 8; n += 1) await saveCue(fakeCue(n));
    // Nog niet weggeschreven, maar wel leesbaar.
    assert.equal((await readCue("cue-008")).name, "Test 8");
    assert.equal((await readCues()).length, 8, "geheugen bevat alle cues tot de flush");

    // Ack-achtige update op een bestaande cue.
    const cue = await readCue("cue-008");
    cue.status.stage = "applied";
    await saveCue(cue);
    assert.equal((await readCue("cue-008")).status.stage, "applied");

    await flushCueStore();
    const onDisk = JSON.parse(await fs.readFile(cuesFilePath(), "utf8"));
    assert.equal(onDisk.length, 5, "cues.json houdt maximaal SHOW_CONTROL_MAX_CUES cues");
    assert.equal(onDisk[0].cueId, "cue-004", "oudste cues zijn gesnoeid");
    assert.equal(onDisk[4].status.stage, "applied");
    const raw = await fs.readFile(cuesFilePath(), "utf8");
    assert(!raw.includes("\n  "), "cues.json is compact geschreven");

    const day = new Date().toISOString().slice(0, 10);
    const archive = (await fs.readFile(path.join(tempDbDir, "cue-archief", `cues-${day}.jsonl`), "utf8")).trim().split("\n");
    assert.deepEqual(archive.map((line) => JSON.parse(line).cueId), ["cue-001", "cue-002", "cue-003"], "gesnoeide cues staan in het archief");

    const index = JSON.parse(await fs.readFile(payloadIndexFilePath(), "utf8"));
    assert(!index.entries["cue-1:payload:01"], "payload van gesnoeide cue is uit de index");
    assert.equal((await readIndexedPayload("cue-8:payload:01")).n, 8, "payload van actieve cue is er nog");

    await saveCue(fakeCue(9));
    await archiveCue("cue-004", { reason: "test" });
    const summary = await readCueSummary();
    assert.equal(summary.archivedCount, 1);
    assert.equal(summary.latestCue.cueId, "cue-009");
    assert.deepEqual(summary.warnings, ["let op"]);
    assert.equal(summary.count, (await readCues()).length, "summary telt zoals readCues");

    // Extern gewijzigd bestand wordt opnieuw ingelezen.
    await flushCueStore();
    await new Promise((resolve) => setTimeout(resolve, 20));
    await fs.writeFile(cuesFilePath(), JSON.stringify([fakeCue(42)]) + "\n");
    assert.equal((await readCues()).length, 1, "nieuw bestand op schijf wint als er niets openstaat");

    console.log(JSON.stringify({ ok: true, test: "cue-store" }));
  } finally {
    await flushCueStore();
    await fs.rm(tempDbDir, { recursive: true, force: true });
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
