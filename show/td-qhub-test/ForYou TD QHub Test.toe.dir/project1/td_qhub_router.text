"""
TouchDesigner Q-hub protocol bridge v2.

The external Show Control contract stays intentionally small:

    /td/cue cueId command payloadId

Inside TouchDesigner this router fans cues out to visible top-level trigger
COMPs so a work session can attach real TD behavior to each incoming cue.
"""

import json
import os
import time
import urllib.error
import urllib.parse
import urllib.request


SHOW_CONTROL_HTTP = "http://127.0.0.1:3025"
CATALOG_HTTP = "http://127.0.0.1:3021"
ACK_ADDRESS = "/td/ack"
EMPTY_ALPHA_FILENAME = "empty-alpha-1920x1080.png"
EMPTY_ALPHA_FALLBACK_PATH = "/Users/for_you/ForYou/main/show/td-qhub-test/empty-alpha-1920x1080.png"
PHASE_VALUE_CHOP = "phase_value"
PHASE_VALUE_STATUS = "phase_value_status"
CAMERA_VALUE_CHOP = "camera_value"
CAMERA_VALUE_STATUS = "camera_value_status"

SUPPORTED_COMMANDS = {
    "td.status.heartbeat",
    "td.environment.prepare",
    "td.environment.go",
    "td.camera.set",
    "td.phase.set",
    "td.asset.prepare",
}

TRIGGER_NAMES = [
    "trigger_start_run_prepare",
    "trigger_start_situation_go",
    "trigger_stop_situation_prepare_next",
    "trigger_camera_1",
    "trigger_camera_2",
    "trigger_camera_3",
    "trigger_phase_set",
    "trigger_asset_prepare",
    "trigger_heartbeat",
    "trigger_unknown",
]

TRIGGER_TITLES = {
    "trigger_start_run_prepare": "START RUN -> TD PREPARE",
    "trigger_start_situation_go": "START SITUATION -> TD GO",
    "trigger_stop_situation_prepare_next": "STOP SITUATION -> TD PREPARE NEXT",
    "trigger_camera_1": "CAMERA 1",
    "trigger_camera_2": "CAMERA 2",
    "trigger_camera_3": "CAMERA 3",
    "trigger_phase_set": "PHASE SET",
    "trigger_asset_prepare": "ASSET PREPARE",
    "trigger_heartbeat": "HEARTBEAT",
    "trigger_unknown": "UNKNOWN / UNSUPPORTED",
}

TRIGGER_COLORS = {
    "trigger_start_run_prepare": (0.18, 0.42, 0.95),
    "trigger_start_situation_go": (0.08, 0.72, 0.34),
    "trigger_stop_situation_prepare_next": (0.90, 0.48, 0.12),
    "trigger_camera_1": (0.08, 0.58, 0.92),
    "trigger_camera_2": (0.08, 0.72, 0.78),
    "trigger_camera_3": (0.24, 0.50, 1.00),
    "trigger_phase_set": (0.58, 0.34, 0.94),
    "trigger_asset_prepare": (0.78, 0.42, 0.82),
    "trigger_heartbeat": (0.48, 0.72, 0.22),
    "trigger_unknown": (0.92, 0.18, 0.16),
}

READY_COLOR = (0.24, 0.24, 0.26)
WARNING_COLOR = (0.95, 0.64, 0.12)
ERROR_COLOR = (0.92, 0.18, 0.16)


def _now():
    return time.strftime("%Y-%m-%dT%H:%M:%S", time.localtime())


def _base():
    try:
        return parent()
    except Exception:
        return op("/project1")


def _op(name):
    base = _base()
    if base is not None:
        child = base.op(name)
        if child is not None:
            return child
    return op("/project1/" + name)


def _path_op(path):
    try:
        return op(path)
    except Exception:
        return None


def _root_path(*parts):
    base = _base()
    if base is None:
        return ""
    suffix = "/".join(_text(part).strip("/") for part in parts if _text(part).strip("/"))
    return "%s/%s" % (base.path, suffix) if suffix else base.path


def _trigger_op(trigger_name, child_name):
    trigger = _trigger_base(trigger_name)
    return trigger.op(child_name) if trigger is not None else None


def _trigger_base(trigger_name):
    return _op(trigger_name)


def _asset_op(child_name):
    manager = _op("asset_manager_demo")
    return manager.op(child_name) if manager is not None else None


def _text(value):
    try:
        if hasattr(value, "val"):
            return str(value.val)
    except Exception:
        pass
    return str(value if value is not None else "")


def _clear_table(table):
    if table is None:
        return
    try:
        table.clear()
    except Exception:
        try:
            while table.numRows:
                table.deleteRow(0)
        except Exception:
            pass


def _ensure_table_at(path, headers):
    table = _path_op(path)
    if table is None:
        return None
    try:
        if table.numRows == 0:
            table.appendRow(headers)
    except Exception:
        pass
    return table


