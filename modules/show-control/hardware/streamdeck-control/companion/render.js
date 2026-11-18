"use strict";

// Tekent per knop en per toon een Gel-pad-achtergrond (72×72 PNG) met headless Chrome.
// Uitvoer: plaatjes.json  { "<key>": { "<toon>": "<base64 png>" } }
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

// toon per rol; nav heeft één vast plaatje
const TONEN = {
  lampje: ["off", "on", "alert", "warn"],
  nav: ["idle"],
  default: ["off", "idle", "on", "live", "busy", "done", "warn", "alert"],
};

function tonenVoor(knop) {
  return TONEN[knop.rol] || TONEN.default;
}

function jobs(deck) {
  const out = [];
  for (const knop of allButtons(deck)) {
    const svg = fs.readFileSync(path.join(DIR, "iconen", `${knop.pictogram}.svg`), "utf8");
    for (const toon of tonenVoor(knop)) {
      out.push({ key: knop.key, toon, rol: knop.rol, kleur: deck.onderdelen[knop.onderdeel], licht: knop.onderdeel === "licht", svg });
    }
  }
  return out;
}

const PAGE = (data, staat) => `<!doctype html><meta charset="utf-8"><body><textarea id="out"></textarea><script>
const S=${SIZE}, JOBS=${JSON.stringify(data)}, ST=${JSON.stringify(staat)};
function mix(a,b,t){const p=h=>[1,3,5].map(i=>parseInt(h.slice(i,i+2),16));const x=p(a),y=p(b);return "rgb("+x.map((v,i)=>Math.round(v*(1-t)+y[i]*t)).join(",")+")";}
function rr(c,x,y,w,h,r){c.beginPath();rp(c,x,y,w,h,r);}
function rp(c,x,y,w,h,r){c.moveTo(x+r,y);c.arcTo(x+w,y,x+w,y+h,r);c.arcTo(x+w,y+h,x,y+h,r);c.arcTo(x,y+h,x,y,r);c.arcTo(x,y,x+w,y,r);c.closePath();}
function img(svg,fill){return new Promise((ok,err)=>{const i=new Image();i.onload=()=>ok(i);i.onerror=err;i.src="data:image/svg+xml;utf8,"+encodeURIComponent(svg.replace("<svg ","<svg fill=\\""+fill+"\\" "));});}
async function draw(j){
  const c=document.createElement("canvas");c.width=c.height=S;const g=c.getContext("2d");
  const R=S*.14; rr(g,0,0,S,S,R); g.save(); g.clip();
  const lamp=j.rol==="lampje";
  let col=j.kleur;
  if(j.rol==="nav") col=ST.nav;
  if(!lamp){ if(j.toon==="alert") col=ST.alert; if(j.toon==="warn"||j.toon==="busy") col=ST.warn; if(j.toon==="done") col=ST.ok; }
  const off=j.toon==="off";
  const dark=lamp||off;
  // vlak
  let lg=g.createLinearGradient(0,0,0,S);
  if(lamp){ const a=j.toon==="alert"?["#5a1414","#2a0909"]:["#262a30","#14171b"]; lg.addColorStop(0,a[0]); lg.addColorStop(1,a[1]); }
  else if(off){ lg.addColorStop(0,"#3c4148"); lg.addColorStop(1,"#212429"); }
  else { lg.addColorStop(0,mix(col,"#ffffff",.22)); lg.addColorStop(.45,col); lg.addColorStop(1,mix(col,"#000000",.32)); }
  g.fillStyle=lg; g.fillRect(0,0,S,S);
  if(!dark){ const rg=g.createRadialGradient(S/2,S*1.08,0,S/2,S*1.08,S*.62); rg.addColorStop(0,mix(col,"#ffffff",.5)); rg.addColorStop(1,"rgba(255,255,255,0)"); g.globalAlpha=.75; g.fillStyle=rg; g.fillRect(0,0,S,S); g.globalAlpha=1; }
  // pictogram: groot, wazig, achter de tekst
  const tekstLicht = (j.licht && !off && !lamp && !["alert"].includes(j.toon)) || ["warn","busy","done"].includes(j.toon) && !lamp;
  const icoKleur = dark ? "#ffffff" : (tekstLicht ? "#2a2000" : "#ffffff");
  const ic=await img(j.svg,icoKleur); const isz=S*1.0;
  g.save(); g.filter="blur("+(S*.035)+"px)"; g.globalAlpha= lamp?.16 : off?.14 : .34; g.drawImage(ic,(S-isz)/2,(S-isz)/2,isz,isz); g.restore();
  // glans
  if(!lamp){ g.save(); g.beginPath(); g.ellipse(S/2,-S*.02,S*.62,S*.5,0,0,Math.PI*2); g.clip();
    const gl=g.createLinearGradient(0,0,0,S*.48); gl.addColorStop(0,"rgba(255,255,255,"+(off?.14:.5)+")"); gl.addColorStop(1,"rgba(255,255,255,"+(off?.02:.06)+")");
    g.fillStyle=gl; g.fillRect(0,0,S,S*.47); g.restore(); }
  // binnenrand en schaduw onder
  const sh=g.createLinearGradient(0,S*.86,0,S); sh.addColorStop(0,"rgba(0,0,0,0)"); sh.addColorStop(1,"rgba(0,0,0,"+(dark?.25:.32)+")"); g.fillStyle=sh; g.fillRect(0,0,S,S);
  g.restore();
  rr(g,.5,.5,S-1,S-1,R); g.strokeStyle="rgba(255,255,255,"+(dark?.08:.22)+")"; g.lineWidth=1; g.stroke();
  // lampje: ring in staatkleur
  if(lamp){ const rc={on:ST.ok,alert:ST.alert,warn:ST.warn,off:"#3d434b"}[j.toon]; const w=S*.055; rr(g,w/2+1,w/2+1,S-w-2,S-w-2,R-2); g.strokeStyle=rc; g.lineWidth=w; g.stroke();
    if(j.toon!=="off"){ g.save(); g.shadowColor=rc; g.shadowBlur=S*.08; g.stroke(); g.restore(); } }
  // live: witte rand
  if(j.toon==="live"){ const w=S*.05; rr(g,w/2,w/2,S-w,S-w,R); g.strokeStyle="#ffffff"; g.lineWidth=w; g.stroke(); }
  // gevaar: geel-zwarte rand
  if(j.rol==="gevaar"){ g.save(); const w=S*.06; g.beginPath(); rp(g,0,0,S,S,R); rp(g,w,w,S-2*w,S-2*w,R-w); g.clip("evenodd");
    for(let x=-S;x<S*2;x+=10){ g.beginPath(); g.moveTo(x,0); g.lineTo(x+5,0); g.lineTo(x+5-S,S); g.lineTo(x-S,S); g.closePath(); g.fillStyle="#ffd400"; g.fill(); }
    g.restore(); }
  // stip rechtsboven
  const dot = j.toon==="on"&&!lamp ? ST.ok : j.toon==="live" ? ST.alert : null;
  if(dot){ const r=S*.075, cx=S-S*.15, cy=S*.15; g.save(); g.shadowColor=dot; g.shadowBlur=S*.08; g.beginPath(); g.arc(cx,cy,r,0,Math.PI*2);
    const dg=g.createRadialGradient(cx-r*.3,cy-r*.3,0,cx,cy,r); dg.addColorStop(0,"#ffffff"); dg.addColorStop(.45,dot); dg.addColorStop(1,mix(dot,"#000000",.4)); g.fillStyle=dg; g.fill(); g.restore();
    g.beginPath(); g.arc(cx,cy,r,0,Math.PI*2); g.strokeStyle="rgba(0,0,0,.45)"; g.lineWidth=1; g.stroke(); }
  return c.toDataURL("image/png").split(",")[1];
}
(async()=>{const res={};for(const j of JOBS){(res[j.key]=res[j.key]||{})[j.toon]=await draw(j);} document.getElementById("out").textContent="@@"+"BEGIN@@"+JSON.stringify(res)+"@@"+"END@@";})()
  .catch(e=>{document.getElementById("out").textContent="@@"+"FOUT@@"+e;});
</script>`;

function main() {
  const argv = process.argv.slice(2);
  const uit = argv[0] === "--uit" ? argv[1] : path.join(DIR, "plaatjes.json");
  const deck = loadDeck();
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "fy-deck-render-"));
  const html = path.join(tmp, "render.html");
  fs.writeFileSync(html, PAGE(jobs(deck), deck.staatkleuren));
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

module.exports = { tonenVoor };
