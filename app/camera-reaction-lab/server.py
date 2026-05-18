#!/usr/bin/env python3
"""Standalone live camera reaction lab.

This is intentionally a lightweight prototype:
- receives camera URLs through the browser UI;
- keeps camera URLs in runtime memory only;
- uses OpenCV cascades for face/smile/eye signals;
- serves a browser view and MJPEG stream without a web framework.

The reaction labels are heuristics, not a trained emotion model yet. They are
good enough to validate the live UniFi -> Mac Studio -> browser pipeline.
"""

from __future__ import annotations

import argparse
import json
import math
import os
import signal
import secrets
import subprocess
import sys
import threading
import time
from dataclasses import dataclass, field
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any
from urllib.parse import parse_qs, urlparse


CASCADE_DIRS = [
    Path("/opt/homebrew/opt/opencv/share/opencv4/haarcascades"),
    Path("/opt/homebrew/share/opencv4/haarcascades"),
    Path("/usr/local/opt/opencv/share/opencv4/haarcascades"),
]

PALETTE = {
    "laughing": (26, 188, 156),
    "happy": (46, 204, 113),
    "engaged": (52, 152, 219),
    "focused": (155, 89, 182),
    "bored": (241, 196, 15),
    "confused": (230, 126, 34),
    "surprised": (231, 76, 60),
    "neutral": (189, 195, 199),
    "uncertain": (149, 165, 166),
}


