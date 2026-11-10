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
TILE_W, TILE_H = 640, 540


def plugin(name):
    import glob
    v = sorted(glob.glob(os.path.join(PLUG, "versies", name + "-*.plugin")))
    return v[-1] if v else os.path.join(PLUG, name + ".plugin")

root = op("/project1")
old = root.op("lab")
if old:
    old.destroy()
lab = root.create(baseCOMP, "lab")
lab.nodeX, lab.nodeY = 0, 0

page = lab.appendCustomPage("Lab")
p = page.appendMenu("Bron", label="Bron")[0]
CAMS = [
    ("cam1", "Camera 1 (live)", "V1|||3299243008|||0|||0|||DeckLink 8K Pro (1) - 1"),
    ("cam2", "Camera 2 (live)", "V1|||3299243010|||2|||0|||DeckLink 8K Pro (3) - 1"),
    ("cam3", "Camera 3 (live)", "V1|||3299243009|||1|||0|||DeckLink 8K Pro (2) - 1"),
]
p.menuNames = [b[0] for b in BRONNEN] + [c[0] for c in CAMS] + ["live"]
p.menuLabels = [b[1] for b in BRONNEN] + [c[1] for c in CAMS] + ["Live (Syphon fy_show_cam)"]
_start = os.path.join(OUT, "startbron.txt")
if os.path.exists(_start):
    p.val = open(_start).read().strip()
p = page.appendMenu("Weergave", label="Weergave")[0]
p.menuNames = ["rvm", "combi", "vergelijking", "component", "tox"]
p.menuLabels = ["Alleen RVM (groot)", "GPU-key + RVM (groot)", "Vergelijking (6 beelden, zwaar)",
                "Component FY Greenscreen (groot)", "Component uit .tox (groot)"]
p.val = "rvm"
p = page.appendMenu("Visionkwaliteit", label="Vision-kwaliteit")[0]
p.menuNames = ["Fast", "Balanced", "Accurate"]
p.menuLabels = ["Fast", "Balanced", "Accurate"]
p.val = "Balanced"
p = page.appendMenu("Uitvoer", label="Uitvoer")[0]
p.menuNames = ["Cutout", "Matte", "Debug"]
p.menuLabels = ["Over achtergrond", "Alleen matte", "Debug (auto-key: blauw key, groen AI, rood rand)"]

gp = lab.appendCustomPage("GPU-key")
for _n, _l, _d, _mx in (("Keyonder", "Key onder (voorgrond)", 0.25, 1), ("Keyboven", "Key boven (papier)", 0.70, 1),
                       ("Tint", "Tint-tolerantie", 0.06, 0.3), ("Despill", "Despill", 0.8, 1),
                       ("Aifill", "AI vult vanaf", 0.85, 1), ("Dichten", "Gaatjes dichten (straal px)", 2, 6),
                       ("Randlinks", "Rand links", 0, 0.5), ("Randrechts", "Rand rechts", 0, 0.5),
                       ("Randboven", "Rand boven", 0, 0.5), ("Randonder", "Rand onder", 0, 0.5)):
    _p = gp.appendFloat(_n, label=_l)[0]
    _p.default = _d
    _p.val = _d
    _p.normMin, _p.normMax = 0, _mx
_p = gp.appendToggle("Keyvast", label="Key vastzetten")[0]
_p.val = False
gp.appendPulse("Herkalibreer", label="Herkalibreer (meet één keer opnieuw)")
SHADERS = os.path.join(LAB_DIR, "td", "shaders")


def glsl(name, shader, inputs, x, y, uniforms=()):
    dat = lab.create(textDAT, name + "_code")
    setp(dat, file=os.path.join(SHADERS, shader), syncfile=True)
    dat.nodeX, dat.nodeY = x, y - 120
    g = lab.create(glslTOP, name)
    setp(g, pixeldat=dat.path)
    for i, src in enumerate(inputs):
        g.inputConnectors[i].connect(src)
    for i, (uname, vals) in enumerate(uniforms):
        setp(g, **{"vec%dname" % i: uname})
        for comp, v in zip("xyzw", vals):
            setp(g, **{"vec%dvalue%s" % (i, comp): v})
    g.nodeX, g.nodeY = x, y
    return g


