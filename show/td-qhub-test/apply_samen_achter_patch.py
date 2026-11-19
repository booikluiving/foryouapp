"""
For_You: derde speler in het gezamenlijke shot (cue td.samen.shot) in het show-TD.

De twee camera's naast elkaar blijven zoals ze zijn. Een derde camera komt er kleiner achter,
op een eigen plek, met een masker voor wat er vóór die speler staat (Achtbaan: de rugleuningen
van de voorste stoelen). Geeft show control geen derde camera mee (Lingo), dan is die laag leeg
en is het shot precies wat het was.

Draaien via de opdrachtenmap (of in de Textport), met het showbestand open en het
gezamenlijke shot uit:

    exec(open('/Users/for_you/ForYou/main/show/td-qhub-test/apply_samen_achter_patch.py').read())

Wat het doet, in /project1:
- samen_leeg (Constant TOP, doorzichtig): de bron zolang er geen derde speler is
- samen_cam_c -> samen_fit_c -> samen_plek_c: kopieën van de keten van camera a
- samen_masker (Movie File In): het masker, anders het lege plaatje
- samen_achter (Composite, outside): de derde speler, weg waar het masker dekt
- samen_comp: voorgrond, camera a, camera b, samen_achter, achtergrond
- td_qhub_router: handle_samen_shot leest na omhoog ook: camera c, x, omhoog, schaal, masker.
  Zonder die args: geen derde speler.
- Bewaart NIET.

Terugdraaien: in samen_comp de vierde ingang weer samen_achtergrond en de vijfde los; de
routertekst staat vóór de patch in /project1 store 'samen_router_voor_achter'.
"""

import os

ACHTER_MARKER = "# --- For_You gezamenlijk shot: derde speler ---"
ROUTER_BEGIN = "def handle_samen_shot(cue_id, extra_args):"
ROUTER_EIND = "# --- einde For_You gezamenlijk shot ---"

ROUTER_HANDLER = ACHTER_MARKER + '''
def handle_samen_shot(cue_id, extra_args):
    # OSC-args: uit (0/1), camera a, camera b, achtergrond, voorgrond, schaal, omhoog,
    # en voor een derde speler erachter: camera c, x, omhoog, schaal, masker.
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
    cam_c = int(_samen_getal(extra_args, 7, 0))
    c_x = _samen_getal(extra_args, 8, 0.0)
    c_omhoog = _samen_getal(extra_args, 9, 0.0)
    c_schaal = _samen_getal(extra_args, 10, 0.4)
    masker = _text(extra_args[11]) if len(extra_args) > 11 else ""
    if cam_a not in (1, 2, 3) or cam_b not in (1, 2, 3) or not os.path.isfile(achtergrond):
        _samen_log(cue_id, "error", "error", "samen_invalid:%s %s %s" % (cam_a, cam_b, achtergrond))
        ack(cue_id, command, "error", "error", "samen_invalid")
        return False
    if cam_c not in (1, 2, 3) or cam_c in (cam_a, cam_b):
        cam_c = 0
    leeg = _empty_alpha_path()
    for name, file_path in (
        ("samen_achtergrond", achtergrond),
        ("samen_voorgrond", voorgrond if os.path.isfile(voorgrond) else leeg),
        ("samen_masker", masker if (cam_c and os.path.isfile(masker)) else leeg),
    ):
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
    # De derde speler: kleiner, op zijn eigen plek, achter de twee voorste. Zonder: een lege bron.
    select_c = _op("samen_cam_c")
    plek_c = _op("samen_plek_c")
    if select_c is not None:
        select_c.par.top = ("cam%d" % cam_c) if cam_c else "samen_leeg"
    if plek_c is not None and cam_c:
        plek_c.par.sx = c_schaal
        plek_c.par.sy = c_schaal
        plek_c.par.tx = c_x
        plek_c.par.ty = c_omhoog
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
    if cam_c:
        message += " achter:cam%d x:%s omhoog:%s schaal:%s" % (cam_c, c_x, c_omhoog, c_schaal)
    _samen_log(cue_id, "applied", "ok", message)
    ack(cue_id, command, "applied", "ok", message)
    return True
'''


def patch_router_text(text):
    """Geeft de nieuwe routertekst terug. Zelfde tekst als hij al gepatcht is."""
    if ACHTER_MARKER in text:
        return text
    if text.count(ROUTER_BEGIN) != 1 or text.count(ROUTER_EIND) != 1:
        raise RuntimeError("td_qhub_router: handle_samen_shot niet herkend, niets veranderd")
    begin = text.index(ROUTER_BEGIN)
    eind = text.index(ROUTER_EIND)
    if eind < begin:
        raise RuntimeError("td_qhub_router: volgorde van handle_samen_shot onverwacht, niets veranderd")
    return text[:begin] + ROUTER_HANDLER + text[eind:]