HTML_PAGE = """<!doctype html>
<html lang="nl">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>For You Camera Reactions</title>
  <style>
    :root {
      color-scheme: dark;
      --bg: #101214;
      --panel: #181c20;
      --line: #2b3238;
      --text: #eef2f5;
      --muted: #9da8b3;
      --good: #2ecc71;
      --warn: #f1c40f;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      min-height: 100vh;
      background: var(--bg);
      color: var(--text);
      font-family: -apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI", sans-serif;
      letter-spacing: 0;
    }
    header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 16px;
      padding: 14px 18px;
      border-bottom: 1px solid var(--line);
      background: #14171a;
    }
    h1 {
      margin: 0;
      font-size: 18px;
      line-height: 1.2;
      font-weight: 650;
    }
    main {
      display: grid;
      grid-template-columns: minmax(0, 1fr) 320px;
      gap: 16px;
      padding: 16px;
    }
    .video-wrap {
      min-width: 0;
      background: #050607;
      border: 1px solid var(--line);
      border-radius: 8px;
      overflow: hidden;
    }
    img {
      display: block;
      width: 100%;
      height: auto;
      aspect-ratio: 16 / 9;
      object-fit: contain;
      background: #050607;
    }
    aside {
      display: grid;
      gap: 12px;
      align-content: start;
    }
    .panel {
      border: 1px solid var(--line);
      border-radius: 8px;
      background: var(--panel);
      padding: 12px;
    }
    .panel h2 {
      margin: 0 0 10px;
      font-size: 13px;
      font-weight: 650;
      color: var(--muted);
      text-transform: uppercase;
    }
    .stat {
      display: flex;
      justify-content: space-between;
      gap: 12px;
      padding: 6px 0;
      border-top: 1px solid rgba(255,255,255,0.06);
      font-size: 14px;
    }
    .stat:first-of-type { border-top: 0; }
    .value { font-variant-numeric: tabular-nums; }
    .pill {
      display: inline-flex;
      align-items: center;
      min-height: 24px;
      padding: 2px 8px;
      border-radius: 999px;
      background: #222a30;
      font-size: 13px;
      color: var(--text);
    }
    .dot {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      background: var(--warn);
      margin-right: 8px;
    }
    .dot.ok { background: var(--good); }
    .bars {
      display: grid;
      gap: 8px;
    }
    .bar-row {
      display: grid;
      grid-template-columns: 88px minmax(80px, 1fr) 28px;
      align-items: center;
      gap: 8px;
      font-size: 13px;
    }
    .bar {
      height: 8px;
      border-radius: 999px;
      background: #273039;
      overflow: hidden;
    }
    .fill {
      width: 0;
      height: 100%;
      background: #2ecc71;
      transition: width 160ms ease;
    }
    .meters {
      display: grid;
      gap: 10px;
    }
    .meter-row {
      display: grid;
      grid-template-columns: 78px minmax(90px, 1fr) 48px;
      gap: 8px;
      align-items: center;
      font-size: 13px;
    }
    .meter {
      height: 12px;
      border-radius: 999px;
      background: #273039;
      overflow: hidden;
    }
    .meter-fill {
      width: 0;
      height: 100%;
      background: #2ecc71;
      transition: width 80ms linear;
    }
    .input-label {
      display: block;
      margin-bottom: 6px;
      color: var(--muted);
      font-size: 13px;
      font-weight: 650;
    }
    .url-input {
      display: block;
      width: 100%;
      min-height: 36px;
      border: 1px solid var(--line);
      border-radius: 6px;
      background: #0d1013;
      color: var(--text);
      padding: 7px 9px;
      font: inherit;
      letter-spacing: 0;
    }
    .actions {
      display: grid;
      grid-template-columns: repeat(3, minmax(0, 1fr));
      gap: 8px;
      margin-top: 10px;
    }
    button {
      min-height: 34px;
      border: 1px solid var(--line);
      border-radius: 6px;
      background: #222a30;
      color: var(--text);
      font: inherit;
      cursor: pointer;
    }
    button:hover { background: #2b343b; }
    .message {
      margin-top: 10px;
      color: var(--muted);
      font-size: 13px;
      line-height: 1.35;
      overflow-wrap: anywhere;
    }
    .controls {
      display: grid;
      gap: 12px;
    }
    .control {
      display: grid;
      grid-template-columns: 1fr auto;
      gap: 6px 10px;
      align-items: center;
      font-size: 13px;
    }
    .control label {
      color: var(--text);
    }
    .control output {
      color: var(--muted);
      font-variant-numeric: tabular-nums;
    }
    .control input {
      grid-column: 1 / -1;
      width: 100%;
      accent-color: #3498db;
    }
    @media (max-width: 900px) {
      main { grid-template-columns: 1fr; }
      aside { grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); }
    }
  </style>
</head>
<body>
  <header>
    <h1>For You Camera Reactions</h1>
    <span class="pill"><span id="dot" class="dot"></span><span id="status">idle</span></span>
  </header>
  <main>
    <section class="video-wrap">
      <img id="videoFeed" alt="Live camera reaction overlay">
    </section>
    <aside>
      <section class="panel">
        <h2>Camera Feed</h2>
        <form id="streamForm" autocomplete="off">
          <label class="input-label" for="cameraUrl">RTSP/RTSPS URL</label>
          <input id="cameraUrl" class="url-input" type="password" inputmode="url" spellcheck="false" placeholder="rtsps://..." autocomplete="off">
          <div class="actions">
            <button id="startBtn" type="submit">Start</button>
            <button id="stopBtn" type="button">Stop</button>
            <button id="clearBtn" type="button">Clear URL</button>
          </div>
        </form>
        <div id="streamMessage" class="message">Idle. Paste a stream URL to start.</div>
      </section>
      <section class="panel">
        <h2>Live</h2>
        <div class="stat"><span>Stream</span><span id="active" class="value">idle</span></div>
        <div class="stat"><span>Frames</span><span id="frames" class="value">0</span></div>
        <div class="stat"><span>FPS</span><span id="fps" class="value">0.0</span></div>
        <div class="stat"><span>Faces</span><span id="faces" class="value">0</span></div>
        <div class="stat"><span>Updated</span><span id="updated" class="value">-</span></div>
      </section>
      <section class="panel">
        <h2>Reactions</h2>
        <div id="bars" class="bars"></div>
      </section>
      <section class="panel">
        <h2>Audio</h2>
        <div class="meters">
          <div class="meter-row">
            <span>Level</span>
            <span class="meter"><span id="audio-level-fill" class="meter-fill" style="background:#2ecc71"></span></span>
            <span id="audio-level" class="value">0%</span>
          </div>
          <div class="meter-row">
            <span>Reaction</span>
            <span class="meter"><span id="audio-reaction-fill" class="meter-fill" style="background:#3498db"></span></span>
            <span id="audio-reaction" class="value">0%</span>
          </div>
          <div class="meter-row">
            <span>Laugh</span>
            <span class="meter"><span id="audio-laugh-fill" class="meter-fill" style="background:#1abc9c"></span></span>
            <span id="audio-laugh" class="value">0%</span>
          </div>
        </div>
        <div class="stat"><span>Status</span><span id="audio-status" class="value">idle</span></div>
        <div class="stat"><span>dBFS</span><span id="audio-dbfs" class="value">-</span></div>
        <div class="stat"><span>Noise floor</span><span id="audio-floor" class="value">-</span></div>
        <div class="stat"><span>Centroid</span><span id="audio-centroid" class="value">-</span></div>
      </section>
      <section class="panel">
        <h2>Signals</h2>
        <div class="stat"><span>Laughing</span><span id="laughing" class="value">0</span></div>
        <div class="stat"><span>Happy</span><span id="happy" class="value">0</span></div>
        <div class="stat"><span>Engaged</span><span id="engaged" class="value">0</span></div>
        <div class="stat"><span>Bored</span><span id="bored" class="value">0</span></div>
        <div class="stat"><span>Confused</span><span id="confused" class="value">0</span></div>
      </section>
      <section class="panel">
        <h2>Tuning</h2>
        <div id="controls" class="controls"></div>
      </section>
    </aside>
  </main>
  <script>
    const labels = ["laughing", "happy", "engaged", "focused", "bored", "confused", "surprised", "neutral", "uncertain"];
    const colors = {
      laughing: "#1abc9c", happy: "#2ecc71", engaged: "#3498db", focused: "#9b59b6", bored: "#f1c40f",
      confused: "#e67e22", surprised: "#e74c3c", neutral: "#bdc3c7", uncertain: "#95a5a6"
    };
    const streamForm = document.getElementById("streamForm");
    const cameraUrl = document.getElementById("cameraUrl");
    const startBtn = document.getElementById("startBtn");
    const stopBtn = document.getElementById("stopBtn");
    const clearBtn = document.getElementById("clearBtn");
    const streamMessage = document.getElementById("streamMessage");
    const videoFeed = document.getElementById("videoFeed");
    let videoAttached = false;
    const controlDefs = [
      { key: "face_score", label: "Face score", min: 0.2, max: 0.95, step: 0.01 },
      { key: "smile_scale", label: "Smile scale", min: 1.05, max: 1.8, step: 0.01 },
      { key: "smile_neighbors", label: "Smile neighbors", min: 3, max: 30, step: 1 },
      { key: "happy_strength", label: "Happy strength", min: 0, max: 0.08, step: 0.001 },
      { key: "laughing_strength", label: "Laughing strength", min: 0, max: 0.1, step: 0.001 },
      { key: "laughing_smiles", label: "Laughing smile count", min: 1, max: 5, step: 1 },
      { key: "confused_tilt", label: "Confused tilt", min: 0, max: 35, step: 0.5 },
      { key: "one_eye_confused_tilt", label: "One-eye confused tilt", min: 0, max: 35, step: 0.5 },
      { key: "engaged_motion", label: "Engaged motion", min: 0, max: 80, step: 1 },
      { key: "bored_after_seconds", label: "Bored after seconds", min: 0, max: 12, step: 0.1 },
      { key: "bored_motion", label: "Bored max motion", min: 0, max: 30, step: 0.5 },
      { key: "audio_reaction_threshold_db", label: "Audio reaction dB above floor", min: 0, max: 30, step: 0.5 },
      { key: "audio_laugh_zcr", label: "Laugh zero-crossing", min: 0, max: 0.3, step: 0.005 },
      { key: "audio_laugh_centroid", label: "Laugh brightness Hz", min: 200, max: 6000, step: 100 }
    ];
    const bars = document.getElementById("bars");
    bars.innerHTML = labels.map((label) => `
      <div class="bar-row">
        <span>${label}</span>
        <span class="bar"><span id="bar-${label}" class="fill" style="background:${colors[label]}"></span></span>
        <span id="count-${label}" class="value">0</span>
      </div>
    `).join("");
    const controls = document.getElementById("controls");
    controls.innerHTML = controlDefs.map((def) => `
      <div class="control">
        <label for="cfg-${def.key}">${def.label}</label>
        <output id="out-${def.key}">-</output>
        <input id="cfg-${def.key}" type="range" min="${def.min}" max="${def.max}" step="${def.step}">
      </div>
    `).join("");
    let config = {};
    let updateTimer = 0;
    const accessToken = new URLSearchParams(window.location.search).get("token") || "";
    function withToken(url) {
      if (!accessToken) return url;
      const next = new URL(url, window.location.href);
      next.searchParams.set("token", accessToken);
      return next.pathname + next.search;
    }
    function authHeaders(headers) {
      const next = Object.assign({}, headers || {});
      if (accessToken) next["x-camera-lab-token"] = accessToken;
      return next;
    }
    function formatValue(value, step) {
      const numeric = Number(value);
      if (!Number.isFinite(numeric)) return "-";
      if (Number(step) >= 1) return String(Math.round(numeric));
      return numeric.toFixed(Number(step) < 0.01 ? 3 : 2);
    }
    function setControlValues(nextConfig) {
      config = nextConfig || {};
      controlDefs.forEach((def) => {
        const input = document.getElementById("cfg-" + def.key);
        const output = document.getElementById("out-" + def.key);
        if (!input || config[def.key] === undefined) return;
        input.value = config[def.key];
        output.value = formatValue(config[def.key], def.step);
      });
    }
    async function loadConfig() {
      const res = await fetch(withToken("/config.json"), { cache: "no-store", headers: authHeaders() });
      setControlValues(await res.json());
    }
    async function saveConfig(patch) {
      const res = await fetch(withToken("/config.json"), {
        method: "POST",
        headers: authHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify(patch)
      });
      setControlValues(await res.json());
    }
    controlDefs.forEach((def) => {
      const input = document.getElementById("cfg-" + def.key);
      const output = document.getElementById("out-" + def.key);
      input.addEventListener("input", () => {
        const value = Number(input.value);
        output.value = formatValue(value, def.step);
        window.clearTimeout(updateTimer);
        updateTimer = window.setTimeout(() => saveConfig({ [def.key]: value }).catch(console.error), 120);
      });
    });
    async function postJson(url, body) {
      const res = await fetch(withToken(url), {
        method: "POST",
        headers: authHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify(body || {})
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(payload.error || res.statusText || "request failed");
      return payload;
    }
    async function startStream() {
      const url = cameraUrl.value.trim();
      if (!url) {
        streamMessage.textContent = "Paste an RTSP or RTSPS URL first.";
        return;
      }
      startBtn.disabled = true;
      streamMessage.textContent = "Starting stream...";
      try {
        await postJson("/stream/start", { url });
        videoFeed.src = withToken("/video.mjpg?ts=" + Date.now());
        videoAttached = true;
        streamMessage.textContent = "Stream starting. URL is held in memory only.";
      } catch (err) {
        streamMessage.textContent = "Start failed: " + (err && err.message ? err.message : "unknown error");
      } finally {
        startBtn.disabled = false;
      }
    }
    async function stopStream(clearInput) {
      stopBtn.disabled = true;
      try {
        await postJson("/stream/stop", {});
        videoFeed.removeAttribute("src");
        videoAttached = false;
        if (clearInput) cameraUrl.value = "";
        streamMessage.textContent = clearInput ? "Stopped and URL cleared." : "Stopped.";
      } catch (err) {
        streamMessage.textContent = "Stop failed: " + (err && err.message ? err.message : "unknown error");
      } finally {
        stopBtn.disabled = false;
      }
    }
    streamForm.addEventListener("submit", (event) => {
      event.preventDefault();
      startStream();
    });
    stopBtn.addEventListener("click", () => stopStream(false));
    clearBtn.addEventListener("click", () => stopStream(true));
    async function tick() {
      try {
        const res = await fetch(withToken("/state.json"), { cache: "no-store", headers: authHeaders() });
        const state = await res.json();
        const active = !!state.active;
        document.getElementById("dot").className = "dot " + (state.opened ? "ok" : "");
        document.getElementById("status").textContent = state.opened ? "live" : (active ? "starting" : "idle");
        document.getElementById("active").textContent = active ? (state.opened ? "live" : "starting") : "idle";
        streamMessage.textContent = state.message || (active ? "Starting..." : "Idle. Paste a stream URL to start.");
        if (active && !videoAttached) {
          videoFeed.src = withToken("/video.mjpg?ts=" + Date.now());
          videoAttached = true;
        }
        if (!active && videoAttached) {
          videoFeed.removeAttribute("src");
          videoAttached = false;
        }
        document.getElementById("frames").textContent = state.frames;
        document.getElementById("fps").textContent = state.fps.toFixed(1);
        document.getElementById("faces").textContent = state.faces;
        document.getElementById("updated").textContent = state.age_ms + " ms";
        const counts = state.reaction_counts || {};
        const max = Math.max(1, ...Object.values(counts));
        labels.forEach((label) => {
          const count = counts[label] || 0;
          document.getElementById("count-" + label).textContent = count;
          document.getElementById("bar-" + label).style.width = Math.round((count / max) * 100) + "%";
        });
        ["laughing", "happy", "engaged", "bored", "confused"].forEach((label) => {
          document.getElementById(label).textContent = counts[label] || 0;
        });
        const audio = state.audio || {};
        const level = Math.max(0, Math.min(100, Math.round(audio.level || 0)));
        const reaction = Math.max(0, Math.min(100, Math.round(audio.reaction || 0)));
        const laugh = Math.max(0, Math.min(100, Math.round(audio.laugh || 0)));
        document.getElementById("audio-level").textContent = level + "%";
        document.getElementById("audio-reaction").textContent = reaction + "%";
        document.getElementById("audio-laugh").textContent = laugh + "%";
        document.getElementById("audio-level-fill").style.width = level + "%";
        document.getElementById("audio-reaction-fill").style.width = reaction + "%";
        document.getElementById("audio-laugh-fill").style.width = laugh + "%";
        document.getElementById("audio-status").textContent = audio.opened ? "connected" : (active ? "waiting" : "idle");
        document.getElementById("audio-dbfs").textContent = (audio.dbfs ?? -90).toFixed(1);
        document.getElementById("audio-floor").textContent = (audio.noise_floor_dbfs ?? -90).toFixed(1);
        document.getElementById("audio-centroid").textContent = Math.round(audio.centroid || 0) + " Hz";
      } catch (err) {
        document.getElementById("dot").className = "dot";
        document.getElementById("status").textContent = "offline";
      }
    }
    setInterval(tick, 500);
    loadConfig().catch(console.error);
    tick();
  </script>
</body>
</html>
"""


