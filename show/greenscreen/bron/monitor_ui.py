# For_You regiemonitor voor perform mode (draait in het show-TD).
# Bouwt /project1/monitor als hij nog niet bestaat; wat je daarna zelf aan de layout verandert blijft staan
# (verwijder /project1/monitor om hem opnieuw te laten bouwen).
# Toont alles wat TD uitstuurt: per camera het gekeyde beeld + de teleprompter + de key-bediening,
# het Main TV-beeld (= LG), de huidige fase en status.

W, H = 1920, 1080
MARGE = 16
KOLOM = 384
KEY_PARS = "Herkalibreer Actief Keyonder Keyboven Tint Despill Dichten"
INGANG = 48  # hoogte van de regel met de DeckLink-ingang
KADER = 6  # dikte van het rode kader om de actieve camera
KOP = 30  # lettergrootte van PERFORMER 1-3
STATUS_EXPR = "'TD %d fps' % round(1 / max(absTime.stepSeconds, 1e-3))"
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

    def tegel(naam, bron, x, y, w, h, label, onder=None, groot=False):
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
        t.par.fontsizex = KOP if groot else 16
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
    status.par.text.expr = STATUS_EXPR
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
              'PERFORMER %d' % n, onder=ruit, groot=True)
        tegel('teleprompter%d' % n, '/project1/teleprompter%d' % n, x, boven + 480 + 8, KOLOM, 216,
              '')
        ui = m.create(parameterCOMP, 'key%d' % n)
        ui.par.op = '/project1/Camera%d/greenscreen' % n
        ui.par.parscope = KEY_PARS
        y = boven + 480 + 8 + 216 + 8
        ui.par.x, ui.par.y = x, H - y - (H - y - MARGE)
        ui.par.w, ui.par.h = KOLOM, H - y - MARGE

    # rechts: het hoofdscherm zoals de fase het kiest (inloop / loading / scène), staand
    rx = MARGE + 3 * (KOLOM + MARGE)
    rw = W - rx - MARGE
    rh = H - boven - MARGE
    tegel('hoofdscherm', '/project1/phase_switch_maindisplay', rx, boven, rw, rh, 'HOOFDSCHERM  (phase_switch_maindisplay)')
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


