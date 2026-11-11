"""
For_You: fases van een omgeving (cue td.effect.fase) in het show-TD.

Draaien in de Textport van TouchDesigner, met het showbestand "Najaar 2026" open:

    exec(open('/Users/for_you/ForYou/main/show/td-qhub-test/apply_fases_patch.py').read())

Wat het doet, in /project1:
- fase_bestand (Movie File In) -> fase_fit (Fit, zelfde maat als prepared_background)
- fase_switch (Switch): 0 = prepared_background (zoals nu), 1 = het beeld van de fase
- fase_schud (Transform): laat de achtergrond schudden bij een fase met schok
- Background (Null) krijgt fase_schud als ingang in plaats van prepared_background.
  fit1, bgselect en de comps per studio blijven zoals ze zijn.
- td_qhub_router: /td/cue met command td.effect.fase gaat naar handle_fase.
  Beeld, uit, schok en de wachttijd tot de klap komen als OSC-args 4-7 mee.
  Bij td.environment.go en td.reset gaat de achtergrond terug naar de gewone.
- Bewaart NIET vanzelf (FASES_SAVE = False). Zet hem op True om als nieuwe versie te bewaren;
  project.save neemt de hele live stand mee, kijk die dan eerst na.

Terugdraaien: Background weer aan prepared_background hangen (of de vorige versie openen).
Nogmaals draaien kan: wat er al staat, wordt hergebruikt. Los van apply_omvallen_patch.py;
de volgorde maakt niet uit.
"""

import os
import re

FASES_NEW_VERSION = None  # bijvoorbeeld "v1.21"; None = huidige versie + 1
FASES_SAVE = False  # True = bewaren als nieuwe versie

ROUTER_MARKER = "# --- For_You fases (td.effect.fase) ---"

