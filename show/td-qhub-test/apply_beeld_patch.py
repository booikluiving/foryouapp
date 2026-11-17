"""
For_You: één beeld met de spelers erin (td.samen.beeld), voor het trolleyprobleem.

De omgeving is één plaat (de meme). De drie gekeyde camera's staan er klein in, elk op een eigen
plek, gedraaid en onderaan afgesneden; daaroverheen een voorgrond (benen, touwen, de tram).
Show control rekent alles uit en stuurt het mee; dit netwerk zet het alleen neer.

Draaien in de Textport van het live project, of via de opdrachtenmap. Bewaart NIET, tenzij
BEELD_SAVE = True.

Wat erbij komt, naast het gezamenlijke shot (dat blijft zoals het is):
- beeld_aan (Constant CHOP, kanaal "aan")
- beeld_achtergrond, beeld_voorgrond (Movie File In)
- per camera 1-3: beeld_cam_N (Select: camN, de gekeyde camera) -> beeld_fit_N (Fit, 1080x1920)
  -> beeld_snij_N (Transform: schuift omlaag, wat onder de rand valt is weg)
  -> beeld_plek_N (Transform: schaal, draaiing, plek)
- beeld_comp (Composite, over): voorgrond, camera 1, 2, 3, achtergrond
- switch10 krijgt een vijfde ingang; de keuze wordt: het ene beeld als beeld_aan aan staat,
  anders het gezamenlijke shot als samen_aan aan staat, anders de camera zoals nu.
- td_qhub_router: handle_samen_beeld. OSC-args na cueId/command/payloadId:
  uit (0/1), achtergrond, voorgrond, duur, en per camera: nummer, schaal, draai, tx, ty, snij.
  td.environment.go en td.reset zetten het uit.

Terugdraaien: index van switch10 terug naar de oude uitdrukking en de vijfde ingang losmaken.
"""

import os
import re

BEELD_NEW_VERSION = None  # bijvoorbeeld "v1.45"; None = huidige versie + 1
BEELD_SAVE = False

BEELD_SWITCH_EXPR_OLD = "3 if op('samen_aan')['aan'] else op('Camera_Switch')['camera']"
BEELD_SWITCH_EXPR = "4 if op('beeld_aan')['aan'] else (3 if op('samen_aan')['aan'] else op('Camera_Switch')['camera'])"

ROUTER_MARKER = "# --- For_You een beeld met de spelers erin (td.samen.beeld) ---"