# de camera's leveren nu 24p: het lab laten meelopen voorkomt herhaalde/overgeslagen frames
project.cookRate = 24

# --- bronnen ---
ins = []
for i, (key, label, path) in enumerate(BRONNEN):
    m = lab.create(moviefileinTOP, "clip_" + key)
    setp(m, file=path)
    m.nodeX, m.nodeY = -800, 300 - i * 150
    ins.append(m)
# live camera's: dezelfde DeckLink-ingangen en dezelfde draaiing als het show-TD (mirror flipY, fit r90),
# maar 1080x1920 i.p.v. 2160x3840. Alleen de gekozen camera staat aan.
for j, (key, label, dev) in enumerate(CAMS):
    v = lab.create(videodeviceinTOP, key + "_in")
    setp(v, driver="blackmagic", device=dev, inputpixelformat="fixed10", cgamma=0.8,
         active="=parent().par.Bron.eval() == %r" % key)
    v.nodeX, v.nodeY = -1200, -300 - j * 150
    mi = lab.create(mirrorTOP, key + "_mirror")
    mi.inputConnectors[0].connect(v)
    setp(mi, pivotx=0, pivoty=0, flipy=True)
    mi.nodeX, mi.nodeY = -1050, -300 - j * 150
    fi = lab.create(fitTOP, key + "_rechtop")
    fi.inputConnectors[0].connect(mi)
    setp(fi, fit="nativeres", r=90, legacyxform=True, outputresolution="custom", resolutionw=1080, resolutionh=1920)
    fi.nodeX, fi.nodeY = -900, -300 - j * 150
    ins.append(fi)
live = lab.create(syphonspoutinTOP, "live_syphon")
setp(live, sendername="fy_show_cam")
live.nodeX, live.nodeY = -800, -800
ins.append(live)
bron = lab.create(switchTOP, "bron")
for i, m in enumerate(ins):
    bron.inputConnectors[i].connect(m)
setp(bron, index="=parent().par.Bron.menuIndex")
bron.nodeX, bron.nodeY = -600, 150

# CPU-plug-ins krijgen een 8-bit kopie: de download van 10-bit (RGB10A2) naar BGRA8 gaf verkeerde kleuren
bron8 = lab.create(resolutionTOP, "bron8")
bron8.inputConnectors[0].connect(bron)
setp(bron8, outputresolution="useinput", format="rgba8fixed")
bron8.nodeX, bron8.nodeY = -450, 150

# --- route 1: Apple Vision C++ TOP ---
vision = lab.create(cplusplusTOP, "route1_vision")
setp(vision, plugin=plugin("FYVisionMatte"))
vision.inputConnectors[0].connect(bron8)
vision.nodeX, vision.nodeY = -350, 300

# --- standaard keyer: Chroma Key TOP van TD, vast blauw bereik (zoals de show-kalibratie, hue ± 210-240) ---
std = lab.create(chromakeyTOP, "std_key")
std.inputConnectors[0].connect(bron)
std.nodeX, std.nodeY = -350, 150
setp(std, huemin=205, huemax=245, satmin=0.25, satmax=1, valmin=0.12, valmax=1, hsoftlow=10, hsofthigh=10,
     ssoftlow=0.1, vsoftlow=0.08, invert=True)

# --- route 3: RVM C++ TOP (CoreML) ---
rvm = lab.create(cplusplusTOP, "route3_rvm")
setp(rvm, plugin=plugin("FYRvmMatte"))
rvm.inputConnectors[0].connect(bron8)
rvm.nodeX, rvm.nodeY = -350, 0

