# Bouwt /project1/lab: drie AI-matte-routes naast elkaar op dezelfde bron.
# Draait in TouchDesigner (via de bootstrap in greenscreen-lab.toe). Niet in het show-bestand gebruiken.
import json
import os

LAB_DIR = os.path.dirname(os.path.dirname(os.path.abspath(BUILD)))  # noqa: F821 (BUILD komt uit de bootstrap)
OUT = os.path.join(LAB_DIR, "out")
PLUG = os.path.join(LAB_DIR, "plugins", "build")
MODELS = os.path.join(LAB_DIR, "models")
LOG = os.path.join(OUT, "td_build.log")
os.makedirs(OUT, exist_ok=True)
_log = []


def log(*a):
    _log.append(" ".join(str(x) for x in a))


def setp(o, **kw):
    for k, v in kw.items():
        p = getattr(o.par, k, None)
        if p is None:
            log(f"par ontbreekt: {o.path}.{k}")
            continue
        try:
            if isinstance(v, str) and v.startswith("="):
                p.expr = v[1:]
            else:
                p.val = v
        except Exception as e:
            log(f"par fout {o.path}.{k}: {e}")


BRONNEN = [
    ("haar", "Haar close-up", "/Users/Shared/Adobe/Premiere Pro/26.0/Sample Media/Sample Media Clip 11.mp4"),
    ("groep", "Groep van vier", "/Users/Shared/Adobe/Premiere Pro/26.0/Sample Media/Sample Media Clip 13.mp4"),
    ("twin", "Twin S2 blauw papier", "/Users/booikluiving/ForYou-twin/feeds/cam2.mp4"),
]
TILE_W, TILE_H = 960, 540

root = op("/project1")
old = root.op("lab")
if old:
    old.destroy()
lab = root.create(baseCOMP, "lab")
lab.nodeX, lab.nodeY = 0, 0

page = lab.appendCustomPage("Lab")
p = page.appendMenu("Bron", label="Bron")[0]
p.menuNames = [b[0] for b in BRONNEN] + ["live"]
p.menuLabels = [b[1] for b in BRONNEN] + ["Live (Syphon fy_show_cam)"]
_start = os.path.join(OUT, "startbron.txt")
if os.path.exists(_start):
    p.val = open(_start).read().strip()
p = page.appendMenu("Visionkwaliteit", label="Vision-kwaliteit")[0]
p.menuNames = ["Fast", "Balanced", "Accurate"]
p.menuLabels = ["Fast", "Balanced", "Accurate"]
p.val = "Balanced"
p = page.appendMenu("Uitvoer", label="Uitvoer")[0]
p.menuNames = ["Cutout", "Matte"]
p.menuLabels = ["Over achtergrond", "Alleen matte"]

# --- bronnen ---
ins = []
for i, (key, label, path) in enumerate(BRONNEN):
    m = lab.create(moviefileinTOP, "clip_" + key)
    setp(m, file=path)
    m.nodeX, m.nodeY = -800, 300 - i * 150
    ins.append(m)
live = lab.create(syphonspoutinTOP, "live_syphon")
setp(live, sendername="fy_show_cam")
live.nodeX, live.nodeY = -800, 300 - 3 * 150
ins.append(live)
bron = lab.create(switchTOP, "bron")
for i, m in enumerate(ins):
    bron.inputConnectors[i].connect(m)
setp(bron, index="=parent().par.Bron.menuIndex")
bron.nodeX, bron.nodeY = -600, 150

# --- route 1: Apple Vision C++ TOP ---
vision = lab.create(cplusplusTOP, "route1_vision")
setp(vision, plugin=os.path.join(PLUG, "FYVisionMatte.plugin"))
vision.inputConnectors[0].connect(bron)
vision.nodeX, vision.nodeY = -350, 300

# --- route 2: RVM via Syphon (sidecar) ---
naar = lab.create(syphonspoutoutTOP, "route2_naar_sidecar")
setp(naar, sendername="fy_lab_bron")
naar.inputConnectors[0].connect(bron)
naar.nodeX, naar.nodeY = -350, 150
van = lab.create(syphonspoutinTOP, "route2_van_sidecar")
setp(van, sendername="Python:fy_lab_rvm")
van.nodeX, van.nodeY = -150, 150

# --- route 3: RVM C++ TOP (CoreML) ---
rvm = lab.create(cplusplusTOP, "route3_rvm")
setp(rvm, plugin=os.path.join(PLUG, "FYRvmMatte.plugin"))
rvm.inputConnectors[0].connect(bron)
rvm.nodeX, rvm.nodeY = -350, 0

# --- achtergrond, tegels en raster ---
bg = lab.create(constantTOP, "achtergrond")
setp(bg, outputresolution="custom", resolutionw=TILE_W, resolutionh=TILE_H, colorr=0.0, colorg=0.6, colorb=0.2)
bg.nodeX, bg.nodeY = 0, -300


def tegel(name, src, titel, x, y, cutout=True):
    fit = lab.create(fitTOP, name + "_fit")
    fit.inputConnectors[0].connect(src)
    setp(fit, outputresolution="custom", resolutionw=TILE_W, resolutionh=TILE_H, fit="fitbest")
    fit.nodeX, fit.nodeY = x, y
    last = fit
    if cutout:
        ov = lab.create(overTOP, name + "_over")
        ov.inputConnectors[0].connect(fit)
        ov.inputConnectors[1].connect(bg)
        ov.nodeX, ov.nodeY = x + 150, y
        sw = lab.create(switchTOP, name + "_uit")
        sw.inputConnectors[0].connect(ov)
        sw.inputConnectors[1].connect(fit)
        setp(sw, index="=parent().par.Uitvoer.menuIndex")
        sw.nodeX, sw.nodeY = x + 300, y
        last = sw
    txt = lab.create(textTOP, name + "_titel")
    setp(txt, text=titel, outputresolution="custom", resolutionw=TILE_W, resolutionh=TILE_H,
         alignx="left", aligny="top", fontsizex=26, bgalpha=0, positionx=16, positiony=-14)
    txt.nodeX, txt.nodeY = x + 300, y - 100
    t = lab.create(overTOP, name + "_tegel")
    t.inputConnectors[0].connect(txt)
    t.inputConnectors[1].connect(last)
    t.nodeX, t.nodeY = x + 450, y
    return t