ROUTER_CODE = ROUTER_MARKER + '''
def _beeld_log(cue_id, stage, status, message):
    _append_row(
        "cue_log",
        ["at", "cueId", "command", "payloadId", "trigger", "stage", "status", "message"],
        [_now(), cue_id, "td.samen.beeld", "-", "samen_beeld", stage, status, message],
    )


def _beeld_zet(aan, waarde):
    for naam in ("const0value", "value0"):
        par = getattr(aan.par, naam, None)
        if par is not None:
            par.val = waarde
            return True
    return False


def beeld_uit():
    aan = _op("beeld_aan")
    if aan is None:
        return False
    base = _base()
    base.store("beeld_token", int(base.fetch("beeld_token", 0) or 0) + 1)
    return _beeld_zet(aan, 0)


def _beeld_getal(extra_args, index, fallback):
    try:
        return float(extra_args[index])
    except (IndexError, ValueError):
        return fallback


def handle_samen_beeld(cue_id, extra_args):
    # OSC-args: uit (0/1), achtergrond, voorgrond, duur, dan per camera zes getallen:
    # nummer, schaal, draai (graden), tx, ty (deel van het scherm), snij (deel dat onderaan afgaat).
    cue_id = _text(cue_id)
    command = "td.samen.beeld"
    ack(cue_id, command, "received", "ok", "osc_received")
    uit = (_text(extra_args[0]) if len(extra_args) > 0 else "1") == "1"
    aan = _op("beeld_aan")
    comp = _op("beeld_comp")
    if aan is None or comp is None:
        _beeld_log(cue_id, "error", "error", "beeld_ops_missing")
        ack(cue_id, command, "error", "error", "beeld_ops_missing")
        return False
    if uit:
        beeld_uit()
        _beeld_log(cue_id, "applied", "ok", "beeld:uit")
        ack(cue_id, command, "applied", "ok", "beeld:uit")
        return True
    achtergrond = _text(extra_args[1]) if len(extra_args) > 1 else ""
    voorgrond = _text(extra_args[2]) if len(extra_args) > 2 else ""
    duur = _beeld_getal(extra_args, 3, 0.0)
    if not os.path.isfile(achtergrond):
        _beeld_log(cue_id, "error", "error", "beeld_invalid:%s" % achtergrond)
        ack(cue_id, command, "error", "error", "beeld_invalid")
        return False
    base = _base()
    token = int(base.fetch("beeld_token", 0) or 0) + 1
    base.store("beeld_token", token)
    movie = _op("beeld_achtergrond")
    if movie is not None and _text(movie.par.file.eval()) != achtergrond:
        movie.par.file = achtergrond
    voor = _op("beeld_voorgrond")
    voor_pad = voorgrond if os.path.isfile(voorgrond) else _empty_alpha_path()
    clip = duur > 0 and voor_pad.lower().endswith(".mov")
    if voor is not None and voor_pad:
        if clip:
            # De clip speelt een keer en blijft op het laatste beeld staan.
            try:
                voor.par.play = 0
            except Exception:
                pass
            voor.par.file = voor_pad
            if hasattr(voor.par, "cuepulse"):
                voor.par.cuepulse.pulse()
        elif _text(voor.par.file.eval()) != voor_pad:
            voor.par.file = voor_pad
    for nummer in (1, 2, 3):
        start = 4 + (nummer - 1) * 6
        camera = int(_beeld_getal(extra_args, start, nummer))
        schaal = _beeld_getal(extra_args, start + 1, 0.0)
        select = _op("beeld_cam_%d" % nummer)
        snij = _op("beeld_snij_%d" % nummer)
        plek = _op("beeld_plek_%d" % nummer)
        if select is not None and camera in (1, 2, 3):
            select.par.top = "cam%d" % camera
        if snij is not None:
            snij.par.ty = -_beeld_getal(extra_args, start + 5, 0.0)
        if plek is not None:
            plek.par.sx = schaal
            plek.par.sy = schaal
            plek.par.rotate = _beeld_getal(extra_args, start + 2, 0.0)
            plek.par.tx = _beeld_getal(extra_args, start + 3, 0.0)
            plek.par.ty = _beeld_getal(extra_args, start + 4, 0.0)
    try:
        if clip and hasattr(voor, "preload"):
            voor.preload()
        comp.cook(force=True)
    except Exception as err:
        _beeld_log(cue_id, "preload", "warning", err)
    run(
        "if args[1].fetch('beeld_token', 0) == args[2]:\\n"
        "    args[3].cook(force=True)\\n"
        "    args[4](args[0], 1)\\n"
        "    if args[6]:\\n"
        "        if hasattr(args[5].par, 'cuepulse'):\\n"
        "            args[5].par.cuepulse.pulse()\\n"
        "        args[5].par.play = 1",
        aan, base, token, comp, _beeld_zet, voor, clip, delayFrames=3,
    )
    if clip:
        # Vangnet als de clip toch zou herhalen: stilzetten vlak voor het einde.
        run(
            "if args[1].fetch('beeld_token', 0) == args[2]:\\n    args[0].par.play = 0",
            voor, base, token, delayMilliSeconds=int(duur * 1000) - 60,
        )
    message = "beeld:%s voor:%s" % (os.path.basename(achtergrond), os.path.basename(voor_pad))
    _beeld_log(cue_id, "applied", "ok", message)
    ack(cue_id, command, "applied", "ok", message)
    return True
# --- einde For_You een beeld met de spelers erin ---


'''

ROUTER_CALL_OLD = '''    if command == "td.samen.shot":
        handle_samen_shot(cue_id, osc_args[3:])
        return
'''

ROUTER_CALL_NEW = '''    if command == "td.samen.beeld":
        handle_samen_beeld(cue_id, osc_args[3:])
        return
    if command in ("td.environment.go", "td.reset"):
        beeld_uit()
''' + ROUTER_CALL_OLD


def patch_router_text(text):
    """Geeft de nieuwe routertekst terug. Zelfde tekst als hij al gepatcht is."""
    if ROUTER_MARKER in text:
        return text
    if text.count(ROUTER_CALL_OLD) != 1:
        raise RuntimeError("td_qhub_router: aanroep van td.samen.shot niet herkend, niets veranderd")
    anchor = "def _parse_callback_args(callback_args):"
    if text.count(anchor) != 1:
        raise RuntimeError("td_qhub_router: _parse_callback_args niet gevonden, niets veranderd")
    for nodig in ("def _empty_alpha_path(", "def _append_row(", "def _base(", "def _op(", "def ack("):
        if nodig not in text:
            raise RuntimeError("td_qhub_router: %s niet gevonden, niets veranderd" % nodig)
    text = text.replace(ROUTER_CALL_OLD, ROUTER_CALL_NEW)
    return text.replace(anchor, ROUTER_CODE + anchor)


def _next_version_name(current_name):
    match = re.search(r"v(\d+)\.(\d+)\.toe$", current_name)
    if not match:
        raise RuntimeError("versie niet herkend in %s" % current_name)
    new_version = BEELD_NEW_VERSION or "v%s.%s" % (match.group(1), int(match.group(2)) + 1)
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
        print("For_You een beeld: parameter %s ontbreekt op %s" % (name, op_obj.name))
        return
    try:
        par.val = value
    except Exception as err:
        print("For_You een beeld: %s.%s = %s lukt niet: %s" % (op_obj.name, name, value, err))


