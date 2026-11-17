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


def _beeld_tp_uit():
    aan = _op("beeld_tp_aan")
    if aan is None:
        return False
    base = _base()
    base.store("beeld_tp_token", int(base.fetch("beeld_tp_token", 0) or 0) + 1)
    return _beeld_zet(aan, 0)


def beeld_uit():
    _beeld_tp_uit()
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


def _beeld_tekst(extra_args, index):
    return _text(extra_args[index]) if len(extra_args) > index else ""


def _beeld_movie(movie, pad, clip):
    # Zet een plaat of clip klaar; een clip speelt pas als _beeld_speel hem start.
    if movie is None or not pad:
        return
    if clip:
        try:
            movie.par.play = 0
        except Exception:
            pass
        movie.par.file = pad
        if hasattr(movie.par, "cuepulse"):
            movie.par.cuepulse.pulse()
        return
    # Een stilstaande plaat. Na een clip staat afspelen uit (vangnet aan het eind van de clip), en
    # zolang dat uit staat leest de Movie File In geen nieuw bestand in: dan bleef de voorgrond van
    # het vorige shot over het nieuwe staan. Dus altijd eerst afspelen aan.
    try:
        movie.par.play = 1
    except Exception:
        pass
    if _text(movie.par.file.eval()) != pad:
        movie.par.file = pad


def _beeld_speel(movie):
    if movie is None:
        return
    if hasattr(movie.par, "cuepulse"):
        movie.par.cuepulse.pulse()
    movie.par.play = 1


def _beeld_spelers(extra_args, start, voorvoegsel_snij, voorvoegsel_plek, met_camera_keuze):
    # Per camera zes getallen: nummer, schaal, draai, tx, ty, snij.
    for nummer in (1, 2, 3):
        begin = start + (nummer - 1) * 6
        camera = int(_beeld_getal(extra_args, begin, nummer))
        if met_camera_keuze:
            select = _op("beeld_cam_%d" % nummer)
            if select is not None and camera in (1, 2, 3):
                select.par.top = "cam%d" % camera
        snij = _op(voorvoegsel_snij % nummer)
        plek = _op(voorvoegsel_plek % nummer)
        if snij is not None:
            snij.par.ty = -_beeld_getal(extra_args, begin + 5, 0.0)
        if plek is not None:
            schaal = _beeld_getal(extra_args, begin + 1, 0.0)
            plek.par.sx = schaal
            plek.par.sy = schaal
            plek.par.rotate = _beeld_getal(extra_args, begin + 2, 0.0)
            plek.par.tx = _beeld_getal(extra_args, begin + 3, 0.0)
            plek.par.ty = _beeld_getal(extra_args, begin + 4, 0.0)