# --- GPU auto-key: kalibratie op kwart resolutie (C++), key/dichten/samenvoegen in GLSL op volle resolutie ---
klein = lab.create(resolutionTOP, "gk_klein")
klein.inputConnectors[0].connect(bron8)
setp(klein, outputresolution="quarter", format="rgba8fixed")
log("bron format:", bron.par.format.eval() if hasattr(bron.par, "format") else "?", "klein format menu:", klein.par.format.menuNames[:12])
klein.nodeX, klein.nodeY = -350, -300
calib = lab.create(cplusplusTOP, "gk_calib")
setp(calib, plugin=plugin("FYKeyCalib"))
calib.inputConnectors[0].connect(klein)
calib.nodeX, calib.nodeY = -200, -300
P = "parent().par."
ga = glsl("gk_alpha", "gk_alpha.glsl", [bron, calib], -50, -300,
          [("uKey", ["=" + P + "Keyonder", "=" + P + "Keyboven", "=" + P + "Tint", 0])])
gmax = glsl("gk_dilate", "gk_morph.glsl", [ga], 100, -300, [("uMorph", ["=" + P + "Dichten", 1, 0, 0])])
gmin = glsl("gk_erode", "gk_morph.glsl", [gmax], 250, -300, [("uMorph", ["=" + P + "Dichten", 0, 0, 0])])
crop = ("uCrop", ["=" + P + "Randlinks", "=" + P + "Randrechts", "=" + P + "Randboven", "=" + P + "Randonder"])
gk = glsl("gpu_key", "gk_final.glsl", [bron, gmin, rvm], 400, -300,
          [("uMix", ["=" + P + "Despill", "=" + P + "Aifill", 0, "=" + P + "Uitvoer.menuIndex"]), crop])
gk_ai = glsl("gpu_key_rvm", "gk_final.glsl", [bron, gmin, rvm], 400, -450,
             [("uMix", ["=" + P + "Despill", "=" + P + "Aifill", 1, "=" + P + "Uitvoer.menuIndex"]), crop])

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
        setp(sw, index="=min(parent().par.Uitvoer.menuIndex, 1)")
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


tegels = [
    tegel("t0", bron, "Bron", 100, 600, cutout=False),
    tegel("t1", std, "Standaard key (Chroma Key TOP)", 100, 450),
    tegel("t2", gk, "GPU auto-key", 100, 300),
    tegel("t3", gk_ai, "GPU auto-key + RVM", 100, 150),
    tegel("t4", vision, "Apple Vision", 100, 0),
    tegel("t5", rvm, "RVM", 100, -150),
]
raster = lab.create(layoutTOP, "raster")
for i, t in enumerate(tegels):
    raster.inputConnectors[i].connect(t)
setp(raster, align="gridrows", maxcols=3, maxrows=2, outputresolution="custom", resolutionw=3 * TILE_W, resolutionh=2 * TILE_H)
raster.nodeX, raster.nodeY = 1000, 225
solo_bg = lab.create(constantTOP, "solo_achtergrond")
setp(solo_bg, outputresolution="custom", resolutionw=1920, resolutionh=1080, colorr=0.0, colorg=0.6, colorb=0.2)
solo_bg.nodeX, solo_bg.nodeY = 800, -300
# --- de component zoals hij in het show-TD komt, en dezelfde component geladen uit de .tox ---
SHOW_ASSETS = os.path.expanduser("~/ForYou/main/show/greenscreen")
TOX = os.path.join(SHOW_ASSETS, "fy_greenscreen.tox")
exec(open(os.path.join(LAB_DIR, "td", "fy_greenscreen.py")).read(), globals())
gs = build(lab, "fy_greenscreen", SHOW_ASSETS, SHADERS, x=400, y=-700)
gs.inputConnectors[0].connect(bron)
gs.par.Actief.expr = "parent().par.Weergave.eval() == 'component'"
gst = lab.create(baseCOMP, "fy_greenscreen_tox")
gst.nodeX, gst.nodeY = 400, -900


def _tox_aansluiten():
    t = op("/project1/lab/fy_greenscreen_tox")
    if t is not None and t.inputConnectors:
        t.inputConnectors[0].connect(op("/project1/lab/bron"))
        op("/project1/lab/solo_keuze").inputConnectors[3].connect(t.outputConnectors[0])


if os.path.exists(TOX):
    setp(gst, externaltox=TOX, enableexternaltox=True)
    gst.par.reinitnet.pulse()

