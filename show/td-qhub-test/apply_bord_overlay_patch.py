"""
For_You: losse laag over elk shot (het Lingo-bord) in het show-TD.

Staat er "overlay" in omvallen.json van een omgeving, dan stuurt show control bij
td.effect.omvallen drie extra OSC-args mee (midden x, midden y, breedte; deel van het beeld).
De clip vervangt dan niet de voorgrond van één paneel, maar komt als kleine laag over het
gekozen shot: elke camera en het gezamenlijke shot. Ondertiteling en emoji blijven erboven.

Draaien in de Textport van TouchDesigner, met het showbestand open:

    exec(open('/Users/for_you/ForYou/main/show/td-qhub-test/apply_bord_overlay_patch.py').read())

Wat het doet, in /project1:
- bord_bestand (Movie File In) -> bord_fit (Fit, breedte van het beeld) -> bord_plek (Transform)
- bord_over (Over): bord_plek over switch10
- bord_keuze (Switch): 0 = switch10 (zoals nu), 1 = bord_over. Alles wat aan switch10 hing
  (over_emoji, hoofd_een) hangt daarna aan bord_keuze.
- td_qhub_router: handle_omvallen stuurt een clip met plaats naar de laag; omvallen_uit
  (ook bij een nieuwe omgeving, reset en het einde van de scène) haalt de laag weg.
- Bewaart NIET vanzelf (BORD_SAVE = False).

Terugdraaien: over_emoji en hoofd_een weer aan switch10 hangen (of de vorige versie openen).
Nogmaals draaien kan: wat er al staat, wordt hergebruikt.
"""

import os
import re

BORD_NEW_VERSION = None  # bijvoorbeeld "v1.41"; None = huidige versie + 1
BORD_SAVE = False

ROUTER_MARKER = "# --- For_You laag over elk shot (td.effect.omvallen met plaats) ---"

ROUTER_CODE = ROUTER_MARKER + '''
def bord_uit():
    keuze = _op("bord_keuze")
    if keuze is None:
        return False
    base = _base()
    base.store("bord_token", int(base.fetch("bord_token", 0) or 0) + 1)
    keuze.par.index = 0
    return True


def _bord_getal(extra_args, index, fallback):
    try:
        return float(extra_args[index])
    except (IndexError, ValueError):
        return fallback


def handle_bord_overlay(cue_id, file_path, duur, extra_args):
    # OSC-args 3-5 van td.effect.omvallen: midden x, midden y, breedte (deel van het beeld).
    command = "td.effect.omvallen"
    movie = _op("bord_bestand")
    plek = _op("bord_plek")
    keuze = _op("bord_keuze")
    if movie is None or plek is None or keuze is None:
        _omvallen_log(cue_id, "error", "error", "bord_ops_missing")
        ack(cue_id, command, "error", "error", "bord_ops_missing")
        return False
    if not os.path.isfile(file_path):
        _omvallen_log(cue_id, "error", "error", "omvallen_file_missing:%s" % file_path)
        ack(cue_id, command, "error", "error", "omvallen_file_missing")
        return False
    x = _bord_getal(extra_args, 3, 0.5)
    y = _bord_getal(extra_args, 4, 0.5)
    breedte = _bord_getal(extra_args, 5, 0.6) or 0.6
    plek.par.sx = breedte
    plek.par.sy = breedte
    plek.par.tx = x - 0.5
    plek.par.ty = 0.5 - y
    base = _base()
    token = int(base.fetch("bord_token", 0) or 0) + 1
    base.store("bord_token", token)
    # De clip speelt een keer en blijft op het laatste beeld staan: dat is de nieuwe stand.
    try:
        movie.par.play = 0
    except Exception:
        pass
    movie.par.file = file_path
    if hasattr(movie.par, "cuepulse"):
        movie.par.cuepulse.pulse()
    try:
        if hasattr(movie, "preload"):
            movie.preload()
        movie.cook(force=True)
    except Exception as err:
        _omvallen_log(cue_id, "preload", "warning", err)
    run(
        "if args[1].fetch('bord_token', 0) == args[2]:\\n"
        "    args[0].par.index = 1\\n"
        "    if hasattr(args[3].par, 'cuepulse'):\\n"
        "        args[3].par.cuepulse.pulse()\\n"
        "    args[3].par.play = 1",
        keuze, base, token, movie, delayFrames=3,
    )
    if duur > 0:
        run(
            "if args[1].fetch('bord_token', 0) == args[2]:\\n    args[0].par.play = 0",
            movie, base, token, delayMilliSeconds=int(duur * 1000) - 60,
        )
    message = "laag:%s x:%s y:%s breedte:%s" % (os.path.basename(file_path), x, y, breedte)
    _omvallen_log(cue_id, "applied", "ok", message)
    ack(cue_id, command, "applied", "ok", message)
    return True
# --- einde For_You laag over elk shot ---


'''

UIT_OLD = '''def omvallen_uit():
    # Terug naar de gewone voorgrond. Ook bij een nieuwe omgeving en bij reset.
'''
UIT_NEW = UIT_OLD + '''    bord_uit()
'''

