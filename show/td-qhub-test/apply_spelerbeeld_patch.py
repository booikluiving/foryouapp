"""
For_You: de camerabeelden van de spelers voor het zaalscherm en de telefoon.

Draaien via de opdrachtenmap (kopie in ~/ForYou/td-opdrachten/in) of in de Textport:

    exec(open('/Users/for_you/ForYou/main/show/td-qhub-test/apply_spelerbeeld_patch.py').read())

Wat het doet:
- maakt per speler een klein beeld van de ruwe camera (CameraN/raw, met greenscreen en al):
  /project1/fy_speler_bron1..3 (Select) en /project1/fy_speler_klein1..3 (270 x 480).
- maakt /project1/fy_spelerbeeld (Execute DAT):
  * buiten de scène (inloop en loading) bewaart die zo'n 17 keer per seconde één strook met de drie
    spelers naast elkaar (/project1/fy_speler_strook, 810 x 480) in ~/ForYou/spelerbeeld
    (strook_0.jpg, strook_1.jpg, strook_2.jpg om de beurt). De publieksserver geeft die als doorlopende
    beeldstroom aan het zaalscherm, dat ze in zwart-wit toont tijdens de inloop, het stemmen en het laden.
  * tijdens de scène bewaart die elke 3 seconden het beeld van elke speler met de omgeving erachter
    (comp1, comp5, comp6) in ~/ForYou/spelersfoto/plekN, voor de foto bij de personagevraag.

Bewaart het project NIET: bewaar het zelf als nieuwe versie, anders is dit weg na een herstart van
TouchDesigner. Uitzetten: SPELERBEELD_UIT = True zetten en opnieuw draaien. Nogmaals draaien kan.
"""

SPELERBEELD_UIT = False

_TEKST = '''# For_You: bewaart beelden van de spelers (zie apply_spelerbeeld_patch.py).
import os

STROOK = 'fy_speler_strook'
SCENE = ((1, 'comp1'), (2, 'comp5'), (3, 'comp6'))
MAP_KLEIN = os.path.expanduser('~/ForYou/spelerbeeld')
MAP_SCENE = os.path.expanduser('~/ForYou/spelersfoto')
OM_DE_STROOK = 3     # buiten de scène: elke 3 frames de strook (50 fps = bijna 17 per seconde)
OM_DE_SCENE = 150    # tijdens de scène: elke 3 seconden
BEWAAR = 40          # zoveel scènebeelden blijven per plek staan


def onFrameStart(frame):
    fase = int(round(op('/project1/phase_value')['phase'].eval()))
    f = absTime.frame
    if fase != 2:
        if f % OM_DE_STROOK == 0:
            bron = op('/project1/' + STROOK)
            if bron is not None:
                os.makedirs(MAP_KLEIN, exist_ok=True)
                # Drie bestanden om de beurt: de lezer pakt het op één na nieuwste, dat is zeker af.
                bron.save(os.path.join(MAP_KLEIN, 'strook_%d.jpg' % ((f // OM_DE_STROOK) % 3)), asynchronous=True, quality=0.6)
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
    strook = r.op('fy_speler_strook') or r.create(layoutTOP, 'fy_speler_strook')
    for n in (1, 2, 3):
        strook.inputConnectors[n - 1].connect(r.op('fy_speler_klein%d' % n))
    strook.par.align = 'horizlr'
    strook.par.fit = 'fill'   # elk beeld vult zijn vak (anders komt het plat in het midden)
    strook.par.outputresolution = 'custom'
    strook.par.resolutionw = 810
    strook.par.resolutionh = 480
    strook.nodeX, strook.nodeY = x0 + 3 * 320 + 150, y0
    if dat is None:
        dat = r.create(executeDAT, 'fy_spelerbeeld')
        dat.nodeX, dat.nodeY = x0, y0 - 160
    dat.text = _TEKST
    dat.par.framestart = True
    dat.par.active = True
    oud = r.op('fy_spelersfoto')
    if oud is not None:
        oud.par.active = False
    print('For_You spelerbeeld: fy_spelerbeeld staat aan; strook %s x %s; NIET bewaard' % (strook.width, strook.height))


_spelerbeeld_patch()
