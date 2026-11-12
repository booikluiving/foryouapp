#!/opt/homebrew/bin/python3
"""Proef publieksreacties: RTSP(S) van Protect -> Apple Vision -> getallen per seconde + live overlay.

Stream-URL in een bestand (chmod 600) naast dit script, standaard .rtsp_hoog (kies met --url-file)
Live beeld met overlay: http://127.0.0.1:3322/  (alleen lokaal)
Er wordt niets opgenomen; alleen het laatste overlaybeeld staat in het geheugen.
"""
from __future__ import annotations

import argparse
import json
import os
import subprocess
import threading
import time
from collections import deque
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

import cv2
import numpy as np

HERE = Path(__file__).resolve().parent


class Grabber(threading.Thread):
    """Leest de stream zo snel mogelijk en houdt alleen het nieuwste frame vast."""

    def __init__(self, url: str):
        super().__init__(daemon=True)
        os.environ["OPENCV_FFMPEG_CAPTURE_OPTIONS"] = "rtsp_transport;tcp|fflags;nobuffer|flags;low_delay"
        self.cap = cv2.VideoCapture(url, cv2.CAP_FFMPEG)
        self.lock = threading.Lock()
        self.frame = None
        self.t = 0.0
        self.n = 0
        self.ok = self.cap.isOpened()

    def run(self):
        while True:
            ok, f = self.cap.read()
            if not ok:
                time.sleep(0.05)
                continue
            with self.lock:
                self.frame, self.t = f, time.time()
                self.n += 1

    def latest(self):
        with self.lock:
            return self.frame, self.t, self.n


class HwGrabber(Grabber):
    """FFmpeg met de hardware-decoder van de Mac (VideoToolbox); levert fps beelden per seconde.
    Het streamadres gaat via stdin (ffconcat), zodat het niet in `ps` staat."""

    def __init__(self, url: str, fps: float, size: tuple[int, int]):
        threading.Thread.__init__(self, daemon=True)
        self.lock = threading.Lock()
        self.frame, self.t, self.n = None, 0.0, 0
        self.w, self.h = size
        esc = url.replace("'", "'\\''")
        cmd = ["ffmpeg", "-hide_banner", "-loglevel", "error", "-hwaccel", "videotoolbox",
               "-fflags", "nobuffer", "-flags", "low_delay", "-threads", "1",
               "-f", "concat", "-safe", "0",
               "-protocol_whitelist", "file,pipe,rtsp,rtsps,tcp,tls,crypto,udp,rtp",
               "-i", "pipe:0", "-map", "0:v:0", "-an",
               "-vf", f"fps={fps}", "-filter_threads", "1", "-pix_fmt", "bgr24", "-f", "rawvideo", "-"]
        self.p = subprocess.Popen(cmd, stdin=subprocess.PIPE, stdout=subprocess.PIPE, bufsize=0)
        self.p.stdin.write(f"ffconcat version 1.0\nfile '{esc}'\noption rtsp_transport tcp\n".encode())
        self.p.stdin.close()
        self.ok = True

    def run(self):
        n = self.w * self.h * 3
        buf = bytearray(n)
        mv = memoryview(buf)
        while True:
            got = 0
            while got < n:
                k = self.p.stdout.readinto(mv[got:])
                if not k:
                    return
                got += k
            f = np.frombuffer(bytes(buf), np.uint8).reshape(self.h, self.w, 3)
            with self.lock:
                self.frame, self.t = f, time.time()
                self.n += 1


def probe_size(url: str) -> tuple[int, int]:
    esc = url.replace("'", "'\\''")
    out = subprocess.run(["ffprobe", "-v", "error", "-f", "concat", "-safe", "0",
                          "-protocol_whitelist", "file,pipe,rtsp,rtsps,tcp,tls,crypto,udp,rtp",
                          "-select_streams", "v:0", "-show_entries", "stream=width,height", "-of", "csv=p=0",
                          "-i", "pipe:0"],
                         input=f"ffconcat version 1.0\nfile '{esc}'\noption rtsp_transport tcp\n".encode(),
                         capture_output=True).stdout.decode().strip().splitlines()[0]
    w, h = out.split(",")[:2]
    return int(w), int(h)


class Vision:
    def __init__(self, w: int, h: int):
        self.w, self.h = w, h
        self.p = subprocess.Popen([str(HERE / "publiek_vision"), str(w), str(h)],
                                  stdin=subprocess.PIPE, stdout=subprocess.PIPE)

    def run(self, bgr: np.ndarray) -> dict:
        bgra = cv2.cvtColor(bgr, cv2.COLOR_BGR2BGRA)
        self.p.stdin.write(bgra.tobytes())
        self.p.stdin.flush()
        return json.loads(self.p.stdout.readline())


