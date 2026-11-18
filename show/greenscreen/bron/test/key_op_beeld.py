# Rekent de key door op een stilstaand beeld, buiten TouchDesigner: de echte kalibratie (C++, via plugins/src/harness.mm)
# en de shaders gk_alpha / gk_morph / gk_final nagebouwd in numpy.
#   python key_op_beeld.py <harness> <beeld.png> <uit.png> <keyonder> <keyboven> <tint> [frames] [r,g,b-versterking]
# Het beeld gaat <frames> keer achter elkaar door de kalibratie (zo lang staat de speler al zo voor de camera).
import subprocess, sys
import numpy as np
from PIL import Image

harness, bron, uit, lo, hi, tol = sys.argv[1], sys.argv[2], sys.argv[3], float(sys.argv[4]), float(sys.argv[5]), float(sys.argv[6])
frames = int(sys.argv[7]) if len(sys.argv) > 7 else 40
gain = [float(v) for v in sys.argv[8].split(',')] if len(sys.argv) > 8 else [1, 1, 1]
DESPILL, DICHTEN = 0.8, 1

im = Image.open(bron).convert('RGB')
c = np.clip(np.asarray(im).astype(np.float32) / 255 * np.array(gain, np.float32), 0, 1)
H, W = c.shape[:2]

# kalibratiebeeld: 1/2 van dit beeld (in de show 1/8 van het 4K-beeld; ± evenveel vakken over de breedte)
kw, kh = W // 2, H // 2
klein = np.asarray(Image.fromarray((c * 255).astype(np.uint8)).resize((kw, kh), Image.BILINEAR))
bgra = np.dstack([klein[..., 2], klein[..., 1], klein[..., 0], np.full((kh, kw), 255, np.uint8)]).tobytes()
subprocess.run([harness, str(kw), str(kh), uit + '.raster'], input=bgra * frames, check=True, stdout=subprocess.DEVNULL)
gw, gh = (kw + 7) // 8, (kh + 7) // 8
ras = np.frombuffer(open(uit + '.raster', 'rb').read(), np.uint8).reshape(gh, gw, 4).astype(np.float32) / 255
niveau, pr, pg = ras[..., 2], ras[0, 0, 1], ras[0, 0, 0]

def bilin(a):
    ys = np.clip((np.arange(H) + 0.5) / H * gh - 0.5, 0, gh - 1); xs = np.clip((np.arange(W) + 0.5) / W * gw - 0.5, 0, gw - 1)
    y0 = np.floor(ys).astype(int); x0 = np.floor(xs).astype(int); y1 = np.minimum(y0 + 1, gh - 1); x1 = np.minimum(x0 + 1, gw - 1)
    fy = (ys - y0)[:, None]; fx = (xs - x0)[None, :]
    return (a[y0][:, x0] * (1 - fx) + a[y0][:, x1] * fx) * (1 - fy) + (a[y1][:, x0] * (1 - fx) + a[y1][:, x1] * fx) * fy

def sstep(a, b, x):
    t = np.clip((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t)

r, g, b = c[..., 0], c[..., 1], c[..., 2]
ratio = (b - np.maximum(r, g)) / np.maximum(bilin(niveau), 0.02)
s = r + g + b
d = np.hypot(r / np.maximum(s, 1e-6) - pr, g / np.maximum(s, 1e-6) - pg)
tint = np.where(s > 0.04, 1 - sstep(tol, 2.5 * tol, d), 0)
a = 1 - sstep(lo, hi, ratio) * tint

def morph(x, f):
    p = np.pad(x, DICHTEN, mode='edge'); k = 2 * DICHTEN + 1
    return f(np.stack([p[i:i + H, j:j + W] for i in range(k) for j in range(k)]), axis=0)
a = morph(morph(a, np.max), np.min)
p = np.pad(a, 1, mode='edge'); a = sum(p[i:i + H, j:j + W] for i in range(3) for j in range(3)) / 9
lim = np.maximum(r, g); b2 = np.where(b > lim, b - DESPILL * (b - lim), b)
rgb = np.dstack([r, g, b2]) / np.array(gain, np.float32)  # terug naar de kleur van het bronbeeld, alleen voor het plaatje
onder = np.full((H, W, 3), 0.32, np.float32)
onder[::2] *= 1.0
beeld = rgb * a[..., None] + onder * (1 - a[..., None])
Image.fromarray((np.clip(beeld, 0, 1) * 255).astype(np.uint8)).save(uit)
Image.fromarray((a * 255).astype(np.uint8)).save(uit.replace('.png', '-matte.png'))
print('wandniveau raster p10/p50/p90 %.3f %.3f %.3f' % tuple(np.percentile(niveau, [10, 50, 90])), 'tint r,g %.3f %.3f' % (pr, pg))
if len(sys.argv) > 9:
    for naam, x0, y0, x1, y1 in [v.split(':')[:1] + [int(t) for t in v.split(':')[1:]] for v in sys.argv[9:]]:
        print('  %-12s verhouding tot wand %.2f   tintafstand %.3f   dekking %.0f%%' % (naam, np.median(ratio[y0:y1, x0:x1]), np.median(d[y0:y1, x0:x1]), 100 * a[y0:y1, x0:x1].mean()))
