"""
For_You: gezamenlijk shot (cue td.samen.shot) in het show-TD.

Twee camera's naast elkaar op het staande scherm, met een eigen achtergrond en een eigen
voorgrond (bij Lingo: camera 2 en 3 achter één desk met de grote ballenbak).

Draaien in de Textport van TouchDesigner, met het showbestand open:

    exec(open('/Users/for_you/ForYou/main/show/td-qhub-test/apply_samen_shot_patch.py').read())

Wat het doet, in /project1:
- samen_achtergrond, samen_voorgrond (Movie File In)
- samen_cam_a / samen_cam_b (Select: cam2 en cam3, de gekeyde camera's)
  -> samen_fit_a / _b (Fit, verticaal passend in 1080x1920, zoals comp5)
  -> samen_plek_a / _b (Transform: kleiner, links en rechts, iets omhoog)
- samen_comp (Composite, over): voorgrond, camera a, camera b, achtergrond
- samen_aan (Constant CHOP, kanaal aan: 0/1)
- switch10 krijgt samen_comp als vierde ingang; index = 3 zolang samen_aan aan staat,
  anders de camera zoals nu. Ondertiteling en emoji blijven er dus overheen staan.
- td_qhub_router: /td/cue met td.samen.shot gaat naar handle_samen_shot. OSC-args na
  cueId/command/payloadId: uit (0/1), camera a, camera b, achtergrond, voorgrond, schaal, omhoog.
  Een nieuwe omgeving (td.environment.go) en td.reset zetten het shot uit.
- Bewaart NIET vanzelf (SAMEN_SAVE = False): project.save neemt de hele live stand mee.
  Zet SAMEN_SAVE = True om als nieuwe versie te bewaren, of bewaar zelf.

Terugdraaien: index van switch10 terug naar op('Camera_Switch')['camera'] en de vierde
ingang losmaken. Nogmaals draaien kan: wat er al staat, wordt hergebruikt.
"""

import os
import re

SAMEN_NEW_VERSION = None  # bijvoorbeeld "v1.27"; None = huidige versie + 1
SAMEN_SAVE = False

SAMEN_SWITCH_EXPR = "3 if op('samen_aan')['aan'] else op('Camera_Switch')['camera']"
SAMEN_SWITCH_EXPR_OLD = "op('Camera_Switch')['camera']"

ROUTER_MARKER = "# --- For_You gezamenlijk shot (td.samen.shot) ---"

ROUTER_CODE = ROUTER_MARKER + '''
def _samen_log(cue_id, stage, status, message):
    _append_row(
        "cue_log",
        ["at", "cueId", "command", "payloadId", "trigger", "stage", "status", "message"],
        [_now(), cue_id, "td.samen.shot", "-", "samen_shot", stage, status, message],
    )


def _samen_zet(aan, waarde):
    # De Constant CHOP heet in deze TD-versie const0value, in oudere value0.
    for naam in ("const0value", "value0"):
        par = getattr(aan.par, naam, None)
        if par is not None:
            par.val = waarde
            return True
    return False


def samen_uit():
    aan = _op("samen_aan")
    if aan is None:
        return False
    base = _base()
    base.store("samen_token", int(base.fetch("samen_token", 0) or 0) + 1)
    return _samen_zet(aan, 0)


def _samen_getal(extra_args, index, fallback):
    try:
        return float(extra_args[index])
    except (IndexError, ValueError):
        return fallback


def handle_samen_shot(cue_id, extra_args):
    # OSC-args: uit (0/1), camera a, camera b, achtergrond, voorgrond, schaal, omhoog.
    cue_id = _text(cue_id)
    command = "td.samen.shot"
    ack(cue_id, command, "received", "ok", "osc_received")
    uit = (_text(extra_args[0]) if len(extra_args) > 0 else "1") == "1"
    aan = _op("samen_aan")
    comp = _op("samen_comp")
    if aan is None or comp is None:
        _samen_log(cue_id, "error", "error", "samen_ops_missing")
        ack(cue_id, command, "error", "error", "samen_ops_missing")
        return False
    if uit:
        samen_uit()
        _samen_log(cue_id, "applied", "ok", "samen:uit")
        ack(cue_id, command, "applied", "ok", "samen:uit")
        return True
    cam_a = int(_samen_getal(extra_args, 1, 2))
    cam_b = int(_samen_getal(extra_args, 2, 3))
    achtergrond = _text(extra_args[3]) if len(extra_args) > 3 else ""
    voorgrond = _text(extra_args[4]) if len(extra_args) > 4 else ""
    schaal = _samen_getal(extra_args, 5, 0.6)
    omhoog = _samen_getal(extra_args, 6, 0.0)
    if cam_a not in (1, 2, 3) or cam_b not in (1, 2, 3) or not os.path.isfile(achtergrond):
        _samen_log(cue_id, "error", "error", "samen_invalid:%s %s %s" % (cam_a, cam_b, achtergrond))
        ack(cue_id, command, "error", "error", "samen_invalid")
        return False
    leeg = _empty_alpha_path()
    for name, file_path in (("samen_achtergrond", achtergrond), ("samen_voorgrond", voorgrond if os.path.isfile(voorgrond) else leeg)):
        movie = _op(name)
        if movie is not None and file_path and _text(movie.par.file.eval()) != file_path:
            movie.par.file = file_path
    for letter, camera, tx in (("a", cam_a, -0.25), ("b", cam_b, 0.25)):
        select = _op("samen_cam_%s" % letter)
        plek = _op("samen_plek_%s" % letter)
        if select is not None:
            select.par.top = "cam%d" % camera
        if plek is not None:
            plek.par.sx = schaal
            plek.par.sy = schaal
            plek.par.tx = tx
            plek.par.ty = omhoog
    base = _base()
    token = int(base.fetch("samen_token", 0) or 0) + 1
    base.store("samen_token", token)
    # Een Switch TOP kookt alleen de gekozen ingang: laat het shot eerst koken,
    # zodat het eerste beeld na het schakelen meteen klopt.
    try:
        comp.cook(force=True)
    except Exception as err:
        _samen_log(cue_id, "preload", "warning", err)
    run(
        "if args[1].fetch('samen_token', 0) == args[2]:\\n"
        "    args[3].cook(force=True)\\n"
        "    args[4](args[0], 1)",
        aan, base, token, comp, _samen_zet, delayFrames=3,
    )
    message = "samen:cam%d+cam%d schaal:%s omhoog:%s" % (cam_a, cam_b, schaal, omhoog)
    _samen_log(cue_id, "applied", "ok", message)
    ack(cue_id, command, "applied", "ok", message)
    return True
# --- einde For_You gezamenlijk shot ---


'''

