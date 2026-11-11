"""
For_You: effect haperen (cue td.effect.haper) in het show-TD.

Het vakje van één speler krijgt een slechte verbinding: speler en achtergrond samen in grove
blokken (lage resolutie) en schokkerig (het beeld blijft telkens even staan). Voor de omgeving Zoom.

Draaien in de Textport van TouchDesigner, met het showbestand "Najaar 2026" open:

    exec(open('/Users/for_you/ForYou/main/.claude/worktrees/zoom-haperen/show/td-qhub-test/apply_haperen_patch.py').read())

Wat het doet, in /project1, per vakje N (1, 2, 3 = comp1, comp5, comp6 -> video1, video2, video3):
- haper_klein_N (Fit): het samengestelde vakje compN op lage resolutie, zonder verzachten
- haper_vast_N (Cross) + haper_terug_N (Feedback): houdt het beeld vast en laat een paar keer
  per seconde een nieuw beeld door. Cross in plaats van Switch: zo kookt de Feedback elk frame
  mee; met een Switch bevroor het beeld.
- haper_groot_N (Fit): terug naar de maat van compN, zonder verzachten (blokken)
- haper_switch_N (Switch): 0 = compN (zoals nu), 1 = het haperende vakje
- videoN krijgt haper_switch_N op de plek van compN. compN en alles ervoor blijft zoals het is.
- Staat de eerste versie er nog (keten tussen camN en compN), dan wordt die eerst weggehaald
  en hangt compN weer aan camN.
- td_qhub_router: /td/cue met command td.effect.haper gaat naar handle_haper.
  Vakje (1-3) en sterkte (0 = uit, 1-3) komen als OSC-args 4-5 mee.
  Bij td.environment.go en td.reset gaat het haperen uit.
- Bewaart NIET vanzelf. Bewaren doet wie TouchDesigner beheert, na het nakijken.

Terugdraaien: video1/video2/video3 weer aan comp1/comp5/comp6 hangen (of de vorige versie openen).
Nogmaals draaien kan: wat er al staat, wordt hergebruikt; de routercode wordt vervangen.
"""

HAPER_COMPS = {1: "comp1", 2: "comp5", 3: "comp6"}
HAPER_AFNEMERS = {1: "video1", 2: "video2", 3: "video3"}
HAPER_ONDERDELEN = ("haper_switch_%d", "haper_groot_%d", "haper_vast_%d", "haper_terug_%d", "haper_klein_%d")

ROUTER_MARKER = "# --- For_You effect haperen (td.effect.haper) ---"
ROUTER_END = "# --- einde For_You effect haperen ---\n"

