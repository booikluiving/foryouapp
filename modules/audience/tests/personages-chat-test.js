"use strict";

// Personages chatten mee tussen de bots: eigen naam, tekst van het model, stil tijdens een scène.

const assert = require("node:assert");
const { ChatSimulator } = require("../simulation/chat-simulator");
const { bouwBerichten, maakSchoon } = require("../simulation/personage-stem");

const wacht = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function maakService() {
  return {
    fase: { fase: "tussen", titel: null },
    binnen: [],
    weg: [],
    comments: [],
    getActivePollSnapshot: () => null,
    registerSimulatedClient(bot) { if (!this.binnen.includes(bot.name)) this.binnen.push(bot.name); },
    disconnectSimulatedClient(bot) { this.weg.push(bot.name); },
    recordSimulationEvent() {},
    recenteChatVoorPersonages: () => [{ naam: "Noor", tekst: "wat een scène" }],
    recenteCommentsVoorLikes: () => [],
    async acceptSimulatedComment(bot, text) { this.comments.push({ naam: bot.name, text }); return { ok: true }; },
    async acceptSimulatedReaction() { return true; },
    async acceptSimulatedLike() { return true; },
  };
}

async function main() {
  assert.strictEqual(maakSchoon('Adolf: "Ach so, wunderbar"\ntweede regel', "Adolf"), "Ach so, wunderbar");
  assert.strictEqual(maakSchoon("nadia", "Nadia"), "");
  const berichten = bouwBerichten({ naam: "Adolf", beschrijving: "Duits accent" }, { scene: "De trein", chat: [{ naam: "Noor", tekst: "hoi" }] });
  assert(berichten[0].content.includes("Duits accent"));
  assert(berichten[1].content.includes("De trein") && berichten[1].content.includes("Noor: hoi"));

  const service = maakService();
  const gevraagd = [];
  const sim = new ChatSimulator(service, {
    haalPersonages: async () => [
      { id: "character:8", naam: "Adolf", beschrijving: "Duits accent" },
      { id: "character:15", naam: "BobbieDeCrackhond", beschrijving: "hond" },
    ],
    personageStem: { schrijf: async (personage, context) => { gevraagd.push({ personage, context }); return `ik ben ${personage.naam}`; } },
  });

  // Alleen personages, geen bots.
  sim.start({ clients: 0, personages: true, spawnMs: 0, msgRate: 0.1, minGapMs: 200, intensity: 1, realism: 0 });
  await wacht(50);
  assert.deepStrictEqual(service.binnen.sort(), ["Adolf", "BobbieDeCrackhond"]);
  assert.strictEqual(sim.getState().stats.personages, 2);

  // Tijdens een scène wordt het model niet gevraagd.
  service.fase = { fase: "scene", titel: "De trein" };
  for (const bot of sim.bots) bot.nextCommentAt = 0;
  for (let i = 0; i < 400; i += 1) { sim.tick(); for (const bot of sim.bots) bot.nextCommentAt = 0; }
  await wacht(20);
  assert.strictEqual(gevraagd.length, 0, "geen modelaanroep tijdens de scène");

  // Tussen de scènes wel, met de laatste scène en de chat als context.
  service.fase = { fase: "tussen", titel: null };
  for (let i = 0; i < 2000 && service.comments.length < 2; i += 1) {
    for (const bot of sim.bots) bot.nextCommentAt = 0;
    sim.tick();
    if (i % 50 === 0) await wacht(1);
  }
  await wacht(20);
  assert(service.comments.length >= 1, "personage heeft iets gezegd");
  assert(service.comments.every((c) => c.text === `ik ben ${c.naam}`));
  assert.strictEqual(gevraagd[0].context.scene.titel, "De trein");

  // De scène van de run gaat voor op de titel die de simulator zelf zag.
  const film = { titel: "Blind audition", verloop: "Adolf draait zijn stoel om.", omgeving: "The Voice", personages: ["Adolf"] };
  const metFilm = bouwBerichten({ naam: "Adolf", beschrijving: "Duits accent" }, { scene: film, chat: [], eerder: ["ja ja"], rng: () => 0.1 });
  assert(metFilm[1].content.includes("Adolf draait zijn stoel om.") && metFilm[1].content.includes("Jij zat er zelf in"));
  assert(metFilm[1].content.includes("- ja ja") && metFilm[1].content.includes("concreet moment"));
  const zonderFilm = bouwBerichten({ naam: "Mark", beschrijving: "" }, { scene: null, chat: [{ naam: "Noor", tekst: "hoi" }], rng: () => 0.5 });
  assert(zonderFilm[1].content.includes("nog geen filmpje") && zonderFilm[1].content.includes("wat Noor net schreef"));
  assert.strictEqual(gevraagd[0].context.chat[0].naam, "Noor");

  // Personages uit: ze verlaten de chat, de simulatie loopt door.
  sim.update({ personages: false });
  assert.deepStrictEqual(service.weg.sort(), ["Adolf", "BobbieDeCrackhond"]);
  assert.strictEqual(sim.bots.length, 0);
  assert.strictEqual(sim.running, true);

  // Bots en personages naast elkaar; een modelfout legt niets stil.
  sim.stem = { schrijf: async () => { throw new Error("model gaf 500"); } };
  sim.start({ clients: 3, personages: true, spawnMs: 0, msgRate: 0.1, minGapMs: 200 });
  await wacht(50);
  assert.strictEqual(sim.bots.filter((b) => b.personage).length, 2);
  assert.strictEqual(sim.bots.filter((b) => !b.personage).length, 3);
  for (let i = 0; i < 600; i += 1) { for (const bot of sim.bots) bot.nextCommentAt = 0; sim.tick(); if (i % 50 === 0) await wacht(1); }
  await wacht(20);
  assert(sim.getState().stats.personageFouten > 0);
  assert(sim.getState().stats.personageLaatsteFout.includes("500"));
  sim.stop();
  console.log("personages-chat-test ok");
}

main().catch((err) => { console.error(err); process.exit(1); });
