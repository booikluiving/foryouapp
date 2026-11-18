"""
For_You: proef plaatje op het voorhoofd (blind ranking zoals op TikTok).

Draaien in TouchDesigner (opdrachtenmap of Textport), met het showbestand open:

    exec(open('/Users/for_you/ForYou/voorhoofd/maak_voorhoofd.py').read())

Maakt /project1/fy_voorhoofd, LOS van de show: niets in de show wordt aangesloten of veranderd.
- bron: kijkt naar /project1/speler_zicht_1 (camera 1, na spiegelen en faden)
- klein: kwart resolutie, 8-bit (Vision heeft genoeg aan ± 540 breed)
- volger: FY Voorhoofd (C++ TOP, Apple Vision op een eigen thread)
- waarden: x, y, maat, hoek, volgt, gezicht, ...
- kaart -> passend -> geplaatst: het testplaatje op het voorhoofd
- uit: geplaatst over het camerabeeld (alleen om te bekijken)
Bewaart NIET. Weghalen: op('/project1/fy_voorhoofd').destroy()
"""

import glob
import os

MAP = "/Users/for_you/ForYou/voorhoofd"
BRON = "/project1/speler_zicht_1"
KAART = "/Users/for_you/ForYou/main/modules/catalog/media/environments/environment_36/fx/bowlen-16423a4438ea27a7.jpg"


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


def maak_voorhoofd():
    root = op("/project1")
    if op(BRON) is None:
        raise RuntimeError("niet gevonden: " + BRON)
    c = _maak(root, baseCOMP, "fy_voorhoofd", -1200, -1400)
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

    kaart = _maak(c, moviefileinTOP, "kaart", 0, -200)
    kaart.par.file = KAART

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

    print("fy_voorhoofd klaar (los van de show, NIET bewaard); plugin", os.path.basename(plugin))
    print("bron", op(BRON).width, "x", op(BRON).height, "klein", klein.width, "x", klein.height)
    return c


maak_voorhoofd()