ROUTER_CODE = ROUTER_MARKER + '''
# Per sterkte: (deler van de resolutie, aantal nieuwe beelden per seconde).
HAPER_STERKTES = {1: (6, 12), 2: (8, 7), 3: (14, 4)}
HAPER_BRON = {1: "comp1", 2: "comp5", 3: "comp6"}


def _haper_vast_expr(per_seconde):
    # 0 = nieuw beeld doorlaten, 1 = het vorige beeld vasthouden. Op tijd, niet op framenummer:
    # zo werkt het ook als TouchDesigner frames overslaat.
    return (
        "0 if int(absTime.seconds * %d) != int((absTime.seconds - absTime.stepSeconds) * %d) else 1"
        % (per_seconde, per_seconde)
    )


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
    bron = _op(HAPER_BRON[camera])
    if switch is None or klein is None or vast is None or bron is None:
        _haper_log(cue_id, "error", "error", "haper_ops_missing")
        ack(cue_id, command, "error", "error", "haper_ops_missing")
        return False
    if sterkte <= 0:
        haper_uit(camera)
        _haper_log(cue_id, "applied", "ok", "haper:cam%d uit" % camera)
        ack(cue_id, command, "applied", "ok", "haper:uit")
        return True
    deler, per_seconde = HAPER_STERKTES.get(min(3, sterkte), HAPER_STERKTES[3])
    klein.par.resolutionw = max(8, int(bron.width / deler))
    klein.par.resolutionh = max(8, int(bron.height / deler))
    vast.par.cross.expr = _haper_vast_expr(per_seconde)
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


def _plek_van(operator, namen):
    for index, ingang in enumerate(operator.inputs):
        if ingang is not None and ingang.name in namen:
            return index
    return None


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
        afnemer = root.op(HAPER_AFNEMERS[nummer])
        if cam is None or comp is None or afnemer is None:
            raise RuntimeError("niet gevonden: cam%d, %s of %s" % (nummer, comp_name, HAPER_AFNEMERS[nummer]))
        switch_name = "haper_switch_%d" % nummer
        oud_plek = _plek_van(comp, (switch_name,))  # eerste versie: de keten zat tussen camN en compN
        plek = _plek_van(afnemer, (comp_name, switch_name))
        if plek is None:
            raise RuntimeError("%s hangt niet aan %s; niets veranderd" % (HAPER_AFNEMERS[nummer], comp_name))
        if oud_plek is None and _plek_van(comp, ("cam%d" % nummer,)) is None:
            raise RuntimeError("%s hangt niet aan cam%d; niets veranderd" % (comp_name, nummer))
        plan.append((nummer, cam, comp, afnemer, plek, oud_plek))

    # 1. Router (alleen tekst).
    router.text = patch_router_text(router.text)

    for nummer, cam, comp, afnemer, plek, oud_plek in plan:
        # 2. De eerste versie weghalen: compN weer aan camN, de oude onderdelen weg.
        if oud_plek is not None:
            comp.inputConnectors[oud_plek].connect(cam)
            for naam in HAPER_ONDERDELEN:
                oud = root.op(naam % nummer)
                if oud is not None:
                    oud.destroy()
        # Een Switch op de plek van de Cross (eerdere poging): vervangen.
        oude_vast = root.op("haper_vast_%d" % nummer)
        if oude_vast is not None and oude_vast.type != "cross":
            oude_vast.destroy()

        # 3. Onderdelen, tussen compN en videoN.
        x, y = comp.nodeX, comp.nodeY
        klein = _get_or_create(root, fitTOP, "haper_klein_%d" % nummer, x + 150, y - 30)
        klein.inputConnectors[0].connect(comp)
        klein.par.fit = "fill"
        klein.par.outputresolution = "custom"
        klein.par.resolutionw = max(8, int(comp.width / 8))
        klein.par.resolutionh = max(8, int(comp.height / 8))
        _hard(klein)

        vast = _get_or_create(root, crossTOP, "haper_vast_%d" % nummer, x + 300, y - 30)
        terug = _get_or_create(root, feedbackTOP, "haper_terug_%d" % nummer, x + 150, y - 75)
        terug.inputConnectors[0].connect(klein)
        terug.par.top = vast.name
        _hard(terug)
        vast.inputConnectors[0].connect(klein)
        vast.inputConnectors[1].connect(terug)
        if not vast.par.cross.expr:
            vast.par.cross.expr = "0 if int(absTime.seconds * 7) != int((absTime.seconds - absTime.stepSeconds) * 7) else 1"
        _hard(vast)

        groot = _get_or_create(root, fitTOP, "haper_groot_%d" % nummer, x + 450, y - 30)
        groot.inputConnectors[0].connect(vast)
        groot.par.fit = "fill"
        groot.par.outputresolution = "custom"
        groot.par.resolutionw.expr = "op('%s').width" % comp.name
        groot.par.resolutionh.expr = "op('%s').height" % comp.name
        _hard(groot)

        switch = _get_or_create(root, switchTOP, "haper_switch_%d" % nummer, x + 600, y - 30)
        switch.inputConnectors[0].connect(comp)
        switch.inputConnectors[1].connect(groot)
        switch.par.index = 0

        # 4. videoN aan de switch, op dezelfde plek als compN.
        afnemer.inputConnectors[plek].connect(switch)

    print("For_You haperen: klaar, NIET bewaard")
    return True


if __name__ != "haperen_offline_test":
    try:
        op  # alleen binnen TouchDesigner
    except NameError:
        pass
    else:
        apply_haperen_patch()
