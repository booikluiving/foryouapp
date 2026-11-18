"""
For_You: het kaartje op het voorhoofd testen zonder dat er iemand voor de camera staat.

    exec(open('/Users/for_you/ForYou/voorhoofd/testopstelling.py').read())
    test(True)    # nepcamera (video met gezichten) als camera 1, volger kijkt daarnaar, opname van het hoofdscherm
    test(False)   # terug naar de echte camera's, opname stopt

Werkt met wat maak_voorhoofd.py neerzet (voorhoofd_bron_1 / voorhoofd_volgbron volgen fy_voorhoofd.fetch('nep')).
Opname: fy_voorhoofd/opname (Movie File Out van extra_shot_switch, alleen beeld) naar
~/ForYou/voorhoofd/test/opname.mov. Alleen voor deze test, niet de run-registratie; weggooien na bekijken.
"""

OPNAME = "/Users/for_you/ForYou/voorhoofd/test/opname.mov"


def opstelling():
    c = op("/project1/fy_voorhoofd")
    beeld = c.op("opname_beeld") or c.create(selectTOP, "opname_beeld")
    beeld.nodeX, beeld.nodeY = 600, -400
    beeld.par.top = "/project1/extra_shot_switch"
    uit = c.op("opname") or c.create(moviefileoutTOP, "opname")
    uit.nodeX, uit.nodeY = 750, -400
    uit.inputConnectors[0].connect(beeld)
    uit.par.file = OPNAME
    return c, uit


def test(aan):
    c, uit = opstelling()
    nep = op("/project1/voorhoofd_nepcamera_1")
    if aan:
        nep.par.cuepulse.pulse()
        nep.par.play = True
        c.store("nep", 1)
        uit.par.record = True
        print("test aan: nepcamera als camera 1, opname loopt")
    else:
        uit.par.record = False
        c.store("nep", 0)
        nep.par.play = False
        print("test uit: echte camera's, opname gestopt")