def werk_bij():
    """Brengt een bestaande monitor bij zonder de layout aan te raken: key-instellingen, statusregel, knop KEY OP LICHT."""
    m = op('/project1/monitor')
    if m is None:
        return
    for n in (1, 2, 3):
        ui = m.op('key%d' % n)
        if ui is not None and ui.par.parscope.eval() != KEY_PARS:
            ui.par.parscope = KEY_PARS
    # één kop per kolom: PERFORMER n op het camerabeeld, geen tekst meer op de teleprompter
    for n in (1, 2, 3):
        c, t = m.op('camera%d_label' % n), m.op('teleprompter%d_label' % n)
        if c is not None and str(c.par.text.eval()).startswith('CAMERA'):
            c.par.text = 'PERFORMER %d' % n
            c.par.fontsizex = KOP
        if t is not None and str(t.par.text.eval()).startswith('TELEPROMPTER'):
            t.par.text = ''
    # DeckLink-ingang per camera: onder de key-bediening, aanklikbaar (de device-parameter van videodevin1)
    for n in (1, 2, 3):
        k = m.op('key%d' % n)
        if m.op('ingang%d' % n) is None and k is not None and op('/project1/Camera%d/videodevin1' % n) is not None:
            i = m.create(parameterCOMP, 'ingang%d' % n)
            i.par.op = '/project1/Camera%d/videodevin1' % n
            i.par.parscope = 'device'
            i.par.x, i.par.y, i.par.w, i.par.h = k.par.x.eval(), k.par.y.eval(), k.par.w.eval(), INGANG
            k.par.y = k.par.y.eval() + INGANG + 4
            k.par.h = k.par.h.eval() - INGANG - 4
    # rood kader om de kolom van de camera die op het hoofdscherm staat (Camera_Switch, 0 = camera 1)
    # het kader ligt achter de panelen en steekt er net buiten uit, zodat het geen klikken opvangt
    if op('/project1/Camera_Switch') is not None:
        for n in (1, 2, 3):
            c = m.op('camera%d' % n)
            if m.op('actief%d' % n) is not None or c is None:
                continue
            onder = min([o.par.y.eval() for o in (m.op('key%d' % n), m.op('ingang%d' % n)) if o is not None] or [c.par.y.eval()])
            f = m.create(containerCOMP, 'actief%d' % n)
            f.par.x, f.par.y = c.par.x.eval() - KADER, onder - KADER
            f.par.w = c.par.w.eval() + 2 * KADER
            f.par.h = c.par.y.eval() + c.par.h.eval() - onder + 2 * KADER
            f.par.bgcolorr, f.par.bgcolorg, f.par.bgcolorb, f.par.bgalpha = 1, 0.1, 0.1, 1
            f.par.layer = -1
            f.par.display.expr = "int(op('/project1/Camera_Switch')['camera']) == %d" % (n - 1)
    # klik op het camerabeeld: wisselt tussen alleen de performer (camN) en de performer met achtergrond (videoN)
    if m.op('beeld_wissel') is None and m.op('camera1') is not None:
        pe = m.create(panelexecuteDAT, 'beeld_wissel')
        pe.par.panels = 'camera1 camera2 camera3'
        pe.par.offtoon = True
        pe.text = ("def onOffToOn(panelValue):\n"
                   "    n = panelValue.owner.name[-1]\n"
                   "    s = op('/project1/monitor/camera%s_bron' % n)\n"
                   "    los, vol = '/project1/cam' + n, '/project1/video' + n\n"
                   "    if s is not None and op(vol) is not None:\n"
                   "        s.par.top = los if s.par.top.eval() == op(vol) else vol\n"
                   "    return\n")
    st = m.op('status_tekst')
    if st is not None and 'info_rvm' in st.par.text.expr:
        st.par.text.expr = STATUS_EXPR
    # één knop voor alle camera's: meet het blauw opnieuw bij het licht van dit moment
    # TD nummert de naam bij het aanmaken (key_op_licht1), dus op het voorvoegsel zoeken
    if not m.ops('key_op_licht*'):
        b = m.create(buttonCOMP, 'key_op_licht')
        b.par.w, b.par.h = 300, 44
        b.par.x, b.par.y = MARGE + 600, H - MARGE - 50
        for naam in ('label', 'text', 'buttonlabel'):
            if hasattr(b.par, naam):
                setattr(b.par, naam, 'KEY OP LICHT')
        pe = m.create(panelexecuteDAT, 'key_op_licht_actie')
        pe.par.panels = b.name
        pe.par.offtoon = True
        pe.text = ("def onOffToOn(panelValue):\n"
                   "    for n in (1, 2, 3):\n"
                   "        g = op('/project1/Camera%d/greenscreen' % n)\n"
                   "        if g is not None and hasattr(g.par, 'Herkalibreer'):\n"
                   "            g.par.Herkalibreer.pulse()\n"
                   "    return\n")
    # naast KEY OP LICHT: het venster van het zaalscherm openen of sluiten (zelfde actie als /project1/ZAALSCHERM_VENSTER)
    k = (m.ops('key_op_licht*') or [None])[0]
    if not m.ops('zaalscherm_knop*') and k is not None and k.isPanel:
        b = m.create(buttonCOMP, 'zaalscherm_knop')
        b.par.w, b.par.h = k.par.w.eval(), k.par.h.eval()
        b.par.x, b.par.y = k.par.x.eval() - k.par.w.eval() - 10, k.par.y.eval()
        for naam in ('label', 'text', 'buttonlabel'):
            if hasattr(b.par, naam):
                setattr(b.par, naam, 'ZAALSCHERM OPEN / DICHT')
        pe = m.create(panelexecuteDAT, 'zaalscherm_actie')
        pe.par.panels = b.name
        pe.par.offtoon = True
        pe.text = ("def onOffToOn(panelValue):\n"
                   "    venster = op('/project1/window1')\n"
                   "    if venster.isOpen:\n"
                   "        venster.par.winclose.pulse()\n"
                   "        return\n"
                   "    scherm = op('/project1/auto_open_lg_window').module.kies_zaalscherm()\n"
                   "    if scherm is None:\n"
                   "        print('[zaalscherm_actie] Zaalscherm niet gevonden, venster blijft dicht.')\n"
                   "        return\n"
                   "    venster.par.monitor = scherm.index\n"
                   "    venster.par.winopen.pulse()\n"
                   "    return\n")


def ververs():
    """Vanuit de textport: exec(open(<dit bestand>).read()); ververs()"""
    werk_bij()
    b = op('/project1/monitor_bouwer')
    if b is not None:
        import os
        b.text = open(os.path.join(project.folder, 'greenscreen', 'bron', 'monitor_ui.py')).read()


def _veilig():
    import os, traceback
    d = os.path.join(project.folder, 'greenscreen', 'status')
    os.makedirs(d, exist_ok=True)
    f = os.path.join(d, 'monitor_fout.txt')
    try:
        bouw()
        werk_bij()
        venster_en_knop()
        if os.path.exists(f):
            os.remove(f)
    except Exception:
        open(f, 'w').write(traceback.format_exc())


def onStart():
    _veilig()


def onCreate():
    _veilig()
