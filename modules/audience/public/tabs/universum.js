// Tab "for_youniverse" op de publiekstelefoon (schil: index.html, afspraken: tabs/LEESMIJ.md).
// De kaart (alleen nummers, posities en lijnen) wordt één keer opgehaald; de stand komt als bericht
// "universum" (ook in hello) over de verbinding van de chat. Er draait geen lus: alleen bij een
// nieuwe stand worden klassen gewisseld. Tikken op een ster toont de scène en laat de paden erdoor
// oplichten; op slot is grijs en toont niets. Serverkant: server/universum.js.
(function () {
  "use strict";
  var NS = "http://www.w3.org/2000/svg";
  var CSS = [
    ".uv{position:relative;flex:1 1 auto;min-height:0;display:flex;flex-direction:column;overflow:hidden}",
    ".uv-balk{padding:9px 16px;font-size:13px;color:var(--b);border-bottom:1px solid var(--d);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;min-height:16px}",
    ".uv-balk b{color:var(--a);font-weight:500}",
    ".uv-blad{position:relative;flex:1 1 auto;min-height:0;overflow:hidden}",
    ".uv svg{width:100%;height:100%;display:block;touch-action:none;user-select:none;-webkit-user-select:none}",
    ".uv .lijn{stroke:var(--d);stroke-width:1.2;fill:none}",
    ".uv .lijn.gelopen{stroke:var(--a);stroke-width:2}",
    ".uv .lijn.open{stroke:var(--c)}",
    ".uv .licht{fill:none;stroke-width:3;stroke-linecap:round;opacity:.9}",
    ".uv .ster{transform-box:fill-box;transform-origin:center}",
    ".uv .ster.slot{fill:rgba(255,255,255,.2)}",
    ".uv .ster.vrij{fill:var(--bg);stroke:var(--a);stroke-width:1.6}",
    ".uv .ster.gespeeld{fill:var(--a)}",
    ".uv .ster.klaar{fill:var(--bg);stroke:#ffe27a;stroke-width:2}",
    ".uv .ster.nu{fill:#ffe27a}",
    ".uv .ster.gekozen{stroke:var(--a);stroke-width:3}",
    ".uv .ster.vers{animation:uvPlop 1.2s ease-out 1}",
    ".uv .ring{fill:none;stroke:#ffe27a;stroke-width:1.5;animation:uvPuls 2s ease-out infinite}",
    ".uv.uit .ring,.uv.uit .ster{animation-play-state:paused}",
    "@keyframes uvPuls{from{r:10;opacity:.9}to{r:28;opacity:0}}",
    "@keyframes uvPlop{0%{transform:scale(2.4)}100%{transform:scale(1)}}",
    ".uv .naam{fill:var(--b);font-size:11px;font-family:var(--font);pointer-events:none}",
    "@media (prefers-reduced-motion:reduce){.uv .ring,.uv .ster.vers{animation:none}.uv-sheet{transition:none}}",
    ".uv-zoom{position:absolute;right:12px;bottom:12px;display:flex;flex-direction:column;gap:6px}",
    ".uv-zoom button{width:40px;height:40px;border-radius:50%;border:1px solid var(--c);background:var(--bg);color:var(--a);font-size:18px;cursor:pointer;padding:0}",
    ".uv-leg{position:absolute;left:12px;bottom:12px;display:grid;gap:4px;font-size:11px;color:var(--b);pointer-events:none}",
    ".uv-leg span{display:flex;align-items:center;gap:6px}",
    ".uv-leg i{width:9px;height:9px;border-radius:50%;display:inline-block;box-sizing:border-box}",
    ".uv-sheet{position:absolute;left:0;right:0;bottom:0;max-height:70%;overflow-y:auto;background:#0e1015;border-top:1px solid var(--c);border-radius:18px 18px 0 0;padding:14px 18px 20px;transform:translateY(105%);transition:transform .22s ease-out}",
    ".uv-sheet.open{transform:none}",
    ".uv-greep{width:36px;height:4px;border-radius:2px;background:var(--c);margin:0 auto 12px}",
    ".uv-sluit{position:absolute;right:12px;top:8px;background:none;border:0;color:var(--b);font-size:24px;cursor:pointer;padding:4px 8px}",
    ".uv-chip{display:inline-block;font-size:11px;letter-spacing:.06em;text-transform:uppercase;border:1px solid var(--c);border-radius:20px;padding:3px 9px;color:var(--b)}",
    ".uv-chip.nu,.uv-chip.klaar{color:#ffe27a;border-color:#ffe27a}",
    ".uv-chip.gespeeld{color:var(--bg);background:var(--a);border-color:var(--a)}",
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
  function kort(t, n) { t = String(t || ""); return t.length > n ? t.slice(0, n - 1) + "…" : t; }
  function kleur(c) {
    var m = /^#([0-9a-f]{6})$/i.exec(c || "");
    if (!m) return "#ffffff";
    var v = parseInt(m[1], 16);
    var l = ((v >> 16) & 255) * 0.3 + ((v >> 8) & 255) * 0.59 + (v & 255) * 0.11;
    return l < 70 ? "#ffffff" : c;
  }
  function lees(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function bewaar(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }

  var LABEL = { nu: "Speelt nu", gespeeld: "Gespeeld", klaar: "Straks", vrij: "Vrijgespeeld", slot: "Op slot" };

  var tab = {
    berichten: ["universum"],
    kaart: null, stand: null, wachtend: null, gekozen: 0, ophalen: null, afgelopen: false,
    S: new Map(), elSter: new Map(), elLijn: [], padenVan: new Map(),
    cam: { x: 0, y: 0, s: 1 }, basis: { x: -400, y: -400, w: 800, h: 800 }, eersteBeeld: true,

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
      this.cam_g = svgEl("g", {});
      this.lLijnen = svgEl("g", {}); this.lLicht = svgEl("g", {}); this.lSterren = svgEl("g", {}); this.lNamen = svgEl("g", {});
      this.cam_g.append(this.lLijnen, this.lLicht, this.lSterren, this.lNamen);
      this.svg.appendChild(this.cam_g);
      this.wacht = maak("div", "uv-wacht", "Universum laden…");
      var leg = maak("div", "uv-leg");
      leg.setAttribute("aria-hidden", "true");
      [["background:var(--a)", "gespeeld"], ["border:1.5px solid var(--a)", "vrij"], ["background:#ffe27a", "speelt nu"],
        ["border:2px solid #ffe27a", "straks"], ["background:rgba(255,255,255,.2)", "op slot"]].forEach(function (r) {
        var s = maak("span"); var i = maak("i"); i.setAttribute("style", r[0]); s.append(i, r[1]); leg.append(s);
      });
      var zoom = maak("div", "uv-zoom");
      var zIn = maak("button", "", "+"), zUit = maak("button", "", "−"), zMid = maak("button", "", "◎");
      [zIn, zUit, zMid].forEach(function (b) { b.type = "button"; });
      zIn.setAttribute("aria-label", "Inzoomen"); zUit.setAttribute("aria-label", "Uitzoomen"); zMid.setAttribute("aria-label", "Naar wat nu speelt");
      zIn.onclick = function () { self.cam.s = Math.min(5, self.cam.s * 1.4); self.zetCam(); };
      zUit.onclick = function () { self.cam.s = Math.max(0.8, self.cam.s / 1.4); self.zetCam(); };
      zMid.onclick = function () { self.naarNu(1.8); };
      zoom.append(zIn, zUit, zMid);
      this.sheet = maak("div", "uv-sheet");
      this.sheet.setAttribute("role", "dialog");
      var sluit = maak("button", "uv-sluit", "×");
      sluit.type = "button"; sluit.setAttribute("aria-label", "Sluiten");
      sluit.onclick = function () { self.sluit(); };
      this.sInhoud = maak("div");
      this.sheet.append(maak("div", "uv-greep"), sluit, this.sInhoud);
      blad.append(this.svg, this.wacht, leg, zoom, this.sheet);
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
    toon: function () { if (this.root) this.root.classList.remove("uit"); },
    verberg: function () { if (this.root) this.root.classList.add("uit"); },

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
          // Opnieuw proberen zolang er geen kaart is; één wachttijd, geen lus die doorloopt.
          setTimeout(function () { self.laadKaart(self.stand && self.stand.kaart); }, 4000);
        });
    },

    zetKaart: function (k) {
      var self = this;
      this.kaart = k; this.S = new Map(); this.padenVan = new Map(); this.elSter = new Map(); this.elLijn = [];
      [this.lLijnen, this.lLicht, this.lSterren, this.lNamen].forEach(function (g) { g.textContent = ""; });
      var minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
      k.s.forEach(function (r) {
        self.S.set(r[0], { id: r[0], x: r[1], y: r[2] });
        minX = Math.min(minX, r[1]); maxX = Math.max(maxX, r[1]); minY = Math.min(minY, r[2]); maxY = Math.max(maxY, r[2]);
      });
      this.basis = { x: minX - 40, y: minY - 40, w: maxX - minX + 80, h: maxY - minY + 80 };
      this.svg.setAttribute("viewBox", this.basis.x + " " + this.basis.y + " " + this.basis.w + " " + this.basis.h);
      this.cam = { x: this.basis.x + this.basis.w / 2, y: this.basis.y + this.basis.h / 2, s: 1 };
      k.l.forEach(function (e) {
        var A = self.S.get(e[0]), B = self.S.get(e[1]);
        if (!A || !B) return;
        var l = svgEl("line", { x1: A.x, y1: A.y, x2: B.x, y2: B.y, "class": "lijn" });
        self.lLijnen.appendChild(l);
        self.elLijn.push({ a: e[0], b: e[1], l: l });
      });
      this.looplijn = svgEl("polyline", { "class": "lijn gelopen" });
      this.lLijnen.appendChild(this.looplijn);
      k.s.forEach(function (r) {
        var c = svgEl("circle", { cx: r[1], cy: r[2], r: 4, "class": "ster slot" });
        self.lSterren.appendChild(c);
        self.elSter.set(r[0], c);
      });
      this.ring = svgEl("circle", { "class": "ring", r: 10 });
      this.ring.style.display = "none";
      this.lSterren.appendChild(this.ring);
      (k.p || []).forEach(function (p) {
        p.s.forEach(function (id) { if (!self.padenVan.has(id)) self.padenVan.set(id, []); self.padenVan.get(id).push(p); });
      });
      this.zetCam();
      this.wacht.hidden = true;
      if (this.wachtend) { var w = this.wachtend; this.wachtend = null; this.ontvang(w); }
      else if (this.stand) this.teken(null);
    },

    /* ---------- stand ---------- */
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

    ontvang: function (m) {
      if (!m || m.type !== "universum" || !Array.isArray(m.gespeeld)) return;
      var s = this.stand;
      if (s && m.bron === s.bron && m.run === s.run && m.v <= s.v) return; // oud of dubbel
      if (!this.kaart || (m.kaart && this.kaart.versie !== m.kaart)) {
        this.wachtend = m;
        this.laadKaart(m.kaart);
        return;
      }
      var nieuweRun = !s || m.run !== s.run;
      var vorigOpen = s && !nieuweRun ? new Set(s.vrij.concat(s.gespeeld)) : null;
      this.stand = m;
      if (nieuweRun) this.gekozen = 0;
      this.teken(vorigOpen);
      if (nieuweRun || this.eersteBeeld) { this.eersteBeeld = false; this.naarNu(1.4); }
    },

    teken: function (vorigOpen) {
      var self = this, st = this.stand;
      if (!this.kaart || !st) return;
      this.elSter.forEach(function (c, id) {
        var z = self.staat(id);
        c.setAttribute("r", z === "slot" ? 4 : (z === "gespeeld" || z === "nu") ? 8 : 6.5);
        var k = "ster " + z;
        if (id === self.gekozen) k += " gekozen";
        if (vorigOpen && z === "vrij" && !vorigOpen.has(id)) k += " vers";
        c.setAttribute("class", k);
      });
      var g = new Set(st.gespeeld), open = new Set(st.vrij);
      if (st.nu) open.add(st.nu);
      if (st.klaar) open.add(st.klaar);
      this.elLijn.forEach(function (x) {
        var naarOpen = (g.has(x.a) && open.has(x.b)) || (g.has(x.b) && open.has(x.a));
        x.l.setAttribute("class", "lijn" + (naarOpen ? " open" : ""));
      });
      var reeks = st.gespeeld.slice();
      if (st.nu) reeks.push(st.nu);
      this.looplijn.setAttribute("points", reeks.filter(function (id) { return self.S.has(id); })
        .map(function (id) { return self.S.get(id).x + "," + self.S.get(id).y; }).join(" "));
      if (st.nu && this.S.has(st.nu)) {
        this.ring.setAttribute("cx", this.S.get(st.nu).x); this.ring.setAttribute("cy", this.S.get(st.nu).y); this.ring.style.display = "";
      } else this.ring.style.display = "none";
      // Titels bij gespeelde scènes. Botst een titel met een eerdere, dan links van de ster; past
      // dat ook niet, dan geen titel (tikken op de ster toont hem).
      this.lNamen.textContent = "";
      var vakken = [];
      var botst = function (v) {
        return vakken.some(function (w) { return v.x1 < w.x2 && w.x1 < v.x2 && v.y1 < w.y2 && w.y1 < v.y2; });
      };
      reeks.slice().reverse().forEach(function (id) {
        var s = self.S.get(id), i = self.info(id);
        if (!s || !i) return;
        var tekst = kort(i.t, 24), breed = tekst.length * 5.6;
        var rechts = { x1: s.x + 10, x2: s.x + 12 + breed, y1: s.y - 8, y2: s.y + 6 };
        var links = { x1: s.x - 12 - breed, x2: s.x - 10, y1: s.y - 8, y2: s.y + 6 };
        var plek = !botst(rechts) ? "rechts" : !botst(links) ? "links" : "";
        if (!plek) return;
        vakken.push(plek === "rechts" ? rechts : links);
        var t = svgEl("text", plek === "rechts"
          ? { x: s.x + 11, y: s.y + 4, "class": "naam" }
          : { x: s.x - 11, y: s.y + 4, "class": "naam", "text-anchor": "end" });
        t.textContent = tekst;
        self.lNamen.appendChild(t);
      });
      this.zetBalk();
      this.tekenLicht();
      if (this.gekozen) this.toonDetail(this.gekozen);
    },

    zetBalk: function () {
      var b = this.balk, st = this.stand;
      b.textContent = "";
      if (this.afgelopen) { b.textContent = "De voorstelling is afgelopen · " + st.gespeeld.length + " gespeeld"; return; }
      if (st.nu && this.info(st.nu)) { b.append("Speelt nu: "); b.append(maak("b", "", this.info(st.nu).t)); return; }
      var tekst = st.gespeeld.length + " gespeeld · " + st.vrij.length + " vrij";
      if (st.klaar && this.info(st.klaar)) tekst += " · straks: " + this.info(st.klaar).t;
      b.textContent = tekst;
    },

    tekenLicht: function () {
      var self = this;
      this.lLicht.textContent = "";
      if (!this.gekozen) return;
      (this.padenVan.get(this.gekozen) || []).forEach(function (p) {
        var kl = kleur(p.c);
        (p.e || []).forEach(function (e) {
          var A = self.S.get(e[0]), B = self.S.get(e[1]);
          if (!A || !B) return;
          self.lLicht.appendChild(svgEl("line", { x1: A.x, y1: A.y, x2: B.x, y2: B.y, "class": "licht", stroke: kl }));
        });
      });
    },

    /* ---------- detail ---------- */
    kies: function (id) {
      this.gekozen = id;
      this.teken(null);
      var s = this.S.get(id);
      if (s) { this.cam.s = Math.max(this.cam.s, 1.5); this.cam.x = s.x; this.cam.y = s.y + this.basis.h * 0.12 / this.cam.s; this.zetCam(); }
    },
    sluit: function () { this.gekozen = 0; this.sheet.classList.remove("open"); this.teken(null); },
    toonDetail: function (id) {
      var z = this.staat(id), it = this.info(id), h = this.sInhoud;
      h.textContent = "";
      var chip = maak("span", "uv-chip " + z, z === "gespeeld" ? "Gespeeld · scène " + (this.stand.gespeeld.indexOf(id) + 1) : LABEL[z]);
      h.append(chip);
      if (z !== "slot" && it) {
        h.append(maak("h2", "", it.t));
        var dl = maak("dl");
        var rij = function (k, v) { var r = maak("div", "uv-rij"); r.append(maak("dt", "", k), maak("dd", "", v)); dl.append(r); };
        if (it.w && it.w.length) rij(z === "gespeeld" ? "Speelden" : "Wie", it.w.map(function (n) { return n || "vrije plek"; }).join(", "));
        if (it.o) rij("Waar", it.o);
        h.append(dl);
      }
      this.sheet.classList.add("open");
    },

    /* ---------- camera en gebaren ---------- */
    zetCam: function () {
      var b = this.basis, c = this.cam;
      this.cam_g.setAttribute("transform", "translate(" + (b.x + b.w / 2 - c.x * c.s) + " " + (b.y + b.h / 2 - c.y * c.s) + ") scale(" + c.s + ")");
    },
    naarNu: function (schaal) {
      var st = this.stand, id = st && (st.nu || st.gespeeld[st.gespeeld.length - 1]);
      if (id && this.S.has(id)) { this.cam.s = schaal; this.cam.x = this.S.get(id).x; this.cam.y = this.S.get(id).y; }
      else { this.cam.s = 1; this.cam.x = this.basis.x + this.basis.w / 2; this.cam.y = this.basis.y + this.basis.h / 2; }
      this.zetCam();
    },
    koppelGebaren: function () {
      var self = this, svg = this.svg, punten = new Map(), greep = null, afstand = 0;
      function punt(e) {
        var r = svg.getBoundingClientRect(), b = self.basis;
        var k = Math.max(b.w / r.width, b.h / r.height);
        return { x: (e.clientX - r.left - r.width / 2) * k, y: (e.clientY - r.top - r.height / 2) * k };
      }
      svg.addEventListener("pointerdown", function (e) {
        try { svg.setPointerCapture(e.pointerId); } catch (x) {}
        punten.set(e.pointerId, punt(e)); afstand = 0;
        greep = { x: self.cam.x, y: self.cam.y, s: self.cam.s, p: punt(e), d: 0 };
      });
      svg.addEventListener("pointermove", function (e) {
        if (!punten.has(e.pointerId) || !greep) return;
        punten.set(e.pointerId, punt(e));
        var ps = Array.from(punten.values());
        if (ps.length === 2) {
          var d = Math.hypot(ps[0].x - ps[1].x, ps[0].y - ps[1].y);
          if (!greep.d) greep.d = d;
          self.cam.s = Math.max(0.8, Math.min(5, greep.s * d / greep.d)); afstand = 99; self.zetCam(); return;
        }
        var dx = ps[0].x - greep.p.x, dy = ps[0].y - greep.p.y;
        afstand = Math.max(afstand, Math.hypot(dx, dy));
        self.cam.x = greep.x - dx / self.cam.s; self.cam.y = greep.y - dy / self.cam.s; self.zetCam();
      });
      svg.addEventListener("pointerup", function (e) {
        var p = punten.get(e.pointerId);
        punten.delete(e.pointerId);
        if (punten.size) return;
        if (afstand < 8 && p && self.kaart) {
          var wx = p.x / self.cam.s + self.cam.x, wy = p.y / self.cam.s + self.cam.y, best = 0, bd = Infinity;
          self.S.forEach(function (s) { var d = Math.hypot(s.x - wx, s.y - wy); if (d < bd) { bd = d; best = s.id; } });
          if (bd * self.cam.s < 28) self.kies(best);
          else if (self.gekozen) self.sluit();
        }
        greep = null;
      });
      svg.addEventListener("pointercancel", function (e) { punten.delete(e.pointerId); });
      svg.addEventListener("wheel", function (e) {
        e.preventDefault();
        self.cam.s = Math.max(0.8, Math.min(5, self.cam.s * (e.deltaY < 0 ? 1.15 : 1 / 1.15)));
        self.zetCam();
      }, { passive: false });
    },
  };

  window.ForYouTabs.registreer("universum", tab);
})();
