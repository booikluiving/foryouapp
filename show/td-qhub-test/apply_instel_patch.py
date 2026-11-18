"""
For_You: instelbeeld op de teleprompters in de inloop (cue td.instel) in het show-TD.

Wens Booi (18 nov 2026): tijdens de inloop staat er nog niets klaar. Elke speler ziet op zijn eigen
teleprompter links zijn eigen camera (rauw, of met de key over wit) en rechts het
universum, om camera en key goed te zetten. Hand omhoog = key aan/uit (via hand_ready, publiek en
show control).

Draaien in de Textport of via de opdrachtenmap (~/ForYou/td-opdrachten/in):

    exec(open('/Users/for_you/ForYou/main/show/td-qhub-test/apply_instel_patch.py').read())

Wat het doet, in /project1:
- instel (Constant CHOP): kanalen aan (instelstand), key1, key2, key3 (0 = rauw, 1 = key).
- per speler N (1-3):
  instel_rauw_N (Select: CameraN/raw) -> instel_rauwfit_N (Fit 1080x1920)
  instel_cam_N (Select: camN, de gekeyde camera) -> instel_key_N (Over: camera over wit, zodat
    een randje of kleurrest van de key meteen opvalt; instel_wit, 1080x1920)
  instel_wissel_N (Switch: rauw / key, index uit instel keyN)
  instel_N (Null): het beeld, zonder tekst erover (de randen van de key moeten te zien zijn)
- select_camN_0 (links op teleprompter N in fase 0) kiest instel_N als instel aan staat, anders
  wat hij al koos.
- instel_universum (Fit: Inloop naar 1312x1080) wordt ingang 0 van switch6/7/8 (rechts op de
  teleprompters); hun index wordt 0 in fase 0 met instel aan, anders 1 (zoals nu).
- td_qhub_router: /td/cue met command td.instel gaat naar handle_instel. OSC-args 4-5:
  speler (0 = de stand zelf, 1-3 = key van die speler) en waarde (0/1). Stand aan zet de keys op rauw.
- Bewaart NIET. Bewaren doet wie TouchDesigner beheert, na het nakijken (op ja van Booi).

Terugdraaien: select_camN_0.par.top.expr terug naar wat in INSTEL_OUD_LINKS staat; switch6/7/8:
index constant 1 en ingang 0 weer aan select_inloop. De instel_*-operators mogen blijven staan.
Nogmaals draaien kan: wat er al staat, wordt hergebruikt; de routercode wordt vervangen.
"""

INSTEL_RECHTS = ("switch6", "switch7", "switch8")
INSTEL_RECHTS_EXPR = "0 if (op('phase_value')['phase'] == 0 and op('/project1/instel')['aan']) else 1"
INSTEL_LINKS_EXPR = "'/project1/instel_%d' if op('/project1/instel')['aan'] else (%s)"
INSTEL_OUD_LINKS = "'/project1/beeld_tp%d_comp' if op('/project1/beeld_tp_aan')['aan'] else '/project1/video%d'"

ROUTER_MARKER = "# --- For_You instelbeeld (td.instel) ---"
ROUTER_END = "# --- einde For_You instelbeeld ---\n"

ROUTER_CODE = ROUTER_MARKER + '''
def _instel_log(cue_id, stage, status, message):
    _append_row(
        "cue_log",
        ["at", "cueId", "command", "payloadId", "trigger", "stage", "status", "message"],
        [_now(), cue_id, "td.instel", "-", "instel", stage, status, message],
    )


def _instel_kanaal(chop, naam, waarde):
    for index in range(4):
        for naam_par, waarde_par in (("const%dname" % index, "const%dvalue" % index), ("name%d" % index, "value%d" % index)):
            np = getattr(chop.par, naam_par, None)
            wp = getattr(chop.par, waarde_par, None)
            if np is not None and wp is not None and str(np.eval()) == naam:
                wp.val = waarde
                return True
    return False


def handle_instel(cue_id, extra_args):
    # OSC-args na cueId/command/payloadId: speler (0 = instelstand, 1-3 = key van die speler), waarde (0/1).
    cue_id = _text(cue_id)
    command = "td.instel"
    ack(cue_id, command, "received", "ok", "osc_received")
    try:
        speler = int(float(extra_args[0])) if len(extra_args) > 0 else 0
        waarde = 1 if int(float(extra_args[1])) else 0
    except (ValueError, IndexError):
        _instel_log(cue_id, "error", "error", "instel_args")
        ack(cue_id, command, "error", "error", "instel_args")
        return False
    chop = _op("instel")
    if chop is None:
        _instel_log(cue_id, "error", "error", "instel_ops_missing")
        ack(cue_id, command, "error", "error", "instel_ops_missing")
        return False
    if speler == 0:
        _instel_kanaal(chop, "aan", waarde)
        if waarde:
            for n in (1, 2, 3):
                _instel_kanaal(chop, "key%d" % n, 0)
        message = "instel:%s" % ("aan" if waarde else "uit")
    elif speler in (1, 2, 3):
        _instel_kanaal(chop, "key%d" % speler, waarde)
        message = "instel:speler %d %s" % (speler, "key" if waarde else "rauw")
    else:
        _instel_log(cue_id, "error", "error", "instel_speler:%s" % speler)
        ack(cue_id, command, "error", "error", "instel_speler")
        return False
    _instel_log(cue_id, "applied", "ok", message)
    ack(cue_id, command, "applied", "ok", message)
    return True
''' + ROUTER_END + "\n\n"