@dataclass
class Track:
    center: tuple[float, float]
    last_seen: float
    motion: float = 0.0
    low_signal_since: float = 0.0
    label: str = "neutral"


@dataclass
class RuntimeConfig:
    face_score: float = 0.55
    smile_scale: float = 1.3
    smile_neighbors: int = 12
    happy_strength: float = 0.008
    laughing_strength: float = 0.03
    laughing_smiles: int = 2
    confused_tilt: float = 7.0
    one_eye_confused_tilt: float = 5.0
    engaged_motion: float = 18.0
    bored_after_seconds: float = 6.0
    bored_motion: float = 3.0
    audio_reaction_threshold_db: float = 8.0
    audio_laugh_zcr: float = 0.06
    audio_laugh_centroid: float = 1800.0

    def as_dict(self) -> dict[str, float | int]:
        return {
            "face_score": self.face_score,
            "smile_scale": self.smile_scale,
            "smile_neighbors": self.smile_neighbors,
            "happy_strength": self.happy_strength,
            "laughing_strength": self.laughing_strength,
            "laughing_smiles": self.laughing_smiles,
            "confused_tilt": self.confused_tilt,
            "one_eye_confused_tilt": self.one_eye_confused_tilt,
            "engaged_motion": self.engaged_motion,
            "bored_after_seconds": self.bored_after_seconds,
            "bored_motion": self.bored_motion,
            "audio_reaction_threshold_db": self.audio_reaction_threshold_db,
            "audio_laugh_zcr": self.audio_laugh_zcr,
            "audio_laugh_centroid": self.audio_laugh_centroid,
        }

    def update(self, values: dict[str, Any]) -> None:
        if "face_score" in values:
            self.face_score = clamp_float(values["face_score"], 0.2, 0.95, self.face_score)
        if "smile_scale" in values:
            self.smile_scale = clamp_float(values["smile_scale"], 1.05, 1.8, self.smile_scale)
        if "smile_neighbors" in values:
            self.smile_neighbors = clamp_int(values["smile_neighbors"], 3, 30, self.smile_neighbors)
        if "happy_strength" in values:
            self.happy_strength = clamp_float(values["happy_strength"], 0.0, 0.08, self.happy_strength)
        if "laughing_strength" in values:
            self.laughing_strength = clamp_float(values["laughing_strength"], 0.0, 0.1, self.laughing_strength)
        if "laughing_smiles" in values:
            self.laughing_smiles = clamp_int(values["laughing_smiles"], 1, 5, self.laughing_smiles)
        if "confused_tilt" in values:
            self.confused_tilt = clamp_float(values["confused_tilt"], 0.0, 35.0, self.confused_tilt)
        if "one_eye_confused_tilt" in values:
            self.one_eye_confused_tilt = clamp_float(values["one_eye_confused_tilt"], 0.0, 35.0, self.one_eye_confused_tilt)
        if "engaged_motion" in values:
            self.engaged_motion = clamp_float(values["engaged_motion"], 0.0, 80.0, self.engaged_motion)
        if "bored_after_seconds" in values:
            self.bored_after_seconds = clamp_float(values["bored_after_seconds"], 0.0, 12.0, self.bored_after_seconds)
        if "bored_motion" in values:
            self.bored_motion = clamp_float(values["bored_motion"], 0.0, 30.0, self.bored_motion)
        if "audio_reaction_threshold_db" in values:
            self.audio_reaction_threshold_db = clamp_float(
                values["audio_reaction_threshold_db"],
                0.0,
                30.0,
                self.audio_reaction_threshold_db,
            )
        if "audio_laugh_zcr" in values:
            self.audio_laugh_zcr = clamp_float(values["audio_laugh_zcr"], 0.0, 0.3, self.audio_laugh_zcr)
        if "audio_laugh_centroid" in values:
            self.audio_laugh_centroid = clamp_float(
                values["audio_laugh_centroid"],
                200.0,
                6000.0,
                self.audio_laugh_centroid,
            )


