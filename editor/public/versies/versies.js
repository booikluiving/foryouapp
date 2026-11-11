"use strict";

const COLLECTION_NAMES = {
  situations: "situatie",
  characters: "personage",
  environments: "omgeving",
  performers: "performer",
  labels: "label",
  paths: "pad",
  crossingThresholds: "kruising",
  mediaAssets: "media",
  environmentCompositions: "compositie",
  lightingPresets: "lichtstand",
};

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
  if (!iso) return "nooit";
  const minutes = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (minutes < 1) return "zojuist";
  if (minutes < 60) return `${minutes} min geleden`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours} uur geleden`;
  return when(iso);
}

async function api(path, options = {}) {
  const response = await fetch(`/api${path}`, {
    ...options,
    headers: { "content-type": "application/json", ...(options.headers || {}) },
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.message || body.error || `HTTP ${response.status}`);
  return body;
}

function changeList(changes, limit = 6) {
  if (!changes || !changes.length) return null;
  const items = changes.slice(0, limit).map((change) => el("li", {}, `${change.kind}: ${COLLECTION_NAMES[change.collection] || change.collection} ${change.label}`));
  if (changes.length > limit) items.push(el("li", {}, `en nog ${changes.length - limit}`));
  return el("ul", { class: "wijzigingen" }, items);
}

const SHOW_MAC_STATES = {
  bijgewerkt: "draait de nieuwste vrijgegeven versie",
  wacht: "wacht op een stil moment",
  bezig: "zet een nieuwe versie klaar",
  conflict: "heeft eigen wijzigingen die botsen met de website",
  fout: "kon een versie niet zetten",
  offline: "kon de website niet bereiken",
};

function renderStatus(stand) {
  const box = document.getElementById("status");
  box.className = "";
  box.replaceChildren();
  const released = stand.released;
  box.append(el("p", {}, released
    ? `Vrijgegeven voor de show: versie ${released.nr}, ${when(stand.releasedAt || released.at)}${stand.releasedBy ? ` (${stand.releasedBy})` : ""}.`
    : "Nog niets vrijgegeven."));
  const mac = stand.showMac;
  if (!mac) {
    box.append(el("p", { class: "zacht" }, "De show-Mac heeft zich nog niet gemeld."));
  } else {
    const fresh = Date.now() - new Date(mac.receivedAt).getTime() < 5 * 60 * 1000;
    const state = SHOW_MAC_STATES[mac.state] || mac.state || "";
    box.append(el("p", { class: mac.state === "fout" || mac.state === "conflict" ? "fout" : "" },
      `Show-Mac: draait versie ${mac.appliedVersion || "?"}, ${state}. Laatst gemeld ${ago(mac.receivedAt)}${fresh ? "" : " (nu niet bereikbaar)"}.`));
    if (mac.message) box.append(el("p", { class: "zacht" }, mac.message));
  }
  if (stand.head && released && stand.head.nr !== released.nr) {
    box.append(el("p", {}, `Versie ${stand.head.nr} is de nieuwste en nog niet vrijgegeven.`));
  }
  box.append(el("p", { class: "zacht" }, stand.autoRelease
    ? "Elke foutloze versie gaat vanzelf naar de show."
    : "Een versie gaat pas naar de show als iemand hem vrijgeeft."));
  box.append(el("p", { class: "zacht" }, "De show-Mac zet een vrijgegeven versie erin als er geen situatie speelt en de show een tijd stil staat, of na een reset. Een lopende run speelt door met wat hij had."));
}

function renderConflict(stand) {
  const box = document.getElementById("conflict");
  box.replaceChildren();
  const conflict = stand.conflict;
  if (!conflict) return;
  const choose = async (keuze) => {
    const text = keuze === "show-mac"
      ? "De wijzigingen van de show-Mac worden de nieuwe versie. De versies van de website blijven bewaard. Doorgaan?"
      : "De show-Mac krijgt de website-versie. Zijn eigen wijzigingen blijven hier bewaard als voorstel. Doorgaan?";
    if (!confirm(text)) return;
    try {
      await api("/conflict/kies", { method: "POST", body: JSON.stringify({ id: conflict.id, keuze }) });
      await load();
    } catch (err) {
      alert(err.message);
    }
  };
  box.append(el("div", { class: "melding" },
    el("strong", {}, "De show-Mac heeft eigen wijzigingen"),
    el("p", {}, `Gemaakt op versie ${conflict.basis}, terwijl de website intussen versie ${conflict.headAtUpload} had (${when(conflict.at)}). Er wordt niets overschreven tot iemand kiest.`),
    changeList(conflict.changes, 12),
    el("div", { class: "knoppen" },
      el("button", { onclick: () => choose("show-mac") }, "Neem de show-Mac over"),
      el("button", { class: "licht", onclick: () => choose("website") }, "Houd de website-versie"))));
}

function renderVersions(stand, versions) {
  const list = document.getElementById("versies");
  list.replaceChildren();
  const releasedNr = stand.released ? stand.released.nr : 0;
  for (const version of versions) {
    const validation = version.validation || {};
    const errors = (validation.catalog ? validation.catalog.errors || 0 : 0) + (validation.paths ? validation.paths.errors || 0 : 0);
    const release = async () => {
      if (!confirm(`Versie ${version.nr} vrijgeven voor de show?`)) return;
      try {
        await api("/vrijgeven", { method: "POST", body: JSON.stringify({ nr: version.nr }) });
        await load();
      } catch (err) {
        alert(err.message);
      }
    };
    const restore = async () => {
      if (!confirm(`De inhoud van versie ${version.nr} terugzetten? Dat wordt een nieuwe versie.`)) return;
      try {
        await api("/terugzetten", { method: "POST", body: JSON.stringify({ nr: version.nr }) });
        await load();
      } catch (err) {
        alert(err.message);
      }
    };
    const isHead = stand.head && version.nr === stand.head.nr;
    list.append(el("li", {},
      el("div", { class: "kop" },
        el("span", { class: "nr" }, `Versie ${version.nr}`),
        el("span", {}, when(version.at)),
        el("span", { class: "zacht" }, version.author),
        version.nr === releasedNr ? el("span", { class: "label" }, "in de show") : null,
        errors ? el("span", { class: "fout" }, `${errors} fout${errors === 1 ? "" : "en"}`) : null),
      el("div", { class: "zacht" }, version.reason || ""),
      version.kind === "begin" || version.kind === "uitbreiding" ? null : changeList(version.changes),
      el("div", { class: "knoppen" },
        version.nr !== releasedNr && !errors && !stand.autoRelease ? el("button", { onclick: release }, "Geef vrij voor de show") : null,
        !isHead ? el("button", { class: "licht", onclick: restore }, "Zet deze versie terug") : null)));
  }
}

async function load() {
  const [stand, list] = await Promise.all([api("/stand"), api("/versies")]);
  document.getElementById("wie").textContent = `Ingelogd als ${stand.me}`;
  renderConflict(stand);
  renderStatus(stand);
  renderVersions(stand, list.versions);
}

load().catch((err) => {
  const box = document.getElementById("status");
  box.className = "fout";
  box.textContent = `Laden mislukt: ${err.message}`;
});
setInterval(() => { load().catch(() => {}); }, 30000);
