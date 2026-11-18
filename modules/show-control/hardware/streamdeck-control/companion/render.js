"use strict";

// Tekent per knop en per stand de achtergrond (72×72 PNG) volgens het ontwerpsysteem
// (deck.json → ontwerp, uitleg in ONTWERP.md): strook bovenaan = soort, vlak = stand.
// Uitvoer: plaatjes.json  { "<key>": { "<stand>": "<base64 png>" } }
// De tekst zet Companion erop; die zit niet in het plaatje.
//
//   node render.js [--uit <pad>]

const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { DIR, allButtons, loadDeck } = require("./lib");

const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const SIZE = 72;

function standenVoor(deck, knop) {
  if (knop.soort === "nav") return ["kan"];
  const lijst = deck.ontwerp.soorten[knop.soort].standen.slice();
  if (knop.actie && knop.actie.scenePlek && !lijst.includes("leeg")) lijst.push("leeg");
  return lijst;
}

function jobs(deck) {
  const out = [];
  for (const knop of allButtons(deck)) {
    const soort = deck.ontwerp.soorten[knop.soort];
    for (const stand of standenVoor(deck, knop)) {
      const job = { key: knop.key, stand, soort: knop.soort, naam: soort.naam, kleur: soort.kleur, web: knop.soort === "web" };
      out.push(job);
      if (deck.ontwerp.standen[stand].knippert) out.push({ ...job, stand: `${stand}_knip`, knip: true, basis: stand });
    }
  }
  return out;
}

const PAGE = (data, standen) => `<!doctype html><meta charset="utf-8"><body><textarea id="out"></textarea><script>
const S=${SIZE}, JOBS=${JSON.stringify(data)}, ST=${JSON.stringify(standen)};
const STROOK=14;
function draw(j){
  const c=document.createElement("canvas");c.width=c.height=S;const g=c.getContext("2d");
  const st=ST[j.knip?j.basis:j.stand];
  // vlak
  g.fillStyle = j.knip || j.soort==="nav" ? "#000000" : st.vlak; g.fillRect(0,0,S,S);
  if(st.vlak2 && !j.knip){ g.fillStyle=st.vlak2; g.fillRect(S/2,0,S/2,S); }
  if(j.knip){ g.strokeStyle=st.vlak; g.lineWidth=3; g.strokeRect(1.5,1.5,S-3,S-3); }
  if(j.soort==="nav"){ g.strokeStyle="#ffffff"; g.lineWidth=3; g.strokeRect(1.5,1.5,S-3,S-3); return c.toDataURL("image/png").split(",")[1]; }
  if(j.stand==="leeg") return c.toDataURL("image/png").split(",")[1];
  // strook = soort; vaag als de knop nu niet mag of niets weet
  const vaag = j.stand==="uit"||j.stand==="onbekend";
  g.globalAlpha = vaag ? .35 : 1;
  g.fillStyle=j.kleur; g.fillRect(0,0,S,STROOK);
  g.fillStyle="#000000"; g.font="800 10px 'Helvetica Neue',Helvetica,Arial,sans-serif"; g.textAlign="center"; g.textBaseline="middle";
  const woord=j.naam; let w=g.measureText(woord).width; g.save(); g.translate(S/2,STROOK/2+.5); if(w>S-6) g.scale((S-6)/w,1); g.fillText(woord,0,0); g.restore();
  g.globalAlpha=1;
  // loopt: wit kader onder de strook
  if(st.kader && !j.knip){ g.strokeStyle=st.kader; g.lineWidth=3; g.strokeRect(1.5,STROOK+1.5,S-3,S-STROOK-3); }
  // web: pijl rechtsonder
  if(j.web){ g.fillStyle="rgba(255,255,255,.7)"; g.font="700 11px 'Helvetica Neue',Helvetica,Arial,sans-serif"; g.textAlign="right"; g.textBaseline="alphabetic"; g.fillText("\u2197",S-4,S-4); }
  return c.toDataURL("image/png").split(",")[1];
}
(()=>{const res={};for(const j of JOBS){(res[j.key]=res[j.key]||{})[j.stand]=draw(j);} document.getElementById("out").textContent="@@"+"BEGIN@@"+JSON.stringify(res)+"@@"+"END@@";})();
</script>`;

function main() {
  const argv = process.argv.slice(2);
  const uit = argv[0] === "--uit" ? argv[1] : path.join(DIR, "plaatjes.json");
  const deck = loadDeck();
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "fy-deck-render-"));
  const html = path.join(tmp, "render.html");
  fs.writeFileSync(html, PAGE(jobs(deck), deck.ontwerp.standen));
  const dom = execFileSync(CHROME, [
    "--headless=new", "--disable-gpu", "--no-first-run", "--no-default-browser-check",
    `--user-data-dir=${path.join(tmp, "profiel")}`, "--virtual-time-budget=20000", "--dump-dom", `file://${html}`,
  ], { encoding: "utf8", maxBuffer: 256 * 1024 * 1024, timeout: 120000, stdio: ["ignore", "pipe", "ignore"] });
  fs.rmSync(tmp, { recursive: true, force: true });
  if (dom.includes("@@FOUT@@")) throw new Error(`render mislukt: ${dom.split("@@FOUT@@")[1].split("<")[0]}`);
  const m = dom.match(/@@BEGIN@@([\s\S]*?)@@END@@/);
  if (!m) throw new Error("render gaf geen uitvoer");
  const json = m[1].replace(/&quot;/g, '"').replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">");
  const res = JSON.parse(json);
  fs.writeFileSync(uit, JSON.stringify(res));
  const n = Object.values(res).reduce((a, v) => a + Object.keys(v).length, 0);
  console.log(`plaatjes: ${n} voor ${Object.keys(res).length} knoppen → ${uit} (${Math.round(fs.statSync(uit).size / 1024)} KB)`);
}

if (require.main === module) {
  try { main(); } catch (err) { console.error(err.message || err); process.exit(1); }
}

module.exports = { standenVoor };
