"""Exporteer Robust Video Matting (mobilenetv3) naar een CoreML-model met vaste resolutie.

Gebruik:
  ~/.venvs/greenscreen/bin/python -I export_coreml.py --rvm-src <map met RVM-repo> \
      --weights rvm_mobilenetv3.pth --width 1080 --height 1920 --ratio 0.25 --out rvm_1080x1920.mlpackage

Ingangen:  src (beeld RGB, 0-1), r1i..r4i (recurrente toestand, eerste frame nullen)
Uitgangen: fgr [1,3,H,W], pha [1,1,H,W], r1o..r4o
RVM valt onder GPL-3.0 (github.com/PeterL1n/RobustVideoMatting).
"""
import argparse
import json
import sys

import numpy as np
import torch


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--rvm-src", required=True)
    ap.add_argument("--weights", required=True)
    ap.add_argument("--width", type=int, required=True)
    ap.add_argument("--height", type=int, required=True)
    ap.add_argument("--ratio", type=float, default=0.25)
    ap.add_argument("--out", required=True)
    args = ap.parse_args()

    sys.path.insert(0, args.rvm_src)
    from model import MattingNetwork  # noqa: E402

    import coremltools as ct

    net = MattingNetwork("mobilenetv3").eval()
    net.load_state_dict(torch.load(args.weights, map_location="cpu", weights_only=True))

    H, W, ratio = args.height, args.width, args.ratio

    class Wrapper(torch.nn.Module):
        def __init__(self, m):
            super().__init__()
            self.m = m

        def forward(self, src, r1, r2, r3, r4):
            fgr, pha, r1o, r2o, r3o, r4o = self.m(src, r1, r2, r3, r4, downsample_ratio=ratio)
            return fgr, pha, r1o, r2o, r3o, r4o

    src = torch.rand(1, 3, H, W)
    with torch.no_grad():
        _, _, *rec = net(src, downsample_ratio=ratio)
    shapes = [tuple(r.shape) for r in rec]
    print("recurrente toestanden:", shapes)

    wrapper = Wrapper(net).eval()
    zeros = [torch.zeros(s) for s in shapes]
    with torch.no_grad():
        traced = torch.jit.trace(wrapper, (src, *zeros), check_trace=False)

    inputs = [ct.ImageType(name="src", shape=(1, 3, H, W), scale=1 / 255.0, color_layout=ct.colorlayout.RGB)]
    inputs += [ct.TensorType(name=f"r{i+1}i", shape=s, dtype=np.float16) for i, s in enumerate(shapes)]
    outputs = [ct.TensorType(name=n, dtype=np.float16) for n in ["fgr", "pha", "r1o", "r2o", "r3o", "r4o"]]

    mlmodel = ct.convert(
        traced,
        inputs=inputs,
        outputs=outputs,
        minimum_deployment_target=ct.target.macOS14,
        compute_precision=ct.precision.FLOAT16,
        convert_to="mlprogram",
    )
    mlmodel.short_description = f"RVM mobilenetv3 {W}x{H} ratio {ratio} (GPL-3.0)"
    mlmodel.save(args.out)
    with open(args.out + ".json", "w") as f:
        json.dump({"width": W, "height": H, "ratio": ratio, "states": shapes}, f)
    print("opgeslagen:", args.out)


if __name__ == "__main__":
    main()