solo_keuze = lab.create(switchTOP, "solo_keuze")
solo_keuze.inputConnectors[0].connect(rvm)
solo_keuze.inputConnectors[1].connect(gk_ai)
solo_keuze.inputConnectors[2].connect(gs.outputConnectors[0])
run(_tox_aansluiten, delayFrames=10)
setp(solo_keuze, index="={'combi': 1, 'component': 2, 'tox': 3}.get(parent().par.Weergave.eval(), 0)")
solo_keuze.nodeX, solo_keuze.nodeY = 650, -150
solo_fit = lab.create(fitTOP, "solo_fit")
solo_fit.inputConnectors[0].connect(solo_keuze)
setp(solo_fit, outputresolution="custom", resolutionw=1920, resolutionh=1080, fit="fitbest")
solo_fit.nodeX, solo_fit.nodeY = 800, -150
solo = lab.create(overTOP, "solo")
solo.inputConnectors[0].connect(solo_fit)
solo.inputConnectors[1].connect(solo_bg)
solo.nodeX, solo.nodeY = 1000, -150
weergave = lab.create(switchTOP, "weergave")
weergave.inputConnectors[0].connect(solo)
weergave.inputConnectors[1].connect(raster)
setp(weergave, index="=1 if parent().par.Weergave.eval() == 'vergelijking' else 0")
weergave.nodeX, weergave.nodeY = 1150, 225
uit = lab.create(nullTOP, "uit")
uit.inputConnectors[0].connect(weergave)
uit.nodeX, uit.nodeY = 1200, 225
root.par.opviewer = uit.path if hasattr(root.par, "opviewer") else None

# --- testbeeld naar de drie teleprompters (zelfde DeckLink-uitgangen als het show-TD, 1080p25).
#     NIET naar het Main TV (videodevout4). Alleen veilig als het show-TD dicht is. ---
_tp = page.appendToggle("Teleprompters", label="Testbeeld op teleprompters")[0]
_tp.val = True
TP = [("teleprompter_1", "V1|||3767264291|||7|||0|||DeckLink 8K Pro (4) - 2"),
      ("teleprompter_2", "V1|||3767264289|||5|||0|||DeckLink 8K Pro (2) - 2"),
      ("teleprompter_3", "V1|||3767264290|||6|||0|||DeckLink 8K Pro (3) - 2")]
tp_fit = lab.create(fitTOP, "teleprompter_fit")
tp_fit.inputConnectors[0].connect(uit)
setp(tp_fit, outputresolution="custom", resolutionw=1920, resolutionh=1080, fit="fitbest")
tp_fit.nodeX, tp_fit.nodeY = 1400, 50
for _j, (_n, _dev) in enumerate(TP):
    o = lab.create(videodeviceoutTOP, _n)
    o.inputConnectors[0].connect(tp_fit)
    setp(o, driver="blackmagic", device=_dev, signalformat="f1920x1080p-25.00hz", active="=parent().par.Teleprompters")
    o.nodeX, o.nodeY = 1600, 50 - _j * 120

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
_ci = lab.create(infoCHOP, "cam1_caminfo")
setp(_ci, op=lab.op("cam1_in").path)
_ci.nodeX, _ci.nodeY = -1200, -900
for o, n in ((vision, "info_vision"), (rvm, "info_rvm"), (calib, "info_calib")):
    ic = lab.create(infoCHOP, n)
    setp(ic, op=o.path)
    ic.nodeX, ic.nodeY = o.nodeX, o.nodeY - 80