ROUTER_CODE = ROUTER_MARKER + '''
FASE_FILE_OP = "fase_bestand"
FASE_SWITCH_OP = "fase_switch"
FASE_FIT_OP = "fase_fit"
FASE_SCHUD_OP = "fase_schud"
FASE_UITSCHUDDEN = 1.1
FASE_SFEER_OP = "prepared_soundscape"


def _fase_log(cue_id, stage, status, message):
    _append_row(
        "cue_log",
        ["at", "cueId", "command", "payloadId", "trigger", "stage", "status", "message"],
        [_now(), cue_id, "td.effect.fase", "-", "fase", stage, status, message],
    )


def _fase_token():
    base = _base()
    token = int(base.fetch("fase_token", 0) or 0) + 1
    base.store("fase_token", token)
    return base, token


def _fase_schud_stil():
    schud = _op(FASE_SCHUD_OP)
    if schud is None:
        return
    schud.par.tx = 0
    schud.par.ty = 0
    schud.par.sx = 1
    schud.par.sy = 1


def _fase_sfeer(file_path):
    # Het sfeergeluid van een fase. Leeg = terug naar het sfeergeluid van de omgeving.
    sfeer = _op(FASE_SFEER_OP)
    if sfeer is None:
        return
    base = _base()
    oud = _text(base.fetch("fase_sfeer_omgeving", ""))
    nu = _text(sfeer.par.file.eval())
    if file_path:
        if not oud:
            base.store("fase_sfeer_omgeving", nu)
        if nu != file_path:
            sfeer.par.file = file_path
    elif oud:
        if nu != oud:
            sfeer.par.file = oud
        base.store("fase_sfeer_omgeving", "")


def fase_uit(sfeer_terug=True):
    # Terug naar de gewone achtergrond. Ook bij een nieuwe omgeving en bij reset.
    switch = _op(FASE_SWITCH_OP)
    if switch is None:
        return False
    _fase_token()
    switch.par.index = 0
    _fase_schud_stil()
    if sfeer_terug:
        _fase_sfeer("")
    else:
        # Een nieuwe omgeving zet zelf haar sfeergeluid: alleen het geheugen leegmaken.
        _base().store("fase_sfeer_omgeving", "")
    return True


def _fase_schud_plan(base, token, start, duur, oplopend):
    # Zelfde beweging als in de editor: oplopend = aanloop naar de klap, anders uitschudden.
    schud = _op(FASE_SCHUD_OP)
    if schud is None or duur <= 0:
        return
    import math
    fps = float(project.cookRate or 60)
    frames = max(2, int(round(duur * fps)))
    for frame in range(frames + 1):
        t = frame / fps
        if oplopend:
            k = 0.3 * (t / duur)
        else:
            k = math.exp(-t * 3.5) * (1 - t / duur)
        if frame == frames and not oplopend:
            k = 0.0
        run(
            "if args[1].fetch('fase_token', 0) == args[2]:\\n"
            "    args[0].par.tx = args[3]\\n"
            "    args[0].par.ty = args[4]\\n"
            "    args[0].par.sx = args[5]\\n"
            "    args[0].par.sy = args[5]",
            schud, base, token,
            0.032 * k * math.sin(t * 83), 0.032 * k * math.sin(t * 131), 1 + 0.08 * k,
            delayMilliSeconds=int((start + t) * 1000),
        )


def handle_fase(cue_id, extra_args):
    # OSC-args na cueId/command/payloadId: filePath, uit (0/1), schok (0/1), schokNa (s), sfeergeluid.
    cue_id = _text(cue_id)
    command = "td.effect.fase"
    ack(cue_id, command, "received", "ok", "osc_received")
    file_path = _text(extra_args[0]) if len(extra_args) > 0 else ""
    uit = (_text(extra_args[1]) if len(extra_args) > 1 else "0") == "1" or not file_path
    schok = (_text(extra_args[2]) if len(extra_args) > 2 else "0") == "1"
    try:
        wacht = float(extra_args[3]) if len(extra_args) > 3 else 0.0
    except ValueError:
        wacht = 0.0
    wacht = max(0.0, min(10.0, wacht)) if schok else 0.0
    sfeer_path = _text(extra_args[4]) if len(extra_args) > 4 else ""
    if sfeer_path and not os.path.isfile(sfeer_path):
        _fase_log(cue_id, "sfeer", "warning", "fase_sfeer_missing:%s" % sfeer_path)
        sfeer_path = ""
    movie = _op(FASE_FILE_OP)
    switch = _op(FASE_SWITCH_OP)
    if movie is None or switch is None:
        _fase_log(cue_id, "error", "error", "fase_ops_missing")
        ack(cue_id, command, "error", "error", "fase_ops_missing")
        return False
    if not uit and not os.path.isfile(file_path):
        _fase_log(cue_id, "error", "error", "fase_file_missing:%s" % file_path)
        ack(cue_id, command, "error", "error", "fase_file_missing")
        return False
    base, token = _fase_token()
    _fase_schud_stil()
    fit = _op(FASE_FIT_OP)
    if not uit:
        # Het beeld alvast laden; een Switch kookt alleen de gekozen ingang.
        if _text(movie.par.file.eval()) != file_path:
            movie.par.file = file_path
        try:
            movie.par.play = 1
            if hasattr(movie, "preload"):
                movie.preload()
            movie.cook(force=True)
            if fit is not None:
                fit.cook(force=True)
        except Exception as err:
            _fase_log(cue_id, "preload", "warning", err)
    # Wisselen op de klap (meteen als er geen schok is). Het sfeergeluid wisselt mee.
    run(
        "if args[1].fetch('fase_token', 0) == args[2]:\\n"
        "    if args[4] is not None:\\n"
        "        args[4].cook(force=True)\\n"
        "    args[0].par.index = args[3]\\n"
        "    s = args[5]\\n"
        "    if s is not None:\\n"
        "        oud = str(args[1].fetch('fase_sfeer_omgeving', '') or '')\\n"
        "        nu = str(s.par.file.eval())\\n"
        "        if args[6]:\\n"
        "            if not oud:\\n"
        "                args[1].store('fase_sfeer_omgeving', nu)\\n"
        "            if nu != args[6]:\\n"
        "                s.par.file = args[6]\\n"
        "        elif oud:\\n"
        "            if nu != oud:\\n"
        "                s.par.file = oud\\n"
        "            args[1].store('fase_sfeer_omgeving', '')",
        switch, base, token, 0 if uit else 1, None if uit else (fit or movie), _op(FASE_SFEER_OP), sfeer_path,
        delayMilliSeconds=int(wacht * 1000) + 50,
    )
    if schok:
        _fase_schud_plan(base, token, 0.0, wacht, True)
        _fase_schud_plan(base, token, wacht, FASE_UITSCHUDDEN, False)
    message = "fase:%s schok:%s" % ("achtergrond" if uit else os.path.basename(file_path), wacht if schok else "nee")
    _fase_log(cue_id, "applied", "ok", message)
    ack(cue_id, command, "applied", "ok", message)
    return True
# --- einde For_You fases ---


'''

ROUTER_CALL_OLD = '''    payload_id = osc_args[2] if len(osc_args) > 2 else "-"
'''

ROUTER_CALL_NEW = '''    payload_id = osc_args[2] if len(osc_args) > 2 else "-"
    if command == "td.effect.fase":
        handle_fase(cue_id, osc_args[3:])
        return
    if command in ("td.environment.go", "td.reset"):
        fase_uit(False)
'''