def _ensure_table(name, headers):
    table = _op(name)
    if table is None:
        return None
    try:
        if table.numRows == 0:
            table.appendRow(headers)
    except Exception:
        pass
    return table


def _append_row(name, headers, values):
    table = _ensure_table(name, headers)
    if table is None:
        return
    try:
        table.appendRow([_text(item) for item in values])
    except Exception:
        pass


def _append_row_at(path, headers, values):
    table = _ensure_table_at(path, headers)
    if table is None:
        return
    try:
        table.appendRow([_text(item) for item in values])
    except Exception:
        pass


def _table_to_dict(table):
    result = {}
    if table is None:
        return result
    try:
        for row_index in range(1, table.numRows):
            key = _text(table[row_index, 0])
            value = _text(table[row_index, 1])
            result[key] = value
    except Exception:
        pass
    return result


def _write_kv_table(table, items):
    if table is None:
        return
    _clear_table(table)
    try:
        table.appendRow(["key", "value"])
        for key in sorted(items.keys()):
            table.appendRow([key, _text(items[key])])
    except Exception:
        pass


def _set_dat_text(dat, text):
    if dat is None:
        return
    try:
        dat.text = text
    except Exception:
        pass


def _set_par_value(op_obj, names, value):
    if op_obj is None:
        return False
    for name in names:
        try:
            par = getattr(op_obj.par, name, None)
            if par is not None:
                par.val = value
                return True
        except Exception:
            pass
    return False


def _ensure_trigger_text(trigger_name, child_name, initial_text="", x=0, y=0):
    dat = _trigger_op(trigger_name, child_name)
    if dat is not None:
        return dat
    trigger = _trigger_base(trigger_name)
    if trigger is None:
        return None
    try:
        dat = trigger.create(textDAT, child_name)
        dat.text = initial_text
        dat.nodeX = x
        dat.nodeY = y
        return dat
    except Exception:
        return None


def _lighten(color, amount):
    return tuple(min(1.0, max(0.0, channel + amount)) for channel in color)


def _safe_int(value, fallback=0):
    try:
        return int(value)
    except Exception:
        return fallback


def _trigger_color(trigger_name, status, count):
    count = _safe_int(count)
    state = _text(status).lower()
    if state in ["error", "failed"]:
        base_color = ERROR_COLOR
    elif state in ["warning", "timedout"]:
        base_color = WARNING_COLOR
    elif count <= 0:
        base_color = READY_COLOR
    else:
        base_color = TRIGGER_COLORS.get(trigger_name, READY_COLOR)
    if count > 0 and count % 2 == 0:
        return _lighten(base_color, 0.14)
    return base_color


def _apply_trigger_visual(trigger_name, status_items, payload):
    count = status_items.get("count", 0)
    status = status_items.get("lastStatus", "ok")
    title = TRIGGER_TITLES.get(trigger_name, trigger_name)
    stage = status_items.get("lastStage", "-")
    command = status_items.get("lastCommand", "-")
    cue_id = status_items.get("lastCueId", "-")
    payload_id = status_items.get("lastPayloadId", "-")
    updated_at = status_items.get("updatedAt", _now())
    message = status_items.get("message", "")

    trigger = _trigger_base(trigger_name)
    if trigger is not None:
        try:
            trigger.color = _trigger_color(trigger_name, status, count)
        except Exception:
            pass
        try:
            trigger.comment = "hit #%s %s %s" % (count, stage, updated_at)
        except Exception:
            pass

    title_dat = _ensure_trigger_text(trigger_name, "title", title, x=0, y=220)
    _set_dat_text(
        title_dat,
        "%s\nHIT #%s\n%s / %s" % (title, count, stage, status),
    )

    visual_dat = _ensure_trigger_text(trigger_name, "visual_state", "READY", x=0, y=-220)
    _set_dat_text(
        visual_dat,
        "\n".join([
            title,
            "",
            "VISUAL CUE: HIT #%s" % count,
            "stage: %s" % stage,
            "status: %s" % status,
            "command: %s" % command,
            "cueId: %s" % cue_id,
            "payloadId: %s" % payload_id,
            "updatedAt: %s" % updated_at,
            "message: %s" % message,
            "",
            "payload:",
            _summary(payload, limit=700),
        ]),
    )


def _set_status(**items):
    table = _op("status_state")
    _write_kv_table(table, items)

    view = _op("status_view")
    if view is not None:
        try:
            lines = ["For You TD Q-hub Test", ""]
            for key in sorted(items.keys()):
                lines.append("%s: %s" % (key, _text(items[key])))
            view.text = "\n".join(lines)
        except Exception:
            pass


def _summary(payload, limit=900):
    try:
        return json.dumps(payload, sort_keys=True)[:limit]
    except Exception:
        return _text(payload)[:limit]


def _fetch_json(url, timeout=1.0):
    with urllib.request.urlopen(url, timeout=timeout) as response:
        raw = response.read().decode("utf-8")
    return json.loads(raw)