MONITOR = r"""
# Lichte monitor: meet elke frametijd; schrijft elke 2 s één regel naar frametijden.jsonl.
# Zware dingen (pixels teruglezen, beelden opslaan) alleen op verzoek via out/lab_control.json {"snapshot": <getal>}.
import json, os, time
OUT = __OUT__
CTRL = os.path.join(OUT, "lab_control.json")

def _chan(chop, name):
    try:
        c = chop[name]
        return float(c.eval()) if c is not None else None
    except Exception:
        return None

def _control(lab):
    try:
        m = os.path.getmtime(CTRL)
    except OSError:
        return
    if m == me.fetch("ctrl_mtime", 0):
        return
    me.store("ctrl_mtime", m)
    try:
        cfg = json.load(open(CTRL))
    except Exception:
        return
    for k, v in cfg.get("pars", {}).items():
        opname, _, par = k.rpartition(".")
        o = lab.op(opname) if opname else lab
        p = getattr(o.par, par, None) if o else None
        if p is not None:
            p.expr = ""
            p.val = v
    for k in cfg.get("pulse", []):
        if k in me.fetch("pulsed", []):
            continue
        opname, _, par = k.rpartition(".")
        o = lab.op(opname) if opname else lab
        p = getattr(o.par, par, None) if o else None
        if p is not None:
            p.pulse()
    me.store("pulsed", list(cfg.get("pulse", [])))
    if cfg.get("snapshot") != me.fetch("snapshot", None):
        me.store("snapshot", cfg.get("snapshot"))
        lab.op("uit").save(os.path.join(OUT, "td_raster.jpg"))
        for n in cfg.get("save", []):
            if lab.op(n) is not None:
                lab.op(n).save(os.path.join(OUT, "snap_" + n + ".jpg"))
        if cfg.get("bron") and lab.par.Bron.eval().startswith("cam"):
            tmp = os.path.join(OUT, "bron_tmp.png")
            lab.op("bron").save(tmp)
            os.replace(tmp, os.path.join(OUT, "bron_" + lab.par.Bron.eval() + ".png"))
    if cfg.get("export") and cfg.get("export") != me.fetch("export", None):
        me.store("export", cfg.get("export"))
        tox = os.path.expanduser("~/ForYou/main/show/greenscreen/fy_greenscreen.tox")
        g = lab.op("fy_greenscreen")
        _e = g.par.Actief.expr
        g.par.Actief.expr = ""
        g.par.Actief.val = True
        g.save(tox)
        g.par.Actief.expr = _e
        t = lab.op("fy_greenscreen_tox")
        t.par.externaltox = tox
        t.par.enableexternaltox = True
        t.par.reinitnet.pulse()
        run("op('/project1/lab/fy_greenscreen_tox').inputConnectors[0].connect(op('/project1/lab/bron')); op('/project1/lab/solo_keuze').inputConnectors[3].connect(op('/project1/lab/fy_greenscreen_tox').outputConnectors[0])", delayFrames=10)
    if cfg.get("cookrate"):
        project.cookRate = cfg["cookrate"]

def onFrameStart(frame):
    lab = parent()
    dts = me.fetch("dts", [], storeDefault=True)
    dts.append(absTime.stepSeconds * 1000.0)
    now = time.time()
    t0 = me.fetch("t0", now, storeDefault=True)
    if frame % 12 == 0:
        _control(lab)
    if now - t0 < 2.0:
        return
    me.store("t0", now)
    me.store("dts", [])
    exp = 1000.0 / max(project.cookRate, 1)
    cam = lab.op("cam1_caminfo")
    rvm = lab.op("info_rvm")
    line = {
        "t": time.strftime("%H:%M:%S"),
        "n": len(dts),
        "fps": round(len(dts) / (now - t0), 1),
        "gem_ms": round(sum(dts) / max(len(dts), 1), 1),
        "max_ms": round(max(dts) if dts else 0, 1),
        "hapering_1.5x": sum(1 for d in dts if d > 1.5 * exp),
        "groot_100ms": sum(1 for d in dts if d > 100),
        "cookrate": project.cookRate,
        "cam_skipped": _chan(cam, "frames_skipped"),
        "cam_repeated": _chan(cam, "frames_repeated"),
        "cam_dropped": _chan(cam, "frames_dropped"),
        "cam_sync_timeouts": _chan(cam, "sync_timeouts"),
        "rvm_infer": _chan(rvm, "infer_ms"),
        "rvm_lat": _chan(rvm, "latency_ms"),
        "rvm_processed": _chan(rvm, "processed"),
        "rvm_dropped": _chan(rvm, "dropped"),
        "weergave": lab.par.Weergave.eval(),
        "key_vast": bool(lab.par.Keyvast.eval()),
        "tox_rvm_infer": _chan(lab.op("fy_greenscreen_tox/info_rvm"), "infer_ms"),
        "tox_rvm_processed": _chan(lab.op("fy_greenscreen_tox/info_rvm"), "processed"),
        "tox_kal_processed": _chan(lab.op("fy_greenscreen_tox/info_kalibratie"), "processed"),
        "tox_fouten": {o.name: (o.errors() or o.warnings()) for o in (lab.op("fy_greenscreen_tox").children if lab.op("fy_greenscreen_tox") else []) if (o.errors() or o.warnings())},
        "calib_resets": _chan(lab.op("info_calib"), "resets"),
        "teleprompters": bool(lab.par.Teleprompters.eval()),
        "rvm_actief": bool(lab.op("route3_rvm").par.Active.eval()) if getattr(lab.op("route3_rvm").par, "Active", None) is not None else None,
        "venster": bool(lab.op("venster").isOpen),
    }
    with open(os.path.join(OUT, "frametijden.jsonl"), "a") as f:
        f.write(json.dumps(line) + "\n")
""".replace("__OUT__", repr(OUT))
pe = lab.create(parameterexecuteDAT, "knoppen")
pe.text = """
def onPulse(par):
    if par.name == 'Herkalibreer':
        c = parent().op('gk_calib')
        if c is not None and getattr(c.par, 'Reset', None) is not None:
            c.par.Reset.pulse()
"""
setp(pe, op=lab.path, pars="Herkalibreer", onpulse=True, valuechange=False)
pe.nodeX, pe.nodeY = 1200, -250

