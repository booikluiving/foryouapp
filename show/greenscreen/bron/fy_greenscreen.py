# Bouwt de For_You-greenscreencomponent (FY Greenscreen) in TouchDesigner.
# Eén Base COMP: in1 = camerabeeld (staand, elke resolutie), out1 = voorvermenigvuldigd RGBA.
# Modus: Key (alleen GPU-key, standaard), Combi (GPU-key + RVM), RVM (alleen AI).
# De key beweegt doorlopend mee met het licht; "Key op licht" (Herkalibreer) meet het blauw in één keer helemaal opnieuw.
# Alleen de wand wordt geleerd: donkerblauwe kleding telt niet mee (zie plugins/src/KeyEngine.mm).
# Wat de operator instelt staat per camera in <project>/greenscreen/instellingen/<Camera>.json en komt na een herstart terug.
# Wordt in het lab gebouwd en als .tox opgeslagen; het show-TD laadt die .tox per camera.
import os


def build(parent, name, assets, shaders_dir, x=0, y=0):
    """parent: COMP waarin de component komt. assets: map met plugins/ en models/. Geeft de COMP terug."""
    old = parent.op(name)
    if old:
        old.destroy()
    c = parent.create(baseCOMP, name)
    c.nodeX, c.nodeY = x, y
    c.color = (0.1, 0.35, 0.8)

    pg = c.appendCustomPage("Greenscreen")
    p = pg.appendMenu("Modus", label="Modus")[0]
    p.menuNames = ["combi", "rvm", "key"]
    p.menuLabels = ["Key + RVM", "Alleen RVM", "Alleen key"]
    p.default = "key"
    p.val = "key"
    p = pg.appendToggle("Keyvast", label="Key vastzetten")[0]  # uit = de key beweegt doorlopend mee met het licht
    pg.appendPulse("Herkalibreer", label="Key op licht")
    p = pg.appendToggle("Actief", label="Actief")[0]
    p.default = True
    p.val = True
    kp = c.appendCustomPage("Key")
    for n, l, d, mx in (("Keyonder", "Key onder (voorgrond)", 0.55, 1), ("Keyboven", "Key boven (papier)", 0.85, 1),
                        ("Tint", "Tint (smal = alleen wandblauw)", 0.06, 0.15),
                        ("Despill", "Despill", 0.8, 1), ("Dichten", "Gaatjes dichten (straal px)", 2, 6),
                        ("Randlinks", "Rand links", 0, 0.5), ("Randrechts", "Rand rechts", 0, 0.5),
                        ("Randboven", "Rand boven", 0, 0.5), ("Randonder", "Rand onder", 0, 0.5)):
        q = kp.appendFloat(n, label=l)[0]
        q.default = d
        q.val = d
        q.normMin, q.normMax = 0, mx

    P = "parent().par."
    AIFILL = 0.85  # vaste waarde: drempel waar RVM invult (alleen in Key + RVM)
    plug = os.path.join(assets, "plugins")
    model = os.path.join(assets, "models", "rvm_1080x1920.mlpackage")

    def node(typ, n, nx, ny, inputs=(), **pars):
        o = c.create(typ, n)
        o.nodeX, o.nodeY = nx, ny
        for i, s in enumerate(inputs):
            o.inputConnectors[i].connect(s)
        for k, v in pars.items():
            par = getattr(o.par, k)
            if isinstance(v, str) and v.startswith("="):
                par.expr = v[1:]
            else:
                par.val = v
        return o

    def glsl(n, shader, inputs, nx, ny, uniforms):
        dat = node(textDAT, n + "_code", nx, ny - 130)
        dat.text = open(os.path.join(shaders_dir, shader)).read()
        g = node(glslTOP, n, nx, ny, inputs, pixeldat=dat.name)
        for i, (uname, vals) in enumerate(uniforms):
            setattr(g.par, "vec%dname" % i, uname)
            for comp, v in zip("xyzw", vals):
                par = getattr(g.par, "vec%dvalue%s" % (i, comp))
                if isinstance(v, str) and v.startswith("="):
                    par.expr = v[1:]
                else:
                    par.val = v
        return g

    inp = node(inTOP, "in1", -800, 0)
    # 8-bit kopie op 1080 breed/hoog: CPU-plug-ins lezen 10-bit verkeerd, en kleiner = sneller
    bron8 = node(resolutionTOP, "bron8", -600, 150, [inp], outputresolution="custom", format="rgba8fixed",
                 resolutionw="=1080 if me.inputs[0].height >= me.inputs[0].width else 1920",
                 resolutionh="=1920 if me.inputs[0].height >= me.inputs[0].width else 1080")
    klein = node(resolutionTOP, "kalibratiebeeld", -450, 300, [bron8], outputresolution="quarter", format="rgba8fixed")
    calib = node(cplusplusTOP, "kalibratie", -300, 300, [klein], plugin=os.path.join(plug, "FYWandKey.plugin"))
    rvm = node(cplusplusTOP, "rvm", -300, 150, [bron8], plugin=os.path.join(plug, "FYRvmMatte.plugin"))
    ga = glsl("key_alfa", "gk_alpha.glsl", [inp, calib], -100, 0,
              [("uKey", ["=" + P + "Keyonder", "=" + P + "Keyboven", "=" + P + "Tint", 0])])
    gmax = glsl("dichten_max", "gk_morph.glsl", [ga], 50, 0, [("uMorph", ["=" + P + "Dichten", 1, 0, 0])])
    gmin = glsl("dichten_min", "gk_morph.glsl", [gmax], 200, 0, [("uMorph", ["=" + P + "Dichten", 0, 0, 0])])
    final = glsl("samenvoegen", "gk_final.glsl", [inp, gmin, rvm], 350, 0,
                 [("uMix", ["=" + P + "Despill", AIFILL, "=1 if " + P + "Modus.eval() == 'combi' else 0", 0]),
                  ("uCrop", ["=" + P + "Randlinks", "=" + P + "Randrechts", "=" + P + "Randboven", "=" + P + "Randonder"])])
    rvm_vol = node(fitTOP, "rvm_vol", 350, 150, [rvm], outputresolution="custom", fit="fill",
                   resolutionw="=op('in1').width", resolutionh="=op('in1').height")
    keuze = node(switchTOP, "keuze", 500, 50, [final, rvm_vol, inp],
                 index="=2 if not " + P + "Actief else (1 if " + P + "Modus.eval() == 'rvm' else 0)")
    node(outTOP, "out1", 650, 50, [keuze])
    node(infoCHOP, "info_rvm", -300, -100, op="rvm")
    node(infoCHOP, "info_kalibratie", -300, -220, op="kalibratie")

    # plug-in-parameters bestaan pas na het laden van de plug-in: zet ze bij start en daarna steeds opnieuw als ze ontbreken
    zorg = node(executeDAT, "zorg", 650, -200)
    zorg.text = '''
import json, os
MODEL = %r
BEWAAR = "Modus Keyvast Actief Keyonder Keyboven Tint Despill Dichten Randlinks Randrechts Randboven Randonder".split()

def _pad():
    return os.path.join(project.folder, 'greenscreen', 'instellingen', parent().parent().name + '.json')

def _herstel():
    # zet terug wat de operator voor deze camera had ingesteld (TD laadt de component bij elke start met de standaardwaarden)
    c = parent()
    try:
        w = json.load(open(_pad()))
    except Exception:
        w = {}
    for k, v in w.items():
        p = getattr(c.par, k, None)
        if k in BEWAAR and p is not None:
            try:
                p.val = v
            except Exception:
                pass
    me.store('vuil', False)
    me.store('hersteld', True)

def _bewaar():
    c = parent()
    try:
        os.makedirs(os.path.dirname(_pad()), exist_ok=True)
        with open(_pad(), 'w') as f:
            json.dump({k: getattr(c.par, k).eval() for k in BEWAAR if hasattr(c.par, k)}, f, indent=1)
    except Exception:
        pass

def _zet():
    c = parent()
    k, r = op('kalibratie'), op('rvm')
    for o in (k, r):
        o.cook(force=True)
    if getattr(k.par, 'Lock', None) is not None:
        k.par.Lock.expr = "parent().par.Keyvast"
        k.par.Active.expr = "parent().par.Actief and parent().par.Modus.eval() != 'rvm'"
        k.par.Adapt.val = 0.15
    if getattr(r.par, 'Model', None) is not None:
        if r.par.Model.eval() != MODEL:
            r.par.Model.val = MODEL
        r.par.Output.val = 0
        r.par.Active.expr = "parent().par.Actief and parent().par.Modus.eval() != 'key'"
    return getattr(k.par, 'Lock', None) is not None and getattr(r.par, 'Model', None) is not None

def onStart():
    me.store('tikken', 0)
    _zet()
    _herstel()

def onCreate():
    me.store('tikken', 0)
    _zet()
    _herstel()

def onFrameStart(frame):
    if frame %% 50:
        return
    if not me.fetch('hersteld', False):
        _herstel()
    elif me.fetch('vuil', False):
        me.store('vuil', False)
        _bewaar()
    if not me.fetch('klaar', False):
        me.store('klaar', _zet())
        return
    # een paar seconden na de start één keer helemaal opnieuw meten, als de camera's beeld geven
    t = me.fetch('tikken', 0)
    if t < 6:
        me.store('tikken', t + 1)
        if t + 1 == 6:
            k = op('kalibratie')
            if getattr(k.par, 'Reset', None) is not None:
                k.par.Reset.pulse()
''' % model
    zorg.par.start = True
    zorg.par.create = True
    zorg.par.framestart = True

    knop = node(parameterexecuteDAT, "knoppen", 650, -330)
    knop.text = '''
def onPulse(par):
    if par.name == 'Herkalibreer':
        k = op('kalibratie')
        if getattr(k.par, 'Reset', None) is not None:
            k.par.Reset.pulse()

def onValueChange(par, prev):
    # een schuif of schakelaar is verzet: zorg bewaart het binnen een seconde bij deze camera
    op('zorg').store('vuil', True)
'''
    knop.par.op.expr = "me.parent()"
    knop.par.pars = "Herkalibreer Modus Keyvast Actief Keyonder Keyboven Tint Despill Dichten Randlinks Randrechts Randboven Randonder"
    knop.par.onpulse = True
    knop.par.valuechange = True
    return c
