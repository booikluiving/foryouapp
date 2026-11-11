"""
For_You: effect haperen (cue td.effect.haper) in het show-TD.

Het camerabeeld van één speler krijgt een slechte verbinding: grove blokken (lage resolutie)
en een schokkerig beeld (het beeld blijft telkens even staan). Voor de omgeving Zoom.

Draaien in de Textport van TouchDesigner, met het showbestand "Najaar 2026" open:

    exec(open('/Users/for_you/ForYou/main/show/td-qhub-test/apply_haperen_patch.py').read())

Wat het doet, in /project1, per camera N (1, 2, 3; comp1, comp5, comp6):
- haper_klein_N (Fit): het gekeyde beeld van camN op lage resolutie, zonder verzachten
- haper_vast_N (Switch) + haper_terug_N (Feedback): houdt het beeld een paar frames vast
- haper_groot_N (Fit): terug naar de maat van camN, zonder verzachten (blokken)
- haper_switch_N (Switch): 0 = camN (zoals nu), 1 = het haperende beeld
- compN krijgt haper_switch_N op de plek van camN. camN zelf en alles ervoor blijft zoals het is.
- td_qhub_router: /td/cue met command td.effect.haper gaat naar handle_haper.
  Camera (1-3) en sterkte (0 = uit, 1-3) komen als OSC-args 4-5 mee.
  Bij td.environment.go en td.reset gaat het haperen uit.
- Bewaart NIET vanzelf. Bewaren doet wie TouchDesigner beheert, na het nakijken.

Terugdraaien: comp1/comp5/comp6 ingang 2 weer aan cam1/cam2/cam3 hangen (of de vorige versie openen).
Nogmaals draaien kan: wat er al staat, wordt hergebruikt; de routercode wordt vervangen.
"""

HAPER_COMPS = {1: "comp1", 2: "comp5", 3: "comp6"}

ROUTER_MARKER = "# --- For_You effect haperen (td.effect.haper) ---"
ROUTER_END = "# --- einde For_You effect haperen ---\n"

ROUTER_CODE = ROUTER_MARKER + '''
# Per sterkte: (deler van de resolutie, aantal frames dat het beeld blijft staan).
HAPER_STERKTES = {1: (8, 4), 2: (16, 9), 3: (28, 16)}


def _haper_log(cue_id, stage, status, message):
    _append_row(
        "cue_log",
        ["at", "cueId", "command", "payloadId", "trigger", "stage", "status", "message"],
        [_now(), cue_id, "td.effect.haper", "-", "haper", stage, status, message],
    )


def haper_uit(camera=0):
    # Haperen uit: voor één camera, of voor alle drie (bij een nieuwe omgeving en bij reset).
    gedaan = False
    for nummer in (1, 2, 3):
        if camera and camera != nummer:
            continue
        switch = _op("haper_switch_%d" % nummer)
        if switch is not None:
            switch.par.index = 0
            gedaan = True
    return gedaan


def handle_haper(cue_id, extra_args):
    # OSC-args na cueId/command/payloadId: camera (1-3), sterkte (0 = uit, 1-3).
    cue_id = _text(cue_id)
    command = "td.effect.haper"
    ack(cue_id, command, "received", "ok", "osc_received")
    try:
        camera = int(float(extra_args[0])) if len(extra_args) > 0 else 0
        sterkte = int(float(extra_args[1])) if len(extra_args) > 1 else 0
    except ValueError:
        camera, sterkte = 0, 0
    if camera not in (1, 2, 3):
        _haper_log(cue_id, "error", "error", "haper_camera_onbekend:%s" % camera)
        ack(cue_id, command, "error", "error", "haper_camera_onbekend")
        return False
    switch = _op("haper_switch_%d" % camera)
    klein = _op("haper_klein_%d" % camera)
    vast = _op("haper_vast_%d" % camera)
    bron = _op("cam%d" % camera)
    if switch is None or klein is None or vast is None or bron is None:
        _haper_log(cue_id, "error", "error", "haper_ops_missing")
        ack(cue_id, command, "error", "error", "haper_ops_missing")
        return False
    if sterkte <= 0:
        haper_uit(camera)
        _haper_log(cue_id, "applied", "ok", "haper:cam%d uit" % camera)
        ack(cue_id, command, "applied", "ok", "haper:uit")
        return True
    deler, frames = HAPER_STERKTES.get(min(3, sterkte), HAPER_STERKTES[3])
    klein.par.resolutionw = max(8, int(bron.width / deler))
    klein.par.resolutionh = max(8, int(bron.height / deler))
    # Index 0 = nieuw beeld doorlaten, 1 = het vorige beeld vasthouden.
    vast.par.index.expr = "0 if absTime.frame %% %d == 0 else 1" % frames
    switch.par.index = 1
    message = "haper:cam%d sterkte %d" % (camera, sterkte)
    _haper_log(cue_id, "applied", "ok", message)
    ack(cue_id, command, "applied", "ok", message)
    return True
''' + ROUTER_END + "\n\n"

