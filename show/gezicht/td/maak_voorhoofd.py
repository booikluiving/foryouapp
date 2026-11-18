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
import time
import os

MAP = "/Users/for_you/ForYou/voorhoofd"
BRON = "/project1/speler_zicht_1"
VAK_URL = "http://127.0.0.1:3027/script-agent/teleprompter-parser/bord.html?vak=los"
COMP = "/project1/comp1"       # hier komt het camerabeeld met het kaartje in, op de plek van speler_zicht_1


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
    # In de show: comp1 krijgt camera 1 mét kaartje. Terug: voorhoofd_los() of comp1 weer aan speler_zicht_1.
    root = op("/project1")
    zicht = op(BRON)
    comp = op(COMP)
    plek = [i.path for i in comp.inputs].index(zicht.path) if zicht in comp.inputs else None
    sel = _maak(root, selectTOP, "voorhoofd_kaart_1", zicht.nodeX + 130, zicht.nodeY - 260)
    sel.par.top = "/project1/fy_voorhoofd/geplaatst"
    over = _maak(root, overTOP, "speler_voorhoofd_1", zicht.nodeX + 260, zicht.nodeY - 260)
    over.inputConnectors[0].connect(sel)
    over.inputConnectors[1].connect(zicht)
    if plek is None:
        if over in comp.inputs:
            print("comp1 hing al aan speler_voorhoofd_1")
            return
        raise RuntimeError("comp1 hangt niet aan speler_zicht_1; niets aangesloten")
    comp.inputConnectors[plek].connect(over)
    print("aangesloten: comp1 ingang", plek, "= speler_voorhoofd_1")


aansluiten()
