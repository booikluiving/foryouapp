// Stand-in for the team bar of www.foryouniverse.nl/_balk/ (built by the hub), only for the tests and
// the local preview. It follows the contract in navigatie/09-ontwerp-def.md 9.4: drawn at once before
// its own tag, sets html.fy-met-balk and --fy-balk-h, nothing in an iframe.
(function () {
  "use strict";
  var me = document.currentScript;
  var root = document.documentElement;
  if (window.top !== window.self) {
    root.style.setProperty("--fy-balk-h", "0px");
    return;
  }
  var nav = document.createElement("nav");
  nav.className = "fy-balk";
  nav.setAttribute("aria-label", "Teambalk");
  nav.innerHTML = '<span class="fy-links">' +
    '<a class="fy-plek fy-team" href="https://www.foryouniverse.nl/team/"><span>Team</span></a>' +
    '<span class="fy-scheid" aria-hidden="true">/</span>' +
    '<a class="fy-plek fy-gereedschap" href="/" aria-current="true" title="Voorstelling"><span>Voorstelling</span></a>' +
    "</span>";
  if (me.dataset.naam) {
    var naam = document.createElement("span");
    naam.className = "fy-naam";
    naam.textContent = me.dataset.naam;
    nav.appendChild(naam);
  }
  me.before(nav);
  root.classList.add("fy-met-balk");
})();