ROUTER_CALL_OLD = '''    payload_id = osc_args[2] if len(osc_args) > 2 else "-"
'''

ROUTER_CALL_NEW = '''    payload_id = osc_args[2] if len(osc_args) > 2 else "-"
    if command == "td.instel":
        handle_instel(cue_id, osc_args[3:])
        return
'''


def patch_router_text(text):
    """Geeft de nieuwe routertekst terug. Een eerdere versie van dit blok wordt vervangen."""
    anchor = "def _parse_callback_args(callback_args):"
    if ROUTER_MARKER in text:
        begin = text.index(ROUTER_MARKER)
        einde = text.index(ROUTER_END, begin) + len(ROUTER_END)
        rest = text[einde:].lstrip("\n")
        return text[:begin] + ROUTER_CODE + rest
    start = text.find("def onReceiveOSC(")
    if start < 0 or text.count(ROUTER_CALL_OLD, start) != 1:
        raise RuntimeError("td_qhub_router: onReceiveOSC niet herkend, niets veranderd")
    if text.count(anchor) != 1:
        raise RuntimeError("td_qhub_router: _parse_callback_args niet gevonden, niets veranderd")
    for nodig in ("def _append_row(", "def _op(", "def ack(", "def _text("):
        if nodig not in text:
            raise RuntimeError("td_qhub_router: %s niet gevonden, niets veranderd" % nodig)
    text = text[:start] + text[start:].replace(ROUTER_CALL_OLD, ROUTER_CALL_NEW)
    return text.replace(anchor, ROUTER_CODE + anchor)


def _get_or_create(root, op_type, name, x, y):
    existing = root.op(name)
    if existing is not None:
        return existing
    created = root.create(op_type, name)
    created.nodeX = x
    created.nodeY = y
    return created


def _set_par(operator, name, value):
    par = getattr(operator.par, name, None)
    if par is None:
        return False
    try:
        par.val = value
        return True
    except Exception:
        return False


def _zet_kanalen(chop, kanalen):
    # Constant CHOP: kanaalnamen en waarden (oude en nieuwe parameternamen).
    for index, (naam, waarde) in enumerate(kanalen):
        for naam_par, waarde_par in (("const%dname" % index, "const%dvalue" % index), ("name%d" % index, "value%d" % index)):
            if getattr(chop.par, naam_par, None) is not None:
                _set_par(chop, naam_par, naam)
                _set_par(chop, waarde_par, waarde)
                break


def _expr(par, tekst):
    # Uitdrukking zetten én de parameter op uitdrukking zetten (een nieuwe operator staat op constant).
    par.expr = tekst
    par.mode = type(par.mode).EXPRESSION


def _fit(root, naam, bron, breed, hoog, x, y):
    fit = _get_or_create(root, fitTOP, naam, x, y)
    fit.inputConnectors[0].connect(bron)
    _set_par(fit, "fit", "fitbest")
    _set_par(fit, "outputresolution", "custom")
    _set_par(fit, "resolutionw", breed)
    _set_par(fit, "resolutionh", hoog)
    return fit


