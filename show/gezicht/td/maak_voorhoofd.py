"""
For_You: proef plaatje op het voorhoofd (blind ranking zoals op TikTok).

Draaien in TouchDesigner (opdrachtenmap of Textport), met het showbestand open:

    exec(open('/Users/for_you/ForYou/voorhoofd/maak_voorhoofd.py').read())

Maakt /project1/fy_voorhoofd en sluit het aan op de drie camera's.
- bron: de camera die op het hoofdscherm staat (Camera_Switch: 0, 1, 2 = speler_zicht_1, 2, 3),
  of de nepcamera als fy_voorhoofd.fetch('nep') aan staat (zie testopstelling.py)
- klein: kwart resolutie, 8-bit (Vision heeft genoeg aan ± 540 breed)
- volger: FY Voorhoofd (C++ TOP, Apple Vision op een eigen thread)
- waarden: x, y, maat, hoek, volgt, gezicht, ...
- kaart -> passend -> geplaatst: het testplaatje op het voorhoofd
- uit: geplaatst over het camerabeeld (alleen om te bekijken)
- per camera N: speler_voorhoofd_N = kaartje (alleen zichtbaar op de camera die op het hoofdscherm staat)
  over het camerabeeld, in comp1 / comp5 / comp6 op de plek van speler_zicht_N.
Bewaart NIET. Terug: voorhoofd_los.py
"""

import glob
import time
import os

MAP = "/Users/for_you/ForYou/voorhoofd"
BRON = "/project1/voorhoofd_volgbron"
CAMERAS = {1: "comp1", 2: "comp5", 3: "comp6"}
NEP = "/Users/for_you/ForYou/voorhoofd/test/nepcamera.mp4"
NEP_AAN = "op('/project1/fy_voorhoofd').fetch('nep', 0)"
ACTIEF = "int(min(2, max(0, op('/project1/Camera_Switch')['camera'])))"
VAK_URL = "http://127.0.0.1:3027/script-agent/teleprompter-parser/bord.html?vak=los"


def _nieuwste_plugin():
    versies = sorted(glob.glob(os.path.join(MAP, "plugins", "versies", "FYVoorhoofd-*.plugin")))
    if not versies:
        raise RuntimeError("geen plugin in " + MAP)
    return versies[-1]


def _maak(ouder, soort, naam, x, y):
    o = ouder.op(naam)
    if o is None:
        o = ouder.create(soort, naam)
    o.nodeX, o.nodeY = x, y
    return o


def _soort(ouder, soort, naam, x, y):
    o = ouder.op(naam)
    if o is not None and o.OPType != soort.__name__:
        o.destroy()
    return _maak(ouder, soort, naam, x, y)


def bronnen():
    # Per camera N: voorhoofd_bron_N = speler_zicht_N, of in de test de nepcamera op de camera die op het
    # hoofdscherm staat. voorhoofd_volgbron = de bron van de camera op het hoofdscherm (Camera_Switch).
    root = op("/project1")
    z1 = op("/project1/speler_zicht_1")
    nep = _maak(root, moviefileinTOP, "voorhoofd_nepcamera_1", z1.nodeX, z1.nodeY - 400)
    nep.par.file = NEP
    vb = _soort(root, switchTOP, "voorhoofd_volgbron", z1.nodeX + 400, z1.nodeY - 400)
    for n in (1, 2, 3):
        z = op("/project1/speler_zicht_%d" % n)
        b = _soort(root, switchTOP, "voorhoofd_bron_%d" % n, z.nodeX + 130, z.nodeY - 400)
        b.inputConnectors[0].connect(z)
        b.inputConnectors[1].connect(nep)
        b.par.index.expr = "1 if (%s and %s == %d) else 0" % (NEP_AAN, ACTIEF, n - 1)
        vb.inputConnectors[n - 1].connect(b)
    vb.par.index.expr = ACTIEF


