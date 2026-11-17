// De content warning op het zaalscherm: bij START SHOW schuift er een zwart vel over het scherm met
// de tekst van het team (Admin), en na de ingestelde tijd schuift het weer weg. Staat los van de rest
// van de pagina: eigen vel, eigen verbinding met de stroom van de publieksdienst.
(function () {
  "use strict";
  const stage = document.getElementById("stage") || document.body;

  const stijl = document.createElement("style");
  stijl.textContent = `
    #waarschuwing {
      position: absolute; inset: 0; z-index: 50; box-sizing: border-box;
      display: flex; align-items: center;
      padding: 60px; background: #07080b; color: #fff;
      transform: translateY(-100%);
      transition: transform 520ms cubic-bezier(.65, 0, .35, 1);
      pointer-events: none;
    }
    #waarschuwing.aan { transform: none; }
    #waarschuwingTekst {
      width: 100%; white-space: pre-line; overflow-wrap: break-word;
      font-family: "Helvetica Neue", Helvetica, Arial, sans-serif;
      font-weight: 700; letter-spacing: -0.025em; line-height: 1.02;
    }
  `;
  document.head.appendChild(stijl);

  const vel = document.createElement("div");
  vel.id = "waarschuwing";
  const tekst = document.createElement("div");
  tekst.id = "waarschuwingTekst";
  vel.appendChild(tekst);
  stage.appendChild(vel);

  let timer = null;
  let nu = null;

  // De letter is zo groot als past: een korte tekst staat groot, een lange kleiner.
  function pas() {
    let maat = 120;
    tekst.style.fontSize = maat + "px";
    while (maat > 34 && tekst.scrollHeight > 1800) {
      maat -= 4;
      tekst.style.fontSize = maat + "px";
    }
  }

  function weg() {
    clearTimeout(timer);
    timer = null;
    nu = null;
    vel.classList.remove("aan");
  }

  function toon(w) {
    if (!w || !String(w.tekst || "").trim() || w.waar === "telefoons") { weg(); return; }
    if (nu === w.id) return;
    clearTimeout(timer);
    nu = w.id;
    tekst.textContent = String(w.tekst);
    pas();
    vel.classList.add("aan");
    if (Number.isFinite(w.overMs)) timer = setTimeout(weg, Math.max(0, w.overMs));
  }

  const bron = new EventSource("/audience/stage/stroom");
  bron.onmessage = (ev) => {
    let msg;
    try { msg = JSON.parse(ev.data); } catch { return; }
    if (msg.type === "begin") toon(msg.waarschuwing || null);
    else if (msg.type === "waarschuwing") toon(msg.waarschuwing || null);
  };
})();