@dataclass
class SharedState:
    lock: threading.Lock = field(default_factory=threading.Lock)
    jpeg: bytes = b""
    frames: int = 0
    fps: float = 0.0
    faces: int = 0
    active: bool = False
    opened: bool = False
    message: str = "idle"
    error: str = ""
    updated_at: float = field(default_factory=time.monotonic)
    reaction_counts: dict[str, int] = field(default_factory=dict)
    face_details: list[dict[str, Any]] = field(default_factory=list)
    config: RuntimeConfig = field(default_factory=RuntimeConfig)
    audio_opened: bool = False
    audio_dbfs: float = -90.0
    audio_peak_dbfs: float = -90.0
    audio_noise_floor_dbfs: float = -60.0
    audio_level: float = 0.0
    audio_reaction: float = 0.0
    audio_laugh: float = 0.0
    audio_zcr: float = 0.0
    audio_centroid: float = 0.0
    audio_updated_at: float = field(default_factory=time.monotonic)


def reset_stream_state(state: SharedState, *, active: bool, message: str, error: str = "") -> None:
    now = time.monotonic()
    with state.lock:
        state.jpeg = b""
        state.frames = 0
        state.fps = 0.0
        state.faces = 0
        state.active = active
        state.opened = False
        state.message = message
        state.error = error
        state.updated_at = now
        state.reaction_counts = {label: 0 for label in PALETTE}
        state.face_details = []
        state.audio_opened = False
        state.audio_dbfs = -90.0
        state.audio_peak_dbfs = -90.0
        state.audio_noise_floor_dbfs = -60.0
        state.audio_level = 0.0
        state.audio_reaction = 0.0
        state.audio_laugh = 0.0
        state.audio_zcr = 0.0
        state.audio_centroid = 0.0
        state.audio_updated_at = now


