"""
For_You: effect omvallen (cue td.effect.omvallen) in het show-TD.

Draaien in de Textport van TouchDesigner, met het showbestand "Najaar 2026" open:

    exec(open('/Users/for_you/ForYou/main/show/td-qhub-test/apply_omvallen_patch.py').read())

Wat het doet, in /project1:
- omvallen_bestand (Movie File In) -> omvallen_fit (Fit, zelfde maat als prepared_fx_overlay)
- omvallen_switch (Switch): 0 = prepared_fx_overlay (zoals nu), 1 = de clip van de stap
- FX (Null) krijgt omvallen_switch als ingang in plaats van prepared_fx_overlay.
  FXselect en alles daarna blijft zoals het is.
- td_qhub_router: /td/cue met command td.effect.omvallen gaat naar handle_omvallen.
  Clip, uit en duur komen als OSC-args 4-6 mee: geen HTTP, geen payload-fetch.
  Bij td.environment.go en td.reset gaat de voorgrond terug naar de gewone laag.
- Bewaart NIET vanzelf (OMVALLEN_SAVE = False). Zet hem op True om als nieuwe versie te bewaren;
  project.save neemt de hele live stand mee, kijk die dan eerst na.

Terugdraaien: FX weer aan prepared_fx_overlay hangen (of de vorige versie openen).
Nogmaals draaien kan: wat er al staat, wordt hergebruikt.
"""

import os
import re

OMVALLEN_NEW_VERSION = None  # bijvoorbeeld "v1.21"; None = huidige versie + 1
OMVALLEN_SAVE = False  # True = bewaren als nieuwe versie

ROUTER_MARKER = "# --- For_You effect omvallen (td.effect.omvallen) ---"

ROUTER_CODE = ROUTER_MARKER + '''
OMVALLEN_FILE_OP = "omvallen_bestand"
OMVALLEN_SWITCH_OP = "omvallen_switch"
OMVALLEN_FIT_OP = "omvallen_fit"


def _omvallen_log(cue_id, stage, status, message):
    _append_row(
        "cue_log",
        ["at", "cueId", "command", "payloadId", "trigger", "stage", "status", "message"],
        [_now(), cue_id, "td.effect.omvallen", "-", "omvallen", stage, status, message],
    )


def omvallen_uit():
    # Terug naar de gewone voorgrond. Ook bij een nieuwe omgeving en bij reset.
    switch = _op(OMVALLEN_SWITCH_OP)
    if switch is None:
        return False
    base = _base()
    base.store("omvallen_token", int(base.fetch("omvallen_token", 0) or 0) + 1)
    switch.par.index = 0
    return True


def handle_omvallen(cue_id, extra_args):
    # OSC-args na cueId/command/payloadId: filePath, uit (0/1), duur (s).
    cue_id = _text(cue_id)
    command = "td.effect.omvallen"
    ack(cue_id, command, "received", "ok", "osc_received")
    file_path = _text(extra_args[0]) if len(extra_args) > 0 else ""
    uit = (_text(extra_args[1]) if len(extra_args) > 1 else "0") == "1"
    try:
        duur = float(extra_args[2]) if len(extra_args) > 2 else 0.0
    except ValueError:
        duur = 0.0
    movie = _op(OMVALLEN_FILE_OP)
    switch = _op(OMVALLEN_SWITCH_OP)
    if movie is None or switch is None:
        _omvallen_log(cue_id, "error", "error", "omvallen_ops_missing")
        ack(cue_id, command, "error", "error", "omvallen_ops_missing")
        return False
    if uit or not file_path:
        omvallen_uit()
        _omvallen_log(cue_id, "applied", "ok", "omvallen:uit")
        ack(cue_id, command, "applied", "ok", "omvallen:uit")
        return True
    if not os.path.isfile(file_path):
        _omvallen_log(cue_id, "error", "error", "omvallen_file_missing:%s" % file_path)
        ack(cue_id, command, "error", "error", "omvallen_file_missing")
        return False
    base = _base()
    token = int(base.fetch("omvallen_token", 0) or 0) + 1
    base.store("omvallen_token", token)
    # De clip speelt een keer en blijft op het laatste beeld staan: dat is de nieuwe stand.
    try:
        movie.par.play = 0
    except Exception:
        pass
    movie.par.file = file_path
    if hasattr(movie.par, "cuepulse"):
        movie.par.cuepulse.pulse()
    fit = _op(OMVALLEN_FIT_OP)
    try:
        if hasattr(movie, "preload"):
            movie.preload()
        movie.cook(force=True)
        if fit is not None:
            fit.cook(force=True)
    except Exception as err:
        _omvallen_log(cue_id, "preload", "warning", err)
    run(
        "if args[1].fetch('omvallen_token', 0) == args[2]:\\n"
        "    args[3].cook(force=True)\\n"
        "    args[0].par.index = 1\\n"
        "    if hasattr(args[4].par, 'cuepulse'):\\n"
        "        args[4].par.cuepulse.pulse()\\n"
        "    args[4].par.play = 1",
        switch, base, token, fit or movie, movie, delayFrames=3,
    )
    if duur > 0:
        # Vangnet als de clip toch zou herhalen: stilzetten vlak voor het einde.
        run(
            "if args[1].fetch('omvallen_token', 0) == args[2]:\\n    args[0].par.play = 0",
            movie, base, token, delayMilliSeconds=int(duur * 1000) - 60,
        )
    message = "omvallen:%s" % os.path.basename(file_path)
    _omvallen_log(cue_id, "applied", "ok", message)
    ack(cue_id, command, "applied", "ok", message)
    return True
# --- einde For_You effect omvallen ---


'''

