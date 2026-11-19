# Swipe-overgang op het hoofdscherm bij een fasewissel (inloop / loading / scène), zoals omhoog swipen in Reels of TikTok:
# het oude beeld schuift omhoog weg, het nieuwe komt van onderen binnen.
#
# Hoe het werkt: phase_switch_maindisplay krijgt een vierde ingang (de swipe). Tijdens de overgang toont hij die,
# daarna weer gewoon de fase. De fase komt nog steeds uit phase_value; alleen de export naar deze switch staat uit,
# zijn index is nu een expressie.
#
# In de textport van het show-TD:
#   exec(open(project.folder + '/fase_swipe.py').read()); installeer()
# Terug naar de harde wissel:
#   exec(open(project.folder + '/fase_swipe.py').read()); verwijder()
# Duur aanpassen: op('/project1/fase_swipe_waarden').par.const3value = 0.8

DUUR = 0.65  # seconden
SWITCH = 'phase_switch_maindisplay'
INGANGEN = ('Inloop', 'Loading', 'Scene')
NIEUW = ('fase_swipe_waarden', 'fase_swipe_oud', 'fase_swipe_nieuw', 'fase_swipe_oud_t', 'fase_swipe_nieuw_t',
         'fase_swipe_beeld', 'fase_swipe', 'fase_swipe_start')

W = "op('/project1/fase_swipe_waarden')"
# voortgang 0..1 met ease-out (snel weg, zacht landen)
P = "(1 - (1 - min(1, max(0, (absTime.seconds - %s['start']) / max(%s['duur'], 0.01)))) ** 3)" % (W, W)
BEZIG = "(0 <= absTime.seconds - %s['start'] < %s['duur'])" % (W, W)

UITVOER = '''# Fasewissel -> swipe op het hoofdscherm (zie show/fase_swipe.py)
def onValueChange(channel, sampleIndex, val, prev):
    oud, nieuw = int(round(prev)), int(round(val))
    if oud == nieuw or not (0 <= oud <= 2 and 0 <= nieuw <= 2):
        return
    w = op('/project1/fase_swipe_waarden')
    w.par.const0value = oud
    w.par.const1value = nieuw
    w.par.const2value = absTime.seconds
    return
'''


def _export(aan):
    t = op('/project1/phase_value_export')
    if t is None:
        return
    kop = [c.val for c in t.row(0)]
    if 'path' not in kop or 'enable' not in kop:
        return
    for r in range(1, t.numRows):
        if t[r, 'path'].val == SWITCH:
            t[r, 'enable'] = 1 if aan else 0


def installeer():
    p = op('/project1')
    s = p.op(SWITCH)
    if s is None or any(p.op(n) is None for n in INGANGEN):
        raise Exception('phase_switch_maindisplay of zijn ingangen ontbreken')
    verwijder(stil=True)
    x, y = s.nodeX, s.nodeY - 1400

    w = p.create(constantCHOP, 'fase_swipe_waarden')
    for i, (naam, waarde) in enumerate((('oud', 0), ('nieuw', 0), ('start', -1000), ('duur', DUUR))):
        setattr(w.par, 'const%dname' % i, naam)
        setattr(w.par, 'const%dvalue' % i, waarde)
    w.nodeX, w.nodeY = x - 1200, y

    def kies(naam, kanaal, dx):
        k = p.create(switchTOP, naam)
        for n in INGANGEN:
            p.op(n).outputConnectors[0].connect(k)
        k.par.index.expr = "int(%s['%s'])" % (W, kanaal)
        k.nodeX, k.nodeY = x + dx, y
        return k

    def schuif(naam, bron, ty, dx):
        t = p.create(transformTOP, naam)
        t.inputConnectors[0].connect(bron)
        if hasattr(t.par, 'tunit'):
            t.par.tunit = 'fraction'
        if hasattr(t.par, 'extend'):
            t.par.extend = 'zero'
        t.par.ty.expr = ty
        t.nodeX, t.nodeY = x + dx, y - 300
        return t

    oud = kies('fase_swipe_oud', 'oud', -800)
    nieuw = kies('fase_swipe_nieuw', 'nieuw', -400)
    oud_t = schuif('fase_swipe_oud_t', oud, P, -800)            # schuift omhoog weg
    nieuw_t = schuif('fase_swipe_nieuw_t', nieuw, P + ' - 1', -400)  # komt van onderen
    beeld = p.create(overTOP, 'fase_swipe_beeld')
    beeld.inputConnectors[0].connect(nieuw_t)
    beeld.inputConnectors[1].connect(oud_t)
    beeld.nodeX, beeld.nodeY = x, y - 300

    d = p.create(chopexecuteDAT, 'fase_swipe')
    d.text = UITVOER
    d.par.chop = '/project1/phase_value'
    d.par.channel = 'phase'
    d.par.valuechange = True
    for naam in ('offtoon', 'ontooff', 'whileon', 'whileoff'):
        if hasattr(d.par, naam):
            setattr(d.par, naam, False)
    d.par.active = True
    d.nodeX, d.nodeY = x - 1200, y - 300
    d.color = w.color = (0.5, 0.05, 0.5)
    # na het openen van het bestand: geen halve swipe van de vorige sessie
    e = p.create(executeDAT, 'fase_swipe_start')
    e.text = "def onStart():\n    op('/project1/fase_swipe_waarden').par.const2value = -1000\n    return\n"
    e.par.active = True
    e.par.start = True
    e.nodeX, e.nodeY = x - 1200, y - 600
    e.color = w.color

    # vierde ingang van de hoofdscherm-switch = de swipe
    _export(False)
    beeld.outputConnectors[0].connect(s)
    s.par.index.expr = "3 if %s else int(op('/project1/phase_value')['phase'])" % BEZIG
    s.par.index.mode = ParMode.EXPRESSION
    print('fase_swipe geinstalleerd: %d ingangen op %s, duur %.2f s' % (len(s.inputs), SWITCH, DUUR))
    return beeld


def verwijder(stil=False):
    p = op('/project1')
    s = p.op(SWITCH)
    for n in NIEUW:
        o = p.op(n)
        if o is not None:
            o.destroy()
    if s is not None:
        for _ in range(4):
            if len(s.inputs) <= len(INGANGEN):
                break
            s.inputConnectors[len(s.inputs) - 1].disconnect()
        if 'fase_swipe' in (s.par.index.expr or ''):
            s.par.index.expr = "int(op('/project1/phase_value')['phase'])"
    _export(True)
    if not stil:
        print('fase_swipe verwijderd, harde wissel terug')