def ack(cue_id, command, stage, status="ok", message=""):
    out = _op("oscout_td_ack")
    if out is None:
        _append_row(
            "cue_log",
            ["at", "cueId", "command", "payloadId", "trigger", "stage", "status", "message"],
            [_now(), cue_id, command, "-", "-", "ack_error", "error", "missing oscout_td_ack"],
        )
        return False
    try:
        out.sendOSC(ACK_ADDRESS, [
            _text(cue_id),
            _text(command),
            _text(stage),
            _text(status),
            _text(message),
        ])
        return True
    except Exception as err:
        _append_row(
            "cue_log",
            ["at", "cueId", "command", "payloadId", "trigger", "stage", "status", "message"],
            [_now(), cue_id, command, "-", "-", "ack_error", "error", err],
        )
        return False


def fetch_payload(payload_id):
    payload_id = _text(payload_id)
    if not payload_id or payload_id == "-":
        return {}
    url = SHOW_CONTROL_HTTP + "/api/show-control/payloads/" + urllib.parse.quote(payload_id)
    return _fetch_json(url, timeout=1.0)


def _final_stage(command):
    if command.endswith(".prepare"):
        return "loaded"
    return "applied"


def _camera_number(payload):
    raw = _text(payload.get("camera") or payload.get("cameraId") or payload.get("camera_id") or "")
    for number in ["1", "2", "3"]:
        if raw == number or raw.endswith(number) or raw.endswith(":%s" % number) or raw.endswith("_%s" % number):
            return number
    return ""


def route_trigger(command, payload):
    if command == "td.status.heartbeat":
        return "trigger_heartbeat"
    if command == "td.phase.set":
        return "trigger_phase_set"
    if command == "td.asset.prepare":
        return "trigger_asset_prepare"
    if command == "td.environment.go":
        return "trigger_start_situation_go"
    if command == "td.camera.set":
        camera = _camera_number(payload)
        if camera in ["1", "2", "3"]:
            return "trigger_camera_%s" % camera
        return "trigger_unknown"
    if command == "td.environment.prepare":
        generated_by = _text(payload.get("generatedBy") or payload.get("generatedByCommand") or "")
        cue_intent = _text(payload.get("cueIntent") or "")
        if generated_by == "runtime.stopSituation" or "prepare_next" in cue_intent:
            return "trigger_stop_situation_prepare_next"
        return "trigger_start_run_prepare"
    return "trigger_unknown"


def _update_trigger_overview(trigger_name, status):
    table = _ensure_table("trigger_overview", ["trigger", "count", "lastCommand", "lastStage", "lastStatus", "updatedAt"])
    if table is None:
        return
    try:
        row_index = None
        for index in range(1, table.numRows):
            if _text(table[index, 0]) == trigger_name:
                row_index = index
                break
        values = [
            trigger_name,
            status.get("count", "0"),
            status.get("lastCommand", "-"),
            status.get("lastStage", "-"),
            status.get("lastStatus", "-"),
            status.get("updatedAt", _now()),
        ]
        if row_index is None:
            table.appendRow(values)
        else:
            for col_index, value in enumerate(values):
                table[row_index, col_index] = _text(value)
    except Exception:
        pass


def update_trigger(trigger_name, cue_id, command, payload_id, payload, stage, status, message):
    if trigger_name not in TRIGGER_NAMES:
        trigger_name = "trigger_unknown"

    status_table = _trigger_op(trigger_name, "status_state")
    previous = _table_to_dict(status_table)
    count = 1
    try:
        count = int(previous.get("count", "0")) + 1
    except Exception:
        pass

    status_items = {
        "count": count,
        "lastCueId": cue_id,
        "lastCommand": command,
        "lastPayloadId": payload_id,
        "lastStage": stage,
        "lastStatus": status,
        "message": message,
        "updatedAt": _now(),
    }
    _write_kv_table(status_table, status_items)
    _append_row_at(
        _root_path(trigger_name, "trigger_log"),
        ["at", "cueId", "command", "payloadId", "stage", "status", "message"],
        [_now(), cue_id, command, payload_id, stage, status, message],
    )

    payload_view = _trigger_op(trigger_name, "payload_view")
    if payload_view is not None:
        try:
            payload_view.text = _summary(payload, limit=1600)
        except Exception:
            pass

    _apply_trigger_visual(trigger_name, status_items, payload)
    _update_trigger_overview(trigger_name, status_items)


def _asset_file_path(asset):
    if not isinstance(asset, dict):
        return ""
    primary = asset.get("primaryFile") or {}
    if primary.get("absolutePath"):
        return primary.get("absolutePath")
    if asset.get("filePath"):
        return asset.get("filePath")
    if asset.get("absolutePath"):
        return asset.get("absolutePath")
    files = asset.get("files") or []
    if files and isinstance(files[0], dict):
        return files[0].get("absolutePath") or files[0].get("path") or ""
    return asset.get("url") or ""