# zichtbare status van de key op de grote weergave
status = lab.create(textTOP, "key_status")
setp(status, text="=('KEY VAST' if parent().par.Keyvast else 'KEY VOLGT LICHT') if parent().par.Weergave.eval() == 'combi' else ''",
     outputresolution="custom", resolutionw=1920, resolutionh=1080, alignx="left", aligny="top", fontsizex=34,
     bgalpha=0, positionx=24, positiony=-20, fontcolorr=1, fontcolorg=1, fontcolorb=1)
status.nodeX, status.nodeY = 1000, -300
solo_status = lab.create(overTOP, "solo_met_status")
solo_status.inputConnectors[0].connect(status)
solo_status.inputConnectors[1].connect(solo)
solo_status.nodeX, solo_status.nodeY = 1100, -150
weergave.inputConnectors[0].connect(solo_status)

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
    ck = lab2.op("gk_calib")
    if getattr(r.par, "Model", None) is None and poging < 40:
        run(_na_laden, poging + 1, delayFrames=15)
        return
    model_expr = "=%r if me.inputs[0].width >= me.inputs[0].height else %r" % (
        os.path.join(MODELS, "rvm_1920x1080.mlpackage"), os.path.join(MODELS, "rvm_1080x1920.mlpackage"))
    # Vision en kalibratie koken pas als de vergelijking aan staat; hun parameters bestaan dan pas
    for _o in (v, ck):
        _o.cook(force=True)
    setp(v, Quality="=parent().par.Visionkwaliteit.menuIndex", Output="=min(parent().par.Uitvoer.menuIndex, 1)")
    setp(r, Output=0, Model=model_expr, Active="=parent().par.Weergave.eval() in ('rvm', 'combi', 'vergelijking')")
    setp(ck, Adapt=0.15, Active="=parent().par.Weergave.eval() != 'rvm'", Lock="=parent().par.Keyvast")
    setp(v, Active="=parent().par.Weergave.eval() == 'vergelijking'")
    log("na laden, poging", poging, [(p.name, p.eval()) for p in v.pars() if p.name in ("Quality", "Output", "Active")])
    open(LOG, "a").write("\n".join(_log) + "\n")


run(_na_laden, delayFrames=30)
if _mon is not None and "LG" not in str(getattr(monitors[_mon], "description", "")):
    run(lambda: op("/project1/lab/venster").par.winopen.pulse(), delayFrames=45)
else:
    log("venster NIET geopend: geen veilige hoofdmonitor gevonden")
open(LOG, "w").write("\n".join(_log) + "\nbuild klaar\n")
