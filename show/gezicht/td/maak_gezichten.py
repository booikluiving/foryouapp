"""
For_You: ondertitel uit de gezichten. Draaien in TouchDesigner (opdrachtenmap of Textport), met het showbestand open:

    exec(open('/Users/for_you/ForYou/main/show/gezicht/td/maak_gezichten.py').read())

Maakt /project1/fy_gezichten:
- bron: /project1/bord_keuze, het hoofdscherm zonder de weblaag (1080x1920, zelfde vlak als de ondertitel)
- klein: 270x480, 8-bit (Vision heeft daar genoeg aan)
- volger: FY Gezichten (C++ TOP, Apple Vision op een eigen thread, kijkt om de Interval, standaard 0,2 s)
- waarden: aantal, vision_ms, verwerkt, leeftijd_s, x1 y1 b1 h1 ... x4 y4 b4 h4
- pomp: stuurt 5x per seconde de kaders naar de ondertitel (iframe 'ondertitel' in audience_tussen_web)
Aan/uit: op('/project1/fy_gezichten/volger').par.Active. Uit = de ondertitel staat na 1 s weer op zijn gewone plek.
Bewaart NIET. Terug: gezichten_los.py
"""

import glob
import os

PLUGINS = "/Users/for_you/ForYou/voorhoofd/plugins/versies"
BRON = "/project1/bord_keuze"
WEB = "/project1/audience_tussen_web"


def _nieuwste_plugin():
    versies = sorted(glob.glob(os.path.join(PLUGINS, "FYGezichten-*.plugin")))
    if not versies:
        raise RuntimeError("geen FYGezichten-plugin in " + PLUGINS + " (bouw: show/gezicht/bron/build-gezichten.sh)")
    return versies[-1]


def _maak(ouder, soort, naam, x, y):
    o = ouder.op(naam)
    if o is not None and o.OPType != soort.__name__:
        o.destroy()
        o = None
    if o is None:
        o = ouder.create(soort, naam)
    o.nodeX, o.nodeY = x, y
    return o


POMP_TEKST = """def onFrameStart(frame):
    v = op('volger')
    v.cook(force=True)
    if frame %% 10:
        return
    z = op('%s')
    if z is None or not z.par.active.eval():
        return
    w = op('waarden')
    kaders = []
    if v.par.Active.eval() and w['leeftijd_s'] is not None and w['leeftijd_s'].eval() < 1:
        for k in range(1, int(w['aantal'].eval()) + 1):
            kaders.append('{x:%%.4f,y:%%.4f,b:%%.4f,h:%%.4f}' %% (w['x%%d' %% k].eval(), w['y%%d' %% k].eval(), w['b%%d' %% k].eval(), w['h%%d' %% k].eval()))
    js = "var f=document.getElementById('ondertitel');if(f&&f.contentWindow)f.contentWindow.postMessage({type:'fy-gezichten',kaders:[" + ','.join(kaders) + "]},'*');"
    z.executeJavaScript(js)
    return
""" % WEB


def maak_gezichten():
    root = op("/project1")
    c = _maak(root, baseCOMP, "fy_gezichten", -1200, -1600)
    c.color = (0.2, 0.7, 0.9)

    bron = _maak(c, selectTOP, "bron", 0, 0)
    bron.par.top = BRON

    klein = _maak(c, resolutionTOP, "klein", 150, 0)
    klein.inputConnectors[0].connect(bron)
    klein.par.outputresolution = "custom"
    klein.par.resolutionw = 270
    klein.par.resolutionh = 480
    klein.par.format = "rgba8fixed"

    plugin = _nieuwste_plugin()
    volger = _maak(c, cplusplusTOP, "volger", 300, 0)
    if volger.par.plugin.eval() != plugin:
        volger.par.plugin = plugin
    volger.inputConnectors[0].connect(klein)

    info = _maak(c, infoCHOP, "waarden", 450, 0)
    info.par.op = volger

    pomp = _maak(c, executeDAT, "pomp", 300, 200)
    pomp.text = POMP_TEKST
    pomp.par.framestart = True
    pomp.par.active = True

    print("fy_gezichten klaar (NIET bewaard); plugin", os.path.basename(plugin), "bron", BRON, op(BRON).width, "x", op(BRON).height)
    return c


maak_gezichten()