def handle_samen_beeld(cue_id, extra_args):
    # OSC-args: wat (0 = hoofdscherm + teleprompters, 1 = alles uit, 2 = alleen teleprompters,
    # 3 = teleprompters uit), achtergrond, voorgrond, duur, per camera zes getallen (nummer, schaal,
    # draai, tx, ty, snij), en dan per teleprompter 1-3: achtergrond, voorgrond en weer 3 x 6 getallen.
    cue_id = _text(cue_id)
    command = "td.samen.beeld"
    ack(cue_id, command, "received", "ok", "osc_received")
    wat = _beeld_tekst(extra_args, 0) or "1"
    aan = _op("beeld_aan")
    comp = _op("beeld_comp")
    if aan is None or comp is None:
        _beeld_log(cue_id, "error", "error", "beeld_ops_missing")
        ack(cue_id, command, "error", "error", "beeld_ops_missing")
        return False
    if wat == "1":
        beeld_uit()
        _beeld_log(cue_id, "applied", "ok", "beeld:uit")
        ack(cue_id, command, "applied", "ok", "beeld:uit")
        return True
    if wat == "3":
        _beeld_tp_uit()
        _beeld_log(cue_id, "applied", "ok", "beeld:teleprompters uit")
        ack(cue_id, command, "applied", "ok", "beeld:teleprompters uit")
        return True
    hoofd = wat != "2"
    achtergrond = _beeld_tekst(extra_args, 1)
    voorgrond = _beeld_tekst(extra_args, 2)
    duur = _beeld_getal(extra_args, 3, 0.0)
    if hoofd and not os.path.isfile(achtergrond):
        _beeld_log(cue_id, "error", "error", "beeld_invalid:%s" % achtergrond)
        ack(cue_id, command, "error", "error", "beeld_invalid")
        return False
    base = _base()
    te_spelen = []
    message = ""
    if hoofd:
        token = int(base.fetch("beeld_token", 0) or 0) + 1
        base.store("beeld_token", token)
        movie = _op("beeld_achtergrond")
        if movie is not None and _text(movie.par.file.eval()) != achtergrond:
            movie.par.file = achtergrond
        voor = _op("beeld_voorgrond")
        voor_pad = voorgrond if os.path.isfile(voorgrond) else _empty_alpha_path()
        clip = duur > 0 and voor_pad.lower().endswith(".mov")
        _beeld_movie(voor, voor_pad, clip)
        if clip:
            te_spelen.append(voor)
        _beeld_spelers(extra_args, 4, "beeld_snij_%d", "beeld_plek_%d", True)
        message = "beeld:%s voor:%s" % (os.path.basename(achtergrond), os.path.basename(voor_pad))
    # Teleprompters: elk de uitsnede van de eigen camera.
    tp_aan = _op("beeld_tp_aan")
    tp_token = None
    tp_comps = []
    if tp_aan is not None and len(extra_args) >= 22 + 3 * 20:
        tp_token = int(base.fetch("beeld_tp_token", 0) or 0) + 1
        base.store("beeld_tp_token", tp_token)
        for nummer in (1, 2, 3):
            start = 22 + (nummer - 1) * 20
            tp_achter = _beeld_tekst(extra_args, start)
            tp_voor = _beeld_tekst(extra_args, start + 1)
            if os.path.isfile(tp_achter):
                _beeld_movie(_op("beeld_tp%d_achtergrond" % nummer), tp_achter, False)
            tp_voor_pad = tp_voor if os.path.isfile(tp_voor) else _empty_alpha_path()
            tp_clip = duur > 0 and tp_voor_pad.lower().endswith(".mov")
            tp_movie = _op("beeld_tp%d_voorgrond" % nummer)
            _beeld_movie(tp_movie, tp_voor_pad, tp_clip)
            if tp_clip:
                te_spelen.append(tp_movie)
            _beeld_spelers(extra_args, start + 2, "beeld_tp%d_snij_%%d" % nummer, "beeld_tp%d_plek_%%d" % nummer, False)
            tp_comp = _op("beeld_tp%d_comp" % nummer)
            if tp_comp is not None:
                tp_comps.append(tp_comp)
        message = (message + " " if message else "") + "teleprompters"
    try:
        for movie in te_spelen:
            if hasattr(movie, "preload"):
                movie.preload()
        if hoofd:
            comp.cook(force=True)
        for tp_comp in tp_comps:
            tp_comp.cook(force=True)
    except Exception as err:
        _beeld_log(cue_id, "preload", "warning", err)
    run(
        "if args[0] is not None and args[1].fetch('beeld_token', 0) == args[2]:\\n"
        "    args[3].cook(force=True)\\n"
        "    args[4](args[0], 1)\\n"
        "if args[5] is not None and args[1].fetch('beeld_tp_token', 0) == args[6]:\\n"
        "    for c in args[7]:\\n"
        "        c.cook(force=True)\\n"
        "    args[4](args[5], 1)\\n"
        "for m in args[8]:\\n"
        "    args[9](m)",
        aan if hoofd else None, base, int(base.fetch("beeld_token", 0) or 0), comp, _beeld_zet,
        tp_aan if tp_token is not None else None, tp_token, tp_comps, te_spelen, _beeld_speel, delayFrames=3,
    )
    if te_spelen:
        # Vangnet als een clip toch zou herhalen: stilzetten vlak voor het einde.
        # Alleen als de clip er dan nog in staat: is er intussen van shot gewisseld, dan blijft de
        # plaat van dat shot gewoon aan.
        run(
            "for m, pad in args[0]:\\n    if str(m.par.file.eval()) == pad:\\n        m.par.play = 0",
            [(m, str(m.par.file.eval())) for m in te_spelen], delayMilliSeconds=int(duur * 1000) - 60,
        )
    _beeld_log(cue_id, "applied", "ok", message or "beeld")
    ack(cue_id, command, "applied", "ok", message or "beeld")
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
    """Geeft de nieuwe routertekst terug. Is hij al gepatcht, dan wordt het blok vervangen."""
    if ROUTER_MARKER in text:
        einde = "# --- einde For_You een beeld met de spelers erin ---"
        start = text.index(ROUTER_MARKER)
        stop = text.index(einde, start) + len(einde)
        nieuw = ROUTER_CODE[:ROUTER_CODE.index(einde) + len(einde)]
        return text[:start] + nieuw + text[stop:]
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