class ReactionEngine:
    def __init__(
        self,
        detect_scale: float,
        face_backend: str,
        face_model: str,
    ) -> None:
        self.detect_scale = max(0.2, min(1.0, detect_scale))
        self.face_backend = face_backend
        self.face_model = Path(face_model) if face_model else Path("/tmp/face_detection_yunet_2023mar.onnx")
        self.yunet = None
        self.yunet_size: tuple[int, int] | None = None
        self.face = cv2.CascadeClassifier(str(cascade_path("haarcascade_frontalface_alt2.xml")))
        self.eye = cv2.CascadeClassifier(str(cascade_path("haarcascade_eye_tree_eyeglasses.xml")))
        self.smile = cv2.CascadeClassifier(str(cascade_path("haarcascade_smile.xml")))
        if self.face_backend in {"auto", "yunet"} and self.face_model.exists() and hasattr(cv2, "FaceDetectorYN_create"):
            self.yunet = cv2.FaceDetectorYN_create(str(self.face_model), "", (320, 320), 0.55, 0.3, 5000)
        elif self.face_backend == "yunet":
            raise RuntimeError(f"YuNet requested, but model is missing: {self.face_model}")
        self.tracks: list[Track] = []
        if self.face.empty() or self.eye.empty() or self.smile.empty():
            raise RuntimeError("OpenCV cascade models could not be loaded.")

    def analyze(self, frame: np.ndarray, config: dict[str, float | int]) -> tuple[list[dict[str, Any]], dict[str, int]]:
        gray_full = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
        gray_full = cv2.equalizeHist(gray_full)
        faces = self.detect_faces(frame, gray_full, config)

        now = time.monotonic()
        details: list[dict[str, Any]] = []
        counts = {label: 0 for label in PALETTE}

        for x, y, w, h in faces:
            x = max(0, int(x))
            y = max(0, int(y))
            w = min(int(w), frame.shape[1] - x)
            h = min(int(h), frame.shape[0] - y)
            if w <= 20 or h <= 20:
                continue
            roi = gray_full[y : y + h, x : x + w]
            upper = roi[: int(h * 0.62), :]
            lower = roi[int(h * 0.36) :, :]
            eyes = self.eye.detectMultiScale(upper, scaleFactor=1.08, minNeighbors=4, minSize=(12, 12))
            smiles = self.smile.detectMultiScale(
                lower,
                scaleFactor=float(config["smile_scale"]),
                minNeighbors=int(config["smile_neighbors"]),
                minSize=(16, 8),
            )

            center = (float(x + w * 0.5), float(y + h * 0.5))
            track = self.update_track(center, now)
            motion = track.motion
            tilt = estimate_eye_tilt(eyes)
            smile_strength = max((sw * sh) / max(1, w * h) for _, _, sw, sh in smiles) if len(smiles) else 0.0
            low_signal = len(eyes) == 0 and motion <= float(config["bored_motion"])
            if low_signal:
                if track.low_signal_since <= 0:
                    track.low_signal_since = now
                low_signal_seconds = now - track.low_signal_since
            else:
                track.low_signal_since = 0.0
                low_signal_seconds = 0.0
            label, confidence = classify_reaction(
                eye_count=len(eyes),
                smile_count=len(smiles),
                smile_strength=smile_strength,
                tilt=tilt,
                motion=motion,
                low_signal_seconds=low_signal_seconds,
                config=config,
            )
            counts[label] = counts.get(label, 0) + 1
            details.append(
                {
                    "box": [
                        x,
                        y,
                        w,
                        h,
                    ],
                    "label": label,
                    "confidence": confidence,
                    "eyes": int(len(eyes)),
                    "smiles": int(len(smiles)),
                    "tilt": round(float(tilt), 1),
                    "motion": round(float(motion), 2),
                    "low_signal_seconds": round(float(low_signal_seconds), 1),
                }
            )

        self.tracks = [track for track in self.tracks if now - track.last_seen < 2.0]
        return details, counts

    def detect_faces(
        self,
        frame: np.ndarray,
        gray_full: np.ndarray,
        config: dict[str, float | int],
    ) -> list[tuple[int, int, int, int]]:
        if self.yunet is not None:
            height, width = frame.shape[:2]
            size = (width, height)
            if self.yunet_size != size:
                self.yunet.setInputSize(size)
                self.yunet_size = size
            if hasattr(self.yunet, "setScoreThreshold"):
                self.yunet.setScoreThreshold(float(config["face_score"]))
            _ok, faces = self.yunet.detect(frame)
            if faces is not None and len(faces):
                boxes = []
                for item in faces:
                    x, y, w, h = item[:4]
                    boxes.append((int(x), int(y), int(w), int(h)))
                return boxes

        scale = self.detect_scale
        small = cv2.resize(gray_full, (0, 0), fx=scale, fy=scale)
        faces = self.face.detectMultiScale(
            small,
            scaleFactor=1.08,
            minNeighbors=5,
            minSize=(42, 42),
        )
        return [
            (int(x / scale), int(y / scale), int(w / scale), int(h / scale))
            for x, y, w, h in faces
        ]

    def update_track(self, center: tuple[float, float], now: float) -> Track:
        if not self.tracks:
            track = Track(center=center, last_seen=now)
            self.tracks.append(track)
            return track

        distances = [distance(center, track.center) for track in self.tracks]
        index = int(np.argmin(distances))
        if distances[index] > 180:
            track = Track(center=center, last_seen=now)
            self.tracks.append(track)
            return track

        track = self.tracks[index]
        instant = distances[index]
        track.motion = track.motion * 0.75 + instant * 0.25
        track.center = center
        track.last_seen = now
        return track


def cascade_path(name: str) -> Path:
    cv2_data = getattr(cv2, "data", None)
    if cv2_data and getattr(cv2_data, "haarcascades", ""):
        candidate = Path(cv2_data.haarcascades) / name
        if candidate.exists():
            return candidate
    for directory in CASCADE_DIRS:
        candidate = directory / name
        if candidate.exists():
            return candidate
    raise FileNotFoundError(f"Missing OpenCV cascade: {name}")


def distance(a: tuple[float, float], b: tuple[float, float]) -> float:
    return math.hypot(a[0] - b[0], a[1] - b[1])


def clamp_float(input_value: Any, min_value: float, max_value: float, fallback: float) -> float:
    try:
        value = float(input_value)
    except (TypeError, ValueError):
        return fallback
    if not math.isfinite(value):
        return fallback
    return max(min_value, min(max_value, value))


def clamp_int(input_value: Any, min_value: int, max_value: int, fallback: int) -> int:
    try:
        value = int(round(float(input_value)))
    except (TypeError, ValueError):
        return fallback
    return max(min_value, min(max_value, value))


def estimate_eye_tilt(eyes: Any) -> float:
    if len(eyes) < 2:
        return 0.0
    centers = sorted(((x + w * 0.5, y + h * 0.5) for x, y, w, h in eyes), key=lambda p: p[0])
    left = centers[0]
    right = centers[-1]
    dx = max(1.0, right[0] - left[0])
    return math.degrees(math.atan2(right[1] - left[1], dx))


def classify_reaction(
    *,
    eye_count: int,
    smile_count: int,
    smile_strength: float,
    tilt: float,
    motion: float,
    low_signal_seconds: float,
    config: dict[str, float | int],
) -> tuple[str, float]:
    if smile_count >= int(config["laughing_smiles"]) or smile_strength >= float(config["laughing_strength"]):
        return "laughing", min(0.96, 0.68 + smile_strength * 9)
    if smile_count > 0 or smile_strength >= float(config["happy_strength"]):
        return "happy", min(0.92, 0.55 + smile_strength * 10)
    if eye_count >= 2 and abs(tilt) >= float(config["confused_tilt"]):
        return "confused", min(0.82, 0.42 + abs(tilt) / 45)
    if eye_count >= 2 and motion >= float(config["engaged_motion"]):
        return "engaged", min(0.86, 0.48 + motion / 90)
    if eye_count >= 2:
        return "focused", 0.64
    if eye_count == 0 and low_signal_seconds >= float(config["bored_after_seconds"]):
        return "bored", min(0.86, 0.52 + low_signal_seconds / 18)
    if eye_count == 1 and abs(tilt) >= float(config["one_eye_confused_tilt"]):
        return "confused", 0.52
    return "neutral", 0.46


