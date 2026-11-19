# Zet de bijgewerkte key in het draaiende show-TD. In de textport, of als opdracht in ~/ForYou/td-opdrachten/in:
#   exec(open(project.folder + '/greenscreen/bron/toepassen_live.py').read())
# (testen vanuit een andere map: zet eerst FY_KEY_BRON = '<map met deze bestanden>')
# - bouwt de FY Greenscreen-component opnieuw uit fy_greenscreen.py en bewaart hem als show/greenscreen/fy_greenscreen.tox
#   (de vorige staat ernaast als fy_greenscreen-vorige.tox; terugzetten = die terugkopiëren en TD herstarten)
# - laadt hem per camera opnieuw; wat met de hand anders stond dan de oude standaard blijft staan
# - werkt de regiemonitor en de key-vensters bij (layout blijft staan)
# Het TD-project zelf wordt niet bewaard.
import os, shutil
_TD = globals().get('FY_KEY_BRON') or os.path.join(project.folder, 'greenscreen', 'bron')
_ASSETS = os.path.join(project.folder, 'greenscreen')
_TOX = os.path.join(_ASSETS, 'fy_greenscreen.tox')
_HOUD = "Modus Keyvast Actief Keyonder Keyboven Tint Despill Dichten Randlinks Randrechts Randboven Randonder".split()
_PLUGIN = os.path.join(_ASSETS, 'plugins', 'FYWandKey.plugin')
if not os.path.exists(_PLUGIN):
    raise RuntimeError('FYWandKey.plugin ontbreekt in ' + os.path.dirname(_PLUGIN) + ' (bouwen: greenscreen/bron/plugins/build.sh)')

exec(open(os.path.join(_TD, 'fy_greenscreen.py')).read(), globals())
_MONITOR = open(os.path.join(_TD, 'monitor_ui.py')).read()
exec(_MONITOR, globals())
if op('/project1/monitor_bouwer') is not None:
    op('/project1/monitor_bouwer').text = _MONITOR

# alleen wat de operator zelf verzet heeft gaat mee; wat nog op de standaard stond krijgt de nieuwe standaard
_waarden = {}
for _n in (1, 2, 3):
    _g = op('/project1/Camera%d/greenscreen' % _n)
    _waarden[_n] = {k: getattr(_g.par, k).eval() for k in _HOUD
                    if hasattr(_g.par, k) and getattr(_g.par, k).eval() != getattr(_g.par, k).default}

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
        _ui.par.parscope = "Modus Keyvast Wandleren Actief Keyonder Keyboven Tint Despill Dichten Randlinks Randrechts Randboven Randonder"


def _terug(waarden=_waarden):
    for n, w in waarden.items():
        g = op('/project1/Camera%d/greenscreen' % n)
        for k, v in w.items():
            if hasattr(g.par, k):
                getattr(g.par, k).val = v
    werk_bij()
    print('key bijgewerkt:', [(n, op('/project1/Camera%d/greenscreen' % n).par.Keyonder.eval(), w) for n, w in waarden.items()])


run(_terug, delayFrames=30)
