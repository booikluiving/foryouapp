"use strict";

// Publieksrapport: volgt de laatste run, of toont een gekozen run.
const $ = (id) => document.getElementById(id);
const VOLG = "";
let gekozen = VOLG;
let runs = [];

function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (key === "text") node.textContent = value;
    else if (key === "style") node.setAttribute("style", value);
    else node.setAttribute(key, value);
  }
  for (const child of [].concat(children)) if (child) node.append(child);
  return node;
}

function getal(value) {
  const number = Number(value || 0);
  return (number > 0 ? "+" : "") + number.toLocaleString("nl-NL", { maximumFractionDigits: 1 });
}

function plat(value) {
  return Number(value || 0).toLocaleString("nl-NL", { maximumFractionDigits: 2 });
}

// Eén kolom per scène: omhoog is positief, omlaag negatief.
function verloop(target, scenes) {
  target.replaceChildren();
  if (!scenes.length) { target.append(leeg("Nog geen scènes gespeeld.")); return; }
  const grootste = Math.max(...scenes.map((scene) => Math.abs(scene.score)), 0.01);
  for (const scene of scenes) {
    const hoogte = `${Math.max(2, (Math.abs(scene.score) / grootste) * 100)}%`;
    target.append(el("div", { class: "verloop-kolom", title: `${scene.nr}. ${scene.title}` }, [
      el("div", { class: "boven" }, scene.score >= 0 ? [el("b", { text: getal(scene.score) }), el("i", { style: `height:${hoogte}` })] : []),
      el("div", { class: "onder" }, scene.score < 0 ? [el("i", { style: `height:${hoogte}` }), el("b", { text: getal(scene.score) })] : []),
      el("span", { text: String(scene.nr) }),
    ]));
  }
}

function uitleg(target, weights) {
  const regels = [
    `Som per scène: elk hartje ${getal(weights.heart)}, elke verveeld ${getal(weights.bored)}, elk bericht ${getal(weights.message)}.`,
    "Duur: een scène van 60 seconden telt 1 keer; een langere scène telt minder zwaar, een kortere zwaarder.",
    "Publiek: de som wordt gedeeld door de wortel van het aantal kijkers, zodat een volle zaal niet vanzelf hoger scoort.",
    `Verwachting voor een scène die nog komt: gemiddelde score van zijn labels × ${plat(weights.labelAffinity)} plus die van zijn personages × ${plat(weights.characterAffinity)}. Recente scènes wegen zwaarder.`,
    `Daarbovenop: tot ${getal(weights.exploration)} voor personages die nog niet gezien zijn, en een aftrek (gewicht ${plat(weights.diversity)}) voor personages van net daarvoor.`,
  ];
  target.replaceChildren(...regels.map((regel) => el("div", { text: regel })));
}

function tijd(iso) {
  if (!iso) return "";
  return new Date(iso).toLocaleTimeString("nl-NL", { hour: "2-digit", minute: "2-digit" });
}

function namen(rows) {
  return rows.map((row) => row.name.toLowerCase()).join(" en ");
}

function leeg(tekst) {
  return el("div", { class: "leeg", text: tekst });
}

// Balk vanuit het midden: rechts positief, links negatief.
function balk(score, grootste) {
  const breedte = grootste > 0 ? Math.min(50, (Math.abs(score) / grootste) * 50) : 0;
  return el("div", { class: "balk" }, el("span", { class: score >= 0 ? "plus" : "min", style: `width:${breedte}%` }));
}

function balkRijen(target, rows) {
  target.replaceChildren();
  if (!rows.length) { target.append(leeg("Nog geen scènes gespeeld.")); return; }
  const grootste = Math.max(...rows.map((row) => Math.abs(row.averageScore)), 0.01);
  for (const row of rows) {
    target.append(el("div", { class: "balk-rij" }, [
      el("div", { class: "naam", title: row.name }, [row.name, el("small", { text: `${row.scenes}×` })]),
      balk(row.averageScore, grootste),
      el("div", { class: "getal", text: getal(row.averageScore) }),
    ]));
  }
}

function sceneKaart(scene, grootste) {
  const meta = [
    `♥ ${scene.hearts}`,
    `verveeld ${scene.bored}`,
    `berichten ${scene.messages}`,
    `${scene.viewers} kijkers`,
    `${scene.durationSeconds} s`,
    tijd(scene.startedAt),
  ];
  if (scene.roomSound && scene.roomSound.averageDb != null) {
    meta.push(`zaal ${Number(scene.roomSound.averageDb).toFixed(0)} dB, piek ${Number(scene.roomSound.peakDb).toFixed(0)} dB`);
  }
  return el("div", { class: "scene-kaart" }, [
    el("div", { class: "scene-kop" }, [
      el("strong", { text: `${scene.nr}. ${scene.title}` }),
      el("span", { class: "score", text: getal(scene.score) }),
    ]),
    balk(scene.score, grootste),
    el("div", { class: "scene-chips" }, scene.labels.map((label) => el("span", { class: "fy-chip", text: label }))),
    el("div", { class: "scene-meta" }, meta.filter(Boolean).map((tekst) => el("span", { text: tekst }))),
    el("div", { class: "scene-meta" }, el("span", { text: scene.characters.join(", ") })),
    scene.calculation ? el("div", { class: "scene-som", text:
      `som ${getal(scene.calculation.raw)} × duur ${plat(scene.calculation.durationFactor)} × publiek ${plat(scene.calculation.audienceFactor)} = ${getal(scene.score)}` }) : null,
  ]);
}

