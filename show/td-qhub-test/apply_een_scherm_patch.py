"""
For_You: inloop en loading tonen hetzelfde scherm.

Draaien via de opdrachtenmap (kopie in ~/ForYou/td-opdrachten/in) of in de Textport:

    exec(open('/Users/for_you/ForYou/main/show/td-qhub-test/apply_een_scherm_patch.py').read())

Waarom: de pagina van de loadingfase (/audience/stage/tussen) is nu één scherm voor inloop en
loading: universum, QR-code, stemmen, genereren en chat. Het hoofdscherm wisselt alleen nog
tussen dat scherm en de scène.

Wat het doet:
- /project1/Inloop krijgt dezelfde bron als /project1/Loading (over_loading_emoji) in plaats van
  null4 (universum met de twee QR-codes). De oude keten blijft staan, alleen niet aangesloten.
- De swipe-overgang slaat de wissel tussen inloop en loading over: het beeld is hetzelfde.

Bewaart NIET. Terugdraaien: EEN_SCHERM_TERUG = True zetten en opnieuw draaien.
Nogmaals draaien kan: staat het al goed, dan verandert er niets.
"""

EEN_SCHERM_TERUG = False

_SWIPE_OUD = "if oud == nieuw or not (0 <= oud <= 2 and 0 <= nieuw <= 2):"
_SWIPE_NIEUW = "if oud == nieuw or not (0 <= oud <= 2 and 0 <= nieuw <= 2) or (oud < 2 and nieuw < 2):"


def _een_scherm_patch():
    root = op('/project1')
    inloop = root.op('Inloop') if root else None
    bron = root.op('null4' if EEN_SCHERM_TERUG else 'over_loading_emoji') if root else None
    if inloop is None or bron is None:
        print('For_You een scherm: niets gedaan, Inloop of de bron ontbreekt')
        return
    was = [i.name for i in inloop.inputs]
    if was != [bron.name]:
        inloop.setInputs([bron])
    swipe = root.op('fase_swipe')
    swipe_stand = 'geen fase_swipe gevonden'
    if swipe is not None:
        van, naar = (_SWIPE_NIEUW, _SWIPE_OUD) if EEN_SCHERM_TERUG else (_SWIPE_OUD, _SWIPE_NIEUW)
        if naar in swipe.text:
            swipe_stand = 'swipe stond al goed'
        elif van in swipe.text:
            swipe.text = swipe.text.replace(van, naar)
            swipe_stand = 'swipe aangepast'
        else:
            swipe_stand = 'swipe niet herkend, niet aangepast'
    print('For_You een scherm: Inloop was %s, is nu %s; %s; NIET bewaard' % (was, [i.name for i in inloop.inputs], swipe_stand))


_een_scherm_patch()