def maak_voorhoofd():
    root = op("/project1")
    c = _maak(root, baseCOMP, "fy_voorhoofd", -1200, -1400)
    bronnen()
    c.color = (0.9, 0.75, 0.1)

    bron = _maak(c, selectTOP, "bron", 0, 0)
    bron.par.top = BRON

    klein = _maak(c, resolutionTOP, "klein", 150, 0)
    klein.inputConnectors[0].connect(bron)
    klein.par.outputresolution = "quarter"
    klein.par.format = "rgba8fixed"

    volger = c.op("volger")
    plugin = _nieuwste_plugin()
    if volger is None:
        volger = c.create(cplusplusTOP, "volger")
    volger.nodeX, volger.nodeY = 300, 0
    if volger.par.plugin.eval() != plugin:
        volger.par.plugin = plugin
    volger.inputConnectors[0].connect(klein)

    info = _maak(c, infoCHOP, "waarden", 450, 0)
    info.par.op = volger

    oud = c.op("kaart")
    if oud is not None and oud.OPType != "webrenderTOP":
        oud.destroy()
    kaart = _maak(c, webrenderTOP, "kaart", 0, -200)
    kaart.par.url = VAK_URL + "&t=%d" % int(time.time())
    kaart.par.active = True
    kaart.par.transparent = True
    kaart.par.audio = "off"
    kaart.par.alwayscook = True
    kaart.par.maxrenderrate = 30
    kaart.par.outputresolution = "custom"
    kaart.par.resolutionw = 640
    kaart.par.resolutionh = 640

    passend = _maak(c, fitTOP, "passend", 150, -200)
    passend.inputConnectors[0].connect(kaart)
    passend.par.fit = "fitbest"
    passend.par.outputresolution = "custom"
    passend.par.resolutionw.expr = "op('bron').width"
    passend.par.resolutionh.expr = "op('bron').height"

    geplaatst = _maak(c, transformTOP, "geplaatst", 300, -200)
    geplaatst.inputConnectors[0].connect(passend)
    geplaatst.par.extend = "zero"
    geplaatst.par.sx.expr = "op('waarden')['maat']"
    geplaatst.par.sy.expr = "op('waarden')['maat']"
    geplaatst.par.rotate.expr = "op('waarden')['hoek']"
    geplaatst.par.tx.expr = "op('waarden')['x'] - 0.5"
    geplaatst.par.ty.expr = "op('waarden')['y'] - 0.5"

    uit = _maak(c, overTOP, "uit", 450, -200)
    uit.inputConnectors[0].connect(geplaatst)
    uit.inputConnectors[1].connect(bron)

    print("fy_voorhoofd klaar (NIET bewaard); plugin", os.path.basename(plugin))
    print("bron", op(BRON).width, "x", op(BRON).height, "klein", klein.width, "x", klein.height)
    return c


maak_voorhoofd()


POMP_TEKST = """def onFrameStart(frame):
    op('volger').cook(force=True)
    # Plek van het voorhoofd naar het bord op het zaalscherm (vliegt vandaar naar zijn plek).
    if frame % 3 == 0:
        w = op('waarden')
        z = op('/project1/audience_tussen_web')
        if z is not None and z.par.active.eval():
            js = "var f=document.getElementById('bord');if(f&&f.contentWindow)f.contentWindow.postMessage({voorhoofd:{x:%.4f,y:%.4f,maat:%.4f,hoek:%.2f,volgt:%.2f}},'*');" % (
                w['x'].eval(), w['y'].eval(), w['maat'].eval(), w['hoek'].eval(), w['volgt'].eval())
            z.executeJavaScript(js)
    return
"""


def _pomp():
    # De volger moet elk beeld rekenen, ook als niemand naar fy_voorhoofd kijkt.
    c = op("/project1/fy_voorhoofd")
    p = c.op("pomp")
    if p is None:
        p = c.create(executeDAT, "pomp")
    p.nodeX, p.nodeY = 300, 200
    p.text = POMP_TEKST
    p.par.framestart = True
    p.par.active = True


_pomp()


def aansluiten():
    # Per camera: compN krijgt het camerabeeld met het kaartje (alleen zichtbaar op de camera op het hoofdscherm).
    root = op("/project1")
    sel = _maak(root, selectTOP, "voorhoofd_geplaatst", -1200, -1700)
    sel.par.top = "/project1/fy_voorhoofd/geplaatst"
    for n, comp_naam in CAMERAS.items():
        zicht = op("/project1/speler_zicht_%d" % n)
        achter = op("/project1/voorhoofd_bron_%d" % n)
        comp = op("/project1/" + comp_naam)
        kaart = _soort(root, levelTOP, "voorhoofd_kaart_%d" % n, zicht.nodeX + 130, zicht.nodeY - 260)
        kaart.inputConnectors[0].connect(sel)
        kaart.par.opacity.expr = "1 if %s == %d else 0" % (ACTIEF, n - 1)
        over = _maak(root, overTOP, "speler_voorhoofd_%d" % n, zicht.nodeX + 260, zicht.nodeY - 260)
        over.inputConnectors[0].connect(kaart)
        over.inputConnectors[1].connect(achter)
        namen = [i.name for i in comp.inputs]
        if over.name in namen:
            print(comp_naam, "hing al aan", over.name)
        elif zicht.name in namen:
            comp.inputConnectors[namen.index(zicht.name)].connect(over)
            print("aangesloten:", comp_naam, "=", over.name)
        else:
            print("LET OP:", comp_naam, "hangt niet aan", zicht.name, "; niet aangesloten", namen)


aansluiten()
