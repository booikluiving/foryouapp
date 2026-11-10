"""Test zonder TD: publiceert een clip als Syphon-server (zoals TD dat zou doen) en leest het resultaat terug.

~/.venvs/greenscreen/bin/python -I test_feed.py <clip> <uitmap> [seconden]
"""
import subprocess
import sys
import time
from pathlib import Path

import Metal
import numpy as np
import syphon
from PIL import Image
from syphon.utils.numpy import copy_image_to_mtl_texture, copy_mtl_texture_to_image
from syphon.utils.raw import create_mtl_texture

clip, out, secs = sys.argv[1], Path(sys.argv[2]), float(sys.argv[3]) if len(sys.argv) > 3 else 8
W, H = 1920, 1080
dev = Metal.MTLCreateSystemDefaultDevice()
server = syphon.SyphonMetalServer("fy_lab_bron", device=dev)
tex = create_mtl_texture(dev, W, H, Metal.MTLPixelFormatBGRA8Unorm)
p = subprocess.Popen(["ffmpeg", "-loglevel", "error", "-stream_loop", "-1", "-re", "-i", clip, "-vf", f"scale={W}:{H}",
                      "-f", "rawvideo", "-pix_fmt", "bgra", "-"], stdout=subprocess.PIPE)
directory = syphon.SyphonServerDirectory()
directory.run_loop_interval = 0.001
client, got, t_end = None, 0, time.time() + secs
while time.time() < t_end:
    buf = p.stdout.read(W * H * 4)
    copy_image_to_mtl_texture(np.frombuffer(buf, np.uint8).reshape(H, W, 4), tex)
    server.publish_frame_texture(tex)
    directory.update_run_loop()
    if client is None:
        d = [s for s in directory.servers if s.name == "fy_lab_rvm"]
        if d:
            client = syphon.SyphonMetalClient(d[0], device=dev)
    elif client.has_new_frame:
        img = copy_mtl_texture_to_image(client.new_frame_image)
        got += 1
p.kill()
print("ontvangen resultaten:", got)
if client is not None and got:
    out.mkdir(parents=True, exist_ok=True)
    Image.fromarray(np.ascontiguousarray(img[..., [2, 1, 0, 3]])).save(out / "terug_van_sidecar.png")
