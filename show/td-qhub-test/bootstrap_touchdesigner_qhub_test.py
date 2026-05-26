"""
Bootstrap a fresh For You TD Q-hub protocol test network.

Run inside TouchDesigner Textport:

exec(open('/Users/for_you/ForYou/main/show/td-qhub-test/bootstrap_touchdesigner_qhub_test.py').read())
"""

import os


BASE_PATH = "/project1"
BRIDGE_PATH = os.environ.get(
    "FORYOU_TD_QHUB_BRIDGE",
    "/Users/for_you/ForYou/main/show/td-qhub-test/td_qhub_bridge.py",
)
SAVE_PATH = os.environ.get(
    "FORYOU_TD_QHUB_SAVE_PATH",
    "/Users/for_you/ForYou/main/show/td-qhub-test/ForYou TD QHub Test.toe",
)
SHOW_MESSAGE = os.environ.get("FORYOU_TD_QHUB_SHOW_MESSAGE", "1") != "0"

TRIGGERS = [
    ("trigger_start_run_prepare", "START RUN -> TD PREPARE"),
    ("trigger_start_situation_go", "START SITUATION -> TD GO"),
    ("trigger_stop_situation_prepare_next", "STOP SITUATION -> TD PREPARE NEXT"),
    ("trigger_camera_1", "CAMERA 1"),
    ("trigger_camera_2", "CAMERA 2"),
    ("trigger_camera_3", "CAMERA 3"),
    ("trigger_phase_set", "PHASE SET"),
    ("trigger_asset_prepare", "ASSET PREPARE"),
    ("trigger_heartbeat", "HEARTBEAT"),
    ("trigger_unknown", "UNKNOWN / UNSUPPORTED"),
]


def _destroy_existing(parent_op, name):
    existing = parent_op.op(name)
    if existing is not None:
        existing.destroy()


def _set_par(op_obj, names, value):
    for name in names:
        par = getattr(op_obj.par, name, None)
        if par is not None:
            par.val = value
            return True
    return False


def _create_table(base, name, headers, x=0, y=0):
    table = base.create(tableDAT, name)
    table.appendRow(headers)
    table.nodeX = x
    table.nodeY = y
    return table


def _create_text(base, name, text, x=0, y=0):
    dat = base.create(textDAT, name)
    dat.text = text
    dat.nodeX = x
    dat.nodeY = y
    return dat


def _create_trigger(base, name, title, x, y):
    trigger = base.create(baseCOMP, name)
    trigger.nodeX = x
    trigger.nodeY = y
    try:
        trigger.color = (0.24, 0.24, 0.26)
    except Exception:
        pass
    _create_text(trigger, "title", title, x=0, y=220)
    _create_table(trigger, "status_state", ["key", "value"], x=0, y=0)
    _create_table(trigger, "trigger_log", ["at", "cueId", "command", "payloadId", "stage", "status", "message"], x=230, y=0)
    _create_text(trigger, "payload_view", "waiting for payload", x=460, y=0)
    _create_text(trigger, "visual_state", "READY\nwaiting for cue hit", x=0, y=-220)
    return trigger


def _create_triggers(base):
    for index, item in enumerate(TRIGGERS):
        name, title = item
        col = index % 5
        row = index // 5
        _create_trigger(base, name, title, x=-700 + col * 300, y=-120 - row * 210)
    return True


def _create_asset_manager(base):
    manager = base.create(baseCOMP, "asset_manager_demo")
    manager.nodeX = 850
    manager.nodeY = -120
    _create_text(
        manager,
        "title",
        "ASSET MANAGER DEMO\nLive Catalog: http://127.0.0.1:3021/v0/catalog/media-assets",
        x=0,
        y=240,
    )
    _create_table(
        manager,
        "asset_registry",
        ["assetId", "environmentId", "type", "role", "name", "filePath", "url", "status"],
        x=0,
        y=0,
    )
    _create_table(manager, "asset_filter_state", ["key", "value"], x=340, y=0)
    _create_table(manager, "selected_asset", ["key", "value"], x=600, y=0)
    _create_table(
        manager,
        "asset_prepare_log",
        ["at", "cueId", "command", "payloadId", "assetId", "environmentId", "type", "filePath"],
        x=0,
        y=-220,
    )
    try:
        preview = manager.create(moviefileinTOP, "prepared_background")
        preview.nodeX = 600
        preview.nodeY = -220
    except Exception:
        preview = None
    _create_text(manager, "prepared_background_status", "waiting for environment background", x=920, y=-220)
    return manager


