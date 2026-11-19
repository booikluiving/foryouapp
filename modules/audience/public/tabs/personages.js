// Personagestab op de publiekstelefoon: alle personages van de run in één scherm, elk op een vaste plek.
// Nog niet gespeeld = vak met een vraagteken (de telefoon weet dan alleen het totaal). Eén tik = een klein
// kaartje over het rooster; naast het kaartje tikken sluit het. De stand komt in zijn geheel (hello en
// bericht "personages") en vervangt steeds alles. Afspraken: public/tabs/LEESMIJ.md.
(function () {
  "use strict";

  var CSS = [
    ".pk{flex:1 1 auto;min-height:0;display:flex;flex-direction:column;position:relative}",
    ".pk-kop{display:flex;align-items:baseline;justify-content:space-between;gap:12px;padding:2px 0 8px}",
    ".pk-kop h2{margin:0;font-size:13px;font-weight:700;letter-spacing:.16em;text-transform:uppercase}",
    ".pk-teller{font-variant-numeric:tabular-nums;color:var(--b);font-size:13px;letter-spacing:.06em}",
    ".pk-teller b{color:var(--a)}",
    ".pk-leeg{color:var(--b);font-size:14px;padding:0 0 10px}",
    ".pk-rooster{flex:1 1 0;min-height:0;display:grid;grid-template-columns:repeat(var(--kol,6),var(--vakb,1fr));gap:4px;justify-content:center;align-content:center;padding:5px}",
    ".pk-vak{position:relative;display:flex;flex-direction:column;border:1px solid var(--c);background:rgba(255,255,255,.04);padding:2px;min-width:0;text-align:left}",
    ".pk-portret{aspect-ratio:1/1;position:relative;overflow:hidden;background:var(--bg)}",
    ".pk-portret img{width:100%;height:100%;object-fit:cover;object-position:50% 20%;display:block}",
    ".pk-letters{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font-size:calc(var(--vakpx,56px)*.38);font-weight:300;color:var(--b)}",
    ".pk-balk{margin-top:2px;min-height:var(--balk,14px);display:flex;align-items:center;justify-content:center;background:var(--bg);font-size:var(--balkletter,8px);font-weight:700;letter-spacing:.06em;text-transform:uppercase;line-height:1.1;padding:1px 2px;text-align:center}",
    ".pk-balk span{overflow-wrap:anywhere;hyphens:auto}",
    ".pk-dicht{border-color:var(--d);cursor:default}",
    ".pk-dicht .pk-balk{color:transparent}",
    ".pk-dicht .pk-portret{background:repeating-linear-gradient(135deg,rgba(255,255,255,.04) 0 6px,var(--bg) 6px 7px)}",
    ".pk-dicht .pk-portret::after{content:'?';position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font-size:calc(var(--vakpx,56px)*.55);font-weight:200;color:var(--c)}",
    ".pk-gekozen{border-color:var(--a);box-shadow:inset 0 0 0 1px var(--a)}",
    ".pk-nieuw{position:absolute;top:2px;right:2px;width:8px;height:8px;background:var(--a);z-index:1}",
    ".pk-laag{position:absolute;inset:0;z-index:5;display:flex;align-items:center;justify-content:center;background:rgba(7,8,11,.5);padding:12px}",
    ".pk-kaart{width:min(290px,88%);max-height:72%;overflow-y:auto;overscroll-behavior:contain;background:var(--bg);border:1px solid var(--a);padding:4px}",
    ".pk-boven{display:grid;grid-template-columns:92px minmax(0,1fr);gap:10px}",
    ".pk-foto{aspect-ratio:3/4;position:relative;overflow:hidden;background:rgba(255,255,255,.04)}",
    ".pk-foto img{width:100%;height:100%;object-fit:cover;object-position:50% 25%;display:block}",
    ".pk-foto .pk-letters{font-size:30px}",
    ".pk-naamkop{display:flex;flex-direction:column;gap:6px;padding-top:4px;min-width:0}",
    ".pk-naamkop h3{margin:0;font-size:17px;line-height:1.05;font-weight:700;letter-spacing:.03em;text-transform:uppercase;overflow-wrap:anywhere}",
    ".pk-speler{font-size:12px;color:var(--b)}",
    ".pk-tekst{padding:10px 6px 6px;display:grid;gap:10px}",
    ".pk-tekst p{margin:0;font-size:13px;color:var(--b);white-space:pre-line}",
    ".pk-label{font-size:10px;letter-spacing:.1em;text-transform:uppercase;color:var(--c);margin-bottom:4px}",
    ".pk-tekst ol{margin:0;padding:0;list-style:none;display:grid;gap:4px}",
    ".pk-tekst li{font-size:12px;display:grid;grid-template-columns:1.8em 1fr;gap:4px}",
    ".pk-tekst li span{color:var(--c);font-variant-numeric:tabular-nums}",
    ".pk-nog{font-size:12px;color:var(--c)}",
    ".pk-pijlen{display:flex;justify-content:space-between;border-top:1px solid var(--d);margin-top:4px}",
    ".pk-pijlen button{padding:8px 12px;font-size:16px;color:var(--b)}",
    ".pk-pijlen button:disabled{opacity:.25}",
    "@keyframes pk-onthul{from{clip-path:inset(0 0 100% 0)}to{clip-path:inset(0 0 0 0)}}",
    ".pk-net .pk-portret>*{animation:pk-onthul .7s cubic-bezier(.2,.7,.2,1)}",
    "@media (prefers-reduced-motion:reduce){.pk-net .pk-portret>*{animation:none}}",
  ].join("\n");

  var vlak = null, api = null, wortel = null, rooster = null, laag = null, teller = null, leeg = null;
  var stand = null;
  var open = null;
  var nieuw = {};
  var gezien = null; // ids die er al waren bij de eerste stand van deze run
  var zichtbaarNu = false;
  var x0 = null;

  function maak(tag, cls, tekst) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (tekst != null) e.textContent = tekst;
    return e;
  }
  function kort(naam) { return String(naam || "").replace(/([a-z])([A-Z])/g, "$1 $2"); }
  function letters(naam) {
    return String(naam || "").replace(/[^A-Za-zÀ-ÿ ]/g, " ").trim().split(/\s+/).slice(0, 2)
      .map(function (w) { return w.charAt(0); }).join("").toUpperCase() || "?";
  }
  function beeld(v, houder) {
    houder.textContent = "";
    var vervang = function () { houder.textContent = ""; houder.appendChild(maak("span", "pk-letters", letters(v.naam))); };
    if (!v.foto) { vervang(); return; }
    var img = document.createElement("img");
    img.alt = "";
    img.decoding = "async";
    img.loading = "lazy";
    img.onerror = vervang;
    img.src = v.foto;
    houder.appendChild(img);
  }
  function spelerTekst(v) {
    return v.speler && v.speler.length ? "Gespeeld door " + v.speler.join(" en ") : "";
  }

  // De stand van de server overnemen. Oudere revisie van dezelfde run: negeren. Andere run: alles opnieuw.
  function neem(s) {
    if (!s || typeof s !== "object") return;
    var run = s.run || null;
    if (stand && stand.run === run && Number(s.revisie || 0) <= Number(stand.revisie || 0)) return;
    var andereRun = !stand || stand.run !== run;
    var vrij = Array.isArray(s.vrij) ? s.vrij.filter(function (v) { return v && typeof v.id === "string"; }) : [];
    if (andereRun) { nieuw = {}; open = null; gezien = null; }
    if (gezien === null) {
      gezien = {};
      vrij.forEach(function (v) { gezien[v.id] = true; });
    } else {
      vrij.forEach(function (v) { if (!gezien[v.id]) { gezien[v.id] = true; nieuw[v.id] = true; } });
    }
    stand = { run: run, revisie: Number(s.revisie || 0), totaal: Math.max(0, Math.min(200, Number(s.totaal) || 0)), vrij: vrij };
    if (open && !vrij.some(function (v) { return v.id === open; })) open = null;
    teken();
  }

  function vakVoor(v) {
    if (!v) {
      var dicht = maak("div", "pk-vak pk-dicht");
      dicht.setAttribute("aria-label", "Nog niet vrijgespeeld");
      dicht.appendChild(maak("div", "pk-portret"));
      dicht.appendChild(maak("div", "pk-balk", "·"));
      return dicht;
    }
    var knop = maak("button", "pk-vak" + (open === v.id ? " pk-gekozen" : "") + (nieuw[v.id] ? " pk-net" : ""));
    knop.type = "button";
    knop.setAttribute("aria-label", v.naam);
    knop.dataset.id = v.id;
    var portret = maak("div", "pk-portret");
    beeld(v, portret);
    knop.appendChild(portret);
    if (nieuw[v.id]) knop.appendChild(maak("span", "pk-nieuw"));
    var balk = maak("div", "pk-balk");
    balk.appendChild(maak("span", null, kort(v.naam)));
    knop.appendChild(balk);
    return knop;
  }

  function teken() {
    if (!wortel || !stand) return;
    teller.innerHTML = "";
    var b = maak("b", null, String(stand.vrij.length));
    teller.appendChild(b);
    teller.appendChild(document.createTextNode(" / " + stand.totaal));
    leeg.hidden = !!stand.vrij.length;
    var vakken = [];
    for (var i = 0; i < stand.totaal; i++) vakken.push(null);
    stand.vrij.forEach(function (v) {
      var p = Number(v.plek);
      if (p >= 0 && p < vakken.length && !vakken[p]) vakken[p] = v;
      else vakken.push(v);
    });
    rooster.textContent = "";
    var frag = document.createDocumentFragment();
    vakken.forEach(function (v) { frag.appendChild(vakVoor(v)); });
    rooster.appendChild(frag);
    pas();
    tekenKaart();
    // De onthulling één keer; het witte blokje blijft tot je tikt.
    setTimeout(function () {
      var net = rooster.querySelectorAll(".pk-net");
      for (var k = 0; k < net.length; k++) net[k].classList.remove("pk-net");
    }, 800);
  }

  // Alle vakken in één scherm: kies het aantal kolommen waarbij het vak zo groot mogelijk is.
  function pas() {
    if (!rooster || !zichtbaarNu) return;
    var n = rooster.children.length;
    var W = rooster.clientWidth - 10, H = rooster.clientHeight - 10, gat = 4;
    if (!n || W <= 0 || H <= 0) return;
    var best = null;
    for (var kol = 3; kol <= 10; kol++) {
      var rijen = Math.ceil(n / kol);
      var breed = (W - gat * (kol - 1)) / kol;
      var balk = Math.max(11, Math.min(18, Math.round(breed * 0.2)));
      // Ruimte voor een naam over twee regels (lange namen worden niet afgekapt).
      var portret = Math.min(breed - 6, (H - gat * (rijen - 1)) / rijen - balk * 1.8 - 2 - 6);
      if (portret < 18) continue;
      if (!best || portret > best.portret) best = { kol: kol, portret: portret, balk: balk };
    }
    if (!best) best = { kol: 8, portret: 18, balk: 11 };
    var st = rooster.style;
    st.setProperty("--kol", best.kol);
    st.setProperty("--vakb", Math.floor(best.portret + 6) + "px");
    st.setProperty("--vakpx", Math.floor(best.portret) + "px");
    st.setProperty("--balk", Math.round(best.balk * 1.8) + "px");
    st.setProperty("--balkletter", Math.max(6.5, Math.min(10, best.balk * 0.58)).toFixed(1) + "px");
  }

  function vrijInVolgorde() {
    return stand ? stand.vrij.slice().sort(function (a, b) { return Number(a.plek) - Number(b.plek); }) : [];
  }

  function tekenKaart() {
    laag.textContent = "";
    laag.hidden = !open;
    if (!open) return;
    var lijst = vrijInVolgorde();
    var i = -1;
    for (var k = 0; k < lijst.length; k++) if (lijst[k].id === open) i = k;
    if (i < 0) { open = null; laag.hidden = true; return; }
    var v = lijst[i];
    var kaart = maak("div", "pk-kaart");
    kaart.setAttribute("role", "dialog");
    kaart.setAttribute("aria-label", v.naam);
    var boven = maak("div", "pk-boven");
    var foto = maak("div", "pk-foto");
    beeld(v, foto);
    var kop = maak("div", "pk-naamkop");
    kop.appendChild(maak("h3", null, kort(v.naam)));
    var sp = spelerTekst(v);
    if (sp) kop.appendChild(maak("div", "pk-speler", sp));
    boven.appendChild(foto);
    boven.appendChild(kop);
    kaart.appendChild(boven);
    var tekst = maak("div", "pk-tekst");
    if (v.beschrijving) tekst.appendChild(maak("p", null, v.beschrijving));
    if (v.scenes && v.scenes.length) {
      var blok = maak("div");
      blok.appendChild(maak("div", "pk-label", "Vanavond gezien in"));
      var ol = maak("ol");
      v.scenes.forEach(function (sc) {
        var li = maak("li");
        li.appendChild(maak("span", null, (sc.nr < 10 ? "0" : "") + sc.nr));
        li.appendChild(document.createTextNode(sc.titel || ""));
        ol.appendChild(li);
      });
      blok.appendChild(ol);
      tekst.appendChild(blok);
    }
    if (v.nog > 0) tekst.appendChild(maak("div", "pk-nog", "Nog " + v.nog + (v.nog === 1 ? " scène" : " scènes") + " die je niet gezien hebt."));
    kaart.appendChild(tekst);
    var pijlen = maak("div", "pk-pijlen");
    [[lijst[i - 1], "←", "Vorige"], [lijst[i + 1], "→", "Volgende"]].forEach(function (p) {
      var knop = maak("button", null, p[1]);
      knop.type = "button";
      knop.setAttribute("aria-label", p[2]);
      if (p[0]) knop.dataset.naar = p[0].id; else knop.disabled = true;
      pijlen.appendChild(knop);
    });
    kaart.appendChild(pijlen);
    laag.appendChild(kaart);
  }

  function kies(id) {
    open = id || null;
    if (id) delete nieuw[id];
    var knoppen = rooster.querySelectorAll(".pk-vak[data-id]");
    for (var k = 0; k < knoppen.length; k++) {
      var aan = knoppen[k].dataset.id === open;
      knoppen[k].classList.toggle("pk-gekozen", aan);
      if (aan) { var stip = knoppen[k].querySelector(".pk-nieuw"); if (stip) stip.remove(); }
    }
    tekenKaart();
  }

  function opBericht(msg) {
    if (!msg) return;
    if (msg.type === "hello") { if (msg.personages) neem(msg.personages); return; }
    if (msg.type === "personages") { neem(msg); return; }
    if (msg.type === "session_closed" || msg.type === "session_reset") {
      stand = null; open = null; nieuw = {}; gezien = null;
      if (rooster) { rooster.textContent = ""; laag.hidden = true; teller.textContent = ""; leeg.hidden = false; }
    }
  }

  ForYouTabs.registreer("personages", {
    berichten: ["personages"],
    start: function (v, a) {
      vlak = v; api = a;
      if (!document.getElementById("pk-stijl")) {
        var stijl = document.createElement("style");
        stijl.id = "pk-stijl";
        stijl.textContent = CSS;
        document.head.appendChild(stijl);
      }
      wortel = maak("div", "pk");
      var kop = maak("div", "pk-kop");
      kop.appendChild(maak("h2", null, "Personages"));
      teller = maak("div", "pk-teller");
      kop.appendChild(teller);
      leeg = maak("div", "pk-leeg", "Na elke scène komen hier de personages bij.");
      rooster = maak("div", "pk-rooster");
      laag = maak("div", "pk-laag");
      laag.hidden = true;
      wortel.appendChild(kop);
      wortel.appendChild(leeg);
      wortel.appendChild(rooster);
      wortel.appendChild(laag);
      vlak.textContent = "";
      vlak.appendChild(wortel);

      rooster.addEventListener("click", function (e) {
        var knop = e.target.closest ? e.target.closest(".pk-vak[data-id]") : null;
        if (knop) kies(knop.dataset.id);
      });
      laag.addEventListener("click", function (e) {
        var naar = e.target.closest ? e.target.closest("[data-naar]") : null;
        if (naar) { kies(naar.dataset.naar); return; }
        // Naast het kaartje tikken sluit het.
        if (e.target === laag) kies(null);
      });
      laag.addEventListener("touchstart", function (e) { x0 = e.touches[0].clientX; }, { passive: true });
      laag.addEventListener("touchend", function (e) {
        if (x0 == null) return;
        var dx = e.changedTouches[0].clientX - x0;
        x0 = null;
        if (Math.abs(dx) < 50) return;
        var knoppen = laag.querySelectorAll(".pk-pijlen button");
        var knop = knoppen[dx > 0 ? 0 : 1];
        if (knop && knop.dataset.naar) kies(knop.dataset.naar);
      });
      if (typeof ResizeObserver === "function") new ResizeObserver(function () { pas(); }).observe(rooster);
      else window.addEventListener("resize", pas);
    },
    bericht: opBericht,
    toon: function () {
      zichtbaarNu = true;
      if (!stand && api) {
        var h = api.laatste("hello");
        if (h && h.personages) neem(h.personages);
      }
      pas();
    },
    verberg: function () { zichtbaarNu = false; },
  });
})();
