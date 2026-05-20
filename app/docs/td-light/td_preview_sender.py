"""
TouchDesigner Light preview sender.

Place this in a Text DAT inside the TD-light POC, then call:

    mod.td_preview_sender.post_all_previews()

from a Timer Execute DAT or DAT Execute DAT at 2-5 fps.

The operator paths below are intentionally explicit placeholders for the
/ShowLight layer. Rename either the TD operators or these paths when wiring the
POC copy.
"""

import base64
import json
import os
import tempfile
import time
import urllib.error
import urllib.request


SERVER_URL = os.environ.get("FORYOU_TD_PREVIEW_URL", "http://127.0.0.1:3310")
TD_PREVIEW_SECRET = os.environ.get("TD_PREVIEW_SECRET", "")
JPEG_QUALITY = 0.62

SOURCE_TOPS = {
    "cam1_raw": "/ShowLight/preview_bus/cam1_raw_preview",
    "cam1_key": "/ShowLight/preview_bus/cam1_key_preview",
    "cam2_raw": "/ShowLight/preview_bus/cam2_raw_preview",
    "cam2_key": "/ShowLight/preview_bus/cam2_key_preview",
    "cam3_raw": "/ShowLight/preview_bus/cam3_raw_preview",
    "cam3_key": "/ShowLight/preview_bus/cam3_key_preview",
    "main_out": "/ShowLight/preview_bus/main_out_preview",
    "tp1_out": "/ShowLight/preview_bus/tp1_out_preview",
    "tp2_out": "/ShowLight/preview_bus/tp2_out_preview",
    "tp3_out": "/ShowLight/preview_bus/tp3_out_preview",
}

_sequence = 0
_last_status = {}


def _next_sequence():
    global _sequence
    _sequence += 1
    return _sequence


def _safe_int(value, fallback=0):
    try:
        return int(value)
    except Exception:
        return fallback


def _top_size(top):
    width = _safe_int(getattr(top, "width", 0), 0)
    height = _safe_int(getattr(top, "height", 0), 0)
    return width, height


def _save_top_to_jpeg(top, source_id):
    file_path = os.path.join(tempfile.gettempdir(), "tdlight_preview_%s.jpg" % source_id)
    try:
        top.save(file_path, quality=JPEG_QUALITY)
    except TypeError:
        top.save(file_path)
    return file_path


def _post_json(source_id, image_bytes, width, height):
    sequence = _next_sequence()
    payload = {
        "sourceId": source_id,
        "width": width,
        "height": height,
        "sequence": sequence,
        "imageBase64": "data:image/jpeg;base64,%s" % base64.b64encode(image_bytes).decode("ascii"),
    }
    body = json.dumps(payload).encode("utf-8")
    request = urllib.request.Request(
        "%s/admin/td-preview/frame" % SERVER_URL.rstrip("/"),
        data=body,
        headers={
            "Content-Type": "application/json",
            "x-td-preview-secret": TD_PREVIEW_SECRET,
        },
        method="POST",
    )
    with urllib.request.urlopen(request, timeout=0.75) as response:
        response.read()
        return response.getcode()


def post_preview(source_id, top_path=None):
    top_path = top_path or SOURCE_TOPS.get(source_id)
    if not top_path:
        _last_status[source_id] = "missing_source_mapping"
        return False

    top = op(top_path)
    if top is None:
        _last_status[source_id] = "missing_top:%s" % top_path
        return False

    try:
        width, height = _top_size(top)
        file_path = _save_top_to_jpeg(top, source_id)
        with open(file_path, "rb") as handle:
            image_bytes = handle.read()
        status_code = _post_json(source_id, image_bytes, width, height)
        _last_status[source_id] = "ok:%s:%s" % (status_code, time.time())
        return True
    except (urllib.error.URLError, urllib.error.HTTPError) as err:
        _last_status[source_id] = "http_error:%s" % err
    except Exception as err:
        _last_status[source_id] = "error:%s" % err
    return False


def post_all_previews():
    ok_count = 0
    for source_id, top_path in SOURCE_TOPS.items():
        if post_preview(source_id, top_path):
            ok_count += 1
    return {
        "ok": ok_count,
        "total": len(SOURCE_TOPS),
        "status": dict(_last_status),
    }


def last_status():
    return dict(_last_status)