ROUTER_CALL_OLD = '''    if command == "td.extra.shot":
        handle_extra_shot(cue_id, osc_args[3:])
        return
'''

ROUTER_CALL_NEW = '''    if command == "td.samen.shot":
        handle_samen_shot(cue_id, osc_args[3:])
        return
    if command in ("td.environment.go", "td.reset"):
        samen_uit()
''' + ROUTER_CALL_OLD


def patch_router_text(text):
    """Geeft de nieuwe routertekst terug. Zelfde tekst als hij al gepatcht is."""
    if ROUTER_MARKER in text:
        return text
    if text.count(ROUTER_CALL_OLD) != 1:
        raise RuntimeError("td_qhub_router: aanroep van td.extra.shot niet herkend, niets veranderd")
    anchor = "def _parse_callback_args(callback_args):"
    if text.count(anchor) != 1:
        raise RuntimeError("td_qhub_router: _parse_callback_args niet gevonden, niets veranderd")
    if "def _empty_alpha_path(" not in text:
        raise RuntimeError("td_qhub_router: _empty_alpha_path niet gevonden, niets veranderd")
    text = text.replace(ROUTER_CALL_OLD, ROUTER_CALL_NEW)
    return text.replace(anchor, ROUTER_CODE + anchor)


def _next_version_name(current_name):
    match = re.search(r"v(\d+)\.(\d+)\.toe$", current_name)
    if not match:
        raise RuntimeError("versie niet herkend in %s" % current_name)
    new_version = SAMEN_NEW_VERSION or "v%s.%s" % (match.group(1), int(match.group(2)) + 1)
    return current_name[:match.start()] + new_version + ".toe"


def _get_or_create(root, op_type, name, x, y):
    existing = root.op(name)
    if existing is not None:
        return existing
    created = root.create(op_type, name)
    created.nodeX = x
    created.nodeY = y
    return created


def _set(op_obj, name, value):
    par = getattr(op_obj.par, name, None)
    if par is None:
        print("For_You gezamenlijk shot: parameter %s ontbreekt op %s" % (name, op_obj.name))
        return
    try:
        par.val = value
    except Exception as err:
        print("For_You gezamenlijk shot: %s.%s = %s lukt niet: %s" % (op_obj.name, name, value, err))


