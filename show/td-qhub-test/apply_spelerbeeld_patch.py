"""
For_You: de camerabeelden van de spelers voor het zaalscherm en de telefoon.

Draaien via de opdrachtenmap (kopie in ~/ForYou/td-opdrachten/in) of in de Textport:

    exec(open('/Users/for_you/ForYou/main/show/td-qhub-test/apply_spelerbeeld_patch.py').read())

Wat het doet:
- maakt per speler een klein beeld van de ruwe camera (CameraN/raw, met greenscreen en al):
  /project1/fy_speler_bron1..3 (Select) en /project1/fy_speler_klein1..3 (270 x 480).
- maakt /project1/fy_spelerbeeld (Execute DAT):
  * buiten de scène (inloop en loading) bewaart die twee keer per seconde het kleine beeld van elke
    speler in ~/ForYou/spelerbeeld (plekN_a.jpg en plekN_b.jpg om en om). De publieksserver leest die
    en het zaalscherm toont ze in zwart-wit tijdens het stemmen en het laden.
  * tijdens de scène bewaart die elke 3 seconden het beeld van elke speler met de omgeving erachter
    (comp1, comp5, comp6) in ~/ForYou/spelersfoto/plekN, voor de foto bij de personagevraag.

Bewaart het project NIET: bewaar het zelf als nieuwe versie, anders is dit weg na een herstart van
TouchDesigner. Uitzetten: SPELERBEELD_UIT = True zetten en opnieuw draaien. Nogmaals draaien kan.
"""

SPELERBEELD_UIT = False

_TEKST = '''# For_You: bewaart beelden van de spelers (zie apply_spelerbeeld_patch.py).
import os

KLEIN = ((1, 'fy_speler_klein1'), (2, 'fy_speler_klein2'), (3, 'fy_speler_klein3'))
SCENE = ((1, 'comp1'), (2, 'comp5'), (3, 'comp6'))
MAP_KLEIN = os.path.expanduser('~/ForYou/spelerbeeld')
MAP_SCENE = os.path.expanduser('~/ForYou/spelersfoto')
OM_DE_KLEIN = 24     # frames tussen twee beelden van dezelfde speler buiten de scène (50 fps = twee per seconde)
OM_DE_SCENE = 150    # tijdens de scène: elke 3 seconden
BEWAAR = 40          # zoveel scènebeelden blijven per plek staan


def onFrameStart(frame):
    fase = int(round(op('/project1/phase_value')['phase'].eval()))
    f = absTime.frame
    if fase != 2:
        stap = f % OM_DE_KLEIN
        for index, (plek, naam) in enumerate(KLEIN):
            if stap != index * (OM_DE_KLEIN // len(KLEIN)):
                continue
            bron = op('/project1/' + naam)
            if bron is None:
                continue
            os.makedirs(MAP_KLEIN, exist_ok=True)
            # Om en om naar twee bestanden: de lezer pakt het bestand dat al af is.
            letter = 'a' if (f // OM_DE_KLEIN) % 2 == 0 else 'b'
            bron.save(os.path.join(MAP_KLEIN, 'plek%d_%s.jpg' % (plek, letter)), asynchronous=True, quality=0.7)
        return
    stap = f % OM_DE_SCENE
    for index, (plek, naam) in enumerate(SCENE):
        if stap != index * (OM_DE_SCENE // len(SCENE)):
            continue
        bron = op('/project1/' + naam)
        if bron is None:
            continue
        map_ = os.path.join(MAP_SCENE, 'plek%d' % plek)
        os.makedirs(map_, exist_ok=True)
        bron.save(os.path.join(map_, '%010d.jpg' % f), asynchronous=True, quality=0.8)
        for bestand in sorted(b for b in os.listdir(map_) if b.endswith('.jpg'))[:-BEWAAR]:
            try:
                os.remove(os.path.join(map_, bestand))
            except OSError:
                pass
    return
'''


def _spelerbeeld_patch():
    r = op('/project1')
    ontbreekt = [naam for naam in ('Camera1', 'Camera2', 'Camera3', 'comp1', 'comp5', 'comp6', 'phase_value') if r.op(naam) is None]
    if ontbreekt:
        print('For_You spelerbeeld: niets gedaan, ontbreekt: %s' % ontbreekt)
        return
    dat = r.op('fy_spelerbeeld')
    if SPELERBEELD_UIT:
        if dat is not None:
            dat.par.active = False
        print('For_You spelerbeeld: uitgezet; NIET bewaard')
        return
    anker = r.op('fy_opdrachten')
    x0 = anker.nodeX if anker is not None else 0
    y0 = (anker.nodeY if anker is not None else 0) - 320
    for n in (1, 2, 3):
        bron = r.op('fy_speler_bron%d' % n) or r.create(selectTOP, 'fy_speler_bron%d' % n)
        bron.par.top = '/project1/Camera%d/raw' % n
        bron.nodeX, bron.nodeY = x0 + (n - 1) * 320, y0
        klein = r.op('fy_speler_klein%d' % n) or r.create(fitTOP, 'fy_speler_klein%d' % n)
        klein.inputConnectors[0].connect(bron)
        klein.par.outputresolution = 'custom'
        klein.par.resolutionw = 270
        klein.par.resolutionh = 480
        klein.nodeX, klein.nodeY = x0 + (n - 1) * 320 + 150, y0
    if dat is None:
        dat = r.create(executeDAT, 'fy_spelerbeeld')
        dat.nodeX, dat.nodeY = x0, y0 - 160
    dat.text = _TEKST
    dat.par.framestart = True
    dat.par.active = True
    oud = r.op('fy_spelersfoto')
    if oud is not None:
        oud.par.active = False
    print('For_You spelerbeeld: fy_spelerbeeld staat aan; klein beeld %s; NIET bewaard' % [(r.op('fy_speler_klein%d' % n).width, r.op('fy_speler_klein%d' % n).height) for n in (1, 2, 3)])


_spelerbeeld_patch()
