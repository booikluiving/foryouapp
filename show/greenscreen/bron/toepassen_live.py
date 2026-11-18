# Zet de versimpelde key in het draaiende show-TD. In de textport van het show-TD:
#   exec(open('<dit bestand>').read())
# - bouwt de FY Greenscreen-component opnieuw uit fy_greenscreen.py en bewaart hem als show/greenscreen/fy_greenscreen.tox
#   (de vorige staat ernaast als fy_greenscreen-vorige.tox; terugzetten = die terugkopiëren en TD herstarten)
# - laadt hem per camera opnieuw en zet de ingestelde waarden (key onder/boven, despill, dichten, randen) terug
# - werkt de regiemonitor en de key-vensters bij (layout blijft staan)
import os, shutil
_TD = '/Users/for_you/ForYou/main/.claude/worktrees/greenscreen-53d2eb/greenscreen-lab/td'
_ASSETS = os.path.join(project.folder, 'greenscreen')
_TOX = os.path.join(_ASSETS, 'fy_greenscreen.tox')
_HOUD = "Actief Keyonder Keyboven Despill Dichten Randlinks Randrechts Randboven Randonder".split()

exec(open(os.path.join(_TD, 'fy_greenscreen.py')).read(), globals())
_MONITOR = open(os.path.join(_TD, 'monitor_ui.py')).read()
exec(_MONITOR, globals())
if op('/project1/monitor_bouwer') is not None:
    op('/project1/monitor_bouwer').text = _MONITOR

_waarden = {}
for _n in (1, 2, 3):
    _g = op('/project1/Camera%d/greenscreen' % _n)
    _waarden[_n] = {k: getattr(_g.par, k).eval() for k in _HOUD if hasattr(_g.par, k)}

shutil.copy(_TOX, os.path.join(_ASSETS, 'fy_greenscreen-vorige.tox'))
_tmp = op('/project1').create(baseCOMP, 'gs_bouw_tmp')
_c = build(_tmp, 'fy_greenscreen', _ASSETS, os.path.join(_TD, 'shaders'))
_c.op('zorg').unstore('*')
_c.save(_TOX)
_tmp.destroy()

for _n in (1, 2, 3):
    _g = op('/project1/Camera%d/greenscreen' % _n)
    _g.par.enableexternaltox = True
    _g.par.reinitnet.pulse()
    _ui = op('/project1/Camera%d/greenscreen_ui' % _n)
    if _ui is not None:
        _ui.par.parscope = "Modus Keyvast Herkalibreer Actief Keyonder Keyboven Despill Dichten Randlinks Randrechts Randboven Randonder"


def _terug(waarden=_waarden):
    for n, w in waarden.items():
        g = op('/project1/Camera%d/greenscreen' % n)
        for k, v in w.items():
            if hasattr(g.par, k):
                getattr(g.par, k).val = v
    werk_bij()
    print('key versimpeld:', [(n, op('/project1/Camera%d/greenscreen' % n).par.Modus.eval()) for n in waarden])


run(_terug, delayFrames=30)