ROUTER_CALL_OLD = '''    payload_id = osc_args[2] if len(osc_args) > 2 else "-"
'''

ROUTER_CALL_NEW = '''    payload_id = osc_args[2] if len(osc_args) > 2 else "-"
    if command == "td.effect.omvallen":
        handle_omvallen(cue_id, osc_args[3:])
        return
    if command in ("td.environment.go", "td.reset"):
        omvallen_uit()
'''


def patch_router_text(text):
    """Geeft de nieuwe routertekst terug. Zelfde tekst als hij al gepatcht is."""
    if ROUTER_MARKER in text:
        return text
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
    new_version = OMVALLEN_NEW_VERSION or "v%s.%s" % (match.group(1), int(match.group(2)) + 1)
    return current_name[:match.start()] + new_version + ".toe"


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


def apply_omvallen_patch():
    root = op("/project1")
    overlay = root.op("prepared_fx_overlay")
    fx = root.op("FX")
    router = root.op("td_qhub_router")
    for name, item in [("prepared_fx_overlay", overlay), ("FX", fx), ("td_qhub_router", router)]:
        if item is None:
            raise RuntimeError("niet gevonden: /project1/%s" % name)
    current_input = fx.inputs[0] if fx.inputs else None
    if current_input is None or current_input.name not in ("prepared_fx_overlay", "omvallen_switch"):
        raise RuntimeError("FX hangt niet aan prepared_fx_overlay; niets veranderd")

    # 1. Router eerst (alleen tekst): faalt dit, dan is het netwerk nog onaangeroerd.
    router.text = patch_router_text(router.text)

    # 2. Operators, tussen prepared_fx_overlay en FX.
    x, y = overlay.nodeX, overlay.nodeY
    movie = _get_or_create(root, moviefileinTOP, "omvallen_bestand", x, y - 700)
    empty = os.path.join(project.folder, "empty-alpha-1920x1080.png")
    if os.path.isfile(empty) and not movie.par.file.eval():
        movie.par.file = empty
    _set_par(movie, "playmode", "sequential")
    _set_par(movie, "extendright", "hold")
    _set_par(movie, "loop", 0)

    fit = _get_or_create(root, fitTOP, "omvallen_fit", x + 300, y - 700)
    fit.inputConnectors[0].connect(movie)
    fit.par.fit = "fill"
    fit.par.outputresolution = "custom"
    fit.par.resolutionw.expr = "op('prepared_fx_overlay').width"
    fit.par.resolutionh.expr = "op('prepared_fx_overlay').height"

    switch = _get_or_create(root, switchTOP, "omvallen_switch", x + 300, y - 350)
    switch.inputConnectors[0].connect(overlay)
    switch.inputConnectors[1].connect(fit)
    switch.par.index = 0

    # 3. FX aan de switch (FXselect en de rest blijven zoals ze zijn).
    fx.inputConnectors[0].connect(switch)

    if not OMVALLEN_SAVE:
        print("For_You omvallen: klaar, NIET bewaard (OMVALLEN_SAVE = False)")
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
    print("For_You omvallen: klaar, bewaard als", new_path)
    return new_path


if __name__ != "omvallen_offline_test":
    try:
        op  # alleen binnen TouchDesigner
    except NameError:
        pass
    else:
        apply_omvallen_patch()
