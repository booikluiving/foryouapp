// Tab "for_youniverse" op de publiekstelefoon (schil: index.html, afspraken: tabs/LEESMIJ.md).
// Zoveel mogelijk hetzelfde beeld als het universum op het zaalscherm (paths/universe/public/sky-renderer.js):
// - gespeeld = open ring, vrij = witte ster met gloed, speelt nu = grotere witte ster, op slot = flauwe stip;
//   lijnen wit, helder aan wat speelt, half tussen gespeeld en vrij, heel flauw naar wat dicht is;
// - twee standen, met één vloeiende overgang ertussen (Booi, 19 nov): vóór de keuze het hele universum,
//   na de keuze (en tijdens de scène) de camera op het pad van de avond: stappen helder, de laatste
//   gestippeld, een gestippelde kring om de scène, de rest flauw. Nieuwe scènes komen er in die
//   overgang bij;
// - bij de stemming op de startscène lichten koplopers en winnaar op.
// De server bepaalt wanneer (server/universum.js volgt de stappen van het zaalscherm). De kaart (alleen
// nummers, posities, bochten, maten) wordt één keer opgehaald. Licht: geen filters, alleen een lus
// tijdens de camerabeweging, en dan wordt alleen de camera verschoven.
(function () {
  "use strict";
  var NS = "http://www.w3.org/2000/svg";
  var OVERGANG_MS = 900, FADE_PAD = 0.16;
  var CSS = [
    ".uv{position:relative;flex:1 1 auto;min-height:0;display:flex;flex-direction:column;overflow:hidden}",
    ".uv-balk{padding:9px 16px;font-size:13px;color:var(--b);border-bottom:1px solid var(--d);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;min-height:16px}",
    ".uv-balk b{color:var(--a);font-weight:500}",
    ".uv-blad{position:relative;flex:1 1 auto;min-height:0;overflow:hidden}",
    ".uv svg{width:100%;height:100%;display:block;touch-action:none;user-select:none;-webkit-user-select:none}",
    ".uv path,.uv circle{vector-effect:non-scaling-stroke}",
    ".uv .lijn{fill:none;stroke:#fff;stroke-linecap:round;transition:opacity " + OVERGANG_MS + "ms ease}",
    ".uv .st,.uv .halo{transition:opacity " + OVERGANG_MS + "ms ease}",
    ".uv .halo{fill:url(#uv-halo);pointer-events:none}",
    ".uv .padlijn{fill:none;stroke:#fff;stroke-width:2.2;stroke-linecap:round;animation:uvIn " + OVERGANG_MS + "ms ease 1 both}",
    ".uv .padlijn.laatste{stroke-dasharray:7 6}",
    ".uv .kring{fill:none;stroke:#fff;stroke-width:1.8;stroke-dasharray:5 5;animation:uvIn " + OVERGANG_MS + "ms ease 1 both}",
    ".uv .hoeken{fill:none;stroke:#fff;stroke-width:1.6;stroke-linecap:butt;stroke-linejoin:miter}",
    "@keyframes uvIn{from{opacity:0}to{opacity:1}}",
    ".uv.stil .lijn,.uv.stil .st,.uv.stil .halo{transition:none}",
    ".uv.stil .padlijn,.uv.stil .kring{animation:none}",
    "@media (prefers-reduced-motion:reduce){.uv .lijn,.uv .st,.uv .halo{transition:none}.uv .padlijn,.uv .kring{animation:none}.uv-sheet{transition:none}}",
    ".uv-titel{position:absolute;transform:translate(-50%,-100%);color:#fff;font-size:14px;font-weight:500;line-height:1.2;text-align:center;max-width:70%;pointer-events:none;text-shadow:0 0 6px #000,0 0 3px #000}",
    ".uv-zoom{position:absolute;right:12px;bottom:12px;display:flex;flex-direction:column;gap:6px}",
    ".uv-zoom button{width:40px;height:40px;border:1px solid var(--c);background:var(--bg);color:var(--a);font-size:18px;cursor:pointer;padding:0}",
    ".uv-leg{position:absolute;left:12px;bottom:12px;display:grid;gap:4px;font-size:11px;color:var(--b);pointer-events:none}",
    ".uv-leg span{display:flex;align-items:center;gap:6px}",
    ".uv-leg i{width:9px;height:9px;border-radius:50%;display:inline-block;box-sizing:border-box}",
    ".uv-sheet{position:absolute;left:0;right:0;bottom:0;max-height:75%;overflow-y:auto;background:var(--bg);border-top:1px solid var(--a);padding:14px 18px 20px;transform:translateY(105%);transition:transform .22s ease-out}",
    ".uv-sheet.open{transform:none}",
    ".uv-sluit{position:absolute;right:12px;top:8px;background:none;border:0;color:var(--b);font-size:24px;cursor:pointer;padding:4px 8px}",
    ".uv-beeld{display:block;width:100%;height:150px;object-fit:cover;margin:12px 0 2px;background:rgba(255,255,255,.04)}",
    ".uv-chip{display:inline-block;font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:var(--b)}",
    ".uv-chip.nu,.uv-chip.klaar{color:var(--a)}",
    ".uv-sheet h2{font-size:20px;font-weight:500;margin:10px 0 12px;line-height:1.2;text-wrap:balance}",
    ".uv-sheet dl{margin:0}",
    ".uv-rij{display:grid;grid-template-columns:78px 1fr;gap:8px;font-size:14px;padding:7px 0;border-top:1px solid var(--d)}",
    ".uv-rij dt{color:var(--b)}.uv-rij dd{margin:0;min-width:0}",
    ".uv-wacht{position:absolute;inset:0;display:grid;place-items:center;color:var(--b);font-size:14px;pointer-events:none}",
  ].join("\n");

  function maak(tag, klasse, tekst) {
    var e = document.createElement(tag);
    if (klasse) e.className = klasse;
    if (tekst != null) e.textContent = tekst;
    return e;
  }
  function svgEl(tag, attrs) {
    var e = document.createElementNS(NS, tag);
    for (var k in attrs) e.setAttribute(k, attrs[k]);
    return e;
  }
  function lees(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function bewaar(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }
  function sleutel(a, b) { return a < b ? a + "-" + b : b + "-" + a; }

  var LABEL = { nu: "Speelt nu", gespeeld: "Gespeeld", klaar: "Volgende scène", vrij: "Vrijgespeeld" };

  var tab = {
    berichten: ["universum"],
    kaart: null, stand: null, wachtend: null, afgelopen: false, ophalen: null,
    S: new Map(), ster: new Map(), lijnen: [], rand: new Map(),
    cam: { x: 0, y: 0, s: 1 }, basis: { x: -400, y: -400, w: 800, h: 800 },
    gekozen: 0, // getikt door de kijker
    lus: 0,

    start: function (vlak) {
      var self = this;
      if (!document.getElementById("uv-stijl")) {
        var st = document.createElement("style");
        st.id = "uv-stijl";
        st.textContent = CSS;
        document.head.appendChild(st);
      }
      var root = maak("div", "uv");
      this.root = root;
      this.balk = maak("div", "uv-balk");
      var blad = maak("div", "uv-blad");
      this.svg = svgEl("svg", { viewBox: "-400 -400 800 800", "aria-label": "for_youniverse" });
      // Gloed zonder filter: een zachte witte kring onder de ster (zoals het gloedplaatje op het zaalscherm).
      var defs = svgEl("defs", {});
      var verloop = svgEl("radialGradient", { id: "uv-halo" });
      [["0", "1"], ["0.25", "0.55"], ["1", "0"]].forEach(function (p) { verloop.appendChild(svgEl("stop", { offset: p[0], "stop-color": "#fff", "stop-opacity": p[1] })); });
      defs.appendChild(verloop);
      this.svg.appendChild(defs);
      this.camG = svgEl("g", {});
      this.lLijnen = svgEl("g", {}); this.lPad = svgEl("g", {}); this.lHalo = svgEl("g", {});
      this.lSterren = svgEl("g", {}); this.lKring = svgEl("g", {}); this.lMerk = svgEl("g", {});
      this.camG.append(this.lLijnen, this.lPad, this.lHalo, this.lSterren, this.lKring, this.lMerk);
      this.svg.appendChild(this.camG);
      this.titel = maak("div", "uv-titel");
      this.titel.hidden = true;
      this.wachtEl = maak("div", "uv-wacht", "Universum laden…");
      var leg = maak("div", "uv-leg");
      leg.setAttribute("aria-hidden", "true");
      [["border:1.5px solid #fff", "gespeeld"], ["background:#fff;box-shadow:0 0 6px #fff", "vrij"],
        ["background:rgba(255,255,255,.16)", "op slot"]].forEach(function (r) {
        var s = maak("span"); var i = maak("i"); i.setAttribute("style", r[0]); s.append(i, r[1]); leg.append(s);
      });
      var zoom = maak("div", "uv-zoom");
      var zIn = maak("button", "", "+"), zUit = maak("button", "", "−"), zMid = maak("button", "", "◎");
      [zIn, zUit, zMid].forEach(function (b) { b.type = "button"; });
      zIn.setAttribute("aria-label", "Inzoomen"); zUit.setAttribute("aria-label", "Uitzoomen"); zMid.setAttribute("aria-label", "Zoals op het scherm");
      zIn.onclick = function () { self.camNaar({ x: self.cam.x, y: self.cam.y, s: Math.min(8, self.cam.s * 1.4) }, 300); };
      zUit.onclick = function () { self.camNaar({ x: self.cam.x, y: self.cam.y, s: Math.max(0.8, self.cam.s / 1.4) }, 300); };
      zMid.onclick = function () { self.regieCam(500); };
      zoom.append(zIn, zUit, zMid);
      this.sheet = maak("div", "uv-sheet");
      this.sheet.setAttribute("role", "dialog");
      var sluit = maak("button", "uv-sluit", "×");
      sluit.type = "button"; sluit.setAttribute("aria-label", "Sluiten");
      sluit.onclick = function () { self.sluit(); };
      this.sInhoud = maak("div");
      this.sheet.append(sluit, this.sInhoud);
      blad.append(this.svg, this.titel, this.wachtEl, leg, zoom, this.sheet);
      root.append(this.balk, blad);
      vlak.textContent = "";
      vlak.appendChild(root);
      this.koppelGebaren();
      this.laadKaart(null);
    },

    bericht: function (msg) {
      if (!msg) return;
      if (msg.type === "hello") { this.afgelopen = false; if (msg.universum) this.ontvang(msg.universum); return; }
      if (msg.type === "universum") { this.ontvang(msg); return; }
      if (msg.type === "session_closed") { this.afgelopen = true; if (this.stand) this.zetBalk(); }
    },
    toon: function () {
      if (!this.root) return;
      this.root.classList.remove("uit");
      this.schaal();
    },
    verberg: function () {
      if (!this.root) return;
      this.root.classList.add("uit");
      if (this.lus) { cancelAnimationFrame(this.lus); this.lus = 0; this.regieCam(0); }
    },

    /* ---------- kaart ---------- */
    laadKaart: function (versie) {
      var self = this;
      if (this.kaart && (!versie || this.kaart.versie === versie)) return;
      if (versie) {
        try { var k = JSON.parse(lees("fy-universum-kaart") || "null"); if (k && k.versie === versie) { this.zetKaart(k); return; } } catch (e) {}
      }
      if (this.ophalen) return;
      this.ophalen = fetch("/audience/universum/kaart" + (versie ? "?v=" + encodeURIComponent(versie) : ""), { credentials: "same-origin" })
        .then(function (r) { if (!r.ok) throw new Error("http " + r.status); return r.json(); })
        .then(function (k) {
          if (!k || !k.ok) throw new Error("leeg");
          bewaar("fy-universum-kaart", JSON.stringify(k));
          self.ophalen = null;
          self.zetKaart(k);
        })
        .catch(function () {
          self.ophalen = null;
          setTimeout(function () { self.laadKaart(self.stand && self.stand.kaart); }, 4000);
        });
    },

    zetKaart: function (k) {
      var self = this;
      this.kaart = k; this.S = new Map(); this.ster = new Map(); this.lijnen = []; this.rand = new Map();
      [this.lLijnen, this.lPad, this.lHalo, this.lSterren, this.lKring, this.lMerk].forEach(function (g) { g.textContent = ""; });
      this.padSleutel = ""; this.kring = null;
      var minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
      k.s.forEach(function (r) {
        self.S.set(r[0], { id: r[0], x: r[1], y: r[2], r: Number(r[3]) || 4 });
        minX = Math.min(minX, r[1]); maxX = Math.max(maxX, r[1]); minY = Math.min(minY, r[2]); maxY = Math.max(maxY, r[2]);
      });
      this.basis = { x: minX - 40, y: minY - 40, w: maxX - minX + 80, h: maxY - minY + 80 };
      this.svg.setAttribute("viewBox", this.basis.x + " " + this.basis.y + " " + this.basis.w + " " + this.basis.h);
      this.cam = { x: this.basis.x + this.basis.w / 2, y: this.basis.y + this.basis.h / 2, s: 1 };
      (k.l || []).forEach(function (e) {
        var A = self.S.get(e[0]), B = self.S.get(e[1]);
        if (!A || !B) return;
        var heen, terug;
        if (e.length >= 6 && e[2] != null) {
          heen = "M" + A.x + " " + A.y + "C" + e[2] + " " + e[3] + " " + e[4] + " " + e[5] + " " + B.x + " " + B.y;
          terug = "M" + B.x + " " + B.y + "C" + e[4] + " " + e[5] + " " + e[2] + " " + e[3] + " " + A.x + " " + A.y;
        } else {
          heen = "M" + A.x + " " + A.y + "L" + B.x + " " + B.y;
          terug = "M" + B.x + " " + B.y + "L" + A.x + " " + A.y;
        }
        var l = svgEl("path", { d: heen, "class": "lijn", "stroke-width": ((Number(e[6]) || 1.19) * 0.75).toFixed(2), opacity: "0.09" });
        self.lLijnen.appendChild(l);
        var rij = { a: e[0], b: e[1], l: l, heen: heen, terug: terug };
        self.lijnen.push(rij);
        self.rand.set(sleutel(e[0], e[1]), rij);
      });
      k.s.forEach(function (r) {
        var h = svgEl("circle", { cx: r[1], cy: r[2], r: 1, "class": "halo", opacity: "0" });
        var c = svgEl("circle", { cx: r[1], cy: r[2], r: 3, "class": "st" });
        self.lHalo.appendChild(h);
        self.lSterren.appendChild(c);
        self.ster.set(r[0], { c: c, h: h, maat: Number(r[3]) || 4, gloed: 0 });
      });
      this.wachtEl.hidden = true;
      this.stil(true);
      if (this.wachtend) { var w = this.wachtend; this.wachtend = null; this.ontvang(w); }
      else if (this.stand) { this.teken(); this.regieSleutel = this.pad().join(","); this.regieCam(0); }
      else this.zetCam();
    },

    /* ---------- stand ---------- */
    open: function (id) {
      var s = this.stand;
      if (!s) return false;
      return id === s.nu || id === s.klaar || s.gespeeld.indexOf(id) >= 0 || s.vrij.indexOf(id) >= 0;
    },
    staat: function (id) {
      var s = this.stand;
      if (!s) return "slot";
      if (id === s.nu) return "nu";
      if (s.gespeeld.indexOf(id) >= 0) return "gespeeld";
      if (id === s.klaar) return "klaar";
      if (s.vrij.indexOf(id) >= 0) return "vrij";
      return "slot";
    },
    info: function (id) { return (this.stand && this.stand.kaartjes && this.stand.kaartjes[id]) || null; },
    zichtbaar: function () { return !!(this.root && !this.root.classList.contains("uit") && !document.hidden); },
    // Zonder overgangen (eerste beeld, nieuwe run, niemand kijkt): meteen de eindstand.
    stil: function (aan) {
      if (!this.root) return;
      this.root.classList.toggle("stil", !!aan);
      if (aan) { void this.root.offsetWidth; var self = this; requestAnimationFrame(function () { requestAnimationFrame(function () { self.root.classList.remove("stil"); }); }); }
    },

    ontvang: function (m) {
      if (!m || m.type !== "universum" || !Array.isArray(m.gespeeld)) return;
      var vorig = this.stand;
      if (vorig && m.bron === vorig.bron && m.run === vorig.run && m.v <= vorig.v) return; // oud of dubbel
      if (!this.kaart || (m.kaart && this.kaart.versie !== m.kaart)) {
        this.wachtend = m;
        this.laadKaart(m.kaart);
        return;
      }
      var nieuweRun = !vorig || m.run !== vorig.run || vorig.gespeeld.some(function (id) { return m.gespeeld.indexOf(id) < 0; });
      if (nieuweRun) this.gekozen = 0;
      this.stand = m;
      var vloeiend = !nieuweRun && this.zichtbaar();
      if (!vloeiend) this.stil(true);
      // Eén vloeiende overgang: sterren en lijnen faden naar hun nieuwe stand. De camera gaat alleen mee
      // als de stand van de zaal verandert (hele universum ↔ pad, of een ander pad); een stem of een
      // ander klein bericht laat de camera staan waar de kijker hem neerzette.
      this.teken();
      var regie = this.pad().join(",");
      if (nieuweRun || regie !== this.regieSleutel) {
        this.regieSleutel = regie;
        this.regieCam(vloeiend ? OVERGANG_MS : 0);
      }
    },

    /* ---------- tekenen ---------- */
    // Het pad van de avond naar wat speelt of naar de gekozen scène; leeg = het hele universum.
    pad: function () {
      var st = this.stand;
      if (!st) return [];
      var doel = st.nu || st.klaar;
      if (!doel) return [];
      return st.gespeeld.filter(function (id) { return id !== doel; }).concat([doel]);
    },

    teken: function () {
      var self = this, st = this.stand;
      if (!this.kaart || !st) return;
      var pad = this.pad();
      var opPad = new Set(pad);
      var fade = pad.length ? FADE_PAD : 1;
      var stem = st.stem && st.stem.s ? st.stem : null;
      this.ster.forEach(function (s, id) {
        var z = self.staat(id);
        var vul = "#fff", rand = "rgba(255,255,255,.42)", randDik = 0.6, alpha = 1, gloed = 0, maat = 1;
        if (z === "gespeeld") { vul = "var(--bg)"; rand = "#fff"; randDik = 1.4; }
        else if (z === "vrij" || z === "klaar") { gloed = 0.5; rand = "#fff"; }
        else if (z === "nu") { gloed = 0.64; rand = "#fff"; randDik = 1.7; maat = 1.15; }
        else { alpha = 0.16; }
        if (stem && stem.s[id] != null && z !== "slot") {
          var winnaar = stem.w === id, kop = !stem.w && stem.k.indexOf(id) >= 0;
          maat = winnaar ? 2.1 : kop ? 1.7 : 1.15;
          if (winnaar || kop) gloed = 0.95;
          if (stem.w && !winnaar) alpha *= 0.45;
        }
        if (!opPad.has(id)) alpha *= fade;
        s.c.setAttribute("fill", vul);
        s.c.setAttribute("stroke", rand);
        s.c.setAttribute("stroke-width", randDik);
        s.c.setAttribute("opacity", alpha.toFixed(3));
        s.h.setAttribute("opacity", (gloed * alpha).toFixed(3));
        s.grootte = maat * s.maat;
        s.gloed = gloed;
      });
      // Lijnen zoals het zaalscherm: een echte lijn alleen tussen twee vrijgekomen sterren (gespeeld of vrij).
      var nu = st.nu;
      this.lijnen.forEach(function (x) {
        var alpha = 0.09;
        if (self.open(x.a) && self.open(x.b)) {
          alpha = 0.5;
          if (nu && (x.a === nu || x.b === nu)) alpha = 1;
          if (self.gekozen && (x.a === self.gekozen || x.b === self.gekozen)) alpha = 1;
        }
        x.l.setAttribute("opacity", (alpha * fade).toFixed(3));
      });
      // Het pad: elke stap helder, de laatste gestippeld. Alleen opnieuw als het pad verandert (anders
      // begint het invloeien opnieuw).
      var padSleutel = pad.join(",");
      if (padSleutel !== this.padSleutel) this.lPad.textContent = "";
      for (var i = 1; i < pad.length && padSleutel !== this.padSleutel; i++) {
        var a = pad[i - 1], b = pad[i], r = this.rand.get(sleutel(a, b)), d;
        if (r) d = r.a === a ? r.heen : r.terug;
        else {
          var A = this.S.get(a), B = this.S.get(b);
          if (!A || !B) continue;
          var mx = (A.x + B.x) / 2, my = (A.y + B.y) / 2, dx = B.x - A.x, dy = B.y - A.y;
          d = "M" + A.x + " " + A.y + "Q" + (mx - dy * 0.18) + " " + (my + dx * 0.18) + " " + B.x + " " + B.y;
        }
        this.lPad.appendChild(svgEl("path", { d: d, "class": "padlijn" + (i === pad.length - 1 ? " laatste" : "") }));
      }
      this.padSleutel = padSleutel;
      this.schaal();
      this.zetBalk();
      if (this.gekozen) this.toonDetail(this.gekozen);
    },

    // Maat van sterren en merktekens in schermpixels: ze groeien minder hard mee dan de afstanden.
    pxPerEenheid: function () {
      var r = this.svg.getBoundingClientRect();
      if (!r.width || !r.height) return 0.5 * this.cam.s;
      return Math.min(r.width / this.basis.w, r.height / this.basis.h) * this.cam.s;
    },
    groei: function () { return Math.pow(this.cam.s, 0.38); },
    schaal: function () {
      var p = this.pxPerEenheid(), g = this.groei();
      this.ster.forEach(function (s) {
        var r = (s.grootte || s.maat) * 0.95 * g / p;
        s.c.setAttribute("r", r.toFixed(2));
        s.h.setAttribute("r", (r * (s.gloed > 0.8 ? 5 : 3.2)).toFixed(2));
      });
      this.zetMerk();
      this.zetTitel();
    },

    zetMerk: function () {
      var self = this, st = this.stand;
      this.lMerk.textContent = "";
      if (!st || !this.kaart) return;
      var p = this.pxPerEenheid(), g = this.groei();
      if (this.gekozen) {
        var S = this.S.get(this.gekozen);
        if (S) {
          var m = (S.r * 0.95 * g + 9) / p, h = m * 0.45, d = "";
          [[-1, -1], [1, -1], [1, 1], [-1, 1]].forEach(function (z) {
            d += "M" + (S.x + z[0] * m) + " " + (S.y + z[1] * (m - h)) + "L" + (S.x + z[0] * m) + " " + (S.y + z[1] * m) + "L" + (S.x + z[0] * (m - h)) + " " + (S.y + z[1] * m);
          });
          this.lMerk.appendChild(svgEl("path", { d: d, "class": "hoeken" }));
        }
      }
      var pad = this.pad();
      if (pad.length) {
        var E = this.S.get(pad[pad.length - 1]);
        if (E) {
          if (!this.kring || this.kring.__id !== E.id) {
            this.lKring.textContent = "";
            this.kring = svgEl("circle", { cx: E.x, cy: E.y, "class": "kring" });
            this.kring.__id = E.id;
            self.lKring.appendChild(this.kring);
          }
          this.kring.setAttribute("r", (16 * g / p).toFixed(2));
        }
      } else { this.kring = null; this.lKring.textContent = ""; }
    },

    // De titel staat bij een getikte ster.
    zetTitel: function () {
      var id = this.gekozen;
      var it = id ? this.info(id) : null, S = id ? this.S.get(id) : null;
      if (!it || !S || !this.zichtbaar()) { this.titel.hidden = true; return; }
      var p = this.punt(S);
      if (this.titel.textContent !== it.t) this.titel.textContent = it.t;
      this.titel.style.left = p.x + "px";
      this.titel.style.top = (p.y - (S.r * 0.95 * this.groei() + 14)) + "px";
      this.titel.hidden = false;
    },
    // Kaartpunt → plek in het blad (pixels).
    punt: function (S) {
      var r = this.svg.getBoundingClientRect(), b = this.basis, c = this.cam;
      var k = Math.min(r.width / b.w, r.height / b.h);
      return { x: r.width / 2 + (S.x - c.x) * c.s * k, y: r.height / 2 + (S.y - c.y) * c.s * k };
    },

    zetBalk: function () {
      var b = this.balk, st = this.stand;
      if (!st) return;
      b.textContent = "";
      if (this.afgelopen) { b.textContent = "De voorstelling is afgelopen · " + st.gespeeld.length + " gespeeld"; return; }
      if (st.nu && this.info(st.nu)) { b.append("Speelt nu: "); b.append(maak("b", "", this.info(st.nu).t)); return; }
      if (st.klaar && this.info(st.klaar)) { b.append("Volgende scène: "); b.append(maak("b", "", this.info(st.klaar).t)); return; }
      if (st.stem && st.stem.a) { b.textContent = "Stem op de eerste scène"; return; }
      b.textContent = st.gespeeld.length + " gespeeld · " + st.vrij.length + " vrij";
    },

    /* ---------- camera ---------- */
    // Wat het zaalscherm laat zien: het hele universum, of ingezoomd op het pad van de avond.
    regieDoel: function () {
      var b = this.basis, pad = this.pad(), self = this;
      var heel = { x: b.x + b.w / 2, y: b.y + b.h / 2, s: 1 };
      if (!pad.length) return heel;
      var xs = [], ys = [];
      pad.forEach(function (id) { var S = self.S.get(id); if (S) { xs.push(S.x); ys.push(S.y); } });
      if (!xs.length) return heel;
      var x0 = Math.min.apply(null, xs), x1 = Math.max.apply(null, xs), y0 = Math.min.apply(null, ys), y1 = Math.max.apply(null, ys);
      var kb = Math.max(x1 - x0, 60), kh = Math.max(y1 - y0, 60);
      // Eén ster (nog niets gespeeld): niet verder dan het zaalscherm, de buren blijven in beeld.
      var s = xs.length < 2 ? 2.4 : Math.max(1, Math.min(6, Math.min(0.74 * b.w / kb, 0.7 * b.h / kh)));
      return { x: (x0 + x1) / 2, y: (y0 + y1) / 2, s: s };
    },
    regieCam: function (ms) { this.camNaar(this.regieDoel(), ms); },
    // Tijdens de beweging verschuift alleen de camera; maten worden aan het eind één keer bijgewerkt.
    camNaar: function (doel, ms) {
      var self = this, van = { x: this.cam.x, y: this.cam.y, s: this.cam.s };
      if (this.lus) { cancelAnimationFrame(this.lus); this.lus = 0; }
      if (!ms || !this.zichtbaar()) { this.cam = doel; this.zetCam(true); return; }
      var t0 = 0;
      var ease = function (t) { return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2; };
      this.titel.hidden = true;
      var stap = function (nu) {
        if (!t0) t0 = nu;
        var t = Math.min(1, (nu - t0) / ms), e = ease(t);
        var ls = Math.log(van.s) + (Math.log(doel.s) - Math.log(van.s)) * e;
        self.cam = { x: van.x + (doel.x - van.x) * e, y: van.y + (doel.y - van.y) * e, s: Math.exp(ls) };
        self.zetCam(t >= 1);
        self.lus = t < 1 ? requestAnimationFrame(stap) : 0;
      };
      this.lus = requestAnimationFrame(stap);
    },
    zetCam: function (maten) {
      var b = this.basis, c = this.cam;
      this.camG.setAttribute("transform", "translate(" + (b.x + b.w / 2 - c.x * c.s) + " " + (b.y + b.h / 2 - c.y * c.s) + ") scale(" + c.s + ")");
      if (maten) this.schaal();
    },

    /* ---------- tikken ---------- */
    kiesSter: function (id) { this.gekozen = id; this.teken(); },
    sluit: function () { this.gekozen = 0; this.sheet.classList.remove("open"); this.teken(); },
    toonDetail: function (id) {
      var z = this.staat(id), it = this.info(id), h = this.sInhoud;
      if (!it || z === "slot") { this.sheet.classList.remove("open"); h.textContent = ""; return; }
      if (h.__id === id && h.__v === this.stand.v) { this.sheet.classList.add("open"); return; }
      h.__id = id; h.__v = this.stand.v;
      h.textContent = "";
      h.append(maak("span", "uv-chip " + z, z === "gespeeld" ? "Gespeeld · scène " + (this.stand.gespeeld.indexOf(id) + 1) : LABEL[z]));
      h.append(maak("h2", "", it.t));
      // Beeld van de omgeving: alleen bij gespeeld, wat nu speelt en de gekozen scène (de server geeft het dan mee).
      if (it.b) {
        var img = maak("img", "uv-beeld");
        img.alt = it.o || "";
        img.decoding = "async";
        img.loading = "lazy";
        img.onerror = function () { img.remove(); };
        img.src = it.b;
        h.append(img);
      }
      var dl = maak("dl");
      var rij = function (k, v) { var r = maak("div", "uv-rij"); r.append(maak("dt", "", k), maak("dd", "", v)); dl.append(r); };
      if (it.w && it.w.length) rij(z === "gespeeld" ? "Speelden" : "Wie", it.w.map(function (n) { return n || "vrije plek"; }).join(", "));
      if (it.o) rij("Waar", it.o);
      h.append(dl);
      this.sheet.classList.add("open");
    },

    koppelGebaren: function () {
      var self = this, svg = this.svg, punten = new Map(), greep = null, afstand = 0, meer = false, maatTimer = 0;
      // Schermpunt → afstand tot het midden van het blad, in kaarteenheden bij zoom 1.
      function punt(e) {
        var r = svg.getBoundingClientRect(), b = self.basis;
        var k = Math.max(b.w / r.width, b.h / r.height);
        return { x: (e.clientX - r.left - r.width / 2) * k, y: (e.clientY - r.top - r.height / 2) * k };
      }
      // Tijdens slepen en knijpen alleen de camera; de maten even later.
      function verschoven() {
        if (self.lus) { cancelAnimationFrame(self.lus); self.lus = 0; }
        self.zetCam(false);
        self.titel.hidden = true;
        clearTimeout(maatTimer);
        maatTimer = setTimeout(function () { self.schaal(); }, 120);
      }
      // Zoom naar s, met het kaartpunt onder schermpunt m op dezelfde plek.
      function zoomRond(m, s, van) {
        var wx = van.x + m.x / van.s, wy = van.y + m.y / van.s;
        self.cam = { x: wx - m.x / s, y: wy - m.y / s, s: s };
      }
      // Bij elke vinger erbij of eraf begint het gebaar opnieuw vanaf waar de camera nu staat:
      // zo springt het beeld nooit terug.
      function anker() {
        var ps = Array.from(punten.values());
        if (!ps.length) { greep = null; return; }
        var c = { x: self.cam.x, y: self.cam.y, s: self.cam.s };
        if (ps.length === 1) greep = { c: c, p: ps[0] };
        else greep = { c: c, m: { x: (ps[0].x + ps[1].x) / 2, y: (ps[0].y + ps[1].y) / 2 }, d: Math.max(1, Math.hypot(ps[0].x - ps[1].x, ps[0].y - ps[1].y)) };
      }
      svg.addEventListener("pointerdown", function (e) {
        try { svg.setPointerCapture(e.pointerId); } catch (x) {}
        if (!punten.size) { afstand = 0; meer = false; }
        punten.set(e.pointerId, punt(e));
        if (punten.size > 1) meer = true;
        if (self.lus) { cancelAnimationFrame(self.lus); self.lus = 0; }
        anker();
      });
      svg.addEventListener("pointermove", function (e) {
        if (!punten.has(e.pointerId) || !greep) return;
        punten.set(e.pointerId, punt(e));
        var ps = Array.from(punten.values());
        if (ps.length >= 2 && greep.m) {
          var m = { x: (ps[0].x + ps[1].x) / 2, y: (ps[0].y + ps[1].y) / 2 };
          var d = Math.max(1, Math.hypot(ps[0].x - ps[1].x, ps[0].y - ps[1].y));
          var s = Math.max(0.8, Math.min(8, greep.c.s * d / greep.d));
          // Het kaartpunt dat onder het midden van de vingers lag, blijft onder het midden van de vingers.
          var wx = greep.c.x + greep.m.x / greep.c.s, wy = greep.c.y + greep.m.y / greep.c.s;
          self.cam = { x: wx - m.x / s, y: wy - m.y / s, s: s };
          afstand = 99;
          verschoven();
          return;
        }
        if (greep.p) {
          var dx = ps[0].x - greep.p.x, dy = ps[0].y - greep.p.y;
          afstand = Math.max(afstand, Math.hypot(dx, dy));
          self.cam = { x: greep.c.x - dx / greep.c.s, y: greep.c.y - dy / greep.c.s, s: greep.c.s };
          verschoven();
        }
      });
      var los = function (e) {
        var p = punten.get(e.pointerId);
        punten.delete(e.pointerId);
        if (punten.size) { anker(); return; }
        if (e.type === "pointerup" && !meer && afstand < 8 && p && self.kaart) {
          var wx = p.x / self.cam.s + self.cam.x, wy = p.y / self.cam.s + self.cam.y, best = 0, bd = Infinity;
          self.S.forEach(function (st) { if (!self.open(st.id)) return; var d = Math.hypot(st.x - wx, st.y - wy); if (d < bd) { bd = d; best = st.id; } });
          if (best && bd * self.cam.s < 28) self.kiesSter(best);
          else if (self.gekozen) self.sluit();
        }
        greep = null;
      };
      svg.addEventListener("pointerup", los);
      svg.addEventListener("pointercancel", los);
      svg.addEventListener("wheel", function (e) {
        e.preventDefault();
        var van = { x: self.cam.x, y: self.cam.y, s: self.cam.s };
        zoomRond(punt(e), Math.max(0.8, Math.min(8, van.s * (e.deltaY < 0 ? 1.15 : 1 / 1.15))), van);
        verschoven();
      }, { passive: false });
      window.addEventListener("resize", function () { if (self.kaart) self.schaal(); });
    },
  };

  window.ForYouTabs.registreer("universum", tab);
})();
