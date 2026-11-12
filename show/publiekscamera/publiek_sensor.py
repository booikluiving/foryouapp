#!/opt/homebrew/bin/python3
"""Zuinige publiekssensor: FFmpeg (hardware, grijs) → publiek_vision (één proces, tegels) → getallen per seconde.

Geen beeld in Python, geen overlay. Het streamadres gaat via stdin naar FFmpeg (niet zichtbaar in `ps`).
Uitvoer: één JSON-regel per seconde op stdout.
"""
from __future__ import annotations

import argparse
import json
import subprocess
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent
WHITELIST = "file,pipe,rtsp,rtsps,tcp,tls,crypto,udp,rtp"


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


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--url-file", default=".rtsp_hoog")
    ap.add_argument("--fps", type=float, default=5.0)
    ap.add_argument("--tiles", type=int, default=3)
    ap.add_argument("--seconds", type=float, default=0)
    a = ap.parse_args()

    url = (HERE / a.url_file).read_text().strip()
    W, H = probe_size(url)
    ff = subprocess.Popen(["ffmpeg", "-hide_banner", "-loglevel", "error", "-hwaccel", "videotoolbox",
                           "-fflags", "nobuffer", "-flags", "low_delay", "-threads", "1",
                           "-f", "concat", "-safe", "0", "-protocol_whitelist", WHITELIST, "-i", "pipe:0",
                           "-map", "0:v:0", "-an", "-vf", f"fps={a.fps}", "-filter_threads", "1",
                           "-pix_fmt", "gray", "-f", "rawvideo", "-"],
                          stdin=subprocess.PIPE, stdout=subprocess.PIPE)
    ff.stdin.write(ffconcat(url)); ff.stdin.close()
    vis = subprocess.Popen([str(HERE / "publiek_vision"), str(W), str(H), "--gray", "--tiles", str(a.tiles)],
                           stdin=ff.stdout, stdout=subprocess.PIPE)
    ff.stdout.close()

    t_end = time.time() + a.seconds if a.seconds else None
    bucket, t_sec = [], time.time()
    try:
        for line in vis.stdout:
            r = json.loads(line)
            cls = [classify(p) for p in r["poses"]]
            bucket.append({"faces": len(r["faces"]), "smiles": sum(f["smile"] for f in r["faces"]),
                           "persons": len(r["persons"]), "hands_up": sum(u for u, _ in cls),
                           "claps": sum(c for _, c in cls), "motion": r["motion"], "ms": r["ms"]})
            if time.time() - t_sec >= 1.0:
                agg = {"t": time.strftime("%H:%M:%S")}
                for k in ("faces", "smiles", "persons", "hands_up", "claps"):
                    agg[k] = max(b[k] for b in bucket)
                agg["motion"] = round(sum(b["motion"] for b in bucket) / len(bucket), 2)
                agg["proc_ms"] = int(sum(b["ms"] for b in bucket) / len(bucket))
                agg["n"] = len(bucket)
                print(json.dumps(agg), flush=True)
                bucket, t_sec = [], time.time()
            if t_end and time.time() > t_end:
                break
    finally:
        for p in (vis, ff):
            p.terminate()


if __name__ == "__main__":
    main()
