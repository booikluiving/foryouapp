# For_You regiemonitor voor perform mode (draait in het show-TD).
# Bouwt /project1/monitor als hij nog niet bestaat; wat je daarna zelf aan de layout verandert blijft staan
# (verwijder /project1/monitor om hem opnieuw te laten bouwen).
# Toont alles wat TD uitstuurt: per camera het gekeyde beeld + de teleprompter + de key-bediening,
# het Main TV-beeld (= LG), de huidige fase en status.

W, H = 1920, 1080
MARGE = 16
KOLOM = 384
KEY_PARS = "Modus Keyvast Herkalibreer Actief Keyonder Keyboven Tint Despill Aifill Dichten"
FASE_EXPR = ("'FASE   ' + {0: 'INLOOP', 1: 'LOADING', 2: 'SCÈNE'}.get(int(op('/project1/phase_value')['phase'].eval()), '?') "
             "if op('/project1/phase_value') else 'FASE   ?'")


def bouw():
    p = op('/project1')
    if p.op('monitor') is not None:
        return p.op('monitor')
    m = p.create(containerCOMP, 'monitor')
    m.nodeX, m.nodeY = -1200, -1600
    m.par.w, m.par.h = W, H
    m.par.display = False  # niet over de oude /project1-weergave heen tekenen; de monitor heeft een eigen venster
    m.color = (0.1, 0.35, 0.8)

    achter = m.create(constantTOP, 'achtergrond')
    achter.par.colorr, achter.par.colorg, achter.par.colorb = 0.07, 0.07, 0.08
    achter.par.outputresolution = 'custom'
    achter.par.resolutionw, achter.par.resolutionh = W, H
    # let op: TOP-verwijzingen van een COMP lossen hier niet relatief op; altijd absolute paden gebruiken
    m.par.top = m.path + '/achtergrond'
    ruit = m.create(constantTOP, 'grijs')  # neutraal grijs onder het gekeyde beeld
    ruit.par.colorr = ruit.par.colorg = ruit.par.colorb = 0.32
    ruit.par.outputresolution = 'custom'
    ruit.par.resolutionw, ruit.par.resolutionh = 16, 16

    def tegel(naam, bron, x, y, w, h, label, onder=None):
        """Paneel met een TOP, passend geschaald, met een label. x/y vanaf linksboven."""
        sel = m.create(selectTOP, naam + '_bron')
        sel.par.top = bron
        fit = m.create(fitTOP, naam + '_fit')
        fit.inputConnectors[0].connect(sel)
        fit.par.outputresolution = 'custom'
        fit.par.resolutionw, fit.par.resolutionh = w, h
        fit.par.fit = 'fitbest'
        laatste = fit
        if onder is not None:
            o = m.create(overTOP, naam + '_over')
            o.inputConnectors[0].connect(fit)
            o.inputConnectors[1].connect(onder)
            o.par.outputresolution = 'custom'
            o.par.resolutionw, o.par.resolutionh = w, h
            laatste = o
        t = m.create(textTOP, naam + '_label')
        t.par.text = label
        t.par.outputresolution = 'custom'
        t.par.resolutionw, t.par.resolutionh = w, h
        t.par.alignx, t.par.aligny = 'left', 'top'
        t.par.fontsizex = 16
        t.par.positionx, t.par.positiony = 8, -6
        t.par.bgalpha = 0
        samen = m.create(overTOP, naam + '_beeld')
        samen.inputConnectors[0].connect(t)
        samen.inputConnectors[1].connect(laatste)
        paneel = m.create(containerCOMP, naam)
        paneel.par.x, paneel.par.y = x, H - y - h
        paneel.par.w, paneel.par.h = w, h
        paneel.par.top = samen.path
        return paneel

    # bovenbalk: fase + status
    fase = m.create(textTOP, 'fase_tekst')
    fase.par.text.expr = FASE_EXPR
    fase.par.outputresolution = 'custom'
    fase.par.resolutionw, fase.par.resolutionh = 900, 56
    fase.par.alignx, fase.par.aligny = 'left', 'center'
    fase.par.fontsizex = 34
    fase.par.positionx = 12
    fase.par.bgalpha = 0
    fp = m.create(containerCOMP, 'fase')
    fp.par.x, fp.par.y, fp.par.w, fp.par.h = MARGE, H - MARGE - 56, 900, 56
    fp.par.top = fase.path

    status = m.create(textTOP, 'status_tekst')
    # geen generator-expressies in parameter-expressies: daarin is op() niet zichtbaar
    status.par.text.expr = (
        "'TD %d fps     RVM  cam1 %d ms   cam2 %d ms   cam3 %d ms' % (round(1 / max(absTime.stepSeconds, 1e-3)), "
        "op('/project1/Camera1/greenscreen/info_rvm')['infer_ms'], op('/project1/Camera2/greenscreen/info_rvm')['infer_ms'], "
        "op('/project1/Camera3/greenscreen/info_rvm')['infer_ms'])")
    status.par.outputresolution = 'custom'
    status.par.resolutionw, status.par.resolutionh = 960, 56
    status.par.alignx, status.par.aligny = 'right', 'center'
    status.par.fontsizex = 18
    status.par.positionx = -12
    status.par.bgalpha = 0
    sp = m.create(containerCOMP, 'status')
    sp.par.x, sp.par.y, sp.par.w, sp.par.h = W - MARGE - 960, H - MARGE - 56, 960, 56
    sp.par.top = status.path

    # per camera: gekeyd beeld, teleprompter, key-bediening
    boven = MARGE + 56 + MARGE
    for i, n in enumerate((1, 2, 3)):
        x = MARGE + i * (KOLOM + MARGE)
        tegel('camera%d' % n, '/project1/cam%d' % n, x, boven, KOLOM, 480,
              'CAMERA %d  gekeyd' % n, onder=ruit)
        tegel('teleprompter%d' % n, '/project1/teleprompter%d' % n, x, boven + 480 + 8, KOLOM, 216,
              'TELEPROMPTER %d  → SDI' % n)
        ui = m.create(parameterCOMP, 'key%d' % n)
        ui.par.op = '/project1/Camera%d/greenscreen' % n
        ui.par.parscope = KEY_PARS
        y = boven + 480 + 8 + 216 + 8
        ui.par.x, ui.par.y = x, H - y - (H - y - MARGE)
        ui.par.w, ui.par.h = KOLOM, H - y - MARGE

    # rechts: Main TV (= LG) groot
    rx = MARGE + 3 * (KOLOM + MARGE)
    rw = W - rx - MARGE
    tegel('main_tv', '/project1/Main_TV', rx, boven, rw, int(rw * 9 / 16), 'MAIN TV / LG  → SDI 4K + LG')
    return m