def _asset_row(asset):
    asset_id = _text(asset.get("id") or asset.get("assetId") or "")
    return [
        asset_id,
        _text(asset.get("environmentId") or ""),
        _text(asset.get("type") or asset.get("role") or ""),
        _text(asset.get("role") or asset.get("type") or ""),
        _text(asset.get("name") or asset.get("title") or asset_id),
        _asset_file_path(asset),
        _text(asset.get("url") or ("/v0/catalog/media-assets/file/" + urllib.parse.quote(asset_id) if asset_id else "")),
        _text(asset.get("status") or ""),
    ]


def _dict_child(value, key):
    if isinstance(value, dict) and isinstance(value.get(key), dict):
        return value.get(key)
    return {}


def _list_child(value, key):
    if isinstance(value, dict) and isinstance(value.get(key), list):
        return [item for item in value.get(key) if isinstance(item, dict)]
    return []


def _asset_id(asset):
    if not isinstance(asset, dict):
        return ""
    return _text(asset.get("assetId") or asset.get("id") or "")


def _asset_role(asset):
    if not isinstance(asset, dict):
        return ""
    return _text(asset.get("role") or asset.get("type") or "")


def _copy_asset_with_environment(asset, payload):
    copied = dict(asset)
    if not copied.get("environmentId"):
        copied["environmentId"] = payload.get("environmentId") or ""
    return copied


def _dedupe_assets(assets):
    seen = set()
    result = []
    for asset in assets:
        asset_id = _asset_id(asset)
        key = asset_id or _asset_file_path(asset)
        if not key or key in seen:
            continue
        seen.add(key)
        result.append(asset)
    return result


def asset_from_payload(payload):
    if not isinstance(payload, dict):
        return {}
    if payload.get("assetId") or payload.get("id"):
        return payload
    for candidate in [
        _dict_child(payload, "backgroundAsset"),
        _dict_child(_dict_child(payload, "environmentAssets"), "background"),
        _dict_child(_dict_child(payload, "assets"), "background"),
    ]:
        if candidate.get("assetId") or candidate.get("id"):
            return _copy_asset_with_environment(candidate, payload)
    return {}


def assets_from_payload(payload):
    if not isinstance(payload, dict):
        return []
    environment_assets = _dict_child(payload, "environmentAssets")
    assets = _dict_child(payload, "assets")
    result = []
    for candidate in [
        _dict_child(payload, "backgroundAsset"),
        _dict_child(environment_assets, "background"),
        _dict_child(assets, "background"),
    ]:
        if _asset_id(candidate):
            result.append(_copy_asset_with_environment(candidate, payload))
            break
    for candidate in [
        _dict_child(payload, "soundscapeAsset"),
        _dict_child(environment_assets, "soundscape"),
        _dict_child(assets, "soundscape"),
    ]:
        if _asset_id(candidate):
            result.append(_copy_asset_with_environment(candidate, payload))
            break
    for candidate in _list_child(payload, "fxAssets") + _list_child(environment_assets, "fx") + _list_child(assets, "fx"):
        if _asset_id(candidate):
            result.append(_copy_asset_with_environment(candidate, payload))
    if not result and (payload.get("assetId") or payload.get("id")):
        result.append(payload)
    return _dedupe_assets(result)


def refresh_asset_registry():
    registry = _asset_op("asset_registry")
    filter_state = _asset_op("asset_filter_state")
    headers = ["assetId", "environmentId", "type", "role", "name", "filePath", "url", "status"]
    _clear_table(registry)
    if registry is not None:
        registry.appendRow(headers)
    try:
        data = _fetch_json(CATALOG_HTTP + "/v0/catalog/media-assets", timeout=1.5)
        assets = data.get("mediaAssets") or data.get("v2MediaAssets") or []
        present_assets = [asset for asset in assets if _text(asset.get("status") or "present") == "present"]
        for asset in present_assets:
            if registry is not None:
                registry.appendRow(_asset_row(asset))
        _write_kv_table(filter_state, {
            "source": CATALOG_HTTP + "/v0/catalog/media-assets",
            "status": "ok",
            "presentCount": len(present_assets),
            "totalCount": len(assets),
            "updatedAt": _now(),
        })
        return present_assets
    except (urllib.error.URLError, urllib.error.HTTPError, ValueError, TimeoutError) as err:
        _write_kv_table(filter_state, {
            "source": CATALOG_HTTP + "/v0/catalog/media-assets",
            "status": "error",
            "message": err,
            "updatedAt": _now(),
        })
        return []


def _ensure_asset_preview_ops():
    root = _base()
    if root is None:
        return None, None
    preview = _op("prepared_background")
    status = _op("prepared_background_status")
    if preview is None:
        try:
            preview = root.create(moviefileinTOP, "prepared_background")
            preview.nodeX = 1150
            preview.nodeY = -120
        except Exception:
            preview = None
    if status is None:
        try:
            status = root.create(textDAT, "prepared_background_status")
            status.nodeX = 1150
            status.nodeY = -260
            status.text = "waiting for environment background"
        except Exception:
            status = None
    return preview, status


