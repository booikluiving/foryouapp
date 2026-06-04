"""
Apply the For You QHub phase/camera CHOP patch inside an open TouchDesigner project.

Run in TouchDesigner Textport:

exec(open('/Users/for_you/ForYou/main/show/td-qhub-test/apply_live_phase_chop_patch.py').read())
"""

BRIDGE_PATH = "/Users/for_you/ForYou/main/show/td-qhub-test/td_qhub_bridge.py"


def _set_par(op_obj, names, value):
    if op_obj is None:
        return False
    for name in names:
        par = getattr(op_obj.par, name, None)
        if par is not None:
            par.val = value
            return True
    return False


def _ensure_text(root, name, text, x, y):
    dat = root.op(name)
    if dat is None:
        dat = root.create(textDAT, name)
        dat.nodeX = x
        dat.nodeY = y
    dat.text = text
    return dat


def _ensure_constant_chop(root, name, channel_name, initial_value, x, y, status_name, status_text):
    chop = root.op(name)
    if chop is None:
        chop = root.create(constantCHOP, name)
        chop.nodeX = x
        chop.nodeY = y
    _set_par(chop, ["numchans", "nchans"], 1)
    _set_par(chop, ["name0", "chan0name", "chan1name"], channel_name)
    _set_par(chop, ["value0", "chan0value", "chan1value"], initial_value)
    try:
        chop.cook(force=True)
    except Exception:
        pass
    _ensure_text(root, status_name, status_text, x, y - 140)
    return chop


def _ensure_phase_chop(root):
    return _ensure_constant_chop(root, "phase_value", "phase", 0, 1750, -120, "phase_value_status", "phase value: 0")


def _ensure_camera_chop(root):
    return _ensure_constant_chop(root, "camera_value", "camera", 1, 1750, -430, "camera_value_status", "camera value: 1")


def _add_unique(items, item):
    if item is not None and item not in items:
        items.append(item)


def _candidate_roots():
    roots = []
    _add_unique(roots, op("/project1"))
    try:
        for oscin in op("/").findChildren(name="oscin_td_cue"):
            _add_unique(roots, oscin.parent())
    except Exception:
        pass
    try:
        for router in op("/").findChildren(name="td_qhub_router"):
            _add_unique(roots, router.parent())
    except Exception:
        pass
    return roots


def _apply_patch_to_root(root):
    router = root.op("td_qhub_router")
    if router is None:
        router = root.create(textDAT, "td_qhub_router")
        router.nodeX = -140
        router.nodeY = 360
    with open(BRIDGE_PATH, "r", encoding="utf-8") as handle:
        router.text = handle.read()

    _ensure_phase_chop(root)
    _ensure_camera_chop(root)

    oscin = root.op("oscin_td_cue")
    if oscin is not None:
        _set_par(oscin, ["callbacks", "callbackdat"], router)
        _set_par(oscin, ["active"], True)

    try:
        router.cook(force=True)
    except Exception:
        pass
    router.module.start()
    return root.path


def apply_patch():
    patched_roots = []
    for root in _candidate_roots():
        patched_roots.append(_apply_patch_to_root(root))
    if not patched_roots:
        raise RuntimeError("Missing TouchDesigner QHub root")
    debug("For You QHub phase/camera CHOP patch applied to %s: /project1/phase_value and /project1/camera_value" % ", ".join(patched_roots))
    return patched_roots


apply_patch()
