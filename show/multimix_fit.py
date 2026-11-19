# Houdt de Pre Fit van de teleprompter-multiMixen goed (Execute DAT /project1/multimix_fit in het show-TD).
# multiMix rekent de fit één keer uit, met de resolutie die de bron op dat moment heeft. Bij het opstarten
# heeft de bron nog niet zijn echte resolutie, en daarna rekent multiMix niet opnieuw. Dit DAT kijkt elke
# seconde of de resolutie van een laagbron veranderd is en laat multiMix de fit dan opnieuw uitrekenen
# (hetzelfde als Pre Fit heen en weer zetten).
#
# Installeren, één keer, in de textport van het show-TD:
#   exec(open(project.folder + '/multimix_fit.py').read()); installeer()

MIXEN = ('multiMix5', 'multiMix6', 'multiMix7')


def _herbereken(alles=False):
    gezien = me.fetch('gezien', {}) if not alles else {}
    for naam in MIXEN:
        m = op('/project1/' + naam)
        if m is None:
            continue
        for laag in range(int(m.par.Numberlayers.eval())):
            bron = m.op('mix/layer%d/Layersource' % laag)
            par = getattr(m.par, 'Prefit%d' % laag, None)
            if bron is None or par is None:
                continue
            sleutel = '%s/%d' % (naam, laag)
            nu = (bron.width, bron.height, par.eval(), m.par.Resolutionw.eval(), m.par.Resolutionh.eval())
            if gezien.get(sleutel) != nu:
                try:
                    m.ext.multiMix.Prefit(par, par.eval(), par.eval())
                    gezien[sleutel] = nu
                except Exception:
                    pass  # extensie nog niet klaar: volgende seconde opnieuw
    me.store('gezien', gezien)


def onStart():
    me.store('gezien', {})


def onCreate():
    me.store('gezien', {})


def onFrameStart(frame):
    if frame % 50 == 0:
        _herbereken()


def installeer():
    p = op('/project1')
    d = p.op('multimix_fit')
    if d is None:
        d = p.create(executeDAT, 'multimix_fit')
        m = p.op('multiMix6')
        d.nodeX, d.nodeY = m.nodeX + 300, m.nodeY
        d.color = (0.1, 0.35, 0.8)
    d.text = open(project.folder + '/multimix_fit.py').read()
    d.par.active = True
    d.par.start = True
    d.par.create = True
    d.par.framestart = True
    d.store('gezien', {})
    return d