def venster_en_knop():
    p = op('/project1')
    # eigen venster op de tweede regiemonitor (niet de LG: TD-monitor 0 is hier de LG)
    w = p.op('monitor_venster')
    if w is None:
        w = p.create(windowCOMP, 'monitor_venster')
        w.nodeX, w.nodeY = -1000, -1600
        w.par.winop = '/project1/monitor'
        w.par.title = 'For_You regiemonitor'
        w.par.borders = True
        w.par.winw, w.par.winh = W, H
        doel = None
        for i, mon in enumerate(monitors):
            if not mon.isPrimary and mon.width < 3000:
                doel = i
        if doel is None:
            for i, mon in enumerate(monitors):
                if mon.isPrimary:
                    doel = i
        if doel is not None:
            w.par.monitor = doel
        w.par.justifyh, w.par.justifyv = 'center', 'center'
    # knop in het netwerk van /project1 om het venster te openen
    if p.op('OPEN_REGIEMONITOR') is None:
        b = p.create(buttonCOMP, 'OPEN_REGIEMONITOR')
        b.nodeX, b.nodeY = -1000, -1450
        b.par.w, b.par.h = 220, 60
        b.par.display = False
        b.viewer = True
        for naam in ('label', 'text', 'buttonlabel'):
            if hasattr(b.par, naam):
                setattr(b.par, naam, 'OPEN REGIEMONITOR')
        pe = p.create(panelexecuteDAT, 'open_regiemonitor')
        pe.nodeX, pe.nodeY = -800, -1450
        pe.par.panels = b.name
        pe.par.offtoon = True
        pe.text = "def onOffToOn(panelValue):\n    op('/project1/monitor_venster').par.winopen.pulse()\n    return\n"
    run("op('/project1/monitor_venster').par.winopen.pulse()", delayFrames=60)


def _veilig():
    import os, traceback
    d = os.path.join(project.folder, 'greenscreen', 'status')
    os.makedirs(d, exist_ok=True)
    f = os.path.join(d, 'monitor_fout.txt')
    try:
        bouw()
        venster_en_knop()
        if os.path.exists(f):
            os.remove(f)
    except Exception:
        open(f, 'w').write(traceback.format_exc())


def onStart():
    _veilig()


def onCreate():
    _veilig()