def _set(op_obj, name, value):
    par = getattr(op_obj.par, name, None)
    if par is None:
        print("For_You samen achter: parameter %s ontbreekt op %s" % (name, op_obj.name))
        return
    par.val = value


def apply_samen_achter_patch():
    root = op("/project1")
    namen = ("td_qhub_router", "samen_comp", "samen_cam_a", "samen_fit_a", "samen_plek_a",
             "samen_plek_b", "samen_voorgrond", "samen_achtergrond", "samen_aan")
    for name in namen:
        if root.op(name) is None:
            raise RuntimeError("niet gevonden: /project1/%s" % name)
    comp = root.op("samen_comp")
    ingangen = [item.name if item is not None else "" for item in comp.inputs]
    oud = ["samen_voorgrond", "samen_plek_a", "samen_plek_b", "samen_achtergrond"]
    nieuw = ["samen_voorgrond", "samen_plek_a", "samen_plek_b", "samen_achter", "samen_achtergrond"]
    if ingangen not in (oud, nieuw):
        raise RuntimeError("samen_comp heeft andere ingangen dan verwacht (%s); niets veranderd" % ingangen)
    if root.op("samen_aan")["aan"] >= 0.5:
        raise RuntimeError("het gezamenlijke shot staat aan; zet het eerst uit. Niets veranderd")

    # 1. Router eerst (alleen tekst): faalt dit, dan is het netwerk nog onaangeroerd.
    router = root.op("td_qhub_router")
    nieuwe_tekst = patch_router_text(router.text)
    if nieuwe_tekst != router.text:
        root.store("samen_router_voor_achter", router.text)
        router.text = nieuwe_tekst

    # 2. Operators, onder camera b.
    plek_b = root.op("samen_plek_b")
    x, y = plek_b.nodeX, plek_b.nodeY - 600
    leeg_png = os.path.join(project.folder, "empty-alpha-1920x1080.png")

    leeg = root.op("samen_leeg")
    if leeg is None:
        leeg = root.create(constantTOP, "samen_leeg")
        leeg.nodeX, leeg.nodeY = x - 1800, y
    for naam, waarde in (("colorr", 0), ("colorg", 0), ("colorb", 0), ("alpha", 0),
                         ("outputresolution", "custom"), ("resolutionw", 16), ("resolutionh", 16)):
        _set(leeg, naam, waarde)

    def kopie(bron_naam, naam, dx):
        bestaand = root.op(naam)
        if bestaand is not None:
            return bestaand
        nieuw_op = root.copy(root.op(bron_naam), name=naam)
        nieuw_op.nodeX, nieuw_op.nodeY = x + dx, y
        return nieuw_op

    select = kopie("samen_cam_a", "samen_cam_c", -1200)
    select.par.top = "samen_leeg"
    fit = kopie("samen_fit_a", "samen_fit_c", -600)
    fit.inputConnectors[0].connect(select)
    plek = kopie("samen_plek_a", "samen_plek_c", 0)
    plek.inputConnectors[0].connect(fit)
    _set(plek, "sx", 0.4)
    _set(plek, "sy", 0.4)
    _set(plek, "tx", 0)
    _set(plek, "ty", 0)

    masker = root.op("samen_masker")
    if masker is None:
        masker = root.create(moviefileinTOP, "samen_masker")
        masker.nodeX, masker.nodeY = x, y - 300
        # Een nieuwe Movie File In begint met het voorbeeldfilmpje van TouchDesigner: dat dekt alles.
        if os.path.isfile(leeg_png):
            masker.par.file = leeg_png

    achter = root.op("samen_achter")
    if achter is None:
        achter = root.create(compositeTOP, "samen_achter")
        achter.nodeX, achter.nodeY = x + 600, y
    achter.inputConnectors[0].connect(plek)
    achter.inputConnectors[1].connect(masker)
    # outside: de speler blijft alleen waar het masker niets dekt.
    for naam, waarde in (("operand", "outside"), ("prefit", "fill"), ("outputresolution", "custom"),
                         ("resolutionw", 1080), ("resolutionh", 1920), ("outputaspect", "resolution")):
        _set(achter, naam, waarde)

    # 3. samen_comp: de derde speler achter de twee voorste, vóór de achtergrond.
    comp.inputConnectors[3].connect(achter)
    comp.inputConnectors[4].connect(root.op("samen_achtergrond"))
    print("For_You samen achter: klaar, NIET bewaard. Ingangen samen_comp:",
          [item.name if item is not None else "" for item in comp.inputs])


if __name__ != "samen_achter_offline_test":
    try:
        op  # alleen binnen TouchDesigner
    except NameError:
        pass
    else:
        apply_samen_achter_patch()
