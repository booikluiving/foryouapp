#!/opt/homebrew/bin/python3
"""Zuinige publiekssensor: FFmpeg (hardware, grijs) → publiek_vision (één proces, tegels) → getallen per seconde.

Geen beeld in Python, geen overlay, niets opgeslagen behalve getallen. Het streamadres gaat via stdin naar FFmpeg
(niet zichtbaar in `ps`). Uitvoer: één JSON-regel per seconde op stdout (en met --log ook in een bestand).

Per seconde (gemiddeld over de beelden in die seconde, behalve personen/handen/klappen = hoogste waarde):
  personen, gezichten, lachen, aandacht (kijkt naar voren), weg (kijkt opzij), omlaag (hoofd omlaag),
  ogen_dicht, saai (weg of omlaag of ogen dicht), zonder_gezicht (persoon zonder zichtbaar gezicht),
  handen (hand omhoog), klappen, beweging (% van het beeld).
Met --fase leest hij (alleen lezen) de fase en scènetitel uit de publieksdienst, zodat het rapport per scène kan.
"""
from __future__ import annotations

import argparse
import json
import subprocess
import threading
import time
import urllib.request
from pathlib import Path

HERE = Path(__file__).resolve().parent
WHITELIST = "file,pipe,rtsp,rtsps,tcp,tls,crypto,udp,rtp"

# Drempels in graden (voorlopig, nog te ijken met mensen in de zaal)
YAW_WEG = 30.0       # |yaw| groter: kijkt opzij
PITCH_OMLAAG = 20.0  # pitch groter (hoofd voorover): kijkt omlaag (telefoon, schoot)


def ffconcat(url: str) -> bytes:
    esc = url.replace("'", "'\\''")
    return f"ffconcat version 1.0\nfile '{esc}'\noption rtsp_transport tcp\n".encode()


def probe_size(url: str) -> tuple[int, int]:
    out = subprocess.run(["ffprobe", "-v", "error", "-f", "concat", "-safe", "0", "-protocol_whitelist", WHITELIST,
                          "-select_streams", "v:0", "-show_entries", "stream=width,height", "-of", "csv=p=0",
                          "-i", "pipe:0"], input=ffconcat(url), capture_output=True).stdout.decode()
    w, h = out.strip().splitlines()[0].split(",")[:2]
    return int(w), int(h)


def classify(p: dict) -> tuple[bool, bool]:
    """(hand omhoog, klappen). y loopt omlaag."""
    sh = [p[k] for k in ("ls", "rs") if k in p]
    head = p.get("nose") or p.get("neck")
    refs = [s[1] for s in sh] + ([head[1]] if head else [])
    wrists = [p[k] for k in ("lw", "rw") if k in p]
    up = bool(refs) and any(w[1] < min(refs) - 0.01 for w in wrists)
    clap = False
    if "lw" in p and "rw" in p and len(sh) == 2:
        sw = abs(sh[0][0] - sh[1][0]) or 0.01
        lw, rw = p["lw"], p["rw"]
        d = ((lw[0] - rw[0]) ** 2 + (lw[1] - rw[1]) ** 2) ** 0.5
        hips = [p[k][1] for k in ("lh", "rh") if k in p]
        low = max(hips) if hips else sh[0][1] + 3 * sw
        mid = (lw[1] + rw[1]) / 2
        clap = d < 0.7 * sw and min(sh[0][1], sh[1][1]) - 0.5 * sw < mid < low and p.get("wm", [0])[0] > 0.15
    return up, clap


def kijk(f: dict, yaw_weg: float, pitch_omlaag: float) -> dict:
    """Toestand van één gezicht."""
    weg = abs(f.get("yaw", 0)) > yaw_weg
    omlaag = f.get("pitch", 0) > pitch_omlaag
    dicht = f.get("eyes") == "dicht"
    return {"lachen": bool(f.get("smile")), "weg": weg, "omlaag": omlaag, "ogen_dicht": dicht,
            "saai": weg or omlaag or dicht, "aandacht": not (weg or omlaag or dicht)}


def beeld(r: dict, yaw_weg: float, pitch_omlaag: float) -> dict:
    """Tellingen van één beeld."""
    fs = [kijk(f, yaw_weg, pitch_omlaag) for f in r["faces"]]
    cls = [classify(p) for p in r["poses"]]
    n_face, n_pers = len(r["faces"]), len(r["persons"])
    out = {"personen": max(n_face, n_pers), "gezichten": n_face,
           "zonder_gezicht": max(0, n_pers - n_face),
           "handen": sum(u for u, _ in cls), "klappen": sum(c for _, c in cls),
           "beweging": r["motion"], "ms": r["ms"]}
    for k in ("lachen", "aandacht", "weg", "omlaag", "ogen_dicht", "saai"):
        out[k] = sum(f[k] for f in fs)
    return out