def draw_overlay(frame: np.ndarray, faces: list[dict[str, Any]], counts: dict[str, int], fps: float) -> np.ndarray:
    output = frame.copy()
    for index, face in enumerate(faces):
        x, y, w, h = face["box"]
        label = str(face["label"])
        confidence = float(face["confidence"])
        color = PALETTE.get(label, PALETTE["uncertain"])
        cv2.rectangle(output, (x, y), (x + w, y + h), color, 3)
        text = f"{label} {confidence:.2f}"
        text_size, _ = cv2.getTextSize(text, cv2.FONT_HERSHEY_SIMPLEX, 0.75, 2)
        cv2.rectangle(output, (x, max(0, y - 32)), (x + text_size[0] + 12, y), color, -1)
        cv2.putText(output, text, (x + 6, max(22, y - 9)), cv2.FONT_HERSHEY_SIMPLEX, 0.75, (5, 7, 9), 2, cv2.LINE_AA)

        metric = f"eyes {face['eyes']} smile {face['smiles']} tilt {face['tilt']} motion {face['motion']} low {face['low_signal_seconds']}s"
        cv2.putText(output, metric, (x, y + h + 24), cv2.FONT_HERSHEY_SIMPLEX, 0.58, color, 2, cv2.LINE_AA)

    panel = f"faces {len(faces)}  fps {fps:.1f}"
    if counts:
        top = sorted(((count, label) for label, count in counts.items() if count), reverse=True)[:4]
        if top:
            panel += "  " + "  ".join(f"{label}:{count}" for count, label in top)
    cv2.rectangle(output, (0, 0), (min(output.shape[1], 760), 40), (10, 12, 14), -1)
    cv2.putText(output, panel, (14, 27), cv2.FONT_HERSHEY_SIMPLEX, 0.75, (235, 242, 245), 2, cv2.LINE_AA)
    return output


class CameraWorker(threading.Thread):
    def __init__(self, state: SharedState, url: str, args: argparse.Namespace) -> None:
        super().__init__(daemon=True)
        self.state = state
        self.url = url
        self.args = args
        self.stop_event = threading.Event()
        self.cap = None
        self.engine = ReactionEngine(
            args.detect_scale,
            args.face_backend,
            args.face_model,
        )

    def stop(self) -> None:
        self.stop_event.set()
        cap = self.cap
        if cap is not None:
            try:
                cap.release()
            except Exception:
                pass
        self.url = ""

    def run(self) -> None:
        os.environ.setdefault("OPENCV_FFMPEG_CAPTURE_OPTIONS", "rtsp_transport;tcp|stimeout;5000000")
        frame_times: list[float] = []
        last_analysis = 0.0
        details: list[dict[str, Any]] = []
        counts = {label: 0 for label in PALETTE}

        while not self.stop_event.is_set():
            cap = cv2.VideoCapture(self.url, cv2.CAP_FFMPEG)
            self.cap = cap
            cap.set(cv2.CAP_PROP_OPEN_TIMEOUT_MSEC, 5000)
            cap.set(cv2.CAP_PROP_READ_TIMEOUT_MSEC, 5000)

            with self.state.lock:
                self.state.opened = bool(cap.isOpened())
                self.state.active = True
                self.state.message = "live" if cap.isOpened() else "waiting for stream"
                self.state.error = ""

            if not cap.isOpened():
                time.sleep(1.5)
                continue

            while not self.stop_event.is_set():
                ok, frame = cap.read()
                if not ok:
                    with self.state.lock:
                        self.state.opened = False
                        self.state.active = True
                        self.state.message = "stream read failed; reconnecting"
                        self.state.error = "stream read failed"
                    break

                now = time.monotonic()
                frame_times.append(now)
                frame_times = [item for item in frame_times if now - item <= 2.0]
                fps = len(frame_times) / max(0.001, frame_times[-1] - frame_times[0]) if len(frame_times) > 1 else 0.0

                if now - last_analysis >= 1.0 / max(1.0, self.args.analysis_fps):
                    with self.state.lock:
                        config = self.state.config.as_dict()
                    details, counts = self.engine.analyze(frame, config)
                    last_analysis = now

                annotated = draw_overlay(frame, details, counts, fps)
                if self.args.width > 0 and annotated.shape[1] > self.args.width:
                    ratio = self.args.width / annotated.shape[1]
                    annotated = cv2.resize(annotated, (self.args.width, int(annotated.shape[0] * ratio)))

                ok_jpeg, encoded = cv2.imencode(".jpg", annotated, [int(cv2.IMWRITE_JPEG_QUALITY), self.args.jpeg_quality])
                if not ok_jpeg:
                    continue

                with self.state.lock:
                    self.state.jpeg = encoded.tobytes()
                    self.state.frames += 1
                    self.state.fps = fps
                    self.state.faces = len(details)
                    self.state.reaction_counts = dict(counts)
                    self.state.face_details = list(details)
                    self.state.opened = True
                    self.state.active = True
                    self.state.message = "live"
                    self.state.error = ""
                    self.state.updated_at = time.monotonic()

            cap.release()
            self.cap = None
            time.sleep(0.8)


class AudioWorker(threading.Thread):
    def __init__(self, state: SharedState, url: str) -> None:
        super().__init__(daemon=True)
        self.state = state
        self.url = url
        self.stop_event = threading.Event()
        self.sample_rate = 16000
        self.chunk_samples = 1600
        self.noise_floor_dbfs = -60.0
        self.proc = None

    def stop(self) -> None:
        self.stop_event.set()
        proc = self.proc
        if proc is not None and proc.poll() is None:
            proc.terminate()
            try:
                proc.wait(timeout=1)
            except subprocess.TimeoutExpired:
                proc.kill()
        self.url = ""

    def run(self) -> None:
        while not self.stop_event.is_set():
            cmd = [
                "ffmpeg",
                "-hide_banner",
                "-loglevel",
                "error",
                "-f",
                "concat",
                "-safe",
                "0",
                "-protocol_whitelist",
                "file,pipe,rtsp,rtsps,tcp,tls,crypto,udp,rtp,http,https",
                "-i",
                "pipe:0",
                "-map",
                "0:a:0",
                "-vn",
                "-ac",
                "1",
                "-ar",
                str(self.sample_rate),
                "-f",
                "s16le",
                "-",
            ]
            proc = subprocess.Popen(cmd, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL)
            self.proc = proc
            if proc.stdin is not None:
                try:
                    proc.stdin.write(make_ffconcat_input(self.url))
                    proc.stdin.close()
                except OSError:
                    pass
            with self.state.lock:
                self.state.audio_opened = True
            try:
                self.read_audio(proc)
            finally:
                self.proc = None
                with self.state.lock:
                    self.state.audio_opened = False
                if proc.poll() is None:
                    proc.terminate()
                    try:
                        proc.wait(timeout=2)
                    except subprocess.TimeoutExpired:
                        proc.kill()
                time.sleep(1.0)

    def read_audio(self, proc: subprocess.Popen[bytes]) -> None:
        assert proc.stdout is not None
        chunk_bytes = self.chunk_samples * 2
        buffer = b""
        while not self.stop_event.is_set():
            data = proc.stdout.read(chunk_bytes - len(buffer))
            if not data:
                break
            buffer += data
            if len(buffer) < chunk_bytes:
                continue
            chunk = buffer[:chunk_bytes]
            buffer = buffer[chunk_bytes:]
            samples = np.frombuffer(chunk, dtype=np.int16).astype(np.float32) / 32768.0
            metrics = audio_metrics(samples, self.sample_rate)
            dbfs = float(metrics["dbfs"])
            if dbfs < self.noise_floor_dbfs + 8:
                self.noise_floor_dbfs = self.noise_floor_dbfs * 0.98 + dbfs * 0.02
            else:
                self.noise_floor_dbfs = self.noise_floor_dbfs * 0.998 + dbfs * 0.002

            with self.state.lock:
                config = self.state.config.as_dict()
                above_floor = dbfs - self.noise_floor_dbfs
                reaction = normalize_percent(
                    above_floor - float(config["audio_reaction_threshold_db"]),
                    0.0,
                    20.0,
                )
                zcr_score = normalize_percent(
                    float(metrics["zcr"]) - float(config["audio_laugh_zcr"]),
                    0.0,
                    0.12,
                )
                centroid_score = normalize_percent(
                    float(metrics["centroid"]) - float(config["audio_laugh_centroid"]),
                    0.0,
                    3200.0,
                )
                laugh = reaction * (0.45 + 0.35 * zcr_score / 100.0 + 0.20 * centroid_score / 100.0)

                self.state.audio_dbfs = dbfs
                self.state.audio_peak_dbfs = float(metrics["peak_dbfs"])
                self.state.audio_noise_floor_dbfs = self.noise_floor_dbfs
                self.state.audio_level = normalize_percent(dbfs, -60.0, -8.0)
                self.state.audio_reaction = reaction
                self.state.audio_laugh = max(0.0, min(100.0, laugh))
                self.state.audio_zcr = float(metrics["zcr"])
                self.state.audio_centroid = float(metrics["centroid"])
                self.state.audio_updated_at = time.monotonic()


