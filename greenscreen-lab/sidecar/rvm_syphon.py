"""Route 2: RVM als apart programma naast TouchDesigner, via Syphon.

TD stuurt het camerabeeld als Syphon-server (Syphon Spout Out TOP, naam --in).
Dit programma maakt er met RVM (CoreML) een matte van en publiceert die als Syphon-server --out.

~/.venvs/greenscreen/bin/python -I rvm_syphon.py --model ../models/rvm_1920x1080.mlpackage \
    --in fy_lab_bron --out fy_lab_rvm --stats ../out/sidecar_stats.json
"""
import argparse
import json
import signal
import time
from pathlib import Path

import coremltools as ct
import Metal
import numpy as np
import syphon
from PIL import Image
from syphon.utils.numpy import copy_image_to_mtl_texture, copy_mtl_texture_to_image
from syphon.utils.raw import create_mtl_texture

RUN = True


def stop(*_):
    global RUN
    RUN = False


def find_server(directory, name):
    for s in directory.servers:
        if s.name == name:
            return s
    return None


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--model", required=True, action="append", help="één of meer modellen; keuze op beeldverhouding")
    ap.add_argument("--in", dest="inp", default="fy_lab_bron")
    ap.add_argument("--out", default="fy_lab_rvm")
    ap.add_argument("--output", choices=["cutout", "matte"], default="cutout")
    ap.add_argument("--flip", action="store_true", help="beeld verticaal spiegelen voor het model")
    ap.add_argument("--stats", default=None)
    ap.add_argument("--debug-dir", default=None, help="bewaar eerste ontvangen frame en eerste resultaat")
    args = ap.parse_args()
    signal.signal(signal.SIGTERM, stop)
    signal.signal(signal.SIGINT, stop)

    models = []
    for path in args.model:
        meta = json.load(open(path + ".json"))
        models.append({
            "W": meta["width"], "H": meta["height"],
            "model": ct.models.MLModel(path, compute_units=ct.ComputeUnit.ALL),
            "zero": {f"r{i+1}i": np.zeros(s, np.float16) for i, s in enumerate(meta["states"])},
        })
    cur = models[0]
    W, H, model, zero = cur["W"], cur["H"], cur["model"], cur["zero"]
    states = dict(zero)

    device = Metal.MTLCreateSystemDefaultDevice()
    server = syphon.SyphonMetalServer(args.out, device=device)
    out_tex = create_mtl_texture(device, W, H, Metal.MTLPixelFormatBGRA8Unorm)

    def pick(tw, th):
        landscape = tw >= th
        for m in models:
            if (m["W"] >= m["H"]) == landscape:
                return m
        return models[0]
    directory = syphon.SyphonServerDirectory()
    directory.run_loop_interval = 0.001
    client = None
    print(f"wacht op Syphon-server '{args.inp}' …", flush=True)

    n, t_last, infer, total = 0, time.time(), [], []
    debug_saved = False
    while RUN:
        if client is None or not client.is_valid:
            directory.update_run_loop()
            desc = find_server(directory, args.inp)
            if desc is None:
                time.sleep(0.2)
                continue
            client = syphon.SyphonMetalClient(desc, device=device)
            states = dict(zero)
            print(f"verbonden met '{desc.name}' ({desc.app_name})", flush=True)
        if not client.has_new_frame:
            directory.update_run_loop()  # Syphon levert frame-meldingen via de run loop
            continue
        t0 = time.time()
        tex = client.new_frame_image
        img = copy_mtl_texture_to_image(tex)
        m = pick(tex.width(), tex.height())
        if m is not cur:
            cur = m
            W, H, model, zero = cur["W"], cur["H"], cur["model"], cur["zero"]
            states = dict(zero)
            out_tex = create_mtl_texture(device, W, H, Metal.MTLPixelFormatBGRA8Unorm)
        if tex.pixelFormat() == Metal.MTLPixelFormatBGRA8Unorm:
            rgb = img[..., [2, 1, 0]]
        else:
            rgb = img[..., :3]
        if args.flip:
            rgb = rgb[::-1]
        pil = Image.fromarray(np.ascontiguousarray(rgb))
        if pil.size != (W, H):
            pil = pil.resize((W, H), Image.BILINEAR)
        t1 = time.time()
        res = model.predict({"src": pil, **states})
        t2 = time.time()
        states = {f"r{k}i": res[f"r{k}o"] for k in range(1, 5)}
        pha = np.clip(res["pha"][0, 0].astype(np.float32), 0, 1)
        if args.output == "matte":
            a8 = (pha * 255 + 0.5).astype(np.uint8)
            bgra = np.dstack([a8, a8, a8, np.full_like(a8, 255)])
        else:
            fgr = np.clip(res["fgr"][0].astype(np.float32), 0, 1).transpose(1, 2, 0)
            pre = fgr * pha[..., None]
            bgra = np.dstack([pre[..., 2], pre[..., 1], pre[..., 0], pha])
            bgra = (bgra * 255 + 0.5).astype(np.uint8)
        if args.flip:
            bgra = bgra[::-1]
        copy_image_to_mtl_texture(np.ascontiguousarray(bgra), out_tex)
        server.publish_frame_texture(out_tex)
        t3 = time.time()
        if args.debug_dir and not debug_saved:
            d = Path(args.debug_dir)
            d.mkdir(parents=True, exist_ok=True)
            Image.fromarray(np.ascontiguousarray(rgb)).save(d / "sidecar_ontvangen.png")
            Image.fromarray(np.ascontiguousarray(bgra[..., [2, 1, 0, 3]])).save(d / "sidecar_resultaat.png")
            debug_saved = True
        n += 1
        infer.append((t2 - t1) * 1000)
        total.append((t3 - t0) * 1000)
        if time.time() - t_last >= 1.0:
            stats = {
                "fps": round(n / (time.time() - t_last), 1),
                "infer_ms": round(float(np.median(infer)), 1),
                "totaal_ms": round(float(np.median(total)), 1),
                "bron": [int(tex.width()), int(tex.height())],
                "model": [W, H],
                "tijd": time.strftime("%H:%M:%S"),
            }
            if args.stats:
                Path(args.stats).write_text(json.dumps(stats))
            print(json.dumps(stats), flush=True)
            n, t_last, infer, total = 0, time.time(), [], []
    server.stop()
    if client is not None:
        client.stop()


if __name__ == "__main__":
    main()
