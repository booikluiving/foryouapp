// De content warning op het zaalscherm: een zwart vel schuift over het scherm met de tekst van het
// team (Admin), met een geluid erbij; bij START SHOW schuift het weer weg. De eerste regel van de
// tekst is de kop (groot, in kapitalen), de rest staat eronder, alles gecentreerd. Staat los van de
// rest van de pagina: eigen vel, eigen verbinding met de stroom van de publieksdienst.
(function () {
  "use strict";
  const stage = document.getElementById("stage") || document.body;

  const stijl = document.createElement("style");
  stijl.textContent = `
    #waarschuwing {
      position: absolute; inset: 0; z-index: 50; box-sizing: border-box;
      display: flex; flex-direction: column; align-items: center; justify-content: center;
      padding: 120px; background: #07080b; color: #fff; text-align: center;
      font-family: "Helvetica Neue", Helvetica, Arial, sans-serif;
      transform: translateY(-100%);
      transition: transform 520ms cubic-bezier(.65, 0, .35, 1);
      pointer-events: none;
    }
    #waarschuwing.aan { transform: none; }
    #waarschuwingKop {
      width: 100%; text-transform: uppercase; overflow-wrap: break-word;
      font-weight: 700; letter-spacing: -0.045em; line-height: 0.86;
    }
    #waarschuwingTekst {
      width: 100%; margin-top: 90px; overflow-wrap: break-word;
      font-weight: 700; letter-spacing: -0.025em; line-height: 1.12;
    }
    #waarschuwingTekst p { margin: 0; }
    #waarschuwingTekst p + p { margin-top: 0.75em; }
    #waarschuwingTekst:empty { display: none; }
  `;
  document.head.appendChild(stijl);

  const vel = document.createElement("div");
  vel.id = "waarschuwing";
  const kop = document.createElement("div");
  kop.id = "waarschuwingKop";
  const tekst = document.createElement("div");
  tekst.id = "waarschuwingTekst";
  vel.appendChild(kop);
  vel.appendChild(tekst);
  stage.appendChild(vel);

  let timer = null;
  let nu = null;

  // De kop zo groot als in de breedte past, de tekst eronder kleiner; samen blijven ze ruim binnen het scherm.
  function pas() {
    let maat = 190;
    kop.style.fontSize = maat + "px";
    while (maat > 70 && (kop.scrollWidth > kop.clientWidth || kop.scrollHeight > 520)) {
      maat -= 6;
      kop.style.fontSize = maat + "px";
    }
    let klein = 52;
    tekst.style.fontSize = klein + "px";
    while (klein > 28 && kop.scrollHeight + tekst.scrollHeight > 1400) {
      klein -= 2;
      tekst.style.fontSize = klein + "px";
    }
  }

  // Het geluid bij het verschijnen: een doffe klap, een lage dreun en twee lage stoten, uit de
  // geluidsmotor van het zaalscherm (volume uit Admin). Zonder die motor blijft het stil.
  function klink() {
    try {
      const klik = window.klik, toon = window.toon;
      if (typeof klik !== "function" || typeof toon !== "function") return;
      klik({ hoogte: 700, scherpte: 3, duur: 0.04, sterkte: 0.6, dof: 85 });
      toon({ hoogte: 110, naar: 73, duur: 1.1, sterkte: 0.5, inzet: 0.02 });
      [0.05, 0.5].forEach((wanneer) => toon({ hoogte: 233, duur: 0.3, sterkte: 0.5, inzet: 0.012, wanneer }));
    } catch (_err) {}
  }

  function weg() {
    clearTimeout(timer);
    timer = null;
    nu = null;
    vel.classList.remove("aan");
  }

  function laatZien(w) {
    if (!w || !String(w.tekst || "").trim() || w.waar === "telefoons") { weg(); return; }
    if (nu === w.id) return;
    clearTimeout(timer);
    nu = w.id;
    const regels = String(w.tekst).split("\n").map((regel) => regel.trim()).filter(Boolean);
    kop.textContent = regels[0] || "";
    tekst.textContent = "";
    for (const regel of regels.slice(1)) {
      const p = document.createElement("p");
      p.textContent = regel;
      tekst.appendChild(p);
    }
    pas();
    vel.classList.add("aan");
    klink();
    if (Number.isFinite(w.overMs)) timer = setTimeout(weg, Math.max(0, w.overMs));
  }

  const bron = new EventSource("/audience/stage/stroom");
  bron.onmessage = (ev) => {
    let msg;
    try { msg = JSON.parse(ev.data); } catch { return; }
    if (msg.type === "begin") laatZien(msg.waarschuwing || null);
    else if (msg.type === "waarschuwing") laatZien(msg.waarschuwing || null);
  };
})();