HANDLE_OLD = '''        duur = 0.0
    movie = _op(OMVALLEN_FILE_OP)
    switch = _op(OMVALLEN_SWITCH_OP)
'''
HANDLE_NEW = '''        duur = 0.0
    if len(extra_args) > 5 and file_path and not uit:
        return handle_bord_overlay(cue_id, file_path, duur, extra_args)
    movie = _op(OMVALLEN_FILE_OP)
    switch = _op(OMVALLEN_SWITCH_OP)
'''

ROUTER_ANCHOR = "# --- For_You effect omvallen (td.effect.omvallen) ---"


def patch_router_text(text):
    """Geeft de nieuwe routertekst terug. Zelfde tekst als hij al gepatcht is."""
    if ROUTER_MARKER in text:
        return text
    for naam, stuk in (("omvallen_uit", UIT_OLD), ("handle_omvallen", HANDLE_OLD), ("begin omvallen", ROUTER_ANCHOR)):
        if text.count(stuk) != 1:
            raise RuntimeError("td_qhub_router: %s niet herkend, niets veranderd" % naam)
    text = text.replace(UIT_OLD, UIT_NEW).replace(HANDLE_OLD, HANDLE_NEW)
    return text.replace(ROUTER_ANCHOR, ROUTER_CODE + ROUTER_ANCHOR)


def _next_version_name(current_name):
    match = re.search(r"v(\d+)\.(\d+)\.toe$", current_name)
    if not match:
        raise RuntimeError("versie niet herkend in %s" % current_name)
    new_version = BORD_NEW_VERSION or "v%s.%s" % (match.group(1), int(match.group(2)) + 1)
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
        print("For_You laag over elk shot: parameter %s ontbreekt op %s" % (name, op_obj.name))
        return
    try:
        par.val = value
    except Exception as err:
        print("For_You laag over elk shot: %s.%s = %s lukt niet: %s" % (op_obj.name, name, value, err))


def apply_bord_overlay_patch():
    root = op("/project1")
    switch10 = root.op("switch10")
    router = root.op("td_qhub_router")
    if switch10 is None or router is None:
        raise RuntimeError("niet gevonden: /project1/switch10 of /project1/td_qhub_router")
    afnemers = [item for item in switch10.outputs if item.name not in ("bord_over", "bord_keuze")]
    if root.op("bord_keuze") is None and not afnemers:
        raise RuntimeError("switch10 heeft geen afnemers; niets veranderd")

    # 1. Router eerst (alleen tekst): faalt dit, dan is het netwerk nog onaangeroerd.
    router.text = patch_router_text(router.text)

    # 2. Operators, naast switch10.
    x, y = switch10.nodeX, switch10.nodeY + 700
    leeg = os.path.join(project.folder, "empty-alpha-1920x1080.png")

    movie = _get_or_create(root, moviefileinTOP, "bord_bestand", x - 900, y)
    if os.path.isfile(leeg) and not movie.par.file.eval():
        movie.par.file = leeg
    _set(movie, "playmode", "sequential")
    _set(movie, "extendright", "hold")
    _set(movie, "loop", 0)

    fit = _get_or_create(root, fitTOP, "bord_fit", x - 600, y)
    fit.inputConnectors[0].connect(movie)
    _set(fit, "fit", "fithorz")
    _set(fit, "outputresolution", "custom")
    fit.par.resolutionw.expr = "op('switch10').width"
    fit.par.resolutionh.expr = "op('switch10').height"
    _set(fit, "outputaspect", "resolution")

    plek = _get_or_create(root, transformTOP, "bord_plek", x - 300, y)
    plek.inputConnectors[0].connect(fit)
    _set(plek, "extend", "zero")
    _set(plek, "sx", 0.6)
    _set(plek, "sy", 0.6)

    over = _get_or_create(root, overTOP, "bord_over", x, y)
    over.inputConnectors[0].connect(plek)
    over.inputConnectors[1].connect(switch10)

    keuze = _get_or_create(root, switchTOP, "bord_keuze", x + 300, y)
    keuze.inputConnectors[0].connect(switch10)
    keuze.inputConnectors[1].connect(over)
    keuze.par.index = 0

    # 3. Wat aan switch10 hing, hangt nu aan bord_keuze.
    for afnemer in afnemers:
        for connector in afnemer.inputConnectors:
            if any(verbinding.owner == switch10 for verbinding in connector.connections):
                connector.connect(keuze)
    print("For_You laag over elk shot: omgelegd naar bord_keuze:", [item.name for item in afnemers])

    # 4. Bewaren alleen als daarom gevraagd is.
    if not BORD_SAVE:
        print("For_You laag over elk shot: klaar, NIET bewaard (BORD_SAVE = False)")
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
    print("For_You laag over elk shot: klaar, bewaard als", new_path)
    return new_path


if __name__ != "bord_overlay_offline_test":
    try:
        op  # alleen binnen TouchDesigner
    except NameError:
        pass
    else:
        apply_bord_overlay_patch()
