#!/opt/homebrew/bin/python3
"""Zuinige publiekssensor: FFmpeg (hardware, grijs) → publiek_vision (één proces, tegels) → getallen per seconde.

Geen beeld in Python, geen overlay, niets opgeslagen behalve getallen. Het streamadres gaat via stdin naar FFmpeg
(niet zichtbaar in `ps`). Uitvoer: één JSON-regel per seconde op stdout (en met --log ook in een bestand).

Per seconde (gemiddeld over de beelden in die seconde, behalve personen/handen/klappen = hoogste waarde):
  personen, gezichten, lachen, aandacht (kijkt naar voren), weg (kijkt opzij), omlaag (hoofd omlaag),
  ogen_dicht, saai (weg of omlaag of ogen dicht), zonder_gezicht (persoon zonder zichtbaar gezicht),
  handen (hand omhoog), klappen, beweging (% van het beeld).
Met --fase leest hij (alleen lezen) de fase en scènetitel uit de publieksdienst, zodat het rapport per scène kan.
Met --publiek stuurt hij tijdens een scène elke 2 s de tellingen van die scène naar de publieksdienst (voor de score
en het rapport op het zaalscherm), plus uitsneden van gezichten: wie lachte, en wie verveeld keek terwijl minstens de
helft van de zaal dat deed (één per persoon en soort, hoogstens 12 per soort per scène).
De uitsneden blijven alleen in het geheugen van de publieksdienst; hier wordt niets bewaard.
"""
from __future__ import annotations

import argparse
import json
import queue
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
    """Tellingen van één beeld (plus uitsneden van gezichten, als publiek_vision die meegaf)."""
    fs = [kijk(f, yaw_weg, pitch_omlaag) for f in r["faces"]]
    lachjes = [(plek(f["b"]), f["jpg"], "lach" if k["lachen"] else "saai")
               for f, k in zip(r["faces"], fs) if f.get("jpg") and (k["lachen"] or k["saai"])]
    cls = [classify(p) for p in r["poses"]]
    n_face, n_pers = len(r["faces"]), len(r["persons"])
    out = {"personen": max(n_face, n_pers), "gezichten": n_face,
           "zonder_gezicht": max(0, n_pers - n_face),
           "handen": sum(u for u, _ in cls), "klappen": sum(c for _, c in cls),
           "beweging": r["motion"], "ms": r["ms"], "lachjes": lachjes}
    for k in ("lachen", "aandacht", "weg", "omlaag", "ogen_dicht", "saai"):
        out[k] = sum(f[k] for f in fs)
    return out


def plek(b: list) -> tuple[float, float, float, float]:
    """Midden en maat van een gezicht (0..1 van het beeld)."""
    return b[0] + b[2] / 2, b[1] + b[3] / 2, b[2], b[3]


ZELFDE = 1.5  # binnen zoveel gezichtsbreedtes/-hoogtes van een eerder gezicht: dezelfde persoon


def zelfde_persoon(a: tuple, b: tuple) -> bool:
    w, h = max(a[2], b[2]), max(a[3], b[3])
    return abs(a[0] - b[0]) < ZELFDE * w and abs(a[1] - b[1]) < ZELFDE * h


GEMIDDELD = ("gezichten", "lachen", "aandacht", "weg", "omlaag", "ogen_dicht", "saai", "zonder_gezicht", "beweging")
HOOGSTE = ("personen", "handen", "klappen")


def seconde(bucket: list[dict]) -> dict:
    n = len(bucket)
    agg = {k: round(sum(b[k] for b in bucket) / n, 2) for k in GEMIDDELD}
    agg.update({k: max(b[k] for b in bucket) for k in HOOGSTE})
    agg["proc_ms"] = int(sum(b["ms"] for b in bucket) / n)
    agg["n"] = n
    return agg


LACHJES_PER_SCENE = 12   # per soort
SAAI_DEEL = 0.5          # verveelde gezichten alleen als minstens dit deel van de zaal verveeld kijkt