def make_ffconcat_input(url: str) -> bytes:
    escaped = str(url).replace("'", "'\\''")
    return f"ffconcat version 1.0\nfile '{escaped}'\n".encode("utf-8")


def audio_metrics(samples: np.ndarray, sample_rate: int) -> dict[str, float]:
    if samples.size == 0:
        return {
            "dbfs": -90.0,
            "peak_dbfs": -90.0,
            "zcr": 0.0,
            "centroid": 0.0,
        }
    rms = float(np.sqrt(np.mean(np.square(samples))) + 1e-12)
    peak = float(np.max(np.abs(samples)) + 1e-12)
    dbfs = 20.0 * math.log10(max(rms, 1e-9))
    peak_dbfs = 20.0 * math.log10(max(peak, 1e-9))
    signs = np.signbit(samples)
    zcr = float(np.mean(signs[1:] != signs[:-1])) if samples.size > 1 else 0.0
    windowed = samples * np.hanning(samples.size)
    spectrum = np.abs(np.fft.rfft(windowed))
    freqs = np.fft.rfftfreq(samples.size, d=1.0 / sample_rate)
    total = float(np.sum(spectrum))
    centroid = float(np.sum(freqs * spectrum) / total) if total > 1e-9 else 0.0
    return {
        "dbfs": dbfs,
        "peak_dbfs": peak_dbfs,
        "zcr": zcr,
        "centroid": centroid,
    }


def normalize_percent(value: float, min_value: float, max_value: float) -> float:
    if max_value <= min_value:
        return 0.0
    return max(0.0, min(100.0, ((value - min_value) / (max_value - min_value)) * 100.0))


def sanitize_stream_url(value: Any) -> str:
    url = str(value or "").strip()
    if not url:
        raise ValueError("stream URL is required")
    parsed = urlparse(url)
    if parsed.scheme not in {"rtsp", "rtsps"}:
        raise ValueError("stream URL must start with rtsp:// or rtsps://")
    if not parsed.netloc:
        raise ValueError("stream URL must include a host")
    return url


def is_loopback_host(host: str) -> bool:
    normalized = str(host or "").strip().lower()
    return normalized in {"127.0.0.1", "localhost", "::1", "[::1]"}


def is_remote_bind_host(host: str) -> bool:
    return not is_loopback_host(host)


def request_access_token(handler: BaseHTTPRequestHandler) -> str:
    header_token = str(handler.headers.get("x-camera-lab-token", "")).strip()
    if header_token:
        return header_token
    auth = str(handler.headers.get("authorization", "")).strip()
    if auth.lower().startswith("bearer "):
        return auth[7:].strip()
    parsed = urlparse(handler.path)
    query = parse_qs(parsed.query, keep_blank_values=True)
    for key in ("token", "access_token"):
        values = query.get(key) or []
        if values:
            return str(values[0] or "").strip()
    return ""


class StreamController:
    def __init__(self, state: SharedState, args: argparse.Namespace) -> None:
        self.state = state
        self.args = args
        self.lock = threading.Lock()
        self.camera_worker: CameraWorker | None = None
        self.audio_worker: AudioWorker | None = None

    def start(self, raw_url: Any) -> dict[str, Any]:
        url = sanitize_stream_url(raw_url)
        with self.lock:
            self._stop_locked()
            reset_stream_state(self.state, active=True, message="starting stream")
            self.camera_worker = CameraWorker(self.state, url, self.args)
            self.audio_worker = AudioWorker(self.state, url)
            self.camera_worker.start()
            self.audio_worker.start()
        return {"ok": True, "active": True}

    def stop(self) -> dict[str, Any]:
        with self.lock:
            self._stop_locked()
            reset_stream_state(self.state, active=False, message="idle")
        return {"ok": True, "active": False}

    def shutdown(self) -> None:
        with self.lock:
            self._stop_locked()

    def _stop_locked(self) -> None:
        workers = [self.camera_worker, self.audio_worker]
        self.camera_worker = None
        self.audio_worker = None
        for worker in workers:
            if worker is not None:
                worker.stop()
        for worker in workers:
            if worker is not None:
                worker.join(timeout=3)