def apply_beeld_patch():
    root = op("/project1")
    switch10 = root.op("switch10")
    router = root.op("td_qhub_router")
    for name in ("switch10", "td_qhub_router", "cam1", "cam2", "cam3", "Camera_Switch", "samen_aan", "samen_comp"):
        if root.op(name) is None:
            raise RuntimeError("niet gevonden: /project1/%s" % name)
    ingangen = [item.name if item is not None else "" for item in switch10.inputs]
    if ingangen[:4] != ["video1", "video2", "video3", "samen_comp"]:
        raise RuntimeError("switch10 heeft andere ingangen dan video1-3 en samen_comp (%s); niets veranderd" % ingangen)
    if len(ingangen) > 4 and ingangen[4] != "beeld_comp":
        raise RuntimeError("switch10 heeft al een vijfde ingang (%s); niets veranderd" % ingangen[4])
    index_expr = switch10.par.index.expr.strip()
    if index_expr not in (BEELD_SWITCH_EXPR_OLD, BEELD_SWITCH_EXPR):
        raise RuntimeError("switch10: index is anders dan verwacht (%s); niets veranderd" % index_expr)

    # 1. Router eerst (alleen tekst): faalt dit, dan is het netwerk nog onaangeroerd.
    router.text = patch_router_text(router.text)

    # 2. Operators, onder het gezamenlijke shot.
    x, y = switch10.nodeX, switch10.nodeY - 4500
    leeg = os.path.join(project.folder, "empty-alpha-1920x1080.png")

    aan = _get_or_create(root, constantCHOP, "beeld_aan", x, y + 600)
    for naam, waarde in (("const0name", "aan"), ("name0", "aan"), ("const0value", 0), ("value0", 0)):
        par = getattr(aan.par, naam, None)
        if par is not None:
            par.val = waarde
    if aan.numChans != 1 or aan.chan(0).name != "aan":
        raise RuntimeError("beeld_aan: kanaal 'aan' zetten lukt niet; netwerk verder onaangeroerd")

    achtergrond = _get_or_create(root, moviefileinTOP, "beeld_achtergrond", x - 3000, y - 2400)
    voorgrond = _get_or_create(root, moviefileinTOP, "beeld_voorgrond", x - 3000, y)
    for movie in (achtergrond, voorgrond):
        if os.path.isfile(leeg) and not movie.par.file.eval():
            movie.par.file = leeg

    plekken = []
    for nummer in (1, 2, 3):
        dy = -600 * nummer
        select = _get_or_create(root, selectTOP, "beeld_cam_%d" % nummer, x - 3000, y + dy)
        select.par.top = "cam%d" % nummer
        fit = _get_or_create(root, fitTOP, "beeld_fit_%d" % nummer, x - 2400, y + dy)
        fit.inputConnectors[0].connect(select)
        _set(fit, "fit", "fitvert")
        _set(fit, "outputresolution", "custom")
        _set(fit, "resolutionw", 1080)
        _set(fit, "resolutionh", 1920)
        _set(fit, "outputaspect", "resolution")
        snij = _get_or_create(root, transformTOP, "beeld_snij_%d" % nummer, x - 1800, y + dy)
        snij.inputConnectors[0].connect(fit)
        _set(snij, "extend", "zero")
        _set(snij, "ty", 0)
        plek = _get_or_create(root, transformTOP, "beeld_plek_%d" % nummer, x - 1200, y + dy)
        plek.inputConnectors[0].connect(snij)
        _set(plek, "extend", "zero")
        _set(plek, "sx", 0.2)
        _set(plek, "sy", 0.2)
        _set(plek, "rotate", 0)
        plekken.append(plek)

    comp = _get_or_create(root, compositeTOP, "beeld_comp", x - 600, y - 1200)
    for index, bron in enumerate([voorgrond, plekken[0], plekken[1], plekken[2], achtergrond]):
        comp.inputConnectors[index].connect(bron)
    _set(comp, "operand", "over")
    _set(comp, "prefit", "fill")
    _set(comp, "outputresolution", "custom")
    _set(comp, "resolutionw", 1080)
    _set(comp, "resolutionh", 1920)
    _set(comp, "outputaspect", "resolution")

    # 3. switch10: vijfde ingang en de keuze.
    switch10.inputConnectors[4].connect(comp)
    switch10.par.index.expr = BEELD_SWITCH_EXPR

    # 4. Bewaren alleen als daarom gevraagd is.
    if not BEELD_SAVE:
        print("For_You een beeld: klaar, NIET bewaard (BEELD_SAVE = False)")
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
    print("For_You een beeld: klaar, bewaard als", new_path)
    return new_path


if __name__ != "beeld_offline_test":
    try:
        op  # alleen binnen TouchDesigner
    except NameError:
        pass
    else:
        apply_beeld_patch()