class TiledVision:
    """Volle resolutie in T verticale tegels met overlap; elke tegel een eigen Vision-proces (parallel)."""

    def __init__(self, W: int, H: int, tiles: int, overlap: int = 256, scale: float = 1.0):
        self.W, self.H, self.scale = W, H, scale
        tw = -(-(W + (tiles - 1) * overlap) // tiles)
        tw += tw % 2
        self.x0s = [min(i * (tw - overlap), W - tw) for i in range(tiles)]
        self.tw = tw
        self.sw, self.sh = int(tw * scale) // 2 * 2, int(H * scale) // 2 * 2
        self.procs = [Vision(self.sw, self.sh) for _ in range(tiles)]

    def run(self, frame: np.ndarray) -> dict:
        crops = []
        for x0 in self.x0s:
            c = frame[:, x0:x0 + self.tw]
            if c.shape[1] != self.sw or c.shape[0] != self.sh:
                c = cv2.resize(c, (self.sw, self.sh), interpolation=cv2.INTER_AREA)
            crops.append(cv2.cvtColor(c, cv2.COLOR_BGR2BGRA))
        for p, c in zip(self.procs, crops):
            p.p.stdin.write(c.tobytes()); p.p.stdin.flush()
        outs = [json.loads(p.p.stdout.readline()) for p in self.procs]
        fx = lambda x0, x: (x0 + x * self.tw) / self.W
        fw = lambda w: w * self.tw / self.W
        merged = {"faces": [], "persons": [], "poses": [], "ms": max(o["ms"] for o in outs)}

        def dup(lst, b):
            cx, cy = b[0] + b[2] / 2, b[1] + b[3] / 2
            return any(o[0] <= cx <= o[0] + o[2] and o[1] <= cy <= o[1] + o[3] for o in lst)

        for x0, o in zip(self.x0s, outs):
            for f in o["faces"]:
                b = [fx(x0, f["b"][0]), f["b"][1], fw(f["b"][2]), f["b"][3]]
                if not dup([g["b"] for g in merged["faces"]], b):
                    merged["faces"].append({**f, "b": b})
            for pb in o["persons"]:
                b = [fx(x0, pb[0]), pb[1], fw(pb[2]), pb[3]]
                if not dup(merged["persons"], b):
                    merged["persons"].append(b)
            for p in o["poses"]:
                q = {k: [fx(x0, v[0]), v[1], v[2]] for k, v in p.items()}
                anchor = q.get("neck") or next(iter(q.values()))
                if not any(abs((m.get("neck") or next(iter(m.values())))[0] - anchor[0]) < 0.01 and
                           abs((m.get("neck") or next(iter(m.values())))[1] - anchor[1]) < 0.03 for m in merged["poses"]):
                    merged["poses"].append(q)
        return merged


def classify(pose: dict) -> tuple[bool, bool]:
    """(handen omhoog, klaphouding). Coördinaten 0..1, y omlaag."""
    def g(k):
        return pose.get(k)
    sh = [p for p in (g("ls"), g("rs")) if p]
    head = g("nose") or g("neck")
    ref_y = min([p[1] for p in sh] + ([head[1]] if head else [])) if (sh or head) else None
    wrists = [p for p in (g("lw"), g("rw")) if p]
    hands_up = bool(ref_y is not None and any(w[1] < ref_y - 0.01 for w in wrists))
    clap = False
    if g("lw") and g("rw") and len(sh) == 2:
        sw = abs(sh[0][0] - sh[1][0]) or 0.01
        d = ((g("lw")[0] - g("rw")[0]) ** 2 + (g("lw")[1] - g("rw")[1]) ** 2) ** 0.5
        hips = [p[1] for p in (g("lh"), g("rh")) if p]
        low = max(hips) if hips else sh[0][1] + 3 * sw
        clap = d < 0.7 * sw and min(sh[0][1], sh[1][1]) - 0.5 * sw < (g("lw")[1] + g("rw")[1]) / 2 < low
    return hands_up, clap


def draw(img, res, stats, motion_mask):
    h, w = img.shape[:2]
    if motion_mask is not None:
        m = cv2.resize(motion_mask, (w, h), interpolation=cv2.INTER_NEAREST)
        img[m > 0] = (img[m > 0] * 0.5 + np.array([0, 0, 255]) * 0.5).astype(np.uint8)
    for b in res["persons"]:
        x, y, bw, bh = int(b[0] * w), int(b[1] * h), int(b[2] * w), int(b[3] * h)
        cv2.rectangle(img, (x, y), (x + bw, y + bh), (255, 160, 0), 2)
    for f in res["faces"]:
        b = f["b"]
        x, y, bw, bh = int(b[0] * w), int(b[1] * h), int(b[2] * w), int(b[3] * h)
        col = (0, 220, 0) if f["smile"] else (255, 255, 255)
        cv2.rectangle(img, (x, y), (x + bw, y + bh), col, 2)
        if f["smile"]:
            cv2.putText(img, "lacht", (x, y - 6), cv2.FONT_HERSHEY_SIMPLEX, 0.6, col, 2)
    for p in res["poses"]:
        up, clap = classify(p)
        clap = p.get("_clap", False) if clap else False
        for k in ("lw", "rw"):
            if k in p:
                cv2.circle(img, (int(p[k][0] * w), int(p[k][1] * h)), 7,
                           (0, 255, 255) if up else ((255, 0, 255) if clap else (200, 200, 200)), -1)
        if "neck" in p and (up or clap):
            cv2.putText(img, "hand omhoog" if up else "klappen?", (int(p["neck"][0] * w), int(p["neck"][1] * h)),
                        cv2.FONT_HERSHEY_SIMPLEX, 0.7, (0, 255, 255) if up else (255, 0, 255), 2)
    lines = [
        time.strftime("%H:%M:%S") + f".{int(time.time() * 10) % 10}  (Mac-klok)",
        f"gezichten {stats['faces']}  lacht {stats['smiles']}  personen {stats['persons']}",
        f"handen omhoog {stats['hands_up']}  klappen {stats['claps']}  beweging {stats['motion']:.1f}%",
        f"analyse {stats['fps']:.1f}/s  verwerking {stats['proc_ms']} ms  frame-leeftijd {stats['age_ms']} ms",
    ]
    cv2.rectangle(img, (0, 0), (min(w, 760), 26 * len(lines) + 12), (0, 0, 0), -1)
    for i, t in enumerate(lines):
        cv2.putText(img, t, (10, 26 * (i + 1)), cv2.FONT_HERSHEY_SIMPLEX, 0.65, (255, 255, 255), 2)
    return img


LATEST = {"jpg": b"", "stats": {}}

PAGE = b"""<!doctype html><meta charset=utf-8><title>Publieksproef</title>
<body style="margin:0;background:#111;color:#eee;font:14px system-ui">
<img src="/mjpeg" style="width:100%;display:block">
<pre id=s style="padding:8px"></pre>
<script>setInterval(async()=>{document.getElementById('s').textContent=JSON.stringify(await (await fetch('/stats')).json(),null,1)},1000)</script>"""


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *a):
        pass

    def do_GET(self):
        if self.path == "/":
            self.send_response(200); self.send_header("Content-Type", "text/html"); self.end_headers()
            self.wfile.write(PAGE)
        elif self.path == "/stats":
            body = json.dumps(LATEST["stats"]).encode()
            self.send_response(200); self.send_header("Content-Type", "application/json"); self.end_headers()
            self.wfile.write(body)
        elif self.path == "/frame.jpg":
            self.send_response(200); self.send_header("Content-Type", "image/jpeg"); self.end_headers()
            self.wfile.write(LATEST["jpg"])
        elif self.path == "/mjpeg":
            self.send_response(200)
            self.send_header("Content-Type", "multipart/x-mixed-replace; boundary=f"); self.end_headers()
            try:
                last = None
                while True:
                    j = LATEST["jpg"]
                    if j and j is not last:
                        self.wfile.write(b"--f\r\nContent-Type: image/jpeg\r\n\r\n" + j + b"\r\n")
                        last = j
                    time.sleep(0.05)
            except (BrokenPipeError, ConnectionResetError):
                pass
        else:
            self.send_response(404); self.end_headers()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--fps", type=float, default=5.0)
    ap.add_argument("--width", type=int, default=1920, help="analysebreedte")
    ap.add_argument("--port", type=int, default=3322)
    ap.add_argument("--seconds", type=float, default=0, help="0 = blijven draaien")
    ap.add_argument("--log", default=str(HERE / "per_seconde.jsonl"))
    ap.add_argument("--url-file", default=".rtsp_hoog")
    ap.add_argument("--tiles", type=int, default=0, help="0 = hele beeld verkleind; 3 = volle resolutie in 3 tegels")
    ap.add_argument("--tile-scale", type=float, default=1.0)
    ap.add_argument("--hw", action="store_true", help="FFmpeg met hardware-decoder (VideoToolbox)")
    a = ap.parse_args()

    url = (HERE / a.url_file).read_text().strip()
    g = HwGrabber(url, a.fps, probe_size(url)) if a.hw else Grabber(url)
    if not g.ok:
        raise SystemExit("stream niet te openen")
    g.start()
    while g.latest()[0] is None:
        time.sleep(0.05)
    f0 = g.latest()[0]
    H0, W0 = f0.shape[:2]
    aw = min(a.width, W0)
    ah = int(round(H0 * aw / W0 / 2) * 2)
    if a.tiles:
        vis = TiledVision(W0, H0, a.tiles, scale=a.tile_scale)
        print(f"stream {W0}x{H0}, analyse in {a.tiles} tegels van {vis.sw}x{vis.sh}, overlay {aw}x{ah}", flush=True)
    else:
        vis = Vision(aw, ah)
        print(f"stream {W0}x{H0}, analyse op {aw}x{ah}", flush=True)

    srv = ThreadingHTTPServer(("127.0.0.1", a.port), Handler)
    threading.Thread(target=srv.serve_forever, daemon=True).start()

    prev_gray = None
    times = deque(maxlen=20)
    sec_bucket: list[dict] = []
    sec_start = time.time()
    t_end = time.time() + a.seconds if a.seconds else None
    logf = open(a.log, "a")
    n_last = 0
    while not t_end or time.time() < t_end:
        t_loop = time.time()
        frame, t_frame, n = g.latest()
        if n == n_last:
            time.sleep(0.005); continue
        n_last = n
        small = cv2.resize(frame, (aw, ah), interpolation=cv2.INTER_AREA)
        t0 = time.time()
        res = vis.run(frame if a.tiles else small)
        proc_ms = int((time.time() - t0) * 1000)

        gray = cv2.GaussianBlur(cv2.cvtColor(cv2.resize(small, (320, int(320 * ah / aw))), cv2.COLOR_BGR2GRAY), (5, 5), 0)
        mask = None
        motion = 0.0
        if prev_gray is not None:
            mask = (cv2.absdiff(gray, prev_gray) > 18).astype(np.uint8)
            motion = 100.0 * float(mask.mean())
        prev_gray = gray

        cls = [classify(p) for p in res["poses"]]
        # Klappen telt alleen met beweging rond de polsen (anders zijn het gevouwen handen).
        if mask is not None:
            mh, mw = mask.shape
            new = []
            for p, (up, clap) in zip(res["poses"], cls):
                if clap:
                    xs = [p[k][0] for k in ("lw", "rw")]; ys = [p[k][1] for k in ("lw", "rw")]
                    x0, x1 = int((min(xs) - 0.01) * mw), int((max(xs) + 0.01) * mw) + 1
                    y0, y1 = int((min(ys) - 0.03) * mh), int((max(ys) + 0.03) * mh) + 1
                    roi = mask[max(0, y0):y1, max(0, x0):x1]
                    clap = bool(roi.size > 0 and roi.mean() > 0.15)
                    p["_clap"] = clap
                new.append((up, clap))
            cls = new
        times.append(time.time())
        fps = (len(times) - 1) / (times[-1] - times[0]) if len(times) > 1 else 0.0
        stats = {
            "faces": len(res["faces"]), "smiles": sum(f["smile"] for f in res["faces"]),
            "persons": len(res["persons"]), "poses": len(res["poses"]),
            "hands_up": sum(u for u, _ in cls), "claps": sum(c for _, c in cls),
            "motion": round(motion, 2), "fps": round(fps, 1), "proc_ms": proc_ms,
            "age_ms": int((time.time() - t_frame) * 1000),
        }
        out = draw(small.copy(), res, stats, mask)
        LATEST["jpg"] = cv2.imencode(".jpg", out, [cv2.IMWRITE_JPEG_QUALITY, 75])[1].tobytes()
        LATEST["stats"] = stats
        sec_bucket.append(stats)

        if time.time() - sec_start >= 1.0:
            agg = {"t": time.strftime("%H:%M:%S")}
            for k in ("faces", "smiles", "persons", "hands_up", "claps"):
                agg[k] = max(s[k] for s in sec_bucket)
            agg["motion"] = round(sum(s["motion"] for s in sec_bucket) / len(sec_bucket), 2)
            agg["proc_ms"] = int(sum(s["proc_ms"] for s in sec_bucket) / len(sec_bucket))
            agg["fps"] = stats["fps"]
            print(json.dumps(agg), flush=True)
            logf.write(json.dumps(agg) + "\n"); logf.flush()
            sec_bucket, sec_start = [], time.time()

        wait = 1.0 / a.fps - (time.time() - t_loop)
        if wait > 0:
            time.sleep(wait)


if __name__ == "__main__":
    main()
