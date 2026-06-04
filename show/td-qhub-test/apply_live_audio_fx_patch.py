"""
Apply the For You QHub audio/fx patch inside an open TouchDesigner project.

Run in TouchDesigner Textport:

exec(open('/Users/for_you/ForYou/main/show/td-qhub-test/apply_live_audio_fx_patch.py').read())
"""

import os

BRIDGE_PATH = "/Users/for_you/ForYou/main/show/td-qhub-test/td_qhub_bridge.py"
EMPTY_ALPHA_FILENAME = "empty-alpha-1920x1080.png"
EMPTY_ALPHA_FALLBACK_PATH = "/Users/for_you/ForYou/main/show/td-qhub-test/empty-alpha-1920x1080.png"


def _project_file_path(filename):
    try:
        folder = project.folder
        if folder:
            return os.path.join(folder, filename)
    except Exception:
        pass
    return ""


def _empty_alpha_path():
    for candidate in [_project_file_path(EMPTY_ALPHA_FILENAME), EMPTY_ALPHA_FALLBACK_PATH]:
        if candidate and os.path.exists(candidate):
            return candidate
    return ""


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


def _ensure_table(parent_op, name, headers, x, y):
    table = parent_op.op(name)
    if table is None:
        table = parent_op.create(tableDAT, name)
        table.nodeX = x
        table.nodeY = y
    try:
        table.clear()
        table.appendRow(headers)
    except Exception:
        pass
    return table


def _ensure_movie(root, name, x, y):
    top = root.op(name)
    if top is None:
        top = root.create(moviefileinTOP, name)
        top.nodeX = x
        top.nodeY = y
    return top


def _destroy_if_exists(root, name):
    old = root.op(name)
    if old is None:
        return False
    old.destroy()
    return True


def _ensure_audio(root, name, x, y):
    chop = root.op(name)
    if chop is None:
        chop = root.create(audiofileinCHOP, name)
        chop.nodeX = x
        chop.nodeY = y
    return chop


def _add_unique(items, item):
    if item is None:
        return
    if item not in items:
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
    if router is not None:
        router.destroy()
    router = root.create(textDAT, "td_qhub_router")
    router.nodeX = -140
    router.nodeY = 360
    with open(BRIDGE_PATH, "r", encoding="utf-8") as handle:
        router.text = handle.read()

    oscin = root.op("oscin_td_cue")
    if oscin is not None:
        _set_par(oscin, ["port"], 9100)
        _set_par(oscin, ["active"], True)
        _set_par(oscin, ["callbacks", "callbackdat"], router)

    oscout = root.op("oscout_td_ack")
    if oscout is not None:
        _set_par(oscout, ["address", "netaddress", "networkaddress"], "127.0.0.1")
        _set_par(oscout, ["port", "networkport"], 9101)
        _set_par(oscout, ["active"], True)

    _ensure_movie(root, "prepared_background", 1150, -120)
    _ensure_text(root, "prepared_background_status", "waiting for environment background", 1150, -260)
    _ensure_audio(root, "prepared_soundscape", 1150, -430)
    _ensure_text(root, "prepared_soundscape_status", "waiting for soundscape", 1150, -570)
    _destroy_if_exists(root, "prepared_fx_video")
    _destroy_if_exists(root, "prepared_fx_image")
    fx_overlay = _ensure_movie(root, "prepared_fx_overlay", 1450, -120)
    _set_par(fx_overlay, ["file", "filein", "filename"], _empty_alpha_path())
    _ensure_text(root, "prepared_fx_status", "waiting for fx assets", 1450, -570)

    manager = root.op("asset_manager_demo")
    if manager is not None:
        _ensure_table(
            manager,
            "asset_bundle",
            ["role", "type", "assetId", "environmentId", "filePath", "url", "updatedAt"],
            600,
            -220,
        )

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
    debug("For You QHub audio/fx patch applied to %s: one prepared_fx_overlay with empty alpha fallback" % ", ".join(patched_roots))
    return patched_roots


apply_patch()
