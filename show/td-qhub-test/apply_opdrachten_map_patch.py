"""
For_You: opdrachtenmap voor TouchDesigner.

Draaien in de Textport van TouchDesigner, met het show-project open:

    exec(open('/Users/for_you/ForYou/main/show/td-qhub-test/apply_opdrachten_map_patch.py').read())

Waarom: opdrachten voor TouchDesigner (een webpagina herladen, een ingang omleggen, iets uitlezen)
gingen via de Textport, en daar kan alleen in getypt worden door het hele scherm over te nemen.

Wat het doet: zet één Execute DAT in het project, /project1/fy_opdrachten. Die kijkt twee keer per
seconde in de map ~/ForYou/td-opdrachten/in. Elk .py-bestand daar wordt één keer uitgevoerd, met
dezelfde namen als in de Textport (op, ops, root, project, ...). Wat het afdrukt, of de foutmelding,
komt in ~/ForYou/td-opdrachten/uit/<naam>.txt (eerste regel: ok of fout). Het bestand zelf verhuist
naar ~/ForYou/td-opdrachten/gedaan.

Er gaat geen netwerkpoort open: alleen wie op deze Mac bestanden kan schrijven, kan een opdracht geven.
Een opdracht kan alles wat de Textport kan.

Bewaart NIET. Bewaar het project zelf, anders is het na een herstart van TouchDesigner weg.
Uitzetten: /project1/fy_opdrachten op niet-actief zetten of weggooien.
Nogmaals draaien kan: de tekst van de DAT wordt dan ververst.
"""

import os

FY_OPDRACHTEN_MAP = os.path.expanduser('~/ForYou/td-opdrachten')

FY_OPDRACHTEN_TEKST = r'''# For_You opdrachtenmap: zie show/td-qhub-test/apply_opdrachten_map_patch.py
import contextlib
import io
import os
import traceback

MAP = os.path.expanduser('~/ForYou/td-opdrachten')
IN = os.path.join(MAP, 'in')
UIT = os.path.join(MAP, 'uit')
GEDAAN = os.path.join(MAP, 'gedaan')


def _voer_uit(naam):
    pad = os.path.join(IN, naam)
    uitvoer = io.StringIO()
    status = 'ok'
    try:
        with open(pad, encoding='utf-8') as bestand:
            code = bestand.read()
        # Eerst verhuizen: een opdracht die misgaat wordt nooit opnieuw geprobeerd.
        os.replace(pad, os.path.join(GEDAAN, naam))
        namen = dict(globals())
        namen['__name__'] = 'fy_opdracht'
        with contextlib.redirect_stdout(uitvoer):
            exec(compile(code, naam, 'exec'), namen)
    except Exception:
        status = 'fout'
        uitvoer.write(traceback.format_exc())
    tijdelijk = os.path.join(UIT, naam + '.tmp')
    with open(tijdelijk, 'w', encoding='utf-8') as bestand:
        bestand.write(status + '\n' + uitvoer.getvalue())
    os.replace(tijdelijk, os.path.join(UIT, naam[:-3] + '.txt'))


def onFrameStart(frame):
    if absTime.frame % 25:
        return
    try:
        namen = sorted(naam for naam in os.listdir(IN) if naam.endswith('.py') and not naam.startswith('.'))
    except Exception:
        return
    for naam in namen:
        _voer_uit(naam)
    return
'''


def _opdrachten_map_patch():
    root = op('/project1')
    if root is None:
        print('For_You opdrachtenmap: niets gedaan, /project1 ontbreekt')
        return
    for sub in ('in', 'uit', 'gedaan'):
        os.makedirs(os.path.join(FY_OPDRACHTEN_MAP, sub), exist_ok=True)
    dat = root.op('fy_opdrachten')
    nieuw = dat is None
    if nieuw:
        dat = root.create(executeDAT, 'fy_opdrachten')
        dat.nodeX = 1150
        dat.nodeY = -900
        dat.comment = 'For_You: voert opdrachten uit ~/ForYou/td-opdrachten/in uit'
    dat.text = FY_OPDRACHTEN_TEKST
    try:
        dat.par.framestart = True
        dat.par.active = True
    except Exception as fout:
        print('For_You opdrachtenmap: parameters niet gezet (%s); beschikbaar: %s' % (fout, [p.name for p in dat.pars()]))
        return
    print('For_You opdrachtenmap: %s %s, map %s, NIET bewaard' % ('geplaatst' if nieuw else 'ververst', dat.path, FY_OPDRACHTEN_MAP))


_opdrachten_map_patch()