# Op het witte papier van de meme valt elk half doorzichtig stukje van de key op (schaduw op het
# doek, rand van het camerabeeld). Per camera een filter tussen beeld_cam_N en beeld_fit_N:
# alleen het stevige deel van de key blijft, en de zijkanten van het camerabeeld lopen zacht weg.
BEELD_SCHOON_GLSL = """uniform vec2 uKey;    // onder x: weg, boven y: helemaal
uniform vec2 uZij;    // deel van de breedte dat links en rechts wegloopt (begin, eind)
out vec4 fragColor;
void main() {
    vec4 c = texture(sTD2DInputs[0], vUV.st);
    float a = c.a;
    vec3 kleur = a > 0.0001 ? c.rgb / a : vec3(0.0);
    float na = smoothstep(uKey.x, uKey.y, a);
    float x = vUV.s;
    na *= smoothstep(uZij.x, uZij.y, x) * smoothstep(uZij.x, uZij.y, 1.0 - x);
    fragColor = TDOutputSwizzle(vec4(kleur * na, na));
}
"""
BEELD_SCHOON_KEY = (0.45, 0.85)
BEELD_SCHOON_ZIJ = (0.04, 0.12)


def apply_beeld_schoon(root):
    pixel = _get_or_create(root, textDAT, "beeld_schoon_glsl", root.op("beeld_cam_1").nodeX, root.op("beeld_cam_1").nodeY + 400)
    pixel.text = BEELD_SCHOON_GLSL
    for nummer in (1, 2, 3):
        select = root.op("beeld_cam_%d" % nummer)
        fit = root.op("beeld_fit_%d" % nummer)
        if select is None or fit is None:
            raise RuntimeError("beeld_cam_%d of beeld_fit_%d ontbreekt" % (nummer, nummer))
        schoon = _get_or_create(root, glslTOP, "beeld_schoon_%d" % nummer, select.nodeX + 300, select.nodeY - 200)
        _set(schoon, "pixeldat", pixel.path)
        _set(schoon, "outputresolution", "useinput")
        _set(schoon, "format", "rgba8fixed")
        _set(schoon, "vec0name", "uKey")
        _set(schoon, "vec0valuex", BEELD_SCHOON_KEY[0])
        _set(schoon, "vec0valuey", BEELD_SCHOON_KEY[1])
        _set(schoon, "vec1name", "uZij")
        _set(schoon, "vec1valuex", BEELD_SCHOON_ZIJ[0])
        _set(schoon, "vec1valuey", BEELD_SCHOON_ZIJ[1])
        schoon.inputConnectors[0].connect(select)
        fit.inputConnectors[0].connect(schoon)
    return [root.op("beeld_schoon_%d" % n) for n in (1, 2, 3)]


# Teleprompters: per speler de uitsnede van zijn eigen camera, zoals het hoofdscherm die toont.
# beeld_tpN_comp (Composite): voorgrond, de drie camera's (eigen snij + plek), achtergrond.
# select_camN_0 en _1 (bron van tel_left_N in fase 0 inloop en 1 tussen de scènes; in fase 2 toont
# de teleprompter het hoofdscherm) kiezen beeld_tpN_comp zolang beeld_tp_aan aan staat.
TP_FASEN = (0, 1)
TP_SELECT_EXPR = "'/project1/beeld_tp%d_comp' if op('/project1/beeld_tp_aan')['aan'] else '/project1/video%d'"


