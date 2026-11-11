"""
For_You: meting van de haper-keten in TouchDesigner. Verandert niets aan het netwerk of het beeld:
de switches blijven op 0. Het dwingt de keten van één camera twaalf keer te koken (om de drie
frames) en print per keer wat de onderdelen doen.

Draaien in de Textport:

    exec(open('/Users/for_you/ForYou/main/.claude/worktrees/zoom-haperen/show/td-qhub-test/haperen_diagnose.py').read())

Na ongeveer een seconde staat er een tabel in de Textport. Stuur die terug naar de Zoom-sessie.
"""

HAPER_DIAG_CAMERA = 3


def _haper_diag_kop():
    root = op("/project1")
    n = HAPER_DIAG_CAMERA
    vast = root.op("haper_vast_%d" % n)
    terug = root.op("haper_terug_%d" % n)
    klein = root.op("haper_klein_%d" % n)
    print("--- For_You haperen: meting camera %d ---" % n)
    print("cookRate", project.cookRate, "| absTime.frame", repr(absTime.frame), type(absTime.frame).__name__,
          "| realTime", getattr(project, "realTime", "?"))
    par = getattr(vast.par, "cross", None) or vast.par.index
    print("vast (%s): mode" % vast.type, par.mode, "| expr", repr(par.expr), "| eval", par.eval())
    print("vast ingangen:", [i.name if i is not None else None for i in vast.inputs])
    print("terug: type", terug.type, "| top", repr(terug.par.top.eval()), "| ingang", [i.name for i in terug.inputs],
          "| bypass", terug.bypass, "| lock", terug.lock)
    print("klein:", klein.width, "x", klein.height, "| lock", klein.lock, "| bypass", klein.bypass)
    for o in (klein, vast, terug):
        print(o.name, "fouten:", repr(o.errors()), "waarschuwingen:", repr(o.warnings()))
    print("frame | index | klein gekookt | vast gekookt | terug gekookt")


def _haper_diag_regel():
    root = op("/project1")
    n = HAPER_DIAG_CAMERA
    groot = root.op("haper_groot_%d" % n)
    try:
        groot.cook(force=True)
    except Exception as err:
        print("cook-fout", err)
    rij = [repr(absTime.frame), repr((getattr(root.op("haper_vast_%d" % n).par, "cross", None) or root.op("haper_vast_%d" % n).par.index).eval())]
    for naam in ("haper_klein_%d", "haper_vast_%d", "haper_terug_%d"):
        o = root.op(naam % n)
        rij.append("%s/%s" % (getattr(o, "cookAbsFrame", "?"), getattr(o, "totalCooks", "?")))
    print(" | ".join(rij))


try:
    op  # alleen binnen TouchDesigner
except NameError:
    pass
else:
    _haper_diag_kop()
    for _stap in range(12):
        run("args[0]()", _haper_diag_regel, delayFrames=1 + _stap * 3)
