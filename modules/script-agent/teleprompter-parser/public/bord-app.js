(function () {
  "use strict";

  // Bord 1 t/m 5 (blind ranking). Een plaatje komt in beeld als de operator op de knop drukt
  // (payload.bord.getoond) en blijft staan. Het gaat naar zijn plek zodra de speler bij die regel
  // is (line.bord), of anders bij de druk voor het volgende plaatje. Zonder druk is het vak leeg.
  const PLEKKEN = 5;
  const VLIEG_MS = 430;
  const params = new URLSearchParams(window.location.search);
  const vel = document.getElementById("vel");
  const bordEl = document.getElementById("bord");
  const nieuw = document.getElementById("nieuw");
  if (params.get("proef") === "1") document.body.classList.add("proef");
  [["bx", "--bx"], ["by", "--by"], ["rx", "--rx"], ["ry", "--ry"]].forEach(([naam, eigenschap]) => {
    const waarde = Number(params.get(naam));
    if (params.has(naam) && Number.isFinite(waarde)) vel.style.setProperty(eigenschap, `${waarde}px`);
  });

  let sleutel = "";        // welke tekst er nu ligt
  let stappen = [];        // alle bordstappen van die tekst, met de cue waarop ze afgaan
  let gedaan = 0;          // hoeveel stappen al in beeld zijn
  let plekken = new Array(PLEKKEN).fill(null);
  let open = null;
  let bezig = false;
  let doel = 0;

  function schaal() {
    const s = Math.min(window.innerWidth / 1080, window.innerHeight / 1920);
    vel.style.transform = `scale(${s})`;
  }

  function slug(naam) {
    return String(naam || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  }

  function kaart(naam) {
    const el = document.createElement("div");
    el.className = "kaart";
    const tekst = document.createElement("span");
    tekst.textContent = naam;
    el.appendChild(tekst);
    const img = new Image();
    img.alt = "";
    img.onload = () => {
      tekst.remove();
      el.insertBefore(img, el.firstChild);
      const label = document.createElement("small");
      label.textContent = naam;
      el.appendChild(label);
    };
    img.src = `/script-agent/teleprompter-parser/bord-plaatje/${slug(naam)}`;
    return el;
  }

  function tekenBord() {
    bordEl.textContent = "";
    plekken.forEach((naam, i) => {
      const rij = document.createElement("div");
      rij.className = "plek";
      const cijfer = document.createElement("b");
      cijfer.textContent = String(i + 1);
      const vak = document.createElement("div");
      vak.className = "vak";
      vak.id = `vak${i + 1}`;
      if (naam) vak.appendChild(kaart(naam));
      rij.append(cijfer, vak);
      bordEl.appendChild(rij);
    });
  }

  function terugNaarStart() {
    nieuw.classList.add("vast");
    ["left", "top", "width", "height"].forEach((k) => nieuw.style.removeProperty(k));
    void nieuw.offsetWidth;
    nieuw.classList.remove("vast");
  }

  // Geen plaatje open: het vak is leeg tot de operator het volgende plaatje toont.
  function rouleer() {
    if (!open) nieuw.classList.add("weg");
  }

  function toon(naam) {
    open = naam;
    terugNaarStart();
    nieuw.textContent = "";
    nieuw.appendChild(kaart(naam));
    nieuw.classList.remove("weg");
  }

  function vlieg(stap, klaar) {
    const vak = document.getElementById(`vak${stap.plek}`);
    if (open !== stap.naam) toon(stap.naam);
    open = null;
    const bord = bordEl.getBoundingClientRect();
    const v = vak.getBoundingClientRect();
    const s = vel.getBoundingClientRect();
    const factor = 1080 / s.width;
    nieuw.style.left = `${(v.left - s.left) * factor}px`;
    nieuw.style.top = `${(v.top - s.top) * factor}px`;
    nieuw.style.width = `${v.width * factor}px`;
    nieuw.style.height = `${v.height * factor}px`;
    void bord;
    window.setTimeout(() => {
      plekken[stap.plek - 1] = stap.naam;
      tekenBord();
      nieuw.classList.add("weg");
      klaar();
    }, VLIEG_MS);
  }

  // Zonder animatie naar de stand na n stappen (bij terugklikken of een nieuwe tekst).
  function zetStand(n) {
    plekken = new Array(PLEKKEN).fill(null);
    open = null;
    stappen.slice(0, n).forEach((stap) => {
      if (stap.soort === "plaatje") open = stap.naam;
      else { plekken[stap.plek - 1] = stap.naam; open = null; }
    });
    gedaan = n;
    tekenBord();
    if (open) toon(open); else rouleer();
  }

  function speel() {
    if (bezig) return;
    if (doel < gedaan) { zetStand(doel); return; }
    if (doel === gedaan) return;
    bezig = true;
    const stap = stappen[gedaan];
    const verder = () => { gedaan += 1; bezig = false; if (doel === gedaan) { if (!open) rouleer(); } else speel(); };
    if (stap.soort === "plaatje") { toon(stap.naam); window.setTimeout(verder, doel - gedaan > 1 ? 500 : 0); }
    else vlieg(stap, verder);
  }

  // Tot welke stap het bord mag: een plaatje pas na de druk van de operator; een plek zodra de
  // speler bij die regel is, of eerder als de operator het volgende plaatje al toont.
  function doelVoor(cueIndex, getoond) {
    let n = 0;
    let plaatjes = 0;
    for (const stap of stappen) {
      if (stap.soort === "plaatje") {
        if (plaatjes >= getoond) break;
        plaatjes += 1;
      } else if (stap.cue > cueIndex && plaatjes >= getoond) break;
      n += 1;
    }
    return n;
  }

  function verwerk(payload) {
    if (!payload || !payload.ok) return;
    const tp = payload.teleprompt || null;
    const scene = payload.preparedScene || null;
    const show = payload.show || null;
    const live = !!(show && show.active === true && scene && scene.status === "playing");
    const heeftBord = !!(tp && tp.bord && Array.isArray(tp.bord.namen) && tp.bord.namen.length);
    if (!live || !heeftBord) {
      vel.classList.remove("aan");
      sleutel = "";
      return;
    }
    const nieuweSleutel = `${tp.version || 0}:${tp.title || ""}:${(tp.lines || []).length}`;
    const cueIndex = Number(payload.cue && payload.cue.index || 0);
    const getoond = Number(payload.bord && payload.bord.getoond || 0);
    if (nieuweSleutel !== sleutel) {
      sleutel = nieuweSleutel;
      stappen = (tp.bord.begin || []).map((stap) => ({ ...stap, cue: 0 }));
      (tp.lines || []).forEach((line, i) => {
        (line.bord || []).forEach((stap) => stappen.push({ ...stap, cue: i + 1 }));
      });
      bezig = false;
      doel = doelVoor(cueIndex, getoond);
      zetStand(doel);
      vel.classList.add("aan");
      return;
    }
    vel.classList.add("aan");
    doel = doelVoor(cueIndex, getoond);
    speel();
  }

  async function haal() {
    try {
      const response = await fetch("/v0/script-agent/teleprompter-parser/current", { cache: "no-store" });
      verwerk(await response.json());
    } catch {}
  }

  window.addEventListener("resize", schaal);
  schaal();
  if (window.EventSource) {
    const events = new EventSource("/v0/script-agent/teleprompter-parser/events");
    events.onmessage = (event) => { try { verwerk(JSON.parse(event.data)); } catch {} };
  }
  haal();
  window.setInterval(haal, 500);
})();