function verwachtRijen(target, rows) {
  target.replaceChildren();
  if (!rows.length) { target.append(leeg("Nog niets te verwachten.")); return; }
  for (const row of rows) {
    const delen = [];
    if (row.fromLabels) delen.push(`labels ${getal(row.fromLabels)}`);
    if (row.fromCharacters) delen.push(`personages ${getal(row.fromCharacters)}`);
    if (row.exploration) delen.push(`nog niet gezien ${getal(row.exploration)}`);
    if (row.diversity) delen.push(`afwisseling ${getal(row.diversity)}`);
    target.append(el("div", { class: "verwacht-rij" }, [
      el("span", { text: row.title }),
      el("span", { class: "getal", text: getal(row.predictedScore) }),
      el("small", { text: [row.labels.join(", "), delen.join(" · ")].filter(Boolean).join(" — ") }),
    ]));
  }
}

function render(report) {
  const conclusie = $("conclusie");
  conclusie.replaceChildren();
  if (report.conclusion) {
    conclusie.append(
      "Dit publiek vindt ", el("em", { text: namen(report.conclusion.best) }),
      " het leukst en ", el("em", { text: namen(report.conclusion.worst) }), " het minst."
    );
  } else {
    conclusie.append(report.totals.scenes ? "Nog te weinig scènes voor een conclusie." : "Nog geen scènes gespeeld.");
  }
  const stats = report.stats || {};
  const tegel = (naam, waarde, extra) => el("div", { class: "tegel" }, [
    el("span", { text: naam }),
    el("strong", { text: String(waarde) }),
    extra ? el("small", { text: extra, title: extra }) : null,
  ]);
  $("tellers").replaceChildren(
    tegel("Scènes", report.totals.scenes, `${plat(stats.totalMinutes)} min gespeeld`),
    tegel("Kijkers", plat(stats.averageViewers), "gemiddeld per scène"),
    tegel("Hartjes", report.totals.hearts, `${plat(stats.heartsPerMinute)} per minuut`),
    tegel("Verveeld", report.totals.bored, stats.heartShare == null ? "" : `${stats.heartShare}% van de reacties is een hartje`),
    tegel("Berichten", report.totals.messages, ""),
    tegel("Gemiddelde score", getal(report.totals.averageScore), ""),
    tegel("Beste scène", stats.best ? getal(stats.best.score) : "–", stats.best ? `${stats.best.nr}. ${stats.best.title}` : ""),
    tegel("Zwakste scène", stats.worst ? getal(stats.worst.score) : "–", stats.worst ? `${stats.worst.nr}. ${stats.worst.title}` : "")
  );
  verloop($("verloop"), report.scenes);
  uitleg($("uitleg"), report.weights || {});
  balkRijen($("labels"), report.labels);
  balkRijen($("personages"), report.characters.slice(0, 12));
  const scenes = $("scenes");
  scenes.replaceChildren();
  if (report.live) {
    scenes.append(el("div", { class: "scene-kaart" }, [
      el("div", { class: "scene-kop" }, [
        el("strong", { text: `Speelt nu: ${report.live.title}` }),
        el("span", { class: "score", text: getal(report.live.score) }),
      ]),
      el("div", { class: "scene-chips" }, report.live.labels.map((label) => el("span", { class: "fy-chip", text: label }))),
    ]));
  }
  if (!report.scenes.length && !report.live) scenes.append(leeg("Nog geen scènes gespeeld."));
  const grootste = Math.max(...report.scenes.map((scene) => Math.abs(scene.score)), 0.01);
  for (const scene of report.scenes.slice().reverse()) scenes.append(sceneKaart(scene, grootste));
  // Zonder gespeelde scènes staat elke verwachting op nul: dan valt er niets te tonen.
  verwachtRijen($("verwachtHoog"), report.totals.scenes ? report.forecast.highest : []);
  verwachtRijen($("verwachtLaag"), report.totals.scenes ? report.forecast.lowest : []);
  $("topMeta").textContent = report.showRunId ? `${report.showRunId} · bijgewerkt ${tijd(report.updatedAt)}` : "";
}

async function haalRuns() {
  const response = await fetch("/v0/algorithm/scoring-contexts");
  const data = await response.json();
  runs = (data.contexts || []).slice().sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  const select = $("runSelect");
  select.replaceChildren(el("option", { value: VOLG, text: "Laatste run" }));
  // Alleen runs waarin iets gespeeld is: de rest heeft geen rapport.
  for (const run of runs.filter((item) => item.observationCount > 0).slice(0, 60)) {
    const wanneer = run.createdAt ? new Date(run.createdAt).toLocaleString("nl-NL", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : run.showRunId;
    select.append(el("option", { value: run.showRunId, text: `${wanneer} · ${run.observationCount} scènes` }));
  }
  select.value = gekozen;
}

async function ververs() {
  const showRunId = gekozen || (runs[0] && runs[0].showRunId);
  if (!showRunId) { $("conclusie").textContent = "Nog geen run."; return; }
  const response = await fetch(`/v0/algorithm/scoring-contexts/${encodeURIComponent(showRunId)}/report`);
  if (response.ok) render(await response.json());
}

$("runSelect").addEventListener("change", (event) => { gekozen = event.target.value; ververs().catch(() => {}); });
haalRuns().then(ververs).catch(() => { $("conclusie").textContent = "Het algoritme is niet bereikbaar."; });
setInterval(() => { ververs().catch(() => {}); }, 5000);
setInterval(() => { haalRuns().catch(() => {}); }, 30000);
