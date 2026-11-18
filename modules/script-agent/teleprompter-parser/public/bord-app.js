(function () {
  "use strict";

  // Bord 1 t/m 5 (blind ranking). De operator zet het bord aan met de knop (payload.bord.aan);
  // tot dan is er niets te zien. Daarna volgt het de tekst van de teleprompter: de bordstappen
  // hangen aan de regels (line.bord) en gaan af zodra de speler die regel bereikt. Tussen twee
  // plaatjes rouleert het vak door alles wat nog niet op het bord staat.
  const PLEKKEN = 5;
  const VLIEG_MS = 430;
  const ROL_MS = 90;
  const START_ROL_MS = 2500; // na BORD AAN eerst even rouleren, ook als het eerste plaatje al vaststaat
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
  let namen = [];
  let gedaan = 0;          // hoeveel stappen al in beeld zijn
  let plekken = new Array(PLEKKEN).fill(null);
  let open = null;
  let bezig = false;
  let rol = null;
  let rolIndex = 0;
  let doel = 0;
  let stil = false;        // zetStand springt zonder geluid

  // Geluid: kaarten schudden zolang het vak rouleert, een kaart neerleggen als het stilstaat of landt.
  const schudden = new Audio("/script-agent/teleprompter-parser/geluid/schudden.wav");
  schudden.loop = true;
  schudden.volume = 0.5;
  function leg() {
    if (stil) return;
    const klap = new Audio("/script-agent/teleprompter-parser/geluid/leg.wav");
    klap.volume = 0.9;
    klap.play().catch(() => {});
  }

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

  const over = () => namen.filter((naam) => !plekken.includes(naam) && naam !== open);

  function stopRol() {
    if (rol) window.clearInterval(rol);
    rol = null;
    schudden.pause();
  }

  function terugNaarStart() {
    nieuw.classList.add("vast");
    ["left", "top", "width", "height"].forEach((k) => nieuw.style.removeProperty(k));
    void nieuw.offsetWidth;
    nieuw.classList.remove("vast");
  }

  // Elk plaatje dat nog over is staat klaar in het vak; rouleren is alleen wisselen welke bovenop ligt.
  function rouleer() {
    stopRol();
    const rest = over();
    if (!rest.length || open) {
      if (!open) nieuw.classList.add("weg");
      return;
    }
    terugNaarStart();
    nieuw.textContent = "";
    const kaarten = rest.map((naam) => {
      const el = kaart(naam);
      el.style.visibility = "hidden";
      nieuw.appendChild(el);
      return el;
    });
    nieuw.classList.remove("weg");
    const tik = () => {
      rolIndex = (rolIndex + 1) % kaarten.length;
      kaarten.forEach((el, i) => { el.style.visibility = i === rolIndex ? "visible" : "hidden"; });
    };
    tik();
    if (kaarten.length > 1) {
      rol = window.setInterval(tik, ROL_MS);
      if (!stil) schudden.play().catch(() => {});
    }
  }

  function toon(naam) {
    stopRol();
    open = naam;
    terugNaarStart();
    nieuw.textContent = "";
    nieuw.appendChild(kaart(naam));
    nieuw.classList.remove("weg");
    leg();
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
      leg();
      nieuw.classList.add("weg");
      klaar();
    }, VLIEG_MS);
  }

  // Zonder animatie naar de stand na n stappen (bij terugklikken of een nieuwe tekst).
  function zetStand(n) {
    stopRol();
    plekken = new Array(PLEKKEN).fill(null);
    open = null;
    stappen.slice(0, n).forEach((stap) => {
      if (stap.soort === "plaatje") open = stap.naam;
      else { plekken[stap.plek - 1] = stap.naam; open = null; }
    });
    gedaan = n;
    tekenBord();
    stil = true;
    if (open) toon(open); else rouleer();
    stil = false;
    if (rol && vel.classList.contains("aan")) schudden.play().catch(() => {});
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

  function verwerk(payload) {
    if (!payload || !payload.ok) return;
    const tp = payload.teleprompt || null;
    const scene = payload.preparedScene || null;
    const show = payload.show || null;
    const live = !!(show && show.active === true && scene && scene.status === "playing");
    const heeftBord = !!(tp && tp.bord && Array.isArray(tp.bord.namen) && tp.bord.namen.length);
    const aan = !!(payload.bord && payload.bord.aan);
    if (!live || !heeftBord || !aan) {
      vel.classList.remove("aan");
      stopRol();
      sleutel = "";
      return;
    }
    const nieuweSleutel = `${tp.version || 0}:${tp.title || ""}:${(tp.lines || []).length}`;
    const cueIndex = Number(payload.cue && payload.cue.index || 0);
    if (nieuweSleutel !== sleutel) {
      sleutel = nieuweSleutel;
      namen = tp.bord.namen.slice();
      stappen = (tp.bord.begin || []).map((stap) => ({ ...stap, cue: 0 }));
      (tp.lines || []).forEach((line, i) => {
        (line.bord || []).forEach((stap) => stappen.push({ ...stap, cue: i + 1 }));
      });
      bezig = false;
      doel = stappen.filter((stap) => stap.cue <= cueIndex).length;
      const vers = !vel.classList.contains("aan");
      zetStand(doel);
      vel.classList.add("aan");
      if (vers && open) {
        // Net aangezet en er staat al een plaatje klaar: eerst rouleren, dan pas stilstaan.
        const naam = open;
        open = null;
        rouleer();
        bezig = true;
        window.setTimeout(() => {
          bezig = false;
          if (sleutel === nieuweSleutel) { toon(naam); speel(); }
        }, START_ROL_MS);
      }
      return;
    }
    vel.classList.add("aan");
    doel = stappen.filter((stap) => stap.cue <= cueIndex).length;
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