def update_asset_preview(selected_items):
    preview, status = _ensure_asset_preview_ops()
    file_path = _text(selected_items.get("filePath") or "")
    if preview is not None and file_path:
        _set_par_value(preview, ["file"], file_path)
        try:
            reload_par = getattr(preview.par, "reloadpulse", None)
            if reload_par is not None:
                reload_par.pulse()
        except Exception:
            pass
    _set_dat_text(
        status,
        "\n".join([
            "PREPARED BACKGROUND",
            "assetId: %s" % selected_items.get("assetId", ""),
            "environmentId: %s" % selected_items.get("environmentId", ""),
            "type: %s" % selected_items.get("type", ""),
            "filePath: %s" % file_path,
            "updatedAt: %s" % selected_items.get("updatedAt", ""),
        ]),
    )


def _ensure_asset_table(name, headers, x=0, y=0):
    table = _asset_op(name)
    if table is None:
        manager = _op("asset_manager_demo")
        if manager is None:
            return None
        try:
            table = manager.create(tableDAT, name)
            table.nodeX = x
            table.nodeY = y
        except Exception:
            return None
    _clear_table(table)
    try:
        table.appendRow(headers)
    except Exception:
        pass
    return table


def _ensure_text_at_root(name, initial_text, x=0, y=0):
    root = _base()
    if root is None:
        return None
    dat = _op(name)
    if dat is not None:
        return dat
    try:
        dat = root.create(textDAT, name)
        dat.text = initial_text
        dat.nodeX = x
        dat.nodeY = y
        return dat
    except Exception:
        return None


def _set_file_parameter(op_obj, file_path):
    if op_obj is None or not file_path:
        return False
    did_set = _set_par_value(op_obj, ["file", "filein", "filename"], file_path)
    try:
        reload_par = getattr(op_obj.par, "reloadpulse", None)
        if reload_par is not None:
            reload_par.pulse()
    except Exception:
        pass
    return did_set


def _clear_file_parameter(op_obj):
    if op_obj is None:
        return False
    did_set = _set_par_value(op_obj, ["file", "filein", "filename"], "")
    try:
        reload_par = getattr(op_obj.par, "reloadpulse", None)
        if reload_par is not None:
            reload_par.pulse()
    except Exception:
        pass
    return did_set


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


def _set_empty_alpha_parameter(op_obj):
    empty_alpha_path = _empty_alpha_path()
    if empty_alpha_path:
        return _set_file_parameter(op_obj, empty_alpha_path)
    return _clear_file_parameter(op_obj)


def _ensure_soundscape_ops():
    root = _base()
    if root is None:
        return None, None
    soundscape = _op("prepared_soundscape")
    if soundscape is None:
        try:
            soundscape = root.create(audiofileinCHOP, "prepared_soundscape")
            soundscape.nodeX = 1150
            soundscape.nodeY = -430
        except Exception:
            soundscape = None
    status = _ensure_text_at_root("prepared_soundscape_status", "waiting for soundscape", x=1150, y=-570)
    return soundscape, status


def _ensure_fx_ops():
    root = _base()
    if root is None:
        return None, None
    fx_overlay = _op("prepared_fx_overlay")
    if fx_overlay is None:
        try:
            fx_overlay = root.create(moviefileinTOP, "prepared_fx_overlay")
            fx_overlay.nodeX = 1450
            fx_overlay.nodeY = -120
        except Exception:
            fx_overlay = None
    status = _ensure_text_at_root("prepared_fx_status", "waiting for fx assets", x=1450, y=-570)
    return fx_overlay, status


def _phase_number_from_payload(payload):
    raw = payload.get("phase") if isinstance(payload, dict) else None
    if raw is None or raw == "":
        raw = payload.get("phaseName") if isinstance(payload, dict) else None
    if raw is None:
        return None
    phase_names = {
        "inloop": 0,
        "intro": 0,
        "pre": 0,
        "loading": 1,
        "load": 1,
        "wait": 1,
        "waiting": 1,
        "situation": 2,
        "scene": 2,
        "live": 2,
        "cams": 2,
        "camera": 2,
    }
    key = _text(raw).strip().lower()
    if key in phase_names:
        return phase_names[key]
    try:
        numeric = int(float(key))
    except Exception:
        return None
    if numeric in [0, 1, 2]:
        return numeric
    return None


def _set_constant_chop_channel(chop, channel_name, value):
    if chop is None:
        return False
    did_set = False
    did_set = _set_par_value(chop, ["numchans", "nchans"], 1) or did_set
    did_set = _set_par_value(chop, ["name0", "chan0name", "chan1name"], channel_name) or did_set
    did_set = _set_par_value(chop, ["value0", "chan0value", "chan1value"], float(value)) or did_set
    try:
        chop.cook(force=True)
    except Exception:
        pass
    return did_set