GEMIDDELD = ("gezichten", "lachen", "aandacht", "weg", "omlaag", "ogen_dicht", "saai", "zonder_gezicht", "beweging")
HOOGSTE = ("personen", "handen", "klappen")


def seconde(bucket: list[dict]) -> dict:
    n = len(bucket)
    agg = {k: round(sum(b[k] for b in bucket) / n, 2) for k in GEMIDDELD}
    agg.update({k: max(b[k] for b in bucket) for k in HOOGSTE})
    agg["proc_ms"] = int(sum(b["ms"] for b in bucket) / n)
    agg["n"] = n
    return agg


class Fase:
    """Leest de fase (scène/tussen) en de titel uit de publieksdienst (Server-Sent Events, alleen lezen)."""

    def __init__(self, url: str):
        self.url, self.stand = url, {"fase": None, "titel": None, "situationRunId": None}
        threading.Thread(target=self._loop, daemon=True).start()

    def _zet(self, f: dict):
        self.stand = {"fase": f.get("fase"), "titel": f.get("titel"), "situationRunId": f.get("situationRunId")}

    def _loop(self):
        while True:
            try:
                with urllib.request.urlopen(self.url, timeout=60) as resp:
                    for raw in resp:
                        line = raw.decode("utf-8", "replace").strip()
                        if not line.startswith("data:"):
                            continue
                        msg = json.loads(line[5:])
                        if msg.get("type") == "begin" and isinstance(msg.get("fase"), dict):
                            self._zet(msg["fase"])
                        elif msg.get("type") == "fase":
                            self._zet(msg)
            except Exception:
                self.stand = {"fase": None, "titel": None, "situationRunId": None}
                time.sleep(3)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--url-file", default=".rtsp_hoog")
    ap.add_argument("--fps", type=float, default=5.0)
    ap.add_argument("--tiles", type=int, default=3)
    ap.add_argument("--seconds", type=float, default=0)
    ap.add_argument("--log", help="schrijf de secondes ook naar dit bestand (JSONL, alleen getallen)")
    ap.add_argument("--fase", nargs="?", const="http://127.0.0.1:3026/audience/stage/stroom",
                    help="volg fase en scènetitel van de publieksdienst (standaard :3026)")
    ap.add_argument("--yaw-weg", type=float, default=YAW_WEG)
    ap.add_argument("--pitch-omlaag", type=float, default=PITCH_OMLAAG)
    ap.add_argument("--rapport", action="store_true", help="druk aan het eind een rapport af")
    a = ap.parse_args()

    url = (HERE / a.url_file).read_text().strip()
    W, H = probe_size(url)
    ff = subprocess.Popen(["ffmpeg", "-hide_banner", "-loglevel", "fatal", "-hwaccel", "videotoolbox",
                           "-fflags", "nobuffer", "-flags", "low_delay", "-threads", "1",
                           "-f", "concat", "-safe", "0", "-protocol_whitelist", WHITELIST, "-i", "pipe:0",
                           "-map", "0:v:0", "-an", "-vf", f"fps={a.fps}", "-filter_threads", "1",
                           "-pix_fmt", "gray", "-f", "rawvideo", "-"],
                          stdin=subprocess.PIPE, stdout=subprocess.PIPE)
    ff.stdin.write(ffconcat(url)); ff.stdin.close()
    vis = subprocess.Popen([str(HERE / "publiek_vision"), str(W), str(H), "--gray", "--tiles", str(a.tiles)],
                           stdin=ff.stdout, stdout=subprocess.PIPE)
    ff.stdout.close()
    fase = Fase(a.fase) if a.fase else None
    log = open(a.log, "a") if a.log else None
    regels = []

    t_end = time.time() + a.seconds if a.seconds else None
    bucket, t_sec = [], time.time()
    try:
        for line in vis.stdout:
            bucket.append(beeld(json.loads(line), a.yaw_weg, a.pitch_omlaag))
            if time.time() - t_sec >= 1.0:
                agg = {"t": time.strftime("%H:%M:%S"), "ts": round(time.time(), 1), **seconde(bucket)}
                if fase:
                    agg.update(fase.stand)
                s = json.dumps(agg, ensure_ascii=False)
                print(s, flush=True)
                if log:
                    log.write(s + "\n"); log.flush()
                regels.append(agg)
                bucket, t_sec = [], time.time()
            if t_end and time.time() > t_end:
                break
    except KeyboardInterrupt:
        pass
    finally:
        for p in (ff, vis):
            p.terminate()
        if log:
            log.close()
        if a.rapport and regels:
            from publiek_rapport import rapport, tekst
            print(tekst(rapport(regels)))


if __name__ == "__main__":
    main()