def patch_router_text(text):
    """Geeft de nieuwe routertekst terug. Staat er al een oudere versie, dan wordt die vervangen."""
    einde = "# --- einde For_You fases ---\n\n\n"
    if ROUTER_MARKER in text:
        a = text.index(ROUTER_MARKER)
        b = text.index(einde, a) + len(einde)
        text = text[:a] + ROUTER_CODE + text[b:]
        oud = "    if command in (\"td.environment.go\", \"td.reset\"):\n        fase_uit()\n"
        return text.replace(oud, "    if command in (\"td.environment.go\", \"td.reset\"):\n        fase_uit(False)\n")
    start = text.find("def onReceiveOSC(")
    if start < 0 or text.count(ROUTER_CALL_OLD, start) != 1:
        raise RuntimeError("td_qhub_router: onReceiveOSC niet herkend, niets veranderd")
    anchor = "def _parse_callback_args(callback_args):"
    if text.count(anchor) != 1:
        raise RuntimeError("td_qhub_router: _parse_callback_args niet gevonden, niets veranderd")
    text = text[:start] + text[start:].replace(ROUTER_CALL_OLD, ROUTER_CALL_NEW)
    return text.replace(anchor, ROUTER_CODE + anchor)


def _next_version_name(current_name):
    match = re.search(r"v(\d+)\.(\d+)\.toe$", current_name)
    if not match:
        raise RuntimeError("versie niet herkend in %s" % current_name)
    new_version = FASES_NEW_VERSION or "v%s.%s" % (match.group(1), int(match.group(2)) + 1)
    return current_name[:match.start()] + new_version + ".toe"


def _get_or_create(root, op_type, name, x, y):
    existing = root.op(name)
    if existing is not None:
        return existing
    created = root.create(op_type, name)
    created.nodeX = x
    created.nodeY = y
    return created


def apply_fases_patch():
    root = op("/project1")
    background = root.op("prepared_background")
    null = root.op("Background")
    router = root.op("td_qhub_router")
    for name, item in [("prepared_background", background), ("Background", null), ("td_qhub_router", router)]:
        if item is None:
            raise RuntimeError("niet gevonden: /project1/%s" % name)
    current_input = null.inputs[0] if null.inputs else None
    if current_input is None or current_input.name not in ("prepared_background", "fase_schud"):
        raise RuntimeError("Background hangt niet aan prepared_background; niets veranderd")

    # 1. Router eerst (alleen tekst): faalt dit, dan is het netwerk nog onaangeroerd.
    router.text = patch_router_text(router.text)

    # 2. Operators, tussen prepared_background en Background.
    x, y = background.nodeX, background.nodeY
    movie = _get_or_create(root, moviefileinTOP, "fase_bestand", x, y + 700)
    empty = os.path.join(project.folder, "empty-alpha-1920x1080.png")
    if os.path.isfile(empty) and not movie.par.file.eval():
        movie.par.file = empty

    fit = _get_or_create(root, fitTOP, "fase_fit", x + 300, y + 700)
    fit.inputConnectors[0].connect(movie)
    fit.par.fit = "fill"
    fit.par.outputresolution = "custom"
    fit.par.resolutionw.expr = "op('prepared_background').width"
    fit.par.resolutionh.expr = "op('prepared_background').height"

    switch = _get_or_create(root, switchTOP, "fase_switch", x + 300, y + 350)
    switch.inputConnectors[0].connect(background)
    switch.inputConnectors[1].connect(fit)
    switch.par.index = 0

    schud = _get_or_create(root, transformTOP, "fase_schud", x + 420, y + 180)
    schud.inputConnectors[0].connect(switch)

    # 3. Background aan de schudder (fit1 en de rest blijven zoals ze zijn).
    null.inputConnectors[0].connect(schud)

    if not FASES_SAVE:
        print("For_You fases: klaar, NIET bewaard (FASES_SAVE = False)")
        return None
    current_name = os.path.basename(project.name if project.name.endswith(".toe") else project.name + ".toe")
    new_name = _next_version_name(current_name)
    variables = op("/local/set_variables")
    if variables is not None and variables.row("TOENAME") is not None:
        variables["TOENAME", 1] = new_name
    new_path = os.path.join(project.folder, new_name)
    if os.path.exists(new_path):
        raise RuntimeError("bestaat al, niet overschreven: %s" % new_path)
    project.save(new_path)
    print("For_You fases: klaar, bewaard als", new_path)
    return new_path


if __name__ != "fases_offline_test":
    try:
        op  # alleen binnen TouchDesigner
    except NameError:
        pass
    else:
        apply_fases_patch()