def make_handler(state: SharedState, controller: StreamController) -> type[BaseHTTPRequestHandler]:
    class Handler(BaseHTTPRequestHandler):
        server_version = "ForYouReactionHTTP/0.1"

        def authorized(self) -> bool:
            expected = str(getattr(controller.args, "access_token", "") or "").strip()
            if not expected:
                return True
            provided = request_access_token(self)
            return bool(provided) and secrets.compare_digest(provided, expected)

        def require_authorized(self) -> bool:
            if self.authorized():
                return True
            self.send_json({"ok": False, "error": "camera_lab_token_required"}, status=HTTPStatus.UNAUTHORIZED)
            return False

        def do_GET(self) -> None:
            if not self.require_authorized():
                return
            path = urlparse(self.path).path
            if path == "/":
                self.send_response(HTTPStatus.OK)
                self.send_header("Content-Type", "text/html; charset=utf-8")
                self.send_header("Cache-Control", "no-store")
                self.end_headers()
                self.wfile.write(HTML_PAGE.encode("utf-8"))
                return
            if path == "/state.json":
                self.send_json(self.current_state())
                return
            if path == "/config.json":
                self.send_json(self.current_config())
                return
            if path == "/snapshot.jpg":
                jpeg = self.current_jpeg()
                if not jpeg:
                    self.send_error(HTTPStatus.SERVICE_UNAVAILABLE, "No frame yet")
                    return
                self.send_response(HTTPStatus.OK)
                self.send_header("Content-Type", "image/jpeg")
                self.send_header("Cache-Control", "no-store")
                self.end_headers()
                self.wfile.write(jpeg)
                return
            if path == "/video.mjpg":
                self.stream_mjpeg()
                return
            self.send_error(HTTPStatus.NOT_FOUND)

        def do_POST(self) -> None:
            if not self.require_authorized():
                return
            path = urlparse(self.path).path
            if path == "/stream/stop":
                self.send_json(controller.stop())
                return
            length = int(self.headers.get("Content-Length", "0") or "0")
            if length < 0 or length > 8192:
                self.send_error(HTTPStatus.BAD_REQUEST)
                return
            try:
                text = self.rfile.read(length).decode("utf-8") if length else "{}"
                payload = json.loads(text)
            except json.JSONDecodeError:
                self.send_error(HTTPStatus.BAD_REQUEST)
                return
            if not isinstance(payload, dict):
                self.send_error(HTTPStatus.BAD_REQUEST)
                return
            if path == "/stream/start":
                try:
                    result = controller.start(payload.get("url"))
                except ValueError as err:
                    self.send_json({"ok": False, "error": str(err)}, status=HTTPStatus.BAD_REQUEST)
                    return
                self.send_json(result)
                return
            if path != "/config.json":
                self.send_error(HTTPStatus.NOT_FOUND)
                return
            with state.lock:
                state.config.update(payload)
                config = state.config.as_dict()
            self.send_json(config)

        def log_message(self, fmt: str, *args: Any) -> None:
            sys.stderr.write("%s - %s\n" % (self.address_string(), fmt % args))

        def send_json(self, payload: dict[str, Any], status: HTTPStatus = HTTPStatus.OK) -> None:
            body = json.dumps(payload).encode("utf-8")
            self.send_response(status)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            self.wfile.write(body)

        def current_jpeg(self) -> bytes:
            with state.lock:
                return state.jpeg

        def current_video(self) -> tuple[bytes, bool]:
            with state.lock:
                return state.jpeg, state.active

        def current_state(self) -> dict[str, Any]:
            now = time.monotonic()
            with state.lock:
                return {
                    "active": state.active,
                    "opened": state.opened,
                    "message": state.message,
                    "error": state.error,
                    "frames": state.frames,
                    "fps": round(float(state.fps), 2),
                    "faces": state.faces,
                    "reaction_counts": state.reaction_counts,
                    "face_details": state.face_details,
                    "age_ms": int((now - state.updated_at) * 1000),
                    "config": state.config.as_dict(),
                    "audio": {
                        "opened": state.audio_opened,
                        "dbfs": round(float(state.audio_dbfs), 2),
                        "peak_dbfs": round(float(state.audio_peak_dbfs), 2),
                        "noise_floor_dbfs": round(float(state.audio_noise_floor_dbfs), 2),
                        "level": round(float(state.audio_level), 1),
                        "reaction": round(float(state.audio_reaction), 1),
                        "laugh": round(float(state.audio_laugh), 1),
                        "zcr": round(float(state.audio_zcr), 4),
                        "centroid": round(float(state.audio_centroid), 1),
                        "age_ms": int((now - state.audio_updated_at) * 1000),
                    },
                }

        def current_config(self) -> dict[str, float | int]:
            with state.lock:
                return state.config.as_dict()

        def stream_mjpeg(self) -> None:
            self.send_response(HTTPStatus.OK)
            self.send_header("Age", "0")
            self.send_header("Cache-Control", "no-cache, private")
            self.send_header("Pragma", "no-cache")
            self.send_header("Content-Type", "multipart/x-mixed-replace; boundary=frame")
            self.end_headers()

            last = b""
            while True:
                jpeg, active = self.current_video()
                if not active and not jpeg:
                    break
                if not jpeg or jpeg == last:
                    time.sleep(0.04)
                    continue
                last = jpeg
                try:
                    self.wfile.write(b"--frame\r\n")
                    self.wfile.write(b"Content-Type: image/jpeg\r\n")
                    self.wfile.write(f"Content-Length: {len(jpeg)}\r\n\r\n".encode("ascii"))
                    self.wfile.write(jpeg)
                    self.wfile.write(b"\r\n")
                except (BrokenPipeError, ConnectionResetError):
                    break

    return Handler


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Serve live camera reactions in a browser.")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=3321)
    parser.add_argument("--access-token", default=os.environ.get("FORYOU_CAMERA_LAB_TOKEN", ""))
    parser.add_argument("--unsafe-allow-remote", action="store_true")
    parser.add_argument("--analysis-fps", type=float, default=5.0)
    parser.add_argument("--detect-scale", type=float, default=0.5)
    parser.add_argument("--face-backend", choices=["auto", "yunet", "haar"], default="auto")
    parser.add_argument("--model-path", "--face-model", dest="face_model", default="/tmp/face_detection_yunet_2023mar.onnx")
    parser.add_argument("--smile-scale", type=float, default=RuntimeConfig.smile_scale)
    parser.add_argument("--smile-neighbors", type=int, default=RuntimeConfig.smile_neighbors)
    parser.add_argument("--width", type=int, default=1280)
    parser.add_argument("--jpeg-quality", type=int, default=78)
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    args.access_token = str(args.access_token or "").strip()
    if is_remote_bind_host(args.host) and not args.access_token and not args.unsafe_allow_remote:
        print(
            "Refusing remote bind without --access-token or --unsafe-allow-remote.",
            file=sys.stderr,
        )
        return 64
    global cv2, np
    import cv2 as cv2_module
    import numpy as np_module
    cv2 = cv2_module
    np = np_module
    state = SharedState()
    state.config.update({
        "smile_scale": args.smile_scale,
        "smile_neighbors": args.smile_neighbors,
    })
    reset_stream_state(state, active=False, message="idle")
    controller = StreamController(state, args)

    httpd = ThreadingHTTPServer((args.host, args.port), make_handler(state, controller))
    httpd.daemon_threads = True

    def stop(_signum: int, _frame: Any) -> None:
        controller.shutdown()
        threading.Thread(target=httpd.shutdown, daemon=True).start()

    signal.signal(signal.SIGTERM, stop)
    signal.signal(signal.SIGINT, stop)
    token_hint = " with access token" if args.access_token else ""
    print(f"Serving camera reactions on http://{args.host}:{args.port}{token_hint}")
    httpd.serve_forever()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
