"""
For_You: het hoofdscherm als één pagina.

Draaien via de opdrachtenmap (kopie in ~/ForYou/td-opdrachten/in) of in de Textport:

    exec(open('/Users/for_you/ForYou/main/show/td-qhub-test/apply_een_pagina_patch.py').read())

Waarom: het hoofdscherm bestond uit drie webrenders (inloop/loading, emoji, ondertitel). De pagina
/audience/stage/tussen kan nu alles: buiten de scène is ze dekkend, tijdens de scène doorzichtig met
de emoji en de ondertitel erin. Eén webrender is lichter en er is minder dat mis kan gaan.

Wat het doet:
- maakt /project1/hoofd_een = audience_tussen_fit over switch10 (het camerabeeld);
- hangt /project1/Inloop, /project1/Loading en /project1/Scene alle drie aan hoofd_een;
- maakt /project1/fase_naar_pagina: geeft bij elke fasewissel, en elke twee seconden opnieuw, de fase
  door aan de pagina (window.forYouFase);
- zet de swipe-overgang van TouchDesigner uit: de pagina schuift zelf;
- zet audience_emoji_web en live_captions_web2 uit (de pagina toont ze zelf).
De oude ketens blijven staan, alleen niet aangesloten.

Bewaart NIET. Terugdraaien: EEN_PAGINA_TERUG = True zetten en opnieuw draaien.
Nogmaals draaien kan: staat het al goed, dan verandert er niets.
"""

EEN_PAGINA_TERUG = False

_FASE_TEKST = '''# For_You: geeft de fase door aan de pagina van het hoofdscherm (zie apply_een_pagina_patch.py).
def onFrameStart(frame):
    web = op('/project1/audience_tussen_web')
    waarde = int(round(op('/project1/phase_value')['phase'].eval()))
    if waarde != me.fetch('fase', -1) or absTime.frame % 100 == 0:
        me.store('fase', waarde)
        web.executeJavaScript('window.forYouFase && window.forYouFase(%d)' % waarde)
    return
'''

_SWIPE_AAN = "if oud == nieuw or not (0 <= oud <= 2 and 0 <= nieuw <= 2) or (oud < 2 and nieuw < 2):"
_SWIPE_UIT = "if True:  # de pagina van het hoofdscherm schuift zelf (apply_een_pagina_patch.py)"


def _een_pagina_patch():
    r = op('/project1')
    nodig = ['audience_tussen_web', 'audience_tussen_fit', 'switch10', 'Inloop', 'Loading', 'Scene', 'scene_comp',
             'over_loading_emoji', 'audience_emoji_web', 'live_captions_web2', 'phase_value']
    ontbreekt = [naam for naam in nodig if r.op(naam) is None]
    if ontbreekt:
        print('For_You een pagina: niets gedaan, ontbreekt: %s' % ontbreekt)
        return
    swipe = r.op('fase_swipe')
    fase = r.op('fase_naar_pagina')

    if EEN_PAGINA_TERUG:
        r.op('audience_emoji_web').par.active = True
        r.op('live_captions_web2').par.active = True
        r.op('Inloop').setInputs([r.op('over_loading_emoji')])
        r.op('Loading').setInputs([r.op('over_loading_emoji')])
        r.op('Scene').setInputs([r.op('scene_comp')])
        if fase is not None:
            fase.par.active = False
        if swipe is not None and _SWIPE_UIT in swipe.text:
            swipe.text = swipe.text.replace(_SWIPE_UIT, _SWIPE_AAN)
        print('For_You een pagina: teruggedraaid naar drie webrenders; NIET bewaard')
        return

    hoofd = r.op('hoofd_een')
    if hoofd is None:
        hoofd = r.create(overTOP, 'hoofd_een')
        scene = r.op('Scene')
        hoofd.nodeX = scene.nodeX - 220
        hoofd.nodeY = scene.nodeY - 260
        hoofd.comment = 'For_You: het hoofdscherm als één pagina over het camerabeeld'
    hoofd.setInputs([r.op('audience_tussen_fit'), r.op('switch10')])
    if fase is None:
        fase = r.create(executeDAT, 'fase_naar_pagina')
        fase.nodeX = hoofd.nodeX
        fase.nodeY = hoofd.nodeY - 160
    fase.text = _FASE_TEKST
    fase.par.framestart = True
    fase.par.active = True
    # Eerst de fase doorgeven, dan pas omleggen: zo is de pagina al doorzichtig als er een scène speelt.
    r.op('audience_tussen_web').executeJavaScript(
        'window.forYouFase && window.forYouFase(%d, true)' % int(round(r.op('phase_value')['phase'].eval())))
    swipe_stand = 'geen fase_swipe gevonden'
    if swipe is not None:
        if _SWIPE_UIT in swipe.text:
            swipe_stand = 'swipe stond al uit'
        elif _SWIPE_AAN in swipe.text:
            swipe.text = swipe.text.replace(_SWIPE_AAN, _SWIPE_UIT)
            swipe_stand = 'swipe uitgezet'
        else:
            swipe_stand = 'swipe niet herkend, niet aangepast'
    run("op('/project1/audience_tussen_web') and [op('/project1/' + n).setInputs([op('/project1/hoofd_een')]) for n in ('Inloop', 'Loading', 'Scene')]", delayFrames=25)
    run("[setattr(op('/project1/' + n).par, 'active', False) for n in ('audience_emoji_web', 'live_captions_web2')]", delayFrames=60)
    print('For_You een pagina: hoofd_een en fase_naar_pagina klaar; %s; omleggen volgt over een halve seconde; NIET bewaard' % swipe_stand)


_een_pagina_patch()