def apply_instel_patch():
    root = op("/project1")
    router = root.op("td_qhub_router")
    if router is None:
        raise RuntimeError("niet gevonden: /project1/td_qhub_router")
    # Eerst alles nakijken: klopt er iets niet, dan verandert er niets.
    inloop = root.op("Inloop")
    if inloop is None:
        raise RuntimeError("niet gevonden: /project1/Inloop")
    links = []
    for nummer in (1, 2, 3):
        camera = root.op("Camera%d" % nummer)
        cam = root.op("cam%d" % nummer)
        select = root.op("select_cam%d_0" % nummer)
        if camera is None or camera.op("raw") is None or cam is None or select is None:
            raise RuntimeError("niet gevonden: Camera%d/raw, cam%d of select_cam%d_0" % (nummer, nummer, nummer))
        oud = (select.par.top.expr or "").strip()
        if "instel_" in oud:
            oud = oud.split(" else (", 1)[1][:-1] if " else (" in oud else INSTEL_OUD_LINKS % (nummer, nummer)
        if not oud:
            oud = repr(str(select.par.top.eval()))
        links.append((nummer, camera, cam, select, oud))
    rechts = []
    for naam in INSTEL_RECHTS:
        switch = root.op(naam)
        if switch is None or not switch.inputs or switch.inputs[0] is None:
            raise RuntimeError("niet gevonden of zonder ingang 0: %s" % naam)
        if switch.inputs[0].name not in ("select_inloop", "instel_universum"):
            raise RuntimeError("%s ingang 0 is %s, verwacht select_inloop; niets veranderd" % (naam, switch.inputs[0].name))
        rechts.append(switch)

    # 1. Router (alleen tekst).
    router.text = patch_router_text(router.text)

    # 2. De stand: aan + key per speler. Bij het opstarten van TouchDesigner is het de inloop.
    x, y = inloop.nodeX, inloop.nodeY - 2400
    stand = _get_or_create(root, constantCHOP, "instel", x, y + 400)
    if [c.name for c in stand.chans()] != ["aan", "key1", "key2", "key3"]:
        _zet_kanalen(stand, (("aan", 1), ("key1", 0), ("key2", 0), ("key3", 0)))

    # 3. Per speler het instelbeeld. Achter de key: wit.
    wit = _get_or_create(root, constantTOP, "instel_wit", x, y + 200)
    _set_par(wit, "outputresolution", "custom")
    _set_par(wit, "resolutionw", 1080)
    _set_par(wit, "resolutionh", 1920)
    for kanaal in ("colorr", "colorg", "colorb", "alpha"):
        _set_par(wit, kanaal, 1)
    for nummer, camera, cam, select, oud in links:
        dy = -700 * nummer
        rauw = _get_or_create(root, selectTOP, "instel_rauw_%d" % nummer, x, y + dy)
        rauw.par.top = camera.op("raw").path
        rauwfit = _fit(root, "instel_rauwfit_%d" % nummer, rauw, 1080, 1920, x + 200, y + dy)
        keycam = _get_or_create(root, selectTOP, "instel_cam_%d" % nummer, x, y + dy - 150)
        keycam.par.top = cam.path
        keyfit = _fit(root, "instel_camfit_%d" % nummer, keycam, 1080, 1920, x + 200, y + dy - 150)
        # Key over wit (wens Booi): een randje of kleurrest van de key valt daarop meteen op.
        for oud_naam in ("instel_achter_%d" % nummer, "instel_achterfit_%d" % nummer):
            oud_op = root.op(oud_naam)
            if oud_op is not None:
                oud_op.destroy()
        key = _get_or_create(root, overTOP, "instel_key_%d" % nummer, x + 400, y + dy - 150)
        key.inputConnectors[0].connect(keyfit)
        key.inputConnectors[1].connect(wit)
        _set_par(key, "outputresolution", "custom")
        _set_par(key, "resolutionw", 1080)
        _set_par(key, "resolutionh", 1920)
        wissel = _get_or_create(root, switchTOP, "instel_wissel_%d" % nummer, x + 600, y + dy)
        wissel.inputConnectors[0].connect(rauwfit)
        wissel.inputConnectors[1].connect(key)
        _expr(wissel.par.index, "op('/project1/instel')['key%d']" % nummer)
        # Geen tekst of balk over het beeld (Booi): de spelers moeten de randen van de key kunnen zien.
        for oud_naam in ("instel_tekst_%d" % nummer,):
            oud_op = root.op(oud_naam)
            if oud_op is not None:
                oud_op.destroy()
        beeld = root.op("instel_%d" % nummer)
        if beeld is not None and beeld.type != "null":
            beeld.destroy()
        beeld = _get_or_create(root, nullTOP, "instel_%d" % nummer, x + 800, y + dy)
        beeld.inputConnectors[0].connect(wissel)
        # Links op teleprompter N in fase 0: het instelbeeld zolang de instelstand aan staat.
        _expr(select.par.top, INSTEL_LINKS_EXPR % (nummer, oud))

    # 4. Rechts: het universum (Inloop) in de maat van het teleprompterblok, in fase 0 met instel aan.
    universum = _fit(root, "instel_universum", inloop, 1312, 1080, x, y - 2800)
    for switch in rechts:
        switch.inputConnectors[0].connect(universum)
        _expr(switch.par.index, INSTEL_RECHTS_EXPR)

    print("For_You instelbeeld: klaar, NIET bewaard")
    return True


if __name__ != "instel_offline_test":
    try:
        op  # alleen binnen TouchDesigner
    except NameError:
        pass
    else:
        apply_instel_patch()
