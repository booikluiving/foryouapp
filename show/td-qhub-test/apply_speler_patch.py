"""
For_You: het camerabeeld van een speler spiegelen of laten wegfaden (cue td.effect.speler).

Voor de Grimmige slaapkamer: Peter fadet weg als de deur dichtslaat, en wie buiten achter het
raam staat kan gespiegeld in beeld.

Draaien in de Textport van TouchDesigner, met het showbestand "Najaar 2026" open:

    exec(open('/Users/for_you/ForYou/main/show/td-qhub-test/apply_speler_patch.py').read())

Wat het doet, in /project1, per speler N (1, 2, 3 = cam1, cam2, cam3 -> comp1, comp5, comp6):
- speler_spiegel_N (Flip): spiegelt het camerabeeld links-rechts als het aan staat
- speler_zicht_N (Level): de dekking van het camerabeeld (1 = zichtbaar, 0 = weg), met een fade
- compN krijgt speler_zicht_N op de plek van camN. camN en alles ervoor blijft zoals het is;
  de achtergrond en de voorgrond van het vakje veranderen niet.
- td_qhub_router: /td/cue met command td.effect.speler gaat naar handle_speler.
  OSC-args 4-6: spiegel en zichtbaar als code van drie tekens, één per camera
  ("1" = aan, "0" = uit, "-" = laten zoals het is), en de duur van de fade in seconden.
  Bij td.environment.go en td.reset staat iedereen weer zichtbaar en niet gespiegeld.
- Bewaart NIET vanzelf. Bewaren doet wie TouchDesigner beheert, na het nakijken.

Terugdraaien: comp1/comp5/comp6 weer aan cam1/cam2/cam3 hangen (of de vorige versie openen).
Nogmaals draaien kan: wat er al staat, wordt hergebruikt; de routercode wordt vervangen.
"""

SPELER_COMPS = {1: "comp1", 2: "comp5", 3: "comp6"}

ROUTER_MARKER = "# --- For_You spelerbeeld spiegelen en faden (td.effect.speler) ---"
ROUTER_END = "# --- einde For_You spelerbeeld spiegelen en faden ---\n"

ROUTER_CODE = ROUTER_MARKER + '''
def _speler_log(cue_id, stage, status, message):
    _append_row(
        "cue_log",
        ["at", "cueId", "command", "payloadId", "trigger", "stage", "status", "message"],
        [_now(), cue_id, "td.effect.speler", "-", "speler", stage, status, message],
    )


def _speler_zicht(nummer, doel, fade):
    # Dekking van het camerabeeld naar doel (0 of 1), in fade seconden. Op tijd, niet op frames.
    level = _op("speler_zicht_%d" % nummer)
    if level is None:
        return False
    try:
        nu = float(level.par.opacity.eval())
    except Exception:
        nu = 1.0
    level.par.opacity.expr = ""
    if fade <= 0 or abs(nu - doel) < 0.001:
        level.par.opacity = doel
        return True
    level.par.opacity.expr = "min(max(%.4f + (%.4f) * (absTime.seconds - %.4f) / %.4f, 0), 1)" % (
        nu, doel - nu, absTime.seconds, fade,
    ) if doel > nu else "max(min(%.4f + (%.4f) * (absTime.seconds - %.4f) / %.4f, 1), 0)" % (
        nu, doel - nu, absTime.seconds, fade,
    )
    return True


def speler_terug():
    # Iedereen zichtbaar en niet gespiegeld. Bij een nieuwe omgeving en bij reset.
    gedaan = False
    for nummer in (1, 2, 3):
        flip = _op("speler_spiegel_%d" % nummer)
        if flip is not None:
            flip.par.flipx = 0
            gedaan = True
        _speler_zicht(nummer, 1.0, 0)
    return gedaan


def handle_speler(cue_id, extra_args):
    # OSC-args na cueId/command/payloadId: spiegel ("--1"), zichtbaar ("0--"), fade (s).
    cue_id = _text(cue_id)
    command = "td.effect.speler"
    ack(cue_id, command, "received", "ok", "osc_received")
    spiegel = _text(extra_args[0]) if len(extra_args) > 0 else "---"
    zichtbaar = _text(extra_args[1]) if len(extra_args) > 1 else "---"
    try:
        fade = float(extra_args[2]) if len(extra_args) > 2 else 0.0
    except ValueError:
        fade = 0.0
    if _op("speler_zicht_1") is None or _op("speler_spiegel_1") is None:
        _speler_log(cue_id, "error", "error", "speler_ops_missing")
        ack(cue_id, command, "error", "error", "speler_ops_missing")
        return False
    for nummer in (1, 2, 3):
        teken = spiegel[nummer - 1] if len(spiegel) >= nummer else "-"
        if teken in ("0", "1"):
            flip = _op("speler_spiegel_%d" % nummer)
            if flip is not None:
                flip.par.flipx = 1 if teken == "1" else 0
        teken = zichtbaar[nummer - 1] if len(zichtbaar) >= nummer else "-"
        if teken in ("0", "1"):
            _speler_zicht(nummer, 1.0 if teken == "1" else 0.0, fade)
    message = "speler:spiegel %s zichtbaar %s fade %.2f" % (spiegel, zichtbaar, fade)
    _speler_log(cue_id, "applied", "ok", message)
    ack(cue_id, command, "applied", "ok", message)
    return True
''' + ROUTER_END + "\n\n"