class Publiek:
    """Stuurt de tellingen van de lopende scène en uitsneden van gezichten naar de publieksdienst."""

    def __init__(self, url: str):
        self.url, self.scene, self.regels, self.plekken = url, None, [], {"lach": [], "saai": []}
        self.laatst = 0.0
        self.rij: "queue.Queue[dict]" = queue.Queue(maxsize=50)
        threading.Thread(target=self._stuur_loop, daemon=True).start()

    def _stuur_loop(self):
        while True:
            body = self.rij.get()
            try:
                req = urllib.request.Request(self.url, data=json.dumps(body).encode(), method="POST",
                                             headers={"Content-Type": "application/json"})
                urllib.request.urlopen(req, timeout=5).read()
            except Exception:
                pass

    def _stuur(self, body: dict):
        try:
            self.rij.put_nowait(body)
        except queue.Full:
            pass

    def seconde(self, agg: dict, lachjes: list):
        run = agg.get("situationRunId") if agg.get("fase") == "scene" else None
        if run != self.scene:
            if self.scene and self.regels:
                self._stuur({"situationRunId": self.scene, "stats": stats(self.regels)})
            self.scene, self.regels, self.plekken = run, [], {"lach": [], "saai": []}
        if not run:
            return
        self.regels.append(agg)
        zaal_saai = agg["gezichten"] >= 1 and agg["saai"] / agg["gezichten"] >= SAAI_DEEL
        for p, jpg, soort in lachjes:
            gehad = self.plekken[soort]
            if soort == "saai" and not zaal_saai:
                continue
            if len(gehad) >= LACHJES_PER_SCENE or any(zelfde_persoon(p, q) for q in gehad):
                continue
            gehad.append(p)
            self._stuur({"situationRunId": run, "headshot": jpg, "soort": soort})
        if time.time() - self.laatst >= 2:
            self.laatst = time.time()
            self._stuur({"situationRunId": run, "stats": stats(self.regels)})


def stats(regels: list) -> dict:
    """Samenvatting van één scène in de vorm die het algoritme verwacht."""
    from publiek_rapport import samenvatting
    s = samenvatting(regels)
    return {"seconds": s["seconden"], "peopleAverage": s["personen_gem"], "peopleMax": s["personen_max"],
            "laughPct": s["lachen_pct"] or 0, "attentionPct": s["aandacht_pct"] or 0, "boredPct": s["saai_pct"] or 0,
            "laughMoments": s["lachmomenten"], "boredMoments": s["saaie_momenten"],
            "clapMoments": s["klapmomenten"], "handMoments": s["handen_momenten"]}


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
    ap.add_argument("--publiek", nargs="?", const="http://127.0.0.1:3026/audience/camera",
                    help="stuur tellingen per scène en lachende gezichten naar de publieksdienst (standaard :3026)")
    a = ap.parse_args()
    if a.publiek and not a.fase:
        a.fase = "http://127.0.0.1:3026/audience/stage/stroom"

    url = (HERE / a.url_file).read_text().strip()
    W, H = probe_size(url)
    ff = subprocess.Popen(["ffmpeg", "-hide_banner", "-loglevel", "fatal", "-hwaccel", "videotoolbox",
                           "-fflags", "nobuffer", "-flags", "low_delay", "-threads", "1",
                           "-f", "concat", "-safe", "0", "-protocol_whitelist", WHITELIST, "-i", "pipe:0",
                           "-map", "0:v:0", "-an", "-vf", f"fps={a.fps}", "-filter_threads", "1",
                           "-pix_fmt", "gray", "-f", "rawvideo", "-"],
                          stdin=subprocess.PIPE, stdout=subprocess.PIPE)
    ff.stdin.write(ffconcat(url)); ff.stdin.close()
    vis = subprocess.Popen([str(HERE / "publiek_vision"), str(W), str(H), "--gray", "--tiles", str(a.tiles)]
                           + (["--uitsneden", "--yaw-weg", str(a.yaw_weg), "--pitch-omlaag", str(a.pitch_omlaag)]
                              if a.publiek else []),
                           stdin=ff.stdout, stdout=subprocess.PIPE)
    ff.stdout.close()
    fase = Fase(a.fase) if a.fase else None
    publiek = Publiek(a.publiek) if a.publiek else None
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
                if publiek:
                    publiek.seconde(agg, [l for b in bucket for l in b["lachjes"]])
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
