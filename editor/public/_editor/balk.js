// Loaded into the catalog, paths editor and universe pages on the website. Sends along
// which version the page is looking at, so a save never overwrites a newer change by
// someone else, and shows the version and any refusal.
// In the house style (html.hs, see huisstijl.css) it also puts one navigation in the
// page's own header; ?stijl=oud switches back to the old look (remembered per browser).
(function () {
  "use strict";
  var basis = null;
  var originalFetch = window.fetch.bind(window);
  // The image catalog's overview shows the small previews the editor makes (voorbeelden.js).
  window.fyVoorbeeld = "/v0/catalog/media-assets/voorbeeld/";

  var stijl = (function () {
    var gevraagd = new URLSearchParams(window.location.search).get("stijl");
    try {
      if (gevraagd === "oud" || gevraagd === "nieuw") window.localStorage.setItem("foryou-stijl", gevraagd);
      return window.localStorage.getItem("foryou-stijl") || "nieuw";
    } catch (_err) {
      return gevraagd || "nieuw";
    }
  })();
  var huisstijl = stijl === "nieuw";
  // Each page has its own colour variables (with overlapping names), so the house style
  // needs to know which page it is on.
  var pagina = { catalog: "hs-catalogus", editor: "hs-paden", universe: "hs-universe" }[window.location.pathname.split("/")[1]];
  if (huisstijl) document.documentElement.classList.add("hs", pagina || "hs-anders");

  function sameOriginApi(input) {
    var url = typeof input === "string" ? input : (input && input.url) || "";
    try {
      var parsed = new URL(url, window.location.href);
      return parsed.origin === window.location.origin && parsed.pathname.indexOf("/v0/") === 0;
    } catch (_err) {
      return false;
    }
  }

  var bar = document.createElement("div");
  bar.className = "hs-melding";
  bar.setAttribute("style", [
    "position:fixed", "right:12px", "bottom:12px", "z-index:2147483000",
    "font:13px/1.3 'Helvetica Neue',Helvetica,Arial,sans-serif", "background:#fff", "color:#111",
    "padding:8px 12px", "box-shadow:0 1px 6px rgba(0,0,0,.18)", "max-width:min(92vw,520px)"
  ].join(";"));
  var label = document.createElement("span");
  label.textContent = "For_You";
  var link = document.createElement("a");
  link.href = "/versies/";
  link.textContent = "Versies";
  link.setAttribute("style", "margin-left:10px;color:#111");
  var message = document.createElement("div");
  message.setAttribute("style", "display:none;margin-top:6px;color:#b00020;font-weight:500");
  if (!huisstijl) {
    bar.appendChild(label);
    bar.appendChild(link);
  }
  bar.appendChild(message);

  var versie = document.createElement("span");
  versie.className = "hs-versie";

  function show(text) {
    message.textContent = text;
    message.style.display = text ? "block" : "none";
    if (huisstijl) bar.style.display = text ? "block" : "none";
  }

  // The word mark goes once the team bar is there (it then says "Team / Voorstelling"; see huisstijl.css).
  var items = [["/versies/", "For_You", "hs-merk"], ["/catalog/", "Catalogus"], ["/catalog/media-assets/", "Beeldcatalogus"], ["/editor/", "Paden"], ["/universe/", "Universe"], ["/ideeen/", "Ideeën"], ["/schrijver/", "Script Agent"], ["/versies/", "Versies"]];
  // The longest matching address is the current page (the image catalog lives under /catalog/).
  var current = items.filter(function (item) { return !item[2] && window.location.pathname.indexOf(item[0]) === 0; })
    .sort(function (a, b) { return b[0].length - a[0].length; })[0];

  function navigation() {
    var nav = document.createElement("nav");
    nav.className = "hs-nav";
    nav.setAttribute("aria-label", "For_You voorstelling");
    items.forEach(function (item) {
      var a = document.createElement("a");
      a.href = item[0];
      a.textContent = item[1];
      if (item[2]) a.className = item[2];
      else if (item === current) a.setAttribute("aria-current", "page");
      nav.appendChild(a);
    });
    return nav;
  }

  function mount() {
    if (!document.body) return;
    // Tab title: the layers from specific to general (navigatie/09-ontwerp-def.md, 8).
    if (current && window.location.pathname.indexOf("/universe/stage") !== 0) {
      if (window.fyBalk && window.fyBalk.titel) window.fyBalk.titel(current[1]);
      else document.title = current[1] + " · Voorstelling · For_You";
    }
    if (huisstijl) {
      // One row under the team bar: the tabs go into the page's own header (the pages write into
      // it, #topMeta), the version first among the page's own buttons on the right.
      var brand = document.querySelector(".fy-brand, .topbar > .brand");
      if (brand && !brand.querySelector(".hs-nav")) brand.insertBefore(navigation(), brand.firstChild);
      var right = document.querySelector(".fy-topbar .fy-actions, .topbar > .topActions, .topbar > .topStats");
      if (right) right.insertBefore(versie, right.firstChild);
      else if (brand) brand.querySelector(".hs-nav").appendChild(versie);
      bar.style.display = "none";
    }
    if (!bar.parentNode) document.body.appendChild(bar);
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", mount);
  else mount();

  window.fetch = function (input, init) {
    if (!sameOriginApi(input)) return originalFetch(input, init);
    var options = Object.assign({}, init || {});
    var headers = new Headers(options.headers || (typeof input !== "string" && input.headers) || {});
    if (basis !== null) headers.set("x-foryou-basis", String(basis));
    options.headers = headers;
    return originalFetch(input, options).then(function (response) {
      var version = Number(response.headers.get("x-foryou-versie"));
      if (response.ok && version > 0) {
        basis = version;
        label.textContent = "For_You · versie " + version;
        versie.textContent = "versie " + version;
      }
      if (response.status === 409 || response.status === 428 || response.status === 403) {
        response.clone().json().then(function (body) {
          if (body && body.message) show(body.message);
        }).catch(function () {});
      } else if (response.ok && (options.method || "GET").toUpperCase() !== "GET") {
        show("");
      }
      return response;
    });
  };
})();