ROUTER_CALL_OLD = '''    payload_id = osc_args[2] if len(osc_args) > 2 else "-"
'''

ROUTER_CALL_NEW = '''    payload_id = osc_args[2] if len(osc_args) > 2 else "-"
    if command == "td.effect.speler":
        handle_speler(cue_id, osc_args[3:])
        return
    if command in ("td.environment.go", "td.reset"):
        speler_terug()
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


def _plek_van(operator, namen):
    for index, ingang in enumerate(operator.inputs):
        if ingang is not None and ingang.name in namen:
            return index
    return None


def apply_speler_patch():
    root = op("/project1")
    router = root.op("td_qhub_router")
    if router is None:
        raise RuntimeError("niet gevonden: /project1/td_qhub_router")
    # Eerst alles nakijken: klopt er iets niet, dan verandert er niets.
    plan = []
    for nummer, comp_name in SPELER_COMPS.items():
        cam = root.op("cam%d" % nummer)
        comp = root.op(comp_name)
        if cam is None or comp is None:
            raise RuntimeError("niet gevonden: cam%d of %s" % (nummer, comp_name))
        plek = _plek_van(comp, ("cam%d" % nummer, "speler_zicht_%d" % nummer))
        if plek is None:
            raise RuntimeError("%s hangt niet aan cam%d; niets veranderd" % (comp_name, nummer))
        plan.append((nummer, cam, comp, plek))

    # 1. Router (alleen tekst).
    router.text = patch_router_text(router.text)

    for nummer, cam, comp, plek in plan:
        # 2. Onderdelen, tussen camN en compN.
        x, y = cam.nodeX, cam.nodeY
        flip = _get_or_create(root, flipTOP, "speler_spiegel_%d" % nummer, x + 130, y - 110)
        flip.inputConnectors[0].connect(cam)
        flip.par.flipx = 0
        flip.par.flipy = 0
        zicht = _get_or_create(root, levelTOP, "speler_zicht_%d" % nummer, x + 260, y - 110)
        zicht.inputConnectors[0].connect(flip)
        zicht.par.opacity.expr = ""
        zicht.par.opacity = 1

        # 3. compN aan de keten, op dezelfde plek als camN.
        comp.inputConnectors[plek].connect(zicht)

    print("For_You spelerbeeld spiegelen en faden: klaar, NIET bewaard")
    return True


if __name__ != "speler_offline_test":
    try:
        op  # alleen binnen TouchDesigner
    except NameError:
        pass
    else:
        apply_speler_patch()