def _create_prepared_background_preview(base):
    try:
        preview = base.create(moviefileinTOP, "prepared_background")
        preview.nodeX = 1150
        preview.nodeY = -120
    except Exception:
        preview = None
    _create_text(base, "prepared_background_status", "waiting for environment background", x=1150, y=-260)
    return preview


def build_qhub_test():
    project_root = op("/project1")
    if project_root is None:
        raise RuntimeError("Missing /project1")

    _destroy_existing(project_root, "show_control_qhub")
    for name in [
        "read_me_first",
        "td_qhub_router",
        "oscin_td_cue",
        "oscout_td_ack",
        "cue_log",
        "payload_log",
        "trigger_overview",
        "status_state",
        "status_view",
        "prepared_background",
        "prepared_background_status",
        "asset_manager_demo",
        "start_qhub_bridge",
    ]:
        _destroy_existing(project_root, name)
    for name, _title in TRIGGERS:
        _destroy_existing(project_root, name)

    _create_text(
        project_root,
        "read_me_first",
        "FOR YOU TD Q-HUB TEST\nExternal OSC stays /td/cue on UDP 9100.\nEach cue is routed to its own visible top-level trigger COMP.",
        x=-760,
        y=360,
    )

    bridge = project_root.create(textDAT, "td_qhub_router")
    with open(BRIDGE_PATH, "r", encoding="utf-8") as handle:
        bridge.text = handle.read()
    bridge.nodeX = -140
    bridge.nodeY = 360

    oscin = project_root.create(oscinDAT, "oscin_td_cue")
    _set_par(oscin, ["port"], 9100)
    _set_par(oscin, ["active"], True)
    _set_par(oscin, ["callbacks", "callbackdat"], bridge)
    oscin.nodeX = -460
    oscin.nodeY = 360

    oscout = project_root.create(oscoutDAT, "oscout_td_ack")
    _set_par(oscout, ["address", "netaddress", "networkaddress"], "127.0.0.1")
    _set_par(oscout, ["port", "networkport"], 9101)
    _set_par(oscout, ["active"], True)
    oscout.nodeX = 180
    oscout.nodeY = 360

    _create_table(project_root, "cue_log", ["at", "cueId", "command", "payloadId", "trigger", "stage", "status", "message"], x=-460, y=130)
    _create_table(project_root, "payload_log", ["at", "cueId", "command", "payloadId", "status", "summary"], x=-140, y=130)
    _create_table(project_root, "trigger_overview", ["trigger", "count", "lastCommand", "lastStage", "lastStatus", "updatedAt"], x=180, y=130)
    _create_table(project_root, "status_state", ["key", "value"], x=500, y=130)

    _create_text(project_root, "status_view", "For You TD Q-hub Test\n\nstatus: bootstrapped", x=820, y=130)

    _create_triggers(project_root)
    _create_prepared_background_preview(project_root)
    _create_asset_manager(project_root)

    startup = project_root.create(executeDAT, "start_qhub_bridge")
    startup.text = (
        "def start():\n"
        "    op('/project1/td_qhub_router').module.start()\n"
        "    return\n\n"
        "def create():\n"
        "    op('/project1/td_qhub_router').module.start()\n"
        "    return\n\n"
        "def exit():\n"
        "    try:\n"
        "        op('/project1/td_qhub_router').module.stop()\n"
        "    except Exception:\n"
        "        pass\n"
        "    return\n"
    )
    startup.nodeX = 500
    startup.nodeY = 360
    _set_par(startup, ["start"], True)
    _set_par(startup, ["create"], True)
    _set_par(startup, ["exit"], True)

    bridge.module.start()
    if SAVE_PATH:
        project.save(SAVE_PATH)
    if SHOW_MESSAGE:
        message = "Created visible Q-hub trigger nodes in %s" % BASE_PATH
        if SAVE_PATH:
            message += "\nSaved to %s" % SAVE_PATH
        else:
            message += "\nSave this project as ForYou TD QHub Test.toe."
        ui.messageBox("For You TD Q-hub Test", message)
    return project_root


build_qhub_test()