ROUTER_CALL_OLD = '''    payload_id = osc_args[2] if len(osc_args) > 2 else "-"
'''

ROUTER_CALL_NEW = '''    payload_id = osc_args[2] if len(osc_args) > 2 else "-"
    if command == "td.effect.haper":
        handle_haper(cue_id, osc_args[3:])
        return
    if command in ("td.environment.go", "td.reset"):
        haper_uit()
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


def _hard(operator):
    # Geen verzachten bij verkleinen en vergroten: zo blijven het blokken.
    _set_par(operator, "inputfiltertype", "nearest")
    _set_par(operator, "filtertype", "nearest")


def apply_haperen_patch():
    root = op("/project1")
    router = root.op("td_qhub_router")
    if router is None:
        raise RuntimeError("niet gevonden: /project1/td_qhub_router")
    # Eerst alles nakijken: klopt er iets niet, dan verandert er niets.
    plan = []
    for nummer, comp_name in HAPER_COMPS.items():
        cam = root.op("cam%d" % nummer)
        comp = root.op(comp_name)
        if cam is None or comp is None:
            raise RuntimeError("niet gevonden: cam%d of %s" % (nummer, comp_name))
        plek = None
        for index, ingang in enumerate(comp.inputs):
            if ingang is not None and ingang.name in ("cam%d" % nummer, "haper_switch_%d" % nummer):
                plek = index
        if plek is None:
            raise RuntimeError("%s hangt niet aan cam%d; niets veranderd" % (comp_name, nummer))
        plan.append((nummer, cam, comp, plek))

    # 1. Router (alleen tekst).
    router.text = patch_router_text(router.text)

    # 2. Operators, tussen camN en compN.
    for nummer, cam, comp, plek in plan:
        x, y = cam.nodeX, cam.nodeY
        klein = _get_or_create(root, fitTOP, "haper_klein_%d" % nummer, x + 150, y - 45)
        klein.inputConnectors[0].connect(cam)
        klein.par.fit = "fill"
        klein.par.outputresolution = "custom"
        klein.par.resolutionw = max(8, int(cam.width / 16))
        klein.par.resolutionh = max(8, int(cam.height / 16))
        _hard(klein)

        vast = _get_or_create(root, switchTOP, "haper_vast_%d" % nummer, x + 150, y - 90)
        terug = _get_or_create(root, feedbackTOP, "haper_terug_%d" % nummer, x + 150, y - 135)
        terug.inputConnectors[0].connect(klein)
        terug.par.top = vast.name
        _hard(terug)
        vast.inputConnectors[0].connect(klein)
        vast.inputConnectors[1].connect(terug)
        if not vast.par.index.expr:
            vast.par.index.expr = "0 if absTime.frame % 9 == 0 else 1"
        _hard(vast)

        groot = _get_or_create(root, fitTOP, "haper_groot_%d" % nummer, x + 300, y - 90)
        groot.inputConnectors[0].connect(vast)
        groot.par.fit = "fill"
        groot.par.outputresolution = "custom"
        groot.par.resolutionw.expr = "op('cam%d').width" % nummer
        groot.par.resolutionh.expr = "op('cam%d').height" % nummer
        _hard(groot)

        switch = _get_or_create(root, switchTOP, "haper_switch_%d" % nummer, x + 300, y - 45)
        switch.inputConnectors[0].connect(cam)
        switch.inputConnectors[1].connect(groot)
        switch.par.index = 0

        # 3. compN aan de switch, op dezelfde plek als camN.
        comp.inputConnectors[plek].connect(switch)

    print("For_You haperen: klaar, NIET bewaard")
    return True


if __name__ != "haperen_offline_test":
    try:
        op  # alleen binnen TouchDesigner
    except NameError:
        pass
    else:
        apply_haperen_patch()
