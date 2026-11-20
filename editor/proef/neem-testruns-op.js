"use strict";

// Neemt de testruns van de drie testpublieken één keer op, zodat de universumpagina ze kan afspelen
// zonder opnieuw te simuleren. Werkt tegen een draaiende proefshow (node editor/proef/los.js).
//
//   node editor/proef/neem-testruns-op.js <uitvoermap> [scènes] [adres]
//
// Per publiek een bestand <id>.json: { publiek, naam, opgenomen, graph, stappen: [{ label, runtime, verloop }] }.
// Stappen: Up next 1 → scène 1 speelt → gestemd + Up next 2 → scène 2 speelt → …

const fs = require("node:fs");
const path = require("node:path");

const UIT = path.resolve(process.argv[2] || "testruns");
const SCENES = Number(process.argv[3] || 10);
const ADRES = String(process.argv[4] || "http://127.0.0.1:4100").replace(/\/+$/, "");

const wacht = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const json = async (pad, body) => {
  const antwoord = await fetch(`${ADRES}${pad}`, body === undefined ? {} : { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  return antwoord.json();
};
const stand = async () => (await json("/proefshow/api/stand")).testpubliek;

async function wachtOpKnop(label) {
  const tot = Date.now() + 60000;
  while (Date.now() < tot) {
    const s = await stand();
    if (s.fout) throw new Error(s.fout);
    if (s.wacht === label) return s;
    await wacht(150);
  }
  throw new Error(`wacht te lang op ${label}`);
}

async function opname(publiek) {
  const stappen = [];
  let graph = null;
  const leg = async (label) => {
    const universum = await json("/proefshow/universe-state");
    if (!graph) graph = universum.graph;
    const s = await stand();
    stappen.push({ label, runtime: universum.runtime, verloop: JSON.parse(JSON.stringify(s.verloop)) });
  };
  const titel = (s) => (s.verloop[s.verloop.length - 1] || {}).titel || "";
  await json("/proefshow/api/testpubliek", { publiek: publiek.id });
  await wachtOpKnop("Start scène 1");
  await leg("Start");
  for (let nr = 1; nr <= SCENES; nr += 1) {
    await json("/proefshow/api/testpubliek", { doe: "verder" });
    let s = await wachtOpKnop(`Stop scène ${nr}`);
    await wacht(1600);
    await leg(`Scène ${nr}: ${titel(s)}`);
    await json("/proefshow/api/testpubliek", { doe: "verder" });
    s = await wachtOpKnop(`Start scène ${nr + 1}`);
    // De scores rekent het algoritme op de achtergrond.
    await wacht(3000);
    await leg(`Gestemd op scène ${nr}`);
    process.stdout.write(`${publiek.id}: scène ${nr} ${titel(s)}\n`);
  }
  await json("/proefshow/api/testpubliek", { doe: "stop" });
  return { publiek: publiek.id, naam: publiek.naam, telefoons: publiek.telefoons, opgenomen: new Date().toISOString(), graph, stappen };
}

(async () => {
  fs.mkdirSync(UIT, { recursive: true });
  const publieken = (await stand()).publieken;
  const lijst = [];
  for (const publiek of publieken) {
    const uit = await opname(publiek);
    fs.writeFileSync(path.join(UIT, `${publiek.id}.json`), JSON.stringify(uit));
    lijst.push({ id: publiek.id, naam: publiek.naam, telefoons: publiek.telefoons, stappen: uit.stappen.length });
    await wacht(1500);
  }
  fs.writeFileSync(path.join(UIT, "lijst.json"), JSON.stringify({ opgenomen: new Date().toISOString(), publieken: lijst }));
  process.stdout.write(`klaar: ${UIT}\n`);
})().catch((err) => {
  process.stderr.write(`${err && err.stack || err}\n`);
  process.exit(1);
});
