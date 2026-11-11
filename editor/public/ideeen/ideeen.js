"use strict";

const SOORTEN = { situatie: "Situatie", personage: "Personage", omgeving: "Omgeving", pad: "Pad", anders: "Anders" };
const STATUSSEN = { nieuw: "Nieuw", besproken: "Besproken", "in-catalogus": "In de catalogus", "niet-nu": "Niet nu" };

const state = { ideeen: [], soort: "", status: "", zoek: "", bewerkt: null };

function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (key === "class") node.className = value;
    else if (key.startsWith("on")) node.addEventListener(key.slice(2), value);
    else if (value !== false && value != null) node.setAttribute(key, value === true ? "" : value);
  }
  for (const child of children.flat()) {
    if (child != null && child !== false) node.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return node;
}

function when(iso) {
  if (!iso) return "";
  return new Date(iso).toLocaleString("nl-NL", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Europe/Amsterdam" });
}

function ago(iso) {
  if (!iso) return "";
  const minutes = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (minutes < 1) return "zojuist";
  if (minutes < 60) return `${minutes} min geleden`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours} uur geleden`;
  return when(iso);
}

async function api(path, options = {}) {
  const isFile = options.body instanceof Blob;
  const response = await fetch(`/api${path}`, {
    ...options,
    headers: isFile ? options.headers : { "content-type": "application/json", ...(options.headers || {}) },
  });
  const body = await response.json().catch(() => ({}));
  if (response.status === 413) throw new Error("Deze foto is te groot (meer dan 25 MB).");
  if (!response.ok) throw new Error(body.message || body.error || `HTTP ${response.status}`);
  return body;
}

function uploadFoto(id, file) {
  return api(`/ideeen/${encodeURIComponent(id)}/foto`, { method: "PUT", headers: { "content-type": file.type || "image/jpeg" }, body: file });
}

// Every change ends with the list as it is on the server.
async function doe(work) {
  try {
    await work();
    await load();
  } catch (err) {
    alert(err.message);
  }
}

function shortLink(url) {
  try {
    const parsed = new URL(url);
    let rest = `${parsed.pathname}${parsed.search}`.replace(/\/$/, "");
    try {
      rest = decodeURI(rest);
    } catch (_err) {
      // Shown as it is.
    }
    const text = `${parsed.host.replace(/^www\./, "")}${rest}`;
    return text.length > 60 ? `${text.slice(0, 57)}…` : text;
  } catch (_err) {
    return url;
  }
}

function keuzes(name, options, checked, onchange) {
  return Object.entries(options).map(([value, label]) => el("label", {},
    el("input", { type: "radio", name, value, checked: value === checked, onchange }),
    el("span", {}, label)));
}

// ---- One idea ----

function reacties(idee) {
  if (!idee.reacties.length) return null;
  return el("ul", { class: "reacties" }, idee.reacties.map((reactie) => el("li", {},
    el("strong", {}, reactie.naam), " ", reactie.tekst, " ",
    el("span", { class: "zacht", title: when(reactie.at) }, ago(reactie.at)),
    reactie.eigen ? [" ", el("button", {
      class: "licht",
      onclick: () => confirm("Je reactie weghalen?") && doe(() => api(`/ideeen/${encodeURIComponent(idee.id)}/reacties/${encodeURIComponent(reactie.id)}`, { method: "DELETE" })),
    }, "weg")] : null)));
}

function reageer(idee) {
  const input = el("input", { type: "text", maxlength: "1000", placeholder: "Reageer…", "aria-label": "Reageer op dit idee" });
  return el("form", {
    class: "reageer",
    onsubmit: (event) => {
      event.preventDefault();
      const tekst = input.value.trim();
      if (tekst) doe(() => api(`/ideeen/${encodeURIComponent(idee.id)}/reacties`, { method: "POST", body: JSON.stringify({ tekst }) }));
    },
  }, input, el("button", { type: "submit" }, "Stuur"));
}

function eigenKnoppen(idee) {
  const id = encodeURIComponent(idee.id);
  const kies = el("input", {
    type: "file",
    accept: "image/*",
    hidden: true,
    onchange: () => kies.files[0] && doe(() => uploadFoto(idee.id, kies.files[0])),
  });
  return el("div", { class: "knoppen" },
    el("button", { class: "licht", onclick: () => { state.bewerkt = idee.id; render(); } }, "Aanpassen"),
    el("button", { class: "licht", onclick: () => kies.click() }, idee.foto ? "Andere foto" : "Foto toevoegen"), kies,
    idee.foto ? el("button", { class: "licht", onclick: () => confirm("De foto weghalen?") && doe(() => api(`/ideeen/${id}/foto`, { method: "DELETE" })) }, "Foto weghalen") : null,
    el("button", { class: "licht", onclick: () => confirm("Dit idee weghalen?") && doe(() => api(`/ideeen/${id}`, { method: "DELETE" })) }, "Weghalen"));
}

// Who the idea is from: the name in bold, anything in brackets after it soft ("Brent (in de groepsapp)"),
// and who dropped it when that was someone else.
function van(idee) {
  if (!idee.namens) return el("strong", {}, idee.naam);
  const haakje = idee.namens.indexOf(" (");
  const naam = haakje > 0 ? idee.namens.slice(0, haakje) : idee.namens;
  const rest = haakje > 0 ? idee.namens.slice(haakje + 1) : "";
  return el("span", {}, el("strong", {}, naam), rest ? el("span", { class: "zacht" }, ` ${rest}`) : null, el("span", { class: "zacht" }, ` · via ${idee.naam}`));
}

function ideeItem(idee) {
  const status = el("select", {
    "aria-label": "Status",
    onchange: (event) => doe(() => api(`/ideeen/${encodeURIComponent(idee.id)}/status`, { method: "PUT", body: JSON.stringify({ status: event.target.value }) })),
  }, Object.entries(STATUSSEN).map(([value, label]) => el("option", { value, selected: value === idee.status }, label)));
  return el("li", {},
    el("div", { class: "kop" },
      el("span", { class: "label" }, SOORTEN[idee.soort] || idee.soort),
      van(idee),
      el("span", { class: "zacht", title: when(idee.at) }, `${ago(idee.at)}${idee.gewijzigdAt ? " · aangepast" : ""}`),
      status),
    idee.statusNaam && idee.status !== "nieuw"
      ? el("div", { class: "zacht", style: "font-size:13px" }, `${STATUSSEN[idee.status] || idee.status}: ${idee.statusNaam}, ${ago(idee.statusAt)}`)
      : null,
    el("p", { class: "tekst" }, idee.tekst),
    idee.link ? el("a", { class: "link", href: idee.link, target: "_blank", rel: "noopener noreferrer" }, shortLink(idee.link)) : null,
    idee.foto ? el("a", { class: "foto", href: idee.foto.groot, target: "_blank" }, el("img", { src: idee.foto.klein, alt: "Foto bij het idee", loading: "lazy", decoding: "async" })) : null,
    reacties(idee),
    reageer(idee),
    idee.eigen ? eigenKnoppen(idee) : null);
}

function bewerkItem(idee) {
  const soort = el("select", { "aria-label": "Soort" }, Object.entries(SOORTEN).map(([value, label]) => el("option", { value, selected: value === idee.soort }, label)));
  const tekst = el("textarea", { maxlength: "2000", "aria-label": "Je idee" }, idee.tekst);
  const link = el("input", { type: "url", inputmode: "url", value: idee.link, placeholder: "Een link erbij (mag leeg blijven)", "aria-label": "Link" });
  const namens = el("input", { type: "text", maxlength: "120", autocomplete: "off", value: idee.namens, placeholder: "Van wie? (leeg = van jou)", "aria-label": "Namens" });
  const melding = el("span", { class: "fout", role: "status" });
  const opslaan = async (event) => {
    event.preventDefault();
    try {
      await api(`/ideeen/${encodeURIComponent(idee.id)}`, { method: "PATCH", body: JSON.stringify({ soort: soort.value, tekst: tekst.value, link: link.value, namens: namens.value }) });
      state.bewerkt = null;
      await load();
    } catch (err) {
      melding.textContent = err.message;
    }
  };
  return el("li", {}, el("form", { class: "bewerk", novalidate: true, onsubmit: opslaan },
    soort, tekst,
    el("div", { class: "extra" }, link, namens),
    el("div", { class: "knoppen" },
      el("button", { type: "submit" }, "Opslaan"),
      el("button", { class: "licht", type: "button", onclick: () => { state.bewerkt = null; render(); } }, "Annuleren"),
      melding)));
}

// ---- The list ----

function past(idee) {
  if (state.soort && idee.soort !== state.soort) return false;
  if (state.status && idee.status !== state.status) return false;
  if (!state.zoek) return true;
  const tekst = [idee.tekst, idee.naam, idee.namens, idee.link, ...idee.reacties.map((reactie) => `${reactie.naam} ${reactie.tekst}`)].join(" ").toLowerCase();
  return state.zoek.toLowerCase().split(/\s+/).filter(Boolean).every((woord) => tekst.includes(woord));
}

function render() {
  const alle = state.ideeen.length;
  const getoond = state.ideeen.filter(past);
  document.getElementById("telling").textContent = !alle
    ? "Nog geen ideeën. Drop de eerste hierboven."
    : !getoond.length
      ? "Geen ideeën die hierbij passen."
      : getoond.length === alle ? `${alle} ${alle === 1 ? "idee" : "ideeën"}` : `${getoond.length} van ${alle} ideeën`;
  document.getElementById("ideeen").replaceChildren(...getoond.map((idee) => (state.bewerkt === idee.id ? bewerkItem(idee) : ideeItem(idee))));
}

async function load() {
  const data = await api("/ideeen");
  state.ideeen = data.ideeen;
  if (state.bewerkt && !state.ideeen.some((idee) => idee.id === state.bewerkt)) state.bewerkt = null;
  document.getElementById("wie").textContent = `Ingelogd als ${data.me}`;
  render();
}

// Someone is typing or changing something in the list: then it is not redrawn underneath them.
function bezig() {
  const lijst = document.getElementById("ideeen");
  return Boolean(state.bewerkt)
    || lijst.contains(document.activeElement)
    || [...lijst.querySelectorAll(".reageer input")].some((input) => input.value.trim());
}

// ---- Dropping a new idea ----

function setupForm() {
  const form = document.getElementById("nieuw");
  const tekst = document.getElementById("tekst");
  const link = document.getElementById("link");
  const namens = document.getElementById("namens");
  const foto = document.getElementById("foto");
  const fotoNaam = document.getElementById("foto-naam");
  const knop = document.getElementById("drop");
  const melding = document.getElementById("melding");
  let laatste = "";
  try {
    laatste = window.localStorage.getItem("foryou-idee-soort") || "";
  } catch (_err) {
    laatste = "";
  }
  document.getElementById("soort").append(...keuzes("soort", SOORTEN, laatste));
  foto.addEventListener("change", () => { fotoNaam.textContent = foto.files[0] ? foto.files[0].name : ""; });
  // Cmd/Ctrl + Enter drops it too.
  tekst.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) form.requestSubmit();
  });
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const soort = form.querySelector('input[name="soort"]:checked');
    melding.className = "fout";
    if (!soort) {
      melding.textContent = "Kies eerst wat voor idee het is.";
      return;
    }
    if (!tekst.value.trim()) {
      melding.textContent = "Schrijf eerst je idee op.";
      tekst.focus();
      return;
    }
    knop.disabled = true;
    melding.className = "zacht";
    melding.textContent = "Bezig…";
    try {
      const { idee } = await api("/ideeen", { method: "POST", body: JSON.stringify({ soort: soort.value, tekst: tekst.value, link: link.value, namens: namens.value }) });
      try {
        window.localStorage.setItem("foryou-idee-soort", soort.value);
      } catch (_err) {
        // Only a convenience.
      }
      let fotoFout = "";
      if (foto.files[0]) {
        try {
          await uploadFoto(idee.id, foto.files[0]);
        } catch (err) {
          fotoFout = err.message;
        }
      }
      tekst.value = "";
      link.value = "";
      namens.value = "";
      foto.value = "";
      fotoNaam.textContent = "";
      melding.className = fotoFout ? "fout" : "zacht";
      melding.textContent = fotoFout ? `Je idee staat erin, maar de foto lukte niet: ${fotoFout}` : "Je idee staat erin.";
      await load();
    } catch (err) {
      melding.className = "fout";
      melding.textContent = err.message;
    } finally {
      knop.disabled = false;
    }
  });
}

function setupFilters() {
  const soorten = document.getElementById("filter-soort");
  soorten.append(...keuzes("filter-soort", { "": "Alles", ...SOORTEN }, "", (event) => { state.soort = event.target.value; render(); }));
  const status = document.getElementById("filter-status");
  status.append(...Object.entries({ "": "Alle statussen", ...STATUSSEN }).map(([value, label]) => el("option", { value }, label)));
  status.addEventListener("change", () => { state.status = status.value; render(); });
  document.getElementById("zoek").addEventListener("input", (event) => { state.zoek = event.target.value.trim(); render(); });
}

setupForm();
setupFilters();
load().catch((err) => {
  const telling = document.getElementById("telling");
  telling.className = "fout";
  telling.textContent = `Laden mislukt: ${err.message}`;
});
setInterval(() => {
  if (!bezig() && !document.hidden) load().catch(() => {});
}, 30000);
