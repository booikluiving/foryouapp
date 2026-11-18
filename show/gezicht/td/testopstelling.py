"""
For_You: testen van het kaartje op het voorhoofd zonder dat er iemand voor camera 1 staat.

    exec(open('/Users/for_you/ForYou/voorhoofd/testopstelling.py').read())
    test(True)    # nepcamera (video met een gezicht) in plaats van camera 1, opname van het hoofdscherm
    test(False)   # terug naar camera 1, opname stopt

- voorhoofd_bron_1 (Switch): 0 = speler_zicht_1 (camera 1), 1 = voorhoofd_nepcamera_1 (video)
  fy_voorhoofd/bron en speler_voorhoofd_1 kijken naar deze switch.
- fy_voorhoofd/opname (Movie File Out): extra_shot_switch (het hoofdscherm), alleen beeld,
  naar ~/ForYou/voorhoofd/test/opname.mov. Alleen voor deze test; niet de run-registratie.
Bewaart NIET.
"""

NEP = "/Users/for_you/ForYou/voorhoofd/test/nepcamera.mp4"
OPNAME = "/Users/for_you/ForYou/voorhoofd/test/opname.mov"


def _maak(ouder, soort, naam, x, y):
    o = ouder.op(naam)
    if o is None:
        o = ouder.create(soort, naam)
        o.nodeX, o.nodeY = x, y
    return o


def opstelling():
    root = op("/project1")
    zicht = op("/project1/speler_zicht_1")
    nep = _maak(root, moviefileinTOP, "voorhoofd_nepcamera_1", zicht.nodeX, zicht.nodeY - 400)
    nep.par.file = NEP
    sw = _maak(root, switchTOP, "voorhoofd_bron_1", zicht.nodeX + 130, zicht.nodeY - 400)
    sw.inputConnectors[0].connect(zicht)
    sw.inputConnectors[1].connect(nep)
    op("/project1/fy_voorhoofd/bron").par.top = sw.path
    op("/project1/speler_voorhoofd_1").inputConnectors[1].connect(sw)
    c = op("/project1/fy_voorhoofd")
    beeld = _maak(c, selectTOP, "opname_beeld", 600, -400)
    beeld.par.top = "/project1/extra_shot_switch"
    uit = _maak(c, moviefileoutTOP, "opname", 750, -400)
    uit.inputConnectors[0].connect(beeld)
    uit.par.file = OPNAME
    uit.par.record = False
    return sw, uit


def test(aan):
    sw, uit = opstelling()
    if aan:
        nep = op("/project1/voorhoofd_nepcamera_1")
        nep.par.cuepulse.pulse()
        nep.par.play = True
        sw.par.index = 1
        uit.par.record = True
        print("test aan: nepcamera, opname loopt")
    else:
        uit.par.record = False
        sw.par.index = 0
        op("/project1/voorhoofd_nepcamera_1").par.play = False
        print("test uit: camera 1, opname gestopt")