def apply_samen_shot_patch():
    root = op("/project1")
    switch10 = root.op("switch10")
    router = root.op("td_qhub_router")
    for name in ("switch10", "td_qhub_router", "cam1", "cam2", "cam3", "Camera_Switch", "video1", "video2", "video3"):
        if root.op(name) is None:
            raise RuntimeError("niet gevonden: /project1/%s" % name)
    ingangen = [item.name if item is not None else "" for item in switch10.inputs]
    if ingangen[:3] != ["video1", "video2", "video3"]:
        raise RuntimeError("switch10 heeft andere ingangen dan video1-3 (%s); niets veranderd" % ingangen)
    if len(ingangen) > 3 and ingangen[3] != "samen_comp":
        raise RuntimeError("switch10 heeft al een vierde ingang (%s); niets veranderd" % ingangen[3])
    index_expr = switch10.par.index.expr.strip()
    if index_expr not in (SAMEN_SWITCH_EXPR_OLD, SAMEN_SWITCH_EXPR):
        raise RuntimeError("switch10: index is anders dan verwacht (%s); niets veranderd" % index_expr)

    # 1. Router eerst (alleen tekst): faalt dit, dan is het netwerk nog onaangeroerd.
    router.text = patch_router_text(router.text)

    # 2. Operators, onder switch10.
    x, y = switch10.nodeX, switch10.nodeY - 1500
    leeg = os.path.join(project.folder, "empty-alpha-1920x1080.png")

    aan = _get_or_create(root, constantCHOP, "samen_aan", x, y + 600)
    for naam, waarde in (("const0name", "aan"), ("name0", "aan"), ("const0value", 0), ("value0", 0)):
        par = getattr(aan.par, naam, None)
        if par is not None:
            par.val = waarde
    if aan.numChans != 1 or aan.chan(0).name != "aan":
        raise RuntimeError("samen_aan: kanaal 'aan' zetten lukt niet; netwerk verder onaangeroerd")

    achtergrond = _get_or_create(root, moviefileinTOP, "samen_achtergrond", x - 2400, y - 1800)
    voorgrond = _get_or_create(root, moviefileinTOP, "samen_voorgrond", x - 2400, y)
    for movie in (achtergrond, voorgrond):
        if os.path.isfile(leeg) and not movie.par.file.eval():
            movie.par.file = leeg

    plekken = []
    for letter, camera, tx, dy in (("a", 2, -0.25, -600), ("b", 3, 0.25, -1200)):
        select = _get_or_create(root, selectTOP, "samen_cam_%s" % letter, x - 2400, y + dy)
        select.par.top = "cam%d" % camera
        fit = _get_or_create(root, fitTOP, "samen_fit_%s" % letter, x - 1800, y + dy)
        fit.inputConnectors[0].connect(select)
        _set(fit, "fit", "fitvert")
        _set(fit, "outputresolution", "custom")
        _set(fit, "resolutionw", 1080)
        _set(fit, "resolutionh", 1920)
        _set(fit, "outputaspect", "resolution")
        plek = _get_or_create(root, transformTOP, "samen_plek_%s" % letter, x - 1200, y + dy)
        plek.inputConnectors[0].connect(fit)
        _set(plek, "extend", "zero")
        _set(plek, "sx", 0.6)
        _set(plek, "sy", 0.6)
        _set(plek, "tx", tx)
        _set(plek, "ty", 0.077)
        plekken.append(plek)

    comp = _get_or_create(root, compositeTOP, "samen_comp", x - 600, y - 600)
    for index, bron in enumerate([voorgrond, plekken[0], plekken[1], achtergrond]):
        comp.inputConnectors[index].connect(bron)
    _set(comp, "operand", "over")
    _set(comp, "prefit", "fill")
    _set(comp, "outputresolution", "custom")
    _set(comp, "resolutionw", 1080)
    _set(comp, "resolutionh", 1920)
    _set(comp, "outputaspect", "resolution")

    # 3. switch10: vierde ingang en de keuze.
    switch10.inputConnectors[3].connect(comp)
    switch10.par.index.expr = SAMEN_SWITCH_EXPR

    # 4. Bewaren alleen als daarom gevraagd is.
    if not SAMEN_SAVE:
        print("For_You gezamenlijk shot: klaar, NIET bewaard (SAMEN_SAVE = False)")
        return None
    current_name = os.path.basename(project.name if project.name.endswith(".toe") else project.name + ".toe")
    new_name = _next_version_name(current_name)
    new_path = os.path.join(project.folder, new_name)
    if os.path.exists(new_path):
        raise RuntimeError("bestaat al, niet overschreven: %s" % new_path)
    variables = op("/local/set_variables")
    if variables is not None and variables.row("TOENAME") is not None:
        variables["TOENAME", 1] = new_name
    project.save(new_path)
    print("For_You gezamenlijk shot: klaar, bewaard als", new_path)
    return new_path


if __name__ != "samen_shot_offline_test":
    try:
        op  # alleen binnen TouchDesigner
    except NameError:
        pass
    else:
        apply_samen_shot_patch()
