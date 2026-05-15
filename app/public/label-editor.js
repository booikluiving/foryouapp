(() => {
  "use strict";

  const TOKEN_KEY = "algorithm_admin_token_v1";
  let token = "";
  let labels = [];
  let characters = [], situations = [], environments = [];
  let currentTab = "characters";
  let currentMode = "quick"; // "quick" | "overview"
  let quickIndex = 0;

  const $ = (id) => document.getElementById(id);
  const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" })[ch]);

  function api(path, opts = {}) {
    const headers = { "Content-Type": "application/json" };
    if (token) headers["Authorization"] = `Bearer ${token}`;
    return fetch(path, { headers, ...opts }).then((r) => {
      if (!r.ok) { const e = new Error(r.statusText); e.status = r.status; throw e; }
      return r.json();
    });
  }

  function loadToken() { try { token = localStorage.getItem(TOKEN_KEY) || ""; } catch { token = ""; } }
  function saveToken(t) { token = t; try { if (token) localStorage.setItem(TOKEN_KEY, token); else localStorage.removeItem(TOKEN_KEY); } catch {} }

  async function login() {
    $("loginMsg").textContent = "";
    try {
      const body = await api("/admin/login", {
        method: "POST",
        body: JSON.stringify({ password: $("password").value, rememberDevice: true, deviceLabel: navigator.userAgent || "" }),
      });
      saveToken(body.token); $("password").value = ""; await loadState();
    } catch { $("loginMsg").textContent = "Login mislukt."; }
  }

  async function loadState() {
    const state = await api("/admin/algorithm/state");
    labels = (state.labels || []).filter((l) => l.isActive && !l.archivedAt);
    characters = (state.characters || []).filter((c) => c.isActive && !c.archivedAt);
    situations = (state.situations || []).filter((s) => s.isActive && !s.archivedAt);
    environments = (state.environments || []).filter((e) => e.isActive && !e.archivedAt);
    $("loginScreen").style.display = "none";
    $("app").style.display = "flex";
    quickIndex = 0;
    renderAll();
  }

  function items() {
    return currentTab === "characters" ? characters : currentTab === "situations" ? situations : environments;
  }

  function kind() {
    return currentTab === "characters" ? "character" : currentTab === "situations" ? "situation" : "environment";
  }

  function getScore(item, labelId) {
    if (!item || !item.labelScores) return 0;
    const map = item.labelScores;
    if (map instanceof Map) return map.get(labelId) || 0;
    if (typeof map === "object") return Number(map[String(labelId)] || 0);
    return 0;
  }

  function setScore(item, labelId, val) {
    if (!item.labelScores) item.labelScores = new Map();
    const map = item.labelScores;
    if (map instanceof Map) {
      if (val === 0) map.delete(labelId); else map.set(labelId, val);
    } else {
      if (val === 0) delete map[String(labelId)]; else map[String(labelId)] = val;
    }
  }

  function scoresObj(item) {
    if (!item || !item.labelScores) return {};
    const map = item.labelScores;
    if (map instanceof Map) { const o = {}; map.forEach((v, k) => { o[String(k)] = v; }); return o; }
    return map;
  }

  async function saveItem(item) {
    const body = { id: item.id, name: item.name, description: item.description || "", labelScores: scoresObj(item), isActive: true };
    if (kind() === "character") body.performerId = item.performerId || 0;
    else if (kind() === "situation") { body.requiredCharacterIds = item.requiredCharacterIds || []; body.allowedCharacterIds = item.allowedCharacterIds || []; }
    const ep = `/admin/algorithm/${kind()}s/upsert`;
    await api(ep, { method: "POST", body: JSON.stringify(body) });
  }

  // ── Quick-label rendering ──
  function renderQuick() {
    const list = items();
    if (!list.length) {
      $("workArea").innerHTML = `<div style="margin-top:60px;color:var(--muted);font-size:13px">Nog geen ${kind() === "character" ? "personages" : kind() === "situation" ? "situaties" : "locaties"} — voeg ze toe in de admin.</div>`;
      return;
    }

    if (quickIndex >= list.length) {
      $("workArea").innerHTML = `
        <div class="quickCard">
          <div class="quickDone">
            <strong>✓ Alle ${kind() === "character" ? "personages" : kind() === "situation" ? "situaties" : "locaties"} gelabeld!</strong>
            <p style="margin:12px 0 0;font-size:12px;color:var(--muted)">${list.length} elementen verwerkt. Ga naar <em>Overzicht</em> voor aanpassingen.</p>
          </div>
          <div class="quickNav">
            <button onclick="location.reload()">Opnieuw beginnen</button>
          </div>
        </div>`;
      return;
    }

    const item = list[quickIndex];
    const labelRows = labels.map((label) => {
      const score = getScore(item, label.id);
      const sel0 = score === 0 ? "sel0" : "";
      const sel50 = score === 50 ? "sel50" : "";
      const sel100 = score === 100 ? "sel100" : "";
      return `<div class="labelRow">
        <span class="labelRowName">${esc(label.name)}</span>
        <div class="radioGroup">
          <span class="radioBtn ${sel0}" data-label="${label.id}" data-val="0">0%</span>
          <span class="radioBtn ${sel50}" data-label="${label.id}" data-val="50">50%</span>
          <span class="radioBtn ${sel100}" data-label="${label.id}" data-val="100">100%</span>
        </div>
      </div>`;
    }).join("");

    $("workArea").innerHTML = `
      <div class="quickCard">
        <div class="quickTitle">${esc(item.name || `#${item.id}`)}</div>
        <div class="quickSub">${kind() === "character" ? "Personage" : kind() === "situation" ? "Situatie" : "Locatie"}</div>
        <div class="quickProgress">${quickIndex + 1} / ${list.length}</div>
        ${labelRows}
        <div class="quickNav">
          <button data-action="prev" ${quickIndex === 0 ? "disabled" : ""}>← Vorige</button>
          <button data-action="next" class="primary">Volgende →</button>
        </div>
      </div>`;

    document.querySelectorAll(".radioBtn").forEach((btn) => {
      btn.addEventListener("click", () => {
        const labelId = Number(btn.dataset.label);
        const val = Number(btn.dataset.val);
        setScore(item, labelId, val);
        saveItem(item);
        renderQuick();
      });
    });
    document.querySelectorAll("[data-action]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const action = btn.dataset.action;
        if (action === "next") { quickIndex++; renderQuick(); }
        else if (action === "prev" && quickIndex > 0) { quickIndex--; renderQuick(); }
      });
    });
  }

  // ── Overview rendering ──
  function renderOverview() {
    const list = items();
    if (!list.length) {
      $("workArea").innerHTML = `<div style="margin-top:60px;color:var(--muted);font-size:13px">Nog geen ${kind() === "character" ? "personages" : kind() === "situation" ? "situaties" : "locaties"}.</div>`;
      return;
    }
    const cards = list.map((item) => {
      const ovLabels = labels.map((label) => {
        const score = getScore(item, label.id);
        return `<span class="ovLabel val${score}" data-id="${item.id}" data-label="${label.id}">${esc(label.name)} ${score}%</span>`;
      }).join("");
      return `<div class="overviewCard">
        <div class="ovName">${esc(item.name || `#${item.id}`)}</div>
        <div class="ovLabels">${ovLabels}</div>
      </div>`;
    }).join("");
    $("workArea").innerHTML = `<div class="overviewGrid">${cards}</div>`;

    document.querySelectorAll(".ovLabel").forEach((btn) => {
      btn.addEventListener("click", () => {
        const id = Number(btn.dataset.id);
        const labelId = Number(btn.dataset.label);
        const item = list.find((i) => Number(i.id) === id);
        if (!item) return;
        const cur = getScore(item, labelId);
        const next = cur === 0 ? 50 : cur === 50 ? 100 : 0;
        setScore(item, labelId, next);
        saveItem(item);
        renderOverview();
      });
    });
  }

  function renderAll() {
    $("modeLabel").textContent = currentMode === "quick" ? "Quick-label" : "Overzicht";
    if (currentMode === "quick") renderQuick(); else renderOverview();
  }

  function switchTab(tab) {
    currentTab = tab; quickIndex = 0;
    document.querySelectorAll(".tabbar button").forEach((b) => b.classList.toggle("active", b.dataset.tab === tab));
    renderAll();
  }

  function switchMode(mode) {
    currentMode = mode; quickIndex = 0;
    document.querySelectorAll(".modeSwitch button").forEach((b) => b.classList.toggle("active", b.dataset.mode === mode));
    renderAll();
  }

  loadToken();
  if (token) loadState();

  $("loginBtn").addEventListener("click", login);
  $("password").addEventListener("keydown", (e) => { if (e.key === "Enter") login(); });
  document.querySelectorAll(".tabbar button").forEach((btn) => {
    btn.addEventListener("click", () => switchTab(btn.dataset.tab));
  });
  document.querySelectorAll(".modeSwitch button").forEach((btn) => {
    btn.addEventListener("click", () => switchMode(btn.dataset.mode));
  });
})();