def apply_beeld_teleprompters(root):
    for nummer in (1, 2, 3):
        if root.op("beeld_fit_%d" % nummer) is None:
            raise RuntimeError("beeld_fit_%d ontbreekt; niets veranderd" % nummer)
        for fase in TP_FASEN:
            select = root.op("select_cam%d_%d" % (nummer, fase))
            if select is None:
                raise RuntimeError("select_cam%d_%d ontbreekt; niets veranderd" % (nummer, fase))
            uitdrukking = (select.par.top.expr or "").strip()
            if uitdrukking not in ("", TP_SELECT_EXPR % (nummer, nummer)) or (not uitdrukking and str(select.par.top.eval()) != "/project1/video%d" % nummer):
                raise RuntimeError("select_cam%d_%d kijkt niet naar video%d (%s); niets veranderd" % (nummer, fase, nummer, select.par.top.eval()))
    basis = root.op("beeld_comp")
    x, y = basis.nodeX, basis.nodeY - 3600
    leeg = os.path.join(project.folder, "empty-alpha-1920x1080.png")
    aan = _get_or_create(root, constantCHOP, "beeld_tp_aan", x, y + 600)
    for naam, waarde in (("const0name", "aan"), ("name0", "aan")):
        par = getattr(aan.par, naam, None)
        if par is not None:
            par.val = waarde
    if aan.numChans != 1 or aan.chan(0).name != "aan":
        raise RuntimeError("beeld_tp_aan: kanaal 'aan' zetten lukt niet")
    for nummer in (1, 2, 3):
        dy = -1500 * nummer
        achter = _get_or_create(root, moviefileinTOP, "beeld_tp%d_achtergrond" % nummer, x - 3000, y + dy)
        voor = _get_or_create(root, moviefileinTOP, "beeld_tp%d_voorgrond" % nummer, x - 3000, y + dy + 300)
        for movie in (achter, voor):
            if os.path.isfile(leeg) and not movie.par.file.eval():
                movie.par.file = leeg
        plekken = []
        for camera in (1, 2, 3):
            snij = _get_or_create(root, transformTOP, "beeld_tp%d_snij_%d" % (nummer, camera), x - 1800, y + dy - 300 * camera)
            snij.inputConnectors[0].connect(root.op("beeld_fit_%d" % camera))
            _set(snij, "extend", "zero")
            plek = _get_or_create(root, transformTOP, "beeld_tp%d_plek_%d" % (nummer, camera), x - 1200, y + dy - 300 * camera)
            plek.inputConnectors[0].connect(snij)
            _set(plek, "extend", "zero")
            plekken.append(plek)
        comp = _get_or_create(root, compositeTOP, "beeld_tp%d_comp" % nummer, x - 600, y + dy)
        for index, bron in enumerate([voor] + plekken + [achter]):
            comp.inputConnectors[index].connect(bron)
        _set(comp, "operand", "over")
        _set(comp, "prefit", "fill")
        _set(comp, "outputresolution", "custom")
        _set(comp, "resolutionw", 1080)
        _set(comp, "resolutionh", 1920)
        _set(comp, "outputaspect", "resolution")
    # Pas als alles staat: de teleprompters mogen het beeld kiezen (beeld_tp_aan staat nog op 0).
    for nummer in (1, 2, 3):
        for fase in TP_FASEN:
            root.op("select_cam%d_%d" % (nummer, fase)).par.top.expr = TP_SELECT_EXPR % (nummer, nummer)
    return aan


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
    apply_beeld_schoon(root)

    comp =_get_or_create(root, compositeTOP, "beeld_comp", x - 600, y - 1200)
    for index, bron in enumerate([voorgrond, plekken[0], plekken[1], plekken[2], achtergrond]):
        comp.inputConnectors[index].connect(bron)
    _set(comp, "operand", "over")
    _set(comp, "prefit", "fill")
    _set(comp, "outputresolution", "custom")
    _set(comp, "resolutionw", 1080)
    _set(comp, "resolutionh", 1920)
    _set(comp, "outputaspect", "resolution")

    apply_beeld_teleprompters(root)

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
