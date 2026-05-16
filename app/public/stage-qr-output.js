"use strict";

(() => {
  const RECONNECT_MIN_MS = 500;
  const RECONNECT_MAX_MS = 6000;
  const outputKind = String(document.body && document.body.dataset.qrOutput || "session").toLowerCase();
  const qrOutputEl = document.getElementById("qrOutput");
  const wifiStackEl = document.getElementById("wifiStack");
  const wifiSsidEl = document.getElementById("wifiSsid");
  const wifiPasswordEl = document.getElementById("wifiPassword");

  const state = {
    sessionJoin: null,
    wifiQr: null,
  };

  let ws = null;
  let reconnectTimer = null;
  let reconnectDelayMs = RECONNECT_MIN_MS;
  let renderedPayload = "";

  function hideOutput() {
    renderedPayload = "";
    if (qrOutputEl) {
      qrOutputEl.classList.add("hidden");
      qrOutputEl.innerHTML = "";
    }
    if (wifiStackEl) wifiStackEl.classList.add("hidden");
    if (wifiSsidEl) wifiSsidEl.textContent = "";
    if (wifiPasswordEl) wifiPasswordEl.textContent = "";
  }

  function buildJoinUrl(join) {
    const data = join && typeof join === "object" ? join : null;
    if (!data) return "";
    const explicit = String(data.joinUrl || "").trim();
    if (explicit) return explicit;
    const path = String(data.joinPath || "").trim();
    if (!path) return "";
    try {
      return new URL(path, window.location.origin).toString();
    } catch {
      return "";
    }
  }

  function renderQr(payload, title) {
    const text = String(payload || "").trim();
    if (!qrOutputEl || !text || typeof window.qrcode !== "function") {
      hideOutput();
      return false;
    }
    if (renderedPayload === text && qrOutputEl.innerHTML) {
      qrOutputEl.classList.remove("hidden");
      return true;
    }
    try {
      const qr = window.qrcode(0, "M");
      qr.addData(text, "Byte");
      qr.make();
      qrOutputEl.innerHTML = qr.createSvgTag({
        cellSize: 6,
        margin: 1,
        scalable: true,
        title,
        alt: title,
      });
      renderedPayload = text;
      qrOutputEl.classList.remove("hidden");
      return true;
    } catch {
      hideOutput();
      return false;
    }
  }

  function renderSessionQr() {
    const joinUrl = buildJoinUrl(state.sessionJoin);
    if (!joinUrl) {
      hideOutput();
      return;
    }
    renderQr(joinUrl, "Sessie QR");
  }

  function renderWifiQr() {
    const wifi = state.wifiQr && typeof state.wifiQr === "object" ? state.wifiQr : {};
    const payload = String(wifi.payload || "").trim();
    const ssid = String(wifi.ssid || "").trim();
    const password = String(wifi.password || "").trim();
    if (!ssid || !payload) {
      hideOutput();
      return;
    }
    if (!renderQr(payload, "WiFi QR")) return;
    if (wifiStackEl) wifiStackEl.classList.remove("hidden");
    if (wifiSsidEl) wifiSsidEl.textContent = "WiFi: " + ssid;
    if (wifiPasswordEl) {
      wifiPasswordEl.textContent = String(wifi.auth || "") === "nopass"
        ? "ww: open netwerk"
        : "ww: " + password;
    }
  }

  function render() {
    if (outputKind === "wifi") {
      renderWifiQr();
      return;
    }
    renderSessionQr();
  }

  function applyStageSnapshot(snapshot) {
    const stage = snapshot && typeof snapshot === "object" ? snapshot : {};
    state.sessionJoin = stage.sessionJoin && typeof stage.sessionJoin === "object" ? stage.sessionJoin : null;
    state.wifiQr = stage.wifiQr && typeof stage.wifiQr === "object" ? stage.wifiQr : null;
    render();
  }

  function onSocketMessage(raw) {
    let msg;
    try {
      msg = JSON.parse(String(raw || "{}"));
    } catch {
      return;
    }
    if (msg.type === "stage_hello" || msg.type === "stage_state") {
      applyStageSnapshot(msg.stage || {});
      return;
    }
    if (msg.type === "session_closed") {
      state.sessionJoin = null;
      if (outputKind === "session") render();
    }
  }

  function scheduleReconnect() {
    if (reconnectTimer) return;
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      connect();
    }, reconnectDelayMs);
    reconnectDelayMs = Math.min(RECONNECT_MAX_MS, Math.floor(reconnectDelayMs * 1.6));
  }

  function connect() {
    if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) return;
    const protocol = window.location.protocol === "https:" ? "wss" : "ws";
    const wsUrl = protocol + "://" + window.location.host + "/?stage=1";

    try {
      ws = new WebSocket(wsUrl);
    } catch {
      scheduleReconnect();
      return;
    }

    ws.addEventListener("open", () => {
      reconnectDelayMs = RECONNECT_MIN_MS;
      try {
        ws.send(JSON.stringify({ type: "stage_refresh" }));
      } catch {}
    });

    ws.addEventListener("message", (event) => {
      onSocketMessage(event && event.data);
    });

    ws.addEventListener("close", () => {
      ws = null;
      scheduleReconnect();
    });

    ws.addEventListener("error", () => {});
  }

  hideOutput();
  connect();
})();
