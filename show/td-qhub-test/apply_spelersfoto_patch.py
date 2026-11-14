"""
For_You: beelden van de spelers bewaren tijdens de scène, voor de vraag "welk personage vond je het leukst?".

Draaien via de opdrachtenmap (kopie in ~/ForYou/td-opdrachten/in) of in de Textport:

    exec(open('/Users/for_you/ForYou/main/show/td-qhub-test/apply_spelersfoto_patch.py').read())

Wat het doet:
- maakt /project1/fy_spelersfoto (Execute DAT). Tijdens de scène (fase 2) bewaart die elke paar seconden
  het beeld van elke speler met de omgeving erachter (comp1, comp5, comp6 = camera 1, 2, 3) als JPEG in
  ~/ForYou/spelersfoto/plek1, plek2 en plek3. Per plek blijven de laatste 40 beelden staan.
- show/spelersfoto/spelersfoto.py kiest daaruit het beste beeld per speler en geeft het aan de publieksserver.

Bewaart NIET. Uitzetten: SPELERSFOTO_UIT = True zetten en opnieuw draaien.
Nogmaals draaien kan: staat het al goed, dan verandert er niets.
"""

SPELERSFOTO_UIT = False

_TEKST = '''# For_You: bewaart tijdens de scène beelden van de spelers (zie apply_spelersfoto_patch.py).
import os

BRONNEN = ((1, 'comp1'), (2, 'comp5'), (3, 'comp6'))
MAP = os.path.expanduser('~/ForYou/spelersfoto')
OM_DE = 150        # frames tussen twee beelden van dezelfde speler (50 fps = 3 seconden)
BEWAAR = 40        # zoveel beelden blijven per plek staan


def onFrameStart(frame):
    if int(round(op('/project1/phase_value')['phase'].eval())) != 2:
        return
    # De drie spelers om de beurt, zodat er nooit drie beelden in hetzelfde frame bewaard worden.
    stap = absTime.frame % OM_DE
    for index, (plek, naam) in enumerate(BRONNEN):
        if stap != index * (OM_DE // len(BRONNEN)):
            continue
        bron = op('/project1/' + naam)
        if bron is None:
            continue
        map_ = os.path.join(MAP, 'plek%d' % plek)
        os.makedirs(map_, exist_ok=True)
        bron.save(os.path.join(map_, '%010d.jpg' % absTime.frame), asynchronous=True, quality=0.8)
        oud = sorted(f for f in os.listdir(map_) if f.endswith('.jpg'))[:-BEWAAR]
        for bestand in oud:
            try:
                os.remove(os.path.join(map_, bestand))
            except OSError:
                pass
    return
'''


def _spelersfoto_patch():
    r = op('/project1')
    ontbreekt = [naam for naam in ('comp1', 'comp5', 'comp6', 'phase_value') if r.op(naam) is None]
    if ontbreekt:
        print('For_You spelersfoto: niets gedaan, ontbreekt: %s' % ontbreekt)
        return
    dat = r.op('fy_spelersfoto')
    if SPELERSFOTO_UIT:
        if dat is not None:
            dat.par.active = False
        print('For_You spelersfoto: uitgezet; NIET bewaard')
        return
    if dat is None:
        dat = r.create(executeDAT, 'fy_spelersfoto')
        anker = r.op('fy_opdrachten')
        if anker is not None:
            dat.nodeX = anker.nodeX
            dat.nodeY = anker.nodeY - 160
    dat.text = _TEKST
    dat.par.framestart = True
    dat.par.active = True
    print('For_You spelersfoto: fy_spelersfoto staat aan (alleen tijdens de scène); NIET bewaard')


_spelersfoto_patch()