t0 = tegel("t0", bron, "Bron", 100, 450, cutout=False)
t1 = tegel("t1", vision, "1  Apple Vision (C++ TOP)", 100, 300)
t2 = tegel("t2", van, "2  RVM via Syphon (los programma)", 100, 150)
t3 = tegel("t3", rvm, "3  RVM CoreML (C++ TOP)", 100, 0)

raster = lab.create(layoutTOP, "raster")
for i, t in enumerate((t0, t1, t2, t3)):
    raster.inputConnectors[i].connect(t)
setp(raster, align="gridrows", maxcols=2, maxrows=2)
log("align menu:", raster.par.align.menuNames, "fit:", raster.par.fit.menuNames)
raster.nodeX, raster.nodeY = 1000, 225
uit = lab.create(nullTOP, "uit")
uit.inputConnectors[0].connect(raster)
uit.nodeX, uit.nodeY = 1200, 225
root.par.opviewer = uit.path if hasattr(root.par, "opviewer") else None

# --- venster op de hoofdmonitor (regie-Dell), NOOIT op de LG ---
win = lab.create(windowCOMP, "venster")
_mon = None
for _i, _m in enumerate(monitors):
    log("monitor", _i, _m.description if hasattr(_m, "description") else "", _m.left, _m.top, _m.width, _m.height, _m.isPrimary)
    if _m.isPrimary:
        _mon = _i
setp(win, winop=uit.path, title="For_You greenscreen-lab", winw=1920, winh=1080, borders=True,
     justifyh="center", justifyv="center")
if _mon is not None:
    setp(win, monitor=_mon)
win.nodeX, win.nodeY = 1400, 225

# --- info en monitor ---
for o, n in ((vision, "info_vision"), (rvm, "info_rvm")):
    ic = lab.create(infoCHOP, n)
    setp(ic, op=o.path)
    ic.nodeX, ic.nodeY = o.nodeX, o.nodeY - 80

MONITOR = r'''
import json, os, time
OUT = __OUT__

def _vals(chop):
    try:
        return {c.name: round(float(c.eval()), 2) for c in chop.chans()}
    except Exception as e:
        return {"fout": str(e)}

def onFrameStart(frame):
    if frame % 90:
        return
    lab = parent()
    stats = {
        "tijd": time.strftime("%H:%M:%S"),
        "td_fps": round(float(project.cookRate), 1),
        "td_frame_ms": round(float(lab.op("uit").cookTime or 0), 2),
        "bron": lab.par.Bron.eval(),
        "bron_res": [lab.op("bron").width, lab.op("bron").height],
        "vision": _vals(lab.op("info_vision")),
        "rvm_cpp": _vals(lab.op("info_rvm")),
        "sidecar_in_res": [lab.op("route2_van_sidecar").width, lab.op("route2_van_sidecar").height],
        "fouten": {o.name: (o.errors() or "") + (o.warnings() or "") for o in lab.children if (o.errors() or o.warnings())},
        "venster_open": bool(lab.op("venster").isOpen),
        "absTime_fps": round(1.0 / max(absTime.stepSeconds, 1e-6), 1),
    }
    open(os.path.join(OUT, "td_stats.json"), "w").write(json.dumps(stats, indent=1))
    try:
        lab.op("uit").save(os.path.join(OUT, "td_raster.jpg"))
    except Exception as e:
        stats["save_fout"] = str(e)
'''.replace("__OUT__", repr(OUT))
mon = lab.create(executeDAT, "monitor")
mon.text = MONITOR
setp(mon, framestart=True, active=True)
mon.nodeX, mon.nodeY = 1200, -100


def _na_laden(poging=0):
    lab2 = op("/project1/lab")
    if lab2 is None:
        return
    v = lab2.op("route1_vision")
    r = lab2.op("route3_rvm")
    if (getattr(v.par, "Quality", None) is None or getattr(r.par, "Model", None) is None) and poging < 40:
        run(_na_laden, poging + 1, delayFrames=15)
        return
    setp(v, Quality="=parent().par.Visionkwaliteit.menuIndex", Output="=parent().par.Uitvoer.menuIndex")
    setp(r, Output="=parent().par.Uitvoer.menuIndex",
         Model="=%r if me.inputs[0].width >= me.inputs[0].height else %r" % (
             os.path.join(MODELS, "rvm_1920x1080.mlpackage"), os.path.join(MODELS, "rvm_1080x1920.mlpackage")))
    log("na laden, poging", poging, [(p.name, p.eval()) for p in v.pars() if p.name in ("Quality", "Output", "Active")])
    open(LOG, "a").write("\n".join(_log) + "\n")


run(_na_laden, delayFrames=30)
if _mon is not None and "LG" not in str(getattr(monitors[_mon], "description", "")):
    run(lambda: op("/project1/lab/venster").par.winopen.pulse(), delayFrames=45)
else:
    log("venster NIET geopend: geen veilige hoofdmonitor gevonden")
open(LOG, "w").write("\n".join(_log) + "\nbuild klaar\n")