def _ensure_phase_value_chop(initial_value=0):
    root = _base()
    if root is None:
        return None
    chop = _op(PHASE_VALUE_CHOP)
    if chop is None:
        try:
            chop = root.create(constantCHOP, PHASE_VALUE_CHOP)
            chop.nodeX = 1750
            chop.nodeY = -120
        except Exception:
            chop = None
    _set_constant_chop_channel(chop, "phase", initial_value)
    _ensure_text_at_root(PHASE_VALUE_STATUS, "phase value: %s" % initial_value, x=1750, y=-260)
    return chop


def update_phase_value_chop(payload):
    phase = _phase_number_from_payload(payload)
    if phase is None:
        return None
    chop = _ensure_phase_value_chop(phase)
    _set_constant_chop_channel(chop, "phase", phase)
    status = _op(PHASE_VALUE_STATUS)
    _set_dat_text(status, "phase value: %s\nupdatedAt: %s\nsource: td.phase.set" % (phase, _now()))
    return phase


def _ensure_camera_value_chop(initial_value=1):
    root = _base()
    if root is None:
        return None
    chop = _op(CAMERA_VALUE_CHOP)
    if chop is None:
        try:
            chop = root.create(constantCHOP, CAMERA_VALUE_CHOP)
            chop.nodeX = 1750
            chop.nodeY = -430
        except Exception:
            chop = None
    _set_constant_chop_channel(chop, "camera", initial_value)
    _ensure_text_at_root(CAMERA_VALUE_STATUS, "camera value: %s" % initial_value, x=1750, y=-570)
    return chop


def update_camera_value_chop(payload):
    camera = _camera_number(payload)
    if camera not in ["1", "2", "3"]:
        return None
    camera_value = int(camera)
    chop = _ensure_camera_value_chop(camera_value)
    _set_constant_chop_channel(chop, "camera", camera_value)
    status = _op(CAMERA_VALUE_STATUS)
    _set_dat_text(status, "camera value: %s\nupdatedAt: %s\nsource: td.camera.set" % (camera_value, _now()))
    return camera_value


def _asset_selected_items(asset, cue_id, command, payload_id, payload):
    asset_id = _asset_id(asset)
    return {
        "assetId": asset_id,
        "environmentId": asset.get("environmentId") or payload.get("environmentId") or "",
        "type": asset.get("type") or asset.get("role") or "",
        "role": asset.get("role") or asset.get("type") or "",
        "filePath": asset.get("filePath") or asset.get("absolutePath") or asset.get("file") or _asset_file_path(asset),
        "url": asset.get("url") or ("/v0/catalog/media-assets/file/" + urllib.parse.quote(asset_id) if asset_id else ""),
        "cueId": cue_id,
        "command": command,
        "payloadId": payload_id,
        "updatedAt": _now(),
    }


def _write_asset_bundle_table(asset_items):
    table = _ensure_asset_table(
        "asset_bundle",
        ["role", "type", "assetId", "environmentId", "filePath", "url", "updatedAt"],
        x=600,
        y=-440,
    )
    if table is None:
        return
    for item in asset_items:
        try:
            table.appendRow([
                _text(item.get("role") or ""),
                _text(item.get("type") or ""),
                _text(item.get("assetId") or ""),
                _text(item.get("environmentId") or ""),
                _text(item.get("filePath") or ""),
                _text(item.get("url") or ""),
                _text(item.get("updatedAt") or ""),
            ])
        except Exception:
            pass


def update_asset_bundle_outputs(asset_items):
    background = None
    soundscape = None
    fx_overlay = None
    fx_items = []
    for item in asset_items:
        role = _text(item.get("role") or item.get("type") or "")
        file_path = _text(item.get("filePath") or "")
        lower_path = file_path.lower()
        if role == "background" and background is None:
            background = item
        elif role == "soundscape" and soundscape is None:
            soundscape = item
        elif role in ["fx", "fxVideo", "fxImage"] or lower_path.endswith((".mp4", ".mov", ".m4v", ".webm", ".jpg", ".jpeg", ".png", ".webp")):
            fx_items.append(item)
            if fx_overlay is None:
                fx_overlay = item

    if background is not None:
        update_asset_preview(background)

    soundscape_op, soundscape_status = _ensure_soundscape_ops()
    if soundscape is not None:
        soundscape_path = _text(soundscape.get("filePath") or "")
        _set_file_parameter(soundscape_op, soundscape_path)
        _set_dat_text(
            soundscape_status,
            "\n".join([
                "PREPARED SOUNDSCAPE",
                "assetId: %s" % soundscape.get("assetId", ""),
                "environmentId: %s" % soundscape.get("environmentId", ""),
                "filePath: %s" % soundscape_path,
                "updatedAt: %s" % soundscape.get("updatedAt", ""),
            ]),
        )

    fx_overlay_op, fx_status = _ensure_fx_ops()
    if fx_overlay is not None:
        _set_file_parameter(fx_overlay_op, _text(fx_overlay.get("filePath") or ""))
        _set_dat_text(
            fx_status,
            "\n".join([
                "PREPARED FX",
                "count: %s" % len(fx_items),
                "overlay: %s" % fx_overlay.get("filePath", ""),
                "updatedAt: %s" % _now(),
            ]),
        )
    else:
        _set_empty_alpha_parameter(fx_overlay_op)
        _set_dat_text(
            fx_status,
            "\n".join([
                "NO FX OVERLAY",
                "count: 0",
                "overlay: empty alpha",
                "filePath: %s" % _empty_alpha_path(),
                "updatedAt: %s" % _now(),
            ]),
        )


