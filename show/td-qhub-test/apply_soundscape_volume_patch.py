"""
For_You: volume van het sfeergeluid per omgeving in het show-TD.

Draaien in de Textport van TouchDesigner, met het show-project open:

    exec(open('/Users/for_you/ForYou/main/show/td-qhub-test/apply_soundscape_volume_patch.py').read())

Wat het doet, alleen in de tekst van /project1/td_qhub_router:
- na het zetten van het bestand op prepared_soundscape zet de router ook
  prepared_soundscape.par.volume, uit soundscape.volume in de payload (0-1).
  Show Control vult dat uit de catalogus (omgeving -> extras.sfeer.volume).
- Ontbreekt het volume (oude Show Control), dan wordt het 1: zoals nu.
Geen operators, geen verbindingen. Het volume geldt vanaf de volgende omgeving
die klaargezet wordt.

Bewaart standaard NIET (SOUNDSCAPE_VOLUME_SAVE = False): project.save neemt de hele
live stand mee. Zonder bewaren is de patch na een herstart van TD weg en speelt alles
weer op 100%.

Terugdraaien: de vorige versie openen, of de regels tussen de markers weghalen.
Nogmaals draaien kan: staat hij er al, dan verandert er niets.
"""

import os
import re

SOUNDSCAPE_VOLUME_SAVE = False
SOUNDSCAPE_VOLUME_NEW_VERSION = None  # bijvoorbeeld "v1.15"; None = huidige versie + 1

ROUTER_MARKER = "# --- For_You sfeer volume ---"

CALL_OLD = "        _set_file_parameter(soundscape_op, soundscape_path)\n"
CALL_NEW = CALL_OLD + "        _set_soundscape_volume(soundscape_op, soundscape.get(\"volume\"))  " + ROUTER_MARKER + "\n"

FUNCTION_ANCHOR = "def update_asset_bundle_outputs(asset_items):"
FUNCTION_CODE = ROUTER_MARKER + '''
def _set_soundscape_volume(op_obj, volume):
    if op_obj is None:
        return False
    try:
        value = float(volume)
    except Exception:
        value = 1.0
    if value != value:
        value = 1.0
    value = max(0.0, min(1.0, value))
    try:
        op_obj.par.volume = value
        return True
    except Exception:
        return False
# --- einde For_You sfeer volume ---


'''


def patch_router_text(text):
    """Geeft de nieuwe routertekst terug. Zelfde tekst als hij al gepatcht is."""
    if ROUTER_MARKER in text:
        return text
    if text.count(CALL_OLD) != 1:
        raise RuntimeError("td_qhub_router: _set_file_parameter(soundscape_op, ...) niet herkend, niets veranderd")
    if text.count(FUNCTION_ANCHOR) != 1:
        raise RuntimeError("td_qhub_router: update_asset_bundle_outputs niet gevonden, niets veranderd")
    text = text.replace(CALL_OLD, CALL_NEW)
    return text.replace(FUNCTION_ANCHOR, FUNCTION_CODE + FUNCTION_ANCHOR)


def _next_version_name(current_name):
    match = re.search(r"v(\d+)\.(\d+)\.toe$", current_name)
    if not match:
        raise RuntimeError("versie niet herkend in %s" % current_name)
    new_version = SOUNDSCAPE_VOLUME_NEW_VERSION or "v%s.%s" % (match.group(1), int(match.group(2)) + 1)
    return current_name[:match.start()] + new_version + ".toe"


def apply_soundscape_volume_patch():
    root = op("/project1")
    router = root.op("td_qhub_router")
    if router is None:
        raise RuntimeError("niet gevonden: /project1/td_qhub_router")
    router.text = patch_router_text(router.text)
    if not SOUNDSCAPE_VOLUME_SAVE:
        print("For_You sfeer volume: klaar, NIET bewaard (SOUNDSCAPE_VOLUME_SAVE = False)")
        return None
    current_name = os.path.basename(project.name if project.name.endswith(".toe") else project.name + ".toe")
    new_name = _next_version_name(current_name)
    variables = op("/local/set_variables")
    if variables is not None and variables.row("TOENAME") is not None:
        variables["TOENAME", 1] = new_name
    new_path = os.path.join(project.folder, new_name)
    if os.path.exists(new_path):
        raise RuntimeError("bestaat al, niet overschreven: %s" % new_path)
    project.save(new_path)
    print("For_You sfeer volume: klaar, bewaard als", new_path)
    return new_path


if __name__ != "soundscape_volume_offline_test":
    try:
        op  # alleen binnen TouchDesigner
    except NameError:
        pass
    else:
        apply_soundscape_volume_patch()
