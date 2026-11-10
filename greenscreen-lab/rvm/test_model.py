"""Snelle controle van een geëxporteerd RVM-model op een videoclip (buiten TD).

~/.venvs/greenscreen/bin/python -I test_model.py <model.mlpackage> <clip> <uitmap> [aantal_frames]
Schrijft pha/fgr-beelden van het laatste frame en meet de tijd per frame.
"""
import json
import subprocess
import sys
import time
from pathlib import Path

import coremltools as ct
import numpy as np
from PIL import Image


def frames(clip, w, h, n):
    cmd = ["ffmpeg", "-loglevel", "error", "-i", clip, "-frames:v", str(n),
           "-vf", f"scale={w}:{h}:force_original_aspect_ratio=increase,crop={w}:{h}",
           "-f", "rawvideo", "-pix_fmt", "rgb24", "-"]
    p = subprocess.Popen(cmd, stdout=subprocess.PIPE)
    size = w * h * 3
    while True:
        buf = p.stdout.read(size)
        if len(buf) < size:
            break
        yield np.frombuffer(buf, np.uint8).reshape(h, w, 3)


def main():
    model_path, clip, out = sys.argv[1], sys.argv[2], Path(sys.argv[3])
    n = int(sys.argv[4]) if len(sys.argv) > 4 else 60
    meta = json.load(open(model_path + ".json"))
    w, h = meta["width"], meta["height"]
    t0 = time.time()
    model = ct.models.MLModel(model_path, compute_units=ct.ComputeUnit.ALL)
    print(f"laden: {time.time() - t0:.1f}s")
    states = {f"r{i+1}i": np.zeros(s, np.float16) for i, s in enumerate(meta["states"])}
    times = []
    out.mkdir(parents=True, exist_ok=True)
    for i, rgb in enumerate(frames(clip, w, h, n)):
        t = time.time()
        res = model.predict({"src": Image.fromarray(rgb), **states})
        times.append(time.time() - t)
        states = {f"r{k}i": res[f"r{k}o"] for k in range(1, 5)}
        last = (rgb, res)
    rgb, res = last
    pha = np.clip(res["pha"][0, 0], 0, 1)
    fgr = np.clip(res["fgr"][0].transpose(1, 2, 0), 0, 1)
    Image.fromarray((pha * 255).astype(np.uint8)).save(out / "pha.png")
    comp = fgr * pha[..., None] + np.array([0, 1, 0]) * (1 - pha[..., None])
    Image.fromarray((comp * 255).astype(np.uint8)).save(out / "comp_groen.png")
    Image.fromarray(rgb).save(out / "bron.png")
    t = np.array(times[5:]) * 1000
    print(f"{len(times)} frames, mediaan {np.median(t):.1f} ms, p95 {np.percentile(t, 95):.1f} ms")


if __name__ == "__main__":
    main()