def select_asset_from_payload(cue_id, command, payload_id, payload):
    selected = _asset_op("selected_asset")
    prepare_log = _asset_op("asset_prepare_log")
    asset_payload = asset_from_payload(payload)
    selected_items = _asset_selected_items(asset_payload, cue_id, command, payload_id, payload)
    _write_kv_table(selected, selected_items)
    _append_row_at(
        _root_path("asset_manager_demo", "asset_prepare_log"),
        ["at", "cueId", "command", "payloadId", "assetId", "environmentId", "type", "filePath"],
        [
            _now(),
            cue_id,
            command,
            payload_id,
            selected_items["assetId"],
            selected_items["environmentId"],
            selected_items["type"],
            selected_items["filePath"],
        ],
    )
    try:
        update_asset_preview(selected_items)
    except Exception as err:
        selected_items["previewError"] = _text(err)
    return selected_items


def select_assets_from_payload(cue_id, command, payload_id, payload):
    prepare_log = _asset_op("asset_prepare_log")
    asset_items = [
        _asset_selected_items(asset, cue_id, command, payload_id, payload)
        for asset in assets_from_payload(payload)
    ]
    if not asset_items:
        update_asset_bundle_outputs([])
        return []
    _write_asset_bundle_table(asset_items)
    for item in asset_items:
        _append_row_at(
            _root_path("asset_manager_demo", "asset_prepare_log"),
            ["at", "cueId", "command", "payloadId", "assetId", "environmentId", "type", "filePath"],
            [
                _now(),
                cue_id,
                command,
                payload_id,
                item["assetId"],
                item["environmentId"],
                item["type"],
                item["filePath"],
            ],
        )
    try:
        update_asset_bundle_outputs(asset_items)
    except Exception as err:
        if prepare_log is not None:
            try:
                prepare_log.appendRow([_now(), cue_id, command, payload_id, "asset_bundle_error", "", "", _text(err)])
            except Exception:
                pass
    selected = _asset_op("selected_asset")
    first_background = next((item for item in asset_items if item.get("role") == "background"), asset_items[0])
    _write_kv_table(selected, first_background)
    return asset_items


