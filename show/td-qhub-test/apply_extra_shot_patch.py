"""
For_You: extra shot per omgeving (cue td.extra.shot) in het show-TD.

Draaien in de Textport van TouchDesigner, met "Najaar 2026 v1.13" (of hoger) open:

    exec(open('/Users/for_you/ForYou/main/show/td-qhub-test/apply_extra_shot_patch.py').read())

Wat het doet, in /project1:
- extra_shot_bestand (Movie File In) -> extra_shot_fit (Fit, vult het staande mainbeeld)
- extra_shot_switch (Switch): 0 = phase_switch_maindisplay (zoals nu), 1 = het shot
- fit2 krijgt extra_shot_switch als ingang in plaats van phase_switch_maindisplay.
  Main_TV, videodevout4, window1 en auto_open_lg_window blijven zoals ze zijn.
- td_qhub_router: /td/cue met command td.extra.shot gaat naar handle_extra_shot.
  Bestand, duur en uit komen als OSC-args 4-6 mee: geen HTTP, geen payload-fetch.
- Bewaart als een nieuwe versie (v1.13 -> v1.14) en zet TOENAME mee.

Terugdraaien: fit2 weer aan phase_switch_maindisplay hangen en de vorige versie openen.
Nogmaals draaien kan: wat er al staat, wordt hergebruikt.
"""

import os
import re

EXTRA_SHOT_NEW_VERSION = None  # bijvoorbeeld "v1.14"; None = huidige versie + 1

ROUTER_MARKER = "# --- For_You extra shot (td.extra.shot) ---"

ROUTER_CODE = ROUTER_MARKER + '''
EXTRA_SHOT_FILE_OP = "extra_shot_bestand"
EXTRA_SHOT_SWITCH_OP = "extra_shot_switch"


def _extra_shot_log(cue_id, stage, status, message):
    _append_row(
        "cue_log",
        ["at", "cueId", "command", "payloadId", "trigger", "stage", "status", "message"],
        [_now(), cue_id, "td.extra.shot", "-", "extra_shot", stage, status, message],
    )


def handle_extra_shot(cue_id, extra_args):
    # OSC-args na cueId/command/payloadId: filePath, duur (s, 0 = blijft staan), uit (0/1).
    cue_id = _text(cue_id)
    command = "td.extra.shot"
    ack(cue_id, command, "received", "ok", "osc_received")
    file_path = _text(extra_args[0]) if len(extra_args) > 0 else ""
    try:
        duur = float(extra_args[1]) if len(extra_args) > 1 else 4.0
    except ValueError:
        duur = 4.0
    uit = (_text(extra_args[2]) if len(extra_args) > 2 else "0") == "1"
    movie = _op(EXTRA_SHOT_FILE_OP)
    switch = _op(EXTRA_SHOT_SWITCH_OP)
    if movie is None or switch is None:
        _extra_shot_log(cue_id, "error", "error", "extra_shot_ops_missing")
        ack(cue_id, command, "error", "error", "extra_shot_ops_missing")
        return False
    base = _base()
    token = int(base.fetch("extra_shot_token", 0) or 0) + 1
    base.store("extra_shot_token", token)
    if uit or not file_path:
        switch.par.index = 0
        _extra_shot_log(cue_id, "applied", "ok", "extra_shot:uit")
        ack(cue_id, command, "applied", "ok", "extra_shot:uit")
        return True
    if not os.path.isfile(file_path):
        _extra_shot_log(cue_id, "error", "error", "extra_shot_file_missing:%s" % file_path)
        ack(cue_id, command, "error", "error", "extra_shot_file_missing")
        return False
    if _text(movie.par.file.eval()) != file_path:
        movie.par.file = file_path
    elif hasattr(movie.par, "cuepulse"):
        movie.par.cuepulse.pulse()
    # Pas schakelen als het bestand er een paar frames is; laden gebeurt niet in de cook.
    run(
        "if args[1].fetch('extra_shot_token', 0) == args[2]:\\n    args[0].par.index = 1",
        switch, base, token, delayFrames=3,
    )
    if duur > 0:
        run(
            "if args[1].fetch('extra_shot_token', 0) == args[2]:\\n    args[0].par.index = 0",
            switch, base, token, delayMilliSeconds=int(duur * 1000) + 60,
        )
    message = "extra_shot:%s duur:%s" % (os.path.basename(file_path), duur)
    _extra_shot_log(cue_id, "applied", "ok", message)
    ack(cue_id, command, "applied", "ok", message)
    return True
# --- einde For_You extra shot ---


'''

ROUTER_CALL_OLD = '''    payload_id = osc_args[2] if len(osc_args) > 2 else "-"
    handle_td_cue(cue_id, command, payload_id)
    return
'''

