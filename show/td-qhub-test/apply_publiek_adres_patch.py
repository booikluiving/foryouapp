"""
For_You: adressen van de publiekspagina's in TouchDesigner bijwerken.

Draaien in de Textport van TouchDesigner, met het actuele showbestand open:

    exec(open('/Users/for_you/ForYou/main/show/td-qhub-test/apply_publiek_adres_patch.py').read())

Wat het doet:
- Zoekt alle Web Render TOPs onder /project1 en haalt een versiedeel vóór
  /audience uit het adres (…:3026/<versie>/audience/stage/… wordt …:3026/audience/stage/…).
  Het gaat om webrender_wifi en webrender_sessie.
- Bewaart als een nieuwe versie (teller + 1) en zet TOENAME mee. Let op: project.save
  neemt de hele live stand mee, ook niet-bewaarde wijzigingen. Zet PUBLIEK_ADRES_SAVE
  op False om zelf te bewaren.

Nogmaals draaien kan: wat al goed staat, blijft staan.
"""

import os
import re

PUBLIEK_ADRES_SAVE = True


def _nieuw_adres(url):
    return re.sub(r"/v\d+/audience", "/audience", str(url or ""))


def _next_version_name(current_name):
    match = re.search(r"v(\d+)\.(\d+)\.toe$", current_name)
    if not match:
        raise RuntimeError("versie niet herkend in %s" % current_name)
    return current_name[:match.start()] + "v%s.%s" % (match.group(1), int(match.group(2)) + 1) + ".toe"


def apply_publiek_adres_patch():
    root = op("/project1")
    gewijzigd = []
    for item in root.findChildren(type=webrenderTOP):
        oud = item.par.url.eval()
        nieuw = _nieuw_adres(oud)
        if nieuw != oud:
            item.par.url = nieuw
            gewijzigd.append((item.path, oud, nieuw))
    for pad, oud, nieuw in gewijzigd:
        print("For_You publiek adres:", pad, oud, "->", nieuw)
    if not gewijzigd:
        print("For_You publiek adres: niets te wijzigen")
        return None
    if not PUBLIEK_ADRES_SAVE:
        print("For_You publiek adres: klaar, NIET bewaard (PUBLIEK_ADRES_SAVE = False)")
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
    print("For_You publiek adres: klaar, bewaard als", new_path)
    return new_path


apply_publiek_adres_patch()