def handle_td_cue(cue_id, command, payload_id="-"):
    cue_id = _text(cue_id)
    command = _text(command)
    payload_id = _text(payload_id or "-")

    _append_row(
        "cue_log",
        ["at", "cueId", "command", "payloadId", "trigger", "stage", "status", "message"],
        [_now(), cue_id, command, payload_id, "-", "received", "ok", "osc_received"],
    )
    ack(cue_id, command, "received", "ok", "osc_received")

    if command not in SUPPORTED_COMMANDS:
        message = "unsupported_command:%s" % command
        update_trigger("trigger_unknown", cue_id, command, payload_id, {}, "error", "error", message)
        _append_row(
            "cue_log",
            ["at", "cueId", "command", "payloadId", "trigger", "stage", "status", "message"],
            [_now(), cue_id, command, payload_id, "trigger_unknown", "error", "error", message],
        )
        _set_status(lastCue=cue_id, lastCommand=command, lastPayloadId=payload_id, lastTrigger="trigger_unknown", lastStage="error", lastStatus="error", message=message)
        ack(cue_id, command, "error", "error", message)
        return False

    try:
        payload = fetch_payload(payload_id)
        payload_ok = "ok"
        payload_message = _summary(payload)
    except (urllib.error.URLError, urllib.error.HTTPError, ValueError, TimeoutError) as err:
        payload = {}
        payload_ok = "error"
        payload_message = _text(err)

    _append_row(
        "payload_log",
        ["at", "cueId", "command", "payloadId", "status", "summary"],
        [_now(), cue_id, command, payload_id, payload_ok, payload_message],
    )

    trigger_name = route_trigger(command, payload)

    if payload_ok != "ok":
        update_trigger(trigger_name, cue_id, command, payload_id, payload, "error", "error", payload_message)
        _append_row(
            "cue_log",
            ["at", "cueId", "command", "payloadId", "trigger", "stage", "status", "message"],
            [_now(), cue_id, command, payload_id, trigger_name, "error", "error", payload_message],
        )
        _set_status(lastCue=cue_id, lastCommand=command, lastPayloadId=payload_id, lastTrigger=trigger_name, lastStage="error", lastStatus="error", message=payload_message)
        ack(cue_id, command, "error", "error", payload_message)
        return False

    selected_asset = None
    selected_assets = []
    try:
        if command == "td.asset.prepare":
            selected_assets = select_assets_from_payload(cue_id, command, payload_id, payload)
            if selected_assets:
                selected_asset = selected_assets[0]
        if command in ["td.environment.prepare", "td.environment.go"] and assets_from_payload(payload):
            selected_assets = select_assets_from_payload(cue_id, command, payload_id, payload)
            if selected_assets:
                selected_asset = selected_assets[0]
    except Exception as err:
        _append_row(
            "cue_log",
            ["at", "cueId", "command", "payloadId", "trigger", "stage", "status", "message"],
            [_now(), cue_id, command, payload_id, trigger_name, "asset_select_warning", "warning", err],
        )

    stage = _final_stage(command)
    message = "%s:%s_ok" % (trigger_name, command.replace(".", "_"))
    if command == "td.phase.set":
        phase_value = update_phase_value_chop(payload)
        if phase_value is None:
            message = "%s phase:ignored" % message
        else:
            message = "%s phase:%s" % (message, phase_value)
    if command == "td.camera.set":
        camera_value = update_camera_value_chop(payload)
        if camera_value is None:
            message = "%s camera:ignored" % message
        else:
            message = "%s camera:%s" % (message, camera_value)
    if selected_assets:
        fx_count = len([item for item in selected_assets if _text(item.get("role") or item.get("type") or "") in ["fx", "fxVideo", "fxImage"]])
        message = "%s assets:%s fx:%s" % (message, len(selected_assets), "loaded" if fx_count else "empty")
    elif selected_asset and selected_asset.get("assetId"):
        message = "%s asset:%s" % (message, selected_asset.get("assetId"))
    update_trigger(trigger_name, cue_id, command, payload_id, payload, stage, "ok", message)
    _append_row(
        "cue_log",
        ["at", "cueId", "command", "payloadId", "trigger", "stage", "status", "message"],
        [_now(), cue_id, command, payload_id, trigger_name, stage, "ok", message],
    )
    _set_status(lastCue=cue_id, lastCommand=command, lastPayloadId=payload_id, lastTrigger=trigger_name, lastStage=stage, lastStatus="ok", message=message)
    ack(cue_id, command, stage, "ok", message)
    return True


def _parse_callback_args(callback_args):
    address = ""
    osc_args = []
    for item in callback_args:
        if _text(item).startswith("/"):
            address = _text(item)
        elif isinstance(item, (list, tuple)):
            osc_args = list(item)
    if not osc_args and len(callback_args) >= 3:
        osc_args = list(callback_args[-1]) if isinstance(callback_args[-1], (list, tuple)) else []
    return address, [_text(item) for item in osc_args]


def onReceiveOSC(*callback_args):
    address, osc_args = _parse_callback_args(callback_args)
    if address and address != "/td/cue":
        return
    cue_id = osc_args[0] if len(osc_args) > 0 else ""
    command = osc_args[1] if len(osc_args) > 1 else ""
    payload_id = osc_args[2] if len(osc_args) > 2 else "-"
    handle_td_cue(cue_id, command, payload_id)
    return


def start():
    _ensure_table("cue_log", ["at", "cueId", "command", "payloadId", "trigger", "stage", "status", "message"])
    _ensure_table("payload_log", ["at", "cueId", "command", "payloadId", "status", "summary"])
    _ensure_table("trigger_overview", ["trigger", "count", "lastCommand", "lastStage", "lastStatus", "updatedAt"])
    for trigger_name in TRIGGER_NAMES:
        status_table = _trigger_op(trigger_name, "status_state")
        if status_table is not None and status_table.numRows == 0:
            initial_status = {
                "count": 0,
                "lastCueId": "-",
                "lastCommand": "-",
                "lastPayloadId": "-",
                "lastStage": "ready",
                "lastStatus": "ok",
                "message": "waiting",
                "updatedAt": _now(),
            }
            _write_kv_table(status_table, initial_status)
            _apply_trigger_visual(trigger_name, initial_status, {})
            _update_trigger_overview(trigger_name, _table_to_dict(status_table))
        elif status_table is not None:
            status_items = _table_to_dict(status_table)
            _apply_trigger_visual(trigger_name, status_items, {})
            _update_trigger_overview(trigger_name, status_items)
    _ensure_phase_value_chop(0)
    _ensure_camera_value_chop(1)
    refresh_asset_registry()
    _set_status(lastCue="-", lastCommand="-", lastPayloadId="-", lastTrigger="-", lastStage="ready", lastStatus="ok", message="listening on udp 9100")
    return True


def stop():
    _set_status(lastCue="-", lastCommand="-", lastPayloadId="-", lastTrigger="-", lastStage="stopped", lastStatus="ok", message="bridge stopped")
    return True