ROUTER_CALL_NEW = '''    payload_id = osc_args[2] if len(osc_args) > 2 else "-"
    if command == "td.extra.shot":
        handle_extra_shot(cue_id, osc_args[3:])
        return
    handle_td_cue(cue_id, command, payload_id)
    return
'''


def patch_router_text(text):
    """Geeft de nieuwe routertekst terug. Zelfde tekst als hij al gepatcht is."""
    if ROUTER_MARKER in text:
        return text
    if text.count(ROUTER_CALL_OLD) != 1:
        raise RuntimeError("td_qhub_router: onReceiveOSC niet herkend, niets veranderd")
    anchor = "def _parse_callback_args(callback_args):"
    if text.count(anchor) != 1:
        raise RuntimeError("td_qhub_router: _parse_callback_args niet gevonden, niets veranderd")
    text = text.replace(ROUTER_CALL_OLD, ROUTER_CALL_NEW)
    return text.replace(anchor, ROUTER_CODE + anchor)


def _next_version_name(current_name):
    match = re.search(r"v(\d+)\.(\d+)\.toe$", current_name)
    if not match:
        raise RuntimeError("versie niet herkend in %s" % current_name)
    new_version = EXTRA_SHOT_NEW_VERSION or "v%s.%s" % (match.group(1), int(match.group(2)) + 1)
    return current_name[:match.start()] + new_version + ".toe"


def _get_or_create(root, op_type, name, x, y):
    existing = root.op(name)
    if existing is not None:
        return existing
    created = root.create(op_type, name)
    created.nodeX = x
    created.nodeY = y
    return created


def apply_extra_shot_patch():
    root = op("/project1")
    phase = root.op("phase_switch_maindisplay")
    fit2 = root.op("fit2")
    router = root.op("td_qhub_router")
    for name, item in [("phase_switch_maindisplay", phase), ("fit2", fit2), ("td_qhub_router", router)]:
        if item is None:
            raise RuntimeError("niet gevonden: /project1/%s" % name)
    current_input = fit2.inputs[0] if fit2.inputs else None
    if current_input is None or current_input.name not in ("phase_switch_maindisplay", "extra_shot_switch"):
        raise RuntimeError("fit2 hangt niet aan phase_switch_maindisplay; niets veranderd")

    # 1. Router eerst (alleen tekst): faalt dit, dan is het netwerk nog onaangeroerd.
    router.text = patch_router_text(router.text)

    # 2. Operators, tussen phase_switch_maindisplay en fit2.
    x, y = phase.nodeX, phase.nodeY
    movie = _get_or_create(root, moviefileinTOP, "extra_shot_bestand", x, y - 1300)
    empty = os.path.join(project.folder, "empty-alpha-1920x1080.png")
    if os.path.isfile(empty) and not movie.par.file.eval():
        movie.par.file = empty
    if hasattr(movie.par, "playmode"):
        try:
            movie.par.playmode = "sequential"
        except Exception:
            pass

    fit = _get_or_create(root, fitTOP, "extra_shot_fit", x + 1200, y - 1300)
    fit.inputConnectors[0].connect(movie)
    fit.par.fit = "fill"
    fit.par.outputresolution = "custom"
    fit.par.resolutionw.expr = "op('phase_switch_maindisplay').width"
    fit.par.resolutionh.expr = "op('phase_switch_maindisplay').height"

    switch = _get_or_create(root, switchTOP, "extra_shot_switch", x + 1200, y - 500)
    switch.inputConnectors[0].connect(phase)
    switch.inputConnectors[1].connect(fit)
    switch.par.index = 0

    # 3. fit2 aan de switch (Main_TV, videodevout4 en window1 blijven zoals ze zijn).
    fit2.inputConnectors[0].connect(switch)

    # 4. Bewaren als nieuwe versie, met TOENAME mee.
    current_name = os.path.basename(project.name if project.name.endswith(".toe") else project.name + ".toe")
    new_name = _next_version_name(current_name)
    variables = op("/local/set_variables")
    if variables is not None and variables.row("TOENAME") is not None:
        variables["TOENAME", 1] = new_name
    new_path = os.path.join(project.folder, new_name)
    if os.path.exists(new_path):
        raise RuntimeError("bestaat al, niet overschreven: %s" % new_path)
    project.save(new_path)
    print("For_You extra shot: klaar, bewaard als", new_path)
    return new_path


if __name__ != "extra_shot_offline_test":
    try:
        op  # alleen binnen TouchDesigner
    except NameError:
        pass
    else:
        apply_extra_shot_patch()
